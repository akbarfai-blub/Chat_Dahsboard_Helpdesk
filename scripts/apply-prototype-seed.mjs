#!/usr/bin/env node
/**
 * scripts/apply-prototype-seed.mjs
 *
 * Idempotently applies seed.sql, fixtures/network.sql, and tester identity mapping.
 * Does NOT reset database or delete existing users/data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

export async function runPrototypeSeed(dbUrl, options = {}) {
  const logger = options.logger || console;
  const testerSenderId = options.testerSenderId || process.env.TELEGRAM_TESTER_ALLOWLIST || '6727338166';
  const botAccountId = options.botAccountId || process.env.TELEGRAM_BOT_ACCOUNT_ID || 'upaznet_helpdesk_bot';

  if (!dbUrl) {
    throw new Error('Database URL is required for seeding.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(dbUrl);
  } catch (err) {
    throw new Error(`Invalid Database URL: ${err.message}`);
  }

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  const sslMode = parsedUrl.searchParams.get('sslmode');

  const clientConfig = { connectionString: dbUrl };
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
    logger.log(`[Seed] Connected to target database: ${parsedUrl.hostname}:${parsedUrl.port || 5432}/${parsedUrl.pathname.replace(/^\//, '')}`);

    // 1. Apply seed.sql
    const seedPath = path.resolve(process.cwd(), 'supabase/seed.sql');
    if (fs.existsSync(seedPath)) {
      logger.log('[Seed] Applying supabase/seed.sql...');
      const seedSql = fs.readFileSync(seedPath, 'utf8').replace(/^\uFEFF/, '');
      await client.query(seedSql);
      logger.log('[Seed] supabase/seed.sql applied successfully.');
    }

    // 2. Apply fixtures/network.sql
    const networkPath = path.resolve(process.cwd(), 'supabase/fixtures/network.sql');
    if (fs.existsSync(networkPath)) {
      logger.log('[Seed] Applying supabase/fixtures/network.sql...');
      const networkSql = fs.readFileSync(networkPath, 'utf8').replace(/^\uFEFF/, '');
      await client.query(networkSql);
      logger.log('[Seed] supabase/fixtures/network.sql applied successfully.');
    }

    // 3. Ensure tester identity exists in channel_identities
    if (testerSenderId) {
      logger.log(`[Seed] Checking channel_identities for tester ${testerSenderId}...`);
      await client.query(
        `
        INSERT INTO public.channel_identities (
          id, channel, channel_account_id, sender_external_id,
          display_name_snapshot, customer_id, verification_status, verified_at
        ) VALUES (
          '60000000-0000-4000-8000-000000000099',
          'telegram',
          $1,
          $2,
          'Tester Prototype',
          '10000000-0000-4000-8000-000000000001',
          'verified',
          now()
        )
        ON CONFLICT (channel, channel_account_id, sender_external_id) DO NOTHING;
        `,
        [botAccountId, testerSenderId]
      );
      logger.log(`[Seed] Tester channel identity ensured for ${botAccountId} / ${testerSenderId}.`);
    }

    // 4. Verify automation_settings table has singleton row in SHADOW mode
    const { rows: settingsRows } = await client.query(
      `SELECT singleton, mode, emergency_stop, version FROM public.automation_settings WHERE singleton = true;`
    );
    if (settingsRows.length === 0) {
      await client.query(`INSERT INTO public.automation_settings (singleton, mode) VALUES (true, 'SHADOW');`);
      logger.log('[Seed] Initialized automation_settings singleton row with mode=SHADOW.');
    } else {
      logger.log(`[Seed] Current automation_settings: mode=${settingsRows[0].mode}, emergency_stop=${settingsRows[0].emergency_stop}, version=${settingsRows[0].version}`);
    }

    logger.log('[Seed] Seeding completed cleanly.');
    return { ok: true };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const targetUrl = process.argv[2] || process.env.PROTOTYPE_DATABASE_URL || process.env.HELPDESK_DATABASE_URL;
  if (!targetUrl) {
    console.error('Usage: node scripts/apply-prototype-seed.mjs <DATABASE_URL>');
    process.exit(1);
  }
  runPrototypeSeed(targetUrl)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] Fatal:', err.message);
      process.exit(1);
    });
}
