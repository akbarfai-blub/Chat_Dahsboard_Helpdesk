import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeErrorMessage,
  isRetryableError,
  computeBackoffMs,
} from "../../lib/application/job-worker-service";
import { PersistenceError } from "../../lib/application/persistence-contracts";
import {
  handleTelegramWebhook,
  type PersistenceFactory,
} from "../../lib/application/telegram-inbound-service";
import type { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";

test("job worker unit tests", async (t) => {
  await t.test("sanitizeErrorMessage strips database credentials and sensitive tokens", () => {
    const rawPgError = new Error(
      "Connection failed to postgresql://admin_user:SuperSecretPassword123@db.example.internal:5432/helpdesk_db"
    );
    const sanitizedPg = sanitizeErrorMessage(rawPgError);
    assert.ok(!sanitizedPg.includes("SuperSecretPassword123"));
    assert.ok(!sanitizedPg.includes("admin_user"));
    assert.ok(sanitizedPg.includes("postgresql://[redacted]@db.example.internal:5432/helpdesk_db"));

    const rawBearerError = new Error("Failed upstream call: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token");
    const sanitizedBearer = sanitizeErrorMessage(rawBearerError);
    assert.ok(!sanitizedBearer.includes("eyJhbGciOi"));
    assert.ok(sanitizedBearer.includes("Bearer [redacted]"));

    const rawSecretError = "URL failed with secret=my_super_secret_webhook_token and key=api_key_12345";
    const sanitizedSecret = sanitizeErrorMessage(rawSecretError);
    assert.ok(!sanitizedSecret.includes("my_super_secret_webhook_token"));
    assert.ok(!sanitizedSecret.includes("api_key_12345"));
    assert.ok(sanitizedSecret.includes("secret=[redacted]"));
    assert.ok(sanitizedSecret.includes("key=[redacted]"));
  });

  await t.test("sanitizeErrorMessage truncates excessively long messages", () => {
    const hugeMessage = "A".repeat(1000);
    const sanitized = sanitizeErrorMessage(hugeMessage);
    assert.ok(sanitized.length <= 500);
    assert.ok(sanitized.endsWith("..."));
  });

  await t.test("isRetryableError distinguishes permanent vs transient errors", () => {
    // Non-retryable permanent domain/persistence errors
    assert.equal(isRetryableError(new PersistenceError("lease_lost")), false);
    assert.equal(isRetryableError(new PersistenceError("job_leased_by_other_worker")), false);
    assert.equal(isRetryableError(new PersistenceError("job_lease_expired")), false);
    assert.equal(isRetryableError(new PersistenceError("ingress_not_found")), false);
    assert.equal(isRetryableError(new PersistenceError("ingress_identity_conflict")), false);
    assert.equal(isRetryableError(new PersistenceError("invalid_association")), false);
    assert.equal(isRetryableError(new PersistenceError("invalid_reply")), false);
    assert.equal(isRetryableError(new PersistenceError("job_already_done")), false);
    assert.equal(isRetryableError(new PersistenceError("job_already_failed")), false);

    // Retryable transient errors
    assert.equal(isRetryableError(new Error("Connection terminated unexpectedly")), true);
    assert.equal(isRetryableError(new Error("deadlock detected")), true);
    assert.equal(isRetryableError(new Error("timeout exceeded")), true);
    assert.equal(isRetryableError(new PersistenceError("unexpected_db_fault")), true);
  });

  await t.test("computeBackoffMs calculates exponential backoff correctly", () => {
    const base = 2000;
    assert.equal(computeBackoffMs(1, base), 2000); // 2000 * 2^0
    assert.equal(computeBackoffMs(2, base), 4000); // 2000 * 2^1
    assert.equal(computeBackoffMs(3, base), 8000); // 2000 * 2^2
    assert.equal(computeBackoffMs(4, base), 16000); // 2000 * 2^3
  });

  await t.test("handleTelegramWebhook schedules worker only on accepted outcome", async () => {
    const secret = "test_webhook_secret_123";
    const allowlist = ["123456789"];

    let acceptedCallbackCount = 0;
    let lastAcceptedInfo: { ingressId: string; duplicate: boolean } | null = null;

    const mockPersistence: Partial<HelpdeskPersistence> = {
      receive: async () => ({
        ingressId: "ing_11111111-1111-4000-8000-111111111111",
        duplicate: false,
      }),
    };
    const factory: PersistenceFactory = () => mockPersistence as HelpdeskPersistence;

    const validPayload = JSON.stringify({
      update_id: 100,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 123456789, type: "private" },
        from: { id: 123456789, is_bot: false, first_name: "Tester" },
        text: "Halo internet lambat",
      },
    });

    // 1. Valid accepted request -> onAccepted is invoked
    const reqAccepted = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": secret,
        "content-type": "application/json",
      },
      body: validPayload,
    });

    const resAccepted = await handleTelegramWebhook(reqAccepted, factory, {
      webhookSecret: secret,
      testerAllowlist: allowlist,
      onAccepted: (info) => {
        acceptedCallbackCount++;
        lastAcceptedInfo = info;
      },
    });

    assert.equal(resAccepted.status, 200);
    assert.equal(acceptedCallbackCount, 1);
    assert.ok(lastAcceptedInfo != null);
    assert.equal((lastAcceptedInfo as { ingressId: string; duplicate: boolean }).ingressId, "ing_11111111-1111-4000-8000-111111111111");
    assert.equal((lastAcceptedInfo as { ingressId: string; duplicate: boolean }).duplicate, false);

    // 2. Duplicate accepted -> onAccepted is STILL invoked (to drain eligible jobs)
    const mockPersistenceDuplicate: Partial<HelpdeskPersistence> = {
      receive: async () => ({
        ingressId: "ing_11111111-1111-4000-8000-111111111111",
        duplicate: true,
      }),
    };
    const factoryDup: PersistenceFactory = () => mockPersistenceDuplicate as HelpdeskPersistence;

    const reqDuplicate = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": secret,
        "content-type": "application/json",
      },
      body: validPayload,
    });

    const resDuplicate = await handleTelegramWebhook(reqDuplicate, factoryDup, {
      webhookSecret: secret,
      testerAllowlist: allowlist,
      onAccepted: (info) => {
        acceptedCallbackCount++;
        lastAcceptedInfo = info;
      },
    });

    assert.equal(resDuplicate.status, 200);
    assert.equal(acceptedCallbackCount, 2);
    assert.ok(lastAcceptedInfo != null);
    assert.equal((lastAcceptedInfo as { ingressId: string; duplicate: boolean }).duplicate, true);

    // 3. Unauthorized request -> onAccepted is NOT invoked
    const reqUnauthorized = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong_secret",
        "content-type": "application/json",
      },
      body: validPayload,
    });

    const resUnauthorized = await handleTelegramWebhook(reqUnauthorized, factory, {
      webhookSecret: secret,
      testerAllowlist: allowlist,
      onAccepted: () => {
        acceptedCallbackCount++;
      },
    });

    assert.equal(resUnauthorized.status, 401);
    assert.equal(acceptedCallbackCount, 2); // Unchanged

    // 4. Rejected request (non-tester) -> onAccepted is NOT invoked
    const nonTesterPayload = JSON.stringify({
      update_id: 101,
      message: {
        message_id: 2,
        date: 1700000000,
        chat: { id: 999999999, type: "private" },
        from: { id: 999999999, is_bot: false, first_name: "NonTester" },
        text: "Halo",
      },
    });

    const reqRejected = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": secret,
        "content-type": "application/json",
      },
      body: nonTesterPayload,
    });

    const resRejected = await handleTelegramWebhook(reqRejected, factory, {
      webhookSecret: secret,
      testerAllowlist: allowlist,
      onAccepted: () => {
        acceptedCallbackCount++;
      },
    });

    assert.equal(resRejected.status, 200);
    const bodyRejected = await resRejected.json();
    assert.equal(bodyRejected.data.status, "rejected");
    assert.equal(acceptedCallbackCount, 2); // Unchanged

    // 5. Malformed structural request (HTTP 400) -> onAccepted is NOT invoked
    const reqMalformed = new Request("http://localhost/api/webhooks/telegram", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": secret,
        "content-type": "application/json",
      },
      body: "{ not valid json",
    });

    const resMalformed = await handleTelegramWebhook(reqMalformed, factory, {
      webhookSecret: secret,
      testerAllowlist: allowlist,
      onAccepted: () => {
        acceptedCallbackCount++;
      },
    });

    assert.equal(resMalformed.status, 400);
    assert.equal(acceptedCallbackCount, 2); // Unchanged
  });
});
