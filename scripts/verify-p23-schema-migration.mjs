import { Pool } from "pg";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export function validateUrl(urlStr) {
  let parsedUrl;
  try {
    parsedUrl = new URL(urlStr);
  } catch (err) {
    const error = new Error("Invalid database URL format");
    error.isValidationError = true;
    throw error;
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    const error = new Error("Invalid database protocol");
    error.isValidationError = true;
    throw error;
  }

  let host = parsedUrl.hostname;
  if (host === "[::1]") host = "::1";
  
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    const error = new Error("Invalid database host");
    error.isValidationError = true;
    throw error;
  }

  if (parsedUrl.search || Array.from(parsedUrl.searchParams.keys()).length > 0) {
    const error = new Error("Database URL query parameters are not allowed");
    error.isValidationError = true;
    throw error;
  }

  return parsedUrl;
}

async function extractSchemaSnapshot(pool) {
  const cols = await pool.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations'
    order by ordinal_position
  `);

  const constrs = await pool.query(`
    select conname, contype, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public' and t.relname = 'conversations'
    order by conname
  `);

  const msgCols = await pool.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'conversation_id'
  `);

  const msgConstrs = await pool.query(`
    select conname, contype, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public' and t.relname = 'messages' and pg_get_constraintdef(c.oid) like '%conversation_id%'
    order by conname
  `);

  const idxs = await pool.query(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public' and (
      tablename = 'conversations' or indexname = 'messages_conversation'
    )
    order by indexname
  `);

  const rls = await pool.query(`
    select relname, relrowsecurity, relforcerowsecurity
    from pg_class c
    join pg_namespace n on c.relnamespace = n.oid
    where n.nspname = 'public' and c.relname = 'conversations'
  `);

  const policies = await pool.query(`
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'conversations'
    order by policyname
  `);

  const grants = await pool.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'conversations'
      and grantee in ('anon', 'authenticated', 'service_role')
    order by grantee, privilege_type
  `);

  const migrations = await pool.query(`
    select version
    from supabase_migrations.schema_migrations
    where version in ('20260929200000', '20260929200001')
    order by version
  `);

  return {
    conversationsColumns: cols.rows,
    conversationsConstraints: constrs.rows,
    messagesConversationColumn: msgCols.rows,
    messagesConversationConstraints: msgConstrs.rows,
    indexes: idxs.rows,
    rlsStatus: rls.rows,
    policies: policies.rows,
    grants: grants.rows,
    migrations: migrations.rows.map(r => r.version),
  };
}

