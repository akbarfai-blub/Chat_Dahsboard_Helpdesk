import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInboxListQuery,
  isValidUuid,
  INBOX_DEFAULT_PAGE_LIMIT,
  INBOX_MAX_PAGE_LIMIT,
} from "../../lib/application/inbox-contracts";
import {
  InboxError,
  listInboxConversations,
  getInboxConversationDetail,
  classifyRouteError,
  type Queryable,
} from "../../lib/application/inbox-service";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateRequestOrigin } from "../../lib/application/origin-validator";
import { GET as getConversationsRoute } from "../../app/api/inbox/conversations/route";
import { GET as getConversationDetailRoute } from "../../app/api/inbox/conversations/[id]/route";
import { POST as postConversationReadRoute } from "../../app/api/inbox/conversations/[id]/read/route";
import { EnvRestorer } from "../utils/test-guard";
import { resolveDatabaseCaCertificate, SUPABASE_ROOT_CA_2021 } from "../../lib/postgres/server";

test("Inbox pagination rejects unsafe numbers before database access", async (t) => {
  const lastSafePageAt25 = Math.floor(Number.MAX_SAFE_INTEGER / 25) + 1;

  await t.test("parser rejects unsafe pages and safe pages whose offset overflows", () => {
    for (const query of [
      "page=9007199254740992",
      `page=${"9".repeat(400)}`,
      `page=${Number.MAX_SAFE_INTEGER}&limit=25`,
      `page=${lastSafePageAt25 + 1}&limit=25`,
      "limit=9007199254740992",
    ]) {
      const result = parseInboxListQuery(new URLSearchParams(query));
      assert.equal(result.valid, false, `Must reject ${query}`);
    }
  });

  await t.test("parser accepts the safe boundary for the selected limit", () => {
    for (const [page, limit] of [[lastSafePageAt25, 25], [Number.MAX_SAFE_INTEGER, 1]]) {
      const result = parseInboxListQuery(new URLSearchParams(`page=${page}&limit=${limit}`));
      assert.ok(result.valid);
      assert.equal(result.query.page, page);
      assert.equal(result.query.limit, limit);
    }
  });

  await t.test("direct service callers receive 400 without executing SQL for invalid numbers", async () => {
    let queryCalls = 0;
    const db: Queryable = {
      query: async () => {
        queryCalls++;
        throw new Error("Invalid pagination must not execute SQL");
      },
    };
    const invalidQueries = [
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((page) => ({ page })),
      ...[0, -1, 1.5, NaN, Infinity, 26, Number.MAX_SAFE_INTEGER + 1].map((limit) => ({ limit })),
      { page: lastSafePageAt25 + 1, limit: 25 },
    ];
    for (const query of invalidQueries) {
      await assert.rejects(
        listInboxConversations(db, "11111111-1111-1111-1111-111111111111", query),
        (error: unknown) => error instanceof InboxError && error.code === "INVALID_PARAMETER" && error.status === 400
      );
    }
    assert.equal(queryCalls, 0);
  });
});

