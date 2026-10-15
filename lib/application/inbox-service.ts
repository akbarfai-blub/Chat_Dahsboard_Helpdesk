import type { QueryResultRow, Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import {
  resolveInboxPagination,
  isValidUuid,
  type InboxConversationDetail,
  type InboxConversationItem,
  type InboxConversationListQuery,
  type InboxConversationListResult,
  type InboxEpisodeSummary,
  type InboxLastMessagePreview,
  type InboxMessageClassification,
  type InboxMessageDetail,
  type InboxSenderSummary,
  type InboxTriageAssessmentSummary,
  type MarkConversationReadCommand,
  type MarkConversationReadResult,
  type InboxConversationContext,
  type InboxNetworkCheckResult,
  type InboxConversationTopology,
  type InboxHistoricalAssessment,
  type InboxHistoricalAssessmentEvidence,
  type InboxActiveIncidentSummary,
  type InboxStaffClassification,
  type SaveStaffClassificationParams,
  type SaveStaffClassificationResult,
} from "./inbox-contracts";
import {
  type StaffClassificationCategory,
  type StaffClassificationStatus,
  determineStaffClassificationStatus,
  sanitizeClassificationNotes,
  validateClassificationCategory,
} from "../domain/staff-classification";
import { inHelpdeskTransaction } from "../postgres/transaction";
import {
  resolveSenderIdentity,
  type IdentityCandidate,
  type SenderKey,
} from "../domain/sender-identity";
import { inspectMockNetwork } from "./inspect-network";


export class InboxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "InboxError";
  }
}

export type RouteErrorCategory =
  | "DatabaseError"
  | "TlsError"
  | "NetworkError"
  | "ConfigurationError"
  | "UnknownError";

export interface RouteErrorDiagnostic {
  route: string;
  category: RouteErrorCategory;
  code: string;
}

const ALLOWED_TLS_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

const ALLOWED_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EPIPE",
]);

/**
 * Classifies unexpected route-level errors into safe, restricted diagnostics.
 * Strictly guarantees that raw error messages, stack traces, connection strings,
 * passwords, tokens, cookies, and customer payloads are never leaked to logs.
 */
export function classifyRouteError(route: string, err: unknown): RouteErrorDiagnostic {
  if (!err || typeof err !== "object") {
    return {
      route,
      category: "UnknownError",
      code: "UNEXPECTED_ERROR",
    };
  }

  const errObj = err as Record<string, unknown>;
  const rawCode = typeof errObj.code === "string" ? errObj.code.trim() : "";
  const name = typeof errObj.name === "string" ? errObj.name : "";
  const message = typeof errObj.message === "string" ? errObj.message : "";

  // 1. PostgreSQL SQLSTATE: 5 alphanumeric characters (e.g. 28P01, 08006, 57P01, 42P01)
  if (/^[0-9A-Z]{5}$/.test(rawCode)) {
    return {
      route,
      category: "DatabaseError",
      code: rawCode,
    };
  }

  // 2. TLS / Certificate errors
  if (ALLOWED_TLS_CODES.has(rawCode) || name === "TLSError") {
    return {
      route,
      category: "TlsError",
      code: ALLOWED_TLS_CODES.has(rawCode) ? rawCode : "TLS_ERROR",
    };
  }

  // 3. Network / POSIX system errors
  if (ALLOWED_NETWORK_CODES.has(rawCode)) {
    return {
      route,
      category: "NetworkError",
      code: rawCode,
    };
  }

  // 4. Configuration errors
  if (
    message.includes("is required") ||
    message.includes("Invalid HELPDESK_DATABASE_URL") ||
    message.includes("sslmode=verify-full") ||
    message.includes("Invalid database protocol")
  ) {
    return {
      route,
      category: "ConfigurationError",
      code: "CONFIG_ERROR",
    };
  }

  // 5. DatabaseError without recognized SQLSTATE code
  if (name === "DatabaseError") {
    return {
      route,
      category: "DatabaseError",
      code: "DATABASE_ERROR",
    };
  }

  // 6. Fallback generic diagnostic
  return {
    route,
    category: "UnknownError",
    code: "UNEXPECTED_ERROR",
  };
}

export interface Queryable {
  query: <R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[]
  ) => Promise<{ rows: R[]; rowCount?: number | null }>;
}

/**
 * Lists conversations with preview, last message, sender identity, latest episode, unread count,
 * needs-review flag, filtering, search, and stable pagination (25 items/page).
 */
