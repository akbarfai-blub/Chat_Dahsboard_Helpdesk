import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResultRow } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  getInboxConversationContext,
  executeInboxNetworkCheck,
  type Queryable,
} from "../../lib/application/inbox-service";
import { GET as getContextRoute } from "../../app/api/inbox/conversations/[id]/context/route";
import {
  GET as getNetworkCheckRoute,
  POST as postNetworkCheckRoute,
} from "../../app/api/inbox/conversations/[id]/network-check/route";
import { EnvRestorer } from "../utils/test-guard";

const VALID_CONV_ID = "00000000-0000-4000-8000-000000000001";
const VALID_STAFF_ID = "90000000-0000-4000-8000-000000000001";
const VALID_CUSTOMER_ID = "10000000-0000-4000-8000-000000000001";
const VALID_SERVICE_ID = "20000000-0000-4000-8000-000000000001";

test("Inbox Context Service: getInboxConversationContext resolves verified single service and topology", async () => {
  const db: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
      // 1. Conversation query
      if (sql.includes("FROM public.conversations c")) {
        return {
          rows: [
            {
              conv_id: VALID_CONV_ID,
              identity_id: "ident-1",
              channel: "telegram",
              account_id: "bot-1",
              chat_id: "12345",
              conv_status: "active",
              sender_id: "ident-1",
              channel_account_id: "bot-1",
              sender_external_id: "12345",
              display_name_snapshot: "Pelanggan Alpha",
              verification_status: "verified",
              verified_at: new Date("2026-09-01T00:00:00Z"),
              customer_id: VALID_CUSTOMER_ID,
              cust_id: VALID_CUSTOMER_ID,
              customer_name: "Alpha Corp",
              customer_status: "active",
            },
          ] as unknown as R[],
        };
      }
      // 2. Services query
      if (sql.includes("FROM public.services")) {
        return {
          rows: [
            {
              id: VALID_SERVICE_ID,
              service_code: "SRV-ALPHA",
              status: "active",
            },
          ] as unknown as R[],
        };
      }
      // 3. Episode query
      if (sql.includes("JOIN public.complaints comp")) {
        return {
          rows: [
            {
              episode_id: "ep-1",
              status: "IN_PROGRESS",
              category: "connection_complaint",
              service_id: VALID_SERVICE_ID,
              service_code: "SRV-ALPHA",
              created_at: new Date("2026-10-01T10:00:00Z"),
              updated_at: new Date("2026-10-01T10:05:00Z"),
            },
          ] as unknown as R[],
        };
      }
      // 4. Topology query
      if (sql.includes("FROM public.service_topology st")) {
        return {
          rows: [
            {
              mapping_version: 1,
              source: "MOCK",
              valid_from: new Date("2026-09-01T00:00:00Z"),
              odp_id: "odp-1",
              odp_code: "ODP-DUMMY-01",
              odc_id: "odc-1",
              odc_code: "ODC-DUMMY-01",
            },
          ] as unknown as R[],
        };
      }
      // 5. Triage assessment query
      if (sql.includes("public.triage_assessments")) {
        return {
          rows: [
            {
              message_id: "msg-1",
              decision: {
                evaluatedAt: "2026-10-01T10:00:05Z",
                ruleVersion: "rule-v1",
                outcome: "candidate",
                reason: "los_area",
                candidateTemplateKey: "LOS_AREA",
                effectiveTemplateKey: "LOS_AREA",
                incidentId: null,
                eventIds: ["EVT-100"],
                notes: ["LOS_RATIO_EXCEEDED"],
                automation: { mode: "SHADOW", disposition: "blocked", blockedReasons: ["shadow_mode"] },
                evidence: [
                  { kind: "onu", status: "LOS", observedAt: "2026-10-01T10:00:00Z", eventId: "EVT-100" },
                  { kind: "area", scope: "ODP", scopeId: "odp-1", total: 10, valid: 8, los: 4, coverage: 0.8, losRatio: 0.5 },
                ],
              },
              processing_result: {
                providerQuality: { source: "MOCK", outcome: "ok" },
              },
              created_at: new Date("2026-10-01T10:00:05Z"),
            },
          ] as unknown as R[],
        };
      }
      // 6. Incidents query
      if (sql.includes("FROM public.incidents")) {
        return {
          rows: [
            {
              id: "inc-1",
              type: "AREA_SPECIFIC",
              status: "ACTIVE",
              odp_ids: ["odp-1"],
              odc_ids: [],
              version: 2,
            },
          ] as unknown as R[],
        };
      }
      return { rows: [] };
    },
  };

  const context = await getInboxConversationContext(db, VALID_STAFF_ID, VALID_CONV_ID);
  assert.ok(context);
  assert.equal(context.conversationId, VALID_CONV_ID);
  assert.equal(context.sender.displayName, "Pelanggan Alpha");
  assert.equal(context.sender.verificationStatus, "verified");

  // Identity resolution verified single service
  assert.equal(context.identityResolution.outcome, "resolved");
  assert.equal(context.identityResolution.reason, "verified_single_service");
  assert.equal(context.service?.serviceCode, "SRV-ALPHA");

  // Topology mapping
  assert.ok(context.topology);
  assert.equal(context.topology.odpCode, "ODP-DUMMY-01");
  assert.equal(context.topology.odcCode, "ODC-DUMMY-01");
  assert.equal(context.topology.mappingVersion, 1);

  // Historical assessment
  assert.ok(context.historicalAssessment);
  assert.equal(context.historicalAssessment.reason, "los_area");
  assert.equal(context.historicalAssessment.evidence.length, 2);
  assert.equal(context.historicalAssessment.evidence[0].kind, "onu");
  assert.equal(context.historicalAssessment.evidence[1].kind, "area");

  // Active incident matched by area
  assert.ok(context.activeIncident);
  assert.equal(context.activeIncident.id, "inc-1");
  assert.equal(context.activeIncident.type, "AREA_SPECIFIC");
});

