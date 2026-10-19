import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validatePipelineTarget,
  evaluatePreCheckGuard,
  runDirectedVerification,
  runPrototypePipeline,
  CORE_TABLES,
  EXPECTED_SCENARIO_IDS,
  EXPECTED_ONU_SCENARIO_IDS,
  EXPECTED_DUMMY_SERVICE_IDS,
} from '../../scripts/apply-prototype-pipeline.mjs';

import { runReadOnlyVerification } from '../../scripts/verify-prototype-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID_PROTO_URL = 'postgresql://postgres.saysxjdyalnbhxqqmytp:dummyAlphanumericPass123@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';

const MOCK_REPO_VERSIONS = [
  '20260919115958',
  '20260920090000',
  '20260922090000',
  '20260929100000',
  '20260929200000',
  '20260929200001',
  '20260930100000',
  '20261002100000',
  '20261004100000',
  '20261004110000',
  '20261004120000',
  '20261004130000',
  '20261012100000',
  '20261019120000',
];

// Helper to build a completely valid mock database query handler
function createValidMockClient(overrides = {}) {
  const queryLog = [];

  const client = {
    connect: async () => {},
    end: async () => {},
    query: async (sql, params = []) => {
      queryLog.push({ sql: sql.trim(), params });

      if (overrides.customHandler) {
        const customRes = overrides.customHandler(sql, params);
        if (customRes !== undefined) return customRes;
      }

      const s = sql.toLowerCase();

      // schema_migrations check
      if (s.includes('from information_schema.tables') && s.includes('supabase_migrations')) {
        return { rows: [{ has_migrations_table: overrides.hasMigrationsTable ?? true }] };
      }

      // schema_migrations query
      if (s.includes('from supabase_migrations.schema_migrations')) {
        const versions = overrides.appliedVersions ?? [...MOCK_REPO_VERSIONS];
        return { rows: versions.map(v => ({ version: v, name: 'migration_' + v })) };
      }

      // public tables query
      if (s.includes('from information_schema.tables') && s.includes('table_schema = \'public\'')) {
        const tables = overrides.publicTables ?? [...CORE_TABLES];
        return { rows: tables.map(t => ({ table_name: t })) };
      }

      // automation_settings query
      if (s.includes('from public.automation_settings')) {
        const settings = overrides.automationSettings !== undefined
          ? overrides.automationSettings
          : { singleton: true, mode: 'SHADOW', emergency_stop: false, version: 1 };
        return { rows: settings ? [settings] : [] };
      }

      // ODC queries
      if (s.includes('from public.odcs')) {
        if (s.includes('count(*)')) {
          return { rows: [{ c: overrides.scopedOdcCount ?? 1 }] };
        }
        return {
          rows: overrides.odcRows ?? [{
            id: '30000000-0000-4000-8000-000000000001',
            odc_code: 'ODC-DUMMY-01',
            display_name: 'ODC Simulasi Utama',
          }],
        };
      }

      // ODP queries
      if (s.includes('from public.odps')) {
        if (s.includes('count(*)')) {
          return { rows: [{ c: overrides.scopedOdpCount ?? 2 }] };
        }
        return {
          rows: overrides.odpRows ?? [
            {
              id: '40000000-0000-4000-8000-000000000001',
              odc_id: '30000000-0000-4000-8000-000000000001',
              odp_code: 'ODP-DUMMY-01',
              display_name: 'ODP Simulasi A',
            },
            {
              id: '40000000-0000-4000-8000-000000000002',
              odc_id: '30000000-0000-4000-8000-000000000001',
              odp_code: 'ODP-DUMMY-02',
              display_name: 'ODP Simulasi B',
            },
          ],
        };
      }

      // Customers query
      if (s.includes('from public.customers')) {
        if (overrides.custRows) return { rows: overrides.custRows };
        const rows = [];
        for (let n = 1; n <= 12; n++) {
          rows.push({
            id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            customer_code: `DUMMY-CUST-${String(n).padStart(3, '0')}`,
            display_name: `Pelanggan Dummy ${String(n).padStart(2, '0')}`,
          });
        }
        return { rows };
      }

      // Services query
      if (s.includes('from public.services')) {
        if (overrides.svcRows) return { rows: overrides.svcRows };
        const rows = [];
        for (let n = 1; n <= 12; n++) {
          rows.push({
            id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            customer_id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            service_code: `DUMMY-SVC-${String(n).padStart(3, '0')}`,
            display_name: `Layanan Dummy ${String(n).padStart(2, '0')}`,
          });
        }
        return { rows };
      }

      // Topology query
      if (s.includes('from public.service_topology')) {
        if (overrides.topRows) return { rows: overrides.topRows };
        const rows = [];
        for (let n = 1; n <= 12; n++) {
          rows.push({
            id: `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            service_id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            odp_id: n <= 10 ? '40000000-0000-4000-8000-000000000001' : '40000000-0000-4000-8000-000000000002',
          });
        }
        return { rows };
      }

      // Channel identities query
      if (s.includes('from public.channel_identities')) {
        if (params && params.length === 2 && params[0] === 'upaznet_helpdesk_bot' && params[1] === '6727338166') {
          // Tester lookup
          if (overrides.testerRow !== undefined) {
            return { rows: overrides.testerRow ? [overrides.testerRow] : [] };
          }
          return {
            rows: [{
              id: '60000000-0000-4000-8000-000000000099',
              channel: 'telegram',
              channel_account_id: 'upaznet_helpdesk_bot',
              sender_external_id: '6727338166',
              customer_id: '10000000-0000-4000-8000-000000000001',
              verification_status: 'verified',
            }],
          };
        }
        // Dummy 5 identities
        if (overrides.dummyIdentityRows) return { rows: overrides.dummyIdentityRows };
        const rows = [];
        for (let n = 1; n <= 4; n++) {
          rows.push({
            id: `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            channel: 'telegram',
            channel_account_id: 'dummy-bot-upaznet',
            sender_external_id: `dummy-sender-${String(n).padStart(3, '0')}`,
            customer_id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            verification_status: 'verified',
          });
        }
        rows.push({
          id: '60000000-0000-4000-8000-000000000005',
          channel: 'telegram',
          channel_account_id: 'dummy-bot-upaznet',
          sender_external_id: 'dummy-sender-unknown',
          customer_id: null,
          verification_status: 'unverified',
        });
        return { rows };
      }

      // Mock network scenarios
      if (s.includes('from public.mock_network_scenarios')) {
        const scenIds = overrides.scenarioIds ?? [...EXPECTED_SCENARIO_IDS];
        return { rows: scenIds.map(id => ({ id })) };
      }

      // Mock ONU status
      if (s.includes('from public.mock_onu_status')) {
        if (s.includes("scenario_id = 'stale'")) {
          if (overrides.staleOnuRow !== undefined) {
            return { rows: overrides.staleOnuRow ? [overrides.staleOnuRow] : [] };
          }
          return {
            rows: [{
              status: 'online',
              observed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              is_stale: overrides.isStaleOnu ?? true,
            }],
          };
        }
        if (overrides.onuRows) {
          return { rows: overrides.onuRows };
        }
        const rows = [];
        for (const scenId of EXPECTED_ONU_SCENARIO_IDS) {
          for (const svcId of EXPECTED_DUMMY_SERVICE_IDS) {
            rows.push({ scenario_id: scenId, service_id: svcId });
          }
        }
        return { rows };
      }

      // Mock Upstream status
      if (s.includes('from public.mock_upstream_status')) {
        if (s.includes("scenario_id = 'stale'")) {
          if (overrides.staleUpsRow !== undefined) {
            return { rows: overrides.staleUpsRow ? [overrides.staleUpsRow] : [] };
          }
          return {
            rows: [{
              status: 'up',
              observed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              is_stale: overrides.isStaleUps ?? true,
            }],
          };
        }
        if (overrides.upsRows) {
          return { rows: overrides.upsRows };
        }
        return {
          rows: EXPECTED_SCENARIO_IDS.map(id => ({ scenario_id: id, link_id: 'MOCK-UPLINK-01' })),
        };
      }

      return { rows: [] };
    },
    getQueryLog: () => queryLog,
  };

  return client;
}

