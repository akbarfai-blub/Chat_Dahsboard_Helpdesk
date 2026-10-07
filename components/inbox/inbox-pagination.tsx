import React from "react";

interface InboxPaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (newPage: number) => void;
  isLoading?: boolean;
}

export function InboxPagination({
  page,
  totalPages,
  totalCount,
  onPageChange,
  isLoading = false,
}: InboxPaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const canGoPrev = page > 1 && !isLoading;
  const canGoNext = page < safeTotalPages && !isLoading;

  return (
    <nav
      aria-label="Paginasi antrean percakapan"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-xs sm:text-sm text-[var(--text-secondary)] shrink-0"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <span>
          Halaman <strong className="font-semibold text-[var(--text-primary)]">{page}</strong> dari{" "}
          <strong className="font-semibold text-[var(--text-primary)]">{safeTotalPages}</strong>
        </span>
        <span className="text-[var(--text-muted)]">·</span>
        <span className="text-[var(--text-muted)]">Total {totalCount}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={() => onPageChange(page - 1)}
          className={`inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 ${
            canGoPrev
              ? "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-rail)] cursor-pointer"
              : "border-[var(--border-subtle)] bg-[var(--bg-field)] text-[var(--text-muted)] cursor-not-allowed opacity-60"
          }`}
        >
          <svg className="w-4 h-4 mr-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Sebelumnya</span>
        </button>

        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => onPageChange(page + 1)}
          className={`inline-flex min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] items-center justify-center rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 ${
            canGoNext
              ? "border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-rail)] cursor-pointer"
              : "border-[var(--border-subtle)] bg-[var(--bg-field)] text-[var(--text-muted)] cursor-not-allowed opacity-60"
          }`}
        >
          <span>Berikutnya</span>
          <svg className="w-4 h-4 ml-1 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