test("Inbox contracts and query parameter validation unit tests", async (t) => {
  await t.test("default pagination parameters are applied when omitted", () => {
    const params = new URLSearchParams();
    const result = parseInboxListQuery(params);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.query.page, 1);
      assert.equal(result.query.limit, INBOX_DEFAULT_PAGE_LIMIT);
      assert.equal(result.query.status, undefined);
      assert.equal(result.query.episodeStatus, undefined);
      assert.equal(result.query.unread, undefined);
      assert.equal(result.query.needsReview, undefined);
      assert.equal(result.query.search, undefined);
    }
  });

  await t.test("page validation enforces positive integer >= 1", () => {
    const valid = parseInboxListQuery(new URLSearchParams("page=3"));
    assert.equal(valid.valid, true);
    if (valid.valid) assert.equal(valid.query.page, 3);

    const zero = parseInboxListQuery(new URLSearchParams("page=0"));
    assert.equal(zero.valid, false);
    if (!zero.valid) assert.match(zero.error, /Parameter 'page'/);

    const negative = parseInboxListQuery(new URLSearchParams("page=-1"));
    assert.equal(negative.valid, false);

    const nonNumber = parseInboxListQuery(new URLSearchParams("page=abc"));
    assert.equal(nonNumber.valid, false);

    const decimal = parseInboxListQuery(new URLSearchParams("page=1.5"));
    assert.equal(decimal.valid, false);
  });

  await t.test("limit validation enforces positive integer up to 25", () => {
    const valid = parseInboxListQuery(new URLSearchParams("limit=15"));
    assert.equal(valid.valid, true);
    if (valid.valid) assert.equal(valid.query.limit, 15);

    const max = parseInboxListQuery(new URLSearchParams(`limit=${INBOX_MAX_PAGE_LIMIT}`));
    assert.equal(max.valid, true);
    if (max.valid) assert.equal(max.query.limit, 25);

    const exceeded = parseInboxListQuery(new URLSearchParams("limit=26"));
    assert.equal(exceeded.valid, false);
    if (!exceeded.valid) assert.match(exceeded.error, /maksimal 25/);

    const zero = parseInboxListQuery(new URLSearchParams("limit=0"));
    assert.equal(zero.valid, false);

    const nonNumber = parseInboxListQuery(new URLSearchParams("limit=ten"));
    assert.equal(nonNumber.valid, false);
  });

  await t.test("status filter validates enum", () => {
    for (const validStatus of ["active", "closed", "all"] as const) {
      const res = parseInboxListQuery(new URLSearchParams(`status=${validStatus}`));
      assert.equal(res.valid, true);
      if (res.valid) assert.equal(res.query.status, validStatus);
    }

    const invalid = parseInboxListQuery(new URLSearchParams("status=pending"));
    assert.equal(invalid.valid, false);
    if (!invalid.valid) assert.match(invalid.error, /Parameter 'status'/);
  });

  await t.test("episodeStatus filter validates allowed states and none/any", () => {
    for (const validState of ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED", "none", "any"] as const) {
      const res = parseInboxListQuery(new URLSearchParams(`episodeStatus=${validState}`));
      assert.equal(res.valid, true);
      if (res.valid) assert.equal(res.query.episodeStatus, validState);
    }

    const invalid = parseInboxListQuery(new URLSearchParams("episodeStatus=INVALID"));
    assert.equal(invalid.valid, false);
  });

  await t.test("unread and needsReview validate strict booleans", () => {
    const unreadTrue = parseInboxListQuery(new URLSearchParams("unread=true"));
    assert.equal(unreadTrue.valid, true);
    if (unreadTrue.valid) assert.equal(unreadTrue.query.unread, true);

    const unreadFalse = parseInboxListQuery(new URLSearchParams("unread=false"));
    assert.equal(unreadFalse.valid, true);
    if (unreadFalse.valid) assert.equal(unreadFalse.query.unread, false);

    const unreadInvalid = parseInboxListQuery(new URLSearchParams("unread=1"));
    assert.equal(unreadInvalid.valid, false);

    const needsReviewTrue = parseInboxListQuery(new URLSearchParams("needsReview=true"));
    assert.equal(needsReviewTrue.valid, true);
    if (needsReviewTrue.valid) assert.equal(needsReviewTrue.query.needsReview, true);

    const needsReviewFalse = parseInboxListQuery(new URLSearchParams("needsReview=false"));
    assert.equal(needsReviewFalse.valid, true);
    if (needsReviewFalse.valid) assert.equal(needsReviewFalse.query.needsReview, false);

    const needsReviewInvalid = parseInboxListQuery(new URLSearchParams("needsReview=yes"));
    assert.equal(needsReviewInvalid.valid, false);
  });

  await t.test("search parameter is trimmed and capped at 100 characters", () => {
    const searchValid = parseInboxListQuery(new URLSearchParams("search=%20%20koneksi%20lambat%20%20"));
    assert.equal(searchValid.valid, true);
    if (searchValid.valid) assert.equal(searchValid.query.search, "koneksi lambat");

    const searchEmpty = parseInboxListQuery(new URLSearchParams("search=%20%20%20"));
    assert.equal(searchEmpty.valid, true);
    if (searchEmpty.valid) assert.equal(searchEmpty.query.search, undefined);

    const longQuery = "a".repeat(101);
    const searchTooLong = parseInboxListQuery(new URLSearchParams(`search=${longQuery}`));
    assert.equal(searchTooLong.valid, false);
    if (!searchTooLong.valid) assert.match(searchTooLong.error, /maksimal 100 karakter/);
  });

  await t.test("duplicate parameters are rejected to prevent parameter pollution", () => {
    const params = new URLSearchParams();
    params.append("page", "1");
    params.append("page", "2");
    const dupPage = parseInboxListQuery(params);
    assert.equal(dupPage.valid, false);
    if (!dupPage.valid) assert.match(dupPage.error, /tidak boleh diduplikasi/);

    const dupStatus = new URLSearchParams();
    dupStatus.append("status", "active");
    dupStatus.append("status", "closed");
    assert.equal(parseInboxListQuery(dupStatus).valid, false);
  });

  await t.test("isValidUuid checks format strictly", () => {
    assert.equal(isValidUuid("00000000-0000-0000-0000-000000000001"), true);
    assert.equal(isValidUuid("c81f33e8-5b4d-4a2e-9d87-17e9976bb201"), true);
    assert.equal(isValidUuid(""), false);
    assert.equal(isValidUuid("not-a-uuid"), false);
    assert.equal(isValidUuid("c81f33e8-5b4d-4a2e-9d87-17e9976bb201; DROP TABLE users;"), false);
    assert.equal(isValidUuid(null), false);
    assert.equal(isValidUuid(123), false);
  });

  await t.test("InboxError preserves code, message, and HTTP status", () => {
    const err = new InboxError("INVALID_PARAMETER", "Parameter tidak valid.", 400);
    assert.equal(err.code, "INVALID_PARAMETER");
    assert.equal(err.message, "Parameter tidak valid.");
    assert.equal(err.status, 400);
    assert.equal(err.name, "InboxError");
  });
});

