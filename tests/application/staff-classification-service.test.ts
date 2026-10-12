import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  saveStaffMessageClassification,
  getStaffMessageClassificationHistory,
  InboxError,
  type Queryable,
} from "../../lib/application/inbox-service";
import {
  POST as classificationPostHandler,
  GET as classificationGetHandler,
} from "../../app/api/inbox/conversations/[id]/messages/[messageId]/classification/route";
import type { OriginValidationOutcome } from "../../lib/application/origin-validator";

const fakeStaffId = "00000000-0000-0000-0000-000000000001";
const fakeConvId = "00000000-0000-0000-0000-000000000010";
const fakeMessageId = "00000000-0000-0000-0000-000000000020";

test("saveStaffMessageClassification: parameter validation fails closed", async (t) => {
  const dummyDb: Queryable = { query: (async () => ({ rows: [] })) as unknown as Queryable["query"] };

  await t.test("rejects invalid staff ID with 401 INVALID_STAFF_ID", async () => {
    await assert.rejects(
      saveStaffMessageClassification(dummyDb, "bad-id", {
        conversationId: fakeConvId,
        messageId: fakeMessageId,
        category: "connection_complaint",
      }),
      (err: unknown) => {
        assert.ok(err instanceof InboxError);
        assert.equal(err.code, "INVALID_STAFF_ID");
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  await t.test("rejects invalid conversation ID with 400 INVALID_CONVERSATION_ID", async () => {
    await assert.rejects(
      saveStaffMessageClassification(dummyDb, fakeStaffId, {
        conversationId: "invalid-uuid",
        messageId: fakeMessageId,
        category: "connection_complaint",
      }),
      (err: unknown) => {
        assert.ok(err instanceof InboxError);
        assert.equal(err.code, "INVALID_CONVERSATION_ID");
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  await t.test("rejects invalid message ID with 400 INVALID_MESSAGE_ID", async () => {
    await assert.rejects(
      saveStaffMessageClassification(dummyDb, fakeStaffId, {
        conversationId: fakeConvId,
        messageId: "not-a-uuid",
        category: "connection_complaint",
      }),
      (err: unknown) => {
        assert.ok(err instanceof InboxError);
        assert.equal(err.code, "INVALID_MESSAGE_ID");
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  await t.test("rejects invalid category with descriptive error", async () => {
    await assert.rejects(
      saveStaffMessageClassification(dummyDb, fakeStaffId, {
        conversationId: fakeConvId,
        messageId: fakeMessageId,
        category: "invalid_category" as unknown as "connection_complaint",
      }),
      /Kategori klasifikasi tidak valid/
    );
  });

  await t.test("rejects notes longer than 1000 characters", async () => {
    await assert.rejects(
      saveStaffMessageClassification(dummyDb, fakeStaffId, {
        conversationId: fakeConvId,
        messageId: fakeMessageId,
        category: "connection_complaint",
        notes: "x".repeat(1001),
      }),
      /Catatan klasifikasi tidak boleh melebihi 1000 karakter/
    );
  });
});

test("saveStaffMessageClassification: handles session not found and message not found", async (t) => {
  await t.test("throws 401 UNAUTHENTICATED when staff not found in auth.users", async () => {
    const mockDb: Queryable = {
      query: (async (sql: string) => {
        if (sql.includes("auth.users")) return { rows: [] };
        return { rows: [] };
      }) as unknown as Queryable["query"],
    };
    await assert.rejects(
      saveStaffMessageClassification(mockDb, fakeStaffId, {
        conversationId: fakeConvId,
        messageId: fakeMessageId,
        category: "connection_complaint",
      }),
      (err: unknown) => {
        assert.ok(err instanceof InboxError);
        assert.equal(err.code, "UNAUTHENTICATED");
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  await t.test("throws 404 MESSAGE_NOT_FOUND when message does not belong to conversation", async () => {
    const mockDb: Queryable = {
      query: (async (sql: string) => {
        if (sql.includes("auth.users")) {
          return { rows: [{ id: fakeStaffId, email: "staff@example.com" }] };
        }
        if (sql.includes("public.messages")) {
          return { rows: [] }; // message not found
        }
        return { rows: [] };
      }) as unknown as Queryable["query"],
    };
    await assert.rejects(
      saveStaffMessageClassification(mockDb, fakeStaffId, {
        conversationId: fakeConvId,
        messageId: fakeMessageId,
        category: "connection_complaint",
      }),
      (err: unknown) => {
        assert.ok(err instanceof InboxError);
        assert.equal(err.code, "MESSAGE_NOT_FOUND");
        assert.equal(err.status, 404);
        return true;
      }
    );
  });
});

test("saveStaffMessageClassification: correctly derives confirmed vs corrected and preserves original rule data", async (t) => {
  let upsertCalled = false;
  let historyInserted = false;
  let capturedUpsertParams: unknown[] = [];

  const mockDb: Queryable = {
    query: (async (sql: string, params?: unknown[]) => {
      if (sql.includes("auth.users")) {
        return { rows: [{ id: fakeStaffId, email: "staff@example.com" }] };
      }
      if (sql.includes("public.messages")) {
        return {
          rows: [
            {
              id: fakeMessageId,
              conversation_id: fakeConvId,
              classification: {
                category: "connection_complaint",
                reason: "connection_keyword",
                ruleVersion: "connection-keywords-v1",
                normalizedText: "wifi mati",
                matchedKeywords: ["wifi mati"],
              },
            },
          ],
        };
      }
      if (sql.includes("SELECT labeled_category, status, notes, staff_id") && sql.includes("staff_message_classifications")) {
        return { rows: [] }; // no existing label
      }
      if (sql.includes("INSERT INTO public.staff_message_classifications")) {
        upsertCalled = true;
        capturedUpsertParams = params || [];
        return {
          rows: [
            {
              labeled_category: params![3],
              status: params![4],
              notes: params![5],
              staff_id: params![2],
              created_at: new Date("2026-10-12T01:00:00Z"),
              updated_at: new Date("2026-10-12T01:00:00Z"),
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.staff_message_classification_history")) {
        historyInserted = true;
        return { rows: [] };
      }
      return { rows: [] };
    }) as unknown as Queryable["query"],
  };

  // Case A: Staff confirms correct rule category ("connection_complaint" matches "connection_complaint")
  const resultConfirmed = await saveStaffMessageClassification(mockDb, fakeStaffId, {
    conversationId: fakeConvId,
    messageId: fakeMessageId,
    category: "connection_complaint",
    notes: "Sesuai indikasi pelanggan",
  });

  assert.equal(resultConfirmed.saved, true);
  assert.equal(resultConfirmed.isIdempotent, false);
  assert.equal(resultConfirmed.classification.labeledCategory, "connection_complaint");
  assert.equal(resultConfirmed.classification.status, "confirmed");
  assert.equal(resultConfirmed.classification.notes, "Sesuai indikasi pelanggan");
  assert.equal(resultConfirmed.classification.staffId, fakeStaffId);
  assert.equal(resultConfirmed.classification.staffEmail, "staff@example.com");

  assert.equal(upsertCalled, true);
  assert.equal(historyInserted, true);
  // Verify original category and rule version preserved in parameters
  assert.equal(capturedUpsertParams[6], "connection_complaint"); // original_category
  assert.equal(capturedUpsertParams[7], "connection-keywords-v1"); // rule_version
  assert.equal(capturedUpsertParams[8], JSON.stringify(["wifi mati"])); // matched_keywords

  // Case B: Staff corrects rule category ("other" differs from "connection_complaint")
  upsertCalled = false;
  historyInserted = false;
  const resultCorrected = await saveStaffMessageClassification(mockDb, fakeStaffId, {
    conversationId: fakeConvId,
    messageId: fakeMessageId,
    category: "other",
    notes: "Hanya ucapan terima kasih",
  });

  assert.equal(resultCorrected.saved, true);
  assert.equal(resultCorrected.isIdempotent, false);
  assert.equal(resultCorrected.classification.labeledCategory, "other");
  assert.equal(resultCorrected.classification.status, "corrected");
  assert.equal(capturedUpsertParams[4], "corrected");
});

test("saveStaffMessageClassification: idempotent repeated saves return existing record without writing duplicate history", async () => {
  let historyInserted = false;

  const mockDb: Queryable = {
    query: (async (sql: string) => {
      if (sql.includes("auth.users")) {
        return { rows: [{ id: fakeStaffId, email: "staff@example.com" }] };
      }
      if (sql.includes("public.messages")) {
        return {
          rows: [
            {
              id: fakeMessageId,
              conversation_id: fakeConvId,
              classification: {
                category: "connection_complaint",
                ruleVersion: "connection-keywords-v1",
                matchedKeywords: ["wifi mati"],
              },
            },
          ],
        };
      }
      if (sql.includes("SELECT labeled_category, status, notes, staff_id") && sql.includes("staff_message_classifications")) {
        return {
          rows: [
            {
              labeled_category: "connection_complaint",
              status: "confirmed",
              notes: "Catatan sama persis",
              staff_id: fakeStaffId,
              created_at: new Date("2026-10-12T01:00:00Z"),
              updated_at: new Date("2026-10-12T01:00:00Z"),
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.staff_message_classification_history")) {
        historyInserted = true;
        return { rows: [] };
      }
      return { rows: [] };
    }) as unknown as Queryable["query"],
  };

  const repeatedResult = await saveStaffMessageClassification(mockDb, fakeStaffId, {
    conversationId: fakeConvId,
    messageId: fakeMessageId,
    category: "connection_complaint",
    notes: "Catatan sama persis",
  });

  assert.equal(repeatedResult.saved, true);
  assert.equal(repeatedResult.isIdempotent, true);
  assert.equal(repeatedResult.classification.labeledCategory, "connection_complaint");
  assert.equal(repeatedResult.classification.notes, "Catatan sama persis");
  assert.equal(historyInserted, false, "History insert must not occur on idempotent repeated save");
});

test("saveStaffMessageClassification: multi-staff idempotent save attributes to existing owner A, while real change re-attributes to B", async () => {
  const staffIdA = "00000000-0000-0000-0000-0000000000aa";
  const staffEmailA = "staff-a@example.com";
  const staffIdB = "00000000-0000-0000-0000-0000000000bb";
  const staffEmailB = "staff-b@example.com";

  let historyInserted = false;
  let upsertCalled = false;
  let capturedUpsertStaffId: string | null = null;

  const mockDb: Queryable = {
    query: (async (sql: string, params?: unknown[]) => {
      if (sql.includes("auth.users")) {
        const targetId = params?.[0];
        if (targetId === staffIdA) return { rows: [{ id: staffIdA, email: staffEmailA }] };
        if (targetId === staffIdB) return { rows: [{ id: staffIdB, email: staffEmailB }] };
        return { rows: [{ id: targetId, email: "unknown@example.com" }] };
      }
      if (sql.includes("public.messages")) {
        return {
          rows: [
            {
              id: fakeMessageId,
              conversation_id: fakeConvId,
              classification: {
                category: "connection_complaint",
                ruleVersion: "connection-keywords-v1",
                matchedKeywords: ["wifi mati"],
              },
            },
          ],
        };
      }
      if (sql.includes("SELECT labeled_category, status, notes, staff_id") && sql.includes("staff_message_classifications")) {
        // Active label owned by Staff A
        return {
          rows: [
            {
              labeled_category: "connection_complaint",
              status: "confirmed",
              notes: "Catatan Staf A",
              staff_id: staffIdA,
              created_at: new Date("2026-10-12T01:00:00Z"),
              updated_at: new Date("2026-10-12T01:00:00Z"),
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.staff_message_classifications")) {
        upsertCalled = true;
        capturedUpsertStaffId = params![2] as string;
        return {
          rows: [
            {
              labeled_category: params![3],
              status: params![4],
              notes: params![5],
              staff_id: params![2],
              created_at: new Date("2026-10-12T01:00:00Z"),
              updated_at: new Date("2026-10-12T02:00:00Z"),
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO public.staff_message_classification_history")) {
        historyInserted = true;
        return { rows: [] };
      }
      return { rows: [] };
    }) as unknown as Queryable["query"],
  };

  // Case 1: Staff B submits identical category and notes as Staff A
  const identicalResult = await saveStaffMessageClassification(mockDb, staffIdB, {
    conversationId: fakeConvId,
    messageId: fakeMessageId,
    category: "connection_complaint",
    notes: "Catatan Staf A",
  });

  assert.equal(identicalResult.saved, true);
  assert.equal(identicalResult.isIdempotent, true);
  assert.equal(identicalResult.classification.staffId, staffIdA, "Staff ID must remain Staff A");
  assert.equal(identicalResult.classification.staffEmail, staffEmailA, "Staff Email must resolve to Staff A");
  assert.equal(historyInserted, false, "History must not be inserted on identical save by different staff");
  assert.equal(upsertCalled, false, "Active table must not be updated on identical save by different staff");

  // Case 2: Staff B makes a real change (e.g. category 'other')
  const changedResult = await saveStaffMessageClassification(mockDb, staffIdB, {
    conversationId: fakeConvId,
    messageId: fakeMessageId,
    category: "other",
    notes: "Koreksi nyata oleh Staf B",
  });

  assert.equal(changedResult.saved, true);
  assert.equal(changedResult.isIdempotent, false);
  assert.equal(changedResult.classification.staffId, staffIdB, "Active record must now be attributed to Staff B");
  assert.equal(changedResult.classification.staffEmail, staffEmailB, "Active record must show Staff B's email");
  assert.equal(upsertCalled, true);
  assert.equal(capturedUpsertStaffId, staffIdB);
  assert.equal(historyInserted, true, "History row must be written for real change by Staff B");
});

test("getStaffMessageClassificationHistory: returns full audit trail ordered by created_at DESC", async () => {
  const mockDb: Queryable = {
    query: (async (sql: string) => {
      if (sql.includes("SELECT id FROM public.messages")) {
        return { rows: [{ id: fakeMessageId }] };
      }
      if (sql.includes("staff_message_classification_history")) {
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000099",
              message_id: fakeMessageId,
              conversation_id: fakeConvId,
              staff_id: fakeStaffId,
              staff_email: "staff@example.com",
              labeled_category: "other",
              status: "corrected",
              notes: "Koreksi kedua",
              previous_category: "connection_complaint",
              original_category: "connection_complaint",
              rule_version: "connection-keywords-v1",
              matched_keywords: ["wifi mati"],
              created_at: new Date("2026-10-12T01:10:00Z"),
            },
            {
              id: "00000000-0000-0000-0000-000000000098",
              message_id: fakeMessageId,
              conversation_id: fakeConvId,
              staff_id: fakeStaffId,
              staff_email: "staff@example.com",
              labeled_category: "connection_complaint",
              status: "confirmed",
              notes: "Label awal",
              previous_category: null,
              original_category: "connection_complaint",
              rule_version: "connection-keywords-v1",
              matched_keywords: ["wifi mati"],
              created_at: new Date("2026-10-12T01:00:00Z"),
            },
          ],
        };
      }
      return { rows: [] };
    }) as unknown as Queryable["query"],
  };

  const history = await getStaffMessageClassificationHistory(
    mockDb,
    fakeStaffId,
    fakeConvId,
    fakeMessageId
  );

  assert.equal(history.length, 2);
  assert.equal(history[0].labeledCategory, "other");
  assert.equal(history[0].previousCategory, "connection_complaint");
  assert.equal(history[0].status, "corrected");
  assert.equal(history[1].labeledCategory, "connection_complaint");
  assert.equal(history[1].previousCategory, null);
  assert.equal(history[1].status, "confirmed");
});

test("Route handler: POST /api/inbox/conversations/[id]/messages/[messageId]/classification", async (t) => {
  const dummyOrigin: OriginValidationOutcome = { valid: true, origin: "http://localhost:3000" };

  await t.test("rejects untrusted origin with 403 CSRF error", async () => {
    const req = new Request("http://localhost/api", { method: "POST" });
    const res = await classificationPostHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        validateOrigin: () => ({ valid: false, reason: "origin_mismatch", status: 403, code: "FORBIDDEN", message: "Origin header mismatch" }),
      }
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "FORBIDDEN");
  });

  await t.test("rejects unauthenticated caller with 401 UNAUTHENTICATED", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ category: "connection_complaint" }),
    });
    const res = await classificationPostHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        validateOrigin: () => dummyOrigin,
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
      }
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAUTHENTICATED");
  });

  await t.test("rejects invalid JSON body with 400 INVALID_JSON", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: "invalid-json{",
    });
    const res = await classificationPostHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        validateOrigin: () => dummyOrigin,
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }) } }),
      }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_JSON");
  });

  await t.test("rejects invalid category in body with 400 INVALID_PARAMETER", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ category: "not_valid" }),
    });
    const res = await classificationPostHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        validateOrigin: () => dummyOrigin,
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }) } }),
      }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_PARAMETER");
  });

  await t.test("successfully processes valid save request with 200 and Cache-Control headers", async () => {
    const mockDb: Queryable = {
      query: (async (sql: string, params?: unknown[]) => {
        if (sql.includes("auth.users")) return { rows: [{ id: fakeStaffId, email: "staff@example.com" }] };
        if (sql.includes("public.messages")) {
          return {
            rows: [
              {
                id: fakeMessageId,
                conversation_id: fakeConvId,
                classification: { category: "connection_complaint", ruleVersion: "connection-keywords-v1" },
              },
            ],
          };
        }
        if (sql.includes("SELECT labeled_category") && sql.includes("staff_message_classifications")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO public.staff_message_classifications")) {
          return {
            rows: [
              {
                labeled_category: params![3],
                status: params![4],
                notes: params![5],
                staff_id: params![2],
                created_at: new Date("2026-10-12T01:00:00Z"),
                updated_at: new Date("2026-10-12T01:00:00Z"),
              },
            ],
          };
        }
        return { rows: [] };
      }) as unknown as Queryable["query"],
    };

    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ category: "connection_complaint", notes: "Catatan staf valid" }),
    });

    const res = await classificationPostHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        validateOrigin: () => dummyOrigin,
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }) } }),
        getPool: () => mockDb,
      }
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.saved, true);
    assert.equal(body.data.classification.labeledCategory, "connection_complaint");
    assert.equal(body.data.classification.status, "confirmed");
  });
});

