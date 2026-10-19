import "../utils/setup-node-env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
import {
  buildOutboundSendRequest,
  type OutboundSendRequest,
} from "../../lib/adapters/channel-adapter-contracts";
import { TelegramChannelAdapter } from "../../lib/adapters/telegram/telegram-adapter";

test("P3.3 Integration: Outbound Telegram sending via ChannelAdapter over loopback HTTP & isolated DB", async (t) => {
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
  const botAccountId = `bot-p33-${runId}`;
  const testBotToken = `token-p33-${runId}`;

  // Unique positive safe integer Telegram IDs for test senders
  const baseTelegramNum = 88300000 + Math.floor(Math.random() * 100000);
  const senderExt = (n: number) => String(baseTelegramNum + n);
  const allowlist = Array.from({ length: 10 }, (_, i) => senderExt(i + 1));

  let staffUserId = "";
  const persistence = new HelpdeskPersistence(pool);

  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];

  let originalSettings: { mode: string; emergency_stop: boolean; version: number } | null = null;

  // Telegram SendMessage JSON payload structure
  interface TelegramSendMessageBody {
    chat_id?: string | number;
    text?: string;
    [key: string]: unknown;
  }

  type LoopbackParsedBody = TelegramSendMessageBody | string | null;

  // Real Node.js HTTP loopback server to simulate Telegram Bot API
  const receivedRequests: {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: LoopbackParsedBody;
  }[] = [];

  let serverBehavior: (
    req: http.IncomingMessage,
    body: LoopbackParsedBody,
  ) => Promise<{
    status: number;
    headers?: Record<string, string>;
    body: unknown;
    delayMs?: number;
  }> = async (_req, body) => {
    const chatNum =
      typeof body === "object" && body !== null && body.chat_id !== undefined
        ? Number(body.chat_id)
        : 0;
    const textVal =
      typeof body === "object" && body !== null && typeof body.text === "string"
        ? body.text
        : "";

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        ok: true,
        result: {
          message_id: 991122,
          date: 1729345000,
          chat: { id: chatNum, type: "private" },
          text: textVal,
        },
      },
    };
  };

  const server = http.createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", async () => {
      let parsedBody: LoopbackParsedBody = null;
      try {
        parsedBody = JSON.parse(rawBody) as TelegramSendMessageBody;
      } catch {
        parsedBody = rawBody;
      }
      receivedRequests.push({
        method: req.method ?? "UNKNOWN",
        url: req.url ?? "/",
        headers: req.headers,
        body: parsedBody,
      });

      try {
        const result = await serverBehavior(req, parsedBody);
        if (result.delayMs && result.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, result.delayMs));
        }
        res.writeHead(result.status, {
          "Content-Type": "application/json",
          ...(result.headers ?? {}),
        });
        res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: 500, description: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const serverPort = (server.address() as AddressInfo).port;
  const loopbackApiBaseUrl = `http://127.0.0.1:${serverPort}`;

  // TelegramChannelAdapter configured to point to our loopback server
  const adapter = new TelegramChannelAdapter({
    botAccountId,
    testerAllowlist: allowlist,
    botToken: testBotToken,
    apiBaseUrl: loopbackApiBaseUrl,
    defaultSendTimeoutMs: 5000,
  });

  try {
    // 1. Guard check: isolated test database required
    await requireIsolatedDatabase(pool, supabase, config);

    // 2. Run pending test migrations
    await runTestMigrations();

    // 3. Save original automation settings
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean; version: number }>(
      "SELECT mode, emergency_stop, version FROM public.automation_settings WHERE singleton",
    );
    if (settingsRes.rows[0]) {
      originalSettings = settingsRes.rows[0];
    }

    // 4. Create test staff user
    const staffEmail = `staff-p33-${runId}@example.com`;
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: staffEmail,
      password: "password123!",
      email_confirm: true,
    });
    assert.ifError(userError);
    assert.ok(userData.user);
    staffUserId = userData.user.id;

    // Helper: set automation mode
    async function setMode(mode: "SHADOW" | "LOS_AND_GENERIC" | "FULL", emergencyStop = false) {
      await pool.query(
        "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2, version = version + 1 WHERE singleton",
        [mode, emergencyStop],
      );
    }

    // Helper: get current episode version
    async function getEpisodeVersion(epId: string): Promise<number> {
      const res = await pool.query<{ version: number }>(
        "SELECT version FROM public.complaints WHERE id = $1",
        [epId],
      );
      assert.ok(res.rows[0], `Episode ${epId} not found`);
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
        [custId, `CUST-${runId}-${index}`, `Customer ${index} ${runId}`],
      );
      await pool.query(
        "INSERT INTO public.services (id, customer_id, service_code, status) VALUES ($1, $2, $3, 'active')",
        [srvId, custId, `SRV-${runId}-${index}`],
      );
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at)
         VALUES ($1, 'telegram', $2, $3, $4, 'verified', now())`,
        [identId, botAccountId, senderExternalId, custId],
      );

      return { custId, srvId, identId, senderExt: senderExternalId };
    }

    // =========================================================================
    // Scenario 1: Automatic Reply End-to-End via Loopback Telegram API
    // =========================================================================
    let autoIntentId = "";
    let episodeId = "";

    await t.test("1. Automatic Reply End-to-End via Loopback Telegram API", async () => {
      await setMode("LOS_AND_GENERIC", false);
      const cust1 = await createCustomerFixture(1, senderExt(1));

      const receipt: InboundReceipt = {
        sender: {
          channel: "telegram",
          channelAccountId: botAccountId,
          senderExternalId: cust1.senderExt,
        },
        chatId: cust1.senderExt,
        providerMessageId: `msg-p33-auto-${runId}`,
        text: "Internet saya mati lampu LOS merah berkedip",
        metadata: { messageType: "text", hasMedia: false, isForwarded: false },
      };

      const recv = await persistence.receive(receipt);
      tracker.recordIngress(recv.ingressId);

      const proc = await persistence.process(recv.ingressId);
      assert.ok(proc.episodeId);
      episodeId = proc.episodeId;
      assert.equal(proc.claim.outcome, "reserved");

      // Inbound processing strictly does NOT authorize dispatch
      assert.equal(proc.dispatchAuthorized, false);

      // Verify pending outbound intent created
      const intentRes = await pool.query<{ id: string; status: string; body: string }>(
        "SELECT id, status, body FROM public.outbound_intents WHERE complaint_id = $1 AND origin = 'automatic'",
        [proc.episodeId],
      );
      assert.equal(intentRes.rows.length, 1);
      assert.equal(intentRes.rows[0].status, "pending");
      assert.ok(intentRes.rows[0].body.startsWith(`${SIMULATION_PREFIX} `));
      autoIntentId = intentRes.rows[0].id;

      // P3.2: Evaluate pre-dispatch gate
      const gateRes = await persistence.evaluateDispatchGate(autoIntentId, { testerAllowlist: allowlist });
      assert.equal(gateRes.outcome, "authorized");
      assert.equal(gateRes.dispatchAuthorized, true);

      // Map gate result to OutboundSendRequest via P3.3 helper
      const sendReq = buildOutboundSendRequest(gateRes, { timeoutMs: 4000 });
      assert.equal(sendReq.origin, "automatic");
      assert.equal(sendReq.intentId, autoIntentId);
      assert.equal(sendReq.dispatchAuthorized, true);
      assert.equal(sendReq.chatId, cust1.senderExt);
      assert.equal(sendReq.senderExternalId, cust1.senderExt);
      assert.equal(sendReq.text, intentRes.rows[0].body);

      // Reset loopback request recorder
      receivedRequests.length = 0;

      // P3.3: Execute outbound dispatch via TelegramChannelAdapter
      const sendRes = await adapter.sendOutbound(sendReq);

      // Assertions on adapter result
      assert.equal(sendRes.outcome, "accepted");
      if (sendRes.outcome === "accepted") {
        assert.equal(sendRes.deliveryStatus, "provider_accepted");
        assert.equal(sendRes.readByRecipient, false); // PRD §11 FR-16
        assert.equal(sendRes.httpDispatched, true);
        assert.equal(sendRes.retryable, false);
        assert.equal(sendRes.providerMessageId, "991122");
        assert.equal(sendRes.httpStatus, 200);
        assert.ok(sendRes.providerAcceptedAt);
      }

      // Assertions on loopback HTTP server traffic
      assert.equal(receivedRequests.length, 1);
      const req = receivedRequests[0];
      assert.equal(req.method, "POST");
      assert.equal(req.url, `/bot${testBotToken}/sendMessage`);
      assert.equal(req.headers["content-type"], "application/json");
      assert.ok(typeof req.body === "object" && req.body !== null);
      const reqBody = req.body as TelegramSendMessageBody;
      assert.equal(reqBody.chat_id, cust1.senderExt);
      assert.equal(reqBody.text, intentRes.rows[0].body);
      assert.ok(reqBody.text?.startsWith(`${SIMULATION_PREFIX} `));
    });

    // =========================================================================
    // Scenario 2: Staff Manual Reply End-to-End via Same Adapter Path
    // =========================================================================
    let staffIntentId = "";

    await t.test("2. Staff Manual Reply End-to-End via Same Adapter Path", async () => {
      // Configure custom response for staff reply on loopback server
      serverBehavior = async (_req, body) => {
        const chatNum =
          typeof body === "object" && body !== null && body.chat_id !== undefined
            ? Number(body.chat_id)
            : 0;
        const textVal =
          typeof body === "object" && body !== null && typeof body.text === "string"
            ? body.text
            : "";

        return {
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: {
            ok: true,
            result: {
              message_id: 991123,
              date: 1729345200,
              chat: { id: chatNum, type: "private" },
              text: textVal,
            },
          },
        };
      };

      // Staff sends manual reply on existing episode
      const currentVer = await getEpisodeVersion(episodeId);
      const staffReplyRes = await persistence.staffAction(staffUserId, {
        requestId: randomUUID(),
        episodeId,
        expectedVersion: currentVer,
        action: "manual_reply",
        body: "Teknisi lapangan kami sedang menuju lokasi ODP Anda.",
      });

      assert.equal(staffReplyRes.result.outcome, "accepted");
      assert.ok(staffReplyRes.manualIntentId);
      staffIntentId = staffReplyRes.manualIntentId;

      // P3.2: Evaluate pre-dispatch gate for staff reply
      const staffGateRes = await persistence.evaluateDispatchGate(staffIntentId, { testerAllowlist: allowlist });
      assert.equal(staffGateRes.outcome, "authorized");
      assert.equal(staffGateRes.dispatchAuthorized, true);

      // Map to OutboundSendRequest
      const staffSendReq = buildOutboundSendRequest(staffGateRes);
      assert.equal(staffSendReq.origin, "staff");
      assert.equal(staffSendReq.intentId, staffIntentId);
      assert.equal(staffSendReq.dispatchAuthorized, true);
      assert.ok(staffSendReq.text.startsWith(`${SIMULATION_PREFIX} `));

      // Reset recorder
      receivedRequests.length = 0;

      // P3.3: Dispatch staff reply via the EXACT SAME adapter method
      const staffSendRes = await adapter.sendOutbound(staffSendReq);

      assert.equal(staffSendRes.outcome, "accepted");
      if (staffSendRes.outcome === "accepted") {
        assert.equal(staffSendRes.deliveryStatus, "provider_accepted");
        assert.equal(staffSendRes.readByRecipient, false); // PRD §11 FR-16
        assert.equal(staffSendRes.httpDispatched, true);
        assert.equal(staffSendRes.providerMessageId, "991123");
        assert.equal(staffSendRes.httpStatus, 200);
      }

      // Verify loopback server received staff message
      assert.equal(receivedRequests.length, 1);
      assert.equal(receivedRequests[0].url, `/bot${testBotToken}/sendMessage`);
      assert.ok(typeof receivedRequests[0].body === "object" && receivedRequests[0].body !== null);
      const staffReqBody = receivedRequests[0].body as TelegramSendMessageBody;
      assert.equal(staffReqBody.chat_id, senderExt(1));
      assert.equal(staffReqBody.text, staffSendReq.text);
    });

    // =========================================================================
    // Scenario 3: Pre-Flight Rejection (Non-Tester & Missing Prefix) Zero HTTP Traffic
    // =========================================================================
    await t.test("3. Pre-Flight Rejections produce zero HTTP loopback traffic", async () => {
      receivedRequests.length = 0;

      // 3.1 Non-tester recipient
      const nonTesterReq: OutboundSendRequest = {
        intentId: randomUUID(),
        origin: "automatic",
        dispatchAuthorized: true,
        channel: "telegram",
        channelAccountId: botAccountId,
        chatId: "99999999", // not in allowlist
        senderExternalId: "99999999",
        text: `${SIMULATION_PREFIX} Pesan untuk non tester`,
      };

      const nonTesterRes = await adapter.sendOutbound(nonTesterReq);
      assert.equal(nonTesterRes.outcome, "failed_permanent");
      if (nonTesterRes.outcome === "failed_permanent") {
        assert.equal(nonTesterRes.httpDispatched, false);
        assert.equal(nonTesterRes.retryable, false);
        assert.equal(nonTesterRes.reason, "not_in_tester_allowlist");
      }

      // 3.2 Missing simulation prefix
      const noPrefixReq: OutboundSendRequest = {
        intentId: randomUUID(),
        origin: "staff",
        dispatchAuthorized: true,
        channel: "telegram",
        channelAccountId: botAccountId,
        chatId: senderExt(1),
        senderExternalId: senderExt(1),
        text: "Pesan tanpa prefix simulasi",
      };

      const noPrefixRes = await adapter.sendOutbound(noPrefixReq);
      assert.equal(noPrefixRes.outcome, "failed_permanent");
      if (noPrefixRes.outcome === "failed_permanent") {
        assert.equal(noPrefixRes.httpDispatched, false);
        assert.equal(noPrefixRes.retryable, false);
        assert.equal(noPrefixRes.reason, "missing_simulation_prefix");
      }

      // Verify zero HTTP traffic arrived at loopback server
      assert.equal(receivedRequests.length, 0, "Loopback server must record exactly 0 incoming HTTP requests for pre-flight rejections");
    });

    // =========================================================================
    // Scenario 4: Definite Retryable (429), Definite Permanent (403), and Ambiguous Timeout (unknown)
    // =========================================================================
    await t.test("4. Definite Retryable (429), Definite Permanent (403), and Ambiguous Timeout (unknown) over Real Loopback HTTP", async () => {
      const validReq: OutboundSendRequest = {
        intentId: randomUUID(),
        origin: "automatic",
        dispatchAuthorized: true,
        channel: "telegram",
        channelAccountId: botAccountId,
        chatId: senderExt(1),
        senderExternalId: senderExt(1),
        text: `${SIMULATION_PREFIX} Pesan pengujian error`,
      };

      // 4.1 Definite Retryable: HTTP 429 with parameters.retry_after = 7
      serverBehavior = async () => ({
        status: 429,
        body: {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 7",
          parameters: { retry_after: 7 },
        },
      });

      const res429 = await adapter.sendOutbound(validReq);
      assert.equal(res429.outcome, "failed_retryable");
      if (res429.outcome === "failed_retryable") {
        assert.equal(res429.httpDispatched, true);
        assert.equal(res429.retryable, true);
        assert.equal(res429.reason, "rate_limited");
        assert.equal(res429.httpStatus, 429);
        assert.equal(res429.retryAfterMs, 7000);
      }

      // 4.2 Definite Permanent: HTTP 403 Forbidden
      serverBehavior = async () => ({
        status: 403,
        body: {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was blocked by the user",
        },
      });

      const res403 = await adapter.sendOutbound(validReq);
      assert.equal(res403.outcome, "failed_permanent");
      if (res403.outcome === "failed_permanent") {
        assert.equal(res403.httpDispatched, true);
        assert.equal(res403.retryable, false);
        assert.equal(res403.reason, "provider_rejected_permanent");
        assert.equal(res403.httpStatus, 403);
      }

      // 4.3 Ambiguous Timeout: Server holds request for 250ms, adapter configured with timeoutMs = 80ms
      serverBehavior = async () => ({
        status: 200,
        delayMs: 250,
        body: { ok: true, result: { message_id: 111 } },
      });

      const timeoutReq: OutboundSendRequest = {
        ...validReq,
        timeoutMs: 80,
      };

      const resTimeout = await adapter.sendOutbound(timeoutReq);
      assert.equal(resTimeout.outcome, "unknown");
      if (resTimeout.outcome === "unknown") {
        assert.equal(resTimeout.httpDispatched, true);
        assert.equal(resTimeout.retryable, false); // PRD §11 FR-16: Never retry blind
        assert.equal(resTimeout.reason, "timeout_after_dispatch");
        assert.equal(resTimeout.httpStatus, null);
        assert.ok(!resTimeout.errorMessage.includes(testBotToken), "Bot token must not leak in timeout errorMessage");
      }
    });

  } catch (err) {
    primaryError = err as Error;
  } finally {
    // Teardown HTTP loopback server
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // Restore original settings
    if (originalSettings) {
      try {
        await pool.query(
          "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2, version = $3 WHERE singleton",
          [originalSettings.mode, originalSettings.emergency_stop, originalSettings.version],
        );
      } catch (err) {
        cleanupErrors.push(err as Error);
      }
    }

    // Clean reply_claims and reply_owners for test customers and identities
    try {
      const allCustIds = tracker.customerIds;
      const allIdentIds = tracker.identityIds;
      if (allCustIds.length > 0 || allIdentIds.length > 0) {
        await pool.query(
          `DELETE FROM public.reply_claims WHERE owner_id IN (
             SELECT id FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])
           )`,
          [allCustIds, allIdentIds],
        );
        await pool.query(
          `DELETE FROM public.outbound_intents WHERE owner_id IN (
             SELECT id FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])
           )`,
          [allCustIds, allIdentIds],
        );
        await pool.query(
          "DELETE FROM public.reply_owners WHERE customer_id = ANY($1::uuid[]) OR identity_id = ANY($2::uuid[])",
          [allCustIds, allIdentIds],
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // Clean fixture tracked resources
    try {
      await cleanupFixture(pool, tracker);
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // Delete test staff user and commands/audit logs
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

    // Residue verification query
    try {
      const allTestCustomerIds = tracker.customerIds;
      const allTestServiceIds = tracker.serviceIds;
      const allTestIdentityIds = tracker.identityIds;
      const allTestIngressIds = tracker.ingressIds;

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
      `, [
        allTestCustomerIds,
        allTestServiceIds,
        allTestIdentityIds,
        allTestIngressIds,
      ]);

      const lingering = residualCheck.rows.filter((r) => Number(r.count) > 0);
      if (lingering.length > 0) {
        cleanupErrors.push(
          new Error(`Residual test fixtures detected: ${lingering.map((r) => `${r.table_name}=${r.count}`).join(", ")}`),
        );
      }
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    // End pool & restore env
    try {
      await pool.end();
    } catch (err) {
      cleanupErrors.push(err as Error);
    }

    restorer.restore();

    // Combine errors
    const finalError = combineErrors(primaryError, cleanupErrors);
    if (finalError) {
      throw finalError;
    }
  }
});
