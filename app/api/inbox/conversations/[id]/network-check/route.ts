import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, getHelpdeskAdminClient } from "../../../../../../lib/supabase/server";
import { getHelpdeskPool } from "../../../../../../lib/postgres/server";
import {
  executeInboxNetworkCheck,
  InboxError,
  type Queryable,
} from "../../../../../../lib/application/inbox-service";
import { isValidUuid } from "../../../../../../lib/application/inbox-contracts";
import type { Database } from "../../../../../../lib/supabase/database.types";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status, headers: responseHeaders }
  );
}

export interface InboxNetworkCheckRouteDeps {
  getAuthClient?: () => Promise<{
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  }>;
  getSupabaseClient?: () => Promise<SupabaseClient<Database>>;
  getPool?: () => Queryable;
}

async function handleNetworkCheck(
  request: Request,
  context: { params: Promise<{ id: string }> },
  deps?: InboxNetworkCheckRouteDeps
) {
  // Explicit prototype switch: never auto-enable mock diagnostics on production
  if (process.env.NETWORK_PROVIDER !== "mock") {
    return failure(503, "PROVIDER_DISABLED", "Pemeriksaan mock belum diaktifkan.");
  }

  try {
    const authClient = deps?.getAuthClient ? await deps.getAuthClient() : await createClient();
    const { data: authData, error: authError } = await authClient.auth.getUser();

    if (authError || !authData.user) {
      return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.");
    }

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return failure(400, "INVALID_PARAMETER", "ID percakapan tidak valid.");
    }

    let scenario = "normal";
    try {
      const url = new URL(request.url);
      const queryScenario = url.searchParams.get("scenario");
      if (queryScenario) {
        scenario = queryScenario;
      } else if (request.method === "POST" && request.headers.get("content-type")?.includes("application/json")) {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (body && typeof body.scenario === "string") {
          scenario = body.scenario;
        }
      }
    } catch {}

    if (!/^[a-z][a-z0-9_]{0,63}$/.test(scenario)) {
      return failure(400, "INVALID_PARAMETER", "Nama skenario tidak valid.");
    }

    const staffId = authData.user.id;
    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();
    const supabaseClient = deps?.getSupabaseClient
      ? await deps.getSupabaseClient()
      : getHelpdeskAdminClient();

    const result = await executeInboxNetworkCheck(supabaseClient, pool, staffId, id, scenario);

    if (result.outcome === "ok" || result.outcome === "unresolved") {
      return NextResponse.json(
        { success: true, data: result, error: null },
        { headers: responseHeaders }
      );
    }

    const status =
      result.outcome === "not_found"
        ? 404
        : result.reason === "timeout"
        ? 504
        : 502;

    return NextResponse.json(
      {
        success: false,
        data: result,
        error: {
          code: (result.reason || "provider_error").toUpperCase(),
          message: "Pemeriksaan belum menghasilkan bukti lengkap. Periksa status tiap sumber.",
        },
      },
      { status, headers: responseHeaders }
    );
  } catch (err: unknown) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(503, "INSPECTION_UNAVAILABLE", "Pemeriksaan jaringan belum tersedia. Coba kembali.");
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
  deps?: InboxNetworkCheckRouteDeps
) {
  return handleNetworkCheck(request, context, deps);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
  deps?: InboxNetworkCheckRouteDeps
) {
  return handleNetworkCheck(request, context, deps);
}
