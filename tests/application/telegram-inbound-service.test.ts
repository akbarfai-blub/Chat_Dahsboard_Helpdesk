import test from "node:test";
import assert from "node:assert/strict";
import {
  TelegramInboundService,
  verifyTelegramWebhookSecret,
  readLimitedRequestBody,
  handleTelegramWebhook,
  type TelegramInboundConfig,
} from "../../lib/application/telegram-inbound-service";
import type { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import type { InboundReceipt } from "../../lib/application/persistence-contracts";
import type { TelegramUpdate } from "../../lib/adapters/telegram/telegram-types";
import { POST } from "../../app/api/webhooks/telegram/route";

const TEST_SECRET = "secret-token-1234567890-test";
const TESTER_ID = "987654321";
const OTHER_TESTER_ID = "112233445";
const BOT_ACCOUNT = "upaznet_helpdesk_bot";

function makeConfig(overrides: Partial<TelegramInboundConfig> = {}): TelegramInboundConfig {
  return {
    webhookSecret: TEST_SECRET,
    botAccountId: BOT_ACCOUNT,
    testerAllowlist: [TESTER_ID, OTHER_TESTER_ID],
    maxPayloadBytes: 1024, // small 1KB limit for easy test boundaries
    ...overrides,
  };
}

function makeValidUpdate(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
  return {
    update_id: 5001,
    message: {
      message_id: 101,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "Internet saya mati total",
    },
    ...overrides,
  };
}

class MockPersistence {
  readonly receivedReceipts: InboundReceipt[] = [];
  nextDuplicate = false;
  shouldThrow = false;

  async receive(receipt: InboundReceipt): Promise<{ ingressId: string; duplicate: boolean }> {
    if (this.shouldThrow) {
      throw new Error("Simulated database failure");
    }
    this.receivedReceipts.push(receipt);
    return {
      ingressId: "mock-ingress-id-" + this.receivedReceipts.length,
      duplicate: this.nextDuplicate,
    };
  }
}

test("verifyTelegramWebhookSecret validates secrets safely and fails closed", () => {
  // Matching secret
  assert.equal(verifyTelegramWebhookSecret(TEST_SECRET, TEST_SECRET), true);

  // Mismatched secret
  assert.equal(verifyTelegramWebhookSecret("wrong-secret", TEST_SECRET), false);

  // Missing or empty incoming secret
  assert.equal(verifyTelegramWebhookSecret(null, TEST_SECRET), false);
  assert.equal(verifyTelegramWebhookSecret(undefined, TEST_SECRET), false);
  assert.equal(verifyTelegramWebhookSecret("", TEST_SECRET), false);
  assert.equal(verifyTelegramWebhookSecret("   ", TEST_SECRET), false);

  // Unconfigured server secret (fails closed)
  assert.equal(verifyTelegramWebhookSecret(TEST_SECRET, null), false);
  assert.equal(verifyTelegramWebhookSecret(TEST_SECRET, undefined), false);
  assert.equal(verifyTelegramWebhookSecret(TEST_SECRET, ""), false);
  assert.equal(verifyTelegramWebhookSecret(TEST_SECRET, "   "), false);

  // Different length strings
  assert.equal(verifyTelegramWebhookSecret("short", TEST_SECRET), false);
});

test("readLimitedRequestBody enforces hard byte limit on body streams", async () => {
  const maxBytes = 100;

  // 1. Valid body within limit
  const smallText = JSON.stringify({ hello: "world" });
  const smallReq = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: smallText,
  });
  const smallResult = await readLimitedRequestBody(smallReq, maxBytes);
  assert.equal(smallResult.ok, true);
  if (smallResult.ok) {
    assert.equal(smallResult.body.toString("utf8"), smallText);
  }

  // 2. Oversized body with Content-Length
  const largeText = "x".repeat(150);
  const largeReqWithHeader = new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Content-Length": "150",
    },
    body: largeText,
  });
  const largeResultWithHeader = await readLimitedRequestBody(largeReqWithHeader, maxBytes);
  assert.equal(largeResultWithHeader.ok, false);
  if (!largeResultWithHeader.ok) {
    assert.equal(largeResultWithHeader.error, "too_large");
  }

  // 3. Oversized streaming body WITHOUT Content-Length
  // Simulates chunked streaming by feeding chunks into a ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("a".repeat(60)));
      controller.enqueue(Buffer.from("b".repeat(60))); // total 120 > 100
      controller.close();
    },
  });
  // Node.js Request with duplex: 'half' for streaming body
  const streamReq = new Request("http://localhost/webhook", {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex is required for Request streaming in Node fetch
    duplex: "half",
  });
  const streamResult = await readLimitedRequestBody(streamReq, maxBytes);
  assert.equal(streamResult.ok, false);
  if (!streamResult.ok) {
    assert.equal(streamResult.error, "too_large");
  }

  // 4. Request with null body
  const emptyReq = new Request("http://localhost/webhook", { method: "POST" });
  const emptyResult = await readLimitedRequestBody(emptyReq, maxBytes);
  assert.equal(emptyResult.ok, true);
  if (emptyResult.ok) {
    assert.equal(emptyResult.body.length, 0);
  }
});

