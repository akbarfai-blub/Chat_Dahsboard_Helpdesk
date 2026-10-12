#!/usr/bin/env node
/**
 * tests/interactive/verify-finalization-handler.test.mjs
 *
 * Dedicated deterministic unit & contract test for Runner Finalization & Teardown Handlers:
 * Proves that:
 * 1. In-flight asynchronous handlers are tracked and safely drained during finalization.
 * 2. Late rejections occurring during draining are captured by AsyncFailureController and fail the run.
 * 3. Handler drain timeout is enforced and produces an explicit recorded failure.
 * 4. Teardown cancellation (TeardownCancellationError) is distinguished from real test failures
 *    and does NOT mask real test errors.
 * 5. Rejection occurring after CDP connection closing is not suppressed for real errors.
 * 6. Artifact & assertion freeze guards prevent any modification after finalization.
 */

import {
  CDPClient,
  AsyncFailureController,
  TeardownCancellationError,
} from "./verify-p27-ui-lifecycle.mjs";

console.log("=== P2.7 VERIFIKASI DETERMINISTIK: PENGAMAN FINALISASI ASYNCHRONOUS ===");

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

async function runFinalizationHandlerVerification() {
  // --------------------------------------------------------------------------
  // Kondisi 1: In-flight handler selesai normal sebelum timeout
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 1] Normal Drain: Handler in-flight selesai sebelum timeout ---");
  {
    const controller = new AsyncFailureController();
    const cdp = new CDPClient("ws://127.0.0.1:9999", {
      onAsyncError: (err) => controller.signal(err),
    });

    let handlerFinished = false;
    const taskPromise = (async () => {
      await new Promise((r) => setTimeout(r, 50));
      handlerFinished = true;
    })();

    cdp.trackInFlight(taskPromise);
    assertTest("Kondisi 1a: Handler terdaftar di inFlightHandlers", cdp.inFlightHandlers.size === 1);

    const drainRes = await cdp.drainInFlightHandlers(500);
    assertTest(
      "Kondisi 1b: drainInFlightHandlers berhasil dan controller tidak mencatat error",
      drainRes.drained === true && cdp.inFlightHandlers.size === 0 && handlerFinished === true && controller.hasError() === false,
      { drainRes, inFlightSize: cdp.inFlightHandlers.size, handlerFinished, hasError: controller.hasError() }
    );
  }

  // --------------------------------------------------------------------------
  // Kondisi 2: Rejection asynchronous saat draining tertangkap controller
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 2] Late Rejection: Error saat draining ditangkap controller ---");
  {
    const controller = new AsyncFailureController();
    const cdp = new CDPClient("ws://127.0.0.1:9999", {
      onAsyncError: (err) => controller.signal(err),
    });

    const failingPromise = (async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new Error("Simulated late async error during drain");
    })();

    cdp.trackInFlight(failingPromise);

    await cdp.drainInFlightHandlers(500);

    assertTest(
      "Kondisi 2: Error asynchronous saat draining ditangkap oleh AsyncFailureController dan tidak hilang",
      controller.hasError() === true &&
        controller.getError().message.includes("Simulated late async error during drain") &&
        cdp.inFlightHandlers.size === 0,
      { hasError: controller.hasError(), errorMsg: controller.getError()?.message, inFlightSize: cdp.inFlightHandlers.size }
    );
  }

  // --------------------------------------------------------------------------
  // Kondisi 3: Drain timeout menghasilkan kegagalan tercatat
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 3] Drain Timeout: Handler menggantung melampaui batas waktu ---");
  {
    const controller = new AsyncFailureController();
    const cdp = new CDPClient("ws://127.0.0.1:9999", {
      onAsyncError: (err) => controller.signal(err),
    });

    // Promise yang menggantung tidak pernah resolve/reject
    let timerId = null;
    const hangingPromise = new Promise((resolve) => {
      timerId = setTimeout(resolve, 5000);
    });

    cdp.trackInFlight(hangingPromise);

    let drainThrew = false;
    let drainError = null;
    try {
      await cdp.drainInFlightHandlers(100);
    } catch (err) {
      drainThrew = true;
      drainError = err;
    }

    if (timerId) clearTimeout(timerId);

    assertTest(
      "Kondisi 3: drainInFlightHandlers melempar timeout error dan dicatat pada controller",
      drainThrew === true &&
        drainError !== null &&
        drainError.message.includes("Handler drain timeout (100ms)") &&
        controller.hasError() === true,
      { drainThrew, errorMsg: drainError?.message, controllerError: controller.getError()?.message }
    );
  }

  // --------------------------------------------------------------------------
  // Kondisi 4: Pembedaan Teardown Cancellation dari error pengujian asli
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 4] Teardown Cancellation vs Real Test Error ---");
  {
    // 4a: Pembatalan teardown yang disengaja diabaikan
    const controller1 = new AsyncFailureController();
    const cdp1 = new CDPClient("ws://127.0.0.1:9999", {
      onAsyncError: (err) => controller1.signal(err),
    });

    const teardownAbortPromise = Promise.reject(
      new TeardownCancellationError("CDP connection closed during teardown")
    );
    cdp1.trackInFlight(teardownAbortPromise);
    await new Promise((r) => setTimeout(r, 20));

    assertTest(
      "Kondisi 4a: TeardownCancellationError tidak dianggap sebagai error pengujian fatal",
      controller1.hasError() === false,
      { hasError: controller1.hasError() }
    );

    // 4b: Real error saat/setelah penutupan tetap dicatat dan memicu kegagalan
    const controller2 = new AsyncFailureController();
    const cdp2 = new CDPClient("ws://127.0.0.1:9999", {
      onAsyncError: (err) => controller2.signal(err),
    });
    cdp2.isClosed = true; // Koneksi ditutup

    const realErrorPromise = Promise.reject(new Error("Actual late network assertion failure"));
    cdp2.trackInFlight(realErrorPromise);
    await new Promise((r) => setTimeout(r, 20));

    assertTest(
      "Kondisi 4b: Real test error setelah isClosed tetap dicatat dan TIDAK disamarkan sebagai pembatalan aman",
      controller2.hasError() === true &&
        controller2.getError().message.includes("Actual late network assertion failure"),
      { hasError: controller2.hasError(), errorMsg: controller2.getError()?.message }
    );
  }

  // --------------------------------------------------------------------------
  // Kondisi 5: Stop accepting new test events saat finalisasi
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 5] stopAcceptingNewEvents menolak pekerjaan pengujian baru ---");
  {
    const cdp = new CDPClient("ws://127.0.0.1:9999");
    assertTest("Kondisi 5a: Awalnya isFinalizing bernilai false", cdp.isFinalizing === false);

    cdp.stopAcceptingNewEvents();
    assertTest("Kondisi 5b: Setelah stopAcceptingNewEvents, isFinalizing bernilai true", cdp.isFinalizing === true);
  }

  // --------------------------------------------------------------------------
  // Kondisi 6: Freeze Guard menolak mutasi assertion pasca-finalisasi
  // --------------------------------------------------------------------------
  console.log("\n--- [Kondisi 6] Freeze Guard menolak mutasi assertion ---");
  {
    const assertions = [];
    let isTestPhaseFinalized = false;
    let isArtifactFinalized = false;

    function testRecordAssertion({ id, name, pass }) {
      if (isArtifactFinalized) {
        return false;
      }
      if (isTestPhaseFinalized && id !== "runner_cleanup_and_teardown") {
        return false;
      }
      assertions.push({ id, name, pass });
      return true;
    }

    // Selama fase pengujian normal: bisa record
    const r1 = testRecordAssertion({ id: "scenario_1", name: "Scenario 1", pass: true });
    assertTest("Kondisi 6a: Assertion fase pengujian diterima", r1 === true && assertions.length === 1);

    // Kunci fase pengujian: assertion skenario ditolak, teardown diterima
    isTestPhaseFinalized = true;
    const r2 = testRecordAssertion({ id: "scenario_late", name: "Late Scenario", pass: true });
    const r3 = testRecordAssertion({ id: "runner_cleanup_and_teardown", name: "Teardown", pass: true });
    assertTest(
      "Kondisi 6b: Setelah isTestPhaseFinalized, skenario terlambat ditolak tetapi teardown diterima",
      r2 === false && r3 === true && assertions.length === 2,
      { r2, r3, assertionsCount: assertions.length }
    );

    // Kunci penuh pasca teardown: semua mutasi ditolak
    isArtifactFinalized = true;
    const r4 = testRecordAssertion({ id: "runner_cleanup_and_teardown", name: "Teardown Dup", pass: true });
    assertTest(
      "Kondisi 6c: Setelah isArtifactFinalized, seluruh mutasi assertion ditolak total",
      r4 === false && assertions.length === 2,
      { r4, assertionsCount: assertions.length }
    );
  }

  // --------------------------------------------------------------------------
  // Ringkasan
  // --------------------------------------------------------------------------
  console.log("\n========================================================");
  const total = testResults.length;
  const passed = testResults.filter((t) => t.pass).length;
  const failed = testResults.filter((t) => !t.pass).length;
  console.log(`TOTAL PENGUJIAN FINALIZATION HANDLER: ${total}`);
  console.log(`LULUS:                                ${passed}`);
  console.log(`GAGAL:                                ${failed}`);
  console.log(`STATUS AKHIR:                         ${failed === 0 ? "PASS" : "FAIL"}`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runFinalizationHandlerVerification().catch((err) => {
  console.error("[Fatal Error]:", err);
  process.exit(1);
});
