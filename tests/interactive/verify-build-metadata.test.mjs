#!/usr/bin/env node
/**
 * tests/interactive/verify-build-metadata.test.mjs
 *
 * Targeted unit tests for build-to-source manifest validation logic and its
 * integration with runner finalizer decisions.
 * Tests matching and non-matching conditions without launching Chrome, Next.js, or DB.
 */

import {
  validateBuildMetadata,
  TRACKED_SOURCE_FILES,
} from "../../scripts/build-source-manifest.mjs";
import { evaluateFinalizeResults } from "./verify-p26-inbox.mjs";

console.log("=== P2.6 TAHAP 2: PENGUJIAN TARGETED VALIDASI METADATA BUILD–SOURCE ===");

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

// Helper to create synthetic hashes
function createMockHashes(prefix = "hash_") {
  const hashes = {};
  for (const f of TRACKED_SOURCE_FILES) {
    hashes[f] = `${prefix}${Buffer.from(f).toString("hex").slice(0, 16)}`;
  }
  return hashes;
}

// --------------------------------------------------------------------------
// Kasus 1: BUILD_ID dan source hashes cocok -> diterima (SYNCHRONIZED, exit 0)
// --------------------------------------------------------------------------
{
  const mockHashes = createMockHashes("v1_");
  const manifest = {
    status: "VALID",
    buildId: "test_build_abc123",
    createdAt: new Date().toISOString(),
    trackedFiles: TRACKED_SOURCE_FILES,
    sourceHashes: { ...mockHashes },
  };

  const validation = validateBuildMetadata({
    manifest,
    currentBuildId: "test_build_abc123",
    launchHashes: { ...mockHashes },
    finalizeHashes: { ...mockHashes },
    mode: "live_browser_normal",
  });

  // Test integration with evaluateFinalizeResults
  const assertions = [
    { id: "auth_setup", name: "Auth Setup", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], ["auth_setup", "runner_cleanup_and_teardown"], {
    buildValidation: validation,
  });

  const pass =
    validation.isValid === true &&
    validation.status === "SYNCHRONIZED" &&
    evalResult.summary.overallStatus === "PASS" &&
    evalResult.summary.exitCode === 0;

  assertTest(
    "Kasus 1: BUILD_ID dan source hashes cocok -> diterima (SYNCHRONIZED, exit 0)",
    pass,
    { validationStatus: validation.status, overallStatus: evalResult.summary.overallStatus, exitCode: evalResult.summary.exitCode }
  );
}

// --------------------------------------------------------------------------
// Kasus 2: Manifest build tidak tersedia -> ditolak untuk mode browser (exit 1)
// --------------------------------------------------------------------------
{
  const mockHashes = createMockHashes("v1_");

  const validation = validateBuildMetadata({
    manifest: null, // MISSING
    currentBuildId: "test_build_abc123",
    launchHashes: { ...mockHashes },
    finalizeHashes: { ...mockHashes },
    mode: "live_browser_normal",
  });

  const assertions = [
    { id: "auth_setup", name: "Auth Setup", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], ["auth_setup", "runner_cleanup_and_teardown"], {
    buildValidation: validation,
  });

  const pass =
    validation.isValid === false &&
    validation.status === "MISSING_OR_INVALID_MANIFEST" &&
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1;

  assertTest(
    "Kasus 2: Manifest build tidak tersedia -> ditolak untuk mode browser (FAIL, exit 1)",
    pass,
    { validationStatus: validation.status, overallStatus: evalResult.summary.overallStatus, exitCode: evalResult.summary.exitCode }
  );
}

// --------------------------------------------------------------------------
// Kasus 3: BUILD_ID berbeda -> ditolak (BUILD_ID_MISMATCH, exit 1)
// --------------------------------------------------------------------------
{
  const mockHashes = createMockHashes("v1_");
  const manifest = {
    status: "VALID",
    buildId: "built_build_old999",
    createdAt: new Date().toISOString(),
    trackedFiles: TRACKED_SOURCE_FILES,
    sourceHashes: { ...mockHashes },
  };

  const validation = validateBuildMetadata({
    manifest,
    currentBuildId: "current_build_new111", // MISMATCH
    launchHashes: { ...mockHashes },
    finalizeHashes: { ...mockHashes },
    mode: "live_browser_normal",
  });

  const assertions = [
    { id: "auth_setup", name: "Auth Setup", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], ["auth_setup", "runner_cleanup_and_teardown"], {
    buildValidation: validation,
  });

  const pass =
    validation.isValid === false &&
    validation.status === "BUILD_ID_MISMATCH" &&
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1;

  assertTest(
    "Kasus 3: BUILD_ID berbeda -> ditolak (BUILD_ID_MISMATCH, FAIL, exit 1)",
    pass,
    { validationStatus: validation.status, overallStatus: evalResult.summary.overallStatus, exitCode: evalResult.summary.exitCode }
  );
}

