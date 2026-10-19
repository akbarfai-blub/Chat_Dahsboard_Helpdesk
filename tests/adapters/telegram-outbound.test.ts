import test from "node:test";
import assert from "node:assert/strict";
import {
  TelegramChannelAdapter,
  redactTelegramBotToken,
  DEFAULT_TELEGRAM_API_BASE_URL,
} from "../../lib/adapters/telegram/telegram-adapter";
import {
  buildOutboundSendRequest,
  type OutboundSendRequest,
} from "../../lib/adapters/channel-adapter-contracts";
import type { PreDispatchAuthorizedResult } from "../../lib/domain/dispatch-contracts";
import { SIMULATION_PREFIX } from "../../lib/domain/template-contracts";

const BOT_ACCOUNT_ID = "upaznet_helpdesk_bot";
const TESTER_ID = "6727338166";
const TESTER_ID_2 = "987654321";
const BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ";

function createAuthorizedResult(
  overrides: Partial<PreDispatchAuthorizedResult> = {},
): PreDispatchAuthorizedResult {
  return {
    ruleVersion: "pre-dispatch-gate-v1",
    outcome: "authorized",
    dispatchAuthorized: true,
    intentId: "intent-123",
    origin: "automatic",
    channel: "telegram",
    channelAccountId: BOT_ACCOUNT_ID,
    chatId: TESTER_ID,
    senderExternalId: TESTER_ID,
    outboundText: `${SIMULATION_PREFIX} Halo tester, jaringan sedang dalam perbaikan.`,
    effectiveMode: "LOS_AND_GENERIC",
    authorizedIncidentId: null,
    authorizedIncidentVersion: null,
    evaluatedAt: new Date().toISOString(),
    blockedReasons: [],
    shouldCancelIntent: false,
    ...overrides,
  };
}

function createOutboundRequest(
  overrides: Partial<OutboundSendRequest> = {},
): OutboundSendRequest {
  return {
    intentId: "intent-123",
    origin: "automatic",
    dispatchAuthorized: true,
    channel: "telegram",
    channelAccountId: BOT_ACCOUNT_ID,
    chatId: TESTER_ID,
    senderExternalId: TESTER_ID,
    text: `${SIMULATION_PREFIX} Halo tester, jaringan sedang dalam perbaikan.`,
    ...overrides,
  };
}

test("buildOutboundSendRequest maps PreDispatchAuthorizedResult to OutboundSendRequest uniformly", () => {
  // Automatic
  const autoAuth = createAuthorizedResult({ origin: "automatic" });
  const autoReq = buildOutboundSendRequest(autoAuth, { timeoutMs: 5000 });
  assert.equal(autoReq.intentId, "intent-123");
  assert.equal(autoReq.origin, "automatic");
  assert.equal(autoReq.dispatchAuthorized, true);
  assert.equal(autoReq.channel, "telegram");
  assert.equal(autoReq.channelAccountId, BOT_ACCOUNT_ID);
  assert.equal(autoReq.chatId, TESTER_ID);
  assert.equal(autoReq.senderExternalId, TESTER_ID);
  assert.equal(autoReq.text, autoAuth.outboundText);
  assert.equal(autoReq.timeoutMs, 5000);

  // Staff
  const staffAuth = createAuthorizedResult({ origin: "staff", intentId: "intent-staff-456" });
  const staffReq = buildOutboundSendRequest(staffAuth);
  assert.equal(staffReq.origin, "staff");
  assert.equal(staffReq.intentId, "intent-staff-456");
  assert.equal(staffReq.timeoutMs, undefined);
});

test("redactTelegramBotToken scrubs bot tokens and URL patterns", () => {
  // Literal token
  const msg1 = `Failed to connect with token ${BOT_TOKEN} to server`;
  const red1 = redactTelegramBotToken(msg1, BOT_TOKEN);
  assert.ok(!red1.includes(BOT_TOKEN));
  assert.ok(red1.includes("[REDACTED]"));

  // URL pattern
  const msg2 = "Error at https://api.telegram.org/bot999888777:SecretStringGoesHere/sendMessage";
  const red2 = redactTelegramBotToken(msg2);
  assert.ok(!red2.includes("SecretStringGoesHere"));
  assert.ok(red2.includes("/bot[REDACTED]/sendMessage"));

  // Truncation to 500 chars
  const longMsg = "x".repeat(600);
  assert.equal(redactTelegramBotToken(longMsg).length, 500);

  // Safe with null/empty
  assert.equal(redactTelegramBotToken(""), "");
  assert.equal(redactTelegramBotToken(null as unknown as string), "");
});

