import { describe, it } from "node:test";
import assert from "node:assert";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import {
  validateDiagnosticTargets,
  executeDiagnosticMarkerCheck,
  handleDiagnosticRuntimeCheck,
} from "../../lib/application/diagnostic-target-validator";
import { POST, handleDiagnosticWebhookRequest } from "../../app/api/webhooks/telegram/route";
import { EnvRestorer } from "../utils/test-guard";

interface MockPoolOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
}

function createMockPool(
  options: MockPoolOptions,
  queryImpl?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
) {
  let queryCallCount = 0;
  const pool = {
    options,
    query: async (sql: string, params?: unknown[]) => {
      queryCallCount++;
      if (queryImpl) return queryImpl(sql, params);
      return { rows: [] };
    },
    getQueryCallCount: () => queryCallCount,
  };
  return pool as unknown as Pool & { getQueryCallCount: () => number };
}

function createMockClient(
  supabaseUrl: string,
  selectImpl?: (id: string) => Promise<{ data: unknown; error: unknown }>
) {
  let fromCallCount = 0;
  const client = {
    supabaseUrl,
    from: () => {
      fromCallCount++;
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              if (selectImpl) return selectImpl(val);
              return { data: null, error: null };
            },
          }),
        }),
      };
    },
    getFromCallCount: () => fromCallCount,
  };
  return client as unknown as SupabaseClient<Database> & { getFromCallCount: () => number };
}

function createDiagnosticRequest(secretToken: string = "valid-secret-123"): Request {
  return new Request("http://127.0.0.1:3000/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-runtime-check": "true",
      "x-telegram-bot-api-secret-token": secretToken,
    },
    body: JSON.stringify({}),
  });
}