test("TelegramInboundService rejects invalid/missing secret without calling persistence", async () => {
  const mockPersistence = new MockPersistence();
  const service = new TelegramInboundService(
    mockPersistence as unknown as HelpdeskPersistence,
    makeConfig(),
  );

  const payload = JSON.stringify(makeValidUpdate());

  // Missing secret header
  const resMissing = await service.handleInbound(null, payload);
  assert.equal(resMissing.outcome, "unauthorized");
  assert.equal(mockPersistence.receivedReceipts.length, 0);

  // Wrong secret header
  const resWrong = await service.handleInbound("wrong-token", payload);
  assert.equal(resWrong.outcome, "unauthorized");
  assert.equal(mockPersistence.receivedReceipts.length, 0);

  // Unconfigured server secret
  const unconfiguredService = new TelegramInboundService(
    mockPersistence as unknown as HelpdeskPersistence,
    makeConfig({ webhookSecret: "" }),
  );
  const resUnconfigured = await unconfiguredService.handleInbound(TEST_SECRET, payload);
  assert.equal(resUnconfigured.outcome, "unauthorized");
  assert.equal(mockPersistence.receivedReceipts.length, 0);
});

test("TelegramInboundService rejects oversized payload pre-parse without calling persistence", async () => {
  const mockPersistence = new MockPersistence();
  const service = new TelegramInboundService(
    mockPersistence as unknown as HelpdeskPersistence,
    makeConfig({ maxPayloadBytes: 50 }),
  );

  const largePayload = JSON.stringify(makeValidUpdate()); // > 50 bytes
  const res = await service.handleInbound(TEST_SECRET, largePayload);

  assert.equal(res.outcome, "oversized");
  assert.equal(mockPersistence.receivedReceipts.length, 0);
});

