import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseAuthConfig } from "../../lib/supabase/auth-config";

describe("resolveSupabaseAuthConfig", () => {
  it("resolves normal public client configuration when only NEXT_PUBLIC_* is set", () => {
    const config = resolveSupabaseAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-public",
    });

    assert.equal(config.url, "https://example.supabase.co");
    assert.equal(config.key, "anon-key-public");
    assert.equal(config.source, "public_client");
  });

  it("prioritizes runtime server pair over test override and public client variables", () => {
    const config = resolveSupabaseAuthConfig({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_ANON_KEY: "jwt-runtime-anon-key",
      HELPDESK_TEST_API_URL: "http://127.0.0.1:54399",
      HELPDESK_TEST_ANON_KEY: "jwt-test-anon-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://build-time-inlined.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "build-time-anon-key",
    });

    assert.equal(config.url, "http://127.0.0.1:54331");
    assert.equal(config.key, "jwt-runtime-anon-key");
    assert.equal(config.source, "runtime_server");
  });

  it("resolves test override pair when runtime server is absent and HELPDESK_TEST_* is configured", () => {
    const config = resolveSupabaseAuthConfig({
      HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
      HELPDESK_TEST_ANON_KEY: "jwt-helpdesk-test-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://default.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "default-key",
    });

    assert.equal(config.url, "http://127.0.0.1:54331");
    assert.equal(config.key, "jwt-helpdesk-test-key");
    assert.equal(config.source, "test_override");
  });

  it("supports explicit publishable key aliases across tiers", () => {
    const configRuntime = resolveSupabaseAuthConfig({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "pub-runtime-key",
    });
    assert.equal(configRuntime.key, "pub-runtime-key");

    const configTest = resolveSupabaseAuthConfig({
      HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
      HELPDESK_TEST_PUBLISHABLE_KEY: "pub-test-key",
    });
    assert.equal(configTest.key, "pub-test-key");

    const configPublic = resolveSupabaseAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub-public-key",
    });
    assert.equal(configPublic.key, "pub-public-key");
  });

  it("rejects runtime SUPABASE_URL without key EVEN WHEN test pair is completely configured (anti-bypass)", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          SUPABASE_URL: "http://127.0.0.1:54331",
          // SUPABASE_ANON_KEY missing!
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54399",
          HELPDESK_TEST_ANON_KEY: "test-anon-key",
          NEXT_PUBLIC_SUPABASE_URL: "https://default.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "default-key",
        }),
      /FAIL-CLOSED: SUPABASE_URL dikonfigurasi pada server runtime tetapi kunci anon\/publishable runtime/
    );
  });

  it("rejects runtime key when SUPABASE_URL is missing", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          SUPABASE_ANON_KEY: "runtime-key-without-url",
        }),
      /FAIL-CLOSED: Kunci runtime \(SUPABASE_ANON_KEY \/ SUPABASE_PUBLISHABLE_KEY\) tersedia tetapi SUPABASE_URL tidak tersedia/
    );
  });

  it("rejects test HELPDESK_TEST_API_URL without test key EVEN WHEN public client is completely configured", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
          // HELPDESK_TEST_ANON_KEY missing!
          NEXT_PUBLIC_SUPABASE_URL: "https://default.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "default-key",
        }),
      /FAIL-CLOSED: HELPDESK_TEST_API_URL dikonfigurasi tetapi kunci anon\/publishable uji/
    );
  });

  it("rejects test key when HELPDESK_TEST_API_URL is missing", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          HELPDESK_TEST_ANON_KEY: "test-key-without-url",
        }),
      /FAIL-CLOSED: Kunci uji \(HELPDESK_TEST_ANON_KEY \/ HELPDESK_TEST_PUBLISHABLE_KEY\) tersedia tetapi HELPDESK_TEST_API_URL tidak tersedia/
    );
  });

  it("prevents cross-source borrowing: HELPDESK_TEST_API_URL cannot borrow SUPABASE_ANON_KEY", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
          // HELPDESK_TEST_ANON_KEY missing!
          SUPABASE_ANON_KEY: "jwt-anon-from-runtime",
        }),
      /FAIL-CLOSED: Kunci runtime \(SUPABASE_ANON_KEY \/ SUPABASE_PUBLISHABLE_KEY\) tersedia tetapi SUPABASE_URL tidak tersedia/
    );
  });

  it("rejects public URL when public key is missing", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        }),
      /FAIL-CLOSED: NEXT_PUBLIC_SUPABASE_URL dikonfigurasi tetapi kunci publik/
    );
  });

  it("rejects public key when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "key-without-url",
        }),
      /FAIL-CLOSED: Kunci Supabase publik tersedia tetapi NEXT_PUBLIC_SUPABASE_URL tidak tersedia/
    );
  });

  it("strictly forbids service-role key from being used as client or staff session key", () => {
    const serviceRoleKey = "secret-service-role-key-12345";
    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          SUPABASE_URL: "http://127.0.0.1:54331",
          SUPABASE_ANON_KEY: serviceRoleKey,
          SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        }),
      /FAIL-CLOSED: Service-role key tidak boleh digunakan untuk sesi client atau staf/
    );

    assert.throws(
      () =>
        resolveSupabaseAuthConfig({
          HELPDESK_TEST_API_URL: "http://127.0.0.1:54331",
          HELPDESK_TEST_ANON_KEY: serviceRoleKey,
          HELPDESK_TEST_SERVICE_ROLE_KEY: serviceRoleKey,
        }),
      /FAIL-CLOSED: Service-role key tidak boleh digunakan untuk sesi client atau staf/
    );
  });

  it("fails closed when no configuration is provided", () => {
    assert.throws(
      () => resolveSupabaseAuthConfig({}),
      /FAIL-CLOSED: Konfigurasi Supabase tidak lengkap/
    );
  });
});
