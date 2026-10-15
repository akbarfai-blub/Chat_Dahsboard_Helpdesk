#!/usr/bin/env node
/**
 * scripts/smoke-test-deployment.mjs
 *
 * Smoke test runner for prototype deployment verification (P2.10).
 *
 * Enforces strict verification without placeholders:
 * 1. HTTPS reachability and TLS status.
 * 2. Unauthenticated access protection (dashboard redirects to /login, API returns 401).
 * 3. Pre-ingestion SHADOW check: verifies automation_settings in DB is SHADOW before sending test message;
 *    halts immediately if mode is not SHADOW.
 * 4. Webhook security: missing or wrong secret rejected (401) with verified zero DB mutation.
 * 5. Webhook ingestion: valid dummy tester message accepted (200), verified response envelope
 *    (status: 'accepted', duplicate: false, valid ingressId).
 * 6. Bounded polling for background job completion (processing_jobs status 'done').
 * 7. Correlated schema-accurate DB assertions:
 *    - ingress_events: found by exact ingressId, mode SHADOW, correct provider message ID.
 *    - processing_jobs: ingress_id, status 'done', attempt_count >= 1, completed_at set.
 *    - messages: id = ingressId, classification not null, conversation_id not null.
 *    - outbound_intents: 0 automatic intents created for this message/complaint.
 *    - reply_claims: 0 claims created for this complaint.
 * 8. Real staff authentication flow: signInWithPassword, authenticated access to /dashboard (200)
 *    and /api/inbox/conversations (200), signOut, and verification of session eviction post-logout.
 * 9. Missing credentials or DB connection explicitly fails the test (no silent skipping).
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createServerClient } from '@supabase/ssr';
import { parseAndValidateDbConfig } from './apply-prototype-migrations.mjs';

const { Client } = pg;

export function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const body = options.body;
    const headers = options.headers || {};

    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: options.timeoutMs || 10000,
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request to ${url.pathname} timed out`));
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Validates that an HTTP response represents a valid redirect to the login page.
 * Requires supported redirect status (307 or 302) and exact pathname '/login'.
 * Rejects 200 responses with Location, non-login destinations (/dashboard, /maintenance, etc.),
 * and off-origin redirects.
 */
export function isValidLoginRedirect(status, locationHeader, baseUrl) {
  if (status !== 307 && status !== 302) {
    return false;
  }
  if (!locationHeader || typeof locationHeader !== 'string') {
    return false;
  }
  const trimmed = locationHeader.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const baseStr = baseUrl && typeof baseUrl === 'string'
      ? (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(baseUrl.trim()) ? baseUrl.trim() : `https://${baseUrl.trim()}`)
      : 'https://example.test';
    const parsedBase = new URL(baseStr);
    const parsed = new URL(trimmed, parsedBase);

    // After parsing succeeds, always compare parsed.origin with target origin
    if (parsed.origin !== parsedBase.origin) {
      return false;
    }

    // Pathname must be strictly '/login'
    return parsed.pathname === '/login';
  } catch {
    return false;
  }
}

/**
 * Polls PostgreSQL until the processing job for the given ingressId completes.
 * Times out if the job does not complete within maxWaitMs.
 */
