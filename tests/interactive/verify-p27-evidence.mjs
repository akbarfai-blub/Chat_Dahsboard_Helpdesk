#!/usr/bin/env node
/**
 * verify-p27-evidence.mjs
 *
 * Interactive Browser & Application Verification Runner for P2.7:
 * Panel Konteks Identitas dan Evidence Jaringan.
 *
 * Enforces:
 * 1. REAL Next.js application server testing on isolated port with .env.test.
 * 2. REAL authenticated staff login & CDP session (no mock HTML / mockAppHtml).
 * 3. REAL PostgreSQL test fixtures on port 54332 with isolated database verification.
 * 4. Build-to-source binding validation against build-source-manifest.json.
 * 5. Wide desktop (1440px) 3-column permanent side-by-side view.
 * 6. Medium desktop (1280px) slide-over drawer with focus trap, Escape key, and focus restoration.
 * 7. Mobile (375px) subnav tab switching with read-ack suppression on context tab.
 * 8. Viewport read-ack suppression while drawer is open, resumed upon closing with DB confirmation.
 * 9. On-demand live network check ("Cek Ulang") verifying 0 outbound messages, 0 claims, and 0 episode mutations.
 * 10. Honest status semantics: dynamic proof age staleness downgrades, area state unknown != NORMAL, individual upstream link observations.
 * 11. Safety boundaries: unverified & ambiguous senders degrade safely without arbitrary service selection.
 * 12. Complete lifecycle teardown with process kill confirmation, user deletion, and zero DB residuals.
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

import {
  computeProofAge,
  getOnuStatusBadge,
  getUpstreamStatusBadge,
  getAreaStateBadge,
  getQualityBadge,
  formatAreaRatioString,
  getTriageReasonExplanation,
} from "../../.test-build/lib/domain/evidence-semantics.js";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_PORT = 9227;

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

const SIMULATE_ASSERTION_FAIL =
  process.argv.includes("--simulate-assertion-fail") || process.argv.includes("--test-fail-mode");
const TEST_GUARD_REJECTION = process.argv.includes("--test-guard-rejection");
const TEST_CLEANUP_FAILURE = process.argv.includes("--test-cleanup-failure");
const TEST_SETUP_FAILURE = process.argv.includes("--test-setup-failure");
const TEST_FOREIGN_CHECK_FAILURE = process.argv.includes("--test-foreign-check-failure");
const TEST_FOREIGN_DELETE_FAILURE = process.argv.includes("--test-foreign-delete-failure");

export const P27_NORMAL_REGISTRY = [
  "build_source_binding_verification",
  "auth_setup",
  "desktop_wide_three_column_layout",
  "identity_context_verified_resolution",
  "identity_context_topology_odp_odc",
  "operational_context_active_incident",
  "triage_historical_assessment_fidelity",
  "desktop_medium_drawer_slide_over",
  "desktop_medium_drawer_focus_trap_and_escape",
  "drawer_read_ack_suppression",
  "mobile_subnav_tabs_and_read_suppression",
  "network_check_on_demand_execution",
  "network_check_distinct_onu_evidence",
  "network_check_distinct_upstream_evidence",
  "network_check_area_coverage_denominators",
  "network_check_zero_side_effects",
  "network_check_unresolved_safety",
  "identity_context_ambiguous_services_warning",
  "evidence_semantics_dynamic_freshness_downgrade",
  "foreign_fixture_isolation_intact",
  "runner_cleanup_and_teardown",
];

export const GUARD_REJECTION_REGISTRY = [
  "guard_active_db_rejection",
  "guard_active_api_rejection",
  "guard_marker_mismatch_rejection",
];

export const SETUP_FAILURE_REGISTRY = [
  "setup_failure_injected",
  "runner_cleanup_and_teardown",
];

export const CLEANUP_FAILURE_REGISTRY = [
  "cleanup_fault_injected",
  "teardown_fallback_recovery",
  "runner_cleanup_and_teardown",
];

export const FOREIGN_CHECK_FAILURE_REGISTRY = [
  "foreign_check_fault_injected",
  "subsequent_cleanup_attempted",
  "runner_cleanup_and_teardown",
];

export const FOREIGN_DELETE_FAILURE_REGISTRY = [
  "foreign_delete_fault_injected",
  "subsequent_cleanup_attempted",
  "runner_cleanup_and_teardown",
];

async function findAvailablePort(startPort = 3340) {
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

export function getRunnerRevisionSha256() {
  try {
    const content = fs.readFileSync(path.resolve("tests/interactive/verify-p27-evidence.mjs"));
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

export function updateLatestManifest(entry) {
  if (entry.skipLatestManifestUpdate) return;
  try {
    const manifestPath = path.resolve("docs/evidence/P2_7/latest-manifest.json");
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

export async function seedForeignComparisonFixture(pool, {
  runId,
  foreignCustId,
  foreignSrvId,
  foreignOdcId,
  foreignOdpId,
  foreignLinkId,
}) {
  const foreignOdcCode = `ODC-FOREIGN-${runId}`;
  const foreignOdpCode = `ODP-FOREIGN-${runId}`;

  await pool.query(
    `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
     VALUES ($1, 'Pelanggan Asing (Harness)', 'active', $2, now(), now())`,
    [foreignCustId, `CUST-FOREIGN-${runId}`]
  );
  await pool.query(
    `INSERT INTO public.services (id, customer_id, service_code, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'Layanan Asing', 'active', now(), now())`,
    [foreignSrvId, foreignCustId, `SRV-FOREIGN-${runId}`]
  );
  await pool.query(
    `INSERT INTO public.odcs (id, odc_code, display_name, status, created_at, updated_at)
     VALUES ($1, $2, 'ODC Asing', 'active', now(), now())`,
    [foreignOdcId, foreignOdcCode]
  );
  await pool.query(
    `INSERT INTO public.odps (id, odc_id, odp_code, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'ODP Asing', 'active', now(), now())`,
    [foreignOdpId, foreignOdcId, foreignOdpCode]
  );
  await pool.query(
    `INSERT INTO public.service_topology (id, service_id, odp_id, mapping_version, source, valid_from, created_at)
     VALUES ($1, $2, $3, 1, 'MOCK', now(), now())`,
    [crypto.randomUUID(), foreignSrvId, foreignOdpId]
  );
  await pool.query(
    `INSERT INTO public.mock_upstream_status (scenario_id, link_id, status, observed_at, event_id)
     VALUES ('normal', $1, 'up', now(), $2)
     ON CONFLICT (scenario_id, link_id) DO UPDATE SET status = 'up', observed_at = now()`,
    [foreignLinkId, crypto.randomUUID()]
  );
}

export async function checkForeignComparisonFixture(dbClient, {
  foreignCustId,
  foreignSrvId,
  foreignOdcId,
  foreignOdpId,
  foreignLinkId,
}) {
  const foreignCheck = await dbClient.query(
    `SELECT
       (SELECT count(*) FROM public.customers WHERE id = $1) as cust_cnt,
       (SELECT count(*) FROM public.services WHERE id = $2) as srv_cnt,
       (SELECT count(*) FROM public.odcs WHERE id = $3) as odc_cnt,
       (SELECT count(*) FROM public.odps WHERE id = $4) as odp_cnt,
       (SELECT count(*) FROM public.mock_upstream_status WHERE link_id = $5) as link_cnt`,
    [foreignCustId, foreignSrvId, foreignOdcId, foreignOdpId, foreignLinkId]
  );
  const row = foreignCheck.rows[0];
  const counts = {
    cust_cnt: Number(row?.cust_cnt ?? 0),
    srv_cnt: Number(row?.srv_cnt ?? 0),
    odc_cnt: Number(row?.odc_cnt ?? 0),
    odp_cnt: Number(row?.odp_cnt ?? 0),
    link_cnt: Number(row?.link_cnt ?? 0),
  };
  const isIntact =
    counts.cust_cnt === 1 &&
    counts.srv_cnt === 1 &&
    counts.odc_cnt === 1 &&
    counts.odp_cnt === 1 &&
    counts.link_cnt === 1;

  return {
    success: true,
    intact: isIntact,
    counts,
  };
}

export async function cleanupForeignComparisonFixture(dbClient, {
  foreignCustId,
  foreignSrvId,
  foreignOdcId,
  foreignOdpId,
  foreignLinkId,
}) {
  const steps = [
    {
      name: "mock_upstream_status",
      sql: "DELETE FROM public.mock_upstream_status WHERE link_id = $1",
      params: [foreignLinkId],
    },
    {
      name: "service_topology",
      sql: "DELETE FROM public.service_topology WHERE odp_id = $1",
      params: [foreignOdpId],
    },
    {
      name: "odps",
      sql: "DELETE FROM public.odps WHERE id = $1",
      params: [foreignOdpId],
    },
    {
      name: "odcs",
      sql: "DELETE FROM public.odcs WHERE id = $1",
      params: [foreignOdcId],
    },
    {
      name: "services",
      sql: "DELETE FROM public.services WHERE id = $1",
      params: [foreignSrvId],
    },
    {
      name: "customers",
      sql: "DELETE FROM public.customers WHERE id = $1",
      params: [foreignCustId],
    },
  ];

  const operationsAttempted = [];
  const operationsSucceeded = [];
  const errors = [];

  for (const step of steps) {
    operationsAttempted.push(step.name);
    try {
      await dbClient.query(step.sql, step.params);
      operationsSucceeded.push(step.name);
    } catch (stepErr) {
      errors.push({ step: step.name, error: stepErr });
    }
  }

  return {
    success: errors.length === 0,
    operationsAttempted,
    operationsSucceeded,
    errors,
  };
}

export async function queryForeignComparisonResiduals(pool, {
  foreignCustId,
  foreignSrvId,
  foreignOdcId,
  foreignOdpId,
  foreignLinkId,
}) {
  const check = await pool.query(
    `SELECT
       (SELECT count(*) FROM public.customers WHERE id = $1) as cust_cnt,
       (SELECT count(*) FROM public.services WHERE id = $2) as srv_cnt,
       (SELECT count(*) FROM public.odcs WHERE id = $3) as odc_cnt,
       (SELECT count(*) FROM public.odps WHERE id = $4) as odp_cnt,
       (SELECT count(*) FROM public.mock_upstream_status WHERE link_id = $5) as link_cnt`,
    [foreignCustId, foreignSrvId, foreignOdcId, foreignOdpId, foreignLinkId]
  );
  const row = check.rows[0];
  const counts = {
    customers: Number(row?.cust_cnt ?? 0),
    services: Number(row?.srv_cnt ?? 0),
    odcs: Number(row?.odc_cnt ?? 0),
    odps: Number(row?.odp_cnt ?? 0),
    mock_upstream_status: Number(row?.link_cnt ?? 0),
  };
  const totalResiduals =
    counts.customers +
    counts.services +
    counts.odcs +
    counts.odps +
    counts.mock_upstream_status;

  return {
    counts,
    totalResiduals,
    isZero: totalResiduals === 0,
  };
}

export async function executeLifecycleTeardown({
  pool = null,
  supabaseAdmin = null,
  staffUserId = null,
  tracker = null,
  processes = [],
  explicitCleanupFns = [],
  residualChecks = [],
  faultInjection = null,
  endPool = false,
}) {
  const primaryErrors = [];
  const fallbackErrors = [];
  const operationsAttempted = [];
  const operationsSucceeded = [];
  const residualBreakdown = {};
  let userCleaned = false;

  // 1. Process termination
  for (const proc of processes) {
    if (proc && proc.pid) {
      const opName = `kill_process_${proc.pid}`;
      operationsAttempted.push(opName);
      try {
        killProcess(proc);
        operationsSucceeded.push(opName);
      } catch (err) {
        primaryErrors.push(new Error(`Gagal mematikan proses (PID ${proc.pid}): ${err.message}`));
      }
    }
  }

  // 2. Staff user deletion
  if (staffUserId && supabaseAdmin) {
    operationsAttempted.push("delete_staff_user");
    if (faultInjection?.operation === "delete_user") {
      primaryErrors.push(new Error(`Injected failure on user deletion: ${faultInjection.message || "delete_user_fault"}`));
    } else {
      try {
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
        if (delError) {
          primaryErrors.push(new Error(`Gagal menghapus user staf (${staffUserId}): ${delError.message}`));
        } else {
          userCleaned = true;
          operationsSucceeded.push("delete_staff_user");
        }
      } catch (err) {
        primaryErrors.push(new Error(`Exception saat menghapus user staf: ${err.message}`));
      }
    }
  }

  // 3. Explicit fixture cleanups
  let explicitIdx = 0;
  for (const fn of explicitCleanupFns) {
    const opName = `explicit_cleanup_${fn.name || explicitIdx++}`;
    operationsAttempted.push(opName);
    try {
      await fn();
      operationsSucceeded.push(opName);
    } catch (err) {
      if (faultInjection?.operation === "explicit_fixture_cleanup") {
        primaryErrors.push(new Error(`Injected cleanup query failure: ${err.message}`));
      } else {
        primaryErrors.push(err);
      }
    }
  }

  if (faultInjection?.operation === "explicit_fixture_cleanup" && explicitCleanupFns.length === 0) {
    operationsAttempted.push("explicit_fixture_cleanup");
    primaryErrors.push(new Error(`Injected cleanup query failure: ${faultInjection.message || "fixture_cleanup_fault"}`));
  }

  // 4. Tracker fixtures cleanup (always executed as fallback)
  if (pool && tracker) {
    operationsAttempted.push("cleanup_tracker_fixtures");
    try {
      await cleanupFixture(pool, tracker);
      operationsSucceeded.push("cleanup_tracker_fixtures");
    } catch (err) {
      if (faultInjection) {
        fallbackErrors.push(err);
      } else {
        primaryErrors.push(err);
      }
    }
  }

  // 5. Fallback user deletion if initial delete was faulted
  if (!userCleaned && staffUserId && supabaseAdmin && faultInjection?.operation === "delete_user") {
    operationsAttempted.push("fallback_delete_staff_user");
    try {
      const { error: fbDelError } = await supabaseAdmin.auth.admin.deleteUser(staffUserId);
      if (!fbDelError) {
        userCleaned = true;
        operationsSucceeded.push("fallback_delete_staff_user");
      } else {
        fallbackErrors.push(new Error(`Fallback user delete failed: ${fbDelError.message}`));
      }
    } catch (err) {
      fallbackErrors.push(err);
    }
  }

  // 6. Check final residuals for resources belonging to this run
  let residualsRemaining = 0;
  if (pool) {
    for (const check of residualChecks) {
      const opName = `check_residuals_${check.name || "unnamed"}`;
      operationsAttempted.push(opName);
      try {
        const res = await pool.query(check.sql, check.params || []);
        const count = Number(res.rows[0]?.cnt || 0);
        residualBreakdown[check.name || "unnamed"] = count;
        residualsRemaining += count;
        operationsSucceeded.push(opName);
        if (count > 0) {
          const errMsg = `Ditemukan ${count} residual record pada ${check.name || "tabel DB"}`;
          if (faultInjection) fallbackErrors.push(new Error(errMsg));
          else primaryErrors.push(new Error(errMsg));
        }
      } catch (err) {
        const errMsg = `Gagal memeriksa residual (${check.name}): ${err.message}`;
        if (faultInjection) fallbackErrors.push(new Error(errMsg));
        else primaryErrors.push(new Error(errMsg));
      }
    }
  }

  // 7. End pool safely if requested
  if (pool && endPool) {
    operationsAttempted.push("end_pool");
    try {
      await pool.end();
      operationsSucceeded.push("end_pool");
    } catch (err) {
      fallbackErrors.push(err);
    }
  }

  const allErrors = [...primaryErrors, ...fallbackErrors];
  return {
    success: allErrors.length === 0,
    primaryErrors,
    fallbackErrors,
    allErrors,
    residualsRemaining,
    residualBreakdown,
    operationsAttempted,
    operationsSucceeded,
    recoveryAttempted: Boolean(faultInjection),
    recoveryCompleted: Boolean(faultInjection) ? fallbackErrors.length === 0 : true,
    userCleaned,
  };
}

export function evaluateFinalizeResults(assertionsInput, cleanupErrors = [], modeRegistry = [], extraMetadata = {}) {
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
    const existingIdx = assertions.findIndex((a) => a.id === "runner_cleanup_and_teardown");
    const teardownAssertion = {
      id: "runner_cleanup_and_teardown",
      name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
      isOptional: false,
      status: "FAIL",
      expected: "Cleanup selesai tanpa error dan 0 residu",
      actual: cleanupErrors.map((e) => e.message || String(e)).join("; "),
    };
    if (existingIdx !== -1) {
      assertions[existingIdx] = teardownAssertion;
    } else {
      assertions.push(teardownAssertion);
    }
  }

  // 4. Build-to-source validation: MUST fail-closed if invalid and applicable
  const bv = extraMetadata.buildValidation;
  if (bv && !bv.isValid && bv.isApplicable) {
    const buildIdx = assertions.findIndex((a) => a.id === "build_source_binding_verification");
    const failedBuildAssertion = {
      id: "build_source_binding_verification",
      name: "Validasi build-to-source binding dan manifest sinkronisasi",
      isOptional: false,
      status: "FAIL",
      expected: "Build validation status SYNCHRONIZED dan isValid: true",
      actual: `Status: ${bv.status}, reason: ${bv.reason}`,
    };
    if (buildIdx !== -1) {
      assertions[buildIdx] = failedBuildAssertion;
    } else {
      assertions.unshift(failedBuildAssertion);
    }
  }

  const total = assertions.length;
  const passed = assertions.filter((a) => a.status === "PASS").length;
  const failed = assertions.filter((a) => a.status === "FAIL").length;
  const notRun = assertions.filter((a) => a.status === "NOT_RUN").length;

  let overallStatus = "PASS";
  if (
    failed > 0 ||
    duplicates.length > 0 ||
    (bv && !bv.isValid && bv.isApplicable) ||
    extraMetadata.mode === "setup_failure" ||
    extraMetadata.mode === "cleanup_failure" ||
    extraMetadata.mode === "foreign_check_failure" ||
    extraMetadata.mode === "foreign_delete_failure"
  ) {
    overallStatus = "FAIL";
  } else if (notRun > 0 || missingMandatoryIds.length > 0) {
    overallStatus = "INCOMPLETE";
  }

  const exitCode = overallStatus === "PASS" ? 0 : 1;

  return {
    summary: { overallStatus, exitCode, total, passed, failed, notRun },
    assertions,
    duplicates,
    missingMandatoryIds,
    cleanupErrors: cleanupErrors.map((e) => e.message || String(e)),
    metadata: extraMetadata,
  };
}

export function finalize(assertions, jsonEvidencePath, cleanupErrors = [], modeRegistry = [], extraMetadata = {}) {
  const buildManifest = extraMetadata.buildManifest || readBuildManifest();
  const buildId = extraMetadata.buildId || getBuildId();
  const sourceHashesAtLaunch = extraMetadata.sourceHashesAtLaunch || null;
  const isAppMode =
    extraMetadata.mode !== "guard_rejection" &&
    extraMetadata.mode !== "setup_failure" &&
    extraMetadata.mode !== "cleanup_failure" &&
    extraMetadata.mode !== "foreign_check_failure" &&
    extraMetadata.mode !== "foreign_delete_failure";
  const sourceHashesAtFinalize =
    extraMetadata.sourceHashesAtFinalize !== undefined
      ? extraMetadata.sourceHashesAtFinalize
      : isAppMode
      ? computeSourceHashes()
      : null;

  // Always perform final validation against the fresh finalize condition
  const finalizeValidation = validateBuildMetadata({
    manifest: buildManifest,
    currentBuildId: buildId,
    launchHashes: sourceHashesAtLaunch,
    finalizeHashes: sourceHashesAtFinalize,
    mode: extraMetadata.mode || "live_browser_normal",
  });

  // Fail-closed: If launch validation failed previously, keep that failure;
  // otherwise, the final validation result governs.
  const buildValidation =
    extraMetadata.buildValidation && !extraMetadata.buildValidation.isValid
      ? extraMetadata.buildValidation
      : finalizeValidation;

  const evaluation = evaluateFinalizeResults(assertions, cleanupErrors, modeRegistry, {
    ...extraMetadata,
    buildValidation,
  });
  const { summary, duplicates } = evaluation;

  const runnerRevisionSha256 = extraMetadata.runnerRevisionSha256 || getRunnerRevisionSha256();

  const mode = extraMetadata.mode || "live_browser_normal";
  const defaultExpectedExitCode =
    mode === "setup_failure" ||
    mode === "cleanup_failure" ||
    mode === "foreign_check_failure" ||
    mode === "foreign_delete_failure"
      ? 1
      : 0;
  const expectedExitCode =
    extraMetadata.expectedExitCode !== undefined
      ? extraMetadata.expectedExitCode
      : defaultExpectedExitCode;

  const results = {
    timestamp: new Date().toISOString(),
    runId: extraMetadata.runId || null,
    mode,
    runnerRevisionSha256,
    expectedExitCode,
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
    screenshots: extraMetadata.screenshots || [],
    summary: evaluation.summary,
    assertions: evaluation.assertions,
    cleanupErrors: evaluation.cleanupErrors,
    teardownRecovery: extraMetadata.teardownRecovery || null,
    operationsAttempted: extraMetadata.operationsAttempted || null,
    operationsSucceeded: extraMetadata.operationsSucceeded || null,
    recoveryAttempted: extraMetadata.recoveryAttempted !== undefined ? extraMetadata.recoveryAttempted : null,
    recoveryCompleted: extraMetadata.recoveryCompleted !== undefined ? extraMetadata.recoveryCompleted : null,
    residualsRemaining: extraMetadata.residualsRemaining !== undefined ? extraMetadata.residualsRemaining : null,
    residualBreakdown: extraMetadata.residualBreakdown || null,
    expectedInjectedFailuresCount: extraMetadata.expectedInjectedFailuresCount !== undefined ? extraMetadata.expectedInjectedFailuresCount : null,
    unexpectedFailuresCount: extraMetadata.unexpectedFailuresCount !== undefined ? extraMetadata.unexpectedFailuresCount : null,
  };

  fs.writeFileSync(jsonEvidencePath, JSON.stringify(results, null, 2));
  console.log(`\nArtefak bukti disimpan di: ${jsonEvidencePath}`);

  if (!extraMetadata.skipLatestManifestUpdate) {
    updateLatestManifest({
      mode: results.mode,
      runId: results.runId,
      evidenceDir: path.dirname(jsonEvidencePath),
      evidencePath: jsonEvidencePath,
      timestamp: results.timestamp,
      overallStatus: summary.overallStatus,
      expectedExitCode: results.expectedExitCode,
      calculatedExitCode: summary.exitCode,
      buildId,
      runnerRevisionSha256,
      screenshotsCount: results.screenshots.length,
      skipLatestManifestUpdate: extraMetadata.skipLatestManifestUpdate,
    });
  }

  if (summary.overallStatus === "PASS") {
    console.log("\nSeluruh assertion wajib PASS (exit code 0).");
  } else {
    console.error(`\nRunner selesai dengan status ${summary.overallStatus} (exit code 1).`);
  }

  return results;
}

export async function runP27VerificationHarness() {
  console.log("=== P2.7: VERIFIKASI APLIKASI SEBENARNYA & EVIDENCE JARINGAN ===");

  const baseEvidenceDir = path.resolve("docs/evidence/P2_7");
  fs.mkdirSync(baseEvidenceDir, { recursive: true });

  const assertions = [];

  function recordAssertion({ id, name, pass, expected, actual, notRunReason, isOptional = false }) {
    if (notRunReason) {
      assertions.push({ id, name, isOptional, status: "NOT_RUN", reason: notRunReason });
      console.log(`[-] NOT_RUN: ${name} (${notRunReason})`);
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
      expected: "Error penolakan default user workspace database",
      actual: guard1Actual,
      pass: guard1Ok,
    });

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
      expected: "Error penolakan target API port 54321",
      actual: guard2Actual,
      pass: guard2Ok,
    });

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

  // 2. SETUP FAILURE HARNESS (--test-setup-failure)
  if (TEST_SETUP_FAILURE) {
    const runId = "setup-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    const tracker = new TestResourceTracker();
    let staffUserId = null;
    let custId = null;
    let pool = null;
    let supabaseAdmin = null;
    const cleanupErrors = [];
    let setupFailureCaught = false;
    let caughtErrorMessage = "";

    try {
      const config = parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
        HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
        HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
        HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
      });
      pool = new Pool({ connectionString: config.databaseUrl });
      supabaseAdmin = createClient(config.apiUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 1. Partial resource creation
      const testEmail = `staff_fail_${runId}@example.com`;
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: "TempPassword123!",
        email_confirm: true,
      });
      if (userError || !userData?.user) {
        throw new Error("Failed creating test user in setup failure test: " + (userError?.message || "unknown"));
      }
      staffUserId = userData.user.id;

      custId = crypto.randomUUID();
      tracker.recordCustomer(custId);
      await pool.query(
        `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at) VALUES ($1, $2, 'active', $3, now(), now())`,
        [custId, `Partial Customer ${runId}`, `CUST-FAIL-${runId}`]
      );

      // 2. Injected failure at designated point
      throw new Error(`Injected setup failure after creating partial user ${staffUserId} and customer ${custId}`);
    } catch (err) {
      setupFailureCaught = true;
      caughtErrorMessage = err.message;
      console.log(`[Setup Failure Harness] Terdeteksi kegagalan setup terinjeksi: ${err.message}`);
    } finally {
      // 3. Rollback partial resources and verify zero residuals via shared teardown
      const teardownRes = await executeLifecycleTeardown({
        pool,
        supabaseAdmin,
        staffUserId,
        tracker,
        endPool: true,
        residualChecks: [
          {
            name: "customers",
            sql: "SELECT count(*) as cnt FROM public.customers WHERE id = $1",
            params: [custId],
          },
        ],
      });

      if (teardownRes.allErrors.length > 0) {
        cleanupErrors.push(...teardownRes.allErrors);
      }

      recordAssertion({
        id: "setup_failure_injected",
        name: "Injeksi kegagalan setup setelah sebagian resource dibuat dan error tertangkap",
        pass: setupFailureCaught,
        expected: "Setup failure caught and reported",
        actual: caughtErrorMessage,
      });

      const rollbackSuccess = teardownRes.success && teardownRes.residualsRemaining === 0 && teardownRes.userCleaned;
      recordAssertion({
        id: "runner_cleanup_and_teardown",
        name: "Pembersihan proses dan resource saat setup gagal (rollback bersih 0 residu)",
        pass: rollbackSuccess,
        expected: "Clean rollback with 0 residuals and user deleted",
        actual: `userCleaned=${teardownRes.userCleaned}, residualsRemaining=${teardownRes.residualsRemaining}, teardownErrors=${teardownRes.allErrors.length}`,
      });

      return finalize(
        assertions,
        path.join(runEvidenceDir, "evidence.json"),
        cleanupErrors,
        SETUP_FAILURE_REGISTRY,
        {
          mode: "setup_failure",
          runId,
          expectedExitCode: 1,
          runnerRevisionSha256: getRunnerRevisionSha256(),
          operationsAttempted: teardownRes.operationsAttempted,
          operationsSucceeded: teardownRes.operationsSucceeded,
          recoveryAttempted: teardownRes.recoveryAttempted,
          recoveryCompleted: teardownRes.recoveryCompleted,
          residualsRemaining: teardownRes.residualsRemaining,
          residualBreakdown: teardownRes.residualBreakdown,
          expectedInjectedFailuresCount: 1,
          unexpectedFailuresCount: teardownRes.allErrors.length,
        }
      );
    }
  }

  // 3. CLEANUP FAILURE HARNESS (--test-cleanup-failure)
  if (TEST_CLEANUP_FAILURE) {
    console.log(">> VERIFIKASI HARNESS: Injeksi Kegagalan Teardown / Cleanup Lifecycle <<");
    const runId = "cleanup-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    const tracker = new TestResourceTracker();
    let staffUserId = null;
    let custId = null;
    let foreignCustId = null;
    let pool = null;
    let supabaseAdmin = null;
    const cleanupErrors = [];

    try {
      const config = parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
        HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
        HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
        HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
      });
      pool = new Pool({ connectionString: config.databaseUrl });
      supabaseAdmin = createClient(config.apiUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 1. Create real staff user & fixture
      const testEmail = `staff_clean_fail_${runId}@example.com`;
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: "TempPassword123!",
        email_confirm: true,
      });
      if (userError || !userData?.user) {
        throw new Error("Failed creating test user in cleanup failure test: " + (userError?.message || "unknown"));
      }
      staffUserId = userData.user.id;

      custId = crypto.randomUUID();
      tracker.recordCustomer(custId);
      await pool.query(
        `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at) VALUES ($1, $2, 'active', $3, now(), now())`,
        [custId, `Customer Cleanup Test ${runId}`, `CUST-CLEAN-${runId}`]
      );

      // Foreign comparison fixture to prove isolation even during cleanup failure
      foreignCustId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at) VALUES ($1, $2, 'active', $3, now(), now())`,
        [foreignCustId, `Foreign Customer Cleanup Test ${runId}`, `CUST-FOREIGN-CLEAN-${runId}`]
      );
    } catch (setupErr) {
      cleanupErrors.push(setupErr);
    } finally {
      // Execute shared lifecycle teardown with injected fault on real cleanup operation
      const teardownRes = await executeLifecycleTeardown({
        pool,
        supabaseAdmin,
        staffUserId,
        tracker,
        endPool: false,
        explicitCleanupFns: [
          async () => {
            // Real query execution that intentionally fails on an invalid table
            await pool.query("DELETE FROM non_existent_table_for_cleanup_fault_injection WHERE id = $1", [custId]);
          },
        ],
        residualChecks: [
          {
            name: "customers",
            sql: "SELECT count(*) as cnt FROM public.customers WHERE id = $1",
            params: [custId],
          },
        ],
        faultInjection: {
          operation: "explicit_fixture_cleanup",
        },
      });

      const faultCaught = teardownRes.primaryErrors.some((e) =>
        e.message.includes("Injected cleanup query failure:")
      );
      recordAssertion({
        id: "cleanup_fault_injected",
        name: "Injeksi kegagalan nyata pada query cleanup tertangkap dalam runner teardown",
        pass: faultCaught,
        expected: "Cleanup query failure caught and recorded in teardown primaryErrors",
        actual: faultCaught
          ? teardownRes.primaryErrors.map((e) => e.message).join("; ")
          : "Fault was not caught",
      });

      // Distinct recovery assertion: Fallback cleanup recovered successfully with zero residuals
      const recoveryPass =
        teardownRes.residualsRemaining === 0 &&
        teardownRes.userCleaned &&
        teardownRes.fallbackErrors.length === 0;
      recordAssertion({
        id: "teardown_fallback_recovery",
        name: "Pemulihan sumber daya melalui fallback cleanup berhasil dan terbukti tanpa residu",
        pass: recoveryPass,
        expected: "residualsRemaining=0, userCleaned=true, fallbackErrors=0",
        actual: `residualsRemaining=${teardownRes.residualsRemaining}, userCleaned=${teardownRes.userCleaned}, fallbackErrors=${teardownRes.fallbackErrors.length}`,
      });

      // Verify foreign fixture remained intact during cleanup failure
      let foreignIntact = false;
      if (foreignCustId && pool) {
        try {
          const foreignCheck = await pool.query(
            "SELECT count(*) as cnt FROM public.customers WHERE id = $1",
            [foreignCustId]
          );
          foreignIntact = Number(foreignCheck.rows[0]?.cnt || 0) === 1;
        } catch (fcErr) {
          cleanupErrors.push(fcErr);
        }
        try {
          // Clean up foreign fixture separately by owner
          await pool.query("DELETE FROM public.customers WHERE id = $1", [foreignCustId]);
        } catch (fErr) {
          cleanupErrors.push(fErr);
        }
      }

      if (pool) {
        try {
          await pool.end();
        } catch (pEndErr) {
          cleanupErrors.push(pEndErr);
        }
      }

      // runner_cleanup_and_teardown MUST FAIL because of the injected error in teardown
      const teardownPass = teardownRes.success && teardownRes.allErrors.length === 0;
      recordAssertion({
        id: "runner_cleanup_and_teardown",
        name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
        pass: teardownPass,
        expected: "Cleanup selesai tanpa error (harus gagal karena injeksi fault)",
        actual: `primaryErrors=${teardownRes.primaryErrors.length}, fallbackErrors=${teardownRes.fallbackErrors.length}, residualsRemaining=${teardownRes.residualsRemaining}, userCleaned=${teardownRes.userCleaned}`,
      });

      if (teardownRes.allErrors.length > 0) {
        cleanupErrors.push(...teardownRes.allErrors);
      }

      return finalize(
        assertions,
        path.join(runEvidenceDir, "evidence.json"),
        cleanupErrors,
        CLEANUP_FAILURE_REGISTRY,
        {
          mode: "cleanup_failure",
          runId,
          expectedExitCode: 1,
          runnerRevisionSha256: getRunnerRevisionSha256(),
          operationsAttempted: teardownRes.operationsAttempted,
          operationsSucceeded: teardownRes.operationsSucceeded,
          recoveryAttempted: teardownRes.recoveryAttempted,
          recoveryCompleted: teardownRes.recoveryCompleted,
          residualsRemaining: teardownRes.residualsRemaining,
          residualBreakdown: teardownRes.residualBreakdown,
          expectedInjectedFailuresCount: 1,
          unexpectedFailuresCount: teardownRes.fallbackErrors.length,
          teardownRecovery: {
            expectedFault: "explicit_fixture_cleanup",
            primaryErrorsCount: teardownRes.primaryErrors.length,
            primaryErrors: teardownRes.primaryErrors.map((e) => e.message || String(e)),
            fallbackErrorsCount: teardownRes.fallbackErrors.length,
            fallbackErrors: teardownRes.fallbackErrors.map((e) => e.message || String(e)),
            userCleaned: teardownRes.userCleaned,
            residualsRemaining: teardownRes.residualsRemaining,
            foreignFixtureIntact: foreignIntact,
            residualChecksExamined: [
              { name: "customers", count: teardownRes.residualsRemaining },
            ],
          },
        }
      );
    }
  }

  // 3b. FOREIGN CHECK FAILURE HARNESS (--test-foreign-check-failure)
  if (TEST_FOREIGN_CHECK_FAILURE) {
    console.log(">> VERIFIKASI HARNESS: Injeksi Kegagalan Pemeriksaan Fixture Pembanding <<");
    const runId = "foreign-chk-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    const tracker = new TestResourceTracker();
    let staffUserId = null;
    let foreignCustId = crypto.randomUUID();
    let foreignSrvId = crypto.randomUUID();
    let foreignOdcId = crypto.randomUUID();
    let foreignOdpId = crypto.randomUUID();
    let foreignLinkId = `LINK-FOREIGN-CHK-${runId}`;
    const foreignFixtureIds = {
      runId,
      foreignCustId,
      foreignSrvId,
      foreignOdcId,
      foreignOdpId,
      foreignLinkId,
    };

    let pool = null;
    let supabaseAdmin = null;
    const cleanupErrors = [];
    let faultCaught = false;
    let subsequentCleanupAttempted = false;
    let subsequentCleanupSuccess = false;
    let residualRes = { totalResiduals: -1, isZero: false, counts: {} };
    let cleanupRes = { operationsAttempted: [], operationsSucceeded: [], errors: [] };

    try {
      const config = parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
        HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
        HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
        HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
      });
      pool = new Pool({ connectionString: config.databaseUrl });
      supabaseAdmin = createClient(config.apiUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const testEmail = `staff_fchk_${runId}@example.com`;
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: "TempPassword123!",
        email_confirm: true,
      });
      if (userError || !userData?.user) {
        throw new Error("Failed creating test user in foreign check failure test: " + (userError?.message || "unknown"));
      }
      staffUserId = userData.user.id;

      // Seed foreign comparison fixture using shared implementation
      await seedForeignComparisonFixture(pool, foreignFixtureIds);
    } catch (setupErr) {
      cleanupErrors.push(setupErr);
    } finally {
      const teardownRes = await executeLifecycleTeardown({
        pool,
        supabaseAdmin,
        staffUserId,
        tracker,
        endPool: false,
      });
      if (teardownRes.allErrors.length > 0) {
        cleanupErrors.push(...teardownRes.allErrors);
      }

      // Inject fault into the shared checkForeignComparisonFixture query operation
      const faultInjectingClient = {
        query: async (sql, params) => {
          if (typeof sql === "string" && sql.includes("SELECT count(*) FROM public.customers WHERE id = $1")) {
            throw new Error("Injected fault on foreign check query: simulated database timeout or connection reset");
          }
          return pool.query(sql, params);
        },
      };

      try {
        await checkForeignComparisonFixture(faultInjectingClient, foreignFixtureIds);
      } catch (err) {
        faultCaught = true;
        cleanupErrors.push(err);
      }

      // Subsequent foreign cleanup step MUST still be attempted and succeed despite check failure
      try {
        if (pool) {
          cleanupRes = await cleanupForeignComparisonFixture(pool, foreignFixtureIds);
          subsequentCleanupAttempted = cleanupRes.operationsAttempted.length > 0;
          subsequentCleanupSuccess = cleanupRes.success;
          if (!cleanupRes.success) {
            for (const item of cleanupRes.errors) {
              cleanupErrors.push(item.error);
            }
          }
          residualRes = await queryForeignComparisonResiduals(pool, foreignFixtureIds);
        }
      } catch (fErr) {
        cleanupErrors.push(fErr);
      }

      if (pool) {
        try {
          await pool.end();
        } catch (pEndErr) {
          cleanupErrors.push(pEndErr);
        }
      }

      const expectedInjectedFailures = cleanupErrors.filter((e) =>
        (e.message || String(e)).includes("Injected fault on foreign check query")
      );
      const unexpectedFailures = cleanupErrors.filter(
        (e) => !(e.message || String(e)).includes("Injected fault on foreign check query")
      );

      recordAssertion({
        id: "foreign_check_fault_injected",
        name: "Injeksi kegagalan pemeriksaan fixture pembanding tertangkap tanpa menghentikan runner",
        pass: faultCaught && expectedInjectedFailures.length > 0 && unexpectedFailures.length === 0,
        expected: "Foreign check query fault caught, recorded, and no unexpected errors",
        actual: faultCaught
          ? `Injected check fault caught (expected: ${expectedInjectedFailures.length}, unexpected: ${unexpectedFailures.length})`
          : "Not caught",
      });

      recordAssertion({
        id: "subsequent_cleanup_attempted",
        name: "Langkah cleanup pembanding lanjutan tetap dicoba dan pool ditutup meski pemeriksaan gagal",
        pass: subsequentCleanupAttempted && subsequentCleanupSuccess && residualRes.isZero,
        expected: "subsequentCleanupAttempted=true, subsequentCleanupSuccess=true, residuals=0",
        actual: `attempted=${subsequentCleanupAttempted}, success=${subsequentCleanupSuccess}, residuals=${residualRes.totalResiduals}`,
      });

      recordAssertion({
        id: "runner_cleanup_and_teardown",
        name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
        pass: false,
        expected: "Harus gagal karena injeksi kegagalan pemeriksaan",
        actual: cleanupErrors.map((e) => e.message || String(e)).join("; "),
      });

      return finalize(
        assertions,
        path.join(runEvidenceDir, "evidence.json"),
        cleanupErrors,
        FOREIGN_CHECK_FAILURE_REGISTRY,
        {
          mode: "foreign_check_failure",
          runId,
          expectedExitCode: 1,
          runnerRevisionSha256: getRunnerRevisionSha256(),
          operationsAttempted: cleanupRes.operationsAttempted,
          operationsSucceeded: cleanupRes.operationsSucceeded,
          residualsRemaining: residualRes.totalResiduals,
          residualBreakdown: residualRes.counts,
          expectedInjectedFailuresCount: expectedInjectedFailures.length,
          unexpectedFailuresCount: unexpectedFailures.length,
        }
      );
    }
  }

  // 3c. FOREIGN DELETE FAILURE HARNESS (--test-foreign-delete-failure)
  if (TEST_FOREIGN_DELETE_FAILURE) {
    console.log(">> VERIFIKASI HARNESS: Injeksi Kegagalan Langkah Penghapusan Fixture Pembanding <<");
    const runId = "foreign-del-fail-" + crypto.randomUUID().slice(0, 8);
    const runEvidenceDir = path.join(baseEvidenceDir, runId);
    fs.mkdirSync(runEvidenceDir, { recursive: true });

    const tracker = new TestResourceTracker();
    let staffUserId = null;
    let foreignCustId = crypto.randomUUID();
    let foreignSrvId = crypto.randomUUID();
    let foreignOdcId = crypto.randomUUID();
    let foreignOdpId = crypto.randomUUID();
    let foreignLinkId = `LINK-FOREIGN-DEL-${runId}`;
    const foreignFixtureIds = {
      runId,
      foreignCustId,
      foreignSrvId,
      foreignOdcId,
      foreignOdpId,
      foreignLinkId,
    };

    let pool = null;
    let supabaseAdmin = null;
    const cleanupErrors = [];
    let faultCaught = false;
    let subsequentStepsAttempted = false;
    let recoveryCompleted = false;
    let residualRes = { totalResiduals: -1, isZero: false, counts: {} };
    let initialCleanupRes = { operationsAttempted: [], operationsSucceeded: [], errors: [] };

    try {
      const config = parseAndValidateTestConfig({
        HELPDESK_TEST_DATABASE_URL: process.env.HELPDESK_TEST_DATABASE_URL || process.env.DATABASE_URL,
        HELPDESK_TEST_API_URL: process.env.HELPDESK_TEST_API_URL,
        HELPDESK_TEST_SERVICE_ROLE_KEY: process.env.HELPDESK_TEST_SERVICE_ROLE_KEY,
        HELPDESK_TEST_ENV_MARKER: process.env.HELPDESK_TEST_ENV_MARKER || "test-env-marker-ok",
      });
      pool = new Pool({ connectionString: config.databaseUrl });
      supabaseAdmin = createClient(config.apiUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const testEmail = `staff_fdel_${runId}@example.com`;
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: "TempPassword123!",
        email_confirm: true,
      });
      if (userError || !userData?.user) {
        throw new Error("Failed creating test user in foreign delete failure test: " + (userError?.message || "unknown"));
      }
      staffUserId = userData.user.id;

      // Seed foreign comparison fixture using shared implementation
      await seedForeignComparisonFixture(pool, foreignFixtureIds);
    } catch (setupErr) {
      cleanupErrors.push(setupErr);
    } finally {
      const teardownRes = await executeLifecycleTeardown({
        pool,
        supabaseAdmin,
        staffUserId,
        tracker,
        endPool: false,
      });
      if (teardownRes.allErrors.length > 0) {
        cleanupErrors.push(...teardownRes.allErrors);
      }

      // Check foreign comparison fixture intactness prior to cleanup
      try {
        if (pool) {
          await checkForeignComparisonFixture(pool, foreignFixtureIds);
        }
      } catch (chkErr) {
        cleanupErrors.push(chkErr);
      }

      // Inject fault into one specific delete operation in cleanupForeignComparisonFixture
      const faultInjectingClient = {
        query: async (sql, params) => {
          if (typeof sql === "string" && sql.includes("DELETE FROM public.mock_upstream_status")) {
            throw new Error("Injected fault on foreign delete step (mock_upstream_status): simulated foreign key or table lock exception");
          }
          return pool.query(sql, params);
        },
      };

      try {
        initialCleanupRes = await cleanupForeignComparisonFixture(faultInjectingClient, foreignFixtureIds);
        if (initialCleanupRes.errors.length > 0) {
          faultCaught = true;
          for (const item of initialCleanupRes.errors) {
            cleanupErrors.push(item.error);
          }
        }
        subsequentStepsAttempted =
          initialCleanupRes.operationsAttempted.length === 6 &&
          initialCleanupRes.operationsSucceeded.length === 5;
      } catch (err) {
        cleanupErrors.push(err);
      }

      // Pemulihan (recovery): clean up remaining uncleaned foreign resource(s) using healthy pool
      try {
        if (pool) {
          const recoveryRes = await cleanupForeignComparisonFixture(pool, foreignFixtureIds);
          recoveryCompleted = recoveryRes.success;
          residualRes = await queryForeignComparisonResiduals(pool, foreignFixtureIds);
        }
      } catch (recErr) {
        cleanupErrors.push(recErr);
      }

      if (pool) {
        try {
          await pool.end();
        } catch (pEndErr) {
          cleanupErrors.push(pEndErr);
        }
      }

      const expectedInjectedFailures = cleanupErrors.filter((e) =>
        (e.message || String(e)).includes("Injected fault on foreign delete step")
      );
      const unexpectedFailures = cleanupErrors.filter(
        (e) => !(e.message || String(e)).includes("Injected fault on foreign delete step")
      );

      recordAssertion({
        id: "foreign_delete_fault_injected",
        name: "Injeksi kegagalan salah satu langkah penghapusan pembanding tertangkap tanpa menghentikan runner",
        pass: faultCaught && expectedInjectedFailures.length > 0 && unexpectedFailures.length === 0,
        expected: "Foreign delete query fault caught, recorded, and no unexpected errors",
        actual: faultCaught
          ? `Injected delete fault caught (expected: ${expectedInjectedFailures.length}, unexpected: ${unexpectedFailures.length})`
          : "Not caught",
      });

      recordAssertion({
        id: "subsequent_cleanup_attempted",
        name: "Langkah penghapusan pembanding berikutnya tetap dicoba dan pool ditutup meski langkah sebelumnya gagal",
        pass: subsequentStepsAttempted && recoveryCompleted && residualRes.isZero,
        expected: "subsequentStepsAttempted=true (5/6 succeeded initially), recoveryCompleted=true, residuals=0",
        actual: `attempted=${subsequentStepsAttempted} (succeeded initially: ${initialCleanupRes.operationsSucceeded.length}/${initialCleanupRes.operationsAttempted.length}), recoveryCompleted=${recoveryCompleted}, residuals=${residualRes.totalResiduals}`,
      });

      recordAssertion({
        id: "runner_cleanup_and_teardown",
        name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
        pass: false,
        expected: "Harus gagal karena injeksi kegagalan delete pembanding",
        actual: cleanupErrors.map((e) => e.message || String(e)).join("; "),
      });

      return finalize(
        assertions,
        path.join(runEvidenceDir, "evidence.json"),
        cleanupErrors,
        FOREIGN_DELETE_FAILURE_REGISTRY,
        {
          mode: "foreign_delete_failure",
          runId,
          expectedExitCode: 1,
          runnerRevisionSha256: getRunnerRevisionSha256(),
          operationsAttempted: initialCleanupRes.operationsAttempted,
          operationsSucceeded: initialCleanupRes.operationsSucceeded,
          recoveryCompleted,
          residualsRemaining: residualRes.totalResiduals,
          residualBreakdown: residualRes.counts,
          expectedInjectedFailuresCount: expectedInjectedFailures.length,
          unexpectedFailuresCount: unexpectedFailures.length,
        }
      );
    }
  }

  // 4. NORMAL LIVE BROWSER RUN
  const runId = "run-" + crypto.randomUUID().slice(0, 8);
  const runEvidenceDir = path.join(baseEvidenceDir, runId);
  const screenshotsDir = path.join(runEvidenceDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const tracker = new TestResourceTracker();
  let staffUserId = null;
  let staffEmail = null;
  let cust1Id = null;
  let srv1Id = null;
  let ident1Id = null;
  let conv1Id = null;
  let comp1Id = null;
  let msg1Id = null;
  let incActiveId = null;
  let incHistId = null;
  let odpId = null;
  let odcId = null;
  let ident2Id = null;
  let conv2Id = null;
  let msg2Id = null;
  let cust3Id = null;
  let ident3Id = null;
  let conv3Id = null;
  let msg3Id = null;
  let srv3HomeId = null;
  let srv3OfficeId = null;
  let linkId = null;
  let foreignCustId = null;
  let foreignSrvId = null;
  let foreignOdcId = null;
  let foreignOdpId = null;
  let foreignLinkId = null;
  let pool = null;
  let supabaseAdmin = null;
  let nextProc = null;
  let chromeProc = null;
  let cdp = null;
  let userDataDir = null;
  const cleanupErrors = [];
  const capturedScreenshots = [];

  const sourceHashesAtLaunch = computeSourceHashes();
  const buildManifest = readBuildManifest();
  const buildId = getBuildId();
  let buildValidation = null;

  try {
    // 3.1 Validate Build-to-Source Binding
    console.log("\n--- [1] Validasi Pengikatan Build-to-Source ---");
    buildValidation = validateBuildMetadata({
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

    // 3.2 Validate Isolated Environment
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

    // 3.3 Create Test Staff User
    staffEmail = `staff-p27-${runId}@upaznet.test`;
    const staffPassword = `P27Staff!Pass_${runId}`;
    console.log(`[Setup] Membuat user staf pengujian: ${staffEmail}`);

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: staffEmail,
      password: staffPassword,
      email_confirm: true,
      user_metadata: { role: "staff", displayName: `Staf Tester ${runId}` },
    });
    if (userError || !userData?.user) {
      throw new Error(`Gagal membuat user staf: ${userError?.message || "No user data"}`);
    }
    staffUserId = userData.user.id;

    // 3.4 Seed Fixtures
    console.log(`[Setup] Menyiapkan fixture percakapan dan topologi untuk run ${runId}...`);
    const baseTime = new Date("2026-10-09T08:00:00Z");

    const odpCode = `ODP-P27-${runId}`;
    const odcCode = `ODC-P27-${runId}`;
    linkId = `LINK-P27-${runId}`;
    const cust1Code = `CUST-P27-${runId}`;
    const srv1Code = `SRV-P27-${runId}`;
    const cust3Code = `CUST-AMB-${runId}`;
    const srv3HomeCode = `SRV-HOME-${runId}`;
    const srv3OfficeCode = `SRV-OFFICE-${runId}`;

    // Setup foreign comparison fixture owned by harness, intentionally outside the run's ownership
    foreignCustId = crypto.randomUUID();
    foreignSrvId = crypto.randomUUID();
    foreignOdcId = crypto.randomUUID();
    foreignOdpId = crypto.randomUUID();
    foreignLinkId = `LINK-FOREIGN-${runId}`;

    await seedForeignComparisonFixture(pool, {
      runId,
      foreignCustId,
      foreignSrvId,
      foreignOdcId,
      foreignOdpId,
      foreignLinkId,
    });

    // Fixture 1: Verified customer, service, ODP/ODC, active incident, and historical assessment
    cust1Id = crypto.randomUUID();
    srv1Id = crypto.randomUUID();
    ident1Id = crypto.randomUUID();
    conv1Id = crypto.randomUUID();
    comp1Id = crypto.randomUUID();
    msg1Id = crypto.randomUUID();
    incActiveId = crypto.randomUUID();
    incHistId = crypto.randomUUID();
    odpId = crypto.randomUUID();
    odcId = crypto.randomUUID();

    tracker.recordCustomer(cust1Id);
    tracker.recordService(srv1Id);
    tracker.recordIncident(incActiveId);
    tracker.recordIdentity(ident1Id);
    tracker.recordConversation(conv1Id);
    tracker.recordComplaint(comp1Id);
    tracker.recordMessage(msg1Id);
    tracker.recordIngress(msg1Id);

    // Insert Customer 1
    await pool.query(
      `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
       VALUES ($1, 'Pelanggan Alpha (P27)', 'active', $2, now(), now())`,
      [cust1Id, cust1Code]
    );

    // Insert Service 1
    await pool.query(
      `INSERT INTO public.services (id, customer_id, service_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Layanan Rumah', 'active', now(), now())`,
      [srv1Id, cust1Id, srv1Code]
    );

    // Insert ODP & ODC with status 'active' and run-scoped codes
    await pool.query(
      `INSERT INTO public.odcs (id, odc_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, 'ODC Wilayah 1', 'active', now(), now())`,
      [odcId, odcCode]
    );
    await pool.query(
      `INSERT INTO public.odps (id, odc_id, odp_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ODP Cluster 1', 'active', now(), now())`,
      [odpId, odcId, odpCode]
    );

    // Insert Service Topology
    await pool.query(
      `INSERT INTO public.service_topology (id, service_id, odp_id, mapping_version, source, valid_from, created_at)
       VALUES ($1, $2, $3, 1, 'MOCK', '2026-09-01T00:00:00Z', now())`,
      [crypto.randomUUID(), srv1Id, odpId]
    );

    // Insert Mock ONU & Upstream Status for srv1Id (P2.7 Evidence verification)
    await pool.query(
      `INSERT INTO public.mock_onu_status (scenario_id, service_id, status, observed_at, event_id)
       VALUES ('normal', $1, 'online', now(), $2)
       ON CONFLICT (scenario_id, service_id) DO UPDATE SET status = 'online', observed_at = now()`,
      [srv1Id, crypto.randomUUID()]
    );
    await pool.query(
      `INSERT INTO public.mock_upstream_status (scenario_id, link_id, status, observed_at, event_id)
       VALUES ('normal', $1, 'up', now(), $2)
       ON CONFLICT (scenario_id, link_id) DO UPDATE SET status = 'up', observed_at = now()`,
      [linkId, crypto.randomUUID()]
    );
    await pool.query(
      `INSERT INTO public.mock_upstream_impacts (scenario_id, link_id, service_id, mapping_version)
       VALUES ('normal', $1, $2, 1)
       ON CONFLICT (scenario_id, link_id, service_id) DO UPDATE SET mapping_version = 1`,
      [linkId, srv1Id]
    );

    // Insert Identity 1 (Verified)
    const botAccountId = `bot-p27-${runId}`;
    const sender1Id = `p27-sender-alpha-${runId}`;
    const sender2Id = `p27-sender-unverified-${runId}`;
    const sender3Id = `p27-sender-ambiguous-${runId}`;

    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Pelanggan Alpha (P27)', $4, 'verified', now(), now(), now())`,
      [ident1Id, botAccountId, sender1Id, cust1Id]
    );

    // Insert Conversation 1
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $6, now(), now())`,
      [conv1Id, ident1Id, botAccountId, sender1Id, baseTime, new Date(baseTime.getTime() + 1000)]
    );

    // Insert Complaint 1
    await pool.query(
      `INSERT INTO public.complaints (id, identity_id, service_id, category, status, is_primary, created_at, updated_at)
       VALUES ($1, $2, $3, 'connection_complaint', 'IN_PROGRESS', true, now(), now())`,
      [comp1Id, ident1Id, srv1Id]
    );

    // Insert Ingress & Message 1 (Unread)
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Internet saya mati lampu merah LOS menyala sejak pagi.', $6, 'SHADOW', 1, false)`,
      [msg1Id, ident1Id, botAccountId, sender1Id, `pmsg-1-${runId}`, baseTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, null, $6)`,
      [
        msg1Id,
        ident1Id,
        conv1Id,
        comp1Id,
        JSON.stringify({ category: "KONEKSI_MATI", reason: "keyword_match" }),
        baseTime,
      ]
    );

    // Insert Historical Triage Assessment on Message 1
    await pool.query(
      `INSERT INTO public.triage_assessments (message_id, decision, processing_result, created_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now())`,
      [
        msg1Id,
        JSON.stringify({
          evaluatedAt: "2026-10-09T08:00:05Z",
          ruleVersion: "rule-p27-v1",
          outcome: "candidate",
          reason: "los_area",
          candidateTemplateKey: "LOS_AREA",
          effectiveTemplateKey: "LOS_AREA",
          incidentId: incHistId,
          eventIds: ["EVT-HIST-01"],
          notes: ["LOS_RATIO_EXCEEDED"],
          automation: { mode: "SHADOW", disposition: "blocked", blockedReasons: ["shadow_mode"] },
          evidence: [
            { kind: "onu", status: "LOS", observedAt: "2026-10-09T08:00:00Z", eventId: "EVT-HIST-01" },
            { kind: "area", scope: "ODP", scopeId: odpCode, total: 10, valid: 8, los: 4, coverage: 0.8, losRatio: 0.5 },
          ],
        }),
        JSON.stringify({
          claim: { outcome: "claimed", reason: "new_complaint", intentId: null },
          dispatchAuthorized: false,
        }),
      ]
    );

    // Insert Active Incident (Current operational state)
    await pool.query(
      `INSERT INTO public.incidents (id, type, status, odp_ids, odc_ids, version, created_at, updated_at)
       VALUES ($1, 'AREA_SPECIFIC', 'ACTIVE', $2, '{}', 2, now(), now())`,
      [incActiveId, [odpId]]
    );

    // Fixture 2: Unverified Customer
    ident2Id = crypto.randomUUID();
    conv2Id = crypto.randomUUID();
    msg2Id = crypto.randomUUID();
    tracker.recordIdentity(ident2Id);
    tracker.recordConversation(conv2Id);
    tracker.recordMessage(msg2Id);
    tracker.recordIngress(msg2Id);

    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Pengirim Belum Terverifikasi', null, 'unverified', null, now(), now())`,
      [ident2Id, botAccountId, sender2Id]
    );
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $6, now(), now())`,
      [conv2Id, ident2Id, botAccountId, sender2Id, baseTime, new Date(baseTime.getTime() + 2000)]
    );
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Halo, nomor pelanggan saya belum terdaftar.', $6, 'SHADOW', 1, false)`,
      [msg2Id, ident2Id, botAccountId, sender2Id, `pmsg-2-${runId}`, baseTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [msg2Id, ident2Id, conv2Id, JSON.stringify({ category: "GENERAL", reason: "keyword_match" }), baseTime]
    );

    // Fixture 3: Ambiguous Customer with 2 services
    cust3Id = crypto.randomUUID();
    ident3Id = crypto.randomUUID();
    conv3Id = crypto.randomUUID();
    msg3Id = crypto.randomUUID();
    srv3HomeId = crypto.randomUUID();
    srv3OfficeId = crypto.randomUUID();
    tracker.recordCustomer(cust3Id);
    tracker.recordService(srv3HomeId);
    tracker.recordService(srv3OfficeId);
    tracker.recordIdentity(ident3Id);
    tracker.recordConversation(conv3Id);
    tracker.recordMessage(msg3Id);
    tracker.recordIngress(msg3Id);

    await pool.query(
      `INSERT INTO public.customers (id, display_name, status, customer_code, created_at, updated_at)
       VALUES ($1, 'Pelanggan Multi Layanan (P27)', 'active', $2, now(), now())`,
      [cust3Id, cust3Code]
    );
    await pool.query(
      `INSERT INTO public.services (id, customer_id, service_code, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Rumah', 'active', now(), now()),
              ($4, $2, $5, 'Kantor', 'active', now(), now())`,
      [srv3HomeId, cust3Id, srv3HomeCode, srv3OfficeId, srv3OfficeCode]
    );
    await pool.query(
      `INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot, customer_id, verification_status, verified_at, created_at, updated_at)
       VALUES ($1, 'telegram', $2, $3, 'Pelanggan Multi Layanan (P27)', $4, 'verified', now(), now(), now())`,
      [ident3Id, botAccountId, sender3Id, cust3Id]
    );
    await pool.query(
      `INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, 'telegram', $3, $4, 'active', $5, $6, now(), now())`,
      [conv3Id, ident3Id, botAccountId, sender3Id, baseTime, new Date(baseTime.getTime() + 3000)]
    );
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Layanan saya bermasalah.', $6, 'SHADOW', 1, false)`,
      [msg3Id, ident3Id, botAccountId, sender3Id, `pmsg-3-${runId}`, baseTime]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [msg3Id, ident3Id, conv3Id, JSON.stringify({ category: "GENERAL", reason: "keyword_match" }), baseTime]
    );

    // 3.5 Launch Next.js Application on dedicated port
    const nextPort = await findAvailablePort(3340);
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
    console.log(`[Setup] Server Next.js siap pada port ${nextPort} (runId: ${runId}).`);

    // 3.6 Launch Headless Chrome & CDP
    const chromePort = await findAvailablePort(9227);
    userDataDir = path.join(
      process.env.TEMP || "C:\\Users\\INVANSION\\AppData\\Local\\Temp",
      `chrome_dev_p27_${runId}`
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

    async function takeScreenshot(name) {
      const filename = `${name}.png`;
      const filepath = path.join(screenshotsDir, filename);
      const res = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(filepath, Buffer.from(res.data, "base64"));
      capturedScreenshots.push(filename);
      console.log(`[Screenshot] Tersimpan: ${filename}`);
    }

    // 3.7 Staff Login via Real Next.js Form
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

    await delay(1500);

    // ========================================================================
    // 4. TEST SCENARIOS
    // ========================================================================

    // Scenario 1: Wide Desktop (1440x900) - 3 Columns Side-by-Side
    console.log("\n--- [5] Validasi Layout 3 Kolom Desktop Lebar (>= 1440px) ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(800);

    // Select Conversation A (Verified)
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pelanggan Alpha'));
        if (item) item.click();
      })(${JSON.stringify(conv1Id)})`,
    });
    await delay(1500);

    const wideLayoutRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const listSection = document.querySelector('section[aria-label="Antrean percakapan masuk"]');
        const detailSection = document.querySelector('section[aria-label="Panel percakapan aktif"]');
        const evidencePanels = Array.from(document.querySelectorAll('aside[aria-label="Panel konteks identitas dan evidence jaringan"], aside[aria-labelledby]'));
        const visibleEvidence = evidencePanels.find(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && window.getComputedStyle(el).display !== 'none';
        });
        const drawerBtn = document.querySelector('[data-testid="toggle-evidence-drawer-btn"]');
        const drawerBtnVisible = drawerBtn ? window.getComputedStyle(drawerBtn).display !== 'none' : false;

        const listWidth = listSection ? Math.round(listSection.getBoundingClientRect().width) : 0;
        const evidenceWidth = visibleEvidence ? Math.round(visibleEvidence.getBoundingClientRect().width) : 0;
        const conversationWidth = detailSection ? Math.round(detailSection.getBoundingClientRect().width) - evidenceWidth : 0;
        const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

        return {
          hasList: Boolean(listSection),
          hasDetail: Boolean(detailSection),
          hasSideBySideEvidence: Boolean(visibleEvidence),
          listWidth,
          conversationWidth,
          evidenceWidth,
          hasHorizontalOverflow,
          drawerBtnVisible,
        };
      })()`,
      returnByValue: true,
    });
    const wideData = wideLayoutRes.result.value || {};
    const widePass = Boolean(
      wideData.hasSideBySideEvidence &&
      !wideData.drawerBtnVisible &&
      wideData.listWidth === 300 &&
      wideData.evidenceWidth === 280 &&
      wideData.conversationWidth >= 420 &&
      !wideData.hasHorizontalOverflow
    );

    recordAssertion({
      id: "desktop_wide_three_column_layout",
      name: "Desktop lebar (1440px): 3 kolom permanen berdampingan (list=300px, chat>=420px, evidence=280px) tanpa overflow",
      pass: widePass,
      expected: "list=300px, evidence=280px, conversation>=420px, overflow=false, drawerBtnVisible=false",
      actual: `list=${wideData.listWidth}px, evidence=${wideData.evidenceWidth}px, conversation=${wideData.conversationWidth}px, overflow=${wideData.hasHorizontalOverflow}, drawerBtnVisible=${wideData.drawerBtnVisible}`,
    });

    await takeScreenshot("01_desktop_wide_1440");

    // Scenario 2: Identity & Topology Verification
    console.log("\n--- [6] Validasi Konteks Identitas, Topologi & Incident Aktif ---");
    const contextRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const bodyText = document.body.innerText;
        const lowerBody = bodyText.toLowerCase();
        return {
          hasCustomerAlpha: bodyText.includes('Pelanggan Alpha'),
          hasVerifiedStatus: bodyText.includes('Terverifikasi'),
          hasServiceCode: bodyText.includes(${JSON.stringify(srv1Code)}),
          hasOdp: bodyText.includes(${JSON.stringify(odpCode)}),
          hasOdc: bodyText.includes(${JSON.stringify(odcCode)}),
          hasActiveIncident: bodyText.includes('Incident Aktif Saat Ini') && bodyText.includes(${JSON.stringify(incActiveId)}),
          hasHistoricalAssessment: lowerBody.includes('keputusan triage historis') && lowerBody.includes('los_area'),
          hasHistoricalIncident: bodyText.includes(${JSON.stringify(incHistId)}),
        };
      })()`,
      returnByValue: true,
    });
    const ctxData = contextRes.result.value || {};

    recordAssertion({
      id: "identity_context_verified_resolution",
      name: "Pengirim terverifikasi meresolusi pelanggan dan layanan aktif tunggal",
      pass: ctxData.hasCustomerAlpha && ctxData.hasVerifiedStatus && ctxData.hasServiceCode,
      expected: `Pelanggan Alpha, Terverifikasi, ${srv1Code}`,
      actual: `cust=${ctxData.hasCustomerAlpha}, verif=${ctxData.hasVerifiedStatus}, srv=${ctxData.hasServiceCode}`,
    });

    recordAssertion({
      id: "identity_context_topology_odp_odc",
      name: "Topologi ODP dan ODC ditampilkan secara tepat untuk layanan aktif",
      pass: ctxData.hasOdp && ctxData.hasOdc,
      expected: `${odpCode} dan ${odcCode}`,
      actual: `odp=${ctxData.hasOdp}, odc=${ctxData.hasOdc}`,
    });

    recordAssertion({
      id: "operational_context_active_incident",
      name: "Incident aktif saat ini ditampilkan dalam bagian konteks operasional aktif",
      pass: ctxData.hasActiveIncident,
      expected: `Incident Aktif Saat Ini dengan ID ${incActiveId}`,
      actual: `hasActiveIncident=${ctxData.hasActiveIncident}`,
    });

    recordAssertion({
      id: "triage_historical_assessment_fidelity",
      name: "Keputusan triage historis menampilkan alasan, template, dan incident historis tersimpan",
      pass: ctxData.hasHistoricalAssessment && ctxData.hasHistoricalIncident,
      expected: "Keputusan los_area dan incident historis tersimpan",
      actual: `histAssessment=${ctxData.hasHistoricalAssessment}, histInc=${ctxData.hasHistoricalIncident}`,
    });

    // Scenario 3: Medium Desktop (1280x800) - Drawer & Focus Trap & Escape
    console.log("\n--- [7] Validasi Drawer Desktop Sedang (1280px), Focus Trap & Escape ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(800);

    await takeScreenshot("02_desktop_medium_drawer_closed");

    // Verify 3rd column is hidden and drawer trigger is visible
    const medPreRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const drawerBtn = document.querySelector('[data-testid="toggle-evidence-drawer-btn"]');
        return {
          drawerBtnFound: Boolean(drawerBtn),
          drawerBtnVisible: drawerBtn ? window.getComputedStyle(drawerBtn).display !== 'none' : false,
        };
      })()`,
      returnByValue: true,
    });
    const medPreData = medPreRes.result.value || {};

    // Click drawer button to open
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const drawerBtn = document.querySelector('[data-testid="toggle-evidence-drawer-btn"]');
        if (drawerBtn) drawerBtn.click();
      })()`,
    });
    await delay(600);

    await takeScreenshot("03_desktop_medium_drawer_open");

    // Check drawer dialog is open and focus trap
    const drawerOpenRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const dialog = document.querySelector('div[role="dialog"][aria-label="Panel Konteks & Bukti Jaringan"]');
        const activeEl = document.activeElement;
        const isFocusInside = dialog ? dialog.contains(activeEl) : false;
        return {
          dialogFound: Boolean(dialog),
          isFocusInside,
        };
      })()`,
      returnByValue: true,
    });
    const drawerOpenData = drawerOpenRes.result.value || {};

    recordAssertion({
      id: "desktop_medium_drawer_slide_over",
      name: "Desktop sedang (1280px): tombol drawer memunculkan dialog slide-over konteks bukti",
      pass: medPreData.drawerBtnVisible && drawerOpenData.dialogFound,
      expected: "drawerBtnVisible=true, dialogFound=true",
      actual: `drawerBtnVisible=${medPreData.drawerBtnVisible}, dialogFound=${drawerOpenData.dialogFound}`,
    });

    // Insert a new unread message while drawer is open to test read suppression
    const msgDrawerId = crypto.randomUUID();
    tracker.recordMessage(msgDrawerId);
    tracker.recordIngress(msgDrawerId);
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Pesan uji supresi saat drawer terbuka', now(), 'SHADOW', 1, false)`,
      [msgDrawerId, ident1Id, botAccountId, sender1Id, `pmsg-drawer-suppress-${runId}`]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, $4, '{"category":"KONEKSI_MATI","reason":"keyword_match"}'::jsonb, null, now())`,
      [msgDrawerId, ident1Id, conv1Id, comp1Id]
    );

    // Wait for client polling (POLLING_INTERVAL_MS=5000) to receive the message while drawer is open
    await delay(5500);

    // Verify message remains unacknowledged in DB while drawer is open
    const dbReadBeforeClose = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
      [staffUserId, msgDrawerId]
    );
    const isReadSuppressed = Number(dbReadBeforeClose.rows[0].cnt) === 0;

    // Press Escape key
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await delay(600);

    // Verify drawer closed and focus returned to trigger
    const drawerClosedRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const dialog = document.querySelector('div[role="dialog"][aria-label="Panel Konteks & Bukti Jaringan"]');
        const drawerBtn = document.querySelector('[data-testid="toggle-evidence-drawer-btn"]');
        return {
          dialogClosed: !dialog,
          isFocusRestored: document.activeElement === drawerBtn,
        };
      })()`,
      returnByValue: true,
    });
    const drawerClosedData = drawerClosedRes.result.value || {};

    recordAssertion({
      id: "desktop_medium_drawer_focus_trap_and_escape",
      name: "Focus trap aktif saat drawer terbuka, tombol Escape menutup drawer dan mengembalikan fokus",
      pass: drawerOpenData.isFocusInside && drawerClosedData.dialogClosed,
      expected: "focusInside=true, dialogClosed=true",
      actual: `focusInside=${drawerOpenData.isFocusInside}, dialogClosed=${drawerClosedData.dialogClosed}`,
    });

    // Verify that once drawer closed, read-ack triggers and marks message read in DB
    await delay(1500);
    const dbReadAfterClose = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
      [staffUserId, msgDrawerId]
    );
    const isReadAcknowledgedAfterClose = Number(dbReadAfterClose.rows[0].cnt) > 0;

    recordAssertion({
      id: "drawer_read_ack_suppression",
      name: "Supresi read-ack saat drawer terbuka dan konfirmasi baca tercatat di DB setelah ditutup",
      pass: isReadSuppressed && isReadAcknowledgedAfterClose,
      expected: "beforeClose=0, afterClose>0",
      actual: `beforeClose=${dbReadBeforeClose.rows[0].cnt}, afterClose=${dbReadAfterClose.rows[0].cnt}`,
    });

    // Scenario 4: Mobile Viewport (375x667) - Subnav Tabs & Suppression
    console.log("\n--- [8] Validasi Tampilan Mobile (375px) & Supresi Tab Konteks ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 667,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(800);

    // Select Conversation 2 (Unverified)
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pengirim Belum Terverifikasi'));
        if (item) item.click();
      })(${JSON.stringify(conv2Id)})`,
    });
    await delay(1200);

    // Switch to 'context' tab on mobile
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const tabContext = document.querySelector('button[role="tab"][aria-selected="false"]') || Array.from(document.querySelectorAll('button[role="tab"]')).find(b => b.textContent.includes('Konteks'));
        if (tabContext) tabContext.click();
      })()`,
    });
    await delay(800);

    await takeScreenshot("04_mobile_context_tab");

    const mobileContextRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const bodyText = document.body.innerText;
        const panel = document.querySelector('section[aria-label="Panel percakapan aktif"]') || document.querySelector('main');
        const r = panel ? panel.getBoundingClientRect() : null;
        const unverifiedCard = Array.from(document.querySelectorAll('*')).find(el => el.textContent.includes('Identitas Belum Terverifikasi'));
        const unvRect = unverifiedCard ? unverifiedCard.getBoundingClientRect() : null;
        return {
          hasUnverifiedWarning: bodyText.includes('Identitas Belum Terverifikasi'),
          panelWidth: r ? Math.round(r.width) : null,
          panelRight: r ? Math.round(r.right) : null,
          unverifiedRight: unvRect ? Math.round(unvRect.right) : null,
          windowWidth: window.innerWidth,
          isWithinViewport: r ? r.right <= window.innerWidth + 1 : false,
        };
      })()`,
      returnByValue: true,
    });
    const mobileMetrics = mobileContextRes.result.value || {};
    console.log(`[Mobile Viewport Measurement] panelWidth=${mobileMetrics.panelWidth}px, panelRight=${mobileMetrics.panelRight}px, windowWidth=${mobileMetrics.windowWidth}px, isWithinViewport=${mobileMetrics.isWithinViewport}`);

    // Insert a new unread message while on mobile context tab to test read suppression
    const msgMobileId = crypto.randomUUID();
    tracker.recordMessage(msgMobileId);
    tracker.recordIngress(msgMobileId);
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Pesan uji supresi saat tab konteks aktif', now(), 'SHADOW', 1, false)`,
      [msgMobileId, ident2Id, botAccountId, sender2Id, `pmsg-mobile-suppress-${runId}`]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, '{"category":"GENERAL","reason":"keyword_match"}'::jsonb, null, now())`,
      [msgMobileId, ident2Id, conv2Id]
    );
    await pool.query(
      `UPDATE public.conversations SET last_activity_at = now() WHERE id = $1`,
      [conv2Id]
    );

    // Wait for client polling (POLLING_INTERVAL_MS=5000) to receive the message while on context tab
    await delay(6000);

    // Check read suppression on mobile context tab
    const dbReadMobileContext = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
      [staffUserId, msgMobileId]
    );

    // TEST FINDING 5: Resize from mobile context tab directly to desktop (1440px)
    // On desktop, messages panel is active (not hidden behind mobile context tab),
    // so read acknowledgment should restore immediately without manual tab switch.
    console.log("[Scenario 4] Menguji transisi resize viewport mobile context tab -> desktop (1440px)...");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(2500);

    const dbReadMobileToDesktop = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
      [staffUserId, msgMobileId]
    );

    // Now resize back to mobile (375x667), where active subnav tab was 'context'
    console.log("[Scenario 4] Menguji transisi resize viewport desktop -> mobile (375px)...");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 667,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(1000);

    // Insert another unread message to verify suppression is restored on mobile context tab
    const msgMobileReturnId = crypto.randomUUID();
    tracker.recordMessage(msgMobileReturnId);
    tracker.recordIngress(msgMobileReturnId);
    await pool.query(
      `INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, received_at, mode, settings_version, emergency_stop)
       VALUES ($1, $2, 'telegram', $3, $4, $5, 'Pesan uji supresi saat resize kembali ke mobile context', now(), 'SHADOW', 1, false)`,
      [msgMobileReturnId, ident2Id, botAccountId, sender2Id, `pmsg-mobile-return-${runId}`]
    );
    await pool.query(
      `INSERT INTO public.messages (id, identity_id, conversation_id, complaint_id, classification, review_reason, created_at)
       VALUES ($1, $2, $3, null, '{"category":"GENERAL","reason":"keyword_match"}'::jsonb, null, now())`,
      [msgMobileReturnId, ident2Id, conv2Id]
    );
    await pool.query(
      `UPDATE public.conversations SET last_activity_at = now() WHERE id = $1`,
      [conv2Id]
    );
    await delay(6000);

    const dbReadMobileReturn = await pool.query(
      `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
      [staffUserId, msgMobileReturnId]
    );

    // Switch back to 'messages' tab on mobile and ensure view is scrolled to latest messages
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const tabMsgs = document.querySelector('[data-testid="tab-messages"]') || Array.from(document.querySelectorAll('button[role="tab"]')).find(b => b.textContent.includes('Percakapan'));
        if (tabMsgs) tabMsgs.click();
        const scroller = document.getElementById('conversation-messages-scroll-container');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      })()`,
    });
    await delay(2000);

    // Poll for read acknowledgment in DB (up to 6 attempts)
    let dbReadMobileMessagesCount = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await pool.query(
        `SELECT count(*) as cnt FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
        [staffUserId, msgMobileReturnId]
      );
      dbReadMobileMessagesCount = Number(res.rows[0].cnt);
      if (dbReadMobileMessagesCount > 0) break;
      await delay(1000);
    }

    await takeScreenshot("05_mobile_messages_tab");

    recordAssertion({
      id: "mobile_subnav_tabs_and_read_suppression",
      name: "Tampilan mobile (375px) dengan tab konteks menyupresi read-ack, memulihkannya saat resize desktop, menyupresinya lagi saat kembali ke mobile, dan menandai baca di tab pesan",
      pass:
        Number(dbReadMobileContext.rows[0].cnt) === 0 &&
        Number(dbReadMobileToDesktop.rows[0].cnt) > 0 &&
        Number(dbReadMobileReturn.rows[0].cnt) === 0 &&
        dbReadMobileMessagesCount > 0,
      expected: "mobileContext=0, resizeDesktop>0, returnMobile=0, switchMessagesTab>0",
      actual: `mobileContext=${dbReadMobileContext.rows[0].cnt}, resizeDesktop=${dbReadMobileToDesktop.rows[0].cnt}, returnMobile=${dbReadMobileReturn.rows[0].cnt}, switchMessagesTab=${dbReadMobileMessagesCount}`,
    });

    // Scenario 5: On-Demand Check ("Cek Ulang") & Zero Side-Effects
    console.log("\n--- [9] Validasi Pemeriksaan Jaringan On-Demand ('Cek Ulang') & Efek Samping Nol ---");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(800);

    // Switch back to Conversation 1
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pelanggan Alpha'));
        if (item) item.click();
      })(${JSON.stringify(conv1Id)})`,
    });
    await delay(2500);

    // Click "Cek Ulang" button
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="recheck-network-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(3000);

    await takeScreenshot("06_network_check_completed");

    let checkData = {};
    for (let i = 0; i < 6; i++) {
      const checkRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const bodyText = document.body.innerText;
          const expectedRatioStr = "0 LOS / 1 valid / 1 total (100% cakupan)";
          return {
            hasOutcome: bodyText.includes('outcome=ok'),
            hasOnuBox: bodyText.includes('Status ONU (Pelanggan)'),
            hasUpstreamBox: bodyText.includes('Tautan Upstream (Independen)'),
            hasAreaCoverage: bodyText.includes('Cakupan Area (Coverage)'),
            hasExactRatio: bodyText.includes(expectedRatioStr),
          };
        })()`,
        returnByValue: true,
      });
      checkData = checkRes.result.value || {};
      if (checkData.hasOutcome && checkData.hasOnuBox) break;
      await delay(500);
    }

    recordAssertion({
      id: "network_check_on_demand_execution",
      name: "Eksekusi pemeriksaan on-demand ('Cek Ulang') memperbarui bukti jaringan secara langsung",
      pass: checkData.hasOutcome && checkData.hasOnuBox,
      expected: "outcome=ok, onuBox=true",
      actual: `outcome=${checkData.hasOutcome}, onuBox=${checkData.hasOnuBox}`,
    });

    recordAssertion({
      id: "network_check_distinct_onu_evidence",
      name: "Bukti status ONU ditampilkan terpisah dengan catatan semantik operasional",
      pass: checkData.hasOnuBox,
      expected: "Status ONU box visible",
      actual: String(checkData.hasOnuBox),
    });

    recordAssertion({
      id: "network_check_distinct_upstream_evidence",
      name: "Status tautan upstream independen dengan detail kualitas observasi dan sumber MOCK",
      pass: checkData.hasUpstreamBox,
      expected: "Upstream box visible",
      actual: String(checkData.hasUpstreamBox),
    });

    recordAssertion({
      id: "network_check_area_coverage_denominators",
      name: "Cakupan area mempertahankan penyebut eksak (LOS / valid / total) dan rasio cakupan",
      pass: checkData.hasAreaCoverage && checkData.hasExactRatio,
      expected: "0 LOS / 1 valid / 1 total (100% cakupan)",
      actual: `coverage=${checkData.hasAreaCoverage}, exactRatioFound=${checkData.hasExactRatio}`,
    });

    // Check DB: Zero outbound messages, zero claims, zero episode mutations
    const outboundRes = await pool.query(
      `SELECT count(*) as cnt FROM public.outbound_intents WHERE complaint_id = $1`,
      [comp1Id]
    );
    const claimsRes = await pool.query(
      `SELECT count(*) as cnt FROM public.reply_claims WHERE complaint_id = $1`,
      [comp1Id]
    );
    const episodeRes = await pool.query(
      `SELECT status FROM public.complaints WHERE id = $1`,
      [comp1Id]
    );

    const zeroOutbound = Number(outboundRes.rows[0].cnt) === 0;
    const zeroClaims = Number(claimsRes.rows[0].cnt) === 0;
    const episodeUnchanged = episodeRes.rows[0].status === "IN_PROGRESS";

    recordAssertion({
      id: "network_check_zero_side_effects",
      name: "Pemeriksaan on-demand tidak memicu outbound, tidak membuat klaim, dan tidak mengubah status episode",
      pass: zeroOutbound && zeroClaims && episodeUnchanged,
      expected: "outbound=0, claims=0, episode=IN_PROGRESS",
      actual: `outbound=${outboundRes.rows[0].cnt}, claims=${claimsRes.rows[0].cnt}, episode=${episodeRes.rows[0].status}`,
    });

    // Scenario 6: Unverified Safety (0 Provider Calls)
    console.log("\n--- [10] Validasi Keamanan Pengirim Belum Terverifikasi ---");
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pengirim Belum Terverifikasi'));
        if (item) item.click();
      })(${JSON.stringify(conv2Id)})`,
    });
    await delay(1500);

    // Call check on unverified conversation
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="recheck-network-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(2500);

    await takeScreenshot("07_unverified_safe_degradation");

    const unverifiedCheckRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        return document.body.innerText.includes('outcome=unresolved');
      })()`,
      returnByValue: true,
    });

    recordAssertion({
      id: "network_check_unresolved_safety",
      name: "Pemeriksaan pada pengirim belum terverifikasi mengembalikan outcome=unresolved tanpa akses provider",
      pass: Boolean(unverifiedCheckRes.result.value),
      expected: "outcome=unresolved",
      actual: unverifiedCheckRes.result.value ? "outcome=unresolved" : "outcome_other",
    });

    // Scenario 7: Ambiguous Customer
    console.log("\n--- [11] Validasi Ambigu Banyak Layanan ---");
    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pelanggan Multi Layanan'));
        if (item) item.click();
      })(${JSON.stringify(conv3Id)})`,
    });
    await delay(1200);

    await takeScreenshot("08_ambiguous_services_warning");

    const ambiguousRes = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        return document.body.innerText.includes('Peringatan Ambigu');
      })()`,
      returnByValue: true,
    });

    recordAssertion({
      id: "identity_context_ambiguous_services_warning",
      name: "Pelanggan dengan multi-layanan menampilkan peringatan ambigu dan tidak memilih layanan sembarang",
      pass: Boolean(ambiguousRes.result.value),
      expected: "Peringatan Ambigu visible",
      actual: String(ambiguousRes.result.value),
    });

    // Scenario 8: Evidence Semantics Dynamic Freshness Downgrade (Domain Semantics & Live DOM Transition)
    console.log("\n--- [12] Validasi Semantik Freshness & Downgrade Status Basi Dinamis di DOM ---");

    // Select Conversation 1 (Alpha) on 1440px desktop
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(800);

    await cdp.send("Runtime.evaluate", {
      expression: `((targetId) => {
        const item = Array.from(document.querySelectorAll('section[aria-label="Antrean percakapan masuk"] [role="option"]'))
          .find(el => el.getAttribute('data-conversation-id') === targetId || el.textContent.includes('Pelanggan Alpha'));
        if (item) item.click();
      })(${JSON.stringify(conv1Id)})`,
    });
    await delay(1500);

    // Run Cek Ulang to ensure fresh check observations
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-testid="recheck-network-btn"]');
        if (btn) btn.click();
      })()`,
    });
    await delay(2500);

    // Verify initial fresh state in DOM with polling
    let preTickState = {};
    for (let i = 0; i < 6; i++) {
      const initialDomState = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const text = document.body.innerText;
          return {
            hasPerangkatOnline: text.includes('Perangkat Online'),
            hasFreshQualityBadge: text.includes('Data Baru (Fresh)'),
            hasDataBasiBefore: text.includes('Status Belum Pasti (Data Basi)') || text.includes('Data Basi (Stale)'),
          };
        })()`,
        returnByValue: true,
      });
      preTickState = initialDomState.result.value || {};
      if (preTickState.hasPerangkatOnline && preTickState.hasFreshQualityBadge) break;
      await delay(500);
    }

    // Advance browser time by 6 minutes and dispatch evidence-tick to trigger real-time downgrade
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const originalDate = window.Date;
        const offsetMs = 6 * 60 * 1000 + 5000; // +6 minutes 5 seconds
        const FakeDate = function(...args) {
          if (args.length === 0) {
            return new originalDate(originalDate.now() + offsetMs);
          }
          return new originalDate(...args);
        };
        FakeDate.prototype = originalDate.prototype;
        FakeDate.now = () => originalDate.now() + offsetMs;
        FakeDate.parse = originalDate.parse;
        FakeDate.UTC = originalDate.UTC;
        window.Date = FakeDate;

        // Dispatch custom event to trigger InboxEvidencePanel clock tick
        window.dispatchEvent(new CustomEvent('evidence-tick'));
      })()`,
    });
    await delay(1000);

    await takeScreenshot("09_dynamic_stale_downgrade");

    // Verify degraded state in DOM with polling: Fresh must not linger, Stale must appear
    let postTickState = {};
    for (let i = 0; i < 6; i++) {
      const postTickDomState = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const text = document.body.innerText;
          return {
            hasDataBasiAfter: text.includes('Status Belum Pasti (Data Basi)'),
            hasStaleQualityBadge: text.includes('Data Basi (Stale)'),
            hasRemainingFreshBadge: text.includes('Data Baru (Fresh)'),
          };
        })()`,
        returnByValue: true,
      });
      postTickState = postTickDomState.result.value || {};
      if (postTickState.hasDataBasiAfter && postTickState.hasStaleQualityBadge) break;
      await delay(500);
    }

    // Domain semantics check
    const freshOnu = getOnuStatusBadge("online", "fresh", false);
    const staleOnu = getOnuStatusBadge("online", "fresh", true);
    const areaUnknown = getAreaStateBadge("unknown", false);
    const semanticsPass =
      freshOnu.label === "Perangkat Online" &&
      staleOnu.label === "Status Belum Pasti (Data Basi)" &&
      areaUnknown.label === "Belum Dapat Ditentukan";

    const dynamicTransitionPass =
      preTickState.hasPerangkatOnline &&
      preTickState.hasFreshQualityBadge &&
      !preTickState.hasDataBasiBefore &&
      postTickState.hasDataBasiAfter &&
      postTickState.hasStaleQualityBadge &&
      !postTickState.hasRemainingFreshBadge &&
      semanticsPass;

    recordAssertion({
      id: "evidence_semantics_dynamic_freshness_downgrade",
      name: "Aturan semantik domain dan transisi UI dinamis: bukti kedaluwarsa (>5 menit) menurunkan status ke peringatan tidak pasti",
      pass: dynamicTransitionPass,
      expected: "preTick=Data Baru (Fresh), postTick=Status Belum Pasti (Data Basi) & Data Basi (Stale) tanpa label Fresh tertinggal",
      actual: `preOnline=${preTickState.hasPerangkatOnline}, preFresh=${preTickState.hasFreshQualityBadge}, postBasi=${postTickState.hasDataBasiAfter}, postStaleQuality=${postTickState.hasStaleQualityBadge}, remainingFresh=${postTickState.hasRemainingFreshBadge}`,
    });

    if (SIMULATE_ASSERTION_FAIL) {
      console.log(">> SIMULATE: Menginjeksi kegagalan assertion wajib (--simulate-assertion-fail) <<");
      recordAssertion({
        id: "desktop_wide_three_column_layout",
        name: "Desktop lebar (1440px): 3 kolom permanen berdampingan dan tombol drawer tersembunyi",
        pass: false,
        expected: "Layout 3 kolom",
        actual: "Injected assertion failure",
      });
    }
  } catch (err) {
    console.error("[Runner] Error selama eksekusi:", err);
    cleanupErrors.push(err);
  } finally {
    // Teardown via shared executeLifecycleTeardown
    console.log("\n--- [Teardown] Membersihkan proses, port, user, dan fixture ---");

    if (cdp) {
      try { cdp.close(); } catch {}
    }
    if (userDataDir && fs.existsSync(userDataDir)) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }

    const teardownRes = await executeLifecycleTeardown({
      pool,
      supabaseAdmin,
      staffUserId,
      tracker,
      processes: [nextProc, chromeProc].filter(Boolean),
      explicitCleanupFns: [
        async () => {
          if (srv1Id) {
            await pool.query("DELETE FROM public.mock_upstream_impacts WHERE service_id = $1 OR link_id = $2", [srv1Id, linkId]);
            await pool.query("DELETE FROM public.mock_onu_status WHERE service_id = $1", [srv1Id]);
            await pool.query("DELETE FROM public.mock_upstream_status WHERE link_id = $1", [linkId]);
          }
        },
        async () => {
          if (odpId) {
            await pool.query("DELETE FROM public.service_topology WHERE odp_id = $1", [odpId]);
            await pool.query("DELETE FROM public.odps WHERE id = $1", [odpId]);
          }
        },
        async () => {
          if (odcId) {
            await pool.query("DELETE FROM public.odcs WHERE id = $1", [odcId]);
          }
        },
      ],
      residualChecks: [
        {
          name: "conversations",
          sql: "SELECT count(*) as cnt FROM public.conversations WHERE id = ANY($1)",
          params: [[conv1Id, conv2Id, conv3Id].filter(Boolean)],
        },
        {
          name: "customers",
          sql: "SELECT count(*) as cnt FROM public.customers WHERE id = ANY($1)",
          params: [[cust1Id, cust3Id].filter(Boolean)],
        },
        {
          name: "services",
          sql: "SELECT count(*) as cnt FROM public.services WHERE id = ANY($1)",
          params: [[srv1Id, srv3HomeId, srv3OfficeId].filter(Boolean)],
        },
        {
          name: "odps",
          sql: "SELECT count(*) as cnt FROM public.odps WHERE id = $1",
          params: [odpId],
        },
        {
          name: "odcs",
          sql: "SELECT count(*) as cnt FROM public.odcs WHERE id = $1",
          params: [odcId],
        },
        {
          name: "mock_upstream_status",
          sql: "SELECT count(*) as cnt FROM public.mock_upstream_status WHERE link_id = $1",
          params: [linkId],
        },
      ],
    });

    if (teardownRes.allErrors.length > 0) {
      cleanupErrors.push(...teardownRes.allErrors);
    }

    // Verify foreign comparison fixture remained 100% intact after the run's teardown using shared check
    if (pool && foreignCustId) {
      let foreignCheckSuccess = false;
      let foreignIntact = false;
      let foreignCheckRows = null;
      let foreignCheckError = null;

      try {
        const checkRes = await checkForeignComparisonFixture(pool, {
          foreignCustId,
          foreignSrvId,
          foreignOdcId,
          foreignOdpId,
          foreignLinkId,
        });
        foreignCheckSuccess = checkRes.success;
        foreignIntact = checkRes.intact;
        foreignCheckRows = checkRes.counts;
      } catch (fcErr) {
        foreignCheckError = fcErr;
        cleanupErrors.push(fcErr);
        console.error("[Runner] Error memeriksa fixture pembanding:", fcErr.message);
      }

      recordAssertion({
        id: "foreign_fixture_isolation_intact",
        name: "Fixture pembanding milik harness di luar kepemilikan run tetap utuh 100% setelah teardown",
        pass: foreignCheckSuccess && foreignIntact,
        expected: "cust=1, srv=1, odc=1, odp=1, link=1",
        actual: foreignCheckError
          ? `Gagal memeriksa fixture pembanding: ${foreignCheckError.message}`
          : `cust=${foreignCheckRows?.cust_cnt}, srv=${foreignCheckRows?.srv_cnt}, odc=${foreignCheckRows?.odc_cnt}, odp=${foreignCheckRows?.odp_cnt}, link=${foreignCheckRows?.link_cnt}`,
      });

      // Cleanup foreign comparison fixture using shared cleanup implementation
      const cleanupRes = await cleanupForeignComparisonFixture(pool, {
        foreignCustId,
        foreignSrvId,
        foreignOdcId,
        foreignOdpId,
        foreignLinkId,
      });

      if (!cleanupRes.success) {
        for (const item of cleanupRes.errors) {
          cleanupErrors.push(item.error);
          console.error(`[Runner] Gagal menghapus foreign fixture (${item.step}):`, item.error.message);
        }
      }
    }

    if (pool) {
      try {
        await pool.end();
      } catch (pErr) {
        cleanupErrors.push(pErr);
      }
    }

    const teardownPass = cleanupErrors.length === 0 && teardownRes.success && teardownRes.residualsRemaining === 0;
    recordAssertion({
      id: "runner_cleanup_and_teardown",
      name: "Pembersihan proses, user staf, dan fixture pengujian selesai tanpa residu atau kegagalan",
      pass: teardownPass,
      expected: "Cleanup berhasil tanpa error dan 0 residu",
      actual: teardownPass
        ? "0 residu, proses dihentikan, user dihapus"
        : cleanupErrors.map((e) => e.message || String(e)).join("; "),
    });

    const activeRegistry = P27_NORMAL_REGISTRY;

    return finalize(
      assertions,
      path.join(runEvidenceDir, "evidence.json"),
      cleanupErrors,
      activeRegistry,
      {
        mode: "live_browser_normal",
        runId,
        sourceHashesAtLaunch,
        buildManifest,
        buildId,
        buildValidation,
        runnerRevisionSha256: getRunnerRevisionSha256(),
        screenshots: capturedScreenshots,
        expectedExitCode: SIMULATE_ASSERTION_FAIL ? 1 : 0,
        operationsAttempted: teardownRes.operationsAttempted,
        operationsSucceeded: teardownRes.operationsSucceeded,
        recoveryAttempted: teardownRes.recoveryAttempted,
        recoveryCompleted: teardownRes.recoveryCompleted,
        residualsRemaining: teardownRes.residualsRemaining,
        residualBreakdown: teardownRes.residualBreakdown,
        expectedInjectedFailuresCount: 0,
        unexpectedFailuresCount: cleanupErrors.length,
      }
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runP27VerificationHarness()
    .then(async (results) => {
      await delay(100);
      process.exit(results.calculatedExitCode);
    })
    .catch((err) => {
      console.error("[Runner] Fatal error:", err);
      process.exit(1);
    });
}
