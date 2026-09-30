import type { PoolClient } from "pg";
import type { EpisodeSnapshot, EpisodeActionResult } from "../domain/episode-contracts";
import type { IdentityCandidate, SenderKey } from "../domain/sender-identity";
import type { AutomationMode, TriageDecision } from "../domain/triage-contracts";
import type { ClaimTarget } from "../domain/reply-claim";
import { evaluateConversationGrouping, type ConversationCandidate } from "../domain/conversation";
import {
  PersistenceError,
  type ProcessingResult,
  type ConversationSnapshot,
  type ConversationMessageItem,
} from "../application/persistence-contracts";

export type Settings = { mode: AutomationMode; emergency_stop: boolean; version: number };
export type ReceiptRow = {
  id: string; identity_id: string; channel: string; account_id: string; chat_id: string;
  provider_message_id: string; body: string; received_at: Date; mode: AutomationMode;
  emergency_stop: boolean;
  message_type?: string;
  has_media?: boolean;
  is_forwarded?: boolean;
  caption?: string | null;
  sent_at?: Date | null;
  sender_info?: Record<string, unknown>;
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

  async ensureConversationForIngress(receipt: ReceiptRow): Promise<{ conversationId: string; isNew: boolean }> {
    // 1. Check if the message is already associated with a conversation in public.messages
    const existingMsg = await this.db.query<{ conversation_id: string | null }>(
      "select conversation_id from public.messages where id = $1",
      [receipt.id]
    );
    if (existingMsg.rows[0]?.conversation_id) {
      return { conversationId: existingMsg.rows[0].conversation_id, isNew: false };
    }

    // 2. Query existing conversations for this specific (channel, account_id, chat_id, identity_id) tuple
    const conversationsResult = await this.db.query<{
      id: string;
      started_at: Date;
      last_activity_at: Date;
      status: "active" | "closed";
    }>(
      `select id, started_at, last_activity_at, status
       from public.conversations
       where channel = $1 and account_id = $2 and chat_id = $3 and identity_id = $4
       order by started_at asc`,
      [receipt.channel, receipt.account_id, receipt.chat_id, receipt.identity_id]
    );

    const candidates: ConversationCandidate[] = conversationsResult.rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at.toISOString(),
      lastActivityAt: r.last_activity_at.toISOString(),
      status: r.status,
    }));

    const messageReceivedAtIso = receipt.received_at.toISOString();
    const decision = evaluateConversationGrouping({
      messageReceivedAt: messageReceivedAtIso,
      existingConversations: candidates,
    });

    if (decision.action === "create") {
      const status = decision.shouldBeActive ? "active" : "closed";
      if (decision.shouldBeActive) {
        // Close any previous active conversation for this scope
        await this.db.query(
          `update public.conversations
           set status = 'closed', updated_at = now()
           where channel = $1 and account_id = $2 and chat_id = $3 and identity_id = $4 and status = 'active'`,
          [receipt.channel, receipt.account_id, receipt.chat_id, receipt.identity_id],
        );
      }

      const inserted = await this.db.query<{ id: string }>(
        `insert into public.conversations (
           identity_id, channel, account_id, chat_id, status, started_at, last_activity_at
         )
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          receipt.identity_id,
          receipt.channel,
          receipt.account_id,
          receipt.chat_id,
          status,
          decision.startedAt,
          decision.lastActivityAt,
        ]
      );
      return { conversationId: inserted.rows[0].id, isNew: true };
    }

    if (decision.action === "join") {
      const status = decision.shouldBeActive ? "active" : "closed";
      if (decision.shouldBeActive) {
        // Ensure any other conversation in this scope is closed
        await this.db.query(
          `update public.conversations
           set status = 'closed', updated_at = now()
           where channel = $1 and account_id = $2 and chat_id = $3 and identity_id = $4 and id != $5 and status = 'active'`,
          [receipt.channel, receipt.account_id, receipt.chat_id, receipt.identity_id, decision.conversationId],
        );
      }

      await this.db.query(
        `update public.conversations
         set started_at = coalesce($2, started_at),
             last_activity_at = coalesce($3, last_activity_at),
             status = $4,
             updated_at = now()
         where id = $1`,
        [
          decision.conversationId,
          decision.updatedStartedAt ?? null,
          decision.updatedLastActivityAt ?? null,
          status,
        ]
      );
      return { conversationId: decision.conversationId, isNew: false };
    }

    // decision.action === "merge"
    const survivingId = decision.survivingConversationId;
    const absorbedIds = [...decision.absorbedConversationIds];
    const status = decision.shouldBeActive ? "active" : "closed";

    // 1. Re-parent messages in public.messages from absorbed conversations to surviving conversation
    await this.db.query(
      `update public.messages
       set conversation_id = $1
       where conversation_id = any($2::uuid[])`,
      [survivingId, absorbedIds],
    );

    // 2. Update cached processing_result in public.triage_assessments for all absorbed messages
    await this.db.query(
      `update public.triage_assessments
       set processing_result = jsonb_set(processing_result, '{conversationId}', to_jsonb($1::text))
       where processing_result->>'conversationId' = any($2::text[])`,
      [survivingId, absorbedIds],
    );

    // 3. Update surviving conversation boundaries and status
    if (decision.shouldBeActive) {
      await this.db.query(
        `update public.conversations
         set status = 'closed', updated_at = now()
         where channel = $1 and account_id = $2 and chat_id = $3 and identity_id = $4 and id != $5 and status = 'active'`,
        [receipt.channel, receipt.account_id, receipt.chat_id, receipt.identity_id, survivingId],
      );
    }

    await this.db.query(
      `update public.conversations
       set started_at = $2,
           last_activity_at = $3,
           status = $4,
           updated_at = now()
       where id = $1`,
      [survivingId, decision.startedAt, decision.lastActivityAt, status],
    );

    // 4. Delete absorbed conversations
    await this.db.query(
      `delete from public.conversations
       where id = any($1::uuid[])`,
      [absorbedIds],
    );

    return { conversationId: survivingId, isNew: false };
  }

  async getConversation(conversationId: string): Promise<ConversationSnapshot | null> {
    const result = await this.db.query<{
      id: string;
      identity_id: string;
      channel: string;
      account_id: string;
      chat_id: string;
      status: "active" | "closed";
      started_at: Date;
      last_activity_at: Date;
      created_at: Date;
      updated_at: Date;
    }>("select * from public.conversations where id = $1", [conversationId]);

    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      identityId: row.identity_id,
      channel: row.channel,
      accountId: row.account_id,
      chatId: row.chat_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      lastActivityAt: row.last_activity_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async getConversationHistory(conversationId: string): Promise<ConversationMessageItem[]> {
    const result = await this.db.query<{
      message_id: string;
      conversation_id: string;
      identity_id: string;
      channel: string;
      account_id: string;
      chat_id: string;
      provider_message_id: string;
      body: string;
      received_at: Date;
      sent_at: Date | null;
      message_type: string;
      has_media: boolean;
      is_forwarded: boolean;
      caption: string | null;
      sender_info: Record<string, unknown>;
      complaint_id: string | null;
      classification: unknown;
      review_reason: string | null;
      created_at: Date;
    }>(
      `select
         m.id as message_id,
         m.conversation_id,
         m.identity_id,
         i.channel,
         i.account_id,
         i.chat_id,
         i.provider_message_id,
         i.body,
         i.received_at,
         i.sent_at,
         coalesce(i.message_type, 'text') as message_type,
         coalesce(i.has_media, false) as has_media,
         coalesce(i.is_forwarded, false) as is_forwarded,
         i.caption,
         coalesce(i.sender_info, '{}'::jsonb) as sender_info,
         m.complaint_id,
         m.classification,
         m.review_reason,
         m.created_at
       from public.messages m
       join public.ingress_events i on i.id = m.id
       where m.conversation_id = $1
       order by i.received_at asc, i.id asc`,
      [conversationId]
    );

    return result.rows.map((row) => ({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      identityId: row.identity_id,
      channel: row.channel,
      accountId: row.account_id,
      chatId: row.chat_id,
      providerMessageId: row.provider_message_id,
      body: row.body,
      receivedAt: row.received_at.toISOString(),
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
      messageType: row.message_type,
      hasMedia: row.has_media,
      isForwarded: row.is_forwarded,
      caption: row.caption,
      senderInfo: row.sender_info ?? {},
      complaintId: row.complaint_id,
      classification: row.classification,
      reviewReason: row.review_reason,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async listConversationsForChat(
    channel: string,
    accountId: string,
    chatId: string,
    identityId?: string
  ): Promise<ConversationSnapshot[]> {
    const query = identityId
      ? `select * from public.conversations
         where channel = $1 and account_id = $2 and chat_id = $3 and identity_id = $4
         order by started_at asc`
      : `select * from public.conversations
         where channel = $1 and account_id = $2 and chat_id = $3
         order by started_at asc`;
    const params = identityId ? [channel, accountId, chatId, identityId] : [channel, accountId, chatId];
    const result = await this.db.query<{
      id: string;
      identity_id: string;
      channel: string;
      account_id: string;
      chat_id: string;
      status: "active" | "closed";
      started_at: Date;
      last_activity_at: Date;
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      identityId: row.identity_id,
      channel: row.channel,
      accountId: row.account_id,
      chatId: row.chat_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      lastActivityAt: row.last_activity_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
}
