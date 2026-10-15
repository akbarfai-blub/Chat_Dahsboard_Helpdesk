#!/usr/bin/env node
/**
 * scripts/apply-prototype-pipeline.mjs
 *
 * Full, safe, atomic deployment pipeline runner for Prototype P2.10:
 * 1. Strict Target Validation (exact username, host, port, db, sslmode, network provider).
 * 2. Pre-check Target Initial State (evaluates ledger & automation_settings guards).
 * 3. Applies official supabase/migrations/ via runPrototypeMigrations().
 * 4. Applies seed.sql, fixtures/network.sql, tester identity via runPrototypeSeed({ requireShadow: true }).
 * 5. Conducts comprehensive, mandatory directed schema & fixture assertions.
 *
 * Enforces strict TLS parity, never logs passwords, and exits with code 0 only on full success.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { runPrototypeMigrations, parseAndValidateDbConfig } from './apply-prototype-migrations.mjs';
import { runPrototypeSeed } from './apply-prototype-seed.mjs';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const CORE_TABLES = [
  'customers',
  'services',
  'odcs',
  'odps',
  'service_topology',
  'channel_identities',
  'complaints',
  'ingress_events',
  'processing_jobs',
  'processing_job_attempts',
  'conversations',
  'messages',
  'incidents',
  'incident_activity_log',
  'staff_conversation_reads',
  'staff_message_reads',
  'staff_message_classifications',
  'staff_message_classification_history',
  'automation_settings',
  'mock_network_scenarios',
  'mock_onu_status',
  'mock_upstream_status',
];

export const EXPECTED_SCENARIO_IDS = [
  'normal',
  'los_individual',
  'los_area',
  'low_coverage',
  'upstream_down',
  'stale',
  'unknown',
  'missing_status',
  'future_timestamp',
  'missing_timestamp',
  'provider_error',
  'timeout',
  'onu_error_upstream_down',
  'upstream_error_los',
  'recovered',
  'new_event',
];

export const EXPECTED_ONU_SCENARIO_IDS = [
  'normal',
  'los_individual',
  'los_area',
  'low_coverage',
  'upstream_down',
  'stale',
  'unknown',
  'future_timestamp',
  'missing_timestamp',
  'provider_error',
  'timeout',
  'onu_error_upstream_down',
  'upstream_error_los',
  'recovered',
  'new_event',
];

export const EXPECTED_DUMMY_SERVICE_IDS = Array.from(
  { length: 12 },
  (_, i) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
);

export function maskUrl(rawUrl) {
  if (!rawUrl) return '(not set)';
  try {
    const u = new URL(rawUrl);
    const user = u.username || '';
    const port = u.port || (u.protocol === 'https:' ? '443' : '5432');
    const sslmode = u.searchParams.get('sslmode') || 'none';
    return `${u.protocol}//${user ? user + ':***@' : ''}${u.hostname}:${port}${u.pathname}?sslmode=${sslmode}`;
  } catch {
    return '(invalid url format)';
  }
}

export function parseEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function validatePipelineTarget(env, urlStr) {
  if (!env || typeof env !== 'object') {
    throw new Error('Environment configuration object is required');
  }

  const networkProvider = env.NETWORK_PROVIDER;
  if (networkProvider !== 'mock') {
    throw new Error(`Invalid NETWORK_PROVIDER "${networkProvider}". Expected "mock".`);
  }

  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('PROTOTYPE_DATABASE_URL is missing or invalid');
  }

  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('Invalid PROTOTYPE_DATABASE_URL format');
  }

  if (!['postgres:', 'postgresql:'].includes(u.protocol)) {
    throw new Error(`Invalid database protocol "${u.protocol}". Expected "postgres:" or "postgresql:".`);
  }

  const expectedHost = 'aws-0-ap-southeast-2.pooler.supabase.com';
  if (u.hostname !== expectedHost) {
    throw new Error(`Target host mismatch: got "${u.hostname}", expected "${expectedHost}"`);
  }

  const port = parseInt(u.port || '5432', 10);
  if (port !== 5432) {
    throw new Error(`Target port mismatch: got ${port}, expected 5432`);
  }

  const expectedUsername = 'postgres.saysxjdyalnbhxqqmytp';
  if (u.username !== expectedUsername) {
    throw new Error(`Target username mismatch: got "${u.username}", expected "${expectedUsername}"`);
  }

  const dbName = u.pathname.replace(/^\//, '') || 'postgres';
  if (dbName !== 'postgres') {
    throw new Error(`Target database mismatch: got "${dbName}", expected "postgres"`);
  }

  const sslmode = u.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') {
    throw new Error(`Target sslmode mismatch: got "${sslmode}", expected "verify-full"`);
  }

  const decodedPassword = decodeURIComponent(u.password || '');
  if (/\[password\]|<password>|your-password|placeholder/i.test(decodedPassword)) {
    throw new Error('Target connection string contains placeholder password');
  }

  if (!u.password || u.password.trim() === '') {
    throw new Error('Target password in connection string is empty');
  }

  return {
    hostname: u.hostname,
    port,
    username: u.username,
    database: dbName,
    sslmode,
  };
}

export function evaluatePreCheckGuard(preCheckState, repoVersions) {
  const { hasMigrationsTable, appliedVersions, publicTables, automationSettings } = preCheckState;

  // 1. Guard against unknown migration versions in database
  const unknownVersions = appliedVersions.filter(v => !repoVersions.includes(v));
  if (unknownVersions.length > 0) {
    throw new Error(
      `Pre-check guard failed: Database contains unknown migration versions not present in repository: ${unknownVersions.join(', ')}`
    );
  }

  // 2. Guard against inconsistent schema vs migration ledger
  // If application tables already exist, there must be a valid migrations table with applied versions
  if (publicTables.length > 0) {
    if (!hasMigrationsTable || appliedVersions.length === 0) {
      throw new Error(
        `Pre-check guard failed: Database contains ${publicTables.length} application tables but no valid migration ledger.`
      );
    }
  }

  // 3. Guard against non-SHADOW mode or active emergency_stop if automation_settings already exists
  if (automationSettings) {
    if (automationSettings.mode !== 'SHADOW') {
      throw new Error(
        `Pre-check guard failed: Existing automation_settings mode is "${automationSettings.mode}". Only "SHADOW" mode is permitted before mutation.`
      );
    }
    if (automationSettings.emergency_stop) {
      throw new Error(
        `Pre-check guard failed: Existing automation_settings emergency_stop is active (true). Cannot proceed while emergency stop is engaged.`
      );
    }
  }

  const isFresh = publicTables.length === 0 && appliedVersions.length === 0;
  const pendingCount = repoVersions.filter(v => !appliedVersions.includes(v)).length;

  return {
    isFresh,
    pendingCount,
    appliedCount: appliedVersions.length,
  };
}

export async function runPipelinePreCheck(client) {
  let hasMigrationsTable = false;
  let appliedVersions = [];
  let publicTables = [];
  let automationSettings = null;

  // Check if supabase_migrations.schema_migrations exists
  const regRes = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
    ) AS has_migrations_table;
  `);

  hasMigrationsTable = Boolean(regRes.rows[0]?.has_migrations_table);

  if (hasMigrationsTable) {
    const vRes = await client.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`);
    appliedVersions = vRes.rows.map(r => r.version);
  }

  // Query all public tables
  const tRes = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name;
  `);
  publicTables = tRes.rows.map(r => r.table_name);

  // If automation_settings table exists, check its state
  if (publicTables.includes('automation_settings')) {
    const sRes = await client.query(`
      SELECT singleton, mode, emergency_stop, version
      FROM public.automation_settings WHERE singleton = true;
    `);
    if (sRes.rows.length > 0) {
      automationSettings = sRes.rows[0];
    }
  }

  return {
    hasMigrationsTable,
    appliedVersions,
    publicTables,
    automationSettings,
  };
}

export async function runDirectedVerification(client, options = {}) {
  const migrationsDir = options.migrationsDir || path.resolve(rootDir, 'supabase/migrations');
  const testerSenderId = options.testerSenderId || '6727338166';
  const botAccountId = options.botAccountId || 'upaznet_helpdesk_bot';

  const repoFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const repoVersions = repoFiles.map(f => f.match(/^(\d{14})_/)[1]);

  const summary = {};

  // 1. Verify Migration Ledger
  const vRows = (await client.query(`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;`)).rows;
  const dbAppliedVersions = vRows.map(r => r.version);

  const missingVersions = repoVersions.filter(v => !dbAppliedVersions.includes(v));
  const unknownVersions = dbAppliedVersions.filter(v => !repoVersions.includes(v));

  if (missingVersions.length > 0) {
    throw new Error(`Verification Assertion Failed: Missing migration versions in DB: ${missingVersions.join(', ')}`);
  }
  if (unknownVersions.length > 0) {
    throw new Error(`Verification Assertion Failed: Unknown migration versions in DB: ${unknownVersions.join(', ')}`);
  }
  if (dbAppliedVersions.length !== repoVersions.length) {
    throw new Error(`Verification Assertion Failed: Ledger count mismatch: DB=${dbAppliedVersions.length}, Repo=${repoVersions.length}`);
  }
  summary.migrationsApplied = dbAppliedVersions.length;
  summary.migrationsTotal = repoVersions.length;

  // 2. Verify Core Tables Presence
  const currentTables = (await client.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  `)).rows.map(r => r.table_name);

  const missingTables = CORE_TABLES.filter(t => !currentTables.includes(t));
  if (missingTables.length > 0) {
    throw new Error(`Verification Assertion Failed: Missing core tables in public schema: ${missingTables.join(', ')}`);
  }
  summary.coreTablesVerified = CORE_TABLES.length;

  // 3. Verify Topology Fixtures
  // ODC (1)
  const odcRow = (await client.query(`
    SELECT id, odc_code, display_name FROM public.odcs
    WHERE id = '30000000-0000-4000-8000-000000000001';
  `)).rows[0];
  if (!odcRow || odcRow.odc_code !== 'ODC-DUMMY-01' || odcRow.display_name !== 'ODC Simulasi Utama') {
    throw new Error(`Verification Assertion Failed: ODC fixture 30000000-...-0001 (ODC-DUMMY-01) invalid or missing`);
  }
  const scopedOdcCount = (await client.query(`
    SELECT count(*)::int AS c FROM public.odcs WHERE odc_code LIKE 'ODC-DUMMY-%';
  `)).rows[0].c;
  if (scopedOdcCount !== 1) {
    throw new Error(`Verification Assertion Failed: Expected exactly 1 ODC-DUMMY-% record, got ${scopedOdcCount}`);
  }
  summary.odcs = scopedOdcCount;

  // ODP (2)
  const odpRows = (await client.query(`
    SELECT id, odc_id, odp_code, display_name FROM public.odps
    WHERE odp_code IN ('ODP-DUMMY-01', 'ODP-DUMMY-02') ORDER BY odp_code;
  `)).rows;
  if (odpRows.length !== 2) {
    throw new Error(`Verification Assertion Failed: Expected 2 dummy ODP records, got ${odpRows.length}`);
  }
  if (odpRows[0].odc_id !== '30000000-0000-4000-8000-000000000001' || odpRows[1].odc_id !== '30000000-0000-4000-8000-000000000001') {
    throw new Error(`Verification Assertion Failed: ODP fixtures odc_id relation invalid`);
  }
  const scopedOdpCount = (await client.query(`
    SELECT count(*)::int AS c FROM public.odps WHERE odp_code LIKE 'ODP-DUMMY-%';
  `)).rows[0].c;
  if (scopedOdpCount !== 2) {
    throw new Error(`Verification Assertion Failed: Expected exactly 2 ODP-DUMMY-% records, got ${scopedOdpCount}`);
  }
  summary.odps = scopedOdpCount;

  // 4. Verify Customers (12)
  const custRows = (await client.query(`
    SELECT id, customer_code, display_name FROM public.customers
    WHERE customer_code LIKE 'DUMMY-CUST-%' ORDER BY customer_code;
  `)).rows;
  if (custRows.length !== 12) {
    throw new Error(`Verification Assertion Failed: Expected 12 dummy customers, got ${custRows.length}`);
  }
  for (let n = 1; n <= 12; n++) {
    const expectedId = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const expectedCode = `DUMMY-CUST-${String(n).padStart(3, '0')}`;
    const row = custRows[n - 1];
    if (row.id !== expectedId || row.customer_code !== expectedCode) {
      throw new Error(`Verification Assertion Failed: Customer fixture #${n} mismatch: got (${row.id}, ${row.customer_code}), expected (${expectedId}, ${expectedCode})`);
    }
  }
  summary.customers = custRows.length;

  // 5. Verify Services (12) & Relation to Customers
  const svcRows = (await client.query(`
    SELECT id, customer_id, service_code, display_name FROM public.services
    WHERE service_code LIKE 'DUMMY-SVC-%' ORDER BY service_code;
  `)).rows;
  if (svcRows.length !== 12) {
    throw new Error(`Verification Assertion Failed: Expected 12 dummy services, got ${svcRows.length}`);
  }
  for (let n = 1; n <= 12; n++) {
    const expectedId = `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const expectedCustId = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const expectedCode = `DUMMY-SVC-${String(n).padStart(3, '0')}`;
    const row = svcRows[n - 1];
    if (row.id !== expectedId || row.customer_id !== expectedCustId || row.service_code !== expectedCode) {
      throw new Error(`Verification Assertion Failed: Service fixture #${n} mismatch: got (${row.id}, cust: ${row.customer_id}, ${row.service_code})`);
    }
  }
  summary.services = svcRows.length;

  // 6. Verify Service Topology Mappings (12) & Relation to ODPs
  const topRows = (await client.query(`
    SELECT id, service_id, odp_id FROM public.service_topology
    WHERE id >= '50000000-0000-4000-8000-000000000001' AND id <= '50000000-0000-4000-8000-000000000012'
    ORDER BY id;
  `)).rows;
  if (topRows.length !== 12) {
    throw new Error(`Verification Assertion Failed: Expected 12 dummy topology mappings, got ${topRows.length}`);
  }
  for (let n = 1; n <= 12; n++) {
    const expectedSvcId = `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const expectedOdpId = n <= 10 ? '40000000-0000-4000-8000-000000000001' : '40000000-0000-4000-8000-000000000002';
    const row = topRows[n - 1];
    if (row.service_id !== expectedSvcId || row.odp_id !== expectedOdpId) {
      throw new Error(`Verification Assertion Failed: Topology mapping #${n} relation mismatch: got (svc: ${row.service_id}, odp: ${row.odp_id})`);
    }
  }
  summary.topologyMappings = topRows.length;

  // 7. Verify Dummy Channel Identities (5)
  const dummyIdentityRows = (await client.query(`
    SELECT id, channel, channel_account_id, sender_external_id, customer_id, verification_status
    FROM public.channel_identities
    WHERE id >= '60000000-0000-4000-8000-000000000001' AND id <= '60000000-0000-4000-8000-000000000005'
    ORDER BY id;
  `)).rows;
  if (dummyIdentityRows.length !== 5) {
    throw new Error(`Verification Assertion Failed: Expected 5 dummy channel identities, got ${dummyIdentityRows.length}`);
  }
  for (let n = 1; n <= 4; n++) {
    const row = dummyIdentityRows[n - 1];
    const expectedCustId = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const expectedSender = `dummy-sender-${String(n).padStart(3, '0')}`;
    if (row.channel !== 'telegram' || row.channel_account_id !== 'dummy-bot-upaznet' || row.sender_external_id !== expectedSender || row.customer_id !== expectedCustId || row.verification_status !== 'verified') {
      throw new Error(`Verification Assertion Failed: Dummy channel identity #${n} mismatch`);
    }
  }
  const unknownIdentity = dummyIdentityRows[4];
  if (unknownIdentity.channel !== 'telegram' || unknownIdentity.sender_external_id !== 'dummy-sender-unknown' || unknownIdentity.customer_id !== null || unknownIdentity.verification_status !== 'unverified') {
    throw new Error(`Verification Assertion Failed: Dummy unknown identity mismatch`);
  }
  summary.dummyChannelIdentities = dummyIdentityRows.length;

  // 8. Verify Tester Channel Identity Mapping
  const testerIdentity = (await client.query(`
    SELECT id, channel, channel_account_id, sender_external_id, customer_id, verification_status
    FROM public.channel_identities
    WHERE channel = 'telegram' AND channel_account_id = $1 AND sender_external_id = $2;
  `, [botAccountId, testerSenderId])).rows[0];

  if (!testerIdentity) {
    throw new Error(`Verification Assertion Failed: Tester channel identity not found for bot=${botAccountId}, sender=${testerSenderId}`);
  }
  if (testerIdentity.customer_id !== '10000000-0000-4000-8000-000000000001') {
    throw new Error(`Verification Assertion Failed: Tester customer_id mismatch: got "${testerIdentity.customer_id}", expected "10000000-0000-4000-8000-000000000001"`);
  }
  if (testerIdentity.verification_status !== 'verified') {
    throw new Error(`Verification Assertion Failed: Tester verification_status mismatch: got "${testerIdentity.verification_status}", expected "verified"`);
  }
  summary.testerIdentity = {
    channel: testerIdentity.channel,
    botAccountId: testerIdentity.channel_account_id,
    senderId: testerIdentity.sender_external_id,
    linkedCustomerId: testerIdentity.customer_id,
    status: testerIdentity.verification_status,
  };

  // 9. Verify Mock Network Scenarios (16)
  const scenRows = (await client.query(`SELECT id FROM public.mock_network_scenarios ORDER BY id;`)).rows;
  const dbScenIds = scenRows.map(r => r.id);
  const missingScenarios = EXPECTED_SCENARIO_IDS.filter(id => !dbScenIds.includes(id));
  if (missingScenarios.length > 0) {
    throw new Error(`Verification Assertion Failed: Missing mock network scenarios: ${missingScenarios.join(', ')}`);
  }
  if (dbScenIds.length !== EXPECTED_SCENARIO_IDS.length) {
    throw new Error(`Verification Assertion Failed: Mock scenarios count mismatch: got ${dbScenIds.length}, expected ${EXPECTED_SCENARIO_IDS.length}`);
  }
  summary.mockNetworkScenarios = dbScenIds.length;

  // 10. Verify Mock Observations Pairs (180 ONU pairs across 15 scenarios & 12 dummy services, 16 Upstream pairs)
  // Scoped strictly to the fixture space so data outside fixtures does not cause false positives/negatives.
  const onuRows = (await client.query(`
    SELECT scenario_id, service_id
    FROM public.mock_onu_status
    WHERE service_id >= '20000000-0000-4000-8000-000000000001'
      AND service_id <= '20000000-0000-4000-8000-000000000012';
  `)).rows;

  const foundOnuPairs = new Set(onuRows.map(r => `${r.scenario_id}:${r.service_id}`));
  const missingOnuPairs = [];

  for (const scenarioId of EXPECTED_ONU_SCENARIO_IDS) {
    for (const serviceId of EXPECTED_DUMMY_SERVICE_IDS) {
      const key = `${scenarioId}:${serviceId}`;
      if (!foundOnuPairs.has(key)) {
        missingOnuPairs.push(key);
      }
    }
  }

  if (missingOnuPairs.length > 0) {
    throw new Error(
      `Verification Assertion Failed: Missing ${missingOnuPairs.length} expected ONU observation pairs: ${missingOnuPairs.slice(0, 5).join(', ')}${missingOnuPairs.length > 5 ? '...' : ''}`
    );
  }

  // Ensure scenario missing_status has NO observations for dummy services
  const invalidMissingStatusRows = onuRows.filter(r => r.scenario_id === 'missing_status');
  if (invalidMissingStatusRows.length > 0) {
    throw new Error(
      `Verification Assertion Failed: Scenario "missing_status" must not contain ONU observations, but found ${invalidMissingStatusRows.length} rows.`
    );
  }

  summary.mockOnuStatusPairsVerified = EXPECTED_ONU_SCENARIO_IDS.length * EXPECTED_DUMMY_SERVICE_IDS.length; // 180

  // Upstream pair verification for link MOCK-UPLINK-01 across 16 scenarios
  const upsRows = (await client.query(`
    SELECT scenario_id, link_id
    FROM public.mock_upstream_status
    WHERE link_id = 'MOCK-UPLINK-01';
  `)).rows;

  const foundUpsPairs = new Set(upsRows.map(r => `${r.scenario_id}:${r.link_id}`));
  const missingUpsPairs = [];

  for (const scenarioId of EXPECTED_SCENARIO_IDS) {
    const key = `${scenarioId}:MOCK-UPLINK-01`;
    if (!foundUpsPairs.has(key)) {
      missingUpsPairs.push(key);
    }
  }

  if (missingUpsPairs.length > 0) {
    throw new Error(
      `Verification Assertion Failed: Missing ${missingUpsPairs.length} expected upstream observation pairs: ${missingUpsPairs.join(', ')}`
    );
  }

  summary.mockUpstreamStatusPairsVerified = EXPECTED_SCENARIO_IDS.length; // 16

  // 11. Stale Scenario Mandatory Assertion (Must genuinely be older than 5 minutes)
  const staleOnu = (await client.query(`
    SELECT status, observed_at, observed_at < (now() - interval '5 minutes') AS is_stale
    FROM public.mock_onu_status
    WHERE scenario_id = 'stale' AND service_id = '20000000-0000-4000-8000-000000000001';
  `)).rows[0];

  if (!staleOnu) {
    throw new Error(`Verification Assertion Failed: Stale ONU observation row missing`);
  }
  if (staleOnu.is_stale !== true) {
    throw new Error(`Verification Assertion Failed: Stale ONU observation is not stale (observed_at: ${staleOnu.observed_at})`);
  }

  const staleUps = (await client.query(`
    SELECT status, observed_at, observed_at < (now() - interval '5 minutes') AS is_stale
    FROM public.mock_upstream_status
    WHERE scenario_id = 'stale' AND link_id = 'MOCK-UPLINK-01';
  `)).rows[0];

  if (!staleUps) {
    throw new Error(`Verification Assertion Failed: Stale upstream observation row missing`);
  }
  if (staleUps.is_stale !== true) {
    throw new Error(`Verification Assertion Failed: Stale upstream observation is not stale (observed_at: ${staleUps.observed_at})`);
  }
  summary.staleScenarioPreserved = true;

  // 12. Automation Settings Assertion
  const autoSettings = (await client.query(`
    SELECT singleton, mode, emergency_stop, version FROM public.automation_settings WHERE singleton = true;
  `)).rows[0];

  if (!autoSettings) {
    throw new Error(`Verification Assertion Failed: automation_settings singleton row not found`);
  }
  if (autoSettings.mode !== 'SHADOW') {
    throw new Error(`Verification Assertion Failed: automation_settings mode is "${autoSettings.mode}". Expected "SHADOW".`);
  }
  if (autoSettings.emergency_stop !== false) {
    throw new Error(`Verification Assertion Failed: automation_settings emergency_stop is ${autoSettings.emergency_stop}. Expected false.`);
  }
  summary.automationSettings = {
    singleton: autoSettings.singleton,
    mode: autoSettings.mode,
    emergency_stop: autoSettings.emergency_stop,
    version: autoSettings.version,
  };

  return {
    ok: true,
    summary,
  };
}

export async function runPrototypePipeline(options = {}) {
  const logger = options.logger || console;

  // 0. Guard against mixed test client in mutating pipeline via environment
  if (process.env.PROTOTYPE_TEST_CLIENT_MODULE) {
    throw new Error(
      'PROTOTYPE_TEST_CLIENT_MODULE is forbidden in the mutating pipeline (apply-prototype-pipeline.mjs). ' +
      'Mock client modules cannot be used in mutating pipelines to prevent mock states from authorizing real database writes.'
    );
  }

  // Guard against partial dependency injection:
  // If a test clientFactory is injected, explicit migrationRunner and seedRunner MUST also be provided.
  // Never allow unprovided dependencies to fall back to real default runners.
  if (options.clientFactory) {
    if (!options.migrationRunner) {
      throw new Error(
        'Incomplete dependency injection: clientFactory was provided without an explicit migrationRunner. ' +
        'All runners must be explicitly injected alongside a test client to prevent fallback to real migration execution.'
      );
    }
    if (!options.seedRunner) {
      throw new Error(
        'Incomplete dependency injection: clientFactory was provided without an explicit seedRunner. ' +
        'All runners must be explicitly injected alongside a test client to prevent fallback to real seed execution.'
      );
    }
  }

  const envPath = options.envLocalPath || process.env.PROTOTYPE_ENV_FILE || (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null) || path.resolve(rootDir, '.env.local');
  const env = options.env || parseEnvLocal(envPath);
  const protoUrl = options.protoUrl || env.PROTOTYPE_DATABASE_URL;
  const clientFactory = options.clientFactory;

  const migrationRunner = options.migrationRunner || runPrototypeMigrations;
  const seedRunner = options.seedRunner || runPrototypeSeed;
  const migrationsDir = options.migrationsDir || path.resolve(rootDir, 'supabase/migrations');

  // 1. Target Validation
  validatePipelineTarget(env, protoUrl);
  const dbConfig = parseAndValidateDbConfig(protoUrl);

  const preClient = clientFactory ? clientFactory(dbConfig) : new Client(dbConfig);
  await preClient.connect();

  let preCheckState;
  try {
    preCheckState = await runPipelinePreCheck(preClient);
  } finally {
    await preClient.end();
  }

  // 2. Evaluate Pre-Check Guards
  const repoFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const repoVersions = repoFiles.map(f => f.match(/^(\d{14})_/)[1]);

  const guardEvaluation = evaluatePreCheckGuard(preCheckState, repoVersions);
  logger.log(`[Pipeline] Pre-check guard passed. Fresh DB: ${guardEvaluation.isFresh}, Pending migrations: ${guardEvaluation.pendingCount}`);

  // 3. Apply Migrations
  logger.log(`[Pipeline] Running migrations...`);
  const migrationResult = await migrationRunner(protoUrl, { logger, migrationsDir });

  // 4. Apply Seed
  logger.log(`[Pipeline] Running seed...`);
  const seedResult = await seedRunner(protoUrl, {
    requireShadow: true,
    logger,
    testerSenderId: env.TELEGRAM_TESTER_ALLOWLIST || '6727338166',
    botAccountId: env.TELEGRAM_BOT_ACCOUNT_ID || 'upaznet_helpdesk_bot',
  });

  if (!seedResult.shadowGuaranteed || seedResult.mode !== 'SHADOW') {
    throw new Error(`FATAL: Prototype seed did NOT guarantee SHADOW mode! (mode: ${seedResult.mode})`);
  }

  // 5. Mandatory Directed Verification
  logger.log(`[Pipeline] Running mandatory directed verification...`);
  const verifyClient = clientFactory ? clientFactory(dbConfig) : new Client(dbConfig);
  await verifyClient.connect();

  let verificationResult;
  try {
    verificationResult = await runDirectedVerification(verifyClient, {
      migrationsDir,
      testerSenderId: env.TELEGRAM_TESTER_ALLOWLIST || '6727338166',
      botAccountId: env.TELEGRAM_BOT_ACCOUNT_ID || 'upaznet_helpdesk_bot',
    });
  } finally {
    await verifyClient.end();
  }

  logger.log(`\n======================================================`);
  logger.log(`[PIPELINE VERIFICATION SUMMARY]`);
  logger.log(`Migrations: ${verificationResult.summary.migrationsApplied}/${verificationResult.summary.migrationsTotal} applied (0 pending) ✅`);
  logger.log(`Core Tables Verified: ${verificationResult.summary.coreTablesVerified} tables present ✅`);
  logger.log(`Fixtures: Customers=${verificationResult.summary.customers}, Services=${verificationResult.summary.services}, ODCs=${verificationResult.summary.odcs}, ODPs=${verificationResult.summary.odps}, Mappings=${verificationResult.summary.topologyMappings} ✅`);
  logger.log(`Tester Identity: ${verificationResult.summary.testerIdentity.senderId} linked to Customer ${verificationResult.summary.testerIdentity.linkedCustomerId} (${verificationResult.summary.testerIdentity.status}) ✅`);
  logger.log(`Network Fixtures: Scenarios=${verificationResult.summary.mockNetworkScenarios}, ONU pairs=${verificationResult.summary.mockOnuStatusPairsVerified}, Uplink pairs=${verificationResult.summary.mockUpstreamStatusPairsVerified} (stale preserved: ${verificationResult.summary.staleScenarioPreserved}) ✅`);
  logger.log(`Automation Settings: mode=${verificationResult.summary.automationSettings.mode}, emergency_stop=${verificationResult.summary.automationSettings.emergency_stop}, version=${verificationResult.summary.automationSettings.version} ✅`);
  logger.log(`Pipeline Status: ALL CHECKS PASSED SUCCESSFULLY ✅`);
  logger.log(`======================================================\n`);

  return {
    ok: true,
    preCheck: preCheckState,
    guardEvaluation,
    migrationResult,
    seedResult,
    verification: verificationResult,
  };
}

// CLI execution only when executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.env.PROTOTYPE_TEST_CLIENT_MODULE) {
    console.error(
      `\n[Pipeline Target Error]: PROTOTYPE_TEST_CLIENT_MODULE is forbidden in the mutating pipeline (apply-prototype-pipeline.mjs). ` +
      `Mock client modules cannot be used in mutating pipelines to prevent mock states from authorizing real database writes.`
    );
    process.exit(1);
  }

  runPrototypePipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n[Pipeline FATAL Error]:`, err.message);
      process.exit(1);
    });
}
