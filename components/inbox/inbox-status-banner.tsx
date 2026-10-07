import React from "react";
import { formatTimeOnly } from "@/lib/utils/format-date";

interface InboxStatusBannerProps {
  pollingError: string | null;
  lastUpdatedAt: Date | null;
  onRetry: () => void;
  isRetrying?: boolean;
}

export function InboxStatusBanner({
  pollingError,
  lastUpdatedAt,
  onRetry,
  isRetrying = false,
}: InboxStatusBannerProps) {
  if (!pollingError) return null;

  const timeFormatted = lastUpdatedAt ? formatTimeOnly(lastUpdatedAt.toISOString()) : null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-2.5 text-xs text-[var(--status-warning-text)] shrink-0 transition-colors"
    >
      <div className="flex items-center gap-2">
        <svg
          className="w-4 h-4 shrink-0 text-[var(--status-warning-text)]"
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
        <span>
          <strong>{pollingError}.</strong>{" "}
          {timeFormatted ? `Terakhir diperbarui pukul ${timeFormatted}. Data terakhir tetap ditampilkan.` : "Data terakhir tetap ditampilkan."}
        </span>
      </div>

      <button
        type="button"
        disabled={isRetrying}
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-warning-border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--status-warning-text)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
      >
        <svg
          className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <span>{isRetrying ? "Memperbarui..." : "Coba lagi"}</span>
      </button>
    </div>
  );
}