test("TelegramChannelAdapter sendOutbound happy path for automatic and staff replies", async () => {
  const dispatchedCalls: { url: string; init: RequestInit }[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    dispatchedCalls.push({ url: String(input), init: init! });
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          message_id: 884422,
          date: 1729340000,
          chat: { id: Number(TESTER_ID), type: "private" },
          text: "echo",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const adapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID, TESTER_ID_2],
    botToken: BOT_TOKEN,
    fetchImpl: mockFetch,
  });

  // 1. Automatic reply
  const autoReq = createOutboundRequest({ origin: "automatic" });
  const autoRes = await adapter.sendOutbound(autoReq);

  assert.equal(autoRes.outcome, "accepted");
  if (autoRes.outcome === "accepted") {
    assert.equal(autoRes.deliveryStatus, "provider_accepted");
    assert.equal(autoRes.readByRecipient, false); // PRD §11 FR-16: Never claims read
    assert.equal(autoRes.httpDispatched, true);
    assert.equal(autoRes.retryable, false);
    assert.equal(autoRes.providerMessageId, "884422");
    assert.equal(autoRes.httpStatus, 200);
    assert.equal(autoRes.providerAcceptedAt, new Date(1729340000 * 1000).toISOString());
  }

  // 2. Staff manual reply
  const staffReq = createOutboundRequest({
    origin: "staff",
    text: `${SIMULATION_PREFIX} Halo, ini pesan langsung dari staf teknis Upaznet.`,
  });
  const staffRes = await adapter.sendOutbound(staffReq);

  assert.equal(staffRes.outcome, "accepted");
  if (staffRes.outcome === "accepted") {
    assert.equal(staffRes.deliveryStatus, "provider_accepted");
    assert.equal(staffRes.readByRecipient, false);
    assert.equal(staffRes.providerMessageId, "884422");
  }

  // Verify HTTP calls
  assert.equal(dispatchedCalls.length, 2);
  for (const call of dispatchedCalls) {
    assert.equal(call.url, `${DEFAULT_TELEGRAM_API_BASE_URL}/bot${BOT_TOKEN}/sendMessage`);
    assert.equal(call.init.method, "POST");
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.chat_id, TESTER_ID);
    assert.ok(body.text.startsWith(`${SIMULATION_PREFIX} `));
  }
});