// =========================================================================
// Suite 1: Target Validation Guard (Exact Match, Protocols, Ports, DB, Mock)
// =========================================================================
test('Suite 1: Target Validation Guard', async (t) => {
  const validEnv = { NETWORK_PROVIDER: 'mock' };

  await t.test('1.1: Rejects missing or non-mock NETWORK_PROVIDER', () => {
    assert.throws(
      () => validatePipelineTarget({}, VALID_PROTO_URL),
      /Invalid NETWORK_PROVIDER "undefined"\. Expected "mock"\./
    );
    assert.throws(
      () => validatePipelineTarget({ NETWORK_PROVIDER: 'live' }, VALID_PROTO_URL),
      /Invalid NETWORK_PROVIDER "live"\. Expected "mock"\./
    );
  });

  await t.test('1.2: Rejects invalid or missing PROTOTYPE_DATABASE_URL', () => {
    assert.throws(() => validatePipelineTarget(validEnv, null), /PROTOTYPE_DATABASE_URL is missing/);
    assert.throws(() => validatePipelineTarget(validEnv, ''), /PROTOTYPE_DATABASE_URL is missing/);
    assert.throws(() => validatePipelineTarget(validEnv, 'not-a-url'), /Invalid PROTOTYPE_DATABASE_URL format/);
    assert.throws(() => validatePipelineTarget(validEnv, 'http://localhost:5432/postgres'), /Invalid database protocol/);
  });

  await t.test('1.3: Rejects wrong host', () => {
    const wrongHost = 'postgresql://postgres.saysxjdyalnbhxqqmytp:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    assert.throws(
      () => validatePipelineTarget(validEnv, wrongHost),
      /Target host mismatch: got "aws-0-ap-southeast-1\.pooler\.supabase\.com", expected "aws-0-ap-southeast-2\.pooler\.supabase\.com"/
    );
  });

  await t.test('1.4: Rejects wrong port (must be 5432 for session pooler / migrations)', () => {
    const wrongPort = 'postgresql://postgres.saysxjdyalnbhxqqmytp:pass@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full';
    assert.throws(
      () => validatePipelineTarget(validEnv, wrongPort),
      /Target port mismatch: got 6543, expected 5432/
    );
  });

  await t.test('1.5: Enforces EXACT username match (rejects substring tricks)', () => {
    // Suffix tampering
    const suffixTampered = 'postgresql://postgres.saysxjdyalnbhxqqmytp_other:pass@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    assert.throws(
      () => validatePipelineTarget(validEnv, suffixTampered),
      /Target username mismatch: got "postgres\.saysxjdyalnbhxqqmytp_other", expected "postgres\.saysxjdyalnbhxqqmytp"/
    );

    // Prefix tampering
    const prefixTampered = 'postgresql://attacker_postgres.saysxjdyalnbhxqqmytp:pass@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    assert.throws(
      () => validatePipelineTarget(validEnv, prefixTampered),
      /Target username mismatch: got "attacker_postgres\.saysxjdyalnbhxqqmytp", expected "postgres\.saysxjdyalnbhxqqmytp"/
    );
  });

  await t.test('1.6: Rejects wrong database name or missing sslmode=verify-full', () => {
    const wrongDb = 'postgresql://postgres.saysxjdyalnbhxqqmytp:pass@aws-0-ap-southeast-2.pooler.supabase.com:5432/otherdb?sslmode=verify-full';
    assert.throws(() => validatePipelineTarget(validEnv, wrongDb), /Target database mismatch: got "otherdb", expected "postgres"/);

    const wrongSsl = 'postgresql://postgres.saysxjdyalnbhxqqmytp:pass@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require';
    assert.throws(() => validatePipelineTarget(validEnv, wrongSsl), /Target sslmode mismatch: got "require", expected "verify-full"/);
  });

  await t.test('1.7: Rejects placeholder or empty password', () => {
    const placeholder1 = 'postgresql://postgres.saysxjdyalnbhxqqmytp:[PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    assert.throws(() => validatePipelineTarget(validEnv, placeholder1), /contains placeholder password/);

    const emptyPw = 'postgresql://postgres.saysxjdyalnbhxqqmytp:@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    assert.throws(() => validatePipelineTarget(validEnv, emptyPw), /password in connection string is empty/);
  });

  await t.test('1.8: Accepts completely valid configuration', () => {
    const res = validatePipelineTarget(validEnv, VALID_PROTO_URL);
    assert.equal(res.hostname, 'aws-0-ap-southeast-2.pooler.supabase.com');
    assert.equal(res.port, 5432);
    assert.equal(res.username, 'postgres.saysxjdyalnbhxqqmytp');
    assert.equal(res.database, 'postgres');
    assert.equal(res.sslmode, 'verify-full');
  });
});

