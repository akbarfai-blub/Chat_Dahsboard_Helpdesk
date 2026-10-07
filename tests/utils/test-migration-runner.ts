import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  combineErrors,
  verifyTestTargetIdentity,
  type PoolQueryable,
  type SupabaseQueryable,
  type TestEnvironmentConfig,
} from "./test-guard";

export interface MigrationFileConsistencyResult {
  ok: boolean;
  error?: string;
  files: string[];
}

export interface EffectivePgTarget {
  host: string;
  port: number;
  database: string;
}

function normalizeHost(hostname: string): string {
  const norm = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (norm === "localhost" || norm === "127.0.0.1") return "127.0.0.1";
  if (norm === "::1") return "::1";
  return norm;
}

function isLoopback(hostname: string): boolean {
  const norm = normalizeHost(hostname);
  return norm === "127.0.0.1" || norm === "::1" || norm === "0.0.0.0" || norm.startsWith("127.");
}

/**
 * Resolves effective PostgreSQL connection options using driver pg's Client parser.
 * This accurately inspects query parameter overrides (such as ?port=... or ?host=...)
 * that the driver actually connects to, WITHOUT opening any network connection.
 */
export function resolveEffectivePgTarget(connectionString: string): EffectivePgTarget {
  try {
    const client = new Client({ connectionString });
    const rawHost = client.host || "127.0.0.1";
    const rawPort =
      typeof client.port === "number"
        ? client.port
        : client.port
          ? parseInt(String(client.port), 10)
          : 5432;
    const rawDb = client.database || "postgres";

    return {
      host: normalizeHost(rawHost),
      port: rawPort,
      database: rawDb.replace(/^\//, ""),
    };
  } catch (err) {
    throw new Error(
      `FAIL-CLOSED: Failed to resolve effective PostgreSQL connection options: ${(err as Error).message}`
    );
  }
}

/**
 * Validates the test environment configuration and effective driver target
 * BEFORE any pool factory, network connection, or query is executed.
 */
export function validateEffectiveMigrationTarget(
  env: Record<string, string | undefined> = process.env
): { config: TestEnvironmentConfig; effectiveTarget: EffectivePgTarget } {
  const dbUrlRaw = env.HELPDESK_TEST_DATABASE_URL?.trim();
  const apiUrlRaw = env.HELPDESK_TEST_API_URL?.trim();
  const roleKeyRaw = env.HELPDESK_TEST_SERVICE_ROLE_KEY?.trim();
  const markerRaw = env.HELPDESK_TEST_ENV_MARKER?.trim();

  if (!dbUrlRaw || !apiUrlRaw || !roleKeyRaw || !markerRaw) {
    throw new Error(
      "FAIL-CLOSED: Explicit test environment configurations (HELPDESK_TEST_DATABASE_URL, HELPDESK_TEST_API_URL, HELPDESK_TEST_SERVICE_ROLE_KEY, HELPDESK_TEST_ENV_MARKER) are missing or invalid."
    );
  }

  // 1. Resolve effective PostgreSQL connection options via driver pg
  const effectiveTarget = resolveEffectivePgTarget(dbUrlRaw);

  // 2. Reject user workspace database on default loopback ports (54322 or 5432)
  if (isLoopback(effectiveTarget.host) && (effectiveTarget.port === 54322 || effectiveTarget.port === 5432)) {
    throw new Error(
      `FAIL-CLOSED: Target is the default user workspace database (port ${effectiveTarget.port}). Rejecting execution to protect user data.`
    );
  }

  // 3. Reject if effective target matches active user database configuration
  const userDbRaw = env.HELPDESK_DATABASE_URL || env.DATABASE_URL;
  if (userDbRaw) {
    try {
      const userEffective = resolveEffectivePgTarget(userDbRaw);
      const sameHost =
        (isLoopback(effectiveTarget.host) && isLoopback(userEffective.host)) ||
        effectiveTarget.host === userEffective.host;
      const samePort = effectiveTarget.port === userEffective.port;
      const sameDb = effectiveTarget.database === userEffective.database;
      if (sameHost && samePort && sameDb) {
        throw new Error(
          "FAIL-CLOSED: Test database configuration points to the active user workspace database."
        );
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("FAIL-CLOSED")) throw e;
    }
  }

  // 4. Validate API URL
  let parsedApiUrl: URL;
  try {
    parsedApiUrl = new URL(apiUrlRaw);
  } catch (err) {
    throw new Error(`FAIL-CLOSED: Invalid API URL format in test configuration: ${(err as Error).message}`);
  }

  const apiPort = parsedApiUrl.port || (parsedApiUrl.protocol === "https:" ? "443" : "80");
  if (isLoopback(parsedApiUrl.hostname) && apiPort === "54321") {
    throw new Error(
      "FAIL-CLOSED: Target API is the default user workspace Supabase API (port 54321). Rejecting execution to protect user data."
    );
  }

  // 5. Host redirection check: ensure host hasn't been diverted to external hosts
  let parsedDbAuthority: URL;
  try {
    parsedDbAuthority = new URL(dbUrlRaw);
  } catch (err) {
    throw new Error(`FAIL-CLOSED: Invalid database URL format: ${(err as Error).message}`);
  }
  const authorityHost = normalizeHost(parsedDbAuthority.hostname);
  if (isLoopback(authorityHost) && !isLoopback(effectiveTarget.host)) {
    throw new Error(
      `FAIL-CLOSED: Effective PostgreSQL host '${effectiveTarget.host}' redirects connection outside verified test target.`
    );
  }

  return {
    config: {
      databaseUrl: dbUrlRaw,
      apiUrl: apiUrlRaw,
      serviceRoleKey: roleKeyRaw,
      expectedMarker: markerRaw,
    },
    effectiveTarget,
  };
}

/**
 * Explicitly unwraps outer transaction wrapper (BEGIN ... COMMIT) from migration SQL.
 * Uses start/end anchored patterns that preserve all internal comments, statements,
 * functions, strings, and triggers without any global string replacements.
 */
export function stripOuterTransactionWrapper(sql: string): {
  sql: string;
  hadLeadingBegin: boolean;
  hadTrailingCommit: boolean;
} {
  let hadLeadingBegin = false;
  let hadTrailingCommit = false;
  let result = sql;

  // 1. Check leading BEGIN; (ignoring leading whitespace and comments)
  const leadingMatch = result.match(
    /^((?:[ \t\r\n]|--[^\r\n]*(?:\r?\n|$)|(?:\/\*[\s\S]*?\*\/))*)\b(BEGIN(?:\s+TRANSACTION|\s+WORK)?|START\s+TRANSACTION)\s*;/i
  );
  if (leadingMatch) {
    hadLeadingBegin = true;
    result = leadingMatch[1] + result.slice(leadingMatch[0].length);
  }

  // 2. Check trailing COMMIT; (ignoring trailing whitespace and comments)
  const trailingMatch = result.match(
    /\b(COMMIT(?:\s+TRANSACTION|\s+WORK)?|END(?:\s+TRANSACTION|\s+WORK)?)\s*;?((?:[ \t\r\n]|--[^\r\n]*(?:\r?\n|$)|(?:\/\*[\s\S]*?\*\/))*)$/i
  );
  if (trailingMatch) {
    hadTrailingCommit = true;
    result = result.slice(0, trailingMatch.index) + trailingMatch[2];
  }

  return {
    sql: result,
    hadLeadingBegin,
    hadTrailingCommit,
  };
}

/**
 * Verifies that migration root (supabase/migrations) and test copy
 * (tests/test-env/supabase/migrations) are strictly identical in file names and content.
 */
export function verifyMigrationFilesConsistency(
  rootMigrationsDir: string = join(process.cwd(), "supabase", "migrations"),
  testMigrationsDir: string = join(process.cwd(), "tests", "test-env", "supabase", "migrations")
): MigrationFileConsistencyResult {
  let rootFiles: string[] = [];
  let testFiles: string[] = [];

  try {
    rootFiles = readdirSync(rootMigrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read root migrations directory (${rootMigrationsDir}): ${(err as Error).message}`,
      files: [],
    };
  }

  try {
    testFiles = readdirSync(testMigrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read test migrations directory (${testMigrationsDir}): ${(err as Error).message}`,
      files: [],
    };
  }

  if (rootFiles.length !== testFiles.length) {
    return {
      ok: false,
      error: `Migration file count mismatch: root has ${rootFiles.length}, test-env has ${testFiles.length}`,
      files: [],
    };
  }

  for (let i = 0; i < rootFiles.length; i++) {
    if (rootFiles[i] !== testFiles[i]) {
      return {
        ok: false,
        error: `Migration filename mismatch: root has '${rootFiles[i]}', test-env has '${testFiles[i]}'`,
        files: [],
      };
    }

    const rootContent = readFileSync(join(rootMigrationsDir, rootFiles[i]), "utf-8");
    const testContent = readFileSync(join(testMigrationsDir, testFiles[i]), "utf-8");
    if (rootContent !== testContent) {
      return {
        ok: false,
        error: `Migration content mismatch for file '${rootFiles[i]}'`,
        files: [],
      };
    }
  }

  return {
    ok: true,
    files: rootFiles,
  };
}

export interface TestMigrationRunnerOptions {
  env?: Record<string, string | undefined>;
  rootMigrationsDir?: string;
  testMigrationsDir?: string;
  poolFactory?: (url: string) => PoolQueryable;
  supabaseFactory?: (url: string, key: string) => SupabaseQueryable;
}

export interface MigrationRunResult {
  success: boolean;
  targetDatabase: string; // Host:Port/Database format without credentials or query params
  markerVerified: string;
  applied: string[];
  skipped: string[];
  totalMigrations: number;
}

/**
 * Runs pending test migrations with full guard verification and atomic transaction guarantees:
 * 1. Validates test configuration and effective driver pg target (anti-user DB, query param overrides).
 * 2. Checks strict consistency between root and test-env migration directories.
 * 3. Verifies both PostgreSQL and Supabase API read the exact same test marker before DDL.
 * 4. Checks supabase_migrations.schema_migrations; never blindly re-applies already recorded migrations.
 * 5. Handles outer transaction wrappers explicitly and executes DDL + version record in one atomic transaction per client.
 */
export async function runTestMigrations(
  options?: TestMigrationRunnerOptions
): Promise<MigrationRunResult> {
  const env = options?.env ?? process.env;

  // 1. Guard check: validate configuration and resolve effective target via driver pg parser
  const { config, effectiveTarget } = validateEffectiveMigrationTarget(env);

  // 2. Consistency check: root vs test-env migrations must be identical
  const rootDir = options?.rootMigrationsDir ?? join(process.cwd(), "supabase", "migrations");
  const testDir = options?.testMigrationsDir ?? join(process.cwd(), "tests", "test-env", "supabase", "migrations");
  const consistency = verifyMigrationFilesConsistency(rootDir, testDir);
  if (!consistency.ok) {
    throw new Error(`FAIL-CLOSED: Migration consistency verification failed: ${consistency.error}`);
  }

  // 3. Connect to target using pool and supabase client
  const pool = options?.poolFactory
    ? options.poolFactory(config.databaseUrl)
    : new Pool({ connectionString: config.databaseUrl });

  const supabase = options?.supabaseFactory
    ? options.supabaseFactory(config.apiUrl, config.serviceRoleKey)
    : createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });

  const ownsPool = !options?.poolFactory;

  try {
    // 4. Dual-path identity and marker check before any DDL
    await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);

    // 5. Ensure schema_migrations table exists and query applied versions (Ledger bootstrap DDL)
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY
      );
    `);

    const schemaRes = await pool.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations"
    );
    const appliedVersions = new Set(schemaRes.rows.map((r) => String(r.version)));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const filename of consistency.files) {
      const version = filename.split("_")[0];
      if (appliedVersions.has(version)) {
        skipped.push(filename);
        continue;
      }

      // Read migration file
      const filePath = join(rootDir, filename);
      const rawSql = readFileSync(filePath, "utf-8");

      // Explicitly unwrap outer BEGIN/COMMIT wrapper without touching inner statements
      const { sql: migrationBody } = stripOuterTransactionWrapper(rawSql);

      // Acquire a dedicated client for atomic transaction handling
      interface TransactionClient {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        release?: () => void;
      }

      let client: TransactionClient;
      if (pool.connect) {
        const rawClient = await pool.connect();
        client = {
          query: (sql: string, params?: unknown[]) => rawClient.query(sql, params),
          release: () => {
            if ("release" in rawClient && typeof rawClient.release === "function") {
              rawClient.release();
            }
          },
        };
      } else {
        client = {
          query: (sql: string, params?: unknown[]) => pool.query(sql, params),
          release: () => {},
        };
      }

      try {
        await client.query("BEGIN");
        try {
          // Execute migration body
          await client.query(migrationBody);
          // Insert version into ledger
          await client.query(
            "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1)",
            [version]
          );
          await client.query("COMMIT");
          applied.push(filename);
        } catch (execErr) {
          let rollbackError: Error | undefined;
          try {
            await client.query("ROLLBACK");
          } catch (rbErr) {
            rollbackError = rbErr as Error;
          }
          const combined = combineErrors(execErr as Error, rollbackError ? [rollbackError] : []);
          throw new Error(
            `FAIL-CLOSED: Failed to apply migration '${filename}': ${combined?.message || (execErr as Error).message}`
          );
        }
      } finally {
        if (client.release) {
          client.release();
        }
      }
    }

    return {
      success: true,
      targetDatabase: `${effectiveTarget.host}:${effectiveTarget.port}/${effectiveTarget.database}`,
      markerVerified: config.expectedMarker,
      applied,
      skipped,
      totalMigrations: consistency.files.length,
    };
  } finally {
    if (ownsPool && pool.end) {
      await pool.end();
    }
  }
}
