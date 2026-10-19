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
import type { ManualIncidentSnapshot, TemplateKey } from "../domain/triage-contracts";
import type { TemplateCandidateRecord, TemplateSnapshot } from "../domain/template-contracts";
import { renderAutomaticTemplate, renderStaffReplySnapshot } from "../domain/template-renderer";
import { evidenceTargets, planReplyClaim, restrictiveMode } from "../domain/reply-claim";
import { inHelpdeskTransaction } from "../postgres/transaction";
import { EpisodeStore } from "../repositories/episode-store";
import {
  PersistenceError, type InboundReceipt, type ProcessingContext, type ProcessingResult,
  type StaffEpisodeAction, type StaffMutationResult,
  type ConversationSnapshot, type ConversationMessageItem,
} from "./persistence-contracts";
import { evaluatePreDispatchGate } from "../domain/dispatch-gate";
import type {
  PreDispatchEvaluationInput,
  PreDispatchEvaluationResult,
  IncidentSnapshot,
} from "../domain/dispatch-contracts";
import { parseTesterAllowlist } from "../adapters/telegram/telegram-adapter";
import type { AutomationMode, TriageDecision } from "../domain/triage-contracts";

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

      const meta = input.metadata;
      const messageType = meta?.messageType ?? "text";
      const hasMedia = Boolean(meta?.hasMedia);
      const isForwarded = Boolean(meta?.isForwarded);
      const caption = meta?.caption ?? null;
      const sentAt = meta?.sentAt && !Number.isNaN(new Date(meta.sentAt).getTime())
        ? new Date(meta.sentAt).toISOString()
        : null;
      const senderInfo = meta?.senderInfo ? JSON.stringify(meta.senderInfo) : "{}";

      const inserted = await db.query<{ id: string }>(
        `insert into public.ingress_events(
          identity_id, channel, account_id, chat_id, provider_message_id, body,
          mode, settings_version, emergency_stop,
          message_type, has_media, is_forwarded, caption, sent_at, sender_info
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
        on conflict(channel, account_id, chat_id, provider_message_id)
        do nothing returning id`,
        [
          identityId, input.sender.channel, input.sender.channelAccountId, input.chatId,
          input.providerMessageId, input.text, settings.mode, settings.version, settings.emergency_stop,
          messageType, hasMedia, isForwarded, caption, sentAt, senderInfo
        ]);
      let ingressId = inserted.rows[0]?.id;
      if (!ingressId) {
        const existing = await db.query<{ id: string; identity_id: string }>(
          `select id, identity_id from public.ingress_events
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
      const jobRes = await db.query<{
        status: string;
        lease_token: string | null;
        lease_expires_at: string | null;
      }>(
        "select status, lease_token, lease_expires_at from public.processing_jobs where ingress_id=$1 for update",
        [ingressId]
      );
      if (jobRes.rowCount !== 1) throw new PersistenceError("pending_job_not_found");
      const jobRow = jobRes.rows[0];

      const nowTime = Date.now();
      const leaseActive =
        jobRow.lease_expires_at != null &&
        new Date(jobRow.lease_expires_at).getTime() > nowTime;

      if (context.leaseToken) {
        if (
          jobRow.status !== "in_progress" ||
          jobRow.lease_token !== context.leaseToken ||
          !leaseActive
        ) {
          throw new PersistenceError("lease_lost");
        }
      } else {
        if (jobRow.status === "in_progress") {
          if (leaseActive) {
            throw new PersistenceError("job_leased_by_other_worker");
          }
          throw new PersistenceError("job_lease_expired");
        }
        if (jobRow.status === "done") {
          const prev = await store.processed(ingressId);
          if (prev) return prev;
          throw new PersistenceError("job_already_done");
        }
        if (jobRow.status === "failed") {
          throw new PersistenceError("job_already_failed");
        }
      }
      const conversationInfo = await store.ensureConversationForIngress(receipt);
      const conversationId = conversationInfo.conversationId;
      const now = new Date().toISOString();
      const candidate = await store.identity(receipt.identity_id);
      const identity = resolveSenderIdentity(candidate, [candidate], now);
      const classification = classifyMessage(receipt.body);
      const settings = await store.settings();

      // Ensure network evidence belongs to the latest resolved service and customer of this identity
      let effectiveNetwork = context.network ?? null;
      if (effectiveNetwork) {
        if (
          identity.outcome !== "resolved" ||
          identity.serviceId !== effectiveNetwork.serviceId ||
          identity.customerId !== effectiveNetwork.customerId
        ) {
          effectiveNetwork = null;
        }
      }

      // Re-validate manual incidents from database inside the final transaction
      // All ACTIVE manual incidents currently in the database are the authoritative source.
      // Context snapshots are never used to revive missing, deleted, or resolved incidents.
      const dbIncidentsResult = await db.query<{
        id: string; type: string; status: string; odp_ids: string[]; odc_ids: string[]; version: number;
        description: string | null; estimated_recovery: string | null;
      }>("select id, type, status, odp_ids, odc_ids, version, description, estimated_recovery from public.incidents where status = 'ACTIVE' for share");

      const effectiveIncidents: ManualIncidentSnapshot[] = dbIncidentsResult.rows.map(inc => ({
        id: inc.id,
        type: inc.type as "GENERAL" | "AREA_SPECIFIC",
        status: "ACTIVE" as const,
        odpIds: inc.odp_ids ?? [],
        odcIds: inc.odc_ids ?? [],
        version: inc.version,
      }));

      const decision = decideTriage({
        evaluatedAt: now, classification, identity, network: effectiveNetwork,
        manualIncidents: effectiveIncidents,
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
      await db.query("insert into public.messages(id,identity_id,conversation_id,classification,review_reason) values ($1,$2,$3,$4::jsonb,$5)",
        [ingressId, receipt.identity_id, conversationId, JSON.stringify(classification),
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
      let templateSnapshot: TemplateSnapshot | null = null;
      let templateError: string | null = null;
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
        if (plan.reason) {
          claim = { outcome: "skipped", reason: plan.reason, intentId: null };
        } else if (decision.effectiveTemplateKey) {
          let estimatedRecovery: string | null = null;
          if (decision.incidentId) {
            const inc = dbIncidentsResult.rows.find(r => r.id === decision.incidentId);
            estimatedRecovery = inc?.estimated_recovery ?? null;
          }

          const templateRows = await db.query<{
            template_id: string;
            template_key: string;
            scope: "default" | "incident";
            incident_id: string | null;
            version_id: string;
            version: number;
            body: string;
            is_active: boolean;
          }>(
            `select
               rt.id as template_id,
               rt.template_key,
               rt.scope,
               rt.incident_id,
               tv.id as version_id,
               tv.version,
               tv.body,
               tv.is_active
             from public.response_templates rt
             join public.template_versions tv on tv.template_id = rt.id
             where rt.template_key = $1
               and (
                 rt.scope = 'default'
                 or ($2::uuid is not null and rt.scope = 'incident' and rt.incident_id = $2::uuid)
               )`,
            [decision.effectiveTemplateKey, decision.incidentId]
          );

          const candidates: TemplateCandidateRecord[] = templateRows.rows.map(r => ({
            id: r.template_id,
            templateKey: r.template_key as TemplateKey,
            scope: r.scope,
            incidentId: r.incident_id,
            versionId: r.version_id,
            version: r.version,
            body: r.body,
            isActive: r.is_active,
          }));

          const renderResult = renderAutomaticTemplate({
            templateKey: decision.effectiveTemplateKey,
            candidates,
            incidentId: decision.incidentId,
            estimatedRecovery,
            renderedAt: now,
          });

          if (renderResult.outcome === "template_error") {
            claim = { outcome: "skipped", reason: "template_error", intentId: null };
            templateError = renderResult.errorCode;
            await store.audit(
              episode.id,
              "template_error",
              {
                errorCode: renderResult.errorCode,
                reason: renderResult.reason,
                templateKey: decision.effectiveTemplateKey,
              },
              null,
              ingressId
            );
          } else {
            templateSnapshot = renderResult.snapshot;
            const intentId = await store.reserve(
              ownerId,
              episode.id,
              ingressId,
              decision,
              plan.targets,
              templateSnapshot
            );
            claim = intentId
              ? { outcome: "reserved", reason: "reserved_not_authorized", intentId }
              : { outcome: "skipped", reason: "claim_conflict", intentId: null };
          }
        } else {
          claim = { outcome: "skipped", reason: "no_template", intentId: null };
        }
      }
      const result: ProcessingResult = {
        messageId: ingressId,
        conversationId,
        episodeId: episode?.id ?? null,
        association,
        decision,
        claim,
        dispatchAuthorized: false,
        providerQuality: context.providerQuality ?? null,
        ...(templateSnapshot ? { templateSnapshot } : {}),
        ...(templateError ? { templateError } : {}),
      };
      await db.query(
        "insert into public.triage_assessments(message_id,decision,processing_result) values ($1,$2::jsonb,$3::jsonb)",
        [ingressId, JSON.stringify(decision), JSON.stringify(result)]);
      await store.audit(episode?.id ?? null, "inbound_processed",
        { association: association.reason, claim, mode: decision.automation.mode }, null, ingressId);
      if (context.leaseToken) {
        const updateJob = await db.query(
          `update public.processing_jobs
           set status='done', completed_at=now(), lease_token=null, lease_expires_at=null
           where ingress_id=$1 and lease_token=$2 and status='in_progress'`,
          [ingressId, context.leaseToken]
        );
        if (updateJob.rowCount !== 1) {
          throw new PersistenceError("lease_lost");
        }
        await db.query(
          `update public.processing_job_attempts
           set outcome='success', completed_at=now()
           where ingress_id=$1 and lease_token=$2 and outcome='in_progress'`,
          [ingressId, context.leaseToken]
        );
      } else {
        await db.query(
          `update public.processing_jobs
           set status='done', completed_at=now(), lease_token=null, lease_expires_at=null
           where ingress_id=$1`,
          [ingressId]
        );
      }
      return result;
    });
  }

  async staffAction(staffId: string, input: StaffEpisodeAction): Promise<StaffResult> {
    requireId(staffId); requireId(input.requestId); requireId(input.episodeId);
    let staffOutboundText: string | null = null;
    if (input.action === "manual_reply") {
      const staffRender = renderStaffReplySnapshot(input.body);
      if (staffRender.outcome !== "rendered") throw new PersistenceError("invalid_reply");
      staffOutboundText = staffRender.outboundText;
    }
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
          [episode.id, staffId, input.requestId, staffOutboundText]);
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

  async getConversation(conversationId: string): Promise<ConversationSnapshot | null> {
    requireId(conversationId);
    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);
      return store.getConversation(conversationId);
    });
  }

  async getConversationHistory(conversationId: string): Promise<ConversationMessageItem[]> {
    requireId(conversationId);
    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);
      return store.getConversationHistory(conversationId);
    });
  }

  async evaluateDispatchGate(
    intentId: string,
    options?: {
      testerAllowlist?: readonly string[] | ReadonlySet<string>;
      evaluatedAt?: string;
    }
  ): Promise<PreDispatchEvaluationResult> {
    requireId(intentId);
    const evaluatedAt = options?.evaluatedAt ?? new Date().toISOString();
    const testerAllowlist =
      options?.testerAllowlist ??
      parseTesterAllowlist(process.env.TELEGRAM_TESTER_ALLOWLIST);

    return inHelpdeskTransaction(this.pool, async db => {
      const store = new EpisodeStore(db);

      // 1. Fetch outbound intent with row-level lock
      const intentRes = await db.query<{
        id: string;
        origin: "automatic" | "staff";
        status: string;
        complaint_id: string;
        owner_id: string | null;
        message_id: string | null;
        decision: unknown;
        staff_id: string | null;
        client_request_id: string | null;
        body: string | null;
        template_version_id: string | null;
        template_key: string | null;
        template_version: number | null;
        template_scope: string | null;
        template_error: string | null;
      }>(
        `select id, origin, status, complaint_id, owner_id, message_id, decision,
                staff_id, client_request_id, body, template_version_id, template_key,
                template_version, template_scope, template_error
         from public.outbound_intents
         where id = $1
         for update`,
        [intentId]
      );

      if (intentRes.rowCount !== 1) {
        throw new PersistenceError("intent_not_found");
      }

      const row = intentRes.rows[0];
      const intent = {
        id: row.id,
        origin: row.origin,
        status: row.status,
        complaintId: row.complaint_id,
        ownerId: row.owner_id,
        messageId: row.message_id,
        decision: row.decision as TriageDecision | null,
        staffId: row.staff_id,
        clientRequestId: row.client_request_id,
        body: row.body,
        templateVersionId: row.template_version_id,
        templateKey: row.template_key,
        templateVersion: row.template_version,
        templateScope: row.template_scope,
        templateError: row.template_error,
      };

      // 2. Fetch current settings
      const dbSettings = await store.settings();
      const currentSettings = dbSettings
        ? {
            mode: dbSettings.mode,
            emergencyStop: dbSettings.emergency_stop,
            version: dbSettings.version,
          }
        : null;

      // 3. Fetch episode if exists
      let episode: EpisodeSnapshot | null = null;
      if (intent.complaintId) {
        try {
          episode = await store.episode(intent.complaintId);
        } catch {
          episode = null;
        }
      }

      // 4. Fetch channel, account, chat, and sender info
      let channel: string | null = null;
      let channelAccountId: string | null = null;
      let chatId: string | null = null;
      let senderExternalId: string | null = null;
      let conversationId: string | null = null;
      let customerVerifiedOwnerId: string | null = null;

      let messagePersisted = false;
      let assessmentPersisted = false;
      let ingress: { mode: AutomationMode; emergencyStop: boolean } | null = null;
      let isFirstMessageOnEpisode = false;
      let hasStaffReplyOnEpisode = false;
      let hasOtherActiveOrSentAutoIntentOnEpisode = false;

      if (intent.origin === "automatic" && intent.messageId) {
        // Fetch message
        const msgRes = await db.query<{ id: string; conversation_id: string | null; complaint_id: string }>(
          "select id, conversation_id, complaint_id from public.messages where id = $1",
          [intent.messageId]
        );
        const msgRow = msgRes.rows[0];
        if (msgRow && msgRow.complaint_id === intent.complaintId && msgRow.conversation_id) {
          messagePersisted = true;
          conversationId = msgRow.conversation_id;
        }

        // Fetch triage assessment
        const assessRes = await db.query<{ message_id: string }>(
          "select message_id from public.triage_assessments where message_id = $1",
          [intent.messageId]
        );
        if (assessRes.rowCount === 1) {
          assessmentPersisted = true;
        }

        // Fetch ingress event
        const ingressRes = await db.query<{
          channel: string;
          account_id: string;
          chat_id: string;
          mode: AutomationMode;
          emergency_stop: boolean;
          identity_id: string;
        }>(
          "select channel, account_id, chat_id, mode, emergency_stop, identity_id from public.ingress_events where id = $1",
          [intent.messageId]
        );
        const ingressRow = ingressRes.rows[0];
        if (ingressRow) {
          ingress = { mode: ingressRow.mode, emergencyStop: ingressRow.emergency_stop };
          channel = ingressRow.channel;
          channelAccountId = ingressRow.account_id;
          chatId = ingressRow.chat_id;

          // Fetch senderExternalId and customerId from channel_identities
          const identRes = await db.query<{ sender_external_id: string; customer_id: string | null; verification_status: string }>(
            "select sender_external_id, customer_id, verification_status from public.channel_identities where id = $1",
            [ingressRow.identity_id]
          );
          if (identRes.rows[0]) {
            senderExternalId = identRes.rows[0].sender_external_id;
            if (identRes.rows[0].verification_status === "verified" && identRes.rows[0].customer_id) {
              const custOwnerRes = await db.query<{ id: string }>(
                "select id from public.reply_owners where customer_id = $1",
                [identRes.rows[0].customer_id]
              );
              if (custOwnerRes.rows[0]) {
                customerVerifiedOwnerId = custOwnerRes.rows[0].id;
              }
            }
          }
        }

        // Check if first message on episode
        if (intent.complaintId) {
          const firstMsgRes = await db.query<{ id: string }>(
            "select id from public.messages where complaint_id = $1 order by created_at asc, id asc limit 1",
            [intent.complaintId]
          );
          isFirstMessageOnEpisode = firstMsgRes.rows[0]?.id === intent.messageId;

          // Check if has staff reply on episode
          const staffReplyRes = await db.query(
            "select 1 from public.outbound_intents where complaint_id = $1 and origin = 'staff' and status <> 'cancelled' limit 1",
            [intent.complaintId]
          );
          hasStaffReplyOnEpisode = (staffReplyRes.rowCount ?? 0) > 0;

          // Check if has other active or sent auto intent on episode
          const otherAutoRes = await db.query(
            "select 1 from public.outbound_intents where complaint_id = $1 and origin = 'automatic' and id <> $2 and status in ('in_flight', 'sent', 'unknown') limit 1",
            [intent.complaintId, intent.id]
          );
          hasOtherActiveOrSentAutoIntentOnEpisode = (otherAutoRes.rowCount ?? 0) > 0;
        }
      } else if (intent.origin === "staff") {
        // For staff reply, channel info is found via episode's identity or latest message
        if (episode) {
          const identityId = episode.scope.kind === "service" ? episode.scope.identityId : episode.scope.identityId;
          const identRes = await db.query<{ channel: string; channel_account_id: string; sender_external_id: string }>(
            "select channel, channel_account_id, sender_external_id from public.channel_identities where id = $1",
            [identityId]
          );
          if (identRes.rows[0]) {
            channel = identRes.rows[0].channel;
            channelAccountId = identRes.rows[0].channel_account_id;
            senderExternalId = identRes.rows[0].sender_external_id;
          }

          // Conversation and chat_id from conversation or latest message
          const convRes = await db.query<{ id: string; chat_id: string }>(
            "select id, chat_id from public.conversations where identity_id = $1 order by last_activity_at desc limit 1",
            [identityId]
          );
          if (convRes.rows[0]) {
            conversationId = convRes.rows[0].id;
            chatId = convRes.rows[0].chat_id;
          } else {
            // Fallback to latest message
            const latestMsgRes = await db.query<{ conversation_id: string; chat_id: string }>(
              `select m.conversation_id, i.chat_id
               from public.messages m
               join public.ingress_events i on i.id = m.id
               where m.complaint_id = $1
               order by m.created_at desc limit 1`,
              [intent.complaintId]
            );
            if (latestMsgRes.rows[0]) {
              conversationId = latestMsgRes.rows[0].conversation_id;
              chatId = latestMsgRes.rows[0].chat_id;
            } else {
              chatId = senderExternalId;
            }
          }
        }
      }

      // 5. Claims and Owner
      let intentOwner: { id: string; mergedInto: string | null } | null = null;
      if (intent.ownerId) {
        const ownerRes = await db.query<{ id: string; merged_into: string | null }>(
          "select id, merged_into from public.reply_owners where id = $1",
          [intent.ownerId]
        );
        if (ownerRes.rows[0]) {
          intentOwner = { id: ownerRes.rows[0].id, mergedInto: ownerRes.rows[0].merged_into };
        }
      }

      const existingClaimsRes = await db.query<{
        owner_id: string;
        scope_kind: "episode" | "incident" | "event";
        scope_id: string;
        outbound_intent_id: string;
      }>(
        `select owner_id, scope_kind, scope_id, outbound_intent_id
         from public.reply_claims
         where owner_id = $1
            or ($2::uuid is not null and owner_id = $2)
            or ($3::uuid is not null and complaint_id = $3)
            or outbound_intent_id = $4`,
        [intent.ownerId, intentOwner?.mergedInto ?? null, intent.complaintId, intent.id]
      );
      const existingClaims = existingClaimsRes.rows.map((r) => ({
        ownerId: r.owner_id,
        scopeKind: r.scope_kind,
        scopeId: r.scope_id,
        outboundIntentId: r.outbound_intent_id,
      }));

      // 6. Current incident if relevant
      let currentIncident: IncidentSnapshot | null = null;
      if (intent.decision?.incidentId) {
        const incRes = await db.query<{
          id: string;
          type: "GENERAL" | "AREA_SPECIFIC";
          status: "ACTIVE" | "RESOLVED" | "CLOSED";
          version: number;
          odp_ids: string[];
          odc_ids: string[];
        }>(
          "select id, type, status, version, odp_ids, odc_ids from public.incidents where id = $1 for share",
          [intent.decision.incidentId]
        );
        if (incRes.rows[0]) {
          currentIncident = {
            id: incRes.rows[0].id,
            type: incRes.rows[0].type,
            status: incRes.rows[0].status,
            version: incRes.rows[0].version,
            odpIds: incRes.rows[0].odp_ids ?? [],
            odcIds: incRes.rows[0].odc_ids ?? [],
          };
        }
      }

      // 7. Evaluate pure gate
      const evaluationInput: PreDispatchEvaluationInput = {
        evaluatedAt,
        testerAllowlist,
        intent,
        handoff: {
          episode,
          conversationId,
          channel,
          channelAccountId,
          chatId,
          senderExternalId,
          customerVerifiedOwnerId,
          messagePersisted,
          assessmentPersisted,
          ingress,
          isFirstMessageOnEpisode,
          hasStaffReplyOnEpisode,
          hasOtherActiveOrSentAutoIntentOnEpisode,
        },
        claims: {
          intentOwner,
          existingClaims,
        },
        currentSettings,
        currentIncident,
      };

      const result = evaluatePreDispatchGate(evaluationInput);

      // 8. Transactional side-effects
      if (result.outcome === "blocked") {
        if (result.shouldCancelIntent) {
          await db.query(
            "update public.outbound_intents set status = 'cancelled', updated_at = now() where id = $1 and status = 'pending'",
            [intent.id]
          );
          await store.audit(
            intent.complaintId,
            "dispatch_blocked",
            {
              intentId: intent.id,
              origin: intent.origin,
              primaryReason: result.primaryReason,
              blockedReasons: result.blockedReasons,
            },
            intent.origin === "staff" ? intent.staffId : null,
            intent.origin === "automatic" ? intent.messageId : null
          );
        }
      } else {
        // outcome: "authorized"
        // Log audit if not already logged
        const existingAudit = await db.query(
          "select 1 from public.complaint_audit_log where action = 'dispatch_authorized' and detail->>'intentId' = $1 limit 1",
          [intent.id]
        );
        if ((existingAudit.rowCount ?? 0) === 0) {
          await store.audit(
            intent.complaintId,
            "dispatch_authorized",
            {
              intentId: intent.id,
              origin: intent.origin,
              effectiveMode: result.effectiveMode,
              authorizedIncidentId: result.authorizedIncidentId,
              authorizedIncidentVersion: result.authorizedIncidentVersion,
              evaluatedAt: result.evaluatedAt,
            },
            intent.origin === "staff" ? intent.staffId : null,
            intent.origin === "automatic" ? intent.messageId : null
          );
        }
      }

      return result;
    });
  }
}
