import { NextResponse } from "next/server";
import { createClient } from "../../../../../../lib/supabase/server";
import { getHelpdeskPool } from "../../../../../../lib/postgres/server";
import { markConversationRead, InboxError, type Queryable } from "../../../../../../lib/application/inbox-service";
import { isValidUuid } from "../../../../../../lib/application/inbox-contracts";
import { validateRequestOrigin, type OriginValidationOutcome } from "../../../../../../lib/application/origin-validator";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status, headers: responseHeaders }
  );
}

export interface InboxReadRouteDeps {
  getAuthClient?: () => Promise<{ auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> } }>;
  getPool?: () => Queryable;
  validateOrigin?: (request: Request) => OriginValidationOutcome;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
  deps?: InboxReadRouteDeps
) {
  try {
    // 1. Origin / CSRF validation: strictly enforced BEFORE mutation, body parsing, auth, or DB access
    const originCheck = deps?.validateOrigin
      ? deps.validateOrigin(request)
      : validateRequestOrigin(request);
    if (!originCheck.valid) {
      return failure(originCheck.status, originCheck.code, originCheck.message);
    }

    // 2. Authentication check: staff session required
    const authClient = deps?.getAuthClient ? await deps.getAuthClient() : await createClient();
    const { data: authData, error: authError } = await authClient.auth.getUser();

    if (authError || !authData.user) {
      return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.");
    }

    // 3. Validate conversation ID parameter
    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return failure(400, "INVALID_PARAMETER", "ID percakapan tidak valid.");
    }

    // 4. Parse and validate JSON request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, "INVALID_JSON", "Format body request tidak valid.");
    }

    if (!body || typeof body !== "object") {
      return failure(400, "INVALID_PARAMETER", "Body request tidak valid.");
    }

    const payload = body as {
      lastReadMessageId?: unknown;
      acknowledgedMessageIds?: unknown;
    };

    if (!("lastReadMessageId" in payload) && !("acknowledgedMessageIds" in payload)) {
      return failure(400, "INVALID_PARAMETER", "Field 'lastReadMessageId' atau 'acknowledgedMessageIds' wajib disertakan.");
    }

    let lastReadMessageId: string | undefined;
    if (payload.lastReadMessageId !== undefined) {
      if (!isValidUuid(payload.lastReadMessageId)) {
        return failure(400, "INVALID_PARAMETER", "Field 'lastReadMessageId' harus berupa UUID yang valid.");
      }
      lastReadMessageId = payload.lastReadMessageId as string;
    }

    let acknowledgedMessageIds: string[] | undefined;
    if (payload.acknowledgedMessageIds !== undefined) {
      if (!Array.isArray(payload.acknowledgedMessageIds) || payload.acknowledgedMessageIds.length === 0) {
        return failure(400, "INVALID_PARAMETER", "Field 'acknowledgedMessageIds' harus berupa array UUID yang tidak kosong.");
      }
      for (const msgId of payload.acknowledgedMessageIds) {
        if (!isValidUuid(msgId)) {
          return failure(400, "INVALID_PARAMETER", "Setiap elemen 'acknowledgedMessageIds' harus berupa UUID yang valid.");
        }
      }
      acknowledgedMessageIds = payload.acknowledgedMessageIds as string[];
    }

    // Actor is strictly resolved from the authenticated server session, never from browser input.
    // If the client submitted an arbitrary 'staffId' in the body, it is completely ignored.
    const staffId = authData.user.id;
    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();

    const result = await markConversationRead(pool, staffId, {
      conversationId: id,
      lastReadMessageId,
      acknowledgedMessageIds,
    });

    return NextResponse.json(
      { success: true, data: result, error: null },
      { headers: responseHeaders }
    );
  } catch (err) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server saat memperbarui status baca.");
  }
}
