import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  checkTestEnvAvailable,
  requireIsolatedDatabase,
  cleanupFixture,
  TestResourceTracker,
  EnvRestorer,
  combineErrors,
} from "../utils/test-guard";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { orchestrateProcessing } from "../../lib/application/orchestrate-processing";
import { handleTelegramWebhook } from "../../lib/application/telegram-inbound-service";
import type { Database } from "../../lib/supabase/database.types";

test("P2.4 Orchestration & Real Database Integration Suite", async (t) => {
  // 1. Validate test environment configuration (fail-closed if missing or invalid)
  const envCheck = checkTestEnvAvailable(process.env);
  if (!envCheck.available) {
    t.skip(`Skipping integration test: ${envCheck.reason}`);
    return;
  }

  const config = envCheck.config!;
  let pool: Pool | undefined;
  const envRestorer = new EnvRestorer();
  const cleanupErrors: Error[] = [];
  let primaryError: Error | undefined;

  let origSettings: { mode: string; emergency_stop: boolean } | undefined;

  try {
    pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
    const supabase = createClient<Database>(config.apiUrl, config.serviceRoleKey);

    // 2. Prove PostgreSQL and Supabase API read the exact same isolation marker
    await requireIsolatedDatabase(pool, supabase, config);

    // Refresh mock observation timestamps for the test run so observations are fresh
    const refreshSql = readFileSync(
      resolve(process.cwd(), "supabase/fixtures/refresh-network-observations.sql"),
      "utf8"
    ).replace(/^\uFEFF/, "");
    await pool.query(refreshSql);

    const persistence = new HelpdeskPersistence(pool);

    // Record original automation settings
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean }>(
      "SELECT mode, emergency_stop FROM public.automation_settings WHERE singleton = true"
    );
    if (settingsRes.rows.length > 0) {
      origSettings = {
        mode: settingsRes.rows[0].mode,
        emergency_stop: settingsRes.rows[0].emergency_stop,
      };
    }

    // Standard helper to create a verified test identity linked to seed customer 1 / service 1
    const seedCustomerId = "10000000-0000-4000-8000-000000000001";

    async function createTestIdentity(
      tracker: TestResourceTracker,
      suffix: string,
      verified = true,
      customerId = seedCustomerId,
      numericSenderId?: string
    ) {
      const id = randomUUID();
      const accountId = `acc_${suffix}`;
      const senderId = numericSenderId ?? `snd_${suffix}`;
      await pool!.query(
        `INSERT INTO public.channel_identities(
          id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at
        ) VALUES ($1, 'telegram', $2, $3, $4, $5, $6)`,
        [
          id,
          accountId,
          senderId,
          verified ? customerId : null,
          verified ? "verified" : "unverified",
          verified ? new Date().toISOString() : null,
        ]
      );
      tracker.recordIdentity(id);
      return { id, accountId, senderId };
    }

    // =========================================================================
    // SECTION 2: Real Database Verification & Cleanup Lifecycle
    // =========================================================================

    await t.test(
      "Real Database Verification: receive() + process() creates full entity graph and cleanup removes all test entities leaving baseline intact",
      async () => {
        const tracker = new TestResourceTracker();
        const runId = randomUUID().replace(/-/g, "").slice(0, 8);

        // Baseline comparison identity
        const baselineIdentity = randomUUID();
        const baselineAccount = `bl_acc_${runId}`;
        const baselineSender = `bl_snd_${runId}`;
        await pool!.query(
          `INSERT INTO public.channel_identities(id, channel, channel_account_id, sender_external_id, verification_status)
           VALUES ($1, 'telegram', $2, $3, 'unverified')`,
          [baselineIdentity, baselineAccount, baselineSender]
        );
        tracker.recordIdentity(baselineIdentity);

        try {
          // Test fixture identity
          const testIdent = await createTestIdentity(tracker, `cleanup_${runId}`);

          // Receive a connection complaint
          const { ingressId } = await persistence.receive({
            sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
            chatId: testIdent.senderId,
            providerMessageId: `msg_${runId}`,
            text: "wifi mati total lampu merah los",
          });
          tracker.recordIngress(ingressId);

          // Process the ingress to form full entity graph
          const procResult = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" });
          assert.ok(procResult.episodeId, "Episode must be created");

          // Verify all entities exist in the database
          const msgCheck = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
          assert.equal(Number(msgCheck.rows[0].count), 1, "Message must be persisted");

          const assessCheck = await pool!.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
          assert.equal(Number(assessCheck.rows[0].count), 1, "Triage assessment must be persisted");

          const episodeCheck = await pool!.query("SELECT count(*) FROM public.complaints WHERE id = $1", [procResult.episodeId]);
          assert.equal(Number(episodeCheck.rows[0].count), 1, "Episode must be persisted");

          const auditCheck = await pool!.query("SELECT count(*) FROM public.complaint_audit_log WHERE complaint_id = $1", [procResult.episodeId]);
          assert.ok(Number(auditCheck.rows[0].count) >= 1, "Audit log entries must be persisted");

          const convCheck = await pool!.query("SELECT count(*) FROM public.conversations WHERE id = $1", [procResult.conversationId]);
          assert.equal(Number(convCheck.rows[0].count), 1, "Conversation must be persisted");

          const jobCheck = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
          assert.equal(jobCheck.rows[0].status, "done", "Processing job must be done");

          // Run targeted cleanup for test fixture (excluding baseline identity)
          await cleanupFixture(pool!, {
            identityIds: [testIdent.id],
            ingressIds: [ingressId],
          });

          // Verify baseline comparison data remains intact
          const baselineCheck = await pool!.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [baselineIdentity]);
          assert.equal(Number(baselineCheck.rows[0].count), 1, "Baseline comparison identity must remain intact");

          // Verify all test fixture entities have been completely deleted
          const testIdentCheck = await pool!.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [testIdent.id]);
          assert.equal(Number(testIdentCheck.rows[0].count), 0, "Test identity must be deleted");

          const testMsgCheck = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
          assert.equal(Number(testMsgCheck.rows[0].count), 0, "Test message must be deleted");

          const testAssessCheck = await pool!.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
          assert.equal(Number(testAssessCheck.rows[0].count), 0, "Test assessment must be deleted");

          const testEpisodeCheck = await pool!.query("SELECT count(*) FROM public.complaints WHERE id = $1", [procResult.episodeId]);
          assert.equal(Number(testEpisodeCheck.rows[0].count), 0, "Test episode must be deleted");

          const testConvCheck = await pool!.query("SELECT count(*) FROM public.conversations WHERE id = $1", [procResult.conversationId]);
          assert.equal(Number(testConvCheck.rows[0].count), 0, "Test conversation must be deleted");

          const testJobCheck = await pool!.query("SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
          assert.equal(Number(testJobCheck.rows[0].count), 0, "Test job must be deleted");
        } finally {
          await cleanupFixture(pool!, tracker);
        }
      }
    );

    await t.test(
      "Real Database Verification: Controlled failure in processing performs cleanup without connection leaks",
      async () => {
        const tracker = new TestResourceTracker();
        const runId = randomUUID().replace(/-/g, "").slice(0, 8);

        try {
          const testIdent = await createTestIdentity(tracker, `fail_${runId}`);
          const { ingressId } = await persistence.receive({
            sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
            chatId: testIdent.senderId,
            providerMessageId: `msg_fail_${runId}`,
            text: "wifi mati",
          });
          tracker.recordIngress(ingressId);

          // Simulate a controlled failure by throwing in onBeforeTransaction hook
          await assert.rejects(
            orchestrateProcessing(pool!, supabase, ingressId, {
              hooks: {
                onBeforeTransaction: () => {
                  throw new Error("Simulated controlled failure before transaction");
                },
              },
            }),
            /Simulated controlled failure before transaction/
          );

          // Job should still be pending and no message created
          const job = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
          assert.equal(job.rows[0].status, "pending");

          const msgs = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
          assert.equal(Number(msgs.rows[0].count), 0);
        } finally {
          await cleanupFixture(pool!, tracker);
        }
      }
    );

    // =========================================================================
    // SECTION 3 & 4: Acceptance Criteria (AC 1 to 8)
    // =========================================================================

    // AC 1: Telegram webhook receipt saves ingress/job before processing; processing stores message, conversation, episode, assessment, audit, and marks job done
    await t.test("AC 1: Simulated Telegram webhook ingress saves job first, then processing completes full persistence graph", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        const numericSenderId = String(100000000 + Math.floor(Math.random() * 899999999));
        const testIdent = await createTestIdentity(tracker, `ac1_${runId}`, true, seedCustomerId, numericSenderId);

        const secretToken = `secret_ac1_${runId}`;
        const telegramUpdate = {
          update_id: 100001,
          message: {
            message_id: 998877,
            from: {
              id: Number(numericSenderId),
              is_bot: false,
              first_name: "Tester",
            },
            chat: {
              id: Number(numericSenderId),
              type: "private",
            },
            date: Math.floor(Date.now() / 1000),
            text: "koneksi internet terputus lampu los merah",
          },
        };

        const webhookReq = new Request("http://localhost/api/webhooks/telegram", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": secretToken,
          },
          body: JSON.stringify(telegramUpdate),
        });

        const webhookRes = await handleTelegramWebhook(webhookReq, persistence, {
          webhookSecret: secretToken,
          botAccountId: testIdent.accountId,
          testerAllowlist: [numericSenderId],
        });

        assert.equal(webhookRes.status, 200, "Webhook response must be 200 OK");
        const webhookJson = (await webhookRes.json()) as {
          success: boolean;
          data: { status: string; ingressId: string; duplicate: boolean };
        };
        assert.equal(webhookJson.success, true);
        assert.equal(webhookJson.data.status, "accepted");
        assert.equal(webhookJson.data.duplicate, false);

        const ingressId = webhookJson.data.ingressId;
        tracker.recordIngress(ingressId);

        // Assert job is pending BEFORE orchestrateProcessing and no message or assessment exists on ACK path
        const beforeJob = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
        assert.equal(beforeJob.rows[0].status, "pending");

        const beforeMsg = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
        assert.equal(Number(beforeMsg.rows[0].count), 0, "No message should exist on webhook ACK path");

        const beforeAssess = await pool!.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
        assert.equal(Number(beforeAssess.rows[0].count), 0, "No assessment should exist on webhook ACK path");

        // Now explicitly invoke orchestrateProcessing (not on the webhook ACK path)
        const result = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" });

        // Assert job is done AFTER orchestrateProcessing
        const afterJob = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
        assert.equal(afterJob.rows[0].status, "done");

        // Message, Conversation, Episode, Assessment, Audit row checks
        const msg = await pool!.query("SELECT * FROM public.messages WHERE id = $1", [ingressId]);
        assert.equal(msg.rowCount, 1);
        assert.equal(msg.rows[0].complaint_id, result.episodeId);

        const conv = await pool!.query("SELECT * FROM public.conversations WHERE id = $1", [result.conversationId]);
        assert.equal(conv.rowCount, 1);

        const episode = await pool!.query("SELECT * FROM public.complaints WHERE id = $1", [result.episodeId]);
        assert.equal(episode.rowCount, 1);
        assert.equal(episode.rows[0].status, "NEW");

        const assess = await pool!.query("SELECT * FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
        assert.equal(assess.rowCount, 1);

        const audits = await pool!.query("SELECT action FROM public.complaint_audit_log WHERE complaint_id = $1", [result.episodeId]);
        assert.ok(audits.rows.some(r => r.action === "created"));
        assert.ok(audits.rows.some(r => r.action === "inbound_processed"));
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 2: Decision and reason matrix across all scenarios (normal, los_individual, los_area, upstream_down, stale, unknown, timeout, provider_error, partial failure, manual AREA match/no-match)
    await t.test("AC 2: Scenario matrix produces decisions and reasons adhering to PRD", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      const testCases = [
        { scenario: "normal", expectedTemplate: "ONLINE_CHECK", expectedReason: "online" },
        { scenario: "los_individual", expectedTemplate: "LOS_INDIVIDUAL", expectedReason: "los_individual" },
        { scenario: "los_area", expectedTemplate: "LOS_AREA", expectedReason: "los_area" },
        { scenario: "upstream_down", expectedTemplate: "NETWORK_DISRUPTION", expectedReason: "upstream_down" },
        { scenario: "stale", expectedTemplate: "GENERIC", expectedReason: "onu_unusable" },
        { scenario: "unknown", expectedTemplate: "GENERIC", expectedReason: "onu_unusable" },
        { scenario: "timeout", expectedTemplate: "GENERIC", expectedReason: "onu_unusable" },
        { scenario: "provider_error", expectedTemplate: "GENERIC", expectedReason: "onu_unusable" },
        { scenario: "upstream_error_los", expectedTemplate: "LOS_INDIVIDUAL", expectedReason: "los_individual" },
        { scenario: "onu_error_upstream_down", expectedTemplate: "NETWORK_DISRUPTION", expectedReason: "upstream_down" },
      ];

      try {
        for (const tc of testCases) {
          const testIdent = await createTestIdentity(tracker, `ac2_${tc.scenario}_${runId}`);
          const { ingressId } = await persistence.receive({
            sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
            chatId: testIdent.senderId,
            providerMessageId: `msg_${tc.scenario}_${runId}`,
            text: "internet saya mati lampu los merah",
          });
          tracker.recordIngress(ingressId);

          const result = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: tc.scenario });
          assert.equal(
            result.decision.effectiveTemplateKey,
            tc.expectedTemplate,
            `Scenario ${tc.scenario} must result in template ${tc.expectedTemplate}`
          );
          assert.equal(
            result.decision.reason,
            tc.expectedReason,
            `Scenario ${tc.scenario} must result in reason ${tc.expectedReason}`
          );
        }

        // Test Manual AREA_SPECIFIC matching ODP
        const odpId = "40000000-0000-4000-8000-000000000001";
        const areaIncId = randomUUID();
        await pool!.query(
          `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
           VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 1)`,
          [areaIncId, [odpId]]
        );
        tracker.recordIncident(areaIncId);

        const areaIdent = await createTestIdentity(tracker, `ac2_area_match_${runId}`);
        const { ingressId: areaIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: areaIdent.accountId, senderExternalId: areaIdent.senderId },
          chatId: areaIdent.senderId,
          providerMessageId: `msg_area_match_${runId}`,
          text: "gangguan internet los merah",
        });
        tracker.recordIngress(areaIngressId);

        const areaResult = await orchestrateProcessing(pool!, supabase, areaIngressId, { scenarioId: "normal" });
        assert.equal(areaResult.decision.effectiveTemplateKey, "MASS_AREA");
        assert.equal(areaResult.decision.reason, "manual_area_match");

        // Cleanup area incident before next tests
        await pool!.query("DELETE FROM public.incidents WHERE id = $1", [areaIncId]);

        // Test Manual AREA_SPECIFIC not matching ODP (falls through to independent evidence, e.g. normal -> ONLINE_CHECK)
        const nonMatchIncId = randomUUID();
        await pool!.query(
          `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
           VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 1)`,
          [nonMatchIncId, ["40000000-0000-4000-8000-999999999999"]]
        );
        tracker.recordIncident(nonMatchIncId);

        const noMatchIdent = await createTestIdentity(tracker, `ac2_nomatch_${runId}`);
        const { ingressId: noMatchIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: noMatchIdent.accountId, senderExternalId: noMatchIdent.senderId },
          chatId: noMatchIdent.senderId,
          providerMessageId: `msg_nomatch_${runId}`,
          text: "gangguan internet los merah",
        });
        tracker.recordIngress(noMatchIngressId);

        const noMatchResult = await orchestrateProcessing(pool!, supabase, noMatchIngressId, { scenarioId: "normal" });
        assert.equal(noMatchResult.decision.effectiveTemplateKey, "ONLINE_CHECK");
        assert.equal(noMatchResult.decision.reason, "online");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 3: GENERAL and non-complaint skip provider (0 provider calls); Unverified & non-complaints follow generic/review; Media without caption saved
    await t.test("AC 3: GENERAL and non-complaint bypass provider (0 calls); Unverified and media without caption handled cleanly", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        // 1. GENERAL incident bypasses provider (verified sender, provider call count must be 0)
        const genIncId = randomUUID();
        await pool!.query(
          `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
           VALUES ($1, 'GENERAL', 'ACTIVE', '{}', '{}', 1)`,
          [genIncId]
        );
        tracker.recordIncident(genIncId);

        let providerCalls = 0;
        const genIdent = await createTestIdentity(tracker, `ac3_gen_${runId}`);
        const { ingressId: genIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: genIdent.accountId, senderExternalId: genIdent.senderId },
          chatId: genIdent.senderId,
          providerMessageId: `msg_gen_${runId}`,
          text: "internet saya mati los",
        });
        tracker.recordIngress(genIngressId);

        const genResult = await orchestrateProcessing(pool!, supabase, genIngressId, {
          hooks: {
            onProviderCall: () => {
              providerCalls++;
            },
          },
        });
        assert.equal(providerCalls, 0, "GENERAL incident must bypass provider inspection completely");
        assert.equal(genResult.decision.effectiveTemplateKey, "MASS_GENERAL");
        assert.equal(genResult.decision.reason, "general_active");

        // Remove GENERAL incident
        await pool!.query("DELETE FROM public.incidents WHERE id = $1", [genIncId]);

        // 2. Non-complaint message bypasses provider (0 calls)
        let nonComplaintCalls = 0;
        const nonComplaintIdent = await createTestIdentity(tracker, `ac3_noncomp_${runId}`);
        const { ingressId: nonCompIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: nonComplaintIdent.accountId, senderExternalId: nonComplaintIdent.senderId },
          chatId: nonComplaintIdent.senderId,
          providerMessageId: `msg_noncomp_${runId}`,
          text: "terima kasih banyak atas bantuannya",
        });
        tracker.recordIngress(nonCompIngressId);

        const nonCompResult = await orchestrateProcessing(pool!, supabase, nonCompIngressId, {
          hooks: {
            onProviderCall: () => {
              nonComplaintCalls++;
            },
          },
        });
        assert.equal(nonComplaintCalls, 0, "Non-complaint message must bypass provider inspection");
        assert.equal(nonCompResult.episodeId, null, "Non-complaint must not create an episode");
        assert.equal(nonCompResult.decision.outcome, "review");

        // 3. Unverified sender with complaint: provider bypassed because sender is unresolved
        let unverifiedCalls = 0;
        const unverifiedIdent = await createTestIdentity(tracker, `ac3_unverified_${runId}`, false);
        const { ingressId: unverifiedIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: unverifiedIdent.accountId, senderExternalId: unverifiedIdent.senderId },
          chatId: unverifiedIdent.senderId,
          providerMessageId: `msg_unver_${runId}`,
          text: "lampu los merah internet mati",
        });
        tracker.recordIngress(unverifiedIngressId);

        const unverifiedResult = await orchestrateProcessing(pool!, supabase, unverifiedIngressId, {
          hooks: {
            onProviderCall: () => {
              unverifiedCalls++;
            },
          },
        });
        assert.equal(unverifiedCalls, 0, "Unverified sender must bypass network inspection");
        assert.equal(unverifiedResult.decision.effectiveTemplateKey, "GENERIC");
        assert.equal(unverifiedResult.decision.reason, "identity_unresolved");

        // 4. Media message without caption is stored cleanly
        const mediaIdent = await createTestIdentity(tracker, `ac3_media_${runId}`);
        const { ingressId: mediaIngressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: mediaIdent.accountId, senderExternalId: mediaIdent.senderId },
          chatId: mediaIdent.senderId,
          providerMessageId: `msg_media_${runId}`,
          text: "",
          metadata: {
            messageType: "photo",
            hasMedia: true,
            caption: null,
          },
        });
        tracker.recordIngress(mediaIngressId);

        const mediaResult = await orchestrateProcessing(pool!, supabase, mediaIngressId);
        assert.ok(mediaResult.messageId);
        const mediaMsgCheck = await pool!.query("SELECT classification FROM public.messages WHERE id = $1", [mediaIngressId]);
        assert.equal(mediaMsgCheck.rowCount, 1);
        const mediaIngressCheck = await pool!.query("SELECT body FROM public.ingress_events WHERE id = $1", [mediaIngressId]);
        assert.equal(mediaIngressCheck.rows[0].body, "");
        assert.equal(mediaResult.decision.outcome, "review");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 4: SHADOW mode produces zero claims, zero outbound intents, dispatchAuthorized=false, and backlog is not activated when mode changes to FULL
    await t.test("AC 4: SHADOW mode suppresses auto claims and intents; settings change to FULL does not activate backlog", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        // Set mode to SHADOW
        await pool!.query("UPDATE public.automation_settings SET mode = 'SHADOW' WHERE singleton = true");

        const testIdent = await createTestIdentity(tracker, `ac4_shadow_${runId}`);
        const { ingressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
          chatId: testIdent.senderId,
          providerMessageId: `msg_shadow_${runId}`,
          text: "lampu merah los internet mati",
        });
        tracker.recordIngress(ingressId);

        const result = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "los_individual" });

        // Assert claim is skipped due to shadow_mode and dispatch is unauthorized
        assert.equal(result.claim.outcome, "skipped");
        assert.equal(result.claim.reason, "shadow_mode");
        assert.equal(result.dispatchAuthorized, false);

        // Assert 0 automatic outbound intents created
        const intents = await pool!.query(
          "SELECT count(*) FROM public.outbound_intents WHERE message_id = $1 AND origin = 'automatic'",
          [ingressId]
        );
        assert.equal(Number(intents.rows[0].count), 0, "No automatic outbound intents in SHADOW mode");

        // Now upgrade settings to FULL
        await pool!.query("UPDATE public.automation_settings SET mode = 'FULL' WHERE singleton = true");

        // Re-run orchestrateProcessing on the backlog message: it must return the persisted result idempotently
        const recheckResult = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "los_individual" });
        assert.equal(recheckResult.claim.outcome, "skipped");
        assert.equal(recheckResult.claim.reason, "shadow_mode");
        assert.equal(recheckResult.dispatchAuthorized, false);

        const afterIntents = await pool!.query(
          "SELECT count(*) FROM public.outbound_intents WHERE message_id = $1",
          [ingressId]
        );
        assert.equal(Number(afterIntents.rows[0].count), 0, "Backlog SHADOW messages must never gain claims after mode change");
      } finally {
        // Restore settings
        if (origSettings) {
          await pool!.query("UPDATE public.automation_settings SET mode = $1, emergency_stop = $2 WHERE singleton = true", [
            origSettings.mode,
            origSettings.emergency_stop,
          ]);
        }
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 5: Sequential and parallel deduplication do not duplicate entities; follow-up keeps same episode
    await t.test("AC 5: Deduplication prevents duplication across sequential and parallel runs; follow-up reuses episode", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        const testIdent = await createTestIdentity(tracker, `ac5_${runId}`);
        const { ingressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
          chatId: testIdent.senderId,
          providerMessageId: `msg_ac5_${runId}`,
          text: "gangguan internet lampu los merah",
        });
        tracker.recordIngress(ingressId);

        // 1. Parallel execution of orchestrateProcessing on the same ingressId
        const [res1, res2] = await Promise.all([
          orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" }),
          orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" }),
        ]);

        assert.deepEqual(res1, res2, "Parallel calls must return identical results");

        // 2. Sequential call
        const res3 = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" });
        assert.deepEqual(res1, res3, "Sequential call must return identical result");

        // Verify counts in DB: exactly 1 message, 1 triage_assessment
        const msgCount = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
        assert.equal(Number(msgCount.rows[0].count), 1);

        const assessCount = await pool!.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
        assert.equal(Number(assessCount.rows[0].count), 1);

        // 3. Follow-up message on the same problem from the same identity
        const { ingressId: followUpId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
          chatId: testIdent.senderId,
          providerMessageId: `msg_ac5_followup_${runId}`,
          text: "internet mati masih belum beres",
        });
        tracker.recordIngress(followUpId);

        const followUpResult = await orchestrateProcessing(pool!, supabase, followUpId, { scenarioId: "normal" });
        assert.equal(followUpResult.episodeId, res1.episodeId, "Follow-up message must reuse existing active episode");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 6: Fault injection rollback after partial mutation inside transaction: query outside transaction confirms clean rollback; retry succeeds idempoten
    await t.test("AC 6: Fault injection after partial mutation verifies transaction rollback; retry succeeds and is idempotent", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        const testIdent = await createTestIdentity(tracker, `ac6_${runId}`);
        const { ingressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
          chatId: testIdent.senderId,
          providerMessageId: `msg_ac6_${runId}`,
          text: "mati internet los merah",
        });
        tracker.recordIngress(ingressId);

        let failTriageInsert = true;
        let reachedTriageInsert = false;

        // Proxy pool to inject fault inside transaction AFTER partial mutations (messages, complaints, audit)
        const faultPool = {
          async connect() {
            const client = await pool!.connect();
            const realQuery = client.query;
            const clientProxy = Object.create(client) as typeof client;
            // @ts-expect-error proxying for targeted fault injection
            clientProxy.query = function (
              queryTextOrConfig: unknown,
              values?: unknown,
              callback?: unknown,
            ) {
              const q = typeof queryTextOrConfig === "string"
                ? queryTextOrConfig
                : (queryTextOrConfig as { text?: string })?.text ?? "";
              if (failTriageInsert && q.toLowerCase().includes("insert into public.triage_assessments")) {
                reachedTriageInsert = true;
                throw new Error("Simulated database failure during insert into triage_assessments");
              }
              // @ts-expect-error delegating with exact arguments
              return realQuery.call(client, queryTextOrConfig, values, callback);
            };
            clientProxy.release = function (destroy?: boolean) {
              return client.release(destroy);
            };
            return clientProxy;
          },
          query(...args: unknown[]) {
            return (pool!.query as (...a: unknown[]) => unknown)(...args);
          },
        } as unknown as Pool;

        await assert.rejects(
          orchestrateProcessing(faultPool, supabase, ingressId, { scenarioId: "normal" }),
          /Simulated database failure during insert into triage_assessments/
        );

        assert.equal(reachedTriageInsert, true, "Fault must be injected during insert into triage_assessments");

        // Verification outside transaction: No message, no assessment, no episode created; job still pending
        const msgCheck = await pool!.query("SELECT count(*) FROM public.messages WHERE id = $1", [ingressId]);
        assert.equal(Number(msgCheck.rows[0].count), 0, "No partial message should exist after rollback");

        const assessCheck = await pool!.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [ingressId]);
        assert.equal(Number(assessCheck.rows[0].count), 0, "No partial assessment should exist after rollback");

        const epCheck = await pool!.query(
          "SELECT count(*) FROM public.complaints WHERE identity_id = $1",
          [testIdent.id]
        );
        assert.equal(Number(epCheck.rows[0].count), 0, "No partial complaint episode should exist after rollback");

        const jobCheck = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
        assert.equal(jobCheck.rows[0].status, "pending", "Job must remain pending for retry");

        // Retry without fault succeeds
        failTriageInsert = false;
        const retryResult = await orchestrateProcessing(pool!, supabase, ingressId, { scenarioId: "normal" });
        assert.ok(retryResult.episodeId, "Retry must succeed and create episode");

        const afterJobCheck = await pool!.query("SELECT status FROM public.processing_jobs WHERE ingress_id = $1", [ingressId]);
        assert.equal(afterJobCheck.rows[0].status, "done", "Job must be marked done after successful retry");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 7: Provider runs outside transaction; revalidates changed identity, changed incident (A -> B), and deleted incident snapshot
    await t.test("AC 7: Provider runs outside transaction; revalidates changed identity, incident replacement (A -> B), and deleted incident", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        // Part A: Concurrent identity change after provider completes but before final transaction
        const testIdentA = await createTestIdentity(tracker, `ac7_ident_${runId}`);
        const { ingressId: ingressA } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdentA.accountId, senderExternalId: testIdentA.senderId },
          chatId: testIdentA.senderId,
          providerMessageId: `msg_ac7_a_${runId}`,
          text: "koneksi internet mati los",
        });
        tracker.recordIngress(ingressA);

        const resultA = await orchestrateProcessing(pool!, supabase, ingressA, {
          scenarioId: "los_individual",
          hooks: {
            onAfterProvider: async () => {
              // Unlink identity customer_id after provider finished but before final transaction
              await pool!.query(
                "UPDATE public.channel_identities SET customer_id = null, verification_status = 'unverified', verified_at = null WHERE id = $1",
                [testIdentA.id]
              );
            },
          },
        });

        // Because identity was mutated, stale network evidence cannot be applied; decision falls back to generic
        assert.equal(resultA.decision.effectiveTemplateKey, "GENERIC");
        assert.equal(resultA.decision.reason, "identity_unresolved");

        // Part B: Specific incident replacement A -> B
        // AREA incident A is ACTIVE before provider runs.
        // After provider finishes but before final transaction: A becomes RESOLVED and GENERAL incident B becomes ACTIVE.
        // Final assessment selects MASS_GENERAL pointing to B, NOT A and NOT ONLINE_CHECK.
        const incAId = randomUUID();
        await pool!.query(
          `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
           VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 1)`,
          [incAId, ["40000000-0000-4000-8000-000000000001"]]
        );
        tracker.recordIncident(incAId);

        const testIdentB = await createTestIdentity(tracker, `ac7_inc_ab_${runId}`);
        const { ingressId: ingressB } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdentB.accountId, senderExternalId: testIdentB.senderId },
          chatId: testIdentB.senderId,
          providerMessageId: `msg_ac7_b_${runId}`,
          text: "internet los mati",
        });
        tracker.recordIngress(ingressB);

        const incBId = randomUUID();
        const resultB = await orchestrateProcessing(pool!, supabase, ingressB, {
          scenarioId: "normal",
          hooks: {
            onAfterProvider: async () => {
              // A becomes RESOLVED (version 2)
              await pool!.query(
                "UPDATE public.incidents SET status = 'RESOLVED', version = 2, updated_at = now() WHERE id = $1",
                [incAId]
              );
              // B is created ACTIVE (version 5 - distinct from A's initial version 1 and resolved version 2)
              await pool!.query(
                `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
                 VALUES ($1, 'GENERAL', 'ACTIVE', '{}', '{}', 5)`,
                [incBId]
              );
              tracker.recordIncident(incBId);
            },
          },
        });

        assert.equal(resultB.decision.effectiveTemplateKey, "MASS_GENERAL", "Assessment must choose MASS_GENERAL from incident B");
        assert.equal(resultB.decision.reason, "general_active");
        assert.equal(resultB.decision.incidentId, incBId, "Assessment must point to incident B ID");
        assert.notEqual(resultB.decision.incidentId, incAId, "Assessment must not point to resolved incident A");

        // Verify resultB.decision.evidence contains kind="incident", ID B, and version 5
        const resultBEvidence = resultB.decision.evidence.find((e) => e.kind === "incident");
        assert.ok(resultBEvidence, "resultB.decision.evidence must contain an evidence entry with kind 'incident'");
        assert.equal(resultBEvidence.id, incBId, "Evidence entry ID must match incident B");
        assert.equal(resultBEvidence.version, 5, "Evidence entry version must match incident B version (version 5)");

        // Verify stored row in triage_assessments directly
        const dbAssessB = await pool!.query<{
          decision: {
            effectiveTemplateKey: string;
            reason: string;
            incidentId: string;
            evidence: Array<{ kind: string; id?: string; version?: number }>;
          };
        }>(
          "SELECT decision FROM public.triage_assessments WHERE message_id = $1",
          [ingressB]
        );
        assert.equal(dbAssessB.rows[0].decision.effectiveTemplateKey, "MASS_GENERAL");
        assert.equal(dbAssessB.rows[0].decision.reason, "general_active");
        assert.equal(dbAssessB.rows[0].decision.incidentId, incBId);

        const storedBEvidence = dbAssessB.rows[0].decision.evidence?.find((e) => e.kind === "incident");
        assert.ok(storedBEvidence, "Stored decision.evidence in database must contain kind 'incident'");
        assert.equal(storedBEvidence.id, incBId, "Stored decision.evidence ID must match incident B");
        assert.equal(storedBEvidence.version, 5, "Stored decision.evidence version must match incident B (version 5, distinguishing from A)");

        // Clean up active incident B before next part
        await pool!.query("DELETE FROM public.incidents WHERE id = $1", [incBId]);

        // Part C: Deleted / Missing incident snapshot in DB before final transaction
        // AREA incident Y is ACTIVE when initial snapshot is taken.
        // In onAfterProvider: incident Y is completely deleted from the database.
        // Final transaction must NOT use missing incident Y; falls back to independent evidence (normal -> ONLINE_CHECK).
        const incYId = randomUUID();
        await pool!.query(
          `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version)
           VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 1)`,
          [incYId, ["40000000-0000-4000-8000-000000000001"]]
        );
        tracker.recordIncident(incYId);

        const testIdentC = await createTestIdentity(tracker, `ac7_inc_del_${runId}`);
        const { ingressId: ingressC } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdentC.accountId, senderExternalId: testIdentC.senderId },
          chatId: testIdentC.senderId,
          providerMessageId: `msg_ac7_c_${runId}`,
          text: "internet los mati",
        });
        tracker.recordIngress(ingressC);

        const resultC = await orchestrateProcessing(pool!, supabase, ingressC, {
          scenarioId: "normal",
          hooks: {
            onAfterProvider: async () => {
              // Delete incident Y completely from database before final transaction
              await pool!.query("DELETE FROM public.incidents WHERE id = $1", [incYId]);
            },
          },
        });

        assert.equal(resultC.decision.effectiveTemplateKey, "ONLINE_CHECK", "Missing incident snapshot must fall back to independent evidence");
        assert.equal(resultC.decision.reason, "online");
        assert.equal(resultC.decision.incidentId, null, "incidentId must be null for independent evidence fallback");
        assert.equal(
          resultC.decision.evidence.some((e) => e.kind === "incident"),
          false,
          "Fallback decision evidence must not contain incident evidence"
        );

        // Verify stored row in triage_assessments directly
        const dbAssessC = await pool!.query<{
          decision: {
            effectiveTemplateKey: string;
            reason: string;
            incidentId: string | null;
            evidence: Array<{ kind: string }>;
          };
        }>(
          "SELECT decision FROM public.triage_assessments WHERE message_id = $1",
          [ingressC]
        );
        assert.equal(dbAssessC.rows[0].decision.effectiveTemplateKey, "ONLINE_CHECK");
        assert.equal(dbAssessC.rows[0].decision.reason, "online");
        assert.equal(dbAssessC.rows[0].decision.incidentId, null);
        assert.equal(
          dbAssessC.rows[0].decision.evidence?.some((e) => e.kind === "incident") ?? false,
          false,
          "Stored decision.evidence in database must not contain incident evidence"
        );

        // Part D: Instrument hook execution order proving provider runs outside transaction
        const hookOrder: string[] = [];
        const testIdentD = await createTestIdentity(tracker, `ac7_order_${runId}`);
        const { ingressId: ingressD } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdentD.accountId, senderExternalId: testIdentD.senderId },
          chatId: testIdentD.senderId,
          providerMessageId: `msg_ac7_d_${runId}`,
          text: "internet los mati",
        });
        tracker.recordIngress(ingressD);

        await orchestrateProcessing(pool!, supabase, ingressD, {
          scenarioId: "normal",
          hooks: {
            onBeforeProvider: () => {
              hookOrder.push("onBeforeProvider");
            },
            onProviderCall: () => {
              hookOrder.push("onProviderCall");
            },
            onAfterProvider: () => {
              hookOrder.push("onAfterProvider");
            },
            onBeforeTransaction: () => {
              hookOrder.push("onBeforeTransaction");
            },
          },
        });

        assert.deepEqual(hookOrder, [
          "onBeforeProvider",
          "onProviderCall",
          "onAfterProvider",
          "onBeforeTransaction",
        ], "Hooks must execute strictly in sequence showing provider completes before transaction is initiated");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });

    // AC 8: Default scenario without override defaults to "normal", and providerQuality is persisted and readable from DB
    await t.test("AC 8: Default scenario without override uses 'normal', and providerQuality is readable from database", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().replace(/-/g, "").slice(0, 8);

      try {
        const testIdent = await createTestIdentity(tracker, `ac8_${runId}`);
        const { ingressId } = await persistence.receive({
          sender: { channel: "telegram", channelAccountId: testIdent.accountId, senderExternalId: testIdent.senderId },
          chatId: testIdent.senderId,
          providerMessageId: `msg_ac8_${runId}`,
          text: "lampu los merah modem mati",
        });
        tracker.recordIngress(ingressId);

        // Call without scenarioId override or env set
        const result = await orchestrateProcessing(pool!, supabase, ingressId);

        assert.equal(result.decision.effectiveTemplateKey, "ONLINE_CHECK");
        assert.equal(result.decision.reason, "online");

        // Read back from triage_assessments directly
        const dbAssessment = await pool!.query<{
          decision: Record<string, unknown>;
          processing_result: { providerQuality: Record<string, unknown> };
        }>("SELECT decision, processing_result FROM public.triage_assessments WHERE message_id = $1", [ingressId]);

        assert.equal(dbAssessment.rowCount, 1);
        const quality = dbAssessment.rows[0].processing_result.providerQuality;
        assert.ok(quality, "providerQuality snapshot must be stored in database");
        assert.equal(quality.source, "MOCK");
        assert.equal(quality.scenarioId, "normal");
        assert.equal(quality.outcome, "ok");
        assert.equal(quality.reason, null);
        assert.ok((quality.onu as Record<string, unknown>).status === "online");
        assert.ok((quality.onu as Record<string, unknown>).quality === "fresh");
      } finally {
        await cleanupFixture(pool!, tracker);
      }
    });
  } catch (err) {
    primaryError = err as Error;
  } finally {
    // Restore singleton automation settings if they were modified
    if (origSettings && pool) {
      try {
        await pool.query(
          "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2 WHERE singleton = true",
          [origSettings.mode, origSettings.emergency_stop]
        );
      } catch (settingsErr) {
        cleanupErrors.push(new Error(`Failed to restore automation_settings: ${(settingsErr as Error).message}`));
      }
    }

    envRestorer.restore();

    if (pool) {
      try {
        await pool.end();
      } catch (poolErr) {
        cleanupErrors.push(new Error(`Failed to close database pool: ${(poolErr as Error).message}`));
      }
    }

    const finalError = combineErrors(primaryError, cleanupErrors);
    if (finalError) {
      throw finalError;
    }
  }
});
