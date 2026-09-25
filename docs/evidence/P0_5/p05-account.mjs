// P0.5 temporary test-account helper (local Supabase / GoTrue admin API).
// SAFE BY DESIGN: no secrets stored; credentials come from env at runtime.
//
// Env:
//   SUPABASE_API_URL      default http://127.0.0.1:54321
//   SUPABASE_SERVICE_KEY  REQUIRED (local dev service_role key; NOT written anywhere)
//   P05_EMAIL             optional override (default: p05-logout-review-<ts>@example.test)
//   P05_PASSWORD          REQUIRED for create (received from env; NEVER printed to stdout)
//   P05_ID                optional (delete/get-by-id)
//
// Usage:
//   node p05-account.mjs create
//   node p05-account.mjs delete [--id] <uuid>
//   node p05-account.mjs get-by-id [--id] <uuid>
//   node p05-account.mjs get-by-email <email>
//
// create prints a single JSON line: {"id":...,"email":...}
// The account must be deleted after the run (delete subcommand).
import { fileURLToPath } from "node:url";
import { createSanitizer } from "./p05-harness-utils.mjs";

const sanitizer = createSanitizer();

function sanitize(text) {
  return sanitizer.sanitize(text);
}

function fail(msg) {
  console.error(sanitize(`p05-account ERROR: ${msg}`));
  process.exit(1);
}

function assertLocalSupabaseUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    if (!isLocal) {
      fail(`Refusing to connect to non-local Supabase target: ${urlStr}. Account helper only permits local Supabase (127.0.0.1 or localhost).`);
    }
  } catch {
    fail(`Invalid SUPABASE_API_URL: ${urlStr}`);
  }
}

function getServiceKey() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) fail("SUPABASE_SERVICE_KEY is required");
  return key;
}

async function adminRequest(path, options = {}) {
  const apiUrl = process.env.SUPABASE_API_URL || "http://127.0.0.1:54321";
  assertLocalSupabaseUrl(apiUrl);
  const serviceKey = getServiceKey();
  try {
    const res = await fetch(`${apiUrl}/auth/v1/admin${path}`, {
      ...options,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    return res;
  } catch (err) {
    fail(`NETWORK_ERROR: fetch failed for ${options.method || "GET"} ${path}: ${err?.message || String(err)}`);
  }
}

async function adminJson(path, options = {}) {
  const res = await adminRequest(path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`API_ERROR: ${options.method || "GET"} ${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// Temporary test accounts must have email matching test domain/prefix.
function isTestAccount(email) {
  if (!email || typeof email !== "string") return false;
  return email.startsWith("p05-") && email.endsWith("@example.test");
}

async function create() {
  const email =
    process.env.P05_EMAIL ||
    `p05-logout-review-${Date.now().toString(36)}@example.test`;
  const password = process.env.P05_PASSWORD;
  if (!password) {
    fail("P05_PASSWORD environment variable is required to create an account");
  }

  const user = await adminJson("/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  // Password is NOT printed to stdout. Only id and email are returned.
  console.log(JSON.stringify({ id: user.id, email: user.email }));
}

async function getById(id) {
  if (!id) fail("get-by-id needs [--id] <uuid>");
  const res = await adminRequest(`/users/${id}`);
  if (res.status === 404) {
    console.log("NOT_FOUND");
    return null;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    fail(`API_ERROR: GET /users/${id} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  const user = await res.json();
  console.log(JSON.stringify({ id: user.id, email: user.email }));
  return user;
}

async function remove(id) {
  if (!id) fail("delete needs [--id] <uuid>");

  // Fetch user first to ensure it exists and is indeed a temporary test account.
  const resCheck = await adminRequest(`/users/${id}`);
  if (resCheck.status === 404) {
    console.log("ALREADY_DELETED");
    return;
  }
  if (!resCheck.ok) {
    fail(`API_ERROR: Pre-delete verification failed with HTTP ${resCheck.status}`);
  }
  const existingUser = await resCheck.json();
  if (!isTestAccount(existingUser.email)) {
    fail(`SAFEGUARD_TRIGGERED: Refusing to delete non-test account ${existingUser.email} (id: ${id}). Only temporary test accounts matching p05-*@example.test can be deleted.`);
  }

  const delRes = await adminRequest(`/users/${id}`, { method: "DELETE" });
  if (!delRes.ok && delRes.status !== 404) {
    const body = await delRes.json().catch(() => null);
    fail(`API_ERROR: DELETE /users/${id} -> HTTP ${delRes.status}: ${JSON.stringify(body)}`);
  }

  // Verify deletion: confirmed 404 GONE
  const verifyRes = await adminRequest(`/users/${id}`);
  if (verifyRes.status !== 404) {
    fail(`VERIFICATION_FAILED: Account ${id} still exists after DELETE (status ${verifyRes.status})`);
  }

  console.log(`DELETED ${id}`);
}

async function getByEmail(email) {
  if (!email) fail("get-by-email needs <email>");
  // Full pagination across all user pages
  let page = 1;
  const perPage = 50;
  const matched = [];

  while (true) {
    const pageData = await adminJson(`/users?page=${page}&per_page=${perPage}`);
    const users = pageData.users || [];
    for (const u of users) {
      if (u.email === email) {
        matched.push({ id: u.id, email: u.email });
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }

  if (matched.length === 0) {
    console.log("NOT_FOUND");
    return;
  }
  console.log(JSON.stringify(matched));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [sub, a1, a2] = process.argv.slice(2);
  const targetId = a1 === "--id" ? a2 : a1;

  if (sub === "create") {
    await create();
  } else if (sub === "delete") {
    await remove(targetId);
  } else if (sub === "get-by-id") {
    await getById(targetId);
  } else if (sub === "get-by-email") {
    await getByEmail(targetId);
  } else {
    fail("usage: create | delete [--id] <uuid> | get-by-id [--id] <uuid> | get-by-email <email>");
  }
}

export { sanitize, create, getById, remove, getByEmail, isTestAccount, assertLocalSupabaseUrl };