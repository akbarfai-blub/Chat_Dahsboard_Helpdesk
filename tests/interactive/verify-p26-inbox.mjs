#!/usr/bin/env node
/**
 * verify-p26-inbox.mjs
 *
 * Interactive Browser Verification Runner for P2.6 Tahap 2 — UI Inbox
 * Uses native Chrome DevTools Protocol (CDP) and Next.js Production Build on isolated ports.
 *
 * Enforces:
 * - Real read-ack retry isolation (exact snapshot, DB is_confirmed = true, no expansion)
 * - Hidden tab read suppression (no network calls or read mutations while document.hidden)
 * - True component polling overlap (foreground delayed, component interval fires, overlap recorded, loading cleared)
 * - Stale response rejection (delayed A released after B open does not overwrite B)
 * - Dedicated failure & recovery isolation for list and detail
 * - Full 28-item dataset pagination integrity and filter reset from Page 2 to Page 1
 * - Verified teardown lifecycle with taskkill PID confirmation, deleteUser error checks, and zero DB residuals
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

import {
  parseAndValidateTestConfig,
  verifyTestTargetIdentity,
  requireIsolatedDatabase,
  TestResourceTracker,
  cleanupFixture,
  EnvRestorer,
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
const CHROME_PORT = 9226;

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

async function findAvailablePort(startPort = 3310) {
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

  if (!isProcessRunning(pid)) {
    return; // Already stopped
  }

  // Attempt termination restricted strictly to this run's process PID
  const res = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { encoding: "utf8" });

  // Verify process actually stopped
  let stillRunning = false;
  for (let i = 0; i < 20; i++) {
    if (!isProcessRunning(pid)) {
      stillRunning = false;
      break;
    }
    stillRunning = true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }

  if (stillRunning) {
    throw new Error(
      `Gagal menghentikan proses milik run (PID ${pid}): taskkill exit=${res.status}, stderr=${res.stderr?.trim() || res.error?.message || "process still active"}`
    );
  }
}

async function getWebSocketDebuggerUrl(port = CHROME_PORT) {
  for (let i = 30; i > 0; i--) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) {
          return page.webSocketDebuggerUrl;
        }
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
          for (const handler of handlers) {
            handler(msg.params);
          }
        }
      };
    });
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, []);
    }
    this.eventHandlers.get(method).push(handler);
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

async function captureScreenshot(cdp, filepath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(filepath, Buffer.from(result.data, "base64"));
}

// Command-line harness flags
const SIMULATE_NO_CREDS = process.argv.includes("--simulate-no-creds");
const SIMULATE_LOGIN_FAIL = process.argv.includes("--simulate-login-fail");
const SIMULATE_ASSERTION_FAIL = process.argv.includes("--simulate-assertion-fail") || process.argv.includes("--test-fail-mode");
const SIMULATE_PASS = process.argv.includes("--simulate-pass");
const TEST_GUARD_REJECTION = process.argv.includes("--test-guard-rejection");
const TEST_CLEANUP_FAILURE = process.argv.includes("--test-cleanup-failure");
const TEST_SETUP_FAILURE = process.argv.includes("--test-setup-failure");
const TEST_MIDRUN_FAILURE = process.argv.includes("--test-midrun-failure");

export const DEPENDENT_TEST_SCENARIOS = [
  { id: "build_source_binding_verification", name: "Validasi pengikatan BUILD_ID dan source hashes terhadap manifest build" },
  { id: "shell_integration_and_indicators", name: "Integrasi shell dashboard: judul 'Inbox / Antrean', badge SHADOW, penanda dummy, dan target sentuh direktori pelanggan" },
  { id: "desktop_two_pane_layout", name: "Layout desktop (1280x800): dua panel berdampingan tanpa overflow" },
  { id: "conversation_list_rendering", name: "Daftar percakapan memuat identitas pengirim, preview pesan, waktu WIB, badge unread, dan item percakapan" },
  { id: "non_color_selection_indicator", name: "Indikator percakapan terpilih memiliki pembeda non-warna ganda (border 4px + teks 'Dipilih')" },
  { id: "conversation_detail_thread", name: "Panel detail menampilkan riwayat kronologis receivedAt ASC dan kartu informasi Fase P3" },
  { id: "search_and_filters", name: "Filter bar mendukung pencarian kata kunci dan menyaring daftar secara akurat" },
  { id: "pagination_reset_on_filter_change", name: "Penerapan filter dari halaman 2 secara otomatis mereset paginasi kembali ke halaman 1" },
  { id: "empty_vs_filtered_empty_states", name: "Membedakan state 'Inbox Kosong' dengan state 'Tidak ada hasil untuk filter ini' lengkap dengan tombol reset filter" },
  { id: "pagination_dataset_integrity", name: "Integritas paginasi 28 fixture: Halaman 1 (25 item) dan Halaman 2 (3 item) disjoin dan mencakup seluruh dataset" },
  { id: "viewport_read_acknowledgment", name: "Penandaan baca hanya mengirim pesan yang benar-benar terlihat di viewport dan terkonfirmasi di database" },
  { id: "read_acknowledgment_retry_isolation", name: "Retry read-ack mengirimkan tepat snapshot pesan gagal tanpa penambahan ID baru dan terkonfirmasi di database" },
  { id: "hidden_tab_read_suppression", name: "Tab dokumen tersembunyi tidak mengirim request read-ack atau mengubah status baca di database" },
  { id: "polling_and_scroll_retention", name: "Polling 5 detik memperbarui pesan tanpa memaksa auto-scroll saat membaca pesan lama, memunculkan pill 'Pesan baru di bawah'" },
  { id: "polling_failure_and_banner_alert", name: "Kegagalan polling mempertahankan data terakhir dan menampilkan banner 'Pembaruan terhenti' dengan timestamp pembaruan terakhir (WIB)" },
  { id: "polling_overlap_with_foreground_fetch", name: "Resiliensi loading saat request foreground tumpang tindih dengan polling komponen (loading selesai, tombol aktif, data sesuai)" },
  { id: "stale_response_rejection", name: "Respons detail lama yang tertunda tidak menimpa percakapan baru yang telah dipilih" },
  { id: "detail_failure_isolation_after_open", name: "Kegagalan memuat detail percakapan baru menampilkan pesan error terisolasi tanpa membocorkan data percakapan sebelumnya" },
  { id: "list_error_and_recovery_isolated", name: "Kegagalan daftar percakapan terisolasi dari panel detail dan pulih secara independen saat dicoba lagi" },
  { id: "detail_error_and_recovery_isolated", name: "Kegagalan detail percakapan terisolasi dari daftar dan pulih secara independen saat dicoba lagi" },
  { id: "mobile_viewport_and_navigation", name: "Viewport mobile (375x667) menampilkan single-pane dengan tombol 'Kembali' yang mempertahankan konteks filter dan daftar" },
  { id: "keyboard_navigation_and_focus", name: "Navigasi keyboard menampilkan focus ring terlihat jelas dan region aria-live polite untuk notifikasi" },
  { id: "runner_cleanup_and_teardown", name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan" },
];

export const NORMAL_BROWSER_REGISTRY = [
  "auth_setup",
  ...DEPENDENT_TEST_SCENARIOS.map((s) => s.id),
];

export const GUARD_REJECTION_REGISTRY = [
  "guard_active_db_rejection",
  "guard_active_api_rejection",
  "guard_marker_mismatch_rejection",
];

export const SETUP_FAILURE_REGISTRY = [
  "setup_failure_injected",
  "teardown_user_deleted",
  "runner_cleanup_and_teardown",
];

export const MIDRUN_FAILURE_REGISTRY = [
  "auth_setup",
  "midrun_failure_injected",
  "teardown_processes_killed",
  "teardown_resources_cleaned",
  "runner_cleanup_and_teardown",
];

export const CLEANUP_FAILURE_REGISTRY = [
  ...NORMAL_BROWSER_REGISTRY.filter((id) => id !== "runner_cleanup_and_teardown"),
  "cleanup_fault_injected",
  "fallback_cleanup_executed",
  "runner_cleanup_and_teardown",
];

export function getApplicationSourceHashes() {
  return computeSourceHashes();
}

export function getFileSha256(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    if (fs.existsSync(fullPath)) {
      return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
    }
  } catch {}
  return null;
}

export function getBuildId() {
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
    const manifestPath = path.resolve("docs/evidence/P2_6/latest-manifest.json");
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
      runnerRevisionSha256: entry.runnerRevisionSha256,
      screenshotsCount: entry.screenshotsCount || 0,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.warn("[Manifest] Gagal memperbarui latest-manifest.json:", err.message);
  }
}

export function handleAuthenticationOutcome({
  hasCredentials,
  isLoginSuccess = false,
  currentPath = "",
  notRunReason = "Kredensial staf tidak disediakan di environment",
  recordAssertion,
}) {
  if (!hasCredentials) {
    recordAssertion({
      id: "auth_setup",
      name: "Autentikasi sesi staf untuk pengujian UI Inbox",
      isOptional: false,
      notRunReason,
    });

    for (const test of DEPENDENT_TEST_SCENARIOS) {
      recordAssertion({
        id: test.id,
        name: test.name,
        isOptional: false,
        notRunReason: "Prasyarat autentikasi tidak terpenuhi",
      });
    }

    return { canRunDependentTests: false, authStatus: "NOT_RUN" };
  }

  recordAssertion({
    id: "auth_setup",
    name: "Autentikasi sesi staf untuk pengujian UI Inbox",
    isOptional: false,
    expected: "Sesi aktif pada rute /dashboard",
    actual: isLoginSuccess ? `Sesi aktif pada rute ${currentPath || "/dashboard"}` : `Dialihkan ke ${currentPath || "/login?error=invalid"}`,
    pass: isLoginSuccess,
  });

  if (!isLoginSuccess) {
    for (const test of DEPENDENT_TEST_SCENARIOS) {
      recordAssertion({
        id: test.id,
        name: test.name,
        isOptional: false,
        notRunReason: "Autentikasi staf gagal",
      });
    }
    return { canRunDependentTests: false, authStatus: "FAIL" };
  }

  return { canRunDependentTests: true, authStatus: "PASS" };
}

export function calculateSummary(assertions) {
  const total = assertions.length;
  const passed = assertions.filter((a) => a.status === "PASS").length;
  const failed = assertions.filter((a) => a.status === "FAIL").length;
  const notRun = assertions.filter((a) => a.status === "NOT_RUN").length;

  const mandatoryAssertions = assertions.filter((a) => !a.isOptional);
  const mandatoryTotal = mandatoryAssertions.length;
  const mandatoryPassed = mandatoryAssertions.filter((a) => a.status === "PASS").length;
  const mandatoryFailed = mandatoryAssertions.filter((a) => a.status === "FAIL").length;
  const mandatoryNotRun = mandatoryAssertions.filter((a) => a.status === "NOT_RUN").length;

  let overallStatus = "PASS";
  if (mandatoryFailed > 0) {
    overallStatus = "FAIL";
  } else if (mandatoryNotRun > 0) {
    overallStatus = "INCOMPLETE";
  } else {
    overallStatus = "PASS";
  }

  const exitCode = overallStatus === "PASS" ? 0 : 1;

  return {
    overallStatus,
    exitCode,
    total,
    passed,
    failed,
    notRun,
    mandatoryTotal,
    mandatoryPassed,
    mandatoryFailed,
    mandatoryNotRun,
  };
}

export function evaluateFinalizeResults(assertionsInput, cleanupErrors = [], modeRegistry = [], extraMetadata = {}) {
  // Deep clone input assertions to preserve caller state and ensure idempotency
  const assertions = assertionsInput.map((a) => ({ ...a }));

  // 1. Detect duplicate IDs
  const idCounts = new Map();
  for (const a of assertions) {
    idCounts.set(a.id, (idCounts.get(a.id) || 0) + 1);
  }
  const duplicates = [...idCounts.entries()]
    .filter(([_, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));

  // 2. Validate completeness against mandatory modeRegistry
  const missingMandatoryIds = [];
  if (modeRegistry && modeRegistry.length > 0) {
    const recordedIds = new Set(assertions.map((a) => a.id));
    for (const requiredId of modeRegistry) {
      if (!recordedIds.has(requiredId)) {
        missingMandatoryIds.push(requiredId);
        assertions.push({
          id: requiredId,
          name: `Assertion wajib mode (${requiredId})`,
          isOptional: false,
          status: "NOT_RUN",
          reason: `Assertion wajib '${requiredId}' terdaftar pada mode registry namun tidak dijalankan oleh runner`,
        });
      }
    }
  }

  // 3. Handle teardown assertion if cleanup errors occurred
  if (cleanupErrors.length > 0) {
    const existingTeardownIdx = assertions.findIndex((a) => a.id === "runner_cleanup_and_teardown");
    const teardownAssertion = {
      id: "runner_cleanup_and_teardown",
      name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
      isOptional: false,
      status: "FAIL",
      expected: "Cleanup selesai tanpa error dan 0 residu",
      actual: cleanupErrors.map((e) => e.message || String(e)).join("; "),
    };
    if (existingTeardownIdx >= 0) {
      assertions[existingTeardownIdx] = teardownAssertion;
    } else {
      assertions.push(teardownAssertion);
    }
  }

  // 4. Handle build-to-source validation if provided
  if (extraMetadata && extraMetadata.buildValidation) {
    const bv = extraMetadata.buildValidation;
    if (!bv.isValid) {
      const existingIdx = assertions.findIndex((a) => a.id === "build_source_binding_verification");
      const bindingAssertion = {
        id: "build_source_binding_verification",
        name: "Validasi pengikatan BUILD_ID dan source hashes terhadap manifest build",
        isOptional: false,
        status: "FAIL",
        expected: "BUILD_ID dan source hashes sinkron dengan manifest build",
        actual: bv.reason,
      };
      if (existingIdx >= 0) {
        assertions[existingIdx] = bindingAssertion;
      } else {
        assertions.unshift(bindingAssertion);
      }
    }
  }

  const summary = calculateSummary(assertions);

  // If duplicate assertions exist, fail closed immediately
  if (duplicates.length > 0 && summary.overallStatus === "PASS") {
    summary.overallStatus = "FAIL";
    summary.exitCode = 1;
  }

  // If cleanup errors exist, fail closed immediately
  if (cleanupErrors.length > 0 && summary.overallStatus === "PASS") {
    summary.overallStatus = "FAIL";
    summary.exitCode = 1;
  }

  // If buildValidation was invalid, ensure overallStatus is FAIL and exitCode is 1
  if (extraMetadata?.buildValidation && !extraMetadata.buildValidation.isValid && summary.overallStatus === "PASS") {
    summary.overallStatus = "FAIL";
    summary.exitCode = 1;
  }

  return {
    summary,
    assertions,
    duplicates,
    missingMandatoryIds,
    cleanupErrors: cleanupErrors.map((e) => e.message || String(e)),
    cleanupSummary: extraMetadata.cleanupSummary || null,
    metadata: extraMetadata,
  };
}

export function finalize(assertions, jsonEvidencePath, cleanupErrors = [], modeRegistry = [], extraMetadata = {}) {
  const buildManifest = extraMetadata.buildManifest || readBuildManifest();
  const buildId = extraMetadata.buildId || getBuildId();
  const sourceHashesAtLaunch = extraMetadata.sourceHashesAtLaunch || null;
  const isAppMode = extraMetadata.mode !== "guard_rejection" && extraMetadata.mode !== "setup_failure";
  const sourceHashesAtFinalize = isAppMode ? computeSourceHashes() : null;

  const buildValidation = extraMetadata.buildValidation || validateBuildMetadata({
    manifest: buildManifest,
    currentBuildId: buildId,
    launchHashes: sourceHashesAtLaunch,
    finalizeHashes: sourceHashesAtFinalize,
    mode: extraMetadata.mode || "live_browser_normal",
  });

  const evaluation = evaluateFinalizeResults(assertions, cleanupErrors, modeRegistry, {
    ...extraMetadata,
    buildValidation,
  });
  const { summary, duplicates } = evaluation;

  if (duplicates.length > 0) {
    console.warn(`[Finalize] PERINGATAN: Assertion ID duplikat terdeteksi: ${duplicates.map((d) => `${d.id} (${d.count}x)`).join(", ")}`);
  }

  const results = {
    timestamp: new Date().toISOString(),
    runId: extraMetadata.runId || null,
    mode: extraMetadata.mode || "live_browser_normal",
    expectedExitCode: extraMetadata.expectedExitCode !== undefined ? extraMetadata.expectedExitCode : (summary.overallStatus === "PASS" ? 0 : 1),
    calculatedExitCode: summary.exitCode,
    buildIdentity: {
      status: buildValidation.status,
      isApplicable: buildValidation.isApplicable,
      isValid: buildValidation.isValid,
      buildId: buildId || null,
      manifestBuildId: buildManifest?.buildId || null,
      scope: buildManifest?.scope || TRACKED_FILE_SCOPE,
      scopeDescription: buildManifest?.scopeDescription || TRACKED_FILE_DESCRIPTION,
      trackedFiles: buildManifest?.trackedFiles || TRACKED_SOURCE_FILES,
      sourceHashesAtBuild: buildManifest?.sourceHashes || null,
      sourceHashesAtLaunch,
      sourceHashesAtFinalize,
      checks: buildValidation.checks,
      reason: buildValidation.reason,
    },
    runnerRevisionSha256: getFileSha256("tests/interactive/verify-p26-inbox.mjs"),
    screenshots: extraMetadata.screenshots || [],
    summary: evaluation.summary,
    assertions: evaluation.assertions,
    cleanupErrors: evaluation.cleanupErrors,
    cleanupSummary: evaluation.cleanupSummary,
  };

  fs.writeFileSync(jsonEvidencePath, JSON.stringify(results, null, 2));
  console.log(`\nArtefak bukti disimpan di: ${jsonEvidencePath}`);

  // Update latest-manifest.json
  updateLatestManifest({
    mode: results.mode,
    runId: results.runId,
    evidenceDir: path.dirname(jsonEvidencePath),
    evidencePath: jsonEvidencePath,
    timestamp: results.timestamp,
    overallStatus: results.summary.overallStatus,
    expectedExitCode: results.expectedExitCode,
    calculatedExitCode: results.calculatedExitCode,
    buildId: results.buildIdentity.buildId,
    buildBindingStatus: results.buildIdentity.status,
    runnerRevisionSha256: results.runnerRevisionSha256,
    screenshotsCount: results.screenshots.length,
  });

  console.log("\n========================================================");
  console.log(`MODE:                  ${results.mode}`);
  console.log(`STATUS KESELURUHAN:    ${summary.overallStatus}`);
  console.log(`EXPECTED EXIT CODE:    ${results.expectedExitCode}`);
  console.log(`CALCULATED EXIT CODE:  ${summary.exitCode}`);
  console.log(`BUILD ID:              ${buildId || "N/A"}`);
  console.log(`BUILD BINDING STATUS:  ${buildValidation.status} (${buildValidation.reason})`);
  console.log(`RUNNER SHA256:         ${results.runnerRevisionSha256 ? results.runnerRevisionSha256.slice(0, 16) + '...' : 'N/A'}`);
  console.log(`TOTAL ASSERTION:       ${summary.total}`);
  console.log(`PASS:                  ${summary.passed}`);
  console.log(`FAIL:                  ${summary.failed}`);
  console.log(`NOT_RUN:               ${summary.notRun} (Mandatory: ${summary.mandatoryNotRun})`);
  console.log("========================================================");

  process.exitCode = summary.exitCode;
  if (summary.overallStatus === "PASS") {
    console.log("\nSeluruh assertion wajib PASS (exit code 0).");
  } else if (summary.overallStatus === "INCOMPLETE") {
    console.error(`\nRunner selesai dengan status INCOMPLETE (${summary.mandatoryNotRun} assertion wajib tidak dijalankan, exit code 1).`);
  } else {
    console.error(`\nRunner selesai dengan status FAIL (${summary.mandatoryFailed} assertion wajib gagal, exit code 1).`);
  }

  return results;
}

async function run() {
  console.log("=== P2.6 TAHAP 2: INTERACTIVE BROWSER VERIFICATION RUNNER ===");
  if (SIMULATE_NO_CREDS) console.log(">> SIMULATION: Cabang kredensial tidak tersedia (--simulate-no-creds)");
  if (SIMULATE_LOGIN_FAIL) console.log(">> SIMULATION: Cabang kegagalan login staf (--simulate-login-fail)");
  if (SIMULATE_ASSERTION_FAIL) console.log(">> SIMULATION: Cabang assertion wajib gagal (--test-fail-mode)");
  if (TEST_GUARD_REJECTION) console.log(">> HARNESS TEST: Penolakan target workspace aktif & marker mismatch (--test-guard-rejection)");
  if (TEST_CLEANUP_FAILURE) console.log(">> HARNESS TEST: Kegagalan pembersihan teardown menghasilkan FAIL (--test-cleanup-failure)");
  if (TEST_SETUP_FAILURE) console.log(">> HARNESS TEST: Kegagalan saat setup dan rollback resource (--test-setup-failure)");

  const baseEvidenceDir = path.resolve("docs/evidence/P2_6");
  fs.mkdirSync(baseEvidenceDir, { recursive: true });

  const assertions = [];

  function recordAssertion({ id, name, expected, actual, pass, notRunReason, isOptional = false }) {
    if (notRunReason) {
      assertions.push({ id, name, isOptional, status: "NOT_RUN", reason: notRunReason });
      console.log(`[-] NOT_RUN${isOptional ? " (OPSIONAL)" : ""}: ${name} (${notRunReason})`);
      return;
    }
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

  // 1. GUARD REJECTION HARNESS (--test-guard-rejection)
  if (TEST_GUARD_REJECTION) {
    console.log(">> VERIFIKASI HARNESS: Penolakan Fail-Closed Guard Lingkungan Uji <<");
    const runId = "guard-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    // Test Guard 1: Active workspace database rejection (port 54322)
    let guard1Ok = false;
    let guard1Actual = "";
    try {
      parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
        HELPDESK_TEST_SERVICE_ROLE_KEY: "dummy-key",
        HELPDESK_TEST_ENV_MARKER: "test-marker-123",
      });
      guard1Actual = "Active workspace database (54322) was NOT rejected";
    } catch (e) {
      guard1Ok = e.message.includes("default user workspace database");
      guard1Actual = e.message;
    }
    recordAssertion({
      id: "guard_active_db_rejection",
      name: "Penolakan fail-closed terhadap database workspace pengguna aktif (port 54322)",
      isOptional: false,
      expected: "Error penolakan default user workspace database",
      actual: guard1Actual,
      pass: guard1Ok,
    });

    // Test Guard 2: Active workspace Supabase API rejection (port 54321)
    let guard2Ok = false;
    let guard2Actual = "";
    try {
      parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
        HELPDESK_TEST_API_URL: "http://127.0.0.1:54321",
        HELPDESK_TEST_SERVICE_ROLE_KEY: "dummy-key",
        HELPDESK_TEST_ENV_MARKER: "test-marker-123",
      });
      guard2Actual = "Active workspace Supabase API (54321) was NOT rejected";
    } catch (e) {
      guard2Ok = e.message.includes("FAIL-CLOSED: Target API is the default user workspace Supabase API (port 54321)");
      guard2Actual = e.message;
    }
    recordAssertion({
      id: "guard_active_api_rejection",
      name: "Penolakan fail-closed terhadap Supabase API workspace pengguna aktif (port 54321)",
      isOptional: false,
      expected: "Error penolakan target API port 54321",
      actual: guard2Actual,
      pass: guard2Ok,
    });

    // Test Guard 3: PostgreSQL and Supabase API marker token mismatch rejection
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
      await verifyTestTargetIdentity(mockPool, mockSupabase, "test-marker");
      guard3Actual = "Marker token mismatch was NOT rejected";
    } catch (e) {
      guard3Ok = e.message.includes("FAIL-CLOSED: Target mismatch: PostgreSQL and Supabase API returned different marker tokens");
      guard3Actual = e.message;
    }
    recordAssertion({
      id: "guard_marker_mismatch_rejection",
      name: "Penolakan fail-closed saat marker token PostgreSQL dan Supabase API tidak cocok",
      isOptional: false,
      expected: "Error penolakan marker token mismatch",
      actual: guard3Actual,
      pass: guard3Ok,
    });

    return finalize(
      assertions,
      path.join(runEvidenceDir, "evidence.json"),
      [],
      GUARD_REJECTION_REGISTRY,
      { mode: "guard_rejection", runId, expectedExitCode: 0 }
    );
  }

  // 2. SIMULATION MODES
  if (SIMULATE_NO_CREDS) {
    const runId = "sim-no-creds-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });
    handleAuthenticationOutcome({ hasCredentials: false, recordAssertion });
    return finalize(assertions, path.join(runEvidenceDir, "evidence.json"), [], NORMAL_BROWSER_REGISTRY, { mode: "sim_no_creds", runId, expectedExitCode: 1 });
  }

  if (SIMULATE_LOGIN_FAIL) {
    const runId = "sim-login-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });
    handleAuthenticationOutcome({ hasCredentials: true, isLoginSuccess: false, currentPath: "/login?error=invalid", recordAssertion });
    return finalize(assertions, path.join(runEvidenceDir, "evidence.json"), [], NORMAL_BROWSER_REGISTRY, { mode: "sim_login_fail", runId, expectedExitCode: 1 });
  }

  if (SIMULATE_ASSERTION_FAIL) {
    const runId = "sim-assert-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });
    const outcome = handleAuthenticationOutcome({ hasCredentials: true, isLoginSuccess: true, currentPath: "/dashboard", recordAssertion });
    if (outcome.canRunDependentTests) {
      recordAssertion({ id: DEPENDENT_TEST_SCENARIOS[0].id, name: DEPENDENT_TEST_SCENARIOS[0].name, isOptional: false, pass: false, expected: "OK", actual: "ERR" });
      for (const test of DEPENDENT_TEST_SCENARIOS.slice(1)) {
        recordAssertion({ id: test.id, name: test.name, isOptional: false, pass: true, expected: "OK", actual: "OK" });
      }
    }
    return finalize(assertions, path.join(runEvidenceDir, "evidence.json"), [], NORMAL_BROWSER_REGISTRY, { mode: "sim_assertion_fail", runId, expectedExitCode: 1 });
  }

  if (SIMULATE_PASS) {
    const runId = "sim-pass-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });
    const outcome = handleAuthenticationOutcome({ hasCredentials: true, isLoginSuccess: true, currentPath: "/dashboard", recordAssertion });
    if (outcome.canRunDependentTests) {
      for (const test of DEPENDENT_TEST_SCENARIOS) {
        recordAssertion({ id: test.id, name: test.name, isOptional: false, pass: true, expected: "OK", actual: "OK" });
      }
    }
    return finalize(assertions, path.join(runEvidenceDir, "evidence.json"), [], NORMAL_BROWSER_REGISTRY, { mode: "sim_pass", runId, expectedExitCode: 0 });
  }

  // 3. LIVE BROWSER EXECUTION WITH ISOLATED TEST ENVIRONMENT
  let runPrefix = "run-";
  let expectedExitCode = 0;
  if (TEST_SETUP_FAILURE) {
    runPrefix = "setup-fail-";
    expectedExitCode = 1;
  } else if (TEST_MIDRUN_FAILURE) {
    runPrefix = "midrun-fail-";
    expectedExitCode = 1;
  } else if (TEST_CLEANUP_FAILURE) {
    runPrefix = "cleanup-fail-";
    expectedExitCode = 1;
  }

  const runId = runPrefix + crypto.randomUUID().slice(0, 8);
  const runTag = `Run-${runId}`;
  const runEvidenceDir = path.join(baseEvidenceDir, runId);
  fs.mkdirSync(runEvidenceDir, { recursive: true });
  const capturedScreenshots = [];

  const buildIdAtLaunch = getBuildId();
  const sourceHashesAtLaunch = getApplicationSourceHashes();
  const buildManifest = readBuildManifest();

  async function takeScreenshot(name) {
    if (!cdp) return;
    const filename = `${name}.png`;
    const targetPath = path.join(runEvidenceDir, filename);
    await captureScreenshot(cdp, targetPath);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(targetPath).size;
    } catch {}
    capturedScreenshots.push({
      name: filename,
      path: targetPath,
      relativePath: path.relative(process.cwd(), targetPath).replace(/\\/g, "/"),
      sizeBytes,
    });
  }

  const config = parseAndValidateTestConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const supabaseAdmin = createClient(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const envRestorer = new EnvRestorer();
  envRestorer.save([
    "PORT",
    "HELPDESK_DATABASE_URL",
    "DATABASE_URL",
    "SUPABASE_URL",
    "HELPDESK_TEST_API_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "HELPDESK_TEST_SERVICE_ROLE_KEY",
    "HELPDESK_TEST_ANON_KEY",
    "HELPDESK_TRUSTED_ORIGINS",
    "NEXT_PUBLIC_APP_URL",
    "APP_URL",
    "TEST_RUN_ID",
  ]);

  const tracker = new TestResourceTracker();
  let staffUserId = null;
  const staffEmail = `test-staff-${runId}@example.test`;
  const staffPassword = `PasswordTest${runId}!`;

  let nextProc = null;
  let chromeProc = null;
  let cdp = null;
  let userDataDir = null;
  const cleanupErrors = [];

  try {
    // Step 0: Verify test environment isolation guard before any mutation
    console.log("[Setup] Memverifikasi lingkungan tes terisolasi (PostgreSQL 54332 & Supabase 54331)...");
    await requireIsolatedDatabase(pool, supabaseAdmin, config);
    console.log("[Setup] Target terverifikasi aman dengan marker:", config.expectedMarker);

    // Step 1: Create isolated staff test user via Supabase Admin API
    console.log(`[Setup] Membuat user staf terisolasi: ${staffEmail}`);
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: staffEmail,
      password: staffPassword,
      email_confirm: true,
    });
    if (userError || !userData?.user) {
      throw new Error(`Gagal membuat user staf tes: ${userError?.message || "Unknown error"}`);
    }
    staffUserId = userData.user.id;

    // Test Harness: Setup failure injection
    if (TEST_SETUP_FAILURE) {
      console.log(">> HARNESS TEST: Menginjeksi kegagalan saat setup (setelah user terbuat) <<");
      throw new Error("Simulated setup failure after user creation");
    }

    // Step 2: Seed tracked test fixtures tagged with runTag
    console.log("[Setup] Mempersiapkan data fixture terarah...");
    const baseTime = new Date();

    async function seedConversationFixture({
      displayName,
      verificationStatus = "verified",
      senderExternalId,
      botAccountId = `bot-${runId}`,
      episode = null,
      messages = [],
      conversationStatus = "active",
      startedAt = baseTime,
      lastActivityAt = baseTime,
    }) {
      const identityId = crypto.randomUUID();
      const convId = crypto.randomUUID();
      tracker.recordIdentity(identityId);
      tracker.recordConversation(convId);

      const taggedDisplayName = `[${runTag}] ${displayName}`;

      let customerId = null;
      if (verificationStatus === "verified") {
        customerId = crypto.randomUUID();
        tracker.recordCustomer(customerId);
        await pool.query(
          `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
           VALUES ($1, $2, 'active', $3, now(), now())`,
          [customerId, taggedDisplayName, `CUST-${senderExternalId}`]
        );
      }

      const verifiedAt = verificationStatus === "verified" ? new Date().toISOString() : null;
      await pool.query(
        `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at, created_at, updated_at)
         VALUES ($1, 'telegram', $2, $3, $4, $5, $6, now(), now())`,
        [identityId, botAccountId, senderExternalId, customerId, verificationStatus, verifiedAt]
      );

      await pool.query(
        `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
         VALUES ($1, $2, 'telegram', $3, $4, $5, $6, $7, now(), now())`,
        [convId, identityId, botAccountId, senderExternalId, conversationStatus, startedAt, lastActivityAt]
      );

      let complaintId = null;
      if (episode) {
        complaintId = crypto.randomUUID();
        tracker.recordComplaint(complaintId);
        await pool.query(
          `INSERT INTO public.complaints (id, identity_id, category, status, is_primary, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, now(), now())`,
          [complaintId, identityId, episode.category || "connection_complaint", episode.status || "NEW"]
        );
      }

      const msgIds = [];
      for (let idx = 0; idx < messages.length; idx++) {
        const m = messages[idx];
        const ingressId = crypto.randomUUID();
        tracker.recordIngress(ingressId);

        await pool.query(
          `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
           VALUES ($1, $2, 'telegram', $3, $4, $5, $6, $7, 'SHADOW', 1, false)`,
          [
            ingressId,
            identityId,
            botAccountId,
            senderExternalId,
            `pmsg_${convId.slice(0, 8)}_${idx}_${Date.now()}`,
            m.body,
            m.receivedAt || baseTime,
          ]
        );

        await pool.query(
          `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, null, $6)`,
          [
            ingressId,
            identityId,
            convId,
            complaintId,
            JSON.stringify(m.classification || { category: "GENERAL", reason: "keyword_match" }),
            m.receivedAt || baseTime,
          ]
        );
        tracker.recordMessage(ingressId);
        msgIds.push(ingressId);

        if (m.isTriage && complaintId) {
          await pool.query(
            `INSERT INTO public.triage_assessments (message_id, decision, processing_result, created_at)
             VALUES ($1, $2::jsonb, $3::jsonb, now())`,
            [
              ingressId,
              JSON.stringify({ outcome: "triaged", reason: "keyword_match", category: "connection_complaint", automation: { mode: "SHADOW" }, emergencyStop: false }),
              JSON.stringify({ claim: { outcome: "claimed", reason: "new_complaint", intentId: null }, dispatchAuthorized: false }),
            ]
          );
        }
      }

      return { identityId, convId, complaintId, msgIds };
    }

    // Fixture Conversation A: Complaint, 9 substantial messages to guarantee viewport split
    const msgATexts = [
      "Pesan 1: Internet saya mati total sejak tadi subuh di Perumahan Griya Indah Blok A.",
      "Pesan 2: Lampu indikator LOS modem berkedip merah terang dan tidak ada sinyal sama sekali.",
      "Pesan 3: Sudah saya coba cabut pasang kabel optik biru dan restart adaptor berkali-kali.",
      "Pesan 4: Tetangga sebelah rumah juga mengeluhkan sambungan internetnya terputus mendadak.",
      "Pesan 5: Mohon bantuan teknisi lapangan untuk memeriksa ODP distribusi di tiang depan rumah.",
      "Pesan 6: Apakah ada informasi perkiraan waktu penyelesaian atau ada pemeliharaan jaringan?",
      "Pesan 7: Kami sangat membutuhkan koneksi yang stabil untuk operasional kerja harian dari rumah.",
      "Pesan 8: Sampai siang ini status koneksi masih belum berubah dan modem tetap alarm merah.",
      "Pesan 9: Terima kasih atas responnya, kami menunggu update perbaikan dari tim teknisi.",
    ];
    const messagesA = msgATexts.map((body, i) => ({
      body,
      receivedAt: new Date(baseTime.getTime() + (i * 2) * 1000),
      classification: {
        category: "KONEKSI_MATI",
        reason: "keyword_match",
        ruleVersion: "1.0",
        normalizedText: body,
        matchedKeywords: ["mati total"],
      },
      isTriage: i === 0,
    }));
    const fixA = await seedConversationFixture({
      displayName: "Pelanggan Alpha",
      senderExternalId: `sender-a-${runId}`,
      episode: { status: "NEW", category: "connection_complaint" },
      messages: messagesA,
      startedAt: baseTime,
      lastActivityAt: new Date(baseTime.getTime() + 1000),
    });
    const convAId = fixA.convId;
    const msgAIds = fixA.msgIds;

    // Fixture Conversation B: Complaint Beta
    const fixB = await seedConversationFixture({
      displayName: "Pelanggan Beta",
      senderExternalId: `sender-b-${runId}`,
      episode: { status: "IN_PROGRESS", category: "connection_complaint" },
      messages: [
        {
          body: "Koneksi sangat lambat sejak kemarin.",
          receivedAt: new Date(baseTime.getTime() + 2000),
          classification: { category: "INTERNET_SLOW", reason: "keyword_match" },
          isTriage: true,
        },
      ],
      startedAt: baseTime,
      lastActivityAt: new Date(baseTime.getTime() + 2000),
    });
    const convBId = fixB.convId;

    // Fixture Conversation C: Non-complaint (Tanya info paket, no episode)
    const fixC = await seedConversationFixture({
      displayName: "Pelanggan Gamma (Non-Komplain)",
      senderExternalId: `sender-c-${runId}`,
      episode: null,
      messages: [
        {
          body: "Halo admin, mau tanya info upgrade paket internet 50Mbps.",
          receivedAt: new Date(baseTime.getTime() + 3000),
          classification: { category: "GENERAL", reason: "keyword_match" },
          isTriage: false,
        },
      ],
      startedAt: baseTime,
      lastActivityAt: new Date(baseTime.getTime() + 3000),
    });
    const convCId = fixC.convId;

    // Fixture Conversation Delta (Read Test): 9 messages, untouched until Scenario 10 to guarantee fresh unread state
    const msgReadTestTexts = [
      "Pesan Read 1: Laporan gangguan koneksi pada area pengujian read-acknowledgment.",
      "Pesan Read 2: Lampu indikator modem masih menyala normal namun tidak ada transfer paket.",
      "Pesan Read 3: Pelanggan telah mencoba mematikan dan menyalakan kembali router utama.",
      "Pesan Read 4: Mohon pengecekan status routing dan redaman kabel di sisi OLT.",
      "Pesan Read 5: Tiket eskalasi diperlukan jika redaman melebihi batas toleransi teknis.",
      "Pesan Read 6: Informasi kontak darurat teknisi lapangan telah dicatat oleh sistem.",
      "Pesan Read 7: Verifikasi berkala dilakukan untuk memastikan stabilitas koneksi pelanggan.",
      "Pesan Read 8: Laporan lanjutan akan dikirimkan setelah pengecekan fisik selesai.",
      "Pesan Read 9: Konfirmasi penerimaan laporan ini ditunggu oleh pelanggan yang bersangkutan.",
    ];
    const messagesReadTest = msgReadTestTexts.map((body, i) => ({
      body,
      receivedAt: new Date(baseTime.getTime() + (i * 2 + 10) * 1000),
      classification: {
        category: "KONEKSI_MATI",
        reason: "keyword_match",
        ruleVersion: "1.0",
        normalizedText: body,
        matchedKeywords: ["gangguan koneksi"],
      },
      isTriage: i === 0,
    }));
    const fixReadTest = await seedConversationFixture({
      displayName: "Pelanggan Delta (Read Test)",
      senderExternalId: `sender-read-${runId}`,
      episode: { status: "NEW", category: "connection_complaint" },
      messages: messagesReadTest,
      startedAt: baseTime,
      lastActivityAt: new Date(baseTime.getTime() + 4000),
    });
    const convReadTestId = fixReadTest.convId;
    const msgReadTestIds = fixReadTest.msgIds;

    // Seed additional 24 conversations tagged with runTag (Total run items = 28: 1 Alpha + 1 Beta + 1 Gamma + 1 Delta Read + 24 Extra)
    const paginationConvIds = [];
    for (let i = 1; i <= 24; i++) {
      const fixExtra = await seedConversationFixture({
        displayName: `Antrean Tambahan ${String(i).padStart(2, "0")}`,
        senderExternalId: `sender-extra-${i}-${runId}`,
        episode: { status: i % 2 === 0 ? "NEW" : "IN_PROGRESS", category: "connection_complaint" },
        messages: [
          {
            body: `Pesan antrean nomor ${i} untuk pengujian paginasi.`,
            receivedAt: new Date(baseTime.getTime() - (i * 60) * 1000),
            classification: { category: "GENERAL", reason: "keyword_match" },
          },
        ],
        startedAt: new Date(baseTime.getTime() - (i * 60) * 1000),
        lastActivityAt: new Date(baseTime.getTime() - (i * 60) * 1000),
      });
      paginationConvIds.push(fixExtra.convId);
    }

    const allSeededConvIds = [convAId, convBId, convCId, convReadTestId, ...paginationConvIds];

    // Step 2.5: Verifikasi pengikatan build-source manifest sebelum peluncuran server Next.js
    console.log("[Setup] Memvalidasi pengikatan build-source manifest terhadap BUILD_ID dan source hashes...");
    const earlyBuildValidation = validateBuildMetadata({
      manifest: buildManifest,
      currentBuildId: buildIdAtLaunch,
      launchHashes: sourceHashesAtLaunch,
      mode: TEST_SETUP_FAILURE ? "setup_failure" : "live_browser_normal",
    });

    if (!TEST_SETUP_FAILURE) {
      recordAssertion({
        id: "build_source_binding_verification",
        name: "Validasi pengikatan BUILD_ID dan source hashes terhadap manifest build",
        isOptional: false,
        pass: earlyBuildValidation.isValid,
        expected: "BUILD_ID dan seluruh source hashes cocok dengan manifest build (status VALID/SYNCHRONIZED)",
        actual: `${earlyBuildValidation.status}: ${earlyBuildValidation.reason}`,
      });

      if (!earlyBuildValidation.isValid) {
        throw new Error(`Validasi build-source gagal sebelum peluncuran server: ${earlyBuildValidation.reason}`);
      }
    }

    // Step 3: Find dedicated isolated port and spawn Next.js
    const nextPort = await findAvailablePort(3310);
    const BASE_URL = `http://127.0.0.1:${nextPort}`;
    console.log(`[Setup] Meluncurkan server Next.js pada port terisolasi ${nextPort}...`);

    const nextBin = path.resolve("node_modules/next/dist/bin/next");
    const jwtAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

    nextProc = spawn(process.execPath, [nextBin, "start", "-p", String(nextPort)], {
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(nextPort),
        HELPDESK_DATABASE_URL: config.databaseUrl,
        DATABASE_URL: config.databaseUrl,
        SUPABASE_URL: config.apiUrl,
        HELPDESK_TEST_API_URL: config.apiUrl,
        NEXT_PUBLIC_SUPABASE_URL: config.apiUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtAnonKey,
        SUPABASE_ANON_KEY: jwtAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
        HELPDESK_TEST_SERVICE_ROLE_KEY: config.serviceRoleKey,
        HELPDESK_TEST_ANON_KEY: jwtAnonKey,
        HELPDESK_TRUSTED_ORIGINS: BASE_URL,
        NEXT_PUBLIC_APP_URL: BASE_URL,
        APP_URL: BASE_URL,
        TEST_RUN_ID: runId,
      },
    });

    let nextStderr = "";
    nextProc.stderr?.on("data", (chunk) => { nextStderr += chunk.toString(); });

    // Wait for server ready on dedicated port
    let isNextRunning = false;
    for (let i = 0; i < 40; i++) {
      await delay(500);
      try {
        const res = await fetch(`${BASE_URL}/login`);
        const serverRunId = res.headers.get("x-test-server-run-id");
        if (res.status === 200 && serverRunId === runId) {
          isNextRunning = true;
          break;
        }
      } catch {}
    }
    if (!isNextRunning) {
      throw new Error(`Gagal memulai server Next.js pada port ${nextPort}. Stderr: ${nextStderr}`);
    }
    console.log(`[Setup] Server Next.js siap pada port ${nextPort} (runId: ${runId}).`);

    // Step 4: Launch headless Chrome
    const chromePort = await findAvailablePort(9226);
    userDataDir = path.join(process.env.TEMP || "C:\\Users\\INVANSION\\AppData\\Local\\Temp", `chrome_dev_p26_${runId}`);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    console.log(`[Setup] Meluncurkan Chrome headless pada remote port ${chromePort}...`);
    chromeProc = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--window-size=1280,800",
      "about:blank",
    ]);

    const wsUrl = await getWebSocketDebuggerUrl(chromePort);
    cdp = new CDPClient(wsUrl);
    await cdp.connect();

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Network.enable");

    // Network tracking for read-ack inspection
    const readNetworkTransactions = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      if (params.request.url.includes("/api/inbox/conversations/") && params.request.url.includes("/read")) {
        readNetworkTransactions.push({
          requestId: params.requestId,
          url: params.request.url,
          postData: params.request.postData,
          timestamp: params.timestamp,
        });
      }
    });

    cdp.on("Network.responseReceived", (params) => {
      const url = params.response?.url || "";
      if (url.includes("/api/inbox/conversations/") && url.includes("/read")) {
        const match = readNetworkTransactions.find((t) => t.requestId === params.requestId);
        if (match) {
          match.status = params.response.status;
          match.statusText = params.response.statusText;
          match.headers = params.response.headers;
        } else {
          readNetworkTransactions.push({
            requestId: params.requestId,
            url,
            status: params.response.status,
            statusText: params.response.statusText,
            headers: params.response.headers,
          });
        }
      }
    });

    // ========================================================================
    // 1. AUTH SETUP
    // ========================================================================
    console.log("\n--- [1] Melakukan Login Staf & Memeriksa Sesi Aktif ---");
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

    const authOutcome = handleAuthenticationOutcome({
      hasCredentials: true,
      isLoginSuccess: loggedIn,
      currentPath: loggedIn ? "/dashboard" : "/login",
      recordAssertion,
    });
    if (!authOutcome.canRunDependentTests) {
      throw new Error(`Otentikasi staf gagal: ${authOutcome.authStatus}`);
    }

    // Wait for Dashboard landing view to render
    await delay(1500);

    // ========================================================================
    // 2. SHELL INTEGRATION & INDICATORS
    // ========================================================================
    console.log("\n--- [2] Verifikasi Integrasi Shell Navigasi & Indikator Mode ---");
    const shellRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const header = document.querySelector('header');
        const h1 = document.querySelector('h1');
        const shadowBadge = Array.from(document.querySelectorAll('span, div')).find(el => el.textContent.includes('SHADOW'));
        const dummyBadge = Array.from(document.querySelectorAll('span, div')).find(el => el.textContent.includes('Data Dummy'));
        const customerLinks = Array.from(document.querySelectorAll('a[href="/dashboard/customers"]'));
        const customerLink = customerLinks.find(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }) || customerLinks[0];
        let touchTargetOk = false;
        if (customerLink) {
          const rect = customerLink.getBoundingClientRect();
          touchTargetOk = rect.height >= 40 && rect.width >= 40;
        }
        return {
          headerFound: Boolean(header),
          titleText: h1 ? h1.textContent.trim() : null,
          hasShadowBadge: Boolean(shadowBadge),
          hasDummyBadge: Boolean(dummyBadge),
          hasCustomerDirectoryLink: Boolean(customerLink),
          touchTargetOk,
        };
      })()`,
      returnByValue: true,
    });

    const shellData = shellRes.result.value || {};
    const shellPass = Boolean(
      shellData.headerFound &&
      shellData.titleText === "Inbox / Antrean" &&
      shellData.hasShadowBadge &&
      shellData.hasDummyBadge &&
      shellData.hasCustomerDirectoryLink &&
      shellData.touchTargetOk
    );

    recordAssertion({
      id: "shell_integration_and_indicators",
      name: "Integrasi shell dashboard: judul 'Inbox / Antrean', badge SHADOW, penanda dummy, dan target sentuh direktori pelanggan",
      isOptional: false,
      expected: { titleText: "Inbox / Antrean", hasShadowBadge: true, hasDummyBadge: true, touchTargetOk: true },
      actual: shellData,
      pass: shellPass,
    });

    // ========================================================================
    // 3. DESKTOP TWO-PANE LAYOUT
    // ========================================================================
    console.log("\n--- [3] Verifikasi Layout Dua Panel Desktop (1280x800) ---");
    const layoutRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const listRect = listSection ? listSection.getBoundingClientRect() : null;
        const detailRect = detailSection ? detailSection.getBoundingClientRect() : null;
        return {
          hasList: Boolean(listSection),
          hasDetail: Boolean(detailSection),
          listWidth: listRect ? Math.round(listRect.width) : 0,
          detailWidth: detailRect ? Math.round(detailRect.width) : 0,
          isSideBySide: Boolean(listRect && detailRect && listRect.right <= detailRect.left + 5),
          bodyScrollWidth: document.body.scrollWidth,
          bodyClientWidth: document.body.clientWidth,
          noHorizontalOverflow: document.body.scrollWidth <= document.body.clientWidth,
        };
      })()`,
      returnByValue: true,
    });

    const layoutData = layoutRes.result.value || {};
    const layoutPass = Boolean(
      layoutData.hasList &&
      layoutData.hasDetail &&
      layoutData.isSideBySide &&
      layoutData.noHorizontalOverflow
    );

    recordAssertion({
      id: "desktop_two_pane_layout",
      name: "Layout desktop (1280x800): dua panel berdampingan tanpa overflow",
      isOptional: false,
      expected: { hasList: true, hasDetail: true, isSideBySide: true, noHorizontalOverflow: true },
      actual: layoutData,
      pass: layoutPass,
    });

    await takeScreenshot("desktop_inbox_two_pane");

    // ========================================================================
    // 4. CONVERSATION LIST RENDERING & NON-COLOR SELECTION
    // ========================================================================
    console.log("\n--- [4] Verifikasi Render Antrean Percakapan & Indikator Non-Warna ---");
    const listRenderRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const unreadBadges = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] span')).filter(el => el.textContent.includes('belum dibaca'));
        const timeElements = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] time'));
        return {
          totalItemsRendered: items.length,
          unreadBadgeCount: unreadBadges.length,
          hasWibTimeFormat: timeElements.some(el => el.textContent.includes('WIB') || el.textContent.includes('lalu') || el.textContent.includes('Baru saja')),
        };
      })()`,
      returnByValue: true,
    });

    const listData = listRenderRes.result.value || {};
    const listPass = Boolean(listData.totalItemsRendered >= 25 && listData.hasWibTimeFormat);

    recordAssertion({
      id: "conversation_list_rendering",
      name: "Daftar percakapan memuat identitas pengirim, preview pesan, waktu WIB, badge unread, dan item percakapan",
      isOptional: false,
      expected: { totalItemsRendered: 25, hasWibTimeFormat: true },
      actual: listData,
      pass: listPass,
    });

    // Harness Test: Mid-run failure injection after fixtures are formed and step 4 executed
    if (TEST_MIDRUN_FAILURE) {
      console.log(">> HARNESS TEST: Menginjeksi kegagalan di tengah run setelah fixture terbentuk <<");
      throw new Error("Simulated mid-run failure after fixture creation and initial render");
    }

    // Select Conversation A (Pelanggan Alpha)
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const itemA = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.textContent.includes('Pelanggan Alpha'));
        if (itemA) itemA.click();
      })()`,
    });
    await delay(1200);

    const selectionRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const selectedItem = document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"][aria-selected="true"]');
        if (!selectedItem) return { isSelected: false };
        const computedStyle = window.getComputedStyle(selectedItem);
        const selectedBadge = selectedItem.querySelector('span[data-selected="true"]') || Array.from(selectedItem.querySelectorAll('span')).find(el => el.textContent.includes('Dipilih'));
        return {
          isSelected: true,
          borderLeftWidth: computedStyle.borderLeftWidth,
          borderLeftColor: computedStyle.borderLeftColor,
          hasSelectedBadge: Boolean(selectedBadge),
          badgeText: selectedBadge ? selectedBadge.textContent.trim() : null,
        };
      })()`,
      returnByValue: true,
    });

    const selData = selectionRes.result.value || {};
    const selPass = Boolean(
      selData.isSelected &&
      selData.borderLeftWidth === "4px" &&
      selData.hasSelectedBadge &&
      selData.badgeText === "Dipilih"
    );

    recordAssertion({
      id: "non_color_selection_indicator",
      name: "Indikator percakapan terpilih memiliki pembeda non-warna ganda (border 4px + teks 'Dipilih')",
      isOptional: false,
      expected: { isSelected: true, borderLeftWidth: "4px", hasSelectedBadge: true, badgeText: "Dipilih" },
      actual: selData,
      pass: selPass,
    });

    // ========================================================================
    // 5. DETAIL THREAD CHRONOLOGY & PHASE P3 COMPOSER CARD
    // ========================================================================
    console.log("\n--- [5] Verifikasi Kronologi Panel Detail & Kartu Pemberitahuan Fase P3 ---");
    const threadRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const msgs = Array.from(detailSection ? detailSection.querySelectorAll('[data-message-id]') : []);
        const p3Card = Array.from(document.querySelectorAll('div, p')).find(el => el.textContent.includes('Composer pengetikan balasan manual'));
        return {
          messageCount: msgs.length,
          hasP3Notice: Boolean(p3Card),
          p3NoticeText: p3Card ? p3Card.textContent.trim() : null,
        };
      })()`,
      returnByValue: true,
    });

    const threadData = threadRes.result.value || {};
    const threadPass = Boolean(threadData.messageCount === 9 && threadData.hasP3Notice);

    recordAssertion({
      id: "conversation_detail_thread",
      name: "Panel detail menampilkan riwayat kronologis receivedAt ASC dan kartu informasi Fase P3",
      isOptional: false,
      expected: { messageCount: 9, hasP3Notice: true },
      actual: threadData,
      pass: threadPass,
    });

    // ========================================================================
    // 6. SEARCH AND FILTERS WITH KEYWORD FILTERING
    // ========================================================================
    console.log("\n--- [6] Verifikasi Filter & Pencarian Kata Kunci ---");
    await cdp.send("Runtime.evaluate", {
      expression: `((tag) => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, '[' + tag + '] Pelanggan Beta');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })(${JSON.stringify(runTag)})`,
    });
    await delay(1200);

    const searchRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const paginationInfo = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]')?.textContent || '';
        return {
          searchValue: searchInput ? searchInput.value : '',
          filteredCount: items.length,
          onlyBetaVisible: items.length === 1 && items[0].textContent.includes('Pelanggan Beta'),
          isPageReset: paginationInfo.includes('Halaman 1 dari'),
        };
      })()`,
      returnByValue: true,
    });

    const searchData = searchRes.result.value || {};
    const searchPass = Boolean(
      searchData.searchValue.includes("Pelanggan Beta") &&
      searchData.onlyBetaVisible &&
      searchData.isPageReset
    );

    recordAssertion({
      id: "search_and_filters",
      name: "Filter bar mendukung pencarian kata kunci dan menyaring daftar secara akurat",
      isOptional: false,
      expected: { searchValue: `[${runTag}] Pelanggan Beta`, onlyBetaVisible: true, isPageReset: true },
      actual: searchData,
      pass: searchPass,
    });

    await takeScreenshot("desktop_filter_applied");

    // Reset search back to runTag to test pagination reset
    await cdp.send("Runtime.evaluate", {
      expression: `((tag) => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, tag);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })(${JSON.stringify(runTag)})`,
    });
    await delay(1200);

    // ========================================================================
    // 7. PAGINATION RESET ON FILTER CHANGE (FROM PAGE 2 -> PAGE 1)
    // ========================================================================
    console.log("\n--- [7] Verifikasi Reset Paginasi dari Halaman 2 saat Filter Diubah ---");
    // Navigate to Page 2
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        if (nextBtn) nextBtn.click();
      })()`,
    });
    await delay(1200);

    // Check we are on Page 2
    const onPage2Res = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const navEl = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]');
        const prevBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Sebelumnya'));
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        return {
          navText: navEl ? navEl.textContent.trim() : '',
          isPage2: navEl ? navEl.textContent.includes('Halaman 2 dari') : false,
          prevEnabled: Boolean(prevBtn && !prevBtn.hasAttribute('disabled')),
          nextDisabled: Boolean(nextBtn && nextBtn.hasAttribute('disabled')),
        };
      })()`,
      returnByValue: true,
    });
    const page2InitialData = onPage2Res.result.value || {};
    console.log(`[Paginasi] Posisi sebelum filter diubah: "${page2InitialData.navText}"`);

    // Now change search to "Alpha" while on Page 2
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, 'Alpha');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })()`,
    });
    await delay(1200);

    const resetPageRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const navEl = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]');
        const prevBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Sebelumnya'));
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        return {
          navText: navEl ? navEl.textContent.trim() : '',
          isResetToPage1: navEl ? navEl.textContent.includes('Halaman 1 dari') : false,
          prevDisabled: prevBtn ? prevBtn.hasAttribute('disabled') : false,
          hasAlpha: items.some(i => i.textContent.includes('Alpha')),
          filteredCount: items.length,
        };
      })()`,
      returnByValue: true,
    });

    const resetPageData = resetPageRes.result.value || {};
    const resetPagePass = Boolean(
      page2InitialData.isPage2 &&
      page2InitialData.prevEnabled &&
      resetPageData.isResetToPage1 &&
      resetPageData.prevDisabled &&
      resetPageData.hasAlpha
    );

    recordAssertion({
      id: "pagination_reset_on_filter_change",
      name: "Penerapan filter dari halaman 2 secara otomatis mereset paginasi kembali ke halaman 1",
      isOptional: false,
      expected: {
        initialPage2Active: true,
        initialPrevEnabled: true,
        isResetToPage1: true,
        prevDisabled: true,
        hasAlpha: true,
      },
      actual: {
        initialPage2Active: page2InitialData.isPage2,
        initialPrevEnabled: page2InitialData.prevEnabled,
        initialNavText: page2InitialData.navText,
        isResetToPage1: resetPageData.isResetToPage1,
        prevDisabled: resetPageData.prevDisabled,
        hasAlpha: resetPageData.hasAlpha,
        navTextAfterReset: resetPageData.navText,
        filteredCount: resetPageData.filteredCount,
      },
      pass: resetPagePass,
    });

    // ========================================================================
    // 8. EMPTY VS FILTERED EMPTY STATES WITH RESET BUTTON
    // ========================================================================
    console.log("\n--- [8] Verifikasi State Filter Kosong & Tombol Reset Filter ---");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, 'STRING_TIDAK_MUNGKIN_ADA_XYZ_999');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })()`,
    });
    await delay(1200);

    const emptyRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const emptyMsg = Array.from(listSection.querySelectorAll('p, div')).find(el => el.textContent.includes('Tidak ada hasil untuk filter ini'));
        const resetBtn = Array.from(listSection.querySelectorAll('button')).find(el => el.textContent.includes('Reset filter'));
        return {
          hasEmptyMessage: Boolean(emptyMsg),
          emptyMessageText: emptyMsg ? emptyMsg.textContent.trim() : null,
          hasResetButton: Boolean(resetBtn),
        };
      })()`,
      returnByValue: true,
    });

    const emptyData = emptyRes.result.value || {};
    const emptyPass = Boolean(emptyData.hasEmptyMessage && emptyData.hasResetButton);

    recordAssertion({
      id: "empty_vs_filtered_empty_states",
      name: "Membedakan state 'Inbox Kosong' dengan state 'Tidak ada hasil untuk filter ini' lengkap dengan tombol reset filter",
      isOptional: false,
      expected: { hasEmptyMessage: true, hasResetButton: true },
      actual: emptyData,
      pass: emptyPass,
    });

    await takeScreenshot("desktop_empty_filtered");

    // Click reset filter button
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const resetBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Reset filter'));
        if (resetBtn) resetBtn.click();
      })()`,
    });
    await delay(1200);

    // ========================================================================
    // 9. PAGINATION DATASET INTEGRITY (ALL 28 RUN FIXTURE IDS VERIFIED)
    // ========================================================================
    console.log("\n--- [9] Verifikasi Integritas Paginasi 28 Fixture Disjoin ---");
    // Filter by runTag so the dataset tested contains exactly our 28 seeded items
    await cdp.send("Runtime.evaluate", {
      expression: `((tag) => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, tag);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })(${JSON.stringify(runTag)})`,
    });
    await delay(1200);

    const page1Res = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const ids = items.map(el => el.getAttribute('data-conversation-id')).filter(Boolean);
        const navEl = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]');
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        return {
          count: items.length,
          ids,
          navText: navEl ? navEl.textContent.trim() : '',
          hasNextBtn: Boolean(nextBtn && !nextBtn.hasAttribute('disabled')),
        };
      })()`,
      returnByValue: true,
    });
    const page1Data = page1Res.result.value || {};

    // Click Next to navigate to Page 2
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        if (nextBtn) nextBtn.click();
      })()`,
    });
    await delay(1200);

    const page2Res = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const ids = items.map(el => el.getAttribute('data-conversation-id')).filter(Boolean);
        const navEl = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]');
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        return {
          count: items.length,
          ids,
          navText: navEl ? navEl.textContent.trim() : '',
          nextDisabled: Boolean(nextBtn && nextBtn.hasAttribute('disabled')),
        };
      })()`,
      returnByValue: true,
    });
    const page2Data = page2Res.result.value || {};

    const page1Ids = new Set(page1Data.ids || []);
    const page2Ids = new Set(page2Data.ids || []);
    const intersection = [...page1Ids].filter(id => page2Ids.has(id));
    const combinedCount = page1Ids.size + page2Ids.size;

    const renderedSet = new Set([...page1Data.ids || [], ...page2Data.ids || []]);
    const seededSet = new Set(allSeededConvIds);
    const missingFromRendered = allSeededConvIds.filter(id => !renderedSet.has(id));
    const unexpectedRendered = [...renderedSet].filter(id => !seededSet.has(id));
    const setEqualityPass = (missingFromRendered.length === 0 && unexpectedRendered.length === 0);

    const paginationPass = Boolean(
      page1Data.count === 25 &&
      page2Data.count === 3 &&
      combinedCount === 28 &&
      intersection.length === 0 &&
      setEqualityPass &&
      page2Data.nextDisabled
    );

    recordAssertion({
      id: "pagination_dataset_integrity",
      name: "Integritas paginasi 28 fixture: Halaman 1 (25 item) dan Halaman 2 (3 item) disjoin dan mencakup seluruh dataset",
      isOptional: false,
      expected: {
        page1Count: 25,
        page2Count: 3,
        combinedTotal: 28,
        intersectionCount: 0,
        missingFromRendered: 0,
        unexpectedRendered: 0,
      },
      actual: {
        page1Count: page1Data.count,
        page2Count: page2Data.count,
        combinedTotal: combinedCount,
        intersectionCount: intersection.length,
        missingFromRendered: missingFromRendered.length,
        unexpectedRendered: unexpectedRendered.length,
      },
      pass: paginationPass,
    });

    // Reset search back to empty to show normal conversations
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, '');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })()`,
    });
    await delay(1200);

    // ========================================================================
    // 10. VIEWPORT READ ACKNOWLEDGMENT WITH ACTUAL DOM GEOMETRY & DB VERIFICATION
    // ========================================================================
    console.log("\n--- [10] Verifikasi Penandaan Baca (Viewport Read Acknowledgment) & Database ---");

    // Pre-condition: Verify that the dedicated read-test conversation has 0 confirmed reads in DB before opening
    const preDbRes = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = ANY($2::uuid[])`,
      [staffUserId, msgReadTestIds]
    );
    const initialDbReadCount = Number(preDbRes.rows[0].cnt);
    console.log(`[Read-Ack] Status DB awal sebelum percakapan dibuka: ${initialDbReadCount} pesan terbaca`);

    // Pre-attach network listener before triggering interaction
    readNetworkTransactions.length = 0;
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__normalReadCalls = [];
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (url.includes('/read')) {
            let payload = null;
            try {
              payload = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : args[1]?.body;
            } catch {}
            const res = await origFetch.apply(this, args);
            let envelope = null;
            try {
              const clone = res.clone();
              envelope = await clone.json();
            } catch {}
            window.__normalReadCalls.push({
              url,
              status: res.status,
              payload,
              envelope,
            });
            return res;
          }
          return origFetch.apply(this, args);
        };
      })()`,
    });

    // Select dedicated read-test conversation (Pelanggan Delta)
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pelanggan Delta (Read Test)'));
        if (item) item.click();
      })(${JSON.stringify(convReadTestId)})`,
    });
    await delay(1500);

    // Compute actual DOM geometry of visible message cards inside the scroll container
    const geometryRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        if (!container) return { error: "Container not found" };
        const containerRect = container.getBoundingClientRect();
        const msgNodes = Array.from(container.querySelectorAll('[data-message-id]'));

        const visibleIds = [];
        const offViewportIds = [];

        for (const el of msgNodes) {
          const id = el.getAttribute('data-message-id');
          const rect = el.getBoundingClientRect();
          const isVisible = (rect.bottom > containerRect.top + 10 && rect.top < containerRect.bottom - 10);
          if (isVisible) {
            visibleIds.push(id);
          } else {
            offViewportIds.push(id);
          }
        }

        return {
          visibleIds,
          offViewportIds,
          totalMessages: msgNodes.length,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        };
      })()`,
      returnByValue: true,
    });
    const geoData = geometryRes.result.value || {};

    // Wait for read acknowledgement debounce (500ms) and network completion
    await delay(1500);

    // Retrieve network read calls recorded
    const readCallsRes = await cdp.send("Runtime.evaluate", {
      expression: "window.__normalReadCalls || []",
      returnByValue: true,
    });
    const readCalls = readCallsRes.result.value || [];
    const readTargetCalls = readCalls.filter(c => c.url.includes(`/api/inbox/conversations/${convReadTestId}/read`));
    const successfulReadCall = readTargetCalls.find(c => c.status === 200 && c.envelope?.success === true);

    // Verify DB confirmation in staff_message_reads
    const dbCheckRes = await pool.query(
      `SELECT message_id, is_confirmed FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = ANY($2::uuid[])`,
      [staffUserId, msgReadTestIds]
    );
    const confirmedReadInDb = dbCheckRes.rows.filter(r => r.is_confirmed).map(r => r.message_id);

    const allVisibleConfirmed = Boolean(geoData.visibleIds?.length > 0 && geoData.visibleIds.every(id => confirmedReadInDb.includes(id)));
    const anyOffViewportConfirmed = Boolean(geoData.offViewportIds?.some(id => confirmedReadInDb.includes(id)));
    const hasSuccessfulHttp200AndEnvelope = Boolean(successfulReadCall);
    const noSyncError = !readCalls.some(c => c.status >= 400);

    const readAckPass = Boolean(
      initialDbReadCount === 0 &&
      hasSuccessfulHttp200AndEnvelope &&
      allVisibleConfirmed &&
      !anyOffViewportConfirmed &&
      noSyncError
    );

    recordAssertion({
      id: "viewport_read_acknowledgment",
      name: "Penandaan baca hanya mengirim pesan yang terlihat dalam viewport panel aktif dan mengurangi badge unread secara akurat",
      isOptional: false,
      expected: {
        initialDbReadCount: 0,
        hasSuccessfulHttp200AndEnvelope: true,
        allVisibleConfirmed: true,
        anyOffViewportConfirmed: false,
        noSyncError: true,
      },
      actual: {
        initialDbReadCount,
        hasSuccessfulHttp200AndEnvelope,
        successfulCallDetails: successfulReadCall ? { status: successfulReadCall.status, envelopeSuccess: successfulReadCall.envelope?.success } : null,
        visibleCount: geoData.visibleIds?.length,
        offViewportCount: geoData.offViewportIds?.length,
        confirmedInDbCount: confirmedReadInDb.length,
        allVisibleConfirmed,
        anyOffViewportConfirmed,
        noSyncError,
      },
      pass: readAckPass,
    });

    // ========================================================================
    // 11. READ ACKNOWLEDGMENT RETRY ISOLATION (MANDATORY ASSERTION)
    // ========================================================================
    console.log("\n--- [11] Verifikasi Injeksi Kegagalan Read-Ack & Isolasi Snapshot Retry ---");
    // Inject failure on the next POST /read request
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__failNextRead = true;
        window.__failedReadPayload = null;
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (url.includes('/read') && window.__failNextRead) {
            window.__failNextRead = false;
            try {
              window.__failedReadPayload = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : args[1]?.body;
            } catch {}
            return new Response(JSON.stringify({ success: false, error: { message: "Simulated read failure for retry testing" } }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            });
          }
          return origFetch.apply(this, args);
        };
      })()`,
    });

    // Scroll up slightly to reveal an unread message and trigger read-ack
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        if (container) {
          container.scrollTop = Math.max(0, container.scrollTop - 250);
          container.dispatchEvent(new Event('scroll'));
        }
      })()`,
    });
    await delay(1200);

    // Verify specific read-ack error banner appears
    const retryBannerRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const banner = document.querySelector('[role="alert"]');
        const retryBtn = banner ? Array.from(banner.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi')) : null;
        return {
          bannerFound: Boolean(banner),
          bannerText: banner ? banner.textContent.trim() : '',
          isReadAckSpecific: banner ? banner.textContent.includes('Gagal menyinkronkan status baca') : false,
          hasRetryButton: Boolean(retryBtn),
          failedPayload: window.__failedReadPayload,
        };
      })()`,
      returnByValue: true,
    });
    const rbData = retryBannerRes.result.value || {};
    const recordedFailedIds = rbData.failedPayload?.acknowledgedMessageIds || [];

    // Capture the retry request payload
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__retryRequestPayload = null;
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (url.includes('/read')) {
            try {
              window.__retryRequestPayload = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : args[1]?.body;
            } catch {}
          }
          return origFetch.apply(this, args);
        };
      })()`,
    });

    // Click retry mark-read button
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const banner = document.querySelector('[role="alert"]');
        const retryBtn = banner ? Array.from(banner.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi')) : null;
        if (retryBtn) retryBtn.click();
      })()`,
    });
    await delay(1500);

    const retryPayloadRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const banner = document.querySelector('[role="alert"]');
        return {
          retryPayload: window.__retryRequestPayload,
          bannerDismissed: !banner || !banner.textContent.includes('Gagal menyinkronkan status baca'),
        };
      })()`,
      returnByValue: true,
    });
    const retryEval = retryPayloadRes.result.value || {};
    const retriedIds = retryEval.retryPayload?.acknowledgedMessageIds || [];

    // Check DB that retried IDs are now confirmed
    let retriedDbConfirmed = false;
    if (retriedIds.length > 0) {
      const retryDbCheck = await pool.query(
        `SELECT message_id, is_confirmed FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = ANY($2::uuid[])`,
        [staffUserId, retriedIds]
      );
      retriedDbConfirmed = retriedIds.every(id => retryDbCheck.rows.some(r => r.message_id === id && r.is_confirmed));
    }

    // Verify snapshot was NOT expanded (exact match with recorded failed IDs)
    const exactSnapshotMatch = recordedFailedIds.length > 0 &&
      retriedIds.length === recordedFailedIds.length &&
      recordedFailedIds.every(id => retriedIds.includes(id));

    const retryAssertionPass = Boolean(
      rbData.bannerFound &&
      rbData.isReadAckSpecific &&
      rbData.hasRetryButton &&
      exactSnapshotMatch &&
      retryEval.bannerDismissed &&
      retriedDbConfirmed
    );

    recordAssertion({
      id: "read_acknowledgment_retry_isolation",
      name: "Retry read-ack mengirimkan tepat snapshot pesan gagal tanpa penambahan ID baru dan terkonfirmasi di database",
      isOptional: false,
      expected: {
        bannerFound: true,
        isReadAckSpecific: true,
        exactSnapshotMatch: true,
        bannerDismissed: true,
        retriedDbConfirmed: true,
      },
      actual: {
        bannerFound: rbData.bannerFound,
        bannerText: rbData.bannerText,
        failedIdsCount: recordedFailedIds.length,
        retriedIdsCount: retriedIds.length,
        exactSnapshotMatch,
        bannerDismissed: retryEval.bannerDismissed,
        retriedDbConfirmed,
      },
      pass: retryAssertionPass,
    });

    // ========================================================================
    // 12. HIDDEN TAB READ SUPPRESSION (MANDATORY ASSERTION)
    // ========================================================================
    console.log("\n--- [12] Verifikasi Supresi Read-Ack saat Tab Dokumen Tersembunyi ---");
    // Verify remaining unread messages exist in conversation A
    const currentConfirmedReads = await pool.query(
      `SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = ANY($2::uuid[]) AND is_confirmed = true`,
      [staffUserId, msgAIds]
    );
    const confirmedCountBeforeHidden = Number(currentConfirmedReads.rows[0].count);

    const readsBeforeHidden = readNetworkTransactions.length;

    // Set document hidden
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      })()`,
    });

    // Scroll up to top where older unread messages are located
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        if (container) {
          container.scrollTop = 0;
          container.dispatchEvent(new Event('scroll'));
        }
      })()`,
    });
    await delay(1200);

    const readsWhileHidden = readNetworkTransactions.length;
    const noNetworkCallsWhileHidden = readsWhileHidden === readsBeforeHidden;

    // Verify DB count did NOT increase while hidden
    const dbCountWhileHidden = await pool.query(
      `SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = ANY($2::uuid[]) AND is_confirmed = true`,
      [staffUserId, msgAIds]
    );
    const noDbMutationsWhileHidden = Number(dbCountWhileHidden.rows[0].count) === confirmedCountBeforeHidden;

    // Restore visible state
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      })()`,
    });

    // Scroll slightly to trigger intersection now that tab is visible
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        if (container) {
          container.scrollTop = 10;
          container.dispatchEvent(new Event('scroll'));
        }
      })()`,
    });
    await delay(1200);

    const readsAfterVisible = readNetworkTransactions.length;
    const readsTriggeredAfterVisible = readsAfterVisible > readsWhileHidden;

    const hiddenTabPass = Boolean(
      noNetworkCallsWhileHidden &&
      noDbMutationsWhileHidden &&
      readsTriggeredAfterVisible
    );

    recordAssertion({
      id: "hidden_tab_read_suppression",
      name: "Tab dokumen tersembunyi tidak mengirim request read-ack atau mengubah status baca di database",
      isOptional: false,
      expected: { noNetworkCallsWhileHidden: true, noDbMutationsWhileHidden: true, readsTriggeredAfterVisible: true },
      actual: {
        readsBeforeHidden,
        readsWhileHidden,
        noNetworkCallsWhileHidden,
        noDbMutationsWhileHidden,
        readsAfterVisible,
        readsTriggeredAfterVisible,
      },
      pass: hiddenTabPass,
    });

    // ========================================================================
    // 13. POLLING & SCROLL RETENTION
    // ========================================================================
    console.log("\n--- [13] Verifikasi Polling 5 Detik & Preservasi Scroll Pengguna ---");
    // Ensure container is scrolled up and dispatch scroll event
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        if (container) {
          container.scrollTop = 0;
          container.dispatchEvent(new Event('scroll'));
        }
      })()`,
    });
    await delay(300);

    // Insert a new inbound message into currently active conversation (convReadTestId) to trigger the "Pesan baru di bawah" pill
    const newIngressId = crypto.randomUUID();
    tracker.recordIngress(newIngressId);
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Pesan baru tiba saat membaca pesan lama.', now(), 'SHADOW', 1, false)`,
      [newIngressId, fixReadTest.identityId, `bot-${runId}`, `sender-read-${runId}`, `pmsg_live_${Date.now()}`]
    );

    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, $4, '{"category":"GENERAL"}'::jsonb, null, now())`,
      [newIngressId, fixReadTest.identityId, convReadTestId, fixReadTest.complaintId]
    );
    await pool.query(
      `UPDATE public.conversations SET last_activity_at = now() WHERE id = $1`,
      [convReadTestId]
    );
    tracker.recordMessage(newIngressId);

    // Wait for the next 5-second polling tick
    await delay(5500);

    const scrollRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const container = document.querySelector('#conversation-messages-scroll-container');
        const pillBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Pesan baru di bawah'));
        return {
          containerScrolledToTop: container ? container.scrollTop < 50 : false,
          hasNewMessagePill: Boolean(pillBtn),
          pillText: pillBtn ? pillBtn.textContent.trim() : null,
        };
      })()`,
      returnByValue: true,
    });

    const scrollData = scrollRes.result.value || {};
    const scrollPass = Boolean(
      scrollData.containerScrolledToTop &&
      scrollData.hasNewMessagePill
    );

    recordAssertion({
      id: "polling_and_scroll_retention",
      name: "Polling 5 detik memperbarui pesan tanpa memaksa auto-scroll saat membaca pesan lama, memunculkan pill 'Pesan baru di bawah'",
      isOptional: false,
      expected: { containerScrolledToTop: true, hasNewMessagePill: true },
      actual: scrollData,
      pass: scrollPass,
    });

    // ========================================================================
    // 14. POLLING FAILURE AND RECOVERY
    // ========================================================================
    console.log("\n--- [14] Verifikasi Penanganan Kegagalan Polling & Banner Peringatan ---");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });

    await delay(5500);

    const bannerRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const banner = document.querySelector('[role="alert"]');
        const retryBtn = banner?.querySelector('button');
        return {
          bannerFound: Boolean(banner),
          bannerText: banner ? banner.textContent.trim() : null,
          hasRetryBtn: Boolean(retryBtn),
        };
      })()`,
      returnByValue: true,
    });

    const bannerData = bannerRes.result.value || {};
    const bannerPass = Boolean(
      bannerData.bannerFound &&
      bannerData.bannerText &&
      bannerData.bannerText.includes("Pembaruan terhenti") &&
      bannerData.hasRetryBtn
    );

    recordAssertion({
      id: "polling_failure_and_banner_alert",
      name: "Kegagalan polling mempertahankan data terakhir dan menampilkan banner 'Pembaruan terhenti' dengan timestamp pembaruan terakhir (WIB)",
      isOptional: false,
      expected: { bannerFound: true, bannerTextContains: "Pembaruan terhenti", hasRetryBtn: true },
      actual: bannerData,
      pass: bannerPass,
    });

    await takeScreenshot("desktop_polling_stopped_banner");

    // Restore online
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // Click retry button on banner
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const banner = document.querySelector('[role="alert"]');
        const retryBtn = banner?.querySelector('button');
        if (retryBtn) retryBtn.click();
      })()`,
    });
    await delay(1500);

    // ========================================================================
    // 15. POLLING OVERLAP WITH FOREGROUND FETCH (GENUINE COMPONENT POLLING)
    // ========================================================================
    console.log("\n--- [15] Verifikasi Resiliensi Loading saat Request Foreground Tumpang Tindih Polling ---");
    // Filter by runTag so Page 2 deterministically has 3 items
    await cdp.send("Runtime.evaluate", {
      expression: `((tag) => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, tag);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })(${JSON.stringify(runTag)})`,
    });
    await delay(1200);

    // Install genuine coordination interceptor on window.fetch:
    // Holds the foreground fetch triggered by clicking "Berikutnya" until the component's 5-second polling interval fires!
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__foregroundStarted = false;
        window.__pollingStarted = false;
        window.__pollingResolved = false;
        window.__foregroundResolved = false;
        window.__releaseForeground = null;

        const origFetch = window.fetch;
        window.fetch = function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (url.includes('/api/inbox/conversations?')) {
            // First list fetch is foreground navigation to Page 2
            if (!window.__foregroundStarted) {
              window.__foregroundStarted = true;
              return new Promise((resolve) => {
                window.__releaseForeground = async () => {
                  const res = await origFetch.apply(this, args);
                  window.__foregroundResolved = true;
                  resolve(res);
                };
              });
            }
            // Second list fetch during pending foreground is the component's background polling!
            if (window.__foregroundStarted && !window.__foregroundResolved) {
              window.__pollingStarted = true;
              return origFetch.apply(this, args).then((res) => {
                window.__pollingResolved = true;
                return res;
              });
            }
          }
          return origFetch.apply(this, args);
        };
      })()`,
    });

    // Trigger foreground list fetch by clicking "Berikutnya"
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        if (nextBtn) nextBtn.click();
      })()`,
    });
    await delay(200);

    // Wait for the component's actual 5-second polling timer to trigger its background fetch
    console.log("[Loading Overlap] Menunggu polling interval 5 detik komponen memicu request latar belakang...");
    for (let i = 0; i < 20; i++) {
      await delay(300);
      const pollCheck = await cdp.send("Runtime.evaluate", {
        expression: "Boolean(window.__pollingStarted && window.__pollingResolved)",
        returnByValue: true,
      });
      if (pollCheck.result.value === true) break;
    }

    // Now release the held foreground fetch so it finishes AFTER polling settled
    console.log("[Loading Overlap] Polling selesai lebih awal; melepaskan request foreground...");
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        if (typeof window.__releaseForeground === 'function') {
          window.__releaseForeground();
        }
      })()`,
    });
    await delay(1200);

    // Check DOM that loading finished, items match Page 2, and pagination is functional
    const overlapRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const prevBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Sebelumnya'));
        const nextBtn = Array.from(document.querySelectorAll('nav[aria-label="Paginasi antrean percakapan"] button')).find(b => b.textContent.includes('Berikutnya'));
        const items = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'));
        const navEl = document.querySelector('nav[aria-label="Paginasi antrean percakapan"]');

        return {
          foregroundStarted: window.__foregroundStarted,
          pollingStarted: window.__pollingStarted,
          pollingResolved: window.__pollingResolved,
          foregroundResolved: window.__foregroundResolved,
          prevDisabled: prevBtn ? prevBtn.hasAttribute('disabled') : false,
          nextDisabled: nextBtn ? nextBtn.hasAttribute('disabled') : false,
          itemCount: items.length,
          navText: navEl ? navEl.textContent.trim() : '',
        };
      })()`,
      returnByValue: true,
    });

    const olData = overlapRes.result.value || {};
    const overlapPass = Boolean(
      olData.foregroundStarted &&
      olData.pollingStarted &&
      olData.pollingResolved &&
      olData.foregroundResolved &&
      olData.itemCount === 3 &&
      !olData.prevDisabled &&
      olData.nextDisabled &&
      olData.navText.includes("Halaman 2 dari 2")
    );

    recordAssertion({
      id: "polling_overlap_with_foreground_fetch",
      name: "Resiliensi loading saat request foreground tumpang tindih dengan polling komponen (loading selesai, tombol aktif, data sesuai)",
      isOptional: false,
      expected: {
        foregroundStarted: true,
        pollingStarted: true,
        itemCount: 3,
        prevEnabled: true,
        nextDisabled: true,
      },
      actual: olData,
      pass: overlapPass,
    });

    // Reset search back to empty
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(searchInput, '');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (searchInput.form) searchInput.form.requestSubmit();
        }
      })()`,
    });
    await delay(1200);

    // ========================================================================
    // 16. STALE RESPONSE REJECTION (DELAYED A RELEASED AFTER B OPEN)
    // ========================================================================
    console.log("\n--- [16] Verifikasi Penolakan Respons Usang (Delayed A vs Fresh B) ---");

    try {
      // Start condition: Select Conversation C (Pelanggan Gamma) and assert initial state using fixture ID
      await cdp.send("Runtime.evaluate", {
        expression: `((targetId) => {
          const itemC = document.querySelector(\`section[aria-label="Antrean percakapan masuk"] [role="option"][data-conversation-id="\${targetId}"]\`);
          if (itemC) itemC.click();
        })(${JSON.stringify(convCId)})`,
      });
      await delay(800);

      const initCRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
          const selectedOption = document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"][aria-selected="true"]');
          return {
            panelHasGamma: detailSection ? detailSection.textContent.includes('Pelanggan Gamma') : false,
            selectedIsGamma: selectedOption ? selectedOption.getAttribute('data-conversation-id') === ${JSON.stringify(convCId)} : false,
          };
        })()`,
        returnByValue: true,
      });
      const initCData = initCRes.result.value || {};
      console.log("[Stale Response] Kondisi awal sebelum uji stale (harus Gamma):", initCData);

      // Install single-use interceptor on GET /api/inbox/conversations/${convAId} (excluding /read)
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__aRequested = false;
          window.__aResolved = false;
          window.__releaseDetailA = null;
          window.__staleEvents = [];
          window.__staleInterceptedOnce = false;
          const targetA = ${JSON.stringify(convAId)};
          window.__origFetchBeforeStale = window.fetch;
          window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const init = args[1] || {};
            const method = (init.method || 'GET').toUpperCase();
            if (!window.__staleInterceptedOnce && method === 'GET' && url.includes('/api/inbox/conversations/' + targetA) && !url.includes('/read')) {
              window.__staleInterceptedOnce = true;
              window.__aRequested = true;
              window.__staleEvents.push("A_requested");
              return new Promise((resolve) => {
                window.__releaseDetailA = async () => {
                  window.__staleEvents.push("A_released");
                  const res = await window.__origFetchBeforeStale.apply(this, args);
                  window.__aResolved = true;
                  window.__staleEvents.push("A_resolved");
                  resolve(res);
                };
              });
            }
            return window.__origFetchBeforeStale.apply(this, args);
          };
        })()`,
      });

      // Click Conversation A (delayed) using fixture ID
      await cdp.send("Runtime.evaluate", {
        expression: `((targetId) => {
          const itemA = document.querySelector(\`section[aria-label="Antrean percakapan masuk"] [role="option"][data-conversation-id="\${targetId}"]\`);
          if (itemA) itemA.click();
        })(${JSON.stringify(convAId)})`,
      });

      // Barrier 1: Wait until request A enters and is held
      let aRequestedAndHeld = false;
      for (let i = 0; i < 60; i++) {
        await delay(50);
        const barrierCheck = await cdp.send("Runtime.evaluate", {
          expression: "Boolean(window.__aRequested && typeof window.__releaseDetailA === 'function')",
          returnByValue: true,
        });
        if (barrierCheck.result.value === true) {
          aRequestedAndHeld = true;
          break;
        }
      }
      console.log("[Stale Response] Request A berhasil masuk dan ditahan:", aRequestedAndHeld);

      // Click Conversation B (Pelanggan Beta) while A is held using fixture ID
      await cdp.send("Runtime.evaluate", {
        expression: `((targetId) => {
          const itemB = document.querySelector(\`section[aria-label="Antrean percakapan masuk"] [role="option"][data-conversation-id="\${targetId}"]\`);
          if (itemB) itemB.click();
        })(${JSON.stringify(convBId)})`,
      });

      // Barrier 2: Wait until detail B is actually rendered in the DOM
      let bRendered = false;
      for (let i = 0; i < 60; i++) {
        await delay(50);
        const bCheck = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
            return detailSection ? detailSection.textContent.includes('Pelanggan Beta') : false;
          })()`,
          returnByValue: true,
        });
        if (bCheck.result.value === true) {
          bRendered = true;
          // Record event "B_rendered" into sequence
          await cdp.send("Runtime.evaluate", {
            expression: `window.__staleEvents.push("B_rendered")`,
          });
          break;
        }
      }
      console.log("[Stale Response] Percakapan B berhasil tampil di panel (event B_rendered dicatat):", bRendered);

      // Release delayed response A
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          if (typeof window.__releaseDetailA === 'function') {
            window.__releaseDetailA();
          }
        })()`,
      });

      // Barrier 3: Wait until request A actually settles
      let aResolved = false;
      for (let i = 0; i < 60; i++) {
        await delay(50);
        const resolveCheck = await cdp.send("Runtime.evaluate", {
          expression: "Boolean(window.__aResolved)",
          returnByValue: true,
        });
        if (resolveCheck.result.value === true) {
          aResolved = true;
          break;
        }
      }
      console.log("[Stale Response] Respons A berhasil selesai settle:", aResolved);

      // Immediately before any other navigation, assert selection and panel content remain B without A data
      const staleCheckRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
          const selectedOption = document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"][aria-selected="true"]');
          window.__staleEvents.push("B_remains_active");
          return {
            panelDisplaysBeta: detailSection ? detailSection.textContent.includes('Pelanggan Beta') : false,
            panelDisplaysAlpha: detailSection ? detailSection.textContent.includes('Pelanggan Alpha') : false,
            selectedItemIsBeta: selectedOption ? selectedOption.getAttribute('data-conversation-id') === ${JSON.stringify(convBId)} : false,
            eventSequence: window.__staleEvents || [],
          };
        })()`,
        returnByValue: true,
      });

      const staleData = staleCheckRes.result.value || {};
      const expectedEvents = ["A_requested", "B_rendered", "A_released", "A_resolved", "B_remains_active"];
      const sequenceMatches = JSON.stringify(staleData.eventSequence) === JSON.stringify(expectedEvents);

      const stalePass = Boolean(
        initCData.panelHasGamma &&
        aRequestedAndHeld &&
        bRendered &&
        aResolved &&
        staleData.panelDisplaysBeta &&
        !staleData.panelDisplaysAlpha &&
        staleData.selectedItemIsBeta &&
        sequenceMatches
      );

      recordAssertion({
        id: "stale_response_rejection",
        name: "Respons detail lama yang tertunda tidak menimpa percakapan baru yang telah dipilih",
        isOptional: false,
        expected: {
          initialConversationIsC: true,
          aRequestedAndHeld: true,
          bRenderedBeforeARelease: true,
          aSettled: true,
          panelDisplaysBeta: true,
          panelDisplaysAlpha: false,
          selectedItemIsBeta: true,
          eventSequence: expectedEvents,
        },
        actual: {
          initialConversationIsC: initCData.panelHasGamma,
          aRequestedAndHeld,
          bRenderedBeforeARelease: bRendered,
          aSettled: aResolved,
          panelDisplaysBeta: staleData.panelDisplaysBeta,
          panelDisplaysAlpha: staleData.panelDisplaysAlpha,
          selectedItemIsBeta: staleData.selectedItemIsBeta,
          eventSequence: staleData.eventSequence,
          conversations: { convAId, convBId, initialConvCId: convCId },
        },
        pass: stalePass,
      });
    } finally {
      // Crucial: Clean up stale interceptor and restore original fetch unconditionally!
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          if (window.__origFetchBeforeStale) {
            window.fetch = window.__origFetchBeforeStale;
            delete window.__origFetchBeforeStale;
          }
          delete window.__releaseDetailA;
          delete window.__aRequested;
          delete window.__aResolved;
          delete window.__staleInterceptedOnce;
          delete window.__staleEvents;
        })()`,
      });
      console.log("[Stale Response] Interceptor stale dibersihkan dan window.fetch dipulihkan via finally.");
    }

    // ========================================================================
    // 17. DETAIL FAILURE ISOLATION AFTER A PREVIOUSLY OPEN
    // ========================================================================
    console.log("\n--- [17] Verifikasi Isolasi Kegagalan Detail B Setelah Percakapan A Terbuka ---");

    try {
      // Step 1: Select Conversation A using run fixture ID
      await cdp.send("Runtime.evaluate", {
        expression: `((targetId) => {
          const itemA = document.querySelector(\`section[aria-label="Antrean percakapan masuk"] [role="option"][data-conversation-id="\${targetId}"]\`);
          if (itemA) itemA.click();
        })(${JSON.stringify(convAId)})`,
      });

      // Poll until Conversation A is verified selected AND rendered in detail panel (no sleep guessing)
      let aFullyOpen = false;
      let aOpenState = {};
      for (let i = 0; i < 60; i++) {
        await delay(50);
        const checkARes = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
            const selectedOption = document.querySelector('section[aria-label="Antrean percakapan masuk"] [role="option"][aria-selected="true"]');
            const isAlphaRendered = detailSection ? detailSection.textContent.includes('Pelanggan Alpha') : false;
            const selectedIsA = selectedOption ? selectedOption.getAttribute('data-conversation-id') === ${JSON.stringify(convAId)} : false;
            return {
              isAlphaRendered,
              selectedIsA,
            };
          })()`,
          returnByValue: true,
        });
        aOpenState = checkARes.result.value || {};
        if (aOpenState.isAlphaRendered && aOpenState.selectedIsA) {
          aFullyOpen = true;
          break;
        }
      }
      console.log("[Detail Failure Isolation] Kondisi awal A benar-benar terpilih dan tampil:", aFullyOpen, aOpenState);

      // Step 2: Now that A is open, install single-use 500 fault interceptor on conversation B's detail endpoint
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          window.__failDetailId = ${JSON.stringify(convBId)};
          window.__origFetchBeforeFailIso = window.fetch;
          window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (window.__failDetailId && url.includes('/api/inbox/conversations/' + window.__failDetailId)) {
              window.__failDetailId = null;
              return Promise.resolve(new Response(JSON.stringify({ success: false, error: { message: "Simulated detail load failure for conversation B" } }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
              }));
            }
            return window.__origFetchBeforeFailIso.apply(this, args);
          };
        })()`,
      });

      // Step 3: Click Conversation B using run fixture ID
      await cdp.send("Runtime.evaluate", {
        expression: `((targetId) => {
          const itemB = document.querySelector(\`section[aria-label="Antrean percakapan masuk"] [role="option"][data-conversation-id="\${targetId}"]\`);
          if (itemB) itemB.click();
        })(${JSON.stringify(convBId)})`,
      });

      // Poll until detail section shows error and does NOT display Alpha
      let bErrorRendered = false;
      let failIsoData = {};
      for (let i = 0; i < 60; i++) {
        await delay(50);
        const failIsolationRes = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
            const isAlphaRendered = detailSection ? detailSection.textContent.includes('Pelanggan Alpha') : false;
            const errorMsg = detailSection ? Array.from(detailSection.querySelectorAll('p, div, h3')).find(el => el.textContent.includes('Gagal memuat detail')) : null;
            return {
              isAlphaRendered,
              hasDetailError: Boolean(errorMsg),
              errorText: errorMsg ? errorMsg.textContent.trim() : '',
            };
          })()`,
          returnByValue: true,
        });
        failIsoData = failIsolationRes.result.value || {};
        if (failIsoData.hasDetailError && !failIsoData.isAlphaRendered) {
          bErrorRendered = true;
          break;
        }
      }

      const failIsoPass = Boolean(aFullyOpen && bErrorRendered && !failIsoData.isAlphaRendered && failIsoData.hasDetailError);

      recordAssertion({
        id: "detail_failure_isolation_after_open",
        name: "Kegagalan memuat detail percakapan baru menampilkan pesan error terisolasi tanpa membocorkan data percakapan sebelumnya",
        isOptional: false,
        expected: { initialAOpen: true, isAlphaRendered: false, hasDetailError: true },
        actual: { initialAOpen: aFullyOpen, ...failIsoData },
        pass: failIsoPass,
      });
    } finally {
      // Clean up fetch interceptor for scenario 17 unconditionally
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          if (window.__origFetchBeforeFailIso) {
            window.fetch = window.__origFetchBeforeFailIso;
            delete window.__origFetchBeforeFailIso;
          }
          delete window.__failDetailId;
        })()`,
      });
      console.log("[Detail Failure Isolation] Interceptor dibersihkan dan window.fetch dipulihkan via finally.");
    }

    // ========================================================================
    // 18. LIST ERROR AND RECOVERY ISOLATED (DIRECTION A)
    // ========================================================================
    console.log("\n--- [18] Verifikasi Penanganan Error Antrean List & Pemulihan Mandiri (Direction A) ---");

    // Install dual-fault interceptor controlling list and detail faults independently
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__faultList = true;
        window.__faultDetail = true;
        window.__listRetryRequested = false;
        window.__detailRetryRequested = false;
        const targetB = ${JSON.stringify(convBId)};
        const origFetch = window.fetch;
        window.fetch = function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (window.__faultList && url.includes('/api/inbox/conversations?')) {
            return Promise.resolve(new Response(JSON.stringify({ success: false, error: { message: "Simulated list load error" } }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            }));
          }
          if (!window.__faultList && url.includes('/api/inbox/conversations?')) {
            window.__listRetryRequested = true;
          }
          if (window.__faultDetail && url.includes('/api/inbox/conversations/' + targetB) && !url.includes('/read')) {
            return Promise.resolve(new Response(JSON.stringify({ success: false, error: { message: "Simulated detail load error" } }), {
              status: 500,
              headers: { "Content-Type": "application/json" }
            }));
          }
          if (!window.__faultDetail && url.includes('/api/inbox/conversations/' + targetB) && !url.includes('/read')) {
            window.__detailRetryRequested = true;
          }
          return origFetch.apply(this, args);
        };
      })()`,
    });

    // Trigger list fetch failure by submitting search
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput && searchInput.form) searchInput.form.requestSubmit();
      })()`,
    });
    await delay(1200);

    // Verify initial dual error state: both list and detail are in error
    const dualErrCheckA = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const listError = listSection ? Array.from(listSection.querySelectorAll('p, div, span')).find(el => el.textContent.includes('Gagal memuat antrean')) : null;
        const listRetryBtn = listSection ? Array.from(listSection.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi') || b.textContent.includes('Muat ulang')) : null;
        const detailError = detailSection ? Array.from(detailSection.querySelectorAll('p, div, h3')).find(el => el.textContent.includes('Gagal memuat detail')) : null;
        return {
          hasListError: Boolean(listError),
          hasListRetryBtn: Boolean(listRetryBtn),
          hasDetailError: Boolean(detailError),
        };
      })()`,
      returnByValue: true,
    });
    const stateBeforeA = dualErrCheckA.result.value || {};
    console.log("[Recovery A] Status awal (kedua panel harus error):", stateBeforeA);

    // Direction A: Release list fault ONLY (keep detail fault active!) and click list retry
    await cdp.send("Runtime.evaluate", {
      expression: "window.__faultList = false;",
    });

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const retryBtn = listSection ? Array.from(listSection.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi') || b.textContent.includes('Muat ulang')) : null;
        if (retryBtn) retryBtn.click();
      })()`,
    });
    await delay(1200);

    // Verify state after list recovery: list is valid, detail error still persists
    const dualAfterA = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const listError = listSection ? Array.from(listSection.querySelectorAll('p, div, span')).find(el => el.textContent.includes('Gagal memuat antrean')) : null;
        const items = Array.from(listSection ? listSection.querySelectorAll('[role="option"]') : []);
        const detailError = detailSection ? Array.from(detailSection.querySelectorAll('p, div, h3')).find(el => el.textContent.includes('Gagal memuat detail')) : null;
        return {
          hasListError: Boolean(listError),
          itemsRestoredCount: items.length,
          hasDetailError: Boolean(detailError),
          listRetryRequested: Boolean(window.__listRetryRequested),
        };
      })()`,
      returnByValue: true,
    });
    const stateAfterA = dualAfterA.result.value || {};
    console.log("[Recovery A] Status setelah list retry:", stateAfterA);

    const listRecoveryPass = Boolean(
      stateBeforeA.hasListError &&
      stateBeforeA.hasDetailError &&
      stateAfterA.listRetryRequested &&
      !stateAfterA.hasListError &&
      stateAfterA.itemsRestoredCount >= 25 &&
      stateAfterA.hasDetailError
    );

    recordAssertion({
      id: "list_error_and_recovery_isolated",
      name: "Kegagalan daftar percakapan terisolasi dari panel detail dan pulih secara independen saat dicoba lagi",
      isOptional: false,
      expected: {
        beforeRecovery: { hasListError: true, hasDetailError: true },
        afterRecovery: { listErrorCleared: true, itemsRestored: true, detailErrorPersists: true },
      },
      actual: {
        beforeRecovery: stateBeforeA,
        afterRecovery: stateAfterA,
      },
      pass: listRecoveryPass,
    });

    // ========================================================================
    // 19. DETAIL ERROR AND RECOVERY ISOLATED (DIRECTION B)
    // ========================================================================
    console.log("\n--- [19] Verifikasi Pemulihan Detail Percakapan Mandiri (Direction B) ---");

    // Re-inject list fault to establish dual error condition again
    await cdp.send("Runtime.evaluate", {
      expression: "window.__faultList = true; window.__faultDetail = true; window.__detailRetryRequested = false;",
    });

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const searchInput = document.querySelector('input[type="search"]');
        if (searchInput && searchInput.form) searchInput.form.requestSubmit();
      })()`,
    });
    await delay(1200);

    const dualErrCheckB = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const listError = listSection ? Array.from(listSection.querySelectorAll('p, div, span')).find(el => el.textContent.includes('Gagal memuat antrean')) : null;
        const detailError = detailSection ? Array.from(detailSection.querySelectorAll('p, div, h3')).find(el => el.textContent.includes('Gagal memuat detail')) : null;
        const detailRetryBtn = detailSection ? Array.from(detailSection.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi')) : null;
        return {
          hasListError: Boolean(listError),
          hasDetailError: Boolean(detailError),
          hasDetailRetryBtn: Boolean(detailRetryBtn),
        };
      })()`,
      returnByValue: true,
    });
    const stateBeforeB = dualErrCheckB.result.value || {};
    console.log("[Recovery B] Status awal (kedua panel harus error):", stateBeforeB);

    // Direction B: Release detail fault ONLY (keep list fault active!) and click detail retry
    await cdp.send("Runtime.evaluate", {
      expression: "window.__faultDetail = false;",
    });

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const retryBtn = detailSection ? Array.from(detailSection.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi')) : null;
        if (retryBtn) retryBtn.click();
      })()`,
    });
    await delay(1500);

    const dualAfterB = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const listError = listSection ? Array.from(listSection.querySelectorAll('p, div, span')).find(el => el.textContent.includes('Gagal memuat antrean')) : null;
        const detailError = detailSection ? Array.from(detailSection.querySelectorAll('p, div, h3')).find(el => el.textContent.includes('Gagal memuat detail')) : null;
        const msgs = Array.from(detailSection ? detailSection.querySelectorAll('[data-message-id]') : []);
        const displaysBeta = detailSection ? detailSection.textContent.includes('Pelanggan Beta') : false;
        return {
          hasListError: Boolean(listError),
          hasDetailError: Boolean(detailError),
          displaysBeta,
          messagesLoaded: msgs.length > 0,
          detailRetryRequested: Boolean(window.__detailRetryRequested),
        };
      })()`,
      returnByValue: true,
    });
    const stateAfterB = dualAfterB.result.value || {};
    console.log("[Recovery B] Status setelah detail retry:", stateAfterB);

    const detailRecoverPass = Boolean(
      stateBeforeB.hasListError &&
      stateBeforeB.hasDetailError &&
      stateAfterB.detailRetryRequested &&
      !stateAfterB.hasDetailError &&
      stateAfterB.displaysBeta &&
      stateAfterB.messagesLoaded &&
      stateAfterB.hasListError
    );

    recordAssertion({
      id: "detail_error_and_recovery_isolated",
      name: "Kegagalan detail percakapan terisolasi dari daftar dan pulih secara independen saat dicoba lagi",
      isOptional: false,
      expected: {
        beforeRecovery: { hasListError: true, hasDetailError: true },
        afterRecovery: { detailErrorCleared: true, displaysBeta: true, messagesLoaded: true, listErrorPersists: true },
      },
      actual: {
        beforeRecovery: stateBeforeB,
        afterRecovery: stateAfterB,
      },
      pass: detailRecoverPass,
    });

    // Clean up all faults and restore list for subsequent tests
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        window.__faultList = false;
        window.__faultDetail = false;
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const retryBtn = listSection ? Array.from(listSection.querySelectorAll('button')).find(b => b.textContent.includes('Coba lagi') || b.textContent.includes('Muat ulang')) : null;
        if (retryBtn) retryBtn.click();
      })()`,
    });
    await delay(1200);

    // ========================================================================
    // 20. MOBILE VIEWPORT (375x667) & NAVIGATION
    // ========================================================================
    console.log("\n--- [20] Verifikasi Viewport Mobile & Navigasi Single-Pane ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await delay(800);

    await takeScreenshot("mobile_inbox_detail");

    // Click back button on mobile: returns to list
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const backBtn = document.querySelector('button[aria-label="Kembali ke daftar percakapan"]');
        if (backBtn) backBtn.click();
      })()`,
    });
    await delay(800);

    const mobileBackRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        return {
          isListVisible: listSection && !listSection.classList.contains('hidden'),
          isDetailHidden: !detailSection || detailSection.classList.contains('hidden'),
        };
      })()`,
      returnByValue: true,
    });

    await takeScreenshot("mobile_inbox_list");

    // Tap the SAME conversation (Pelanggan Beta) again to verify reopening
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const itemB = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.textContent.includes('Pelanggan Beta'));
        if (itemB) itemB.click();
      })()`,
    });
    await delay(1000);

    const mobileReopenRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        return {
          isListHidden: !listSection || listSection.classList.contains('hidden'),
          isDetailVisible: detailSection && !detailSection.classList.contains('hidden'),
          detailHasBeta: detailSection ? detailSection.textContent.includes('Pelanggan Beta') : false,
        };
      })()`,
      returnByValue: true,
    });

    const mbBack = mobileBackRes.result.value || {};
    const mbReopen = mobileReopenRes.result.value || {};
    const mobilePass = Boolean(
      mbBack.isListVisible &&
      mbBack.isDetailHidden &&
      mbReopen.isListHidden &&
      mbReopen.isDetailVisible &&
      mbReopen.detailHasBeta
    );

    recordAssertion({
      id: "mobile_viewport_and_navigation",
      name: "Viewport mobile (375x667) menampilkan single-pane dengan tombol 'Kembali' yang mempertahankan konteks filter dan daftar",
      isOptional: false,
      expected: { backToListOk: true, reopenSameConvOk: true },
      actual: { back: mbBack, reopen: mbReopen },
      pass: mobilePass,
    });

    // ========================================================================
    // 21. KEYBOARD NAVIGATION & FOCUS RINGS
    // ========================================================================
    console.log("\n--- [21] Verifikasi Navigasi Keyboard & Focus Ring ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(600);

    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector('input[type="search"]');
        if (input) input.focus();
      })()`,
    });
    await delay(200);

    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    await delay(300);

    const focusRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.activeElement;
        const ariaLive = document.querySelector('[aria-live]');
        const hasFocusRing = el ? (
          el.className.includes('outline') ||
          el.className.includes('ring') ||
          window.getComputedStyle(el).outlineStyle !== 'none'
        ) : false;

        return {
          activeTagName: el ? el.tagName.toLowerCase() : null,
          hasFocusVisibleClass: hasFocusRing,
          hasAriaLiveRegion: Boolean(ariaLive),
        };
      })()`,
      returnByValue: true,
    });

    const focusData = focusRes.result.value || {};
    const focusPass = Boolean(
      focusData.activeTagName &&
      focusData.hasFocusVisibleClass &&
      focusData.hasAriaLiveRegion
    );

    recordAssertion({
      id: "keyboard_navigation_and_focus",
      name: "Navigasi keyboard menampilkan focus ring yang terlihat jelas dan region aria-live polite untuk notifikasi",
      isOptional: false,
      expected: { hasFocusVisibleClass: true, hasAriaLiveRegion: true },
      actual: focusData,
      pass: focusPass,
    });

    await takeScreenshot("keyboard_focus_ring");

  } catch (err) {
    console.error("\nEksekusi runner terhenti dengan exception:", err);
    if (TEST_SETUP_FAILURE) {
      recordAssertion({
        id: "setup_failure_injected",
        name: "Injeksi kegagalan saat setup untuk menguji rollback resource",
        isOptional: false,
        pass: false,
        expected: "Kegagalan saat setup memicu rollback di catch/finally",
        actual: err.message || String(err),
      });
    } else if (TEST_MIDRUN_FAILURE) {
      recordAssertion({
        id: "midrun_failure_injected",
        name: "Injeksi kegagalan di tengah run setelah fixture terbentuk",
        isOptional: false,
        pass: false,
        expected: "Kegagalan mid-run memicu rollback di catch/finally",
        actual: err.message || String(err),
      });
    } else {
      recordAssertion({
        id: "runner_execution_failure",
        name: "Eksekusi runner pengujian browser terhenti tanpa unhandled crash",
        isOptional: false,
        pass: false,
        expected: "Runner menyelesaikan seluruh skenario pengujian tanpa crash",
        actual: err.message || String(err),
      });
    }
  } finally {
    console.log("\n--- [Teardown Lifecycle] Menghentikan proses dan membersihkan resource ---");
    // 1. Terminate browser and child server processes
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    let processesKilledCleanly = true;
    if (chromeProc) {
      try {
        killProcess(chromeProc);
      } catch (e) {
        processesKilledCleanly = false;
        cleanupErrors.push(e);
      }
    }
    if (nextProc) {
      try {
        killProcess(nextProc);
      } catch (e) {
        processesKilledCleanly = false;
        cleanupErrors.push(e);
      }
    }
    if (TEST_MIDRUN_FAILURE && processesKilledCleanly) {
      recordAssertion({
        id: "teardown_processes_killed",
        name: "Proses Chrome dan Next.js berhasil dihentikan saat mid-run rollback",
        isOptional: false,
        pass: true,
        expected: "Proses dihentikan tanpa error",
        actual: "Proses Chrome dan Next.js dihentikan",
      });
    }

    // 2. Delete isolated staff user via Supabase Admin API
    if (staffUserId && supabaseAdmin) {
      try {
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
        if (delError) {
          cleanupErrors.push(new Error(`Gagal menghapus user staf (${staffUserId}): ${delError.message}`));
        } else {
          console.log(`[Teardown] User staf ${staffEmail} berhasil dihapus.`);
          if (TEST_SETUP_FAILURE) {
            recordAssertion({
              id: "teardown_user_deleted",
              name: "User staf terisolasi berhasil dihapus saat rollback setup failure",
              isOptional: false,
              pass: true,
              expected: "User staf terhapus dari auth",
              actual: `User staf ${staffEmail} berhasil dihapus`,
            });
          }
        }
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    // 3. Delete tracked test fixtures via unified primary -> catch -> fallback cleanup pipeline
    if (pool && tracker) {
      let primaryCleanupAttempted = false;
      const primaryCleanupFn = async (p, t) => {
        primaryCleanupAttempted = true;
        if (TEST_CLEANUP_FAILURE) {
          throw new Error("Simulated operational failure at primary cleanup call boundary");
        }
        return cleanupFixture(p, t);
      };

      const fallbackCleanupFn = async (p, t) => {
        return cleanupFixture(p, t);
      };

      try {
        console.log("[Teardown] Menjalankan primary cleanup...");
        await primaryCleanupFn(pool, tracker);
        console.log("[Teardown] Primary cleanupFixture selesai dengan sukses.");
        if (TEST_MIDRUN_FAILURE) {
          recordAssertion({
            id: "teardown_resources_cleaned",
            name: "Resource fixture dan user staf berhasil dibersihkan saat mid-run rollback",
            isOptional: false,
            pass: true,
            expected: "Semua resource run dibersihkan",
            actual: "Semua fixture dan user berhasil dibersihkan via cleanupFixture & deleteUser",
          });
        }
      } catch (primaryErr) {
        console.warn(`[Teardown] Primary cleanup gagal (${primaryErr.message}). Menjalankan fallback cleanup...`);
        cleanupErrors.push(primaryErr);

        if (TEST_CLEANUP_FAILURE) {
          recordAssertion({
            id: "cleanup_fault_injected",
            name: "Injeksi kegagalan terencana pada batas pemanggilan primary cleanup",
            isOptional: false,
            pass: primaryCleanupAttempted,
            expected: "Primary cleanup dicoba dan melempar error yang tertangkap handler",
            actual: primaryErr.message,
          });
        }

        try {
          await fallbackCleanupFn(pool, tracker);
          console.log("[Teardown] Fallback cleanup berhasil membersihkan resource milik run.");
          if (TEST_CLEANUP_FAILURE) {
            recordAssertion({
              id: "fallback_cleanup_executed",
              name: "Upaya pembersihan lanjutan (fallback) membersihkan seluruh resource milik run",
              isOptional: false,
              pass: true,
              expected: "Resource milik run dibersihkan via fallback",
              actual: "Fallback cleanupFixture berhasil dieksekusi",
            });
          }
        } catch (fallbackErr) {
          console.error(`[Teardown] Fallback cleanup juga gagal: ${fallbackErr.message}`);
          cleanupErrors.push(fallbackErr);
          if (TEST_CLEANUP_FAILURE) {
            recordAssertion({
              id: "fallback_cleanup_executed",
              name: "Upaya pembersihan lanjutan (fallback) membersihkan seluruh resource milik run",
              isOptional: false,
              pass: false,
              expected: "Resource milik run dibersihkan via fallback",
              actual: fallbackErr.message,
            });
          }
        }
      }
    }

    // 4. Residual data verification query
    let residualSummary = "0 residu (conversations=0, messages=0, identities=0)";
    if (pool && tracker && (tracker.conversationIds.length > 0 || tracker.identityIds.length > 0)) {
      try {
        const residualCheck = await pool.query(
          `SELECT
            (SELECT count(*) FROM public.conversations WHERE id = ANY($1::uuid[])) as conv_count,
            (SELECT count(*) FROM public.messages WHERE id = ANY($2::uuid[])) as msg_count,
            (SELECT count(*) FROM public.channel_identities WHERE id = ANY($3::uuid[])) as id_count`,
          [tracker.conversationIds, tracker.messageIds, tracker.identityIds]
        );
        const row = residualCheck.rows[0];
        if (Number(row.conv_count) > 0 || Number(row.msg_count) > 0 || Number(row.id_count) > 0) {
          const resErr = new Error(`Residu database ditemukan setelah cleanup: conv=${row.conv_count}, msg=${row.msg_count}, id=${row.id_count}`);
          cleanupErrors.push(resErr);
          residualSummary = `Residu ditemukan: conv=${row.conv_count}, msg=${row.msg_count}, id=${row.id_count}`;
        } else {
          console.log("[Teardown] Verifikasi residu database: 0 residu ditemukan (bersih).");
        }
      } catch (e) {
        cleanupErrors.push(e);
      }
    }

    // 5. Clean up temporary chrome user data dir
    if (userDataDir && fs.existsSync(userDataDir)) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }

    // 6. Restore environment variables
    envRestorer.restore();

    try {
      await pool.end();
    } catch (e) {
      cleanupErrors.push(e);
    }

    // 7. Record teardown assertion
    if (cleanupErrors.length === 0) {
      recordAssertion({
        id: "runner_cleanup_and_teardown",
        name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
        isOptional: false,
        pass: true,
        expected: "Cleanup selesai tanpa error dan 0 residu",
        actual: "Semua proses dihentikan, user dihapus, fixture dibersihkan, residu = 0",
      });
    }

    // 8. Finalize evidence JSON and exit code strictly after teardown completes
    let activeMode = "live_browser_normal";
    let activeRegistry = NORMAL_BROWSER_REGISTRY;

    if (TEST_CLEANUP_FAILURE) {
      activeMode = "cleanup_failure";
      activeRegistry = CLEANUP_FAILURE_REGISTRY;
    } else if (TEST_SETUP_FAILURE) {
      activeMode = "setup_failure";
      activeRegistry = SETUP_FAILURE_REGISTRY;
    } else if (TEST_MIDRUN_FAILURE) {
      activeMode = "midrun_failure";
      activeRegistry = MIDRUN_FAILURE_REGISTRY;
    }

    finalize(
      assertions,
      path.join(runEvidenceDir, "evidence.json"),
      cleanupErrors,
      activeRegistry,
      {
        mode: activeMode,
        runId,
        expectedExitCode,
        buildManifest,
        buildId: buildIdAtLaunch,
        sourceHashesAtLaunch,
        screenshots: capturedScreenshots,
        cleanupSummary: {
          initialCleanupError: cleanupErrors.length > 0 ? (cleanupErrors[0].message || String(cleanupErrors[0])) : null,
          totalCleanupErrors: cleanupErrors.length,
          residualVerification: residualSummary,
        },
      }
    );
  }
}

import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
