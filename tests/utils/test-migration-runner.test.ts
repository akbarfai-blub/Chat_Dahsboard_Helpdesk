import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyMigrationFilesConsistency,
  runTestMigrations,
  resolveEffectivePgTarget,
  stripOuterTransactionWrapper,
} from "./test-migration-runner";
import { type PoolQueryable, type SupabaseQueryable } from "./test-guard";

test("Test Migration Runner Guard Verification and Safe Execution", async (t) => {
  await t.test("1. Consistency check verifies root and test-env migrations are identical", () => {
    const result = verifyMigrationFilesConsistency();
    assert.equal(result.ok, true, `Migration consistency failed: ${result.error}`);
    assert.ok(result.files.length > 0, "Should detect migration files");
    assert.ok(
      result.files.includes("20261004110000_revoke_direct_staff_conversation_reads_mutation.sql"),
      "Should include Koreksi A migration"
    );
  });

  await t.test("2. Effective Target Resolution: Driver pg query parameter overrides", () => {
    // Basic authority
    const baseTarget = resolveEffectivePgTarget("postgresql://user:pass@127.0.0.1:54332/postgres");
    assert.equal(baseTarget.host, "127.0.0.1");
    assert.equal(baseTarget.port, 54332);
    assert.equal(baseTarget.database, "postgres");

    // Overridden port via query param ?port=54322
    const portOverride = resolveEffectivePgTarget("postgresql://user:pass@127.0.0.1:54332/postgres?port=54322");
    assert.equal(portOverride.port, 54322, "Driver pg must resolve effective port 54322 from query param");

    // Overridden port via query param ?port=5432
    const port5432 = resolveEffectivePgTarget("postgresql://user:pass@127.0.0.1:54332/postgres?port=5432");
    assert.equal(port5432.port, 5432, "Driver pg must resolve effective port 5432 from query param");

    // Overridden host via query param ?host=evil.com
    const hostOverride = resolveEffectivePgTarget("postgresql://user:pass@127.0.0.1:54332/postgres?host=evil.com");
    assert.equal(hostOverride.host, "evil.com", "Driver pg must resolve effective host from query param");
  });

  await t.test("3. Penolakan target pengguna dan pengganti query param sebelum pool/koneksi/query dipanggil", async (st) => {
    await st.test("3.1 Target pengguna (port 54322 di authority) ditolak dengan 0 call pool/query", async () => {
      let poolFactoryCalls = 0;
      await assert.rejects(
        async () => {
          await runTestMigrations({
            env: {
              HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
              HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
              HELPDESK_TEST_SERVICE_ROLE_KEY: "test-service-key",
              HELPDESK_TEST_ENV_MARKER: "test-marker-1",
            },
            poolFactory: () => {
              poolFactoryCalls++;
              throw new Error("Pool factory should never be called");
            },
          });
        },
        (err: Error) => {
          assert.match(err.message, /Target is the default user workspace database \(port 54322\)/);
          return true;
        }
      );
      assert.equal(poolFactoryCalls, 0, "Counter pool factory must be 0");
    });

    await st.test("3.2 URL dengan ?port=54322 (tampak port 54332) ditolak dengan 0 call pool/query", async () => {
      let poolFactoryCalls = 0;
      await assert.rejects(
        async () => {
          await runTestMigrations({
            env: {
              HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?port=54322",
              HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
              HELPDESK_TEST_SERVICE_ROLE_KEY: "test-service-key",
              HELPDESK_TEST_ENV_MARKER: "test-marker-1",
            },
            poolFactory: () => {
              poolFactoryCalls++;
              throw new Error("Pool factory should never be called");
            },
          });
        },
        (err: Error) => {
          assert.match(err.message, /Target is the default user workspace database \(port 54322\)/);
          return true;
        }
      );
      assert.equal(poolFactoryCalls, 0, "Counter pool factory must be 0 for ?port=54322");
    });

    await st.test("3.3 URL dengan ?port=5432 (default system postgres) ditolak dengan 0 call pool/query", async () => {
      let poolFactoryCalls = 0;
      await assert.rejects(
        async () => {
          await runTestMigrations({
            env: {
              HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?port=5432",
              HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
              HELPDESK_TEST_SERVICE_ROLE_KEY: "test-service-key",
              HELPDESK_TEST_ENV_MARKER: "test-marker-1",
            },
            poolFactory: () => {
              poolFactoryCalls++;
              throw new Error("Pool factory should never be called");
            },
          });
        },
        (err: Error) => {
          assert.match(err.message, /Target is the default user workspace database \(port 5432\)/);
          return true;
        }
      );
      assert.equal(poolFactoryCalls, 0, "Counter pool factory must be 0 for ?port=5432");
    });

    await st.test("3.4 URL dengan ?host=evil.com mengarahkan keluar dari target tes ditolak dengan 0 call pool/query", async () => {
      let poolFactoryCalls = 0;
      await assert.rejects(
        async () => {
          await runTestMigrations({
            env: {
              HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres?host=evil.com",
              HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
              HELPDESK_TEST_SERVICE_ROLE_KEY: "test-service-key",
              HELPDESK_TEST_ENV_MARKER: "test-marker-1",
            },
            poolFactory: () => {
              poolFactoryCalls++;
              throw new Error("Pool factory should never be called");
            },
          });
        },
        (err: Error) => {
          assert.match(err.message, /redirects connection outside verified test target/);
          return true;
        }
      );
      assert.equal(poolFactoryCalls, 0, "Counter pool factory must be 0 for host diversion");
    });
  });

  await t.test("4. Marker mismatch antara PostgreSQL dan Supabase API menghasilkan nol migration DDL", async () => {
    let migrationDdlExecuted = false;

    const mockPool: PoolQueryable = {
      query: async (sql: string) => {
        if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
          return { rows: [{ id: "test-marker-1", description: "pg-token-abc" }] };
        }
        // Trim leading whitespace and check for DDL keywords
        const isDdl = /^\s*(CREATE|ALTER|DROP|REVOKE|GRANT|TRUNCATE)\b/i.test(sql);
        if (isDdl) {
          migrationDdlExecuted = true;
        }
        return { rows: [] };
      },
    };

    const mockSupabase: SupabaseQueryable = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "test-marker-1", description: "supabase-token-MISMATCH" },
              error: null,
            }),
          }),
        }),
      }),
    };

    await assert.rejects(
      async () => {
        await runTestMigrations({
          env: {
            HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
            HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
            HELPDESK_TEST_SERVICE_ROLE_KEY: "test-service-key",
            HELPDESK_TEST_ENV_MARKER: "test-marker-1",
          },
          poolFactory: () => mockPool,
          supabaseFactory: () => mockSupabase,
        });
      },
      (err: Error) => {
        assert.match(err.message, /Target mismatch: PostgreSQL and Supabase API returned different marker tokens/);
        return true;
      }
    );

    assert.equal(migrationDdlExecuted, false, "Zero migration DDL must be executed when target marker check fails");
  });

  await t.test("5. Outer transaction unwrapping safely strips BEGIN and COMMIT without altering internal statements", () => {
    const sqlWithBoth = `
      -- Header comment
      BEGIN;
      CREATE TABLE public.foo (id int);
      -- Internal comment
      COMMIT;
      -- Trailing comment
    `;
    const resBoth = stripOuterTransactionWrapper(sqlWithBoth);
    assert.equal(resBoth.hadLeadingBegin, true);
    assert.equal(resBoth.hadTrailingCommit, true);
    assert.ok(resBoth.sql.includes("CREATE TABLE public.foo (id int);"));
    assert.ok(!resBoth.sql.trim().startsWith("BEGIN;"));
    assert.ok(!resBoth.sql.trim().endsWith("COMMIT;"));

    const sqlOnlyCommit = `
      CREATE TABLE public.bar (id int);
      COMMIT;
    `;
    const resCommit = stripOuterTransactionWrapper(sqlOnlyCommit);
    assert.equal(resCommit.hadLeadingBegin, false);
    assert.equal(resCommit.hadTrailingCommit, true);
    assert.ok(resCommit.sql.includes("CREATE TABLE public.bar (id int);"));

    const sqlPlain = `CREATE TABLE public.baz (id int);`;
    const resPlain = stripOuterTransactionWrapper(sqlPlain);
    assert.equal(resPlain.hadLeadingBegin, false);
    assert.equal(resPlain.hadTrailingCommit, false);
    assert.equal(resPlain.sql, sqlPlain);
  });
});

