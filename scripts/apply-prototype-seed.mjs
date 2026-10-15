#!/usr/bin/env node
/**
 * scripts/apply-prototype-seed.mjs
 *
 * Idempotently applies seed.sql, fixtures/network.sql, and tester identity mapping.
 * - Strict TLS parity matching runtime lib/postgres/server.ts (remote requires sslmode=verify-full).
 * - Verifies whether automation_settings is genuinely in SHADOW mode (does NOT falsely report SHADOW guaranteed).
 * - Does NOT reset database or delete existing users/data.
 * - Never prints passwords or raw database URLs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseAndValidateDbConfig } from './apply-prototype-migrations.mjs';

const { Client } = pg;

export async function runPrototypeSeed(dbUrl, options = {}) {
  const logger = options.logger || console;
  const testerSenderId = options.testerSenderId || process.env.TELEGRAM_TESTER_ALLOWLIST || '6727338166';
  const botAccountId = options.botAccountId || process.env.TELEGRAM_BOT_ACCOUNT_ID || 'upaznet_helpdesk_bot';
  const requireShadow = options.requireShadow ?? false;
  const clientFactory = options.clientFactory;

  const dbConfig = parseAndValidateDbConfig(dbUrl);
  const client = clientFactory ? clientFactory(dbConfig) : new Client(dbConfig);
  await client.connect();

  try {
    logger.log(`[Seed] Connected to target database: ${dbConfig.hostname}:${dbConfig.port}/${dbConfig.database}`);

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

    // 4. Verify automation_settings table state
    const { rows: settingsRows } = await client.query(
      `SELECT singleton, mode, emergency_stop, version FROM public.automation_settings WHERE singleton = true;`
    );

    let shadowGuaranteed = false;
    let currentMode = null;
    let emergencyStop = false;

    if (settingsRows.length === 0) {
      await client.query(`INSERT INTO public.automation_settings (singleton, mode) VALUES (true, 'SHADOW');`);
      logger.log('[Seed] Initialized automation_settings singleton row with mode=SHADOW.');
      shadowGuaranteed = true;
      currentMode = 'SHADOW';
      emergencyStop = false;
    } else {
      currentMode = settingsRows[0].mode;
      emergencyStop = settingsRows[0].emergency_stop;
      if (currentMode === 'SHADOW' && !emergencyStop) {
        shadowGuaranteed = true;
        logger.log(`[Seed] Current automation_settings verified in SHADOW mode (emergency_stop=false, version=${settingsRows[0].version}).`);
      } else {
        shadowGuaranteed = false;
        const warningMsg = `Current automation_settings mode is '${currentMode}' (emergency_stop=${emergencyStop}). SHADOW is NOT guaranteed.`;
        if (requireShadow) {
          throw new Error(`FAIL-CLOSED: ${warningMsg}`);
        }
        logger.warn(`[Seed] WARNING: ${warningMsg}`);
      }
    }

    logger.log('[Seed] Seeding completed.');
    return { ok: true, shadowGuaranteed, mode: currentMode, emergencyStop };
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
    .then((res) => {
      console.log('[Seed] Result:', JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Fatal:', err.message);
      process.exit(1);
    });
}