export async function listInboxConversations(
  db: Queryable,
  staffId: string,
  query: InboxConversationListQuery
): Promise<InboxConversationListResult> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }

  const pagination = resolveInboxPagination(query.page, query.limit);
  if (!pagination.valid) {
    throw new InboxError("INVALID_PARAMETER", pagination.error, 400);
  }
  const { page, limit, offset } = pagination;

  // Build parameterized conditions
  const params: unknown[] = [staffId];
  const conversationFilters: string[] = [];
  const outerFilters: string[] = [];

  // Conversation status filter (active / closed / all)
  if (query.status && query.status !== "all") {
    params.push(query.status);
    conversationFilters.push(`c.status = $${params.length}`);
  }

  // Episode status filter
  if (query.episodeStatus) {
    if (query.episodeStatus === "none") {
      outerFilters.push(`ci.episode_id IS NULL`);
    } else if (query.episodeStatus === "any") {
      outerFilters.push(`ci.episode_id IS NOT NULL`);
    } else {
      params.push(query.episodeStatus);
      outerFilters.push(`ci.episode_status = $${params.length}`);
    }
  }

  // Unread filter
  if (query.unread !== undefined) {
    if (query.unread) {
      outerFilters.push(`ci.unread_count > 0`);
    } else {
      outerFilters.push(`ci.unread_count = 0`);
    }
  }

  // Needs review filter
  if (query.needsReview !== undefined) {
    if (query.needsReview) {
      outerFilters.push(`ci.needs_review = true`);
    } else {
      outerFilters.push(`ci.needs_review = false`);
    }
  }

  // Search filter
  if (query.search) {
    params.push(`%${query.search}%`);
    const searchParam = `$${params.length}`;
    outerFilters.push(`(
      ci.display_name_snapshot ILIKE ${searchParam}
      OR ci.sender_external_id ILIKE ${searchParam}
      OR ci.customer_name ILIKE ${searchParam}
      OR ci.episode_service_code ILIKE ${searchParam}
      OR ci.last_message_body ILIKE ${searchParam}
      OR EXISTS (
        SELECT 1
        FROM public.messages sm
        JOIN public.ingress_events sie ON sie.id = sm.id
        WHERE sm.conversation_id = ci.id AND sie.body ILIKE ${searchParam}
      )
    )`);
  }

  const convWhereClause = conversationFilters.length > 0
    ? `WHERE ${conversationFilters.join(" AND ")}`
    : "";

  const outerWhereClause = outerFilters.length > 0
    ? `WHERE ${outerFilters.join(" AND ")}`
    : "";

  // Common Table Expression (CTE) query following project architectural rules
  const baseCte = `
    WITH filtered_conversations AS (
      SELECT
        c.id,
        c.identity_id,
        c.channel,
        c.account_id,
        c.chat_id,
        c.status,
        c.started_at,
        c.last_activity_at,
        c.created_at,
        c.updated_at
      FROM public.conversations c
      ${convWhereClause}
    ),
    conversation_messages_agg AS (
      SELECT
        m.conversation_id,
        COUNT(m.id) AS total_messages,
        BOOL_OR(m.review_reason IS NOT NULL) AS has_review_reason
      FROM public.messages m
      GROUP BY m.conversation_id
    ),
    conversation_unread AS (
      SELECT
        m.conversation_id,
        COUNT(m.id) AS unread_count
      FROM public.messages m
      LEFT JOIN public.staff_message_reads smr
        ON smr.message_id = m.id AND smr.staff_id = $1 AND smr.is_confirmed = true
      WHERE smr.message_id IS NULL
      GROUP BY m.conversation_id
    ),
    latest_messages AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.id AS message_id,
        ie.body,
        ie.received_at,
        COALESCE(m.classification->>'category', 'unknown') AS category,
        m.review_reason
      FROM public.messages m
      JOIN public.ingress_events ie ON ie.id = m.id
      ORDER BY m.conversation_id, ie.received_at DESC, m.id DESC
    ),
    latest_episodes AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        comp.id AS episode_id,
        comp.status,
        comp.category,
        comp.service_id,
        s.service_code,
        comp.created_at,
        comp.updated_at
      FROM public.messages m
      JOIN public.complaints comp ON comp.id = m.complaint_id
      LEFT JOIN public.services s ON s.id = comp.service_id
      ORDER BY m.conversation_id, comp.created_at DESC, comp.id DESC
    ),
    combined_items AS (
      SELECT
        fc.id,
        fc.channel,
        fc.account_id,
        fc.chat_id,
        fc.status,
        fc.started_at,
        fc.last_activity_at,
        fc.created_at,
        fc.updated_at,
        ci.id AS sender_id,
        ci.sender_external_id,
        ci.display_name_snapshot,
        ci.verification_status,
        ci.customer_id,
        cust.display_name AS customer_name,
        lm.message_id AS last_message_id,
        lm.body AS last_message_body,
        lm.received_at AS last_message_received_at,
        lm.category AS last_message_category,
        lm.review_reason AS last_message_review_reason,
        le.episode_id,
        le.status AS episode_status,
        le.category AS episode_category,
        le.service_id AS episode_service_id,
        le.service_code AS episode_service_code,
        le.created_at AS episode_created_at,
        le.updated_at AS episode_updated_at,
        COALESCE(cu.unread_count, 0)::integer AS unread_count,
        (
          COALESCE(cma.has_review_reason, false)
          OR le.category = 'review'
        ) AS needs_review
      FROM filtered_conversations fc
      JOIN public.channel_identities ci ON ci.id = fc.identity_id
      LEFT JOIN public.customers cust ON cust.id = ci.customer_id
      LEFT JOIN conversation_messages_agg cma ON cma.conversation_id = fc.id
      LEFT JOIN conversation_unread cu ON cu.conversation_id = fc.id
      LEFT JOIN latest_messages lm ON lm.conversation_id = fc.id
      LEFT JOIN latest_episodes le ON le.conversation_id = fc.id
    )
  `;

  // Single-query CTE ensures total_count and paginated items are evaluated on the exact same snapshot
  const paginationParams = [...params, limit, offset];
  const limitParam = `$${paginationParams.length - 1}`;
  const offsetParam = `$${paginationParams.length}`;

  const unifiedListSql = `
    ${baseCte},
    matching_items AS (
      SELECT * FROM combined_items ci
      ${outerWhereClause}
    ),
    counted AS (
      SELECT COUNT(*)::integer AS total_count FROM matching_items
    ),
    paged AS (
      SELECT * FROM matching_items
      ORDER BY last_activity_at DESC, id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    )
    SELECT
      counted.total_count,
      paged.id AS paged_id,
      paged.*
    FROM counted
    LEFT JOIN paged ON true
    ORDER BY paged.last_activity_at DESC NULLS LAST, paged.id DESC NULLS LAST
  `;

  interface RowType {
    id: string;
    channel: string;
    account_id: string;
    chat_id: string;
    status: "active" | "closed";
    started_at: Date;
    last_activity_at: Date;
    sender_id: string;
    sender_external_id: string;
    display_name_snapshot: string | null;
    verification_status: "unverified" | "verified";
    customer_id: string | null;
    customer_name: string | null;
    last_message_id: string | null;
    last_message_body: string | null;
    last_message_received_at: Date | null;
    last_message_category: string | null;
    last_message_review_reason: string | null;
    episode_id: string | null;
    episode_status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | null;
    episode_category: "connection_complaint" | "other" | "review" | null;
    episode_service_id: string | null;
    episode_service_code: string | null;
    episode_created_at: Date | null;
    episode_updated_at: Date | null;
    unread_count: number;
    needs_review: boolean;
  }

  interface ListQueryRow extends RowType {
    total_count: number;
    paged_id: string | null;
  }

  const listResult = await db.query<ListQueryRow>(unifiedListSql, paginationParams);

  const totalCount = Number(listResult.rows[0]?.total_count ?? 0);
  const totalPages = Math.ceil(totalCount / limit) || (totalCount === 0 ? 0 : 1);

  // If paged_id is null (e.g. 0 matching items or offset >= totalCount), return empty items array
  const items: InboxConversationItem[] = listResult.rows[0]?.paged_id == null
    ? []
    : listResult.rows.map((row) => {
        const sender: InboxSenderSummary = {
          id: row.sender_id,
          senderExternalId: row.sender_external_id,
          displayName: row.display_name_snapshot,
          verificationStatus: row.verification_status,
          customerId: row.customer_id,
          customerName: row.customer_name,
        };

        const lastMessage: InboxLastMessagePreview | null = row.last_message_id
          ? {
              id: row.last_message_id,
              body: row.last_message_body || "",
              receivedAt: row.last_message_received_at
                ? new Date(row.last_message_received_at).toISOString()
                : new Date(row.last_activity_at).toISOString(),
              category: row.last_message_category || "other",
              reviewReason: row.last_message_review_reason,
            }
          : null;

        const latestEpisode: InboxEpisodeSummary | null = row.episode_id
          ? {
              id: row.episode_id,
              status: row.episode_status!,
              category: row.episode_category!,
              serviceId: row.episode_service_id,
              serviceCode: row.episode_service_code,
              createdAt: new Date(row.episode_created_at!).toISOString(),
              updatedAt: new Date(row.episode_updated_at!).toISOString(),
            }
          : null;

        return {
          id: row.id,
          channel: row.channel,
          accountId: row.account_id,
          chatId: row.chat_id,
          status: row.status,
          startedAt: new Date(row.started_at).toISOString(),
          lastActivityAt: new Date(row.last_activity_at).toISOString(),
          sender,
          lastMessage,
          latestEpisode,
          unreadCount: Number(row.unread_count),
          isUnread: Number(row.unread_count) > 0,
          needsReview: Boolean(row.needs_review),
        };
      });

  return {
    items,
    totalCount,
    page,
    limit,
    totalPages,
  };
}

/**
 * Returns conversation detail and chronologically ordered message history.
 * Strictly read-only: does NOT mutate read cursor or any other state.
 * Evaluates header metadata, sender identity, latest episode, messages, and unread counts
 * within a single consistent statement snapshot to prevent aggregate/item split-brain.
 */