test("Origin and CSRF validation unit tests", async (t) => {
  await t.test("missing Origin header is rejected with 403 origin_missing", () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
    });
    const outcome = validateRequestOrigin(req);
    assert.equal(outcome.valid, false);
    if (!outcome.valid) {
      assert.equal(outcome.reason, "origin_missing");
      assert.equal(outcome.status, 403);
      assert.equal(outcome.code, "FORBIDDEN");
    }
  });

  await t.test("browser 'null' Origin is rejected with 403 origin_invalid", () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: { origin: "null" },
    });
    const outcome = validateRequestOrigin(req);
    assert.equal(outcome.valid, false);
    if (!outcome.valid) {
      assert.equal(outcome.reason, "origin_invalid");
      assert.equal(outcome.status, 403);
    }
  });

  await t.test("malformed Origin header is rejected with 403 origin_invalid", () => {
    for (const badOrigin of ["not-a-url", "javascript:void(0)", "ftp://example.com"]) {
      const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
        method: "POST",
        headers: { origin: badOrigin },
      });
      const outcome = validateRequestOrigin(req);
      assert.equal(outcome.valid, false);
      if (!outcome.valid) {
        assert.equal(outcome.reason, "origin_invalid");
        assert.equal(outcome.status, 403);
      }
    }
  });

  await t.test("foreign Origin is rejected with 403 origin_mismatch even if x-forwarded-host and proto match it", () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: {
        origin: "https://evil.com",
        "x-forwarded-host": "evil.com",
        "x-forwarded-proto": "https",
      },
    });
    const outcome = validateRequestOrigin(req);
    assert.equal(outcome.valid, false);
    assert.equal(outcome.reason, "origin_mismatch");
    assert.equal(outcome.status, 403);
    assert.equal(outcome.code, "FORBIDDEN");
  });

  await t.test("forwarded headers cannot expand allowed origins", () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: {
        origin: "https://attacker.org",
        host: "attacker.org",
        "x-forwarded-host": "attacker.org",
        "x-forwarded-proto": "https",
      },
    });
    const outcome = validateRequestOrigin(req);
    assert.equal(outcome.valid, false);
    assert.equal(outcome.reason, "origin_mismatch");
    assert.equal(outcome.status, 403);
  });

  await t.test("request from legitimate origin is accepted (default dev localhost:3000)", () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    const outcome = validateRequestOrigin(req);
    assert.equal(outcome.valid, true);
    if (outcome.valid) {
      assert.equal(outcome.origin, "http://localhost:3000");
    }
  });

  await t.test("request from configured HELPDESK_TRUSTED_ORIGINS is accepted", () => {
    const restorer = new EnvRestorer();
    restorer.save(["HELPDESK_TRUSTED_ORIGINS"]);
    try {
      restorer.set("HELPDESK_TRUSTED_ORIGINS", "https://helpdesk.upaznet.com,http://localhost:3000");
      const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
        method: "POST",
        headers: { origin: "https://helpdesk.upaznet.com" },
      });
      const outcome = validateRequestOrigin(req);
      assert.equal(outcome.valid, true);
      if (outcome.valid) {
        assert.equal(outcome.origin, "https://helpdesk.upaznet.com");
      }
    } finally {
      restorer.restore();
    }
  });

  await t.test("request from Vercel deployment variables is accepted", () => {
    const restorer = new EnvRestorer();
    restorer.save(["VERCEL_PROJECT_PRODUCTION_URL", "HELPDESK_TRUSTED_ORIGINS"]);
    try {
      delete process.env.HELPDESK_TRUSTED_ORIGINS;
      restorer.set("VERCEL_PROJECT_PRODUCTION_URL", "helpdesk-staging.vercel.app");
      const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
        method: "POST",
        headers: { origin: "https://helpdesk-staging.vercel.app" },
      });
      const outcome = validateRequestOrigin(req);
      assert.equal(outcome.valid, true);
      if (outcome.valid) {
        assert.equal(outcome.origin, "https://helpdesk-staging.vercel.app");
      }
    } finally {
      restorer.restore();
    }
  });

  await t.test("invalid server configuration is handled in a controlled manner (fail-closed, no silent fallback)", () => {
    const restorer = new EnvRestorer();
    restorer.save(["HELPDESK_TRUSTED_ORIGINS"]);
    try {
      // Configuration is present but malformed: must NOT silently fall back to localhost!
      restorer.set("HELPDESK_TRUSTED_ORIGINS", "invalid-uri-not-a-url");
      const req = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      });
      const outcome = validateRequestOrigin(req);
      assert.equal(outcome.valid, false);
      assert.equal(outcome.status, 403);
      assert.equal(outcome.code, "FORBIDDEN");
      assert.equal(outcome.reason, "origin_mismatch");
    } finally {
      restorer.restore();
    }
  });

  await t.test("strict scheme, host, and port matching rejects variations", () => {
    // Protocol mismatch
    const reqProto = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: { origin: "https://localhost:3000" },
    });
    assert.equal(validateRequestOrigin(reqProto).valid, false);

    // Port mismatch
    const reqPort = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: { origin: "http://localhost:8080" },
    });
    assert.equal(validateRequestOrigin(reqPort).valid, false);

    // Subdomain mismatch
    const reqSub = new Request("http://localhost:3000/api/inbox/conversations/conv-1/read", {
      method: "POST",
      headers: { origin: "http://evil.localhost:3000" },
    });
    assert.equal(validateRequestOrigin(reqSub).valid, false);
  });
});

test("Route boundary authentication and session actor proof (spies)", async (t) => {
  const fakeConversationId = "00000000-0000-0000-0000-000000000001";
  const fakeMessageId = "00000000-0000-0000-0000-000000000002";
  const sessionStaffId = "11111111-1111-1111-1111-111111111111";

  await t.test("GET /api/inbox/conversations without session returns 401 and does not call pool", async () => {
    let poolCalled = false;
    const req = new Request("http://localhost:3000/api/inbox/conversations");
    const res = await getConversationsRoute(
      req,
      { params: Promise.resolve({}) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: null }, error: new Error("unauthenticated") }),
          },
        }),
        getPool: () => {
          poolCalled = true;
          throw new Error("Pool should never be accessed");
        },
      }
    );

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAUTHENTICATED");
    assert.equal(poolCalled, false, "Database pool must not be accessed without valid session");
  });

  await t.test("GET /api/inbox/conversations/[id] without session returns 401 and does not call pool", async () => {
    let poolCalled = false;
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConversationId}`);
    const res = await getConversationDetailRoute(
      req,
      { params: Promise.resolve({ id: fakeConversationId }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: null }, error: new Error("unauthenticated") }),
          },
        }),
        getPool: () => {
          poolCalled = true;
          throw new Error("Pool should never be accessed");
        },
      }
    );

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAUTHENTICATED");
    assert.equal(poolCalled, false, "Database pool must not be accessed without valid session");
  });

  await t.test("POST /api/inbox/conversations/[id]/read without Origin is rejected with 403 and does not call pool", async () => {
    let poolCalled = false;
    let authCalled = false;
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConversationId}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastReadMessageId: fakeMessageId }),
    });

    const res = await postConversationReadRoute(
      req,
      { params: Promise.resolve({ id: fakeConversationId }) },
      {
        getAuthClient: async () => {
          authCalled = true;
          return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
        },
        getPool: () => {
          poolCalled = true;
          throw new Error("Pool should never be accessed");
        },
      }
    );

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(authCalled, false, "Auth check should not even run if Origin validation fails");
    assert.equal(poolCalled, false, "Database pool must not be accessed on invalid Origin");
  });

  await t.test("POST /api/inbox/conversations/[id]/read with spoofed Origin is rejected with 403 and does not call auth or pool", async () => {
    let poolCalled = false;
    let authCalled = false;
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConversationId}/read`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.com",
        "x-forwarded-host": "evil.com",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ lastReadMessageId: fakeMessageId }),
    });

    const res = await postConversationReadRoute(
      req,
      { params: Promise.resolve({ id: fakeConversationId }) },
      {
        getAuthClient: async () => {
          authCalled = true;
          return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
        },
        getPool: () => {
          poolCalled = true;
          throw new Error("Pool should never be accessed");
        },
      }
    );

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(authCalled, false, "Auth check must not run when spoofed Origin is rejected");
    assert.equal(poolCalled, false, "Database pool must not be accessed on spoofed Origin");
  });

  await t.test("POST /api/inbox/conversations/[id]/read without session returns 401 and does not call pool", async () => {
    let poolCalled = false;
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConversationId}/read`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ lastReadMessageId: fakeMessageId }),
    });

    const res = await postConversationReadRoute(
      req,
      { params: Promise.resolve({ id: fakeConversationId }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: null }, error: new Error("unauthenticated") }),
          },
        }),
        getPool: () => {
          poolCalled = true;
          throw new Error("Pool should never be accessed");
        },
      }
    );

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAUTHENTICATED");
    assert.equal(poolCalled, false, "Database pool must not be accessed without valid session");
  });

  await t.test("POST /api/inbox/conversations/[id]/read enforces session actor and ignores injected staffId in body", async () => {
    let receivedStaffId: string | null = null;
    const attackerStaffId = "99999999-9999-9999-9999-999999999999";

    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConversationId}/read`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      // Attacker attempts to inject another staffId into the JSON payload
      body: JSON.stringify({
        lastReadMessageId: fakeMessageId,
        staffId: attackerStaffId,
      }),
    });

    const res = await postConversationReadRoute(
      req,
      { params: Promise.resolve({ id: fakeConversationId }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({
              data: { user: { id: sessionStaffId } },
              error: null,
            }),
          },
        }),
        getPool: () => ({
          query: (async (sql: string, params?: unknown[]) => {
            // Check markConversationRead query: first query verifies message
            if (sql.includes("FROM public.messages m")) {
              return {
                rows: [
                  {
                    id: fakeMessageId,
                    conversation_id: fakeConversationId,
                    received_at: new Date("2026-10-04T00:00:00.000Z"),
                  },
                ],
              };
            }
            // Second query is upsert into staff_conversation_reads
            if (sql.includes("INSERT INTO public.staff_conversation_reads")) {
              receivedStaffId = params?.[0] as string;
              return {
                rows: [
                  {
                    staff_id: receivedStaffId,
                    conversation_id: fakeConversationId,
                    last_read_message_id: fakeMessageId,
                    last_read_at: new Date("2026-10-04T00:00:00.000Z"),
                    updated_at: new Date(),
                  },
                ],
              };
            }
            return { rows: [] };
          }) as unknown as Queryable["query"],
        }),
      }
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(
      receivedStaffId,
      sessionStaffId,
      "Actor must strictly match session staffId and completely disregard payload staffId"
    );
    assert.notEqual(receivedStaffId, attackerStaffId);
  });
});

