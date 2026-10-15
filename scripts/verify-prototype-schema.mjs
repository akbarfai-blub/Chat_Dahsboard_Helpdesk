#!/usr/bin/env node
/**
 * scripts/verify-prototype-schema.mjs
 *
 * Dedicated READ-ONLY Schema & Fixture Verification Runner:
 * - Reads PROTOTYPE_DATABASE_URL from .env.local.
 * - Enforces strict TLS verification via NODE_EXTRA_CA_CERTS (certs/prod-ca-2021.crt).
 * - Executes all database inspection queries within a "BEGIN READ ONLY" transaction.
 * - Does NOT call migrations, does NOT call seed, and performs ZERO data mutations.
 * - Exits with code 0 only if all mandatory assertions pass. Nonzero otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  parseEnvLocal,
  validatePipelineTarget,
  runDirectedVerification,
} from './apply-prototype-pipeline.mjs';
import { parseAndValidateDbConfig } from './apply-prototype-migrations.mjs';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export async function runReadOnlyVerification(options = {}) {
  const logger = options.logger || console;
  const envPath = options.envLocalPath || process.env.PROTOTYPE_ENV_FILE || (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null) || path.resolve(rootDir, '.env.local');
  const env = options.env || parseEnvLocal(envPath);
  const protoUrl = options.protoUrl || env.PROTOTYPE_DATABASE_URL;
  let clientFactory = options.clientFactory;

  if (!clientFactory && process.env.PROTOTYPE_TEST_CLIENT_MODULE) {
    const mod = await import(pathToFileURL(path.resolve(process.env.PROTOTYPE_TEST_CLIENT_MODULE)).href);
    clientFactory = mod.clientFactory || mod.default;
  }

  const migrationsDir = options.migrationsDir || path.resolve(rootDir, 'supabase/migrations');

  // Validate target parameters
  validatePipelineTarget(env, protoUrl);
  const dbConfig = parseAndValidateDbConfig(protoUrl);

  const client = clientFactory ? clientFactory(dbConfig) : new Client({
    ...dbConfig,
    connectionTimeoutMillis: 7000,
    statement_timeout: 7000,
    query_timeout: 7000,
    application_name: 'upaznet-readonly-verifier',
  });

  await client.connect();
  logger.log(`[ReadOnlyVerification] Connected to target: ${dbConfig.hostname}:${dbConfig.port}/${dbConfig.database}`);

  try {
    // Start strict READ ONLY transaction
    await client.query('BEGIN READ ONLY;');
    logger.log(`[ReadOnlyVerification] Transaction started: BEGIN READ ONLY (guaranteed 0 mutations).`);

    const result = await runDirectedVerification(client, {
      migrationsDir,
      testerSenderId: env.TELEGRAM_TESTER_ALLOWLIST || '6727338166',
      botAccountId: env.TELEGRAM_BOT_ACCOUNT_ID || 'upaznet_helpdesk_bot',
    });

    await client.query('COMMIT;');
    logger.log(`[ReadOnlyVerification] Read-only verification completed and committed.`);

    logger.log(`\n======================================================`);
    logger.log(`[READ-ONLY VERIFICATION SUMMARY]`);
    logger.log(`Migrations: ${result.summary.migrationsApplied}/${result.summary.migrationsTotal} applied (0 pending) ✅`);
    logger.log(`Core Tables Verified: ${result.summary.coreTablesVerified} tables present ✅`);
    logger.log(`Fixtures: Customers=${result.summary.customers}, Services=${result.summary.services}, ODCs=${result.summary.odcs}, ODPs=${result.summary.odps}, Mappings=${result.summary.topologyMappings} ✅`);
    logger.log(`Tester Identity: ${result.summary.testerIdentity.senderId} linked to Customer ${result.summary.testerIdentity.linkedCustomerId} (${result.summary.testerIdentity.status}) ✅`);
    logger.log(`Network Fixtures: Scenarios=${result.summary.mockNetworkScenarios}, ONU pairs=${result.summary.mockOnuStatusPairsVerified}, Uplink pairs=${result.summary.mockUpstreamStatusPairsVerified} (stale preserved: ${result.summary.staleScenarioPreserved}) ✅`);
    logger.log(`Automation Settings: mode=${result.summary.automationSettings.mode}, emergency_stop=${result.summary.automationSettings.emergency_stop}, version=${result.summary.automationSettings.version} ✅`);
    logger.log(`Overall Result: ALL READ-ONLY ASSERTIONS PASSED ✅`);
    logger.log(`======================================================\n`);

    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch {}
    logger.error(`\n[ReadOnlyVerification FAILED]:`, err.message);
    throw err;
  } finally {
    await client.end();
  }
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runReadOnlyVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message || err);
      console.error(`Exit code: 1`);
      process.exit(1);
    });
}
