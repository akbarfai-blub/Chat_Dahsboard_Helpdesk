import { NextResponse } from "next/server";
import { createClient } from "../../../../../../../../lib/supabase/server";
import { getHelpdeskPool } from "../../../../../../../../lib/postgres/server";
import {
  saveStaffMessageClassification,
  getStaffMessageClassificationHistory,
  InboxError,
  type Queryable,
} from "../../../../../../../../lib/application/inbox-service";
import { isValidUuid } from "../../../../../../../../lib/application/inbox-contracts";
import {
  validateRequestOrigin,
  type OriginValidationOutcome,
} from "../../../../../../../../lib/application/origin-validator";
import {
  isValidClassificationCategory,
  type StaffClassificationCategory,
} from "../../../../../../../../lib/domain/staff-classification";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status, headers: responseHeaders }
  );
}

export interface InboxClassificationRouteDeps {
  getAuthClient?: () => Promise<{
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  }>;
  getPool?: () => Queryable;
  validateOrigin?: (request: Request) => OriginValidationOutcome;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
  deps?: InboxClassificationRouteDeps
) {
  try {
    // 1. Origin / CSRF validation: strictly enforced BEFORE mutation or body parsing
    const originCheck = deps?.validateOrigin
      ? deps.validateOrigin(request)
      : validateRequestOrigin(request);
    if (!originCheck.valid) {
      return failure(originCheck.status, originCheck.code, originCheck.message);
    }

    // 2. Authentication check: staff session required (cookie or Authorization Bearer header)
    const authHeader = request.headers.get("Authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
    const authClient = deps?.getAuthClient ? await deps.getAuthClient() : await createClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(bearerToken);

    if (authError || !authData.user) {
      return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.");
    }

    // 3. Validate route parameters
    const { id: conversationId, messageId } = await context.params;
    if (!isValidUuid(conversationId)) {
      return failure(400, "INVALID_PARAMETER", "ID percakapan tidak valid.");
    }
    if (!isValidUuid(messageId)) {
      return failure(400, "INVALID_PARAMETER", "ID pesan tidak valid.");
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

    const payload = body as { category?: unknown; labeledCategory?: unknown; notes?: unknown };
    const targetCategory = payload.category ?? payload.labeledCategory;

    if (!targetCategory || !isValidClassificationCategory(targetCategory)) {
      return failure(
        400,
        "INVALID_PARAMETER",
        "Field 'category' wajib berupa salah satu dari: connection_complaint, other, review."
      );
    }

    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") {
      return failure(400, "INVALID_PARAMETER", "Field 'notes' harus berupa teks.");
    }

    if (typeof payload.notes === "string" && payload.notes.trim().length > 1000) {
      return failure(400, "INVALID_PARAMETER", "Catatan klasifikasi tidak boleh melebihi 1000 karakter.");
    }

    // 5. Staff actor strictly bound from authenticated session
    const staffId = authData.user.id;
    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();

    const result = await saveStaffMessageClassification(pool, staffId, {
      conversationId,
      messageId,
      category: targetCategory as StaffClassificationCategory,
      notes: typeof payload.notes === "string" ? payload.notes : null,
    });

    return NextResponse.json(
      { success: true, data: result, error: null },
      { headers: responseHeaders }
    );
  } catch (err: unknown) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server saat menyimpan label klasifikasi.");
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
  deps?: InboxClassificationRouteDeps
) {
  try {
    // 1. Authentication check
    const authHeader = _request.headers.get("Authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
    const authClient = deps?.getAuthClient ? await deps.getAuthClient() : await createClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(bearerToken);

    if (authError || !authData.user) {
      return failure(401, "UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.");
    }

    // 2. Validate route parameters
    const { id: conversationId, messageId } = await context.params;
    if (!isValidUuid(conversationId)) {
      return failure(400, "INVALID_PARAMETER", "ID percakapan tidak valid.");
    }
    if (!isValidUuid(messageId)) {
      return failure(400, "INVALID_PARAMETER", "ID pesan tidak valid.");
    }

    const staffId = authData.user.id;
    const pool = deps?.getPool ? deps.getPool() : getHelpdeskPool();

    const history = await getStaffMessageClassificationHistory(
      pool,
      staffId,
      conversationId,
      messageId
    );

    return NextResponse.json(
      { success: true, data: history, error: null },
      { headers: responseHeaders }
    );
  } catch (err: unknown) {
    if (err instanceof InboxError) {
      return failure(err.status, err.code, err.message);
    }
    return failure(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server saat membaca riwayat klasifikasi.");
  }
}