export async function getInboxConversationDetail(
  db: Queryable,
  staffId: string,
  conversationId: string
): Promise<InboxConversationDetail | null> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }
  if (!isValidUuid(conversationId)) {
    throw new InboxError("INVALID_CONVERSATION_ID", "ID percakapan tidak valid.", 400);
  }

  // Single-query snapshot: conversation header, sender, episode, and message history
  const singleDetailSql = `
    SELECT
      c.id AS conv_id,
      c.channel AS conv_channel,
      c.account_id AS conv_account_id,
      c.chat_id AS conv_chat_id,
      c.status AS conv_status,
      c.started_at AS conv_started_at,
      c.last_activity_at AS conv_last_activity_at,
      ci.id AS sender_id,
      ci.sender_external_id,
      ci.display_name_snapshot,
      ci.verification_status,
      ci.customer_id,
      cust.display_name AS customer_name,
      le.episode_id,
      le.status AS episode_status,
      le.category AS episode_category,
      le.service_id AS episode_service_id,
      le.service_code AS episode_service_code,
      le.created_at AS episode_created_at,
      le.updated_at AS episode_updated_at,
      m.id AS message_id,
      m.identity_id AS message_identity_id,
      m.complaint_id AS message_complaint_id,
      m.classification AS message_classification,
      m.review_reason AS message_review_reason,
      m.created_at AS message_created_at,
      ie.channel AS message_channel,
      ie.account_id AS message_account_id,
      ie.chat_id AS message_chat_id,
      ie.provider_message_id AS message_provider_message_id,
      ie.body AS message_body,
      ie.received_at AS message_received_at,
      COALESCE(ie.message_type, 'text') AS message_type,
      COALESCE(ie.has_media, false) AS has_media,
      COALESCE(ie.is_forwarded, false) AS is_forwarded,
      ie.caption AS message_caption,
      COALESCE(ie.sender_info, '{}'::jsonb) AS message_sender_info,
      ta.decision AS message_decision,
      ta.processing_result AS message_processing_result,
      (smr.message_id IS NOT NULL AND smr.is_confirmed = true) AS is_read,
      smc.labeled_category AS staff_label_category,
      smc.status AS staff_label_status,
      smc.notes AS staff_label_notes,
      smc.staff_id AS staff_label_staff_id,
      u_staff.email AS staff_label_staff_email,
      smc.created_at AS staff_label_created_at,
      smc.updated_at AS staff_label_updated_at
    FROM public.conversations c
    JOIN public.channel_identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customers cust ON cust.id = ci.customer_id
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (m_sub.conversation_id)
        comp.id AS episode_id,
        comp.status,
        comp.category,
        comp.service_id,
        s.service_code,
        comp.created_at,
        comp.updated_at
      FROM public.messages m_sub
      JOIN public.complaints comp ON comp.id = m_sub.complaint_id
      LEFT JOIN public.services s ON s.id = comp.service_id
      WHERE m_sub.conversation_id = c.id
      ORDER BY m_sub.conversation_id, comp.created_at DESC, comp.id DESC
    ) le ON true
    LEFT JOIN public.messages m ON m.conversation_id = c.id
    LEFT JOIN public.ingress_events ie ON ie.id = m.id
    LEFT JOIN public.triage_assessments ta ON ta.message_id = m.id
    LEFT JOIN public.staff_message_reads smr
      ON smr.message_id = m.id AND smr.staff_id = $2 AND smr.is_confirmed = true
    LEFT JOIN public.staff_message_classifications smc ON smc.message_id = m.id
    LEFT JOIN auth.users u_staff ON u_staff.id = smc.staff_id
    WHERE c.id = $1
    ORDER BY ie.received_at ASC NULLS LAST, m.id ASC NULLS LAST
  `;

  interface DetailCombinedRow {
    conv_id: string;
    conv_channel: string;
    conv_account_id: string;
    conv_chat_id: string;
    conv_status: "active" | "closed";
    conv_started_at: Date;
    conv_last_activity_at: Date;
    sender_id: string;
    sender_external_id: string;
    display_name_snapshot: string | null;
    verification_status: "unverified" | "verified";
    customer_id: string | null;
    customer_name: string | null;
    episode_id: string | null;
    episode_status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | null;
    episode_category: "connection_complaint" | "other" | "review" | null;
    episode_service_id: string | null;
    episode_service_code: string | null;
    episode_created_at: Date | null;
    episode_updated_at: Date | null;
    message_id: string | null;
    message_identity_id: string | null;
    message_complaint_id: string | null;
    message_classification: unknown;
    message_review_reason: string | null;
    message_created_at: Date | null;
    message_channel: string | null;
    message_account_id: string | null;
    message_chat_id: string | null;
    message_provider_message_id: string | null;
    message_body: string | null;
    message_received_at: Date | null;
    message_type: string | null;
    has_media: boolean | null;
    is_forwarded: boolean | null;
    message_caption: string | null;
    message_sender_info: Record<string, unknown> | null;
    message_decision: {
      outcome?: string;
      reason?: string;
      category?: string;
      automation?: { mode?: string };
      emergencyStop?: boolean;
    } | null;
    message_processing_result: {
      claim?: { outcome?: string; reason?: string; intentId?: string | null };
      dispatchAuthorized?: boolean;
    } | null;
    is_read: boolean | null;
    staff_label_category?: "connection_complaint" | "other" | "review" | null;
    staff_label_status?: "confirmed" | "corrected" | null;
    staff_label_notes?: string | null;
    staff_label_staff_id?: string | null;
    staff_label_staff_email?: string | null;
    staff_label_created_at?: Date | string | null;
    staff_label_updated_at?: Date | string | null;
  }

  const res = await db.query<DetailCombinedRow>(singleDetailSql, [conversationId, staffId]);
  if (res.rows.length === 0) {
    return null;
  }

  const first = res.rows[0];
  const sender: InboxSenderSummary = {
    id: first.sender_id,
    senderExternalId: first.sender_external_id,
    displayName: first.display_name_snapshot,
    verificationStatus: first.verification_status,
    customerId: first.customer_id,
    customerName: first.customer_name,
  };

  const latestEpisode: InboxEpisodeSummary | null = first.episode_id
    ? {
        id: first.episode_id,
        status: first.episode_status!,
        category: first.episode_category!,
        serviceId: first.episode_service_id,
        serviceCode: first.episode_service_code,
        createdAt: new Date(first.episode_created_at!).toISOString(),
        updatedAt: new Date(first.episode_updated_at!).toISOString(),
      }
    : null;

  // Filter out any rows where message_id is null (e.g. conversation with 0 messages)
  const messageRows = res.rows.filter((r) => r.message_id != null);

  const messages: InboxMessageDetail[] = messageRows.map((row) => {
    let triageAssessment: InboxTriageAssessmentSummary | null = null;
    if (row.message_decision && row.message_processing_result) {
      triageAssessment = {
        decision: {
          outcome: row.message_decision.outcome || "unknown",
          reason: row.message_decision.reason || "unknown",
          category: row.message_decision.category || "unknown",
          mode: row.message_decision.automation?.mode || "SHADOW",
          emergencyStop: Boolean(row.message_decision.emergencyStop),
        },
        processingResult: {
          claim: {
            outcome: row.message_processing_result.claim?.outcome || "skipped",
            reason: row.message_processing_result.claim?.reason || "unknown",
            intentId: row.message_processing_result.claim?.intentId ?? null,
          },
          dispatchAuthorized: false,
        },
      };
    }

    const rawCls = row.message_classification as Record<string, unknown> | null;
    const classification: InboxMessageClassification = {
      category: typeof rawCls?.category === "string" && rawCls.category ? rawCls.category : "unknown",
      reason: typeof rawCls?.reason === "string" && rawCls.reason ? rawCls.reason : "unknown",
      ruleVersion: typeof rawCls?.ruleVersion === "string" && rawCls.ruleVersion ? rawCls.ruleVersion : "unknown",
      normalizedText: typeof rawCls?.normalizedText === "string" ? rawCls.normalizedText : null,
      matchedKeywords: Array.isArray(rawCls?.matchedKeywords)
        ? rawCls.matchedKeywords.filter((k): k is string => typeof k === "string")
        : [],
    };

    let staffClassification: InboxStaffClassification | null = null;
    if (row.staff_label_category && row.staff_label_staff_id) {
      staffClassification = {
        labeledCategory: row.staff_label_category,
        status: row.staff_label_status ?? "confirmed",
        notes: row.staff_label_notes ?? null,
        staffId: row.staff_label_staff_id,
        staffEmail: row.staff_label_staff_email ?? null,
        createdAt: new Date(row.staff_label_created_at!).toISOString(),
        updatedAt: new Date(row.staff_label_updated_at!).toISOString(),
      };
    }

    return {
      id: row.message_id!,
      conversationId: row.conv_id,
      identityId: row.message_identity_id!,
      direction: "inbound" as const,
      channel: row.message_channel!,
      accountId: row.message_account_id!,
      chatId: row.message_chat_id!,
      providerMessageId: row.message_provider_message_id!,
      body: row.message_body || "",
      receivedAt: new Date(row.message_received_at!).toISOString(),
      createdAt: new Date(row.message_created_at!).toISOString(),
      messageType: row.message_type!,
      hasMedia: Boolean(row.has_media),
      isForwarded: Boolean(row.is_forwarded),
      caption: row.message_caption,
      senderInfo: row.message_sender_info ?? {},
      classification,
      reviewReason: row.message_review_reason,
      complaintId: row.message_complaint_id,
      triageAssessment,
      staffClassification,
      isRead: Boolean(row.is_read),
    };
  });

  const unreadCount = messages.filter((m) => !m.isRead).length;
  const isUnread = unreadCount > 0;
  const hasReviewReason = messages.some((m) => m.reviewReason !== null);
  const needsReview = hasReviewReason || latestEpisode?.category === "review";

  return {
    id: first.conv_id,
    channel: first.conv_channel,
    accountId: first.conv_account_id,
    chatId: first.conv_chat_id,
    status: first.conv_status,
    startedAt: new Date(first.conv_started_at).toISOString(),
    lastActivityAt: new Date(first.conv_last_activity_at).toISOString(),
    sender,
    latestEpisode,
    unreadCount,
    isUnread,
    needsReview,
    messages,
  };
}