test("Pre-flight safety guards fail permanently with zero HTTP fetch calls", async () => {
  let fetchCallCount = 0;
  const mockFetch: typeof fetch = async () => {
    fetchCallCount++;
    throw new Error("Fetch should NOT be called on pre-flight rejection");
  };

  const adapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: mockFetch,
  });

  const testCases: {
    name: string;
    request: OutboundSendRequest;
    expectedReason: string;
    adapterOverride?: TelegramChannelAdapter;
  }[] = [
    {
      name: "missing pre-dispatch authorization",
      request: createOutboundRequest({ dispatchAuthorized: false as unknown as true }),
      expectedReason: "dispatch_not_authorized",
    },
    {
      name: "invalid origin (internal note)",
      request: createOutboundRequest({ origin: "internal_note" as unknown as "automatic" }),
      expectedReason: "invalid_origin",
    },
    {
      name: "unsupported channel",
      request: createOutboundRequest({ channel: "whatsapp" }),
      expectedReason: "unsupported_channel",
    },
    {
      name: "account mismatch",
      request: createOutboundRequest({ channelAccountId: "other_bot_account" }),
      expectedReason: "account_mismatch",
    },
    {
      name: "empty tester allowlist",
      request: createOutboundRequest(),
      expectedReason: "empty_tester_allowlist",
      adapterOverride: new TelegramChannelAdapter({
        botAccountId: BOT_ACCOUNT_ID,
        testerAllowlist: [],
        botToken: BOT_TOKEN,
        fetchImpl: mockFetch,
      }),
    },
    {
      name: "non-private chat (negative chat ID / group)",
      request: createOutboundRequest({ chatId: "-10012345678", senderExternalId: "-10012345678" }),
      expectedReason: "non_private_chat",
    },
    {
      name: "non-private chat (chatId !== senderExternalId)",
      request: createOutboundRequest({ chatId: TESTER_ID, senderExternalId: TESTER_ID_2 }),
      expectedReason: "non_private_chat",
    },
    {
      name: "not in tester allowlist",
      request: createOutboundRequest({ chatId: "99999999", senderExternalId: "99999999" }),
      expectedReason: "not_in_tester_allowlist",
    },
    {
      name: "empty message body",
      request: createOutboundRequest({ text: "   " }),
      expectedReason: "empty_message_body",
    },
    {
      name: "missing simulation prefix",
      request: createOutboundRequest({ text: "Halo ini pesan tanpa prefix" }),
      expectedReason: "missing_simulation_prefix",
    },
    {
      name: "prefix only with empty body",
      request: createOutboundRequest({ text: `${SIMULATION_PREFIX}   ` }),
      expectedReason: "empty_message_body",
    },
    {
      name: "duplicate simulation prefix",
      request: createOutboundRequest({ text: `${SIMULATION_PREFIX} ${SIMULATION_PREFIX} Pesan dobel` }),
      expectedReason: "invalid_outbound_body",
    },
    {
      name: "text too long (> 4096 chars)",
      request: createOutboundRequest({ text: `${SIMULATION_PREFIX} ` + "a".repeat(4100) }),
      expectedReason: "text_too_long",
    },
    {
      name: "missing bot token",
      request: createOutboundRequest(),
      expectedReason: "missing_bot_token",
      adapterOverride: new TelegramChannelAdapter({
        botAccountId: BOT_ACCOUNT_ID,
        testerAllowlist: [TESTER_ID],
        botToken: "", // empty
        fetchImpl: mockFetch,
      }),
    },
  ];

  for (const tc of testCases) {
    const activeAdapter = tc.adapterOverride ?? adapter;
    const res = await activeAdapter.sendOutbound(tc.request);

    assert.equal(res.outcome, "failed_permanent", `Test case '${tc.name}' outcome mismatch`);
    if (res.outcome === "failed_permanent") {
      assert.equal(res.httpDispatched, false, `Test case '${tc.name}' should have httpDispatched: false`);
      assert.equal(res.retryable, false, `Test case '${tc.name}' should have retryable: false`);
      assert.equal(res.reason, tc.expectedReason, `Test case '${tc.name}' reason mismatch`);
      assert.equal(res.httpStatus, null);
      assert.equal(res.providerErrorCode, null);
    }
  }

  assert.equal(fetchCallCount, 0, "Zero HTTP calls must be made when pre-flight checks fail");
});

test("HTTP 429 Rate Limited extracts retryAfterMs from parameters or header", async () => {
  // 1. From JSON parameters.retry_after
  const adapterWithJson429 = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 5",
          parameters: { retry_after: 5 },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
  });

  const res1 = await adapterWithJson429.sendOutbound(createOutboundRequest());
  assert.equal(res1.outcome, "failed_retryable");
  if (res1.outcome === "failed_retryable") {
    assert.equal(res1.httpDispatched, true);
    assert.equal(res1.retryable, true);
    assert.equal(res1.reason, "rate_limited");
    assert.equal(res1.httpStatus, 429);
    assert.equal(res1.retryAfterMs, 5000);
  }

  // 2. From Retry-After header fallback
  const adapterWithHeader429 = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests" }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "8" } },
      ),
  });

  const res2 = await adapterWithHeader429.sendOutbound(createOutboundRequest());
  assert.equal(res2.outcome, "failed_retryable");
  if (res2.outcome === "failed_retryable") {
    assert.equal(res2.retryAfterMs, 8000);
  }
});

test("HTTP 5xx Server Errors are classified as failed_retryable", async () => {
  for (const status of [500, 502, 503, 504]) {
    const adapter = new TelegramChannelAdapter({
      botAccountId: BOT_ACCOUNT_ID,
      testerAllowlist: [TESTER_ID],
      botToken: BOT_TOKEN,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ ok: false, error_code: status, description: "Bad Gateway" }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
    });

    const res = await adapter.sendOutbound(createOutboundRequest());
    assert.equal(res.outcome, "failed_retryable");
    if (res.outcome === "failed_retryable") {
      assert.equal(res.httpDispatched, true);
      assert.equal(res.retryable, true);
      assert.equal(res.reason, "provider_server_error");
      assert.equal(res.httpStatus, status);
    }
  }
});

