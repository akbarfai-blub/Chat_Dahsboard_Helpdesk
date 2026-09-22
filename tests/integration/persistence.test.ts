import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { linkVerifiedIdentity } from "../../lib/application/link-identity";
import { inHelpdeskTransaction } from "../../lib/postgres/transaction";
import type { InboundReceipt } from "../../lib/application/persistence-contracts";

test("P1.4 local PostgreSQL transactions, constraints and concurrency", async t => {
  const url = process.env.HELPDESK_TEST_DATABASE_URL;
  assert.ok(url, "Set HELPDESK_TEST_DATABASE_URL to the migrated local Supabase database");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Local database only");
  const pool = new Pool({ connectionString: url, max: 8 });
  const service = new HelpdeskPersistence(pool);
  const tag = "p14-" + randomUUID(), staffId = randomUUID();
  const accounts = [tag, tag + "-second"];
  const customers: string[] = [], services: string[] = [];
  let original: { mode: string; emergency_stop: boolean; version: number } | undefined;

  async function mode(value: string, stopped = false) {
    await pool.query("update public.automation_settings set mode=$1,emergency_stop=$2,version=version+1 where singleton", [value, stopped]);
  }
  async function customer() {
    const customerId = randomUUID(), serviceId = randomUUID();
    customers.push(customerId); services.push(serviceId);
    await pool.query("insert into public.customers(id,customer_code,display_name) values ($1,$2,'P1.4 fixture')", [customerId, tag + customerId]);
    await pool.query("insert into public.services(id,customer_id,service_code) values ($1,$2,$3)", [serviceId, customerId, tag + serviceId]);
    return { customerId, serviceId };
  }
  async function known(sender: string, customerId: string) {
    const id = randomUUID();
    await pool.query(
      `insert into public.channel_identities(id,channel,channel_account_id,sender_external_id,customer_id,verification_status,verified_at)
       values ($1,'telegram',$2,$3,$4,'verified',now())`, [id, tag, sender, customerId]);
    return id;
  }
  function receipt(sender: string, text = "wifi mati"): InboundReceipt {
    return { sender: { channel: "telegram", channelAccountId: tag, senderExternalId: sender },
      chatId: sender, providerMessageId: randomUUID(), text };
  }
  async function inbound(sender: string, text = "wifi mati") {
    return service.receive(receipt(sender, text));
  }
  async function version(id: string): Promise<number> {
    return (await pool.query<{ version: number }>("select version from public.complaints where id=$1", [id])).rows[0].version;
  }
  function incident(id: string) {
    return { manualIncidents: [{ id, version: 1, status: "ACTIVE" as const,
      type: "GENERAL" as const, odpIds: [], odcIds: [] }] };
  }

  try {
    original = (await pool.query("select mode,emergency_stop,version from public.automation_settings where singleton")).rows[0];
    assert.ok(original, "Apply the P1.4 migration first");
    await pool.query(
      `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now())`,
      [staffId, tag + "@example.test"]);
    await mode("FULL");

    await t.test("parallel duplicate receipt has one ingress/job; chat and account are part of dedup", async () => {
      const input = receipt("duplicate");
      const results = await Promise.all(Array.from({ length: 8 }, () => service.receive(input)));
      assert.equal(new Set(results.map(r => r.ingressId)).size, 1);
      assert.equal(results.filter(r => !r.duplicate).length, 1);
      assert.equal((await pool.query("select 1 from public.processing_jobs where ingress_id=$1", [results[0].ingressId])).rowCount, 1);
      const otherChat = await service.receive({ ...input, chatId: "another-chat" });
      const otherAccount = await service.receive({ ...input, sender: { ...input.sender, channelAccountId: accounts[1] } });
      assert.notEqual(otherChat.ingressId, results[0].ingressId);
      assert.notEqual(otherAccount.ingressId, results[0].ingressId);
      const processed = await Promise.all(results.map(r => service.process(r.ingressId)));
      for (const result of processed) assert.deepEqual(result, processed[0]);
      assert.equal(processed[0].claim.outcome, "reserved");
      assert.equal((await pool.query("select 1 from public.triage_assessments where message_id=$1", [results[0].ingressId])).rowCount, 1);
    });

    await t.test("different inbound messages/channels for one service create one primary and one reservation", async () => {
      const c = await customer();
      await known("parallel-a", c.customerId); await known("parallel-b", c.customerId);
      const a = await inbound("parallel-a"), b = await inbound("parallel-b");
      const results = await Promise.all([service.process(a.ingressId), service.process(b.ingressId)]);
      assert.equal(results[0].episodeId, results[1].episodeId);
      assert.equal(results.filter(r => r.claim.outcome === "reserved").length, 1);
      assert.equal((await pool.query("select 1 from public.complaints where service_id=$1", [c.serviceId])).rowCount, 1);
      await assert.rejects(pool.query(
        "insert into public.complaints(identity_id,service_id,category) select identity_id,service_id,category from public.complaints where id=$1",
        [results[0].episodeId]), { code: "23505" });
    });

    await t.test("event conflict rolls back episode claim and intent but keeps message, assessment and job completion", async () => {
      const c = await customer(); await known("event-conflict", c.customerId);
      const context = incident(tag + "-outage");
      const first = await service.process((await inbound("event-conflict")).ingressId, context);
      assert.ok(first.episodeId);
      await service.staffAction(staffId, { requestId: randomUUID(), episodeId: first.episodeId,
        expectedVersion: await version(first.episodeId), action: "resolve", note: "Pulih" });
      await service.staffAction(staffId, { requestId: randomUUID(), episodeId: first.episodeId,
        expectedVersion: await version(first.episodeId), action: "close" });
      const next = await service.process((await inbound("event-conflict")).ingressId, context);
      assert.notEqual(next.episodeId, first.episodeId);
      assert.equal(next.claim.reason, "claim_conflict");
      assert.equal((await pool.query("select 1 from public.reply_claims where scope_kind='episode' and scope_id=$1", [next.episodeId])).rowCount, 0);
      assert.equal((await pool.query("select 1 from public.outbound_intents where message_id=$1", [next.messageId])).rowCount, 0);
      assert.equal((await pool.query("select status from public.processing_jobs where ingress_id=$1", [next.messageId])).rows[0].status, "done");
    });

    await t.test("later event evidence adds a guard after GENERIC without a second reservation", async () => {
      const first = await service.process((await inbound("late-evidence")).ingressId);
      const next = await service.process((await inbound("late-evidence")).ingressId, incident(tag + "-late"));
      assert.equal(next.episodeId, first.episodeId);
      assert.equal(next.claim.reason, "follow_up");
      assert.equal((await pool.query("select 1 from public.outbound_intents where complaint_id=$1", [first.episodeId])).rowCount, 1);
      assert.equal((await pool.query("select 1 from public.reply_claims where scope_kind='incident' and scope_id=$1", [tag + "-late"])).rowCount, 1);
      await mode("SHADOW");
      await service.process((await inbound("late-evidence")).ingressId, incident(tag + "-shadow-evidence"));
      assert.equal((await pool.query("select 1 from public.reply_claims where scope_id=$1", [tag + "-shadow-evidence"])).rowCount, 0);
      await mode("FULL");
    });

    await t.test("SHADOW backlog and emergency-stop snapshots never gain dispatch claims", async () => {
      await mode("SHADOW");
      const shadow = await inbound("shadow");
      await mode("FULL");
      const first = await service.process(shadow.ingressId);
      assert.equal(first.claim.reason, "shadow_mode");
      assert.equal(first.dispatchAuthorized, false);
      const pending = await inbound("downgrade");
      await mode("SHADOW");
      assert.equal((await service.process(pending.ingressId)).claim.reason, "shadow_mode");
      await mode("FULL", true);
      const stopped = await inbound("stopped");
      await mode("FULL");
      assert.equal((await service.process(stopped.ingressId)).claim.reason, "automation_blocked");
      assert.equal((await pool.query("select 1 from public.reply_claims where complaint_id=$1", [first.episodeId])).rowCount, 0);
    });

    await t.test("concurrent staff changes use expectedVersion; identical requests replay and changed requests conflict", async () => {
      const first = await service.process((await inbound("staff-race")).ingressId);
      assert.ok(first.episodeId);
      const before = await version(first.episodeId);
      const start = { requestId: randomUUID(), episodeId: first.episodeId, expectedVersion: before, action: "start" as const };
      const resolve = { requestId: randomUUID(), episodeId: first.episodeId, expectedVersion: before,
        action: "resolve" as const, note: "Pulih" };
      const results = await Promise.all([service.staffAction(staffId, start), service.staffAction(staffId, resolve)]);
      assert.equal(results.filter(r => r.result.outcome === "accepted").length, 1);
      assert.equal(results.filter(r => r.result.reason === "version_mismatch").length, 1);
      assert.deepEqual(await service.staffAction(staffId, start), results[0]);
      await assert.rejects(service.staffAction(staffId, { ...start, expectedVersion: before + 1 }), { code: "request_id_conflict" });
      assert.equal((await pool.query("select status from public.outbound_intents where complaint_id=$1", [first.episodeId])).rows[0].status, "cancelled");
    });

    await t.test("manual replies are idempotent and remain queued when lifecycle is already suppressed", async () => {
      const first = await service.process((await inbound("manual")).ingressId);
      assert.ok(first.episodeId);
      const request = { requestId: randomUUID(), episodeId: first.episodeId,
        expectedVersion: await version(first.episodeId), action: "manual_reply" as const, body: "Kami periksa." };
      const queued = await service.staffAction(staffId, request);
      assert.ok(queued.manualIntentId);
      assert.deepEqual(await service.staffAction(staffId, request), queued);
      const second = await service.staffAction(staffId, { ...request, requestId: randomUUID(),
        expectedVersion: await version(first.episodeId), body: "Mohon tunggu." });
      assert.equal(second.result.outcome, "noop");
      assert.ok(second.manualIntentId);
      assert.notEqual(second.manualIntentId, queued.manualIntentId);
      assert.equal((await pool.query(
        "select 1 from public.outbound_intents where complaint_id=$1 and origin='staff' and status='pending'",
        [first.episodeId])).rowCount, 2);
      assert.equal((await pool.query(
        "select status from public.outbound_intents where complaint_id=$1 and origin='automatic'",
        [first.episodeId])).rows[0].status, "cancelled");
    });

    await t.test("audit failure rolls back status/version and pending cancellation", async () => {
      const first = await service.process((await inbound("rollback")).ingressId);
      assert.ok(first.episodeId);
      const before = await pool.query("select status,version from public.complaints where id=$1", [first.episodeId]);
      await assert.rejects(service.staffAction(randomUUID(), { requestId: randomUUID(), episodeId: first.episodeId,
        expectedVersion: before.rows[0].version, action: "start" }), { code: "23503" });
      assert.deepEqual((await pool.query("select status,version from public.complaints where id=$1", [first.episodeId])).rows, before.rows);
      assert.equal((await pool.query("select status from public.outbound_intents where complaint_id=$1", [first.episodeId])).rows[0].status, "pending");
      await assert.rejects(inHelpdeskTransaction(pool, async db => {
        await db.query("update public.complaints set automation_suppressed=true where id=$1", [first.episodeId]);
        throw new Error("intentional rollback");
      }), /intentional rollback/);
      assert.equal((await pool.query("select automation_suppressed from public.complaints where id=$1", [first.episodeId])).rows[0].automation_suppressed, false);
    });

    await t.test("identity linking unions guards, keeps history, suppresses episodes and reports in-flight work", async () => {
      const source = await service.process((await inbound("link-source")).ingressId, incident(tag + "-link"));
      const c = await customer(); await known("link-target", c.customerId);
      const target = await service.process((await inbound("link-target")).ingressId, incident(tag + "-link"));
      assert.ok(source.episodeId); assert.ok(target.episodeId); assert.ok(source.claim.intentId);
      const sourceIdentity = (await pool.query("select identity_id from public.ingress_events where id=$1", [source.messageId])).rows[0].identity_id;
      await pool.query("update public.outbound_intents set status='in_flight' where id=$1", [source.claim.intentId]);
      const command = { requestId: randomUUID(), identityId: sourceIdentity, customerId: c.customerId, serviceId: c.serviceId };
      const linked = await linkVerifiedIdentity(pool, staffId, command);
      assert.equal(linked.inFlightCount, 1);
      assert.deepEqual(await linkVerifiedIdentity(pool, staffId, command), linked);
      assert.equal((await pool.query("select status from public.outbound_intents where id=$1", [source.claim.intentId])).rows[0].status, "in_flight");
      assert.equal((await pool.query("select status from public.outbound_intents where id=$1", [target.claim.intentId])).rows[0].status, "cancelled");
      assert.equal((await pool.query(
        "select 1 from public.reply_claims c join public.reply_owners o on o.id=c.owner_id where o.customer_id=$1 and c.scope_kind='episode'",
        [c.customerId])).rowCount, 2);
      assert.equal((await pool.query("select 1 from public.complaints where service_id=$1 and not automation_suppressed", [c.serviceId])).rowCount, 0);
      const next = await service.process((await inbound("link-source")).ingressId);
      assert.equal(next.claim.reason, "staff_takeover");
      assert.equal((await pool.query("select 1 from public.complaints where service_id=$1 and is_primary and status<>'CLOSED'", [c.serviceId])).rowCount, 1);
    });

    await t.test("split is idempotent, bumps source version, and primary selection is explicit", async () => {
      const first = await service.process((await inbound("split")).ingressId);
      assert.ok(first.episodeId);
      const v = await version(first.episodeId);
      const command = { requestId: randomUUID(), episodeId: first.episodeId, expectedVersion: v,
        action: "split" as const, reason: "Masalah berbeda" };
      const split = await service.staffAction(staffId, command);
      assert.ok(split.createdEpisodeId);
      assert.deepEqual(await service.staffAction(staffId, command), split);
      assert.equal(await version(first.episodeId), v + 1);
      assert.equal((await service.staffAction(staffId, { ...command, requestId: randomUUID() })).result.reason, "version_mismatch");
      await service.staffAction(staffId, { requestId: randomUUID(), episodeId: split.createdEpisodeId,
        expectedVersion: await version(split.createdEpisodeId), action: "primary" });
      assert.equal((await pool.query("select is_primary from public.complaints where id=$1", [first.episodeId])).rows[0].is_primary, false);
      assert.equal((await pool.query("select automation_suppressed from public.complaints where id=$1", [split.createdEpisodeId])).rows[0].automation_suppressed, true);
    });

    await t.test("browser roles cannot write episodes/claims/audit or read ingress payload", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(role === "anon" ? "set local role anon" : "set local role authenticated");
          for (const sql of [
            "update public.complaints set version=version",
            "delete from public.reply_claims where false",
            "delete from public.complaint_audit_log where false",
            "select body from public.ingress_events limit 1",
          ]) {
            await client.query("savepoint permission_check");
            await assert.rejects(client.query(sql), { code: "42501" });
            await client.query("rollback to savepoint permission_check");
          }
        } finally {
          try { await client.query("rollback"); } finally { client.release(); }
        }
      }
    });
  } finally {
    // Remove only this run's UUID/account-scoped fixtures, never reset the database.
    try {
      await inHelpdeskTransaction(pool, async db => {
        const identities = (await db.query<{ id: string }>(
          "select id from public.channel_identities where channel_account_id=any($1::text[])", [accounts])).rows.map(r => r.id);
        const episodes = (await db.query<{ id: string }>(
          "select id from public.complaints where identity_id=any($1::uuid[]) or service_id=any($2::uuid[])", [identities, services])).rows.map(r => r.id);
        const owners = (await db.query<{ id: string }>(
          "select id from public.reply_owners where identity_id=any($1::uuid[]) or customer_id=any($2::uuid[])", [identities, customers])).rows.map(r => r.id);
        const messages = (await db.query<{ id: string }>(
          "select id from public.ingress_events where identity_id=any($1::uuid[])", [identities])).rows.map(r => r.id);
        await db.query("delete from public.staff_commands where staff_id=$1", [staffId]);
        await db.query("delete from public.complaint_audit_log where complaint_id=any($1::uuid[]) or message_id=any($2::uuid[]) or staff_id=$3", [episodes, messages, staffId]);
        await db.query("delete from public.reply_claims where owner_id=any($1::uuid[])", [owners]);
        await db.query("delete from public.outbound_intents where complaint_id=any($1::uuid[])", [episodes]);
        await db.query("delete from public.complaint_evidence_links where complaint_id=any($1::uuid[])", [episodes]);
        await db.query("delete from public.triage_assessments where message_id=any($1::uuid[])", [messages]);
        await db.query("delete from public.messages where id=any($1::uuid[])", [messages]);
        await db.query("delete from public.processing_jobs where ingress_id=any($1::uuid[])", [messages]);
        await db.query("delete from public.ingress_events where id=any($1::uuid[])", [messages]);
        await db.query("delete from public.complaints where id=any($1::uuid[])", [episodes]);
        await db.query("delete from public.reply_owners where id=any($1::uuid[])", [owners]);
        await db.query("delete from public.channel_identities where id=any($1::uuid[])", [identities]);
        await db.query("delete from public.services where id=any($1::uuid[])", [services]);
        await db.query("delete from public.customers where id=any($1::uuid[])", [customers]);
        await db.query("delete from auth.users where id=$1", [staffId]);
        if (original) await db.query("update public.automation_settings set mode=$1,emergency_stop=$2,version=$3 where singleton",
          [original.mode, original.emergency_stop, original.version]);
      });
    } finally { await pool.end(); }
  }
});
