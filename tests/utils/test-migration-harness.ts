import { existsSync, rmSync } from "node:fs";
import {
  requireIsolatedDatabase,
  verifyTestTargetIdentity,
  combineErrors,
  type PoolQueryable,
  type SupabaseQueryable,
  type TestEnvironmentConfig,
} from "./test-guard";

export interface MigrationHarnessTrackers {
  createdTableNames: string[];
  recordedVersions: string[];
  installedConstraints: string[];
  tempDirs: string[];
}

export interface MigrationHarnessContext {
  pool: PoolQueryable;
  supabase: SupabaseQueryable;
  config: TestEnvironmentConfig;
  trackers: MigrationHarnessTrackers;
}

export interface RunMigrationHarnessOptions<T> {
  pool: PoolQueryable;
  supabase: SupabaseQueryable;
  config: TestEnvironmentConfig;
  execute: (ctx: MigrationHarnessContext) => Promise<T>;
}

/**
 * Shared lifecycle harness for migration integration tests and negative guard tests.
 *
 * Guarantees:
 * 1. Executes actual environment guard (requireIsolatedDatabase) before ANY mutation or fixture execution.
 * 2. If the guard check fails, fixture execution is completely skipped and zero DDL/teardown mutations are executed.
 * 3. Safely cleans up per-run tracked constraints, tables, versions, and temp directories if and only if guard passed.
 * 4. Always closes connection pool in the finally block.
 * 5. Aggregates primary error and cleanup/pool.end errors via combineErrors without masking.
 */
export async function runMigrationTestLifecycle<T>(
  options: RunMigrationHarnessOptions<T>
): Promise<T> {
  const { pool, supabase, config, execute } = options;

  const trackers: MigrationHarnessTrackers = {
    createdTableNames: [],
    recordedVersions: [],
    installedConstraints: [],
    tempDirs: [],
  };

  let guardPassed = false;
  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];
  let result: T | undefined;

  try {
    // 1. Safety Guard: verify isolated database identity before ANY mutation or workload
    await requireIsolatedDatabase(pool, supabase, config);
    guardPassed = true;

    // 2. Execute fixture workload
    result = await execute({ pool, supabase, config, trackers });
  } catch (err) {
    primaryError = err as Error;
  } finally {
    // 3. Teardown bounded resources ONLY if environment guard passed
    if (guardPassed) {
      // 3.1 Drop installed check constraints
      for (const cName of trackers.installedConstraints) {
        try {
          await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);
          await pool.query(
            `ALTER TABLE supabase_migrations.schema_migrations DROP CONSTRAINT IF EXISTS ${cName}`
          );
        } catch (err) {
          cleanupErrors.push(
            new Error(`Failed to drop constraint ${cName}: ${(err as Error).message}`)
          );
        }
      }

      // 3.2 Drop created fixture tables (per-run tracked only)
      for (const tName of trackers.createdTableNames) {
        try {
          await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);
          await pool.query(`DROP TABLE IF EXISTS ${tName}`);
        } catch (err) {
          cleanupErrors.push(
            new Error(`Failed to drop table ${tName}: ${(err as Error).message}`)
          );
        }
      }

      // 3.3 Delete recorded ledger versions (per-run tracked only)
      if (trackers.recordedVersions.length > 0) {
        try {
          await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);
          await pool.query(
            "DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY($1::text[])",
            [trackers.recordedVersions]
          );
        } catch (err) {
          cleanupErrors.push(
            new Error(`Failed to delete ledger versions: ${(err as Error).message}`)
          );
        }
      }
    }

    // 4. Remove isolated temporary directories
    for (const dir of trackers.tempDirs) {
      try {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch (err) {
        cleanupErrors.push(
          new Error(`Failed to remove temp dir ${dir}: ${(err as Error).message}`)
        );
      }
    }

    // 5. Always close connection pool
    if (typeof pool.end === "function") {
      try {
        await pool.end();
      } catch (err) {
        cleanupErrors.push(
          new Error(`Pool end failed: ${(err as Error).message}`)
        );
      }
    }

    // 6. Aggregate primary error and cleanup errors without masking
    const combined = combineErrors(primaryError, cleanupErrors);
    if (combined) {
      throw combined;
    }
  }

  return result as T;
}
