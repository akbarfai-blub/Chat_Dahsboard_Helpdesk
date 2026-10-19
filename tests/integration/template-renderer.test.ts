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
import { PersistenceError, type InboundReceipt } from "../../lib/application/persistence-contracts";
import type { Database } from "../../lib/supabase/database.types";
import { SIMULATION_PREFIX } from "../../lib/domain/template-contracts";

test("P3.1 Integration: Template renderer, snapshot persistence, and staff reply prefixing", async (t) => {
  const { available, config, reason } = checkTestEnvAvailable();
  if (!available || !config) {
    t.skip(`Skipping P3.1 integration tests: ${reason}`);
    return;
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
  const botAccountId = `bot-p31-${runId}`;
  const senderPrefix = `sender-p31-${runId}`;

  let staffUserId = "";
  const persistence = new HelpdeskPersistence(pool);
  const incidentIds = new Set<string>();
  const incidentTemplateIds = new Set<string>();

  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];

  // Save original automation_settings to restore in finally
  let originalSettings: { mode: string; emergency_stop: boolean; version: number } | null = null;

  try {
    // 1. Guard check: isolated test database required
    await requireIsolatedDatabase(pool, supabase, config);

    // 2. Run pending test migrations to apply 20261019120000_create_response_templates.sql
    await runTestMigrations();

    // 3. Save original automation settings
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean; version: number }>(
      "SELECT mode, emergency_stop, version FROM public.automation_settings WHERE singleton"
    );
    if (settingsRes.rows[0]) {
      originalSettings = settingsRes.rows[0];
    }

    // 4. Create test staff user
    const staffEmail = `staff-p31-${runId}@example.com`;
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

    // =========================================================================
    // Test 1: Schema & Constraints: Default templates exist and partial unique active index
    // =========================================================================
    await t.test("1. Database Schema & Constraints: Default templates exist and partial unique index prevents duplicate active versions", async () => {
      // 1.1 Check 7 default templates exist
      const templatesRes = await pool.query<{ id: string; template_key: string; scope: string }>(
        "SELECT id, template_key, scope FROM public.response_templates WHERE scope = 'default' ORDER BY template_key"
      );
      assert.equal(templatesRes.rows.length, 7, "All 7 default response templates must be seeded");

      const expectedKeys = [
        "GENERIC",
        "LOS_AREA",
        "LOS_INDIVIDUAL",
        "MASS_AREA",
        "MASS_GENERAL",
        "NETWORK_DISRUPTION",
        "ONLINE_CHECK",
      ];
      assert.deepEqual(templatesRes.rows.map((r) => r.template_key), expectedKeys);

      // 1.2 Check all 7 have active version 1
      const activeVersionsRes = await pool.query<{ template_id: string; version: number; is_active: boolean }>(
        `SELECT tv.template_id, tv.version, tv.is_active
         FROM public.template_versions tv
         JOIN public.response_templates rt ON rt.id = tv.template_id
         WHERE rt.scope = 'default' AND tv.is_active = true`
      );
      assert.equal(activeVersionsRes.rows.length, 7, "All 7 default templates must have an active version");

      // 1.3 Partial unique index: inserting a second active version for same template_id must fail
      const firstTemplateId = templatesRes.rows[0].id;
      const duplicateVersionId = randomUUID();

      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO public.template_versions (id, template_id, version, body, is_active)
             VALUES ($1, $2, 999, 'Bad duplicate active version', true)`,
            [duplicateVersionId, firstTemplateId]
          ),
        /template_versions_one_active/,
        "Database must reject inserting a second active version for the same template_id"
      );

      // 1.4 Inserting an inactive version succeeds
      const inactiveVersionId = randomUUID();
      await pool.query(
        `INSERT INTO public.template_versions (id, template_id, version, body, is_active)
         VALUES ($1, $2, 999, 'Inactive draft version', false)`,
        [inactiveVersionId, firstTemplateId]
      );
      // Clean up the inactive version
      await pool.query("DELETE FROM public.template_versions WHERE id = $1", [inactiveVersionId]);

      // 1.5 Scope constraint: incident scope requires incident_id is not null
      const invalidIncidentTemplateId = randomUUID();
      await assert.rejects(
        () =>
          pool.query(
            `INSERT INTO public.response_templates (id, scope, incident_id, template_key)
             VALUES ($1, 'incident', null, 'MASS_GENERAL')`,
            [invalidIncidentTemplateId]
          ),
        /check/,
        "Incident scoped template requires incident_id is not null"
      );
    });

    // =========================================================================
    // Test 2: Inbound Processing: Snapshot body with simulation prefix and metadata
    // =========================================================================
    await t.test("2. Inbound Processing in LOS_AND_GENERIC mode: Saves snapshot text with prefix and template metadata", async () => {
      await setMode("LOS_AND_GENERIC", false);

      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();
      const senderExt = `${senderPrefix}-cust1`;

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query("INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')", [
        custId,
        `CUST-${runId}-1`,
        `Customer 1 ${runId}`,
      ]);
      await pool.query("INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')", [
        srvId,
        custId,
        `SRV-${runId}-1`,
      ]);
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExt, custId]
      );

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt },
        chatId: senderExt,
        providerMessageId: `msg-${runId}-2`,
        text: "Lampu LOS merah wifi mati total tolong dibantu",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const nowIso = new Date().toISOString();
      // Provide network evidence showing individual LOS
      const result = await persistence.process(ingress.ingressId, {
        network: {
          customerId: custId,
          serviceId: srvId,
          checkedAt: nowIso,
          mapping: null,
          onu: {
            status: "LOS",
            reportedStatus: "LOS",
            quality: "fresh",
            observedAt: nowIso,
            eventId: `onu-event-${runId}`,
            source: "MOCK",
          },
          areas: [],
          upstream: [],
        },
      });

      assert.equal(result.claim.outcome, "reserved", "Claim should be reserved in LOS_AND_GENERIC mode");
      assert.ok(result.claim.intentId, "Intent ID must be generated");
      assert.equal(result.dispatchAuthorized, false, "dispatchAuthorized must strictly remain false in P3.1");

      assert.ok(result.templateSnapshot, "ProcessingResult must include templateSnapshot");
      assert.equal(result.templateSnapshot.templateKey, "LOS_INDIVIDUAL");
      assert.equal(result.templateSnapshot.templateScope, "default");
      assert.equal(result.templateSnapshot.templateVersion, 1);
      assert.ok(result.templateSnapshot.outboundText.startsWith(SIMULATION_PREFIX));

      // Query outbound_intents
      const intentRes = await pool.query<{
        id: string;
        body: string;
        template_version_id: string;
        template_key: string;
        template_version: number;
        template_scope: string;
        origin: string;
      }>("SELECT * FROM public.outbound_intents WHERE id = $1", [result.claim.intentId]);

      assert.equal(intentRes.rows.length, 1);
      const intent = intentRes.rows[0];

      assert.equal(intent.origin, "automatic");
      assert.equal(intent.template_key, "LOS_INDIVIDUAL");
      assert.equal(intent.template_version, 1);
      assert.equal(intent.template_scope, "default");
      assert.ok(intent.body.startsWith(`${SIMULATION_PREFIX} `));
      assert.ok(intent.body.includes("Terdeteksi indikasi gangguan sinyal pada koneksi Anda"));
      assert.equal(intent.body, result.templateSnapshot.outboundText);
    });

    // =========================================================================
    // Test 3: Immutability Verification (FR-07 & FR-13)
    // =========================================================================
    await t.test("3. Immutability Verification: Modifying template versions does NOT alter stored intent snapshot", async () => {
      // Find the template_version for LOS_INDIVIDUAL
      const tmplRes = await pool.query<{ id: string }>(
        "SELECT id FROM public.response_templates WHERE template_key = 'LOS_INDIVIDUAL' AND scope = 'default'"
      );
      const templateId = tmplRes.rows[0].id;

      // Find the latest outbound intent created in Test 2
      const existingIntent = (
        await pool.query<{ id: string; body: string; template_version: number; template_version_id: string }>(
          "SELECT id, body, template_version, template_version_id FROM public.outbound_intents WHERE template_key = 'LOS_INDIVIDUAL' ORDER BY created_at DESC LIMIT 1"
        )
      ).rows[0];

      assert.ok(existingIntent, "Must have existing intent from test 2");
      const originalBody = existingIntent.body;
      const originalVersion = existingIntent.template_version;

      // Now create a new active version 2 for LOS_INDIVIDUAL
      // First deactivate version 1
      await pool.query("UPDATE public.template_versions SET is_active = false WHERE id = $1", [
        existingIntent.template_version_id,
      ]);

      const newVersionId = randomUUID();
      await pool.query(
        `INSERT INTO public.template_versions (id, template_id, version, body, is_active)
         VALUES ($1, $2, 2, 'Teks baru versi 2 yang jauh berbeda dari sebelumnya.', true)`,
        [newVersionId, templateId]
      );

      // Re-query the previously saved outbound_intents row
      const verifiedIntent = (
        await pool.query<{ id: string; body: string; template_version: number; template_version_id: string }>(
          "SELECT id, body, template_version, template_version_id FROM public.outbound_intents WHERE id = $1",
          [existingIntent.id]
        )
      ).rows[0];

      // CRITICAL ASSERTION: The stored body and version in outbound_intents must NOT have changed!
      assert.equal(verifiedIntent.body, originalBody, "Historical outbound intent body must remain immutable");
      assert.equal(verifiedIntent.template_version, originalVersion, "Historical template version must remain immutable");
      assert.equal(verifiedIntent.template_version_id, existingIntent.template_version_id);

      // Restore: delete version 2 and reactivate version 1
      await pool.query("DELETE FROM public.template_versions WHERE id = $1", [newVersionId]);
      await pool.query("UPDATE public.template_versions SET is_active = true WHERE id = $1", [
        existingIntent.template_version_id,
      ]);
    });

    // =========================================================================
    // Test 4: Incident Override and estimated_recovery substitution
    // =========================================================================
    await t.test("4. Incident Override: Incident-scoped template beats default template and uses estimated_recovery", async () => {
      await setMode("FULL", false);

      // 4.1 Create active GENERAL incident with estimated_recovery
      const incidentId = randomUUID();
      tracker.recordIncident(incidentId);
      incidentIds.add(incidentId);

      await pool.query(
        `INSERT INTO public.incidents (id, type, status, description, estimated_recovery)
         VALUES ($1, 'GENERAL', 'ACTIVE', 'Galian kabel putus jalur utama', '18:00 WIB')`,
        [incidentId]
      );

      // 4.2 Create incident-scoped template and active version
      const incTemplateId = randomUUID();
      const incVersionId = randomUUID();
      incidentTemplateIds.add(incTemplateId);

      await pool.query(
        `INSERT INTO public.response_templates (id, scope, incident_id, template_key)
         VALUES ($1, 'incident', $2, 'MASS_GENERAL')`,
        [incTemplateId, incidentId]
      );

      await pool.query(
        `INSERT INTO public.template_versions (id, template_id, version, body, is_active)
         VALUES ($1, $2, 1, 'Insiden FO utama putus. Estimasi perbaikan: {{estimated_recovery}}.', true)`,
        [incVersionId, incTemplateId]
      );

      // 4.3 Ingest inbound message
      const senderExt = `${senderPrefix}-cust-inc`;
      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query("INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')", [
        custId,
        `CUST-${runId}-INC`,
        `Customer Inc ${runId}`,
      ]);
      await pool.query("INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')", [
        srvId,
        custId,
        `SRV-${runId}-INC`,
      ]);
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExt, custId]
      );

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt },
        chatId: senderExt,
        providerMessageId: `msg-${runId}-inc`,
        text: "Selamat pagi, koneksi internet mati semua di kantor",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const result = await persistence.process(ingress.ingressId);

      assert.equal(result.claim.outcome, "reserved");
      assert.ok(result.claim.intentId);
      assert.ok(result.templateSnapshot);
      assert.equal(result.templateSnapshot.templateScope, "incident");
      assert.equal(result.templateSnapshot.incidentId, incidentId);
      assert.equal(result.templateSnapshot.templateKey, "MASS_GENERAL");

      // Verify the body rendered the incident override template and substituted 18:00 WIB
      const expectedText = `${SIMULATION_PREFIX} Insiden FO utama putus. Estimasi perbaikan: 18:00 WIB.`;
      assert.equal(result.templateSnapshot.outboundText, expectedText);

      const intentRes = await pool.query<{ body: string; template_scope: string; template_version_id: string }>(
        "SELECT body, template_scope, template_version_id FROM public.outbound_intents WHERE id = $1",
        [result.claim.intentId]
      );
      assert.equal(intentRes.rows[0].template_scope, "incident");
      assert.equal(intentRes.rows[0].template_version_id, incVersionId);
      assert.equal(intentRes.rows[0].body, expectedText);

      // Clean up child records referencing the template version and incident for this subtest
      await pool.query(
        `DELETE FROM public.reply_claims WHERE outbound_intent_id IN (
           SELECT id FROM public.outbound_intents WHERE complaint_id IN (
             SELECT id FROM public.complaints WHERE identity_id = $1
           )
         )`,
        [identId]
      );
      await pool.query(
        `DELETE FROM public.complaint_evidence_links WHERE complaint_id IN (
           SELECT id FROM public.complaints WHERE identity_id = $1
         )`,
        [identId]
      );
      await pool.query(
        `DELETE FROM public.outbound_intents WHERE complaint_id IN (
           SELECT id FROM public.complaints WHERE identity_id = $1
         )`,
        [identId]
      );
      await pool.query("DELETE FROM public.response_templates WHERE id = $1", [incTemplateId]);
      await pool.query("DELETE FROM public.incidents WHERE id = $1", [incidentId]);
    });

    // =========================================================================
    // Test 5: Fallback for estimated_recovery
    // =========================================================================
    await t.test("5. Fallback for estimated_recovery: When estimated_recovery is null, uses fallback string", async () => {
      await setMode("FULL", false);

      // Active GENERAL incident without estimated_recovery (null)
      const incidentId = randomUUID();
      tracker.recordIncident(incidentId);
      incidentIds.add(incidentId);

      await pool.query(
        `INSERT INTO public.incidents (id, type, status, description, estimated_recovery)
         VALUES ($1, 'GENERAL', 'ACTIVE', 'Gangguan umum tanpa estimasi', null)`,
        [incidentId]
      );

      const senderExt = `${senderPrefix}-cust-fb`;
      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query("INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')", [
        custId,
        `CUST-${runId}-FB`,
        `Customer FB ${runId}`,
      ]);
      await pool.query("INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')", [
        srvId,
        custId,
        `SRV-${runId}-FB`,
      ]);
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExt, custId]
      );

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt },
        chatId: senderExt,
        providerMessageId: `msg-${runId}-fb`,
        text: "Laporan internet terputus",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const result = await persistence.process(ingress.ingressId);

      assert.equal(result.claim.outcome, "reserved");
      assert.ok(result.templateSnapshot);

      // Default MASS_GENERAL template must use fallback: "masih dalam pemeriksaan"
      assert.ok(result.templateSnapshot.outboundText.includes("masih dalam pemeriksaan."));
      // Ensure no double dot ".."
      assert.equal(result.templateSnapshot.outboundText.includes(".."), false);

      // Clean up records referencing the incident for this subtest
      await pool.query(
        `DELETE FROM public.reply_claims WHERE outbound_intent_id IN (
           SELECT id FROM public.outbound_intents WHERE complaint_id IN (
             SELECT id FROM public.complaints WHERE identity_id = $1
           )
         )`,
        [identId]
      );
      await pool.query(
        `DELETE FROM public.complaint_evidence_links WHERE complaint_id IN (
           SELECT id FROM public.complaints WHERE identity_id = $1
         )`,
        [identId]
      );
      await pool.query(
        `DELETE FROM public.outbound_intents WHERE complaint_id IN (
           SELECT id FROM public.complaints WHERE identity_id = $1
         )`,
        [identId]
      );
      await pool.query("DELETE FROM public.incidents WHERE id = $1", [incidentId]);
    });

    // =========================================================================
    // Test 6: Template Error Fail-Closed: Blocks dispatch and creates zero outbound records
    // =========================================================================
    await t.test("6. Template Error Fail-Closed: Blocks dispatch and creates zero outbound records", async () => {
      await setMode("FULL", false);

      // Create an incident with an invalid template containing disallowed placeholder {{customer_id}}
      const incidentId = randomUUID();
      tracker.recordIncident(incidentId);
      incidentIds.add(incidentId);

      await pool.query(
        `INSERT INTO public.incidents (id, type, status, description, estimated_recovery)
         VALUES ($1, 'GENERAL', 'ACTIVE', 'Insiden dengan template cacat', '19:00')`,
        [incidentId]
      );

      const incTemplateId = randomUUID();
      const incVersionId = randomUUID();
      incidentTemplateIds.add(incTemplateId);

      await pool.query(
        `INSERT INTO public.response_templates (id, scope, incident_id, template_key)
         VALUES ($1, 'incident', $2, 'MASS_GENERAL')`,
        [incTemplateId, incidentId]
      );

      await pool.query(
        `INSERT INTO public.template_versions (id, template_id, version, body, is_active)
         VALUES ($1, $2, 1, 'Gangguan untuk pelanggan {{customer_id}} sedang diproses.', true)`,
        [incVersionId, incTemplateId]
      );

      const senderExt = `${senderPrefix}-cust-err`;
      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query("INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')", [
        custId,
        `CUST-${runId}-ERR`,
        `Customer Err ${runId}`,
      ]);
      await pool.query("INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')", [
        srvId,
        custId,
        `SRV-${runId}-ERR`,
      ]);
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExt, custId]
      );

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt },
        chatId: senderExt,
        providerMessageId: `msg-${runId}-err`,
        text: "Ada gangguan internet luas nih",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);

      const result = await persistence.process(ingress.ingressId);

      // Verify fail-closed behavior:
      assert.equal(result.claim.outcome, "skipped");
      assert.equal(result.claim.reason, "template_error");
      assert.equal(result.claim.intentId, null);
      assert.equal(result.dispatchAuthorized, false);
      assert.equal(result.templateError, "disallowed_placeholder");

      // Verify ZERO outbound intents or reply claims created for this message
      const intentsCount = (
        await pool.query<{ c: string }>(
          "SELECT count(*) as c FROM public.outbound_intents WHERE message_id = $1",
          [ingress.ingressId]
        )
      ).rows[0].c;
      assert.equal(Number(intentsCount), 0, "No outbound_intents must be created on template_error");

      // Verify audit log has recorded template_error
      const auditRes = await pool.query<{ action: string; detail: Record<string, unknown> }>(
        "SELECT action, detail FROM public.complaint_audit_log WHERE message_id = $1 AND action = 'template_error'",
        [ingress.ingressId]
      );
      assert.equal(auditRes.rows.length, 1);
      assert.equal(auditRes.rows[0].detail.errorCode, "disallowed_placeholder");

      // Clean up incident-scoped template and incident
      await pool.query(
        `DELETE FROM public.complaint_evidence_links WHERE complaint_id IN (
           SELECT id FROM public.complaints WHERE identity_id = $1
         )`,
        [identId]
      );
      await pool.query("DELETE FROM public.response_templates WHERE id = $1", [incTemplateId]);
      await pool.query("DELETE FROM public.incidents WHERE id = $1", [incidentId]);
    });

    // =========================================================================
    // Test 7: Staff Manual Reply Normalization and Validation
    // =========================================================================
    await t.test("7. Staff Manual Reply: Normalizes simulation prefix and rejects prefix-only inputs", async () => {
      // Create an episode by receiving and processing an inbound message
      const senderExt = `${senderPrefix}-cust-staff`;
      const custId = randomUUID();
      const srvId = randomUUID();
      const identId = randomUUID();

      tracker.recordCustomer(custId);
      tracker.recordService(srvId);
      tracker.recordIdentity(identId);

      await pool.query("INSERT INTO public.customers (id, customer_code, display_name, status) VALUES ($1, $2, $3, 'active')", [
        custId,
        `CUST-${runId}-STAFF`,
        `Customer Staff ${runId}`,
      ]);
      await pool.query("INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')", [
        srvId,
        custId,
        `SRV-${runId}-STAFF`,
      ]);
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExt, custId]
      );

      const receipt: InboundReceipt = {
        sender: { channel: "telegram", channelAccountId: botAccountId, senderExternalId: senderExt },
        chatId: senderExt,
        providerMessageId: `msg-${runId}-staff`,
        text: "wifi mati tolong dibantu teknisi",
        metadata: {},
      };

      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);
      const proc = await persistence.process(ingress.ingressId);
      assert.ok(proc.episodeId);
      const episodeId = proc.episodeId;

      // 7.1 Normal staff reply: should add [SIMULASI DATA DUMMY] prefix
      const reply1 = await persistence.staffAction(staffUserId, {
        action: "manual_reply",
        episodeId,
        expectedVersion: 1,
        requestId: randomUUID(),
        body: "Halo kak, teknisi kami sedang menuju lokasi Anda.",
      });

      assert.ok(reply1.manualIntentId);
      const intent1 = (
        await pool.query<{ body: string; origin: string }>(
          "SELECT body, origin FROM public.outbound_intents WHERE id = $1",
          [reply1.manualIntentId]
        )
      ).rows[0];

      assert.equal(intent1.origin, "staff");
      assert.equal(intent1.body, `${SIMULATION_PREFIX} Halo kak, teknisi kami sedang menuju lokasi Anda.`);

      // 7.2 Staff reply already containing prefix: idempotent, no double prefix
      const reply2 = await persistence.staffAction(staffUserId, {
        action: "manual_reply",
        episodeId,
        expectedVersion: 2,
        requestId: randomUUID(),
        body: `${SIMULATION_PREFIX} Mohon tunggu beberapa menit lagi.`,
      });

      assert.ok(reply2.manualIntentId);
      const intent2 = (
        await pool.query<{ body: string }>(
          "SELECT body FROM public.outbound_intents WHERE id = $1",
          [reply2.manualIntentId]
        )
      ).rows[0];

      assert.equal(intent2.body, `${SIMULATION_PREFIX} Mohon tunggu beberapa menit lagi.`);

      // 7.3 Reject input that is only the simulation prefix
      await assert.rejects(
        () =>
          persistence.staffAction(staffUserId, {
            action: "manual_reply",
            episodeId,
            expectedVersion: 3,
            requestId: randomUUID(),
            body: SIMULATION_PREFIX,
          }),
        (err: unknown) => err instanceof PersistenceError && err.code === "invalid_reply",
        "Must reject body containing only the simulation prefix"
      );

      // 7.4 Reject whitespace-only input
      await assert.rejects(
        () =>
          persistence.staffAction(staffUserId, {
            action: "manual_reply",
            episodeId,
            expectedVersion: 3,
            requestId: randomUUID(),
            body: "     ",
          }),
        (err: unknown) => err instanceof PersistenceError && err.code === "invalid_reply",
        "Must reject body containing only whitespace"
      );
    });
  } catch (err) {
    primaryError = err as Error;
  } finally {
    // 1. Restore original automation settings
    try {
      if (originalSettings) {
        await pool.query(
          "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2, version = version + 1 WHERE singleton",
          [originalSettings.mode, originalSettings.emergency_stop]
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 2. Restore default template versions in case Test 3 was interrupted
    try {
      await pool.query(
        "DELETE FROM public.template_versions WHERE template_id IN (SELECT id FROM public.response_templates WHERE scope = 'default') AND version > 1"
      );
      await pool.query(
        "UPDATE public.template_versions SET is_active = true WHERE template_id IN (SELECT id FROM public.response_templates WHERE scope = 'default') AND version = 1"
      );
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 3. Clean up all incident-scoped response templates and their referencing intents/claims
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

    // 4. Pre-clean reply_owners for all test customers and identities so customers deletion doesn't violate FK
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

    // 5. Teardown fixture tracked resources
    try {
      await cleanupFixture(pool, tracker);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 6. Clean up any remaining incident rows created during this test
    try {
      if (incidentIds.size > 0) {
        await pool.query("DELETE FROM public.incidents WHERE id = ANY($1::uuid[])", [Array.from(incidentIds)]);
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // 7. Delete test staff user and related commands/audit logs
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

    // 8. Residue verification query
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

    // 9. End pool & restore env
    try {
      await pool.end();
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    restorer.restore();

    // 10. Combine errors
    const finalError = combineErrors(primaryError, cleanupErrors);
    if (finalError) {
      throw finalError;
    }
  }
});
