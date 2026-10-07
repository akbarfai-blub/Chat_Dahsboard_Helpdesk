import React from "react";
import type { InboxEpisodeSummary } from "./inbox-types";

interface StatusBadgeProps {
  type: "episode" | "conversation" | "verification" | "needs-review" | "unread" | "channel";
  status?: InboxEpisodeSummary["status"] | "active" | "closed" | "verified" | "unverified" | string;
  count?: number;
  className?: string;
}

export function InboxStatusBadge({ type, status, count, className = "" }: StatusBadgeProps) {
  if (type === "unread") {
    if (!count || count <= 0) return null;
    return (
      <span
        aria-label={`${count} pesan belum dibaca`}
        className={`inline-flex items-center justify-center rounded-full bg-[var(--action-primary)] text-[var(--action-on-primary)] px-2 py-0.5 text-xs font-bold leading-none shrink-0 ${className}`}
      >
        {count > 99 ? "99+" : count}
      </span>
    );
  }

  if (type === "needs-review") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)] px-2.5 py-0.5 text-xs font-semibold shrink-0 ${className}`}
      >
        <svg
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>Perlu diperiksa</span>
      </span>
    );
  }

  if (type === "channel") {
    return (
      <span
        className={`inline-flex items-center rounded-md bg-[var(--bg-rail)] text-[var(--text-secondary)] border border-[var(--border-subtle)] px-2 py-0.5 text-xs font-medium uppercase tracking-wider shrink-0 ${className}`}
      >
        {status || "Telegram"}
      </span>
    );
  }

  if (type === "verification") {
    const isVerified = status === "verified";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${
          isVerified
            ? "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)]"
            : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]"
        } ${className}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isVerified ? "bg-[var(--status-info-text)]" : "bg-[var(--status-warning-text)]"
          }`}
          aria-hidden="true"
        />
        <span>{isVerified ? "Terverifikasi" : "Belum terverifikasi"}</span>
      </span>
    );
  }

  if (type === "conversation") {
    const isActive = status === "active";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
          isActive
            ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]"
            : "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--status-neutral-border)]"
        } ${className}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isActive ? "bg-[var(--status-success-text)]" : "bg-[var(--status-neutral-text)]"
          }`}
          aria-hidden="true"
        />
        <span>Percakapan {isActive ? "Aktif" : "Ditutup"}</span>
      </span>
    );
  }

  // type === "episode"
  switch (status) {
    case "NEW":
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)] px-2.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          <span>Baru</span>
        </span>
      );
    case "IN_PROGRESS":
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)] px-2.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span>Ditangani</span>
        </span>
      );
    case "RESOLVED":
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] px-2.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Pulih</span>
        </span>
      );
    case "CLOSED":
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--status-neutral-border)] px-2.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="9" x2="15" y2="15" />
            <line x1="15" y1="9" x2="9" y2="15" />
          </svg>
          <span>Ditutup</span>
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full bg-[var(--bg-rail)] text-[var(--text-muted)] border border-[var(--border-subtle)] px-2.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
        >
          <span>Tanpa episode</span>
        </span>
      );
  }
}
