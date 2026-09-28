import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { handleTelegramWebhook } from "../../lib/application/telegram-inbound-service";
import type { TelegramUpdate } from "../../lib/adapters/telegram/telegram-types";

test("P2.2 Telegram webhook endpoint and persistent ACK integration", async (t) => {
  const url = process.env.HELPDESK_TEST_DATABASE_URL;
  assert.ok(url, "Set HELPDESK_TEST_DATABASE_URL to the migrated local Supabase database");
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "Local database only",
  );

  const pool = new Pool({ connectionString: url, max: 8 });
  const persistence = new HelpdeskPersistence(pool);
  const tag = "p22-" + randomUUID().slice(0, 8);
  const testSecret = "webhook-secret-token-" + tag;
  const botAccountId = "bot-" + tag;
  const testerId = "88990011";
  const otherTesterId = "88990022";
  const nonTesterId = "77665544";

  const configOverrides = {
    webhookSecret: testSecret,
    botAccountId,
    testerAllowlist: [testerId, otherTesterId],
  };

  function makeWebhookRequest(
    body: unknown,
    options: {
      secret?: string | null;
      headers?: Record<string, string>;
    } = {},
  ): Request {
    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    if (options.secret !== null) {
      headers["x-telegram-bot-api-secret-token"] = options.secret ?? testSecret;
    }
    return new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers,
      body: rawBody,
    });
  }

  function makeUpdate(
    messageId: number,
    senderId: string,
    overrides: Partial<TelegramUpdate["message"]> = {},
  ): TelegramUpdate {
    return {
      update_id: 100000 + messageId,
      message: {
        message_id: messageId,
        date: 1727600000,
        chat: { id: Number(senderId), type: "private" },
        from: {
          id: Number(senderId),
          is_bot: false,
          first_name: "TesterName",
          username: "tester_user",
        },
        text: "Lapor wifi mati lampu merah",
        ...overrides,
      },
    };
  }

  try {
    // 1. Secret verification fails closed before any DB mutation
    await t.test("rejects invalid or missing secret with 401 without side effects", async () => {
      const initialIngressCount = (
        await pool.query("select count(*) from public.ingress_events where account_id=$1", [
          botAccountId,
        ])
      ).rows[0].count;

      // Missing header
      const reqMissing = makeWebhookRequest(makeUpdate(1, testerId), { secret: null });
      const resMissing = await handleTelegramWebhook(reqMissing, persistence, configOverrides);
      assert.equal(resMissing.status, 401);
      const bodyMissing = (await resMissing.json()) as { success: boolean; error: { code: string } };
      assert.equal(bodyMissing.success, false);
      assert.equal(bodyMissing.error?.code, "UNAUTHORIZED");

      // Wrong secret
      const reqWrong = makeWebhookRequest(makeUpdate(1, testerId), { secret: "wrong-secret-token" });
      const resWrong = await handleTelegramWebhook(reqWrong, persistence, configOverrides);
      assert.equal(resWrong.status, 401);

      // Unconfigured secret
      const reqUnconfigured = makeWebhookRequest(makeUpdate(1, testerId), { secret: testSecret });
      const resUnconfigured = await handleTelegramWebhook(reqUnconfigured, persistence, {
        ...configOverrides,
        webhookSecret: "",
      });
      assert.equal(resUnconfigured.status, 401);

      // Verify no DB mutations occurred
      const finalIngressCount = (
        await pool.query("select count(*) from public.ingress_events where account_id=$1", [
          botAccountId,
        ])
      ).rows[0].count;
      assert.equal(finalIngressCount, initialIngressCount);
    });

    // 2. Body size limit
    await t.test("rejects oversized body with 413 without side effects", async () => {
      const largePayload = JSON.stringify(
        makeUpdate(2, testerId, { text: "x".repeat(2000) }),
      );
      const reqOversized = makeWebhookRequest(largePayload);
      const resOversized = await handleTelegramWebhook(reqOversized, persistence, {
        ...configOverrides,
        maxPayloadBytes: 500, // limit to 500 bytes for this test
      });
      assert.equal(resOversized.status, 413);
      const body = (await resOversized.json()) as { success: boolean; error: { code: string } };
      assert.equal(body.success, false);
      assert.equal(body.error?.code, "PAYLOAD_TOO_LARGE");
    });

    // 3. Accepted message: persists ingress, metadata, and processing_job before returning 200
    await t.test("persists accepted message with rich metadata and pending job atomically", async () => {
      const messageId = 10;
      const sentTimestamp = 1727601234;
      const update = makeUpdate(messageId, testerId, {
        date: sentTimestamp,
        text: "Internet rumah mati sejak pagi",
      });

      const req = makeWebhookRequest(update);
      const res = await handleTelegramWebhook(req, persistence, configOverrides);
      assert.equal(res.status, 200);

      const resBody = (await res.json()) as {
        success: boolean;
        data: { status: string; ingressId: string; duplicate: boolean };
      };
      assert.equal(resBody.success, true);
      assert.equal(resBody.data?.status, "accepted");
      assert.equal(resBody.data?.duplicate, false);
      assert.ok(resBody.data?.ingressId);

      // Verify ingress row in database
      const ingressRes = await pool.query(
        `select id, channel, account_id, chat_id, provider_message_id, body,
                message_type, has_media, is_forwarded, caption, sent_at, received_at, sender_info
         from public.ingress_events where id=$1`,
        [resBody.data.ingressId],
      );
      assert.equal(ingressRes.rowCount, 1);
      const ingress = ingressRes.rows[0];
      assert.equal(ingress.channel, "telegram");
      assert.equal(ingress.account_id, botAccountId);
      assert.equal(ingress.chat_id, testerId);
      assert.equal(ingress.provider_message_id, String(messageId));
      assert.equal(ingress.body, "Internet rumah mati sejak pagi");
      assert.equal(ingress.message_type, "text");
      assert.equal(ingress.has_media, false);
      assert.equal(ingress.is_forwarded, false);
      assert.equal(ingress.caption, null);
      assert.equal(new Date(ingress.sent_at).getTime(), sentTimestamp * 1000);
      assert.ok(ingress.received_at instanceof Date);
      // sent_at and received_at must be distinct
      assert.notEqual(new Date(ingress.sent_at).toISOString(), new Date(ingress.received_at).toISOString());
      assert.equal(ingress.sender_info?.firstName, "TesterName");
      assert.equal(ingress.sender_info?.username, "tester_user");

      // Verify processing_job row in database (status = 'pending')
      const jobRes = await pool.query(
        "select ingress_id, status from public.processing_jobs where ingress_id=$1",
        [resBody.data.ingressId],
      );
      assert.equal(jobRes.rowCount, 1);
      assert.equal(jobRes.rows[0].status, "pending");

      // Verify NO triage assessment or outbound intent exists on the ACK path
      const triageRes = await pool.query(
        "select count(*) from public.triage_assessments where message_id=$1",
        [resBody.data.ingressId],
      );
      assert.equal(triageRes.rows[0].count, "0");

      const intentRes = await pool.query(
        "select count(*) from public.outbound_intents where message_id=$1",
        [resBody.data.ingressId],
      );
      assert.equal(intentRes.rows[0].count, "0");
    });

    // 4. Sequential duplicate does not insert extra ingress/job and preserves metadata
    await t.test("sequential duplicate returns 200 with duplicate=true without modifying records", async () => {
      const messageId = 20;
      const update = makeUpdate(messageId, testerId, {
        date: 1727602000,
        text: "Pesan pertama yang asli",
      });

      // First call
      const res1 = await handleTelegramWebhook(makeWebhookRequest(update), persistence, configOverrides);
      assert.equal(res1.status, 200);
      const body1 = (await res1.json()) as { success: boolean; data: { ingressId: string; duplicate: boolean } };
      assert.equal(body1.data.duplicate, false);

      // Second call (duplicate with altered payload to verify original is preserved)
      const duplicateUpdate = makeUpdate(messageId, testerId, {
        date: 1727602000,
        text: "Mencoba menimpa pesan asli",
      });
      const res2 = await handleTelegramWebhook(
        makeWebhookRequest(duplicateUpdate),
        persistence,
        configOverrides,
      );
      assert.equal(res2.status, 200);
      const body2 = (await res2.json()) as { success: boolean; data: { ingressId: string; duplicate: boolean } };
      assert.equal(body2.data.duplicate, true);
      assert.equal(body2.data.ingressId, body1.data.ingressId);

      // Check DB: exactly 1 ingress row and body is still the original
      const rows = await pool.query(
        "select body from public.ingress_events where account_id=$1 and provider_message_id=$2",
        [botAccountId, String(messageId)],
      );
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].body, "Pesan pertama yang asli");

      // Check DB: exactly 1 job row
      const jobs = await pool.query(
        "select count(*) from public.processing_jobs where ingress_id=$1",
        [body1.data.ingressId],
      );
      assert.equal(jobs.rows[0].count, "1");
    });

    // 5. Parallel duplicate requests (race condition protection)
    await t.test("concurrent parallel requests produce exactly one ingress and one job", async () => {
      const messageId = 30;
      const update = makeUpdate(messageId, testerId, {
        date: 1727603000,
        text: "Laporan concurrent race test",
      });

      // 5 concurrent requests with identical message
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          handleTelegramWebhook(makeWebhookRequest(update), persistence, configOverrides),
        ),
      );

      for (const res of responses) {
        assert.equal(res.status, 200);
      }

      const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
        success: boolean;
        data: { ingressId: string; duplicate: boolean };
      }>;

      // Exactly 1 request sees duplicate: false, 4 see duplicate: true
      const firstTime = bodies.filter((b) => !b.data.duplicate);
      const duplicates = bodies.filter((b) => b.data.duplicate);
      assert.equal(firstTime.length, 1);
      assert.equal(duplicates.length, 4);

      // All share the same ingressId
      const allIds = new Set(bodies.map((b) => b.data.ingressId));
      assert.equal(allIds.size, 1);
      const ingressId = bodies[0].data.ingressId;

      // Exactly 1 row in ingress_events and 1 in processing_jobs
      const ingressCount = (
        await pool.query("select count(*) from public.ingress_events where id=$1", [ingressId])
      ).rows[0].count;
      assert.equal(ingressCount, "1");

      const jobCount = (
        await pool.query("select count(*) from public.processing_jobs where ingress_id=$1", [ingressId])
      ).rows[0].count;
      assert.equal(jobCount, "1");
    });

    // 6. Same message ID on different chat IDs or bot accounts are kept separate
    await t.test("same message_id on different chat or bot account are isolated", async () => {
      const sharedMessageId = 40;
      const updateTester1 = makeUpdate(sharedMessageId, testerId, { text: "Chat 1 message" });
      const updateTester2 = makeUpdate(sharedMessageId, otherTesterId, { text: "Chat 2 message" });

      const res1 = await handleTelegramWebhook(
        makeWebhookRequest(updateTester1),
        persistence,
        configOverrides,
      );
      const res2 = await handleTelegramWebhook(
        makeWebhookRequest(updateTester2),
        persistence,
        configOverrides,
      );
      assert.equal(res1.status, 200);
      assert.equal(res2.status, 200);

      const body1 = (await res1.json()) as { data: { ingressId: string; duplicate: boolean } };
      const body2 = (await res2.json()) as { data: { ingressId: string; duplicate: boolean } };

      assert.equal(body1.data.duplicate, false);
      assert.equal(body2.data.duplicate, false);
      assert.notEqual(body1.data.ingressId, body2.data.ingressId);

      // Also different bot account ID
      const otherAccount = "other-bot-" + tag;
      const resOtherAccount = await handleTelegramWebhook(
        makeWebhookRequest(updateTester1),
        persistence,
        { ...configOverrides, botAccountId: otherAccount },
      );
      assert.equal(resOtherAccount.status, 200);
      const bodyOtherAccount = (await resOtherAccount.json()) as {
        data: { ingressId: string; duplicate: boolean };
      };
      assert.equal(bodyOtherAccount.data.duplicate, false);
      assert.notEqual(bodyOtherAccount.data.ingressId, body1.data.ingressId);
    });

    // 7. Non-text messages maintain metadata without inventing customer text
    await t.test("photo without caption stores empty text and media metadata", async () => {
      const messageId = 50;
      const photoUpdate = makeUpdate(messageId, testerId, {
        text: undefined,
        caption: undefined,
        photo: [{ file_id: "photo_123", file_unique_id: "u123", width: 800, height: 600 }],
      });

      const res = await handleTelegramWebhook(
        makeWebhookRequest(photoUpdate),
        persistence,
        configOverrides,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { ingressId: string } };

      const row = (
        await pool.query(
          "select body, message_type, has_media, caption from public.ingress_events where id=$1",
          [body.data.ingressId],
        )
      ).rows[0];

      assert.equal(row.body, ""); // never invents text
      assert.equal(row.message_type, "photo");
      assert.equal(row.has_media, true);
      assert.equal(row.caption, null);
    });

    await t.test("photo with caption stores caption as text and in caption column", async () => {
      const messageId = 51;
      const photoCaptionUpdate = makeUpdate(messageId, testerId, {
        text: undefined,
        caption: "Foto modem lampu merah berkedip",
        photo: [{ file_id: "photo_456", file_unique_id: "u456", width: 800, height: 600 }],
      });

      const res = await handleTelegramWebhook(
        makeWebhookRequest(photoCaptionUpdate),
        persistence,
        configOverrides,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { ingressId: string } };

      const row = (
        await pool.query(
          "select body, message_type, has_media, caption from public.ingress_events where id=$1",
          [body.data.ingressId],
        )
      ).rows[0];

      assert.equal(row.body, "Foto modem lampu merah berkedip");
      assert.equal(row.message_type, "photo");
      assert.equal(row.has_media, true);
      assert.equal(row.caption, "Foto modem lampu merah berkedip");
    });

    // 8. Unsupported update and non-tester policy rejection: ACK 200, NO database records
    await t.test("unsupported updates and non-tester rejections return 200 without DB mutations", async () => {
      const beforeCount = (
        await pool.query("select count(*) from public.ingress_events where account_id=$1", [
          botAccountId,
        ])
      ).rows[0].count;

      // Non-tester
      const nonTesterUpdate = makeUpdate(60, nonTesterId, { text: "Saya bukan tester" });
      const resNonTester = await handleTelegramWebhook(
        makeWebhookRequest(nonTesterUpdate),
        persistence,
        configOverrides,
      );
      assert.equal(resNonTester.status, 200);
      const bodyNonTester = (await resNonTester.json()) as {
        success: boolean;
        data: { status: string; reason: string };
      };
      assert.equal(bodyNonTester.success, true);
      assert.equal(bodyNonTester.data.status, "rejected");
      assert.equal(bodyNonTester.data.reason, "not_in_tester_allowlist");

      // Edited message (unsupported)
      const editedUpdate: TelegramUpdate = {
        update_id: 200000,
        edited_message: {
          message_id: 61,
          date: 1727600000,
          chat: { id: Number(testerId), type: "private" },
          from: { id: Number(testerId), is_bot: false, first_name: "Tester" },
          text: "Pesan yang diedit",
        },
      };
      const resEdited = await handleTelegramWebhook(
        makeWebhookRequest(editedUpdate),
        persistence,
        configOverrides,
      );
      assert.equal(resEdited.status, 200);
      const bodyEdited = (await resEdited.json()) as {
        success: boolean;
        data: { status: string; reason: string };
      };
      assert.equal(bodyEdited.success, true);
      assert.equal(bodyEdited.data.status, "ignored");
      assert.equal(bodyEdited.data.reason, "edited_message_ignored");

      // Verify no extra rows
      const afterCount = (
        await pool.query("select count(*) from public.ingress_events where account_id=$1", [
          botAccountId,
        ])
      ).rows[0].count;
      assert.equal(afterCount, beforeCount);
    });

    // 9. Controlled fault injection during processing_jobs insert rolls back ingress+metadata completely, allowing idempotent retry
    await t.test("controlled fault injection rolls back ingress+metadata before commit, allowing retry", async () => {
      let failProcessingJob = true;
      const faultInjectingPool = {
        async connect() {
          const client = await pool.connect();
          const originalQuery = client.query.bind(client);
          // @ts-expect-error wrapping client query for targeted test fault injection
          client.query = async function (
            queryTextOrConfig: string | { text: string },
            values?: unknown[],
          ) {
            const q = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig?.text ?? "";
            if (failProcessingJob && q.includes("processing_jobs")) {
              throw new Error("Simulated database failure during processing_jobs insert");
            }
            return (originalQuery as (...args: unknown[]) => unknown)(queryTextOrConfig, values);
          };
          return client;
        },
        query(...args: unknown[]) {
          return (pool.query as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as Pool;

      const faultPersistence = new HelpdeskPersistence(faultInjectingPool);
      const rollbackMessageId = 70;
      const rollbackUpdate = makeUpdate(rollbackMessageId, testerId, {
        date: 1727607000,
        text: "Pesan uji rollback transaksi",
      });

      // 1. Send valid message while failure is active
      const resFailed = await handleTelegramWebhook(
        makeWebhookRequest(rollbackUpdate),
        faultPersistence,
        configOverrides,
      );
      assert.equal(resFailed.status, 500);
      const bodyFailed = (await resFailed.json()) as { success: boolean; error: { code: string } };
      assert.equal(bodyFailed.success, false);
      assert.equal(bodyFailed.error?.code, "PERSISTENCE_FAILED");

      // 2. Query via independent connection: verify NO partial ingress or metadata was committed
      const uncommittedRows = await pool.query(
        "select count(*) from public.ingress_events where account_id=$1 and provider_message_id=$2",
        [botAccountId, String(rollbackMessageId)],
      );
      assert.equal(uncommittedRows.rows[0].count, "0");

      // 3. Release fault injection and resend the exact same message
      failProcessingJob = false;
      const resRetry = await handleTelegramWebhook(
        makeWebhookRequest(rollbackUpdate),
        faultPersistence,
        configOverrides,
      );
      assert.equal(resRetry.status, 200);
      const bodyRetry = (await resRetry.json()) as {
        success: boolean;
        data: { status: string; ingressId: string; duplicate: boolean };
      };
      assert.equal(bodyRetry.success, true);
      assert.equal(bodyRetry.data?.status, "accepted");
      assert.equal(bodyRetry.data?.duplicate, false);

      // Verify exactly 1 ingress row and 1 job row now committed in DB
      const committedIngress = await pool.query(
        "select count(*) from public.ingress_events where account_id=$1 and provider_message_id=$2",
        [botAccountId, String(rollbackMessageId)],
      );
      assert.equal(committedIngress.rows[0].count, "1");

      const committedJob = await pool.query(
        "select count(*) from public.processing_jobs where ingress_id=$1",
        [bodyRetry.data.ingressId],
      );
      assert.equal(committedJob.rows[0].count, "1");

      // 4. Send duplicate: must not add rows or alter committed data
      const resDuplicate = await handleTelegramWebhook(
        makeWebhookRequest(rollbackUpdate),
        faultPersistence,
        configOverrides,
      );
      assert.equal(resDuplicate.status, 200);
      const bodyDuplicate = (await resDuplicate.json()) as {
        success: boolean;
        data: { status: string; ingressId: string; duplicate: boolean };
      };
      assert.equal(bodyDuplicate.success, true);
      assert.equal(bodyDuplicate.data?.status, "accepted");
      assert.equal(bodyDuplicate.data?.duplicate, true);
      assert.equal(bodyDuplicate.data?.ingressId, bodyRetry.data.ingressId);

      const afterDupIngress = await pool.query(
        "select count(*) from public.ingress_events where account_id=$1 and provider_message_id=$2",
        [botAccountId, String(rollbackMessageId)],
      );
      assert.equal(afterDupIngress.rows[0].count, "1");

      const afterDupJob = await pool.query(
        "select count(*) from public.processing_jobs where ingress_id=$1",
        [bodyRetry.data.ingressId],
      );
      assert.equal(afterDupJob.rows[0].count, "1");
    });
  } finally {
    // Clean up test data for this tag
    try {
      const ingressIds = (
        await pool.query("select id from public.ingress_events where account_id like $1", [
          "%" + tag + "%",
        ])
      ).rows.map((r) => r.id);

      if (ingressIds.length > 0) {
        await pool.query("delete from public.processing_jobs where ingress_id = any($1)", [
          ingressIds,
        ]);
        await pool.query("delete from public.ingress_events where id = any($1)", [ingressIds]);
      }
    } finally {
      await pool.end();
    }
  }
});