test("HTTP 4xx Non-429 errors are classified as failed_permanent", async () => {
  for (const status of [400, 401, 403, 404]) {
    const adapter = new TelegramChannelAdapter({
      botAccountId: BOT_ACCOUNT_ID,
      testerAllowlist: [TESTER_ID],
      botToken: BOT_TOKEN,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: status,
            description: "Forbidden: bot was blocked by the user",
          }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
    });

    const res = await adapter.sendOutbound(createOutboundRequest());
    assert.equal(res.outcome, "failed_permanent");
    if (res.outcome === "failed_permanent") {
      assert.equal(res.httpDispatched, true);
      assert.equal(res.retryable, false);
      assert.equal(res.reason, "provider_rejected_permanent");
      assert.equal(res.httpStatus, status);
    }
  }
});

test("Ambiguous outcomes after dispatch are classified as unknown with retryable: false", async () => {
  // 1. Timeout / AbortError
  const timeoutAdapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async (_url, init) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    },
  });

  const timeoutRes = await timeoutAdapter.sendOutbound(
    createOutboundRequest({ timeoutMs: 10 }),
  );
  assert.equal(timeoutRes.outcome, "unknown");
  if (timeoutRes.outcome === "unknown") {
    assert.equal(timeoutRes.httpDispatched, true);
    assert.equal(timeoutRes.retryable, false); // PRD §11 FR-16: Never blindly retry ambiguous outcomes
    assert.equal(timeoutRes.reason, "timeout_after_dispatch");
    assert.equal(timeoutRes.httpStatus, null);
  }

  // 2. Network socket crash
  const networkAdapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () => {
      const err = new Error("ECONNRESET: socket hang up");
      err.name = "FetchError";
      throw err;
    },
  });

  const networkRes = await networkAdapter.sendOutbound(createOutboundRequest());
  assert.equal(networkRes.outcome, "unknown");
  if (networkRes.outcome === "unknown") {
    assert.equal(networkRes.httpDispatched, true);
    assert.equal(networkRes.retryable, false);
    assert.equal(networkRes.reason, "network_error_after_dispatch");
    assert.equal(networkRes.httpStatus, null);
  }

  // 3. HTTP 200 with malformed JSON
  const malformedJsonAdapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () => new Response("Internal Gateway OK but not JSON", { status: 200 }),
  });

  const malformedRes = await malformedJsonAdapter.sendOutbound(createOutboundRequest());
  assert.equal(malformedRes.outcome, "unknown");
  if (malformedRes.outcome === "unknown") {
    assert.equal(malformedRes.httpDispatched, true);
    assert.equal(malformedRes.retryable, false);
    assert.equal(malformedRes.reason, "ambiguous_provider_response");
    assert.equal(malformedRes.httpStatus, 200);
  }

  // 4. HTTP 200 with ok: false or missing message_id
  const missingMsgIdAdapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true, result: { no_message_id: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });

  const missingMsgIdRes = await missingMsgIdAdapter.sendOutbound(createOutboundRequest());
  assert.equal(missingMsgIdRes.outcome, "unknown");
  if (missingMsgIdRes.outcome === "unknown") {
    assert.equal(missingMsgIdRes.reason, "ambiguous_provider_response");
  }

  // 5. HTTP 200 with chat ID mismatch
  const mismatchChatAdapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: BOT_TOKEN,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 1234, chat: { id: 999999 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  const mismatchRes = await mismatchChatAdapter.sendOutbound(createOutboundRequest());
  assert.equal(mismatchRes.outcome, "unknown");
  if (mismatchRes.outcome === "unknown") {
    assert.equal(mismatchRes.reason, "ambiguous_provider_response");
  }
});

test("Bot token is never exposed in error messages across any failure scenario", async () => {
  const secretToken = "777666555:SecretTokenThatMustNeverLeak";
  const errorDescription = `Telegram API at /bot${secretToken}/ returned error with token ${secretToken}`;

  const adapter = new TelegramChannelAdapter({
    botAccountId: BOT_ACCOUNT_ID,
    testerAllowlist: [TESTER_ID],
    botToken: secretToken,
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, error_code: 400, description: errorDescription }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  });

  const res = await adapter.sendOutbound(createOutboundRequest());
  assert.equal(res.outcome, "failed_permanent");
  if (res.outcome === "failed_permanent") {
    assert.ok(!res.errorMessage.includes(secretToken), "Bot token must not appear in errorMessage");
    assert.ok(res.errorMessage.includes("[REDACTED]"));
  }
});