export interface MarkConversationReadOptions {
  readonly onBeforeCommit?: () => Promise<void>;
}

/**
 * Marks conversation messages read for the staff member.
 * Operates on explicit message acknowledgment (snapshot model) to ensure that messages
 * not yet visible or received in the detail snapshot remain unread, even if delayed,
 * committed out-of-order, or sharing identical timestamps.
 * 
 * Monotonically advances the conversation-level cursor in staff_conversation_reads.
 * Operates in an isolated database transaction with advisory transaction locking.
 * Does not alter complaint/episode status, automation settings, or outbound intents.
 */
export async function markConversationRead(
  db: Queryable,
  staffId: string,
  command: MarkConversationReadCommand,
  options?: MarkConversationReadOptions
): Promise<MarkConversationReadResult> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }
  if (!isValidUuid(command.conversationId)) {
    throw new InboxError("INVALID_CONVERSATION_ID", "ID percakapan tidak valid.", 400);
  }

  const hasAck = command.acknowledgedMessageIds !== undefined;
  const hasLastRead = command.lastReadMessageId !== undefined;

  if (!hasAck && !hasLastRead) {
    throw new InboxError(
      "INVALID_PARAMETER",
      "Field 'lastReadMessageId' atau 'acknowledgedMessageIds' wajib disertakan.",
      400
    );
  }

  if (hasLastRead && !isValidUuid(command.lastReadMessageId)) {
    throw new InboxError("INVALID_MESSAGE_ID", "ID pesan tidak valid.", 400);
  }

  if (hasAck) {
    if (!Array.isArray(command.acknowledgedMessageIds) || command.acknowledgedMessageIds.length === 0) {
      throw new InboxError("INVALID_PARAMETER", "Field 'acknowledgedMessageIds' harus berupa array UUID yang tidak kosong.", 400);
    }
    for (const id of command.acknowledgedMessageIds) {
      if (!isValidUuid(id)) {
        throw new InboxError("INVALID_MESSAGE_ID", "ID pesan tidak valid.", 400);
      }
    }
  }

  const isPool = "connect" in db && typeof (db as { connect: unknown }).connect === "function" && !("release" in db);
  const isClient = "release" in db && typeof (db as { release: unknown }).release === "function";

  const executeInTx = async (txDb: Queryable): Promise<MarkConversationReadResult> => {
    // 1. Advisory transaction lock scoped to (staffId, conversationId) to serialize concurrent mark-read requests
    await txDb.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [staffId, command.conversationId]
    );

    // 2. Resolve target messages to mark read
    let targetMessageIds: string[] = [];

    if (hasAck) {
      const uniqueRequestedIds = [...new Set(command.acknowledgedMessageIds!)];

      const checkRes = await txDb.query<{ id: string }>(
        `SELECT m.id
         FROM public.messages m
         WHERE m.conversation_id = $1 AND m.id = ANY($2::uuid[])`,
        [command.conversationId, uniqueRequestedIds]
      );

      if (checkRes.rows.length !== uniqueRequestedIds.length) {
        throw new InboxError(
          "MESSAGE_NOT_FOUND",
          "Satu atau lebih pesan tidak ditemukan pada percakapan ini.",
          404
        );
      }

      // If lastReadMessageId was also supplied alongside acknowledgedMessageIds, validate it belongs to this conversation as well
      if (hasLastRead) {
        const lastReadCheck = await txDb.query<{ id: string }>(
          `SELECT m.id
           FROM public.messages m
           WHERE m.id = $1 AND m.conversation_id = $2`,
          [command.lastReadMessageId, command.conversationId]
        );
        if (lastReadCheck.rows.length === 0) {
          throw new InboxError(
            "MESSAGE_NOT_FOUND",
            "Pesan tidak ditemukan pada percakapan ini.",
            404
          );
        }
      }

      // acknowledgedMessageIds strictly defines the set of messages to mark read. lastReadMessageId never expands it.
      targetMessageIds = uniqueRequestedIds;
    } else {
      // Legacy fallback: single lastReadMessageId only marks that exact single message, NEVER expands to earlier messages
      const msgCheck = await txDb.query<{ id: string }>(
        `SELECT m.id
         FROM public.messages m
         WHERE m.id = $1 AND m.conversation_id = $2`,
        [command.lastReadMessageId, command.conversationId]
      );

      if (msgCheck.rows.length === 0) {
        throw new InboxError(
          "MESSAGE_NOT_FOUND",
          "Pesan tidak ditemukan pada percakapan ini.",
          404
        );
      }

      targetMessageIds = [command.lastReadMessageId!];
    }

    // 3. Insert or confirm in public.staff_message_reads
    let newlyReadCount = 0;
    if (targetMessageIds.length > 0) {
      const insertRes = await txDb.query<{ message_id: string }>(
        `INSERT INTO public.staff_message_reads (staff_id, conversation_id, message_id, read_at, is_confirmed)
         SELECT $1, $2, unnest($3::uuid[]), now(), true
         ON CONFLICT (staff_id, message_id) DO UPDATE
         SET is_confirmed = true, read_at = now()
         WHERE NOT staff_message_reads.is_confirmed
         RETURNING message_id`,
        [staffId, command.conversationId, targetMessageIds]
      );
      newlyReadCount = insertRes.rowCount ?? insertRes.rows.length;
    }

    const advanced = newlyReadCount > 0;

    // 4. Update public.staff_conversation_reads directly in PostgreSQL with newest confirmed read message
    await txDb.query(
      `INSERT INTO public.staff_conversation_reads (
         staff_id, conversation_id, last_read_message_id, last_read_at, updated_at, is_confirmed
       )
       SELECT
         smr.staff_id,
         smr.conversation_id,
         m.id,
         ie.received_at,
         now(),
         true
       FROM public.staff_message_reads smr
       JOIN public.messages m ON m.id = smr.message_id
       JOIN public.ingress_events ie ON ie.id = m.id
       WHERE smr.staff_id = $1 AND smr.conversation_id = $2 AND smr.is_confirmed = true
       ORDER BY ie.received_at DESC, m.id DESC
       LIMIT 1
       ON CONFLICT (staff_id, conversation_id) DO UPDATE
       SET
         last_read_message_id = excluded.last_read_message_id,
         last_read_at = excluded.last_read_at,
         updated_at = now(),
         is_confirmed = true
       WHERE public.staff_conversation_reads.is_confirmed = false
          OR excluded.last_read_at > public.staff_conversation_reads.last_read_at
          OR (
            excluded.last_read_at = public.staff_conversation_reads.last_read_at
            AND excluded.last_read_message_id > public.staff_conversation_reads.last_read_message_id
          )`,
      [staffId, command.conversationId]
    );

    // 5. Read current confirmed cursor from staff_conversation_reads, preserving PostgreSQL microsecond precision
    const cursorRes = await txDb.query<{ last_read_message_id: string; last_read_at_iso: string }>(
      `SELECT
         last_read_message_id,
         to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_read_at_iso
       FROM public.staff_conversation_reads
       WHERE staff_id = $1 AND conversation_id = $2 AND is_confirmed = true`,
      [staffId, command.conversationId]
    );

    const effectiveCursor = cursorRes.rows[0];

    // 6. Calculate unread remaining for this staff in this conversation using confirmed reads
    const unreadRes = await txDb.query<{ count: string }>(
      `SELECT COUNT(m.id)::integer AS count
       FROM public.messages m
       LEFT JOIN public.staff_message_reads smr
         ON smr.message_id = m.id AND smr.staff_id = $1 AND smr.is_confirmed = true
       WHERE m.conversation_id = $2 AND smr.message_id IS NULL`,
      [staffId, command.conversationId]
    );

    // Optional test coordination hook (e.g. holding lock while concurrent client waits)
    if (options?.onBeforeCommit) {
      await options.onBeforeCommit();
    }

    return {
      success: true,
      conversationId: command.conversationId,
      lastReadMessageId: effectiveCursor ? effectiveCursor.last_read_message_id : "",
      lastReadAt: effectiveCursor ? effectiveCursor.last_read_at_iso : "",
      unreadRemaining: Number(unreadRes.rows[0]?.count ?? 0),
      advanced,
      newlyReadCount,
    };
  };

  if (isPool) {
    const client = await (db as unknown as { connect: () => Promise<Queryable & { release: (err?: boolean) => void }> }).connect();
    let broken = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await executeInTx(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }

  if (isClient) {
    await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    try {
      const result = await executeInTx(db);
      await db.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  // If db is neither a Pool nor PoolClient (e.g. mock Queryable), execute directly
  return executeInTx(db);
}

/**
 * Retrieves identity context, verified customer and services, ODP/ODC topology mapping,
 * historical triage assessment (at message processing time), and active relevant manual incidents.
 * Strictly read-only staff query using server-validated relations.
 */
export async function getInboxConversationContext(
  db: Queryable,
  staffId: string,
  conversationId: string
): Promise<InboxConversationContext | null> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }
  if (!isValidUuid(conversationId)) {
    throw new InboxError("INVALID_CONVERSATION_ID", "ID percakapan tidak valid.", 400);
  }

  // 1. Fetch conversation and sender identity
  const convSql = `
    SELECT
      c.id AS conv_id,
      c.identity_id,
      c.channel,
      c.account_id,
      c.chat_id,
      c.status AS conv_status,
      ci.id AS sender_id,
      ci.channel_account_id,
      ci.sender_external_id,
      ci.display_name_snapshot,
      ci.verification_status,
      ci.verified_at,
      ci.customer_id,
      cust.id AS cust_id,
      cust.display_name AS customer_name,
      cust.status AS customer_status
    FROM public.conversations c
    JOIN public.channel_identities ci ON ci.id = c.identity_id
    LEFT JOIN public.customers cust ON cust.id = ci.customer_id
    WHERE c.id = $1
  `;
  const convRes = await db.query<{
    conv_id: string;
    identity_id: string;
    channel: string;
    account_id: string;
    chat_id: string;
    conv_status: string;
    sender_id: string;
    channel_account_id: string;
    sender_external_id: string;
    display_name_snapshot: string | null;
    verification_status: "unverified" | "verified";
    verified_at: Date | string | null;
    customer_id: string | null;
    cust_id: string | null;
    customer_name: string | null;
    customer_status: string | null;
  }>(convSql, [conversationId]);

  if (convRes.rows.length === 0) {
    return null;
  }
  const convRow = convRes.rows[0];

  // 2. Fetch candidate services if customer is associated
  let serviceRows: { id: string; service_code: string; status: string }[] = [];
  if (convRow.cust_id) {
    const servSql = `
      SELECT id, service_code, status
      FROM public.services
      WHERE customer_id = $1
      ORDER BY created_at ASC
    `;
    const servRes = await db.query<{ id: string; service_code: string; status: string }>(servSql, [convRow.cust_id]);
    serviceRows = servRes.rows;
  }

  // 3. Resolve identity using pure domain policy
  const senderKey: SenderKey = {
    channel: convRow.channel,
    channelAccountId: convRow.channel_account_id,
    senderExternalId: convRow.sender_external_id,
  };
  const candidate: IdentityCandidate = {
    id: convRow.sender_id,
    channel: convRow.channel,
    channelAccountId: convRow.channel_account_id,
    senderExternalId: convRow.sender_external_id,
    customerId: convRow.customer_id,
    verificationStatus: convRow.verification_status,
    verifiedAt: convRow.verified_at ? new Date(convRow.verified_at).toISOString() : null,
    customer: convRow.cust_id
      ? {
          id: convRow.cust_id,
          status: convRow.customer_status || "active",
          services: serviceRows.map((s) => ({
            id: s.id,
            customerId: convRow.cust_id!,
            status: s.status,
          })),
        }
      : null,
  };

  const identityResolution = resolveSenderIdentity(
    senderKey,
    [candidate],
    new Date().toISOString()
  );

  // 4. Determine linked service
  let resolvedService: { id: string; serviceCode: string; status: string } | null = null;
  if (identityResolution.outcome === "resolved") {
    const found = serviceRows.find((s) => s.id === identityResolution.serviceId);
    if (found) {
      resolvedService = {
        id: found.id,
        serviceCode: found.service_code,
        status: found.status,
      };
    }
  }

  // 5. Fetch latest episode in conversation
  const episodeSql = `
    SELECT DISTINCT ON (m.conversation_id)
      comp.id AS episode_id,
      comp.status,
      comp.category,
      comp.service_id,
      s.service_code,
      comp.created_at,
      comp.updated_at
    FROM public.messages m
    JOIN public.complaints comp ON comp.id = m.complaint_id
    LEFT JOIN public.services s ON s.id = comp.service_id
    WHERE m.conversation_id = $1
    ORDER BY m.conversation_id, comp.created_at DESC, comp.id DESC
  `;
  const epRes = await db.query<{
    episode_id: string;
    status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    category: "connection_complaint" | "other" | "review";
    service_id: string | null;
    service_code: string | null;
    created_at: Date;
    updated_at: Date;
  }>(episodeSql, [conversationId]);

  const latestEpisode: InboxEpisodeSummary | null = epRes.rows[0]
    ? {
        id: epRes.rows[0].episode_id,
        status: epRes.rows[0].status,
        category: epRes.rows[0].category,
        serviceId: epRes.rows[0].service_id,
        serviceCode: epRes.rows[0].service_code,
        createdAt: new Date(epRes.rows[0].created_at).toISOString(),
        updatedAt: new Date(epRes.rows[0].updated_at).toISOString(),
      }
    : null;

  // Review Group 3: Service is strictly resolved via pure domain resolution.
  // Do NOT fall back to latest episode service if identity resolution resulted in manual/unresolved.
  const targetServiceId = identityResolution.outcome === "resolved" ? (resolvedService?.id ?? null) : null;

  // 6. Fetch topology mapping if a verified service is available
  let topology: InboxConversationTopology | null = null;
  if (targetServiceId) {
    const topSql = `
      SELECT
        st.mapping_version,
        st.source,
        st.valid_from,
        odp.id AS odp_id,
        odp.odp_code,
        odc.id AS odc_id,
        odc.odc_code
      FROM public.service_topology st
      JOIN public.odps odp ON odp.id = st.odp_id
      JOIN public.odcs odc ON odc.id = odp.odc_id
      WHERE st.service_id = $1 AND st.valid_to IS NULL
      ORDER BY st.mapping_version DESC
      LIMIT 1
    `;
    const topRes = await db.query<{
      mapping_version: number;
      source: string;
      valid_from: Date;
      odp_id: string;
      odp_code: string;
      odc_id: string;
      odc_code: string;
    }>(topSql, [targetServiceId]);

    if (topRes.rows[0]) {
      topology = {
        odpId: topRes.rows[0].odp_id,
        odpCode: topRes.rows[0].odp_code,
        odcId: topRes.rows[0].odc_id,
        odcCode: topRes.rows[0].odc_code,
        mappingVersion: topRes.rows[0].mapping_version,
        source: topRes.rows[0].source,
        validFrom: new Date(topRes.rows[0].valid_from).toISOString(),
      };
    }
  }

  // 7. Fetch latest triage assessment in this conversation
  const taSql = `
    SELECT
      ta.message_id,
      ta.decision,
      ta.processing_result,
      ta.created_at
    FROM public.messages m
    JOIN public.triage_assessments ta ON ta.message_id = m.id
    WHERE m.conversation_id = $1
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  `;
  const taRes = await db.query<{
    message_id: string;
    decision: Record<string, unknown>;
    processing_result: Record<string, unknown>;
    created_at: Date;
  }>(taSql, [conversationId]);

  let historicalAssessment: InboxHistoricalAssessment | null = null;
  if (taRes.rows[0]) {
    const row = taRes.rows[0];
    const dec = (row.decision || {}) as Record<string, unknown>;
    const pr = (row.processing_result || {}) as Record<string, unknown>;

    const rawEvidence = Array.isArray(dec.evidence) ? (dec.evidence as Record<string, unknown>[]) : [];
    const evidenceList: InboxHistoricalAssessmentEvidence[] = rawEvidence.map((ev) => {
      const kind = (ev.kind as InboxHistoricalAssessmentEvidence["kind"]) || "onu";
      let summary = "";
      if (kind === "onu") {
        summary = `Perangkat ONU: ${ev.status || "unknown"}`;
      } else if (kind === "upstream") {
        summary = `Tautan upstream: ${ev.linkId || "-"}`;
      } else if (kind === "area") {
        summary = `Area ${ev.scope || "ODP"}: ${ev.los ?? 0} LOS / ${ev.valid ?? 0} valid / ${ev.total ?? 0} total`;
      } else if (kind === "incident") {
        summary = `Incident manual ID: ${ev.id || "-"}`;
      } else if (kind === "mapping") {
        summary = `Mapping ODP/ODC versi ${ev.version || 1}`;
      }
      return {
        kind,
        summary,
        details: ev,
      };
    });

    const automation = (dec.automation || {}) as Record<string, unknown>;

    historicalAssessment = {
      messageId: row.message_id,
      evaluatedAt: dec.evaluatedAt
        ? String(dec.evaluatedAt)
        : new Date(row.created_at).toISOString(),
      ruleVersion: String(dec.ruleVersion || "triage-v1"),
      outcome: (dec.outcome === "candidate" ? "candidate" : "review") as "candidate" | "review",
      reason: String(dec.reason || "unknown"),
      candidateTemplateKey: dec.candidateTemplateKey ? String(dec.candidateTemplateKey) : null,
      effectiveTemplateKey: dec.effectiveTemplateKey ? String(dec.effectiveTemplateKey) : null,
      incidentId: dec.incidentId ? String(dec.incidentId) : null,
      eventIds: Array.isArray(dec.eventIds) ? dec.eventIds.map(String) : [],
      notes: Array.isArray(dec.notes) ? dec.notes.map(String) : [],
      automation: {
        mode: automation.mode ? String(automation.mode) : null,
        disposition: String(automation.disposition || "blocked"),
        blockedReasons: Array.isArray(automation.blockedReasons) ? automation.blockedReasons.map(String) : [],
      },
      evidence: evidenceList,
      providerQuality: (pr.providerQuality as Record<string, unknown>) || null,
    };
  }

  // 8. Fetch active manual incidents
  const incSql = `
    SELECT id, type, status, odp_ids, odc_ids, version
    FROM public.incidents
    WHERE status = 'ACTIVE'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const incRes = await db.query<{
    id: string;
    type: "GENERAL" | "AREA_SPECIFIC";
    status: "ACTIVE";
    odp_ids: string[];
    odc_ids: string[];
    version: number;
  }>(incSql);

  let activeIncident: InboxActiveIncidentSummary | null = null;
  if (incRes.rows[0]) {
    const inc = incRes.rows[0];
    const isGeneral = inc.type === "GENERAL";
    const isAreaMatch =
      inc.type === "AREA_SPECIFIC" &&
      topology &&
      (inc.odp_ids?.includes(topology.odpId) || inc.odc_ids?.includes(topology.odcId));

    if (isGeneral || isAreaMatch) {
      activeIncident = {
        id: inc.id,
        type: inc.type,
        status: inc.status,
        odpIds: inc.odp_ids || [],
        odcIds: inc.odc_ids || [],
        version: inc.version,
      };
    }
  }

  return {
    conversationId: convRow.conv_id,
    sender: {
      id: convRow.sender_id,
      senderExternalId: convRow.sender_external_id,
      displayName: convRow.display_name_snapshot,
      verificationStatus: convRow.verification_status,
      verifiedAt: convRow.verified_at ? new Date(convRow.verified_at).toISOString() : null,
    },
    identityResolution: {
      outcome: identityResolution.outcome,
      reason: identityResolution.reason,
      ruleVersion: identityResolution.ruleVersion,
    },
    customer: convRow.cust_id
      ? {
          id: convRow.cust_id,
          displayName: convRow.customer_name,
          status: convRow.customer_status || "active",
        }
      : null,
    service: resolvedService,
    candidateServices: serviceRows.map((s) => ({
      id: s.id,
      serviceCode: s.service_code,
      status: s.status,
    })),
    topology,
    latestEpisode,
    historicalAssessment,
    activeIncident,
  };
}

/**
 * Executes on-demand live network check for staff.
 * Crucial rules:
 * - Does NOT perform outbound or create claims.
 * - Does NOT mutate complaint episode or automation mode.
 * - Does NOT call provider in a transaction.
 * - Strictly validates staff session and verified single service.
 */
export async function executeInboxNetworkCheck(
  client: SupabaseClient<Database>,
  db: Queryable,
  staffId: string,
  conversationId: string,
  scenarioId = "normal",
  inspector: typeof inspectMockNetwork = inspectMockNetwork
): Promise<InboxNetworkCheckResult> {
  const context = await getInboxConversationContext(db, staffId, conversationId);
  if (!context) {
    throw new InboxError("CONVERSATION_NOT_FOUND", "Percakapan tidak ditemukan.", 404);
  }

  // Safe fallback if identity or service is unresolved: do NOT attempt mock provider check
  if (
    context.identityResolution.outcome !== "resolved" ||
    !context.customer?.id ||
    !context.service?.id
  ) {
    return {
      outcome: "unresolved",
      reason: context.identityResolution.reason,
      source: "MOCK",
      scenarioId,
      customerId: context.customer?.id ?? null,
      serviceId: context.service?.id ?? null,
      checkedAt: new Date().toISOString(),
      onu: {
        status: "unknown",
        reportedStatus: null,
        quality: "unknown",
        observedAt: null,
        eventId: null,
        source: "MOCK",
      },
      upstream: [],
      upstreamQuality: "not_found",
      areas: [],
      indicatedArea: null,
      mapping: null,
    };
  }

  // Perform mock provider check
  const checkResult = await inspector(
    client,
    context.customer.id,
    context.service.id,
    scenarioId
  );

  return {
    outcome: checkResult.outcome,
    reason: checkResult.reason,
    source: checkResult.source,
    scenarioId: checkResult.scenarioId,
    customerId: checkResult.customerId,
    serviceId: checkResult.serviceId,
    checkedAt: checkResult.checkedAt,
    onu: {
      status: checkResult.onu.status,
      reportedStatus: checkResult.onu.reportedStatus,
      quality: checkResult.onu.quality,
      observedAt: checkResult.onu.observedAt,
      eventId: checkResult.onu.eventId,
      source: checkResult.onu.source,
    },
    upstream: checkResult.upstream.map((u) => ({
      linkId: u.linkId,
      mappingVersion: u.mappingVersion,
      observation: {
        status: u.observation.status,
        reportedStatus: u.observation.reportedStatus,
        quality: u.observation.quality,
        observedAt: u.observation.observedAt,
        eventId: u.observation.eventId,
      },
    })),
    upstreamQuality: checkResult.upstreamQuality,
    areas: checkResult.areas.map((a) => {
      // Area indication freshness rule: An aggregate conclusion remains fresh only as long
      // as its supporting member observations remain fresh. We derive observedAt from the
      // oldest observation timestamp among members supporting valid/LOS/coverage.
      const validMemberObservedAts = (a.members || [])
        .filter(
          (m) =>
            m.observation?.quality === "fresh" &&
            (m.observation?.status === "online" || m.observation?.status === "LOS") &&
            typeof m.observation?.observedAt === "string"
        )
        .map((m) => m.observation.observedAt as string)
        .filter((t) => Number.isFinite(Date.parse(t)));

      const oldestSupportingObservedAt =
        validMemberObservedAts.length > 0 ? validMemberObservedAts.sort()[0] : null;

      return {
        scope: a.scope,
        scopeId: a.scopeId,
        state: a.state,
        total: a.total,
        valid: a.valid,
        los: a.los,
        coverage: a.coverage,
        losRatio: a.losRatio,
        thresholdVersion: a.thresholdVersion,
        observedAt: oldestSupportingObservedAt,
      };
    }),
    indicatedArea: checkResult.indicatedArea,
    mapping: checkResult.mapping,
  };
}

export interface SaveStaffClassificationOptions {
  readonly onBeforeCommit?: () => Promise<void>;
}

export interface StaffClassificationHistoryItem {
  readonly id: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly staffId: string;
  readonly staffEmail: string | null;
  readonly labeledCategory: StaffClassificationCategory;
  readonly status: StaffClassificationStatus;
  readonly notes: string | null;
  readonly previousCategory: StaffClassificationCategory | null;
  readonly originalCategory: string;
  readonly ruleVersion: string;
  readonly matchedKeywords: readonly string[];
  readonly createdAt: string;
}

/**
 * Saves a staff classification label or correction for an inbound message.
 *
 * Requirements:
 * - Preserves original rule category, rule version, and matched keywords.
 * - Resolves staff actor strictly from session, and timestamp from server clock (now()).
 * - Derives status: 'confirmed' if labeled_category === original_category, else 'corrected'.
 * - Records every change to public.staff_message_classification_history for full traceability.
 * - Handles repeated saves idempotently: if category and notes are identical, returns active label without creating redundant history rows.
 * - Uses inHelpdeskTransaction / advisory lock to guarantee consistency under concurrent updates.
 * - Does not re-trigger triage, modify episodes, claims, or outbound intents (annotation-only).
 */
export async function saveStaffMessageClassification(
  db: Queryable,
  staffId: string,
  params: SaveStaffClassificationParams,
  options?: SaveStaffClassificationOptions
): Promise<SaveStaffClassificationResult> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }
  if (!isValidUuid(params.conversationId)) {
    throw new InboxError("INVALID_CONVERSATION_ID", "ID percakapan tidak valid.", 400);
  }
  if (!isValidUuid(params.messageId)) {
    throw new InboxError("INVALID_MESSAGE_ID", "ID pesan tidak valid.", 400);
  }

  const validatedCategory = validateClassificationCategory(params.category);
  const sanitizedNotes = sanitizeClassificationNotes(params.notes);

  const executeInTx = async (txDb: Queryable): Promise<SaveStaffClassificationResult> => {
    // 1. Verify staff session exists
    const staffRes = await txDb.query<{ id: string; email: string | null }>(
      "SELECT id, email FROM auth.users WHERE id = $1",
      [staffId]
    );
    if (staffRes.rows.length === 0) {
      throw new InboxError("UNAUTHENTICATED", "Sesi staf tidak valid.", 401);
    }
    const staffEmail = staffRes.rows[0].email;

    // 2. Lock and retrieve message in conversation
    const msgRes = await txDb.query<{
      id: string;
      conversation_id: string;
      classification: unknown;
    }>(
      `SELECT m.id, m.conversation_id, m.classification
       FROM public.messages m
       WHERE m.id = $1 AND m.conversation_id = $2
       FOR UPDATE OF m`,
      [params.messageId, params.conversationId]
    );

    if (msgRes.rows.length === 0) {
      throw new InboxError("MESSAGE_NOT_FOUND", "Pesan tidak ditemukan pada percakapan ini.", 404);
    }

    const msgRow = msgRes.rows[0];
    const rawCls = msgRow.classification as Record<string, unknown> | null;
    const originalCategory = typeof rawCls?.category === "string" && rawCls.category ? rawCls.category : "unknown";
    const ruleVersion = typeof rawCls?.ruleVersion === "string" && rawCls.ruleVersion ? rawCls.ruleVersion : "unknown";
    const matchedKeywords: string[] = Array.isArray(rawCls?.matchedKeywords)
      ? rawCls.matchedKeywords.filter((k): k is string => typeof k === "string")
      : [];

    const status = determineStaffClassificationStatus(validatedCategory, originalCategory);

    // 3. Check existing active label
    const existingRes = await txDb.query<{
      labeled_category: StaffClassificationCategory;
      status: StaffClassificationStatus;
      notes: string | null;
      staff_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT labeled_category, status, notes, staff_id, created_at, updated_at
       FROM public.staff_message_classifications
       WHERE message_id = $1
       FOR UPDATE`,
      [params.messageId]
    );

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      // Idempotent repeated save check: same category and same notes
      if (existing.labeled_category === validatedCategory && (existing.notes ?? null) === sanitizedNotes) {
        if (options?.onBeforeCommit) {
          await options.onBeforeCommit();
        }
        let resolvedStaffEmail = staffEmail;
        if (existing.staff_id !== staffId) {
          try {
            const userRes = await txDb.query<{ email: string }>(
              `SELECT email FROM auth.users WHERE id = $1`,
              [existing.staff_id]
            );
            resolvedStaffEmail = userRes.rows[0]?.email ?? null;
          } catch {
            resolvedStaffEmail = null;
          }
        }
        return {
          saved: true,
          isIdempotent: true,
          classification: {
            labeledCategory: existing.labeled_category,
            status: existing.status,
            notes: existing.notes,
            staffId: existing.staff_id,
            staffEmail: resolvedStaffEmail,
            createdAt: new Date(existing.created_at).toISOString(),
            updatedAt: new Date(existing.updated_at).toISOString(),
          },
        };
      }
    }

    const previousCategory = existingRes.rows.length > 0 ? existingRes.rows[0].labeled_category : null;

    // 4. Upsert active classification record
    const upsertRes = await txDb.query<{
      labeled_category: StaffClassificationCategory;
      status: StaffClassificationStatus;
      notes: string | null;
      staff_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO public.staff_message_classifications (
         message_id, conversation_id, staff_id, labeled_category, status,
         notes, original_category, rule_version, matched_keywords, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())
       ON CONFLICT (message_id) DO UPDATE SET
         conversation_id = EXCLUDED.conversation_id,
         staff_id = EXCLUDED.staff_id,
         labeled_category = EXCLUDED.labeled_category,
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         updated_at = now()
       RETURNING labeled_category, status, notes, staff_id, created_at, updated_at`,
      [
        params.messageId,
        params.conversationId,
        staffId,
        validatedCategory,
        status,
        sanitizedNotes,
        originalCategory,
        ruleVersion,
        JSON.stringify(matchedKeywords),
      ]
    );

    // 5. Append to historical audit log
    await txDb.query(
      `INSERT INTO public.staff_message_classification_history (
         message_id, conversation_id, staff_id, labeled_category, status,
         notes, previous_category, original_category, rule_version, matched_keywords, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())`,
      [
        params.messageId,
        params.conversationId,
        staffId,
        validatedCategory,
        status,
        sanitizedNotes,
        previousCategory,
        originalCategory,
        ruleVersion,
        JSON.stringify(matchedKeywords),
      ]
    );

    if (options?.onBeforeCommit) {
      await options.onBeforeCommit();
    }

    const savedRow = upsertRes.rows[0];
    return {
      saved: true,
      isIdempotent: false,
      classification: {
        labeledCategory: savedRow.labeled_category,
        status: savedRow.status,
        notes: savedRow.notes,
        staffId: savedRow.staff_id,
        staffEmail,
        createdAt: new Date(savedRow.created_at).toISOString(),
        updatedAt: new Date(savedRow.updated_at).toISOString(),
      },
    };
  };

  const isPool = "connect" in db && typeof (db as { connect: unknown }).connect === "function" && !("release" in db);
  if (isPool) {
    return inHelpdeskTransaction(db as unknown as Pool, executeInTx);
  }
  return executeInTx(db);
}

/**
 * Retrieves the full audit history of classification labeling/corrections for a specific message.
 */
export async function getStaffMessageClassificationHistory(
  db: Queryable,
  staffId: string,
  conversationId: string,
  messageId: string
): Promise<StaffClassificationHistoryItem[]> {
  if (!isValidUuid(staffId)) {
    throw new InboxError("INVALID_STAFF_ID", "ID staf tidak valid.", 401);
  }
  if (!isValidUuid(conversationId)) {
    throw new InboxError("INVALID_CONVERSATION_ID", "ID percakapan tidak valid.", 400);
  }
  if (!isValidUuid(messageId)) {
    throw new InboxError("INVALID_MESSAGE_ID", "ID pesan tidak valid.", 400);
  }

  // Verify message exists in conversation
  const msgCheck = await db.query(
    "SELECT id FROM public.messages WHERE id = $1 AND conversation_id = $2",
    [messageId, conversationId]
  );
  if (msgCheck.rows.length === 0) {
    throw new InboxError("MESSAGE_NOT_FOUND", "Pesan tidak ditemukan pada percakapan ini.", 404);
  }

  const res = await db.query<{
    id: string;
    message_id: string;
    conversation_id: string;
    staff_id: string;
    staff_email: string | null;
    labeled_category: StaffClassificationCategory;
    status: StaffClassificationStatus;
    notes: string | null;
    previous_category: StaffClassificationCategory | null;
    original_category: string;
    rule_version: string;
    matched_keywords: unknown;
    created_at: Date;
  }>(
    `SELECT
       h.id,
       h.message_id,
       h.conversation_id,
       h.staff_id,
       u.email AS staff_email,
       h.labeled_category,
       h.status,
       h.notes,
       h.previous_category,
       h.original_category,
       h.rule_version,
       h.matched_keywords,
       h.created_at
     FROM public.staff_message_classification_history h
     LEFT JOIN auth.users u ON u.id = h.staff_id
     WHERE h.message_id = $1 AND h.conversation_id = $2
     ORDER BY h.created_at DESC, h.id DESC`,
    [messageId, conversationId]
  );

  return res.rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    conversationId: r.conversation_id,
    staffId: r.staff_id,
    staffEmail: r.staff_email,
    labeledCategory: r.labeled_category,
    status: r.status,
    notes: r.notes,
    previousCategory: r.previous_category,
    originalCategory: r.original_category,
    ruleVersion: r.rule_version,
    matchedKeywords: Array.isArray(r.matched_keywords)
      ? r.matched_keywords.filter((k): k is string => typeof k === "string")
      : [],
    createdAt: new Date(r.created_at).toISOString(),
  }));
}