test("TelegramInboundService returns unsupported/rejected for non-tester or service messages without mutation", async () => {
  const mockPersistence = new MockPersistence();
  const service = new TelegramInboundService(
    mockPersistence as unknown as HelpdeskPersistence,
    makeConfig(),
  );

  // 1. Edited message -> unsupported (no persistence call)
  const editedUpdate = makeValidUpdate({
    edited_message: {
      message_id: 101,
      date: 1727500010,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "Pesan diedit",
    },
    message: undefined,
  });
  const editedRes = await service.handleInbound(TEST_SECRET, JSON.stringify(editedUpdate));
  assert.equal(editedRes.outcome, "unsupported");
  if (editedRes.outcome === "unsupported") {
    assert.equal(editedRes.reason, "edited_message_ignored");
  }
  assert.equal(mockPersistence.receivedReceipts.length, 0);

  // 2. Non-private chat -> rejected (non_private_chat)
  const groupUpdate = makeValidUpdate({
    message: {
      message_id: 102,
      date: 1727500000,
      chat: { id: -100123456, type: "group", title: "Test Group" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "Laporan dari grup",
    },
  });
  const groupRes = await service.handleInbound(TEST_SECRET, JSON.stringify(groupUpdate));
  assert.equal(groupRes.outcome, "rejected");
  if (groupRes.outcome === "rejected") {
    assert.equal(groupRes.reason, "non_private_chat");
  }
  assert.equal(mockPersistence.receivedReceipts.length, 0);

  // 3. Sender not in tester allowlist -> rejected (not_in_tester_allowlist)
  const unauthorizedUpdate = makeValidUpdate({
    message: {
      message_id: 103,
      date: 1727500000,
      chat: { id: 999999999, type: "private" },
      from: { id: 999999999, is_bot: false, first_name: "Intruder" },
      text: "Halo bot",
    },
  });
  const unauthRes = await service.handleInbound(TEST_SECRET, JSON.stringify(unauthorizedUpdate));
  assert.equal(unauthRes.outcome, "rejected");
  if (unauthRes.outcome === "rejected") {
    assert.equal(unauthRes.reason, "not_in_tester_allowlist");
  }
  assert.equal(mockPersistence.receivedReceipts.length, 0);
});

test("TelegramInboundService persists accepted messages with rich metadata atomically", async () => {
  const mockPersistence = new MockPersistence();
  const service = new TelegramInboundService(
    mockPersistence as unknown as HelpdeskPersistence,
    makeConfig(),
  );

  // 1. Text message
  const textUpdate = makeValidUpdate();
  const textRes = await service.handleInbound(TEST_SECRET, JSON.stringify(textUpdate));

  assert.equal(textRes.outcome, "accepted");
  if (textRes.outcome === "accepted") {
    assert.equal(textRes.duplicate, false);
    assert.match(textRes.ingressId, /^mock-ingress-id-/);
  }
  assert.equal(mockPersistence.receivedReceipts.length, 1);
  const receipt1 = mockPersistence.receivedReceipts[0];
  assert.equal(receipt1.text, "Internet saya mati total");
  assert.equal(receipt1.metadata?.messageType, "text");
  assert.equal(receipt1.metadata?.hasMedia, false);
  assert.equal(receipt1.metadata?.isForwarded, false);
  assert.equal(receipt1.metadata?.caption, null);
  assert.equal(receipt1.metadata?.sentAt, new Date(1727500000 * 1000).toISOString());
  assert.equal(receipt1.metadata?.senderInfo?.firstName, "Tester");

  // 2. Photo with caption message
  const photoCaptionUpdate = makeValidUpdate({
    message: {
      message_id: 104,
      date: 1727500005,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      photo: [{ file_id: "ph_1", file_unique_id: "u1", width: 100, height: 100 }],
      caption: "Lampu LOS merah menyala",
    },
  });
  const photoRes = await service.handleInbound(TEST_SECRET, JSON.stringify(photoCaptionUpdate));
  assert.equal(photoRes.outcome, "accepted");
  assert.equal(mockPersistence.receivedReceipts.length, 2);
  const receipt2 = mockPersistence.receivedReceipts[1];
  assert.equal(receipt2.text, "Lampu LOS merah menyala");
  assert.equal(receipt2.metadata?.messageType, "photo");
  assert.equal(receipt2.metadata?.hasMedia, true);
  assert.equal(receipt2.metadata?.caption, "Lampu LOS merah menyala");

  // 3. Photo WITHOUT caption: receipt.text is empty string, no invented words
  const photoNoCaptionUpdate = makeValidUpdate({
    message: {
      message_id: 105,
      date: 1727500010,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      photo: [{ file_id: "ph_2", file_unique_id: "u2", width: 100, height: 100 }],
    },
  });
  const photoNoCapRes = await service.handleInbound(TEST_SECRET, JSON.stringify(photoNoCaptionUpdate));
  assert.equal(photoNoCapRes.outcome, "accepted");
  assert.equal(mockPersistence.receivedReceipts.length, 3);
  const receipt3 = mockPersistence.receivedReceipts[2];
  assert.equal(receipt3.text, "");
  assert.equal(receipt3.metadata?.messageType, "photo");
  assert.equal(receipt3.metadata?.hasMedia, true);
  assert.equal(receipt3.metadata?.caption, null);

  // 4. Forwarded message: preserves isForwarded flag without changing sender
  const forwardUpdate = makeValidUpdate({
    message: {
      message_id: 106,
      date: 1727500015,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      forward_from: { id: 777777777, is_bot: false, first_name: "Neighbor" },
      forward_date: 1727400000,
      text: "Forwarded complaint",
    },
  });
  const forwardRes = await service.handleInbound(TEST_SECRET, JSON.stringify(forwardUpdate));
  assert.equal(forwardRes.outcome, "accepted");
  assert.equal(mockPersistence.receivedReceipts.length, 4);
  const receipt4 = mockPersistence.receivedReceipts[3];
  assert.equal(receipt4.sender.senderExternalId, TESTER_ID); // remains tester ID
  assert.equal(receipt4.metadata?.isForwarded, true);

  // 5. Duplicate receipt returns duplicate: true
  mockPersistence.nextDuplicate = true;
  const dupRes = await service.handleInbound(TEST_SECRET, JSON.stringify(textUpdate));
  assert.equal(dupRes.outcome, "accepted");
  if (dupRes.outcome === "accepted") {
    assert.equal(dupRes.duplicate, true);
  }
});

test("handleTelegramWebhook HTTP pipeline maps status codes and envelope accurately", async () => {
  const originalEnvSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalEnvAllowlist = process.env.TELEGRAM_TESTER_ALLOWLIST;
  const originalEnvBotAccount = process.env.TELEGRAM_BOT_ACCOUNT_ID;
  const mockPersistence = new MockPersistence();

  try {
    process.env.TELEGRAM_WEBHOOK_SECRET = TEST_SECRET;
    process.env.TELEGRAM_TESTER_ALLOWLIST = TESTER_ID;
    process.env.TELEGRAM_BOT_ACCOUNT_ID = BOT_ACCOUNT;

    // 1. Missing secret token header -> 401 Unauthorized
    const reqNoSecret = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      body: JSON.stringify(makeValidUpdate()),
    });
    const resNoSecret = await handleTelegramWebhook(reqNoSecret, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resNoSecret.status, 401);
    const bodyNoSecret = (await resNoSecret.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyNoSecret.success, false);
    assert.equal(bodyNoSecret.error?.code, "UNAUTHORIZED");

    // 2. Wrong secret token header -> 401 Unauthorized
    const reqWrongSecret = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "wrong-token" },
      body: JSON.stringify(makeValidUpdate()),
    });
    const resWrongSecret = await handleTelegramWebhook(reqWrongSecret, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resWrongSecret.status, 401);

    // 3. Oversized payload -> 413 Payload Too Large
    const hugeBody = "a".repeat(70 * 1024); // 70 KB > 64 KB limit
    const reqHuge = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": TEST_SECRET,
        "content-length": String(hugeBody.length),
      },
      body: hugeBody,
    });
    const resHuge = await handleTelegramWebhook(reqHuge, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resHuge.status, 413);
    const bodyHuge = (await resHuge.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyHuge.success, false);
    assert.equal(bodyHuge.error?.code, "PAYLOAD_TOO_LARGE");

    // 4. Malformed JSON body -> 400 Bad Request
    const reqMalformed = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: '{"update_id": 123, broken-json',
    });
    const resMalformed = await handleTelegramWebhook(reqMalformed, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resMalformed.status, 400);
    const bodyMalformed = (await resMalformed.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyMalformed.success, false);
    assert.equal(bodyMalformed.error?.code, "INVALID_JSON");

    // 5. Unsupported update (edited message) -> 200 OK (ignored, no retry)
    const reqUnsupported = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: JSON.stringify(
        makeValidUpdate({
          edited_message: {
            message_id: 1,
            date: 1727500000,
            chat: { id: Number(TESTER_ID), type: "private" },
            from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
          },
          message: undefined,
        }),
      ),
    });
    const resUnsupported = await handleTelegramWebhook(reqUnsupported, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resUnsupported.status, 200);
    const bodyUnsupported = (await resUnsupported.json()) as { success: boolean; data: { status: string; reason: string } };
    assert.equal(bodyUnsupported.success, true);
    assert.equal(bodyUnsupported.data?.status, "ignored");
    assert.equal(bodyUnsupported.data?.reason, "edited_message_ignored");

    // 6. Policy rejection (non-tester) -> 200 OK (rejected, no retry)
    const reqNonTester = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: JSON.stringify(
        makeValidUpdate({
          message: {
            message_id: 2,
            date: 1727500000,
            chat: { id: 888888, type: "private" },
            from: { id: 888888, is_bot: false, first_name: "Intruder" },
            text: "Hello",
          },
        }),
      ),
    });
    const resNonTester = await handleTelegramWebhook(reqNonTester, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resNonTester.status, 200);
    const bodyNonTester = (await resNonTester.json()) as { success: boolean; data: { status: string; reason: string } };
    assert.equal(bodyNonTester.success, true);
    assert.equal(bodyNonTester.data?.status, "rejected");
    assert.equal(bodyNonTester.data?.reason, "not_in_tester_allowlist");

    // 7. Accepted -> 200 OK
    const reqAccepted = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: JSON.stringify(makeValidUpdate({ message: { ...makeValidUpdate().message!, message_id: 301 } })),
    });
    const resAccepted = await handleTelegramWebhook(reqAccepted, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resAccepted.status, 200);
    const bodyAccepted = (await resAccepted.json()) as { success: boolean; data: { status: string; duplicate: boolean } };
    assert.equal(bodyAccepted.success, true);
    assert.equal(bodyAccepted.data?.status, "accepted");
    assert.equal(bodyAccepted.data?.duplicate, false);

    // 8. Transient persistence/DB failure -> 500 PERSISTENCE_FAILED (allows Telegram retry)
    mockPersistence.shouldThrow = true;
    const reqFail = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: JSON.stringify(makeValidUpdate({ message: { ...makeValidUpdate().message!, message_id: 302 } })),
    });
    const resFail = await handleTelegramWebhook(reqFail, mockPersistence as unknown as HelpdeskPersistence);
    assert.equal(resFail.status, 500);
    const bodyFail = (await resFail.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyFail.success, false);
    assert.equal(bodyFail.error?.code, "PERSISTENCE_FAILED");
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = originalEnvSecret;
    process.env.TELEGRAM_TESTER_ALLOWLIST = originalEnvAllowlist;
    process.env.TELEGRAM_BOT_ACCOUNT_ID = originalEnvBotAccount;
  }
});

