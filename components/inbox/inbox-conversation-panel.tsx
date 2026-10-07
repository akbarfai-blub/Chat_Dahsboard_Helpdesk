import React, { useEffect, useRef, useState, useCallback } from "react";
import type { InboxConversationDetail } from "./inbox-types";
import { InboxStatusBadge } from "./inbox-status-badge";
import { formatAbsoluteDate, formatTimeOnly } from "@/lib/utils/format-date";

interface InboxConversationPanelProps {
  selectedId: string | null;
  conversation: InboxConversationDetail | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onBackToList?: () => void;
  onVisibleMessagesChange?: (visibleUnreadIds: readonly string[]) => void;
  markReadFailed?: boolean;
  onRetryMarkRead?: () => void;
}

export function InboxConversationPanel({
  selectedId,
  conversation,
  isLoading,
  error,
  onRetry,
  onBackToList,
  onVisibleMessagesChange,
  markReadFailed,
  onRetryMarkRead,
}: InboxConversationPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [hasScrolledUp, setHasScrolledUp] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const prevMessagesCountRef = useRef<number>(0);

  // Auto-scroll to bottom only if user hasn't scrolled up
  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      setHasScrolledUp(false);
      setShowScrollBottomBtn(false);
    }
  }, []);

  // Detect user scroll position
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    const isUp = distanceToBottom > 80;
    setHasScrolledUp(isUp);
    if (!isUp) {
      setShowScrollBottomBtn(false);
    }
  };

  const currentId = conversation?.id;

  const prevConversationIdRef = useRef<string | null>(null);

  // Initial load auto-scroll: only on first load of a different conversation
  useEffect(() => {
    if (currentId && !isLoading) {
      if (prevConversationIdRef.current !== currentId) {
        prevConversationIdRef.current = currentId;
        scrollToBottom(false);
        if (conversation) {
          prevMessagesCountRef.current = conversation.messages.length;
        }
      }
    }
  }, [currentId, conversation, isLoading, scrollToBottom]);

  // Handle incoming messages while viewing conversation
  useEffect(() => {
    if (!conversation) return;
    const currentCount = conversation.messages.length;
    if (currentCount > prevMessagesCountRef.current) {
      if (hasScrolledUp) {
        // User is reading older messages: don't force scroll, show button asynchronously
        requestAnimationFrame(() => setShowScrollBottomBtn(true));
      } else {
        // User was already at bottom: smooth scroll to new message
        scrollToBottom(true);
      }
    }
    prevMessagesCountRef.current = currentCount;
  }, [conversation, hasScrolledUp, scrollToBottom]);

  const isCurrentConversation = Boolean(selectedId && conversation && conversation.id === selectedId);

  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setHasScrolledUp(false);
    setShowScrollBottomBtn(false);
  }

  // Clear message refs when selectedId changes
  useEffect(() => {
    messageRefs.current.clear();
  }, [selectedId]);

  // IntersectionObserver for tracking truly visible unread messages
  useEffect(() => {
    if (!isCurrentConversation || !conversation || !onVisibleMessagesChange || isLoading) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    // Filter unread messages
    const unreadMessages = conversation.messages.filter((m) => !m.isRead);
    if (unreadMessages.length === 0) return;

    // Don't acknowledge if document/tab is hidden
    if (typeof document !== "undefined" && document.hidden) return;

    const visibleUnreadSet = new Set<string>();

    const checkVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const containerRect = container.getBoundingClientRect();

      unreadMessages.forEach((msg) => {
        const el = messageRefs.current.get(msg.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Element is considered visible if it overlaps with container viewport
          const isVisible =
            rect.top < containerRect.bottom &&
            rect.bottom > containerRect.top &&
            rect.height > 0;
          if (isVisible) {
            visibleUnreadSet.add(msg.id);
          }
        }
      });

      if (visibleUnreadSet.size > 0) {
        onVisibleMessagesChange(Array.from(visibleUnreadSet));
      }
    };

    // Use IntersectionObserver with fallback
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (typeof document !== "undefined" && document.hidden) return;
          entries.forEach((entry) => {
            const messageId = entry.target.getAttribute("data-message-id");
            if (messageId && entry.isIntersecting) {
              visibleUnreadSet.add(messageId);
            }
          });
          if (visibleUnreadSet.size > 0) {
            onVisibleMessagesChange(Array.from(visibleUnreadSet));
          }
        },
        {
          root: container,
          threshold: 0.2, // 20% visible is sufficient
        }
      );

      unreadMessages.forEach((msg) => {
        const el = messageRefs.current.get(msg.id);
        if (el) observer?.observe(el);
      });
    } else {
      // Fallback check
      checkVisibility();
    }

    // Also listen to visibility change
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        checkVisibility();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isCurrentConversation, conversation, onVisibleMessagesChange, isLoading]);

  if (!selectedId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-canvas)]">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-rail)] text-[var(--text-muted)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tidak ada percakapan yang dipilih</h3>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)] max-w-xs leading-relaxed">
          Pilih salah satu percakapan dari antrean di sebelah kiri untuk melihat riwayat pesan dan detail komplain.
        </p>
      </div>
    );
  }

  if (isLoading && !isCurrentConversation) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Memuat percakapan..."
        className="flex-1 flex flex-col h-full bg-[var(--bg-canvas)]"
      >
        <div className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 animate-pulse flex items-center justify-between">
          <div className="h-5 w-48 bg-[var(--bg-rail)] rounded" />
          <div className="h-5 w-24 bg-[var(--bg-rail)] rounded-full" />
        </div>
        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <div className="w-64 max-w-[80%] rounded-[var(--radius-container)] bg-[var(--bg-surface)] p-4 border border-[var(--border-subtle)] space-y-2 animate-pulse">
                <div className="h-3 w-20 bg-[var(--bg-rail)] rounded" />
                <div className="h-4 w-full bg-[var(--bg-rail)] rounded" />
                <div className="h-3 w-16 bg-[var(--bg-rail)] rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !isCurrentConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-canvas)]">
        <div className="w-12 h-12 rounded-full bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] flex items-center justify-center mb-3 border border-[var(--status-danger-border)]">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Gagal memuat detail percakapan</h3>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)] max-w-sm leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] bg-[var(--action-primary)] px-4 py-2 text-xs font-semibold text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!conversation || !isCurrentConversation) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Memuat percakapan..."
        className="flex-1 flex flex-col h-full bg-[var(--bg-canvas)]"
      >
        <div className="h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 animate-pulse flex items-center justify-between">
          <div className="h-5 w-48 bg-[var(--bg-rail)] rounded" />
          <div className="h-5 w-24 bg-[var(--bg-rail)] rounded-full" />
        </div>
        <div className="flex-1 p-6 space-y-4 overflow-y-auto">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <div className="w-64 max-w-[80%] rounded-[var(--radius-container)] bg-[var(--bg-surface)] p-4 border border-[var(--border-subtle)] space-y-2 animate-pulse">
                <div className="h-3 w-20 bg-[var(--bg-rail)] rounded" />
                <div className="h-4 w-full bg-[var(--bg-rail)] rounded" />
                <div className="h-3 w-16 bg-[var(--bg-rail)] rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const senderTitle = conversation.sender.displayName || conversation.sender.senderExternalId;

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-canvas)] overflow-hidden relative">
      {/* Panel Header */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 sm:p-4 shrink-0 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-start sm:items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            {/* Mobile Back Button */}
            {onBackToList && (
              <button
                type="button"
                onClick={onBackToList}
                data-testid="back-to-list-btn"
                aria-label="Kembali ke daftar percakapan"
                className="lg:hidden inline-flex min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate max-w-full">
                  {senderTitle}
                </h2>
                {conversation.sender.customerName && conversation.sender.customerName !== senderTitle && (
                  <span className="text-xs text-[var(--text-secondary)] font-normal truncate max-w-[200px]">
                    · Pelanggan: <strong className="font-semibold text-[var(--text-primary)]">{conversation.sender.customerName}</strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1 text-xs text-[var(--text-muted)] flex-wrap">
                <InboxStatusBadge type="verification" status={conversation.sender.verificationStatus} />
                <span>·</span>
                <span className="font-mono">ID: {conversation.sender.senderExternalId}</span>
                <span>·</span>
                <span className="uppercase">{conversation.channel}</span>
                {conversation.latestEpisode?.serviceCode && (
                  <>
                    <span>·</span>
                    <span className="font-mono font-semibold text-[var(--text-secondary)]">
                      Layanan: {conversation.latestEpisode.serviceCode}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right badges: on mobile placed with neat alignment, on sm aligned to right */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap sm:justify-end pl-[calc(var(--control-height-touch)+0.5rem)] lg:pl-0 sm:pl-0 pt-0.5 sm:pt-0">
            <InboxStatusBadge type="conversation" status={conversation.status} />
            {conversation.latestEpisode ? (
              <InboxStatusBadge type="episode" status={conversation.latestEpisode.status} />
            ) : (
              <InboxStatusBadge type="episode" status="none" />
            )}
          </div>
        </div>

        {/* Needs Review Alert Banner */}
        {conversation.needsReview && (
          <div
            role="alert"
            className="mt-3 rounded-[var(--radius-control)] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2.5 text-xs text-[var(--status-warning-text)] flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                <strong>Perhatian:</strong> Percakapan ini memerlukan peninjauan atau tindakan langsung oleh staf helpdesk.
              </span>
            </div>
          </div>
        )}

        {/* Read Ack Failure Alert */}
        {markReadFailed && (
          <div
            role="alert"
            className="mt-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 text-xs text-[var(--status-danger-text)] flex items-center justify-between gap-2"
          >
            <span>Gagal menyinkronkan status baca ke server.</span>
            {onRetryMarkRead && (
              <button
                type="button"
                onClick={onRetryMarkRead}
                className="font-semibold underline hover:no-underline text-xs"
              >
                Coba lagi
              </button>
            )}
          </div>
        )}
      </header>

      {/* Messages Scroll Area */}
      <div
        id="conversation-messages-scroll-container"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        aria-label="Riwayat percakapan kronologis"
        tabIndex={0}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 focus:outline-none"
      >
        {conversation.messages.length === 0 ? (
          <div className="text-center py-12 text-xs text-[var(--text-muted)]">
            Belum ada pesan dalam percakapan ini.
          </div>
        ) : (
          conversation.messages.map((message) => {
            const isInbound = message.direction === "inbound";
            const absoluteDate = formatAbsoluteDate(message.receivedAt);
            const timeOnly = formatTimeOnly(message.receivedAt);

            return (
              <div
                key={message.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(message.id, el);
                  else messageRefs.current.delete(message.id);
                }}
                data-message-id={message.id}
                data-received-at={message.receivedAt}
                data-is-read={message.isRead ? "true" : "false"}
                className={`flex flex-col ${isInbound ? "items-start" : "items-end"} max-w-full`}
              >
                {/* Bubble Container */}
                <div
                  className={`relative rounded-[var(--radius-container)] border p-3.5 sm:p-4 text-sm shadow-xs max-w-[90%] sm:max-w-[80%] ${
                    isInbound
                      ? "bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                      : "bg-[var(--status-info-bg)] border-[var(--status-info-border)] text-[var(--text-primary)]"
                  }`}
                >
                  {/* Sender & Timestamp Header */}
                  <div className="flex items-center justify-between gap-3 text-xs mb-1.5 pb-1 border-b border-[var(--border-subtle)]/60">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {isInbound ? senderTitle : "Bot / Otomasi"}
                    </span>
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <time dateTime={message.receivedAt} title={absoluteDate} className="text-[11px]">
                        {timeOnly}
                      </time>
                      <span className="text-[var(--text-muted)]">·</span>
                      {message.isRead ? (
                        <span className="text-[10px] text-[var(--text-muted)]" title="Pesan telah dibaca oleh Anda">
                          Dibaca
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--action-primary)]" title="Pesan belum dibaca">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--action-primary)]" />
                          Baru
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Message Body */}
                  <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {message.body || <span className="italic text-[var(--text-muted)]">(Pesan tanpa teks)</span>}
                  </div>

                  {/* Media / Forward metadata if available */}
                  {(message.hasMedia || message.isForwarded) && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-secondary)] bg-[var(--bg-field)] p-1.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)]">
                      {message.hasMedia && (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          <span>Lampiran media ({message.messageType})</span>
                        </span>
                      )}
                      {message.isForwarded && (
                        <span className="inline-flex items-center gap-1 font-medium italic">
                          <span>(Diteruskan)</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Factual Classification Box (Only if category exists) */}
                  {message.classification && message.classification.category !== "unknown" && (
                    <div className="mt-2.5 pt-2 border-t border-[var(--border-subtle)] text-[11px] space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[var(--text-secondary)]">Klasifikasi:</span>
                        <span className="rounded bg-[var(--bg-rail)] px-1.5 py-0.5 font-mono text-[var(--text-primary)]">
                          {message.classification.category}
                        </span>
                        <span className="text-[var(--text-muted)]">({message.classification.reason})</span>
                      </div>

                      {message.classification.matchedKeywords && message.classification.matchedKeywords.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          <span className="text-[var(--text-muted)]">Kata kunci:</span>
                          {message.classification.matchedKeywords.map((kw, idx) => (
                            <span
                              key={idx}
                              className="rounded-sm bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)] px-1.5 py-0.2 text-[10px] font-mono"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Factual Triage Assessment (Only if present in backend) */}
                  {message.triageAssessment && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] text-[11px] bg-[var(--bg-field)] p-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] space-y-1">
                      <div className="flex items-center justify-between gap-2 font-medium">
                        <span className="text-[var(--text-primary)]">Assessment Triage Otomatis</span>
                        <span className="rounded bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] px-1.5 py-0.2 text-[10px] font-mono">
                          Mode {message.triageAssessment.decision.mode}
                        </span>
                      </div>
                      <p className="text-[var(--text-secondary)] text-[10px]">
                        Keputusan: <strong className="font-semibold">{message.triageAssessment.decision.outcome}</strong> ({message.triageAssessment.decision.reason})
                      </p>
                      <p className="text-[var(--text-muted)] text-[10px]">
                        Klaim: {message.triageAssessment.processingResult.claim.outcome} ({message.triageAssessment.processingResult.claim.reason}) · Dispatch: {message.triageAssessment.processingResult.dispatchAuthorized ? "Ya" : "Tidak"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollBottomBtn && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-28 right-6 z-20 inline-flex items-center gap-1.5 rounded-full bg-[var(--action-primary)] text-[var(--action-on-primary)] px-3.5 py-2 text-xs font-semibold shadow-lg hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-transform active:scale-95"
        >
          <svg className="w-4 h-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span>Pesan baru di bawah</span>
        </button>
      )}

      {/* Footer Informasional (Fase P3 Notice) */}
      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4 shrink-0">
        <div
          data-testid="p3-composer-notice"
          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-3 border border-[var(--border-subtle)] flex items-start gap-2.5"
        >
          <svg className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
            <p className="font-semibold text-[var(--text-primary)]">
              Balasan Staf & Catatan Internal (Tahap P3)
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              Composer pengetikan balasan manual ke pelanggan Telegram dan penyimpanan catatan internal staf akan hadir pada fase P3. Mode otomasi saat ini berjalan di mode SHADOW (evaluasi internal tanpa pengiriman otomatis).
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
