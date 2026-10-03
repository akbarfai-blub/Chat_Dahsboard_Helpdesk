import crypto from "crypto";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import {
  getHelpdeskPoolTarget,
  isLoopbackHost,
  normalizeHostname,
  type HelpdeskPoolTarget,
} from "../postgres/server";
import {
  getSupabaseClientTarget,
  type SupabaseClientTarget,
} from "../supabase/server";

export interface TargetValidationResult {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  expectedMarker?: string;
  runtimeApiEndpoint?: string;
  poolTarget?: HelpdeskPoolTarget;
  clientTarget?: SupabaseClientTarget;
}

export interface DiagnosticMarkerResult {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  dbMarker?: string;
  apiMarker?: string;
}

export function jsonFailure(status: number, code: string, message: string): Response {
  return Response.json(
    {
      success: false,
      data: null,
      error: { code, message },
    },
    { status }
  );
}

export function timingSafeSecretMatch(
  incomingSecret: string | null | undefined,
  configuredSecret: string | null | undefined
): boolean {
  if (typeof incomingSecret !== "string" || typeof configuredSecret !== "string") {
    return false;
  }
  if (!incomingSecret || !configuredSecret) {
    return false;
  }
  try {
    const bufIncoming = Buffer.from(incomingSecret, "utf8");
    const bufConfigured = Buffer.from(configuredSecret, "utf8");
    if (bufIncoming.byteLength !== bufConfigured.byteLength) {
      return false;
    }
    return crypto.timingSafeEqual(bufIncoming, bufConfigured);
  } catch {
    return false;
  }
}

/**
 * Validates expected test targets against actual runtime connections BEFORE executing any diagnostic query.
 * Strictly requires explicit test environment variables without falling back to main runtime variables.
 */
export function validateDiagnosticTargets(
  pool: Pool,
  client: SupabaseClient<Database>,
  env: Record<string, string | undefined> = process.env
): TargetValidationResult {
  // 1. Explicit test configuration required; no fallbacks to runtime env vars (D98, D99).
  const expectedMarker = env.HELPDESK_TEST_ENV_MARKER?.trim();
  const expectedTestDbUrl = env.HELPDESK_TEST_DATABASE_URL?.trim();
  const expectedTestApiUrl = env.HELPDESK_TEST_API_URL?.trim();

  if (!expectedMarker || !expectedTestDbUrl || !expectedTestApiUrl) {
    return {
      ok: false,
      status: 403,
      code: "TEST_CONFIG_INCOMPLETE",
      message: "Konfigurasi target pengujian tidak lengkap.",
    };
  }

  // 2. Parse and validate expected PostgreSQL test configuration
  let parsedDb: URL;
  try {
    parsedDb = new URL(expectedTestDbUrl);
  } catch {
    return {
      ok: false,
      status: 403,
      code: "TEST_CONFIG_INVALID",
      message: "URL konfigurasi database tes tidak valid.",
    };
  }
  if (!["postgres:", "postgresql:"].includes(parsedDb.protocol)) {
    return {
      ok: false,
      status: 403,
      code: "TEST_CONFIG_INVALID",
      message: "Protokol database tes harus postgresql.",
    };
  }
  const expDbHost = normalizeHostname(parsedDb.hostname);
  const expDbPort = parsedDb.port ? parseInt(parsedDb.port, 10) : 5432;
  const expDbName = parsedDb.pathname.replace(/^\//, "");

  // 3. Parse and validate expected Supabase API test configuration
  let parsedApi: URL;
  try {
    parsedApi = new URL(expectedTestApiUrl);
  } catch {
    return {
      ok: false,
      status: 403,
      code: "TEST_CONFIG_INVALID",
      message: "URL konfigurasi API tes tidak valid.",
    };
  }
  if (!["http:", "https:"].includes(parsedApi.protocol)) {
    return {
      ok: false,
      status: 403,
      code: "TEST_CONFIG_INVALID",
      message: "Protokol API tes harus http atau https.",
    };
  }
  const expApiProto = parsedApi.protocol.toLowerCase();
  const expApiHost = normalizeHostname(parsedApi.hostname);
  const expApiPort = parsedApi.port
    ? parseInt(parsedApi.port, 10)
    : (expApiProto === "https:" ? 443 : 80);
  const expApiPath = parsedApi.pathname.replace(/\/+$/, "");

  // 4. Independent loopback & production port checks
  // Database loopback check (independent of API hostname!)
  if (isLoopbackHost(expDbHost) && (expDbPort === 5432 || expDbPort === 54322)) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Target PostgreSQL loopback tidak boleh menggunakan port produksi atau default dev (5432, 54322).",
    };
  }

  // API loopback check (independent of DB hostname!)
  if (isLoopbackHost(expApiHost) && expApiPort === 54321) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Target API loopback tidak boleh menggunakan port default dev (54321).",
    };
  }

  // 5. Evaluate actual stored pool target (inspected from pool options, NOT re-reading env)
  const poolTarget = getHelpdeskPoolTarget(pool);
  if (!poolTarget) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Target koneksi pool runtime tidak dapat ditentukan.",
    };
  }

  if (isLoopbackHost(poolTarget.host) && (poolTarget.port === 5432 || poolTarget.port === 54322)) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Target PostgreSQL pool aktual menggunakan port produksi atau default dev (5432, 54322).",
    };
  }

  if (
    expDbHost !== poolTarget.host ||
    expDbPort !== poolTarget.port ||
    expDbName !== poolTarget.database
  ) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_MISMATCH",
      message: "Target PostgreSQL runtime tidak sesuai dengan target tes yang diharapkan.",
    };
  }

  // 6. Evaluate actual runtime Supabase admin client target
  const clientTarget = getSupabaseClientTarget(client);
  if (!clientTarget) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Target API client runtime tidak dapat ditentukan.",
    };
  }

  if (isLoopbackHost(clientTarget.host) && clientTarget.port === 54321) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_INVALID",
      message: "Endpoint API client runtime loopback menggunakan port default dev (54321).",
    };
  }

  if (
    expApiProto !== clientTarget.protocol ||
    expApiHost !== clientTarget.host ||
    expApiPort !== clientTarget.port ||
    expApiPath !== clientTarget.pathname
  ) {
    return {
      ok: false,
      status: 403,
      code: "TEST_TARGET_MISMATCH",
      message: "Endpoint API runtime tidak sesuai dengan target tes yang diharapkan.",
    };
  }

  const runtimeApiEndpoint = `${clientTarget.protocol}//${clientTarget.host}:${clientTarget.port}${clientTarget.pathname}`;

  return {
    ok: true,
    expectedMarker,
    runtimeApiEndpoint,
    poolTarget,
    clientTarget,
  };
}

