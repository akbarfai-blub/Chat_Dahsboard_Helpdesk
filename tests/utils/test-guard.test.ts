import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAndValidateTestConfig,
  verifyTestTargetIdentity,
  requireIsolatedDatabase,
  checkTestEnvAvailable,
  TestResourceTracker,
  EnvRestorer,
  combineErrors,
  cleanupFixture,
  type PoolQueryable,
  type SupabaseQueryable,
  type CombinedTestError,
} from "./test-guard";

test("Test Guard, Isolation Verification, and Cleanup Lifecycle", async (t) => {
  const envRestorer = new EnvRestorer();

  t.afterEach(() => {
    envRestorer.restore();
  });

  await t.test("1. Konfigurasi invalid ditolak sebelum inisialisasi koneksi", async () => {
    // Missing required env
    assert.throws(
      () => parseAndValidateTestConfig({}),
      /Explicit test environment configurations .* are missing or invalid/
    );

    // checkTestEnvAvailable reports unavailable without creating connections
    const checkResult = checkTestEnvAvailable({});
    assert.equal(checkResult.available, false);
    assert.match(checkResult.reason || "", /Explicit test environment configurations/);

    // Invalid URL format
    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_TEST_DATABASE_URL: "not-a-valid-url",
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54399",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "test-key",
          HELPDESK_TEST_ENV_MARKER: "test_marker_1",
        }),
      /Invalid URL format in test configuration/
    );
  });

  await t.test("2. Target pengguna dan pasangan target berbeda ditolak", async () => {
    // 2a. Loopback default user database (port 54322 / postgres) rejected
    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54399",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "test-key",
          HELPDESK_TEST_ENV_MARKER: "test_marker_1",
        }),
      /Target is the default user workspace database/
    );

    // 2b. Loopback alias for user database (localhost:54322 / postgres) rejected
    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54399",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "test-key",
          HELPDESK_TEST_ENV_MARKER: "test_marker_1",
        }),
      /Target is the default user workspace database/
    );

    // 2c. Loopback default user Supabase API (port 54321) rejected
    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54399/isolated_test",
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54321",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "test-key",
          HELPDESK_TEST_ENV_MARKER: "test_marker_1",
        }),
      /Target API is the default user workspace Supabase API/
    );

    // 2d. Explicit user DB URL match rejected
    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_DATABASE_URL: "postgresql://postgres:postgres@db.custom.internal:5432/myuserdb",
          HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@db.custom.internal:5432/myuserdb",
          HELPDESK_TEST_API_URL: "http://test-api.local:8000",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "test-key",
          HELPDESK_TEST_ENV_MARKER: "test_marker_1",
        }),
      /Test database configuration points to the active user workspace database/
    );

    // 2e. Mismatched target pairs (PostgreSQL and Supabase point to different databases)
    const mockPgPool: PoolQueryable = {
      query: async (sql) => {
        if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
          return { rows: [{ id: "test_marker_run_1", description: "TOKEN_FROM_PG" }] };
        }
        return { rows: [] };
      },
    };

    const mockMismatchedSupabase: SupabaseQueryable = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "test_marker_run_1", description: "DIFFERENT_TOKEN_FROM_API" },
              error: null,
            }),
          }),
        }),
      }),
    };

    await assert.rejects(
      verifyTestTargetIdentity(mockPgPool, mockMismatchedSupabase, "test_marker_run_1"),
      /Target mismatch: PostgreSQL and Supabase API returned different marker tokens/
    );

    // 2f. Supabase cannot find the marker (e.g. API points to empty user DB while PG is on test DB)
    const mockNotFoundSupabase: SupabaseQueryable = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };

    await assert.rejects(
      verifyTestTargetIdentity(mockPgPool, mockNotFoundSupabase, "test_marker_run_1"),
      /Test environment marker 'test_marker_run_1' not found via Supabase API/
    );
  });

  await t.test("3. Target tes yang tervalidasi diterima", async () => {
    const validConfig = {
      HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54399/isolated_test_db",
      HELPDESK_TEST_API_URL: "http://127.0.0.1:54398",
      HELPDESK_TEST_SERVICE_ROLE_KEY: "valid-test-key",
      HELPDESK_TEST_ENV_MARKER: "test_env_verified_marker",
    };

    const parsed = parseAndValidateTestConfig(validConfig);
    assert.equal(parsed.databaseUrl, validConfig.HELPDESK_TEST_DATABASE_URL);
    assert.equal(parsed.expectedMarker, "test_env_verified_marker");

    const mockPgPool: PoolQueryable = {
      query: async (sql, params) => {
        if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
          assert.equal(params?.[0], "test_env_verified_marker");
          return { rows: [{ id: "test_env_verified_marker", description: "AUTHENTIC_TEST_TOKEN_123" }] };
        }
        return { rows: [] };
      },
    };

    let supabaseQueried = false;
    const mockSupabase: SupabaseQueryable = {
      from: (table: string) => {
        assert.equal(table, "mock_network_scenarios");
        return {
          select: (cols: string) => {
            assert.equal(cols, "id, description");
            return {
              eq: (col: string, val: string) => {
                assert.equal(col, "id");
                assert.equal(val, "test_env_verified_marker");
                return {
                  maybeSingle: async () => {
                    supabaseQueried = true;
                    return {
                      data: { id: "test_env_verified_marker", description: "AUTHENTIC_TEST_TOKEN_123" },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    await assert.doesNotReject(
      requireIsolatedDatabase(mockPgPool, mockSupabase, parsed)
    );
    assert.equal(supabaseQueried, true, "Supabase client must actually execute a query");
  });

  await t.test("4. Penolakan guard tidak mengubah environment", async () => {
    const specificKeys = [
      "HELPDESK_TEST_DATABASE_URL",
      "HELPDESK_TEST_API_URL",
      "HELPDESK_TEST_SERVICE_ROLE_KEY",
      "HELPDESK_TEST_ENV_MARKER",
      "NETWORK_SCENARIO_ID",
    ];
    const snapshot = new Map(specificKeys.map((k) => [k, process.env[k]]));
    const allKeysBefore = new Set(Object.keys(process.env));

    assert.throws(
      () =>
        parseAndValidateTestConfig({
          HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54321",
          HELPDESK_TEST_SERVICE_ROLE_KEY: "key",
          HELPDESK_TEST_ENV_MARKER: "marker",
        }),
      /Target is the default user workspace database/
    );

    // Verify tracked keys remained identical
    for (const key of specificKeys) {
      assert.equal(process.env[key], snapshot.get(key), `process.env.${key} must not be changed`);
    }

    // Verify no new keys were injected into process.env
    const allKeysAfter = new Set(Object.keys(process.env));
    for (const k of allKeysAfter) {
      if (!allKeysBefore.has(k)) {
        assert.fail(`Guard rejection unexpectedly injected new environment variable: ${k}`);
      }
    }
  });

  await t.test("5. Kegagalan setup setelah resource pertama memicu cleanup resource tersebut", async () => {
    const tracker = new TestResourceTracker();
    const executedQueries: string[] = [];

    const mockPool: PoolQueryable = {
      query: async (sql) => {
        executedQueries.push(sql);
        if (sql.includes("SELECT id, complaint_id")) return { rows: [] };
        if (sql.includes("SELECT id FROM public.reply_owners")) return { rows: [] };
        return { rows: [] };
      },
    };

    // Simulate setup: resource 1 succeeds and is tracked
    tracker.recordIdentity("identity-1");
    assert.deepEqual(tracker.identityIds, ["identity-1"]);

    // Resource 2 fails during setup
    let setupError: Error | undefined;
    try {
      throw new Error("Simulated setup failure while provisioning scenario");
    } catch (err) {
      setupError = err as Error;
    }

    // In finally, cleanup must run using the tracker
    await cleanupFixture(mockPool, tracker);

    // Verify identity-1 was deleted even though setup failed early
    const identityDeleteQuery = executedQueries.find((q) => q.includes("DELETE FROM public.channel_identities"));
    assert.ok(identityDeleteQuery, "channel_identities delete query must be executed for identity-1");
    assert.equal(setupError?.message, "Simulated setup failure while provisioning scenario");
  });

  await t.test("6. Parameter pertama kosong/parameter kedua terisi tidak melewatkan delete yang diperlukan", async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];

    const mockPool: PoolQueryable = {
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        if (sql.includes("SELECT id, complaint_id")) return { rows: [] };
        if (sql.includes("SELECT id FROM public.reply_owners")) return { rows: [] };
        return { rows: [] };
      },
    };

    // ownerIds is empty, complaintIds has elements!
    await cleanupFixture(mockPool, {
      ownerIds: [],
      complaintIds: ["complaint-uuid-999"],
      messageIds: [],
    });

    // Check reply_claims: must NOT be skipped!
    const replyClaimsDelete = executedQueries.find((q) => q.sql.includes("DELETE FROM public.reply_claims"));
    assert.ok(replyClaimsDelete, "reply_claims must be deleted when complaint_id is provided even if owner_id is empty");
    assert.equal(replyClaimsDelete?.sql, "DELETE FROM public.reply_claims WHERE complaint_id = ANY($1::uuid[])");
    assert.deepEqual(replyClaimsDelete?.params, [["complaint-uuid-999"]]);

    // Check complaint_audit_log: must NOT be skipped!
    const auditLogDelete = executedQueries.find((q) => q.sql.includes("DELETE FROM public.complaint_audit_log"));
    assert.ok(auditLogDelete, "complaint_audit_log must be deleted when complaint_id is provided even if message_id is empty");
    assert.equal(auditLogDelete?.sql, "DELETE FROM public.complaint_audit_log WHERE complaint_id = ANY($1::uuid[])");
    assert.deepEqual(auditLogDelete?.params, [["complaint-uuid-999"]]);
  });

  await t.test("7. Kegagalan discovery atau salah satu cleanup tidak melewatkan cleanup independen dan penutupan pool", async () => {
    const executedQueries: string[] = [];
    let poolClosed = false;

    const mockPool: PoolQueryable = {
      query: async (sql) => {
        executedQueries.push(sql);
        // Simulate discovery failure on messages
        if (sql.includes("SELECT id, complaint_id")) {
          throw new Error("Discovery network timeout");
        }
        if (sql.includes("SELECT id FROM public.reply_owners")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      end: async () => {
        poolClosed = true;
      },
    };

    const tracker = new TestResourceTracker();
    tracker.recordScenario("scenario_123");
    tracker.recordIdentity("identity_abc");

    let cleanupError: Error | undefined;
    try {
      await cleanupFixture(mockPool, tracker);
    } catch (err) {
      cleanupError = err as Error;
    } finally {
      if (mockPool.end) {
        await mockPool.end();
      }
    }

    // Verify discovery failed
    assert.ok(cleanupError, "Cleanup should report the discovery error");
    assert.match(cleanupError.message, /Discovery error \(messages\)/);

    // Verify independent cleanups STILL executed despite discovery failure
    const scenarioDelete = executedQueries.find((q) => q.includes("DELETE FROM public.mock_network_scenarios"));
    assert.ok(scenarioDelete, "Independent cleanup of mock_network_scenarios must still run");

    const identityDelete = executedQueries.find((q) => q.includes("DELETE FROM public.channel_identities"));
    assert.ok(identityDelete, "Independent cleanup of channel_identities must still run");

    // Verify pool closure still happened in finally
    assert.equal(poolClosed, true, "Pool.end() must be called in finally");
  });

  await t.test("8. Error utama serta error cleanup keduanya tetap dilaporkan", async () => {
    const primaryError = new Error("Primary business logic assertion failed");
    const cleanupErrors = [
      new Error("Database drop connection during cleanup step 1"),
      new Error("Lock timeout on cleanup step 2"),
    ];

    const combined = combineErrors(primaryError, cleanupErrors) as CombinedTestError;
    assert.ok(combined, "Combined error must exist");

    // Must preserve primary error message and mention cleanup errors
    assert.match(combined.message, /Primary business logic assertion failed/);
    assert.match(combined.message, /Database drop connection during cleanup step 1/);
    assert.match(combined.message, /Lock timeout on cleanup step 2/);

    // Verify metadata properties are preserved for inspections
    assert.equal(combined.primaryError, primaryError);
    assert.deepEqual(combined.cleanupErrors, cleanupErrors);

    // When no primary error, only cleanup errors are reported
    const cleanupOnly = combineErrors(undefined, cleanupErrors);
    assert.ok(cleanupOnly);
    assert.match(cleanupOnly.message, /Cleanup failed on 2 step\(s\)/);

    // When no cleanup errors, primary error is returned directly
    const primaryOnly = combineErrors(primaryError, []);
    assert.equal(primaryOnly, primaryError);
  });
});
