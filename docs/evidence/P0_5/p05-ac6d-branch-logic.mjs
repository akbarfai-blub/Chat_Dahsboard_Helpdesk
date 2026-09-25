// P0.5 AC6d2 — isolated/mock test of the ACTUAL logout() Server Action branch selection.
//
// WHY ISOLATED: with the installed @supabase/auth-js (2.116.0, pinned via supabase-js), the
// valid-session branch (`signOut()` errors while `getUser()` still returns a user) cannot be
// triggered through real GoTrue traffic: every non-swallowed `signOut` error path evicts the
// local session first, and 401/403/404 errors are consumed inside `_signOut` (returned as
// success). This is verified against node_modules/@supabase/auth-js source; see review §5.
//
// METHOD / BOUNDARY (explicit per task instruction):
//   - MOCKED: only @/lib/supabase/server (`createClient`) — the Supabase client seam.
//   - REAL: app/login/actions.ts (the actual logout() source, type-stripped by Node),
//           and next/navigation `redirect()` (the real Next framework primitive, whose
//           thrown NEXT_REDIRECT digest carries the chosen target).
//   - NOT browser/Supabase E2E. Message display and retry for the valid-session case are
//     proven separately in p05-logout-failure.mjs (AC6d3, real browser). The session-lost
//     branch is proven end-to-end with a real HTTP 500 (AC6d1).
//   - No test-only endpoints/flags added to the app; the logout logic is not copied anywhere.
//
// RUN: node p05-ac6d-branch-logic.mjs   (plain Node >=24; no playwright needed)
import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

register(new URL("./p05-ac6d-loader.mjs", import.meta.url));

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ACTIONS_URL = pathToFileURL(`${REPO_ROOT}app/login/actions.ts`).href;
const EVIDENCE_DIR = process.env.P05_EVIDENCE_DIR || fileURLToPath(new URL(".", import.meta.url));

const results = [];
function rec(scenario, status, evidence, limitation = "") {
  results.push({ scenario, status, evidence, limitation });
  console.log(`${status} | ${scenario} | ${evidence}${limitation ? " | LIMIT: " + limitation : ""}`);
}

const { __setSupabase, __reset } = await import("mock://supabase-server");
const actions = await import(ACTIONS_URL);

function parseDigest(digest) {
  // NEXT_REDIRECT;replace;<target>;<status>;  (Next.js internal, stable across 15/16)
  const m = /^NEXT_REDIRECT;replace;(.+?);(\d+);?$/.exec(String(digest || ""));
  return m ? { target: m[1], status: Number(m[2]) } : null;
}

async function invokeLogout({ signOutResult, getUserResult }) {
  // Each invocation uses a fresh mock; the call counters below are the ONLY instrumentation,
  // and they observe the ACTUAL calls logout() makes through createClient().
  let signOutCalls = 0;
  let getUserCalls = 0;
  __setSupabase({
    auth: {
      signOut: async () => {
        signOutCalls += 1;
        return signOutResult;
      },
      getUser: async () => {
        getUserCalls += 1;
        return getUserResult;
      },
    },
  });
  let captured = null;
  try {
    await actions.logout();
  } catch (e) {
    captured = e;
  }
  __reset();
  return { captured, signOutCalls, getUserCalls };
}

