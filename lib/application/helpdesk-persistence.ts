import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  associateMessageToEpisode, closeEpisode, reopenEpisode, reopenEpisodeFromInbound,
  resolveEpisode, splitEpisode, startHandling, recordManualReply,
} from "../domain/episode-lifecycle";
import type { EpisodeSnapshot, StaffCommand } from "../domain/episode-contracts";
import { classifyMessage } from "../domain/message-classification";
import { isValidSenderKey, resolveSenderIdentity } from "../domain/sender-identity";
import { decideTriage } from "../domain/triage-decision";
import { evidenceTargets, planReplyClaim, restrictiveMode } from "../domain/reply-claim";
import { inHelpdeskTransaction } from "../postgres/transaction";
import { EpisodeStore } from "../repositories/episode-store";
import {
  PersistenceError, type InboundReceipt, type ProcessingContext, type ProcessingResult,
  type StaffEpisodeAction, type StaffMutationResult,
} from "./persistence-contracts";

export type StaffResult = {
  result: StaffMutationResult; inFlightCount: number; createdEpisodeId?: string; manualIntentId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(id: string) {
  if (!uuid.test(id)) throw new PersistenceError("invalid_id");
}
function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Internal services only: ingress is authenticated by its adapter; staffId comes from server session. */
export class HelpdeskPersistence {
  constructor(private readonly pool: Pool) {}

  async receive(input: InboundReceipt): Promise<{ ingressId: string; duplicate: boolean }> {
    if (!isValidSenderKey(input.sender) || !input.chatId?.trim() || !input.providerMessageId?.trim() ||
        typeof input.text !== "string" || input.text.length > 10000) throw new PersistenceError("invalid_ingress");
    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);
      const identityId = await store.ensureIdentity(input.sender);
      const settings = await store.settings();
      const inserted = await db.query<{ id: string }>(
        `insert into public.ingress_events(identity_id,channel,account_id,chat_id,provider_message_id,body,mode,settings_version,emergency_stop)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(channel,account_id,chat_id,provider_message_id)
         do nothing returning id`,
        [identityId, input.sender.channel, input.sender.channelAccountId, input.chatId,
          input.providerMessageId, input.text, settings.mode, settings.version, settings.emergency_stop]);
      let ingressId = inserted.rows[0]?.id;
      if (!ingressId) {
        const existing = await db.query<{ id: string; identity_id: string }>(
          `select id,identity_id from public.ingress_events
           where channel=$1 and account_id=$2 and chat_id=$3 and provider_message_id=$4`,
          [input.sender.channel, input.sender.channelAccountId, input.chatId, input.providerMessageId]);
        if (existing.rows[0]?.identity_id !== identityId) throw new PersistenceError("ingress_identity_conflict");
        ingressId = existing.rows[0].id;
      }
      await db.query("insert into public.processing_jobs(ingress_id) values ($1) on conflict do nothing", [ingressId]);
      return { ingressId, duplicate: !inserted.rowCount };
    });
  }

  async process(ingressId: string, context: ProcessingContext = {}): Promise<ProcessingResult> {
    requireId(ingressId);
    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);
      const receipt = await store.receipt(ingressId);
      const previous = await store.processed(ingressId);
      if (previous) return previous;
      const job = await db.query("select 1 from public.processing_jobs where ingress_id=$1 and status='pending' for update", [ingressId]);
      if (job.rowCount !== 1) throw new PersistenceError("pending_job_not_found");
      const now = new Date().toISOString();
      const candidate = await store.identity(receipt.identity_id);
      const identity = resolveSenderIdentity(candidate, [candidate], now);
      const classification = classifyMessage(receipt.body);
      const settings = await store.settings();
      const decision = decideTriage({
        evaluatedAt: now, classification, identity, network: context.network ?? null,
        manualIncidents: context.manualIncidents,
        mode: restrictiveMode(receipt.mode, settings.mode),
        emergencyStop: receipt.emergency_stop || settings.emergency_stop,
      });
      const episodes = await store.episodes(receipt.identity_id,
        identity.outcome === "resolved" ? identity.serviceId : null);
      const associationInput = {
        classification, identity, existingEpisodes: episodes,
        triageDecision: decision, targetEpisodeId: context.targetEpisodeId,
      };
      const association = associateMessageToEpisode(associationInput);
      await db.query("insert into public.messages(id,identity_id,classification,review_reason) values ($1,$2,$3::jsonb,$4)",
        [ingressId, receipt.identity_id, JSON.stringify(classification),
          association.outcome === "review" ? association.reason : null]);
      let episode: EpisodeSnapshot | null = null;
      if (association.outcome === "create_new" || association.outcome === "create_after_closed") {
        if (!association.newEpisodeScope || !association.newEpisodeCategory) throw new PersistenceError("invalid_association");
        episode = await store.createEpisode({
          scope: association.newEpisodeScope, category: association.newEpisodeCategory,
          status: "NEW", automationSuppressed: false, isPrimary: true, closedAt: null,
          previousEpisodeId: association.previousEpisodeId, splitFromEpisodeId: null,
        });
        await store.audit(episode.id, "created", { previousEpisodeId: association.previousEpisodeId }, null, ingressId);
      } else if (association.episodeId) {
        episode = await store.episode(association.episodeId);
        if (association.outcome === "reopen_resolved") {
          const reopened = reopenEpisodeFromInbound(episode, {
            expectedVersion: association.expectedVersion!, at: now, messageId: ingressId, association: associationInput,
          });
          if (reopened.outcome !== "accepted") throw new PersistenceError(reopened.reason);
          await store.apply(reopened);
          episode = await store.episode(episode.id);
        }
      }

      let claim: ProcessingResult["claim"] = { outcome: "skipped", reason: "review", intentId: null };
      if (episode) {
        const count = await db.query<{ count: string }>("select count(*) from public.messages where complaint_id=$1", [episode.id]);
        const firstMessage = Number(count.rows[0].count) === 0;
        await db.query("update public.messages set complaint_id=$2 where id=$1", [ingressId, episode.id]);
        const ownerId = await store.owner(receipt.identity_id,
          candidate.verificationStatus === "verified" ? candidate.customerId : null);
        const targets = evidenceTargets(decision);
        await store.evidence(episode.id, ownerId, targets,
          decision.automation.mode !== "SHADOW" && !receipt.emergency_stop && !settings.emergency_stop);
        const plan = planReplyClaim(episode, firstMessage, decision);
        if (plan.reason) claim = { outcome: "skipped", reason: plan.reason, intentId: null };
        else {
          const intentId = await store.reserve(ownerId, episode.id, ingressId, decision, plan.targets);
          claim = intentId ? { outcome: "reserved", reason: "reserved_not_authorized", intentId }
            : { outcome: "skipped", reason: "claim_conflict", intentId: null };
        }
      }
      const result: ProcessingResult = {
        messageId: ingressId, episodeId: episode?.id ?? null, association, decision, claim, dispatchAuthorized: false,
      };
      await db.query(
        "insert into public.triage_assessments(message_id,decision,processing_result) values ($1,$2::jsonb,$3::jsonb)",
        [ingressId, JSON.stringify(decision), JSON.stringify(result)]);
      await store.audit(episode?.id ?? null, "inbound_processed",
        { association: association.reason, claim, mode: decision.automation.mode }, null, ingressId);
      await db.query("update public.processing_jobs set status='done',completed_at=now() where ingress_id=$1", [ingressId]);
      return result;
    });
  }

  async staffAction(staffId: string, input: StaffEpisodeAction): Promise<StaffResult> {
    requireId(staffId); requireId(input.requestId); requireId(input.episodeId);
    if (input.action === "manual_reply" && (typeof input.body !== "string" ||
        !input.body.trim() || input.body.length > 10000)) throw new PersistenceError("invalid_reply");
    const hash = fingerprint(["episode", input.episodeId, input.expectedVersion, input.action,
      input.action === "resolve" ? input.note : input.action === "split" ? input.reason :
        input.action === "manual_reply" ? input.body : null]);
    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);
      const previous = await store.commandResult<StaffResult>(staffId, input.requestId, hash);
      if (previous) return previous;
      const episode = await store.episode(input.episodeId);
      const command: StaffCommand = {
        actor: { kind: "staff", staffId }, expectedVersion: input.expectedVersion, at: new Date().toISOString(),
      };
      let result: StaffMutationResult;
      let createdEpisodeId: string | undefined;
      if (input.action === "split") {
        result = splitEpisode(episode, { ...command, splitReason: input.reason });
        if (result.outcome === "accepted") {
          const changed = await db.query(
            "update public.complaints set version=version+1,updated_at=now() where id=$1 and version=$2 returning id",
            [episode.id, input.expectedVersion]);
          if (changed.rowCount !== 1) throw new PersistenceError("version_mismatch");
          const child = await store.createEpisode(result.newEpisode);
          createdEpisodeId = child.id;
          await store.audit(child.id, "split_created", { ...result.audit, sourceEpisodeId: episode.id }, staffId, null);
          await store.audit(episode.id, "split_source", { childEpisodeId: child.id }, staffId, null);
        }
      } else if (input.action === "primary") {
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new PersistenceError("invalid_version");
        if (episode.version !== input.expectedVersion) throw new PersistenceError("version_mismatch");
        if (episode.status === "CLOSED") throw new PersistenceError("closed_is_final");
        if (episode.isPrimary) result = { ruleVersion: "episode-lifecycle-v2", outcome: "noop", reason: "already_in_status" };
        else {
          const demoted = await db.query<{ id: string }>(
            `update public.complaints set is_primary=false,version=version+1,updated_at=now()
             where is_primary and status<>'CLOSED' and
             (($1::uuid is not null and service_id=$1) or ($1::uuid is null and service_id is null and identity_id=$2))
             returning id`, [episode.scope.kind === "service" ? episode.scope.serviceId : null, episode.scope.identityId]);
          for (const old of demoted.rows) await store.audit(old.id, "primary_replaced", { replacementId: episode.id }, staffId, null);
          await db.query("update public.complaints set is_primary=true,version=version+1,updated_at=now() where id=$1", [episode.id]);
          await store.audit(episode.id, "primary_selected", {}, staffId, null);
          result = { outcome: "accepted", reason: "primary_selected", episodeId: episode.id };
        }
      } else {
        switch (input.action) {
          case "start": result = startHandling(episode, command); break;
          case "resolve": result = resolveEpisode(episode, { ...command, resolutionNote: input.note }); break;
          case "reopen": result = reopenEpisode(episode, command); break;
          case "close": result = closeEpisode(episode, command); break;
          case "manual_reply": result = recordManualReply(episode, command); break;
          default: throw new PersistenceError("invalid_action");
        }
        if (result.outcome === "accepted") await store.apply(result);
      }
      let manualIntentId: string | undefined;
      if (input.action === "manual_reply" && result.outcome !== "rejected") {
        const queued = await db.query<{ id: string }>(
          "insert into public.outbound_intents(origin,complaint_id,staff_id,client_request_id,body) values ('staff',$1,$2,$3,$4) returning id",
          [episode.id, staffId, input.requestId, input.body]);
        manualIntentId = queued.rows[0].id;
        await store.audit(episode.id, "manual_reply_queued", { intentId: manualIntentId }, staffId, null);
      }
      const inFlightCount = (result.outcome === "accepted" || manualIntentId) && input.action !== "primary" && input.action !== "split"
        ? await store.cancelPending(episode.id) : 0;
      const saved: StaffResult = { result, inFlightCount,
        ...(createdEpisodeId ? { createdEpisodeId } : {}), ...(manualIntentId ? { manualIntentId } : {}) };
      await store.saveCommand(staffId, input.requestId, hash, saved);
      return saved;
    });
  }
}
