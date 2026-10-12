import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const importESM = new Function("specifier", "return import(specifier)") as (
  specifier: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

test("Build-to-Source Validation: validateBuildMetadata handles synchronization and failure modes", async () => {
  const manifestScriptUrl = pathToFileURL(
    path.resolve(process.cwd(), "scripts/build-source-manifest.mjs")
  ).href;
  const manifestModule = await importESM(manifestScriptUrl);
  const { validateBuildMetadata } = manifestModule;

  const mockManifest = {
    status: "VALID",
    buildId: "build-12345",
    scope: "p27_inbox_and_evidence",
    trackedFiles: ["fileA.ts", "fileB.ts"],
    sourceHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_222",
    },
  };

  // 1. Perfectly synchronized
  const synchronizedRes = validateBuildMetadata({
    manifest: mockManifest,
    currentBuildId: "build-12345",
    launchHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_222",
    },
    finalizeHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_222",
    },
    mode: "live_browser_normal",
  });
  assert.equal(synchronizedRes.isValid, true);
  assert.equal(synchronizedRes.isApplicable, true);
  assert.equal(synchronizedRes.status, "SYNCHRONIZED");
  assert.equal(synchronizedRes.checks.buildIdMatch, true);
  assert.equal(synchronizedRes.checks.launchSourceMatch, true);
  assert.equal(synchronizedRes.checks.runtimeSourceMatch, true);

  // 2. Missing launch hashes
  const missingLaunchRes = validateBuildMetadata({
    manifest: mockManifest,
    currentBuildId: "build-12345",
    launchHashes: null,
    mode: "live_browser_normal",
  });
  assert.equal(missingLaunchRes.isValid, false);
  assert.equal(missingLaunchRes.isApplicable, true);
  assert.equal(missingLaunchRes.status, "LAUNCH_HASHES_MISSING");

  // 3. BUILD_ID mismatch
  const buildIdMismatchRes = validateBuildMetadata({
    manifest: mockManifest,
    currentBuildId: "build-99999",
    launchHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_222",
    },
    mode: "live_browser_normal",
  });
  assert.equal(buildIdMismatchRes.isValid, false);
  assert.equal(buildIdMismatchRes.isApplicable, true);
  assert.equal(buildIdMismatchRes.status, "BUILD_ID_MISMATCH");

  // 4. Source changed before runner launch
  const sourceChangedPreLaunchRes = validateBuildMetadata({
    manifest: mockManifest,
    currentBuildId: "build-12345",
    launchHashes: {
      "fileA.ts": "hash_a_MODIFIED",
      "fileB.ts": "hash_b_222",
    },
    mode: "live_browser_normal",
  });
  assert.equal(sourceChangedPreLaunchRes.isValid, false);
  assert.equal(sourceChangedPreLaunchRes.isApplicable, true);
  assert.equal(sourceChangedPreLaunchRes.status, "SOURCE_CHANGED_BEFORE_LAUNCH");
  assert.equal(sourceChangedPreLaunchRes.mismatchedLaunchFiles?.length, 1);
  assert.equal(sourceChangedPreLaunchRes.mismatchedLaunchFiles?.[0].file, "fileA.ts");

  // 5. Source changed during runner execution
  const sourceChangedRuntimeRes = validateBuildMetadata({
    manifest: mockManifest,
    currentBuildId: "build-12345",
    launchHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_222",
    },
    finalizeHashes: {
      "fileA.ts": "hash_a_111",
      "fileB.ts": "hash_b_MUTATED_AT_RUNTIME",
    },
    mode: "live_browser_normal",
  });
  assert.equal(sourceChangedRuntimeRes.isValid, false);
  assert.equal(sourceChangedRuntimeRes.isApplicable, true);
  assert.equal(sourceChangedRuntimeRes.status, "SOURCE_CHANGED_DURING_RUN");
  assert.equal(sourceChangedRuntimeRes.mismatchedRuntimeFiles?.length, 1);
  assert.equal(sourceChangedRuntimeRes.mismatchedRuntimeFiles?.[0].file, "fileB.ts");

  // 6. Non-app modes (guard_rejection, setup_failure, cleanup_failure) are NOT_APPLICABLE
  for (const mode of ["guard_rejection", "setup_failure", "cleanup_failure"]) {
    const nonAppRes = validateBuildMetadata({
      manifest: null,
      currentBuildId: null,
      launchHashes: null,
      mode,
    });
    assert.equal(nonAppRes.isValid, true);
    assert.equal(nonAppRes.isApplicable, false);
    assert.equal(nonAppRes.status, "NOT_APPLICABLE");
  }
});

