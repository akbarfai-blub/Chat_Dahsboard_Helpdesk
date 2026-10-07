import React, { useState } from "react";
import type { InboxFilterState } from "./inbox-types";

interface InboxFilterBarProps {
  filters: InboxFilterState;
  onFilterChange: (newFilters: InboxFilterState) => void;
  totalCount: number;
}

export function InboxFilterBar({
  filters,
  onFilterChange,
  totalCount,
}: InboxFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const [prevSearch, setPrevSearch] = useState(filters.search);

  // Sync internal search input if parent filters change (e.g. on reset)
  if (prevSearch !== filters.search) {
    setPrevSearch(filters.search);
    setSearchInput(filters.search);
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const inputEl = form.querySelector<HTMLInputElement>('input[type="search"]');
    const term = (inputEl ? inputEl.value : searchInput).trim().slice(0, 100);
    setSearchInput(term);
    onFilterChange({
      ...filters,
      search: term,
    });
  };

  const handleSearchClear = () => {
    setSearchInput("");
    onFilterChange({
      ...filters,
      search: "",
    });
  };

  const isFiltered =
    filters.status !== "all" ||
    filters.episodeStatus !== "any" ||
    filters.unread !== undefined ||
    filters.needsReview !== undefined ||
    filters.search !== "";

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:p-4 space-y-3">
      {/* Top row: Search Bar */}
      <form onSubmit={handleSearchSubmit} className="relative flex items-center gap-2">
        <label htmlFor="inbox-search" className="sr-only">
          Cari percakapan
        </label>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--text-muted)]">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <input
            id="inbox-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.slice(0, 100))}
            placeholder="Cari nama, ID eksternal, pelanggan, pesan..."
            maxLength={100}
            className="w-full min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-field)] pl-9 pr-9 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleSearchClear}
              aria-label="Hapus kata kunci pencarian"
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="submit"
          className="min-h-[var(--control-height-touch)] sm:min-h-[var(--control-height-default)] rounded-[var(--radius-control)] bg-[var(--action-primary)] px-3 py-1.5 text-xs sm:text-sm font-semibold text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors shrink-0"
        >
          Cari
        </button>
      </form>

      {/* Middle row: Filter controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
        {/* Status Percakapan Select */}
        <div className="flex items-center gap-1.5 shrink-0">
          <label htmlFor="inbox-status-filter" className="text-[var(--text-secondary)] font-medium text-xs">
            Percakapan:
          </label>
          <select
            id="inbox-status-filter"
            value={filters.status}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                status: e.target.value as InboxFilterState["status"],
              })
            }
            className="rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2"
          >
            <option value="all">Semua</option>
            <option value="active">Aktif</option>
            <option value="closed">Ditutup</option>
          </select>
        </div>

        {/* Episode Status Filter */}
        <div className="flex items-center gap-1.5 shrink-0">
          <label htmlFor="inbox-episode-filter" className="text-[var(--text-secondary)] font-medium text-xs">
            Episode:
          </label>
          <select
            id="inbox-episode-filter"
            value={filters.episodeStatus}
            onChange={(e) =>
              onFilterChange({
                ...filters,
                episodeStatus: e.target.value as InboxFilterState["episodeStatus"],
              })
            }
            className="rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2"
          >
            <option value="any">Semua episode</option>
            <option value="NEW">Baru (NEW)</option>
            <option value="IN_PROGRESS">Ditangani (IN_PROGRESS)</option>
            <option value="RESOLVED">Pulih (RESOLVED)</option>
            <option value="CLOSED">Ditutup (CLOSED)</option>
            <option value="none">Tanpa episode</option>
          </select>
        </div>

        {/* Quick Toggles */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Unread Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={filters.unread === true}
            onClick={() =>
              onFilterChange({
                ...filters,
                unread: filters.unread ? undefined : true,
              })
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-control)] text-xs font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 ${
              filters.unread
                ? "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border-[var(--status-info-border)] font-semibold"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-control)] hover:bg-[var(--bg-rail)]"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                filters.unread ? "bg-[var(--status-info-text)]" : "bg-[var(--text-muted)]"
              }`}
              aria-hidden="true"
            />
            <span>Belum dibaca</span>
          </button>

          {/* Needs Review Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={filters.needsReview === true}
            onClick={() =>
              onFilterChange({
                ...filters,
                needsReview: filters.needsReview ? undefined : true,
              })
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-control)] text-xs font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 ${
              filters.needsReview
                ? "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)] font-semibold"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-control)] hover:bg-[var(--bg-rail)]"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                filters.needsReview ? "bg-[var(--status-warning-text)]" : "bg-[var(--text-muted)]"
              }`}
              aria-hidden="true"
            />
            <span>Perlu diperiksa</span>
          </button>

          {/* Reset Filter Button */}
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                onFilterChange({
                  status: "all",
                  episodeStatus: "any",
                  unread: undefined,
                  needsReview: undefined,
                  search: "",
                });
              }}
              className="inline-flex items-center rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] focus-visible:outline-offset-2 transition-colors"
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* Summary indicator */}
      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1">
        <span>
          Menampilkan {totalCount} percakapan {isFiltered ? "(difilter)" : ""}
        </span>
        <span className="font-mono">Limit 25 per halaman</span>
      </div>
    </div>
  );
}
