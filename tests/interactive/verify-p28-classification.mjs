#!/usr/bin/env node
/**
 * tests/interactive/verify-p28-classification.mjs
 *
 * Dedicated Interactive Browser & Application Verification Runner for P2.8:
 * Label dan Koreksi Klasifikasi oleh Staf.
 *
 * Verifies:
 * 1. REAL Next.js application server running with .env.test on isolated port.
 * 2. REAL authenticated staff login & CDP session.
 * 3. REAL PostgreSQL test fixtures on port 54332 with isolated database verification.
 * 4. Unlabeled message UI: displays original rule category, keywords, reason, "Belum Dilabeli" badge,
 *    and actions ("Konfirmasi Benar", "Koreksi / Beri Label").
 * 5. 1-Click Confirmation: staff confirms correct automatic rule decision (status: confirmed),
 *    records staff session actor & server timestamp, preserves original rule category/keywords/version.
 * 6. Idempotency: repeated saves with identical parameters return active record with 0 duplicate history rows.
 * 7. Staff Correction: staff changes classification category (e.g. to 'other' / Bukan Komplain),
 *    enters optional notes, updates status to 'corrected', preserves audit history in DB.
 * 8. Reload Persistence: full page reload retains staff label, actor, timestamp, notes, and corrected status.
 * 9. Error Handling & Draft Preservation: failure response displays error alert while preserving
 *    staff draft category and notes intact without data loss.
 * 10. Responsive Mobile Layout (375px): touch target sizing >= 40px, legible labels, no horizontal overflow.
 * 11. Zero Operational Side Effects: purely annotative, 0 outbound messages, 0 debounce reset, 0 episode mutations.
 * 12. Clean Teardown: kills Next.js and Chrome processes via taskkill, deletes staff user, cleans up DB fixtures.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

import {
  parseAndValidateTestConfig,
  verifyTestTargetIdentity,
  TestResourceTracker,
  cleanupFixture,
} from "../../.test-build/tests/utils/test-guard.js";

import {
  computeSourceHashes,
  readBuildManifest,
  validateBuildMetadata,
} from "../../scripts/build-source-manifest.mjs";
import { NetworkRequestCorrelator } from "./verify-p27-ui-lifecycle.mjs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PORT = 9228;

function loadTestEnv() {
  const envPath = path.resolve(".env.test");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([^=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadTestEnv();

export const P28_MANDATORY_REGISTRY = [
  "build_source_binding_verification",
  "auth_setup",
  "unlabeled_message_ui_state",
  "direct_confirmation_failure_display_and_accessibility",
  "one_click_confirmation_and_rule_preservation",
  "idempotent_repeated_save_behavior",
  "staff_correction_with_traceable_history",
  "polling_draft_preservation_and_inflight_resilience",
  "server_polling_reconciliation_and_race_prevention",
  "keyboard_navigation_operability",
  "reload_persistence_from_database",
  "error_handling_and_draft_preservation",
  "responsive_mobile_viewport_and_touch_target",
  "zero_operational_side_effects",
  "runner_cleanup_and_teardown",
];

async function findAvailablePort(startPort = 3360) {
  for (let port = startPort; port < startPort + 50; port++) {
    const isFree = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (isFree) return port;
  }
  throw new Error("No free port available in range.");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  const pid = proc.pid;
  if (!isProcessRunning(pid)) return;

  spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { encoding: "utf8" });
  for (let i = 0; i < 20; i++) {
    if (!isProcessRunning(pid)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (isProcessRunning(pid)) {
    throw new Error(`Failed to terminate PID ${pid}`);
  }
}

async function getWebSocketDebuggerUrl(port = CHROME_PORT) {
  for (let i = 30; i > 0; i--) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
        const newRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
        if (newRes.ok) {
          const target = await newRes.json();
          if (target.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
        }
      }
    } catch {}
    await delay(300);
  }
  throw new Error("Cannot connect to Chrome remote debugging port.");
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
  }

  async connect() {
    this.ws = new globalThis.WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (err) => reject(new Error("WebSocket error: " + err.message));
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          const handlers = this.eventHandlers.get(msg.method) || [];
          for (const handler of handlers) handler(msg.params);
        }
      };
    });
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(handler);
  }

  off(method, handler) {
    if (!this.eventHandlers.has(method)) return;
    const handlers = this.eventHandlers.get(method);
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  removeAllListeners(method) {
    if (method) {
      this.eventHandlers.delete(method);
    } else {
      this.eventHandlers.clear();
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function getBuildId() {
  try {
    const buildIdPath = path.resolve(".next/BUILD_ID");
    if (fs.existsSync(buildIdPath)) {
      return fs.readFileSync(buildIdPath, "utf8").trim();
    }
  } catch {}
  return null;
}

export function updateLatestManifest(entry) {
  try {
    const manifestPath = path.resolve("docs/evidence/P2_8/latest-manifest.json");
    let manifest = { updatedAt: new Date().toISOString(), modes: {} };
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch {}
    }
    manifest.updatedAt = new Date().toISOString();
    manifest.modes = manifest.modes || {};
    manifest.modes[entry.mode] = {
      runId: entry.runId,
      evidenceDir: path.relative(process.cwd(), entry.evidenceDir).replace(/\\/g, "/"),
      evidencePath: path.relative(process.cwd(), entry.evidencePath).replace(/\\/g, "/"),
      timestamp: entry.timestamp,
      overallStatus: entry.overallStatus,
      expectedExitCode: entry.expectedExitCode,
      calculatedExitCode: entry.calculatedExitCode,
      buildId: entry.buildId,
      screenshotsCount: entry.screenshotsCount || 0,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.warn("[Manifest] Gagal memperbarui latest-manifest.json:", err.message);
  }
}

async function waitForDetailPollCycle(cdp, convId, baseUrl, timeoutMs = 8000) {
  const initialCountRes = await cdp.send("Runtime.evaluate", {
    expression: `Number(document.querySelector('[data-testid="inbox-dashboard"]')?.getAttribute('data-detail-poll-count') || 0)`,
  });
  const initialCount = Number(initialCountRes.result?.value || 0);

  let targetRequestId = null;
  let responseStatusCode = null;
  let loadingFinished = false;

  const reqListener = (params) => {
    const url = params.request.url;
    if (url === `${baseUrl}/api/inbox/conversations/${convId}` || url.endsWith(`/api/inbox/conversations/${convId}`)) {
      targetRequestId = params.requestId;
    }
  };

  const resListener = (params) => {
    if (params.requestId === targetRequestId || params.response.url.endsWith(`/api/inbox/conversations/${convId}`)) {
      targetRequestId = params.requestId;
      responseStatusCode = params.response.status;
    }
  };

  const finListener = (params) => {
    if (params.requestId === targetRequestId) {
      loadingFinished = true;
    }
  };

  cdp.on("Network.requestWillBeSent", reqListener);
  cdp.on("Network.responseReceived", resListener);
  cdp.on("Network.loadingFinished", finListener);

  try {
    await cdp.send("Runtime.evaluate", {
      expression: `window.dispatchEvent(new CustomEvent('test:inbox-poll'))`,
    });

    const startTime = Date.now();
    let applied = false;
    let currentCount = initialCount;

    while (Date.now() - startTime < timeoutMs) {
      await delay(100);

      const countCheck = await cdp.send("Runtime.evaluate", {
        expression: `Number(document.querySelector('[data-testid="inbox-dashboard"]')?.getAttribute('data-detail-poll-count') || 0)`,
      });
      currentCount = Number(countCheck.result?.value || 0);

      if (responseStatusCode === 200 && loadingFinished && currentCount > initialCount) {
        applied = true;
        break;
      }
    }

    if (!applied) {
      throw new Error(
        `Gagal menunggu siklus polling detail percakapan ${convId} dalam batas waktu ${timeoutMs}ms (status: ${responseStatusCode}, loadingFinished: ${loadingFinished}, count: ${initialCount} -> ${currentCount})`
      );
    }

    return { requestId: targetRequestId, statusCode: responseStatusCode, count: currentCount };
  } finally {
    cdp.off("Network.requestWillBeSent", reqListener);
    cdp.off("Network.responseReceived", resListener);
    cdp.off("Network.loadingFinished", finListener);
  }
}

export async function runP28VerificationHarness(options = {}) {
  const isOnlyMobile = Boolean(
    options.onlyMobile ??
      (process.argv.includes("--only-mobile") || process.argv.includes("--target=mobile"))
  );

  if (isOnlyMobile) {
    console.log("=== P2.8: EKSEKUSI TERARAH — VERIFIKASI MOBILE VIEWPORT & TOUCH TARGET ===");
  } else {
    console.log("=== P2.8: VERIFIKASI APLIKASI SEBENARNYA — LABEL DAN KOREKSI KLASIFIKASI STAF ===");
  }

  const baseEvidenceDir = path.resolve("docs/evidence/P2_8");
  fs.mkdirSync(baseEvidenceDir, { recursive: true });

  const runId = "p28-" + crypto.randomUUID().slice(0, 8);
  const runEvidenceDir = path.join(baseEvidenceDir, runId);
  const screenshotsDir = path.join(runEvidenceDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const tracker = new TestResourceTracker();
  let staffUserId = null;
  let staffEmail = null;
  let pool = null;
  let supabaseAdmin = null;
  let nextProc = null;
  let chromeProc = null;
  let cdp = null;
  let userDataDir = null;
  const cleanupErrors = [];
  const extraStaffUserIds = [];
  const capturedScreenshots = [];
  const assertions = [];

  function recordAssertion({ id, name, pass, expected, actual, isOptional = false }) {
    const status = pass ? "PASS" : "FAIL";
    assertions.push({ id, name, isOptional, status, expected, actual });
    if (pass) {
      console.log(`[✓] PASS: ${name}`);
    } else {
      console.error(`[x] FAIL: ${name}`);
      console.error(`    Expected:`, expected);
      console.error(`    Actual:  `, actual);
    }
  }

  let custId = null;
  let identId = null;
  let convId = null;
  let msgId = null;
  let convId2 = null;
  let msgId2 = null;

  try {
    // 1. Build & Source Binding Verification
    console.log("\n--- [1] Validasi Pengikatan Build-to-Source ---");
    const sourceHashesAtLaunch = computeSourceHashes();
    const buildManifest = readBuildManifest();
    const buildId = getBuildId();

    const buildValidation = validateBuildMetadata({
      manifest: buildManifest,
      currentBuildId: buildId,
      launchHashes: sourceHashesAtLaunch,
      mode: "live_browser_normal",
    });

    recordAssertion({
      id: "build_source_binding_verification",
      name: "Pengikatan build-to-source valid dan BUILD_ID tersinkronisasi",
      pass: buildValidation.isValid && buildValidation.status === "SYNCHRONIZED",
      expected: "SYNCHRONIZED",
      actual: buildValidation.status,
    });

    // 2. Validate Isolated Environment
    console.log("\n--- [2] Validasi Lingkungan Terisolasi ---");
    const testConfig = parseAndValidateTestConfig({
      HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
      HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
      HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
      HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
    });

    pool = new Pool({ connectionString: testConfig.databaseUrl });
    supabaseAdmin = createClient(testConfig.apiUrl, testConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await verifyTestTargetIdentity(pool, supabaseAdmin, testConfig.expectedMarker);

    // 3. Create Test Staff User
    staffEmail = `staff-p28-${runId}@upaznet.test`;
    const staffPassword = `P28Staff!Pass_${runId}`;
    console.log(`[Setup] Membuat user staf pengujian: ${staffEmail}`);

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: staffEmail,
      password: staffPassword,
      email_confirm: true,
      user_metadata: { role: "staff", displayName: `Staf P28 ${runId}` },
    });
    if (userError || !userData?.user) {
      throw new Error(`Gagal membuat user staf: ${userError?.message || "No user data"}`);
    }
    staffUserId = userData.user.id;

    // 4. Seed Test Fixtures
    console.log(`[Setup] Menyiapkan fixture percakapan dengan pesan inbound...`);
    custId = crypto.randomUUID();
    identId = crypto.randomUUID();
    convId = crypto.randomUUID();
    msgId = crypto.randomUUID();
    const botAccountId = "upaznet_helpdesk_bot";
    const senderExternalId = `672733_${runId}`;
    const baseTime = new Date("2026-10-12T01:20:00Z");

    tracker.recordCustomer(custId);
    tracker.recordIdentity(identId);
    tracker.recordConversation(convId);
    tracker.recordMessage(msgId);
    tracker.recordIngress(msgId);

    await pool.query(
      `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
       VALUES ($1, 'Budi Santoso P28', 'active', $2, now(), now())`,
      [custId, `CUST-P28-${runId}`]
    );

    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Budi Santoso', $4, 'verified', now(), now(), now())`,
      [identId, botAccountId, senderExternalId, custId]
    );

    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $5, now(), now())`,
      [convId, identId, botAccountId, senderExternalId, baseTime]
    );

    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Halo min lampu internet los merah berkedip terus dari tadi tolong dibantu', $6, 'SHADOW', 1, false)`,
      [msgId, identId, botAccountId, senderExternalId, `pmsg-p28-${runId}`, baseTime]
    );

    const initialRuleClassification = {
      category: "connection_complaint",
      reason: "keyword_match",
      rule_version: "connection-keywords-v1",
      matched_keywords: ["los", "red"],
    };

    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [msgId, identId, convId, JSON.stringify(initialRuleClassification), baseTime]
    );

    // Seed second conversation to test conversation switching A -> B and A -> B -> A
    convId2 = crypto.randomUUID();
    msgId2 = crypto.randomUUID();
    tracker.recordConversation(convId2);
    tracker.recordMessage(msgId2);
    tracker.recordIngress(msgId2);

    const baseTime2 = new Date("2026-10-12T01:00:00Z");
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $5, now(), now())`,
      [convId2, identId, botAccountId, senderExternalId, baseTime2]
    );

    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Pesan kedua untuk verifikasi isolasi percakapan', $6, 'SHADOW', 1, false)`,
      [msgId2, identId, botAccountId, senderExternalId, `pmsg-p28-${runId}-2`, baseTime2]
    );

    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [
        msgId2,
        identId,
        convId2,
        JSON.stringify({ category: "other", reason: "greeting", rule_version: "v1", matched_keywords: [] }),
        baseTime2,
      ]
    );

    if (isOnlyMobile) {
      await pool.query(
        `INSERT INTO public.staff_message_classifications (message_id, conversation_id, labeled_category, status, staff_id, original_category, rule_version, created_at, updated_at)
         VALUES ($1, $2, 'connection_complaint', 'confirmed', $3, 'connection_complaint', 'connection-keywords-v1', now(), now())`,
        [msgId, convId, staffUserId]
      );
    }

    // Snapshot state awal database operasional untuk bukti perbandingan sebelum-vs-sesudah
    const baselineEpisodesRes = await pool.query(`SELECT count(*)::int as count FROM public.complaints`);
    const baselineClaimsRes = await pool.query(`SELECT count(*)::int as count FROM public.reply_claims`);
    const baselineOutboundRes = await pool.query(`SELECT count(*)::int as count FROM public.outbound_intents`);
    const baselineConversationsRes = await pool.query(`SELECT count(*)::int as count FROM public.conversations`);

    const baselineDbState = {
      complaints: baselineEpisodesRes.rows[0].count,
      replyClaims: baselineClaimsRes.rows[0].count,
      outboundIntents: baselineOutboundRes.rows[0].count,
      conversations: baselineConversationsRes.rows[0].count,
    };

    // 5. Launch Next.js Application on Dedicated Port
    const nextPort = await findAvailablePort(3360);
    const BASE_URL = `http://127.0.0.1:${nextPort}`;
    console.log(`\n--- [3] Meluncurkan Aplikasi Next.js pada port ${nextPort} ---`);

    const nextBin = path.resolve("node_modules/next/dist/bin/next");
    const jwtAnonKey =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

    nextProc = spawn(process.execPath, [nextBin, "start", "-p", String(nextPort)], {
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(nextPort),
        NETWORK_PROVIDER: "mock",
        HELPDESK_DATABASE_URL: testConfig.databaseUrl,
        DATABASE_URL: testConfig.databaseUrl,
        SUPABASE_URL: testConfig.apiUrl,
        HELPDESK_TEST_API_URL: testConfig.apiUrl,
        NEXT_PUBLIC_SUPABASE_URL: testConfig.apiUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtAnonKey,
        SUPABASE_ANON_KEY: jwtAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: testConfig.serviceRoleKey,
        HELPDESK_TEST_SERVICE_ROLE_KEY: testConfig.serviceRoleKey,
        HELPDESK_TEST_ANON_KEY: jwtAnonKey,
        HELPDESK_TRUSTED_ORIGINS: BASE_URL,
        NEXT_PUBLIC_APP_URL: BASE_URL,
        APP_URL: BASE_URL,
        TEST_RUN_ID: runId,
      },
    });

    let isNextRunning = false;
    for (let i = 0; i < 40; i++) {
      await delay(500);
      try {
        const res = await fetch(`${BASE_URL}/login`);
        if (res.status === 200) {
          isNextRunning = true;
          break;
        }
      } catch {}
    }
    if (!isNextRunning) {
      throw new Error(`Gagal memulai server Next.js pada port ${nextPort}.`);
    }
    console.log(`[Setup] Server Next.js siap pada port ${nextPort}.`);

    // 6. Launch Headless Chrome & CDP
    const chromePort = await findAvailablePort(9228);
    userDataDir = path.join(
      process.env.TEMP || "C:\\Users\\INVANSION\\AppData\\Local\\Temp",
      `chrome_p28_${runId}`
    );
    fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`[Setup] Meluncurkan Chrome headless pada remote port ${chromePort}...`);
    chromeProc = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--window-size=1440,900",
      "about:blank",
    ]);

    const wsUrl = await getWebSocketDebuggerUrl(chromePort);
    cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");

    const networkCorrelator = new NetworkRequestCorrelator();

    cdp.on("Runtime.consoleAPICalled", (params) => {
      console.log(`[Browser Console ${params.type}]`, ...params.args.map((a) => a.value || JSON.stringify(a)));
    });

    cdp.on("Network.responseReceived", (params) => {
      networkCorrelator.onResponseReceived(params);
      if (params.response?.url?.includes("classification")) {
        console.log(`[CDP Network] ${params.response.url} -> status ${params.response.status}`);
      }
    });

    cdp.on("Network.loadingFinished", (params) => {
      networkCorrelator.onLoadingFinished(params);
    });

    cdp.on("Network.loadingFailed", (params) => {
      networkCorrelator.onLoadingFailed(params);
    });

    async function takeScreenshot(name) {
      const filename = `${name}.png`;
      const filepath = path.join(screenshotsDir, filename);
      const res = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(filepath, Buffer.from(res.data, "base64"));
      capturedScreenshots.push(filename);
      console.log(`[Screenshot] Tersimpan: ${filename}`);
    }

    // 7. Authenticate Staff via Real Login Page
    console.log("\n--- [4] Melakukan Login Staf & Memeriksa Sesi Aktif ---");
    await cdp.send("Page.navigate", { url: `${BASE_URL}/login` });
    await delay(1200);

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');
        if (emailInput && passInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(emailInput, ${JSON.stringify(staffEmail)});
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          nativeSetter.call(passInput, ${JSON.stringify(staffPassword)});
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
          const submitBtn = document.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.click();
        }
      })()`,
    });

    let loggedIn = false;
    for (let i = 0; i < 20; i++) {
      await delay(400);
      const evalRes = await cdp.send("Runtime.evaluate", { expression: "window.location.pathname" });
      if (evalRes.result.value === "/dashboard") {
        loggedIn = true;
        break;
      }
    }

    recordAssertion({
      id: "auth_setup",
      name: "Autentikasi sesi staf pada aplikasi Next.js asli (/login -> /dashboard)",
      pass: loggedIn,
      expected: "/dashboard",
      actual: loggedIn ? "/dashboard" : "login_failed",
    });

    if (!loggedIn) {
      throw new Error("Login staf gagal pada aplikasi Next.js");
    }

    // 8. Select Conversation on Dashboard
    console.log("\n--- [5] Navigasi ke Inbox & Validasi Keadaan Belum Dilabeli ---");
    // Wait for list items to appear
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const evalList = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"]'))`,
      });
      if (evalList.result.value) break;
    }

    // Click the target conversation item
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const item = items.find(el => el.getAttribute('data-conversation-id') === targetId) || items.find(el => el.textContent.includes('Halo min lampu internet')) || items[0];
        if (item) item.click();
      })(${JSON.stringify(convId)})`,
    });

    // Wait for message classification card to appear
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const checkCard = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('[data-testid="message-classification-card"]'))`,
      });
      if (checkCard.result.value) break;
    }

    if (!isOnlyMobile) {
    // Verify Unlabeled State in UI
    const unlabeledStateRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const card = document.querySelector('[data-testid="message-classification-card"]');
        const badge = card?.querySelector('[data-testid="classification-status-badge"]');
        const ruleCat = card?.querySelector('[data-testid="rule-category-badge"]');
        const confirmBtn = card?.querySelector('[data-testid="quick-confirm-btn"]');
        const openEditBtn = card?.querySelector('[data-testid="open-correction-btn"]');

        return {
          cardExists: Boolean(card),
          badgeText: badge?.textContent?.trim() || "",
          ruleCategory: ruleCat?.textContent?.trim() || "",
          confirmBtnExists: Boolean(confirmBtn),
          confirmBtnText: confirmBtn?.textContent?.trim() || "",
          openEditBtnExists: Boolean(openEditBtn),
          cardText: card?.textContent || "",
        };
      })()`,
      returnByValue: true,
    });

    const unlabeledData = unlabeledStateRes.result.value;
    const isUnlabeledPass =
      unlabeledData.cardExists &&
      unlabeledData.badgeText.includes("Belum Dilabeli") &&
      unlabeledData.ruleCategory === "connection_complaint" &&
      unlabeledData.confirmBtnExists &&
      unlabeledData.confirmBtnText.includes("Konfirmasi Benar") &&
      unlabeledData.openEditBtnExists;

    recordAssertion({
      id: "unlabeled_message_ui_state",
      name: "Tampilan pesan belum dilabeli: badge 'Belum Dilabeli', kategori rule asli, tombol konfirmasi & koreksi",
      pass: isUnlabeledPass,
      expected: "badge=Belum Dilabeli, rule=connection_complaint, confirmBtn=Konfirmasi Benar",
      actual: `badge=${unlabeledData.badgeText}, rule=${unlabeledData.ruleCategory}, confirmBtn=${unlabeledData.confirmBtnText}`,
    });

    await takeScreenshot("01_unlabeled_state");

    // 9a. Scenario: Direct 1-Click Confirmation Failure, Error Polling Persistence, and Retry
    console.log("\n--- [6a] Simulasi Kegagalan Konfirmasi Langsung, Polling Persistence, Dismiss & Retry ---");
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/classification*", requestStage: "Request" }],
    });

    const directConfirmFailHandler = async (params) => {
      await cdp.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 500,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" },
        ],
        body: Buffer.from(
          JSON.stringify({
            success: false,
            data: null,
            error: {
              code: "SIMULATED_CONFIRM_ERROR",
              message: "Simulasi kegagalan server saat konfirmasi langsung.",
            },
          })
        ).toString("base64"),
      });
    };
    cdp.on("Fetch.requestPaused", directConfirmFailHandler);

    // Click "Konfirmasi Benar" while intercepted
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="quick-confirm-btn"]');
        if (btn) btn.click();
      })()`,
    });

    let directConfirmErrorPass = false;
    let directConfirmErrorData = {};
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const errRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const errorAlert = card?.querySelector('[data-testid="classification-error-alert"]');
          const retryBtn = card?.querySelector('[data-testid="retry-confirm-btn"]');
          const dismissBtn = card?.querySelector('[data-testid="dismiss-error-btn"]');
          const quickConfirmBtn = card?.querySelector('[data-testid="quick-confirm-btn"]');

          return {
            errorVisible: Boolean(errorAlert),
            errorRole: errorAlert?.getAttribute('role') || "",
            errorAriaLive: errorAlert?.getAttribute('aria-live') || "",
            errorText: errorAlert?.textContent?.trim() || "",
            retryBtnExists: Boolean(retryBtn),
            dismissBtnExists: Boolean(dismissBtn),
            isSubmittingStopped: !quickConfirmBtn?.disabled,
          };
        })()`,
        returnByValue: true,
      });

      directConfirmErrorData = errRes.result.value;
      if (
        directConfirmErrorData.errorVisible &&
        directConfirmErrorData.errorText.includes("Simulasi kegagalan") &&
        directConfirmErrorData.errorRole === "alert" &&
        directConfirmErrorData.errorAriaLive === "polite" &&
        directConfirmErrorData.retryBtnExists &&
        directConfirmErrorData.dismissBtnExists &&
        directConfirmErrorData.isSubmittingStopped
      ) {
        directConfirmErrorPass = true;
        break;
      }
    }

    await takeScreenshot("01b_direct_confirm_error");

    // Verify polling does NOT clear the error banner (Execute 2 detail polling cycles via application polling mechanism)
    console.log("\n--- [6a.1] Membuktikan Polling Detail Tidak Menghapus Banner Error atau Tombol 'Coba lagi' ---");
    let pollingSurvivesPass = true;
    for (let pollIdx = 1; pollIdx <= 2; pollIdx++) {
      console.log(`[6a.1] Menjalankan siklus polling detail ke-${pollIdx}...`);
      const pollCycle = await waitForDetailPollCycle(cdp, convId, BASE_URL);
      console.log(`[6a.1] Polling detail ke-${pollIdx} sukses & diterapkan di UI (requestId: ${pollCycle.requestId}, count: ${pollCycle.count}).`);

      const pollCheck = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const errorAlert = card?.querySelector('[data-testid="classification-error-alert"]');
          const retryBtn = card?.querySelector('[data-testid="retry-confirm-btn"]');
          return {
            errorVisible: Boolean(errorAlert),
            retryVisible: Boolean(retryBtn),
            errorText: errorAlert?.textContent?.trim() || "",
          };
        })()`,
        returnByValue: true,
      });

      const pollVal = pollCheck.result.value;
      if (!pollVal.errorVisible || !pollVal.retryVisible || !pollVal.errorText.includes("Simulasi kegagalan")) {
        pollingSurvivesPass = false;
        console.error(`Polling cycle ${pollIdx} erroneously cleared error banner or retry button!`);
      } else {
        console.log(`[✓] Polling cycle ${pollIdx} berhasil diterapkan; banner error & tombol retry tetap tersedia tanpa interaksi staf.`);
      }
    }

    // Disable Fetch interception and remove listener before retrying
    await cdp.send("Fetch.disable");
    cdp.removeAllListeners("Fetch.requestPaused");

    // Now click Retry ("Coba lagi") to succeed!
    console.log("\n--- [6b] Klik Tombol 'Coba lagi' pada Banner Konfirmasi Langsung ---");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const retryBtn = document.querySelector('[data-testid="retry-confirm-btn"]');
        if (retryBtn) retryBtn.click();
      })()`,
    });

    // Wait for request to complete and UI to update
    let confirmedStatePass = false;
    let confirmedData = {};
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const evalRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const badge = card?.querySelector('[data-testid="classification-status-badge"]');
          const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
          const editBtn = card?.querySelector('[data-testid="edit-classification-btn"]');
          const details = card?.querySelector('[data-testid="staff-classification-details"]');

          return {
            badgeText: badge?.textContent?.trim() || "",
            staffCategoryValue: staffVal?.textContent?.trim() || "",
            editBtnExists: Boolean(editBtn),
            detailsText: details?.textContent || "",
          };
        })()`,
        returnByValue: true,
      });

      confirmedData = evalRes.result.value;
      if (
        confirmedData.badgeText.includes("Terkonfirmasi") &&
        confirmedData.staffCategoryValue.includes("Komplain Koneksi")
      ) {
        confirmedStatePass = true;
        break;
      }
    }

    // Verify DB integrity: rule is untouched, label has status 'confirmed', actor is staffUserId
    const dbConfirmCheck = await pool.query(
      `SELECT sc.status, sc.labeled_category, sc.staff_id, sc.original_category, sc.rule_version,
              m.classification as original_msg_classification
       FROM public.staff_message_classifications sc
       JOIN public.messages m ON m.id = sc.message_id
       WHERE sc.message_id = $1`,
      [msgId]
    );

    const dbConfirmRow = dbConfirmCheck.rows[0];
    const isDbConfirmValid =
      dbConfirmRow &&
      dbConfirmRow.status === "confirmed" &&
      dbConfirmRow.labeled_category === "connection_complaint" &&
      dbConfirmRow.staff_id === staffUserId &&
      dbConfirmRow.original_category === "connection_complaint" &&
      dbConfirmRow.original_msg_classification.category === "connection_complaint" &&
      dbConfirmRow.original_msg_classification.matched_keywords.includes("los");

    recordAssertion({
      id: "one_click_confirmation_and_rule_preservation",
      name: "Konfirmasi 1-klik tersimpan: status 'confirmed', aktor sesi server, rule asli di messages tetap utuh",
      pass: confirmedStatePass && isDbConfirmValid,
      expected: "UI: Terkonfirmasi & Komplain Koneksi; DB: status=confirmed, actor=staffUserId, rule_preserved=true",
      actual: `UI badge=${confirmedData.badgeText}, DB status=${dbConfirmRow?.status}, actor=${dbConfirmRow?.staff_id}, rule_cat=${dbConfirmRow?.original_msg_classification?.category}`,
    });

    await takeScreenshot("02_confirmed_state");

    // Now test Tutup (dismiss) button and message switch isolation on convId2
    console.log("\n--- [6c] Uji Tombol 'Tutup' dan Isolasi Switch Percakapan pada Percakapan Lain ---");
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/classification*", requestStage: "Request" }],
    });
    cdp.on("Fetch.requestPaused", directConfirmFailHandler);

    // Switch to convId2
    await cdp.send("Runtime.evaluate", {
      expression: `((cid2) => {
        const item = document.querySelector('[data-conversation-id="' + cid2 + '"]');
        if (item) item.click();
      })(${JSON.stringify(convId2)})`,
    });
    await delay(500);

    // Trigger error on convId2
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="quick-confirm-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(500);

    // Test dismiss button ("Tutup")
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const dismissBtn = document.querySelector('[data-testid="dismiss-error-btn"]');
        if (dismissBtn) dismissBtn.click();
      })()`,
    });
    await delay(300);

    const dismissedCheck = await cdp.send("Runtime.evaluate", {
      expression: `!document.querySelector('[data-testid="classification-error-alert"]')`,
    });
    const isDismissed = Boolean(dismissedCheck.result.value);

    // Trigger error again on convId2
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="quick-confirm-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(500);

    // Switch to convId (where message 1 is already labeled)
    await cdp.send("Runtime.evaluate", {
      expression: `((cid) => {
        const item = document.querySelector('[data-conversation-id="' + cid + '"]');
        if (item) item.click();
      })(${JSON.stringify(convId)})`,
    });
    await delay(500);

    // Verify convId does not carry over the error from convId2
    const conv1ErrorCheck = await cdp.send("Runtime.evaluate", {
      expression: `!document.querySelector('[data-testid="classification-error-alert"]')`,
    });
    const isConv1FreeOfError = Boolean(conv1ErrorCheck.result.value);

    await cdp.send("Fetch.disable");
    cdp.removeAllListeners("Fetch.requestPaused");

    recordAssertion({
      id: "direct_confirmation_failure_display_and_accessibility",
      name: "Kegagalan konfirmasi langsung: error alert role='alert' aria-live='polite', tahan 2x polling, retry sukses, dismiss 'Tutup', switch bersih",
      pass: directConfirmErrorPass && pollingSurvivesPass && confirmedStatePass && isDbConfirmValid && isDismissed && isConv1FreeOfError,
      expected: "errorVisible=true, role=alert, 2x polling survive=true, retrySuccess=true, dismiss=true, switchIsolation=true",
      actual: `pollingSurvive=${pollingSurvivesPass}, retrySuccess=${confirmedStatePass}, dismiss=${isDismissed}, switchIsolation=${isConv1FreeOfError}`,
    });


    // 10. Scenario: Idempotent Repeated Save Behavior
    console.log("\n--- [7] Uji Idempotensi Penyimpanan Berulang ---");
    // Execute repeated save inside browser context to utilize authenticated staff session
    await cdp.send("Runtime.evaluate", {
      expression: `(async (cid, mid) => {
        return await fetch('/api/inbox/conversations/' + cid + '/messages/' + mid + '/classification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ category: 'connection_complaint', labeledCategory: 'connection_complaint', notes: null })
        }).then(r => r.json());
      })(${JSON.stringify(convId)}, ${JSON.stringify(msgId)})`,
      awaitPromise: true,
    });

    // Check history count in database: must be exactly 1 row (no duplicate row created for identical save)
    const historyCheck = await pool.query(
      `SELECT count(*)::int as count FROM public.staff_message_classification_history WHERE message_id = $1`,
      [msgId]
    );
    const initialHistoryCount = historyCheck.rows[0].count;

    recordAssertion({
      id: "idempotent_repeated_save_behavior",
      name: "Penyimpanan berulang dengan nilai identik bersifat idempoten tanpa duplikasi history",
      pass: initialHistoryCount === 1,
      expected: "history_count = 1",
      actual: `history_count = ${initialHistoryCount}`,
    });

    // 11. Scenario: Staff Correction with Traceable History
    console.log("\n--- [8] Eksekusi Koreksi Klasifikasi oleh Staf ('Ubah Label' -> Bukan Komplain) ---");
    // Click "Ubah Label"
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="edit-classification-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(500);

    // Select category 'other' (Bukan Komplain) and click it
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const otherRadio = document.querySelector('input[type="radio"][value="other"]');
        if (otherRadio) otherRadio.click();
        const otherOpt = document.querySelector('[data-testid="category-option-other"]');
        if (otherOpt && !otherRadio?.checked) otherOpt.click();
      })()`,
    });
    await delay(300);

    // Type notes and click Save
    const testNotes = "Pelanggan menanyakan informasi biaya tagihan bulanan, bukan komplain koneksi.";
    await cdp.send("Runtime.evaluate", {
      expression: `((notesVal) => {
        const notesTextarea = document.querySelector('[data-testid="classification-notes-input"]');
        if (notesTextarea) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(notesTextarea, notesVal);
          notesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');
        if (saveBtn) saveBtn.click();
      })(${JSON.stringify(testNotes)})`,
    });

    // Wait for correction to complete
    let correctedStatePass = false;
    let correctedData = {};
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const evalRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const badge = card?.querySelector('[data-testid="classification-status-badge"]');
          const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
          const details = card?.querySelector('[data-testid="staff-classification-details"]');

          return {
            badgeText: badge?.textContent?.trim() || "",
            staffCategoryValue: staffVal?.textContent?.trim() || "",
            detailsText: details?.textContent || "",
          };
        })()`,
        returnByValue: true,
      });

      correctedData = evalRes.result.value;
      if (
        correctedData.badgeText.includes("Dikoreksi") &&
        correctedData.staffCategoryValue.includes("Bukan Komplain") &&
        correctedData.detailsText.includes("Pelanggan menanyakan informasi")
      ) {
        correctedStatePass = true;
        break;
      }
    }

    // Verify DB history has 2 records: first confirmed, second corrected with previousCategory
    const dbHistoryCheck = await pool.query(
      `SELECT status, labeled_category, previous_category, notes
       FROM public.staff_message_classification_history
       WHERE message_id = $1
       ORDER BY created_at ASC`,
      [msgId]
    );

    const historyRows = dbHistoryCheck.rows;
    const isHistoryValid =
      historyRows.length === 2 &&
      historyRows[0].status === "confirmed" &&
      historyRows[1].status === "corrected" &&
      historyRows[1].labeled_category === "other" &&
      historyRows[1].previous_category === "connection_complaint" &&
      historyRows[1].notes.includes("informasi biaya tagihan");

    recordAssertion({
      id: "staff_correction_with_traceable_history",
      name: "Koreksi klasifikasi tersimpan: badge 'Dikoreksi', label 'Bukan Komplain', catatan tersimpan, riwayat terlacak",
      pass: correctedStatePass && isHistoryValid,
      expected: "UI: Dikoreksi & Bukan Komplain; DB history count=2 (confirmed -> corrected)",
      actual: `UI badge=${correctedData.badgeText}, staffVal=${correctedData.staffCategoryValue}, DB history count=${historyRows.length}`,
    });

    await takeScreenshot("03_corrected_state");

    // 11a. Scenario: Draft Preservation Under Server Polling & In-Flight Status Resilience
    console.log("\n--- [8a] Preservasi Draft Editor saat Polling Menerima Pembaruan Server & Resiliensi Request In-Flight ---");
    // 1. Staff A opens edit form
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="edit-classification-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(400);

    // 2. Staff A edits category to 'review' and enters draft notes without saving
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const radio = document.querySelector('input[type="radio"][value="review"]');
        if (radio) radio.click();
        const opt = document.querySelector('[data-testid="category-option-review"]');
        if (opt && !radio?.checked) opt.click();
      })()`,
    });
    await delay(200);

    const draftNotesA = "Draft catatan Staf A yang sedang diedit (belum disimpan)";
    await cdp.send("Runtime.evaluate", {
      expression: `((val) => {
        const el = document.querySelector('[data-testid="classification-notes-input"]');
        if (el) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })(${JSON.stringify(draftNotesA)})`,
    });
    await delay(300);

    // 3. Staff B updates classification via real backend route with Session B
    const staffBDraftEmail = `staff-draft-test-${runId}@upaznet.test`;
    const staffBDraftPassword = "Password123!";
    const { data: userBDraftData, error: userBDraftErr } = await supabaseAdmin.auth.admin.createUser({
      email: staffBDraftEmail,
      password: staffBDraftPassword,
      email_confirm: true,
    });
    if (userBDraftErr || !userBDraftData?.user) {
      throw new Error(`Failed to create Staff B user: ${userBDraftErr?.message}`);
    }
    const staffBDraftId = userBDraftData.user.id;
    extraStaffUserIds.push(staffBDraftId);

    const { data: bDraftSignInData, error: bDraftSignInErr } = await supabaseAdmin.auth.signInWithPassword({
      email: staffBDraftEmail,
      password: staffBDraftPassword,
    });
    if (bDraftSignInErr || !bDraftSignInData?.session?.access_token) {
      throw new Error(`Failed to sign in Staff B: ${bDraftSignInErr?.message}`);
    }
    const staffBDraftToken = bDraftSignInData.session.access_token;
    const notesStaffB = "Koreksi Staf B via Backend Aplikasi";

    const bDraftSaveRes = await fetch(`${BASE_URL}/api/inbox/conversations/${convId}/messages/${msgId}/classification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": BASE_URL,
        "Authorization": `Bearer ${staffBDraftToken}`,
      },
      body: JSON.stringify({
        category: "connection_complaint",
        labeledCategory: "connection_complaint",
        notes: notesStaffB,
      }),
    });
    const bDraftSaveJson = await bDraftSaveRes.json();
    if (!bDraftSaveRes.ok || !bDraftSaveJson.success) {
      throw new Error(`Staff B backend save failed: ${JSON.stringify(bDraftSaveJson)}`);
    }
    console.log(`[8a.1] Staf B berhasil menyimpan pembaruan via backend (HTTP ${bDraftSaveRes.status}).`);

    // 4. Polling A runs and receives Staff B's update
    console.log("[8a.2] Menjalankan polling A untuk menerima pembaruan Staf B...");
    await waitForDetailPollCycle(cdp, convId, BASE_URL);

    // 5. Verify Editor A remains OPEN, draft radio 'review' still checked, draft notes identical!
    const draftPollCheck = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('[data-testid="classification-edit-form"]');
        const reviewRadio = document.querySelector('input[type="radio"][value="review"]');
        const notesEl = document.querySelector('[data-testid="classification-notes-input"]');
        const noticeEl = document.querySelector('[data-testid="concurrent-update-notice"]');
        const detailsEl = document.querySelector('[data-testid="staff-classification-details"]');
        const staffValEl = document.querySelector('[data-testid="staff-category-value"]');

        return {
          formOpen: Boolean(form),
          reviewChecked: reviewRadio?.checked || false,
          notesValue: notesEl?.value || "",
          noticeVisible: Boolean(noticeEl),
          noticeText: noticeEl?.textContent?.trim() || "",
          savedCategoryText: staffValEl?.textContent?.trim() || "",
          detailsText: detailsEl?.textContent || "",
        };
      })()`,
      returnByValue: true,
    });

    const draftPollData = draftPollCheck.result.value;
    const isDraftPreservedOnPoll =
      draftPollData.formOpen &&
      draftPollData.reviewChecked === true &&
      draftPollData.notesValue === draftNotesA &&
      draftPollData.noticeVisible &&
      draftPollData.savedCategoryText.includes("Komplain Koneksi") &&
      draftPollData.detailsText.includes(staffBDraftEmail);

    console.log(
      `[8a.3] Hasil verifikasi preservasi draft setelah polling: formOpen=${draftPollData.formOpen}, reviewChecked=${draftPollData.reviewChecked}, notesMatch=${draftPollData.notesValue === draftNotesA}, noticeVisible=${draftPollData.noticeVisible}, savedCategory=${draftPollData.savedCategoryText}`
    );

    // 6. Test in-flight request status resilience: Polling does NOT terminate in-flight request loading state
    console.log("[8a.4] Menguji status request in-flight: Polling tidak boleh mengakhiri loading request secara prematur...");
    let inFlightRequestId = null;
    let holdInFlightResolve = null;
    const holdInFlightPromise = new Promise((resolve) => {
      holdInFlightResolve = resolve;
    });

    const holdInFlightHandler = (params) => {
      if (params.request.url.includes(`/messages/${msgId}/classification`)) {
        inFlightRequestId = params.requestId;
        holdInFlightResolve(params);
      } else {
        cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
      }
    };
    cdp.on("Fetch.requestPaused", holdInFlightHandler);

    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: `*messages/${msgId}/classification*`, requestStage: "Request" }],
    });

    // Click "Simpan Label"
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="save-classification-btn"]');
        if (btn) btn.click();
      })()`,
    });

    await holdInFlightPromise;
    console.log(`[8a.5] Request simpan Staf A sedang in-flight (requestId: ${inFlightRequestId})...`);

    // Verify loading state before polling
    const prePollLoadingCheck = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="save-classification-btn"]');
        return {
          isDisabled: btn?.disabled || false,
          btnText: btn?.textContent?.trim() || "",
        };
      })()`,
      returnByValue: true,
    });
    const isPrePollLoading =
      prePollLoadingCheck.result.value.isDisabled &&
      prePollLoadingCheck.result.value.btnText.includes("Menyimpan");

    // Execute polling while request is in-flight
    await waitForDetailPollCycle(cdp, convId, BASE_URL);

    // Verify loading state AFTER polling: STILL LOADING, NOT terminated early!
    const postPollLoadingCheck = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="save-classification-btn"]');
        return {
          isDisabled: btn?.disabled || false,
          btnText: btn?.textContent?.trim() || "",
        };
      })()`,
      returnByValue: true,
    });
    const isPostPollStillLoading =
      postPollLoadingCheck.result.value.isDisabled &&
      postPollLoadingCheck.result.value.btnText.includes("Menyimpan");

    console.log(
      `[8a.6] Status loading request saat polling: prePollLoading=${isPrePollLoading}, postPollStillLoading=${isPostPollStillLoading}`
    );

    // Fulfill held request with 500 error to verify draft preservation on failure
    cdp.off("Fetch.requestPaused", holdInFlightHandler);
    await cdp.send("Fetch.fulfillRequest", {
      requestId: inFlightRequestId,
      responseCode: 500,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Access-Control-Allow-Origin", value: "*" },
      ],
      body: Buffer.from(
        JSON.stringify({
          success: false,
          data: null,
          error: { message: "Simulasi kegagalan server saat pengujian in-flight draft." },
        })
      ).toString("base64"),
    });
    await cdp.send("Fetch.disable");
    await delay(400);

    // Verify draft remains intact on failure and loading has stopped
    const failureDraftCheck = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('[data-testid="classification-edit-form"]');
        const reviewRadio = document.querySelector('input[type="radio"][value="review"]');
        const notesEl = document.querySelector('[data-testid="classification-notes-input"]');
        const errorAlert = document.querySelector('[data-testid="classification-error-alert"]');
        const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');

        return {
          formOpen: Boolean(form),
          reviewChecked: reviewRadio?.checked || false,
          notesValue: notesEl?.value || "",
          errorVisible: Boolean(errorAlert),
          isSubmittingStopped: !saveBtn?.disabled,
        };
      })()`,
      returnByValue: true,
    });
    const failureDraftData = failureDraftCheck.result.value;
    const isFailureDraftPreserved =
      failureDraftData.formOpen &&
      failureDraftData.reviewChecked === true &&
      failureDraftData.notesValue === draftNotesA &&
      failureDraftData.errorVisible &&
      failureDraftData.isSubmittingStopped;

    // Click "Batal" to reset edit mode cleanly
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const cancelBtn = document.querySelector('[data-testid="cancel-edit-btn"]');
        if (cancelBtn) cancelBtn.click();
      })()`,
    });
    await delay(300);

    recordAssertion({
      id: "polling_draft_preservation_and_inflight_resilience",
      name: "Preservasi draft editor saat polling server & resiliensi loading in-flight tanpa pemutusan dini",
      pass: isDraftPreservedOnPoll && isPrePollLoading && isPostPollStillLoading && isFailureDraftPreserved,
      expected: "draftPreservedOnPoll=true, postPollStillLoading=true, failureDraftPreserved=true",
      actual: `draftPreserved=${isDraftPreservedOnPoll}, inFlightProtected=${isPostPollStillLoading}, failureDraftPreserved=${isFailureDraftPreserved}`,
    });

    // 11b. Scenario: Server Polling Reconciliation, Delayed Save Rejection & Control Case
    console.log("\n--- [8b] Validasi Rekonsiliasi Server: Penolakan Respons Simpan Lama, Polling Versi B & Kasus Kontrol ---");
    let isReconciliationPass = false;
    let heldSaveParams = null;
    let isStaffACommitted = false;
    let isInvalidBearerRejected = false;
    let versionBVisible = false;
    let isPreReleaseDraftIntact = false;
    let isImmediateVersionBKept = false;
    let isPostReleaseDraftIntact = false;
    let isPostReleaseSubmittingStopped = false;
    let isSubsequentVersionBKept = false;
    let isDbActiveConsistent = false;
    let isHistoryConsistent = false;
    let negativeCorrelatorPass = false;
    let versionCApplied = false;
    let isConv2Clean = false;
    let heldSaveRequestId = null;
    let heldSaveNetworkId = null;
    let delayedSaveHoldHandler = null;

    try {
      // Step 1: Staff A initiates save for Version 1 ('connection_complaint' with notes)
      // First click "Ubah Label" to open edit form
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const btn = document.querySelector('[data-testid="edit-classification-btn"]');
          if (btn) btn.click();
        })()`,
      });
      await delay(400);

      // Select connection_complaint radio
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const radio = document.querySelector('input[type="radio"][value="connection_complaint"]');
          if (radio) radio.click();
          const opt = document.querySelector('[data-testid="category-option-connection_complaint"]');
          if (opt && !radio?.checked) opt.click();
        })()`,
      });
      await delay(300);

      const notesVersion1 = "Koreksi Awal Staf A Versi 1";
      await cdp.send("Runtime.evaluate", {
        expression: `((notesVal) => {
          const notesTextarea = document.querySelector('[data-testid="classification-notes-input"]');
          if (notesTextarea) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(notesTextarea, notesVal);
            notesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })(${JSON.stringify(notesVersion1)})`,
      });

      // Step 2: Set up CDP Fetch interception on response stage to hold Staff A's HTTP response
      let holdPromiseResolve = null;
      let holdPromiseReject = null;
      const holdPromise = new Promise((resolve, reject) => {
        holdPromiseResolve = resolve;
        holdPromiseReject = reject;
      });

      delayedSaveHoldHandler = (params) => {
        const reqUrl = params?.request?.url || "";
        const reqMethod = params?.request?.method || "";
        if (
          reqUrl.includes(`/api/inbox/conversations/${convId}/messages/${msgId}/classification`) &&
          reqMethod === "POST"
        ) {
          if (!params.requestId || !params.networkId) {
            holdPromiseReject(
              new Error(`Identitas korelasi hilang: requestId=${params.requestId}, networkId=${params.networkId}`)
            );
            return;
          }
          heldSaveParams = params;
          heldSaveRequestId = params.requestId;
          heldSaveNetworkId = params.networkId;
          holdPromiseResolve(params);
        } else {
          cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
        }
      };
      cdp.on("Fetch.requestPaused", delayedSaveHoldHandler);

      await cdp.send("Fetch.enable", {
        patterns: [
          {
            urlPattern: `*messages/${msgId}/classification*`,
            requestStage: "Response",
          },
        ],
      });

      // Click "Simpan Label" to submit Version 1
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');
          if (saveBtn) saveBtn.click();
        })()`,
      });

      // Wait until response is paused by CDP
      console.log("[8b.1] Menunggu transaksi Staf A selesai di DB dan respons ditahan di layer HTTP...");
      const holdTimeout = setTimeout(() => {
        holdPromiseReject(new Error("Timeout (10000ms) menunggu Fetch.requestPaused untuk request simpan Staf A"));
      }, 10000);
      await holdPromise;
      clearTimeout(holdTimeout);
      console.log(
        `[8b.1] Respons HTTP Staf A berhasil ditahan (fetchRequestId: ${heldSaveRequestId}, networkId: ${heldSaveNetworkId}).`
      );

      // Verify DB committed Staff A's transaction
      const dbStaffACheck = await pool.query(
        `SELECT labeled_category, notes, staff_id, updated_at
         FROM public.staff_message_classifications
         WHERE message_id = $1`,
        [msgId]
      );
      const staffARow = dbStaffACheck.rows[0];
      isStaffACommitted = Boolean(
        staffARow &&
        staffARow.labeled_category === "connection_complaint" &&
        staffARow.notes === notesVersion1 &&
        staffARow.staff_id === staffUserId
      );
      console.log(`[8b.2] Verifikasi DB Staf A committed: ${isStaffACommitted} (updated_at: ${staffARow?.updated_at})`);

      // Step 2.5: Verify invalid Bearer token is rejected with 401 without mutating active record or history
      console.log("[8b.2b] Menguji penolakan Bearer token tidak valid (wajib 401 tanpa mutasi DB)...");
      const countBeforeInvalid = await pool.query(
        `SELECT count(*)::int as count FROM public.staff_message_classification_history WHERE message_id = $1`,
        [msgId]
      );
      const activeBeforeInvalid = await pool.query(
        `SELECT * FROM public.staff_message_classifications WHERE message_id = $1`,
        [msgId]
      );

      const invalidBearerRes = await fetch(`${BASE_URL}/api/inbox/conversations/${convId}/messages/${msgId}/classification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": BASE_URL,
          "Authorization": "Bearer invalid.malformed.token.value",
        },
        body: JSON.stringify({
          category: "spam",
          labeledCategory: "spam",
          notes: "Attempt with invalid bearer token",
        }),
      });
      const invalidBearerJson = await invalidBearerRes.json().catch(() => ({}));
      const countAfterInvalid = await pool.query(
        `SELECT count(*)::int as count FROM public.staff_message_classification_history WHERE message_id = $1`,
        [msgId]
      );
      const activeAfterInvalid = await pool.query(
        `SELECT * FROM public.staff_message_classifications WHERE message_id = $1`,
        [msgId]
      );

      isInvalidBearerRejected =
        invalidBearerRes.status === 401 &&
        invalidBearerJson.success === false &&
        countAfterInvalid.rows[0].count === countBeforeInvalid.rows[0].count &&
        activeAfterInvalid.rows[0].updated_at.getTime() === activeBeforeInvalid.rows[0].updated_at.getTime();
      console.log(
        `[8b.2b] Hasil penolakan token Bearer tidak valid: ${isInvalidBearerRejected} (status: ${invalidBearerRes.status})`
      );

      // Step 3: Staff B saves different correction (Version 2: 'review' / "Perlu Tinjauan") via real application backend
      const staffBEmail = `staff-reconcile-${runId}@upaznet.test`;
      const staffBPassword = "Password123!";
      const { data: userBData, error: userBErr } = await supabaseAdmin.auth.admin.createUser({
        email: staffBEmail,
        password: staffBPassword,
        email_confirm: true,
      });
      if (userBErr || !userBData?.user) {
        throw new Error(`Failed to create Staff B user: ${userBErr?.message}`);
      }
      const staffBId = userBData.user.id;
      extraStaffUserIds.push(staffBId);

      const { data: bSignInData, error: bSignInErr } = await supabaseAdmin.auth.signInWithPassword({
        email: staffBEmail,
        password: staffBPassword,
      });
      if (bSignInErr || !bSignInData?.session?.access_token) {
        throw new Error(`Failed to sign in Staff B: ${bSignInErr?.message}`);
      }
      const staffBToken = bSignInData.session.access_token;
      const notesVersionB = "Koreksi Staf B Versi 2 Terbaru via Backend";

      // Call real application route with Staff B session (NO direct SQL UPDATE or synthetic timestamps!)
      const bSaveRes = await fetch(`${BASE_URL}/api/inbox/conversations/${convId}/messages/${msgId}/classification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Origin": BASE_URL,
          "Authorization": `Bearer ${staffBToken}`,
        },
        body: JSON.stringify({
          category: "review",
          labeledCategory: "review",
          notes: notesVersionB,
        }),
      });
      const bSaveJson = await bSaveRes.json();
      if (!bSaveRes.ok || !bSaveJson.success) {
        throw new Error(`Staff B backend save failed: ${JSON.stringify(bSaveJson)}`);
      }
      console.log(`[8b.3] Staf B berhasil menyimpan koreksi Versi 2 via backend aplikasi (HTTP ${bSaveRes.status}).`);

      // Step 4: Polling A receives Version B
      console.log("[8b.4] Menjalankan polling A untuk menerima Versi B dari server...");
      await waitForDetailPollCycle(cdp, convId, BASE_URL);

      const evalB = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const badge = card?.querySelector('[data-testid="classification-status-badge"]');
          const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
          const details = card?.querySelector('[data-testid="staff-classification-details"]');
          const form = document.querySelector('[data-testid="classification-edit-form"]');
          const radioConn = document.querySelector('input[type="radio"][value="connection_complaint"]');
          const notesEl = document.querySelector('[data-testid="classification-notes-input"]');
          const isCardSubmitting = card?.getAttribute("data-submitting") === "true";

          return {
            badgeText: badge?.textContent?.trim() || "",
            staffCategoryValue: staffVal?.textContent?.trim() || "",
            detailsText: details?.textContent || "",
            formOpen: Boolean(form),
            connRadioChecked: radioConn?.checked || false,
            notesValue: notesEl?.value || "",
            isSubmitting: isCardSubmitting,
          };
        })()`,
        returnByValue: true,
      });
      const versionBData = evalB.result?.value || {};
      versionBVisible = Boolean(
        versionBData.staffCategoryValue?.includes("Perlu Tinjauan") &&
        versionBData.detailsText?.includes(notesVersionB) &&
        versionBData.detailsText?.includes(staffBEmail)
      );
      isPreReleaseDraftIntact = Boolean(
        versionBData.formOpen &&
        versionBData.connRadioChecked &&
        versionBData.notesValue === notesVersion1 &&
        versionBData.isSubmitting
      );
      console.log(
        `[8b.4] UI Polling menerima Versi B: ${versionBVisible} (${versionBData.staffCategoryValue}), editor & draft A tetap utuh: ${isPreReleaseDraftIntact}`
      );

      // Step 5: Release Staff A's delayed HTTP response with request correlation & UI synchronization!
      console.log("[8b.5] Melepaskan respons HTTP Staf A yang ditahan dan memastikan korelasi pemrosesan...");

      // 5a. Set up deterministic UI handler completion listener in browser
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__classificationResponseHandled = null;
          window.addEventListener(
            "test:classification-response-handled",
            (e) => { window.__classificationResponseHandled = e.detail; },
            { once: true }
          );
        })()`,
      });

      // 5b. Pause background polling to prevent background polls from masking temporary overwrites!
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { window.__TEST_PAUSE_POLLING = true; })()`,
      });
      // Wait for any in-flight background list/detail request to drain
      await delay(300);

      // 5c. Release the held response using Fetch requestId and disable interception
      cdp.off("Fetch.requestPaused", delayedSaveHoldHandler);
      await cdp.send("Fetch.continueRequest", { requestId: heldSaveParams.requestId });
      await cdp.send("Fetch.disable");

      // 5d. Correlate Network completion using NetworkRequestCorrelator (fails explicitly if unobserved)
      console.log(`[8b.5] Mengamati penyelesaian jaringan untuk networkId=${heldSaveParams.networkId}...`);
      const netCompletion = await networkCorrelator.waitForRequestCompletion(heldSaveParams, 8000);
      console.log(
        `[8b.5] Jaringan selesai terverifikasi: status=${netCompletion.status}, networkId=${netCompletion.networkId}, fetchRequestId=${netCompletion.fetchRequestId}`
      );

      // 5e. Wait for UI response handler to finish processing
      let uiHandledDetail = null;
      const uiWaitStart = Date.now();
      while (Date.now() - uiWaitStart < 5000) {
        const checkRes = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const card = document.querySelector('[data-testid="message-classification-card"]');
            const form = document.querySelector('[data-testid="classification-edit-form"]');
            const isCardSubmitting = card?.getAttribute("data-submitting") === "true";
            const isFormSubmitting = form?.getAttribute("data-submitting") === "true";
            const handledDetail = window.__classificationResponseHandled;
            if (handledDetail && !isCardSubmitting && !isFormSubmitting) {
              return { handled: true, detail: handledDetail };
            }
            return { handled: false };
          })()`,
          returnByValue: true,
        });
        if (checkRes.result?.value?.handled) {
          uiHandledDetail = checkRes.result.value.detail;
          break;
        }
        await delay(50);
      }
      if (!uiHandledDetail) {
        throw new Error("UI handler test:classification-response-handled tidak selesai dalam 5000ms");
      }
      console.log(
        `[8b.5] UI response handler selesai: isStale=${uiHandledDetail.isStale}, messageId=${uiHandledDetail.messageId}`
      );

      // Step 6: Verify UI IMMEDIATELY while background polling is STILL PAUSED:
      // Versi B tetap tampil, editor tetap terbuka, draft A tidak berubah, loading request A selesai!
      const evalAfterRelease = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const badge = card?.querySelector('[data-testid="classification-status-badge"]');
          const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
          const details = card?.querySelector('[data-testid="staff-classification-details"]');
          const form = document.querySelector('[data-testid="classification-edit-form"]');
          const radioConn = document.querySelector('input[type="radio"][value="connection_complaint"]');
          const notesEl = document.querySelector('[data-testid="classification-notes-input"]');
          const isCardSubmitting = card?.getAttribute("data-submitting") === "true";
          const isFormSubmitting = form?.getAttribute("data-submitting") === "true";

          return {
            badgeText: badge?.textContent?.trim() || "",
            staffCategoryValue: staffVal?.textContent?.trim() || "",
            detailsText: details?.textContent || "",
            formOpen: Boolean(form),
            connRadioChecked: radioConn?.checked || false,
            notesValue: notesEl?.value || "",
            isSubmitting: isCardSubmitting || isFormSubmitting,
          };
        })()`,
        returnByValue: true,
      });
      const immediateData = evalAfterRelease.result?.value || {};
      isImmediateVersionBKept = Boolean(
        immediateData.staffCategoryValue?.includes("Perlu Tinjauan") &&
        immediateData.detailsText?.includes(notesVersionB)
      );
      isPostReleaseDraftIntact = Boolean(
        immediateData.formOpen &&
        immediateData.connRadioChecked &&
        immediateData.notesValue === notesVersion1
      );
      isPostReleaseSubmittingStopped = !immediateData.isSubmitting;
      console.log(
        `[8b.6] Respons A selesai diproses UI (polling dijeda): Versi B bertahan=${isImmediateVersionBKept}, editor & draft utuh=${isPostReleaseDraftIntact}, loading selesai=${isPostReleaseSubmittingStopped}`
      );

      // Step 7: Restore background polling and verify subsequent polling cycle
      console.log("[8b.7] Memulihkan polling dan menjalankan satu siklus lanjutan...");
      await cdp.send("Runtime.evaluate", {
        expression: `(() => { window.__TEST_PAUSE_POLLING = false; })()`,
      });
      await waitForDetailPollCycle(cdp, convId, BASE_URL);

      const evalSubsequent = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
          const details = card?.querySelector('[data-testid="staff-classification-details"]');
          return {
            staffCategoryValue: staffVal?.textContent?.trim() || "",
            detailsText: details?.textContent || "",
          };
        })()`,
        returnByValue: true,
      });
      const subsequentData = evalSubsequent.result?.value || {};
      isSubsequentVersionBKept = Boolean(
        subsequentData.staffCategoryValue?.includes("Perlu Tinjauan") &&
        subsequentData.detailsText?.includes(notesVersionB)
      );
      console.log(`[8b.7] Polling lanjutan selesai; Versi B tetap tampil: ${isSubsequentVersionBKept}`);

      // Step 8: Database & history consistency check (active record AND full history contents & sequence)
      const dbFinalCheck = await pool.query(
        `SELECT labeled_category, status, staff_id, notes
         FROM public.staff_message_classifications
         WHERE message_id = $1`,
        [msgId]
      );
      const dbActiveRow = dbFinalCheck.rows[0];
      isDbActiveConsistent = Boolean(
        dbActiveRow &&
        dbActiveRow.labeled_category === "review" &&
        dbActiveRow.staff_id === staffBId &&
        dbActiveRow.notes === notesVersionB &&
        dbActiveRow.status === "corrected"
      );

      const dbFullHistoryCheck = await pool.query(
        `SELECT labeled_category, status, staff_id, notes, previous_category
         FROM public.staff_message_classification_history
         WHERE message_id = $1
         ORDER BY created_at ASC`,
        [msgId]
      );
      const historyRowsAll = dbFullHistoryCheck.rows;
      // Complete history verification: exactly 5 chronological transitions
      // Row 0: initial confirm by Staff A (confirmed, connection_complaint, prev=null, notes=null)
      // Row 1: correction to other by Staff A (corrected, other, prev=connection_complaint, notes contains tagihan)
      // Row 2: correction by Staff B draft test (corrected, connection_complaint, prev=other, notes=notesStaffB)
      // Row 3: save by Staff A Version 1 (status: confirmed karena sama dengan rule asli connection_complaint, prev=connection_complaint, notes=notesVersion1)
      // Row 4: correction by Staff B Version 2 (status: corrected karena berbeda dengan rule asli, prev=connection_complaint, notes=notesVersionB)
      const isHistoryRowCountValid = historyRowsAll.length === 5;
      const row0Valid =
        historyRowsAll[0]?.staff_id === staffUserId &&
        historyRowsAll[0]?.labeled_category === "connection_complaint" &&
        historyRowsAll[0]?.status === "confirmed" &&
        historyRowsAll[0]?.previous_category === null &&
        historyRowsAll[0]?.notes === null;
      const row1Valid =
        historyRowsAll[1]?.staff_id === staffUserId &&
        historyRowsAll[1]?.labeled_category === "other" &&
        historyRowsAll[1]?.status === "corrected" &&
        historyRowsAll[1]?.previous_category === "connection_complaint" &&
        Boolean(historyRowsAll[1]?.notes && historyRowsAll[1].notes.includes("tagihan"));
      const row2Valid =
        historyRowsAll[2]?.staff_id === staffBDraftId &&
        historyRowsAll[2]?.labeled_category === "connection_complaint" &&
        historyRowsAll[2]?.status === "confirmed" &&
        historyRowsAll[2]?.previous_category === "other" &&
        historyRowsAll[2]?.notes === notesStaffB;
      const row3Valid =
        historyRowsAll[3]?.staff_id === staffUserId &&
        historyRowsAll[3]?.labeled_category === "connection_complaint" &&
        historyRowsAll[3]?.status === "confirmed" &&
        historyRowsAll[3]?.previous_category === "connection_complaint" &&
        historyRowsAll[3]?.notes === notesVersion1;
      const row4Valid =
        historyRowsAll[4]?.staff_id === staffBId &&
        historyRowsAll[4]?.labeled_category === "review" &&
        historyRowsAll[4]?.status === "corrected" &&
        historyRowsAll[4]?.previous_category === "connection_complaint" &&
        historyRowsAll[4]?.notes === notesVersionB;

      isHistoryConsistent = Boolean(
        isHistoryRowCountValid &&
        row0Valid &&
        row1Valid &&
        row2Valid &&
        row3Valid &&
        row4Valid &&
        dbActiveRow &&
        dbActiveRow.labeled_category === historyRowsAll[4].labeled_category &&
        dbActiveRow.staff_id === historyRowsAll[4].staff_id &&
        dbActiveRow.notes === historyRowsAll[4].notes
      );

      console.log(
        `[8b.8] Verifikasi DB Lengkap: activeConsistent=${isDbActiveConsistent}, historyConsistent=${isHistoryConsistent} (total riwayat: ${historyRowsAll.length}, checks: r0=${row0Valid}, r1=${row1Valid}, r2=${row2Valid}, r3=${row3Valid}, r4=${row4Valid})`
      );

      // Step 8.9: Targeted Negative Correlation Check: uncompleted request correlation MUST throw/fail and not silently pass!
      console.log("[8b.8b] Menjalankan pemeriksaan negatif terarah korelasi yang tidak selesai...");
      try {
        const dummyFetchParams = {
          requestId: `dummy-fetch-id-${Date.now()}`,
          networkId: `dummy-net-id-${Date.now()}`,
          request: { url: `${BASE_URL}/api/inbox/conversations/${convId}/messages/${msgId}/classification` },
        };
        await networkCorrelator.waitForRequestCompletion(dummyFetchParams, 350);
        negativeCorrelatorPass = false;
      } catch (err) {
        if (err.message.includes("Timeout") || err.message.includes("Korelasi")) {
          negativeCorrelatorPass = true;
          console.log(`[8b.8b] Korelasi tidak selesai berhasil ditolak dengan benar: ${err.message}`);
        }
      }
      if (!negativeCorrelatorPass) {
        throw new Error("Pemeriksaan negatif gagal: korelasi yang tidak selesai seharusnya melempar error, bukan PASS!");
      }

      // Step 9: Control Case — truly newer save response from UI (Version C) IS applied and closes editor
      console.log("[8b.9] Uji Kasus Kontrol: Penyimpanan Versi C yang benar-benar lebih baru harus langsung diterapkan dan menutup editor...");
      // Form is already open from Step 8b! If for any reason it wasn't, open it
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('[data-testid="classification-edit-form"]');
          if (!form) {
            const btn = document.querySelector('[data-testid="edit-classification-btn"]');
            if (btn) btn.click();
          }
        })()`,
      });
      await delay(300);

      // Select category 'other'
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const radio = document.querySelector('input[type="radio"][value="other"]');
          if (radio) radio.click();
          const opt = document.querySelector('[data-testid="category-option-other"]');
          if (opt && !radio?.checked) opt.click();
        })()`,
      });
      await delay(300);

      const notesVersionC = "Koreksi Kontrol Staf A Versi 3 Paling Baru";
      await cdp.send("Runtime.evaluate", {
        expression: `((notesVal) => {
          const notesTextarea = document.querySelector('[data-testid="classification-notes-input"]');
          if (notesTextarea) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(notesTextarea, notesVal);
            notesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');
          if (saveBtn) saveBtn.click();
        })(${JSON.stringify(notesVersionC)})`,
      });

      let versionCData = {};
      for (let i = 0; i < 20; i++) {
        await delay(300);
        const evalC = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const card = document.querySelector('[data-testid="message-classification-card"]');
            const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
            const details = card?.querySelector('[data-testid="staff-classification-details"]');
            const form = document.querySelector('[data-testid="classification-edit-form"]');
            return {
              staffCategoryValue: staffVal?.textContent?.trim() || "",
              detailsText: details?.textContent || "",
              formClosed: !form,
            };
          })()`,
          returnByValue: true,
        });
        versionCData = evalC.result?.value || {};
        if (
          versionCData.staffCategoryValue?.includes("Bukan Komplain") &&
          versionCData.detailsText?.includes(notesVersionC) &&
          versionCData.formClosed
        ) {
          versionCApplied = true;
          break;
        }
      }
      console.log(
        `[8b.9] Kasus Kontrol: Versi C berhasil diterapkan di UI & editor ditutup: ${versionCApplied} (${versionCData.staffCategoryValue}, formClosed=${versionCData.formClosed})`
      );

      // Step 10: Test conversation switch A -> B and A -> B -> A for isolation
      await cdp.send("Runtime.evaluate", {
        expression: `((cid2) => {
          const item2 = document.querySelector('[data-conversation-id="' + cid2 + '"]');
          if (item2) item2.click();
        })(${JSON.stringify(convId2)})`,
      });
      await delay(500);

      const conv2Check = await cdp.send("Runtime.evaluate", {
        expression: `((vC) => {
          const card = document.querySelector('[data-testid="message-classification-card"]');
          return {
            cardExists: Boolean(card),
            hasOldClassification: card ? card.textContent.includes(vC) : false,
          };
        })(${JSON.stringify(notesVersionC)})`,
        returnByValue: true,
      });
      isConv2Clean = Boolean(conv2Check.result?.value && !conv2Check.result.value.hasOldClassification);

      // Switch back to convId (A -> B -> A)
      await cdp.send("Runtime.evaluate", {
        expression: `((cid) => {
          const item = document.querySelector('[data-conversation-id="' + cid + '"]');
          if (item) item.click();
        })(${JSON.stringify(convId)})`,
      });
      await delay(500);
    } finally {
      // Guaranteed cleanup even on scenario failure
      if (delayedSaveHoldHandler) {
        cdp.off("Fetch.requestPaused", delayedSaveHoldHandler);
      }
      await cdp.send("Fetch.disable").catch(() => {});
      await cdp.send("Runtime.evaluate", {
        expression: `if (typeof window !== "undefined") { window.__TEST_PAUSE_POLLING = false; }`,
      }).catch(() => {});
      if (networkCorrelator) {
        networkCorrelator.clear();
      }
    }

    isReconciliationPass = Boolean(
      isStaffACommitted &&
      isInvalidBearerRejected &&
      versionBVisible &&
      isPreReleaseDraftIntact &&
      isImmediateVersionBKept &&
      isPostReleaseDraftIntact &&
      isPostReleaseSubmittingStopped &&
      isSubsequentVersionBKept &&
      isDbActiveConsistent &&
      isHistoryConsistent &&
      negativeCorrelatorPass &&
      versionCApplied &&
      isConv2Clean
    );

    recordAssertion({
      id: "server_polling_reconciliation_and_race_prevention",
      name: "Rekonsiliasi server: respons simpan lama ditolak, Versi B polling bertahan, editor & draft A utuh, kontrol Versi C diterapkan, korelasi terbukti",
      pass: isReconciliationPass,
      expected: "staffACommitted=true, invalidBearer=true, versionBVisible=true, preReleaseDraft=true, immediateKept=true, postReleaseDraft=true, subsequentKept=true, dbConsistent=true, historyConsistent=true, negativeCorrelator=true, controlCApplied=true, conv2Clean=true",
      actual: `immediateKept=${isImmediateVersionBKept}, postDraft=${isPostReleaseDraftIntact}, dbActive=${isDbActiveConsistent}, history5Rows=${isHistoryConsistent}, negCorrelator=${negativeCorrelatorPass}, controlC=${versionCApplied}, conv2Clean=${isConv2Clean}`,
    });

    // 11c. Scenario: Complete Keyboard Navigation Flow via Real Keyboard Events
    console.log("\n--- [8c] Uji Aksesibilitas Navigasi Keyboard Nyata (Tab, Shift+Tab, Arrow Keys, Typing, Enter) ---");

    const pressKey = async (key, code, keyCode = 0, modifiers = 0) => {
      const isEnter = key === "Enter";
      await cdp.send("Input.dispatchKeyEvent", {
        type: isEnter ? "keyDown" : "rawKeyDown",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers,
        text: isEnter ? "\r" : undefined,
        unmodifiedText: isEnter ? "\r" : undefined,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers,
      });
      await delay(80);
    };

    const pressTab = async (shift = false) => {
      if (shift) {
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "Shift",
          code: "ShiftLeft",
          windowsVirtualKeyCode: 16,
          nativeVirtualKeyCode: 16,
          modifiers: 8,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          modifiers: 8,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          modifiers: 8,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Shift",
          code: "ShiftLeft",
          windowsVirtualKeyCode: 16,
          nativeVirtualKeyCode: 16,
        });
      } else {
        await pressKey("Tab", "Tab", 9);
      }
      await delay(120);
    };

    const typeText = async (str) => {
      for (const char of str) {
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          unmodifiedText: char,
          key: char,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: char,
        });
        await delay(25);
      }
    };

    // 1. Wait for edit button to be present
    for (let i = 0; i < 25; i++) {
      const btnCheck = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('[data-testid="edit-classification-btn"]'))`,
      });
      if (btnCheck.result?.value) break;
      await delay(200);
    }

    // 2. Establish initial keyboard focus on the message card container
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const card = document.querySelector('[data-testid="message-classification-card"]');
        if (card) {
          card.setAttribute('tabindex', '-1');
          card.focus();
        }
      })()`,
    });
    await delay(150);

    // 3. Tab to edit button
    let editBtnFocused = false;
    for (let i = 0; i < 5; i++) {
      await pressTab(false);
      const activeTestId = await cdp.send("Runtime.evaluate", {
        expression: `document.activeElement?.getAttribute('data-testid')`,
      });
      if (activeTestId.result?.value === "edit-classification-btn") {
        editBtnFocused = true;
        break;
      }
    }
    console.log(`[8c.1] Focus berhasil mencapai tombol edit via Tab: ${editBtnFocused}`);

    // 4. Activate edit button via Enter key
    await pressKey("Enter", "Enter", 13);
    await delay(300);

    // Wait for form to open
    let formOpened = false;
    for (let i = 0; i < 20; i++) {
      const formCheck = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('[data-testid="classification-edit-form"]'))`,
      });
      if (formCheck.result?.value) {
        formOpened = true;
        break;
      }
      await delay(100);
    }
    console.log(`[8c.2] Form edit dibuka via Enter: ${formOpened}`);

    // 5. Test Cancel via Keyboard: Tab through to cancel button, activate with Enter
    let cancelBtnFocused = false;
    for (let i = 0; i < 8; i++) {
      await pressTab(false);
      const activeTestId = await cdp.send("Runtime.evaluate", {
        expression: `document.activeElement?.getAttribute('data-testid')`,
      });
      if (activeTestId.result?.value === "cancel-edit-btn") {
        cancelBtnFocused = true;
        break;
      }
    }
    console.log(`[8c.3] Focus mencapai tombol Batal via Tab: ${cancelBtnFocused}`);
    await pressKey("Enter", "Enter", 13);
    await delay(300);

    // Verify form closed via Cancel
    let formCanceled = false;
    for (let i = 0; i < 15; i++) {
      const closedCheck = await cdp.send("Runtime.evaluate", {
        expression: `!document.querySelector('[data-testid="classification-edit-form"]')`,
      });
      if (closedCheck.result?.value) {
        formCanceled = true;
        break;
      }
      await delay(100);
    }
    console.log(`[8c.4] Form berhasil dibatalkan dan ditutup via Enter pada tombol Batal: ${formCanceled}`);

    // 6. Re-open form via keyboard (focus was returned to edit-classification-btn by focus restoration)
    let reOpenBtnFocused = false;
    for (let i = 0; i < 5; i++) {
      const activeTestId = await cdp.send("Runtime.evaluate", {
        expression: `document.activeElement?.getAttribute('data-testid')`,
      });
      if (activeTestId.result?.value === "edit-classification-btn") {
        reOpenBtnFocused = true;
        break;
      }
      await pressTab(false);
    }
    console.log(`[8c.4b] Tombol Ubah Label kembali fokus setelah batal: ${reOpenBtnFocused}`);
    await pressKey("Enter", "Enter", 13);
    await delay(300);

    // 7. Verify category radio group focus (auto-focused on open or accessible via Tab)
    let radioFocused = false;
    for (let i = 0; i < 6; i++) {
      const activeInfo = await cdp.send("Runtime.evaluate", {
        expression: `(() => ({
          tagName: document.activeElement?.tagName,
          type: document.activeElement?.type,
          value: document.activeElement?.value,
        }))()`,
        returnByValue: true,
      });
      if (activeInfo.result?.value?.type === "radio") {
        radioFocused = true;
        break;
      }
      await pressTab(false);
    }
    console.log(`[8c.5] Focus mencapai radio group kategori: ${radioFocused}`);

    const initialRadioRes = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('input[type="radio"]:checked')?.value`,
    });
    const initialCategory = initialRadioRes.result?.value;

    // Use ArrowRight key to change category selection via keyboard
    await pressKey("ArrowRight", "ArrowRight", 39);
    await delay(200);

    const postArrowRadioRes = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('input[type="radio"]:checked')?.value`,
    });
    const newCategory = postArrowRadioRes.result?.value;
    const radioSelectionChanged = Boolean(newCategory && newCategory !== initialCategory);
    console.log(
      `[8c.6] Kategori berhasil diubah via Arrow Key: ${initialCategory} -> ${newCategory} (changed=${radioSelectionChanged})`
    );

    // Return to target category ('other') using ArrowLeft key
    await pressKey("ArrowLeft", "ArrowLeft", 37);
    await delay(200);
    const postReturnRadioRes = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('input[type="radio"]:checked')?.value`,
    });
    console.log(
      `[8c.6b] Kategori dikembalikan ke target via ArrowLeft: ${postReturnRadioRes.result?.value}`
    );

    // 8. Tab to Notes Textarea and type notes via keyboard
    let notesFocused = false;
    for (let i = 0; i < 4; i++) {
      await pressTab(false);
      const activeTestId = await cdp.send("Runtime.evaluate", {
        expression: `document.activeElement?.getAttribute('data-testid')`,
      });
      if (activeTestId.result?.value === "classification-notes-input") {
        notesFocused = true;
        break;
      }
    }
    console.log(`[8c.7] Focus mencapai Textarea catatan via Tab: ${notesFocused}`);

    // Select all and type new notes text
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    await delay(100);

    const keyboardNotesText = "Catatan murni alur keyboard staf";
    await typeText(keyboardNotesText);
    await delay(200);

    const textareaValueRes = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('[data-testid="classification-notes-input"]')?.value`,
    });
    const notesFilledViaKeyboard = textareaValueRes.result?.value?.includes(keyboardNotesText);
    console.log(
      `[8c.8] Catatan berhasil diisi via keyboard typing: ${notesFilledViaKeyboard} ("${textareaValueRes.result?.value}")`
    );

    // 9. Tab to cancel button, then Tab to save button
    await pressTab(false);
    const atCancel = await cdp.send("Runtime.evaluate", {
      expression: `document.activeElement?.getAttribute('data-testid') === 'cancel-edit-btn'`,
    });

    await pressTab(false);
    const atSave = await cdp.send("Runtime.evaluate", {
      expression: `document.activeElement?.getAttribute('data-testid') === 'save-classification-btn'`,
    });

    // Test Shift+Tab backwards navigation!
    await pressTab(true);
    const backAtCancel = await cdp.send("Runtime.evaluate", {
      expression: `document.activeElement?.getAttribute('data-testid') === 'cancel-edit-btn'`,
    });

    await pressTab(false);
    const forwardAtSave = await cdp.send("Runtime.evaluate", {
      expression: `document.activeElement?.getAttribute('data-testid') === 'save-classification-btn'`,
    });

    const tabNavigationSucceeded = Boolean(
      atCancel.result?.value &&
      atSave.result?.value &&
      backAtCancel.result?.value &&
      forwardAtSave.result?.value
    );
    console.log(`[8c.9] Navigasi Tab / Shift+Tab bolak-balik berhasil: ${tabNavigationSucceeded}`);

    // 10. Activate Save button via Enter key
    await pressKey("Enter", "Enter", 13);
    await delay(500);

    // Wait for save to complete and form to close
    let saveCompletedAndFormClosed = false;
    for (let i = 0; i < 25; i++) {
      const saveState = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const form = document.querySelector('[data-testid="classification-edit-form"]');
          const details = document.querySelector('[data-testid="staff-classification-details"]');
          return {
            formClosed: !form,
            detailsText: details?.textContent || "",
          };
        })()`,
        returnByValue: true,
      });
      if (
        saveState.result?.value?.formClosed &&
        saveState.result?.value?.detailsText?.includes(keyboardNotesText)
      ) {
        saveCompletedAndFormClosed = true;
        break;
      }
      await delay(200);
    }
    console.log(`[8c.10] Penyimpanan via keyboard berhasil dan form ditutup: ${saveCompletedAndFormClosed}`);

    const isKeyboardPass = Boolean(
      editBtnFocused &&
      formOpened &&
      cancelBtnFocused &&
      formCanceled &&
      radioFocused &&
      radioSelectionChanged &&
      notesFocused &&
      notesFilledViaKeyboard &&
      tabNavigationSucceeded &&
      saveCompletedAndFormClosed
    );

    recordAssertion({
      id: "keyboard_navigation_operability",
      name: "Aksesibilitas keyboard fitur klasifikasi: Tab, Shift+Tab, Arrow keys, typing, Enter simpan/batal",
      pass: isKeyboardPass,
      expected: "allKeyboardFlowsPass=true (reach, open, cancel, change category, type notes, tab/shift-tab, save)",
      actual: `editFocus=${editBtnFocused}, open=${formOpened}, cancelFocus=${cancelBtnFocused}, canceled=${formCanceled}, radioChange=${radioSelectionChanged}, notesType=${notesFilledViaKeyboard}, tabShiftTab=${tabNavigationSucceeded}, saveClose=${saveCompletedAndFormClosed}`,
    });

    // 12. Scenario: Reload Persistence From Database
    console.log("\n--- [9] Validasi Persistensi Setelah Reload Halaman ---");
    await cdp.send("Page.reload");
    await delay(1500);

    // Wait for list to load and re-click target conversation
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const evalList = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"]'))`,
      });
      if (evalList.result.value) break;
    }

    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const item = items.find(el => el.getAttribute('data-conversation-id') === targetId) || items.find(el => el.textContent.includes('Halo min lampu internet')) || items[0];
        if (item) item.click();
      })(${JSON.stringify(convId)})`,
    });

    for (let i = 0; i < 20; i++) {
      await delay(300);
      const checkCard = await cdp.send("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('[data-testid="message-classification-card"]'))`,
      });
      if (checkCard.result.value) break;
    }

    const reloadedRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const card = document.querySelector('[data-testid="message-classification-card"]');
        const badge = card?.querySelector('[data-testid="classification-status-badge"]');
        const staffVal = card?.querySelector('[data-testid="staff-category-value"]');
        const details = card?.querySelector('[data-testid="staff-classification-details"]');

        return {
          badgeText: badge?.textContent?.trim() || "",
          staffCategoryValue: staffVal?.textContent?.trim() || "",
          detailsText: details?.textContent || "",
        };
      })()`,
      returnByValue: true,
    });

    const reloadedData = reloadedRes.result.value;
    const isReloadedPass =
      reloadedData.badgeText.includes("Dikoreksi") &&
      reloadedData.staffCategoryValue.includes("Bukan Komplain");

    recordAssertion({
      id: "reload_persistence_from_database",
      name: "Persistensi setelah reload: status 'Dikoreksi', label 'Bukan Komplain' tetap utuh dari DB",
      pass: isReloadedPass,
      expected: "badge=Dikoreksi, label=Bukan Komplain",
      actual: `badge=${reloadedData.badgeText}, label=${reloadedData.staffCategoryValue}`,
    });

    await takeScreenshot("04_reloaded_persistence");

    // 13. Scenario: Error Handling and Draft Preservation
    console.log("\n--- [10] Validasi Penanganan Error & Preservasi Draft Saat Gagal ---");
    // Enable Fetch interception for next classification request
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/classification*", requestStage: "Request" }],
    });

    let interceptedRequestCount = 0;
    cdp.on("Fetch.requestPaused", async (params) => {
      interceptedRequestCount++;
      // Return simulated 500 error response
      await cdp.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 500,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" },
        ],
        body: Buffer.from(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: "SIMULATED_SERVER_ERROR", message: "Simulasi kegagalan penyimpanan server database." },
          })
        ).toString("base64"),
      });
    });

    // Open edit mode
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="edit-classification-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(400);

    // Enter draft: select 'review' and draft notes
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const reviewRadio = document.querySelector('input[type="radio"][value="review"]');
        if (reviewRadio) reviewRadio.click();
        const reviewOpt = document.querySelector('[data-testid="category-option-review"]');
        if (reviewOpt && !reviewRadio?.checked) reviewOpt.click();
      })()`,
    });
    await delay(300);

    const draftNotes = "Draft catatan staf yang tidak boleh hilang saat terjadi kesalahan jaringan.";
    await cdp.send("Runtime.evaluate", {
      expression: `((draftVal) => {
        const notesTextarea = document.querySelector('[data-testid="classification-notes-input"]');
        if (notesTextarea) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(notesTextarea, draftVal);
          notesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');
        if (saveBtn) saveBtn.click();
      })(${JSON.stringify(draftNotes)})`,
    });

    // Wait for error alert to appear
    let errorHandlingPass = false;
    let errorData = {};
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const evalRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const errorAlert = document.querySelector('[data-testid="classification-error-alert"]');
          const notesTextarea = document.querySelector('[data-testid="classification-notes-input"]');
          const reviewRadio = document.querySelector('input[type="radio"][value="review"]');

          return {
            errorVisible: Boolean(errorAlert),
            errorText: errorAlert?.textContent?.trim() || "",
            notesValue: notesTextarea?.value || "",
            reviewChecked: reviewRadio?.checked || false,
          };
        })()`,
        returnByValue: true,
      });

      errorData = evalRes.result.value;
      if (
        errorData.errorVisible &&
        errorData.errorText.includes("Simulasi kegagalan") &&
        errorData.reviewChecked === true &&
        errorData.notesValue === draftNotes
      ) {
        errorHandlingPass = true;
        break;
      }
    }

    recordAssertion({
      id: "error_handling_and_draft_preservation",
      name: "Penanganan error & preservasi draft: banner error tampil, pilihan kategori & catatan draft tidak hilang",
      pass: errorHandlingPass,
      expected: "errorVisible=true, reviewChecked=true, notes preserved",
      actual: `errorVisible=${errorData.errorVisible}, reviewChecked=${errorData.reviewChecked}, notesMatch=${errorData.notesValue === draftNotes}`,
    });

    await takeScreenshot("05_error_draft_preserved");

    // Disable Fetch interception
    await cdp.send("Fetch.disable");

    // Close error by clicking Batal
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const cancelBtn = document.querySelector('[data-testid="cancel-edit-btn"]');
        if (cancelBtn) cancelBtn.click();
      })()`,
    });
    await delay(300);
    }

    // 14. Scenario: Responsive Mobile Viewport (375px) & Touch Target Measurements
    console.log("\n--- [11] Validasi Viewport Mobile (375px) & Pengukuran Aktual Touch Target ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await delay(800);

    // 1. Measure editBtn before opening form
    const editBtnRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const editBtn = document.querySelector('[data-testid="edit-classification-btn"]');
        const r = editBtn ? editBtn.getBoundingClientRect() : null;
        if (editBtn) editBtn.click();
        return r ? { width: Math.round(r.width), height: Math.round(r.height) } : null;
      })()`,
      returnByValue: true,
    });
    await delay(400);

    // 2. Measure form controls while form is open
    const formControlsRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const card = document.querySelector('[data-testid="message-classification-card"]');
        const cancelBtn = document.querySelector('[data-testid="cancel-edit-btn"]');
        const saveBtn = document.querySelector('[data-testid="save-classification-btn"]');
        const optionOther = document.querySelector('[data-testid="category-option-other"]');
        const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

        const cancelRect = cancelBtn ? cancelBtn.getBoundingClientRect() : null;
        const saveRect = saveBtn ? saveBtn.getBoundingClientRect() : null;
        const optionRect = optionOther ? optionOther.getBoundingClientRect() : null;

        if (cancelBtn) cancelBtn.click();

        return {
          cardExists: Boolean(card),
          hasHorizontalOverflow,
          cancelBtn: cancelRect ? { width: Math.round(cancelRect.width), height: Math.round(cancelRect.height) } : null,
          saveBtn: saveRect ? { width: Math.round(saveRect.width), height: Math.round(saveRect.height) } : null,
          optionCard: optionRect ? { width: Math.round(optionRect.width), height: Math.round(optionRect.height) } : null,
        };
      })()`,
      returnByValue: true,
    });
    await delay(300);

    // 3. Measure retry-confirm-btn and dismiss-error-btn on mobile 375px
    console.log("[11.2] Mengukur area interaksi aktual tombol retry-confirm-btn dan dismiss-error-btn pada mobile 375px...");
    // Switch to convId2 (which has unlabeled message with quick-confirm-btn)
    await cdp.send("Runtime.evaluate", {
      expression: `((cid2) => {
        const item2 = document.querySelector('[data-conversation-id="' + cid2 + '"]');
        if (item2) item2.click();
      })(${JSON.stringify(convId2)})`,
    });
    await delay(600);

    const mobileFailHandler = async (params) => {
      try {
        await cdp.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 500,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(
            JSON.stringify({ success: false, error: { message: "Simulasi kegagalan mobile touch target." } })
          ).toString("base64"),
        });
      } catch {
        // Interception already handled or disabled
      }
    };
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/classification*", requestStage: "Request" }],
    });
    cdp.on("Fetch.requestPaused", mobileFailHandler);

    // Click quick-confirm-btn to trigger error banner on mobile
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="quick-confirm-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(600);

    const errorButtonsRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const retryBtn = document.querySelector('[data-testid="retry-confirm-btn"]');
        const dismissBtn = document.querySelector('[data-testid="dismiss-error-btn"]');
        const alertBox = document.querySelector('[data-testid="classification-error-alert"]');
        const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

        const rRetry = retryBtn ? retryBtn.getBoundingClientRect() : null;
        const rDismiss = dismissBtn ? dismissBtn.getBoundingClientRect() : null;

        return {
          alertExists: Boolean(alertBox),
          hasHorizontalOverflow,
          retryBtn: rRetry
            ? {
                width: Math.round(rRetry.width),
                height: Math.round(rRetry.height),
                left: Math.round(rRetry.left),
                right: Math.round(rRetry.right),
                top: Math.round(rRetry.top),
                bottom: Math.round(rRetry.bottom),
              }
            : null,
          dismissBtn: rDismiss
            ? {
                width: Math.round(rDismiss.width),
                height: Math.round(rDismiss.height),
                left: Math.round(rDismiss.left),
                right: Math.round(rDismiss.right),
                top: Math.round(rDismiss.top),
                bottom: Math.round(rDismiss.bottom),
              }
            : null,
        };
      })()`,
      returnByValue: true,
    });

    cdp.off("Fetch.requestPaused", mobileFailHandler);
    await cdp.send("Fetch.disable").catch(() => {});

    await takeScreenshot("06_mobile_confirmation_error");

    // Dismiss error alert
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const dismissBtn = document.querySelector('[data-testid="dismiss-error-btn"]');
        if (dismissBtn) dismissBtn.click();
      })()`,
    });
    await delay(300);

    // Switch back to convId
    await cdp.send("Runtime.evaluate", {
      expression: `((cid) => {
        const item = document.querySelector('[data-conversation-id="' + cid + '"]');
        if (item) item.click();
      })(${JSON.stringify(convId)})`,
    });
    await delay(500);

    await cdp.send("Emulation.clearDeviceMetricsOverride");

    const editBtnRect = editBtnRes.result.value;
    const formMetrics = formControlsRes.result.value;
    const errorMetrics = errorButtonsRes.result.value;

    const noButtonOverlap = Boolean(
      errorMetrics.retryBtn &&
      errorMetrics.dismissBtn &&
      (errorMetrics.retryBtn.right <= errorMetrics.dismissBtn.left ||
        errorMetrics.retryBtn.left >= errorMetrics.dismissBtn.right ||
        errorMetrics.retryBtn.bottom <= errorMetrics.dismissBtn.top ||
        errorMetrics.retryBtn.top >= errorMetrics.dismissBtn.bottom)
    );

    const allControlsMeetMinSize =
      editBtnRect && editBtnRect.height >= 40 && editBtnRect.width >= 40 &&
      formMetrics.cancelBtn && formMetrics.cancelBtn.height >= 40 && formMetrics.cancelBtn.width >= 40 &&
      formMetrics.saveBtn && formMetrics.saveBtn.height >= 40 && formMetrics.saveBtn.width >= 40 &&
      formMetrics.optionCard && formMetrics.optionCard.height >= 40 && formMetrics.optionCard.width >= 40 &&
      errorMetrics.retryBtn && errorMetrics.retryBtn.height >= 40 && errorMetrics.retryBtn.width >= 40 &&
      errorMetrics.dismissBtn && errorMetrics.dismissBtn.height >= 40 && errorMetrics.dismissBtn.width >= 40;

    const noOverflow = !formMetrics.hasHorizontalOverflow && !errorMetrics.hasHorizontalOverflow;
    const isMobilePass =
      formMetrics.cardExists &&
      errorMetrics.alertExists &&
      noOverflow &&
      allControlsMeetMinSize &&
      noButtonOverlap;

    recordAssertion({
      id: "responsive_mobile_viewport_and_touch_target",
      name: "Responsivitas mobile (375px) & ukuran touch target: tanpa overflow, kontrol form dan error banner >= 40px terukur",
      pass: isMobilePass,
      expected: "hasHorizontalOverflow=false, all controls (form & error banner) width and height >= 40px, no button overlap",
      actual: `overflow=${formMetrics.hasHorizontalOverflow || errorMetrics.hasHorizontalOverflow}, editBtn=${editBtnRect?.width}x${editBtnRect?.height}px, cancelBtn=${formMetrics.cancelBtn?.width}x${formMetrics.cancelBtn?.height}px, saveBtn=${formMetrics.saveBtn?.width}x${formMetrics.saveBtn?.height}px, optionCard=${formMetrics.optionCard?.width}x${formMetrics.optionCard?.height}px, retryBtn=${errorMetrics.retryBtn?.width}x${errorMetrics.retryBtn?.height}px, dismissBtn=${errorMetrics.dismissBtn?.width}x${errorMetrics.dismissBtn?.height}px, noOverlap=${noButtonOverlap}`,
    });

    if (!isOnlyMobile) {
    // 15. Scenario: Zero Operational Side Effects (Strictly Annotative Sebelum vs Sesudah)
    console.log("\n--- [12] Validasi Zero Operational Side Effects (Strictly Annotative Sebelum vs Sesudah) ---");
    const finalEpisodesRes = await pool.query(`SELECT count(*)::int as count FROM public.complaints`);
    const finalClaimsRes = await pool.query(`SELECT count(*)::int as count FROM public.reply_claims`);
    const finalOutboundRes = await pool.query(`SELECT count(*)::int as count FROM public.outbound_intents`);
    const finalConversationsRes = await pool.query(`SELECT count(*)::int as count FROM public.conversations`);

    const finalDbState = {
      complaints: finalEpisodesRes.rows[0].count,
      replyClaims: finalClaimsRes.rows[0].count,
      outboundIntents: finalOutboundRes.rows[0].count,
      conversations: finalConversationsRes.rows[0].count,
    };

    const isZeroSideEffectsPass =
      finalDbState.complaints === baselineDbState.complaints &&
      finalDbState.replyClaims === baselineDbState.replyClaims &&
      finalDbState.outboundIntents === baselineDbState.outboundIntents &&
      finalDbState.conversations === baselineDbState.conversations;

    recordAssertion({
      id: "zero_operational_side_effects",
      name: "Murni anotasi evaluasi: 0 outbound intents dikirim, 0 klaim dispatch, 0 mutasi complaint/lifecycle (sebelum vs sesudah identik)",
      pass: isZeroSideEffectsPass,
      expected: `complaints=${baselineDbState.complaints}, claims=${baselineDbState.replyClaims}, outbound=${baselineDbState.outboundIntents}`,
      actual: `complaints=${finalDbState.complaints}, claims=${finalDbState.replyClaims}, outbound=${finalDbState.outboundIntents}`,
    });
    }

  } catch (err) {
    console.error("\n[Fatal Runner Error]:", err);
    cleanupErrors.push(err);
  } finally {
    // Teardown Lifecycle
    console.log("\n--- [Teardown] Pembersihan Resource Pengujian ---");

    if (cdp) {
      try {
        cdp.close();
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (chromeProc) {
      try {
        killProcess(chromeProc);
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (nextProc) {
      try {
        killProcess(nextProc);
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (pool) {
      try {
        if (convId) {
          await pool.query(
            `DELETE FROM public.staff_message_classification_history WHERE conversation_id = $1`,
            [convId]
          );
          await pool.query(
            `DELETE FROM public.staff_message_classifications WHERE conversation_id = $1`,
            [convId]
          );
        }
        if (convId2) {
          await pool.query(
            `DELETE FROM public.staff_message_classification_history WHERE conversation_id = $1`,
            [convId2]
          ).catch(() => {});
          await pool.query(
            `DELETE FROM public.staff_message_classifications WHERE conversation_id = $1`,
            [convId2]
          ).catch(() => {});
        }
        if (tracker) {
          await cleanupFixture(pool, tracker);
        }
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (staffUserId && supabaseAdmin) {
      try {
        const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
        if (delUserErr) cleanupErrors.push(delUserErr);
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (supabaseAdmin && extraStaffUserIds.length > 0) {
      for (const uid of extraStaffUserIds) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(uid);
        } catch (e) {
          cleanupErrors.push(e);
        }
      }
    }

    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    const teardownPass = cleanupErrors.length === 0;
    recordAssertion({
      id: "runner_cleanup_and_teardown",
      name: "Pembersihan proses Chrome/Next.js, user staf, dan fixture database selesai tanpa residu",
      pass: teardownPass,
      expected: "cleanupErrors.length === 0",
      actual: teardownPass ? "Clean teardown" : cleanupErrors.map((e) => e.message).join("; "),
    });

    // Save evidence JSON
    const overallPass = assertions.every((a) => a.status === "PASS");
    const summary = {
      runId,
      timestamp: new Date().toISOString(),
      overallStatus: overallPass ? "PASS" : "FAIL",
      expectedExitCode: overallPass ? 0 : 1,
      calculatedExitCode: overallPass ? 0 : 1,
      totalAssertions: assertions.length,
      passedAssertions: assertions.filter((a) => a.status === "PASS").length,
      failedAssertions: assertions.filter((a) => a.status === "FAIL").length,
      screenshots: capturedScreenshots,
      assertions,
      cleanupErrors: cleanupErrors.map((e) => e.message || String(e)),
    };

    const evidenceFilePath = path.join(runEvidenceDir, "evidence.json");
    fs.writeFileSync(evidenceFilePath, JSON.stringify(summary, null, 2));
    console.log(`\n[Bukti] Hasil disimpan di: ${evidenceFilePath}`);

    updateLatestManifest({
      mode: isOnlyMobile ? "targeted_mobile" : "live_browser_normal",
      runId,
      evidenceDir: runEvidenceDir,
      evidencePath: evidenceFilePath,
      timestamp: summary.timestamp,
      overallStatus: summary.overallStatus,
      expectedExitCode: summary.expectedExitCode,
      calculatedExitCode: summary.calculatedExitCode,
      buildId: getBuildId(),
      screenshotsCount: capturedScreenshots.length,
    });

    console.log("\n========================================================");
    console.log(`TOTAL ASSERTION: ${summary.totalAssertions}`);
    console.log(`LULUS:           ${summary.passedAssertions}`);
    console.log(`GAGAL:           ${summary.failedAssertions}`);
    console.log(`STATUS AKHIR:    ${summary.overallStatus}`);
    console.log("========================================================\n");

    process.exit(overallPass ? 0 : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runP28VerificationHarness()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Runner] Fatal error:", err);
      process.exit(1);
    });
}
