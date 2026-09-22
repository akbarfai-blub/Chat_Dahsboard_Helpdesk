import type { PoolClient } from "pg";
import type { EpisodeSnapshot, EpisodeActionResult } from "../domain/episode-contracts";
import type { IdentityCandidate, SenderKey } from "../domain/sender-identity";
import type { AutomationMode, TriageDecision } from "../domain/triage-contracts";
import type { ClaimTarget } from "../domain/reply-claim";
import { PersistenceError, type ProcessingResult } from "../application/persistence-contracts";

export type Settings = { mode: AutomationMode; emergency_stop: boolean; version: number };
export type ReceiptRow = {
  id: string; identity_id: string; channel: string; account_id: string; chat_id: string;
  provider_message_id: string; body: string; received_at: Date; mode: AutomationMode;
  emergency_stop: boolean;
};
type EpisodeRow = {
  id: string; version: number; status: EpisodeSnapshot["status"]; category: EpisodeSnapshot["category"];
  identity_id: string; service_id: string | null; is_primary: boolean; automation_suppressed: boolean;
  closed_at: Date | null; split_from_episode_id: string | null; previous_episode_id: string | null;
};
export type EpisodeDraft = Omit<EpisodeSnapshot, "id" | "version">;
type AcceptedAction = Extract<EpisodeActionResult, { outcome: "accepted" }>;

function snapshot(row: EpisodeRow): EpisodeSnapshot {
  return {
    id: row.id, version: row.version, status: row.status, category: row.category,
    scope: row.service_id
      ? { kind: "service", serviceId: row.service_id, identityId: row.identity_id }
      : { kind: "identity_only", identityId: row.identity_id },
    isPrimary: row.is_primary, automationSuppressed: row.automation_suppressed,
    closedAt: row.closed_at?.toISOString() ?? null,
    splitFromEpisodeId: row.split_from_episode_id, previousEpisodeId: row.previous_episode_id,
  };
}

export class EpisodeStore {
  constructor(readonly db: PoolClient) {}

  async settings(): Promise<Settings> {
    const result = await this.db.query<Settings>("select mode, emergency_stop, version from public.automation_settings where singleton");
    if (!result.rows[0]) throw new PersistenceError("missing_settings");
    return result.rows[0];
  }