test("Runner Evaluation: evaluateFinalizeResults enforces fail-closed build validation and registry completeness", async () => {
  const runnerScriptUrl = pathToFileURL(
    path.resolve(process.cwd(), "tests/interactive/verify-p27-evidence.mjs")
  ).href;
  const runnerModule = await importESM(runnerScriptUrl);
  const { evaluateFinalizeResults, getRunnerRevisionSha256 } = runnerModule;

  // Revision SHA-256 is present and 64 hex characters
  const sha = getRunnerRevisionSha256();
  assert.ok(sha);
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  assert.match(sha, /^[a-f0-9]{64}$/);

  // Sample assertions where all tests passed
  const samplePassedAssertions = [
    { id: "build_source_binding_verification", status: "PASS", name: "Build verify" },
    { id: "auth_setup", status: "PASS", name: "Auth setup" },
    { id: "runner_cleanup_and_teardown", status: "PASS", name: "Cleanup" },
  ];
  const modeRegistry = ["build_source_binding_verification", "auth_setup", "runner_cleanup_and_teardown"];

  // 1. Pass with valid buildValidation
  const passResult = evaluateFinalizeResults(samplePassedAssertions, [], modeRegistry, {
    buildValidation: { isValid: true, isApplicable: true, status: "SYNCHRONIZED" },
  });
  assert.equal(passResult.summary.overallStatus, "PASS");
  assert.equal(passResult.summary.exitCode, 0);

  // 2. Fail-closed: Even if assertions all say PASS, if buildValidation is invalid and applicable, runner MUST FAIL with exitCode 1
  const failClosedResult = evaluateFinalizeResults(samplePassedAssertions, [], modeRegistry, {
    buildValidation: {
      isValid: false,
      isApplicable: true,
      status: "LAUNCH_HASHES_MISSING",
      reason: "Launch hashes were null",
    },
  });
  assert.equal(failClosedResult.summary.overallStatus, "FAIL");
  assert.equal(failClosedResult.summary.exitCode, 1);
  const buildAssertion = failClosedResult.assertions.find(
    (a: { id: string }) => a.id === "build_source_binding_verification"
  );
  assert.equal(buildAssertion?.status, "FAIL");

  // 3. Duplicate detection
  const duplicateAssertions = [
    { id: "auth_setup", status: "PASS", name: "Auth" },
    { id: "auth_setup", status: "PASS", name: "Auth Duplicate" },
    { id: "runner_cleanup_and_teardown", status: "PASS", name: "Teardown" },
  ];
  const dupResult = evaluateFinalizeResults(duplicateAssertions, [], ["auth_setup", "runner_cleanup_and_teardown"]);
  assert.equal(dupResult.summary.overallStatus, "FAIL");
  assert.equal(dupResult.summary.exitCode, 1);
  assert.equal(dupResult.duplicates.length, 1);
  assert.equal(dupResult.duplicates[0].id, "auth_setup");

  // 4. Missing mandatory assertion in registry
  const incompleteAssertions = [
    { id: "auth_setup", status: "PASS", name: "Auth" },
  ];
  const missingResult = evaluateFinalizeResults(incompleteAssertions, [], modeRegistry);
  assert.equal(missingResult.summary.overallStatus, "INCOMPLETE");
  assert.equal(missingResult.summary.exitCode, 1);
  assert.ok(missingResult.missingMandatoryIds.includes("runner_cleanup_and_teardown"));
});

