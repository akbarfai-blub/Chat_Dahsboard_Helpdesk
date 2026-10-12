#!/usr/bin/env node
/**
 * scripts/apply-prototype-migrations.mjs
 *
 * Safe, idempotent migration runner for prototype Supabase databases.
 * - Reads migration files in order from supabase/migrations/
 * - Checks supabase_migrations.schema_migrations table to see which have already been applied
 * - Applies only unapplied migrations inside atomic transactions
 * - Preserves existing data without database reset
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

export async function runPrototypeMigrations(dbUrl, options = {}) {
  const migrationsDir = options.migrationsDir || path.resolve(process.cwd(), 'supabase/migrations');
  const logger = options.logger || console;

  if (!dbUrl) {
    throw new Error('Database URL is required for applying migrations.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(dbUrl);
  } catch (err) {
    throw new Error(`Invalid Database URL: ${err.message}`);
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  const sslMode = parsedUrl.searchParams.get('sslmode');

  const clientConfig = {
    connectionString: dbUrl,
  };

  // If remote and sslmode is verify-full or require
  if (!isLocal) {
    if (sslMode === 'verify-full') {
      clientConfig.ssl = { rejectUnauthorized: true };
    } else if (sslMode === 'no-verify' || sslMode === 'disable') {
      clientConfig.ssl = false;
    } else {
      clientConfig.ssl = { rejectUnauthorized: false };
    }
  }

  const client = new Client(clientConfig);
  await client.connect();

  try {
    logger.log(`[Migrations] Connected to target database: ${parsedUrl.hostname}:${parsedUrl.port || 5432}/${parsedUrl.pathname.replace(/^\//, '')}`);

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
      const sql = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING;`,
          [item.version, item.name]
        );
        await client.query('COMMIT');
        logger.log(`[Migrations] Successfully applied: ${item.file}`);
        newlyApplied.push(item.version);
      } catch (err) {
        await client.query('ROLLBACK');
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

import { fileURLToPath } from 'node:url';

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

