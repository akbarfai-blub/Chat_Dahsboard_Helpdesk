import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  parseAndValidateTestConfig,
  verifyTestTargetIdentity,
  type PoolQueryable,
  type SupabaseQueryable,
} from "../utils/test-guard";
import {
  runMigrationTestLifecycle,
} from "../utils/test-migration-harness";
import {
  runTestMigrations,
  validateEffectiveMigrationTarget,
} from "../utils/test-migration-runner";
import type { Database } from "../../lib/supabase/database.types";

test("Integration: Migration Runner Safe DDL, Ledger Atomicity, and Per-Run Fixture Ownership", async (t) => {
  // 1. Parse and validate explicit test configuration (fail-closed, no hardcoded fallbacks)
  const config = parseAndValidateTestConfig(process.env);
  validateEffectiveMigrationTarget(process.env);

  // =========================================================================
  // 1. Guard check failure produces zero mutations on runner
  // =========================================================================
  await t.test("1. Target/marker mismatch fails closed and executes zero DDL or teardown mutations", async () => {
    let ddlExecuted = false;
    const fakePool = {
      query: async (sql: string) => {
        if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
          return { rows: [{ id: config.expectedMarker, description: "real-pg-token" }] };
        }
        if (/^\s*(CREATE|ALTER|DROP|REVOKE|GRANT|TRUNCATE|DELETE|INSERT|UPDATE)\b/i.test(sql)) {
          ddlExecuted = true;
        }
        return { rows: [] };
      },
    };

    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: config.expectedMarker, description: "mismatched-sb-token" },
              error: null,
            }),
          }),
        }),
      }),
    };

    const tempDir = join(tmpdir(), `mig-stub-${randomUUID().slice(0, 8)}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      await assert.rejects(
        async () => {
          await runTestMigrations({
            env: {
              HELPDESK_TEST_DATABASE_URL: config.databaseUrl,
              HELPDESK_TEST_API_URL: config.apiUrl,
              HELPDESK_TEST_SERVICE_ROLE_KEY: config.serviceRoleKey,
              HELPDESK_TEST_ENV_MARKER: config.expectedMarker,
            },
            rootMigrationsDir: tempDir,
            testMigrationsDir: tempDir,
            poolFactory: () => fakePool,
            supabaseFactory: () => fakeSupabase as unknown as ReturnType<typeof createSupabaseClient>,
          });
        },
        (err: Error) => {
          assert.match(err.message, /Target mismatch: PostgreSQL and Supabase API/);
          return true;
        }
      );

      assert.equal(ddlExecuted, false, "Zero DDL or mutation must be executed when marker check fails");
    } finally {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  // =========================================================================
  // 1.1 Harness lifecycle: real guard check failure via shared lifecycle harness
  // =========================================================================
  await t.test(
    "1.1 Harness lifecycle: real guard check mismatch prevents fixture execution, produces zero teardown mutation, and closes pool",
    async () => {
      let markerQueryCalled = false;
      let teardownMutationsExecuted = 0;
      let poolEnded = false;
      let fixtureExecuted = false;

      const stubPool: PoolQueryable = {
        query: async (sql: string) => {
          if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
            markerQueryCalled = true;
            return { rows: [{ id: config.expectedMarker, description: "real-pg-token" }] };
          }
          if (/^\s*(CREATE|ALTER|DROP|REVOKE|GRANT|TRUNCATE|DELETE|INSERT|UPDATE)\b/i.test(sql)) {
            teardownMutationsExecuted++;
          }
          return { rows: [] };
        },
        end: async () => {
          poolEnded = true;
        },
      };

      const stubSupabase: SupabaseQueryable = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: config.expectedMarker, description: "mismatched-sb-token" },
                error: null,
              }),
            }),
          }),
        }),
      };

      // Call the ACTUAL shared lifecycle harness with stub dependencies possessing mismatched marker
      await assert.rejects(
        async () => {
          await runMigrationTestLifecycle({
            pool: stubPool,
            supabase: stubSupabase,
            config,
            execute: async () => {
              fixtureExecuted = true;
            },
          });
        },
        (err: Error) => {
          assert.match(
            err.message,
            /FAIL-CLOSED: Target mismatch: PostgreSQL and Supabase API returned different marker tokens/
          );
          return true;
        }
      );

      // Required assertions:
      assert.equal(markerQueryCalled, true, "Marker check must be queried by actual guard");
      assert.equal(fixtureExecuted, false, "Fixture execution must NEVER be reached when guard fails");
      assert.equal(teardownMutationsExecuted, 0, "Teardown must execute zero mutations when guard fails");
      assert.equal(poolEnded, true, "Connection pool must be closed even when guard fails");
    }
  );

  // =========================================================================
  // 1.2 Harness lifecycle: dual error reporting when both guard fails and pool.end() fails
  // =========================================================================
  await t.test(
    "1.2 Harness lifecycle: dual error reporting when both guard fails and pool.end() fails",
    async () => {
      let markerQueryCalled = false;
      let poolEndCalled = false;
      let fixtureExecuted = false;

      const failingEndPool: PoolQueryable = {
        query: async (sql: string) => {
          if (sql.includes("SELECT id, description FROM public.mock_network_scenarios")) {
            markerQueryCalled = true;
            return { rows: [{ id: config.expectedMarker, description: "real-pg-token" }] };
          }
          return { rows: [] };
        },
        end: async () => {
          poolEndCalled = true;
          throw new Error("Stub pool end failure: socket hang up");
        },
      };

      const stubSupabase: SupabaseQueryable = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: config.expectedMarker, description: "mismatched-sb-token" },
                error: null,
              }),
            }),
          }),
        }),
      };

      await assert.rejects(
        async () => {
          await runMigrationTestLifecycle({
            pool: failingEndPool,
            supabase: stubSupabase,
            config,
            execute: async () => {
              fixtureExecuted = true;
            },
          });
        },
        (err: Error) => {
          assert.match(err.message, /Target mismatch/);
          assert.match(err.message, /Stub pool end failure: socket hang up/);
          const agg = err as { primaryError?: Error; cleanupErrors?: Error[] };
          assert.ok(agg.primaryError?.message.includes("Target mismatch"), "Primary error must be preserved");
          assert.ok(
            agg.cleanupErrors?.some((e) => e.message.includes("Stub pool end failure")),
            "Cleanup error must be preserved"
          );
          return true;
        }
      );

      assert.equal(markerQueryCalled, true, "Marker query must be called");
      assert.equal(poolEndCalled, true, "pool.end must be called");
      assert.equal(fixtureExecuted, false, "Fixture execution must never be reached");
    }
  );

  // =========================================================================
  // 2. Real database migration integration using the SAME runMigrationTestLifecycle harness
  // =========================================================================
  const realPool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  const realSupabase = createSupabaseClient<Database>(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await runMigrationTestLifecycle({
    pool: realPool,
    supabase: realSupabase,
    config,
    execute: async (ctx) => {
      // Safe unique per-run identifier
      const runId = randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
      const okTableName = `test_atom_ok_${runId}`;
      const rbTableName = `test_atom_rb_${runId}`;
      const okVersion = `2099${Math.floor(Date.now() / 1000)}${runId.slice(0, 4)}1`;
      const failVersion = `2099${Math.floor(Date.now() / 1000)}${runId.slice(0, 4)}2`;
      const constraintName = `chk_mig_reject_${runId}`;

      // Unique isolated temporary directory per run
      const tempBaseDir = join(tmpdir(), `helpdesk-migration-test-${runId}`);
      const testFixtureDir = join(tempBaseDir, "root-migrations");
      const testCopyDir = join(tempBaseDir, "test-migrations");
      mkdirSync(testFixtureDir, { recursive: true });
      mkdirSync(testCopyDir, { recursive: true });
      ctx.trackers.tempDirs.push(tempBaseDir);

      const envMap: Record<string, string | undefined> = {
        HELPDESK_TEST_DATABASE_URL: config.databaseUrl,
        HELPDESK_TEST_API_URL: config.apiUrl,
        HELPDESK_TEST_SERVICE_ROLE_KEY: config.serviceRoleKey,
        HELPDESK_TEST_ENV_MARKER: config.expectedMarker,
      };

      // -----------------------------------------------------------------------
      // 2.1 Pending migration executes atomically: schema formed and version recorded
      // -----------------------------------------------------------------------
      await t.test("2. Pending migration executes atomically: schema formed and version recorded", async () => {
        await verifyTestTargetIdentity(realPool, realSupabase, config.expectedMarker);

        const okFilename = `${okVersion}_create_${okTableName}.sql`;
        const okSql = `
          BEGIN;
          CREATE TABLE public.${okTableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            label text NOT NULL
          );
          COMMIT;
        `;

        writeFileSync(join(testFixtureDir, okFilename), okSql, "utf-8");
        writeFileSync(join(testCopyDir, okFilename), okSql, "utf-8");

        const result = await runTestMigrations({
          env: envMap,
          rootMigrationsDir: testFixtureDir,
          testMigrationsDir: testCopyDir,
        });

        assert.equal(result.success, true);
        assert.ok(result.applied.includes(okFilename), "Migration fixture should be applied");

        // Record ownership immediately upon creation
        ctx.trackers.createdTableNames.push(`public.${okTableName}`);
        ctx.trackers.recordedVersions.push(okVersion);

        // Verify table exists
        const tableCheck = await realPool.query(
          "SELECT to_regclass($1) AS table_name",
          [`public.${okTableName}`]
        );
        assert.ok(tableCheck.rows[0].table_name, `Table ${okTableName} must exist in database`);

        // Verify version recorded in ledger
        const ledgerCheck = await realPool.query(
          "SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1",
          [okVersion]
        );
        assert.equal(ledgerCheck.rows.length, 1, `Version ${okVersion} must be recorded in schema_migrations`);
      });

      // -----------------------------------------------------------------------
      // 2.2 Already recorded migration is skipped on subsequent run
      // -----------------------------------------------------------------------
      await t.test("3. Already recorded migration is safely skipped without re-executing DDL", async () => {
        const okFilename = `${okVersion}_create_${okTableName}.sql`;
        const secondRun = await runTestMigrations({
          env: envMap,
          rootMigrationsDir: testFixtureDir,
          testMigrationsDir: testCopyDir,
        });

        assert.equal(secondRun.success, true);
        assert.equal(secondRun.applied.length, 0, "Already recorded migration must not be applied again");
        assert.ok(secondRun.skipped.includes(okFilename), "Already recorded migration must be skipped");
      });

      // -----------------------------------------------------------------------
      // 2.3 Version recording failure rolls back DDL atomically
      // -----------------------------------------------------------------------
      await t.test("4. Ledger version recording failure rolls back DDL atomically without orphaned schema", async () => {
        await verifyTestTargetIdentity(realPool, realSupabase, config.expectedMarker);

        const failFilename = `${failVersion}_create_${rbTableName}.sql`;
        const failSql = `
          BEGIN;
          CREATE TABLE public.${rbTableName} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            note text NOT NULL
          );
          COMMIT;
        `;

        writeFileSync(join(testFixtureDir, failFilename), failSql, "utf-8");
        writeFileSync(join(testCopyDir, failFilename), failSql, "utf-8");

        assert.ok(/^[a-z0-9_]+$/.test(constraintName), "constraintName must be safe SQL identifier");
        assert.ok(/^[a-z0-9_]+$/.test(failVersion), "failVersion must be safe SQL identifier");

        // Install per-run unique check constraint on schema_migrations that only rejects failVersion
        await realPool.query(
          `ALTER TABLE supabase_migrations.schema_migrations ADD CONSTRAINT ${constraintName} CHECK (version <> '${failVersion}')`
        );
        ctx.trackers.installedConstraints.push(constraintName);

        try {
          await assert.rejects(
            async () => {
              await runTestMigrations({
                env: envMap,
                rootMigrationsDir: testFixtureDir,
                testMigrationsDir: testCopyDir,
              });
            },
            (err: Error) => {
              assert.match(err.message, /FAIL-CLOSED: Failed to apply migration/);
              return true;
            }
          );

          // ATOMICITY PROOF:
          // 1. Table rbTableName must NOT exist (DDL rolled back!)
          const tableCheck = await realPool.query(
            "SELECT to_regclass($1) AS table_name",
            [`public.${rbTableName}`]
          );
          assert.equal(
            tableCheck.rows[0].table_name,
            null,
            `Table ${rbTableName} must not exist after atomic rollback`
          );

          // 2. Version must NOT exist in schema_migrations
          const ledgerCheck = await realPool.query(
            "SELECT version FROM supabase_migrations.schema_migrations WHERE version = $1",
            [failVersion]
          );
          assert.equal(
            ledgerCheck.rows.length,
            0,
            `Version ${failVersion} must not exist in schema_migrations after atomic rollback`
          );
        } finally {
          // Remove constraint with guard
          await verifyTestTargetIdentity(realPool, realSupabase, config.expectedMarker);
          await realPool.query(
            `ALTER TABLE supabase_migrations.schema_migrations DROP CONSTRAINT IF EXISTS ${constraintName}`
          );
          const idx = ctx.trackers.installedConstraints.indexOf(constraintName);
          if (idx !== -1) ctx.trackers.installedConstraints.splice(idx, 1);
        }
      });
    },
  });
});