// =========================================================================
// Suite 2: Pre-check Guards & Zero-Runner Execution on Rejection
// =========================================================================
test('Suite 2: Pre-check Guards & Zero-Runner Execution', async (t) => {
  await t.test('2.1: Rejects existing automation_settings when mode is not SHADOW', () => {
    const preCheckState = {
      hasMigrationsTable: true,
      appliedVersions: [...MOCK_REPO_VERSIONS],
      publicTables: [...CORE_TABLES],
      automationSettings: { singleton: true, mode: 'FULL', emergency_stop: false },
    };
    assert.throws(
      () => evaluatePreCheckGuard(preCheckState, MOCK_REPO_VERSIONS),
      /Existing automation_settings mode is "FULL"\. Only "SHADOW" mode is permitted before mutation\./
    );
  });

  await t.test('2.2: Rejects existing automation_settings when emergency_stop is active (true)', () => {
    const preCheckState = {
      hasMigrationsTable: true,
      appliedVersions: [...MOCK_REPO_VERSIONS],
      publicTables: [...CORE_TABLES],
      automationSettings: { singleton: true, mode: 'SHADOW', emergency_stop: true },
    };
    assert.throws(
      () => evaluatePreCheckGuard(preCheckState, MOCK_REPO_VERSIONS),
      /Existing automation_settings emergency_stop is active \(true\)\. Cannot proceed while emergency stop is engaged\./
    );
  });

  await t.test('2.3: Rejects database with application tables but no valid migration ledger', () => {
    // Case A: schema_migrations table does not exist
    const noLedgerTable = {
      hasMigrationsTable: false,
      appliedVersions: [],
      publicTables: ['customers', 'complaints'],
      automationSettings: null,
    };
    assert.throws(
      () => evaluatePreCheckGuard(noLedgerTable, MOCK_REPO_VERSIONS),
      /Database contains 2 application tables but no valid migration ledger\./
    );

    // Case B: schema_migrations exists but has 0 records while public tables exist
    const emptyLedger = {
      hasMigrationsTable: true,
      appliedVersions: [],
      publicTables: ['customers', 'complaints'],
      automationSettings: null,
    };
    assert.throws(
      () => evaluatePreCheckGuard(emptyLedger, MOCK_REPO_VERSIONS),
      /Database contains 2 application tables but no valid migration ledger\./
    );
  });

  await t.test('2.4: Rejects database with unknown migration versions not found in repository', () => {
    const unknownVersionState = {
      hasMigrationsTable: true,
      appliedVersions: ['20260919115958', '99991231235959_malicious_or_rogue'],
      publicTables: ['customers'],
      automationSettings: null,
    };
    assert.throws(
      () => evaluatePreCheckGuard(unknownVersionState, MOCK_REPO_VERSIONS),
      /Database contains unknown migration versions not present in repository: 99991231235959_malicious_or_rogue/
    );
  });

  await t.test('2.5: Accepts fresh database (0 tables, 0 applied migrations)', () => {
    const freshState = {
      hasMigrationsTable: false,
      appliedVersions: [],
      publicTables: [],
      automationSettings: null,
    };
    const res = evaluatePreCheckGuard(freshState, MOCK_REPO_VERSIONS);
    assert.equal(res.isFresh, true);
    assert.equal(res.pendingCount, MOCK_REPO_VERSIONS.length);
    assert.equal(res.appliedCount, 0);
  });

  await t.test('2.6: Accepts valid existing database (all versions known, SHADOW mode, emergency_stop false)', () => {
    const validState = {
      hasMigrationsTable: true,
      appliedVersions: [...MOCK_REPO_VERSIONS],
      publicTables: [...CORE_TABLES],
      automationSettings: { singleton: true, mode: 'SHADOW', emergency_stop: false },
    };
    const res = evaluatePreCheckGuard(validState, MOCK_REPO_VERSIONS);
    assert.equal(res.isFresh, false);
    assert.equal(res.pendingCount, 0);
    assert.equal(res.appliedCount, MOCK_REPO_VERSIONS.length);
  });

  await t.test('2.7a: Rejects invalid target with 0 migrationRunner and 0 seedRunner calls', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return {}; };
    const mockSeedRunner = async () => { seedCalls++; return {}; };

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'live' },
          protoUrl: VALID_PROTO_URL,
          migrationRunner: mockMigrationRunner,
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Invalid NETWORK_PROVIDER "live"\. Expected "mock"\./
    );

    assert.equal(migrationCalls, 0, 'migrationRunner must NOT be called on invalid target');
    assert.equal(seedCalls, 0, 'seedRunner must NOT be called on invalid target');
  });

  await t.test('2.7b: Rejects existing mode non-SHADOW with 0 migrationRunner and 0 seedRunner calls', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return {}; };
    const mockSeedRunner = async () => { seedCalls++; return {}; };
    const mockClient = createValidMockClient({
      automationSettings: { singleton: true, mode: 'FULL', emergency_stop: false },
    });

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          migrationRunner: mockMigrationRunner,
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Pre-check guard failed: Existing automation_settings mode is "FULL"/
    );

    assert.equal(migrationCalls, 0, 'migrationRunner must NOT be called on non-SHADOW mode');
    assert.equal(seedCalls, 0, 'seedRunner must NOT be called on non-SHADOW mode');
  });

  await t.test('2.7c: Rejects existing emergency stop active with 0 migrationRunner and 0 seedRunner calls', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return {}; };
    const mockSeedRunner = async () => { seedCalls++; return {}; };
    const mockClient = createValidMockClient({
      automationSettings: { singleton: true, mode: 'SHADOW', emergency_stop: true },
    });

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          migrationRunner: mockMigrationRunner,
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Pre-check guard failed: Existing automation_settings emergency_stop is active \(true\)/
    );

    assert.equal(migrationCalls, 0, 'migrationRunner must NOT be called when emergency_stop is true');
    assert.equal(seedCalls, 0, 'seedRunner must NOT be called when emergency_stop is true');
  });

  await t.test('2.7d: Rejects application tables without valid ledger with 0 migrationRunner and 0 seedRunner calls', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return {}; };
    const mockSeedRunner = async () => { seedCalls++; return {}; };
    const mockClient = createValidMockClient({
      hasMigrationsTable: true,
      appliedVersions: [],
      publicTables: ['customers', 'complaints'],
    });

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          migrationRunner: mockMigrationRunner,
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Database contains 2 application tables but no valid migration ledger\./
    );

    assert.equal(migrationCalls, 0, 'migrationRunner must NOT be called when schema inconsistent');
    assert.equal(seedCalls, 0, 'seedRunner must NOT be called when schema inconsistent');
  });

  await t.test('2.7e: Rejects unknown migration version in ledger with 0 migrationRunner and 0 seedRunner calls', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return {}; };
    const mockSeedRunner = async () => { seedCalls++; return {}; };
    const mockClient = createValidMockClient({
      appliedVersions: ['20260919115958', '99991231235959_unknown'],
      publicTables: ['customers'],
    });

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          migrationRunner: mockMigrationRunner,
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Database contains unknown migration versions not present in repository: 99991231235959_unknown/
    );

    assert.equal(migrationCalls, 0, 'migrationRunner must NOT be called when unknown migrations present');
    assert.equal(seedCalls, 0, 'seedRunner must NOT be called when unknown migrations present');
  });

  await t.test('2.8: Pipeline proceeds and calls migration runner, seed runner, and verification on valid state', async () => {
    let migrationCalls = 0;
    let seedCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return { applied: 13 }; };
    const mockSeedRunner = async () => { seedCalls++; return { shadowGuaranteed: true, mode: 'SHADOW' }; };
    const mockClient = createValidMockClient();

    const res = await runPrototypePipeline({
      env: { NETWORK_PROVIDER: 'mock' },
      protoUrl: VALID_PROTO_URL,
      clientFactory: () => mockClient,
      migrationRunner: mockMigrationRunner,
      seedRunner: mockSeedRunner,
      logger: { log: () => {}, error: () => {}, warn: () => {} },
    });

    assert.equal(res.ok, true);
    assert.equal(migrationCalls, 1, 'migrationRunner must be called exactly once');
    assert.equal(seedCalls, 1, 'seedRunner must be called exactly once');
    assert.equal(res.verification.ok, true);
  });

  await t.test('2.9a: Rejects clientFactory without migrationRunner before any connection or runner call', async () => {
    let connectCalls = 0;
    let seedCalls = 0;
    const mockSeedRunner = async () => { seedCalls++; return { shadowGuaranteed: true, mode: 'SHADOW' }; };
    const mockClient = {
      connect: async () => { connectCalls++; },
      end: async () => {},
      query: async () => ({ rows: [] }),
    };

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          // migrationRunner intentionally omitted!
          seedRunner: mockSeedRunner,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Incomplete dependency injection: clientFactory was provided without an explicit migrationRunner/
    );

    assert.equal(connectCalls, 0, 'Must NOT attempt database connection when migrationRunner is missing');
    assert.equal(seedCalls, 0, 'Must NOT invoke seedRunner');
  });

  await t.test('2.9b: Rejects clientFactory without seedRunner before any connection or runner call', async () => {
    let connectCalls = 0;
    let migrationCalls = 0;
    const mockMigrationRunner = async () => { migrationCalls++; return { applied: 13 }; };
    const mockClient = {
      connect: async () => { connectCalls++; },
      end: async () => {},
      query: async () => ({ rows: [] }),
    };

    await assert.rejects(
      async () => {
        await runPrototypePipeline({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => mockClient,
          migrationRunner: mockMigrationRunner,
          // seedRunner intentionally omitted!
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /Incomplete dependency injection: clientFactory was provided without an explicit seedRunner/
    );

    assert.equal(connectCalls, 0, 'Must NOT attempt database connection when seedRunner is missing');
    assert.equal(migrationCalls, 0, 'Must NOT invoke migrationRunner');
  });

  await t.test('2.9c: Rejects runPrototypePipeline when PROTOTYPE_TEST_CLIENT_MODULE is set in process.env', async () => {
    const origEnvVal = process.env.PROTOTYPE_TEST_CLIENT_MODULE;
    try {
      process.env.PROTOTYPE_TEST_CLIENT_MODULE = 'some/test/client/module.mjs';
      await assert.rejects(
        async () => {
          await runPrototypePipeline({
            env: { NETWORK_PROVIDER: 'mock' },
            protoUrl: VALID_PROTO_URL,
            logger: { log: () => {}, error: () => {}, warn: () => {} },
          });
        },
        /PROTOTYPE_TEST_CLIENT_MODULE is forbidden in the mutating pipeline \(apply-prototype-pipeline\.mjs\)/
      );
    } finally {
      if (origEnvVal === undefined) {
        delete process.env.PROTOTYPE_TEST_CLIENT_MODULE;
      } else {
        process.env.PROTOTYPE_TEST_CLIENT_MODULE = origEnvVal;
      }
    }
  });
});

// =========================================================================
// Suite 3: Mandatory Directed Verification Assertions
// =========================================================================
test('Suite 3: Mandatory Directed Verification Assertions', async (t) => {
  await t.test('3.1: Fails when a repository migration is missing in ledger', async () => {
    const client = createValidMockClient({
      appliedVersions: MOCK_REPO_VERSIONS.slice(0, 13), // missing the 14th
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Missing migration versions in DB: 20261019120000/
    );
  });

  await t.test('3.2: Fails when an unknown migration exists in ledger', async () => {
    const client = createValidMockClient({
      appliedVersions: [...MOCK_REPO_VERSIONS, '20990101000000'],
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Unknown migration versions in DB: 20990101000000/
    );
  });

  await t.test('3.3: Fails when a core table is missing in schema', async () => {
    const client = createValidMockClient({
      publicTables: CORE_TABLES.filter(t => t !== 'complaints'),
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Missing core tables in public schema: complaints/
    );
  });

  await t.test('3.4: Fails when ODC fixture is missing or odc_code incorrect', async () => {
    const client = createValidMockClient({
      odcRows: [{ id: '30000000-0000-4000-8000-000000000001', odc_code: 'WRONG-ODC', display_name: 'ODC' }],
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /ODC fixture 30000000-\.\.\.-0001 \(ODC-DUMMY-01\) invalid or missing/
    );
  });

  await t.test('3.5: Fails when ODP fixture relation to ODC is invalid', async () => {
    const client = createValidMockClient({
      odpRows: [
        { id: '40000000-0000-4000-8000-000000000001', odc_id: 'wrong-odc-id', odp_code: 'ODP-DUMMY-01', display_name: 'ODP A' },
        { id: '40000000-0000-4000-8000-000000000002', odc_id: '30000000-0000-4000-8000-000000000001', odp_code: 'ODP-DUMMY-02', display_name: 'ODP B' },
      ],
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /ODP fixtures odc_id relation invalid/
    );
  });

  await t.test('3.6: Fails when customer count != 12 or ID/code mismatch', async () => {
    const client = createValidMockClient({
      custRows: [
        { id: '10000000-0000-4000-8000-000000000001', customer_code: 'WRONG-CODE', display_name: 'Dummy' },
      ],
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Expected 12 dummy customers, got 1/
    );
  });

  await t.test('3.7: Fails when service customer_id relation is broken', async () => {
    const invalidSvcRows = [];
    for (let n = 1; n <= 12; n++) {
      invalidSvcRows.push({
        id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        customer_id: n === 3 ? '00000000-0000-0000-0000-000000000000' : `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        service_code: `DUMMY-SVC-${String(n).padStart(3, '0')}`,
        display_name: `Layanan Dummy ${String(n).padStart(2, '0')}`,
      });
    }
    const client = createValidMockClient({ svcRows: invalidSvcRows });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Service fixture #3 mismatch/
    );
  });

  await t.test('3.8: Fails when service topology mapping relation is broken', async () => {
    const invalidTopRows = [];
    for (let n = 1; n <= 12; n++) {
      invalidTopRows.push({
        id: `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        service_id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        odp_id: '40000000-0000-4000-8000-000000000002', // all mapped to ODP 2 instead of 1-10 to ODP 1
      });
    }
    const client = createValidMockClient({ topRows: invalidTopRows });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Topology mapping #1 relation mismatch/
    );
  });

  await t.test('3.9: Fails when dummy channel identity is corrupted', async () => {
    const client = createValidMockClient({
      dummyIdentityRows: [
        { id: '60000000-0000-4000-8000-000000000001', channel: 'telegram', channel_account_id: 'wrong-bot', sender_external_id: 'dummy-sender-001', customer_id: '10000000-0000-4000-8000-000000000001', verification_status: 'verified' },
      ],
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Expected 5 dummy channel identities, got 1/
    );
  });

  await t.test('3.10: Fails when tester identity is missing, unverified, or linked to wrong customer', async () => {
    // Missing tester row
    const clientMissing = createValidMockClient({ testerRow: null });
    await assert.rejects(
      () => runDirectedVerification(clientMissing),
      /Tester channel identity not found for bot=upaznet_helpdesk_bot, sender=6727338166/
    );

    // Unverified status
    const clientUnverified = createValidMockClient({
      testerRow: {
        id: '60000000-0000-4000-8000-000000000099',
        channel: 'telegram',
        channel_account_id: 'upaznet_helpdesk_bot',
        sender_external_id: '6727338166',
        customer_id: '10000000-0000-4000-8000-000000000001',
        verification_status: 'unverified',
      },
    });
    await assert.rejects(
      () => runDirectedVerification(clientUnverified),
      /Tester verification_status mismatch: got "unverified", expected "verified"/
    );

    // Wrong customer ID
    const clientWrongCust = createValidMockClient({
      testerRow: {
        id: '60000000-0000-4000-8000-000000000099',
        channel: 'telegram',
        channel_account_id: 'upaznet_helpdesk_bot',
        sender_external_id: '6727338166',
        customer_id: '10000000-0000-4000-8000-000000000099',
        verification_status: 'verified',
      },
    });
    await assert.rejects(
      () => runDirectedVerification(clientWrongCust),
      /Tester customer_id mismatch/
    );
  });

  await t.test('3.11: Fails when mock network scenario count != 16', async () => {
    const client = createValidMockClient({
      scenarioIds: EXPECTED_SCENARIO_IDS.slice(0, 15), // missing 1
    });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Missing mock network scenarios: new_event/
    );
  });

  await t.test('3.12a: Semua 180 pasangan ONU dan 16 pasangan Upstream yang diharapkan tersedia: LULUS', async () => {
    const client = createValidMockClient();
    const res = await runDirectedVerification(client);
    assert.equal(res.summary.mockOnuStatusPairsVerified, 180);
    assert.equal(res.summary.mockUpstreamStatusPairsVerified, 16);
  });

  await t.test('3.12b: Satu pasangan ONU hilang: GAGAL', async () => {
    // Generate 179 rows by omitting (normal, service_1)
    const onuRows = [];
    for (const scenId of EXPECTED_ONU_SCENARIO_IDS) {
      for (const svcId of EXPECTED_DUMMY_SERVICE_IDS) {
        if (scenId === 'normal' && svcId === EXPECTED_DUMMY_SERVICE_IDS[0]) continue;
        onuRows.push({ scenario_id: scenId, service_id: svcId });
      }
    }
    const client = createValidMockClient({ onuRows });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Missing 1 expected ONU observation pairs: normal:20000000-0000-4000-8000-000000000001/
    );
  });

  await t.test('3.12c: Jumlah tetap 180 tetapi satu observasi normal diganti observasi missing_status: GAGAL', async () => {
    // Replace (normal, service_1) with (missing_status, service_1) -> count is still 180!
    const onuRows = [];
    for (const scenId of EXPECTED_ONU_SCENARIO_IDS) {
      for (const svcId of EXPECTED_DUMMY_SERVICE_IDS) {
        if (scenId === 'normal' && svcId === EXPECTED_DUMMY_SERVICE_IDS[0]) continue;
        onuRows.push({ scenario_id: scenId, service_id: svcId });
      }
    }
    onuRows.push({ scenario_id: 'missing_status', service_id: EXPECTED_DUMMY_SERVICE_IDS[0] });
    assert.equal(onuRows.length, 180, 'Must have exactly 180 rows to prove count alone is insufficient');

    const client = createValidMockClient({ onuRows });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Missing 1 expected ONU observation pairs/
    );
  });

  await t.test('3.12d: Jumlah upstream tetap 16 tetapi pasangan skenario/link salah: GAGAL', async () => {
    // Replace (normal, MOCK-UPLINK-01) with (normal, WRONG-LINK-99)
    const upsRows = EXPECTED_SCENARIO_IDS.map(id => {
      if (id === 'normal') return { scenario_id: id, link_id: 'WRONG-LINK-99' };
      return { scenario_id: id, link_id: 'MOCK-UPLINK-01' };
    });
    assert.equal(upsRows.length, 16, 'Total rows is 16');

    const client = createValidMockClient({ upsRows });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Verification Assertion Failed: Missing 1 expected upstream observation pairs: normal:MOCK-UPLINK-01/
    );
  });

  await t.test('3.12e: Fixture lengkap disertai data tambahan di luar ruang fixture: TETAP LULUS', async () => {
    // Extra ONU row for outside service
    const onuRows = [];
    for (const scenId of EXPECTED_ONU_SCENARIO_IDS) {
      for (const svcId of EXPECTED_DUMMY_SERVICE_IDS) {
        onuRows.push({ scenario_id: scenId, service_id: svcId });
      }
    }
    onuRows.push({ scenario_id: 'normal', service_id: '20000000-0000-4000-8000-000000000099' }); // extra outside fixture
    assert.equal(onuRows.length, 181);

    // Extra upstream row for another link
    const upsRows = EXPECTED_SCENARIO_IDS.map(id => ({ scenario_id: id, link_id: 'MOCK-UPLINK-01' }));
    upsRows.push({ scenario_id: 'normal', link_id: 'OTHER-UPLINK-99' }); // extra link
    assert.equal(upsRows.length, 17);

    const client = createValidMockClient({ onuRows, upsRows });
    const res = await runDirectedVerification(client);
    assert.equal(res.ok, true);
    assert.equal(res.summary.mockOnuStatusPairsVerified, 180);
    assert.equal(res.summary.mockUpstreamStatusPairsVerified, 16);
  });

  await t.test('3.13: Fails when stale scenario is not stale (observed_at < now() - 5m false)', async () => {
    const client = createValidMockClient({ isStaleOnu: false });
    await assert.rejects(
      () => runDirectedVerification(client),
      /Stale ONU observation is not stale/
    );

    const clientMissingStale = createValidMockClient({ staleOnuRow: null });
    await assert.rejects(
      () => runDirectedVerification(clientMissingStale),
      /Stale ONU observation row missing/
    );
  });

  await t.test('3.14: Fails when automation_settings is not SHADOW or emergency_stop is true', async () => {
    const clientMode = createValidMockClient({
      automationSettings: { singleton: true, mode: 'LOS_AND_GENERIC', emergency_stop: false },
    });
    await assert.rejects(
      () => runDirectedVerification(clientMode),
      /automation_settings mode is "LOS_AND_GENERIC"\. Expected "SHADOW"\./
    );

    const clientStop = createValidMockClient({
      automationSettings: { singleton: true, mode: 'SHADOW', emergency_stop: true },
    });
    await assert.rejects(
      () => runDirectedVerification(clientStop),
      /automation_settings emergency_stop is true\. Expected false\./
    );
  });

  await t.test('3.15: Fully valid mock client passes all assertions and returns ok: true', async () => {
    const client = createValidMockClient();
    const res = await runDirectedVerification(client);
    assert.equal(res.ok, true);
    assert.equal(res.summary.migrationsApplied, 14);
    assert.equal(res.summary.coreTablesVerified, 24);
    assert.equal(res.summary.customers, 12);
    assert.equal(res.summary.services, 12);
    assert.equal(res.summary.odcs, 1);
    assert.equal(res.summary.odps, 2);
    assert.equal(res.summary.topologyMappings, 12);
    assert.equal(res.summary.dummyChannelIdentities, 5);
    assert.equal(res.summary.testerIdentity.status, 'verified');
    assert.equal(res.summary.mockNetworkScenarios, 16);
    assert.equal(res.summary.mockOnuStatusPairsVerified, 180);
    assert.equal(res.summary.mockUpstreamStatusPairsVerified, 16);
    assert.equal(res.summary.staleScenarioPreserved, true);
    assert.equal(res.summary.automationSettings.mode, 'SHADOW');
    assert.equal(res.summary.automationSettings.emergency_stop, false);
  });
});

// =========================================================================
// Suite 4: Read-Only Verification Runner & Subprocess Exit Code Mapping
// =========================================================================
test('Suite 4: Read-Only Verification Runner & Subprocess Exit Code', async (t) => {
  await t.test('4.1: Executes "BEGIN READ ONLY" before queries and "COMMIT" after queries on success', async () => {
    const client = createValidMockClient();
    const res = await runReadOnlyVerification({
      env: { NETWORK_PROVIDER: 'mock' },
      protoUrl: VALID_PROTO_URL,
      clientFactory: () => client,
      logger: { log: () => {}, error: () => {}, warn: () => {} },
    });

    assert.equal(res.ok, true);
    const queryLog = client.getQueryLog();
    const sqls = queryLog.map(q => q.sql);

    assert.equal(sqls[0], 'BEGIN READ ONLY;');
    assert.equal(sqls[sqls.length - 1], 'COMMIT;');
    assert.equal(sqls.includes('ROLLBACK;'), false);
  });

  await t.test('4.2: Executes "ROLLBACK" and rejects when verification fails', async () => {
    const client = createValidMockClient({
      automationSettings: { singleton: true, mode: 'FULL', emergency_stop: false },
    });

    await assert.rejects(
      async () => {
        await runReadOnlyVerification({
          env: { NETWORK_PROVIDER: 'mock' },
          protoUrl: VALID_PROTO_URL,
          clientFactory: () => client,
          logger: { log: () => {}, error: () => {}, warn: () => {} },
        });
      },
      /automation_settings mode is "FULL"\. Expected "SHADOW"\./
    );

    const queryLog = client.getQueryLog();
    const sqls = queryLog.map(q => q.sql);
    assert.equal(sqls[0], 'BEGIN READ ONLY;');
    assert.equal(sqls[sqls.length - 1], 'ROLLBACK;');
  });

  // Helper to run CLI subprocess in clean isolated directory with dedicated dummy env and seam
  async function runSubprocessCli({ script, envFileContent, seamMode, extraArgs = [] }) {
    const targetScript = script || '../../scripts/verify-prototype-schema.mjs';
    const scriptPath = path.resolve(__dirname, targetScript);
    const seamPath = path.resolve(__dirname, './test-client-seam.mjs');
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cli-test-'));
    const dummyEnvPath = path.join(isolatedDir, 'dummy.env');

    if (envFileContent) {
      fs.writeFileSync(dummyEnvPath, envFileContent, 'utf8');
    }

    const cleanEnv = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT || '',
      PROTOTYPE_ENV_FILE: dummyEnvPath,
      PROTOTYPE_TEST_CLIENT_MODULE: seamPath,
      TEST_SEAM_MODE: seamMode || 'valid',
    };

    return new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
        cwd: isolatedDir,
        env: cleanEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', d => stdout += d.toString());
      child.stderr.on('data', d => stderr += d.toString());

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 5000);

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        try {
          fs.rmSync(isolatedDir, { recursive: true, force: true });
        } catch {}
        resolve({ code, signal, stdout, stderr });
      });
    });
  }

  const VALID_DUMMY_ENV = `
NETWORK_PROVIDER=mock
PROTOTYPE_DATABASE_URL=postgresql://postgres.saysxjdyalnbhxqqmytp:dummyAlphanumericPass123@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full
TELEGRAM_TESTER_ALLOWLIST=6727338166
TELEGRAM_BOT_ACCOUNT_ID=upaznet_helpdesk_bot
`.trim();

  const INVALID_TARGET_ENV = `
NETWORK_PROVIDER=live
PROTOTYPE_DATABASE_URL=postgresql://postgres.saysxjdyalnbhxqqmytp:dummyAlphanumericPass123@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full
`.trim();

  await t.test('4.3: Subprocess CLI with invalid target exits with code 1, reports guard error, and does NOT attempt connection', async () => {
    const res = await runSubprocessCli({
      envFileContent: INVALID_TARGET_ENV,
      seamMode: 'valid',
    });

    assert.equal(res.code, 1, `Subprocess must exit with code 1 on target validation failure. stderr: ${res.stderr}`);
    assert.match(res.stderr, /Invalid NETWORK_PROVIDER "live"\. Expected "mock"\./);
    assert.equal(res.stdout.includes('Connected to target:'), false, 'Must not attempt connection');
    assert.equal(res.stdout.includes('ALL READ-ONLY ASSERTIONS PASSED'), false);
  });

  await t.test('4.4: Subprocess CLI with valid dummy target and complete fixture via local seam exits with code 0 and reports all assertions passed', async () => {
    const res = await runSubprocessCli({
      envFileContent: VALID_DUMMY_ENV,
      seamMode: 'valid',
    });

    assert.equal(res.code, 0, `Subprocess must exit with code 0 on success. stderr: ${res.stderr}`);
    assert.match(res.stdout, /ALL READ-ONLY ASSERTIONS PASSED ✅/);
    assert.match(res.stdout, /Migrations: 14\/14 applied/);
    assert.match(res.stdout, /Core Tables Verified: 24 tables present/);
    assert.match(res.stdout, /ONU pairs=180, Uplink pairs=16/);
  });

  await t.test('4.5: Subprocess CLI with valid dummy target and broken fixture via local seam exits with code 1 with specific assertion reason and NO success message', async () => {
    const res = await runSubprocessCli({
      envFileContent: VALID_DUMMY_ENV,
      seamMode: 'broken_table',
    });

    assert.equal(res.code, 1, `Subprocess must exit with code 1 when assertion fails`);
    assert.match(res.stderr, /Verification Assertion Failed: Missing core tables in public schema:/);
    assert.equal(res.stdout.includes('ALL READ-ONLY ASSERTIONS PASSED'), false);
  });

  await t.test('4.6: Verification failure reason check: negative tests did not pass due to DNS, TLS, timeout, or missing config file', async () => {
    // Run negative target test and assert no network/TLS/config file errors occurred
    const resTarget = await runSubprocessCli({
      envFileContent: INVALID_TARGET_ENV,
      seamMode: 'valid',
    });
    assert.equal(resTarget.code, 1);
    const combinedTarget = resTarget.stderr + resTarget.stdout;
    assert.doesNotMatch(combinedTarget, /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i, 'Failure must not be due to network socket error');
    assert.doesNotMatch(combinedTarget, /self signed certificate|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT/i, 'Failure must not be due to TLS error');
    assert.doesNotMatch(combinedTarget, /File not found/i, 'Failure must not be due to missing configuration file');

    // Run negative assertion test and assert no network/TLS/config file errors occurred
    const resBroken = await runSubprocessCli({
      envFileContent: VALID_DUMMY_ENV,
      seamMode: 'broken_onu_pair',
    });
    assert.equal(resBroken.code, 1);
    const combinedBroken = resBroken.stderr + resBroken.stdout;
    assert.match(combinedBroken, /Verification Assertion Failed: Missing 1 expected ONU observation pairs/);
    assert.doesNotMatch(combinedBroken, /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i, 'Failure must not be due to network socket error');
    assert.doesNotMatch(combinedBroken, /self signed certificate/i, 'Failure must not be due to TLS error');
    assert.doesNotMatch(combinedBroken, /File not found/i, 'Failure must not be due to missing configuration file');
  });

  await t.test('4.7: Mutating CLI pipeline (apply-prototype-pipeline.mjs) rejects PROTOTYPE_TEST_CLIENT_MODULE with exit code 1, reports guard error, and does NOT attempt connection', async () => {
    const res = await runSubprocessCli({
      script: '../../scripts/apply-prototype-pipeline.mjs',
      envFileContent: VALID_DUMMY_ENV,
      seamMode: 'valid',
    });

    assert.equal(res.code, 1, `Mutating CLI must exit with code 1 when PROTOTYPE_TEST_CLIENT_MODULE is set. stderr: ${res.stderr}`);
    assert.match(res.stderr, /PROTOTYPE_TEST_CLIENT_MODULE is forbidden in the mutating pipeline \(apply-prototype-pipeline\.mjs\)/);
    assert.equal(res.stdout.includes('Connected to target:'), false, 'Must not attempt database connection');
    assert.equal(res.stdout.includes('Running migrations...'), false, 'Must not invoke migration runner');
    assert.equal(res.stdout.includes('Running seed...'), false, 'Must not invoke seed runner');
  });
});