test("Inbox Context Service: handles unverified identity safely without choosing arbitrary service", async () => {
  const db: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
      if (sql.includes("FROM public.conversations c")) {
        return {
          rows: [
            {
              conv_id: VALID_CONV_ID,
              identity_id: "ident-unverified",
              channel: "telegram",
              account_id: "bot-1",
              chat_id: "99999",
              conv_status: "active",
              sender_id: "ident-unverified",
              channel_account_id: "bot-1",
              sender_external_id: "99999",
              display_name_snapshot: "Unknown User",
              verification_status: "unverified",
              verified_at: null,
              customer_id: null,
              cust_id: null,
              customer_name: null,
              customer_status: null,
            },
          ] as unknown as R[],
        };
      }
      return { rows: [] };
    },
  };

  const context = await getInboxConversationContext(db, VALID_STAFF_ID, VALID_CONV_ID);
  assert.ok(context);
  assert.equal(context.identityResolution.outcome, "manual");
  assert.equal(context.identityResolution.reason, "unverified");
  assert.equal(context.service, null);
  assert.equal(context.topology, null);
  assert.equal(context.historicalAssessment, null);
});

test("Inbox Context Service: handles ambiguous multiple services safely without falling back to latest episode", async () => {
  const db: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
      if (sql.includes("FROM public.conversations c")) {
        return {
          rows: [
            {
              conv_id: VALID_CONV_ID,
              identity_id: "ident-2",
              channel: "telegram",
              account_id: "bot-1",
              chat_id: "22222",
              conv_status: "active",
              sender_id: "ident-2",
              channel_account_id: "bot-1",
              sender_external_id: "22222",
              display_name_snapshot: "Multi Service Customer",
              verification_status: "verified",
              verified_at: new Date("2026-09-01T00:00:00Z"),
              customer_id: VALID_CUSTOMER_ID,
              cust_id: VALID_CUSTOMER_ID,
              customer_name: "Multi Customer",
              customer_status: "active",
            },
          ] as unknown as R[],
        };
      }
      if (sql.includes("FROM public.services")) {
        return {
          rows: [
            { id: "srv-1", service_code: "SRV-HOME", status: "active" },
            { id: "srv-2", service_code: "SRV-OFFICE", status: "active" },
          ] as unknown as R[],
        };
      }
      // Episode previously had srv-1
      if (sql.includes("JOIN public.complaints comp")) {
        return {
          rows: [
            {
              episode_id: "ep-prev",
              status: "IN_PROGRESS",
              category: "connection_complaint",
              service_id: "srv-1",
              service_code: "SRV-HOME",
              created_at: new Date("2026-10-01T10:00:00Z"),
              updated_at: new Date("2026-10-01T10:05:00Z"),
            },
          ] as unknown as R[],
        };
      }
      return { rows: [] };
    },
  };

  const context = await getInboxConversationContext(db, VALID_STAFF_ID, VALID_CONV_ID);
  assert.ok(context);
  assert.equal(context.identityResolution.outcome, "manual");
  assert.equal(context.identityResolution.reason, "multiple_services");
  // Review Group 3: Must NOT fallback to latestEpisode.serviceId when domain resolution is manual
  assert.equal(context.service, null);
  assert.equal(context.topology, null);
  assert.equal(context.candidateServices.length, 2);
  assert.equal(context.latestEpisode?.serviceId, "srv-1");
});

