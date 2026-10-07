import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { getHelpdeskPool } from "../../../../../lib/postgres/server";
import { getInboxConversationDetail, InboxError, type Queryable } from "../../../../../lib/application/inbox-service";
import { isValidUuid } from "../../../../../lib/application/inbox-contracts";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status, headers: responseHeaders }
  );
}

export interface InboxConversationDetailRouteDeps {
  getAuthClient?: () => Promise<{ auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> } }>;
  getPool?: () => Queryable;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
  deps?: InboxConversationDetailRouteDeps
) {
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

    const staffId = authData.user.id;
    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();
    const result = await getInboxConversationDetail(pool, staffId, id);

    if (!result) {
      return failure(404, "CONVERSATION_NOT_FOUND", "Percakapan tidak ditemukan.");
    }

    return NextResponse.json(
      { success: true, data: result, error: null },
      { headers: responseHeaders }
    );
  } catch (err) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server saat memuat detail percakapan.");
  }
}