  async ensureIdentity(sender: SenderKey): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `insert into public.channel_identities(channel, channel_account_id, sender_external_id)
       values ($1,$2,$3) on conflict (channel,channel_account_id,sender_external_id)
       do update set sender_external_id = excluded.sender_external_id returning id`,
      [sender.channel, sender.channelAccountId, sender.senderExternalId]);
    return result.rows[0].id;
  }

  async identity(id: string): Promise<IdentityCandidate> {
    const result = await this.db.query<{ candidate: IdentityCandidate }>(
      `select jsonb_build_object(
        'id',i.id,'channel',i.channel,'channelAccountId',i.channel_account_id,
        'senderExternalId',i.sender_external_id,'customerId',i.customer_id,
        'verificationStatus',i.verification_status,'verifiedAt',i.verified_at,
        'customer',case when c.id is null then null else jsonb_build_object(
          'id',c.id,'status',c.status,'services',coalesce((
            select jsonb_agg(jsonb_build_object('id',s.id,'customerId',s.customer_id,'status',s.status) order by s.id)
            from public.services s where s.customer_id=c.id),'[]'::jsonb)) end) as candidate
       from public.channel_identities i left join public.customers c on c.id=i.customer_id where i.id=$1`, [id]);
    if (!result.rows[0]) throw new PersistenceError("identity_not_found");
    return result.rows[0].candidate;
  }

  async receipt(id: string): Promise<ReceiptRow> {
    const result = await this.db.query<ReceiptRow>("select * from public.ingress_events where id=$1 for update", [id]);
    if (!result.rows[0]) throw new PersistenceError("ingress_not_found");
    return result.rows[0];
  }

  async episodes(identityId: string, serviceId: string | null): Promise<EpisodeSnapshot[]> {
    const result = await this.db.query<EpisodeRow>(
      "select * from public.complaints where identity_id=$1 or service_id=$2 order by created_at,id for update",
      [identityId, serviceId]);
    return result.rows.map(snapshot);
  }

  async episode(id: string): Promise<EpisodeSnapshot> {
    const result = await this.db.query<EpisodeRow>("select * from public.complaints where id=$1 for update", [id]);
    if (!result.rows[0]) throw new PersistenceError("episode_not_found");
    return snapshot(result.rows[0]);
  }

  async createEpisode(draft: EpisodeDraft): Promise<EpisodeSnapshot> {
    const result = await this.db.query<EpisodeRow>(
      `insert into public.complaints(identity_id,service_id,status,category,is_primary,automation_suppressed,
        split_from_episode_id,previous_episode_id,closed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [draft.scope.identityId, draft.scope.kind === "service" ? draft.scope.serviceId : null,
        draft.status, draft.category, draft.isPrimary, draft.automationSuppressed,
        draft.splitFromEpisodeId, draft.previousEpisodeId, draft.closedAt]);
    return snapshot(result.rows[0]);
  }

  async apply(result: AcceptedAction): Promise<void> {
    const changed = await this.db.query(
      `update public.complaints set status=$3,automation_suppressed=$4,closed_at=$5,
        resolution_note=coalesce($6,resolution_note),version=version+1,updated_at=now()
       where id=$1 and version=$2 returning id`,
      [result.episodeId, result.expectedVersion, result.changes.status,
        result.changes.automationSuppressed, result.changes.closedAt, result.changes.resolutionNote ?? null]);
    if (changed.rowCount !== 1) throw new PersistenceError("version_mismatch");
    const actor = result.audit.actor;
    await this.audit(result.episodeId, result.reason, result.audit,
      actor.kind === "staff" ? actor.staffId : null,
      actor.kind === "inbound" ? actor.messageId : null);
  }

  async audit(episodeId: string | null, action: string, detail: unknown, staffId: string | null, messageId: string | null) {
    await this.db.query(
      "insert into public.complaint_audit_log(complaint_id,action,detail,staff_id,message_id) values ($1,$2,$3::jsonb,$4,$5)",
      [episodeId, action, JSON.stringify(detail), staffId, messageId]);
  }

  async cancelPending(episodeId: string): Promise<number> {
    await this.db.query(
      "update public.outbound_intents set status='cancelled',updated_at=now() where complaint_id=$1 and origin='automatic' and status='pending'", [episodeId]);
    const result = await this.db.query<{ count: string }>(
      "select count(*) from public.outbound_intents where complaint_id=$1 and origin='automatic' and status in ('in_flight','unknown')", [episodeId]);
    return Number(result.rows[0].count);
  }

  async owner(identityId: string, customerId: string | null): Promise<string> {
    const identityOwner = await this.db.query<{ id: string; merged_into: string | null }>(
      `insert into public.reply_owners(identity_id) values ($1)
       on conflict(identity_id) do update set identity_id=excluded.identity_id returning id,merged_into`, [identityId]);
    const row = identityOwner.rows[0];
    if (customerId) {
      const target = await this.db.query<{ id: string }>(
        `insert into public.reply_owners(customer_id) values ($1)
         on conflict(customer_id) do update set customer_id=excluded.customer_id returning id`, [customerId]);
      const targetId = target.rows[0].id;
      if (row.merged_into && row.merged_into !== targetId) throw new PersistenceError("owner_reassignment_requires_review");
      const oldClaims = await this.db.query("select 1 from public.reply_claims where owner_id=$1 limit 1", [row.id]);
      if (!row.merged_into && oldClaims.rowCount) throw new PersistenceError("identity_reconciliation_required");
      await this.db.query("update public.reply_owners set merged_into=$2 where id=$1", [row.id, targetId]);
      return targetId;
    }
    return row.merged_into ?? row.id;
  }

  async evidence(episodeId: string, ownerId: string, targets: ClaimTarget[], consumeGuards: boolean): Promise<void> {
    for (const target of targets.filter(t => t.kind !== "episode")) {
      await this.db.query(
        `insert into public.complaint_evidence_links(complaint_id,scope_kind,scope_id)
         values ($1,$2,$3) on conflict do nothing`, [episodeId, target.kind, target.id]);
      // Later evidence consumes event guards without creating another outbound intent.
      if (!consumeGuards) continue;
      await this.db.query(
        `insert into public.reply_claims(owner_id,scope_kind,scope_id,outbound_intent_id)
         select $1,$2,$3,outbound_intent_id from public.reply_claims
         where owner_id=$1 and scope_kind='episode' and scope_id=$4 on conflict do nothing`,
        [ownerId, target.kind, target.id, episodeId]);
    }
  }

  async reserve(ownerId: string, episodeId: string, messageId: string, decision: TriageDecision,
    targets: ClaimTarget[]): Promise<string | null> {
    await this.db.query("savepoint reply_reservation");
    try {
      const intent = await this.db.query<{ id: string }>(
        `insert into public.outbound_intents(owner_id,complaint_id,message_id,decision)
         values ($1,$2,$3,$4::jsonb) returning id`, [ownerId, episodeId, messageId, JSON.stringify(decision)]);
      for (const target of targets) {
        const claim = await this.db.query(
          `insert into public.reply_claims(owner_id,scope_kind,scope_id,complaint_id,outbound_intent_id)
           values ($1,$2,$3,$4,$5) on conflict do nothing returning owner_id`,
          [ownerId, target.kind, target.id, target.kind === "episode" ? episodeId : null, intent.rows[0].id]);
        if (!claim.rowCount) {
          await this.db.query("rollback to savepoint reply_reservation");
          await this.db.query("release savepoint reply_reservation");
          return null;
        }
      }
      await this.db.query("release savepoint reply_reservation");
      return intent.rows[0].id;
    } catch (error) {
      await this.db.query("rollback to savepoint reply_reservation");
      await this.db.query("release savepoint reply_reservation");
      throw error;
    }
  }

  async processed(messageId: string): Promise<ProcessingResult | null> {
    const result = await this.db.query<{ processing_result: ProcessingResult }>(
      "select processing_result from public.triage_assessments where message_id=$1", [messageId]);
    return result.rows[0]?.processing_result ?? null;
  }

  async commandResult<T>(staffId: string, requestId: string, fingerprint: string): Promise<T | null> {
    const result = await this.db.query<{ fingerprint: string; result: T }>(
      "select fingerprint,result from public.staff_commands where staff_id=$1 and request_id=$2", [staffId, requestId]);
    if (!result.rows[0]) return null;
    if (result.rows[0].fingerprint !== fingerprint) throw new PersistenceError("request_id_conflict");
    return result.rows[0].result;
  }

  async saveCommand(staffId: string, requestId: string, fingerprint: string, result: unknown) {
    await this.db.query(
      "insert into public.staff_commands(staff_id,request_id,fingerprint,result) values ($1,$2,$3,$4::jsonb)",
      [staffId, requestId, fingerprint, JSON.stringify(result)]);
  }
}
