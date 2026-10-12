#!/usr/bin/env node
/**
 * tests/interactive/verify-request-correlator.test.mjs
 *
 * Dedicated deterministic unit & contract test for NetworkRequestCorrelator:
 * Proves exact request correlation between Fetch interception and CDP Network events.
 *
 * Enforces empirical proof for 4 mandatory review finding conditions:
 * 1. Respons lama dengan URL sama sudah selesai 200, tetapi request baru masih tertunda:
 *    request baru tidak boleh dinyatakan berhasil.
 * 2. Request lain dengan URL sama selesai:
 *    request target tetap belum berhasil.
 * 3. Respons dan event selesai untuk request target tiba:
 *    pemeriksaan baru berhasil.
 * 4. Request target gagal atau timeout:
 *    pemeriksaan gagal meskipun respons historis yang berhasil tersedia.
 *
 * Additional contract checks:
 * 5. Identitas request tidak tersedia atau ambigu (missing/empty networkId):
 *    gagalkan pemeriksaan dengan alasan eksplisit.
 * 6. Respons non-200 (misalnya 500) pada request target:
 *    gagalkan pemeriksaan.
 * 7. Konsumsi respons membersihkan catatan request:
 *    tidak ada bukti lama yang dapat digunakan kembali.
 */

import { NetworkRequestCorrelator } from "./verify-p27-ui-lifecycle.mjs";

console.log("=== P2.7 VERIFIKASI DETERMINISTIK: KORELASI REQUEST JARINGAN (Finding 1) ===");

const testResults = [];

function assertTest(name, condition, details = {}) {
  if (condition) {
    console.log(`  [✓] PASS: ${name}`);
    testResults.push({ name, pass: true, details });
  } else {
    console.error(`  [✗] FAIL: ${name}`);
    console.error("      Details:", JSON.stringify(details, null, 2));
    testResults.push({ name, pass: false, details });
  }
}

