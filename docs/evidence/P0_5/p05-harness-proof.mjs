// docs/evidence/P0_5/p05-harness-proof.mjs
// P0.5 Verification Suite — Proves test tool fixes against the actual shared module
// and harness code used by p05-logout-tests.mjs and p05-logout-failure.mjs.
//
// Execution Modes:
// 1. Synthetic Suite (Default):
//    node docs/evidence/P0_5/p05-harness-proof.mjs
//    Runs entirely offline/in-memory with synthetic secrets. No database or real key required.
//    Account integration against GoTrue is reported as NOT RUN.
//
// 2. Integration Suite (Explicit):
//    node docs/evidence/P0_5/p05-harness-proof.mjs --with-account
//    Requires local Supabase running and SUPABASE_SERVICE_KEY provided via environment.
//    Executes real temporary account lifecycle against local GoTrue admin API.
//    Fails safely with a prerequisite error if required configuration is missing.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createSanitizer,
  ConsoleTracker,
  executeKeyboardAction,
  createHarnessLifecycle,
} from "./p05-harness-utils.mjs";
import { isTestAccount } from "./p05-account.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const enableAccountIntegration =
  process.argv.includes("--with-account") ||
  process.argv.includes("--account-integration");

// If integration is explicitly requested, validate prerequisites upfront
if (enableAccountIntegration) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey || serviceKey.trim() === "") {
    console.error(
      "PREREQUISITE ERROR: SUPABASE_SERVICE_KEY environment variable is required when --with-account is specified."
    );
    process.exit(1);
  }
}

const proofResults = [];
function recordProof(name, status, details = "") {
  let normalizedStatus = "PASS";
  if (status === true || status === "PASS") {
    normalizedStatus = "PASS";
  } else if (status === "NOT_RUN" || status === null) {
    normalizedStatus = "NOT RUN";
  } else {
    normalizedStatus = "FAIL";
  }
  proofResults.push({ name, status: normalizedStatus, details });
  const badge =
    normalizedStatus === "PASS"
      ? "✔ PASS"
      : normalizedStatus === "NOT RUN"
      ? "○ NOT RUN"
      : "✖ FAIL";
  console.log(`${badge}: ${name}${details ? ` -> ${details}` : ""}`);
}

