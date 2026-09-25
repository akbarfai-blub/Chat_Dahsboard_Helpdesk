// docs/evidence/P0_5/p05-harness-utils.mjs
// Shared testing utilities for P0.5 logout test harnesses and proof suite.
// Handles secret detection, redaction, console tracking, keyboard promise handling,
// and robust lifecycle management (ensuring accurate nonzero exit codes and preserving errors).

import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Creates a sanitizer and raw-text leak detector.
 * Detects leaks on raw in-memory strings BEFORE redacting them for logs/artifacts.
 */
export function createSanitizer(options = {}) {
  const getPassword = () => options.password || process.env.P05_PASSWORD || "";
  const getServiceKey = () => options.serviceKey || process.env.SUPABASE_SERVICE_KEY || "";
  const additional = options.additionalSecrets || [];

  // Patterns for detecting sensitive data
  const jwtTestRegex = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}(?:\.[a-zA-Z0-9_-]+)?/;
  const jwtReplaceRegex = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}(?:\.[a-zA-Z0-9_-]+)?/g;
  const bearerTestRegex = /Bearer\s+[a-zA-Z0-9_.-]+/i;
  const bearerReplaceRegex = /Bearer\s+[a-zA-Z0-9_.-]+/gi;

  function detectLeaks(rawText) {
    if (typeof rawText !== "string") {
      rawText = String(rawText ?? "");
    }
    const leaks = [];
    const pw = getPassword();
    if (pw && pw.length > 0 && rawText.includes(pw)) {
      leaks.push("password_leak");
    }
    const sk = getServiceKey();
    if (sk && sk.length > 0 && rawText.includes(sk)) {
      leaks.push("service_key_leak");
    }
    if (jwtTestRegex.test(rawText)) {
      leaks.push("jwt_token_leak");
    }
    if (bearerTestRegex.test(rawText)) {
      leaks.push("bearer_token_leak");
    }
    if (rawText.toLowerCase().includes("service_role")) {
      leaks.push("service_role_leak");
    }
    for (const secret of additional) {
      if (secret && rawText.includes(secret)) {
        leaks.push("custom_secret_leak");
      }
    }
    return leaks;
  }

  function sanitize(text) {
    if (text === null || text === undefined) return "";
    let str = typeof text === "string" ? text : String(text);

    const pw = getPassword();
    if (pw && pw.length > 0) {
      str = str.replaceAll(pw, "[REDACTED_PASSWORD]");
    }
    const sk = getServiceKey();
    if (sk && sk.length > 0) {
      str = str.replaceAll(sk, "[REDACTED_SERVICE_KEY]");
    }
    for (const secret of additional) {
      if (secret) str = str.replaceAll(secret, "[REDACTED_SECRET]");
    }
    str = str.replace(jwtReplaceRegex, "[REDACTED_JWT]");
    str = str.replace(bearerReplaceRegex, "Bearer [REDACTED_TOKEN]");
    return str;
  }

  return {
    detectLeaks,
    sanitize,
  };
}

/**
 * Tracks browser console messages and page errors.
 * Inspects RAW text for leaks before sanitization, and stores only sanitized text.
 */
export class ConsoleTracker {
  constructor(sanitizer) {
    this.sanitizer = sanitizer || createSanitizer();
    this.issues = [];
    this.leakCategories = [];
  }

  attach(page) {
    if (!page || typeof page.on !== "function") return;
    page.on("console", (m) => this.handleConsole(m));
    page.on("pageerror", (e) => this.handlePageError(e));
  }

  handleConsole(msg) {
    const rawType = typeof msg?.type === "function" ? msg.type() : (msg?.type || "log");
    const rawText = typeof msg?.text === "function" ? msg.text() : (msg?.text || String(msg ?? ""));

    // 1. Detect leaks on RAW in-memory text BEFORE sanitization
    const leaks = this.sanitizer.detectLeaks(rawText);
    if (leaks.length > 0) {
      for (const leak of leaks) {
        if (!this.leakCategories.includes(leak)) {
          this.leakCategories.push(leak);
        }
      }
    }

    // 2. Sanitize text before saving or printing
    if (rawType === "error" || rawType === "warning") {
      this.issues.push(this.sanitizer.sanitize(`${rawType}: ${rawText}`));
    }
  }

  handlePageError(err) {
    const rawText = err?.message || String(err || "");
    const leaks = this.sanitizer.detectLeaks(rawText);
    if (leaks.length > 0) {
      for (const leak of leaks) {
        if (!this.leakCategories.includes(leak)) {
          this.leakCategories.push(leak);
        }
      }
    }
    this.issues.push(this.sanitizer.sanitize(`pageerror: ${rawText}`));
  }

  hasLeaks() {
    return this.leakCategories.length > 0;
  }

  getLeakCategories() {
    return [...this.leakCategories];
  }

