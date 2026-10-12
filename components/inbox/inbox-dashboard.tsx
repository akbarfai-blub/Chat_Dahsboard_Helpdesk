"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  InboxConversationItem,
  InboxConversationDetail,
  InboxMessageDetail,
  InboxFilterState,
  ApiResponse,
  InboxConversationListResult,
  MarkConversationReadResult,
  InboxConversationContext,
  InboxNetworkCheckResult,
  InboxStaffClassification,
} from "./inbox-types";
import { INITIAL_INBOX_FILTERS } from "./inbox-types";
import { InboxFilterBar } from "./inbox-filter-bar";
import { InboxConversationList } from "./inbox-conversation-list";
import { InboxPagination } from "./inbox-pagination";
import { InboxConversationPanel } from "./inbox-conversation-panel";
import { InboxEvidencePanel } from "./inbox-evidence-panel";
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
  const [detailPollCount, setDetailPollCount] = useState<number>(0);
  const [isRetryingPolling, setIsRetryingPolling] = useState<boolean>(false);

  // 5. Read acknowledgment state
  const [markReadFailed, setMarkReadFailed] = useState<boolean>(false);
  const inFlightReadIdsRef = useRef<Set<string>>(new Set());
  const failedAckSnapshotRef = useRef<{ conversationId: string; messageIds: readonly string[] } | null>(null);

  // 6. Mobile view management: 'list' or 'detail'
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // 7. Screen reader announcements
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  // 8. P2.7 Context & Network Evidence state
  const [context, setContext] = useState<InboxConversationContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState<boolean>(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const [latestCheck, setLatestCheck] = useState<InboxNetworkCheckResult | null>(null);
  const [isLoadingCheck, setIsLoadingCheck] = useState<boolean>(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [activeMobileTab, setActiveMobileTab] = useState<"messages" | "context">("messages");
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerContainerRef = useRef<HTMLDivElement | null>(null);

  // Refs for race-condition prevention and coordinated requests
  const activeListRequestIdRef = useRef<number>(0);
  const activeForegroundListRequestIdRef = useRef<number>(0);
  const latestAppliedListRequestIdRef = useRef<number>(0);
  const isListPollingInFlightRef = useRef<boolean>(false);

  const activeDetailRequestIdRef = useRef<number>(0);
  const activeForegroundDetailRequestIdRef = useRef<number>(0);
  const isDetailForegroundLoadingRef = useRef<boolean>(false);

  const activeContextRequestIdRef = useRef<number>(0);
  const activeForegroundContextRequestIdRef = useRef<number>(0);
  const isContextForegroundLoadingRef = useRef<boolean>(false);
  const latestAppliedContextRequestIdRef = useRef<number>(0);

  const activeCheckRequestIdRef = useRef<number>(0);
  const latestAppliedCheckRequestIdRef = useRef<number>(0);
  const resolutionGenerationRef = useRef<number>(0);
  const boundCheckGenerationRef = useRef<number | null>(null);

  const selectionVisitTokenRef = useRef<number>(0);

  const latestFiltersRef = useRef(filters);
  const latestPageRef = useRef(page);
  const latestSelectedIdRef = useRef(selectedId);
  const selectedConversationRef = useRef(selectedConversation);
  const contextRef = useRef(context);
  const boundServiceIdRef = useRef<string | null>(null);
  const boundConversationIdRef = useRef<string | null>(null);

  // Helper to compute stable resolution identity for invalidation
  const getResolutionKey = useCallback((ctx: InboxConversationContext | null): string => {
    if (!ctx) return "null";
    const serviceId = ctx.service?.id ?? "none";
    const verification = ctx.sender.verificationStatus ?? "none";
    const outcome = ctx.identityResolution.outcome ?? "none";
    const reason = ctx.identityResolution.reason ?? "none";
    const candidateIds = (ctx.candidateServices ?? []).map((s) => s.id).sort().join(",");
    return `${ctx.conversationId}|${serviceId}|${verification}|${outcome}|${reason}|${candidateIds}`;
  }, []);

  // Keep refs synchronized inside useEffect
  useEffect(() => {
    latestFiltersRef.current = filters;
    latestPageRef.current = page;
    latestSelectedIdRef.current = selectedId;
    selectedConversationRef.current = selectedConversation;
    contextRef.current = context;
  }, [filters, page, selectedId, selectedConversation, context]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      activeListRequestIdRef.current = -1;
      activeForegroundListRequestIdRef.current = -1;
      activeDetailRequestIdRef.current = -1;
      activeForegroundDetailRequestIdRef.current = -1;
      activeContextRequestIdRef.current = -1;
      activeForegroundContextRequestIdRef.current = -1;
      activeCheckRequestIdRef.current = -1;
      latestAppliedContextRequestIdRef.current = Number.MAX_SAFE_INTEGER;
      latestAppliedCheckRequestIdRef.current = Number.MAX_SAFE_INTEGER;
      selectionVisitTokenRef.current = -1;
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

  // Fetch conversation context (P2.7)
  const fetchConversationContext = useCallback(
    async (id: string, isBackground = false) => {
      const requestId = ++activeContextRequestIdRef.current;
      const visitToken = selectionVisitTokenRef.current;
      let foregroundId = 0;
      if (!isBackground) {
        foregroundId = ++activeForegroundContextRequestIdRef.current;
        isContextForegroundLoadingRef.current = true;
        setIsLoadingContext(true);
        setContextError(null);
      }

      try {
        const res = await fetch(`/api/inbox/conversations/${id}/context`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (res.status === 401) {
          router.push("/login?error=expired");
          return;
        }

        // Stale response guard: conversation must still be selected and visit token must match
        if (id !== latestSelectedIdRef.current || visitToken !== selectionVisitTokenRef.current) {
          return;
        }
        // Discard if superseded by a newer applied context request
        if (requestId < latestAppliedContextRequestIdRef.current) {
          return;
        }
        if (!isBackground && foregroundId !== activeForegroundContextRequestIdRef.current) {
          return;
        }

        if (!res.ok) {
          if (!isBackground && foregroundId === activeForegroundContextRequestIdRef.current) {
            if (requestId >= latestAppliedContextRequestIdRef.current) {
              setContextError(`Gagal memuat konteks percakapan (status ${res.status}).`);
            }
          }
          return;
        }

        const json: ApiResponse<InboxConversationContext> = await res.json();
        if (
          id !== latestSelectedIdRef.current ||
          visitToken !== selectionVisitTokenRef.current ||
          requestId < latestAppliedContextRequestIdRef.current ||
          (!isBackground && foregroundId !== activeForegroundContextRequestIdRef.current)
        ) {
          return;
        }

        if (json.success && json.data) {
          latestAppliedContextRequestIdRef.current = Math.max(
            latestAppliedContextRequestIdRef.current,
            requestId
          );

          const previousResolutionKey = getResolutionKey(contextRef.current);
          const newResolutionKey = getResolutionKey(json.data);
          const resolutionChanged = previousResolutionKey !== newResolutionKey;

          // Invalidate previous network check results & in-flight requests if active resolution changed or conversation switched
          const conversationSwitched =
            boundConversationIdRef.current !== null && boundConversationIdRef.current !== id;

          if (conversationSwitched || resolutionChanged) {
            resolutionGenerationRef.current++;
            activeCheckRequestIdRef.current++;
            setIsLoadingCheck(false);
            setLatestCheck(null);
            setCheckError(null);
            boundServiceIdRef.current = null;
            boundConversationIdRef.current = null;
            boundCheckGenerationRef.current = null;
          }

          setContext(json.data);
          setContextError(null);

          if (isContextForegroundLoadingRef.current) {
            isContextForegroundLoadingRef.current = false;
            setIsLoadingContext(false);
          }
        } else {
          if (!isBackground && foregroundId === activeForegroundContextRequestIdRef.current) {
            if (requestId >= latestAppliedContextRequestIdRef.current) {
              setContextError(json.error?.message || "Gagal memuat konteks percakapan.");
            }
          }
        }
      } catch {
        if (
          id === latestSelectedIdRef.current &&
          visitToken === selectionVisitTokenRef.current &&
          requestId >= latestAppliedContextRequestIdRef.current
        ) {
          if (!isBackground && foregroundId === activeForegroundContextRequestIdRef.current) {
            setContextError("Koneksi terputus saat memuat konteks.");
          }
        }
      } finally {
        if (!isBackground && foregroundId === activeForegroundContextRequestIdRef.current) {
          isContextForegroundLoadingRef.current = false;
          setIsLoadingContext(false);
        }
      }
    },
    [router, getResolutionKey]
  );

  // Fetch conversation detail
  const fetchConversationDetail = useCallback(
    async (id: string, isBackground = false) => {
      if (isBackground && typeof window !== "undefined" && (window as any).__TEST_PAUSE_POLLING) {
        return;
      }
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
        if (isBackground && typeof window !== "undefined" && (window as any).__TEST_PAUSE_POLLING) {
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
        if (isBackground && typeof window !== "undefined" && (window as any).__TEST_PAUSE_POLLING) {
          return;
        }

        if (json.success && json.data) {
          // Detect changes during background polling: new message, assessment update, activity, or sender verification
          if (
            isBackground &&
            selectedConversationRef.current &&
            selectedConversationRef.current.id === id
          ) {
            const oldConv = selectedConversationRef.current;
            const newConv = json.data;
            const messageCountChanged = newConv.messages.length > oldConv.messages.length;

            let assessmentChanged = false;
            if (newConv.messages.length === oldConv.messages.length) {
              for (let i = 0; i < newConv.messages.length; i++) {
                const oldMsg = oldConv.messages[i];
                const newMsg = newConv.messages[i];
                if (!oldMsg || !newMsg) {
                  assessmentChanged = true;
                  break;
                }
                if (
                  oldMsg.id !== newMsg.id ||
                  oldMsg.complaintId !== newMsg.complaintId ||
                  oldMsg.classification?.category !== newMsg.classification?.category ||
                  oldMsg.classification?.reason !== newMsg.classification?.reason ||
                  oldMsg.classification?.ruleVersion !== newMsg.classification?.ruleVersion
                ) {
                  assessmentChanged = true;
                  break;
                }
                const oldAssess = oldMsg.triageAssessment;
                const newAssess = newMsg.triageAssessment;
                if (!oldAssess && !newAssess) continue;
                if (!oldAssess || !newAssess) {
                  assessmentChanged = true;
                  break;
                }
                if (JSON.stringify(oldAssess) !== JSON.stringify(newAssess)) {
                  assessmentChanged = true;
                  break;
                }
              }
            }

            const activityChanged = newConv.lastActivityAt !== oldConv.lastActivityAt;
            const senderVerificationChanged =
              newConv.sender.verificationStatus !== oldConv.sender.verificationStatus;
            const senderCustomerChanged =
              newConv.sender.customerId !== oldConv.sender.customerId ||
              newConv.sender.customerName !== oldConv.sender.customerName;
            const episodeServiceChanged =
              newConv.latestEpisode?.serviceId !== oldConv.latestEpisode?.serviceId ||
              newConv.latestEpisode?.serviceCode !== oldConv.latestEpisode?.serviceCode ||
              newConv.latestEpisode?.status !== oldConv.latestEpisode?.status;

            if (
              messageCountChanged ||
              assessmentChanged ||
              activityChanged ||
              senderVerificationChanged ||
              senderCustomerChanged ||
              episodeServiceChanged
            ) {
              if (messageCountChanged) {
                const latestNewMsg = newConv.messages[newConv.messages.length - 1];
                const sender = newConv.sender.displayName || newConv.sender.senderExternalId;
                setLiveAnnouncement(`Pesan baru diterima dari ${sender}: "${latestNewMsg.body.slice(0, 50)}"`);
              }
              // Synchronize context without requiring message count increase
              fetchConversationContext(id, true);
            }
          }

          const incomingConv: InboxConversationDetail = json.data;
          // Reconcile incoming conversation messages with current local state
          setSelectedConversation((prev) => {
            if (!prev || prev.id !== id) return incomingConv;
            const reconciledMessages: InboxMessageDetail[] = incomingConv.messages.map((incomingMsg) => {
              const existingMsg = prev.messages.find((m) => m.id === incomingMsg.id);
              if (!existingMsg || !existingMsg.staffClassification) {
                return incomingMsg;
              }
              if (!incomingMsg.staffClassification) {
                // Incoming polling response has no label yet (stale response that was in-flight before save)
                return { ...incomingMsg, staffClassification: existingMsg.staffClassification };
              }
              // Both have staffClassification: compare timestamps to prevent stale responses from overwriting newer saves
              const existingTime = new Date(existingMsg.staffClassification.updatedAt).getTime();
              const incomingTime = new Date(incomingMsg.staffClassification.updatedAt).getTime();
              if (incomingTime >= existingTime) {
                // Server update is newer or equal (e.g. latest correction from another staff member)
                return incomingMsg;
              } else {
                // Server response is older than local save: keep more recent local save
                return { ...incomingMsg, staffClassification: existingMsg.staffClassification };
              }
            });
            const reconciledConv: InboxConversationDetail = {
              ...incomingConv,
              messages: reconciledMessages,
            };
            return reconciledConv;
          });
          setDetailPollCount((c) => c + 1);
          setLastUpdatedAt(new Date());
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("test:detail-poll-applied", {
                detail: { id, timestamp: Date.now() },
              })
            );
          }
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
    [router, fetchConversationContext]
  );

  // Handle classification saved (P2.8) with active conversation, visitToken, and server version reconciliation
  const handleClassificationSaved = useCallback(
    (
      conversationId: string,
      messageId: string,
      saved: InboxStaffClassification,
      visitToken?: number
    ): boolean => {
      // Guard against switching conversations: must match active conversation ID
      if (conversationId !== latestSelectedIdRef.current) return false;
      // Guard against A -> B -> A switching while in-flight: visitToken must match current visit
      if (visitToken !== undefined && visitToken !== selectionVisitTokenRef.current) return false;

      const currentConv = selectedConversationRef.current;
      if (!currentConv || currentConv.id !== conversationId) return false;

      const existingMsg = currentConv.messages.find((m) => m.id === messageId);
      if (existingMsg?.staffClassification) {
        const existingTime = new Date(existingMsg.staffClassification.updatedAt).getTime();
        const savedTime = new Date(saved.updatedAt).getTime();
        if (savedTime < existingTime) {
          return false;
        }
      }

      setSelectedConversation((prev) => {
        if (!prev || prev.id !== conversationId) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => {
            if (m.id !== messageId) return m;
            if (!m.staffClassification) {
              return { ...m, staffClassification: saved };
            }
            // Reconcile based on server timestamp: only apply saved if saved.updatedAt >= existing.updatedAt
            const existingTime = new Date(m.staffClassification.updatedAt).getTime();
            const savedTime = new Date(saved.updatedAt).getTime();
            if (savedTime >= existingTime) {
              return { ...m, staffClassification: saved };
            }
            // Existing classification is newer than delayed saved response: preserve newer existing
            return m;
          }),
        };
      });

      return true;
    },
    []
  );

  // Run on-demand network check (P2.7)
  const handleRunCheck = useCallback(async () => {
    const currentId = latestSelectedIdRef.current;
    if (!currentId) return;

    const startVisitToken = selectionVisitTokenRef.current;
    const startGeneration = resolutionGenerationRef.current;
    const startServiceId = contextRef.current?.service?.id ?? null;
    const startIsAmbiguous =
      (contextRef.current?.candidateServices?.length ?? 0) > 1 ||
      contextRef.current?.sender.verificationStatus !== "verified" ||
      !contextRef.current?.service ||
      contextRef.current?.identityResolution.outcome !== "resolved";

    const requestId = ++activeCheckRequestIdRef.current;
    boundCheckGenerationRef.current = startGeneration;
    setIsLoadingCheck(true);
    setCheckError(null);

    try {
      const res = await fetch(`/api/inbox/conversations/${currentId}/network-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scenario: "normal" }),
      });

      if (res.status === 401) {
        router.push("/login?error=expired");
        return;
      }

      // Context binding: reject if conversation switched, request invalidated, visit changed, or resolution generation changed
      if (
        requestId !== activeCheckRequestIdRef.current ||
        currentId !== latestSelectedIdRef.current ||
        startVisitToken !== selectionVisitTokenRef.current ||
        startGeneration !== resolutionGenerationRef.current ||
        requestId < latestAppliedCheckRequestIdRef.current
      ) {
        return;
      }

      // If active service changed or became ambiguous in-flight, reject
      const currentServiceId = contextRef.current?.service?.id ?? null;
      const currentIsAmbiguous =
        (contextRef.current?.candidateServices?.length ?? 0) > 1 ||
        contextRef.current?.sender.verificationStatus !== "verified" ||
        !contextRef.current?.service ||
        contextRef.current?.identityResolution.outcome !== "resolved";

      if (startServiceId !== currentServiceId || (!startIsAmbiguous && currentIsAmbiguous)) {
        return;
      }

      // Read envelope even on non-2xx status, preserving safe snapshot data
      let json: ApiResponse<InboxNetworkCheckResult> | null = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      const latestServiceIdAfterJson = contextRef.current?.service?.id ?? null;
      const latestIsAmbiguousAfterJson =
        (contextRef.current?.candidateServices?.length ?? 0) > 1 ||
        contextRef.current?.sender.verificationStatus !== "verified" ||
        !contextRef.current?.service ||
        contextRef.current?.identityResolution.outcome !== "resolved";

      if (
        requestId !== activeCheckRequestIdRef.current ||
        currentId !== latestSelectedIdRef.current ||
        startVisitToken !== selectionVisitTokenRef.current ||
        startGeneration !== resolutionGenerationRef.current ||
        requestId < latestAppliedCheckRequestIdRef.current ||
        startServiceId !== latestServiceIdAfterJson ||
        (!startIsAmbiguous && latestIsAmbiguousAfterJson)
      ) {
        return;
      }

      // Stale service response rejection: reject if returned serviceId does not match active service
      const responseServiceId = json?.data?.serviceId ?? null;
      if (
        (startServiceId && responseServiceId && responseServiceId !== startServiceId) ||
        (latestServiceIdAfterJson && responseServiceId && responseServiceId !== latestServiceIdAfterJson)
      ) {
        return;
      }

      if (res.ok && json?.success && json?.data) {
        latestAppliedCheckRequestIdRef.current = Math.max(
          latestAppliedCheckRequestIdRef.current,
          requestId
        );
        setLatestCheck(json.data);
        const resolvedServiceId = json.data.serviceId ?? contextRef.current?.service?.id ?? null;
        boundServiceIdRef.current = resolvedServiceId;
        boundConversationIdRef.current = currentId;
        boundCheckGenerationRef.current = startGeneration;
        setCheckError(null);
      } else if (json && json.data) {
        // Provider returned valid error envelope with partial snapshot data
        if (
          (!startServiceId || !responseServiceId || responseServiceId === startServiceId) &&
          !latestIsAmbiguousAfterJson &&
          startGeneration === resolutionGenerationRef.current &&
          startVisitToken === selectionVisitTokenRef.current &&
          currentId === latestSelectedIdRef.current &&
          requestId >= latestAppliedCheckRequestIdRef.current
        ) {
          latestAppliedCheckRequestIdRef.current = Math.max(
            latestAppliedCheckRequestIdRef.current,
            requestId
          );
          setLatestCheck(json.data);
          boundServiceIdRef.current = json.data.serviceId ?? null;
          boundConversationIdRef.current = currentId;
          boundCheckGenerationRef.current = startGeneration;
        }
        setCheckError(json.error?.message || "Pemeriksaan jaringan menghasilkan status gagal/tidak lengkap.");
      } else {
        // Transport error or server error without snapshot
        setCheckError(json?.error?.message || `Pemeriksaan jaringan gagal (status ${res.status}).`);
      }
    } catch {
      if (
        requestId === activeCheckRequestIdRef.current &&
        currentId === latestSelectedIdRef.current &&
        startVisitToken === selectionVisitTokenRef.current &&
        startGeneration === resolutionGenerationRef.current &&
        requestId >= latestAppliedCheckRequestIdRef.current
      ) {
        setCheckError("Koneksi terputus saat memeriksa jaringan.");
      }
    } finally {
      if (requestId === activeCheckRequestIdRef.current) {
        setIsLoadingCheck(false);
      }
    }
  }, [router]);

  // Close drawer and restore focus (P2.7)
  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    requestAnimationFrame(() => {
      drawerTriggerRef.current?.focus();
    });
  }, []);

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

      // Invalidate in-flight check and context requests to prevent stale leaks
      selectionVisitTokenRef.current++;
      resolutionGenerationRef.current++;
      activeCheckRequestIdRef.current++;
      activeContextRequestIdRef.current++;
      activeForegroundContextRequestIdRef.current++;
      isContextForegroundLoadingRef.current = false;
      setIsLoadingCheck(false);
      setIsLoadingContext(false);

      setSelectedId(id);
      setSelectedConversation(null); // Clear previous conversation immediately to prevent stale UI
      setDetailError(null);
      setDetailPollingError(null);
      setMobileView("detail");

      // Reset context & latest check on conversation switch to prevent leaking previous conversation state
      setContext(null);
      setContextError(null);
      setLatestCheck(null);
      setCheckError(null);
      boundServiceIdRef.current = null;
      boundConversationIdRef.current = null;
      boundCheckGenerationRef.current = null;
      setActiveMobileTab("messages");

      fetchConversationDetail(id, false);
      fetchConversationContext(id);
    },
    [selectedId, mobileView, fetchConversationDetail, fetchConversationContext]
  );

  // Auto-close drawer on viewport resize to >= 1440px or < 1024px
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1440 || window.innerWidth < 1024) {
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Trap focus inside drawer when open
  useEffect(() => {
    if (!isDrawerOpen) return;
    const drawerEl = drawerContainerRef.current;
    if (!drawerEl) return;

    // Focus the first focusable element inside drawer
    const focusable = drawerEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusableElements = drawerEl.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen]);

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

  // Polling effect (every 5000ms, with test event trigger for deterministic verification)
  useEffect(() => {
    const pollTick = async () => {
      // Do not poll if document is hidden
      if (typeof document !== "undefined" && document.hidden) return;

      // Guard against stacked list requests
      if (isListPollingInFlightRef.current) return;
      if (typeof window !== "undefined" && (window as any).__TEST_PAUSE_POLLING) return;
      isListPollingInFlightRef.current = true;

      try {
        await fetchConversationList(latestFiltersRef.current, latestPageRef.current, true);

        const currentSelectedId = latestSelectedIdRef.current;
        if (currentSelectedId && !isDetailForegroundLoadingRef.current) {
          await fetchConversationDetail(currentSelectedId, true);
          await fetchConversationContext(currentSelectedId, true);
        }
      } finally {
        isListPollingInFlightRef.current = false;
      }
    };

    const timerId = setInterval(pollTick, POLLING_INTERVAL_MS);

    const handlePollTrigger = () => {
      void pollTick();
    };
    window.addEventListener("test:inbox-poll", handlePollTrigger);

    return () => {
      clearInterval(timerId);
      window.removeEventListener("test:inbox-poll", handlePollTrigger);
    };
  }, [fetchConversationList, fetchConversationDetail, fetchConversationContext]);

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
    <div
      data-testid="inbox-dashboard"
      data-detail-poll-count={detailPollCount}
      className="flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-[var(--bg-canvas)]"
    >
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
          className={`inbox-list-pane w-full lg:w-[360px] min-[1440px]:w-[300px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col h-full overflow-hidden ${
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

        {/* RIGHT PANE: Conversation & Evidence (3-column layout on >= 1440px / 2xl) */}
        <section
          aria-label="Panel percakapan aktif"
          className={`flex-1 flex h-full overflow-hidden ${
            mobileView === "list" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Main conversation panel */}
          <div className="flex-1 min-w-0 min-[1440px]:min-w-[420px] flex flex-col h-full overflow-hidden">
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
              // P2.7 props
              context={context}
              isLoadingContext={isLoadingContext}
              contextError={contextError}
              onRetryContext={() => {
                if (selectedId) fetchConversationContext(selectedId);
              }}
              latestCheck={latestCheck}
              isLoadingCheck={isLoadingCheck}
              checkError={checkError}
              onRunCheck={handleRunCheck}
              onToggleEvidenceDrawer={() => setIsDrawerOpen((prev) => !prev)}
              isEvidenceDrawerOpen={isDrawerOpen}
              activeMobileTab={activeMobileTab}
              onMobileTabChange={setActiveMobileTab}
              drawerTriggerRef={drawerTriggerRef}
              visitToken={selectionVisitTokenRef.current}
              onClassificationSaved={handleClassificationSaved}
            />
          </div>

          {/* 3rd Column: Permanent side-by-side Evidence Panel on >= 1440px */}
          <div
            data-testid="evidence-column"
            className="inbox-evidence-column hidden min-[1440px]:flex shrink-0 h-full overflow-hidden"
          >
            <InboxEvidencePanel
              conversationId={selectedId}
              context={context}
              isLoadingContext={isLoadingContext}
              contextError={contextError}
              onRetryContext={() => {
                if (selectedId) fetchConversationContext(selectedId);
              }}
              latestCheck={latestCheck}
              isLoadingCheck={isLoadingCheck}
              checkError={checkError}
              onRunCheck={handleRunCheck}
              isDrawer={false}
            />
          </div>
        </section>
      </div>

      {/* Drawer Overlay for 1024px to 1439px (lg to xl) */}
      {isDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Panel Konteks & Bukti Jaringan"
          className="fixed inset-0 z-50 flex justify-end min-[1440px]:hidden"
        >
          <div
            className="fixed inset-0 bg-[var(--bg-overlay-backdrop)] transition-opacity"
            onClick={handleCloseDrawer}
            aria-hidden="true"
          />
          <div ref={drawerContainerRef} className="relative w-full max-w-md h-full bg-[var(--bg-surface)] shadow-2xl z-10 flex flex-col">
            <InboxEvidencePanel
              conversationId={selectedId}
              context={context}
              isLoadingContext={isLoadingContext}
              contextError={contextError}
              onRetryContext={() => {
                if (selectedId) fetchConversationContext(selectedId);
              }}
              latestCheck={latestCheck}
              isLoadingCheck={isLoadingCheck}
              checkError={checkError}
              onRunCheck={handleRunCheck}
              isDrawer={true}
              onCloseDrawer={handleCloseDrawer}
            />
          </div>
        </div>
      )}
    </div>
  );
}