describe("Diagnostic Target & Marker Validation (Unit & Negative Proof)", () => {
  const baseEnv: Record<string, string | undefined> = {
    TELEGRAM_WEBHOOK_SECRET: "valid-secret-123",
    HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
    HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
    HELPDESK_TEST_ENV_MARKER: "test_marker_token",
  };

  it("Target PostgreSQL runtime berbeda dari konfigurasi tes: ditolak sebelum query diagnostik", async () => {
    // Config expects port 54332, but pool is configured to port 54333
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54333/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const targetDirect = validateDiagnosticTargets(pool, client, baseEnv);
    assert.strictEqual(targetDirect.ok, false);
    assert.strictEqual(targetDirect.code, "TEST_TARGET_MISMATCH");

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_TARGET_MISMATCH");

    // Factual proof: 0 database queries and 0 API requests occurred
    assert.strictEqual(pool.getQueryCallCount(), 0, "Query PostgreSQL tidak boleh dijalankan saat target mismatch");
    assert.strictEqual(client.getFromCallCount(), 0, "Query API tidak boleh dijalankan saat target mismatch");
  });

  it("Endpoint API runtime berbeda dari konfigurasi tes: ditolak sebelum query diagnostik", async () => {
    // Config expects API port 54331, but client is connected to port 54339
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54339");

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_TARGET_MISMATCH");

    // Factual proof: 0 database queries and 0 API requests occurred
    assert.strictEqual(pool.getQueryCallCount(), 0, "Query PostgreSQL tidak boleh dijalankan saat target mismatch");
    assert.strictEqual(client.getFromCallCount(), 0, "Query API tidak boleh dijalankan saat target mismatch");
  });

  it("Pool yang sudah tersimpan tetap dinilai berdasarkan target efektifnya meskipun environment berubah", async () => {
    // Pool was instantiated with port 54332 in its options
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    // Now pretend environment was mutated to point to 54339
    const mutatedEnv: Record<string, string | undefined> = {
      ...baseEnv,
      HELPDESK_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54339/postgres",
      HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54339/postgres",
    };

    // Even though HELPDESK_DATABASE_URL matches HELPDESK_TEST_DATABASE_URL, the stored pool itself is on 54332!
    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, mutatedEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_TARGET_MISMATCH");

    // Factual proof: 0 queries
    assert.strictEqual(pool.getQueryCallCount(), 0);
  });

  it("Pemeriksaan port database tidak bergantung pada hostname API: DB port 5432 loopback ditolak pada remote API", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    });
    const client = createMockClient("https://api.upaznet.test");

    const envWithRemoteApi: Record<string, string | undefined> = {
      ...baseEnv,
      HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      HELPDESK_TEST_API_URL: "https://api.upaznet.test",
    };

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, envWithRemoteApi);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, "TEST_TARGET_INVALID");
    assert.strictEqual(pool.getQueryCallCount(), 0);
  });

  it("Pemeriksaan port database tidak bergantung pada hostname API: API port 54321 loopback ditolak pada remote DB", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@remote-db.upaznet.test:5432/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54321");

    const envWithRemoteDb: Record<string, string | undefined> = {
      ...baseEnv,
      HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@remote-db.upaznet.test:5432/postgres",
      HELPDESK_TEST_API_URL: "http://127.0.0.1:54321",
    };

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, envWithRemoteDb);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, "TEST_TARGET_INVALID");
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Pemeriksaan hostname IPv6: loopback [::1] dengan port 5432 ditolak sebagai port default dev", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@[::1]:5432/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const ipv6Env: Record<string, string | undefined> = {
      ...baseEnv,
      HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@[::1]:5432/postgres",
    };

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, ipv6Env);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, "TEST_TARGET_INVALID");
    assert.strictEqual(pool.getQueryCallCount(), 0);
  });

  it("Marker tidak ditemukan: gagal tanpa mengembalikan metadata diagnostik", async () => {
    // Targets match
    const pool = createMockPool(
      { connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres" },
      async () => ({ rows: [] }) // Empty rows -> not found in DB
    );
    const client = createMockClient("http://127.0.0.1:54331", async () => ({
      data: { description: "some_token" },
      error: null,
    }));

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_MARKER_NOT_FOUND");
    // Proof that no endpoint or marker metadata was leaked
    assert.strictEqual(body.apiEndpoint, undefined);
    assert.strictEqual(body.dbMarker, undefined);
  });

  it("Token marker PostgreSQL/API berbeda: gagal tanpa mengembalikan metadata", async () => {
    const pool = createMockPool(
      { connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres" },
      async () => ({ rows: [{ description: "token_from_postgres" }] })
    );
    const client = createMockClient("http://127.0.0.1:54331", async () => ({
      data: { description: "token_from_supabase_api_different" },
      error: null,
    }));

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_MARKER_MISMATCH");
    assert.strictEqual(body.apiEndpoint, undefined);
  });

  it("Target dan marker yang sesuai tetap menghasilkan verifikasi berhasil", async () => {
    const matchedToken = "ISOLATION_MARKER_MATCHED_100";
    const pool = createMockPool(
      { connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres" },
      async () => ({ rows: [{ description: matchedToken }] })
    );
    const client = createMockClient("http://127.0.0.1:54331", async () => ({
      data: { description: matchedToken },
      error: null,
    }));

    const markerDirect = await executeDiagnosticMarkerCheck(pool, client, "test_marker_token");
    assert.strictEqual(markerDirect.ok, true);
    assert.strictEqual(markerDirect.dbMarker, matchedToken);
    assert.strictEqual(markerDirect.apiMarker, matchedToken);

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.error, null);
    assert.strictEqual(body.data.verified, true);
    assert.strictEqual(body.data.dbMarker, matchedToken);
    assert.strictEqual(body.data.apiMarker, matchedToken);
    assert.strictEqual(body.data.apiEndpoint, "http://127.0.0.1:54331");
  });

  it("Autentikasi secret salah ditolak sebelum pemeriksaan target atau kueri", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const req = createDiagnosticRequest("wrong-secret-token");
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "UNAUTHORIZED");

    assert.strictEqual(pool.getQueryCallCount(), 0);
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Target konfigurasi pengujian tidak memakai variabel runtime utama sebagai fallback", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    // Only runtime env vars present; HELPDESK_TEST_* missing
    const runtimeOnlyEnv: Record<string, string | undefined> = {
      TELEGRAM_WEBHOOK_SECRET: "valid-secret-123",
      HELPDESK_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
      SUPABASE_URL: "http://127.0.0.1:54331",
      // HELPDESK_TEST_DATABASE_URL, HELPDESK_TEST_API_URL, HELPDESK_TEST_ENV_MARKER are intentionally omitted
    };

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, runtimeOnlyEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, "TEST_CONFIG_INCOMPLETE");

    assert.strictEqual(pool.getQueryCallCount(), 0);
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Target PostgreSQL dengan parameter query pengganti port terlarang (?port=5432): ditolak sebelum query dengan 0 query PG dan 0 call API", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?port=5432",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.ok(body.error.code === "TEST_TARGET_INVALID" || body.error.code === "TEST_TARGET_MISMATCH");

    assert.strictEqual(pool.getQueryCallCount(), 0);
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Target PostgreSQL dengan parameter query pengganti host (?host=evil.com): ditolak sebelum query dengan 0 query PG dan 0 call API", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?host=evil.com",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_TARGET_MISMATCH");

    assert.strictEqual(pool.getQueryCallCount(), 0);
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Target PostgreSQL dengan parameter query pengganti port tidak cocok (?port=54339): ditolak sebelum query dengan 0 query PG dan 0 call API", async () => {
    const pool = createMockPool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?port=54339",
    });
    const client = createMockClient("http://127.0.0.1:54331");

    const req = createDiagnosticRequest();
    const res = await handleDiagnosticRuntimeCheck(req, pool, client, baseEnv);

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.data, null);
    assert.strictEqual(body.error.code, "TEST_TARGET_MISMATCH");

    assert.strictEqual(pool.getQueryCallCount(), 0);
    assert.strictEqual(client.getFromCallCount(), 0);
  });

  it("Boundary route: Secret salah ketika konfigurasi runtime tidak lengkap tetap 401 dan factory tidak dipanggil", async () => {
    const envRestorer = new EnvRestorer();
    envRestorer.save([
      "ENABLE_TEST_RUNTIME_DIAGNOSTICS",
      "TELEGRAM_WEBHOOK_SECRET",
      "HELPDESK_DATABASE_URL",
      "HELPDESK_TEST_DATABASE_URL",
    ]);

    try {
      process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS = "true";
      process.env.TELEGRAM_WEBHOOK_SECRET = "configured-secret-key-123";
      delete process.env.HELPDESK_DATABASE_URL; // Incomplete runtime config
      delete process.env.HELPDESK_TEST_DATABASE_URL; // Incomplete test config

      let poolFactoryCalled = false;
      let clientFactoryCalled = false;

      const req = new Request("http://127.0.0.1:3000/api/webhooks/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-runtime-check": "true",
          "x-telegram-bot-api-secret-token": "wrong-secret-token",
        },
        body: JSON.stringify({}),
      });

      // 1. Direct call to POST route entrypoint:
      // defaultPoolFactory would throw if called because HELPDESK_DATABASE_URL is missing.
      // Returning 401 proves defaultPoolFactory was NEVER called.
      const resPost = await POST(req);
      assert.strictEqual(resPost.status, 401);
      const bodyPost = await resPost.json();
      assert.strictEqual(bodyPost.success, false);
      assert.strictEqual(bodyPost.error.code, "UNAUTHORIZED");

      // 2. Explicit spy factories passed to handleDiagnosticWebhookRequest:
      const res = await handleDiagnosticWebhookRequest(req, {
        getPool: () => {
          poolFactoryCalled = true;
          throw new Error("Should not be called");
        },
        getClient: () => {
          clientFactoryCalled = true;
          throw new Error("Should not be called");
        },
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "UNAUTHORIZED");
      assert.strictEqual(poolFactoryCalled, false);
      assert.strictEqual(clientFactoryCalled, false);
    } finally {
      envRestorer.restore();
    }
  });

  it("Boundary route: Secret dengan panjang karakter sama tetapi panjang byte UTF-8 berbeda ditolak tanpa exception", async () => {
    const envRestorer = new EnvRestorer();
    envRestorer.save([
      "ENABLE_TEST_RUNTIME_DIAGNOSTICS",
      "TELEGRAM_WEBHOOK_SECRET",
    ]);

    try {
      process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS = "true";
      // "secret123" is 9 characters and 9 bytes
      process.env.TELEGRAM_WEBHOOK_SECRET = "secret123";

      // "secret12\u00E9" is 9 characters but 10 bytes in UTF-8
      const multiByteSecret = "secret12\u00E9";
      assert.strictEqual(multiByteSecret.length, "secret123".length);
      assert.notStrictEqual(Buffer.byteLength(multiByteSecret, "utf8"), Buffer.byteLength("secret123", "utf8"));

      let factoryCalled = false;
      const req = new Request("http://127.0.0.1:3000/api/webhooks/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-runtime-check": "true",
          "x-telegram-bot-api-secret-token": multiByteSecret,
        },
        body: JSON.stringify({}),
      });

      const res = await handleDiagnosticWebhookRequest(req, {
        getPool: () => { factoryCalled = true; throw new Error("Should not be called"); },
        getClient: () => { factoryCalled = true; throw new Error("Should not be called"); },
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "UNAUTHORIZED");
      assert.strictEqual(factoryCalled, false);
    } finally {
      envRestorer.restore();
    }
  });

  it("Boundary route: Secret valid dengan kegagalan factory terkontrol menghasilkan respons gagal standar tanpa bocor detail", async () => {
    const envRestorer = new EnvRestorer();
    envRestorer.save([
      "ENABLE_TEST_RUNTIME_DIAGNOSTICS",
      "TELEGRAM_WEBHOOK_SECRET",
    ]);

    try {
      process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS = "true";
      process.env.TELEGRAM_WEBHOOK_SECRET = "valid-secret-123";

      const req = new Request("http://127.0.0.1:3000/api/webhooks/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-runtime-check": "true",
          "x-telegram-bot-api-secret-token": "valid-secret-123",
        },
        body: JSON.stringify({}),
      });

      const res = await handleDiagnosticWebhookRequest(req, {
        getPool: () => {
          throw new Error("FATAL: connection failed postgresql://super_secret_user:super_secret_password@127.0.0.1:5432/db");
        },
        getClient: () => {
          throw new Error("Should not reach client");
        },
      });

      assert.strictEqual(res.status, 500);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.data, null);
      assert.strictEqual(body.error.code, "INITIALIZATION_FAILED");
      assert.strictEqual(body.error.message, "Layanan database atau API runtime tidak tersedia.");

      const raw = JSON.stringify(body);
      assert.strictEqual(raw.includes("super_secret_user"), false);
      assert.strictEqual(raw.includes("super_secret_password"), false);
      assert.strictEqual(raw.includes("5432"), false);
      assert.strictEqual(raw.includes("FATAL"), false);
      assert.strictEqual(raw.includes("stack"), false);
    } finally {
      envRestorer.restore();
    }
  });

  it("Boundary route: Jalur diagnostik sah tetap berfungsi melalui route", async () => {
    const envRestorer = new EnvRestorer();
    envRestorer.save([
      "ENABLE_TEST_RUNTIME_DIAGNOSTICS",
      "TELEGRAM_WEBHOOK_SECRET",
      "HELPDESK_TEST_ENV_MARKER",
      "HELPDESK_TEST_DATABASE_URL",
      "HELPDESK_TEST_API_URL",
    ]);

    try {
      process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS = "true";
      process.env.TELEGRAM_WEBHOOK_SECRET = "valid-secret-123";
      process.env.HELPDESK_TEST_ENV_MARKER = "test_marker_token";
      process.env.HELPDESK_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54332/postgres";
      process.env.HELPDESK_TEST_API_URL = "http://127.0.0.1:54331";

      const matchedToken = "ISOLATION_MARKER_ROUTE_OK";
      const pool = createMockPool(
        { connectionString: "postgresql://postgres:postgres@127.0.0.1:54332/postgres" },
        async () => ({ rows: [{ description: matchedToken }] })
      );
      const client = createMockClient("http://127.0.0.1:54331", async () => ({
        data: { description: matchedToken },
        error: null,
      }));

      const req = new Request("http://127.0.0.1:3000/api/webhooks/telegram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-runtime-check": "true",
          "x-telegram-bot-api-secret-token": "valid-secret-123",
        },
        body: JSON.stringify({}),
      });

      const res = await handleDiagnosticWebhookRequest(req, {
        getPool: () => pool,
        getClient: () => client,
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.verified, true);
      assert.strictEqual(body.data.dbMarker, matchedToken);
      assert.strictEqual(body.data.apiMarker, matchedToken);
    } finally {
      envRestorer.restore();
    }
  });
});
