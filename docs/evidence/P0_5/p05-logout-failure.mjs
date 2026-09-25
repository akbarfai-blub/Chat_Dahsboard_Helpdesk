// P0.5 logout FAILURE verification — runs against a second dev instance (port 3001)
// whose NEXT_PUBLIC_SUPABASE_URL points at the failing proxy (127.0.0.1:54389).
// The proxy passes everything through to real local Supabase EXCEPT POST /auth/v1/logout,
// which returns 500 while the mode file says "fail" — the REAL logout Server Action path.
//
// Revision 2 (2026-09-23): AC6d is split by evidence method and by session state:
//   - AC6d1 session-lost branch: real browser E2E with HTTP 500 (previous evidence, tightened).
//   - AC6d2 valid-session branch SELECTION: isolated mock test of the ACTUAL logout()
//     server action code (p05-ac6d-branch-logic.mjs) — this branch is unreachable with the
//     installed @supabase/auth-js (see review); it is NOT claimed as browser/Supabase E2E.
//   - AC6d3 valid-session DISPLAY + RETRY: real browser E2E on /dashboard?error=logout with a
//     valid session (message shown, Keluar available, retry succeeds, no loop, no misleading claim).
// FAIL_login and AC6e/f stay. Credentials from env only; nothing secret written to artifacts.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSanitizer,
  ConsoleTracker,
  createHarnessLifecycle,
} from "./p05-harness-utils.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.P05_PW_PATH || "playwright");

const BASE = process.env.P05_FAIL_BASE_URL || "http://localhost:3001";
if (!process.env.P05_EMAIL || !process.env.P05_PASSWORD) {
  console.error("P05_EMAIL and P05_PASSWORD env are required");
  process.exit(2);
}
const creds = { email: process.env.P05_EMAIL, password: process.env.P05_PASSWORD };
const modeFile = fileURLToPath(new URL("./p05-fail-mode", import.meta.url));
const EVIDENCE_DIR =
  (process.env.P05_EVIDENCE_DIR || fileURLToPath(new URL(".", import.meta.url))).replace(/[\\/]$/, "") + "\\";

const sanitizer = createSanitizer({ password: creds.password });

function basePathSafe(u, base) {
  try {
    const url = new URL(u);
    return url.pathname === "/" ? u.replace(base, "") : url.pathname + url.search;
  } catch {
    return u;
  }
}

const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: EVIDENCE_DIR,
  resultsFileName: "results-failure.json",
  results,
  sanitizer,
});
const rec = lifecycle.rec;
function setMode(m) {
  writeFileSync(modeFile, m);
  console.log(`  [proxy mode -> ${m}]`);
}
const logoutMsg = "Logout belum berhasil. Periksa koneksi lalu coba kembali.";
const isVisible = async (loc) => {
  try {
    return await loc.isVisible();
  } catch {
    return false;
  }
};
const settle = async (ms = 300) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ locale: "id-ID" });
const page = await context.newPage();
page.setDefaultTimeout(25000);

const consoleTracker = new ConsoleTracker(sanitizer);
consoleTracker.attach(page);

const authCookies = async () => (await context.cookies()).filter((c) => c.name.includes("auth-token"));
const shot = async (name) => lifecycle.captureScreenshot(page, name);
const alertTexts = async () =>
  page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim() || ""));
const dashH1 = () => page.getByRole("heading", { name: "Dashboard Helpdesk", exact: true });
const loginFormVisible = async () =>
  (await isVisible(page.locator("#email"))) && (await isVisible(page.locator("#password")));

