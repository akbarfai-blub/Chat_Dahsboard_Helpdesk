/**
 * tests/tooling/test-client-seam.mjs
 *
 * Test seam module for isolated CLI subprocess verification.
 * Dynamically loaded by scripts/verify-prototype-schema.mjs when
 * PROTOTYPE_TEST_CLIENT_MODULE points to this file.
 */

import {
  CORE_TABLES,
  EXPECTED_SCENARIO_IDS,
  EXPECTED_ONU_SCENARIO_IDS,
  EXPECTED_DUMMY_SERVICE_IDS,
} from '../../scripts/apply-prototype-pipeline.mjs';

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
];

export function clientFactory(dbConfig) {
  const mode = process.env.TEST_SEAM_MODE || 'valid';
  const queryLog = [];

  return {
    async connect() {},
    async end() {},
    async query(sql, params) {
      queryLog.push({ sql, params });
      const s = sql.toLowerCase();

      // Transactions
      if (s.startsWith('begin read only')) return { rows: [] };
      if (s.startsWith('commit')) return { rows: [] };
      if (s.startsWith('rollback')) return { rows: [] };

      // Schema migrations table existence
      if (s.includes('from information_schema.tables') && s.includes('supabase_migrations')) {
        return { rows: [{ has_migrations_table: true }] };
      }

      // Schema migrations versions
      if (s.includes('from supabase_migrations.schema_migrations')) {
        return { rows: MOCK_REPO_VERSIONS.map(v => ({ version: v, name: 'migration_' + v })) };
      }

      // Public tables
      if (s.includes('from information_schema.tables') && s.includes("table_schema = 'public'")) {
        if (mode === 'broken_table') {
          // Return only 1 table so assertion fails
          return { rows: [{ table_name: 'customers' }] };
        }
        return { rows: CORE_TABLES.map(t => ({ table_name: t })) };
      }

      // ODC query
      if (s.includes('from public.odcs')) {
        if (s.includes('count(*)')) return { rows: [{ c: 1 }] };
        return {
          rows: [{
            id: '30000000-0000-4000-8000-000000000001',
            odc_code: 'ODC-DUMMY-01',
            display_name: 'ODC Simulasi Utama',
          }],
        };
      }

      // ODP query
      if (s.includes('from public.odps')) {
        if (s.includes('count(*)')) return { rows: [{ c: 2 }] };
        return {
          rows: [
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

      // Service topology query
      if (s.includes('from public.service_topology')) {
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

      // Channel identities
      if (s.includes('from public.channel_identities')) {
        if (params && params.length === 2 && params[0] === 'upaznet_helpdesk_bot' && params[1] === '6727338166') {
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
        return { rows: EXPECTED_SCENARIO_IDS.map(id => ({ id })) };
      }

      // Mock ONU status
      if (s.includes('from public.mock_onu_status')) {
        if (s.includes("scenario_id = 'stale'")) {
          return {
            rows: [{
              status: 'online',
              observed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              is_stale: true,
            }],
          };
        }
        // Return 180 pairs
        if (mode === 'broken_onu_pair') {
          // Omit one pair
          const rows = [];
          for (const scenId of EXPECTED_ONU_SCENARIO_IDS) {
            for (const svcId of EXPECTED_DUMMY_SERVICE_IDS) {
              if (scenId === 'normal' && svcId === EXPECTED_DUMMY_SERVICE_IDS[0]) continue;
              rows.push({ scenario_id: scenId, service_id: svcId });
            }
          }
          return { rows };
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
          return {
            rows: [{
              status: 'up',
              observed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              is_stale: true,
            }],
          };
        }
        return {
          rows: EXPECTED_SCENARIO_IDS.map(id => ({ scenario_id: id, link_id: 'MOCK-UPLINK-01' })),
        };
      }

      // Automation settings
      if (s.includes('from public.automation_settings')) {
        return { rows: [{ singleton: true, mode: 'SHADOW', emergency_stop: false, version: 1 }] };
      }

      return { rows: [] };
    },
  };
}
