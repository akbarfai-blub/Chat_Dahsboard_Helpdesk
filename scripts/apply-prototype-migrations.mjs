#!/usr/bin/env node
/**
 * scripts/apply-prototype-migrations.mjs
 *
 * Safe, atomic, and idempotent migration runner for prototype Supabase databases.
 * - Enforces strict TLS parity with runtime lib/postgres/server.ts (remote requires sslmode=verify-full).
 * - Reads migration files in order from supabase/migrations/.
 * - Explicitly unwraps outer BEGIN/COMMIT from migration SQL files to guarantee atomic execution
 *   of both schema DDL and version insertion in one transaction per migration.
 * - Checks supabase_migrations.schema_migrations table to prevent re-applying migrations.
 * - Never prints passwords or raw database URLs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

/**
 * Validates protocol, hostname, and TLS rules matching runtime lib/postgres/server.ts.
 */
export function parseAndValidateDbConfig(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') {
    throw new Error('Database URL is required');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(dbUrl);
  } catch {
    throw new Error('Invalid Database URL format');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid database protocol: must be postgres: or postgresql:');
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const sslMode = parsedUrl.searchParams.get('sslmode');

  if (!isLocal) {
    if (sslMode !== 'verify-full') {
      throw new Error('Remote database connection requires sslmode=verify-full');
    }
    return {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: true },
      isLocal: false,
      hostname,
      port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 5432,
      database: parsedUrl.pathname.replace(/^\//, '') || 'postgres',
    };
  }

  return {
    connectionString: dbUrl,
    ssl: false,
    isLocal: true,
    hostname,
    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 5432,
    database: parsedUrl.pathname.replace(/^\//, '') || 'postgres',
  };
}

/**
 * Explicitly unwraps outer transaction wrapper (BEGIN ... COMMIT) from migration SQL.
 * Preserves all inner statements, triggers, functions, and comments.
 */
export function stripOuterTransactionWrapper(sql) {
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

export async function runPrototypeMigrations(dbUrl, options = {}) {
  const migrationsDir = options.migrationsDir || path.resolve(process.cwd(), 'supabase/migrations');
  const logger = options.logger || console;
  const clientFactory = options.clientFactory;

  const dbConfig = parseAndValidateDbConfig(dbUrl);
  const client = clientFactory ? clientFactory(dbConfig) : new Client(dbConfig);
  await client.connect();

  try {
    logger.log(`[Migrations] Connected to target database: ${dbConfig.hostname}:${dbConfig.port}/${dbConfig.database}`);

    // Ensure supabase_migrations schema and table exist
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        statements text[],
        name text
      );
    `);

    // Fetch applied versions
    const { rows: appliedRows } = await client.query(
      `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`
    );
    const appliedVersions = new Set(appliedRows.map((r) => r.version));
    logger.log(`[Migrations] Currently applied migrations in DB: ${appliedVersions.size}`);

    // Read migration files
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = [];
    for (const file of files) {
      const match = file.match(/^(\d{14})_(.*)\.sql$/);
      if (!match) continue;
      const version = match[1];
      const name = match[2];
      if (!appliedVersions.has(version)) {
        pending.push({ version, name, file });
      }
    }

    if (pending.length === 0) {
      logger.log(`[Migrations] All ${files.length} migrations are already applied. Database schema is up to date.`);
      return { total: files.length, applied: 0, skipped: files.length, versions: Array.from(appliedVersions) };
    }

    logger.log(`[Migrations] Found ${pending.length} pending migrations out of ${files.length} total.`);

    const newlyApplied = [];
    for (const item of pending) {
      logger.log(`[Migrations] Applying: ${item.file}...`);
      const filePath = path.join(migrationsDir, item.file);
      const rawSql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      const { sql: unwrappedSql } = stripOuterTransactionWrapper(rawSql);

      await client.query('BEGIN');
      try {
        await client.query(unwrappedSql);
        await client.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2);`,
          [item.version, item.name]
        );

        if (options.injectedFailureVersion === item.version) {
          throw new Error(`Injected failure for testing atomicity on migration ${item.version}`);
        }

        await client.query('COMMIT');
        logger.log(`[Migrations] Successfully applied: ${item.file}`);
        newlyApplied.push(item.version);
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback failure
        }
        logger.error(`[Migrations] Error applying ${item.file}:`, err.message);
        throw new Error(`Migration ${item.file} failed: ${err.message}`);
      }
    }

    logger.log(`[Migrations] Successfully applied ${newlyApplied.length} new migrations.`);
    return {
      total: files.length,
      applied: newlyApplied.length,
      skipped: files.length - newlyApplied.length,
      newlyApplied,
    };
  } finally {
    await client.end();
  }
}

// CLI execution if called directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const targetUrl = process.argv[2] || process.env.PROTOTYPE_DATABASE_URL || process.env.HELPDESK_DATABASE_URL;
  if (!targetUrl) {
    console.error('Usage: node scripts/apply-prototype-migrations.mjs <DATABASE_URL>');
    process.exit(1);
  }
  runPrototypeMigrations(targetUrl)
    .then((res) => {
      console.log('[Migrations] Result:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migrations] Fatal:', err.message);
      process.exit(1);
    });
}