test("Inbox Context Route (GET): enforces session and returns 401 when unauthenticated", async () => {
  const req = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/context");
  const response = await getContextRoute(req, { params: Promise.resolve({ id: VALID_CONV_ID }) }, {
    getAuthClient: async () => ({
      auth: { getUser: async () => ({ data: { user: null }, error: new Error("no session") }) },
    }),
  });

  assert.equal(response.status, 401);
  const json = await response.json();
  assert.equal(json.success, false);
  assert.equal(json.error.code, "UNAUTHENTICATED");
});

test("Inbox Context Route (GET): returns 400 for invalid UUID", async () => {
  const req = new Request("http://localhost/api/inbox/conversations/not-a-uuid/context");
  const response = await getContextRoute(req, { params: Promise.resolve({ id: "not-a-uuid" }) }, {
    getAuthClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: VALID_STAFF_ID } }, error: null }) },
    }),
  });

  assert.equal(response.status, 400);
  const json = await response.json();
  assert.equal(json.error.code, "INVALID_PARAMETER");
});

test("Inbox Network Check Route: returns 503 PROVIDER_DISABLED when NETWORK_PROVIDER is not mock before auth, pool, or admin client (GET and POST)", async () => {
  const restorer = new EnvRestorer();
  try {
    delete process.env.NETWORK_PROVIDER;
    let authCallCount = 0;
    let poolCallCount = 0;
    let supabaseCallCount = 0;

    const deps = {
      getAuthClient: async () => {
        authCallCount++;
        return {
          auth: { getUser: async () => ({ data: { user: { id: VALID_STAFF_ID } }, error: null }) },
        };
      },
      getPool: () => {
        poolCallCount++;
        return {} as Queryable;
      },
      getSupabaseClient: async () => {
        supabaseCallCount++;
        return {} as SupabaseClient<Database>;
      },
    };

    // Test POST
    const postReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "POST",
    });
    const postRes = await postNetworkCheckRoute(postReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(postRes.status, 503);
    const postJson = await postRes.json();
    assert.equal(postJson.error.code, "PROVIDER_DISABLED");

    // Test GET
    const getReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "GET",
    });
    const getRes = await getNetworkCheckRoute(getReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(getRes.status, 503);
    const getJson = await getRes.json();
    assert.equal(getJson.error.code, "PROVIDER_DISABLED");

    assert.equal(authCallCount, 0, "Auth client must NOT be called when provider disabled");
    assert.equal(poolCallCount, 0, "Pool must NOT be called when provider disabled");
    assert.equal(supabaseCallCount, 0, "Admin client must NOT be called when provider disabled");
  } finally {
    restorer.restore();
  }
});

test("Inbox Network Check Route: rejects unauthenticated requests with 401 before admin client or pool are invoked (GET and POST)", async () => {
  const restorer = new EnvRestorer();
  try {
    process.env.NETWORK_PROVIDER = "mock";
    let poolCallCount = 0;
    let supabaseCallCount = 0;

    const deps = {
      getAuthClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
      getPool: () => {
        poolCallCount++;
        return {} as Queryable;
      },
      getSupabaseClient: async () => {
        supabaseCallCount++;
        return {} as SupabaseClient<Database>;
      },
    };

    // Test POST
    const postReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "POST",
    });
    const postRes = await postNetworkCheckRoute(postReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(postRes.status, 401);
    const postJson = await postRes.json();
    assert.equal(postJson.error.code, "UNAUTHENTICATED");

    // Test GET
    const getReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "GET",
    });
    const getRes = await getNetworkCheckRoute(getReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(getRes.status, 401);
    const getJson = await getRes.json();
    assert.equal(getJson.error.code, "UNAUTHENTICATED");

    assert.equal(poolCallCount, 0, "Pool must NOT be called for unauthenticated requests");
    assert.equal(supabaseCallCount, 0, "Admin client must NOT be called for unauthenticated requests");
  } finally {
    restorer.restore();
  }
});

