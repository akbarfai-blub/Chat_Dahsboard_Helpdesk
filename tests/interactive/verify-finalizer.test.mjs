#!/usr/bin/env node
/**
 * verify-finalizer.test.mjs
 *
 * Standalone negative & edge-case unit test for finalizer evaluation logic in verify-p26-inbox.mjs.
 * Tests 5 mandatory cases without launching Chrome, Next.js, or PostgreSQL.
 */

import {
  evaluateFinalizeResults,
  GUARD_REJECTION_REGISTRY,
  SETUP_FAILURE_REGISTRY,
} from "./verify-p26-inbox.mjs";

console.log("=== P2.6 TAHAP 2: PENGUJIAN NEGATIF & LOGIKA FINALIZER ===");

const testResults = [];

function assertTest(name, condition, details) {
  if (condition) {
    console.log(`[✓] PASS: ${name}`);
    testResults.push({ name, pass: true, details });
  } else {
    console.error(`[x] FAIL: ${name}`);
    console.error("    Details:", details);
    testResults.push({ name, pass: false, details });
  }
}

// --------------------------------------------------------------------------
// Kasus 1: Registry lengkap dengan hasil valid menghasilkan PASS/exit 0
// --------------------------------------------------------------------------
{
  const registry = ["scenario_1", "scenario_2", "runner_cleanup_and_teardown"];
  const assertions = [
    { id: "scenario_1", name: "Skenario 1", isOptional: false, status: "PASS" },
    { id: "scenario_2", name: "Skenario 2", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], registry);
  const pass =
    evalResult.summary.overallStatus === "PASS" &&
    evalResult.summary.exitCode === 0 &&
    evalResult.duplicates.length === 0 &&
    evalResult.missingMandatoryIds.length === 0;

  assertTest(
    "Kasus 1: Registry lengkap dengan seluruh assertion valid menghasilkan PASS dan exitCode 0",
    pass,
    { status: evalResult.summary.overallStatus, exitCode: evalResult.summary.exitCode }
  );
}

// --------------------------------------------------------------------------
// Kasus 2: Satu ID wajib hilang menghasilkan INCOMPLETE atau FAIL/exit nonzero
// --------------------------------------------------------------------------
{
  const registry = ["scenario_1", "mandatory_scenario_2", "runner_cleanup_and_teardown"];
  const assertions = [
    { id: "scenario_1", name: "Skenario 1", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], registry);
  const pass =
    (evalResult.summary.overallStatus === "INCOMPLETE" || evalResult.summary.overallStatus === "FAIL") &&
    evalResult.summary.exitCode !== 0 &&
    evalResult.missingMandatoryIds.includes("mandatory_scenario_2") &&
    evalResult.summary.mandatoryNotRun >= 1;

  assertTest(
    "Kasus 2: Satu ID wajib hilang dari assertion terdeteksi, menghasilkan INCOMPLETE/FAIL dan exitCode 1",
    pass,
    {
      status: evalResult.summary.overallStatus,
      exitCode: evalResult.summary.exitCode,
      missingIds: evalResult.missingMandatoryIds,
      mandatoryNotRun: evalResult.summary.mandatoryNotRun,
    }
  );
}

// --------------------------------------------------------------------------
// Kasus 3: ID duplikat tidak dapat menghasilkan PASS (fail-closed exit 1)
// --------------------------------------------------------------------------
{
  const registry = ["scenario_1", "scenario_2", "runner_cleanup_and_teardown"];
  const assertions = [
    { id: "scenario_1", name: "Skenario 1", isOptional: false, status: "PASS" },
    { id: "scenario_2", name: "Skenario 2", isOptional: false, status: "PASS" },
    { id: "scenario_2", name: "Skenario 2 Duplikat", isOptional: false, status: "PASS" }, // DUPLICATE
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], registry);
  const pass =
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1 &&
    evalResult.duplicates.some((d) => d.id === "scenario_2" && d.count === 2);

  assertTest(
    "Kasus 3: Assertion ID duplikat ditolak secara fail-closed (status FAIL, exitCode 1) meski seluruh ID lulus",
    pass,
    {
      status: evalResult.summary.overallStatus,
      exitCode: evalResult.summary.exitCode,
      duplicates: evalResult.duplicates,
    }
  );
}

