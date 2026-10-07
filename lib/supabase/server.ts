import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";
import { resolveSupabaseAuthConfig } from "./auth-config";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = resolveSupabaseAuthConfig(process.env);

  return createServerClient<Database>(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component tidak dapat menulis cookie.
            // Pembaruan session ditangani oleh proxy.ts.
          }
        },
      },
    },
  );
}

export function getHelpdeskAdminClient(): SupabaseClient<Database> {
  // Read server-configured runtime environment variables first (SUPABASE_URL, HELPDESK_TEST_API_URL)
  // so runtime target configuration is never defeated by build-time inlined NEXT_PUBLIC_SUPABASE_URL.
  const url =
    process.env.SUPABASE_URL ||
    process.env.HELPDESK_TEST_API_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.HELPDESK_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase admin environment variables (URL or SERVICE_ROLE_KEY)");
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SupabaseClientTarget {
  protocol: string;
  host: string;
  port: number;
  pathname: string;
}

export function getSupabaseClientTarget(client: SupabaseClient<Database>): SupabaseClientTarget | null {
  const urlStr = (client as unknown as { supabaseUrl?: string }).supabaseUrl;
  if (!urlStr || typeof urlStr !== "string") return null;
  try {
    const u = new URL(urlStr);
    const protocol = u.protocol.toLowerCase();
    const port = u.port ? parseInt(u.port, 10) : (protocol === "https:" ? 443 : 80);
    const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const host = (h === "localhost" || h === "127.0.0.1") ? "127.0.0.1" : (h === "::1" ? "::1" : h);
    return {
      protocol,
      host,
      port,
      pathname: u.pathname.replace(/\/+$/, ""),
    };
  } catch {
    return null;
  }
}