try {
  // --- FAIL_login: proxy pass mode, real login through the proxy ---
  setMode("pass");
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await settle(400);
  rec(
    "FAIL_login Login melalui proxy (mode pass)",
    new URL(page.url()).pathname === "/dashboard" && (await isVisible(dashH1())) ? "PASS" : "FAIL",
    `url=${new URL(page.url()).pathname}, dashHeadingVisible=${await isVisible(dashH1())}`,
    "isolated: env aplikasi 3001 menunjuk proxy setempat, bukan Supabase langsung — membuktikan env gagal benar-benar dipakai",
  );

  // --- AC6a/b/c/d1: logout failure with session still present at click time ---
  setMode("fail");
  const cookiesBefore = (await authCookies()).length;
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  // wait until the final URL is stable (redirect target resolved, no bounce loop)
  await page.waitForFunction(
    () => !!document.querySelector("#email") || !!document.querySelector("h1"),
    null,
    { timeout: 10000 },
  ).catch(() => {});
  await settle(800);
  const failUrl = page.url();
  const failPath = new URL(failUrl).pathname;
  const failQuery = new URL(failUrl).search;
  const alerts = await alertTexts();
  const cookiesAfter = (await authCookies()).length;
  const bodyText = (await page.locator("body").textContent()) || "";
  const bodyLeaks = sanitizer.detectLeaks(bodyText);
  const leakCategories = [...bodyLeaks];
  if (bodyText.includes("AuthApiError")) leakCategories.push("auth_api_error_detected");
  if (bodyText.includes("Internal Server Error (simulated")) leakCategories.push("internal_server_error_raw_detected");
  if (bodyText.includes("at Server Actions")) leakCategories.push("server_actions_stack_detected");
  if (bodyText.includes("errorStack")) leakCategories.push("error_stack_detected");
  const alertVisible = (await isVisible(page.getByRole("alert"))) || (await isVisible(page.getByText(logoutMsg, { exact: true })));
  await settle(1000);
  const failPathAfterSettle = new URL(page.url()).pathname; // loop check
  await shot("\\ac6-logout-500.png");

  // AC6a — no misleading success redirect; error=logout is mandatory on this branch
  const landedOnLoginError =
    failPath === "/login" && failQuery.includes("error=logout") && failPathAfterSettle === "/login";
  rec(
    "AC6a Kegagalan 500: tanpa redirect sukses menyesatkan (mendarat di /login?error=logout, bukan klaim berhasil)",
    landedOnLoginError && cookiesAfter === 0 && (await loginFormVisible()) && !(await isVisible(dashH1())) ? "PASS" : "FAIL",
    `final=${basePathSafe(failUrl, BASE)}, afterSettle=${failPathAfterSettle}, alerts=${JSON.stringify(alerts)}, cookiesBefore=${cookiesBefore}, cookiesAfter=${cookiesAfter}, formVisible=${await loginFormVisible()}, dashHeadingVisible=${await isVisible(dashH1())}`,
  );

  // AC6b — generic Indonesian message on the session-lost error path
  const msgShown = alerts.includes(logoutMsg) || (alertVisible && alerts.length > 0);
  rec(
    "AC6b Pesan generik Bahasa Indonesia tampil di jalur error sesi-hilang",
    msgShown && failQuery.includes("error=logout") ? "PASS" : "FAIL",
    `alerts=${JSON.stringify(alerts)}, final=${failPath}${failQuery}`,
  );

  // AC6c — no raw error/token on page (explicit patterns; "500" NOT used as a pattern)
  rec("AC6c Tidak ada raw error/token di halaman", leakCategories.length === 0 ? "PASS" : "FAIL", `leaks=${JSON.stringify(leakCategories)}`);

  // AC6d1 — session-lost branch (real E2E with genuine 500): getUser->no user -> /login?error=logout, no loop
  const noLoop = failPathAfterSettle === failPath && failPath === "/login";
  rec(
    "AC6d1 Sesi hilang setelah kegagalan: /login?error=logout, tanpa redirect loop (browser E2E nyata, HTTP 500)",
    landedOnLoginError && noLoop && msgShown ? "PASS" : "FAIL",
    `final=${failPath}${failQuery}, afterSettle=${failPathAfterSettle}, alerts=${JSON.stringify(alerts)}, cookiesAfter=${cookiesAfter}`,
    "metode: browser nyata + Server Action nyata + Supabase lokal (via proxy yang hanya memutus POST /logout); cabang dipilih karena getUser() setelah error tidak menemukan sesi (auth-js meng-evict sesi pada error non-401/403/404)",
  );

  // --- AC6d3: valid-session branch DISPLAY + RETRY (real browser, proxy pass) ---
  // The branch SELECTION (/dashboard?error=logout when getUser still returns a user) is
  // proven separately in p05-ac6d-branch-logic.mjs (isolated mock); this E2E proves the
  // target the branch selects renders the message, keeps the retry button, and succeeds
  // once the outage is over — without any misleading success claim.
  setMode("pass");
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await settle(400);
  // navigate to the exact target the valid-session branch redirects to
  await page.goto(`${BASE}/dashboard?error=logout`, { waitUntil: "load" });
  await settle(500);
  const branchQueryPath = new URL(page.url()).pathname + new URL(page.url()).search;
  const branchAlerts = await alertTexts();
  const branchAlertVisible = await isVisible(page.getByText(logoutMsg, { exact: true }));
  const keluarAvailable = (await page.locator('form button[type="submit"]', { hasText: "Keluar" }).count()) === 1;
  await settle(800);
  const noLoopValid = new URL(page.url()).pathname === "/dashboard"; // stays, no bounce
  await shot("\\ac6-dashboard-error-valid-session.png");
  const displayOk =
    branchQueryPath === "/dashboard?error=logout" &&
    branchAlerts.includes(logoutMsg) &&
    branchAlertVisible &&
    keluarAvailable &&
    noLoopValid &&
    (await isVisible(dashH1()));
  rec(
    "AC6d3 Sesi valid: pesan kegagalan tampil di /dashboard?error=logout, tombol Keluar tersedia, tanpa redirect loop (browser E2E)",
    displayOk ? "PASS" : "FAIL",
    `final=${branchQueryPath}, alerts=${JSON.stringify(branchAlerts)}, alertVisible=${branchAlertVisible}, keluarAvailable=${keluarAvailable}, staysOnDashboard=${noLoopValid}, dashHeadingVisible=${await isVisible(dashH1())}`,
    "urutan: login nyata (proxy pass) -> buka /dashboard?error=logout (target yang dipilih cabang sesi-valid) -> assert pesan + retry tersedia; pemilihan cabang itu sendiri dibuktikan terpisah (mock terisolasi ac6d2)",
  );
  // retry: logout succeeds now that the proxy is back to pass — no misleading error
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await settle(400);
  rec(
    "AC6d3b Retry logout setelah kondisi pulih (sesi valid): sukses -> /login tanpa alert error",
    new URL(page.url()).pathname === "/login" && (await alertTexts()).length === 0 ? "PASS" : "FAIL",
    `final=${new URL(page.url()).pathname}, alerts=${JSON.stringify(await alertTexts())}`,
  );

  // --- AC6e: after the outage, a fresh login + logout succeeds (no alert) ---
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await settle(400);
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await settle(400);
  rec(
    "AC6e Setelah kondisi pulih, login ulang + logout sukses -> /login tanpa alert error",
    new URL(page.url()).pathname === "/login" && (await alertTexts()).length === 0 ? "PASS" : "FAIL",
    `url=${new URL(page.url()).pathname}, alerts=${JSON.stringify(await alertTexts())}`,
    "isolated: gunakan proxy pass setelah kegagalan, bukan mematikan/menyalakan Supabase",
  );

  const consoleHasLeak = consoleTracker.hasLeaks();
  rec(
    "AC6f Console bersih (tanpa token/password)",
    !consoleHasLeak ? "PASS" : "FAIL",
    `consoleIssues=${JSON.stringify(consoleTracker.getIssues(5))}${consoleHasLeak ? ` | LEAK_DETECTED: [${consoleTracker.getLeakCategories().join(", ")}]` : ""}`,
    "pengecualian: 404 favicon (repo tanpa public/favicon)",
  );
} catch (e) {
  lifecycle.recordHarnessError(e);
  await shot("failure-harness-error.png");
} finally {
  const exitInfo = await lifecycle.finalize({ browser });
  exitInfo.executeExit();
}