// --------------------------------------------------------------------------
// Kasus 4: Registry mode yang sesuai (guard / setup failure tidak mewajibkan seluruh skenario browser)
// --------------------------------------------------------------------------
{
  // Test Guard Registry (3 guard assertions only)
  const guardAssertions = [
    { id: "guard_active_db_rejection", name: "Guard DB", isOptional: false, status: "PASS" },
    { id: "guard_active_api_rejection", name: "Guard API", isOptional: false, status: "PASS" },
    { id: "guard_marker_mismatch_rejection", name: "Guard Marker", isOptional: false, status: "PASS" },
  ];
  const guardEval = evaluateFinalizeResults(guardAssertions, [], GUARD_REJECTION_REGISTRY);

  // Test Setup Failure Registry (3 setup failure assertions only)
  const setupAssertions = [
    { id: "setup_failure_injected", name: "Setup Fail Injected", isOptional: false, status: "FAIL" },
    { id: "teardown_user_deleted", name: "Teardown User", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const setupEval = evaluateFinalizeResults(setupAssertions, [], SETUP_FAILURE_REGISTRY);

  const pass =
    guardEval.summary.overallStatus === "PASS" &&
    guardEval.summary.exitCode === 0 &&
    guardEval.missingMandatoryIds.length === 0 &&
    guardEval.assertions.length === 3 &&
    setupEval.missingMandatoryIds.length === 0 &&
    setupEval.assertions.length === 3;

  assertTest(
    "Kasus 4: Registry mode terisolasi sesuai konteks (Guard mode & Setup mode tidak mewajibkan skenario browser penuh)",
    pass,
    {
      guardStatus: guardEval.summary.overallStatus,
      guardExitCode: guardEval.summary.exitCode,
      guardCount: guardEval.assertions.length,
      setupMissingIds: setupEval.missingMandatoryIds,
      setupCount: setupEval.assertions.length,
    }
  );
}

// --------------------------------------------------------------------------
// Kasus 5: Error cleanup tetap menghasilkan FAIL / exit 1 meskipun seluruh assertion lain PASS
// --------------------------------------------------------------------------
{
  const registry = ["scenario_1", "scenario_2", "runner_cleanup_and_teardown"];
  const assertions = [
    { id: "scenario_1", name: "Skenario 1", isOptional: false, status: "PASS" },
    { id: "scenario_2", name: "Skenario 2", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const cleanupErrors = [new Error("Simulated connection pool leak in teardown")];
  const evalResult = evaluateFinalizeResults(assertions, cleanupErrors, registry);

  const teardownAssertion = evalResult.assertions.find((a) => a.id === "runner_cleanup_and_teardown");
  const pass =
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1 &&
    evalResult.cleanupErrors.length === 1 &&
    teardownAssertion &&
    teardownAssertion.status === "FAIL";

  assertTest(
    "Kasus 5: Error cleanup memaksa status akhir FAIL dan exitCode 1 meskipun seluruh skenario lain berstatus PASS",
    pass,
    {
      status: evalResult.summary.overallStatus,
      exitCode: evalResult.summary.exitCode,
      cleanupErrors: evalResult.cleanupErrors,
      teardownStatus: teardownAssertion ? teardownAssertion.status : null,
    }
  );
}

console.log("\n========================================================");
const allPassed = testResults.every((t) => t.pass);
console.log(`TOTAL PENGUJIAN FINALIZER: ${testResults.length}`);
console.log(`LULUS:                    ${testResults.filter((t) => t.pass).length}`);
console.log(`GAGAL:                    ${testResults.filter((t) => !t.pass).length}`);
console.log(`STATUS:                   ${allPassed ? "PASS (Semua kasus terbukti)" : "FAIL"}`);
console.log("========================================================");

if (allPassed) {
  process.exit(0);
} else {
  process.exit(1);
}
