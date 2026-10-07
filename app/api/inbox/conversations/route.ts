import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { getHelpdeskPool } from "../../../../lib/postgres/server";
import { listInboxConversations, InboxError, type Queryable } from "../../../../lib/application/inbox-service";
import { parseInboxListQuery } from "../../../../lib/application/inbox-contracts";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status, headers: responseHeaders }
  );
}

export interface InboxConversationsRouteDeps {
  getAuthClient?: () => Promise<{ auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> } }>;
  getPool?: () => Queryable;
}

export async function GET(
  request: Request,
  context?: { params?: Promise<Record<string, never>> } | InboxConversationsRouteDeps,
  maybeDeps?: InboxConversationsRouteDeps
) {
  try {
    const deps =
      context && ("getAuthClient" in context || "getPool" in context)
        ? (context as InboxConversationsRouteDeps)
        : maybeDeps;
    const authClient = deps?.getAuthClient ? await deps.getAuthClient() : await createClient();
    const { data: authData, error: authError } = await authClient.auth.getUser();

    if (authError || !authData.user) {
      return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.");
    }

    const staffId = authData.user.id;
    const url = new URL(request.url);
    const parsed = parseInboxListQuery(url.searchParams);

    if (!parsed.valid) {
      return failure(400, "INVALID_PARAMETER", parsed.error);
    }

    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();
    const result = await listInboxConversations(pool, staffId, parsed.query);

    return NextResponse.json(
      { success: true, data: result, error: null },
      { headers: responseHeaders }
    );
  } catch (err) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server saat memuat percakapan.");
  }
}