async function runSubprocess(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: __dirname,
      env: { ...process.env, ...env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

console.log("=== STARTING P0.5 TEST TOOL VERIFICATION SUITE ===");
if (enableAccountIntegration) {
  console.log("Mode: INTEGRATION (--with-account enabled)");
} else {
  console.log("Mode: SYNTHETIC (default offline suite; integration marked NOT RUN)");
}

// ---------------------------------------------------------------------------
// GROUP 1: Harness Integration Check (Checking actual code used)
// ---------------------------------------------------------------------------
console.log("\n--- Group 1: Verifying Harnesses Import and Use Shared Module ---");
{
  const logoutTestsSrc = readFileSync(join(__dirname, "p05-logout-tests.mjs"), "utf8");
  const logoutFailureSrc = readFileSync(join(__dirname, "p05-logout-failure.mjs"), "utf8");

  const testsImportUtils =
    logoutTestsSrc.includes('from "./p05-harness-utils.mjs"') &&
    logoutTestsSrc.includes("ConsoleTracker") &&
    logoutTestsSrc.includes("createHarnessLifecycle") &&
    logoutTestsSrc.includes("createSanitizer") &&
    logoutTestsSrc.includes("executeKeyboardAction");

  const failureImportUtils =
    logoutFailureSrc.includes('from "./p05-harness-utils.mjs"') &&
    logoutFailureSrc.includes("ConsoleTracker") &&
    logoutFailureSrc.includes("createHarnessLifecycle") &&
    logoutFailureSrc.includes("createSanitizer");

  const testsNoPostSanitizeBug =
    !logoutTestsSrc.includes("rawConsoleHasSecret = consoleIssues.some") &&
    logoutTestsSrc.includes("consoleTracker.hasLeaks()");

  const failureNoPostSanitizeBug =
    !logoutFailureSrc.includes("rawConsoleHasSecret = consoleIssues.some") &&
    logoutFailureSrc.includes("consoleTracker.hasLeaks()");

  recordProof(
    "p05-logout-tests.mjs imports and uses shared p05-harness-utils.mjs",
    testsImportUtils && testsNoPostSanitizeBug,
    "Imports ConsoleTracker, createHarnessLifecycle, executeKeyboardAction, and uses consoleTracker.hasLeaks()"
  );

  recordProof(
    "p05-logout-failure.mjs imports and uses shared p05-harness-utils.mjs",
    failureImportUtils && failureNoPostSanitizeBug,
    "Imports ConsoleTracker, createHarnessLifecycle, and uses consoleTracker.hasLeaks()"
  );
}

// ---------------------------------------------------------------------------
// GROUP 2: AC 1 & AC 2 — Secret Leak Detection in Console / PageError
// ---------------------------------------------------------------------------
console.log("\n--- Group 2: Leak Detection and Secret Redaction (AC 1 & AC 2) ---");
{
  const synthPw = "synth-very-secret-password-xyz123";
  const synthJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InN0YWZmIn0.mock_signature_part";
  const synthBearer = "Bearer synth-bearer-token-987654";
  const synthServiceKey = "synth-service-role-key-0000";

  const sanitizer = createSanitizer({
    password: synthPw,
    serviceKey: synthServiceKey,
  });

  const tracker = new ConsoleTracker(sanitizer);

  // Simulate console error with synthetic password
  tracker.handleConsole({
    type: () => "error",
    text: () => `Auth failed for password: ${synthPw}`,
  });

  // Simulate console warning with synthetic Bearer token
  tracker.handleConsole({
    type: () => "warning",
    text: () => `Request rejected: Authorization ${synthBearer}`,
  });

  // Simulate pageerror with synthetic JWT
  tracker.handlePageError({
    message: `Uncaught exception in token parser: ${synthJwt}`,
  });

  // 1. Verify leak detection occurred
  const hasLeaks = tracker.hasLeaks();
  const categories = tracker.getLeakCategories();
  const issues = tracker.getIssues(10);

  const detectedAllThree =
    categories.includes("password_leak") &&
    categories.includes("bearer_token_leak") &&
    categories.includes("jwt_token_leak");

  // 2. Verify no raw secrets leaked in issues/artifacts
  const issuesJoined = issues.join(" | ");
  const noRawPw = !issuesJoined.includes(synthPw);
  const noRawJwt = !issuesJoined.includes(synthJwt);
  const noRawBearer = !issuesJoined.includes("synth-bearer-token-987654");

  // 3. Verify redaction labels present
  const hasRedactedPw = issuesJoined.includes("[REDACTED_PASSWORD]");
  const hasRedactedJwt = issuesJoined.includes("[REDACTED_JWT]");
  const hasRedactedBearer = issuesJoined.includes("Bearer [REDACTED_TOKEN]");

  // 4. Verify scenario evaluation: asserting !tracker.hasLeaks() yields FAIL
  const scenarioStatus = !tracker.hasLeaks() ? "PASS" : "FAIL";

  recordProof(
    "AC 1: Console and pageerror with synthetic secrets trigger FAIL and leak categories",
    hasLeaks && detectedAllThree && scenarioStatus === "FAIL",
    `categories=${JSON.stringify(categories)}, scenarioStatus=${scenarioStatus}`
  );

  recordProof(
    "AC 1: Logged issues and artifacts contain ZERO raw secrets (properly redacted)",
    noRawPw && noRawJwt && noRawBearer && hasRedactedPw && hasRedactedJwt && hasRedactedBearer,
    `issuesPreview=${issuesJoined}`
  );

  // AC 2: Clean console without leaks passes
  const cleanTracker = new ConsoleTracker(sanitizer);
  cleanTracker.handleConsole({
    type: () => "warning",
    text: () => "Failed to load resource: the server responded with a status of 404 for /favicon.ico",
  });
  cleanTracker.handleConsole({
    type: () => "log",
    text: () => "User clicked submit button",
  });

  const cleanScenarioStatus = !cleanTracker.hasLeaks() ? "PASS" : "FAIL";
  recordProof(
    "AC 2: Clean console logs without secrets evaluate to PASS",
    !cleanTracker.hasLeaks() && cleanScenarioStatus === "PASS" && cleanTracker.getIssues().length === 1,
    `cleanLeaks=${cleanTracker.hasLeaks()}, issuesCount=${cleanTracker.getIssues().length}`
  );
}

// ---------------------------------------------------------------------------
// GROUP 3: AC 3 — Scenario FAIL Produces Nonzero Exit Code (Subprocess)
// ---------------------------------------------------------------------------
console.log("\n--- Group 3: Scenario FAIL Yields Nonzero Exit Code (AC 3) ---");
{
  const tempScriptPath = join(__dirname, "temp-test-fail-scenario.mjs");
  const tempResultsPath = join(__dirname, "temp-results-fail-scenario.json");

  const script = `
import { createHarnessLifecycle, createSanitizer } from "./p05-harness-utils.mjs";

const sanitizer = createSanitizer();
const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: "${__dirname.replace(/\\/g, "/")}",
  resultsFileName: "temp-results-fail-scenario.json",
  results,
  sanitizer,
});

lifecycle.rec("Passing scenario", "PASS", "ok");
lifecycle.rec("Failing scenario", "FAIL", "assertion failed");

const exitInfo = await lifecycle.finalize();
exitInfo.executeExit();
`;
  writeFileSync(tempScriptPath, script);

  const res = await runSubprocess("node", [tempScriptPath]);
  recordProof(
    "AC 3: Harness subprocess with a FAIL scenario exits with code 1",
    res.code === 1 && res.stderr.includes("Harness finished with FAILURES"),
    `exitCode=${res.code}, stderr=${res.stderr}`
  );

  try { unlinkSync(tempScriptPath); } catch {}
  try { unlinkSync(tempResultsPath); } catch {}
}

// ---------------------------------------------------------------------------
// GROUP 4: AC 4 — Save Failure Produces Nonzero, Stderr Summary, and Attempts Cleanup
// ---------------------------------------------------------------------------
console.log("\n--- Group 4: Results Save Failure Handling (AC 4) ---");
{
  const tempScriptPath = join(__dirname, "temp-test-write-fail.mjs");
  const tempCleanupMarker = join(__dirname, "temp-cleanup-marker-ac4.txt");

  const script = `
import { writeFileSync } from "node:fs";
import { createHarnessLifecycle, createSanitizer } from "./p05-harness-utils.mjs";

const sanitizer = createSanitizer();
const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: "${__dirname.replace(/\\/g, "/")}",
  resultsFileName: "temp-results-never.json",
  results,
  sanitizer,
});

lifecycle.rec("Scenario 1", "PASS", "ok");
lifecycle.rec("Scenario 2", "PASS", "ok");

const exitInfo = await lifecycle.finalize({
  writeOverride: () => {
    throw new Error("Simulated disk write permission denied");
  },
  customCleanup: async () => {
    writeFileSync("${tempCleanupMarker.replace(/\\/g, "/")}", "CLEANUP_EXECUTED");
  }
});

exitInfo.executeExit();
`;
  writeFileSync(tempScriptPath, script);

  const res = await runSubprocess("node", [tempScriptPath]);
  const cleanupRan = existsSync(tempCleanupMarker);
  const fallbackSummaryPrinted = res.stderr.includes("RESULTS_FALLBACK_SUMMARY: total=2, pass=2, fail=0");

  recordProof(
    "AC 4: Write failure results in exit code 1",
    res.code === 1,
    `exitCode=${res.code}`
  );

  recordProof(
    "AC 4: Write failure prints safe fallback summary to stderr without claiming success",
    fallbackSummaryPrinted && res.stderr.includes("CRITICAL: Failed to write"),
    `stderrSnippet=${res.stderr.slice(0, 180)}`
  );

  recordProof(
    "AC 4: Cleanup was still executed despite write failure",
    cleanupRan,
    `cleanupMarkerExists=${cleanupRan}`
  );

  try { unlinkSync(tempScriptPath); } catch {}
  try { unlinkSync(tempCleanupMarker); } catch {}
}

// ---------------------------------------------------------------------------
// GROUP 5: AC 5 — Cleanup Failure Produces Nonzero Exit Code
// ---------------------------------------------------------------------------
console.log("\n--- Group 5: Cleanup Failure Handling (AC 5) ---");
{
  const tempScriptPath = join(__dirname, "temp-test-cleanup-fail.mjs");
  const tempResultsPath = join(__dirname, "temp-results-cleanup-fail.json");

  const script = `
import { createHarnessLifecycle, createSanitizer } from "./p05-harness-utils.mjs";

const sanitizer = createSanitizer();
const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: "${__dirname.replace(/\\/g, "/")}",
  resultsFileName: "temp-results-cleanup-fail.json",
  results,
  sanitizer,
});

lifecycle.rec("All pass scenario", "PASS", "ok");

const exitInfo = await lifecycle.finalize({
  cleanupOverride: async () => {
    throw new Error("Simulated browser close crash: SIGKILL required");
  }
});

exitInfo.executeExit();
`;
  writeFileSync(tempScriptPath, script);

  const res = await runSubprocess("node", [tempScriptPath]);
  recordProof(
    "AC 5: Cleanup failure results in exit code 1",
    res.code === 1 && res.stderr.includes("CRITICAL: Cleanup failed"),
    `exitCode=${res.code}, stderrSnippet=${res.stderr.slice(0, 160)}`
  );

  try { unlinkSync(tempScriptPath); } catch {}
  try { unlinkSync(tempResultsPath); } catch {}
}

// ---------------------------------------------------------------------------
// GROUP 6: AC 6 — Primary Error Preserved Despite Screenshot or Cleanup Failure
// ---------------------------------------------------------------------------
console.log("\n--- Group 6: Primary Error Preservation (AC 6) ---");
{
  const tempResultsPath = join(__dirname, "temp-results-ac6-primary.json");
  const sanitizer = createSanitizer();
  const results = [];
  const lifecycle = createHarnessLifecycle({
    evidenceDir: __dirname,
    resultsFileName: "temp-results-ac6-primary.json",
    results,
    sanitizer,
  });

  const primaryError = new Error("Primary Server Action navigation timeout");
  lifecycle.recordHarnessError(primaryError);

  // Simulate screenshot failure
  const mockPage = {
    screenshot: async () => {
      throw new Error("Screenshot buffer allocation failed");
    },
  };
  await lifecycle.captureScreenshot(mockPage, "error.png");

  // Verify screenshot error is tracked without wiping harness error
  const recordedPrimary = lifecycle.getHarnessError();
  const recordedScreenshotErr = lifecycle.getScreenshotError();

  // Finalize with simulated cleanup failure
  const exitInfo = await lifecycle.finalize({
    cleanupOverride: async () => {
      throw new Error("Cleanup connection reset");
    },
  });

  // Verify results file has primary error recorded as FAIL
  const savedData = JSON.parse(readFileSync(tempResultsPath, "utf8"));
  const harnessErrorRow = savedData.find((r) => r.scenario === "HARNESS ERROR");

  const primaryPreservedInResults =
    harnessErrorRow &&
    harnessErrorRow.status === "FAIL" &&
    harnessErrorRow.evidence.includes("Primary Server Action navigation timeout");

  const primaryPreservedInObject =
    recordedPrimary !== null &&
    recordedPrimary.message === "Primary Server Action navigation timeout" &&
    recordedScreenshotErr !== null &&
    exitInfo.hasHarnessError === true &&
    exitInfo.hasCleanupError === true;

  recordProof(
    "AC 6: Primary error is preserved in results when screenshot fails",
    primaryPreservedInObject && recordedScreenshotErr.message.includes("Screenshot buffer allocation"),
    `primary=${recordedPrimary.message}, screenshotError=${recordedScreenshotErr.message}`
  );

  recordProof(
    "AC 6: Primary error is persisted in results file even when cleanup fails",
    primaryPreservedInResults,
    `savedHarnessEvidence=${harnessErrorRow?.evidence}`
  );

  try { unlinkSync(tempResultsPath); } catch {}
}

// ---------------------------------------------------------------------------
// GROUP 7: AC 7 — All PASS + Successful Save + Cleanup Produces Exit Code 0
// ---------------------------------------------------------------------------
console.log("\n--- Group 7: All Scenarios PASS Produces Exit Code 0 (AC 7) ---");
{
  const tempScriptPath = join(__dirname, "temp-test-all-pass.mjs");
  const tempResultsPath = join(__dirname, "temp-results-all-pass.json");

  const script = `
import { createHarnessLifecycle, createSanitizer } from "./p05-harness-utils.mjs";

const sanitizer = createSanitizer();
const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: "${__dirname.replace(/\\/g, "/")}",
  resultsFileName: "temp-results-all-pass.json",
  results,
  sanitizer,
});

lifecycle.rec("AC1 Logout button present", "PASS", "button count=1");
lifecycle.rec("AC2 Normal logout redirect", "PASS", "landed on /login");
lifecycle.rec("AC8 Alert observation", "INFO", "no alerts shown");

const exitInfo = await lifecycle.finalize({
  browser: { close: async () => {} }
});
exitInfo.executeExit();
`;
  writeFileSync(tempScriptPath, script);

  const res = await runSubprocess("node", [tempScriptPath]);
  const resultsExist = existsSync(tempResultsPath);

  recordProof(
    "AC 7: All PASS/INFO scenarios with successful save and cleanup exits 0",
    res.code === 0 && resultsExist && res.stdout.includes("Harness finished successfully"),
    `exitCode=${res.code}, resultsWritten=${resultsExist}`
  );

  try { unlinkSync(tempScriptPath); } catch {}
  try { unlinkSync(tempResultsPath); } catch {}
}

// ---------------------------------------------------------------------------
// GROUP 8: AC 8 — Keyboard Action Promise Handling
// ---------------------------------------------------------------------------
console.log("\n--- Group 8: Keyboard Action Promise Handling (AC 8) ---");
{
  const sanitizer = createSanitizer();

  // Test successful execution
  const mockPageSuccess = {
    waitForURL: async () => {},
    keyboard: { press: async () => {} },
  };

  const successResult = await executeKeyboardAction({
    page: mockPageSuccess,
    key: "Enter",
    targetUrl: "**/login",
    sanitizer,
  });

  recordProof(
    "AC 8: executeKeyboardAction succeeds when both waitForURL and keyboard.press resolve",
    successResult.success === true && successResult.error === null,
    `success=${successResult.success}`
  );

  // Test failure execution (timeout in navigation)
  const mockPageFail = {
    waitForURL: async () => {
      throw new Error("page.waitForURL: Timeout 25000ms exceeded.");
    },
    keyboard: { press: async () => {} },
  };

  const failResult = await executeKeyboardAction({
    page: mockPageFail,
    key: "Enter",
    targetUrl: "**/login",
    sanitizer,
  });

  recordProof(
    "AC 8: executeKeyboardAction catches navigation failure safely without unhandled rejection",
    failResult.success === false && failResult.error.includes("Timeout 25000ms exceeded"),
    `errorMsg=${failResult.error}`
  );
}

// ---------------------------------------------------------------------------
// GROUP 9: Account Helper Configuration, Security Guards, and Prerequisites
// ---------------------------------------------------------------------------
console.log("\n--- Group 9: Account Helper Guards and Configuration ---");
{
  // 9.1 Rejection when SUPABASE_SERVICE_KEY is missing
  const resNoKey = await runSubprocess("node", ["p05-account.mjs", "create"], {
    SUPABASE_SERVICE_KEY: "",
    P05_PASSWORD: "synth-password-to-reach-service-key-check",
  });
  recordProof(
    "p05-account create fails when SUPABASE_SERVICE_KEY is empty",
    resNoKey.code !== 0 && resNoKey.stderr.includes("SUPABASE_SERVICE_KEY is required"),
    `exit=${resNoKey.code}, stderr=${resNoKey.stderr}`
  );

  // 9.2 Remote target rejection before request
  const resRemote = await runSubprocess("node", ["p05-account.mjs", "get-by-id", "00000000-0000-0000-0000-000000000000"], {
    SUPABASE_API_URL: "https://remote-project.supabase.co",
    SUPABASE_SERVICE_KEY: "dummy-key-to-test-target-guard",
  });
  recordProof(
    "p05-account strictly rejects non-local Supabase target before making any request",
    resRemote.code !== 0 && resRemote.stderr.includes("Refusing to connect to non-local Supabase target"),
    `exit=${resRemote.code}, stderr=${resRemote.stderr}`
  );

  // 9.3 Prerequisite check when --with-account is requested without SUPABASE_SERVICE_KEY
  const resPrereq = await runSubprocess("node", ["p05-harness-proof.mjs", "--with-account"], {
    SUPABASE_SERVICE_KEY: "",
  });
  recordProof(
    "Suite exits nonzero with safe prerequisite error when integration is requested without SUPABASE_SERVICE_KEY",
    resPrereq.code !== 0 && resPrereq.stderr.includes("PREREQUISITE ERROR: SUPABASE_SERVICE_KEY environment variable is required"),
    `exit=${resPrereq.code}, stderr=${resPrereq.stderr}`
  );

  // 9.4 Verification that no fallback service-role key is embedded in code
  const proofSrc = readFileSync(join(__dirname, "p05-harness-proof.mjs"), "utf8");
  const utilsSrc = readFileSync(join(__dirname, "p05-harness-utils.mjs"), "utf8");
  const accountSrc = readFileSync(join(__dirname, "p05-account.mjs"), "utf8");

  // Matches any attempt to provide a non-empty fallback literal to SUPABASE_SERVICE_KEY
  const fallbackKeyPattern = new RegExp("SUPABASE_SERVICE_KEY" + "\\s*(?:\\?\\?|\\|\\|)\\s*[\"']([^\"']+)[\"']");
  const hasFallbackAssigned =
    fallbackKeyPattern.test(proofSrc) ||
    fallbackKeyPattern.test(utilsSrc) ||
    fallbackKeyPattern.test(accountSrc);

  const hardcodedKeyInAccount = /serviceKey\s*=\s*["'][^"']+["']/.test(accountSrc);
  const hardcodedKeyInProof = /localServiceKey\s*=\s*["'][^"']+["']/.test(proofSrc);

  recordProof(
    "No fallback service-role key embedded in harness proof, utils, or account helper code",
    !hasFallbackAssigned && !hardcodedKeyInAccount && !hardcodedKeyInProof,
    "Verified across proof, utils, and account helper (no credentials printed or hardcoded)"
  );

  // 9.5 Safeguard: rejecting deletion of non-test account
  const rejectStaff = !isTestAccount("staff@upaznet.com") && !isTestAccount("helpdesk@gmail.com");
  const acceptTest = isTestAccount("p05-logout-review-123@example.test");
  recordProof(
    "isTestAccount correctly protects production/staff emails and only matches test prefix",
    rejectStaff && acceptTest,
    "staff/helpdesk rejected, test accepted"
  );
}

// ---------------------------------------------------------------------------
// GROUP 10: Local Supabase Account Integration (Explicit via --with-account)
// ---------------------------------------------------------------------------
console.log("\n--- Group 10: Local Supabase Account Integration ---");
if (!enableAccountIntegration) {
  recordProof(
    "Local GoTrue account integration (create, get-by-id, pagination, delete, 404 confirmation)",
    "NOT_RUN",
    "Omitted in default synthetic mode. Run with --with-account and SUPABASE_SERVICE_KEY set to execute against local Supabase."
  );
} else {
  // At this point, SUPABASE_SERVICE_KEY was verified non-empty by top-level guard
  const localServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const synthPw = "synth-test-password-helper-987";
  const testEmail = `p05-logout-review-${Date.now().toString(36)}@example.test`;

  // 10.1 Rejection when P05_PASSWORD is empty
  const resNoPw = await runSubprocess("node", ["p05-account.mjs", "create"], {
    SUPABASE_SERVICE_KEY: localServiceKey,
    P05_PASSWORD: "",
  });
  recordProof(
    "p05-account create fails when P05_PASSWORD is empty",
    resNoPw.code !== 0 && resNoPw.stderr.includes("P05_PASSWORD environment variable is required"),
    `exit=${resNoPw.code}, stderr=${resNoPw.stderr}`
  );

  // 10.2 Create temporary test account with password from env (NO password leak in stdout)
  const resCreate = await runSubprocess("node", ["p05-account.mjs", "create"], {
    SUPABASE_SERVICE_KEY: localServiceKey,
    P05_EMAIL: testEmail,
    P05_PASSWORD: synthPw,
  });

  let createdId = null;
  let stdoutHasNoPw = false;
  try {
    const parsed = JSON.parse(resCreate.stdout);
    createdId = parsed.id;
    stdoutHasNoPw = !resCreate.stdout.includes(synthPw) && parsed.email === testEmail && typeof parsed.id === "string";
  } catch {
    stdoutHasNoPw = false;
  }
  recordProof(
    "p05-account create receives password via env and does NOT leak password to stdout",
    resCreate.code === 0 && stdoutHasNoPw,
    `createdId=${createdId}`
  );

  if (createdId) {
    // 10.3 get-by-id retrieves created account
    const resGet = await runSubprocess("node", ["p05-account.mjs", "get-by-id", createdId], {
      SUPABASE_SERVICE_KEY: localServiceKey,
    });
    recordProof(
      "p05-account get-by-id retrieves created test account",
      resGet.code === 0 && resGet.stdout.includes(createdId) && resGet.stdout.includes(testEmail),
      resGet.stdout
    );

    // 10.4 get-by-email retrieves created account across pagination
    const resGetEmail = await runSubprocess("node", ["p05-account.mjs", "get-by-email", testEmail], {
      SUPABASE_SERVICE_KEY: localServiceKey,
    });
    recordProof(
      "p05-account get-by-email finds created test account across pagination",
      resGetEmail.code === 0 && resGetEmail.stdout.includes(createdId),
      resGetEmail.stdout
    );

    // 10.5 Delete temporary account
    const resDel = await runSubprocess("node", ["p05-account.mjs", "delete", createdId], {
      SUPABASE_SERVICE_KEY: localServiceKey,
    });
    recordProof(
      "p05-account delete successfully removes temporary account",
      resDel.code === 0 && resDel.stdout.includes(`DELETED ${createdId}`),
      resDel.stdout
    );

    // 10.6 get-by-id confirms account is NOT_FOUND after deletion
    const resGone = await runSubprocess("node", ["p05-account.mjs", "get-by-id", createdId], {
      SUPABASE_SERVICE_KEY: localServiceKey,
    });
    recordProof(
      "p05-account get-by-id confirms NOT_FOUND after deletion",
      resGone.code === 0 && resGone.stdout === "NOT_FOUND",
      resGone.stdout
    );
  }

  // 10.7 404 vs Network error distinction
  const fakeUuid = "00000000-0000-0000-0000-000000000000";
  const resFake404 = await runSubprocess("node", ["p05-account.mjs", "get-by-id", fakeUuid], {
    SUPABASE_SERVICE_KEY: localServiceKey,
  });
  recordProof(
    "p05-account get-by-id returns NOT_FOUND for non-existent account",
    resFake404.code === 0 && resFake404.stdout === "NOT_FOUND",
    resFake404.stdout
  );

  const resDeadPort = await runSubprocess("node", ["p05-account.mjs", "get-by-id", fakeUuid], {
    SUPABASE_SERVICE_KEY: localServiceKey,
    SUPABASE_API_URL: "http://127.0.0.1:59999",
  });
  recordProof(
    "p05-account distinguishes network failure from NOT_FOUND (exits nonzero with NETWORK_ERROR)",
    resDeadPort.code !== 0 && resDeadPort.stderr.includes("NETWORK_ERROR"),
    `exit=${resDeadPort.code}`
  );
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log("\n=== SUMMARY OF P0.5 VERIFICATION SUITE ===");
const passCount = proofResults.filter((r) => r.status === "PASS").length;
const failCount = proofResults.filter((r) => r.status === "FAIL").length;
const notRunCount = proofResults.filter((r) => r.status === "NOT RUN").length;
const totalCount = proofResults.length;
console.log(
  `Total: ${totalCount} checks | Passed: ${passCount} | Failed: ${failCount} | Not Run: ${notRunCount}`
);

if (failCount > 0) {
  console.error("Some verification checks failed!");
  process.exit(1);
} else {
  console.log("P0.5 verification suite finished successfully (0 failures)!");
  process.exit(0);
}
