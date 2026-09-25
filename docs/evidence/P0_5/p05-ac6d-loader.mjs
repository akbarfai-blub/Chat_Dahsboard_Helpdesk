// Loader used by p05-ac6d-branch-logic.mjs.
// Mocks ONLY the module "@/lib/supabase/server" (the Supabase client seam). Everything else —
// the real app/login/actions.ts source and the real next/navigation redirect() — is loaded for
// real. This keeps the branch-selection logic under test as the ACTUAL application code.
import { fileURLToPath } from "node:url";

// docs/evidence/P0_5/ -> repo root
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const NEXT_NAV_URL = `file://${REPO_ROOT}node_modules/next/navigation.js`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase/server") {
    return { shortCircuit: true, url: "mock://supabase-server" };
  }
  if (specifier === "next/navigation") {
    return { shortCircuit: true, url: NEXT_NAV_URL };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "mock://supabase-server") {
    return {
      shortCircuit: true,
      format: "module",
      source: `
let current = null;
export function __setSupabase(m) { current = m; }
export async function createClient() { return current; }
export function __reset() { current = null; }
`,
    };
  }
  return nextLoad(url, context);
}