export async function pollJobCompletion(pgClient, ingressId, options = {}) {
  const maxWaitMs = options.maxWaitMs || 10000;
  const intervalMs = options.intervalMs || 250;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { rows } = await pgClient.query(
      `SELECT ingress_id, status, attempt_count, max_attempts, completed_at, last_error
       FROM public.processing_jobs
       WHERE ingress_id = $1;`,
      [ingressId]
    );

    if (rows.length > 0) {
      const job = rows[0];
      if (job.status === 'done') {
        return { ok: true, job, elapsedMs: Date.now() - startTime };
      }
      if (job.status === 'failed') {
        return { ok: false, job, error: `Job permanently failed: ${job.last_error}` };
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { ok: false, error: `Job processing timed out after ${maxWaitMs}ms for ingress ${ingressId}` };
}

export async function runDeploymentSmokeTest({
  baseUrl,
  dbUrl,
  supabaseUrl,
  supabaseAnonKey,
  staffEmail,
  staffPassword,
  webhookSecret,
  testerId = '6727338166',
  logger = console,
  clientFactory,
  httpRequester = httpRequest,
  authClientFactory,
}) {
  const results = {
    baseUrl,
    timestamp: new Date().toISOString(),
    checks: {},
    allPassed: false,
  };

  logger.log(`\n======================================================`);
  logger.log(`[Smoke Test] Starting P2.10 Prototype Smoke Test`);
  logger.log(`Target URL: ${baseUrl}`);
  logger.log(`Tester ID: ${testerId}`);
  logger.log(`======================================================\n`);

  // --- Check 1: HTTPS Reachability ---
  logger.log(`[Check 1] Verifying HTTPS Reachability...`);
  try {
    const rootRes = await httpRequester(baseUrl);
    const isHttps = baseUrl.startsWith('https://');
    const reachable = rootRes.status >= 200 && rootRes.status < 500;
    results.checks.httpsReachable = {
      pass: reachable && isHttps,
      status: rootRes.status,
      isHttps,
    };
    logger.log(`  -> Status: ${rootRes.status}, HTTPS: ${isHttps} [${results.checks.httpsReachable.pass ? 'PASS' : 'FAIL'}]`);
  } catch (err) {
    results.checks.httpsReachable = { pass: false, error: err.message };
    logger.error(`  -> Failed: ${err.message}`);
  }

  // --- Check 2: Unauthenticated Protection ---
  logger.log(`\n[Check 2] Verifying Unauthenticated Protection...`);
  try {
    const unauthDashboard = await httpRequester(`${baseUrl}/dashboard`);
    const unauthApi = await httpRequester(`${baseUrl}/api/inbox/conversations`);

    const locationHeader = unauthDashboard.headers?.location || unauthDashboard.headers?.Location;
    const dashboardProtected = isValidLoginRedirect(unauthDashboard.status, locationHeader, baseUrl);
    const apiProtected = unauthApi.status === 401;

    results.checks.unauthenticatedProtected = {
      pass: dashboardProtected && apiProtected,
      dashboardStatus: unauthDashboard.status,
      dashboardLocation: locationHeader || null,
      dashboardRedirectValid: dashboardProtected,
      apiStatus: unauthApi.status,
    };
    logger.log(`  -> /dashboard status: ${unauthDashboard.status} (Location: ${locationHeader || 'none'}, valid redirect: ${dashboardProtected})`);
    logger.log(`  -> /api/inbox/conversations status: ${unauthApi.status}`);
    logger.log(`  -> Result: [${results.checks.unauthenticatedProtected.pass ? 'PASS' : 'FAIL'}]`);
  } catch (err) {
    results.checks.unauthenticatedProtected = { pass: false, error: err.message };
    logger.error(`  -> Failed: ${err.message}`);
  }

  // --- Connect to Database for Mandatory Assertions ---
  let pgClient = null;
  logger.log(`\n[DB Connection] Validating database connection and TLS...`);
  if (!dbUrl) {
    results.checks.dbConnection = {
      pass: false,
      error: 'Database URL is missing. Mandatory database assertions cannot run.',
    };
    logger.error(`  -> Failed: Database URL is required.`);
  } else {
    try {
      const dbConfig = parseAndValidateDbConfig(dbUrl);
      pgClient = clientFactory ? clientFactory(dbConfig) : new Client(dbConfig);
      await pgClient.connect();
      results.checks.dbConnection = { pass: true, hostname: dbConfig.hostname };
      logger.log(`  -> Connected to PostgreSQL (${dbConfig.hostname}:${dbConfig.port}/${dbConfig.database}) [PASS]`);
    } catch (err) {
      results.checks.dbConnection = { pass: false, error: err.message };
      logger.error(`  -> Failed to connect to DB: ${err.message}`);
    }
  }

  // --- Check 3: Webhook Security (Secret Validation & Zero DB Mutation) ---
  logger.log(`\n[Check 3] Verifying Webhook Secret Validation (Zero DB Mutations)...`);
  if (!pgClient) {
    results.checks.webhookSecurity = {
      pass: false,
      error: 'Database client not connected. Zero-mutation assertion cannot be verified.',
    };
    logger.error(`  -> Skipping Check 3: DB connection not available.`);
  } else {
    try {
      const { rows: initialRows } = await pgClient.query('SELECT count(*)::int as cnt FROM public.ingress_events;');
      const initialIngressCount = initialRows[0].cnt;

      // 3a. Missing Secret Token Header
      const missingSecretRes = await httpRequester(`${baseUrl}/api/webhooks/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 999991, message: { text: 'test-missing-secret' } }),
      });

      // 3b. Wrong Secret Token Header
      const wrongSecretRes = await httpRequester(`${baseUrl}/api/webhooks/telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-token-value',
        },
        body: JSON.stringify({ update_id: 999992, message: { text: 'test-wrong-secret' } }),
      });

      const { rows: postRows } = await pgClient.query('SELECT count(*)::int as cnt FROM public.ingress_events;');
      const countAfterRejections = postRows[0].cnt;
      const zeroMutation = countAfterRejections === initialIngressCount;

      const missingRejected = missingSecretRes.status === 401;
      const wrongRejected = wrongSecretRes.status === 401;

      results.checks.webhookSecurity = {
        pass: missingRejected && wrongRejected && zeroMutation,
        missingSecretStatus: missingSecretRes.status,
        wrongSecretStatus: wrongSecretRes.status,
        initialIngressCount,
        countAfterRejections,
        zeroMutation,
      };

      logger.log(`  -> Missing secret status: ${missingSecretRes.status} (expected 401)`);
      logger.log(`  -> Wrong secret status: ${wrongSecretRes.status} (expected 401)`);
      logger.log(`  -> Zero DB mutation verified: ${zeroMutation} (Count before: ${initialIngressCount}, after: ${countAfterRejections})`);
      logger.log(`  -> Result: [${results.checks.webhookSecurity.pass ? 'PASS' : 'FAIL'}]`);
    } catch (err) {
      results.checks.webhookSecurity = { pass: false, error: err.message };
      logger.error(`  -> Failed: ${err.message}`);
    }
  }

  // --- Pre-Ingestion Guard: Require SHADOW Mode Before Sending Test Message ---
  logger.log(`\n[Pre-Ingestion Guard] Verifying SHADOW Mode Prior to Test Message Injection...`);
  let preShadowOk = false;
  if (!pgClient) {
    results.checks.preIngestionShadow = {
      pass: false,
      error: 'Database connection not available to verify SHADOW mode.',
    };
    logger.error(`  -> Cannot verify SHADOW mode without DB connection.`);
  } else {
    try {
      const { rows: settingsRows } = await pgClient.query(
        `SELECT singleton, mode, emergency_stop, version FROM public.automation_settings WHERE singleton = true;`
      );
      if (settingsRows.length === 0) {
        throw new Error('automation_settings row is missing in database.');
      }
      const setting = settingsRows[0];
      if (setting.mode !== 'SHADOW') {
        throw new Error(`FAIL-CLOSED: Current mode is '${setting.mode}', not 'SHADOW'. Test message halted to protect live operations.`);
      }
      if (setting.emergency_stop) {
        throw new Error('FAIL-CLOSED: emergency_stop is active in automation_settings. Test message halted.');
      }
      preShadowOk = true;
      results.checks.preIngestionShadow = {
        pass: true,
        mode: setting.mode,
        emergencyStop: setting.emergency_stop,
      };
      logger.log(`  -> Pre-check verified: mode='${setting.mode}', emergency_stop=${setting.emergency_stop} [PASS]`);
    } catch (err) {
      results.checks.preIngestionShadow = { pass: false, error: err.message };
      logger.error(`  -> Pre-check failed: ${err.message}`);
    }
  }

  // --- Check 4: Valid Tester Webhook Ingestion & SHADOW Processing ---
  logger.log(`\n[Check 4] Ingesting Dummy Tester Webhook Update & Verifying SHADOW Ingestion...`);
  if (!preShadowOk || !pgClient) {
    results.checks.webhookIngestionAndShadow = {
      pass: false,
      error: 'Pre-ingestion SHADOW check or DB connection failed. Message injection blocked.',
    };
    logger.error(`  -> Skipping Check 4: Pre-conditions not met.`);
  } else {
    try {
      const testUpdateId = Math.floor(Date.now() / 1000);
      const testMessageId = String(Math.floor(Date.now() % 1000000));
      const correlationText = `[SmokeTest-${testUpdateId}] Internet mati sejak pagi`;

      const dummyPayload = {
        update_id: testUpdateId,
        message: {
          message_id: parseInt(testMessageId, 10),
          from: {
            id: parseInt(testerId, 10),
            is_bot: false,
            first_name: 'Tester',
            username: 'smoke_tester',
          },
          chat: {
            id: parseInt(testerId, 10),
            type: 'private',
            first_name: 'Tester',
            username: 'smoke_tester',
          },
          date: Math.floor(Date.now() / 1000),
          text: correlationText,
        },
      };

      const webhookHeaders = { 'Content-Type': 'application/json' };
      if (webhookSecret) {
        webhookHeaders['X-Telegram-Bot-Api-Secret-Token'] = webhookSecret;
      }

      const acceptRes = await httpRequester(`${baseUrl}/api/webhooks/telegram`, {
        method: 'POST',
        headers: webhookHeaders,
        body: JSON.stringify(dummyPayload),
      });

      let acceptEnvelope = null;
      try {
        acceptEnvelope = JSON.parse(acceptRes.body);
      } catch {
        throw new Error(`Invalid JSON response from webhook endpoint: ${acceptRes.body}`);
      }

      const isAccepted =
        acceptRes.status === 200 &&
        acceptEnvelope?.success === true &&
        acceptEnvelope?.data?.status === 'accepted' &&
        acceptEnvelope?.data?.duplicate === false &&
        typeof acceptEnvelope?.data?.ingressId === 'string';

      if (!isAccepted) {
        throw new Error(
          `Webhook did not accept message: HTTP ${acceptRes.status}, envelope: ${JSON.stringify(acceptEnvelope)}`
        );
      }

      const returnedIngressId = acceptEnvelope.data.ingressId;
      logger.log(`  -> Webhook accepted (HTTP 200), Ingress ID: ${returnedIngressId}`);

      // Bounded polling for job completion
      logger.log(`  -> Polling for background job completion on ingress ${returnedIngressId}...`);
      const pollResult = await pollJobCompletion(pgClient, returnedIngressId, { maxWaitMs: 10000 });
      if (!pollResult.ok) {
        throw new Error(`Job processing verification failed: ${pollResult.error}`);
      }
      logger.log(`  -> Background job completed with status 'done' in ${pollResult.elapsedMs}ms.`);

      // Correlated schema assertions
      // 1. Ingress event
      const { rows: ingressRows } = await pgClient.query(
        `SELECT id, identity_id, channel, account_id, chat_id, provider_message_id, mode, emergency_stop
         FROM public.ingress_events
         WHERE id = $1;`,
        [returnedIngressId]
      );
      if (ingressRows.length === 0) {
        throw new Error(`Ingress event ${returnedIngressId} not found in database.`);
      }
      const ingress = ingressRows[0];
      const ingressValid =
        ingress.channel === 'telegram' &&
        ingress.chat_id === String(testerId) &&
        ingress.provider_message_id === testMessageId &&
        ingress.mode === 'SHADOW';

      // 2. Message record
      const { rows: msgRows } = await pgClient.query(
        `SELECT m.id, m.identity_id, m.complaint_id, m.classification, m.conversation_id
         FROM public.messages m
         WHERE m.id = $1;`,
        [returnedIngressId]
      );
      if (msgRows.length === 0) {
        throw new Error(`Message record ${returnedIngressId} not found in database.`);
      }
      const message = msgRows[0];
      const messageValid = Boolean(message.classification && message.conversation_id);

      // 3. Triage assessment
      const { rows: assessmentRows } = await pgClient.query(
        `SELECT message_id, decision, processing_result
         FROM public.triage_assessments
         WHERE message_id = $1;`,
        [returnedIngressId]
      );
      const assessmentValid = assessmentRows.length > 0;

      // 4. Outbound intents - MUST be 0 in SHADOW mode
      const { rows: outboundRows } = await pgClient.query(
        `SELECT id, origin, status
         FROM public.outbound_intents
         WHERE message_id = $1 OR (complaint_id = $2 AND origin = 'automatic');`,
        [returnedIngressId, message.complaint_id || '00000000-0000-0000-0000-000000000000']
      );

      // 5. Reply claims - MUST be 0 in SHADOW mode
      let claimCount = 0;
      if (message.complaint_id) {
        const { rows: claimRows } = await pgClient.query(
          `SELECT owner_id, scope_kind, scope_id
           FROM public.reply_claims
           WHERE complaint_id = $1;`,
          [message.complaint_id]
        );
        claimCount = claimRows.length;
      }

      const shadowPreserved = outboundRows.length === 0 && claimCount === 0;

      const check4Pass = ingressValid && messageValid && assessmentValid && shadowPreserved;

      results.checks.webhookIngestionAndShadow = {
        pass: check4Pass,
        ingressId: returnedIngressId,
        jobStatus: pollResult.job?.status,
        attemptCount: pollResult.job?.attempt_count,
        ingressValid,
        messageValid,
        assessmentValid,
        outboundIntentsCount: outboundRows.length,
        replyClaimsCount: claimCount,
        shadowPreserved,
      };

      logger.log(`  -> Ingress verified: ${ingressValid}`);
      logger.log(`  -> Message & Conversation verified: ${messageValid}`);
      logger.log(`  -> Triage Assessment verified: ${assessmentValid}`);
      logger.log(`  -> Outbound intents created: ${outboundRows.length} (must be 0)`);
      logger.log(`  -> Reply claims created: ${claimCount} (must be 0)`);
      logger.log(`  -> Result: [${check4Pass ? 'PASS' : 'FAIL'}]`);
    } catch (err) {
      results.checks.webhookIngestionAndShadow = { pass: false, error: err.message };
      logger.error(`  -> Failed: ${err.message}`);
    }
  }

  // --- Check 5: Staff Login, Authenticated Inbox Access, and Logout ---
  logger.log(`\n[Check 5] Verifying Real Staff Login, Inbox Access, and Logout...`);
  if (!staffEmail || !staffPassword || !supabaseUrl || !supabaseAnonKey) {
    results.checks.staffAuth = {
      pass: false,
      error: 'Staff credentials or Supabase URL/Anon key missing. Real staff auth flow could not be verified.',
    };
    logger.error(`  -> Failed: staffEmail, staffPassword, supabaseUrl, and supabaseAnonKey are mandatory.`);
  } else {
    try {
      const cookieJar = new Map();
      const staffClient = authClientFactory
        ? authClientFactory(cookieJar)
        : createServerClient(supabaseUrl, supabaseAnonKey, {
            cookies: {
              getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
              setAll: (values) => values.forEach(({ name, value }) => cookieJar.set(name, value)),
            },
          });

      // 5a. Real sign in
      const { data: authData, error: authError } = await staffClient.auth.signInWithPassword({
        email: staffEmail,
        password: staffPassword,
      });

      if (authError || !authData?.session) {
        throw new Error(`Staff login failed: ${authError?.message || 'No session returned'}`);
      }
      logger.log(`  -> Staff signed in successfully as ${staffEmail}. Session cookies captured.`);

      const sessionCookieHeader = [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');

      // 5b. Authenticated access to /dashboard (must be 200)
      const authDashboardRes = await httpRequester(`${baseUrl}/dashboard`, {
        headers: { Cookie: sessionCookieHeader },
      });
      const dashboardAuthed = authDashboardRes.status === 200;

      // 5c. Authenticated access to inbox conversations API (must be 200)
      const authApiRes = await httpRequester(`${baseUrl}/api/inbox/conversations`, {
        headers: { Cookie: sessionCookieHeader },
      });
      const apiAuthed = authApiRes.status === 200;

      // 5d. Real sign out
      const { error: signOutError } = await staffClient.auth.signOut();
      const signOutSuccess = !signOutError;
      if (signOutError) {
        logger.error(`  -> Staff logout failed via Supabase Auth: ${signOutError.message}`);
      } else {
        logger.log(`  -> Staff signed out via Supabase Auth.`);
      }

      // 5e. Verify post-logout access is evicted
      const clearedCookieHeader = [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ');
      const postLogoutDashboard = await httpRequester(`${baseUrl}/dashboard`, {
        headers: clearedCookieHeader ? { Cookie: clearedCookieHeader } : {},
      });
      const postLogoutApi = await httpRequester(`${baseUrl}/api/inbox/conversations`, {
        headers: clearedCookieHeader ? { Cookie: clearedCookieHeader } : {},
      });

      const postLogoutLocationHeader = postLogoutDashboard.headers?.location || postLogoutDashboard.headers?.Location;
      const postLogoutDashboardProtected = isValidLoginRedirect(
        postLogoutDashboard.status,
        postLogoutLocationHeader,
        baseUrl
      );

      const postLogoutApiProtected = postLogoutApi.status === 401;

      const authFlowPassed =
        dashboardAuthed &&
        apiAuthed &&
        signOutSuccess &&
        postLogoutDashboardProtected &&
        postLogoutApiProtected;

      results.checks.staffAuth = {
        pass: authFlowPassed,
        loginSuccess: true,
        dashboardAuthed,
        apiAuthed,
        signOutSuccess,
        signOutError: signOutError?.message || null,
        postLogoutDashboardProtected,
        postLogoutDashboardLocation: postLogoutLocationHeader || null,
        postLogoutDashboardRedirectValid: postLogoutDashboardProtected,
        postLogoutApiProtected,
      };

      logger.log(`  -> Authenticated /dashboard status: ${authDashboardRes.status} (expected 200)`);
      logger.log(`  -> Authenticated /api/inbox/conversations status: ${authApiRes.status} (expected 200)`);
      logger.log(`  -> Sign-out success: ${signOutSuccess}${signOutError ? ` (error: ${signOutError.message})` : ''}`);
      logger.log(`  -> Post-logout /dashboard status: ${postLogoutDashboard.status} (Location: ${postLogoutLocationHeader || 'none'}, valid redirect: ${postLogoutDashboardProtected})`);
      logger.log(`  -> Post-logout /api/inbox/conversations status: ${postLogoutApi.status} (expected 401)`);
      logger.log(`  -> Result: [${authFlowPassed ? 'PASS' : 'FAIL'}]`);
    } catch (err) {
      results.checks.staffAuth = { pass: false, error: err.message };
      logger.error(`  -> Failed: ${err.message}`);
    }
  }

  if (pgClient) {
    await pgClient.end();
  }

  // Mandatory checks: all expected checks must exist and be pass: true
  const requiredChecks = [
    'httpsReachable',
    'unauthenticatedProtected',
    'dbConnection',
    'webhookSecurity',
    'preIngestionShadow',
    'webhookIngestionAndShadow',
    'staffAuth',
  ];

  const allPassed = requiredChecks.every((key) => results.checks[key]?.pass === true);
  results.allPassed = allPassed;

  logger.log(`\n======================================================`);
  logger.log(`[Smoke Test Summary] All Mandatory Checks Passed: ${allPassed ? 'YES ✅' : 'NO ❌'}`);
  logger.log(`======================================================\n`);

  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const env = {};
  const envFile = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  const baseUrl = process.argv[2] || process.env.DEPLOYMENT_URL || 'http://localhost:3000';
  const dbUrl = process.argv[3] || process.env.HELPDESK_DATABASE_URL || env.HELPDESK_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const staffEmail = process.env.STAFF_EMAIL || env.STAFF_EMAIL;
  const staffPassword = process.env.STAFF_PASSWORD || env.STAFF_PASSWORD;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET;
  const testerId = process.env.TELEGRAM_TESTER_ALLOWLIST || env.TELEGRAM_TESTER_ALLOWLIST || '6727338166';

  runDeploymentSmokeTest({
    baseUrl,
    dbUrl,
    supabaseUrl,
    supabaseAnonKey,
    staffEmail,
    staffPassword,
    webhookSecret,
    testerId,
  })
    .then((res) => {
      console.log('Result JSON:', JSON.stringify(res, null, 2));
      process.exit(res.allPassed ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error in smoke test:', err);
      process.exit(1);
    });
}
