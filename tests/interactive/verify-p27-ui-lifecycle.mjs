#!/usr/bin/env node
/**
 * tests/interactive/verify-p27-ui-lifecycle.mjs
 *
 * Dedicated Interactive UI Lifecycle Verification Runner for P2.7:
 * Tests the real Next.js application & InboxDashboard in native headless Chrome
 * with controllable, delayed, and reordered HTTP responses via Chrome DevTools Protocol (CDP).
 *
 * Enforces empirical DOM verification for:
 * 1. Respons konteks tidak berurutan:
 *    - Pembuktian A -> B -> A navigation.
 *    - Pembuktian dua request konteks pada kunjungan percakapan yang sama (request lama ditahan,
 *      request baru dari polling diselesaikan duluan -> tampil di DOM, respons lama dilepas -> respons lama ditolak).
 *    - Pencatatan urutan intersepsi & pelepasan sebenarnya secara presisi.
 * 2. Foreground lambat bersamaan dengan polling:
 *    - Dua request berbeda tertangkap: foreground context ditahan DAN background polling aktual dari komponen.
 *    - Uji polling sukses dan polling gagal saat foreground masih in-flight.
 *    - Konteks akhir tampil, loading tuntas, dan error polling dapat dipulihkan.
 * 3. Pemeriksaan jaringan tertunda saat layanan berubah:
 *    - Pemeriksaan pertama untuk layanan A ditahan, konteks berganti ke layanan B, pastikan B tampil
 *      sebelum respons A dilepas.
 *    - Uji layanan A -> B -> A dalam percakapan yang sama (respons check A sebelumnya tetap ditolak).
 *    - Kontrol positif: pemeriksaan sah pada konteks aktif benar-benar dirender pada DOM.
 *    - Assertion ketat: tidak ada OR yang lolos karena teks hilang.
 * 4. Sinkronisasi assessment dan perubahan layanan:
 *    - Kasus 4a: Assessment berubah pada field non-reason (disposition/incidentId) dengan pesan & service sama.
 *    - Kasus 4b: Service ID benar-benar berubah tanpa penambahan pesan.
 *    - Perubahan tampil konkret di DOM sesuai kontrak API.
 * 5. Preservasi unresolved saat polling:
 *    - Outcome unresolved tampil terlebih dahulu.
 *    - Menghitung minimal 3 request polling aktual yang selesai.
 *    - Hasil unresolved tetap utuh di DOM setelah seluruh siklus polling selesai.
 * 6. Snapshot parsial non-2xx:
 *    - Respons non-2xx dengan snapshot parsial berpenanda unik menampilkan banner error DAN snapshot di DOM.
 *    - Respons parsial kedaluwarsa setelah perpindahan konteks ditolak dan tidak menggantikan konteks aktif.
 * 7. Proteksi runner & teardown bersih:
 *    - Verifikasi marker PostgreSQL & Supabase API via verifyTestTargetIdentity fail-closed sebelum mutasi.
 *    - Mode --test-guard-rejection membuktikan penolakan guard mencegah pembuatan user & fixture.
 *    - Pemeriksaan error deleteUser() dan verifikasi proses Chrome/Next.js benar-benar mati.
 *    - Validasi build-source ketat (mode ui_lifecycle -> SYNCHRONIZED, bukan NOT_APPLICABLE).
 *    - Registry assertion wajib.
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
  TRACKED_SOURCE_FILES,
  TRACKED_FILE_SCOPE,
  TRACKED_FILE_DESCRIPTION,
} from "../../scripts/build-source-manifest.mjs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export const LIFECYCLE_MANDATORY_REGISTRY = [
  "build_source_binding_verification",
  "ui_lifecycle_stale_context_rejected_a_b_a",
  "ui_lifecycle_slow_foreground_with_polling_consistent",
  "ui_lifecycle_delayed_network_check_rejected_on_service_change",
  "ui_lifecycle_assessment_and_service_change_syncs_context",
  "ui_lifecycle_noop_polling_preserves_unresolved",
  "ui_lifecycle_partial_non_2xx_accepted_and_stale_rejected",
  "runner_cleanup_and_teardown",
];

export const GUARD_REJECTION_REGISTRY = [
  "guard_active_db_rejection",
  "guard_active_api_rejection",
  "guard_marker_mismatch_rejection",
  "guard_zero_mutations_on_rejection",
];

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

let unhandledRejectionsCount = 0;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionsCount++;
  console.error("[CRITICAL UNHANDLED REJECTION]:", reason);
});

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

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { encoding: "utf8" });
  } else {
    try { proc.kill("SIGKILL"); } catch {}
  }

  for (let i = 0; i < 20; i++) {
    if (!isProcessRunning(pid)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  if (isProcessRunning(pid)) {
    throw new Error(`Gagal menghentikan proses PID ${pid}`);
  }
}

function getLifecycleRunnerRevisionSha256() {
  const scriptPath = path.resolve("tests/interactive/verify-p27-ui-lifecycle.mjs");
  return crypto.createHash("sha256").update(fs.readFileSync(scriptPath)).digest("hex");
}

async function findAvailablePort(startPort = 3370) {
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

async function getWebSocketDebuggerUrl(port) {
  for (let i = 40; i > 0; i--) {
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
    await delay(250);
  }
  throw new Error("Cannot connect to Chrome remote debugging port.");
}

export class TeardownCancellationError extends Error {
  constructor(message = "Operasi dibatalkan karena teardown runner sedang berlangsung") {
    super(message);
    this.name = "TeardownCancellationError";
    this.isTeardownCancellation = true;
  }
}

export class CDPClient {
  constructor(wsUrl, { onAsyncError = null } = {}) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
    this.inFlightHandlers = new Set();
    this.onAsyncError = onAsyncError;
    this.isClosed = false;
    this.isFinalizing = false;
  }

  stopAcceptingNewEvents() {
    this.isFinalizing = true;
  }

  async connect() {
    this.ws = new globalThis.WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (err) => reject(new Error("WebSocket error: " + err.message));
      this.ws.onclose = () => {
        if (!this.isClosed) {
          const closeErr = new Error("CDP WebSocket unexpectedly closed");
          for (const [id, cb] of this.callbacks.entries()) {
            cb.reject(closeErr);
          }
          this.callbacks.clear();
        }
      };
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          if (this.isFinalizing || this.isClosed) {
            // Hentikan pekerjaan pengujian baru saat finalisasi dimulai
            if (msg.method === "Fetch.requestPaused" && msg.params?.requestId) {
              try {
                const contId = this.id++;
                this.ws.send(JSON.stringify({ id: contId, method: "Fetch.continueRequest", params: { requestId: msg.params.requestId } }));
              } catch {}
            }
            return;
          }
          const handlers = this.eventHandlers.get(msg.method) || [];
          for (const handler of handlers) {
            try {
              const res = handler(msg.params);
              if (res && typeof res.then === "function") {
                this.trackInFlight(res);
              }
            } catch (syncErr) {
              this.dispatchError(syncErr);
            }
          }
        }
      };
    });
  }

  trackInFlight(promise) {
    this.inFlightHandlers.add(promise);
    promise
      .catch((err) => {
        // Bedakan pembatalan yang sengaja dilakukan oleh teardown dari kegagalan pengujian sebenarnya
        if (err instanceof TeardownCancellationError || err?.isTeardownCancellation) {
          return;
        }
        // Jangan mengabaikan rejection terlambat meskipun isClosed atau isFinalizing
        this.dispatchError(err);
      })
      .finally(() => {
        this.inFlightHandlers.delete(promise);
      });
  }

  dispatchError(err) {
    if (this.onAsyncError) {
      try {
        this.onAsyncError(err instanceof Error ? err : new Error(String(err)));
      } catch (handlerErr) {
        console.error("[CDPClient] Error in onAsyncError listener:", handlerErr);
      }
    }
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(handler);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.isClosed) {
        return reject(new TeardownCancellationError(`Cannot send CDP command ${method}: connection is closed`));
      }
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async drainInFlightHandlers(timeoutMs = 5000) {
    if (this.inFlightHandlers.size === 0) {
      return { drained: true, inFlightCount: 0 };
    }
    let timeoutId = null;
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        const remaining = this.inFlightHandlers.size;
        reject(
          new Error(
            `Handler drain timeout (${timeoutMs}ms): ${remaining} handler(s) asynchronous in-flight gagal selesai tepat waktu`
          )
        );
      }, timeoutMs);
    });

    try {
      const allSettledLoop = (async () => {
        while (this.inFlightHandlers.size > 0 && !timedOut) {
          await Promise.allSettled([...this.inFlightHandlers]);
        }
      })();
      await Promise.race([allSettledLoop, timeoutPromise]);
      return { drained: true, inFlightCount: 0 };
    } catch (drainErr) {
      this.dispatchError(drainErr);
      throw drainErr;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  close() {
    this.isClosed = true;
    this.stopAcceptingNewEvents();
    this.eventHandlers.clear();
    const cancellationError = new TeardownCancellationError("CDP connection closed during teardown");
    for (const [id, cb] of this.callbacks.entries()) {
      cb.reject(cancellationError);
    }
    this.callbacks.clear();
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}

export class AsyncFailureController {
  constructor() {
    this.fatalError = null;
    this.allErrors = [];
    this.listeners = new Set();
  }

  signal(err) {
    if (!err) return;
    if (err instanceof TeardownCancellationError || err?.isTeardownCancellation) {
      return;
    }
    const normalizedErr = err instanceof Error ? err : new Error(String(err));
    this.allErrors.push(normalizedErr);
    if (!this.fatalError) {
      this.fatalError = normalizedErr;
    }
    for (const listener of this.listeners) {
      try {
        listener(normalizedErr);
      } catch {}
    }
  }

  hasError() {
    return this.fatalError !== null;
  }

  getError() {
    return this.fatalError;
  }

  getAllErrors() {
    return this.allErrors;
  }

  check() {
    if (this.fatalError) {
      throw this.fatalError;
    }
  }

  async race(promise) {
    if (this.fatalError) throw this.fatalError;
    return new Promise((resolve, reject) => {
      let settled = false;
      const onError = (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      };
      const cleanup = () => {
        this.listeners.delete(onError);
      };
      this.listeners.add(onError);
      promise
        .then((res) => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(res);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        });
    });
  }
}

export class NetworkRequestCorrelator {
  constructor() {
    this.networkResponses = new Map(); // netId -> { status, statusText, url, timestamp }
    this.networkFinished = new Set();  // Set<netId>
    this.networkFailed = new Map();    // netId -> { errorText, canceled }
    this.pendingWaiters = new Map();   // netId -> { resolve, reject, timer, targetUrl, fetchReqId }
  }

  onResponseReceived(p) {
    const requestId = p?.requestId;
    if (!requestId) return;
    this.networkResponses.set(requestId, {
      status: p.response?.status,
      statusText: p.response?.statusText,
      url: p.response?.url,
      timestamp: p.timestamp || Date.now(),
    });
    this._checkSettlement(requestId);
  }

  onLoadingFinished(p) {
    const requestId = p?.requestId;
    if (!requestId) return;
    this.networkFinished.add(requestId);
    this._checkSettlement(requestId);
  }

  onLoadingFailed(p) {
    const requestId = p?.requestId;
    if (!requestId) return;
    this.networkFailed.set(requestId, {
      errorText: p.errorText,
      canceled: p.canceled,
    });
    if (this.pendingWaiters.has(requestId)) {
      const waiter = this.pendingWaiters.get(requestId);
      this.pendingWaiters.delete(requestId);
      if (waiter.timer) clearTimeout(waiter.timer);
      this.networkFailed.delete(requestId);
      waiter.reject(
        new Error(`Permintaan jaringan gagal untuk ${waiter.targetUrl} (networkId=${requestId}): ${p.errorText || "loading failed"}`)
      );
    }
  }

  _checkSettlement(netId) {
    if (!this.pendingWaiters.has(netId)) return;
    if (this.networkFailed.has(netId)) {
      const waiter = this.pendingWaiters.get(netId);
      this.pendingWaiters.delete(netId);
      if (waiter.timer) clearTimeout(waiter.timer);
      const err = this.networkFailed.get(netId);
      this.networkFailed.delete(netId);
      waiter.reject(
        new Error(`Permintaan jaringan gagal untuk ${waiter.targetUrl} (networkId=${netId}): ${err.errorText || "loading failed"}`)
      );
      return;
    }
    if (this.networkResponses.has(netId) && this.networkFinished.has(netId)) {
      const waiter = this.pendingWaiters.get(netId);
      this.pendingWaiters.delete(netId);
      if (waiter.timer) clearTimeout(waiter.timer);
      const resp = this.networkResponses.get(netId);
      this.networkResponses.delete(netId);
      this.networkFinished.delete(netId);

      if (resp.status !== 200) {
        waiter.reject(
          new Error(`Permintaan jaringan selesai dengan HTTP status bukan 200 (${resp.status}) untuk ${waiter.targetUrl} (networkId=${netId})`)
        );
        return;
      }

      waiter.resolve({
        status: resp.status,
        statusText: resp.statusText,
        networkId: netId,
        fetchRequestId: waiter.fetchReqId,
        url: waiter.targetUrl,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  async waitForRequestCompletion(fetchParams, timeoutMs = 8000) {
    const netId = fetchParams?.networkId;
    const fetchReqId = fetchParams?.requestId;
    const targetUrl = fetchParams?.request?.url;

    if (!netId || typeof netId !== "string" || !netId.trim()) {
      throw new Error(`Korelasi gagal: fetchParams.networkId wajib ada dan valid untuk request ${targetUrl || "unknown"}`);
    }

    if (this.pendingWaiters.has(netId)) {
      throw new Error(`Korelasi ambigu: terdapat request waiter yang sedang berjalan untuk networkId=${netId}`);
    }

    if (this.networkFailed.has(netId)) {
      const err = this.networkFailed.get(netId);
      this.networkFailed.delete(netId);
      throw new Error(`Permintaan jaringan gagal untuk ${targetUrl} (networkId=${netId}): ${err.errorText || "loading failed"}`);
    }

    if (this.networkResponses.has(netId) && this.networkFinished.has(netId)) {
      const resp = this.networkResponses.get(netId);
      this.networkResponses.delete(netId);
      this.networkFinished.delete(netId);
      if (resp.status !== 200) {
        throw new Error(`Permintaan jaringan selesai dengan HTTP status bukan 200 (${resp.status}) untuk ${targetUrl} (networkId=${netId})`);
      }
      return {
        status: resp.status,
        statusText: resp.statusText,
        networkId: netId,
        fetchRequestId: fetchReqId,
        url: targetUrl,
        finishedAt: new Date().toISOString(),
      };
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingWaiters.has(netId)) {
          this.pendingWaiters.delete(netId);
          reject(new Error(`Timeout (${timeoutMs}ms) menunggu penyelesaian jaringan untuk ${targetUrl} (networkId=${netId})`));
        }
      }, timeoutMs);

      this.pendingWaiters.set(netId, {
        resolve,
        reject,
        timer,
        targetUrl,
        fetchReqId,
      });
    });
  }

  clear() {
    for (const [_, waiter] of this.pendingWaiters.entries()) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error("NetworkRequestCorrelator dibersihkan"));
    }
    this.pendingWaiters.clear();
    this.networkResponses.clear();
    this.networkFinished.clear();
    this.networkFailed.clear();
  }
}

export async function executeRunnerSetupPipeline(envConfig, {
  pool = null,
  supabaseAdmin = null,
  createUser = null,
  seedFixtures = null,
} = {}) {
  // Step 1: parse and validate config (fails closed on workspace DB 54322 or Supabase API 54321)
  const testConfig = parseAndValidateTestConfig(envConfig);

  // Step 2: instantiate clients if not injected
  const activePool = pool || new Pool({ connectionString: testConfig.databaseUrl });
  const activeSb = supabaseAdmin || createClient(testConfig.apiUrl, testConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Step 3: verify identity marker between PostgreSQL and Supabase API
    await verifyTestTargetIdentity(activePool, activeSb, testConfig.expectedMarker);

    // Step 4: user creation seam (must NOT be reached if guard rejected)
    let staffUserId = null;
    if (createUser) {
      staffUserId = await createUser(activeSb);
    }

    // Step 5: fixture seeding seam (must NOT be reached if guard rejected)
    if (seedFixtures) {
      await seedFixtures(activePool, staffUserId);
    }

    return { testConfig, pool: activePool, supabaseAdmin: activeSb, staffUserId };
  } catch (err) {
    if (!pool && activePool && typeof activePool.end === "function") {
      try { await activePool.end(); } catch {}
    }
    throw err;
  }
}

export async function runUILifecycleVerification() {
  const TEST_GUARD_REJECTION = process.argv.includes("--test-guard-rejection");

  console.log("=== P2.7: PENGUJIAN LIFECYCLE UI & RESILIENSI RESPON HTTP ===");

  const baseEvidenceDir = path.resolve("docs/evidence/P2_7");
  const runnerRevisionSha256 = getLifecycleRunnerRevisionSha256();

  // =========================================================================
  // HARNESS: GUARD REJECTION TEST (--test-guard-rejection)
  // =========================================================================
  if (TEST_GUARD_REJECTION) {
    console.log(">> HARNESS VERIFIKASI: Penolakan Guard Melalui Jalur Setup Runner <<");
    const runId = "guard-reject-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    const assertions = [];
    function recordGuardAssertion({ id, name, pass, expected, actual }) {
      const status = pass ? "PASS" : "FAIL";
      const record = { id, name, isOptional: false, status, expected, actual };
      assertions.push(record);
      if (pass) console.log(`  [✓] PASS: ${name}`);
      else console.error(`  [✗] FAIL: ${name}\n      Expected: ${expected}\n      Actual: ${actual}`);
      return pass;
    }

    // 1. Rejection of active workspace DB (port 54322) via setup pipeline
    let userSpy1Calls = 0;
    let fixtureSpy1Calls = 0;
    let guard1Ok = false;
    let guard1Actual = "";
    try {
      await executeRunnerSetupPipeline({
        HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
        HELPDESK_TEST_SERVICE_ROLE_KEY: "dummy-key",
        HELPDESK_TEST_ENV_MARKER: "test-marker-123",
      }, {
        createUser: async () => { userSpy1Calls++; },
        seedFixtures: async () => { fixtureSpy1Calls++; },
      });
      guard1Actual = "Active workspace database (54322) was NOT rejected";
    } catch (e) {
      guard1Ok = e.message.includes("default user workspace database") && userSpy1Calls === 0 && fixtureSpy1Calls === 0;
      guard1Actual = `${e.message} (userCalls=${userSpy1Calls}, fixtureCalls=${fixtureSpy1Calls})`;
    }
    recordGuardAssertion({
      id: "guard_active_db_rejection",
      name: "Jalur setup runner menolak database workspace pengguna aktif (port 54322) sebelum pembuatan user & fixture",
      expected: "Error penolakan database 54322 & userCalls=0 & fixtureCalls=0",
      actual: guard1Actual,
      pass: guard1Ok,
    });

    // 2. Rejection of active workspace Supabase API (port 54321) via setup pipeline
    let userSpy2Calls = 0;
    let fixtureSpy2Calls = 0;
    let guard2Ok = false;
    let guard2Actual = "";
    try {
      await executeRunnerSetupPipeline({
        HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
        HELPDESK_TEST_API_URL: "http://127.0.0.1:54321",
        HELPDESK_TEST_SERVICE_ROLE_KEY: "dummy-key",
        HELPDESK_TEST_ENV_MARKER: "test-marker-123",
      }, {
        createUser: async () => { userSpy2Calls++; },
        seedFixtures: async () => { fixtureSpy2Calls++; },
      });
      guard2Actual = "Active workspace Supabase API (54321) was NOT rejected";
    } catch (e) {
      guard2Ok = e.message.includes("FAIL-CLOSED: Target API is the default user workspace Supabase API (port 54321)") && userSpy2Calls === 0 && fixtureSpy2Calls === 0;
      guard2Actual = `${e.message} (userCalls=${userSpy2Calls}, fixtureCalls=${fixtureSpy2Calls})`;
    }
    recordGuardAssertion({
      id: "guard_active_api_rejection",
      name: "Jalur setup runner menolak Supabase API workspace pengguna aktif (port 54321) sebelum pembuatan user & fixture",
      expected: "Error target API port 54321 & userCalls=0 & fixtureCalls=0",
      actual: guard2Actual,
      pass: guard2Ok,
    });

    // 3. Rejection of marker token mismatch between PG and Supabase API via setup pipeline
    let userSpy3Calls = 0;
    let fixtureSpy3Calls = 0;
    let guard3Ok = false;
    let guard3Actual = "";
    try {
      const mockPool = {
        query: async () => ({ rows: [{ id: "test-marker", description: "TOKEN_DATABASE_ALPHA" }] }),
      };
      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "test-marker", description: "TOKEN_SUPABASE_BETA" },
                error: null,
              }),
            }),
          }),
        }),
      };
      await executeRunnerSetupPipeline({
        HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
        HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
        HELPDESK_TEST_SERVICE_ROLE_KEY: "dummy-key",
        HELPDESK_TEST_ENV_MARKER: "test-marker",
      }, {
        pool: mockPool,
        supabaseAdmin: mockSupabase,
        createUser: async () => { userSpy3Calls++; },
        seedFixtures: async () => { fixtureSpy3Calls++; },
      });
      guard3Actual = "Marker token mismatch was NOT rejected";
    } catch (e) {
      guard3Ok = e.message.includes("FAIL-CLOSED: Target mismatch: PostgreSQL and Supabase API returned different marker tokens") && userSpy3Calls === 0 && fixtureSpy3Calls === 0;
      guard3Actual = `${e.message} (userCalls=${userSpy3Calls}, fixtureCalls=${fixtureSpy3Calls})`;
    }
    recordGuardAssertion({
      id: "guard_marker_mismatch_rejection",
      name: "Jalur setup runner menolak marker token mismatch antara PG dan Supabase API sebelum pembuatan user & fixture",
      expected: "Error marker token mismatch & userCalls=0 & fixtureCalls=0",
      actual: guard3Actual,
      pass: guard3Ok,
    });

    // 4. Verification that zero mutations occurred and no residuals leaked across resources
    const verifiedConfig = parseAndValidateTestConfig({
      HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
      HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
      HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
      HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
    });
    const checkPool = new Pool({ connectionString: verifiedConfig.databaseUrl });
    const checkSb = createClient(verifiedConfig.apiUrl, verifiedConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const guardPrefix = `staff_lifecycle_${runId}`;
    const { data: usersList, error: listUsersError } = await checkSb.auth.admin.listUsers();
    if (listUsersError) {
      throw new Error(`Gagal membaca daftar pengguna dari Supabase Admin: ${listUsersError.message}`);
    }
    const leakedUsers = (usersList?.users || []).filter((u) => u.email?.includes(guardPrefix));

    // Multi-resource database checks: ensure zero customers or conversations leaked from guard test
    const { rows: leakedCustRows } = await checkPool.query(
      "SELECT id FROM public.customers WHERE customer_code LIKE $1",
      [`%${runId}%`]
    );
    const { rows: leakedConvRows } = await checkPool.query(
      "SELECT id FROM public.conversations WHERE account_id LIKE $1",
      [`%${runId}%`]
    );
    await checkPool.end();

    const zeroMutationsOk = leakedUsers.length === 0 && leakedCustRows.length === 0 && leakedConvRows.length === 0;
    recordGuardAssertion({
      id: "guard_zero_mutations_on_rejection",
      name: "Verifikasi nol mutasi dan bebas residu lintas resource (Auth API, Customers, Conversations) pada penolakan guard setup",
      expected: "leakedUsers=0, leakedCustomers=0, leakedConversations=0",
      actual: `leakedUsers=${leakedUsers.length}, leakedCustomers=${leakedCustRows.length}, leakedConversations=${leakedConvRows.length}`,
      pass: zeroMutationsOk,
    });

    const passedCount = assertions.filter((a) => a.status === "PASS").length;
    const failedCount = assertions.filter((a) => a.status === "FAIL").length;
    const overallStatus = failedCount === 0 ? "PASS" : "FAIL";

    const guardEvidence = {
      timestamp: new Date().toISOString(),
      runId,
      mode: "guard_rejection",
      runnerRevisionSha256,
      expectedExitCode: 0,
      calculatedExitCode: overallStatus === "PASS" ? 0 : 1,
      buildIdentity: {
        status: "NOT_APPLICABLE",
        isApplicable: false,
        isValid: true,
        reason: "Mode guard rejection tidak menjalankan server Next.js",
      },
      summary: {
        overallStatus,
        exitCode: overallStatus === "PASS" ? 0 : 1,
        total: assertions.length,
        passed: passedCount,
        failed: failedCount,
      },
      assertions,
      cleanupErrors: [],
    };

    const outPath = path.join(runEvidenceDir, "evidence.json");
    fs.writeFileSync(outPath, JSON.stringify(guardEvidence, null, 2));
    console.log(`\nArtefak bukti guard rejection disimpan di: ${outPath}`);
    return guardEvidence;
  }

  // =========================================================================
  // NORMAL / ASYNC FAILURE LIFECYCLE RUN
  // =========================================================================
  const TEST_ASYNC_FAILURE = process.argv.includes("--test-async-failure");
  const TEST_FINALIZATION_ASYNC_FAILURE = process.argv.includes("--test-finalization-async-failure");
  const runId = (TEST_ASYNC_FAILURE
    ? "async-fail-"
    : TEST_FINALIZATION_ASYNC_FAILURE
    ? "final-fail-"
    : "lifecycle-") + crypto.randomUUID().slice(0, 8);
  const runEvidenceDir = path.join(baseEvidenceDir, runId);
  const screenshotsDir = path.join(runEvidenceDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const asyncFailureController = new AsyncFailureController();
  let runnerFatalError = null;

  let isTestPhaseFinalized = false;
  let isArtifactFinalized = false;

  let finalizationTriggered = false;
  let finalizationSignalResolve = null;
  const finalizationSignalPromise = new Promise((resolve) => {
    finalizationSignalResolve = resolve;
  });

  function delay(ms) {
    if (asyncFailureController.hasError()) {
      return Promise.reject(asyncFailureController.getError());
    }
    return asyncFailureController.race(
      new Promise((resolve) => setTimeout(resolve, ms))
    );
  }

  const assertions = [];
  const capturedScreenshots = [];
  const cleanupErrors = [];

  function recordAssertion({ id, name, pass, expected, actual }) {
    if (isArtifactFinalized) {
      console.warn(`[Assertion Freeze Guard] Menolak modifikasi assertion pasca-finalisasi: ${id}`);
      return false;
    }
    if (isTestPhaseFinalized && id !== "runner_cleanup_and_teardown") {
      console.warn(`[Assertion Freeze Guard] Menolak modifikasi assertion pengujian saat fase teardown: ${id}`);
      return false;
    }
    const status = pass ? "PASS" : "FAIL";
    const record = { id, name, isOptional: false, status, expected, actual };
    assertions.push(record);
    if (pass) {
      console.log(`  [✓] PASS: ${name}`);
    } else {
      console.error(`  [✗] FAIL: ${name}`);
      console.error(`      Expected: ${expected}`);
      console.error(`      Actual:   ${actual}`);
    }
    return pass;
  }

  // Source hashes at launch
  const sourceHashesAtLaunch = computeSourceHashes();
  const buildManifest = readBuildManifest();
  const buildId = fs.existsSync(".next/BUILD_ID")
    ? fs.readFileSync(".next/BUILD_ID", "utf8").trim()
    : null;

  // Strict launch build validation for ui_lifecycle mode
  let buildValidation = validateBuildMetadata({
    manifest: buildManifest,
    currentBuildId: buildId,
    launchHashes: sourceHashesAtLaunch,
    mode: "ui_lifecycle",
  });

  recordAssertion({
    id: "build_source_binding_verification",
    name: "Pengikatan build-to-source valid dan BUILD_ID tersinkronisasi (mode ui_lifecycle)",
    pass: buildValidation.isValid && buildValidation.status === "SYNCHRONIZED",
    expected: "SYNCHRONIZED",
    actual: buildValidation.status,
  });

  const tracker = new TestResourceTracker();
  let testConfig = null;
  let pool = null;
  let supabaseAdmin = null;
  let nextProc = null;
  let chromeProc = null;
  let cdp = null;
  let userDataDir = null;
  let staffUserId = null;

  // Resource IDs
  let custAlphaId = null;
  let srvAlphaId = null;
  let identAlphaId = null;
  let convAlphaId = null;
  let msgAlphaId = null;
  let compAlphaId = null;

  let custBetaId = null;
  let srvBetaId = null;
  let identBetaId = null;
  let convBetaId = null;
  let msgBetaId = null;

  let identGammaId = null;
  let convGammaId = null;
  let msgGammaId = null;

  const srvAlphaCode = `SRV-ALPHA-${runId}`;
  const srvBetaCode = `SRV-BETA-${runId}`;

  // Active intercept rules for CDP Fetch domain
  const activeInterceptRules = [];
  let completedPollingCyclesEvidence = [];
  let networkCorrelator = null;

  try {
    // 1. Environment & Target Identity Validation via Shared Pipeline (FAIL-CLOSED)
    console.log("\n--- [1] Validasi Lingkungan & Target Database Terisolasi ---");
    const staffEmail = `staff_lifecycle_${runId}@example.com`;
    const staffPassword = `P27Lifecycle!Pass_${runId}`;

    const setupResult = await executeRunnerSetupPipeline(
      {
        HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
        HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
        HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
        HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
      },
      {
        createUser: async (sb) => {
          console.log(`[Setup] Membuat user staf pengujian: ${staffEmail}`);
          const { data: userData, error: userError } = await sb.auth.admin.createUser({
            email: staffEmail,
            password: staffPassword,
            email_confirm: true,
            user_metadata: { role: "staff", displayName: `Staf Lifecycle ${runId}` },
          });
          if (userError || !userData?.user) {
            throw new Error(`Gagal membuat user staf: ${userError?.message || "No user data"}`);
          }
          return userData.user.id;
        },
      }
    );

    testConfig = setupResult.testConfig;
    pool = setupResult.pool;
    supabaseAdmin = setupResult.supabaseAdmin;
    staffUserId = setupResult.staffUserId;
    console.log("[Setup] Target database dan Supabase API terverifikasi identik & terisolasi.");

    // 3. Seed Fixtures
    console.log(`[Setup] Menyiapkan fixture percakapan Alpha, Beta, dan Gamma...`);
    const baseTime = new Date("2026-10-10T10:00:00Z");

    // --- Conversation Alpha (Verified Customer) ---
    custAlphaId = crypto.randomUUID();
    srvAlphaId = crypto.randomUUID();
    identAlphaId = crypto.randomUUID();
    convAlphaId = crypto.randomUUID();
    msgAlphaId = crypto.randomUUID();
    compAlphaId = crypto.randomUUID();

    tracker.recordCustomer(custAlphaId);
    tracker.recordService(srvAlphaId);
    tracker.recordIdentity(identAlphaId);
    tracker.recordConversation(convAlphaId);
    tracker.recordMessage(msgAlphaId);
    tracker.recordIngress(msgAlphaId);
    tracker.recordComplaint(compAlphaId);

    await pool.query(
      `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
       VALUES ($1, $2, 'active', $3, now(), now())`,
      [custAlphaId, `Pelanggan Alpha ${runId}`, `CUST-A-${runId}`]
    );
    await pool.query(
      `INSERT INTO public.services (id, customer_id, service_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Layanan Utama Alpha', 'active', now(), now())`,
      [srvAlphaId, custAlphaId, srvAlphaCode]
    );
    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Akun Alpha', $4, 'verified', now(), now(), now())`,
      [identAlphaId, `bot-${runId}`, `sender-a-${runId}`, custAlphaId]
    );
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $5, now(), now())`,
      [convAlphaId, identAlphaId, `bot-${runId}`, `chat-a-${runId}`, baseTime]
    );
    await pool.query(
      `INSERT INTO public.complaints (id, identity_id, service_id, category, status, is_primary, created_at, updated_at)
       VALUES ($1, $2, $3, 'connection_complaint', 'IN_PROGRESS', true, now(), now())`,
      [compAlphaId, identAlphaId, srvAlphaId]
    );
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Internet mati total di rumah.', $6, 'SHADOW', 1, false)`,
      [msgAlphaId, identAlphaId, `bot-${runId}`, `chat-a-${runId}`, `pmsg-a-${runId}`, baseTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, null, $6)`,
      [
        msgAlphaId,
        identAlphaId,
        convAlphaId,
        compAlphaId,
        JSON.stringify({ category: "KONEKSI_MATI", reason: "keyword_match" }),
        baseTime,
      ]
    );
    await pool.query(
      `INSERT INTO public.triage_assessments (message_id, decision, processing_result, created_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now())`,
      [
        msgAlphaId,
        JSON.stringify({
          evaluatedAt: baseTime.toISOString(),
          ruleVersion: "rule-p27-v1",
          outcome: "candidate",
          reason: "los_area",
          candidateTemplateKey: "LOS_AREA",
          effectiveTemplateKey: "LOS_AREA",
          incidentId: null,
          eventIds: ["EVT-HIST-01"],
          notes: ["LOS_RATIO_EXCEEDED"],
          automation: { mode: "SHADOW", disposition: "blocked", blockedReasons: ["shadow_mode"] },
          evidence: [
            { kind: "onu", status: "LOS", observedAt: baseTime.toISOString(), eventId: "EVT-HIST-01" },
            { kind: "area", scope: "ODP", scopeId: `ODP-A-${runId}`, total: 10, valid: 8, los: 4, coverage: 0.8, losRatio: 0.5 },
          ],
        }),
        JSON.stringify({
          claim: { outcome: "claimed", reason: "new_complaint", intentId: null },
          dispatchAuthorized: false,
        }),
      ]
    );

    // --- Conversation Beta (Verified Customer) ---
    custBetaId = crypto.randomUUID();
    srvBetaId = crypto.randomUUID();
    identBetaId = crypto.randomUUID();
    convBetaId = crypto.randomUUID();
    msgBetaId = crypto.randomUUID();

    tracker.recordCustomer(custBetaId);
    tracker.recordService(srvBetaId);
    tracker.recordIdentity(identBetaId);
    tracker.recordConversation(convBetaId);
    tracker.recordMessage(msgBetaId);
    tracker.recordIngress(msgBetaId);

    await pool.query(
      `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
       VALUES ($1, $2, 'active', $3, now(), now())`,
      [custBetaId, `Pelanggan Beta ${runId}`, `CUST-B-${runId}`]
    );
    await pool.query(
      `INSERT INTO public.services (id, customer_id, service_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Layanan Kantor Beta', 'active', now(), now())`,
      [srvBetaId, custBetaId, srvBetaCode]
    );
    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Akun Beta', $4, 'verified', now(), now(), now())`,
      [identBetaId, `bot-${runId}`, `sender-b-${runId}`, custBetaId]
    );
    const betaTime = new Date("2026-10-10T10:05:00Z");
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $5, now(), now())`,
      [convBetaId, identBetaId, `bot-${runId}`, `chat-b-${runId}`, betaTime]
    );
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Halo koneksi kantor lambat.', $6, 'SHADOW', 1, false)`,
      [msgBetaId, identBetaId, `bot-${runId}`, `chat-b-${runId}`, `pmsg-b-${runId}`, betaTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [msgBetaId, identBetaId, convBetaId, JSON.stringify({ category: "KONEKSI_LAMBAT", reason: "keyword_match" }), betaTime]
    );

    // --- Conversation Gamma (Unverified Customer) ---
    identGammaId = crypto.randomUUID();
    convGammaId = crypto.randomUUID();
    msgGammaId = crypto.randomUUID();

    tracker.recordIdentity(identGammaId);
    tracker.recordConversation(convGammaId);
    tracker.recordMessage(msgGammaId);
    tracker.recordIngress(msgGammaId);

    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Akun Gamma (Unverified)', null, 'unverified', now(), now())`,
      [identGammaId, `bot-${runId}`, `sender-g-${runId}`]
    );
    const gammaTime = new Date("2026-10-10T10:10:00Z");
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $5, now(), now())`,
      [convGammaId, identGammaId, `bot-${runId}`, `chat-g-${runId}`, gammaTime]
    );
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Nomor pelanggan belum ada.', $6, 'SHADOW', 1, false)`,
      [msgGammaId, identGammaId, `bot-${runId}`, `chat-g-${runId}`, `pmsg-g-${runId}`, gammaTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [msgGammaId, identGammaId, convGammaId, JSON.stringify({ category: "GENERAL", reason: "keyword_match" }), gammaTime]
    );

    // 4. Launch Next.js Server
    const nextPort = await findAvailablePort(3370);
    const BASE_URL = `http://127.0.0.1:${nextPort}`;
    console.log(`[Setup] Menjalankan server Next.js pada port ${nextPort}...`);

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

    // 5. Launch Chrome Headless (1600x1000 for Desktop 3rd column Evidence Panel)
    const chromePort = await findAvailablePort(9245);
    userDataDir = path.join(
      process.env.TEMP || "C:\\Users\\INVANSION\\AppData\\Local\\Temp",
      `chrome_p27_lifecycle_${runId}`
    );
    fs.mkdirSync(userDataDir, { recursive: true });

    console.log(`[Setup] Meluncurkan Chrome headless (remote debugging port ${chromePort})...`);
    chromeProc = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--window-size=1600,1000",
      "about:blank",
    ]);

    const wsUrl = await getWebSocketDebuggerUrl(chromePort);
    cdp = new CDPClient(wsUrl, {
      onAsyncError: (err) => {
        console.error("[CDP Event Dispatcher] Asynchronous error captured:", err.message);
        asyncFailureController.signal(err);
      },
    });
    await cdp.connect();

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");

    async function takeScreenshot(name) {
      const filename = `${name}.png`;
      const filepath = path.join(screenshotsDir, filename);
      const res = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(filepath, Buffer.from(res.data, "base64"));
      capturedScreenshots.push(filename);
      console.log(`    [Screenshot] Tersimpan: ${filename}`);
    }

    // 6. Login
    console.log("[Setup] Login staf pada aplikasi asli...");
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
    if (!loggedIn) {
      throw new Error("Gagal login staf ke /dashboard.");
    }
    await delay(1000);

    // Setup HTTP Request Interceptor using CDP Fetch domain
    console.log("\n--- [2] Inisialisasi Interceptor CDP Fetch ---");
    cdp.on("Fetch.requestPaused", async (params) => {
      const { requestId, request } = params;
      for (const rule of activeInterceptRules) {
        if (rule.match(request)) {
          await rule.handle(params);
          return;
        }
      }
      try {
        await cdp.send("Fetch.continueRequest", { requestId });
      } catch {}
    });

    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*api/inbox/*", requestStage: "Request" }],
    });

    // Inisialisasi pelacakan jaringan CDP Network untuk verifikasi response completion nyata
    networkCorrelator = new NetworkRequestCorrelator();

    cdp.on("Network.responseReceived", (p) => {
      networkCorrelator.onResponseReceived(p);
    });

    cdp.on("Network.loadingFinished", (p) => {
      networkCorrelator.onLoadingFinished(p);
    });

    cdp.on("Network.loadingFailed", (p) => {
      networkCorrelator.onLoadingFailed(p);
    });

    // Helper untuk menunggu penyelesaian jaringan nyata (HTTP 200 + loadingFinished)
    function waitForRequestCompletion(fetchParams, timeoutMs = 8000) {
      return networkCorrelator.waitForRequestCompletion(fetchParams, timeoutMs);
    }

    // Helper to fulfill a request with JSON response
    async function fulfillJson(requestId, responseCode, jsonBody) {
      const bodyBase64 = Buffer.from(JSON.stringify(jsonBody)).toString("base64");
      await cdp.send("Fetch.fulfillRequest", {
        requestId,
        responseCode,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Cache-Control", value: "no-store" },
        ],
        body: bodyBase64,
      });
    }

    // Harness Controlled Asynchronous Failure Mode (Early Failure)
    if (TEST_ASYNC_FAILURE) {
      console.log("\n>> [HARNESS] Menginjeksi kegagalan asynchronous terkendali (--test-async-failure) <<");
      console.log("       -> Menambahkan rule asynchronous yang sengaja melempar rejection pada jalur interception...");
      const failingRule = {
        match: (req) => req.url.includes("/api/inbox"),
        handle: async (params) => {
          await delay(50);
          throw new Error("Controlled async failure: Terjadi error jaringan asynchronous terkendali pada CDP event dispatcher (simulasi kegagalan runner)");
        },
      };
      activeInterceptRules.unshift(failingRule);
    }

    // Harness Controlled Asynchronous Failure Mode (Late Finalization Boundary)
    if (TEST_FINALIZATION_ASYNC_FAILURE) {
      console.log("\n>> [HARNESS] Menginjeksi kegagalan asynchronous menjelang finalisasi (--test-finalization-async-failure) <<");
      let handlerAttached = false;
      cdp.on("Network.responseReceived", async (p) => {
        if (!handlerAttached && p.response?.url?.includes("/api/inbox/conversations")) {
          handlerAttached = true;
          console.log("       -> [Harness] Async handler terdaftar di event dispatcher CDP, menunggu koordinasi sinyal finalisasi...");
          await finalizationSignalPromise;
          console.log("       -> [Harness] Sinyal batas finalisasi diterima! Melempar rejection asynchronous terlambat...");
          throw new Error("Late async failure at finalization boundary: Rejection asynchronous sengaja diinjeksi saat runner mulai menyelesaikan run");
        }
      });
    }

    // Helper to wait for DOM element
    async function waitForElement(selector, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const res = await cdp.send("Runtime.evaluate", {
          expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
          returnByValue: true,
        });
        if (res.result && res.result.value === true) return true;
        await delay(100);
      }
      throw new Error(`Timeout menunggu elemen: ${selector} (${timeoutMs}ms)`);
    }

    // Helper to wait for arbitrary boolean condition in page context
    async function waitForCondition(fnExpression, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const res = await cdp.send("Runtime.evaluate", {
          expression: fnExpression,
          returnByValue: true,
        });
        if (res.result && res.result.value) return res.result.value;
        await delay(100);
      }
      return false;
    }

    // Helper to click conversation card in DOM
    async function clickConversationCard(convId) {
      await waitForElement(`[data-conversation-id="${convId}"]`, 8000);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const item = document.querySelector('[data-conversation-id="${convId}"]');
          if (item) {
            item.click();
            return true;
          }
          return false;
        })()`,
      });
      await delay(200);
    }

    // Helper to click "Cek Ulang" network button in Evidence Panel
    async function clickRecheckButton() {
      await waitForElement('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]', 8000);
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const btn = document.querySelector('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })()`,
      });
      await delay(200);
    }

    // Helper to read Evidence Panel DOM scoped strictly to desktop evidence-column
    async function readEvidencePanelDOM() {
      const res = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const aside = document.querySelector('[data-testid="evidence-column"] aside');
          if (!aside) {
            return { found: false, text: '', isBusy: false };
          }
          const text = (aside.innerText && aside.innerText.trim().length > 0) ? aside.innerText : (aside.textContent || '');
          const isBusy = aside.getAttribute('aria-busy') === 'true';
          const hasErrorHeading = text.includes('Gagal memuat konteks percakapan') || text.includes('Gagal memeriksa jaringan');
          const hasRetryBtn = Boolean(Array.from(aside.querySelectorAll('button')).find(b => {
            const bText = b.innerText || b.textContent || '';
            return bText.includes('Coba lagi');
          }));
          return {
            found: true,
            isBusy,
            text,
            hasErrorHeading,
            hasRetryBtn,
          };
        })()`,
        returnByValue: true,
      });
      return res.result.value || {};
    }

    // =========================================================================
    // SCENARIO 1: Respons Konteks Tidak Berurutan (A -> B -> A & Kunjungan Sama)
    // =========================================================================
    console.log("\n>> [Skenario 1] Respons Konteks Tidak Berurutan (Kunjungan Sama & A → B → A) <<");
    {
      console.log("  [1a] Menguji dua request konteks pada kunjungan percakapan yang sama (Conversation Alpha)...");
      let heldReqA_old = null;
      let capturedReqA_new = null;

      const rule1a = {
        match: (req) => req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) && req.method === "GET",
        handle: (params) => {
          if (!heldReqA_old) {
            heldReqA_old = params;
            console.log(`       -> Request konteks lama (A_old) ditahan: ID=${params.requestId}`);
          } else {
            capturedReqA_new = params;
            console.log(`       -> Request konteks terbaru (A_new) tertangkap dari polling: ID=${params.requestId}`);
          }
        },
      };
      activeInterceptRules.unshift(rule1a);

      // Klik percakapan Alpha -> memicu foreground detail & foreground context (heldReqA_old)
      await clickConversationCard(convAlphaId);
      for (let i = 0; i < 30 && !heldReqA_old; i++) await delay(100);
      if (!heldReqA_old) {
        throw new Error("Skenario 1a gagal: Request konteks pertama (A_old) tidak tertangkap!");
      }

      // Tunggu background polling dari komponen (~5000ms) memicu fetchConversationContext(convAlphaId, true)
      console.log("       -> Menunggu polling siklus background memicu request konteks kedua pada kunjungan yang sama...");
      for (let i = 0; i < 80 && !capturedReqA_new; i++) await delay(100);
      if (!capturedReqA_new) {
        throw new Error("Skenario 1a gagal: Request konteks kedua (A_new) dari polling tidak tertangkap!");
      }

      // Hapus aturan intercept 1a
      const idx1a = activeInterceptRules.indexOf(rule1a);
      if (idx1a !== -1) activeInterceptRules.splice(idx1a, 1);

      // Urutan pelepasan:
      // LANGKAH 1: Selesaikan request TERBARU (A_new) terlebih dahulu dengan label unik
      const newerLabel = `SRV-ALPHA-SAMEVISIT-NEW-${runId}`;
      console.log(`       -> Melepaskan respons TERBARU (A_new) terlebih dahulu dengan label: ${newerLabel}`);
      await fulfillJson(capturedReqA_new.requestId, 200, {
        success: true,
        data: {
          conversationId: convAlphaId,
          sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
          customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
          service: { id: srvAlphaId, serviceCode: newerLabel, status: "active" },
          topology: { odpCode: "ODP-A-NEW", odcCode: "ODC-A-NEW", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
          identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
          candidateServices: [],
          historicalAssessment: null,
          activeIncident: null,
        },
      });
      await delay(400);

      // Pastikan konteks TERBARU sudah tampil di DOM
      let dom1a = await readEvidencePanelDOM();
      const newerRenderedFirst = dom1a.text.includes(newerLabel);

      // LANGKAH 2: Lepaskan respons LAMA (A_old) dengan penanda lama
      const staleLabel = `SRV-ALPHA-SAMEVISIT-OLD-${runId}`;
      console.log(`       -> Melepaskan respons LAMA (A_old) setelahnya dengan label: ${staleLabel}`);
      await fulfillJson(heldReqA_old.requestId, 200, {
        success: true,
        data: {
          conversationId: convAlphaId,
          sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
          customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
          service: { id: srvAlphaId, serviceCode: staleLabel, status: "active" },
          topology: { odpCode: "ODP-A-OLD", odcCode: "ODC-A-OLD", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
          identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
          candidateServices: [],
          historicalAssessment: null,
          activeIncident: null,
        },
      });
      await delay(400);

      // Pastikan konteks TERBARU TETAP tampil dan penanda respons LAMA TIDAK MUNCUL
      dom1a = await readEvidencePanelDOM();
      const newerPreserved = dom1a.text.includes(newerLabel);
      const staleRejectedSameVisit = !dom1a.text.includes(staleLabel);

      // --- Bagian 1b: Perpindahan percakapan A -> B -> A ---
      console.log("  [1b] Menguji reordering pada navigasi A → B → A...");
      const navRequests = [];
      const rule1b = {
        match: (req) => req.url.includes("/context") && req.method === "GET",
        handle: (params) => {
          navRequests.push(params);
        },
      };
      activeInterceptRules.unshift(rule1b);

      // Klik B
      await clickConversationCard(convBetaId);
      for (let i = 0; i < 30 && navRequests.length < 1; i++) await delay(100);
      const reqB_nav = navRequests[0];

      // Klik kembali ke A
      await clickConversationCard(convAlphaId);
      for (let i = 0; i < 30 && navRequests.length < 2; i++) await delay(100);
      const reqA_latest = navRequests[1];

      const idx1b = activeInterceptRules.indexOf(rule1b);
      if (idx1b !== -1) activeInterceptRules.splice(idx1b, 1);

      // Selesaikan B_nav saat aktif berada di A (pastikan B tidak bocor)
      const betaLabel = `SRV-BETA-LEAKTEST-${runId}`;
      await fulfillJson(reqB_nav.requestId, 200, {
        success: true,
        data: {
          conversationId: convBetaId,
          sender: { verificationStatus: "verified", displayName: "Akun Beta" },
          customer: { displayName: `Pelanggan Beta ${runId}`, id: custBetaId },
          service: { id: srvBetaId, serviceCode: betaLabel, status: "active" },
          topology: { odpCode: "ODP-B", odcCode: "ODC-B", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
          identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
          candidateServices: [],
          historicalAssessment: null,
          activeIncident: null,
        },
      });
      await delay(200);

      // Selesaikan A_latest terlebih dahulu
      const aLatestLabel = `SRV-ALPHA-NAV-LATEST-${runId}`;
      await fulfillJson(reqA_latest.requestId, 200, {
        success: true,
        data: {
          conversationId: convAlphaId,
          sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
          customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
          service: { id: srvAlphaId, serviceCode: aLatestLabel, status: "active" },
          topology: { odpCode: "ODP-A", odcCode: "ODC-A", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
          identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
          candidateServices: [],
          historicalAssessment: null,
          activeIncident: null,
        },
      });
      await delay(300);

      let dom1b = await readEvidencePanelDOM();
      const bDidNotLeak = !dom1b.text.includes(betaLabel);
      const aLatestApplied = dom1b.text.includes(aLatestLabel);

      await takeScreenshot("01_ui_lifecycle_reordered_context");

      const scenario1Pass = newerRenderedFirst && newerPreserved && staleRejectedSameVisit && bDidNotLeak && aLatestApplied;
      recordAssertion({
        id: "ui_lifecycle_stale_context_rejected_a_b_a",
        name: "Respons konteks lama ditolak pada percakapan A → B → A dan kunjungan yang sama",
        pass: scenario1Pass,
        expected: "newerRenderedFirst=true, newerPreserved=true, staleRejected=true, bDidNotLeak=true, aLatestApplied=true",
        actual: `newerFirst=${newerRenderedFirst}, newerPreserved=${newerPreserved}, staleRejected=${staleRejectedSameVisit}, bDidNotLeak=${bDidNotLeak}, aLatest=${aLatestApplied}`,
      });
    }

    // =========================================================================
    // SCENARIO 2: Foreground Lambat Bersamaan dengan Polling
    // =========================================================================
    console.log("\n>> [Skenario 2] Foreground Lambat Bersamaan dengan Polling <<");
    {
      let heldFgReq = null;
      let foregroundDetailFired = false;
      const capturedBackgroundPollingRequests = [];

      const rule2 = {
        match: (req) => {
          if (req.url.includes(`/api/inbox/conversations/${convGammaId}/context`) && req.method === "GET") {
            return true;
          }
          if (
            req.url.includes(`/api/inbox/conversations/${convGammaId}`) &&
            !req.url.includes("/network-check") &&
            !req.url.includes("/read") &&
            req.method === "GET"
          ) {
            return true;
          }
          return false;
        },
        handle: async (params) => {
          if (params.request.url.includes("/context") && !heldFgReq) {
            // Tahan foreground context request
            heldFgReq = params;
            console.log(`       -> Request foreground konteks ditahan: ID=${params.requestId}`);
          } else if (
            params.request.url.includes(`/api/inbox/conversations/${convGammaId}`) &&
            !params.request.url.includes("/context") &&
            !foregroundDetailFired
          ) {
            // Biarkan foreground detail request selesai agar isDetailForegroundLoadingRef.current = false
            foregroundDetailFired = true;
            console.log(`       -> Foreground detail selesai normal: ID=${params.requestId}`);
            try {
              await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
            } catch {}
          } else {
            // Ini adalah BACKGROUND POLLING dari komponen yang berjalan saat foreground masih tertahan!
            capturedBackgroundPollingRequests.push(params);
            console.log(`       -> Request background polling tertangkap: ID=${params.requestId} (url=${params.request.url})`);
          }
        },
      };
      activeInterceptRules.unshift(rule2);

      // Klik Gamma untuk memulai foreground fetch
      await clickConversationCard(convGammaId);
      for (let i = 0; i < 30 && !heldFgReq; i++) await delay(100);
      if (!heldFgReq) {
        throw new Error("Skenario 2 gagal: Request foreground konteks tidak tertangkap!");
      }

      // Pastikan DOM dalam keadaan loading / aria-busy
      let dom2 = await readEvidencePanelDOM();
      const foregroundIsBusy = dom2.isBusy || (await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside[aria-busy="true"]'))`,
        2000
      ));

      // Tunggu background polling dari komponen benar-benar terjadi saat foreground masih tertahan
      console.log("       -> Menunggu background polling komponen berjalan saat foreground masih tertahan...");
      for (let i = 0; i < 80 && capturedBackgroundPollingRequests.length < 1; i++) await delay(100);
      if (capturedBackgroundPollingRequests.length < 1) {
        throw new Error("Skenario 2 gagal: Background polling dari komponen tidak terjadi!");
      }

      const pollReq1 = capturedBackgroundPollingRequests[0];
      console.log(`       -> Menguji kegagalan polling pada request ID=${pollReq1.requestId} saat foreground masih in-flight...`);

      // Uji 2a: Polling gagal (HTTP 500) saat foreground masih berlangsung
      await fulfillJson(pollReq1.requestId, 500, {
        success: false,
        error: { code: "SERVER_ERROR", message: "Simulasi kegagalan server polling 500" },
      });
      await delay(400);

      // Verifikasi banner polling error muncul di DOM saat foreground masih loading
      const pollingErrorBannerVisible = await waitForCondition(
        `(() => {
          const banner = document.querySelector('[role="alert"]') || document.body;
          return banner.textContent.includes("Pembaruan terhenti");
        })()`,
        4000
      );

      // Verifikasi tombol retry "Coba lagi" tersedia di banner [role="alert"]
      const retryButtonAvailable = await waitForCondition(
        `(() => {
          const btn = document.querySelector('[role="alert"] button');
          return Boolean(btn && (btn.innerText || btn.textContent || '').includes('Coba lagi'));
        })()`,
        3000
      );

      // Uji 2b: Selesaikan foreground request yang ditahan dengan data valid
      console.log(`       -> Melepaskan foreground request yang ditahan: ID=${heldFgReq.requestId}`);
      await fulfillJson(heldFgReq.requestId, 200, {
        success: true,
        data: {
          conversationId: convGammaId,
          sender: {
            id: identGammaId,
            senderExternalId: `sender-g-${runId}`,
            displayName: "Akun Gamma (Unverified)",
            verificationStatus: "unverified",
            verifiedAt: null,
          },
          identityResolution: { outcome: "unresolved", reason: "unverified", ruleVersion: "v1.0" },
          customer: null,
          service: null,
          candidateServices: [],
          topology: null,
          historicalAssessment: null,
          activeIncident: null,
        },
      });
      await delay(500);

      // Pastikan semua sisa request background polling pada rule 2 dilanjutkan agar polling loop tidak terhambat!
      for (const p of capturedBackgroundPollingRequests) {
        if (p.requestId !== pollReq1.requestId) {
          try {
            await cdp.send("Fetch.continueRequest", { requestId: p.requestId });
          } catch {}
        }
      }

      // Hapus aturan intercept skenario 2 awal
      const idx2 = activeInterceptRules.indexOf(rule2);
      if (idx2 !== -1) activeInterceptRules.splice(idx2, 1);

      // Uji 2c: Isolasi polling otomatis selama pembuktian retry
      console.log("       -> Mengisolasi background polling otomatis via document.hidden sebelum menguji klik retry...");
      await cdp.send("Runtime.evaluate", {
        expression: "Object.defineProperty(document, 'hidden', { value: true, configurable: true, writable: true });",
      });
      await delay(200);

      let retryListRequest = null;
      let retryDetailRequest = null;
      let clickRetryTriggered = false;

      const retryRule = {
        match: (req) =>
          req.url.includes("/api/inbox/conversations") &&
          !req.url.includes("/network-check") &&
          !req.url.includes("/read") &&
          req.method === "GET",
        handle: async (params) => {
          if (!clickRetryTriggered) {
            console.warn(`[RetryRule] Meneruskan request sebelum klik retry dieksekusi: ${params.request.url}`);
            try { await cdp.send("Fetch.continueRequest", { requestId: params.requestId }); } catch {}
            return;
          }

          const url = params.request.url;
          if (url.includes(`/api/inbox/conversations/${convGammaId}`)) {
            retryDetailRequest = params;
            console.log(`       -> [Retry 2/2] Request detail pemulihan tertangkap: ID=${params.requestId}`);
            await fulfillJson(params.requestId, 200, {
              success: true,
              data: {
                id: convGammaId,
                channel: "telegram",
                accountId: `bot-${runId}`,
                chatId: `chat-g-${runId}`,
                status: "active",
                startedAt: baseTime.toISOString(),
                lastActivityAt: baseTime.toISOString(),
                sender: {
                  id: identGammaId,
                  senderExternalId: `sender-g-${runId}`,
                  displayName: "Akun Gamma (Unverified)",
                  verificationStatus: "unverified",
                },
                latestEpisode: null,
                unreadCount: 0,
                isUnread: false,
                needsReview: false,
                messages: [],
              },
            });
          } else {
            retryListRequest = params;
            console.log(`       -> [Retry 1/2] Request list pemulihan tertangkap: ID=${params.requestId}`);
            await fulfillJson(params.requestId, 200, {
              success: true,
              data: {
                items: [],
                totalCount: 3,
                page: 1,
                pageSize: 20,
                totalPages: 1,
              },
            });
          }
        },
      };
      activeInterceptRules.unshift(retryRule);

      // Verifikasi bahwa sebelum klik, request pemulihan masih null
      if (retryListRequest !== null || retryDetailRequest !== null) {
        throw new Error("Skenario 2 gagal: Request pemulihan sudah ada sebelum tombol retry diklik!");
      }

      console.log("       -> Mengklik tombol 'Coba lagi' pada banner [role='alert'] button...");
      clickRetryTriggered = true;
      const clickResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const btn = document.querySelector('[role="alert"] button');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })()`,
        returnByValue: true,
      });
      if (!clickResult?.result?.value) {
        throw new Error("Skenario 2 gagal: Tombol retry [role='alert'] button tidak ditemukan atau gagal diklik!");
      }

      // Tunggu hingga request pemulihan list tertangkap (dipicu oleh klik)
      for (let i = 0; i < 50 && !retryListRequest; i++) await delay(100);
      if (!retryListRequest) {
        throw new Error("Skenario 2 gagal: Tombol retry diklik tetapi request list pemulihan tidak tertangkap!");
      }

      // Tunggu hingga request pemulihan detail tertangkap (dipicu setelah list selesai)
      for (let i = 0; i < 50 && !retryDetailRequest; i++) await delay(100);
      if (!retryDetailRequest) {
        throw new Error("Skenario 2 gagal: Request list selesai tetapi request detail pemulihan tidak tertangkap!");
      }

      // Tunggu hingga banner error polling hilang dari DOM
      const pollingErrorBannerDismissed = await waitForCondition(
        `!Boolean(document.querySelector('[role="alert"]'))`,
        6000
      );

      const idxRetry = activeInterceptRules.indexOf(retryRule);
      if (idxRetry !== -1) activeInterceptRules.splice(idxRetry, 1);

      // Pulihkan document.hidden agar polling otomatis kembali normal untuk skenario berikutnya
      console.log("       -> Memulihkan polling otomatis (document.hidden = false)...");
      await cdp.send("Runtime.evaluate", {
        expression: "Object.defineProperty(document, 'hidden', { value: false, configurable: true, writable: true });",
      });
      await delay(200);

      // Verifikasi konteks akhir tampil di DOM dan loading selesai
      dom2 = await readEvidencePanelDOM();
      const loadingCompleteAfterRetry = !dom2.isBusy;
      const finalContextRendered = !dom2.isBusy && dom2.text.includes("Belum Terverifikasi");

      await takeScreenshot("02_ui_lifecycle_slow_fg_polling");

      const scenario2Pass =
        foregroundIsBusy &&
        capturedBackgroundPollingRequests.length >= 1 &&
        pollingErrorBannerVisible &&
        retryButtonAvailable &&
        Boolean(retryListRequest) &&
        Boolean(retryDetailRequest) &&
        pollingErrorBannerDismissed &&
        loadingCompleteAfterRetry &&
        finalContextRendered;

      recordAssertion({
        id: "ui_lifecycle_slow_foreground_with_polling_consistent",
        name: "Foreground lambat bersamaan dengan polling (dua request tertangkap, polling gagal, banner muncul, polling diisolasi, klik retry wajib memicu rangkaian pemulihan list & detail, banner hilang, konteks konsisten)",
        pass: scenario2Pass,
        expected: "fgBusy=true, pollCaptured>=1, errBannerBefore=true, retryBtn=true, listCap=true, detailCap=true, bannerDismissed=true, loadingEnd=true, finalContext=true",
        actual: `fgBusy=${foregroundIsBusy}, pollCaptured=${capturedBackgroundPollingRequests.length}, bannerBefore=${pollingErrorBannerVisible}, retryBtn=${retryButtonAvailable}, listCap=${Boolean(retryListRequest)}, detailCap=${Boolean(retryDetailRequest)}, bannerDismissed=${pollingErrorBannerDismissed}, loadingEnd=${loadingCompleteAfterRetry}, finalContext=${finalContextRendered}`,
      });
    }

    // =========================================================================
    // SCENARIO 3: Pemeriksaan Jaringan Tertunda Saat Layanan Berubah (A → B dan A → B → A)
    // =========================================================================
    console.log("\n>> [Skenario 3] Pemeriksaan Jaringan Tertunda Saat Layanan Berubah (A → B & A → B → A) <<");
    {
      // Pastikan Layanan A aktif dan tampil di DOM terlebih dahulu
      await clickConversationCard(convAlphaId);
      await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${srvAlphaCode}"))`,
        8000
      );
      await waitForElement('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]', 8000);

      // --- Bagian 3a: Bukti A → B (pemeriksaan dimulai di A, beralih ke B, respon A ditolak di B) ---
      console.log("  [3a] Menguji penolakan request pemeriksaan pada peralihan A → B...");
      let heldCheckReqA_toB = null;
      const checkRuleA_toB = {
        match: (req) => req.url.includes("/network-check") && req.method === "POST",
        handle: (params) => {
          heldCheckReqA_toB = params;
        },
      };
      activeInterceptRules.unshift(checkRuleA_toB);

      console.log("       -> Mengklik Cek Ulang untuk Layanan A (request 3a ditahan)...");
      await clickRecheckButton();
      for (let i = 0; i < 30 && !heldCheckReqA_toB; i++) await delay(100);
      if (!heldCheckReqA_toB) {
        throw new Error("Skenario 3a gagal: Request pemeriksaan jaringan A tidak tertangkap!");
      }
      const idxCheck3a = activeInterceptRules.indexOf(checkRuleA_toB);
      if (idxCheck3a !== -1) activeInterceptRules.splice(idxCheck3a, 1);

      // Ubah konteks layanan ke Layanan B via context poll
      const serviceBCode = `SRV-ALPHA-SWITCHED-TO-B-${runId}`;
      let capturedPollToB = null;
      const pollToBRule = {
        match: (req) =>
          (req.url.includes(`/api/inbox/conversations/${convAlphaId}`) || req.url.includes("/api/inbox/conversations")) &&
          !req.url.includes("/network-check") &&
          !req.url.includes("/read") &&
          req.method === "GET",
        handle: async (params) => {
          if (params.request.url.includes("/context")) {
            capturedPollToB = params;
            await fulfillJson(params.requestId, 200, {
              success: true,
              data: {
                conversationId: convAlphaId,
                sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
                customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
                service: { id: srvBetaId, serviceCode: serviceBCode, status: "active" },
                topology: { odpCode: "ODP-B-SWITCH", odcCode: "ODC-B-SWITCH", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
                identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
                candidateServices: [],
                historicalAssessment: null,
                activeIncident: null,
              },
            });
          } else {
            try {
              await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
            } catch {}
          }
        },
      };
      activeInterceptRules.unshift(pollToBRule);

      for (let i = 0; i < 180 && !capturedPollToB; i++) await delay(100);
      if (!capturedPollToB) {
        throw new Error("Skenario 3a gagal: Polling konteks untuk Layanan B tidak tertangkap!");
      }
      const idxPollB = activeInterceptRules.indexOf(pollToBRule);
      if (idxPollB !== -1) activeInterceptRules.splice(idxPollB, 1);

      // Pastikan Layanan B SUDAH TAMPIL di DOM sebelum respons A dilepas
      const serviceBRenderedBeforeRelease = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${serviceBCode}"))`,
        8000
      );
      if (!serviceBRenderedBeforeRelease) {
        throw new Error("Skenario 3a gagal: Layanan B tidak tampil di DOM sebelum pelepasan respons!");
      }

      // Lepaskan respons A1 saat aktif di B
      const staleMarkerA1 = `STALE-CHECK-SNAPSHOT-A1-${runId}`;
      console.log(`       -> Melepaskan respons A1 (ID=${heldCheckReqA_toB.requestId}) dengan marker: ${staleMarkerA1}`);
      await fulfillJson(heldCheckReqA_toB.requestId, 200, {
        success: true,
        data: {
          serviceId: srvAlphaId,
          outcome: "ok",
          checkedAt: new Date().toISOString(),
          source: "mock",
          onu: { status: "LOS", quality: "usable", reportedStatus: staleMarkerA1, observedAt: new Date().toISOString() },
          upstream: [],
          areas: [],
        },
      });
      await delay(400);

      let dom3 = await readEvidencePanelDOM();
      const staleMarkerRejectedInB = !dom3.text.includes(staleMarkerA1);
      const activeServiceRemainedB = dom3.text.includes(serviceBCode);

      // --- Bagian 3b: Skenario Delayed Network Check A → B → A dalam percakapan yang sama ---
      console.log("  [3b] Menguji delayed network check A → B → A (respon awal A dilepas setelah kembali ke A)...");

      // 1. Kembalikan konteks ke Layanan A dan pastikan aktif di DOM
      let returnedToContextA = null;
      const pollBackToARule = {
        match: (req) => req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) && req.method === "GET",
        handle: async (params) => {
          returnedToContextA = params;
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: {
              conversationId: convAlphaId,
              sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
              customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
              service: { id: srvAlphaId, serviceCode: srvAlphaCode, status: "active" },
              topology: { odpCode: "ODP-A", odcCode: "ODC-A", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
              identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
              candidateServices: [],
              historicalAssessment: null,
              activeIncident: null,
            },
          });
        },
      };
      activeInterceptRules.unshift(pollBackToARule);
      for (let i = 0; i < 180 && !returnedToContextA; i++) await delay(100);
      const idxPollBackA = activeInterceptRules.indexOf(pollBackToARule);
      if (idxPollBackA !== -1) activeInterceptRules.splice(idxPollBackA, 1);

      // Pastikan Layanan A aktif dan tampil di DOM
      const serviceAActiveInDOM = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${srvAlphaCode}"))`,
        8000
      );
      if (!serviceAActiveInDOM) {
        throw new Error("Skenario 3b gagal: Layanan A tidak aktif di DOM sebelum memulai check A!");
      }

      // 2. Jalankan pemeriksaan A, tangkap request tersebut, lalu tahan responsnya
      let heldInitialCheckReqA = null;
      const checkRuleA2 = {
        match: (req) => req.url.includes("/network-check") && req.method === "POST",
        handle: (params) => {
          heldInitialCheckReqA = params;
        },
      };
      activeInterceptRules.unshift(checkRuleA2);

      console.log("       -> Menjalankan pemeriksaan A awal (request 3b ditahan)...");
      await clickRecheckButton();
      for (let i = 0; i < 30 && !heldInitialCheckReqA; i++) await delay(100);
      if (!heldInitialCheckReqA) {
        throw new Error("Skenario 3b gagal: Request pemeriksaan A awal tidak tertangkap!");
      }
      const idxCheckA2 = activeInterceptRules.indexOf(checkRuleA2);
      if (idxCheckA2 !== -1) activeInterceptRules.splice(idxCheckA2, 1);
      console.log(`       -> Request pemeriksaan A awal ditahan: ID=${heldInitialCheckReqA.requestId}`);

      // 3. Ubah konteks menjadi Layanan B dan pastikan B sudah tampil
      console.log("       -> Mengubah konteks ke Layanan B melalui polling...");
      let capturedPollB2 = null;
      const pollToB2Rule = {
        match: (req) => req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) && req.method === "GET",
        handle: async (params) => {
          capturedPollB2 = params;
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: {
              conversationId: convAlphaId,
              sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
              customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
              service: { id: srvBetaId, serviceCode: serviceBCode, status: "active" },
              topology: { odpCode: "ODP-B-SWITCH", odcCode: "ODC-B-SWITCH", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
              identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
              candidateServices: [],
              historicalAssessment: null,
              activeIncident: null,
            },
          });
        },
      };
      activeInterceptRules.unshift(pollToB2Rule);
      for (let i = 0; i < 180 && !capturedPollB2; i++) await delay(100);
      const idxPollB2 = activeInterceptRules.indexOf(pollToB2Rule);
      if (idxPollB2 !== -1) activeInterceptRules.splice(idxPollB2, 1);

      const serviceBRenderedABA = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${serviceBCode}"))`,
        8000
      );
      if (!serviceBRenderedABA) {
        throw new Error("Skenario 3b gagal: Layanan B tidak tampil di DOM pada peralihan A → B!");
      }

      // 4. Kembalikan konteks menjadi Layanan A dengan service ID awal yang sama, lalu pastikan A sudah tampil
      // (PENTING: Jangan membuat request network-check baru sebelum respons A awal dilepas!)
      console.log("       -> Mengembalikan konteks ke Layanan A (service ID awal) tanpa membuat request check baru...");
      let returnedToContextA2 = null;
      const pollBackToA2Rule = {
        match: (req) => req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) && req.method === "GET",
        handle: async (params) => {
          returnedToContextA2 = params;
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: {
              conversationId: convAlphaId,
              sender: { verificationStatus: "verified", displayName: "Akun Alpha" },
              customer: { displayName: `Pelanggan Alpha ${runId}`, id: custAlphaId },
              service: { id: srvAlphaId, serviceCode: srvAlphaCode, status: "active" },
              topology: { odpCode: "ODP-A", odcCode: "ODC-A", mappingVersion: 1, source: "mock", validFrom: baseTime.toISOString() },
              identityResolution: { outcome: "resolved", reason: "direct_match", ruleVersion: "v1.0" },
              candidateServices: [],
              historicalAssessment: null,
              activeIncident: null,
            },
          });
        },
      };
      activeInterceptRules.unshift(pollBackToA2Rule);
      for (let i = 0; i < 180 && !returnedToContextA2; i++) await delay(100);
      const idxPollBackA2 = activeInterceptRules.indexOf(pollBackToA2Rule);
      if (idxPollBackA2 !== -1) activeInterceptRules.splice(idxPollBackA2, 1);

      const serviceAReRenderedABA = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${srvAlphaCode}"))`,
        8000
      );
      if (!serviceAReRenderedABA) {
        throw new Error("Skenario 3b gagal: Layanan A tidak tampil di DOM pada pengembalian B → A!");
      }

      // 5. BARU LEPASKAN respons request A awal dengan penanda snapshot unik
      const staleMarkerInitialA = `STALE-CHECK-SNAPSHOT-ABA-${runId}`;
      console.log(`       -> Melepaskan respons request A awal (ID=${heldInitialCheckReqA.requestId}) dengan penanda unik: ${staleMarkerInitialA}...`);
      await fulfillJson(heldInitialCheckReqA.requestId, 200, {
        success: true,
        data: {
          serviceId: srvAlphaId,
          outcome: "ok",
          checkedAt: new Date().toISOString(),
          source: "mock",
          onu: { status: "LOS", quality: "usable", reportedStatus: staleMarkerInitialA, observedAt: new Date().toISOString() },
          upstream: [],
          areas: [],
        },
      });
      await delay(400);

      // 6. Pastikan snapshot lama tidak diterapkan dan konteks aktif tetap benar
      dom3 = await readEvidencePanelDOM();
      const staleMarkerRejectedInABA = !dom3.text.includes(staleMarkerInitialA);
      const activeContextRemainedInABA = dom3.text.includes(srvAlphaCode);

      // 7. Setelah itu, jalankan pemeriksaan A baru sebagai kontrol positif dan buktikan hasil sah tampil
      console.log("       -> Menjalankan pemeriksaan A baru sebagai kontrol positif...");
      let legitCheckReq = null;
      const legitRule = {
        match: (req) => req.url.includes("/network-check") && req.method === "POST",
        handle: (params) => {
          legitCheckReq = params;
        },
      };
      activeInterceptRules.unshift(legitRule);

      await clickRecheckButton();
      for (let i = 0; i < 30 && !legitCheckReq; i++) await delay(100);
      if (!legitCheckReq) {
        throw new Error("Skenario 3b gagal: Request kontrol positif pemeriksaan A baru tidak tertangkap!");
      }

      const idxLegit = activeInterceptRules.indexOf(legitRule);
      if (idxLegit !== -1) activeInterceptRules.splice(idxLegit, 1);

      const legitMarker = `LEGIT-POSITIVE-CONTROL-${runId}`;
      await fulfillJson(legitCheckReq.requestId, 200, {
        success: true,
        data: {
          serviceId: srvAlphaId,
          outcome: "ok",
          checkedAt: new Date().toISOString(),
          source: "mock",
          onu: { status: "online", quality: "usable", reportedStatus: legitMarker, observedAt: new Date().toISOString() },
          upstream: [],
          areas: [],
        },
      });
      await delay(400);

      dom3 = await readEvidencePanelDOM();
      const positiveControlRendered = dom3.text.includes(legitMarker);

      await takeScreenshot("03_ui_lifecycle_delayed_check_rejected");

      const scenario3Pass =
        serviceBRenderedBeforeRelease &&
        staleMarkerRejectedInB &&
        activeServiceRemainedB &&
        serviceAActiveInDOM &&
        serviceBRenderedABA &&
        serviceAReRenderedABA &&
        staleMarkerRejectedInABA &&
        activeContextRemainedInABA &&
        positiveControlRendered &&
        dom3.found;

      recordAssertion({
        id: "ui_lifecycle_delayed_network_check_rejected_on_service_change",
        name: "Pemeriksaan jaringan tertunda ditolak saat layanan berubah (bukti A → B, bukti A → B → A tanpa request pengganti, & kontrol positif sah)",
        pass: scenario3Pass,
        expected: "bBefore=true, staleRejB=true, actB=true, bRenderedABA=true, aRenderedABA=true, staleRejABA=true, actA=true, positiveCtrl=true",
        actual: `bBefore=${serviceBRenderedBeforeRelease}, staleRejB=${staleMarkerRejectedInB}, actB=${activeServiceRemainedB}, bABA=${serviceBRenderedABA}, aABA=${serviceAReRenderedABA}, staleABA=${staleMarkerRejectedInABA}, actA=${activeContextRemainedInABA}, posCtrl=${positiveControlRendered}`,
      });
    }

    // =========================================================================
    // SCENARIO 4: Sinkronisasi Assessment dan Perubahan Layanan
    // =========================================================================
    console.log("\n>> [Skenario 4] Sinkronisasi Assessment & Perubahan Layanan (Dua Kasus Terpisah) <<");
    {
      await clickConversationCard(convAlphaId);
      await waitForElement('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]', 8000);

      // Pastikan kondisi awal DOM Alpha
      let dom4Before = await readEvidencePanelDOM();

      // --- Kasus 4a: Assessment berubah HANYA pada field selain reason ---
      // Baseline diambil langsung dari respons API aktual (termasuk classification lengkap dengan ruleVersion 'unknown')
      console.log("       -> Mengambil baseline detail & context aktual langsung dari aplikasi...");
      const actualBaselineDetailRes = await cdp.send("Runtime.evaluate", {
        expression: `fetch('/api/inbox/conversations/${convAlphaId}').then(r => r.json())`,
        awaitPromise: true,
        returnByValue: true,
      });
      const actualBaselineDetail = actualBaselineDetailRes?.result?.value?.data;

      const actualBaselineContextRes = await cdp.send("Runtime.evaluate", {
        expression: `fetch('/api/inbox/conversations/${convAlphaId}/context').then(r => r.json())`,
        awaitPromise: true,
        returnByValue: true,
      });
      const actualBaselineContext = actualBaselineContextRes?.result?.value?.data;

      if (!actualBaselineDetail || !actualBaselineContext) {
        throw new Error("Skenario 4 gagal: Tidak dapat mengambil baseline detail atau context aktual dari API!");
      }

      console.log("  [4a] Menguji isolasi perubahan assessment pada field non-reason (decision.mode & incidentId)...");
      const updatedIncidentId = `INC-NON-REASON-${runId}`;

      // Buat payload 4a detail: klon dari actualBaselineDetail, mutasi HANYA pada valid field InboxTriageAssessmentSummary (decision.mode)
      const payload4aDetail = JSON.parse(JSON.stringify(actualBaselineDetail));
      const targetDetailMsg = payload4aDetail.messages[0];
      if (!targetDetailMsg || !targetDetailMsg.triageAssessment?.decision) {
        throw new Error("Skenario 4 gagal: target message atau triageAssessment tidak ditemukan pada baseline detail aktual!");
      }
      targetDetailMsg.triageAssessment.decision.mode = "FULL";

      // Buat payload 4a context: klon dari actualBaselineContext, mutasi pada historicalAssessment
      const payload4aContext = JSON.parse(JSON.stringify(actualBaselineContext));
      if (!payload4aContext.historicalAssessment) {
        throw new Error("Skenario 4 gagal: historicalAssessment tidak ditemukan pada baseline context aktual!");
      }
      payload4aContext.historicalAssessment.incidentId = updatedIncidentId;
      payload4aContext.historicalAssessment.automation.mode = "FULL";
      payload4aContext.historicalAssessment.automation.disposition = "allowed";
      payload4aContext.historicalAssessment.automation.blockedReasons = [];

      // Buktikan field lain strictly preserved terhadap baseline aktual
      const nonReasonDetailIsolated =
        payload4aDetail.id === actualBaselineDetail.id &&
        payload4aDetail.lastActivityAt === actualBaselineDetail.lastActivityAt &&
        payload4aDetail.latestEpisode?.id === actualBaselineDetail.latestEpisode?.id &&
        payload4aDetail.latestEpisode?.serviceId === actualBaselineDetail.latestEpisode?.serviceId &&
        payload4aDetail.sender?.id === actualBaselineDetail.sender?.id &&
        payload4aDetail.messages.length === actualBaselineDetail.messages.length &&
        payload4aDetail.messages[0].id === actualBaselineDetail.messages[0].id &&
        payload4aDetail.messages[0].classification.category === actualBaselineDetail.messages[0].classification.category &&
        payload4aDetail.messages[0].classification.reason === actualBaselineDetail.messages[0].classification.reason &&
        payload4aDetail.messages[0].classification.ruleVersion === actualBaselineDetail.messages[0].classification.ruleVersion &&
        payload4aDetail.messages[0].triageAssessment.decision.reason === actualBaselineDetail.messages[0].triageAssessment.decision.reason &&
        payload4aDetail.messages[0].triageAssessment.decision.mode === "FULL" &&
        actualBaselineDetail.messages[0].triageAssessment.decision.mode !== "FULL";

      const nonReasonContextIsolated =
        payload4aContext.conversationId === actualBaselineContext.conversationId &&
        payload4aContext.service?.id === actualBaselineContext.service?.id &&
        payload4aContext.sender?.id === actualBaselineContext.sender?.id &&
        payload4aContext.historicalAssessment.messageId === actualBaselineContext.historicalAssessment.messageId &&
        payload4aContext.historicalAssessment.reason === actualBaselineContext.historicalAssessment.reason &&
        payload4aContext.historicalAssessment.incidentId === updatedIncidentId &&
        actualBaselineContext.historicalAssessment.incidentId !== updatedIncidentId;

      const nonReasonPayloadIsolated = nonReasonDetailIsolated && nonReasonContextIsolated;
      const initialDomLacksNewIncident = !dom4Before.text.includes(updatedIncidentId);

      const detailRule4a = {
        match: (req) =>
          req.url.includes(`/api/inbox/conversations/${convAlphaId}`) &&
          !req.url.includes("/context") &&
          !req.url.includes("/read") &&
          !req.url.includes("/network-check") &&
          req.method === "GET",
        handle: async (params) => {
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: payload4aDetail,
          });
        },
      };

      const contextRule4a = {
        match: (req) =>
          req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) &&
          req.method === "GET",
        handle: async (params) => {
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: payload4aContext,
          });
        },
      };

      activeInterceptRules.unshift(detailRule4a);
      activeInterceptRules.unshift(contextRule4a);

      // Tunggu hingga assessment non-reason tampil di DOM
      const nonReasonUpdated = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${updatedIncidentId}"))`,
        18000
      );

      const idxD4a = activeInterceptRules.indexOf(detailRule4a);
      if (idxD4a !== -1) activeInterceptRules.splice(idxD4a, 1);
      const idxC4a = activeInterceptRules.indexOf(contextRule4a);
      if (idxC4a !== -1) activeInterceptRules.splice(idxC4a, 1);

      // --- Kasus 4b: Service ID benar-benar berubah tanpa penambahan pesan ---
      console.log("  [4b] Menguji perubahan Service ID nyata tanpa penambahan pesan...");
      const newServiceCode4b = `SRV-REAL-CHANGE-${runId}`;

      const payload4bDetail = JSON.parse(JSON.stringify(payload4aDetail));
      payload4bDetail.latestEpisode.serviceId = srvBetaId;
      payload4bDetail.latestEpisode.serviceCode = newServiceCode4b;
      payload4bDetail.sender.customerId = custBetaId;
      payload4bDetail.sender.customerName = `Pelanggan Beta ${runId}`;

      const payload4bContext = JSON.parse(JSON.stringify(payload4aContext));
      payload4bContext.service = { id: srvBetaId, serviceCode: newServiceCode4b, status: "active" };
      payload4bContext.customer = { id: custBetaId, displayName: `Pelanggan Beta ${runId}`, status: "active" };

      const detailRule4b = {
        match: (req) =>
          req.url.includes(`/api/inbox/conversations/${convAlphaId}`) &&
          !req.url.includes("/context") &&
          !req.url.includes("/read") &&
          !req.url.includes("/network-check") &&
          req.method === "GET",
        handle: async (params) => {
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: payload4bDetail,
          });
        },
      };

      const contextRule4b = {
        match: (req) =>
          req.url.includes(`/api/inbox/conversations/${convAlphaId}/context`) &&
          req.method === "GET",
        handle: async (params) => {
          await fulfillJson(params.requestId, 200, {
            success: true,
            data: payload4bContext,
          });
        },
      };

      activeInterceptRules.unshift(detailRule4b);
      activeInterceptRules.unshift(contextRule4b);

      // Tunggu hingga Service ID baru tampil di DOM
      const serviceIdUpdated = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${newServiceCode4b}"))`,
        18000
      );

      const idxD4b = activeInterceptRules.indexOf(detailRule4b);
      if (idxD4b !== -1) activeInterceptRules.splice(idxD4b, 1);
      const idxC4b = activeInterceptRules.indexOf(contextRule4b);
      if (idxC4b !== -1) activeInterceptRules.splice(idxC4b, 1);

      await takeScreenshot("04_ui_lifecycle_assessment_service_sync");

      const scenario4Pass =
        nonReasonPayloadIsolated &&
        initialDomLacksNewIncident &&
        Boolean(nonReasonUpdated) &&
        Boolean(serviceIdUpdated);

      recordAssertion({
        id: "ui_lifecycle_assessment_and_service_change_syncs_context",
        name: "Assessment berubah (terisolasi non-reason) dan layanan berubah tetap memperbarui konteks tanpa pertambahan pesan",
        pass: scenario4Pass,
        expected: "isolatedPayload=true, initialDomClean=true, nonReasonUpdated=true, serviceIdUpdated=true",
        actual: `isolated=${nonReasonPayloadIsolated}, initialClean=${initialDomLacksNewIncident}, nonReasonUpdated=${Boolean(nonReasonUpdated)}, serviceIdUpdated=${Boolean(serviceIdUpdated)}`,
      });
    }

    // =========================================================================
    // SCENARIO 5: Preservasi Unresolved Saat Polling (Menghitung Siklus Nyata Selesai)
    // =========================================================================
    console.log("\n>> [Skenario 5] Preservasi Unresolved Saat Polling (Minimal 3 Siklus Nyata Selesai) <<");
    {
      await clickConversationCard(convGammaId);
      await waitForElement('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]', 8000);

      // Jalankan recheck pada Gamma untuk memastikan outcome=unresolved tampil di DOM sebelum penghitungan
      console.log("       -> Memastikan outcome=unresolved tampil di DOM sebelum penghitungan siklus dimulai...");
      await clickRecheckButton();
      const unresolvedRenderedBeforeCycles = await waitForCondition(
        `(() => {
          const aside = document.querySelector('[data-testid="evidence-column"] aside');
          return Boolean(aside && aside.textContent.includes("Belum Terverifikasi") && aside.textContent.includes("outcome=unresolved"));
        })()`,
        8000
      );
      if (!unresolvedRenderedBeforeCycles) {
        throw new Error("Skenario 5 gagal: outcome=unresolved tidak tampil di DOM sebelum siklus dimulai!");
      }

      // Amati dan hitung putaran polling aktif yang benar-benar selesai
      // Polling loop memanggil GET /api/inbox/conversations/:id (detail) diikuti /context secara berkala (~5000ms).
      // Kita identifikasikan request detail dan context percakapan aktif Gamma secara spesifik,
      // teruskan request, tunggu respon jaringan selesai secara nyata (HTTP 200 + loadingFinished via CDP Network),
      // lalu verifikasi pembaruan aplikasi di DOM bahwa outcome=unresolved tetap tampil setelah SETIAP putaran selesai.
      const completedPollingCycles = [];
      let pendingDetailCompletion = null;

      const cycleTrackerRule = {
        match: (req) =>
          req.url.includes(`/api/inbox/conversations/${convGammaId}`) &&
          !req.url.includes("/network-check") &&
          !req.url.includes("/read") &&
          req.method === "GET",
        handle: async (params) => {
          const url = params.request.url;
          const isDetail = !url.includes("/context");
          const reqId = params.requestId;

          // Lanjutkan request ke server secara normal
          try {
            await cdp.send("Fetch.continueRequest", { requestId: reqId });
          } catch (e) {
            throw new Error(`[CycleTracker] continueRequest gagal untuk ${url}: ${e.message}`);
          }

          if (isDetail) {
            // Tunggu penyelesaian jaringan nyata untuk request detail (HTTP 200)
            const detailComp = await waitForRequestCompletion(params, 8000);
            pendingDetailCompletion = detailComp;
            console.log(`       -> [Siklus #${completedPollingCycles.length + 1}] Detail response selesai (ID=${detailComp.fetchRequestId}, status=${detailComp.status})`);
          } else {
            // Ini adalah request context dari putaran yang sama
            if (!pendingDetailCompletion) {
              console.warn(`[CycleTracker] Context request tertangkap tanpa detail pendahulu: ${url}`);
              return;
            }
            // Tunggu penyelesaian jaringan nyata untuk request context (HTTP 200)
            const contextComp = await waitForRequestCompletion(params, 8000);
            const detailComp = pendingDetailCompletion;
            pendingDetailCompletion = null;

            // Tunggu sejenak agar state React dan DOM selesai menerapkan pembaruan
            await delay(200);

            // Verifikasi di DOM bahwa unresolved tetap tampil setelah putaran ini selesai sepenuhnya
            const domCheck = await readEvidencePanelDOM();
            const cyclePreserved =
              domCheck.text.includes("Belum Terverifikasi") &&
              domCheck.text.includes("outcome=unresolved");

            if (!cyclePreserved) {
              throw new Error(`Skenario 5 gagal: outcome=unresolved hilang setelah putaran #${completedPollingCycles.length + 1} selesai!`);
            }

            const cycleRecord = {
              cycleNumber: completedPollingCycles.length + 1,
              detailRequest: {
                requestId: detailComp.fetchRequestId,
                networkId: detailComp.networkId,
                endpoint: detailComp.url,
                status: detailComp.status,
                finishedAt: detailComp.finishedAt,
              },
              contextRequest: {
                requestId: contextComp.fetchRequestId,
                networkId: contextComp.networkId,
                endpoint: contextComp.url,
                status: contextComp.status,
                finishedAt: contextComp.finishedAt,
              },
              executionOrder: ["detail (HTTP 200)", "context (HTTP 200)", "dom_verification"],
              unresolvedPreserved: cyclePreserved,
              domSnippet: domCheck.text.slice(0, 160).replace(/\s+/g, " "),
              completedAt: new Date().toISOString(),
            };
            completedPollingCycles.push(cycleRecord);
            console.log(`       -> Putaran polling percakapan aktif #${cycleRecord.cycleNumber} selesai penuh & terverifikasi (detail=${detailComp.fetchRequestId}, context=${contextComp.fetchRequestId}, preserved=${cyclePreserved})`);
          }
        },
      };
      activeInterceptRules.unshift(cycleTrackerRule);

      // Tunggu hingga minimal 3 putaran polling berbeda selesai dan terverifikasi (interval 5s per putaran)
      console.log("       -> Menunggu minimal 3 putaran polling selesai penuh (diamati dari response completion 200 & verifikasi DOM)...");
      for (let i = 0; i < 350 && completedPollingCycles.length < 3; i++) {
        await delay(100);
      }

      const idx5 = activeInterceptRules.indexOf(cycleTrackerRule);
      if (idx5 !== -1) activeInterceptRules.splice(idx5, 1);

      if (completedPollingCycles.length < 3) {
        throw new Error(`Skenario 5 gagal: Hanya ${completedPollingCycles.length}/3 putaran polling yang selesai penuh!`);
      }

      completedPollingCyclesEvidence = completedPollingCycles;

      // Pastikan seluruh putaran berhasil mempertahankan unresolved
      const allCyclesPreserved = completedPollingCycles.every((c) => c.unresolvedPreserved);

      // Verifikasi akhir di DOM
      let dom5 = await readEvidencePanelDOM();
      const unresolvedPreservedFinal =
        dom5.text.includes("Belum Terverifikasi") && dom5.text.includes("outcome=unresolved");

      await takeScreenshot("05_ui_lifecycle_polling_preserves_unresolved");

      const scenario5Pass =
        unresolvedRenderedBeforeCycles &&
        completedPollingCycles.length >= 3 &&
        allCyclesPreserved &&
        unresolvedPreservedFinal;

      recordAssertion({
        id: "ui_lifecycle_noop_polling_preserves_unresolved",
        name: "Polling tanpa perubahan mempertahankan hasil relevan (outcome=unresolved tetap utuh, 3 putaran selesai terbukti)",
        pass: scenario5Pass,
        expected: "before=true, completedCycles>=3, allCyclesPreserved=true, finalPreserved=true",
        actual: `before=${unresolvedRenderedBeforeCycles}, completedCycles=${completedPollingCycles.length}, allPreserved=${allCyclesPreserved}, final=${unresolvedPreservedFinal}`,
      });
    }

    // =========================================================================
    // SCENARIO 6: Snapshot Parsial Non-2xx & Penolakan Respons Kedaluwarsa
    // =========================================================================
    console.log("\n>> [Skenario 6] Snapshot Parsial Non-2xx & Penolakan Respons Kedaluwarsa <<");
    {
      await clickConversationCard(convBetaId);
      await waitForElement('[data-testid="evidence-column"] [data-testid="recheck-network-btn"]', 8000);

      // Bagian 6a: Respons non-2xx dengan snapshot parsial berpenanda unik
      const partialMarker = `PARTIAL-SNAPSHOT-${runId}`;
      const partialErrorMessage = `Error provider parsial 500 (${runId})`;

      let partialCheckReq = null;
      const partialRule = {
        match: (req) => req.url.includes("/network-check") && req.method === "POST",
        handle: (params) => {
          partialCheckReq = params;
        },
      };
      activeInterceptRules.unshift(partialRule);

      console.log("       -> Menjalankan pemeriksaan jaringan untuk snapshot parsial non-2xx...");
      await clickRecheckButton();
      for (let i = 0; i < 30 && !partialCheckReq; i++) await delay(100);
      if (!partialCheckReq) {
        throw new Error("Skenario 6a gagal: Request network-check tidak tertangkap!");
      }

      const idxPart = activeInterceptRules.indexOf(partialRule);
      if (idxPart !== -1) activeInterceptRules.splice(idxPart, 1);

      // Kirim respons 500 dengan snapshot parsial yang memiliki penanda unik
      await fulfillJson(partialCheckReq.requestId, 500, {
        success: false,
        data: {
          serviceId: srvBetaId,
          outcome: "error",
          checkedAt: new Date().toISOString(),
          source: "mock",
          onu: {
            status: "LOS",
            quality: "usable",
            reportedStatus: partialMarker,
            observedAt: new Date().toISOString(),
          },
          upstream: [],
          areas: [],
        },
        error: {
          code: "PARTIAL_PROVIDER_ERROR",
          message: partialErrorMessage,
        },
      });
      await delay(500);

      // Assertion harus membuktikan banner error DAN isi snapshot yang relevan tampil di DOM
      let dom6 = await readEvidencePanelDOM();
      const errorBannerRendered = dom6.text.includes(partialErrorMessage) || dom6.text.includes("Gagal memeriksa jaringan");
      const partialSnapshotContentRendered = dom6.text.includes(partialMarker) && dom6.text.includes("LOS");

      // Bagian 6b: Respons kedaluwarsa setelah konteks berubah
      console.log("       -> Menahan request pemeriksaan untuk pengujian respons kedaluwarsa...");
      let heldExpiredCheckReq = null;
      const expiredCheckRule = {
        match: (req) => req.url.includes("/network-check") && req.method === "POST",
        handle: (params) => {
          heldExpiredCheckReq = params;
        },
      };
      activeInterceptRules.unshift(expiredCheckRule);

      await clickRecheckButton();
      for (let i = 0; i < 30 && !heldExpiredCheckReq; i++) await delay(100);
      if (!heldExpiredCheckReq) {
        throw new Error("Skenario 6b gagal: Request network-check yang hendak ditahan tidak tertangkap!");
      }

      const idxExp = activeInterceptRules.indexOf(expiredCheckRule);
      if (idxExp !== -1) activeInterceptRules.splice(idxExp, 1);

      // Pindahkan konteks ke Conversation Alpha
      console.log("       -> Berpindah konteks ke Conversation Alpha...");
      await clickConversationCard(convAlphaId);
      const alphaRenderedBeforeRelease = await waitForCondition(
        `Boolean(document.querySelector('[data-testid="evidence-column"] aside')?.textContent.includes("${srvAlphaCode}"))`,
        8000
      );
      if (!alphaRenderedBeforeRelease) {
        throw new Error("Skenario 6b gagal: Konteks Alpha tidak tampil di DOM sebelum pelepasan respons lama!");
      }

      // Lepaskan respons parsial lama dari Beta saat konteks sudah berada di Alpha (wajib dilepas, tanpa if)
      const staleExpiredMarker = `STALE-EXPIRED-MARKER-${runId}`;
      const staleExpiredError = `Stale error dari Beta (${runId})`;
      console.log(`       -> Melepaskan respons kedaluwarsa Beta (ID=${heldExpiredCheckReq.requestId})...`);
      await fulfillJson(heldExpiredCheckReq.requestId, 500, {
        success: false,
        data: {
          serviceId: srvBetaId,
          outcome: "error",
          checkedAt: new Date().toISOString(),
          source: "mock",
          onu: { status: "offline", quality: "unusable", reportedStatus: staleExpiredMarker },
          upstream: [],
          areas: [],
        },
        error: { code: "STALE_ERROR", message: staleExpiredError },
      });
      await delay(500);

      // Pastikan penanda snapshot dan error lama tidak menggantikan konteks aktif Alpha
      dom6 = await readEvidencePanelDOM();
      const expiredSnapshotRejected = !dom6.text.includes(staleExpiredMarker);
      const expiredErrorRejected = !dom6.text.includes(staleExpiredError);
      const activeContextAlphaRemained = dom6.text.includes(srvAlphaCode);

      await takeScreenshot("06_ui_lifecycle_partial_non2xx_and_expired");

      const scenario6Pass =
        errorBannerRendered &&
        partialSnapshotContentRendered &&
        Boolean(heldExpiredCheckReq) &&
        alphaRenderedBeforeRelease &&
        expiredSnapshotRejected &&
        expiredErrorRejected &&
        activeContextAlphaRemained;

      recordAssertion({
        id: "ui_lifecycle_partial_non_2xx_accepted_and_stale_rejected",
        name: "Respons parsial non-2xx untuk konteks aktif ditangani dengan benar; respons kedaluwarsa ditolak",
        pass: scenario6Pass,
        expected: "banner=true, partialSnapshot=true, heldReq=true, alphaBefore=true, expSnapshotRej=true, expErrRej=true, actAlpha=true",
        actual: `banner=${errorBannerRendered}, snapshot=${partialSnapshotContentRendered}, held=${Boolean(heldExpiredCheckReq)}, alphaBefore=${alphaRenderedBeforeRelease}, expSnapshotRej=${expiredSnapshotRejected}, expErrRej=${expiredErrorRejected}, actAlpha=${activeContextAlphaRemained}`,
      });

      console.log("\n--- [Selesai Seluruh Skenario Pengujian UI Lifecycle] ---");
      if (!finalizationTriggered && finalizationSignalResolve) {
        finalizationTriggered = true;
        finalizationSignalResolve();
      }
    }
  } catch (err) {
    console.error("\n[Error Runner UI Lifecycle]:", err);
    runnerFatalError = err;
  } finally {
    console.log("\n--- [Finalisasi & Teardown] Penutupan Handler Asynchronous & Pembersihan Resource ---");
    if (!finalizationTriggered && finalizationSignalResolve) {
      finalizationTriggered = true;
      finalizationSignalResolve();
    }

    let drainError = null;
    if (cdp) {
      try {
        cdp.stopAcceptingNewEvents();
        console.log(`[Finalisasi] Menunggu penyelesaian ${cdp.inFlightHandlers.size} handler in-flight (timeout 5000ms)...`);
        await cdp.drainInFlightHandlers(5000);
        console.log("[Finalisasi] Seluruh handler asynchronous in-flight telah selesai diselesaikan.");
      } catch (dErr) {
        drainError = dErr;
        console.error("[Finalisasi] Kegagalan saat menyelesaikan in-flight handlers:", dErr.message);
      }
    }

    // Bekukan fase skenario pengujian agar handler terlambat tidak dapat mengubah assertion skenario
    isTestPhaseFinalized = true;

    if (networkCorrelator) {
      try { networkCorrelator.clear(); } catch {}
    }

    if (cdp) {
      try { cdp.close(); } catch {}
    }

    if (chromeProc) {
      try {
        killProcess(chromeProc);
        console.log("[Teardown] Proses Chrome berhasil dihentikan.");
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    if (userDataDir && fs.existsSync(userDataDir)) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }

    if (nextProc) {
      try {
        killProcess(nextProc);
        console.log("[Teardown] Proses Next.js server berhasil dihentikan.");
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    // Teardown staff user: check error return value of deleteUser() explicitly
    if (staffUserId && supabaseAdmin) {
      try {
        const { error: delUserError } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
        if (delUserError) {
          cleanupErrors.push(new Error(`Gagal deleteUser staf ${staffUserId}: ${delUserError.message}`));
        } else {
          console.log(`[Teardown] User staf ${staffUserId} berhasil dihapus.`);
        }

        const { data: checkUserRes } = await supabaseAdmin.auth.admin.getUserById(staffUserId);
        if (checkUserRes?.user) {
          cleanupErrors.push(new Error(`Residu user staf: ${staffUserId} masih ada di Supabase Auth!`));
        }
      } catch (uErr) {
        cleanupErrors.push(uErr);
      }
    }

    // Teardown DB fixtures strictly scoped to this run
    if (pool && tracker) {
      try {
        await cleanupFixture(pool, tracker);
        console.log("[Teardown] Fixture DB run berhasil dibersihkan via tracker.");
      } catch (cErr) {
        cleanupErrors.push(cErr);
      }
    }

    let residualsRemaining = 0;
    let residualBreakdown = {};
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT
             (SELECT count(*) FROM public.conversations WHERE id = ANY($1)) as conv_cnt,
             (SELECT count(*) FROM public.customers WHERE id = ANY($2)) as cust_cnt,
             (SELECT count(*) FROM public.services WHERE id = ANY($3)) as srv_cnt,
             (SELECT count(*) FROM public.channel_identities WHERE id = ANY($4)) as ident_cnt,
             (SELECT count(*) FROM public.messages WHERE id = ANY($5)) as msg_cnt,
             (SELECT count(*) FROM public.complaints WHERE id = ANY($6)) as comp_cnt,
             (SELECT count(*) FROM public.ingress_events WHERE id = ANY($7)) as ing_cnt,
             (SELECT count(*) FROM public.triage_assessments WHERE message_id = ANY($8)) as assess_cnt`,
          [
            [convAlphaId, convBetaId, convGammaId].filter(Boolean),
            [custAlphaId, custBetaId].filter(Boolean),
            [srvAlphaId, srvBetaId].filter(Boolean),
            [identAlphaId, identBetaId, identGammaId].filter(Boolean),
            [msgAlphaId, msgBetaId, msgGammaId].filter(Boolean),
            [compAlphaId].filter(Boolean),
            [msgAlphaId, msgBetaId, msgGammaId].filter(Boolean),
            [msgAlphaId].filter(Boolean),
          ]
        );
        const r = res.rows[0];
        residualBreakdown = {
          conversations: Number(r.conv_cnt || 0),
          customers: Number(r.cust_cnt || 0),
          services: Number(r.srv_cnt || 0),
          channel_identities: Number(r.ident_cnt || 0),
          messages: Number(r.msg_cnt || 0),
          complaints: Number(r.comp_cnt || 0),
          ingress_events: Number(r.ing_cnt || 0),
          triage_assessments: Number(r.assess_cnt || 0),
        };
        residualsRemaining = Object.values(residualBreakdown).reduce((a, b) => a + b, 0);
      } catch (rErr) {
        cleanupErrors.push(rErr);
      }

      try {
        await pool.end();
      } catch (pErr) {
        cleanupErrors.push(pErr);
      }
    }

    const teardownPass = cleanupErrors.length === 0 && residualsRemaining === 0;
    recordAssertion({
      id: "runner_cleanup_and_teardown",
      name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
      pass: teardownPass,
      expected: "cleanupErrors=0, residualsRemaining=0",
      actual: `cleanupErrors=${cleanupErrors.length}, residualsRemaining=${residualsRemaining}`,
    });

    // Bekukan seluruh rekaman artefak agar tidak ada mutasi pasca-teardown
    isArtifactFinalized = true;

    // Finalize Source Hashes & Runtime Build Validation
    const sourceHashesAtFinalize = computeSourceHashes();
    const finalizeValidation = validateBuildMetadata({
      manifest: buildManifest,
      currentBuildId: buildId,
      launchHashes: sourceHashesAtLaunch,
      finalizeHashes: sourceHashesAtFinalize,
      mode: "ui_lifecycle",
    });

    const finalBuildValidation =
      buildValidation && !buildValidation.isValid ? buildValidation : finalizeValidation;

    // Check mandatory registry
    const recordedIds = new Set(assertions.map((a) => a.id));
    const missingMandatoryIds = [];
    for (const requiredId of LIFECYCLE_MANDATORY_REGISTRY) {
      if (!recordedIds.has(requiredId)) {
        missingMandatoryIds.push(requiredId);
        assertions.push({
          id: requiredId,
          name: `Assertion wajib mode (${requiredId})`,
          isOptional: false,
          status: "NOT_RUN",
          reason: `Assertion wajib '${requiredId}' tidak dijalankan`,
        });
      }
    }

    const idCounts = new Map();
    for (const a of assertions) {
      idCounts.set(a.id, (idCounts.get(a.id) || 0) + 1);
    }
    const duplicates = [...idCounts.entries()]
      .filter(([_, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));

    const total = assertions.length;
    const passed = assertions.filter((a) => a.status === "PASS").length;
    const failed = assertions.filter((a) => a.status === "FAIL").length;
    const notRun = assertions.filter((a) => a.status === "NOT_RUN").length;

    const asyncControllerError = asyncFailureController.getError();
    const effectiveFatalError = runnerFatalError || asyncControllerError || drainError;

    let overallStatus = "PASS";
    if (
      failed > 0 ||
      notRun > 0 ||
      duplicates.length > 0 ||
      !finalBuildValidation.isValid ||
      cleanupErrors.length > 0 ||
      residualsRemaining > 0 ||
      effectiveFatalError !== null ||
      unhandledRejectionsCount > 0
    ) {
      overallStatus = "FAIL";
    }
    const calculatedExitCode = overallStatus === "PASS" ? 0 : 1;

    const evidenceArtifact = {
      timestamp: new Date().toISOString(),
      runId,
      mode: TEST_ASYNC_FAILURE
        ? "async_failure_injection"
        : TEST_FINALIZATION_ASYNC_FAILURE
        ? "finalization_async_failure"
        : "ui_lifecycle",
      testAsyncFailureInjected: TEST_ASYNC_FAILURE,
      testFinalizationAsyncFailureInjected: TEST_FINALIZATION_ASYNC_FAILURE,
      runnerRevisionSha256,
      expectedExitCode: (TEST_ASYNC_FAILURE || TEST_FINALIZATION_ASYNC_FAILURE) ? 1 : 0,
      calculatedExitCode,
      runnerFatalError: runnerFatalError ? (runnerFatalError.message || String(runnerFatalError)) : null,
      asyncFailureError: asyncControllerError ? (asyncControllerError.message || String(asyncControllerError)) : null,
      drainError: drainError ? (drainError.message || String(drainError)) : null,
      effectiveFatalError: effectiveFatalError ? (effectiveFatalError.message || String(effectiveFatalError)) : null,
      unhandledRejectionsCount,
      buildIdentity: {
        status: finalBuildValidation.status,
        isApplicable: true,
        isValid: finalBuildValidation.isValid,
        buildId: buildId || null,
        manifestBuildId: buildManifest?.buildId || null,
        scope: buildManifest?.scope || TRACKED_FILE_SCOPE,
        scopeDescription: buildManifest?.scopeDescription || TRACKED_FILE_DESCRIPTION,
        trackedFiles: buildManifest?.trackedFiles || TRACKED_SOURCE_FILES,
        sourceHashesAtBuild: buildManifest?.sourceHashes || null,
        sourceHashesAtLaunch,
        sourceHashesAtFinalize,
        checks: finalBuildValidation.checks,
        reason: finalBuildValidation.reason,
      },
      screenshots: capturedScreenshots,
      summary: {
        overallStatus,
        exitCode: calculatedExitCode,
        total,
        passed,
        failed,
        notRun,
        duplicatesCount: duplicates.length,
      },
      assertions,
      pollingCyclesEvidence: completedPollingCyclesEvidence,
      cleanupErrors: cleanupErrors.map((e) => e.message || String(e)),
      residualBreakdown,
      residualsRemaining,
    };

    const evidencePath = path.join(runEvidenceDir, "evidence.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidenceArtifact, null, 2));
    console.log(`\n[Artefak Bukti] Tersimpan pada: ${evidencePath}`);

    console.log("\n========================================================");
    console.log(`TOTAL ASSERTION LIFECYCLE UI: ${total}`);
    console.log(`LULUS:                        ${passed}`);
    console.log(`GAGAL:                        ${failed}`);
    console.log(`STATUS AKHIR:                 ${overallStatus} (exit code ${calculatedExitCode})`);
    console.log("========================================================\n");

    return evidenceArtifact;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runUILifecycleVerification()
    .then((result) => {
      process.exit(result.calculatedExitCode);
    })
    .catch((err) => {
      console.error("[Fatal Error]:", err);
      process.exit(1);
    });
}