  getIssues(limit = 5) {
    return this.issues.slice(0, limit);
  }
}

/**
 * Executes a keyboard press while properly awaiting navigation / URL transition.
 * Catches errors safely so keyboard or timeout failures are recorded as test failures
 * rather than unhandled promise rejections.
 */
export async function executeKeyboardAction({ page, key, targetUrl, timeout = 25000, sanitizer }) {
  const sanitize = sanitizer ? sanitizer.sanitize : (s) => String(s);
  try {
    await Promise.all([
      page.waitForURL(targetUrl, { timeout }),
      page.keyboard.press(key),
    ]);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: sanitize(err?.message || String(err)) };
  }
}

/**
 * Manages harness lifecycle: recording results, error handling,
 * screenshot safety, results persistence, cleanup, and determining exit code.
 */
export function createHarnessLifecycle({ evidenceDir, resultsFileName, results, sanitizer }) {
  const sanitize = sanitizer ? sanitizer.sanitize : (s) => String(s);
  let harnessError = null;
  let screenshotError = null;
  let writeError = null;
  let cleanupError = null;

  function rec(scenario, status, evidence, limitation = "") {
    const safeEvidence = sanitize(evidence);
    const safeLimitation = sanitize(limitation);
    results.push({ scenario, status, evidence: safeEvidence, limitation: safeLimitation });
    console.log(`${status} | ${scenario} | ${safeEvidence}${safeLimitation ? " | LIMIT: " + safeLimitation : ""}`);
  }

  function recordHarnessError(err) {
    harnessError = err;
    const safeMsg = sanitize(err?.message || String(err));
    rec("HARNESS ERROR", "FAIL", `exception=${safeMsg}`);
  }

  async function captureScreenshot(page, filename) {
    if (!page || typeof page.screenshot !== "function") return;
    try {
      const cleanFilename = String(filename || "").replace(/^[\\/]+/, "");
      const fullPath = join(evidenceDir, cleanFilename);
      await page.screenshot({ path: fullPath });
    } catch (shotErr) {
      screenshotError = shotErr;
      console.error(`Warning: failed to capture screenshot ${filename}:`, sanitize(shotErr?.message || String(shotErr)));
    }
  }

  async function finalize({ browser, customCleanup, writeOverride, cleanupOverride } = {}) {
    // 1. Attempt to write results file
    try {
      if (writeOverride) {
        writeOverride();
      } else {
        const fullPath = join(evidenceDir, resultsFileName);
        writeFileSync(fullPath, JSON.stringify(results, null, 2));
        console.log(`WROTE ${resultsFileName}`);
      }
    } catch (fsErr) {
      writeError = fsErr;
      console.error(`CRITICAL: Failed to write ${resultsFileName}:`, sanitize(fsErr?.message || String(fsErr)));
      // Safe fallback summary output to stderr
      const passCount = results.filter((r) => r.status === "PASS").length;
      const failCount = results.filter((r) => r.status === "FAIL").length;
      console.error(`RESULTS_FALLBACK_SUMMARY: total=${results.length}, pass=${passCount}, fail=${failCount}`);
    }

    // 2. ALWAYS attempt cleanup, even if write failed!
    try {
      if (cleanupOverride) {
        await cleanupOverride();
      } else {
        if (browser && typeof browser.close === "function") {
          await browser.close();
        }
        if (customCleanup && typeof customCleanup === "function") {
          await customCleanup();
        }
      }
    } catch (cErr) {
      cleanupError = cErr;
      console.error("CRITICAL: Cleanup failed:", sanitize(cErr?.message || String(cErr)));
    }

    // 3. Evaluate overall status and exit code
    const hasScenarioFail = results.some((r) => r.status === "FAIL");
    const hasHarnessError = harnessError !== null;
    const hasWriteError = writeError !== null;
    const hasCleanupError = cleanupError !== null;

    const hasAnyFailure = hasScenarioFail || hasHarnessError || hasWriteError || hasCleanupError;
    const exitCode = hasAnyFailure ? 1 : 0;

    return {
      hasAnyFailure,
      hasScenarioFail,
      hasHarnessError,
      hasWriteError,
      hasCleanupError,
      screenshotError,
      exitCode,
      executeExit() {
        if (hasAnyFailure) {
          console.error(
            `Harness finished with FAILURES (scenariosFailed=${hasScenarioFail}, harnessError=${hasHarnessError}, writeError=${hasWriteError}, cleanupError=${hasCleanupError}).`
          );
          process.exit(1);
        } else {
          console.log("Harness finished successfully (ALL PASS/INFO, save and cleanup succeeded).");
          process.exit(0);
        }
      },
    };
  }

  return {
    rec,
    recordHarnessError,
    captureScreenshot,
    finalize,
    getHarnessError: () => harnessError,
    getScreenshotError: () => screenshotError,
    getWriteError: () => writeError,
    getCleanupError: () => cleanupError,
  };
}
