import React from "react";
import type { InboxConversationItem } from "./inbox-types";
import { InboxStatusBadge } from "./inbox-status-badge";
import { formatRelativeTime, formatAbsoluteDate } from "@/lib/utils/format-date";

interface InboxConversationListProps {
  items: readonly InboxConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  isFiltered: boolean;
  onResetFilter: () => void;
}

export function InboxConversationList({
  items,
  selectedId,
  onSelect,
  isLoading,
  isFiltered,
  onResetFilter,
}: InboxConversationListProps) {
  if (isLoading && items.length === 0) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Memuat daftar percakapan..."
        className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)] p-3 space-y-3"
      >
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[var(--radius-control)] bg-[var(--bg-surface)] p-4 border border-[var(--border-subtle)] space-y-2.5"
          >
            <div className="flex justify-between items-center">
              <div className="h-4 w-32 bg-[var(--bg-rail)] rounded" />
              <div className="h-4 w-16 bg-[var(--bg-rail)] rounded" />
            </div>
            <div className="h-3 w-48 bg-[var(--bg-rail)] rounded" />
            <div className="h-4 w-full bg-[var(--bg-rail)] rounded" />
            <div className="flex gap-2 pt-1">
              <div className="h-5 w-16 bg-[var(--bg-rail)] rounded-full" />
              <div className="h-5 w-20 bg-[var(--bg-rail)] rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-[var(--bg-surface)]">
        <div className="w-12 h-12 rounded-full bg-[var(--bg-rail)] text-[var(--text-muted)] flex items-center justify-center mb-3">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {isFiltered ? "Tidak ada hasil untuk filter ini." : "Belum ada komplain."}
        </h3>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)] max-w-xs leading-relaxed">
          {isFiltered
            ? "Coba ganti filter atau kata kunci pencarian Anda."
            : "Kirim pesan dari akun tester ke bot Telegram untuk memulai pengujian."}
        </p>
        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilter}
            className="mt-4 inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] bg-[var(--action-primary)] px-4 py-2 text-xs font-semibold text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
          >
            Reset filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Daftar antrean percakapan"
      className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)] focus:outline-none"
      tabIndex={0}
    >
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        const senderName = item.sender.displayName || item.sender.senderExternalId;
        const absoluteTime = formatAbsoluteDate(item.lastActivityAt);
        const relativeTime = formatRelativeTime(item.lastActivityAt);

        return (
          <div
            key={item.id}
            data-conversation-id={item.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelect(item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(item.id);
              }
            }}
            className={`group relative p-3 sm:p-4 cursor-pointer transition-colors border-l-4 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-[-2px] ${
              isSelected
                ? "bg-[var(--bg-surface)] border-l-[var(--brand-accent)] shadow-xs"
                : "border-l-transparent hover:bg-[var(--bg-field)] bg-[var(--bg-surface)]"
            }`}
          >
            {/* Top row: Sender Name + Timestamp + Selected Badge */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-xs sm:text-sm text-[var(--text-primary)] truncate">
                    {senderName}
                  </span>
                  {item.sender.customerName && item.sender.customerName !== senderName && (
                    <span className="text-[11px] text-[var(--text-secondary)] truncate">
                      ({item.sender.customerName})
                    </span>
                  )}
                  {item.sender.verificationStatus && (
                    <InboxStatusBadge type="verification" status={item.sender.verificationStatus} />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--text-muted)] font-mono">
                  <span>{item.channel}</span>
                  {item.latestEpisode?.serviceCode && (
                    <>
                      <span>·</span>
                      <span className="font-semibold text-[var(--text-secondary)]">
                        {item.latestEpisode.serviceCode}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Timestamp & Non-Color Selected Indicator */}
              <div className="flex flex-col items-end shrink-0 gap-1">
                <time
                  dateTime={item.lastActivityAt}
                  title={absoluteTime}
                  className="text-[11px] text-[var(--text-muted)] whitespace-nowrap"
                >
                  {relativeTime}
                </time>

                {isSelected && (
                  <span
                    aria-hidden="true"
                    data-selected="true"
                    className="inline-flex items-center gap-1 rounded bg-[var(--border-panel-navy)] text-[var(--text-on-navy)] px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase shrink-0"
                  >
                    <svg className="w-3 h-3 text-[var(--brand-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Dipilih</span>
                  </span>
                )}
              </div>
            </div>

            {/* Message Preview (clamped to 2 lines) */}
            <p className="mt-2 text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
              {item.lastMessage ? (
                item.lastMessage.body || <span className="italic text-[var(--text-muted)]">(Pesan tanpa teks)</span>
              ) : (
                <span className="italic text-[var(--text-muted)]">(Belum ada pesan)</span>
              )}
            </p>

            {/* Badges footer: Episode status, unread count, needs-review */}
            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.latestEpisode ? (
                  <InboxStatusBadge type="episode" status={item.latestEpisode.status} />
                ) : (
                  <InboxStatusBadge type="episode" status="none" />
                )}

                {item.needsReview && <InboxStatusBadge type="needs-review" />}
              </div>

              {item.unreadCount > 0 && (
                <InboxStatusBadge type="unread" count={item.unreadCount} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
