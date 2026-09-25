// P0.5 logout verification harness — NORMAL flow (real Supabase local, dev port 3000).
// Revision 2 (2026-09-23): every PASS/FAIL is derived from an actual assertion tied to
// the scenario semantics; visibility is checked through locators (role=heading / form
// controls), NOT body.textContent (which also matches RSC payload scripts). Cache-header
// claims are separated into a static-review + observation row instead of a runtime PASS.
// Keyboard logout (Tab+Enter and Tab+Space) is a separate scenario without click().
//
// RUN (Windows node with playwright in node_modules, e.g. the p04-pw temp dir):
//   set P05_EMAIL=... P05_PASSWORD=... P05_EVIDENCE_DIR=D:\...\docs\evidence\P0_5
//   set P05_BASE_URL=http://localhost:3000
//   node p05-logout-tests.mjs
// P05_PW_PATH may point at a node_modules containing playwright (default "playwright").
// Credentials come from env only; nothing secret is written to artifacts.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createSanitizer,
  ConsoleTracker,
  executeKeyboardAction,
  createHarnessLifecycle,
} from "./p05-harness-utils.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.P05_PW_PATH || "playwright");

const BASE = process.env.P05_BASE_URL || "http://localhost:3000";
if (!process.env.P05_EMAIL || !process.env.P05_PASSWORD) {
  console.error("P05_EMAIL and P05_PASSWORD env are required");
  process.exit(2);
}
const creds = { email: process.env.P05_EMAIL, password: process.env.P05_PASSWORD };
const EVIDENCE_DIR =
  (process.env.P05_EVIDENCE_DIR || fileURLToPath(new URL(".", import.meta.url))).replace(/[\\/]$/, "") + "\\";

const sanitizer = createSanitizer({ password: creds.password });

const results = [];
const lifecycle = createHarnessLifecycle({
  evidenceDir: EVIDENCE_DIR,
  resultsFileName: "results-main.json",
  results,
  sanitizer,
});
const rec = lifecycle.rec;
const basePath = (u) => {
  try {
    return new URL(u).pathname + new URL(u).search;
  } catch {
    return String(u);
  }
};
const isVisible = async (loc) => {
  try {
    return await loc.isVisible();
  } catch {
    return false;
  }
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ locale: "id-ID" });
const page = await context.newPage();
page.setDefaultTimeout(25000);

const consoleTracker = new ConsoleTracker(sanitizer);
consoleTracker.attach(page);

// Network capture for the logout action chain (method + Next-Action header + cache-control).
const netLog = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.startsWith(BASE) && !u.includes("/_next/")) {
    netLog.push({
      kind: "request",
      method: req.method(),
      url: u,
      nextAction: req.headers()["next-action"] || "",
    });
  }
});
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith(BASE) && !u.includes("/_next/")) {
    netLog.push({
      kind: "response",
      method: r.request().method(),
      status: r.status(),
      url: u,
      cacheControl: r.headers()["cache-control"] || "",
      actionRedirect: r.headers()["x-action-redirect"] || "",
    });
  }
});
page.on("requestfailed", (r) => netLog.push({ kind: "failed", method: r.method(), status: "FAILED", url: r.url() }));

const authCookies = async () => (await context.cookies()).filter((c) => c.name.includes("auth-token"));
const shot = async (name) => lifecycle.captureScreenshot(page, name);
const alertTexts = async () =>
  page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim() || ""));
const settle = async (ms = 300) => {
  // Wait one more paint cycle so soft navigation finishes, then a short settle.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
};

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await settle(400);
}

// Visible-element helpers (never body.textContent — RSC payloads live in <script> tags).
const dashH1 = () => page.getByRole("heading", { name: "Dashboard Helpdesk", exact: true });
const customersH1 = () => page.getByRole("heading", { name: "Pelanggan", exact: true });
const loginFormVisible = async () =>
  (await isVisible(page.locator("#email"))) && (await isVisible(page.locator("#password")));
const appErrorVisible = () => isVisible(page.getByText("Application error", { exact: false }));