async function runCorrelatorVerification() {
  const TARGET_URL = "http://127.0.0.1:3370/api/inbox/conversations/conv-123/context";

  // --------------------------------------------------------------------------
  // Kondisi 1: Respons lama dengan URL sama sudah selesai 200, tetapi request baru
  // masih tertunda: request baru tidak boleh dinyatakan berhasil.
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 1] Respons lama selesai 200, request baru tertunda ---");
  {
    const correlator = new NetworkRequestCorrelator();

    // Simulasikan siklus sebelumnya: request lama 'net-old-1' sudah selesai 200
    correlator.onResponseReceived({
      requestId: "net-old-1",
      response: { status: 200, statusText: "OK", url: TARGET_URL },
    });
    correlator.onLoadingFinished({ requestId: "net-old-1" });

    // Request baru 'net-target-2' masuk dengan URL sama persis
    const newFetchParams = {
      networkId: "net-target-2",
      requestId: "fetch-target-2",
      request: { url: TARGET_URL, method: "GET" },
    };

    let resolvedEarly = false;
    let timeoutCaught = false;

    // Tunggu dengan timeout pendek (100ms) tanpa menyuplai event untuk 'net-target-2'
    const waitPromise = correlator.waitForRequestCompletion(newFetchParams, 100);
    waitPromise
      .then(() => {
        resolvedEarly = true;
      })
      .catch((err) => {
        if (err.message.includes("Timeout (100ms)") && err.message.includes("net-target-2")) {
          timeoutCaught = true;
        }
      });

    // Beri waktu 150ms agar timeout terpicu
    await new Promise((r) => setTimeout(r, 150));

    assertTest(
      "Kondisi 1: Request baru dengan URL sama tetap tertunda dan TIDAK memakai respons lama net-old-1 (timeout terjadi secara benar)",
      resolvedEarly === false && timeoutCaught === true,
      { resolvedEarly, timeoutCaught }
    );

    correlator.clear();
  }

  // --------------------------------------------------------------------------
  // Kondisi 2: Request lain dengan URL sama selesai: request target tetap belum berhasil.
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 2] Request concurrent lain dengan URL sama selesai, target tetap belum berhasil ---");
  {
    const correlator = new NetworkRequestCorrelator();

    const targetFetchParams = {
      networkId: "net-target-active",
      requestId: "fetch-target-active",
      request: { url: TARGET_URL, method: "GET" },
    };

    let targetSettledEarly = false;
    const targetPromise = correlator.waitForRequestCompletion(targetFetchParams, 250);
    targetPromise.then(() => {
      targetSettledEarly = true;
    }).catch(() => {});

    // Request lain 'net-concurrent-other' dengan URL sama tiba dan selesai 200
    correlator.onResponseReceived({
      requestId: "net-concurrent-other",
      response: { status: 200, statusText: "OK", url: TARGET_URL },
    });
    correlator.onLoadingFinished({ requestId: "net-concurrent-other" });

    // Tunggu 50ms untuk memastikan event loop memproses
    await new Promise((r) => setTimeout(r, 50));

    assertTest(
      "Kondisi 2: Penyelesaian request lain (net-concurrent-other) tidak meluluskan target (net-target-active)",
      targetSettledEarly === false,
      { targetSettledEarly }
    );

    correlator.clear();
  }

  // --------------------------------------------------------------------------
  // Kondisi 3: Respons dan event selesai untuk request target tiba: pemeriksaan baru berhasil.
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 3] Respons dan loadingFinished untuk target tiba -> pemeriksaan berhasil ---");
  {
    const correlator = new NetworkRequestCorrelator();

    const targetFetchParams = {
      networkId: "net-target-success",
      requestId: "fetch-target-success",
      request: { url: TARGET_URL, method: "GET" },
    };

    const waitPromise = correlator.waitForRequestCompletion(targetFetchParams, 1000);

    // Kirim respons 200 dan loadingFinished untuk net-target-success
    correlator.onResponseReceived({
      requestId: "net-target-success",
      response: { status: 200, statusText: "OK", url: TARGET_URL },
    });
    correlator.onLoadingFinished({ requestId: "net-target-success" });

    const result = await waitPromise;

    const condition3Pass =
      result.status === 200 &&
      result.networkId === "net-target-success" &&
      result.fetchRequestId === "fetch-target-success" &&
      result.url === TARGET_URL &&
      typeof result.finishedAt === "string";

    assertTest(
      "Kondisi 3: Target request berhasil diverifikasi dengan identitas event yang tepat",
      condition3Pass,
      result
    );

    // Verifikasi pembersihan: memanggil wait ulang untuk net-target-success tidak boleh dapat memakai respons lama
    let reuseAttemptSucceeded = false;
    const reusePromise = correlator.waitForRequestCompletion(targetFetchParams, 50);
    reusePromise.then(() => {
      reuseAttemptSucceeded = true;
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 80));

    assertTest(
      "Kondisi 3b: Catatan request langsung dibersihkan setelah dipakai sehingga tidak bisa digunakan kembali",
      reuseAttemptSucceeded === false,
      { reuseAttemptSucceeded }
    );

    correlator.clear();
  }

  // --------------------------------------------------------------------------
  // Kondisi 4: Request target gagal atau timeout: pemeriksaan gagal meskipun
  // respons historis yang berhasil tersedia.
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 4] Request target gagal atau timeout meskipun ada respons historis 200 ---");
  {
    const correlator = new NetworkRequestCorrelator();

    // Sediakan respons historis 200 untuk URL yang sama
    correlator.onResponseReceived({
      requestId: "net-historical-ok",
      response: { status: 200, statusText: "OK", url: TARGET_URL },
    });
    correlator.onLoadingFinished({ requestId: "net-historical-ok" });

    // 4a: Loading failed pada target
    const targetFailParams = {
      networkId: "net-target-failed",
      requestId: "fetch-target-failed",
      request: { url: TARGET_URL, method: "GET" },
    };

    const failPromise = correlator.waitForRequestCompletion(targetFailParams, 500);

    // Kirim event loadingFailed untuk net-target-failed
    correlator.onLoadingFailed({
      requestId: "net-target-failed",
      errorText: "net::ERR_CONNECTION_RESET",
      canceled: false,
    });

    let failedWithError = false;
    let failErrorMessage = "";
    try {
      await failPromise;
    } catch (e) {
      failedWithError = true;
      failErrorMessage = e.message;
    }

    assertTest(
      "Kondisi 4a: Request target gagal (loadingFailed) memicu error eksplisit meskipun respons historis 200 ada",
      failedWithError &&
        failErrorMessage.includes("net::ERR_CONNECTION_RESET") &&
        failErrorMessage.includes("net-target-failed"),
      { failedWithError, failErrorMessage }
    );

    // 4b: Respons status non-200 (misalnya 500 Internal Server Error)
    const target500Params = {
      networkId: "net-target-500",
      requestId: "fetch-target-500",
      request: { url: TARGET_URL, method: "GET" },
    };

    const serverErrorPromise = correlator.waitForRequestCompletion(target500Params, 500);
    correlator.onResponseReceived({
      requestId: "net-target-500",
      response: { status: 500, statusText: "Internal Server Error", url: TARGET_URL },
    });
    correlator.onLoadingFinished({ requestId: "net-target-500" });

    let non200Caught = false;
    let non200Error = "";
    try {
      await serverErrorPromise;
    } catch (e) {
      non200Caught = true;
      non200Error = e.message;
    }

    assertTest(
      "Kondisi 4b: Respons HTTP 500 pada target memicu error eksplisit (bukan dianggap berhasil)",
      non200Caught && non200Error.includes("500") && non200Error.includes("net-target-500"),
      { non200Caught, non200Error }
    );

    // 4c: Identitas request tidak tersedia atau ambigu (missing networkId)
    let ambiguousCaught = false;
    let ambiguousError = "";
    try {
      await correlator.waitForRequestCompletion({
        networkId: null,
        requestId: "fetch-missing-netid",
        request: { url: TARGET_URL, method: "GET" },
      });
    } catch (e) {
      ambiguousCaught = true;
      ambiguousError = e.message;
    }

    assertTest(
      "Kondisi 4c: Missing/ambiguous networkId langsung menggagalkan pemeriksaan dengan alasan eksplisit",
      ambiguousCaught && ambiguousError.includes("fetchParams.networkId wajib ada"),
      { ambiguousCaught, ambiguousError }
    );

    // 4d: Request target timeout
    const targetTimeoutParams = {
      networkId: "net-target-timeout",
      requestId: "fetch-target-timeout",
      request: { url: TARGET_URL, method: "GET" },
    };

    let timeoutOccurred = false;
    let timeoutError = "";
    try {
      await correlator.waitForRequestCompletion(targetTimeoutParams, 80);
    } catch (e) {
      timeoutOccurred = true;
      timeoutError = e.message;
    }

    assertTest(
      "Kondisi 4d: Request target timeout memicu error eksplisit meskipun respons historis 200 tersedia",
      timeoutOccurred && timeoutError.includes("Timeout (80ms)") && timeoutError.includes("net-target-timeout"),
      { timeoutOccurred, timeoutError }
    );

    correlator.clear();
  }

  console.log("\n========================================================");
  const total = testResults.length;
  const passed = testResults.filter((t) => t.pass).length;
  const failed = testResults.filter((t) => !t.pass).length;
  console.log(`TOTAL UJI KORELASI REQUEST: ${total}`);
  console.log(`LULUS:                     ${passed}`);
  console.log(`GAGAL:                     ${failed}`);
  console.log(`STATUS:                    ${failed === 0 ? "PASS (Semua kondisi terbukti)" : "FAIL"}`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runCorrelatorVerification().catch((err) => {
  console.error("[Fatal Error in Correlator Test]:", err);
  process.exit(1);
});
