/**
 * Strict resolver for Supabase Auth credentials (URL and Client Key).
 * Enforces atomic pairing and consistent precedence across runtime, test, and build environments.
 * Prevents mixing a URL from one environment with a key from another.
 * Prevents partial configuration bypass and explicitly rejects service-role keys for client/staff sessions.
 */

export interface SupabaseAuthConfig {
  url: string;
  key: string;
  source: "runtime_server" | "test_override" | "public_client";
}

export function resolveSupabaseAuthConfig(
  env: Record<string, string | undefined> = process.env
): SupabaseAuthConfig {
  // Candidate pairs by priority tier:
  // Tier 1: Runtime server (SUPABASE_URL + SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY)
  const runtimeUrl = env.SUPABASE_URL?.trim();
  const runtimeKey = (env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY)?.trim();

  // Tier 2: Test override (HELPDESK_TEST_API_URL + HELPDESK_TEST_ANON_KEY / HELPDESK_TEST_PUBLISHABLE_KEY)
  const testUrl = env.HELPDESK_TEST_API_URL?.trim();
  const testKey = (env.HELPDESK_TEST_ANON_KEY || env.HELPDESK_TEST_PUBLISHABLE_KEY)?.trim();

  // Tier 3: Public client (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();

  // Known service role keys that must NEVER be used for client/staff sessions
  const forbiddenServiceRoleKeys = [
    env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    env.HELPDESK_TEST_SERVICE_ROLE_KEY?.trim(),
  ].filter((k): k is string => Boolean(k && k.length > 0));

  function assertNotServiceRole(keyToVerify: string): void {
    if (forbiddenServiceRoleKeys.includes(keyToVerify)) {
      throw new Error(
        "FAIL-CLOSED: Service-role key tidak boleh digunakan untuk sesi client atau staf. Gunakan anon atau publishable key."
      );
    }
  }

  // Tier 1 Evaluation: Runtime Server
  // If runtime URL is configured, it is the highest-priority source. Its key must be provided.
  // Never fall through to lower tiers if the higher-priority source is partially configured.
  if (runtimeUrl) {
    if (!runtimeKey) {
      throw new Error(
        "FAIL-CLOSED: SUPABASE_URL dikonfigurasi pada server runtime tetapi kunci anon/publishable runtime (SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY) tidak tersedia. Kombinasi parsial ditolak."
      );
    }
    assertNotServiceRole(runtimeKey);
    return { url: runtimeUrl, key: runtimeKey, source: "runtime_server" };
  }

  if (runtimeKey && !runtimeUrl) {
    throw new Error(
      "FAIL-CLOSED: Kunci runtime (SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY) tersedia tetapi SUPABASE_URL tidak tersedia. Kombinasi parsial ditolak."
    );
  }

  // Tier 2 Evaluation: Test Override
  // If test override URL is configured, its dedicated test key must be provided without borrowing from other sources.
  if (testUrl) {
    if (!testKey) {
      throw new Error(
        "FAIL-CLOSED: HELPDESK_TEST_API_URL dikonfigurasi tetapi kunci anon/publishable uji (HELPDESK_TEST_ANON_KEY / HELPDESK_TEST_PUBLISHABLE_KEY) tidak tersedia. Kombinasi parsial ditolak."
      );
    }
    assertNotServiceRole(testKey);
    return { url: testUrl, key: testKey, source: "test_override" };
  }

  if (testKey && !testUrl) {
    throw new Error(
      "FAIL-CLOSED: Kunci uji (HELPDESK_TEST_ANON_KEY / HELPDESK_TEST_PUBLISHABLE_KEY) tersedia tetapi HELPDESK_TEST_API_URL tidak tersedia. Kombinasi parsial ditolak."
    );
  }

  // Tier 3 Evaluation: Public Client
  if (publicUrl) {
    if (!publicKey) {
      throw new Error(
        "FAIL-CLOSED: NEXT_PUBLIC_SUPABASE_URL dikonfigurasi tetapi kunci publik (NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) tidak tersedia."
      );
    }
    assertNotServiceRole(publicKey);
    return { url: publicUrl, key: publicKey, source: "public_client" };
  }

  if (publicKey && !publicUrl) {
    throw new Error(
      "FAIL-CLOSED: Kunci Supabase publik tersedia tetapi NEXT_PUBLIC_SUPABASE_URL tidak tersedia."
    );
  }

  throw new Error(
    "FAIL-CLOSED: Konfigurasi Supabase tidak lengkap. Diperlukan pasangan URL dan anon/publishable key yang valid."
  );
}