test("Inbox Network Check Route: rejects invalid session/auth error with 401 before admin client or pool are invoked (GET and POST)", async () => {
  const restorer = new EnvRestorer();
  try {
    process.env.NETWORK_PROVIDER = "mock";
    let poolCallCount = 0;
    let supabaseCallCount = 0;

    const deps = {
      getAuthClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: new Error("JWT expired or invalid") }) },
      }),
      getPool: () => {
        poolCallCount++;
        return {} as Queryable;
      },
      getSupabaseClient: async () => {
        supabaseCallCount++;
        return {} as SupabaseClient<Database>;
      },
    };

    // Test POST
    const postReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "POST",
    });
    const postRes = await postNetworkCheckRoute(postReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(postRes.status, 401);
    const postJson = await postRes.json();
    assert.equal(postJson.error.code, "UNAUTHENTICATED");

    // Test GET
    const getReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "GET",
    });
    const getRes = await getNetworkCheckRoute(getReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(getRes.status, 401);
    const getJson = await getRes.json();
    assert.equal(getJson.error.code, "UNAUTHENTICATED");

    assert.equal(poolCallCount, 0, "Pool must NOT be called when session is invalid");
    assert.equal(supabaseCallCount, 0, "Admin client must NOT be called when session is invalid");
  } finally {
    restorer.restore();
  }
});

test("Inbox Network Check Route: allows authenticated staff to invoke mock check through authorized admin client with session actor (GET and POST)", async () => {
  const restorer = new EnvRestorer();
  try {
    process.env.NETWORK_PROVIDER = "mock";
    let poolCallCount = 0;
    let supabaseCallCount = 0;

    const mockDb: Queryable = {
      query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
        if (sql.includes("FROM public.conversations c")) {
          return {
            rows: [
              {
                conv_id: VALID_CONV_ID,
                identity_id: "ident-unverified",
                channel: "telegram",
                account_id: "bot-1",
                chat_id: "99999",
                conv_status: "active",
                sender_id: "ident-unverified",
                channel_account_id: "bot-1",
                sender_external_id: "99999",
                display_name_snapshot: "Unknown User",
                verification_status: "unverified",
                verified_at: null,
                customer_id: null,
                cust_id: null,
                customer_name: null,
                customer_status: null,
              },
            ] as unknown as R[],
          };
        }
        return { rows: [] };
      },
    };

    const deps = {
      getAuthClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: VALID_STAFF_ID } }, error: null }) },
      }),
      getPool: () => {
        poolCallCount++;
        return mockDb;
      },
      getSupabaseClient: async () => {
        supabaseCallCount++;
        return {} as SupabaseClient<Database>;
      },
    };

    // Test POST
    const postReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "normal" }),
    });
    const postRes = await postNetworkCheckRoute(postReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.success, true);
    assert.equal(postJson.data.outcome, "unresolved");

    // Test GET
    const getReq = new Request("http://localhost/api/inbox/conversations/" + VALID_CONV_ID + "/network-check?scenario=normal", {
      method: "GET",
    });
    const getRes = await getNetworkCheckRoute(getReq, { params: Promise.resolve({ id: VALID_CONV_ID }) }, deps);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.success, true);
    assert.equal(getJson.data.outcome, "unresolved");

    assert.equal(poolCallCount, 2, "Pool must be called exactly once per authorized request");
    assert.equal(supabaseCallCount, 2, "Admin client must be called exactly once per authorized request");
  } finally {
    restorer.restore();
  }
});