export async function runVerification(baseUrlStr, envDeps = {}) {
  const PoolClass = envDeps.Pool || Pool;
  const getMigrationsDir = envDeps.getMigrationsDir || (() => join(process.cwd(), "supabase", "migrations"));
  const readDir = envDeps.readDir || readdirSync;
  const readFile = envDeps.readFile || readFileSync;
  const extractSnapshot = envDeps.extractSnapshot || extractSchemaSnapshot;

  const parsedUrl = validateUrl(baseUrlStr);
  const FRESH_DB_NAME = "p23_verify_" + randomUUID().replace(/-/g, "");
  
  let adminPool;
  try {
    adminPool = new PoolClass({ connectionString: parsedUrl.toString() });
  } catch (err) {
    throw new Error("Failed to initialize database connection pool");
  }

  let dbCreated = false;
  let freshPool = null;
  let mainError = null;

  try {
    console.log(`[1/5] Preparing isolated database: ${FRESH_DB_NAME}...`);
    await adminPool.query(`create database "${FRESH_DB_NAME}"`);
    dbCreated = true;

    const freshUrl = new URL(parsedUrl.toString());
    freshUrl.pathname = `/${FRESH_DB_NAME}`;
    freshPool = new PoolClass({ connectionString: freshUrl.toString() });

    console.log("[2/5] Setting up Supabase prerequisites (auth schema, migrations ledger, default privileges)...");
    await freshPool.query(`
      create schema if not exists auth;
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
        created_at timestamptz default now()
      );
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
      alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
    `);

    const migrationsDir = getMigrationsDir();
    const migrationFiles = readDir(migrationsDir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    console.log(`[3/5] Applying ${migrationFiles.length} migrations sequentially to isolated database...`);
    for (const file of migrationFiles) {
      const version = file.split("_")[0];
      const rawSql = readFile(join(migrationsDir, file), "utf-8");
      const sql = rawSql.replace(/^\uFEFF/, "");
      process.stdout.write(`  Applying ${file}... `);
      await freshPool.query(sql);
      await freshPool.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
        [version, file.replace(".sql", "")]
      );
      console.log("OK");
    }

    console.log("[4/5] Extracting schema snapshots from both databases...");
    const freshSnapshot = await extractSnapshot(freshPool);
    const liveSnapshot = await extractSnapshot(adminPool);

    console.log("[5/5] Comparing schema objects between fresh installation and live user database...");
    
    console.log("  a. Comparing public.conversations columns...");
    assert.deepStrictEqual(freshSnapshot.conversationsColumns, liveSnapshot.conversationsColumns, "public.conversations columns do not match");

    console.log("  b. Comparing public.conversations constraints...");
    assert.deepStrictEqual(freshSnapshot.conversationsConstraints, liveSnapshot.conversationsConstraints, "public.conversations constraints do not match");

    console.log("  c. Comparing public.messages.conversation_id column...");
    assert.deepStrictEqual(freshSnapshot.messagesConversationColumn, liveSnapshot.messagesConversationColumn, "public.messages.conversation_id column does not match");

    console.log("  d. Comparing public.messages.conversation_id foreign key constraint...");
    assert.deepStrictEqual(freshSnapshot.messagesConversationConstraints, liveSnapshot.messagesConversationConstraints, "public.messages.conversation_id constraints do not match");

    console.log("  e. Comparing indexes (conversations and messages)...");
    assert.deepStrictEqual(freshSnapshot.indexes, liveSnapshot.indexes, "P2.3 indexes do not match");

    console.log("  f. Comparing RLS status...");
    assert.deepStrictEqual(freshSnapshot.rlsStatus, liveSnapshot.rlsStatus, "RLS status does not match");

    console.log("  g. Comparing RLS policies...");
    assert.deepStrictEqual(freshSnapshot.policies, liveSnapshot.policies, "RLS policies do not match");

    console.log("  h. Comparing role table grants (anon, authenticated, service_role)...");
    assert.deepStrictEqual(freshSnapshot.grants, liveSnapshot.grants, "Role table grants do not match");

    console.log("  i. Comparing schema_migrations entries for P2.3...");
    assert.deepStrictEqual(freshSnapshot.migrations, liveSnapshot.migrations, "schema_migrations entries do not match");

    console.log("\n>>> ALL 9 COMPARISON CATEGORIES ARE STRICTLY EQUIVALENT! <<<");
    
    console.log("Details of verified objects:");
    console.log("- public.conversations columns:", freshSnapshot.conversationsColumns.map(c => `${c.column_name} (${c.data_type}, nullable: ${c.is_nullable})`));
    console.log("- public.conversations constraints:", freshSnapshot.conversationsConstraints.map(c => `${c.conname}: ${c.def}`));
    console.log("- public.messages.conversation_id constraint:", freshSnapshot.messagesConversationConstraints.map(c => `${c.conname}: ${c.def}`));
    console.log("- P2.3 indexes:", freshSnapshot.indexes.map(i => `${i.indexname}: ${i.indexdef}`));
    console.log("- RLS enabled:", freshSnapshot.rlsStatus[0]?.relrowsecurity);
    console.log("- Policies:", freshSnapshot.policies.map(p => `${p.policyname} (${p.cmd}) for ${p.roles}: ${p.qual}`));
    console.log("- Grants:", freshSnapshot.grants.map(g => `${g.grantee}: ${g.privilege_type}`));
    console.log("- Migrations:", freshSnapshot.migrations);

  } catch (err) {
    mainError = err;
  } finally {
    if (freshPool) {
      try {
        await freshPool.end();
      } catch (e) {}
    }

    let cleanupError = null;
    if (dbCreated) {
      console.log(`\nTearing down isolated database: ${FRESH_DB_NAME}...`);
      try {
        await adminPool.query(`drop database if exists "${FRESH_DB_NAME}"`);
        console.log("Teardown complete.");
      } catch (err) {
        cleanupError = new Error(`Failed to teardown database ${FRESH_DB_NAME}`);
      }
    }

    if (adminPool) {
      try {
        await adminPool.end();
      } catch (e) {}
    }

    if (mainError && cleanupError) {
      const combined = new Error("Verification failed and cleanup also failed");
      combined.mainError = mainError;
      combined.cleanupError = cleanupError;
      combined.dbName = FRESH_DB_NAME;
      throw combined;
    } else if (mainError) {
      throw mainError;
    } else if (cleanupError) {
      cleanupError.dbName = FRESH_DB_NAME;
      throw cleanupError;
    }
  }
}

// Check if running directly
let isMain = false;
try {
  isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url);
} catch (e) {}

if (isMain) {
  console.log("=== P2.3 Migration & Schema Equivalence Verification ===");
  const url = process.env.HELPDESK_TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  runVerification(url).then(() => {
    process.exit(0);
  }).catch((err) => {
    if (err.isValidationError) {
      console.error("Verification FAILED:", err.message);
    } else if (err.mainError && err.cleanupError) {
      console.error("Verification FAILED:", err.mainError.message);
      console.error("Cleanup FAILED:", err.cleanupError.message);
      console.error("Database remaining:", err.dbName);
    } else {
      console.error("Verification FAILED:", err.message);
      if (err.dbName) console.error("Database remaining:", err.dbName);
    }
    process.exit(1);
  });
}
