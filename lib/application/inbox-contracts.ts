/**
 * Contracts and types for Helpdesk Inbox data layer and staff access (P2.6 Tahap 1).
 *
 * Rules:
 * - Read-only staff queries with parameterized SQL and standard application envelopes.
 * - Persistent per-staff unread tracking isolated to the session actor.
 * - Non-complaint messages remain visible (decoupled from complaint episodes).
 * - Stable pagination (default 25 items per page) sorted by (last_activity_at DESC, id DESC).
 */

export const INBOX_DEFAULT_PAGE_LIMIT = 25;
export const INBOX_MAX_PAGE_LIMIT = 25;

export interface InboxSenderSummary {
  readonly id: string;
  readonly senderExternalId: string;
  readonly displayName: string | null;
  readonly verificationStatus: "unverified" | "verified";
  readonly customerId: string | null;
  readonly customerName: string | null;
}

export interface InboxLastMessagePreview {
  readonly id: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly category: string;
  readonly reviewReason: string | null;
}

export interface InboxEpisodeSummary {
  readonly id: string;
  readonly status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  readonly category: "connection_complaint" | "other" | "review";
  readonly serviceId: string | null;
  readonly serviceCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboxConversationItem {
  readonly id: string;
  readonly channel: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly status: "active" | "closed";
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly sender: InboxSenderSummary;
  readonly lastMessage: InboxLastMessagePreview | null;
  readonly latestEpisode: InboxEpisodeSummary | null;
  readonly unreadCount: number;
  readonly isUnread: boolean;
  readonly needsReview: boolean;
}

export type InboxEpisodeStatusFilter = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "none" | "any";

export interface InboxConversationListQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: "active" | "closed" | "all";
  readonly episodeStatus?: InboxEpisodeStatusFilter;
  readonly unread?: boolean;
  readonly needsReview?: boolean;
  readonly search?: string;
}

export interface InboxConversationListResult {
  readonly items: readonly InboxConversationItem[];
  readonly totalCount: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface InboxMessageClassification {
  readonly category: string;
  readonly reason: string;
  readonly ruleVersion: string;
  readonly normalizedText: string | null;
  readonly matchedKeywords: readonly string[];
}

export interface InboxTriageAssessmentSummary {
  readonly decision: {
    readonly outcome: string;
    readonly reason: string;
    readonly category: string;
    readonly mode: string;
    readonly emergencyStop: boolean;
  };
  readonly processingResult: {
    readonly claim: {
      readonly outcome: string;
      readonly reason: string;
      readonly intentId?: string | null;
    };
    readonly dispatchAuthorized: boolean;
  };
}

export interface InboxMessageDetail {
  readonly id: string;
  readonly conversationId: string;
  readonly identityId: string;
  readonly direction: "inbound";
  readonly channel: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly providerMessageId: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly createdAt: string;
  readonly messageType: string;
  readonly hasMedia: boolean;
  readonly isForwarded: boolean;
  readonly caption: string | null;
  readonly senderInfo: Record<string, unknown>;
  readonly classification: InboxMessageClassification;
  readonly reviewReason: string | null;
  readonly complaintId: string | null;
  readonly triageAssessment: InboxTriageAssessmentSummary | null;
  readonly isRead: boolean;
}

export interface InboxConversationDetail {
  readonly id: string;
  readonly channel: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly status: "active" | "closed";
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly sender: InboxSenderSummary;
  readonly latestEpisode: InboxEpisodeSummary | null;
  readonly unreadCount: number;
  readonly isUnread: boolean;
  readonly needsReview: boolean;
  readonly messages: readonly InboxMessageDetail[];
}

export interface MarkConversationReadCommand {
  readonly conversationId: string;
  readonly lastReadMessageId?: string;
  readonly acknowledgedMessageIds?: readonly string[];
}

export interface MarkConversationReadResult {
  readonly success: boolean;
  readonly conversationId: string;
  readonly lastReadMessageId: string;
  readonly lastReadAt: string;
  readonly unreadRemaining: number;
  readonly advanced: boolean;
  readonly newlyReadCount?: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_REGEX.test(id);
}

export function resolveInboxPagination(
  page = 1,
  limit = INBOX_DEFAULT_PAGE_LIMIT
): { valid: true; page: number; limit: number; offset: number } | { valid: false; error: string } {
  if (!Number.isSafeInteger(page) || page < 1) {
    return { valid: false, error: "Parameter 'page' harus berupa bilangan bulat positif yang aman." };
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return { valid: false, error: `Parameter 'limit' harus berupa bilangan bulat positif antara 1 dan ${INBOX_MAX_PAGE_LIMIT}.` };
  }
  if (limit > INBOX_MAX_PAGE_LIMIT) {
    return { valid: false, error: `Parameter 'limit' maksimal ${INBOX_MAX_PAGE_LIMIT}.` };
  }

  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return { valid: false, error: "Kombinasi 'page' dan 'limit' menghasilkan offset di luar batas bilangan bulat aman." };
  }
  return { valid: true, page, limit, offset };
}