test("Inbox Network Check Service: safe unresolved result when service cannot be resolved", async () => {
  const db: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
      if (sql.includes("FROM public.conversations c")) {
        return {
          rows: [
            {
              conv_id: VALID_CONV_ID,
              identity_id: "ident-unverified",
              channel: "telegram",
              account_id: "bot-1",
              chat_id: "99999",
              conv_status: "active",
              sender_id: "ident-unverified",
              channel_account_id: "bot-1",
              sender_external_id: "99999",
              display_name_snapshot: "Unknown User",
              verification_status: "unverified",
              verified_at: null,
              customer_id: null,
              cust_id: null,
              customer_name: null,
              customer_status: null,
            },
          ] as unknown as R[],
        };
      }
      return { rows: [] };
    },
  };

  const dummySupabaseClient = {} as unknown as SupabaseClient<Database>;
  const result = await executeInboxNetworkCheck(dummySupabaseClient, db, VALID_STAFF_ID, VALID_CONV_ID);

  assert.equal(result.outcome, "unresolved");
  assert.equal(result.reason, "unverified");
  assert.equal(result.onu.status, "unknown");
});

test("Inbox Network Check Service: derives conservative oldest observedAt from staggered area members", async () => {
  const db: Queryable = {
    query: async <R extends QueryResultRow = QueryResultRow>(sql: string) => {
      // 1. Conversation query
      if (sql.includes("FROM public.conversations c")) {
        return {
          rows: [
            {
              conv_id: VALID_CONV_ID,
              identity_id: "ident-1",
              channel: "telegram",
              account_id: "bot-1",
              chat_id: "12345",
              conv_status: "active",
              sender_id: "ident-1",
              channel_account_id: "bot-1",
              sender_external_id: "12345",
              display_name_snapshot: "Pelanggan Alpha",
              verification_status: "verified",
              verified_at: new Date("2026-09-01T00:00:00Z"),
              customer_id: VALID_CUSTOMER_ID,
              cust_id: VALID_CUSTOMER_ID,
              customer_name: "Alpha Corp",
              customer_status: "active",
            },
          ] as unknown as R[],
        };
      }
      // 2. Services query
      if (sql.includes("FROM public.services")) {
        return {
          rows: [
            {
              id: VALID_SERVICE_ID,
              service_code: "SRV-ALPHA",
              status: "active",
            },
          ] as unknown as R[],
        };
      }
      return { rows: [] };
    },
  };

  const dummySupabaseClient = {} as unknown as SupabaseClient<Database>;

  const newerTimestamp = "2026-10-01T10:04:00.000Z";
  const olderTimestamp = "2026-10-01T09:58:00.000Z";

  const mockInspector = async () => ({
    outcome: "ok" as const,
    reason: null,
    source: "MOCK" as const,
    scenarioId: "custom_scenario",
    customerId: VALID_CUSTOMER_ID,
    serviceId: VALID_SERVICE_ID,
    checkedAt: "2026-10-01T10:04:30.000Z",
    mapping: null,
    onu: {
      status: "online" as const,
      reportedStatus: "online" as const,
      quality: "fresh" as const,
      observedAt: newerTimestamp,
      eventId: "EVT-ONU-1",
      source: "MOCK" as const,
    },
    upstream: [],
    upstreamQuality: "ok" as const,
    indicatedArea: { scope: "ODP" as const, scopeId: "odp-1" },
    areas: [
      {
        scope: "ODP" as const,
        scopeId: "odp-1",
        state: "indicated" as const,
        total: 2,
        valid: 2,
        los: 1,
        coverage: 1.0,
        losRatio: 0.5,
        thresholdVersion: "mock-v1",
        members: [
          {
            serviceId: VALID_SERVICE_ID,
            mappingVersion: 1,
            observation: {
              status: "online" as const,
              reportedStatus: "online" as const,
              quality: "fresh" as const,
              observedAt: newerTimestamp,
              eventId: "EVT-1",
              source: "MOCK" as const,
            },
          },
          {
            serviceId: "srv-other",
            mappingVersion: 1,
            observation: {
              status: "LOS" as const,
              reportedStatus: "LOS" as const,
              quality: "fresh" as const,
              observedAt: olderTimestamp,
              eventId: "EVT-2",
              source: "MOCK" as const,
            },
          },
        ],
      },
    ],
  });

  const result = await executeInboxNetworkCheck(
    dummySupabaseClient,
    db,
    VALID_STAFF_ID,
    VALID_CONV_ID,
    "custom_scenario",
    mockInspector
  );

  assert.equal(result.outcome, "ok");
  assert.equal(result.areas.length, 1);
  assert.equal(result.areas[0].observedAt, olderTimestamp);
});