// --------------------------------------------------------------------------
// Kasus 4: Source berubah setelah build, sebelum runner dimulai -> ditolak (exit 1)
// --------------------------------------------------------------------------
{
  const buildHashes = createMockHashes("v1_");
  const launchHashes = { ...buildHashes };
  // Simulate one file modified after build before runner launch
  const modifiedFile = TRACKED_SOURCE_FILES[0];
  launchHashes[modifiedFile] = "mutated_hash_after_build_123456";

  const manifest = {
    status: "VALID",
    buildId: "test_build_abc123",
    createdAt: new Date().toISOString(),
    trackedFiles: TRACKED_SOURCE_FILES,
    sourceHashes: { ...buildHashes },
  };

  const validation = validateBuildMetadata({
    manifest,
    currentBuildId: "test_build_abc123",
    launchHashes,
    finalizeHashes: { ...launchHashes },
    mode: "live_browser_normal",
  });

  const assertions = [
    { id: "auth_setup", name: "Auth Setup", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], ["auth_setup", "runner_cleanup_and_teardown"], {
    buildValidation: validation,
  });

  const pass =
    validation.isValid === false &&
    validation.status === "SOURCE_CHANGED_BEFORE_LAUNCH" &&
    validation.mismatchedLaunchFiles?.length === 1 &&
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1;

  assertTest(
    "Kasus 4: Source berubah setelah build, sebelum runner dimulai -> ditolak (SOURCE_CHANGED_BEFORE_LAUNCH, FAIL, exit 1)",
    pass,
    {
      validationStatus: validation.status,
      mismatchedCount: validation.mismatchedLaunchFiles?.length,
      overallStatus: evalResult.summary.overallStatus,
      exitCode: evalResult.summary.exitCode,
    }
  );
}

// --------------------------------------------------------------------------
// Kasus 5: Source berubah selama run -> hasil akhir non-PASS/exit nonzero (exit 1)
// --------------------------------------------------------------------------
{
  const mockHashes = createMockHashes("v1_");
  const finalizeHashes = { ...mockHashes };
  // Simulate file mutated during run
  const mutatedRuntimeFile = TRACKED_SOURCE_FILES[1];
  finalizeHashes[mutatedRuntimeFile] = "runtime_mutated_hash_789012";

  const manifest = {
    status: "VALID",
    buildId: "test_build_abc123",
    createdAt: new Date().toISOString(),
    trackedFiles: TRACKED_SOURCE_FILES,
    sourceHashes: { ...mockHashes },
  };

  const validation = validateBuildMetadata({
    manifest,
    currentBuildId: "test_build_abc123",
    launchHashes: { ...mockHashes },
    finalizeHashes,
    mode: "live_browser_normal",
  });

  const assertions = [
    { id: "auth_setup", name: "Auth Setup", isOptional: false, status: "PASS" },
    { id: "runner_cleanup_and_teardown", name: "Teardown", isOptional: false, status: "PASS" },
  ];
  const evalResult = evaluateFinalizeResults(assertions, [], ["auth_setup", "runner_cleanup_and_teardown"], {
    buildValidation: validation,
  });

  const pass =
    validation.isValid === false &&
    validation.status === "SOURCE_CHANGED_DURING_RUN" &&
    evalResult.summary.overallStatus === "FAIL" &&
    evalResult.summary.exitCode === 1;

  assertTest(
    "Kasus 5: Source berubah selama run -> hasil akhir non-PASS dan exit nonzero (SOURCE_CHANGED_DURING_RUN, FAIL, exit 1)",
    pass,
    {
      validationStatus: validation.status,
      mismatchedCount: validation.mismatchedRuntimeFiles?.length,
      overallStatus: evalResult.summary.overallStatus,
      exitCode: evalResult.summary.exitCode,
    }
  );
}

// --------------------------------------------------------------------------
// Kasus Tambahan: Mode yang tidak menjalankan aplikasi (guard rejection) -> NOT_APPLICABLE (exit 0)
// --------------------------------------------------------------------------
{
  const validation = validateBuildMetadata({
    manifest: null, // Even without manifest
    currentBuildId: null,
    launchHashes: null,
    finalizeHashes: null,
    mode: "guard_rejection",
  });

  const pass =
    validation.isValid === true &&
    validation.isApplicable === false &&
    validation.status === "NOT_APPLICABLE";

  assertTest(
    "Kasus Tambahan: Mode non-aplikasi (guard_rejection) berstatus NOT_APPLICABLE tanpa memaksakan sinkronisasi",
    pass,
    { validationStatus: validation.status, isApplicable: validation.isApplicable }
  );
}

console.log("\n========================================================");
const passedCount = testResults.filter((r) => r.pass).length;
const totalCount = testResults.length;
console.log(`TOTAL PENGUJIAN METADATA BUILD: ${totalCount}`);
console.log(`LULUS:                          ${passedCount}`);
console.log(`GAGAL:                          ${totalCount - passedCount}`);
console.log(`STATUS:                         ${passedCount === totalCount ? "PASS (Semua kasus terbukti)" : "FAIL"}`);
console.log("========================================================\n");

process.exit(passedCount === totalCount ? 0 : 1);