test("Finalizer Execution Path: finalize() rejects mutated sources at finalization even if launch validation succeeded", async () => {
  const runnerScriptUrl = pathToFileURL(
    path.resolve(process.cwd(), "tests/interactive/verify-p27-evidence.mjs")
  ).href;
  const runnerModule = await importESM(runnerScriptUrl);
  const { finalize } = runnerModule;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p27-finalize-test-"));
  const evidencePath = path.join(tempDir, "evidence.json");

  const liveManifestPath = path.resolve(process.cwd(), "docs/evidence/P2_7/latest-manifest.json");
  const manifestBefore = fs.existsSync(liveManifestPath)
    ? fs.readFileSync(liveManifestPath, "utf8")
    : null;

  try {
    const mockManifest = {
      status: "VALID",
      buildId: "build-test-finalizer-999",
      scope: "p27_inbox_and_evidence",
      trackedFiles: ["app/globals.css", "lib/application/inbox-service.ts"],
      sourceHashes: {
        "app/globals.css": "hash_css_valid_123",
        "lib/application/inbox-service.ts": "hash_service_valid_456",
      },
    };

    const initialAssertions = [
      { id: "build_source_binding_verification", status: "PASS", name: "Build verify", expected: "VALID", actual: "VALID" },
      { id: "auth_setup", status: "PASS", name: "Auth setup", expected: "auth ok", actual: "auth ok" },
      { id: "runner_cleanup_and_teardown", status: "PASS", name: "Cleanup", expected: "0 residuals", actual: "0 residuals" },
    ];
    const modeRegistry = ["build_source_binding_verification", "auth_setup", "runner_cleanup_and_teardown"];

    // Scenario: Launch validation was SYNCHRONIZED and isValid: true
    const launchValidation = {
      isValid: true,
      isApplicable: true,
      status: "SYNCHRONIZED",
      reason: "Launch hashes match build manifest",
      checks: { manifestExists: true, buildIdMatch: true, launchSourceMatch: true, runtimeSourceMatch: true },
    };

    // But between launch and finalization, app/globals.css changed!
    const mutatedFinalizeHashes = {
      "app/globals.css": "hash_css_MUTATED_AFTER_LAUNCH",
      "lib/application/inbox-service.ts": "hash_service_valid_456",
    };

    const finalizeResults = finalize(
      initialAssertions,
      evidencePath,
      [],
      modeRegistry,
      {
        mode: "live_browser_normal",
        runId: "test-run-mutated-finalize",
        buildManifest: mockManifest,
        buildId: "build-test-finalizer-999",
        buildValidation: launchValidation, // Initial launch was valid!
        sourceHashesAtLaunch: {
          "app/globals.css": "hash_css_valid_123",
          "lib/application/inbox-service.ts": "hash_service_valid_456",
        },
        sourceHashesAtFinalize: mutatedFinalizeHashes, // Mutated at finalization!
        skipLatestManifestUpdate: true,
        expectedExitCode: 1, // Pre-declared expected exit code for failure scenario
      }
    );

    // Assert that finalize() re-computed the validation and failed closed
    assert.equal(finalizeResults.calculatedExitCode, 1, "Exit code must be 1 on source mutation");
    assert.equal(finalizeResults.summary.overallStatus, "FAIL", "Overall status must be FAIL");
    assert.equal(finalizeResults.buildIdentity.isValid, false, "buildIdentity.isValid must be false");
    assert.equal(finalizeResults.buildIdentity.status, "SOURCE_CHANGED_DURING_RUN");

    const buildAssertion = finalizeResults.assertions.find(
      (a: { id: string }) => a.id === "build_source_binding_verification"
    );
    assert.equal(buildAssertion?.status, "FAIL", "build_source_binding_verification must be forced to FAIL");

    // Verify written evidence JSON on disk in temp dir
    assert.ok(fs.existsSync(evidencePath), "Evidence JSON file must be written to disk");
    const writtenJson = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    assert.equal(writtenJson.calculatedExitCode, 1);
    assert.equal(writtenJson.summary.overallStatus, "FAIL");
    assert.equal(writtenJson.buildIdentity.status, "SOURCE_CHANGED_DURING_RUN");

    // Also test synchronized finalization path produces exit code 0 and status PASS
    const syncEvidencePath = path.join(tempDir, "evidence-sync.json");
    const syncFinalizeResults = finalize(
      initialAssertions,
      syncEvidencePath,
      [],
      modeRegistry,
      {
        mode: "live_browser_normal",
        runId: "test-run-sync-finalize",
        buildManifest: mockManifest,
        buildId: "build-test-finalizer-999",
        buildValidation: launchValidation,
        sourceHashesAtLaunch: {
          "app/globals.css": "hash_css_valid_123",
          "lib/application/inbox-service.ts": "hash_service_valid_456",
        },
        sourceHashesAtFinalize: {
          "app/globals.css": "hash_css_valid_123",
          "lib/application/inbox-service.ts": "hash_service_valid_456",
        },
        skipLatestManifestUpdate: true,
        expectedExitCode: 0,
      }
    );
    assert.equal(syncFinalizeResults.calculatedExitCode, 0);
    assert.equal(syncFinalizeResults.summary.overallStatus, "PASS");
    assert.equal(syncFinalizeResults.buildIdentity.isValid, true);
    assert.equal(syncFinalizeResults.buildIdentity.status, "SYNCHRONIZED");

    // CRITICAL: Assert that live latest-manifest.json was NOT modified by any finalize() calls
    const manifestAfter = fs.existsSync(liveManifestPath)
      ? fs.readFileSync(liveManifestPath, "utf8")
      : null;
    assert.equal(manifestAfter, manifestBefore, "Live latest-manifest.json must remain 100% UNTOUCHED by unit tests");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

