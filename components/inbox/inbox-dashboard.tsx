"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  InboxConversationItem,
  InboxConversationDetail,
  InboxFilterState,
  ApiResponse,
  InboxConversationListResult,
  MarkConversationReadResult,
} from "./inbox-types";
import { INITIAL_INBOX_FILTERS } from "./inbox-types";
import { InboxFilterBar } from "./inbox-filter-bar";
import { InboxConversationList } from "./inbox-conversation-list";
import { InboxPagination } from "./inbox-pagination";
import { InboxConversationPanel } from "./inbox-conversation-panel";
import { InboxStatusBanner } from "./inbox-status-banner";

const POLLING_INTERVAL_MS = 5000;

function areFiltersEqual(a: InboxFilterState, b: InboxFilterState): boolean {
  return (
    a.status === b.status &&
    a.episodeStatus === b.episodeStatus &&
    a.unread === b.unread &&
    a.needsReview === b.needsReview &&
    a.search.trim() === b.search.trim()
  );
}

export function InboxDashboard() {
  const router = useRouter();

  // 1. Data state
  const [conversations, setConversations] = useState<readonly InboxConversationItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [page, setPage] = useState<number>(1);
  const [filters, setFilters] = useState<InboxFilterState>(INITIAL_INBOX_FILTERS);

  // 2. Detail selection state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<InboxConversationDetail | null>(null);

  // 3. UI and loading state
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 4. Polling & sync state
  const [listPollingError, setListPollingError] = useState<string | null>(null);
  const [detailPollingError, setDetailPollingError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRetryingPolling, setIsRetryingPolling] = useState<boolean>(false);

  // 5. Read acknowledgment state
  const [markReadFailed, setMarkReadFailed] = useState<boolean>(false);
  const inFlightReadIdsRef = useRef<Set<string>>(new Set());
  const failedAckSnapshotRef = useRef<{ conversationId: string; messageIds: readonly string[] } | null>(null);

  // 6. Mobile view management: 'list' or 'detail'
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // 7. Screen reader announcements
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  // Refs for race-condition prevention and coordinated requests
  const activeListRequestIdRef = useRef<number>(0);
  const activeForegroundListRequestIdRef = useRef<number>(0);
  const latestAppliedListRequestIdRef = useRef<number>(0);
  const isListPollingInFlightRef = useRef<boolean>(false);

  const activeDetailRequestIdRef = useRef<number>(0);
  const activeForegroundDetailRequestIdRef = useRef<number>(0);
  const isDetailForegroundLoadingRef = useRef<boolean>(false);

  const latestFiltersRef = useRef(filters);
  const latestPageRef = useRef(page);
  const latestSelectedIdRef = useRef(selectedId);
  const selectedConversationRef = useRef(selectedConversation);

  // Keep refs synchronized inside useEffect
  useEffect(() => {
    latestFiltersRef.current = filters;
    latestPageRef.current = page;
    latestSelectedIdRef.current = selectedId;
    selectedConversationRef.current = selectedConversation;
  }, [filters, page, selectedId, selectedConversation]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      activeListRequestIdRef.current = -1;
      activeForegroundListRequestIdRef.current = -1;
      activeDetailRequestIdRef.current = -1;
      activeForegroundDetailRequestIdRef.current = -1;
    };
  }, []);

  // Build query string for API
  const buildQueryString = useCallback((f: InboxFilterState, p: number) => {
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("limit", "25");

    if (f.status !== "all") params.set("status", f.status);
    if (f.episodeStatus !== "any") params.set("episodeStatus", f.episodeStatus);
    if (f.unread !== undefined) params.set("unread", String(f.unread));
    if (f.needsReview !== undefined) params.set("needsReview", String(f.needsReview));
    if (f.search.trim()) params.set("search", f.search.trim());

    return params.toString();
  }, []);

  // Unified list fetcher: coordinated sequence, preserves data on error, guarantees isLoadingList reset
  const fetchConversationList = useCallback(
    async (
      targetFilters: InboxFilterState,
      targetPage: number,
      isBackground = false
    ): Promise<boolean> => {
      const requestId = ++activeListRequestIdRef.current;
      let foregroundId = 0;
      if (!isBackground) {
        foregroundId = ++activeForegroundListRequestIdRef.current;
        setIsLoadingList(true);
      }

      try {
        const queryStr = buildQueryString(targetFilters, targetPage);
        const res = await fetch(`/api/inbox/conversations?${queryStr}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (res.status === 401) {
          router.push("/login?error=expired");
          return false;
        }

        // Stale response guard: discard if superseded by newer applied request or parameters changed
        if (requestId < latestAppliedListRequestIdRef.current) {
          return false;
        }
        if (
          !areFiltersEqual(targetFilters, latestFiltersRef.current) ||
          targetPage !== latestPageRef.current
        ) {
          return false;
        }

        if (!res.ok) {
          if (!isBackground) {
            if (foregroundId === activeForegroundListRequestIdRef.current) {
              setListError(`Gagal memuat antrean (status ${res.status}).`);
            }
          } else {
            setListPollingError("Pembaruan terhenti");
          }
          return false;
        }

        const json: ApiResponse<InboxConversationListResult> = await res.json();

        if (requestId < latestAppliedListRequestIdRef.current) {
          return false;
        }
        if (
          !areFiltersEqual(targetFilters, latestFiltersRef.current) ||
          targetPage !== latestPageRef.current
        ) {
          return false;
        }

        if (json.success && json.data) {
          latestAppliedListRequestIdRef.current = requestId;
          setConversations(json.data.items);
          setTotalCount(json.data.totalCount);
          setTotalPages(json.data.totalPages || 1);
          setLastUpdatedAt(new Date());
          setListError(null);
          setListPollingError(null);
          return true;
        } else {
          const errMsg = json.error?.message || "Gagal memuat antrean percakapan.";
          if (!isBackground) {
            if (foregroundId === activeForegroundListRequestIdRef.current) {
              setListError(errMsg);
            }
          } else {
            setListPollingError("Pembaruan terhenti");
          }
          return false;
        }
      } catch {
        if (
          areFiltersEqual(targetFilters, latestFiltersRef.current) &&
          targetPage === latestPageRef.current
        ) {
          if (!isBackground) {
            if (foregroundId === activeForegroundListRequestIdRef.current) {
              setListError("Koneksi ke server terputus saat memuat antrean.");
            }
          } else {
            setListPollingError("Pembaruan terhenti");
          }
        }
        return false;
      } finally {
        if (!isBackground && foregroundId === activeForegroundListRequestIdRef.current) {
          setIsLoadingList(false);
        }
      }
    },
    [buildQueryString, router]
  );

  // Fetch conversation detail
  const fetchConversationDetail = useCallback(
    async (id: string, isBackground = false) => {
      const requestId = ++activeDetailRequestIdRef.current;

      if (!isBackground) {
        activeForegroundDetailRequestIdRef.current = requestId;
        isDetailForegroundLoadingRef.current = true;
        setIsLoadingDetail(true);
        setDetailError(null);
      }

      try {
        const res = await fetch(`/api/inbox/conversations/${id}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (res.status === 401) {
          router.push("/login?error=expired");
          return;
        }

        // Stale response guard: only apply if this is still the active selected ID
        if (id !== latestSelectedIdRef.current) {
          return;
        }
        if (!isBackground && requestId !== activeForegroundDetailRequestIdRef.current) {
          return;
        }
        if (isBackground && requestId < activeForegroundDetailRequestIdRef.current) {
          return;
        }

        if (!res.ok) {
          const errMsg = `Gagal memuat detail percakapan (status ${res.status}).`;
          if (!isBackground) {
            setDetailError(errMsg);
          } else {
            setDetailPollingError("Pembaruan terhenti");
          }
          return;
        }

        const json: ApiResponse<InboxConversationDetail> = await res.json();

        if (id !== latestSelectedIdRef.current) {
          return;
        }
        if (!isBackground && requestId !== activeForegroundDetailRequestIdRef.current) {
          return;
        }

        if (json.success && json.data) {
          // Detect new inbound messages during background polling
          if (
            isBackground &&
            selectedConversationRef.current &&
            selectedConversationRef.current.id === id
          ) {
            const oldMessages = selectedConversationRef.current.messages;
            const newMessages = json.data.messages;
            if (newMessages.length > oldMessages.length) {
              const latestNewMsg = newMessages[newMessages.length - 1];
              const sender = json.data.sender.displayName || json.data.sender.senderExternalId;
              setLiveAnnouncement(`Pesan baru diterima dari ${sender}: "${latestNewMsg.body.slice(0, 50)}"`);
            }
          }

          setSelectedConversation(json.data);
          setLastUpdatedAt(new Date());
          setDetailError(null);
          setDetailPollingError(null);
        } else {
          const errMsg = json.error?.message || "Gagal memuat detail percakapan.";
          if (!isBackground) {
            setDetailError(errMsg);
          } else {
            setDetailPollingError("Pembaruan terhenti");
          }
        }
      } catch {
        if (id === latestSelectedIdRef.current) {
          if (!isBackground) {
            if (requestId === activeForegroundDetailRequestIdRef.current) {
              setDetailError("Koneksi ke server terputus saat memuat percakapan.");
            }
          } else {
            setDetailPollingError("Pembaruan terhenti");
          }
        }
      } finally {
        if (!isBackground && requestId === activeForegroundDetailRequestIdRef.current) {
          isDetailForegroundLoadingRef.current = false;
          setIsLoadingDetail(false);
        }
      }
    },
    [router]
  );

  // Select a conversation
  const handleSelectConversation = useCallback(
    (id: string) => {
      if (id === selectedId) {
        // Mobile reopening same conversation: switch view without refetching or losing state
        if (mobileView !== "detail") {
          setMobileView("detail");
        }
        return;
      }

      // Switching to a different conversation:
      // Clear pending reads and failed snapshots from previous conversation
      inFlightReadIdsRef.current.clear();
      failedAckSnapshotRef.current = null;
      setMarkReadFailed(false);

      setSelectedId(id);
      setSelectedConversation(null); // Clear previous conversation immediately to prevent stale UI
      setDetailError(null);
      setDetailPollingError(null);
      setMobileView("detail");

      fetchConversationDetail(id, false);
    },
    [selectedId, mobileView, fetchConversationDetail]
  );

  // Handle filter changes: resets page to 1
  const handleFilterChange = useCallback((newFilters: InboxFilterState) => {
    setFilters(newFilters);
    setPage(1);
    setIsLoadingList(true);
    setListError(null);
  }, []);

  // Handle page changes
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    setIsLoadingList(true);
    setListError(null);
  }, []);

  // Mark read acknowledgment for visible unread messages
  const handleVisibleMessagesChange = useCallback(
    async (visibleUnreadIds: readonly string[]) => {
      // Hidden tab/document must not trigger acknowledgments
      if (typeof document !== "undefined" && document.hidden) return;

      const activeId = latestSelectedIdRef.current;
      if (!activeId || visibleUnreadIds.length === 0) return;

      // Filter out any message IDs already currently in-flight
      const idsToSend = visibleUnreadIds.filter((id) => !inFlightReadIdsRef.current.has(id));
      if (idsToSend.length === 0) return;

      // Mark IDs as in-flight
      idsToSend.forEach((id) => inFlightReadIdsRef.current.add(id));

      try {
        const res = await fetch(`/api/inbox/conversations/${activeId}/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            conversationId: activeId,
            acknowledgedMessageIds: idsToSend,
          }),
        });

        // If conversation changed while request was in-flight, discard and release in-flight IDs
        if (activeId !== latestSelectedIdRef.current) {
          idsToSend.forEach((id) => inFlightReadIdsRef.current.delete(id));
          return;
        }

        if (!res.ok) {
          setMarkReadFailed(true);
          failedAckSnapshotRef.current = { conversationId: activeId, messageIds: idsToSend };
          idsToSend.forEach((id) => inFlightReadIdsRef.current.delete(id));
          return;
        }

        const json: ApiResponse<MarkConversationReadResult> = await res.json();

        if (json.success && json.data) {
          setMarkReadFailed(false);
          failedAckSnapshotRef.current = null;

          // 1. Update active conversation messages locally
          setSelectedConversation((prev) => {
            if (!prev || prev.id !== activeId) return prev;
            const updatedMessages = prev.messages.map((m) =>
              idsToSend.includes(m.id) ? { ...m, isRead: true } : m
            );
            const remaining =
              json.data?.unreadRemaining ?? updatedMessages.filter((m) => !m.isRead).length;
            return {
              ...prev,
              messages: updatedMessages,
              unreadCount: remaining,
              isUnread: remaining > 0,
            };
          });

          // 2. Synchronize conversation in the list
          setConversations((prevList) =>
            prevList.map((item) => {
              if (item.id !== activeId) return item;
              const remaining =
                json.data?.unreadRemaining ?? Math.max(0, item.unreadCount - idsToSend.length);
              return {
                ...item,
                unreadCount: remaining,
                isUnread: remaining > 0,
              };
            })
          );
        } else {
          // Acknowledgement failed: do not show fake success
          setMarkReadFailed(true);
          failedAckSnapshotRef.current = { conversationId: activeId, messageIds: idsToSend };
          idsToSend.forEach((id) => inFlightReadIdsRef.current.delete(id));
        }
      } catch {
        if (activeId === latestSelectedIdRef.current) {
          setMarkReadFailed(true);
          failedAckSnapshotRef.current = { conversationId: activeId, messageIds: idsToSend };
        }
        idsToSend.forEach((id) => inFlightReadIdsRef.current.delete(id));
      }
    },
    []
  );

  // Retry mark read: strictly uses snapshot of failed visible messages for the active conversation
  const handleRetryMarkRead = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;

    const currentId = latestSelectedIdRef.current;
    const snapshot = failedAckSnapshotRef.current;
    if (!currentId || !snapshot || snapshot.conversationId !== currentId) {
      return;
    }

    inFlightReadIdsRef.current.clear();
    setMarkReadFailed(false);

    const currentConv = selectedConversationRef.current;
    if (currentConv && currentConv.id === currentId) {
      const unreadMessageIdSet = new Set(
        currentConv.messages.filter((m) => !m.isRead).map((m) => m.id)
      );
      // Only retry IDs that were in the failed visible snapshot and are still unread
      const idsToRetry = snapshot.messageIds.filter((id) => unreadMessageIdSet.has(id));
      if (idsToRetry.length > 0) {
        handleVisibleMessagesChange(idsToRetry);
      }
    }
  }, [handleVisibleMessagesChange]);

  // Initial and reactive fetch on filters or page change
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      if (ignore) return;
      await fetchConversationList(filters, page, false);
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [filters, page, fetchConversationList]);

  // Polling effect (every 5000ms)
  useEffect(() => {
    const timerId = setInterval(async () => {
      // Do not poll if document is hidden
      if (typeof document !== "undefined" && document.hidden) return;

      // Guard against stacked list requests
      if (isListPollingInFlightRef.current) return;
      isListPollingInFlightRef.current = true;

      try {
        await fetchConversationList(latestFiltersRef.current, latestPageRef.current, true);

        const currentSelectedId = latestSelectedIdRef.current;
        if (currentSelectedId && !isDetailForegroundLoadingRef.current) {
          await fetchConversationDetail(currentSelectedId, true);
        }
      } finally {
        isListPollingInFlightRef.current = false;
      }
    }, POLLING_INTERVAL_MS);

    return () => {
      clearInterval(timerId);
    };
  }, [fetchConversationList, fetchConversationDetail]);

  // Manual retry when polling or loading fails
  const handleRetryPolling = async () => {
    setIsRetryingPolling(true);
    try {
      await fetchConversationList(latestFiltersRef.current, latestPageRef.current, false);
      const curId = latestSelectedIdRef.current;
      if (curId) {
        await fetchConversationDetail(curId, false);
      }
    } finally {
      setIsRetryingPolling(false);
    }
  };

  const pollingError = listPollingError || detailPollingError;

  const isFiltered =
    filters.status !== "all" ||
    filters.episodeStatus !== "any" ||
    filters.unread !== undefined ||
    filters.needsReview !== undefined ||
    filters.search !== "";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-[var(--bg-canvas)]">
      {/* Screen Reader Live Announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Top Banner for Polling Failure */}
      <InboxStatusBanner
        pollingError={pollingError}
        lastUpdatedAt={lastUpdatedAt}
        onRetry={handleRetryPolling}
        isRetrying={isRetryingPolling}
      />

      {/* Main Two-Pane Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANE */}
        <section
          aria-label="Antrean percakapan masuk"
          className={`w-full lg:w-[380px] xl:w-[420px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col h-full overflow-hidden ${
            mobileView === "detail" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Header Title & Subtitle */}
          <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
            <div className="flex items-center justify-between">
              <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                Inbox / Antrean
              </h1>
              <span className="rounded-full bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--status-neutral-border)] px-2 py-0.5 text-xs font-mono">
                SHADOW
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
              Daftar komplain dan percakapan pelanggan dari Telegram.
            </p>
          </div>

          {/* Filter Bar */}
          <InboxFilterBar
            filters={filters}
            onFilterChange={handleFilterChange}
            totalCount={totalCount}
          />

          {/* List Error Banner */}
          {listError && (
            <div
              role="alert"
              className="p-3 bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border-b border-[var(--status-danger-border)] text-xs flex items-center justify-between gap-2 shrink-0"
            >
              <span>{listError}</span>
              <button
                type="button"
                onClick={() => {
                  fetchConversationList(filters, page, false);
                }}
                className="font-semibold underline hover:no-underline shrink-0"
              >
                Coba lagi
              </button>
            </div>
          )}

          {/* Scrollable Conversation List */}
          <InboxConversationList
            items={conversations}
            selectedId={selectedId}
            onSelect={handleSelectConversation}
            isLoading={isLoadingList}
            isFiltered={isFiltered}
            onResetFilter={() => {
              handleFilterChange(INITIAL_INBOX_FILTERS);
            }}
          />

          {/* Pagination Controls */}
          <InboxPagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={handlePageChange}
            isLoading={isLoadingList}
          />
        </section>

        {/* RIGHT PANE */}
        <section
          aria-label="Panel percakapan aktif"
          className={`flex-1 flex flex-col h-full overflow-hidden ${
            mobileView === "list" ? "hidden lg:flex" : "flex"
          }`}
        >
          <InboxConversationPanel
            selectedId={selectedId}
            conversation={selectedConversation}
            isLoading={isLoadingDetail}
            error={detailError}
            onRetry={() => {
              if (selectedId) fetchConversationDetail(selectedId, false);
            }}
            onBackToList={() => setMobileView("list")}
            onVisibleMessagesChange={handleVisibleMessagesChange}
            markReadFailed={markReadFailed}
            onRetryMarkRead={handleRetryMarkRead}
          />
        </section>
      </div>
    </div>
  );
}
