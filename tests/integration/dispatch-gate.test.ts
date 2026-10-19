import "../utils/setup-node-env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  checkTestEnvAvailable,
  requireIsolatedDatabase,
  TestResourceTracker,
  cleanupFixture,
  EnvRestorer,
  combineErrors,
} from "../utils/test-guard";
import { runTestMigrations } from "../utils/test-migration-runner";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import type { InboundReceipt } from "../../lib/application/persistence-contracts";
import type { Database } from "../../lib/supabase/database.types";
import { SIMULATION_PREFIX } from "../../lib/domain/template-contracts";
import { PRE_DISPATCH_RULE_VERSION } from "../../lib/domain/dispatch-contracts";

test("P3.2 Integration: Pre-dispatch gate checks and transactional evaluation", async (t) => {
  const { available, config, reason } = checkTestEnvAvailable();
  if (!available || !config) {
    throw new Error(`Test environment unavailable: ${reason}`);
  }

  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const supabase = createSupabaseClient<Database>(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const restorer = new EnvRestorer();
  restorer.save([
    "HELPDESK_DATABASE_URL",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  const tracker = new TestResourceTracker();
  const runId = randomUUID().slice(0, 8);
  const botAccountId = `bot-p32-${runId}`;

  // Unique positive safe integer Telegram IDs for test senders
  const baseTelegramNum = 88200000 + Math.floor(Math.random() * 100000);
  const senderExt = (n: number) => String(baseTelegramNum + n);
  const allowlist = Array.from({ length: 15 }, (_, i) => senderExt(i + 1));

  let staffUserId = "";
  const persistence = new HelpdeskPersistence(pool);
  const incidentIds = new Set<string>();
  const incidentTemplateIds = new Set<string>();

  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];

  let originalSettings: { mode: string; emergency_stop: boolean; version: number } | null = null;

  try {
    // 1. Guard check: isolated test database required
    await requireIsolatedDatabase(pool, supabase, config);

    // 2. Run pending test migrations
    await runTestMigrations();

    // 3. Save original automation settings
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean; version: number }>(
      "SELECT mode, emergency_stop, version FROM public.automation_settings WHERE singleton"
    );
    if (settingsRes.rows[0]) {
      originalSettings = settingsRes.rows[0];
    }

    // 4. Create test staff user
    const staffEmail = `staff-p32-${runId}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: staffEmail,
      password: "password123!",
      email_confirm: true,
    });
    assert.ifError(userError);
    assert.ok(userData.user);
    staffUserId = userData.user.id;

    // Helper: set automation settings
    async function setMode(mode: "SHADOW" | "LOS_AND_GENERIC" | "FULL", emergencyStop = false) {
      await pool.query(
        "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2, version = version + 1 WHERE singleton",
        [mode, emergencyStop]
      );
    }

    // Helper: get current episode version
    async function getEpisodeVersion(episodeId: string): Promise<number> {
      const res = await pool.query<{ version: number }>(
        "SELECT version FROM public.complaints WHERE id = $1",
        [episodeId]
      );
      assert.ok(res.rows[0], `Episode ${episodeId} not found`);
      return res.rows[0].version;
    }

    // Helper: create customer, service, channel identity fixture
    async function createCustomerFixture(index: number, senderExternalId: string) {
      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query(
        "INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')",
        [custId, `CUST-${runId}-${index}`, `Customer ${index} ${runId}`]
      );
      await pool.query(
        "INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')",
        [srvId, custId, `SRV-${runId}-${index}`]
      );
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExternalId, custId]
      );

      return { custId, srvId, identId, senderExt: senderExternalId };
    }

    // =========================================================================
    // Test 1: Happy Path Automatic & Staff Authorization
    // =========================================================================
    let intentId1 = "";
    let episodeId1 = "";
    let staffIntentId1 = "";

    await t.test("1. Happy Path Automatic & Staff Authorization in LOS_AND_GENERIC", async () => {
      await setMode("LOS_AND_GENERIC", false);
      const cust1 = await createCustomerFixture(1, senderExt(1));

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(1) },
        chatId: senderExt(1),
        providerMessageId: `msg-${runId}-1`,
        text: "Lampu LOS merah wifi mati tolong dibantu",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const nowIso = new Date().toISOString();
      const processRes = await persistence.process(ingress.ingressId, {
        network: {
          customerId: cust1.custId,
          serviceId: cust1.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-1`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      // PRD §8 & §11: process() must NEVER authorize dispatch directly
      assert.equal(processRes.dispatchAuthorized, false);
      assert.ok(processRes.claim);
      assert.ok(processRes.claim.intentId);
      assert.ok(processRes.episodeId);

      intentId1 = processRes.claim.intentId;
      episodeId1 = processRes.episodeId;

      // 1.1 Verify outbound_intents row in DB
      const intentRow = (
        await pool.query<{ origin: string; status: string; body: string }>(
          "SELECT origin, status, body FROM public.outbound_intents WHERE id = $1",
          [intentId1]
        )
      ).rows[0];
      assert.equal(intentRow.origin, "automatic");
      assert.equal(intentRow.status, "pending");
      assert.ok(intentRow.body.startsWith(`${SIMULATION_PREFIX} `));

      // 1.2 Evaluate dispatch gate on pending automatic intent
      const evalRes = await persistence.evaluateDispatchGate(intentId1, {
        testerAllowlist: allowlist,
      });

      assert.equal(evalRes.outcome, "authorized");
      assert.equal(evalRes.dispatchAuthorized, true);
      assert.equal(evalRes.ruleVersion, PRE_DISPATCH_RULE_VERSION);
      assert.equal(evalRes.intentId, intentId1);
      assert.equal(evalRes.origin, "automatic");
      assert.equal(evalRes.channel, "telegram");
      assert.equal(evalRes.channelAccountId, botAccountId);
      assert.equal(evalRes.chatId, senderExt(1));
      assert.equal(evalRes.senderExternalId, senderExt(1));
      assert.equal(evalRes.effectiveMode, "LOS_AND_GENERIC");
      assert.equal(evalRes.authorizedIncidentId, null);
      assert.equal(evalRes.authorizedIncidentVersion, null);
      assert.equal(evalRes.shouldCancelIntent, false);
      assert.deepEqual(evalRes.blockedReasons, []);

      // 1.3 Verify audit log contains dispatch_authorized
      const auditRes = await pool.query<{ action: string; detail: { intentId: string; effectiveMode: string } }>(
        "SELECT action, detail FROM public.complaint_audit_log WHERE complaint_id = $1 AND action = 'dispatch_authorized'",
        [episodeId1]
      );
      assert.equal(auditRes.rows.length, 1);
      assert.equal(auditRes.rows[0].detail.intentId, intentId1);
      assert.equal(auditRes.rows[0].detail.effectiveMode, "LOS_AND_GENERIC");

      // 1.4 Idempotency: calling evaluateDispatchGate again on pending intent does NOT duplicate audit log
      const evalResRepeat = await persistence.evaluateDispatchGate(intentId1, {
        testerAllowlist: allowlist,
      });
      assert.equal(evalResRepeat.outcome, "authorized");
      const auditResRepeat = await pool.query(
        "SELECT count(*)::int as count FROM public.complaint_audit_log WHERE complaint_id = $1 AND action = 'dispatch_authorized'",
        [episodeId1]
      );
      assert.equal(auditResRepeat.rows[0].count, 1, "Audit log must not be duplicated for repeated evaluation");

      // 1.5 Staff manual reply authorization
      const currentVersion = await getEpisodeVersion(episodeId1);
      const staffReplyRes = await persistence.staffAction(staffUserId, {
        requestId: randomUUID(),
        episodeId: episodeId1,
        expectedVersion: currentVersion,
        action: "manual_reply",
        body: "Halo kak, laporan sedang kami tangani oleh teknisi lapangan.",
      });

      assert.equal(staffReplyRes.result.outcome, "accepted");
      assert.ok(staffReplyRes.manualIntentId);
      staffIntentId1 = staffReplyRes.manualIntentId;

      const evalStaffRes = await persistence.evaluateDispatchGate(staffIntentId1, {
        testerAllowlist: allowlist,
      });

      assert.equal(evalStaffRes.outcome, "authorized");
      assert.equal(evalStaffRes.dispatchAuthorized, true);
      assert.equal(evalStaffRes.origin, "staff");
      assert.equal(evalStaffRes.chatId, senderExt(1));
      assert.equal(evalStaffRes.senderExternalId, senderExt(1));
      assert.equal(evalStaffRes.effectiveMode, "LOS_AND_GENERIC");

      // Verify audit log for staff manual reply authorization
      const staffAuditRes = await pool.query<{ action: string; detail: { intentId: string; origin: string } }>(
        "SELECT action, detail FROM public.complaint_audit_log WHERE complaint_id = $1 AND action = 'dispatch_authorized' AND detail->>'origin' = 'staff'",
        [episodeId1]
      );
      assert.equal(staffAuditRes.rows.length, 1);
      assert.equal(staffAuditRes.rows[0].detail.intentId, staffIntentId1);
    });

    // =========================================================================
    // Test 2: Staff Takeover Sebelum Send Membatalkan Automatic Intent
    // =========================================================================
    await t.test("2. Staff Takeover Sebelum Send Membatalkan Automatic Intent", async () => {
      await setMode("LOS_AND_GENERIC", false);
      const cust2 = await createCustomerFixture(2, senderExt(2));

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(2) },
        chatId: senderExt(2),
        providerMessageId: `msg-${runId}-2`,
        text: "Lampu LOS merah wifi mati tolong dicek",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const nowIso = new Date().toISOString();
      const processRes = await persistence.process(ingress.ingressId, {
        network: {
          customerId: cust2.custId,
          serviceId: cust2.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-2`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.ok(processRes.claim);
      assert.ok(processRes.claim.intentId);
      assert.ok(processRes.episodeId);
      const autoIntentId = processRes.claim.intentId;
      const episodeId = processRes.episodeId;

      const currentVersion = await getEpisodeVersion(episodeId);

      // Staff starts handling before send (takeover)
      const takeoverRes = await persistence.staffAction(staffUserId, {
        requestId: randomUUID(),
        episodeId,
        expectedVersion: currentVersion,
        action: "start",
      });
      assert.equal(takeoverRes.result.outcome, "accepted");

      // Verify automatic intent was cancelled by staff action
      const intentCheck = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [autoIntentId]
        )
      ).rows[0];
      assert.equal(intentCheck.status, "cancelled");

      // Evaluating gate on cancelled intent must fail closed with intent_not_pending without re-cancelling
      const gateRes1 = await persistence.evaluateDispatchGate(autoIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateRes1.outcome, "blocked");
      assert.equal(gateRes1.dispatchAuthorized, false);
      if (gateRes1.outcome === "blocked") {
        assert.equal(gateRes1.primaryReason, "intent_not_pending");
        assert.equal(gateRes1.shouldCancelIntent, false);
      }

      // Test staff takeover detection when intent is pending but episode is suppressed
      await pool.query("UPDATE public.outbound_intents SET status = 'pending' WHERE id = $1", [autoIntentId]);

      const gateRes2 = await persistence.evaluateDispatchGate(autoIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateRes2.outcome, "blocked");
      assert.equal(gateRes2.dispatchAuthorized, false);
      if (gateRes2.outcome === "blocked") {
        assert.ok(gateRes2.blockedReasons.includes("staff_takeover"));
        assert.equal(gateRes2.shouldCancelIntent, true);
      }

      // Verify intent status updated to cancelled in DB
      const intentCheck2 = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [autoIntentId]
        )
      ).rows[0];
      assert.equal(intentCheck2.status, "cancelled");

      // Verify dispatch_blocked audit log
      const blockedAudit = await pool.query<{ action: string; detail: { primaryReason: string } }>(
        "SELECT action, detail FROM public.complaint_audit_log WHERE complaint_id = $1 AND action = 'dispatch_blocked'",
        [episodeId]
      );
      assert.ok(blockedAudit.rows.length >= 1);
      assert.equal(blockedAudit.rows[0].detail.primaryReason, "staff_takeover");
    });

    // =========================================================================
    // Test 3: Perubahan Mode & Emergency Stop + Non-Replay Backlog SHADOW (AC-06)
    // =========================================================================
    await t.test("3. Mode Changes & Emergency Stop + Non-Replay Backlog SHADOW (AC-06)", async () => {
      // 3.1 Inbound in SHADOW creates 0 outbound intents
      await setMode("SHADOW", false);
      const cust3 = await createCustomerFixture(3, senderExt(3));

      const receiptShadow: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(3) },
        chatId: senderExt(3),
        providerMessageId: `msg-${runId}-shadow`,
        text: "Lampu LOS merah wifi mati total",
        metadata: {},
      };

      const ingressShadow = await persistence.receive(receiptShadow);
      tracker.recordIngress(ingressShadow.ingressId);

      const nowIso = new Date().toISOString();
      const processShadowRes = await persistence.process(ingressShadow.ingressId, {
        network: {
          customerId: cust3.custId,
          serviceId: cust3.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-shadow`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.equal(processShadowRes.claim.intentId, null);
      assert.ok(processShadowRes.episodeId);
      const shadowIntentCount = (
        await pool.query<{ count: string }>(
          "SELECT count(*)::text as count FROM public.outbound_intents WHERE complaint_id = $1",
          [processShadowRes.episodeId]
        )
      ).rows[0].count;
      assert.equal(Number(shadowIntentCount), 0, "SHADOW mode must produce 0 outbound intents");

      // 3.2 Mode upgraded to FULL: new message produces intent, old SHADOW message is never replayed
      await setMode("FULL", false);

      const cust4 = await createCustomerFixture(4, senderExt(4));
      const receiptFull: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(4) },
        chatId: senderExt(4),
        providerMessageId: `msg-${runId}-full`,
        text: "Internet lemot tidak bisa browsing",
        metadata: {},
      };

      const ingressFull = await persistence.receive(receiptFull);
      tracker.recordIngress(ingressFull.ingressId);

      // In FULL mode with ONU online, effectiveTemplateKey is ONLINE_CHECK
      const processFullRes = await persistence.process(ingressFull.ingressId, {
        network: {
          customerId: cust4.custId,
          serviceId: cust4.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "online",
            reportedStatus: "online",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-online`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.ok(processFullRes.claim);
      assert.ok(processFullRes.claim.intentId);
      const intentFullId = processFullRes.claim.intentId;

      // CRITICAL CHECK: Old SHADOW episode still has 0 outbound intents!
      const shadowIntentCountAfter = (
        await pool.query<{ count: string }>(
          "SELECT count(*)::text as count FROM public.outbound_intents WHERE complaint_id = $1",
          [processShadowRes.episodeId]
        )
      ).rows[0].count;
      assert.equal(Number(shadowIntentCountAfter), 0, "SHADOW backlog must NEVER be replayed when mode changes to FULL");

      // 3.3 Mode downgraded to LOS_AND_GENERIC before send: ONLINE_CHECK is blocked
      await setMode("LOS_AND_GENERIC", false);

      const gateResOnline = await persistence.evaluateDispatchGate(intentFullId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResOnline.outcome, "blocked");
      assert.equal(gateResOnline.dispatchAuthorized, false);
      if (gateResOnline.outcome === "blocked") {
        assert.ok(gateResOnline.blockedReasons.includes("template_blocked_by_mode"));
        assert.equal(gateResOnline.shouldCancelIntent, true);
      }

      // Check DB intent updated to cancelled
      const intentCheckFull = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [intentFullId]
        )
      ).rows[0];
      assert.equal(intentCheckFull.status, "cancelled");

      // 3.4 Emergency stop: blocks pending automatic intent but allows staff reply
      await setMode("LOS_AND_GENERIC", false);
      const cust5 = await createCustomerFixture(5, senderExt(5));

      const receiptEs: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(5) },
        chatId: senderExt(5),
        providerMessageId: `msg-${runId}-es`,
        text: "Kabel putus wifi mati lampu LOS merah",
        metadata: {},
      };

      const ingressEs = await persistence.receive(receiptEs);
      tracker.recordIngress(ingressEs.ingressId);

      const processEsRes = await persistence.process(ingressEs.ingressId, {
        network: {
          customerId: cust5.custId,
          serviceId: cust5.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-es`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.ok(processEsRes.claim);
      assert.ok(processEsRes.claim.intentId);
      assert.ok(processEsRes.episodeId);
      const autoIntentEsId = processEsRes.claim.intentId;
      const episodeEsId = processEsRes.episodeId;

      // Turn on emergency stop before send
      await setMode("LOS_AND_GENERIC", true);

      // Automatic intent must be blocked and cancelled
      const gateResEs = await persistence.evaluateDispatchGate(autoIntentEsId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResEs.outcome, "blocked");
      if (gateResEs.outcome === "blocked") {
        assert.ok(gateResEs.blockedReasons.includes("emergency_stop_active"));
        assert.equal(gateResEs.shouldCancelIntent, true);
      }

      const intentCheckEs = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [autoIntentEsId]
        )
      ).rows[0];
      assert.equal(intentCheckEs.status, "cancelled");

      // Staff reply while emergency stop is active MUST pass authorization (PRD §8)
      const currentEsVersion = await getEpisodeVersion(episodeEsId);
      const staffReplyEsRes = await persistence.staffAction(staffUserId, {
        requestId: randomUUID(),
        episodeId: episodeEsId,
        expectedVersion: currentEsVersion,
        action: "manual_reply",
        body: "Halo kak, ini balasan manual staf saat emergency stop aktif.",
      });

      assert.equal(staffReplyEsRes.result.outcome, "accepted");
      assert.ok(staffReplyEsRes.manualIntentId);

      const gateResStaffEs = await persistence.evaluateDispatchGate(staffReplyEsRes.manualIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResStaffEs.outcome, "authorized");
      assert.equal(gateResStaffEs.dispatchAuthorized, true);
      assert.equal(gateResStaffEs.origin, "staff");
    });

    // =========================================================================
    // Test 4: Incident Resolved atau Area Berubah Sebelum Send (PRD §6.2)
    // =========================================================================
    await t.test("4. Incident Resolved atau Area Berubah Sebelum Send (PRD §6.2)", async () => {
      // 4.1 Active GENERAL incident: passes authorization and logs authorized incident version
      await setMode("FULL", false);

      const incId1 = randomUUID();
      tracker.recordIncident(incId1);
      incidentIds.add(incId1);

      await pool.query(
        "INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version) VALUES ($1, 'GENERAL', 'ACTIVE', '{}', '{}', 1)",
        [incId1]
      );

      await createCustomerFixture(6, senderExt(6));
      const receiptGen: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(6) },
        chatId: senderExt(6),
        providerMessageId: `msg-${runId}-gen`,
        text: "Laporan gangguan internet mati massal padam semua tetangga",
        metadata: {},
      };

      const ingressGen = await persistence.receive(receiptGen);
      tracker.recordIngress(ingressGen.ingressId);

      const nowIso = new Date().toISOString();
      const processGenRes = await persistence.process(ingressGen.ingressId, {
        manualIncidents: [
          {
            id: incId1,
            version: 1,
            status: "ACTIVE",
            type: "GENERAL",
            odpIds: [],
            odcIds: [],
          },
        ],
      });

      assert.ok(processGenRes.claim);
      assert.ok(processGenRes.claim.intentId);
      const genIntentId = processGenRes.claim.intentId;

      const gateResGen = await persistence.evaluateDispatchGate(genIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResGen.outcome, "authorized");
      assert.equal(gateResGen.dispatchAuthorized, true);
      assert.equal(gateResGen.authorizedIncidentId, incId1);
      assert.equal(gateResGen.authorizedIncidentVersion, 1);

      // 4.2 Incident resolved before send: blocks with incident_no_longer_active and cancels intent
      await pool.query(
        "UPDATE public.incidents SET status = 'RESOLVED', version = version + 1 WHERE id = $1",
        [incId1]
      );

      // Re-arm intent to pending to test gate check on resolved incident
      await pool.query("UPDATE public.outbound_intents SET status = 'pending' WHERE id = $1", [genIntentId]);

      const gateResResolved = await persistence.evaluateDispatchGate(genIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResResolved.outcome, "blocked");
      assert.equal(gateResResolved.dispatchAuthorized, false);
      if (gateResResolved.outcome === "blocked") {
        assert.ok(gateResResolved.blockedReasons.includes("incident_no_longer_active"));
        assert.equal(gateResResolved.shouldCancelIntent, true);
      }

      const intentCheckResolved = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [genIntentId]
        )
      ).rows[0];
      assert.equal(intentCheckResolved.status, "cancelled");

      // Clean up incId1 before creating next incident (only 1 active incident allowed at a time)
      await pool.query("DELETE FROM public.reply_claims WHERE scope_id = $1", [incId1]);
      await pool.query("DELETE FROM public.incidents WHERE id = $1", [incId1]);
      incidentIds.delete(incId1);

      // 4.3 AREA_SPECIFIC incident: customer area removed from incident before send
      const incIdArea = randomUUID();
      tracker.recordIncident(incIdArea);
      incidentIds.add(incIdArea);

      await pool.query(
        "INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version) VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 1)",
        [incIdArea, ["ODP-DISPATCH-01"]]
      );

      const custArea = await createCustomerFixture(7, senderExt(7));
      const receiptArea: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(7) },
        chatId: senderExt(7),
        providerMessageId: `msg-${runId}-area`,
        text: "Internet mati lampu LOS merah komplek perumahan",
        metadata: {},
      };

      const ingressArea = await persistence.receive(receiptArea);
      tracker.recordIngress(ingressArea.ingressId);

      const processAreaRes = await persistence.process(ingressArea.ingressId, {
        manualIncidents: [
          {
            id: incIdArea,
            version: 1,
            status: "ACTIVE",
            type: "AREA_SPECIFIC",
            odpIds: ["ODP-DISPATCH-01"],
            odcIds: [],
          },
        ],
        network: {
          customerId: custArea.custId,
          serviceId: custArea.srvId,
          checkedAt: nowIso,
          mapping: {
            serviceId: custArea.srvId,
            version: 1,
            odpId: "ODP-DISPATCH-01",
            odpCode: "ODP-DISPATCH-01",
            odcId: "ODC-DISPATCH-01",
            odcCode: "ODC-DISPATCH-01",
            source: "MOCK",
            validFrom: nowIso,
          },
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-area`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.ok(processAreaRes.claim);
      assert.ok(processAreaRes.claim.intentId);
      const areaIntentId = processAreaRes.claim.intentId;

      // Before send, update incident to remove ODP-DISPATCH-01
      await pool.query(
        "UPDATE public.incidents SET odp_ids = '{\"ODP-OTHER\"}', version = version + 1 WHERE id = $1",
        [incIdArea]
      );

      const gateResArea = await persistence.evaluateDispatchGate(areaIntentId, {
        testerAllowlist: allowlist,
      });
      assert.equal(gateResArea.outcome, "blocked");
      assert.equal(gateResArea.dispatchAuthorized, false);
      if (gateResArea.outcome === "blocked") {
        assert.ok(gateResArea.blockedReasons.includes("incident_area_no_longer_matches"));
        assert.equal(gateResArea.shouldCancelIntent, true);
      }

      const intentCheckArea = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [areaIntentId]
        )
      ).rows[0];
      assert.equal(intentCheckArea.status, "cancelled");
    });

    // =========================================================================
    // Test 5: Tester Allowlist & Private Chat Enforcement
    // =========================================================================
    await t.test("5. Tester Allowlist & Private Chat Enforcement", async () => {
      await setMode("LOS_AND_GENERIC", false);
      const custAllow = await createCustomerFixture(8, senderExt(8));

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt(8) },
        chatId: senderExt(8),
        providerMessageId: `msg-${runId}-allowlist`,
        text: "Koneksi LOS merah wifi mati",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const nowIso = new Date().toISOString();
      const processRes = await persistence.process(ingress.ingressId, {
        network: {
          customerId: custAllow.custId,
          serviceId: custAllow.srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}-allow`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.ok(processRes.claim);
      assert.ok(processRes.claim.intentId);
      assert.ok(processRes.episodeId);
      const autoIntentId = processRes.claim.intentId;
      const episodeId = processRes.episodeId;

      // 5.1 Sender removed from allowlist before send -> blocked with not_in_tester_allowlist and cancelled
      const gateResNotAllowed = await persistence.evaluateDispatchGate(autoIntentId, {
        testerAllowlist: ["99999999"], // does not contain senderExt(8)
      });
      assert.equal(gateResNotAllowed.outcome, "blocked");
      if (gateResNotAllowed.outcome === "blocked") {
        assert.ok(gateResNotAllowed.blockedReasons.includes("not_in_tester_allowlist"));
        assert.equal(gateResNotAllowed.shouldCancelIntent, true);
      }

      const intentCheck = (
        await pool.query<{ status: string }>(
          "SELECT status FROM public.outbound_intents WHERE id = $1",
          [autoIntentId]
        )
      ).rows[0];
      assert.equal(intentCheck.status, "cancelled");

      // 5.2 Staff manual reply evaluated with empty allowlist -> blocked with empty_tester_allowlist
      const currentVersion = await getEpisodeVersion(episodeId);
      const staffReplyRes = await persistence.staffAction(staffUserId, {
        requestId: randomUUID(),
        episodeId,
        expectedVersion: currentVersion,
        action: "manual_reply",
        body: "Halo, tes balasan staf untuk allowlist kosong.",
      });

      assert.equal(staffReplyRes.result.outcome, "accepted");
      assert.ok(staffReplyRes.manualIntentId);

      const gateResEmptyAllow = await persistence.evaluateDispatchGate(staffReplyRes.manualIntentId, {
        testerAllowlist: [],
      });
      assert.equal(gateResEmptyAllow.outcome, "blocked");
      if (gateResEmptyAllow.outcome === "blocked") {
        assert.ok(gateResEmptyAllow.blockedReasons.includes("empty_tester_allowlist"));
        assert.equal(gateResEmptyAllow.shouldCancelIntent, true);
      }
    });
  } catch (err) {
    primaryError = err as Error;
  } finally {
    // 1. Restore original automation settings
    try {
      if (originalSettings) {
        await pool.query(
          "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2, version = $3 WHERE singleton",
          [originalSettings.mode, originalSettings.emergency_stop, originalSettings.version]
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 2. Clean up incident-scoped response templates and referencing intents/claims
    try {
      await pool.query(
        `DELETE FROM public.reply_claims WHERE outbound_intent_id IN (
           SELECT id FROM public.outbound_intents WHERE template_scope = 'incident'
         )`
      );
      await pool.query("DELETE FROM public.outbound_intents WHERE template_scope = 'incident'");
      await pool.query("DELETE FROM public.response_templates WHERE scope = 'incident'");
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 3. Pre-clean reply_claims and reply_owners for all test customers and identities
    try {
      const allCustIds = tracker.customerIds;
      const allIdentIds = tracker.identityIds;
      if (allCustIds.length > 0 || allIdentIds.length > 0) {
        await pool.query(
          `DELETE FROM public.reply_claims WHERE owner_id IN (
             SELECT id FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])
           )`,
          [allCustIds, allIdentIds]
        );
        await pool.query(
          `DELETE FROM public.outbound_intents WHERE owner_id IN (
             SELECT id FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])
           )`,
          [allCustIds, allIdentIds]
        );
        await pool.query(
          "DELETE FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])",
          [allCustIds, allIdentIds]
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 4. Teardown fixture tracked resources
    try {
      await cleanupFixture(pool, tracker);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 5. Clean up any remaining incident rows created during this test
    try {
      if (incidentIds.size > 0) {
        await pool.query("DELETE FROM public.incidents WHERE id = ANY($1::uuid[])", [Array.from(incidentIds)]);
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 6. Delete test staff user and related commands/audit logs
    try {
      if (staffUserId) {
        await pool.query("DELETE FROM public.staff_commands WHERE staff_id = $1", [staffUserId]);
        await pool.query("DELETE FROM public.complaint_audit_log WHERE staff_id = $1", [staffUserId]);
        const { error: delError } = await supabase.auth.admin.deleteUser(staffUserId);
        if (delError) {
          cleanupErrors.push(new Error(`Failed to delete test staff user ${staffUserId}: ${delError.message}`));
        } else {
          const { data: checkUser } = await supabase.auth.admin.getUserById(staffUserId);
          if (checkUser?.user) {
            cleanupErrors.push(new Error(`Staff user ${staffUserId} still exists in auth.users after deleteUser`));
          }
        }
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 7. Residue verification query
    try {
      const allTestCustomerIds = tracker.customerIds;
      const allTestServiceIds = tracker.serviceIds;
      const allTestIdentityIds = tracker.identityIds;
      const allTestIngressIds = tracker.ingressIds;
      const allTestIncidentIds = Array.from(incidentIds);
      const allTestTemplateIds = Array.from(incidentTemplateIds);

      const residualCheck = await pool.query<{ table_name: string; count: string }>(`
        SELECT 'customers' as table_name, count(*)::text as count FROM public.customers WHERE id = ANY($1::uuid[])
        UNION ALL
        SELECT 'services', count(*)::text FROM public.services WHERE id = ANY($2::uuid[])
        UNION ALL
        SELECT 'channel_identities', count(*)::text FROM public.channel_identities WHERE id = ANY($3::uuid[])
        UNION ALL
        SELECT 'ingress_events', count(*)::text FROM public.ingress_events WHERE id = ANY($4::uuid[])
        UNION ALL
        SELECT 'messages', count(*)::text FROM public.messages WHERE id = ANY($4::uuid[])
        UNION ALL
        SELECT 'processing_jobs', count(*)::text FROM public.processing_jobs WHERE ingress_id = ANY($4::uuid[])
        UNION ALL
        SELECT 'complaints', count(*)::text FROM public.complaints WHERE identity_id = ANY($3::uuid[])
        UNION ALL
        SELECT 'triage_assessments', count(*)::text FROM public.triage_assessments WHERE message_id = ANY($4::uuid[])
        UNION ALL
        SELECT 'incidents', count(*)::text FROM public.incidents WHERE id = ANY($5::uuid[])
        UNION ALL
        SELECT 'response_templates', count(*)::text FROM public.response_templates WHERE scope = 'incident' AND id = ANY($6::uuid[])
      `, [
        allTestCustomerIds,
        allTestServiceIds,
        allTestIdentityIds,
        allTestIngressIds,
        allTestIncidentIds,
        allTestTemplateIds,
      ]);

      const lingering = residualCheck.rows.filter((r) => Number(r.count) > 0);
      if (lingering.length > 0) {
        cleanupErrors.push(
          new Error(`Residual test fixtures detected: ${lingering.map((r) => `${r.table_name}=${r.count}`).join(", ")}`)
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 8. End pool & restore env
    try {
      await pool.end();
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    restorer.restore();

    // 9. Combine errors
    const finalError = combineErrors(primaryError, cleanupErrors);
    if (finalError) {
      throw finalError;
    }
  }
});