test("Route POST entry point rejects invalid secret without calling database factory even if DB config is broken", async () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalDbUrl = process.env.HELPDESK_DATABASE_URL;

  try {
    process.env.TELEGRAM_WEBHOOK_SECRET = TEST_SECRET;
    delete process.env.HELPDESK_DATABASE_URL; // Deliberately broken/unset DB configuration

    // 1. Missing secret header
    const reqMissingSecret = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      body: JSON.stringify(makeValidUpdate()),
    });
    const resMissing = await POST(reqMissingSecret);
    assert.equal(resMissing.status, 401);
    const bodyMissing = (await resMissing.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyMissing.success, false);
    assert.equal(bodyMissing.error?.code, "UNAUTHORIZED");

    // 2. Wrong secret header
    const reqWrongSecret = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "wrong-secret-token" },
      body: JSON.stringify(makeValidUpdate()),
    });
    const resWrong = await POST(reqWrongSecret);
    assert.equal(resWrong.status, 401);
    const bodyWrong = (await resWrong.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyWrong.success, false);
    assert.equal(bodyWrong.error?.code, "UNAUTHORIZED");
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    if (originalDbUrl !== undefined) {
      process.env.HELPDESK_DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.HELPDESK_DATABASE_URL;
    }
  }
});

test("Route POST entry point handles database initialization failure safely when secret is valid", async () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalDbUrl = process.env.HELPDESK_DATABASE_URL;
  const originalAllowlist = process.env.TELEGRAM_TESTER_ALLOWLIST;

  try {
    process.env.TELEGRAM_WEBHOOK_SECRET = TEST_SECRET;
    process.env.TELEGRAM_TESTER_ALLOWLIST = TESTER_ID;
    delete process.env.HELPDESK_DATABASE_URL; // Database initialization will fail inside defaultPersistenceFactory

    const reqValidSecret = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
      body: JSON.stringify(makeValidUpdate()),
    });

    const res = await POST(reqValidSecret);
    assert.equal(res.status, 500);

    const body = (await res.json()) as { success: boolean; data: null; error: { code: string; message: string } };
    assert.equal(body.success, false);
    assert.equal(body.data, null);
    assert.equal(body.error?.code, "DATABASE_UNAVAILABLE");
    assert.equal(body.error?.message, "Layanan database tidak tersedia atau gagal diinisialisasi.");

    // Ensure raw connection strings, secrets, or internal stack traces are NEVER leaked in response
    const rawResponse = JSON.stringify(body);
    assert.equal(rawResponse.includes("HELPDESK_DATABASE_URL"), false);
    assert.equal(rawResponse.includes("password"), false);
    assert.equal(rawResponse.includes("postgres"), false);
    assert.equal(rawResponse.includes("stack"), false);
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    process.env.TELEGRAM_TESTER_ALLOWLIST = originalAllowlist;
    if (originalDbUrl !== undefined) {
      process.env.HELPDESK_DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.HELPDESK_DATABASE_URL;
    }
  }
});

