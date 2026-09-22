import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { inHelpdeskTransaction } from "../postgres/transaction";
import { EpisodeStore } from "../repositories/episode-store";
import { PersistenceError } from "./persistence-contracts";

export type IdentityLinkCommand = {
  requestId: string; identityId: string; customerId: string; serviceId: string;
};
export type IdentityLinkResult = { outcome: "linked"; affectedEpisodeIds: string[]; inFlightCount: number };

/** Called only after staff has verified ownership; a customer ID typed in chat is not authorization. */
export async function linkVerifiedIdentity(pool: Pool, staffId: string, input: IdentityLinkCommand): Promise<IdentityLinkResult> {
  const ids = [staffId, input.requestId, input.identityId, input.customerId, input.serviceId];
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new PersistenceError("invalid_id");
  }
  const hash = createHash("sha256").update(JSON.stringify(["identity_link", ...ids.slice(2)])).digest("hex");
  return inHelpdeskTransaction(pool, async db => {
    const store = new EpisodeStore(db);
    const previous = await store.commandResult<IdentityLinkResult>(staffId, input.requestId, hash);
    if (previous) return previous;
    const identity = await store.identity(input.identityId);
    if (identity.customerId && identity.customerId !== input.customerId) throw new PersistenceError("identity_reassignment_requires_review");
    const services = await db.query<{ id: string; status: string; customer_status: string }>(
      `select s.id,s.status,c.status as customer_status from public.services s
       join public.customers c on c.id=s.customer_id where c.id=$1 order by s.id for update of s,c`, [input.customerId]);
    if (services.rows.length !== 1 || services.rows[0].id !== input.serviceId ||
        services.rows[0].status !== "active" || services.rows[0].customer_status !== "active") {
      throw new PersistenceError("verified_single_service_required");
    }
    const episodes = await store.episodes(input.identityId, input.serviceId);
    if (episodes.some(ep => ep.scope.kind === "service" && ep.scope.serviceId !== input.serviceId)) {
      throw new PersistenceError("episode_service_conflict");
    }
    const source = await db.query<{ id: string; merged_into: string | null }>(
      `insert into public.reply_owners(identity_id) values ($1) on conflict(identity_id)
       do update set identity_id=excluded.identity_id returning id,merged_into`, [input.identityId]);
    const target = await db.query<{ id: string }>(
      `insert into public.reply_owners(customer_id) values ($1) on conflict(customer_id)
       do update set customer_id=excluded.customer_id returning id`, [input.customerId]);
    const sourceId = source.rows[0].id, targetId = target.rows[0].id;
    if (source.rows[0].merged_into && source.rows[0].merged_into !== targetId) {
      throw new PersistenceError("owner_reassignment_requires_review");
    }
    // Keep original claims as history; the canonical customer ledger contains their union.
    await db.query(
      `insert into public.reply_claims(owner_id,scope_kind,scope_id,complaint_id,outbound_intent_id,created_at)
       select $2,scope_kind,scope_id,complaint_id,outbound_intent_id,created_at
       from public.reply_claims where owner_id=$1 on conflict do nothing`, [sourceId, targetId]);
    await db.query("update public.reply_owners set merged_into=$2 where id=$1", [sourceId, targetId]);
    await db.query(
      `update public.channel_identities set customer_id=$2,verification_status='verified',
       verified_at=coalesce(verified_at,now()),verified_by=$3,updated_at=now() where id=$1`,
      [input.identityId, input.customerId, staffId]);

    const active = episodes.filter(ep => ep.status !== "CLOSED");
    const primary = active.find(ep => ep.scope.kind === "service" && ep.isPrimary) ??
      active.find(ep => ep.isPrimary) ?? active[0];
    // Demote before moving scopes so partial unique indexes hold throughout the transaction.
    await db.query(
      "update public.complaints set is_primary=false where id=any($1::uuid[])", [episodes.map(ep => ep.id)]);
    for (const ep of episodes) {
      await db.query(
        `update public.complaints set service_id=$2,is_primary=$3,automation_suppressed=true,
         version=version+1,updated_at=now() where id=$1`,
        [ep.id, input.serviceId, ep.id === primary?.id]);
      await store.cancelPending(ep.id);
      await store.audit(ep.id, "identity_reconciled",
        { identityId: input.identityId, customerId: input.customerId, previousScope: ep.scope,
          primaryEpisodeId: primary?.id ?? null }, staffId, null);
    }
    await db.query(
      `update public.outbound_intents set status='cancelled',updated_at=now()
       where owner_id=any($1::uuid[]) and status='pending'`, [[sourceId, targetId]]);
    const pending = await db.query<{ count: string }>(
      "select count(*) from public.outbound_intents where owner_id=any($1::uuid[]) and status in ('in_flight','unknown')",
      [[sourceId, targetId]]);
    const result: IdentityLinkResult = {
      outcome: "linked", affectedEpisodeIds: episodes.map(ep => ep.id), inFlightCount: Number(pending.rows[0].count),
    };
    await store.audit(null, "identity_linked", { ...input, sourceOwnerId: sourceId, targetOwnerId: targetId }, staffId, null);
    await store.saveCommand(staffId, input.requestId, hash, result);
    return result;
  });
}
