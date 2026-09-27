import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\Users\\INVANSION\\AppData\\Local\\Temp\\chrome_dev_p011_interactive";
const PORT = 9226;

// Kredensial dibaca secara aman dari environment variable
const TEST_STAFF_EMAIL = process.env.TEST_STAFF_EMAIL;
const TEST_STAFF_PASSWORD = process.env.TEST_STAFF_PASSWORD;

// Mode verifikasi fail-mode terarah untuk membuktikan exit code nonzero saat kegagalan
const IS_FAIL_MODE_TEST = process.argv.includes("--test-fail-mode");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWebSocketDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const json = await res.json();
        return json.webSocketDebuggerUrl;
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
        }
      };
    });
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

async function run() {
  console.log("=== P0.11 INTERACTIVE VERIFICATION RUNNER ===");
  if (IS_FAIL_MODE_TEST) {
    console.log(">> MODE: Fail-mode verification enabled (--test-fail-mode)");
  }

  const results = {
    timestamp: new Date().toISOString(),
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      notRun: 0,
    },
    assertions: [],
  };

  function recordAssertion({ id, name, expected, actual, pass, notRunReason }) {
    results.summary.total++;
    if (notRunReason) {
      results.summary.notRun++;
      results.assertions.push({
        id,
        name,
        status: "NOT_RUN",
        reason: notRunReason,
      });
      console.log(`[-] NOT_RUN: ${name} (${notRunReason})`);
      return;
    }

    if (pass) {
      results.summary.passed++;
      results.assertions.push({
        id,
        name,
        status: "PASS",
        expected,
        actual,
      });
      console.log(`[✓] PASS: ${name}`);
    } else {
      results.summary.failed++;
      results.assertions.push({
        id,
        name,
        status: "FAIL",
        expected,
        actual,
      });
      console.error(`[✗] FAIL: ${name}\n    Expected: ${JSON.stringify(expected)}\n    Actual:   ${JSON.stringify(actual)}`);
    }
  }

  const evidenceDir = path.resolve("docs/evidence/P0_11");
  fs.mkdirSync(evidenceDir, { recursive: true });

  let chromeProc = null;
  let cdp = null;

  try {
    chromeProc = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--window-size=1440,900",
      ],
      { stdio: "ignore" }
    );

    const browserWsUrl = await getWebSocketDebuggerUrl();
    const createTargetRes = await fetch(`http://127.0.0.1:${PORT}/json/new?http://localhost:3000/login`, {
      method: "PUT",
    });
    const targetInfo = await createTargetRes.json();
    const pageWsUrl = targetInfo.webSocketDebuggerUrl;

    cdp = new CDPClient(pageWsUrl);
    await cdp.connect();

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // ------------------------------------------------------------------------
    // SETUP: Autentikasi Pengujian (Aman, Tanpa Hardcoded Secret)
    // ------------------------------------------------------------------------
    let isAuthenticated = false;

    if (!TEST_STAFF_EMAIL || !TEST_STAFF_PASSWORD) {
      console.warn("\n[Prasyarat Kredensial] TEST_STAFF_EMAIL atau TEST_STAFF_PASSWORD tidak diset pada environment.");
      console.warn("Skenario autentikasi akan ditandai NOT_RUN.");
    } else {
      console.log("\n[Setup] Mencoba autentikasi menggunakan email uji yang dikonfigurasi...");
      await cdp.send("Page.navigate", { url: "http://localhost:3000/login" });
      await delay(1200);

      // Isi form login menggunakan evaluasi runtime tanpa mengekspos isi rahasia ke log
      await cdp.send("Runtime.evaluate", {
        expression: `((email, pass) => {
          const emailInput = document.querySelector('input[type="email"]');
          const passInput = document.querySelector('input[type="password"]');
          if (!emailInput || !passInput) return false;
          emailInput.value = email;
          passInput.value = pass;
          const submitBtn = document.querySelector('button[type="submit"]');
          if (submitBtn && submitBtn.form) {
            submitBtn.form.requestSubmit();
          } else if (submitBtn) {
            submitBtn.click();
          }
          return true;
        })(${JSON.stringify(TEST_STAFF_EMAIL)}, ${JSON.stringify(TEST_STAFF_PASSWORD)})`,
      });
      await delay(2500);

      const postLoginUrlRes = await cdp.send("Runtime.evaluate", { expression: "window.location.pathname" });
      const currentPath = postLoginUrlRes.result.value;
      if (currentPath && currentPath.startsWith("/dashboard")) {
        isAuthenticated = true;
        console.log("[Setup] Autentikasi berhasil. Sesi aktif pada rute:", currentPath);
      } else {
        console.warn("[Setup] Autentikasi gagal atau dialihkan ke:", currentPath);
      }
    }

    // ========================================================================
    // 1. TOOLTIP SIDEBAR RINGKAS (1024-1439px, misal 1280x800)
    // ========================================================================
    console.log("\n--- [1] Pengujian Tooltip Sidebar Ringkas (1280x800) ---");
    if (!isAuthenticated) {
      recordAssertion({
        id: "compact_sidebar_tooltip_hover",
        name: "Tooltip Sidebar Ringkas tampil saat hover mouse",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "compact_sidebar_tooltip_keyboard_tab",
        name: "Tooltip Sidebar Ringkas tampil saat fokus keyboard via Tab",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "compact_sidebar_no_horizontal_overflow",
        name: "Sidebar Ringkas bebas dari horizontal overflow",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
    } else {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard" });
      await delay(1200);

      // 1.1 Tooltip saat Hover Mouse
      const linkPos = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const link = document.querySelector('a[href="/dashboard/customers"].sidebar-compact-only');
          if (!link) return null;
          const rect = link.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
        returnByValue: true,
      });

      if (linkPos.result.value) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: linkPos.result.value.x,
          y: linkPos.result.value.y,
        });
        await delay(400);
      }

      const hoverRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const tooltip = document.querySelector('[role="tooltip"]');
          const sidebar = document.querySelector('aside[aria-label="Sidebar utama"]');
          const nav = document.querySelector('nav[aria-label="Navigasi utama"]');
          if (!tooltip || !sidebar || !nav) {
            return { found: false };
          }
          const rect = tooltip.getBoundingClientRect();
          const sidebarRect = sidebar.getBoundingClientRect();
          const isOutsideNavScroll = !nav.contains(tooltip);
          const isRightOfSidebar = rect.left >= sidebarRect.right - 2;
          const notClippedByViewport = rect.right <= window.innerWidth;

          return {
            found: true,
            text: tooltip.textContent.trim(),
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            sidebarRight: Math.round(sidebarRect.right),
            isOutsideNavScroll,
            isRightOfSidebar,
            notClippedByViewport,
          };
        })()`,
        returnByValue: true,
      });

      const hoverData = hoverRes.result.value || {};
      const hoverPass = Boolean(
        hoverData.found &&
        hoverData.text === "Pelanggan" &&
        hoverData.isOutsideNavScroll === true &&
        hoverData.isRightOfSidebar === true &&
        hoverData.notClippedByViewport === true
      );

      recordAssertion({
        id: "compact_sidebar_tooltip_hover",
        name: "Tooltip Sidebar Ringkas tampil utuh di luar area scroll saat hover mouse",
        expected: { found: true, text: "Pelanggan", isOutsideNavScroll: true, notClippedByViewport: true },
        actual: hoverData,
        pass: hoverPass,
      });

      // Tangkapan layar hover
      const hoverScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(evidenceDir, "compact_sidebar_tooltip_hover.png"),
        Buffer.from(hoverScreenshot.data, "base64")
      );

      // 1.2 Tooltip saat Fokus Keyboard melalui Input Tab Browser
      console.log("  Menghapus status hover dan menavigasi fokus keyboard menggunakan tombol Tab...");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      await delay(200);

      // Reset fokus ke body
      await cdp.send("Runtime.evaluate", {
        expression: `document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.focus();`,
      });
      await delay(200);

      // Navigasi menggunakan input keyboard Tab native browser
      let isTargetFocused = false;
      for (let i = 0; i < 6; i++) {
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          windowsVirtualKeyCode: 9,
          key: "Tab",
          code: "Tab",
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          windowsVirtualKeyCode: 9,
          key: "Tab",
          code: "Tab",
        });
        await delay(200);

        const checkFocus = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const link = document.querySelector('a[href="/dashboard/customers"].sidebar-compact-only');
            return document.activeElement === link;
          })()`,
          returnByValue: true,
        });

        if (checkFocus.result.value) {
          isTargetFocused = true;
          break;
        }
      }

      const focusRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const tooltip = document.querySelector('[role="tooltip"]');
          const nav = document.querySelector('nav[aria-label="Navigasi utama"]');
          const link = document.querySelector('a[href="/dashboard/customers"].sidebar-compact-only');
          if (!tooltip || !nav || !link) return { found: false, isFocused: document.activeElement === link };

          const rect = tooltip.getBoundingClientRect();
          const isOutsideNavScroll = !nav.contains(tooltip);
          const notClippedByViewport = rect.right <= window.innerWidth;

          return {
            found: true,
            text: tooltip.textContent.trim(),
            isFocused: document.activeElement === link,
            isOutsideNavScroll,
            notClippedByViewport,
            left: Math.round(rect.left),
            top: Math.round(rect.top),
          };
        })()`,
        returnByValue: true,
      });

      const focusData = focusRes.result.value || {};
      const focusPass = Boolean(
        isTargetFocused &&
        focusData.found &&
        focusData.text === "Pelanggan" &&
        focusData.isFocused === true &&
        focusData.isOutsideNavScroll === true &&
        focusData.notClippedByViewport === true
      );

      recordAssertion({
        id: "compact_sidebar_tooltip_keyboard_tab",
        name: "Tooltip Sidebar Ringkas tampil utuh saat fokus keyboard via Tab native",
        expected: { isFocused: true, found: true, text: "Pelanggan", isOutsideNavScroll: true, notClippedByViewport: true },
        actual: focusData,
        pass: focusPass,
      });

      // Tangkapan layar fokus keyboard
      const focusScreenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(evidenceDir, "compact_sidebar_tooltip_focus.png"),
        Buffer.from(focusScreenshot.data, "base64")
      );

      // 1.3 Pemeriksaan Horizontal Overflow
      const overflowRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const sidebar = document.querySelector('aside[aria-label="Sidebar utama"]');
          const nav = document.querySelector('nav[aria-label="Navigasi utama"]');
          const sidebarScroll = sidebar ? sidebar.scrollWidth : 0;
          const sidebarClient = sidebar ? sidebar.clientWidth : 0;
          const navScroll = nav ? nav.scrollWidth : 0;
          const navClient = nav ? nav.clientWidth : 0;
          const pageOverflowX = document.documentElement.scrollWidth > window.innerWidth;

          return {
            sidebarScrollWidth: Math.round(sidebarScroll),
            sidebarClientWidth: Math.round(sidebarClient),
            hasSidebarHorizontalOverflow: sidebarScroll > sidebarClient,
            navScrollWidth: Math.round(navScroll),
            navClientWidth: Math.round(navClient),
            hasNavHorizontalOverflow: navScroll > navClient,
            pageOverflowX,
          };
        })()`,
        returnByValue: true,
      });

      const overflowData = overflowRes.result.value || {};
      const overflowPass = Boolean(
        overflowData.hasSidebarHorizontalOverflow === false &&
        overflowData.hasNavHorizontalOverflow === false &&
        overflowData.pageOverflowX === false
      );

      recordAssertion({
        id: "compact_sidebar_no_horizontal_overflow",
        name: "Sidebar Ringkas bebas dari horizontal overflow",
        expected: { hasSidebarHorizontalOverflow: false, hasNavHorizontalOverflow: false, pageOverflowX: false },
        actual: overflowData,
        pass: overflowPass,
      });
    }

    // ========================================================================
    // 2. SIKLUS DAN AKSESIBILITAS DRAWER MODAL (<1024px, misal 375x667 DPR 2)
    // ========================================================================
    console.log("\n--- [2] Pengujian Interaktif Drawer Modal Mobile (375x667) ---");
    if (!isAuthenticated) {
      recordAssertion({
        id: "drawer_tab_cycle_last_to_first",
        name: "Tab dari elemen terakhir drawer berputar kembali ke elemen pertama",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "drawer_shift_tab_cycle_first_to_last",
        name: "Shift+Tab dari elemen pertama drawer berputar kembali ke elemen terakhir",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "drawer_escape_key_restores_focus",
        name: "Escape menutup drawer dan mengembalikan fokus ke tombol pemicu hamburger",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "drawer_resize_cleanup",
        name: "Resize dari drawer terbuka ke desktop membersihkan scroll lock dan menutup drawer",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
    } else {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 667,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard" });
      await delay(1200);

      // Buka drawer modal
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('button[aria-label="Buka menu navigasi"]').click();`,
      });
      await delay(500);

      // 2.1 Tab cycle: elemen terakhir -> elemen pertama
      const setupLastElRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const drawer = document.querySelector('#dashboard-drawer');
          if (!drawer) return null;
          const focusables = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          if (focusables.length === 0) return null;
          focusables[focusables.length - 1].focus();
          return {
            totalFocusables: focusables.length,
            isLastFocused: document.activeElement === focusables[focusables.length - 1],
          };
        })()`,
        returnByValue: true,
      });

      // Dispatch native Tab
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        windowsVirtualKeyCode: 9,
        key: "Tab",
        code: "Tab",
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        windowsVirtualKeyCode: 9,
        key: "Tab",
        code: "Tab",
      });
      await delay(200);

      const tabCycleCheck = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const drawer = document.querySelector('#dashboard-drawer');
          if (!drawer) return { error: "No drawer" };
          const focusables = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          const firstEl = focusables[0];
          return {
            firstElementFocusedAfterTab: document.activeElement === firstEl,
          };
        })()`,
        returnByValue: true,
      });

      const tabCyclePass = Boolean(
        setupLastElRes.result.value &&
        setupLastElRes.result.value.isLastFocused &&
        tabCycleCheck.result.value &&
        tabCycleCheck.result.value.firstElementFocusedAfterTab === true
      );

      recordAssertion({
        id: "drawer_tab_cycle_last_to_first",
        name: "Tab dari elemen terakhir drawer berputar kembali ke elemen pertama via keyboard native",
        expected: { firstElementFocusedAfterTab: true },
        actual: tabCycleCheck.result.value,
        pass: tabCyclePass,
      });

      // 2.2 Shift+Tab cycle: elemen pertama -> elemen terakhir
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const drawer = document.querySelector('#dashboard-drawer');
          if (!drawer) return;
          const focusables = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          focusables[0].focus();
        })()`,
      });
      await delay(200);

      // Dispatch native Shift+Tab (modifiers: 8 for Shift)
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        windowsVirtualKeyCode: 9,
        key: "Tab",
        code: "Tab",
        modifiers: 8,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        windowsVirtualKeyCode: 9,
        key: "Tab",
        code: "Tab",
        modifiers: 8,
      });
      await delay(200);

      const shiftTabCycleCheck = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const drawer = document.querySelector('#dashboard-drawer');
          if (!drawer) return { error: "No drawer" };
          const focusables = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          const lastEl = focusables[focusables.length - 1];
          return {
            lastElementFocusedAfterShiftTab: document.activeElement === lastEl,
          };
        })()`,
        returnByValue: true,
      });

      const shiftTabPass = Boolean(
        shiftTabCycleCheck.result.value &&
        shiftTabCycleCheck.result.value.lastElementFocusedAfterShiftTab === true
      );

      recordAssertion({
        id: "drawer_shift_tab_cycle_first_to_last",
        name: "Shift+Tab dari elemen pertama drawer berputar kembali ke elemen terakhir via keyboard native",
        expected: { lastElementFocusedAfterShiftTab: true },
        actual: shiftTabCycleCheck.result.value,
        pass: shiftTabPass,
      });

      // 2.3 Escape key closes drawer and restores focus
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        windowsVirtualKeyCode: 27,
        key: "Escape",
        code: "Escape",
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        windowsVirtualKeyCode: 27,
        key: "Escape",
        code: "Escape",
      });
      await delay(400);

      const escapeCheck = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const trigger = document.querySelector('button[aria-label="Buka menu navigasi"]');
          const drawer = document.querySelector('#dashboard-drawer');
          return {
            drawerRemoved: drawer === null,
            isTriggerFocused: document.activeElement === trigger,
            bodyOverflowRestored: document.body.style.overflow === '',
          };
        })()`,
        returnByValue: true,
      });

      const escapeData = escapeCheck.result.value || {};
      const escapePass = Boolean(
        escapeData.drawerRemoved === true &&
        escapeData.isTriggerFocused === true &&
        escapeData.bodyOverflowRestored === true
      );

      recordAssertion({
        id: "drawer_escape_key_restores_focus",
        name: "Escape menutup drawer, mengembalikan fokus ke pemicu hamburger, dan memulihkan scroll body",
        expected: { drawerRemoved: true, isTriggerFocused: true, bodyOverflowRestored: true },
        actual: escapeData,
        pass: escapePass,
      });

      // 2.4 Resize from mobile open drawer to desktop
      await cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('button[aria-label="Buka menu navigasi"]').click();`,
      });
      await delay(400);

      const beforeResize = await cdp.send("Runtime.evaluate", {
        expression: `({ isDrawerOpen: Boolean(document.querySelector('#dashboard-drawer')), bodyOverflow: document.body.style.overflow })`,
        returnByValue: true,
      });

      // Resize to 1280px
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Runtime.evaluate", {
        expression: `window.dispatchEvent(new Event('resize'));`,
      });
      await delay(400);

      const afterResize = await cdp.send("Runtime.evaluate", {
        expression: `({
          innerWidth: window.innerWidth,
          isDrawerOpen: Boolean(document.querySelector('#dashboard-drawer')),
          bodyOverflow: document.body.style.overflow,
        })`,
        returnByValue: true,
      });

      const resizeData = { before: beforeResize.result.value, after: afterResize.result.value };
      const resizePass = Boolean(
        resizeData.before.isDrawerOpen === true &&
        resizeData.after.isDrawerOpen === false &&
        resizeData.after.bodyOverflow === ""
      );

      recordAssertion({
        id: "drawer_resize_cleanup",
        name: "Resize dari drawer terbuka ke desktop (1280px) menutup drawer dan membersihkan scroll lock",
        expected: { afterIsDrawerOpen: false, afterBodyOverflow: "" },
        actual: { afterIsDrawerOpen: resizeData.after.isDrawerOpen, afterBodyOverflow: resizeData.after.bodyOverflow },
        pass: resizePass,
      });
    }

    // ========================================================================
    // 3. PENGUKURAN KONTROL & PEMBEDAAN POINTER MATCHMEDIA
    // ========================================================================
    console.log("\n--- [3] Pengukuran Tinggi Kontrol & MatchMedia Pointer ---");
    if (!isAuthenticated) {
      recordAssertion({
        id: "narrow_viewport_control_heights",
        name: "Kontrol viewport sempit (<640px) memenuhi batas minimum sentuh 44px",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "desktop_control_heights",
        name: "Kontrol desktop pointer fine memenuhi batas minimum 40px",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
      recordAssertion({
        id: "pointer_coarse_hardware_test",
        name: "Pengujian hardware pointer: coarse",
        notRunReason: "Perangkat uji tidak mengemulasikan hardware layar sentuh fisik",
      });
    } else {
      // 3.1 Viewport Sempit (<640px / 375x667 DPR 2)
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 375,
        height: 667,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard" });
      await delay(1200);

      const narrowMetrics = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const hamburgerBtn = document.querySelector('button[aria-label="Buka menu navigasi"]');
          // Selector tombol aksi di main content (bukan tautan sidebar)
          const custActionBtn = document.querySelector('#main-content a[href="/dashboard/customers"]');
          const logoutBtn = document.querySelector('form button[type="submit"]');

          const isPointerCoarse = window.matchMedia('(pointer: coarse)').matches;
          const isPointerFine = window.matchMedia('(pointer: fine)').matches;

          return {
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
            matchMediaCoarse: isPointerCoarse,
            matchMediaFine: isPointerFine,
            pointerType: isPointerCoarse ? 'coarse' : isPointerFine ? 'fine' : 'none',
            hamburgerHeight: hamburgerBtn ? Math.round(hamburgerBtn.getBoundingClientRect().height) : 0,
            customerActionBtnHeight: custActionBtn ? Math.round(custActionBtn.getBoundingClientRect().height) : 0,
            logoutBtnHeight: logoutBtn ? Math.round(logoutBtn.getBoundingClientRect().height) : 0,
          };
        })()`,
        returnByValue: true,
      });

      const narrowData = narrowMetrics.result.value || {};
      const narrowPass = Boolean(
        narrowData.hamburgerHeight >= 44 &&
        narrowData.customerActionBtnHeight >= 44 &&
        narrowData.logoutBtnHeight >= 44
      );

      recordAssertion({
        id: "narrow_viewport_control_heights",
        name: "Kontrol viewport sempit (<640px) memenuhi target sentuh 44px pada hamburger, tombol direktori, dan logout",
        expected: { hamburgerHeight: ">=44", customerActionBtnHeight: ">=44", logoutBtnHeight: ">=44" },
        actual: {
          viewport: narrowData.viewport,
          pointerType: narrowData.pointerType,
          hamburgerHeight: narrowData.hamburgerHeight,
          customerActionBtnHeight: narrowData.customerActionBtnHeight,
          logoutBtnHeight: narrowData.logoutBtnHeight,
        },
        pass: narrowPass,
      });

      // 3.2 Desktop Pointer Presisi (1440x900 DPR 1)
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard" });
      await delay(1000);

      const desktopMetrics = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const custActionBtn = document.querySelector('#main-content a[href="/dashboard/customers"]');
          const logoutBtn = document.querySelector('form button[type="submit"]');
          const isPointerFine = window.matchMedia('(pointer: fine)').matches;
          const isPointerCoarse = window.matchMedia('(pointer: coarse)').matches;

          return {
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
            matchMediaFine: isPointerFine,
            matchMediaCoarse: isPointerCoarse,
            pointerType: isPointerCoarse ? 'coarse' : isPointerFine ? 'fine' : 'none',
            customerActionBtnHeight: custActionBtn ? Math.round(custActionBtn.getBoundingClientRect().height) : 0,
            logoutBtnHeight: logoutBtn ? Math.round(logoutBtn.getBoundingClientRect().height) : 0,
          };
        })()`,
        returnByValue: true,
      });

      const desktopData = desktopMetrics.result.value || {};
      const desktopPass = Boolean(
        desktopData.customerActionBtnHeight >= 40 &&
        desktopData.logoutBtnHeight >= 40
      );

      recordAssertion({
        id: "desktop_control_heights",
        name: "Kontrol desktop pointer presisi memenuhi tinggi minimum default 40px",
        expected: { customerActionBtnHeight: ">=40", logoutBtnHeight: ">=40" },
        actual: {
          viewport: desktopData.viewport,
          pointerType: desktopData.pointerType,
          customerActionBtnHeight: desktopData.customerActionBtnHeight,
          logoutBtnHeight: desktopData.logoutBtnHeight,
        },
        pass: desktopPass,
      });

      // 3.3 Hardware pointer: coarse status check
      if (!narrowData.matchMediaCoarse && !desktopData.matchMediaCoarse) {
        recordAssertion({
          id: "pointer_coarse_hardware_test",
          name: "Pengujian hardware pointer: coarse pada layar sentuh fisik",
          notRunReason: "matchMedia('(pointer: coarse)').matches === false; lingkungan headless Chromium tidak memiliki hardware layar sentuh fisik",
        });
      }
    }

    // ========================================================================
    // 4. PEMUATAN DATA DIREKTORI PELANGGAN (/dashboard/customers)
    // ========================================================================
    console.log("\n--- [4] Verifikasi Pemuatan Data Pelanggan (1440x900) ---");
    if (!isAuthenticated) {
      recordAssertion({
        id: "customer_directory_data_loading",
        name: "Tabel pelanggan memuat 12 data dummy normal tanpa error alert",
        notRunReason: "Sesi staf autentikasi tidak tersedia",
      });
    } else {
      await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard/customers" });
      await delay(1500);

      const customerRes = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const table = document.querySelector('table');
          const rows = document.querySelectorAll('tbody tr');
          const alertEl = document.querySelector('[role="alert"]');
          const countSpan = document.querySelector('h2#customer-list-heading + span');
          const unlinkedSec = document.querySelector('section[aria-labelledby="unlinked-heading"]');
          const paginationNav = document.querySelector('nav[aria-label="Halaman daftar pelanggan"]');
          const paginationSpan = paginationNav && paginationNav.parentElement ? paginationNav.parentElement.querySelector('span') : null;
          const paginationText = paginationSpan ? paginationSpan.textContent.trim() : null;

          return {
            tableFound: Boolean(table),
            rowCount: rows.length,
            hasErrorAlert: Boolean(alertEl),
            errorMessage: alertEl ? alertEl.textContent.trim() : null,
            countBadge: countSpan ? countSpan.textContent.trim() : null,
            paginationText,
            hasPaginationLinks: Boolean(paginationNav && paginationNav.children.length > 0),
            hasUnlinkedSection: Boolean(unlinkedSec),
          };
        })()`,
        returnByValue: true,
      });

      const custData = customerRes.result.value || {};
      const custPass = Boolean(
        custData.tableFound === true &&
        custData.rowCount === 12 &&
        custData.hasErrorAlert === false &&
        custData.paginationText &&
        custData.paginationText.includes("Maksimal 25 pelanggan per halaman") &&
        custData.hasPaginationLinks === false
      );

      recordAssertion({
        id: "customer_directory_data_loading",
        name: "Tabel pelanggan memuat 12 data dummy normal, ukuran halaman 25, tanpa error alert",
        expected: { tableFound: true, rowCount: 12, hasErrorAlert: false, pageSize: 25, hasPaginationLinks: false },
        actual: {
          tableFound: custData.tableFound,
          rowCount: custData.rowCount,
          hasErrorAlert: custData.hasErrorAlert,
          paginationText: custData.paginationText,
          hasPaginationLinks: custData.hasPaginationLinks,
        },
        pass: custPass,
      });
    }

    // ========================================================================
    // FAIL-MODE TEST: Jika dijalankan dengan --test-fail-mode, simulasikan kegagalan
    // ========================================================================
    if (IS_FAIL_MODE_TEST) {
      recordAssertion({
        id: "fail_mode_simulation_check",
        name: "Simulasi kegagalan terarah untuk menguji exit code nonzero runner",
        expected: "simulated_success",
        actual: "simulated_failure",
        pass: false,
      });
    }

    // Simpan hasil bukti terstruktur ke docs/evidence/P0_11/
    const jsonEvidencePath = path.join(evidenceDir, "p011-interaction-evidence.json");
    fs.writeFileSync(jsonEvidencePath, JSON.stringify(results, null, 2));
    console.log(`\nArtefak bukti disimpan di: ${jsonEvidencePath}`);

    // Ringkasan akhir runner
    console.log("\n========================================================");
    console.log(`TOTAL:   ${results.summary.total}`);
    console.log(`PASS:    ${results.summary.passed}`);
    console.log(`FAIL:    ${results.summary.failed}`);
    console.log(`NOT_RUN: ${results.summary.notRun}`);
    console.log("========================================================");

    if (results.summary.failed > 0) {
      console.error(`\nRunner selesai dengan ${results.summary.failed} kegagalan (exit code 1).`);
      process.exitCode = 1;
    } else {
      console.log("\nSeluruh assertion yang dijalankan berhasil (exit code 0).");
      process.exitCode = 0;
    }
  } catch (err) {
    console.error("\nEksekusi runner terhenti dengan exception:", err);
    process.exitCode = 1;
  } finally {
    if (cdp) {
      try { cdp.close(); } catch {}
    }
    if (chromeProc) {
      try { chromeProc.kill("SIGTERM"); } catch {}
    }
  }
}

run();