test("handleTelegramWebhook lazily resolves persistence factory and avoids factory execution on invalid secret or oversized body", async () => {
  let factoryCallCount = 0;
  const mockFactory = () => {
    factoryCallCount++;
    return new MockPersistence() as unknown as HelpdeskPersistence;
  };

  const config = makeConfig();

  // 1. Wrong secret -> factory is NEVER called
  const reqWrong = new Request("http://localhost/api/webhooks/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "wrong-secret" },
    body: JSON.stringify(makeValidUpdate()),
  });
  const resWrong = await handleTelegramWebhook(reqWrong, mockFactory, config);
  assert.equal(resWrong.status, 401);
  assert.equal(factoryCallCount, 0);

  // 2. Oversized body -> factory is NEVER called
  const reqHuge = new Request("http://localhost/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": TEST_SECRET,
      "content-length": "2000",
    },
    body: "x".repeat(2000), // > 1024 maxPayloadBytes in config
  });
  const resHuge = await handleTelegramWebhook(reqHuge, mockFactory, config);
  assert.equal(resHuge.status, 413);
  assert.equal(factoryCallCount, 0);

  // 3. Valid secret & normal body -> factory IS called exactly once
  const reqValid = new Request("http://localhost/api/webhooks/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": TEST_SECRET },
    body: JSON.stringify(makeValidUpdate()),
  });
  const resValid = await handleTelegramWebhook(reqValid, mockFactory, config);
  assert.equal(resValid.status, 200);
  assert.equal(factoryCallCount, 1);
});