test("Koreksi B2: InboxMessageClassification mapping and factual fallback unit tests", async (t) => {
  const fakeConvId = "00000000-0000-0000-0000-000000000010";
  const fakeStaffId = "11111111-1111-1111-1111-111111111111";

  await t.test("maps complete persistent classification without confidence or flags", async () => {
    const mockDb: Queryable = {
      query: (async () => ({
        rows: [
          {
            conv_id: fakeConvId,
            conv_channel: "telegram",
            conv_account_id: "bot_1",
            conv_chat_id: "chat_1",
            conv_status: "active",
            conv_started_at: new Date("2026-10-06T00:00:00Z"),
            conv_last_activity_at: new Date("2026-10-06T00:01:00Z"),
            sender_id: "00000000-0000-0000-0000-000000000020",
            sender_external_id: "sender_1",
            display_name_snapshot: "Customer A",
            verification_status: "verified",
            customer_id: "00000000-0000-0000-0000-000000000030",
            customer_name: "Customer A Official",
            episode_id: null,
            episode_status: null,
            episode_category: null,
            episode_service_id: null,
            episode_service_code: null,
            episode_created_at: null,
            episode_updated_at: null,
            message_id: "00000000-0000-0000-0000-000000000040",
            message_identity_id: "00000000-0000-0000-0000-000000000020",
            message_complaint_id: null,
            message_classification: {
              category: "connection_complaint",
              reason: "connection_keyword",
              ruleVersion: "connection-keywords-v1",
              normalizedText: "wifi mati lampu merah",
              matchedKeywords: ["wifi mati", "los"],
            },
            message_review_reason: null,
            message_created_at: new Date("2026-10-06T00:01:00Z"),
            message_channel: "telegram",
            message_account_id: "bot_1",
            message_chat_id: "chat_1",
            message_provider_message_id: "prov_1",
            message_body: "wifi mati lampu merah",
            message_received_at: new Date("2026-10-06T00:01:00Z"),
            message_type: "text",
            has_media: false,
            is_forwarded: false,
            message_caption: null,
            message_sender_info: {},
            message_decision: null,
            message_processing_result: null,
            is_read: false,
          },
        ],
      })) as unknown as Queryable["query"],
    };

    const detail = await getInboxConversationDetail(mockDb, fakeStaffId, fakeConvId);
    assert.ok(detail);
    assert.equal(detail.messages.length, 1);
    const cls = detail.messages[0].classification;
    assert.equal(cls.category, "connection_complaint");
    assert.equal(cls.reason, "connection_keyword");
    assert.equal(cls.ruleVersion, "connection-keywords-v1");
    assert.equal(cls.normalizedText, "wifi mati lampu merah");
    assert.deepEqual(cls.matchedKeywords, ["wifi mati", "los"]);
    // Factual check: confidence and flags MUST NOT exist on the contract
    assert.equal("confidence" in cls, false, "confidence must not exist on classification");
    assert.equal("flags" in cls, false, "flags must not exist on classification");
  });

  await t.test("preserves valid normalizedText null without altering category or reason", async () => {
    const mockDb: Queryable = {
      query: (async () => ({
        rows: [
          {
            conv_id: fakeConvId,
            conv_channel: "telegram",
            conv_account_id: "bot_1",
            conv_chat_id: "chat_1",
            conv_status: "active",
            conv_started_at: new Date("2026-10-06T00:00:00Z"),
            conv_last_activity_at: new Date("2026-10-06T00:01:00Z"),
            sender_id: "00000000-0000-0000-0000-000000000020",
            sender_external_id: "sender_1",
            display_name_snapshot: null,
            verification_status: "unverified",
            customer_id: null,
            customer_name: null,
            episode_id: null,
            episode_status: null,
            episode_category: null,
            episode_service_id: null,
            episode_service_code: null,
            episode_created_at: null,
            episode_updated_at: null,
            message_id: "00000000-0000-0000-0000-000000000041",
            message_identity_id: "00000000-0000-0000-0000-000000000020",
            message_complaint_id: null,
            message_classification: {
              category: "review",
              reason: "empty_text",
              ruleVersion: "connection-keywords-v1",
              normalizedText: null,
              matchedKeywords: [],
            },
            message_review_reason: "empty_text",
            message_created_at: new Date("2026-10-06T00:01:00Z"),
            message_channel: "telegram",
            message_account_id: "bot_1",
            message_chat_id: "chat_1",
            message_provider_message_id: "prov_2",
            message_body: "",
            message_received_at: new Date("2026-10-06T00:01:00Z"),
            message_type: "text",
            has_media: false,
            is_forwarded: false,
            message_caption: null,
            message_sender_info: {},
            message_decision: null,
            message_processing_result: null,
            is_read: false,
          },
        ],
      })) as unknown as Queryable["query"],
    };

    const detail = await getInboxConversationDetail(mockDb, fakeStaffId, fakeConvId);
    assert.ok(detail);
    const cls = detail.messages[0].classification;
    assert.equal(cls.category, "review");
    assert.equal(cls.reason, "empty_text");
    assert.equal(cls.ruleVersion, "connection-keywords-v1");
    assert.equal(cls.normalizedText, null, "normalizedText null must be preserved exactly");
    assert.deepEqual(cls.matchedKeywords, []);
  });

  await t.test("falls back explicitly when classification in database is null, empty or corrupted", async () => {
    const mockDb: Queryable = {
      query: (async () => ({
        rows: [
          {
            conv_id: fakeConvId,
            conv_channel: "telegram",
            conv_account_id: "bot_1",
            conv_chat_id: "chat_1",
            conv_status: "active",
            conv_started_at: new Date("2026-10-06T00:00:00Z"),
            conv_last_activity_at: new Date("2026-10-06T00:01:00Z"),
            sender_id: "00000000-0000-0000-0000-000000000020",
            sender_external_id: "sender_1",
            display_name_snapshot: null,
            verification_status: "unverified",
            customer_id: null,
            customer_name: null,
            episode_id: null,
            episode_status: null,
            episode_category: null,
            episode_service_id: null,
            episode_service_code: null,
            episode_created_at: null,
            episode_updated_at: null,
            message_id: "00000000-0000-0000-0000-000000000042",
            message_identity_id: "00000000-0000-0000-0000-000000000020",
            message_complaint_id: null,
            message_classification: null, // Null in DB
            message_review_reason: null,
            message_created_at: new Date("2026-10-06T00:01:00Z"),
            message_channel: "telegram",
            message_account_id: "bot_1",
            message_chat_id: "chat_1",
            message_provider_message_id: "prov_3",
            message_body: "pesan tanpa klasifikasi",
            message_received_at: new Date("2026-10-06T00:01:00Z"),
            message_type: "text",
            has_media: false,
            is_forwarded: false,
            message_caption: null,
            message_sender_info: {},
            message_decision: null,
            message_processing_result: null,
            is_read: false,
          },
        ],
      })) as unknown as Queryable["query"],
    };

    const detail = await getInboxConversationDetail(mockDb, fakeStaffId, fakeConvId);
    assert.ok(detail);
    const cls = detail.messages[0].classification;
    assert.equal(cls.category, "unknown");
    assert.equal(cls.reason, "unknown");
    assert.equal(cls.ruleVersion, "unknown");
    assert.equal(cls.normalizedText, null);
    assert.deepEqual(cls.matchedKeywords, []);
  });
});