/**
 * Executes diagnostic marker verification only AFTER targets are verified to match.
 */
export async function executeDiagnosticMarkerCheck(
  pool: Pool,
  client: SupabaseClient<Database>,
  markerId: string
): Promise<DiagnosticMarkerResult> {
  let pgToken: string | null = null;
  let sbToken: string | null = null;

  try {
    const pgRes = await pool.query(
      "SELECT description FROM public.mock_network_scenarios WHERE id = $1",
      [markerId]
    );
    pgToken = (pgRes.rows[0]?.description as string | undefined) ?? null;

    const { data: sbData, error: sbError } = await client
      .from("mock_network_scenarios")
      .select("description")
      .eq("id", markerId)
      .maybeSingle();

    if (sbError || !sbData) {
      return {
        ok: false,
        status: 403,
        code: "TEST_MARKER_NOT_FOUND",
        message: "Marker pengujian tidak ditemukan melalui API runtime.",
      };
    }
    sbToken = sbData.description ?? null;
  } catch {
    return {
      ok: false,
      status: 500,
      code: "TEST_VERIFICATION_FAILED",
      message: "Gagal memverifikasi marker lingkungan pengujian.",
    };
  }

  if (!pgToken) {
    return {
      ok: false,
      status: 403,
      code: "TEST_MARKER_NOT_FOUND",
      message: "Marker pengujian tidak ditemukan melalui PostgreSQL.",
    };
  }

  if (pgToken !== sbToken) {
    return {
      ok: false,
      status: 403,
      code: "TEST_MARKER_MISMATCH",
      message: "Target database dan API runtime tidak merujuk lingkungan yang sama.",
    };
  }

  return {
    ok: true,
    dbMarker: pgToken,
    apiMarker: sbToken,
  };
}

export type PoolOrFactory = Pool | (() => Pool);
export type ClientOrFactory = SupabaseClient<Database> | (() => SupabaseClient<Database>);

/**
 * Handles the complete diagnostic runtime check: authentication, lazy factory resolution,
 * target validation, and marker verification.
 * Authentication is strictly performed BEFORE any pool or client factory is executed.
 */
export async function handleDiagnosticRuntimeCheck(
  request: Request,
  poolOrFactory: PoolOrFactory,
  clientOrFactory: ClientOrFactory,
  env: Record<string, string | undefined> = process.env
): Promise<Response> {
  // 1. Maintain secret authentication strictly BEFORE any pool/client factory or diagnostic access
  const configuredSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!timingSafeSecretMatch(incomingSecret, configuredSecret)) {
    return jsonFailure(401, "UNAUTHORIZED", "Webhook secret token tidak valid atau tidak tersedia.");
  }

  // 2. Resolve factories lazily ONLY after secret authentication succeeds.
  // Factory errors are handled with a generic message without leaking credentials, environment or stack traces.
  let pool: Pool;
  let client: SupabaseClient<Database>;
  try {
    pool = typeof poolOrFactory === "function" ? poolOrFactory() : poolOrFactory;
    client = typeof clientOrFactory === "function" ? clientOrFactory() : clientOrFactory;
  } catch {
    return jsonFailure(500, "INITIALIZATION_FAILED", "Layanan database atau API runtime tidak tersedia.");
  }

  // 3. Validate targets before executing any database or API queries
  const targetCheck = validateDiagnosticTargets(pool, client, env);
  if (!targetCheck.ok) {
    return jsonFailure(
      targetCheck.status ?? 403,
      targetCheck.code ?? "TEST_TARGET_MISMATCH",
      targetCheck.message ?? "Target diagnostik tidak valid."
    );
  }

  // 4. Execute marker check only after targets are verified
  const markerCheck = await executeDiagnosticMarkerCheck(pool, client, targetCheck.expectedMarker!);
  if (!markerCheck.ok) {
    return jsonFailure(
      markerCheck.status ?? 403,
      markerCheck.code ?? "TEST_MARKER_NOT_FOUND",
      markerCheck.message ?? "Verifikasi marker gagal."
    );
  }

  return Response.json({
    success: true,
    data: {
      verified: true,
      apiEndpoint: targetCheck.runtimeApiEndpoint,
      dbMarker: markerCheck.dbMarker,
      apiMarker: markerCheck.apiMarker,
    },
    error: null,
  });
}