export function parseInboxListQuery(
  params: URLSearchParams
): { valid: true; query: InboxConversationListQuery } | { valid: false; error: string } {
  // Prevent duplicate query params
  const allowedKeys = ["page", "limit", "status", "episodeStatus", "unread", "needsReview", "search"];
  for (const key of allowedKeys) {
    if (params.getAll(key).length > 1) {
      return { valid: false, error: `Parameter '${key}' tidak boleh diduplikasi.` };
    }
  }

  // Page validation
  const pageRaw = params.get("page");
  let page = 1;
  if (pageRaw !== null) {
    if (!/^[1-9]\d*$/.test(pageRaw)) {
      return { valid: false, error: "Parameter 'page' harus berupa bilangan bulat positif (>= 1)." };
    }
    page = Number(pageRaw);
  }

  // Limit defaults to 25; both parser and service share numeric bounds.
  const limitRaw = params.get("limit");
  let limit = INBOX_DEFAULT_PAGE_LIMIT;
  if (limitRaw !== null) {
    if (!/^[1-9]\d*$/.test(limitRaw)) {
      return { valid: false, error: `Parameter 'limit' harus berupa bilangan bulat positif antara 1 dan ${INBOX_MAX_PAGE_LIMIT}.` };
    }
    limit = Number(limitRaw);
  }

  const pagination = resolveInboxPagination(page, limit);
  if (!pagination.valid) return pagination;

  // Status validation
  const statusRaw = params.get("status");
  let status: InboxConversationListQuery["status"];
  if (statusRaw !== null) {
    if (!["active", "closed", "all"].includes(statusRaw)) {
      return { valid: false, error: "Parameter 'status' hanya menerima 'active', 'closed', atau 'all'." };
    }
    status = statusRaw as InboxConversationListQuery["status"];
  }

  // Episode status validation
  const episodeStatusRaw = params.get("episodeStatus");
  let episodeStatus: InboxEpisodeStatusFilter | undefined;
  if (episodeStatusRaw !== null) {
    if (!["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED", "none", "any"].includes(episodeStatusRaw)) {
      return { valid: false, error: "Parameter 'episodeStatus' tidak valid." };
    }
    episodeStatus = episodeStatusRaw as InboxEpisodeStatusFilter;
  }

  // Unread validation
  const unreadRaw = params.get("unread");
  let unread: boolean | undefined;
  if (unreadRaw !== null) {
    if (unreadRaw !== "true" && unreadRaw !== "false") {
      return { valid: false, error: "Parameter 'unread' harus bernilai 'true' atau 'false'." };
    }
    unread = unreadRaw === "true";
  }

  // NeedsReview validation
  const needsReviewRaw = params.get("needsReview");
  let needsReview: boolean | undefined;
  if (needsReviewRaw !== null) {
    if (needsReviewRaw !== "true" && needsReviewRaw !== "false") {
      return { valid: false, error: "Parameter 'needsReview' harus bernilai 'true' atau 'false'." };
    }
    needsReview = needsReviewRaw === "true";
  }

  // Search validation
  const searchRaw = params.get("search");
  let search: string | undefined;
  if (searchRaw !== null) {
    const trimmed = searchRaw.trim();
    if (trimmed.length > 100) {
      return { valid: false, error: "Parameter 'search' maksimal 100 karakter." };
    }
    if (trimmed.length > 0) {
      search = trimmed;
    }
  }

  return {
    valid: true,
    query: {
      page,
      limit,
      status,
      episodeStatus,
      unread,
      needsReview,
      search,
    },
  };
}
