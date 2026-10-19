import "../utils/setup-node-env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { handleTelegramWebhook } from "../../lib/application/telegram-inbound-service";
import { drainProcessingJobs } from "../../lib/application/job-worker-service";
import {
  listInboxConversations,
  getInboxConversationDetail,
} from "../../lib/application/inbox-service";
import {
  checkTestEnvAvailable,
  requireIsolatedDatabase,
  verifyTestTargetIdentity,
  cleanupFixture,
  TestResourceTracker,
  EnvRestorer,
  combineErrors,
} from "../utils/test-guard";
import type { TelegramUpdate } from "../../lib/adapters/telegram/telegram-types";

test("P2.11 Vertical Slice SHADOW End-to-End Integration Suite", async (t) => {
  const { available, config, reason } = checkTestEnvAvailable();
  if (!available || !config) {
    t.skip(`Skipping P2.11 vertical slice tests: ${reason}`);
    return;
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const supabase = createClient<Database>(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const restorer = new EnvRestorer();
  restorer.save([
    "HELPDESK_DATABASE_URL",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_BOT_ACCOUNT_ID",
    "TELEGRAM_TESTER_ALLOWLIST",
  ]);

  const tracker = new TestResourceTracker();
  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const tag = `p211-${runId}`;

  const botAccountId = `bot-${tag}`;
  const webhookSecret = `wh-secret-${tag}`;

  // Unique numeric sender IDs for Telegram tester allowlist
  const numericSenderVerified = String(88000000 + Math.floor(Math.random() * 90000));
  const numericSenderUnverified = String(88900000 + Math.floor(Math.random() * 90000));
  const testerAllowlist = [numericSenderVerified, numericSenderUnverified];

  const configOverrides = {
    webhookSecret,
    botAccountId,
    testerAllowlist,
  };

  // Fixture IDs
  let actualStaffUserId: string | null = null;
  const staffEmail = `staff-${tag}@example.test`;
  const odcId = randomUUID();
  const odpId = randomUUID();
  const custId = randomUUID();
  const srvId = randomUUID();
  const topId = randomUUID();
  const verifiedIdentId = randomUUID();
  const unverifiedIdentId = randomUUID();

  // Track active created episode, conversation, and ingress IDs across tests and teardown
  let verifiedConversationId = "";
  let verifiedComplaintId = "";
  let verifiedIngressId = "";
  let unverifiedConversationId = "";
  let unverifiedComplaintId = "";
  let unverifiedIngressId = "";
  let nonComplaintIngressId = "";

  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];

  function makeWebhookRequest(update: TelegramUpdate, secret: string = webhookSecret): Request {
    return new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify(update),
    });
  }

  function makeTelegramUpdate(
    messageId: number,
    senderId: string,
    text: string,
    updateId: number = 211000 + messageId
  ): TelegramUpdate {
    return {
      update_id: updateId,
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(senderId), type: "private" },
        from: {
          id: Number(senderId),
          is_bot: false,
          first_name: `Tester ${senderId}`,
          username: `tester_${senderId}`,
        },
        text,
      },
    };
  }

  try {
    // 1. Guard against non-isolated test database
    await requireIsolatedDatabase(pool, supabase, config);
    await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);

    // Refresh mock network observation timestamps
    const refreshSql = readFileSync(
      resolve(process.cwd(), "supabase/fixtures/refresh-network-observations.sql"),
      "utf8"
    ).replace(/^\uFEFF/, "");
    await pool.query(refreshSql);

    // Verify automation settings is in SHADOW mode
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean }>(
      "SELECT mode, emergency_stop FROM public.automation_settings WHERE singleton = true"
    );
    assert.equal(settingsRes.rows.length, 1, "Singleton automation_settings must exist");
    assert.equal(settingsRes.rows[0].mode, "SHADOW", "Automation mode must be SHADOW");
    assert.equal(settingsRes.rows[0].emergency_stop, false, "Emergency stop must be false");

    // Create staff user in auth.users
    const { data: staffData, error: staffCreateError } = await supabase.auth.admin.createUser({
      email: staffEmail,
      password: "password123!",
      email_confirm: true,
      user_metadata: { name: `Staff ${tag}` },
    });
    if (staffCreateError || !staffData?.user?.id) {
      throw new Error(`Failed to create test staff user: ${staffCreateError?.message ?? "No user returned"}`);
    }
    actualStaffUserId = staffData.user.id;

    // Track resources for clean teardown
    tracker.recordCustomer(custId);
    tracker.recordService(srvId);
    tracker.recordIdentity(verifiedIdentId);
    tracker.recordIdentity(unverifiedIdentId);

    // Seed ODC, ODP, Customer, Service, and Topology
    await pool.query(
      `INSERT INTO public.odcs (id, odc_code, display_name)
       VALUES ($1, $2, $3)`,
      [odcId, `ODC-${tag}`, `ODC Prototype ${tag}`]
    );

    await pool.query(
      `INSERT INTO public.odps (id, odc_id, odp_code, display_name)
       VALUES ($1, $2, $3, $4)`,
      [odpId, odcId, `ODP-${tag}`, `ODP Prototype ${tag}`]
    );

    await pool.query(
      `INSERT INTO public.customers (id, customer_code, display_name, status)
       VALUES ($1, $2, $3, 'active')`,
      [custId, `CUST-${tag}`, `Pelanggan Dummy ${tag}`]
    );

    await pool.query(
      `INSERT INTO public.services (id, customer_id, service_code, display_name, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [srvId, custId, `SRV-${tag}`, `Layanan Fiber ${tag}`]
    );

    await pool.query(
      `INSERT INTO public.service_topology (id, service_id, odp_id, mapping_version, source, valid_from)
       VALUES ($1, $2, $3, 1, 'MOCK', now())`,
      [topId, srvId, odpId]
    );

    await pool.query(
      `INSERT INTO public.mock_onu_status (scenario_id, service_id, status, observed_at)
       VALUES ('normal', $1, 'online', now())
       ON CONFLICT (scenario_id, service_id) DO UPDATE SET status = 'online', observed_at = now()`,
      [srvId]
    );

    // Seed Verified Tester Identity (linked to customer & service)
    await pool.query(
      `INSERT INTO public.channel_identities (
         id, channel, channel_account_id, sender_external_id, display_name_snapshot,
         customer_id, verification_status, verified_at
       ) VALUES ($1, 'telegram', $2, $3, $4, $5, 'verified', now())`,
      [verifiedIdentId, botAccountId, numericSenderVerified, `Tester Verified ${tag}`, custId]
    );

    // Seed Unverified Tester Identity (in allowlist, but unlinked to customer)
    await pool.query(
      `INSERT INTO public.channel_identities (
         id, channel, channel_account_id, sender_external_id, display_name_snapshot,
         customer_id, verification_status
       ) VALUES ($1, 'telegram', $2, $3, $4, null, 'unverified')`,
      [unverifiedIdentId, botAccountId, numericSenderUnverified, `Tester Unverified ${tag}`]
    );

    const persistence = new HelpdeskPersistence(pool);

    // =========================================================================
    // AC1: Dummy complaint from Telegram tester appears in Inbox with episode & assessment
    // =========================================================================
    await t.test(
      "AC1: Komplain dummy dari tester Telegram muncul di Inbox dengan episode dan assessment yang sesuai",
      async () => {
        const update1 = makeTelegramUpdate(
          101,
          numericSenderVerified,
          "Lapor min koneksi wifi mati total lampu indikator LOS merah kedip terus dari pagi tolong"
        );
        const req1 = makeWebhookRequest(update1);
        const res1 = await handleTelegramWebhook(req1, persistence, configOverrides);

        assert.equal(res1.status, 200, "Webhook must return HTTP 200 for accepted tester message");
        const body1 = (await res1.json()) as {
          success: boolean;
          data: { status: string; ingressId: string; duplicate: boolean };
        };
        assert.equal(body1.success, true);
        assert.equal(body1.data.status, "accepted");
        assert.equal(body1.data.duplicate, false, "First delivery must not be duplicate");
        assert.ok(body1.data.ingressId, "Ingress ID must be returned");

        verifiedIngressId = body1.data.ingressId;
        tracker.recordIngress(verifiedIngressId);

        // Process job with worker
        const drainResult = await drainProcessingJobs(pool, supabase);
        assert.ok(drainResult.processedCount >= 1, "Worker must process at least 1 job");
        assert.equal(drainResult.failureCount, 0, "Worker job must not fail");
        assert.ok(drainResult.successCount >= 1, "Worker job must succeed");

        // Verify processing_jobs row status is 'done'
        const jobRow = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [verifiedIngressId]
        );
        assert.equal(jobRow.rows[0].status, "done", "Processing job must be marked done");

        // Verify Dashboard Inbox list displays the conversation
        const inboxList = await listInboxConversations(pool, actualStaffUserId!, {});
        assert.ok(inboxList.items.length >= 1, "Inbox list must contain conversations");

        const convItem = inboxList.items.find((item) => item.chatId === numericSenderVerified);
        assert.ok(convItem, "Conversation matching verified tester chatId must exist in Inbox");
        assert.equal(convItem.status, "active");
        assert.equal(convItem.sender.verificationStatus, "verified");
        assert.equal(convItem.sender.customerId, custId);
        assert.equal(convItem.sender.customerName, `Pelanggan Dummy ${tag}`);

        // Episode check
        assert.ok(convItem.latestEpisode, "Episode summary must be present on conversation item");
        assert.equal(convItem.latestEpisode.status, "NEW");
        assert.equal(convItem.latestEpisode.category, "connection_complaint");
        assert.equal(convItem.latestEpisode.serviceId, srvId);

        verifiedConversationId = convItem.id;
        verifiedComplaintId = convItem.latestEpisode.id;
        tracker.recordConversation(verifiedConversationId);
        tracker.recordComplaint(verifiedComplaintId);

        // Verify Dashboard Inbox detail
        const detail = await getInboxConversationDetail(pool, actualStaffUserId!, verifiedConversationId);
        assert.ok(detail, "Conversation detail must be returned");
        assert.equal(detail.messages.length, 1, "Detail must contain 1 message");

        const msg = detail.messages[0];
        assert.equal(msg.direction, "inbound");
        assert.equal(msg.classification.category, "connection_complaint");
        assert.equal(msg.complaintId, verifiedComplaintId);

        // Triage assessment check
        assert.ok(msg.triageAssessment, "Triage assessment must be populated on message");
        assert.equal(msg.triageAssessment.decision.mode, "SHADOW");
        assert.equal(msg.triageAssessment.decision.emergencyStop, false);
        assert.equal(msg.triageAssessment.decision.outcome, "candidate");
        assert.equal(msg.triageAssessment.decision.reason, "online");
        assert.equal(msg.triageAssessment.processingResult.claim.outcome, "skipped");
        assert.equal(msg.triageAssessment.processingResult.claim.reason, "shadow_mode");
        assert.equal(msg.triageAssessment.processingResult.dispatchAuthorized, false);

        // Verify direct triage assessment row in database
        const dbAssessment = await pool.query<{ decision: Record<string, unknown>; processing_result: Record<string, unknown> }>(
          "SELECT decision, processing_result FROM public.triage_assessments WHERE message_id = $1",
          [verifiedIngressId]
        );
        assert.equal(dbAssessment.rows.length, 1);
        assert.equal(dbAssessment.rows[0].decision.candidateTemplateKey, "ONLINE_CHECK");
      }
    );

    // =========================================================================
    // AC2: Replay identical inbound event does not duplicate entities
    // =========================================================================
    await t.test(
      "AC2: Replay event inbound yang sama tidak menggandakan ingress, pesan, episode, maupun assessment terkait",
      async () => {
        // Snapshot counts before replay
        const beforeIngress = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.ingress_events WHERE account_id = $1",
          [botAccountId]
        );
        const beforeJobs = await pool.query<{ count: string }>(
          `SELECT count(*) FROM public.processing_jobs j
           JOIN public.ingress_events i ON i.id = j.ingress_id
           WHERE i.account_id = $1`,
          [botAccountId]
        );
        const beforeMessages = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.messages WHERE conversation_id = $1",
          [verifiedConversationId]
        );
        const beforeComplaints = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.complaints WHERE id = $1",
          [verifiedComplaintId]
        );
        const beforeAssessments = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [verifiedIngressId]
        );

        const countIngressBefore = Number(beforeIngress.rows[0].count);
        const countJobsBefore = Number(beforeJobs.rows[0].count);
        const countMessagesBefore = Number(beforeMessages.rows[0].count);
        const countComplaintsBefore = Number(beforeComplaints.rows[0].count);
        const countAssessmentsBefore = Number(beforeAssessments.rows[0].count);

        // Replay EXACT same Telegram webhook event (same update_id, same message_id, same chat, same text)
        const replayUpdate = makeTelegramUpdate(
          101,
          numericSenderVerified,
          "Lapor min koneksi wifi mati total lampu indikator LOS merah kedip terus dari pagi tolong"
        );
        const replayReq = makeWebhookRequest(replayUpdate);
        const replayRes = await handleTelegramWebhook(replayReq, persistence, configOverrides);

        assert.equal(replayRes.status, 200, "Replay must return HTTP 200");
        const replayBody = (await replayRes.json()) as {
          success: boolean;
          data: { status: string; ingressId: string; duplicate: boolean };
        };
        assert.equal(replayBody.success, true);
        assert.equal(replayBody.data.status, "accepted");
        assert.equal(replayBody.data.duplicate, true, "Replay must be flagged as duplicate: true");
        assert.equal(replayBody.data.ingressId, verifiedIngressId, "Replay must point to existing ingressId");

        // Run worker drain - no new jobs should be claimed/processed
        const drainResult = await drainProcessingJobs(pool, supabase);
        assert.equal(drainResult.processedCount, 0, "No pending jobs should be processed on duplicate replay");

        // Verify database counts after replay
        const afterIngress = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.ingress_events WHERE account_id = $1",
          [botAccountId]
        );
        const afterJobs = await pool.query<{ count: string }>(
          `SELECT count(*) FROM public.processing_jobs j
           JOIN public.ingress_events i ON i.id = j.ingress_id
           WHERE i.account_id = $1`,
          [botAccountId]
        );
        const afterMessages = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.messages WHERE conversation_id = $1",
          [verifiedConversationId]
        );
        const afterComplaints = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.complaints WHERE id = $1",
          [verifiedComplaintId]
        );
        const afterAssessments = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [verifiedIngressId]
        );

        assert.equal(Number(afterIngress.rows[0].count), countIngressBefore, "Ingress count must remain unchanged (+0)");
        assert.equal(Number(afterJobs.rows[0].count), countJobsBefore, "Processing jobs count must remain unchanged (+0)");
        assert.equal(Number(afterMessages.rows[0].count), countMessagesBefore, "Messages count must remain unchanged (+0)");
        assert.equal(Number(afterComplaints.rows[0].count), countComplaintsBefore, "Complaints count must remain unchanged (+0)");
        assert.equal(Number(afterAssessments.rows[0].count), countAssessmentsBefore, "Triage assessments count must remain unchanged (+0)");

        // Verify conversation detail in dashboard has exactly 1 message
        const detailAfter = await getInboxConversationDetail(pool, actualStaffUserId!, verifiedConversationId);
        assert.ok(detailAfter);
        assert.equal(detailAfter.messages.length, 1, "Detail messages array must not duplicate");
        assert.equal(detailAfter.messages[0].id, verifiedIngressId);
      }
    );

    // =========================================================================
    // AC3: Unmapped sender remains visible in Inbox without service details
    // =========================================================================
    await t.test(
      "AC3: Pengirim yang belum terpetakan ke pelanggan tetap terlihat di Inbox tanpa memperoleh detail layanan",
      async () => {
        const updateUnverified = makeTelegramUpdate(
          201,
          numericSenderUnverified,
          "Lapor min wifi mati lampu merah los tolong dibantu perbaiki"
        );
        const reqUnverified = makeWebhookRequest(updateUnverified);
        const resUnverified = await handleTelegramWebhook(reqUnverified, persistence, configOverrides);

        assert.equal(resUnverified.status, 200);
        const bodyUnverified = (await resUnverified.json()) as {
          success: boolean;
          data: { status: string; ingressId: string; duplicate: boolean };
        };
        assert.equal(bodyUnverified.success, true);
        assert.equal(bodyUnverified.data.status, "accepted");
        assert.equal(bodyUnverified.data.duplicate, false);

        unverifiedIngressId = bodyUnverified.data.ingressId;
        tracker.recordIngress(unverifiedIngressId);

        // Process job
        const drainResult = await drainProcessingJobs(pool, supabase);
        assert.ok(drainResult.processedCount >= 1);
        assert.equal(drainResult.failureCount, 0);

        // Verify in Inbox List
        const inboxList = await listInboxConversations(pool, actualStaffUserId!, {});
        const unverifiedItem = inboxList.items.find((item) => item.chatId === numericSenderUnverified);
        assert.ok(unverifiedItem, "Unverified sender conversation must be visible in Inbox list");
        assert.equal(unverifiedItem.sender.verificationStatus, "unverified");
        assert.equal(unverifiedItem.sender.customerId, null, "Customer ID must be null for unverified sender");
        assert.equal(unverifiedItem.sender.customerName, null, "Customer name must be null for unverified sender");

        if (unverifiedItem.latestEpisode) {
          assert.equal(unverifiedItem.latestEpisode.serviceId, null, "Service ID must be null for unverified identity");
          assert.equal(unverifiedItem.latestEpisode.serviceCode, null, "Service code must be null for unverified identity");
          unverifiedComplaintId = unverifiedItem.latestEpisode.id;
          tracker.recordComplaint(unverifiedComplaintId);
        }

        unverifiedConversationId = unverifiedItem.id;
        tracker.recordConversation(unverifiedConversationId);

        // Verify in Inbox Detail
        const detail = await getInboxConversationDetail(pool, actualStaffUserId!, unverifiedConversationId);
        assert.ok(detail, "Conversation detail must be accessible for unverified sender");
        assert.equal(detail.sender.verificationStatus, "unverified");
        assert.equal(detail.sender.customerId, null);
        assert.equal(detail.sender.customerName, null);
        assert.equal(detail.messages.length, 1);

        const unverifiedMsg = detail.messages[0];
        assert.ok(unverifiedMsg.triageAssessment, "Triage assessment must exist for unverified sender");
        // PRD rule: Unverified identity falls back safely to GENERIC with identity_unresolved, no service/topology details
        assert.equal(
          unverifiedMsg.triageAssessment.decision.outcome,
          "candidate",
          "Unverified sender triage outcome must be candidate"
        );
        assert.equal(
          unverifiedMsg.triageAssessment.decision.reason,
          "identity_unresolved",
          "Triage reason must be identity_unresolved"
        );
        assert.equal(
          unverifiedMsg.triageAssessment.processingResult.claim.outcome,
          "skipped",
          "Claim outcome must be skipped in SHADOW mode"
        );
        assert.equal(
          unverifiedMsg.triageAssessment.processingResult.claim.reason,
          "shadow_mode",
          "Claim reason must be shadow_mode"
        );
        assert.equal(unverifiedMsg.triageAssessment.processingResult.dispatchAuthorized, false);

        // Verify candidate template key is GENERIC in DB
        const dbAssessment = await pool.query<{ decision: Record<string, unknown> }>(
          "SELECT decision FROM public.triage_assessments WHERE message_id = $1",
          [unverifiedIngressId]
        );
        assert.equal(dbAssessment.rows[0].decision.candidateTemplateKey, "GENERIC");
      }
    );

    // =========================================================================
    // AC4: Non-complaint message remains visible and handled per PRD rules
    // =========================================================================
    await t.test(
      "AC4: Pesan non-komplain tetap terlihat dan ditangani sesuai aturan PRD",
      async () => {
        const updateNonComplaint = makeTelegramUpdate(
          102,
          numericSenderVerified,
          "Halo selamat siang min, terima kasih banyak atas bantuannya kemarin ya"
        );
        const reqNonComplaint = makeWebhookRequest(updateNonComplaint);
        const resNonComplaint = await handleTelegramWebhook(reqNonComplaint, persistence, configOverrides);

        assert.equal(resNonComplaint.status, 200);
        const bodyNonComplaint = (await resNonComplaint.json()) as {
          success: boolean;
          data: { status: string; ingressId: string; duplicate: boolean };
        };
        assert.equal(bodyNonComplaint.success, true);
        assert.equal(bodyNonComplaint.data.status, "accepted");
        assert.equal(bodyNonComplaint.data.duplicate, false);

        nonComplaintIngressId = bodyNonComplaint.data.ingressId;
        tracker.recordIngress(nonComplaintIngressId);

        // Process job
        const drainResult = await drainProcessingJobs(pool, supabase);
        assert.ok(drainResult.processedCount >= 1);
        assert.equal(drainResult.failureCount, 0);

        // Verify in Conversation Detail
        const detail = await getInboxConversationDetail(pool, actualStaffUserId!, verifiedConversationId);
        assert.ok(detail);
        assert.equal(detail.messages.length, 2, "Conversation must now hold 2 messages");

        const secondMsg = detail.messages.find((m) => m.providerMessageId === "102");
        assert.ok(secondMsg, "Non-complaint message must exist in conversation history");
        assert.equal(
          secondMsg.classification.category,
          "other",
          "Non-complaint message classification category must be other"
        );
        assert.equal(
          secondMsg.complaintId,
          null,
          "Non-complaint message must not create a new complaint episode"
        );

        // Mandatory assertion: triage assessment must exist and reflect non_connection_message
        assert.ok(secondMsg.triageAssessment, "Triage assessment must exist for non-complaint message");
        assert.equal(
          secondMsg.triageAssessment.decision.outcome,
          "review",
          "Non-complaint assessment decision outcome must be review"
        );
        assert.equal(
          secondMsg.triageAssessment.decision.reason,
          "non_connection_message",
          "Non-complaint assessment decision reason must be non_connection_message"
        );
        assert.equal(
          secondMsg.triageAssessment.processingResult.dispatchAuthorized,
          false,
          "Non-complaint assessment dispatchAuthorized must be false"
        );
      }
    );

    // =========================================================================
    // AC5: No automatic outbound intents or reply claims formed in SHADOW mode
    // =========================================================================
    await t.test(
      "AC5: Tidak ada outbound otomatis atau claim debounce yang terbentuk akibat skenario SHADOW",
      async () => {
        const testComplaints = [verifiedComplaintId, unverifiedComplaintId].filter(Boolean);
        const testMessages = [verifiedIngressId, unverifiedIngressId, nonComplaintIngressId].filter(Boolean);

        // 1. Check outbound_intents table: exactly 0 automatic intents across all test messages, complaints, and owners
        const autoIntents = await pool.query<{ count: string }>(
          `SELECT count(*) FROM public.outbound_intents
           WHERE origin = 'automatic'
             AND (
               message_id = ANY($1::uuid[])
               OR complaint_id = ANY($2::uuid[])
               OR owner_id IN (
                 SELECT id FROM public.reply_owners
                 WHERE customer_id = $3 OR identity_id = ANY($4::uuid[])
               )
             )`,
          [testMessages, testComplaints, custId, [verifiedIdentId, unverifiedIdentId]]
        );
        assert.equal(
          Number(autoIntents.rows[0].count),
          0,
          "State Persistence: Exactly 0 automatic outbound_intents must be created in SHADOW mode across all test messages, complaints, and owners"
        );

        // 2. Check reply_claims table: 0 debounce claims across test complaints or reply owners
        const replyClaims = await pool.query<{ count: string }>(
          `SELECT count(*) FROM public.reply_claims
           WHERE complaint_id = ANY($1::uuid[])
              OR owner_id IN (
                SELECT id FROM public.reply_owners
                WHERE customer_id = $2 OR identity_id = ANY($3::uuid[])
              )`,
          [testComplaints, custId, [verifiedIdentId, unverifiedIdentId]]
        );
        assert.equal(
          Number(replyClaims.rows[0].count),
          0,
          "State Persistence: Exactly 0 reply_claims must be created in SHADOW mode for any test complaint or owner"
        );

        // 3. Check triage_assessments table directly: enforce exact count, message identities, and SHADOW contract
        const assessmentsRes = await pool.query<{
          message_id: string;
          decision: { outcome: string; reason: string };
          processing_result: Record<string, unknown>;
        }>(
          "SELECT message_id, decision, processing_result FROM public.triage_assessments WHERE message_id = ANY($1::uuid[])",
          [testMessages]
        );
        assert.equal(
          assessmentsRes.rows.length,
          3,
          "State Persistence: Exactly 3 triage assessment rows must exist corresponding to all 3 test fixture messages"
        );

        const foundMessageIds = assessmentsRes.rows.map((r) => r.message_id).sort();
        const expectedMessageIds = [...testMessages].sort();
        assert.deepEqual(
          foundMessageIds,
          expectedMessageIds,
          "State Persistence: Triage assessment message IDs must match the 3 test fixture messages"
        );

        for (const row of assessmentsRes.rows) {
          const pr = row.processing_result as {
            dispatchAuthorized?: boolean;
            claim?: { outcome?: string; reason?: string; intentId?: string | null };
          };

          assert.equal(
            pr.dispatchAuthorized,
            false,
            `State Persistence: dispatchAuthorized must be false for assessment of message ${row.message_id}`
          );

          if (row.message_id === nonComplaintIngressId) {
            assert.equal(
              pr.claim?.outcome,
              "skipped",
              "State Persistence: Non-complaint assessment claim outcome must be 'skipped'"
            );
            assert.equal(
              pr.claim?.reason,
              "review",
              "State Persistence: Non-complaint assessment claim reason must be 'review'"
            );
            assert.equal(
              pr.claim?.intentId,
              null,
              "State Persistence: Non-complaint assessment intentId must be null"
            );
          } else {
            assert.equal(
              pr.claim?.outcome,
              "skipped",
              "State Persistence: Complaint assessment claim outcome must be 'skipped' in SHADOW mode"
            );
            assert.equal(
              pr.claim?.reason,
              "shadow_mode",
              "State Persistence: Complaint assessment claim reason must be 'shadow_mode'"
            );
          }
        }
      }
    );
  } catch (err) {
    primaryError = err as Error;
  } finally {
    // Teardown: clean up test fixtures in reverse dependency order
    try {
      await pool.query(
        "DELETE FROM public.reply_owners WHERE customer_id = $1 OR identity_id = ANY($2::uuid[])",
        [custId, [verifiedIdentId, unverifiedIdentId]]
      );
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      await pool.query("DELETE FROM public.mock_onu_status WHERE service_id = $1", [srvId]);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      await pool.query("DELETE FROM public.service_topology WHERE id = $1", [topId]);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      await cleanupFixture(pool, tracker);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      await pool.query("DELETE FROM public.odps WHERE id = $1", [odpId]);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      await pool.query("DELETE FROM public.odcs WHERE id = $1", [odcId]);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    try {
      if (actualStaffUserId) {
        const { error: delError } = await supabase.auth.admin.deleteUser(actualStaffUserId);
        if (delError) {
          cleanupErrors.push(new Error(`Failed to delete test staff user ${actualStaffUserId}: ${delError.message}`));
        } else {
          const { data: checkUser } = await supabase.auth.admin.getUserById(actualStaffUserId);
          if (checkUser?.user) {
            cleanupErrors.push(new Error(`Staff user ${actualStaffUserId} still exists in auth.users after deleteUser`));
          }
        }
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // Comprehensive residue verification across all tables touched by fixture
    try {
      const allTestMessages = [verifiedIngressId, unverifiedIngressId, nonComplaintIngressId].filter(Boolean);
      const allTestComplaints = [verifiedComplaintId, unverifiedComplaintId].filter(Boolean);

      const residualCheck = await pool.query<{ table_name: string; count: string }>(`
        SELECT 'odcs' as table_name, count(*)::text as count FROM public.odcs WHERE id = $1
        UNION ALL
        SELECT 'odps', count(*)::text FROM public.odps WHERE id = $2
        UNION ALL
        SELECT 'customers', count(*)::text FROM public.customers WHERE id = $3
        UNION ALL
        SELECT 'services', count(*)::text FROM public.services WHERE id = $4
        UNION ALL
        SELECT 'service_topology', count(*)::text FROM public.service_topology WHERE id = $5
        UNION ALL
        SELECT 'mock_onu_status', count(*)::text FROM public.mock_onu_status WHERE service_id = $4
        UNION ALL
        SELECT 'channel_identities', count(*)::text FROM public.channel_identities WHERE id = ANY($6::uuid[])
        UNION ALL
        SELECT 'ingress_events', count(*)::text FROM public.ingress_events WHERE id = ANY($7::uuid[])
        UNION ALL
        SELECT 'messages', count(*)::text FROM public.messages WHERE id = ANY($7::uuid[])
        UNION ALL
        SELECT 'processing_jobs', count(*)::text FROM public.processing_jobs WHERE ingress_id = ANY($7::uuid[])
        UNION ALL
        SELECT 'complaints', count(*)::text FROM public.complaints WHERE id = ANY($8::uuid[])
        UNION ALL
        SELECT 'triage_assessments', count(*)::text FROM public.triage_assessments WHERE message_id = ANY($7::uuid[])
        UNION ALL
        SELECT 'reply_owners', count(*)::text FROM public.reply_owners WHERE customer_id = $3 OR identity_id = ANY($6::uuid[])
        UNION ALL
        SELECT 'outbound_intents', count(*)::text FROM public.outbound_intents WHERE message_id = ANY($7::uuid[]) OR complaint_id = ANY($8::uuid[])
        UNION ALL
        SELECT 'reply_claims', count(*)::text FROM public.reply_claims WHERE complaint_id = ANY($8::uuid[])
      `, [
        odcId,
        odpId,
        custId,
        srvId,
        topId,
        [verifiedIdentId, unverifiedIdentId],
        allTestMessages,
        allTestComplaints,
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

    try {
      await pool.end();
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    restorer.restore();

    const finalError = combineErrors(primaryError, cleanupErrors);
    if (finalError) {
      throw finalError;
    }
  }
});