test("Koreksi B2: Route handlers direct invocation with Request/Response unit tests", async (t) => {
  const fakeConvId = "00000000-0000-0000-0000-000000000010";
  const fakeStaffId = "11111111-1111-1111-1111-111111111111";

  await t.test("GET /api/inbox/conversations success path returns envelope and Cache-Control headers", async () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations?page=1&limit=10&status=active");

    const mockPool: Queryable = {
      query: (async () => ({
        rows: [
          {
            total_count: 1,
            paged_id: fakeConvId,
            id: fakeConvId,
            channel: "telegram",
            account_id: "bot_1",
            chat_id: "chat_1",
            status: "active",
            started_at: new Date("2026-10-06T00:00:00Z"),
            last_activity_at: new Date("2026-10-06T00:01:00Z"),
            sender_id: "00000000-0000-0000-0000-000000000020",
            sender_external_id: "sender_1",
            display_name_snapshot: "Customer A",
            verification_status: "verified",
            customer_id: null,
            customer_name: null,
            last_message_id: "00000000-0000-0000-0000-000000000040",
            last_message_body: "wifi mati",
            last_message_received_at: new Date("2026-10-06T00:01:00Z"),
            last_message_category: "connection_complaint",
            last_message_review_reason: null,
            episode_id: null,
            episode_status: null,
            episode_category: null,
            episode_service_id: null,
            episode_service_code: null,
            episode_created_at: null,
            episode_updated_at: null,
            unread_count: 1,
            needs_review: false,
          },
        ],
      })) as unknown as Queryable["query"],
    };

    const res = await getConversationsRoute(
      req,
      { params: Promise.resolve({}) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
          },
        }),
        getPool: () => mockPool,
      }
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.error, null);
    assert.ok(body.data);
    assert.equal(body.data.totalCount, 1);
    assert.equal(body.data.page, 1);
    assert.equal(body.data.limit, 10);
    assert.equal(body.data.totalPages, 1);
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].id, fakeConvId);
    assert.equal(body.data.items[0].lastMessage.category, "connection_complaint");
    assert.equal(body.data.items[0].isUnread, true);
  });

  await t.test("GET /api/inbox/conversations rejects invalid query params with 400 INVALID_PARAMETER", async () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations?limit=30");

    const res = await getConversationsRoute(
      req,
      { params: Promise.resolve({}) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
          },
        }),
        getPool: () => ({ query: (async () => ({ rows: [] })) as unknown as Queryable["query"] }),
      }
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_PARAMETER");
    assert.match(body.error.message, /maksimal 25/);
  });

  await t.test("GET /api/inbox/conversations rejects page and offset overflow before acquiring the pool", async () => {
    let poolCalls = 0;
    for (const query of [
      "page=9007199254740992",
      `page=${"9".repeat(400)}`,
      `page=${Number.MAX_SAFE_INTEGER}&limit=25`,
      `page=${Math.floor(Number.MAX_SAFE_INTEGER / 25) + 2}&limit=25`,
    ]) {
      const response = await getConversationsRoute(
        new Request(`http://localhost:3000/api/inbox/conversations?${query}`),
        { params: Promise.resolve({}) },
        {
          getAuthClient: async () => ({
            auth: { getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }) },
          }),
          getPool: () => {
            poolCalls++;
            throw new Error("Invalid pagination must not acquire the database pool");
          },
        }
      );
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.equal(body.error.code, "INVALID_PARAMETER");
    }
    assert.equal(poolCalls, 0);
  });

  await t.test("GET /api/inbox/conversations/[id] success path returns envelope and Cache-Control headers", async () => {
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${fakeConvId}`);

    const mockPool: Queryable = {
      query: (async () => ({
        rows: [
          {
            conv_id: fakeConvId,
            conv_channel: "telegram",
            conv_account_id: "bot_1",
            conv_chat_id: "chat_1",
            conv_status: "active",
            conv_started_at: new Date("2026-10-06T00:00:00Z"),
            conv_last_activity_at: new Date("2026-10-06T00:01:00Z"),
            sender_id: "00000000-0000-0000-0000-000000000020",
            sender_external_id: "sender_1",
            display_name_snapshot: "Customer A",
            verification_status: "verified",
            customer_id: null,
            customer_name: null,
            episode_id: null,
            episode_status: null,
            episode_category: null,
            episode_service_id: null,
            episode_service_code: null,
            episode_created_at: null,
            episode_updated_at: null,
            message_id: "00000000-0000-0000-0000-000000000040",
            message_identity_id: "00000000-0000-0000-0000-000000000020",
            message_complaint_id: null,
            message_classification: {
              category: "connection_complaint",
              reason: "connection_keyword",
              ruleVersion: "connection-keywords-v1",
              normalizedText: "wifi mati",
              matchedKeywords: ["wifi mati"],
            },
            message_review_reason: null,
            message_created_at: new Date("2026-10-06T00:01:00Z"),
            message_channel: "telegram",
            message_account_id: "bot_1",
            message_chat_id: "chat_1",
            message_provider_message_id: "prov_1",
            message_body: "wifi mati",
            message_received_at: new Date("2026-10-06T00:01:00Z"),
            message_type: "text",
            has_media: false,
            is_forwarded: false,
            message_caption: null,
            message_sender_info: {},
            message_decision: null,
            message_processing_result: null,
            is_read: false,
          },
        ],
      })) as unknown as Queryable["query"],
    };

    const res = await getConversationDetailRoute(
      req,
      { params: Promise.resolve({ id: fakeConvId }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
          },
        }),
        getPool: () => mockPool,
      }
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.error, null);
    assert.ok(body.data);
    assert.equal(body.data.id, fakeConvId);
    assert.equal(body.data.unreadCount, 1);
    assert.equal(body.data.isUnread, true);
    assert.equal(body.data.messages.length, 1);
    assert.equal(body.data.messages[0].classification.category, "connection_complaint");
    assert.equal("confidence" in body.data.messages[0].classification, false);
  });

  await t.test("GET /api/inbox/conversations/[id] rejects invalid UUID with 400 INVALID_PARAMETER", async () => {
    const req = new Request("http://localhost:3000/api/inbox/conversations/not-a-uuid");

    const res = await getConversationDetailRoute(
      req,
      { params: Promise.resolve({ id: "not-a-uuid" }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
          },
        }),
      }
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_PARAMETER");
  });

  await t.test("GET /api/inbox/conversations/[id] returns 404 CONVERSATION_NOT_FOUND when conversation does not exist", async () => {
    const missingConvId = "00000000-0000-0000-0000-000000000099";
    const req = new Request(`http://localhost:3000/api/inbox/conversations/${missingConvId}`);

    const res = await getConversationDetailRoute(
      req,
      { params: Promise.resolve({ id: missingConvId }) },
      {
        getAuthClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
          },
        }),
        getPool: () => ({ query: (async () => ({ rows: [] })) as unknown as Queryable["query"] }),
      }
    );

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "CONVERSATION_NOT_FOUND");
  });

  await t.test("classifyRouteError strictly eliminates secrets and categorizes errors safely", () => {
    // 1. Sensitive error with database URI, token, cookie, customer message, and stack trace
    const sensitiveError = Object.assign(
      new Error("Failed connecting to postgresql://postgres:p@ssw0rd999!@db.internal:5432/helpdesk?token=secret-token-xyz&cookie=session=abcd"),
      {
        code: "28P01",
        password: "p@ssw0rd999!",
        token: "secret-token-xyz",
        cookie: "session=abcd",
        customerMessage: "Tolong perbaiki internet di ODP-UBP-01 rumah saya",
        stack: "Error at db.ts:42\n    connectionString: postgresql://postgres:p@ssw0rd999!@db.internal:5432\n    payload: ODP-UBP-01",
      }
    );

    const diag = classifyRouteError("GET /api/inbox/conversations", sensitiveError);
    assert.deepEqual(diag, {
      route: "GET /api/inbox/conversations",
      category: "DatabaseError",
      code: "28P01",
    });

    const serialized = JSON.stringify(diag);
    assert.ok(!serialized.includes("p@ssw0rd999!"), "Must not leak password");
    assert.ok(!serialized.includes("secret-token-xyz"), "Must not leak token");
    assert.ok(!serialized.includes("session=abcd"), "Must not leak cookie");
    assert.ok(!serialized.includes("ODP-UBP-01"), "Must not leak customer message");
    assert.ok(!serialized.includes("db.internal"), "Must not leak host or URI");
    assert.ok(!serialized.includes("stack"), "Must not include stack property");

    // 2. Allowlisted TLS errors
    const tlsErr = Object.assign(new Error("self signed certificate"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", tlsErr), {
      route: "GET /api/inbox/conversations",
      category: "TlsError",
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });

    // 3. Allowlisted Network errors
    const netErr = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", netErr), {
      route: "GET /api/inbox/conversations",
      category: "NetworkError",
      code: "ECONNREFUSED",
    });

    // 4. Configuration errors
    const configErr = new Error("HELPDESK_DATABASE_URL is required");
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", configErr), {
      route: "GET /api/inbox/conversations",
      category: "ConfigurationError",
      code: "CONFIG_ERROR",
    });

    // 5. DatabaseError without recognized SQLSTATE
    const genericDbErr = Object.assign(new Error("query failed"), { name: "DatabaseError" });
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", genericDbErr), {
      route: "GET /api/inbox/conversations",
      category: "DatabaseError",
      code: "DATABASE_ERROR",
    });

    // 6. Unknown error with unallowlisted code (code must be discarded, not forwarded)
    const unvalidatedErr = Object.assign(new Error("custom app failure"), { code: "CUSTOMER_SSN_99999" });
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", unvalidatedErr), {
      route: "GET /api/inbox/conversations",
      category: "UnknownError",
      code: "UNEXPECTED_ERROR",
    });
    assert.ok(!JSON.stringify(classifyRouteError("GET /api/inbox/conversations", unvalidatedErr)).includes("CUSTOMER_SSN_99999"));

    // 7. Non-object / primitive error
    assert.deepEqual(classifyRouteError("GET /api/inbox/conversations", "string error"), {
      route: "GET /api/inbox/conversations",
      category: "UnknownError",
      code: "UNEXPECTED_ERROR",
    });
  });

  await t.test("GET /api/inbox/conversations catches unexpected errors, prevents log/response leaks, and returns 500 INTERNAL_ERROR", async () => {
    const originalConsoleError = console.error;
    const loggedErrors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };

    try {
      const dummySecrets = {
        password: "supersecret-password-123",
        token: "bearer-token-abc-999",
        cookie: "auth-session-cookie=secret",
        customerPayload: "Tolong jaringan saya di ODP-UBP-02 mati total",
        uri: "postgresql://postgres:supersecret-password-123@db.internal:5432/db",
      };

      const sensitiveErr = Object.assign(
        new Error(`Connection failed to ${dummySecrets.uri}?token=${dummySecrets.token}&cookie=${dummySecrets.cookie}`),
        {
          code: "28P01", // Valid SQLSTATE
          password: dummySecrets.password,
          token: dummySecrets.token,
          cookie: dummySecrets.cookie,
          customerMessage: dummySecrets.customerPayload,
          stack: `Error at db.ts:10\n    secret: ${dummySecrets.password}`,
        }
      );

      const req = new Request("http://localhost:3000/api/inbox/conversations");
      const res = await getConversationsRoute(
        req,
        { params: Promise.resolve({}) },
        {
          getAuthClient: async () => ({
            auth: {
              getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
            },
          }),
          getPool: () => ({
            query: async () => {
              throw sensitiveErr;
            },
          }),
        }
      );

      // 1. Response status & envelope validation
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.equal(body.error.code, "INTERNAL_ERROR");
      assert.equal(body.error.message, "Terjadi kesalahan pada server saat memuat percakapan.");

      // 2. Zero leak in HTTP response body
      const rawBody = JSON.stringify(body);
      assert.ok(!rawBody.includes(dummySecrets.password), "Response must not contain password");
      assert.ok(!rawBody.includes(dummySecrets.token), "Response must not contain token");
      assert.ok(!rawBody.includes(dummySecrets.cookie), "Response must not contain cookie");
      assert.ok(!rawBody.includes(dummySecrets.customerPayload), "Response must not contain customer message");
      assert.ok(!rawBody.includes("db.internal"), "Response must not contain connection string");

      // 3. Verify safe logging occurred
      assert.equal(loggedErrors.length, 1);
      const [logPrefix, logData] = loggedErrors[0] as [string, Record<string, unknown>];
      assert.equal(logPrefix, "[InboxConversationsRoute Error]");
      assert.deepEqual(logData, {
        route: "GET /api/inbox/conversations",
        category: "DatabaseError",
        code: "28P01",
      });

      // 4. Zero leak in console log output
      const rawLog = JSON.stringify(loggedErrors[0]);
      assert.ok(!rawLog.includes(dummySecrets.password), "Log must not contain password");
      assert.ok(!rawLog.includes(dummySecrets.token), "Log must not contain token");
      assert.ok(!rawLog.includes(dummySecrets.cookie), "Log must not contain cookie");
      assert.ok(!rawLog.includes(dummySecrets.customerPayload), "Log must not contain customer message");
      assert.ok(!rawLog.includes("db.internal"), "Log must not contain connection string");
      assert.ok(!rawLog.includes("stack"), "Log must not contain stack trace");
    } finally {
      console.error = originalConsoleError;
    }
  });

  await t.test("GET /api/inbox/conversations/[id] catches unexpected errors, prevents log/response leaks, and returns 500 INTERNAL_ERROR", async () => {
    const originalConsoleError = console.error;
    const loggedErrors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };

    try {
      const dummySecrets = {
        password: "detail-secret-pass-456",
        token: "detail-token-xyz-888",
        cookie: "session-detail=secretval",
        customerPayload: "Pesan pelanggan dalam percakapan: modem merah berkedip",
        uri: "postgresql://postgres:detail-secret-pass-456@db.internal:5432/db",
      };

      const sensitiveErr = Object.assign(
        new Error(`Detail query failed on ${dummySecrets.uri}`),
        {
          code: "08006", // Valid connection failure SQLSTATE
          password: dummySecrets.password,
          token: dummySecrets.token,
          cookie: dummySecrets.cookie,
          customerMessage: dummySecrets.customerPayload,
        }
      );

      const convId = "00000000-0000-4000-8000-000000000001";
      const req = new Request(`http://localhost:3000/api/inbox/conversations/${convId}`);
      const res = await getConversationDetailRoute(
        req,
        { params: Promise.resolve({ id: convId }) },
        {
          getAuthClient: async () => ({
            auth: {
              getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
            },
          }),
          getPool: () => ({
            query: async () => {
              throw sensitiveErr;
            },
          }),
        }
      );

      // 1. Response status & envelope validation
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.data, null);
      assert.equal(body.error.code, "INTERNAL_ERROR");
      assert.equal(body.error.message, "Terjadi kesalahan pada server saat memuat detail percakapan.");

      // 2. Zero leak in HTTP response body
      const rawBody = JSON.stringify(body);
      assert.ok(!rawBody.includes(dummySecrets.password));
      assert.ok(!rawBody.includes(dummySecrets.token));
      assert.ok(!rawBody.includes(dummySecrets.cookie));
      assert.ok(!rawBody.includes(dummySecrets.customerPayload));

      // 3. Verify safe logging occurred
      assert.equal(loggedErrors.length, 1);
      const [logPrefix, logData] = loggedErrors[0] as [string, Record<string, unknown>];
      assert.equal(logPrefix, "[InboxConversationDetailRoute Error]");
      assert.deepEqual(logData, {
        route: "GET /api/inbox/conversations/[id]",
        category: "DatabaseError",
        code: "08006",
      });

      // 4. Zero leak in console log output
      const rawLog = JSON.stringify(loggedErrors[0]);
      assert.ok(!rawLog.includes(dummySecrets.password));
      assert.ok(!rawLog.includes(dummySecrets.token));
      assert.ok(!rawLog.includes(dummySecrets.cookie));
      assert.ok(!rawLog.includes(dummySecrets.customerPayload));
    } finally {
      console.error = originalConsoleError;
    }
  });

  await t.test("Route error logging discards unallowlisted error codes and produces generic diagnostics", async () => {
    const originalConsoleError = console.error;
    const loggedErrors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };

    try {
      const unallowlistedErr = Object.assign(
        new Error("Unexpected internal error with leaked credential code"),
        {
          code: "LEAKY_INTERNAL_QUERY_OR_SECRET",
        }
      );

      const req = new Request("http://localhost:3000/api/inbox/conversations");
      const res = await getConversationsRoute(
        req,
        { params: Promise.resolve({}) },
        {
          getAuthClient: async () => ({
            auth: {
              getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }),
            },
          }),
          getPool: () => ({
            query: async () => {
              throw unallowlistedErr;
            },
          }),
        }
      );

      assert.equal(res.status, 500);
      assert.equal(loggedErrors.length, 1);
      const [, logData] = loggedErrors[0] as [string, Record<string, unknown>];
      assert.deepEqual(logData, {
        route: "GET /api/inbox/conversations",
        category: "UnknownError",
        code: "UNEXPECTED_ERROR",
      });
      // Verify unallowlisted code is completely absent from log output
      const rawLog = JSON.stringify(loggedErrors[0]);
      assert.ok(!rawLog.includes("LEAKY_INTERNAL_QUERY_OR_SECRET"));
    } finally {
      console.error = originalConsoleError;
    }
  });

  await t.test("resolveDatabaseCaCertificate fallback parses as valid X.509 and matches reference certificate", () => {
    // 1. Truly activate fallback: empty env and non-existent certPath
    const missingCertPath = path.resolve(process.cwd(), "nonexistent-test-certs/missing-prod-ca.crt");
    const fallbackCa = resolveDatabaseCaCertificate({
      env: {},
      certPath: missingCertPath,
    });

    assert.equal(fallbackCa, SUPABASE_ROOT_CA_2021);

    // 2. Also activate fallback when certPath exists but is unreadable (directory instead of file)
    const unreadableCertPath = path.resolve(process.cwd(), "certs");
    const unreadableFallbackCa = resolveDatabaseCaCertificate({
      env: {},
      certPath: unreadableCertPath,
    });
    assert.equal(unreadableFallbackCa, SUPABASE_ROOT_CA_2021);

    // 3. Cryptographic X.509 certificate parsing and comparison
    const fallbackCert = new crypto.X509Certificate(fallbackCa);

    const referenceCertPath = path.resolve(process.cwd(), "certs/prod-ca-2021.crt");
    const referenceCa = fs.readFileSync(referenceCertPath, "utf8").trim();
    const referenceCert = new crypto.X509Certificate(referenceCa);

    // Assert subject, issuer, SHA-256 fingerprint, and validity match reference certificate
    assert.equal(fallbackCert.subject, referenceCert.subject);
    assert.equal(fallbackCert.issuer, referenceCert.issuer);
    assert.equal(fallbackCert.fingerprint256, referenceCert.fingerprint256);
    assert.equal(fallbackCert.validTo, referenceCert.validTo);
    assert.equal(fallbackCert.serialNumber, referenceCert.serialNumber);

    // Assert key attributes of Supabase Root 2021 CA
    assert.ok(fallbackCert.subject.includes("Supabase Root 2021 CA"));
    assert.equal(
      fallbackCert.fingerprint256,
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA"
    );

    // 4. Environment override precedence testing
    const envOverrideCa = resolveDatabaseCaCertificate({
      env: { HELPDESK_DB_CA: "-----BEGIN CERTIFICATE-----\nMOCK_HELPDESK_CA\n-----END CERTIFICATE-----" },
      certPath: referenceCertPath,
    });
    assert.equal(envOverrideCa, "-----BEGIN CERTIFICATE-----\nMOCK_HELPDESK_CA\n-----END CERTIFICATE-----");

    const supabaseEnvCa = resolveDatabaseCaCertificate({
      env: { SUPABASE_DB_CA: "-----BEGIN CERTIFICATE-----\nMOCK_SUPABASE_CA\n-----END CERTIFICATE-----" },
      certPath: referenceCertPath,
    });
    assert.equal(supabaseEnvCa, "-----BEGIN CERTIFICATE-----\nMOCK_SUPABASE_CA\n-----END CERTIFICATE-----");

    // 5. File selection from disk when env is empty
    const fileCa = resolveDatabaseCaCertificate({
      env: {},
      certPath: referenceCertPath,
    });
    assert.equal(fileCa, referenceCa);

    // 6. Default invocation without arguments cleanly resolves certificate and restores env
    const originalHelpdeskCa = process.env.HELPDESK_DB_CA;
    const originalSupabaseCa = process.env.SUPABASE_DB_CA;
    try {
      delete process.env.HELPDESK_DB_CA;
      delete process.env.SUPABASE_DB_CA;

      const defaultCa = resolveDatabaseCaCertificate();
      const defaultCert = new crypto.X509Certificate(defaultCa);
      assert.equal(defaultCert.fingerprint256, referenceCert.fingerprint256);
    } finally {
      if (originalHelpdeskCa !== undefined) {
        process.env.HELPDESK_DB_CA = originalHelpdeskCa;
      } else {
        delete process.env.HELPDESK_DB_CA;
      }
      if (originalSupabaseCa !== undefined) {
        process.env.SUPABASE_DB_CA = originalSupabaseCa;
      } else {
        delete process.env.SUPABASE_DB_CA;
      }
    }
  });
});

