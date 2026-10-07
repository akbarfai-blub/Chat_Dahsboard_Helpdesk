/**
 * Origin and CSRF validation for state-changing HTTP requests.
 * Evaluates the Origin header against trusted server-side authority without
 * trusting arbitrary client headers or leaking internal network details.
 */

export type OriginValidationOutcome =
  | { valid: true; origin: string }
  | {
      valid: false;
      reason: "origin_missing" | "origin_invalid" | "origin_mismatch";
      status: number;
      code: string;
      message: string;
    };

export interface TrustedOriginsResolution {
  ok: boolean;
  origins: Set<string>;
  error?: "invalid_configuration" | "missing_configuration";
  errorMessage?: string;
}

/**
 * Normalizes an origin string into standard WHATWG format (scheme + host + port).
 * Returns null if the URL is invalid or uses an unsupported protocol.
 */
export function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the trusted origin set from server-side configuration or platform variables.
 * Under no circumstances are incoming request headers permitted to define or expand
 * this trusted list.
 *
 * Evaluation Order:
 * 1. HELPDESK_TRUSTED_ORIGINS: Explicit comma-separated origins.
 *    If provided, EVERY entry must be valid. An invalid entry triggers fail-closed.
 * 2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL: Server-injected Vercel deployment domains.
 * 3. NEXT_PUBLIC_APP_URL / APP_URL: Explicit application URL.
 * 4. Development/Test Fallback: If in non-production, defaults to localhost loopbacks.
 *    In production, missing configuration triggers fail-closed.
 */
export function resolveTrustedOrigins(
  env: Record<string, string | undefined> = process.env
): TrustedOriginsResolution {
  // 1. Explicit configuration: HELPDESK_TRUSTED_ORIGINS
  const explicitOrigins = env.HELPDESK_TRUSTED_ORIGINS?.trim();
  if (explicitOrigins) {
    const tokens = explicitOrigins.split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
      return {
        ok: false,
        origins: new Set(),
        error: "invalid_configuration",
        errorMessage: "Konfigurasi origin tepercaya server tidak valid.",
      };
    }

    const set = new Set<string>();
    for (const token of tokens) {
      const normalized = normalizeOrigin(token);
      if (!normalized) {
        // Fail-closed: invalid configuration must NOT silently fall back to an untrusted source
        return {
          ok: false,
          origins: new Set(),
          error: "invalid_configuration",
          errorMessage: "Konfigurasi origin tepercaya server tidak valid.",
        };
      }
      set.add(normalized);
    }
    return { ok: true, origins: set };
  }

  // 2. Vercel deployment variables (server-injected by Vercel platform)
  const vercelProdUrl = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const vercelUrl = env.VERCEL_URL?.trim();
  if (vercelProdUrl || vercelUrl) {
    const set = new Set<string>();
    if (vercelProdUrl) {
      const normalized = normalizeOrigin(`https://${vercelProdUrl}`);
      if (!normalized) {
        return {
          ok: false,
          origins: new Set(),
          error: "invalid_configuration",
          errorMessage: "Konfigurasi domain Vercel tidak valid.",
        };
      }
      set.add(normalized);
    }
    if (vercelUrl) {
      const normalized = normalizeOrigin(`https://${vercelUrl}`);
      if (!normalized) {
        return {
          ok: false,
          origins: new Set(),
          error: "invalid_configuration",
          errorMessage: "Konfigurasi domain Vercel tidak valid.",
        };
      }
      set.add(normalized);
    }
    return { ok: true, origins: set };
  }

  // 3. Base application URL
  const appUrl = (env.NEXT_PUBLIC_APP_URL || env.APP_URL)?.trim();
  if (appUrl) {
    const normalized = normalizeOrigin(appUrl);
    if (!normalized) {
      return {
        ok: false,
        origins: new Set(),
        error: "invalid_configuration",
        errorMessage: "Konfigurasi URL aplikasi tidak valid.",
      };
    }
    return { ok: true, origins: new Set([normalized]) };
  }

  // 4. Fallback for non-production environments (development / test)
  const isProduction = env.NODE_ENV === "production";
  if (!isProduction) {
    return {
      ok: true,
      origins: new Set(["http://localhost:3000", "http://127.0.0.1:3000"]),
    };
  }

  // In production, missing trusted origin configuration triggers fail-closed
  return {
    ok: false,
    origins: new Set(),
    error: "missing_configuration",
    errorMessage: "Konfigurasi origin tepercaya belum dikonfigurasi pada server.",
  };
}

export interface ValidateOriginOptions {
  env?: Record<string, string | undefined>;
  trustedOrigins?: string[];
}

/**
 * Validates that an incoming state-changing request originates from a trusted origin.
 *
 * Rules:
 * 1. Missing Origin: Rejected with 403 FORBIDDEN.
 * 2. Invalid/Malformed Origin (or "null"): Rejected with 403 FORBIDDEN.
 * 3. Server Configuration Invalid: Rejected with 403 FORBIDDEN (fail-closed).
 * 4. Origin Mismatch: Origin not in trusted list: Rejected with 403 FORBIDDEN.
 * 5. Valid Origin: Accepted.
 */
export function validateRequestOrigin(
  request: Request,
  options?: ValidateOriginOptions
): OriginValidationOutcome {
  const originHeader = request.headers.get("origin")?.trim();

  // 1. Missing Origin
  if (!originHeader) {
    return {
      valid: false,
      reason: "origin_missing",
      status: 403,
      code: "FORBIDDEN",
      message: "Header Origin wajib disertakan.",
    };
  }

  // 2. Invalid Origin (including browser "null" origin from sandboxed frames/data URLs)
  if (originHeader === "null") {
    return {
      valid: false,
      reason: "origin_invalid",
      status: 403,
      code: "FORBIDDEN",
      message: "Header Origin tidak valid.",
    };
  }

  const normalizedRequestOrigin = normalizeOrigin(originHeader);
  if (!normalizedRequestOrigin) {
    return {
      valid: false,
      reason: "origin_invalid",
      status: 403,
      code: "FORBIDDEN",
      message: "Header Origin tidak valid.",
    };
  }

  // 3. Resolve trusted origins from server authority or explicit test options
  let trustedOriginsSet: Set<string>;
  if (options?.trustedOrigins) {
    trustedOriginsSet = new Set();
    for (const item of options.trustedOrigins) {
      const norm = normalizeOrigin(item);
      if (norm) {
        trustedOriginsSet.add(norm);
      }
    }
  } else {
    const resolution = resolveTrustedOrigins(options?.env);
    if (!resolution.ok) {
      // Fail-closed: invalid or missing configuration must reject all state-changing requests
      return {
        valid: false,
        reason: "origin_mismatch",
        status: 403,
        code: "FORBIDDEN",
        message: resolution.errorMessage || "Origin permintaan tidak diizinkan.",
      };
    }
    trustedOriginsSet = resolution.origins;
  }

  // 4. Exact origin comparison (scheme + host + port)
  if (!trustedOriginsSet.has(normalizedRequestOrigin)) {
    return {
      valid: false,
      reason: "origin_mismatch",
      status: 403,
      code: "FORBIDDEN",
      message: "Origin permintaan tidak diizinkan.",
    };
  }

  return {
    valid: true,
    origin: normalizedRequestOrigin,
  };
}