test("Route handler: GET /api/inbox/conversations/[id]/messages/[messageId]/classification", async (t) => {
  await t.test("rejects unauthenticated caller with 401 UNAUTHENTICATED", async () => {
    const req = new Request("http://localhost/api", { method: "GET" });
    const res = await classificationGetHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
      }
    );
    assert.equal(res.status, 401);
  });

  await t.test("returns 200 with history array on success", async () => {
    const mockDb: Queryable = {
      query: (async (sql: string) => {
        if (sql.includes("SELECT id FROM public.messages")) {
          return { rows: [{ id: fakeMessageId }] };
        }
        if (sql.includes("staff_message_classification_history")) {
          return {
            rows: [
              {
                id: randomUUID(),
                message_id: fakeMessageId,
                conversation_id: fakeConvId,
                staff_id: fakeStaffId,
                staff_email: "staff@example.com",
                labeled_category: "other",
                status: "corrected",
                notes: "Koreksi",
                previous_category: null,
                original_category: "connection_complaint",
                rule_version: "connection-keywords-v1",
                matched_keywords: [],
                created_at: new Date("2026-10-12T01:00:00Z"),
              },
            ],
          };
        }
        return { rows: [] };
      }) as unknown as Queryable["query"],
    };

    const req = new Request("http://localhost/api", { method: "GET" });
    const res = await classificationGetHandler(
      req,
      { params: Promise.resolve({ id: fakeConvId, messageId: fakeMessageId }) },
      {
        getAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: fakeStaffId } }, error: null }) } }),
        getPool: () => mockDb,
      }
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].labeledCategory, "other");
  });
});