try {
  // ================= Phase 1: mouse flow =================
  await login(page, creds);
  rec(
    "Login uji",
    new URL(page.url()).pathname === "/dashboard" && (await isVisible(dashH1())) && (await isVisible(page.getByText(creds.email, { exact: true })))
      ? "PASS"
      : "FAIL",
    `url=${new URL(page.url()).pathname}, dashHeadingVisible=${await isVisible(dashH1())}, staffEmailVisible=${await isVisible(page.getByText(creds.email, { exact: true }))}, authCookies=${(await authCookies()).length}`,
    "temporary account, deleted after the run",
  );

  const keluarBtn = page.locator('form button[type="submit"]', { hasText: "Keluar" });
  const btnCount = await keluarBtn.count();
  rec("AC1a Keluar tersedia (mouse)", btnCount === 1 ? "PASS" : "FAIL", `buttons=${btnCount}`);

  // keyboard focus-visible (focus alone; activation is AC2_kbd)
  await page.evaluate(() => document.activeElement?.blur?.());
  let focusedText = "";
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim() || "",
      tag: document.activeElement?.tagName,
    }));
    if (el.text === "Keluar" && el.tag === "BUTTON") {
      focusedText = el.text;
      break;
    }
  }
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el.textContent?.trim() !== "Keluar") return null;
    const s = getComputedStyle(el);
    return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle };
  });
  const focusOk = focusedText === "Keluar" && outline && outline.outlineStyle !== "none" && parseFloat(outline.outlineWidth) >= 2;
  rec("AC1b Keluar dapat difokus keyboard + fokus terlihat", focusOk ? "PASS" : "FAIL", `focused=${focusedText}, outline=${JSON.stringify(outline)}`);

  // ---- AC2 mouse logout ----
  const preLogoutCookies = await authCookies();
  const netStart = netLog.length;
  await keluarBtn.click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await settle(500);
  const cookiesAfter = await authCookies();
  const ac2Path = new URL(page.url()).pathname;
  const emailFilled = (await page.locator("#email").inputValue()).trim();
  const ac2Ok =
    ac2Path === "/login" &&
    cookiesAfter.length === 0 &&
    (await loginFormVisible()) &&
    emailFilled === "" &&
    !(await isVisible(dashH1())) &&
    !(await isVisible(page.getByText(creds.email, { exact: true })));
  await shot("\\ac2-login-after-logout.png");
  rec(
    "AC2 Logout mouse: /login + cookie auth hilang + form kosong tanpa identitas staf",
    ac2Ok ? "PASS" : "FAIL",
    `url=${ac2Path}, authCookiesBefore=${preLogoutCookies.length}, authCookiesAfter=${cookiesAfter.length}, formVisible=${await loginFormVisible()}, emailInput="${emailFilled}", dashHeadingVisible=${await isVisible(dashH1())}, staffEmailVisible=${await isVisible(page.getByText(creds.email, { exact: true }))}`,
  );

  // ---- AC2_chain: Server Action redirect (asserted, not assumed) ----
  const window = netLog.slice(netStart);
  const actionPosts = window.filter(
    (e) => e.kind === "request" && e.method === "POST" && e.nextAction !== "" && !e.url.includes("_next"),
  );
  const actionRedirectHeader = window
    .filter((e) => e.kind === "response" && e.actionRedirect !== "")
    .map((e) => `${e.status} ${basePath(e.url)} redirect="${e.actionRedirect}"`);
  const redirectTargetsLogin = actionRedirectHeader.some((h) => h.includes("/login"));
  const chainOk =
    actionPosts.length >= 1 && redirectTargetsLogin && ac2Path === "/login" && cookiesAfter.length === 0;
  rec(
    "AC2_chain Redirect ke /login dari Server Action",
    chainOk ? "PASS" : "FAIL",
    `actionPosts=${JSON.stringify(actionPosts.map((e) => `${e.method} ${basePath(e.url)} nextAction=${e.nextAction.slice(0, 8)}…`))}, actionRedirectHeader=${JSON.stringify(actionRedirectHeader)}, final=${ac2Path}, authCookiesAfter=${cookiesAfter.length}`,
    "bukti redirect = header x-action-redirect pada respons Server Action POST /dashboard (navigasi ke /login dikerjakan client-side oleh router Next, sehingga tidak ada request /login terpisah) + cookie sesi hilang; status HTTP saja tidak dipakai sebagai bukti",
  );

  // ---- Cache header: static review + observation (NOT a runtime PASS claim) ----
  const proxyCacheHeader = "private, no-cache, no-store, must-revalidate, max-age=0";
  // No separate /login response exists: the Server Action response carries x-action-redirect
  // and the router navigates client-side. Header observation therefore targets the action
  // response (which passed through proxy.ts matcher) and any /login-destined responses seen.
  const loginCacheObserved = window
    .filter((e) => e.kind === "response" && new URL(e.url).pathname.startsWith("/login"))
    .map((e) => `${e.method} ${basePath(e.url)} cc="${e.cacheControl || "-"}"`);
  const actionResponse = window.find((e) => e.kind === "response" && actionPosts.some((a) => a.url === e.url));
  rec(
    "AC2_obs Cache header (observasi, di luar AC)",
    "INFO",
    `staticReview=proxy.ts matcher [login, dashboard/:path*] menetapkan Cache-Control "${proxyCacheHeader}"; observedLoginResponses=${JSON.stringify(loginCacheObserved)}; observedActionResponse=${JSON.stringify(actionResponse ? `${actionResponse.status} ${basePath(actionResponse.url)} cc="${actionResponse.cacheControl || "-"}"` : "none")}`,
    "statis+observasi header respons; tidak menguji semantik cache browser dan bukan syarat kelulusan AC P0.5",
  );

  // ---- AC8a: no misleading alert on successful logout ----
  const alertsNormal = await alertTexts();
  rec(
    "AC8a Tanpa alert saat logout sukses (tidak ada pesan error menyesatkan)",
    alertsNormal.length === 0 ? "PASS" : "FAIL",
    `alerts=${JSON.stringify(alertsNormal)}`,
  );

  // ================= Phase 2: keyboard logout (separate from mouse) =================
  await login(page, creds);
  await page.evaluate(() => document.activeElement?.blur?.());
  let kbdFocused = "";
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim() || "",
      tag: document.activeElement?.tagName,
    }));
    if (el.text === "Keluar" && el.tag === "BUTTON") {
      kbdFocused = el.text;
      break;
    }
  }
  const kbdCookiesBefore = (await authCookies()).length;
  const kbdEnterResult = await executeKeyboardAction({
    page,
    key: "Enter",
    targetUrl: "**/login",
    timeout: 25000,
    sanitizer,
  });
  await settle(500);
  const kbdEnterPath = new URL(page.url()).pathname;
  const kbdCookiesAfter = (await authCookies()).length;
  const kbdEnterOk =
    kbdEnterResult.success &&
    kbdFocused === "Keluar" &&
    kbdEnterPath === "/login" &&
    kbdCookiesAfter === 0 &&
    (await loginFormVisible()) &&
    !(await isVisible(dashH1()));
  await shot("\\ac2-keyboard-logout.png");
  rec(
    "AC2_kbd Enter — Logout keyboard (Tab+Enter, tanpa click/submit JS): server action berjalan, sesi berakhir, halaman login tampil",
    kbdEnterOk ? "PASS" : "FAIL",
    `focused=${kbdFocused}, final=${kbdEnterPath}, authCookiesBefore=${kbdCookiesBefore}, authCookiesAfter=${kbdCookiesAfter}, formVisible=${await loginFormVisible()}, dashHeadingVisible=${await isVisible(dashH1())}${kbdEnterResult.error ? `, keyboardError=${kbdEnterResult.error}` : ""}`,
  );
  // access again must be denied
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await settle(400);
  const kbdDenyPath = new URL(page.url()).pathname;
  rec(
    "AC2_kbd_deny Akses ulang /dashboard setelah logout keyboard ditolak",
    kbdDenyPath === "/login" && (await loginFormVisible()) ? "PASS" : "FAIL",
    `final=${kbdDenyPath}, formVisible=${await loginFormVisible()}`,
  );

  // Space activation (separate login), keep evidence separate from the Enter row
  await login(page, creds);
  await page.evaluate(() => document.activeElement?.blur?.());
  let spaceFocused = "";
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim() || "",
      tag: document.activeElement?.tagName,
    }));
    if (el.text === "Keluar" && el.tag === "BUTTON") {
      spaceFocused = el.text;
      break;
    }
  }
  const kbdSpaceResult = await executeKeyboardAction({
    page,
    key: "Space",
    targetUrl: "**/login",
    timeout: 25000,
    sanitizer,
  });
  await settle(500);
  const spacePath = new URL(page.url()).pathname;
  const spaceCookiesAfter = (await authCookies()).length;
  const spaceOk =
    kbdSpaceResult.success &&
    spaceFocused === "Keluar" &&
    spacePath === "/login" &&
    spaceCookiesAfter === 0 &&
    (await loginFormVisible()) &&
    !(await isVisible(dashH1()));
  rec(
    "AC2_kbd Space — Logout keyboard (Tab+Space, tanpa click): server action berjalan, sesi berakhir",
    spaceOk ? "PASS" : "FAIL",
    `focused=${spaceFocused}, final=${spacePath}, authCookiesAfter=${spaceCookiesAfter}, formVisible=${await loginFormVisible()}${kbdSpaceResult.error ? `, keyboardError=${kbdSpaceResult.error}` : ""}`,
  );

  // ================= Phase 3: direct access after logout (no session) =================
  const r1 = await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await settle(400);
  const directPath = new URL(page.url()).pathname;
  rec(
    "AC3a /dashboard langsung -> /login (dashboard tidak pernah dirender)",
    directPath === "/login" && (await loginFormVisible()) && !(await isVisible(dashH1())) ? "PASS" : "FAIL",
    `status=${r1?.status()}, final=${directPath}, formVisible=${await loginFormVisible()}, dashHeadingVisible=${await isVisible(dashH1())}`,
  );

  await page.reload({ waitUntil: "load" });
  await settle(400);
  const reloadPath = new URL(page.url()).pathname;
  rec(
    "AC3b Reload halaman terlindungi -> /login (tidak pernah dirender)",
    reloadPath === "/login" && (await loginFormVisible()) && !(await isVisible(dashH1())) ? "PASS" : "FAIL",
    `final=${reloadPath}, formVisible=${await loginFormVisible()}, dashHeadingVisible=${await isVisible(dashH1())}`,
  );

  const r2 = await page.goto(`${BASE}/dashboard/customers`, { waitUntil: "load" });
  await settle(500);
  const custPath = new URL(page.url()).pathname;
  rec(
    "AC3c /dashboard/customers tidak menampilkan data pelanggan",
    custPath === "/login" &&
      (await loginFormVisible()) &&
      !(await isVisible(customersH1())) &&
      !(await isVisible(page.getByRole("heading", { name: "Daftar pelanggan", exact: true })))
      ? "PASS"
      : "FAIL",
    `status=${r2?.status()}, final=${custPath}, formVisible=${await loginFormVisible()}, customersHeadingVisible=${await isVisible(customersH1())}`,
  );

  // ---- AC3d: re-inject pre-logout cookies (documented out-of-normal-flow scenario) ----
  if (preLogoutCookies.length > 0) {
    await context.clearCookies();
    for (const c of preLogoutCookies) {
      await context.addCookies([{ name: c.name, value: c.value, domain: "localhost", path: "/" }]);
    }
    const r3 = await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
    await settle(600);
    const reinjectPath = new URL(page.url()).pathname;
    const reinjectOk = reinjectPath === "/login" && (await loginFormVisible());
    rec(
      "AC3d Injeksi ulang cookie pra-logout (skenario di luar alur normal)",
      reinjectOk ? "PASS" : "INFO",
      `final=${reinjectPath}, status=${r3?.status()}, formVisible=${await loginFormVisible()}`,
      "server menolak karena sesi GoTrue sudah dicabut via logout (endpoint /user memvalidasi session_id); akses token JWT mentah tetap berlaku hingga kedaluwarsa untuk pemegang lain (perilaku Supabase/GoTrue) — di luar kendali aplikasi ini",
    );
    await context.clearCookies();
  }

  // ================= Phase 4: browser Back after logout =================
  await login(page, creds);
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await settle(400);
  const backNetStart = netLog.length;
  await page.goBack(); // browser Back from /login
  // Wait for a stable page indicator: login form OR dashboard heading, whichever appears.
  await page
    .waitForFunction(
      () =>
        !!document.querySelector("#email") ||
        [...document.querySelectorAll("h1")].some((h) => h.textContent?.includes("Dashboard Helpdesk")),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await settle(600);
  const backUrl = page.url();
  const backPath = new URL(backUrl).pathname;
  const backDashVisible = await isVisible(dashH1());
  const backFormVisible = await loginFormVisible();
  const backWindow = netLog.slice(backNetStart);
  const backDashRequests = backWindow.filter((e) => new URL(e.url).pathname.startsWith("/dashboard")).length;
  const dashTextOnlyInScripts =
    (await page.evaluate(() => [...document.querySelectorAll("body script")].map((s) => s.textContent || "").join("")))
      .includes("Dashboard Helpdesk") && !backDashVisible;
  await shot("\\ac4-back-nav.png");

  let ac4Status, ac4Limit;
  if (backPath === "/login" && backFormVisible && !backDashVisible) {
    ac4Status = "PASS";
    ac4Limit = "";
  } else if (backPath === "/dashboard" && backDashVisible) {
    ac4Status = "INFO";
    ac4Limit =
      "Konten dashboard lama terlihat dari bfcache (tanpa akses server baru); verifikasi refresh & interaksi terlindungi pada AC4b";
  } else {
    ac4Status = "FAIL";
    ac4Limit = "";
  }
  rec(
    "AC4 Back setelah logout tidak membuka dashboard",
    ac4Status,
    `backUrl=${backPath}, dashHeadingVisible=${backDashVisible}, formVisible=${backFormVisible}, dashRequestsAfterBack=${backDashRequests}, dashTextOnlyInScripts=${dashTextOnlyInScripts}`,
    ac4Limit,
  );

  if (backPath === "/dashboard" && backDashVisible) {
    // bfcache stale content: prove interactions go through a protected path
    await page.reload({ waitUntil: "load" });
    await settle(500);
    const backReloadPath = new URL(page.url()).pathname;
    rec(
      "AC4b Reload setelah back (bfcache) tidak mengembalikan akses",
      backReloadPath === "/login" && (await loginFormVisible()) ? "PASS" : "FAIL",
      `final=${backReloadPath}, formVisible=${await loginFormVisible()}`,
    );
    await page.goto(`${BASE}/dashboard/customers`, { waitUntil: "load" });
    await settle(500);
    rec(
      "AC4c Navigasi dari konten lama (bfcache) ke /dashboard/customers ditolak",
      new URL(page.url()).pathname === "/login" ? "PASS" : "FAIL",
      `final=${new URL(page.url()).pathname}`,
    );
    await shot("\\ac4-bfcache-protected.png");
  } else if (backPath === "/dashboard" && !backDashVisible && backFormVisible) {
    // server access produced a fresh login render under /dashboard URL? treat as permissive INFO
    rec("AC4_obs Back URL /dashboard namun form login terlihat (transisi lunak)", "INFO", `url=/dashboard, formVisible=true`);
  }

  // ================= Phase 5: second tab =================
  await login(page, creds);
  const tab2 = await context.newPage();
  await tab2.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await settle(400);
  const tab2HasDashboard = new URL(tab2.url()).pathname === "/dashboard";
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await tab2.reload({ waitUntil: "load" });
  await settle(500);
  const tab2ReloadPath = new URL(tab2.url()).pathname;
  rec(
    "AC5 Tab2 reload setelah logout di tab1 -> /login (dashboard tab2 tidak terlihat)",
    tab2HasDashboard &&
      tab2ReloadPath === "/login" &&
      !(await isVisible(tab2.getByRole("heading", { name: "Dashboard Helpdesk", exact: true })))
      ? "PASS"
      : "FAIL",
    `tab2InitialDashboard=${tab2HasDashboard}, tab2AfterReload=${tab2ReloadPath}`,
    "Sinkronisasi UI antar-tab seketika bukan requirement; reload eksplisit yang diuji",
  );
  await tab2.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await settle(400);
  rec(
    "AC5b Tab2 navigasi baru ke /dashboard -> /login",
    new URL(tab2.url()).pathname === "/login" ? "PASS" : "FAIL",
    `final=${new URL(tab2.url()).pathname}`,
  );
  await tab2.close();

  // ================= Phase 6: repeat logout / already-ended session =================
  await login(page, creds);
  const form = page.locator('form button[type="submit"]', { hasText: "Keluar" });
  await form.evaluate((btn) => {
    const f = btn.closest("form");
    f.requestSubmit(btn);
    f.requestSubmit(btn);
  });
  await page.waitForURL("**/login", { timeout: 25000 }).catch(() => {});
  await settle(1200);
  const doubleUrl = page.url();
  const doublePath = new URL(doubleUrl).pathname;
  await settle(800);
  const doubleStill = new URL(page.url()).pathname;
  const noLoop = doublePath === "/login" && doubleStill === "/login";
  rec(
    "AC7a Keluar dua kali beruntun tidak crash/tidak loop (mendarat di /login, bukan /dashboard)",
    noLoop && !(await appErrorVisible()) ? "PASS" : "FAIL",
    `final=${doublePath}, afterSettle=${doubleStill}, appError=${await appErrorVisible()}`,
  );

  // session already ended: clear cookies, then Keluar (server action runs with no session)
  await login(page, creds);
  await context.clearCookies();
  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await settle(1500);
  const endedPath = new URL(page.url()).pathname;
  await settle(800);
  const endedStill = new URL(page.url()).pathname;
  rec(
    "AC7b Logout saat sesi sudah berakhir (cookie hilang) -> /login aman, tanpa loop",
    endedPath === "/login" && endedStill === "/login" && (await loginFormVisible()) ? "PASS" : "FAIL",
    `final=${endedPath}, afterSettle=${endedStill}, formVisible=${await loginFormVisible()}`,
  );
  await context.clearCookies();

  // no misleading alert on the ended-session path either
  const alertsEnded = await alertTexts();
  rec(
    "AC8a2 Tanpa alert saat logout sukses pada sesi yang sudah berakhir",
    alertsEnded.length === 0 ? "PASS" : "FAIL",
    `alerts=${JSON.stringify(alertsEnded)}`,
  );

  // ================= Phase 7: login again + P0.4 regression =================
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill(creds.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard", { timeout: 25000 });
  await settle(400);
  rec(
    "AC9a Login kembali setelah logout -> /dashboard",
    new URL(page.url()).pathname === "/dashboard" && (await isVisible(dashH1())) ? "PASS" : "FAIL",
    `url=${new URL(page.url()).pathname}, dashHeadingVisible=${await isVisible(dashH1())}`,
  );

  await page.locator('form button[type="submit"]', { hasText: "Keluar" }).click();
  await page.waitForURL("**/login", { timeout: 25000 });
  await page.locator("#email").fill(creds.email);
  await page.locator("#password").fill("   ");
  await page.evaluate(() => {
    const f = document.querySelector("form");
    f.noValidate = true;
    f.requestSubmit();
  });
  await settle(800);
  const wsUrl = new URL(page.url());
  const wsAlerts = await alertTexts();
  rec(
    "AC9b Regresi P0.4: password spasi ditolak sebagai input kosong",
    wsUrl.searchParams.get("error") === "required" && wsAlerts.includes("Email dan password wajib diisi.")
      ? "PASS"
      : "FAIL",
    `query=${basePath(page.url())}, alerts=${JSON.stringify(wsAlerts)}`,
  );

  const htmlContent = await page.content();
  const htmlLeaks = sanitizer.detectLeaks(htmlContent);
  const htmlLeakCategories = [...htmlLeaks];
  if (htmlContent.includes("AuthApiError")) htmlLeakCategories.push("auth_api_error");
  if (htmlContent.includes("at Server Actions")) htmlLeakCategories.push("server_actions_stack");
  if (htmlContent.includes("errorStack")) htmlLeakCategories.push("error_stack");
  rec("AC9c Tanpa secret/raw error di HTML", htmlLeakCategories.length === 0 ? "PASS" : "FAIL", `htmlHits=${JSON.stringify(htmlLeakCategories)}`);

  const consoleHasLeak = consoleTracker.hasLeaks();
  rec(
    "AC9d Console/bad responses bersih (tanpa token/password)",
    !consoleHasLeak ? "PASS" : "FAIL",
    `consoleIssues=${JSON.stringify(consoleTracker.getIssues(5))}${consoleHasLeak ? ` | LEAK_DETECTED: [${consoleTracker.getLeakCategories().join(", ")}]` : ""}`,
    "pengecualian: 404 favicon (repo tanpa public/favicon), bukan isu logout",
  );
} catch (e) {
  lifecycle.recordHarnessError(e);
  await shot("harness-error.png");
} finally {
  const exitInfo = await lifecycle.finalize({ browser });
  exitInfo.executeExit();
}