try {
  const nextNav = await import("next/navigation");
  if (typeof nextNav.redirect !== "function") {
    rec("Preamble: next/navigation redirect tersedia", "FAIL", `type=${typeof nextNav.redirect}`);
  } else {
    rec(
      "Preamble: kode asli diimpor, redirect() Next asli dipakai",
      "PASS",
      `actionsSource=${ACTIONS_URL.replace("file://", "")}, nextNavigation=${pathToFileURL(`${REPO_ROOT}node_modules/next/navigation.js`).href.replace("file://", "")}`,
      "module yang dimock HANYA @/lib/supabase/server; cabang yang diuji adalah logika pemilihan redirect pada logout() asli",
    );
  }

  // Branch A: signOut error + session still valid -> /dashboard?error=logout
  const a = await invokeLogout({
    signOutResult: { error: { name: "AuthApiError", message: "simulated 500" } },
    getUserResult: { data: { user: { id: "u-temp", email: "p05@example.test" } }, error: null },
  });
  const aDigest = a.captured ? parseDigest(a.captured.digest) : null;
  const aOk =
    aDigest !== null &&
    aDigest.target === "/dashboard?error=logout" &&
    a.signOutCalls === 1 &&
    a.getUserCalls === 1 &&
    String(a.captured.digest).includes("NEXT_REDIRECT");
  rec(
    "AC6d2a Sesi masih valid: signOut error + getUser valid -> redirect /dashboard?error=logout (bisa coba lagi), 1 redirect, tanpa loop",
    aOk ? "PASS" : "FAIL",
    `digest=${a.captured?.digest}, parsedTarget=${aDigest ? aDigest.target : "none"}, signOutCalls=${a.signOutCalls}, getUserCalls=${a.getUserCalls}, redirectsThrown=${a.captured ? 1 : 0}`,
    "mock terisolasi: hanya createClient() yang dimock; logika pemilihan cabang dan redirect() Next adalah kode asli; bukan bukti browser/Supabase E2E",
  );

  // Branch B: signOut error + session already lost -> /login?error=logout
  const b = await invokeLogout({
    signOutResult: { error: { name: "AuthApiError", message: "simulated 500" } },
    getUserResult: { data: { user: null }, error: { name: "AuthSessionMissingError", message: "session missing" } },
  });
  const bDigest = b.captured ? parseDigest(b.captured.digest) : null;
  const bOk =
    bDigest !== null &&
    bDigest.target === "/login?error=logout" &&
    b.signOutCalls === 1 &&
    b.getUserCalls === 1;
  rec(
    "AC6d2b Sesi sudah hilang: signOut error + getUser tanpa user -> redirect /login?error=logout, 1 redirect",
    bOk ? "PASS" : "FAIL",
    `digest=${b.captured?.digest}, parsedTarget=${bDigest ? bDigest.target : "none"}, signOutCalls=${b.signOutCalls}, getUserCalls=${b.getUserCalls}`,
    "mock terisolasi; konsisten dengan AC6d1 (browser E2E HTTP 500) dan dengan analisis auth-js yang meng-evict sesi pada error non-401/403/404",
  );

  // Branch C: signOut success -> /login (no error=logout anywhere)
  const c = await invokeLogout({
    signOutResult: { error: null },
    getUserResult: { data: { user: null }, error: null },
  });
  const cDigest = c.captured ? parseDigest(c.captured.digest) : null;
  const cOk =
    cDigest !== null &&
    cDigest.target === "/login" &&
    !c.captured.digest.includes("error=logout") &&
    c.signOutCalls === 1 &&
    c.getUserCalls === 0;
  rec(
    "AC6d2c Logout sukses: signOut tanpa error -> redirect /login tanpa error=logout, getUser TIDAK dipanggil",
    cOk ? "PASS" : "FAIL",
    `digest=${c.captured?.digest}, parsedTarget=${cDigest ? cDigest.target : "none"}, signOutCalls=${c.signOutCalls}, getUserCalls=${c.getUserCalls}`,
    "mock terisolasi; konsisten dengan AC2 (browser E2E logout sukses tanpa alert)",
  );

  // No-loop / no-misleading-claim guard at code level: every branch threw exactly ONE redirect.
  const allSingle = [a, b, c].every((r) => r.captured && String(r.captured.digest || "").startsWith("NEXT_REDIRECT"));
  rec(
    "AC6d2d Tidak ada loop/klaim ganda pada kode logout: tepat satu redirect per invokasi, logout() tidak pernah resolve normal",
    allSingle ? "PASS" : "FAIL",
    `redirectsPerBranch=${JSON.stringify([a, b, c].map((r) => (r.captured ? 1 : 0)))}`,
    "bukti di level kode; perilaku loop di level navigasi dibuktikan oleh AC6d1/AC6d3 (settle di URL akhir)",
  );
} catch (e) {
  rec("AC6D HARNESS ERROR", "FAIL", `exception=${e && e.message ? e.message : String(e)}`);
  if (e && e.stack) console.error(e.stack.split("\n").slice(0, 10).join("\n"));
}

writeFileSync(`${EVIDENCE_DIR}results-ac6d.json`, JSON.stringify(results, null, 2));
console.log("WROTE results-ac6d.json");
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);