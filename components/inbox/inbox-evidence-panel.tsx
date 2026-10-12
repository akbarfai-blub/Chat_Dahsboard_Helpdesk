"use client";

import React, { useEffect, useState, useId } from "react";
import type {
  InboxConversationContext,
  InboxNetworkCheckResult,
} from "./inbox-types";
import { formatAbsoluteDate } from "@/lib/utils/format-date";
import {
  computeProofAge,
  getOnuStatusBadge,
  getUpstreamStatusBadge,
  getAreaStateBadge,
  getQualityBadge,
  getEffectiveQuality,
  getAreaIndicationSummaryBadge,
  formatAreaRatioString,
  getTriageReasonExplanation,
} from "@/lib/domain/evidence-semantics";

function getBadgeColorClass(badgeType: "success" | "warning" | "danger" | "neutral" | "info"): string {
  switch (badgeType) {
    case "success":
      return "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]";
    case "warning":
      return "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]";
    case "danger":
      return "bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)]";
    case "info":
      return "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)]";
    case "neutral":
    default:
      return "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--status-neutral-border)]";
  }
}

interface InboxEvidencePanelProps {
  conversationId: string | null;
  context: InboxConversationContext | null;
  isLoadingContext: boolean;
  contextError: string | null;
  onRetryContext: () => void;
  latestCheck: InboxNetworkCheckResult | null;
  isLoadingCheck: boolean;
  checkError: string | null;
  onRunCheck: () => void;
  onCloseDrawer?: () => void;
  isDrawer?: boolean;
}

export function InboxEvidencePanel({
  conversationId,
  context,
  isLoadingContext,
  contextError,
  onRetryContext,
  latestCheck,
  isLoadingCheck,
  checkError,
  onRunCheck,
  onCloseDrawer,
  isDrawer = false,
}: InboxEvidencePanelProps) {
  // Dynamic tick for proof age recalculation every 30s or on custom evidence-tick event
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    const handleTick = () => setNow(new Date());
    window.addEventListener("evidence-tick", handleTick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("evidence-tick", handleTick);
    };
  }, []);

  // Keyboard Escape listener for drawer mode
  useEffect(() => {
    if (!isDrawer || !onCloseDrawer) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseDrawer();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawer, onCloseDrawer]);

  const panelHeadingId = useId();

  // If no conversation selected
  if (!conversationId) {
    return (
      <aside
        aria-label="Panel konteks identitas dan evidence jaringan"
        className="flex flex-col h-full items-center justify-center p-4 text-center bg-[var(--bg-canvas)] border-l border-[var(--border-subtle)] text-[var(--text-secondary)]"
      >
        <div className="w-10 h-10 rounded-full bg-[var(--bg-rail)] flex items-center justify-center mb-2.5 text-[var(--text-muted)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-xs font-semibold text-[var(--text-primary)]">Belum ada percakapan dipilih</p>
        <p className="text-xs mt-1 text-[var(--text-muted)] max-w-xs leading-relaxed">
          Pilih salah satu percakapan di antrean untuk melihat identitas pelanggan, topologi, dan status jaringan.
        </p>
      </aside>
    );
  }

  // Loading context skeleton
  if (isLoadingContext && !context) {
    return (
      <aside
        aria-label="Panel konteks identitas dan evidence jaringan"
        role="status"
        aria-busy="true"
        className="flex flex-col h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] overflow-y-auto p-3 space-y-3"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
          <div className="h-5 w-36 bg-[var(--bg-rail)] rounded animate-pulse" />
          {isDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              aria-label="Tutup panel bukti"
              className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-rail)] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </div>
        <div className="space-y-3">
          <div className="h-20 bg-[var(--bg-rail)] rounded animate-pulse" />
          <div className="h-28 bg-[var(--bg-rail)] rounded animate-pulse" />
          <div className="h-32 bg-[var(--bg-rail)] rounded animate-pulse" />
        </div>
      </aside>
    );
  }

  // Error loading context
  if (contextError && !context) {
    return (
      <aside
        aria-label="Panel konteks identitas dan evidence jaringan"
        className="flex flex-col h-full items-center justify-center p-4 text-center bg-[var(--bg-surface)] border-l border-[var(--border-subtle)]"
      >
        <div className="w-10 h-10 rounded-full bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] flex items-center justify-center mb-2.5 border border-[var(--status-danger-border)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Gagal memuat konteks percakapan</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)] max-w-xs">{contextError}</p>
        <button
          type="button"
          onClick={onRetryContext}
          className="mt-3 inline-flex items-center justify-center min-h-[40px] px-3 py-2 rounded-[var(--radius-control)] bg-[var(--action-primary)] text-[var(--action-on-primary)] text-xs font-semibold hover:bg-[var(--action-primary-hover)] transition-colors"
        >
          Coba lagi
        </button>
      </aside>
    );
  }

  const sender = context?.sender;
  const customer = context?.customer;
  const service = context?.service;
  const topology = context?.topology;
  const historical = context?.historicalAssessment;
  const activeIncident = context?.activeIncident;

  const isVerified = sender?.verificationStatus === "verified";
  const hasCandidates = (context?.candidateServices?.length ?? 0) > 1;

  // Independent proof age dynamic calculations for each evidence source
  const onuProofAge = latestCheck?.onu?.observedAt
    ? computeProofAge(latestCheck.onu.observedAt, now.getTime())
    : null;
  const isOnuStale = Boolean(onuProofAge?.isStaleNow);

  // Primary upstream proof age calculation
  const primaryUpstreamObservedAt = latestCheck?.upstream[0]?.observation?.observedAt ?? null;
  const primaryUpstreamProofAge = primaryUpstreamObservedAt
    ? computeProofAge(primaryUpstreamObservedAt, now.getTime())
    : null;
  const isPrimaryUpstreamStale = Boolean(primaryUpstreamProofAge?.isStaleNow);

  // Evaluated areas with independent freshness per area
  const evaluatedAreas = (latestCheck?.areas ?? []).map((ar) => {
    const aProof = ar.observedAt ? computeProofAge(ar.observedAt, now.getTime()) : null;
    return {
      state: ar.state,
      isStale: Boolean(aProof?.isStaleNow),
      coverage: ar.coverage,
    };
  });
  const areaSummaryBadge = getAreaIndicationSummaryBadge(evaluatedAreas);

  return (
    <aside
      aria-labelledby={panelHeadingId}
      className={`flex flex-col h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] overflow-hidden ${
        isDrawer ? "w-full max-w-lg shadow-xl" : "w-full"
      }`}
    >
      {/* Header (Operational UI: no milestone/development tags) */}
      <header className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between shrink-0">
        <div className="min-w-0 pr-2">
          <h2 id={panelHeadingId} className="text-sm font-bold text-[var(--text-primary)] truncate">
            Konteks & Bukti Jaringan
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-1 leading-tight">
            Identitas, topologi & bukti observasi.
          </p>
        </div>
        {isDrawer && onCloseDrawer && (
          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="Tutup panel bukti"
            className="p-2 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--bg-rail)] hover:text-[var(--text-primary)] min-h-[40px] min-w-[40px] flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </header>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* ====================================================================
            BAGIAN 1: IDENTITAS, LAYANAN & KONTEKS OPERASIONAL AKTIF
            ==================================================================== */}
        <section aria-labelledby="section-identity" className="space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-1 border-b border-[var(--border-subtle)] pb-1">
            <h3 id="section-identity" className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              1. Identitas & Layanan
            </h3>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                isVerified
                  ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]"
                  : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]"
              }`}
            >
              {isVerified ? "✓ Terverifikasi" : "Belum Terverifikasi"}
            </span>
          </div>

          {/* Sender Details */}
          <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
            <div className="flex justify-between items-start gap-1">
              <span className="text-[var(--text-secondary)] shrink-0">Pengirim:</span>
              <span className="font-semibold text-[var(--text-primary)] text-right break-words">
                {sender?.displayName || sender?.senderExternalId || "-"}
              </span>
            </div>
            <div className="flex justify-between items-center gap-1">
              <span className="text-[var(--text-secondary)] shrink-0">ID Eksternal:</span>
              <span className="font-mono text-[var(--text-primary)] truncate">{sender?.senderExternalId || "-"}</span>
            </div>
            {sender?.verifiedAt && (
              <div className="flex justify-between items-center gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Waktu Verifikasi:</span>
                <span className="text-[var(--text-primary)] text-right">{formatAbsoluteDate(sender.verifiedAt)}</span>
              </div>
            )}
          </div>

          {/* Customer & Service Resolution */}
          {isVerified ? (
            <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
              <div className="flex justify-between items-start gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Pelanggan:</span>
                <span className="font-semibold text-[var(--text-primary)] text-right break-words">
                  {customer?.displayName || customer?.id || "-"}
                </span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Status Pelanggan:</span>
                <span className="capitalize font-medium text-[var(--text-primary)]">{customer?.status || "-"}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Layanan Aktif:</span>
                <span className="font-mono font-bold text-[var(--text-primary)]">
                  {service?.serviceCode || "-"}
                </span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Status Layanan:</span>
                <span className="capitalize font-medium text-[var(--text-primary)]">{service?.status || "-"}</span>
              </div>

              {hasCandidates && (
                <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] bg-[var(--status-warning-bg)] p-2 rounded text-xs text-[var(--status-warning-text)] border border-[var(--status-warning-border)]">
                  <strong>Peringatan Ambigu:</strong> Terdapat {context?.candidateServices?.length} kandidat layanan. Membutuhkan verifikasi manual sebelum intervensi teknis.
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] text-[var(--status-warning-text)] p-2.5 rounded-[var(--radius-container)] text-xs space-y-1">
              <p className="font-semibold">Identitas Belum Terverifikasi</p>
              <p className="text-xs leading-relaxed">
                Detail pelanggan dan layanan tidak diekspos secara otomatis sesuai batas keamanan PRD. Staf dapat melakukan verifikasi nomor/ID pelanggan secara manual bila diperlukan.
              </p>
            </div>
          )}

          {/* Topology ODP/ODC */}
          <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] text-xs space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-[var(--text-secondary)]">Topologi Jaringan</span>
              {topology && (
                <span className="font-mono text-xs bg-[var(--bg-rail)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
                  v{topology.mappingVersion} ({topology.source})
                </span>
              )}
            </div>
            {topology ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">ODP:</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">{topology.odpCode}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">ODC:</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]">{topology.odcCode}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                  <span>Berlaku sejak:</span>
                  <span>{formatAbsoluteDate(topology.validFrom)}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic">
                {isVerified ? "Topologi ODP/ODC belum dipetakan untuk layanan ini." : "Topologi tidak tersedia untuk pengirim belum terverifikasi."}
              </p>
            )}
          </div>

          {/* Current Active Incident (Operational context, clearly separated from historical assessment) */}
          {activeIncident && (
            <div className="bg-[var(--status-warning-bg)] border border-[var(--status-warning-border)] text-[var(--status-warning-text)] p-2.5 rounded-[var(--radius-container)] text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span className="font-bold">Incident Aktif Saat Ini ({activeIncident.type})</span>
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--status-warning-border)]">
                  v{activeIncident.version}
                </span>
              </div>
              <div className="font-mono text-xs">ID: {activeIncident.id}</div>
              {activeIncident.odpIds.length > 0 && (
                <div className="text-xs text-[var(--text-secondary)]">
                  ODP Terdampak: {activeIncident.odpIds.join(", ")}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ====================================================================
            BAGIAN 2: HASIL PEMERIKSAAN JARINGAN TERKINI (STAF)
            ==================================================================== */}
        <section aria-labelledby="section-live-check" className="space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-1 border-b border-[var(--border-subtle)] pb-1">
            <div>
              <h3 id="section-live-check" className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                2. Pemeriksaan Terkini (Staf)
              </h3>
              <p className="text-xs text-[var(--text-muted)]">On-demand · Tanpa balasan otomatis</p>
            </div>
            <button
              type="button"
              onClick={onRunCheck}
              disabled={isLoadingCheck}
              data-testid="recheck-network-btn"
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--action-primary)] text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoadingCheck ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Memeriksa...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Cek Ulang</span>
                </>
              )}
            </button>
          </div>

          {/* Loading check spinner */}
          {isLoadingCheck && (
            <div className="bg-[var(--bg-canvas)] p-3 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-2 animate-pulse">
              <div className="h-4 w-28 bg-[var(--bg-rail)] rounded" />
              <div className="h-8 bg-[var(--bg-rail)] rounded" />
            </div>
          )}

          {/* Error banner */}
          {checkError && !isLoadingCheck && (
            <div role="alert" className="p-2.5 bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] rounded-[var(--radius-container)] text-xs flex items-start justify-between gap-2">
              <div>
                <strong>Gagal memeriksa jaringan:</strong> {checkError}
              </div>
              <button
                type="button"
                onClick={onRunCheck}
                className="underline hover:no-underline font-semibold shrink-0 min-h-[40px] px-2 flex items-center"
              >
                Coba lagi
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoadingCheck && !latestCheck && !checkError && (
            <div className="bg-[var(--bg-canvas)] p-3 rounded-[var(--radius-container)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-secondary)]">
              <p>Belum ada pemeriksaan jaringan langsung untuk sesi ini.</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Klik tombol <strong>Cek Ulang</strong> di atas untuk menjalankan diagnosa terkini.
              </p>
            </div>
          )}

          {/* Check Results */}
          {!isLoadingCheck && latestCheck && (
            <div className="space-y-3">
              {/* Outcome Badge & Freshness Overview */}
              <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Status Diagnosa:</span>
                  <span className="font-semibold px-2 py-0.5 rounded bg-[var(--bg-rail)] text-[var(--text-primary)] border border-[var(--border-subtle)] font-mono">
                    outcome={latestCheck.outcome}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Waktu Diperiksa:</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {formatAbsoluteDate(latestCheck.checkedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Sumber Diagnosa:</span>
                  <span className="font-mono text-[var(--text-primary)]">{latestCheck.source}</span>
                </div>
              </div>

              {/* ONU Evidence Box (Independent Freshness) */}
              <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="font-bold text-[var(--text-secondary)]">Status ONU (Pelanggan)</span>
                  {(() => {
                    const ob = getOnuStatusBadge(latestCheck.onu.status, latestCheck.onu.quality, isOnuStale);
                    const colorClass = getBadgeColorClass(ob.badgeType);
                    return (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colorClass}`}>
                        {ob.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--text-secondary)]">
                  <span>Waktu Observasi:</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {latestCheck.onu.observedAt ? formatAbsoluteDate(latestCheck.onu.observedAt) : "-"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--text-secondary)]">
                  <span>Usia Bukti ONU:</span>
                  {(() => {
                    if (!onuProofAge) {
                      return (
                        <span className="font-semibold px-1.5 py-0.5 rounded text-xs bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]">
                          Waktu Tidak Valid
                        </span>
                      );
                    }
                    return (
                      <span
                        className={`font-semibold px-1.5 py-0.5 rounded text-xs ${
                          !onuProofAge.isStaleNow
                            ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]"
                            : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]"
                        }`}
                      >
                        {onuProofAge.ageLabel} ({!onuProofAge.isStaleNow ? "Fresh" : "Stale >5 menit"})
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between items-center text-xs text-[var(--text-secondary)]">
                  <span>Kualitas Data ONU:</span>
                  {(() => {
                    const effectiveOnuQuality = getEffectiveQuality(latestCheck.onu.quality, isOnuStale);
                    const qb = getQualityBadge(effectiveOnuQuality);
                    const colorClass = getBadgeColorClass(qb.badgeType);
                    return (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
                        {qb.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                  <span>Reported Status:</span>
                  <span className="font-mono">{latestCheck.onu.reportedStatus || "-"}</span>
                </div>
                {latestCheck.onu.eventId && (
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>Event ID:</span>
                    <span className="font-mono">{latestCheck.onu.eventId}</span>
                  </div>
                )}
                <p className="text-xs text-[var(--text-muted)] italic pt-1 border-t border-[var(--border-subtle)] leading-normal">
                  {getOnuStatusBadge(latestCheck.onu.status, latestCheck.onu.quality, isOnuStale).semanticNote}
                </p>
              </div>

              {/* Upstream Evidence Box (Separate & Independent) */}
              <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="font-bold text-[var(--text-secondary)]">Tautan Upstream (Independen)</span>
                  {(() => {
                    const primaryStatus = latestCheck.upstream[0]?.observation?.status || "unknown";
                    const effectiveUpstreamQuality = getEffectiveQuality(latestCheck.upstreamQuality, isPrimaryUpstreamStale);
                    const usb = getUpstreamStatusBadge(primaryStatus, effectiveUpstreamQuality, isPrimaryUpstreamStale);
                    const colorClass = getBadgeColorClass(usb.badgeType);
                    return (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colorClass}`}>
                        {usb.label}
                      </span>
                    );
                  })()}
                </div>

                {latestCheck.upstream.length > 0 ? (
                  latestCheck.upstream.map((link, idx) => {
                    const linkProofAge = link.observation.observedAt
                      ? computeProofAge(link.observation.observedAt, now.getTime())
                      : null;
                    const isLinkStale = Boolean(linkProofAge?.isStaleNow);
                    const effectiveLinkQuality = getEffectiveQuality(link.observation.quality, isLinkStale);
                    const linkBadge = getUpstreamStatusBadge(link.observation.status, effectiveLinkQuality, isLinkStale);
                    const linkBadgeColor = getBadgeColorClass(linkBadge.badgeType);

                    return (
                      <div key={idx} className="bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)] text-xs space-y-1">
                        <div className="flex justify-between items-center font-mono font-semibold">
                          <span className="truncate">Link: {link.linkId}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${linkBadgeColor}`}>
                            {linkBadge.label}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Kualitas Bukti:</span>
                          <span className="font-medium">{getQualityBadge(effectiveLinkQuality).label}</span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Waktu Observasi:</span>
                          <span>{link.observation.observedAt ? formatAbsoluteDate(link.observation.observedAt) : "-"}</span>
                        </div>
                        <div className="flex justify-between items-center text-[var(--text-secondary)]">
                          <span>Usia Bukti Upstream:</span>
                          {linkProofAge ? (
                            <span
                              className={`font-semibold px-1 py-0.5 rounded text-xs ${
                                !linkProofAge.isStaleNow
                                  ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]"
                                  : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]"
                              }`}
                            >
                              {linkProofAge.ageLabel} ({!linkProofAge.isStaleNow ? "Fresh" : "Stale"})
                            </span>
                          ) : (
                            <span className="font-semibold px-1 py-0.5 rounded text-xs bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]">
                              Waktu Tidak Valid
                            </span>
                          )}
                        </div>
                        {link.observation.eventId && (
                          <div className="flex justify-between text-[var(--text-secondary)]">
                            <span>Event ID:</span>
                            <span className="font-mono">{link.observation.eventId}</span>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-[var(--text-muted)] italic">Tidak ada tautan upstream terpetakan.</p>
                )}

                <p className="text-xs text-[var(--text-muted)] italic pt-1 border-t border-[var(--border-subtle)] leading-normal">
                  {(() => {
                    const primaryStatus = latestCheck.upstream[0]?.observation?.status || "unknown";
                    return getUpstreamStatusBadge(primaryStatus, latestCheck.upstreamQuality, isPrimaryUpstreamStale).semanticNote;
                  })()}
                </p>
              </div>

              {/* Area Coverage Box */}
              <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-1.5 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="font-bold text-[var(--text-secondary)]">Cakupan Area (Coverage)</span>
                  {(() => {
                    const colorClass = getBadgeColorClass(areaSummaryBadge.badgeType);
                    return (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colorClass}`}>
                        {areaSummaryBadge.label}
                      </span>
                    );
                  })()}
                </div>

                {latestCheck.areas.length > 0 ? (
                  latestCheck.areas.map((ar, idx) => {
                    const areaProofAge = ar.observedAt
                      ? computeProofAge(ar.observedAt, now.getTime())
                      : null;
                    const isAreaStale = Boolean(areaProofAge?.isStaleNow);
                    const areaBadge = getAreaStateBadge(ar.state, isAreaStale);
                    const colorClass = getBadgeColorClass(areaBadge.badgeType);
                    return (
                      <div key={idx} className="bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)] text-xs space-y-1">
                        <div className="flex justify-between items-center font-bold">
                          <span className="truncate">{ar.scope}: {ar.scopeId}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${colorClass}`}>
                            {areaBadge.label}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--text-secondary)]">
                          <span>Rasio Anggota:</span>
                          <span className="font-mono font-semibold">
                            {formatAreaRatioString(ar.los, ar.valid, ar.total, ar.coverage)}
                          </span>
                        </div>
                        <div className="flex justify-between text-[var(--text-muted)] text-xs">
                          <span>Coverage: {Math.round(ar.coverage * 100)}%</span>
                          <span>LOS Ratio: {Math.round(ar.losRatio * 100)}%</span>
                        </div>
                        {ar.observedAt && (
                          <div className="flex justify-between text-[var(--text-secondary)] text-xs">
                            <span>Observasi Area:</span>
                            <span>{formatAbsoluteDate(ar.observedAt)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-xs text-[var(--text-secondary)]">
                          <span>Usia Bukti Area:</span>
                          {areaProofAge ? (
                            <span
                              className={`font-semibold px-1 py-0.5 rounded text-xs ${
                                !areaProofAge.isStaleNow
                                  ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)]"
                                  : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]"
                              }`}
                            >
                              {areaProofAge.ageLabel} ({!areaProofAge.isStaleNow ? "Data Baru (Fresh)" : "Data Basi (Stale)"})
                            </span>
                          ) : (
                            <span className="font-semibold px-1 py-0.5 rounded text-xs bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)]">
                              Waktu Tidak Valid
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] italic pt-1 border-t border-[var(--border-subtle)] leading-normal">
                          {areaBadge.semanticNote}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-[var(--text-muted)] italic">Tidak ada observasi area terkait.</p>
                )}
                <p className="text-xs text-[var(--text-muted)] italic pt-1 border-t border-[var(--border-subtle)] leading-normal">
                  {areaSummaryBadge.semanticNote}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ====================================================================
            BAGIAN 3: BUKTI & KEPUTUSAN HISTORIS (SAAT PESAN DIPROSES)
            ==================================================================== */}
        <section aria-labelledby="section-historical" className="space-y-2.5">
          <div className="flex items-center justify-between flex-wrap gap-1 border-b border-[var(--border-subtle)] pb-1">
            <div>
              <h3 id="section-historical" className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                3. Keputusan Triage Historis
              </h3>
              <p className="text-xs text-[var(--text-muted)]">Tersimpan saat pesan pelanggan diterima</p>
            </div>
            {historical && (
              <span className="text-xs font-mono bg-[var(--bg-rail)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
                {historical.ruleVersion}
              </span>
            )}
          </div>

          {historical ? (
            <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] shrink-0">ID Pesan Asal:</span>
                <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                  {historical.messageId}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] shrink-0">Waktu Evaluasi:</span>
                <span className="font-medium text-[var(--text-primary)] text-right">
                  {formatAbsoluteDate(historical.evaluatedAt)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] shrink-0">Hasil Keputusan:</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    historical.outcome === "candidate"
                      ? "bg-[var(--status-info-bg)] text-[var(--status-info-text)]"
                      : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]"
                  }`}
                >
                  {historical.outcome === "candidate" ? "Kandidat Otomatis" : "Perlu Peninjauan Manual"}
                </span>
              </div>
              <div className="flex justify-between items-start gap-1">
                <span className="text-[var(--text-secondary)] shrink-0">Alasan:</span>
                <div className="text-right">
                  <span className="font-mono font-bold text-[var(--text-primary)] block">
                    {historical.reason}
                  </span>
                  {(() => {
                    const expl = getTriageReasonExplanation(historical.reason);
                    return (
                      <span className="text-xs text-[var(--text-secondary)] block mt-0.5">
                        <strong className="text-[var(--text-primary)]">{expl.title}:</strong> {expl.explanation}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Template */}
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] shrink-0">Template:</span>
                <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                  {historical.effectiveTemplateKey || historical.candidateTemplateKey || "-"}
                </span>
              </div>

              {/* Historical Incident ID & Event IDs */}
              <div className="flex justify-between items-center">
                <span className="text-[var(--text-secondary)] shrink-0">Incident Historis:</span>
                <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                  {historical.incidentId || "-"}
                </span>
              </div>
              {historical.eventIds.length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)] shrink-0">Event IDs:</span>
                  <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                    {historical.eventIds.join(", ")}
                  </span>
                </div>
              )}

              {/* Automation State */}
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)] shrink-0">Mode Otomasi:</span>
                  <span className="font-semibold text-[var(--text-primary)] text-right">
                    {historical.automation.mode || "SHADOW"} ({historical.automation.disposition})
                  </span>
                </div>
                {historical.automation.blockedReasons.length > 0 && (
                  <div className="flex justify-between items-start gap-1 text-xs text-[var(--text-muted)]">
                    <span className="shrink-0">Alasan Diblokir:</span>
                    <span className="text-right break-words">
                      {historical.automation.blockedReasons.join(", ")}
                    </span>
                  </div>
                )}
              </div>

              {/* Historical Evidence Snapshot */}
              {historical.evidence.length > 0 && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1">
                  <span className="font-semibold text-[var(--text-secondary)] block text-xs">
                    Bukti Tersimpan Saat Pesan Diproses:
                  </span>
                  <ul className="space-y-1">
                    {historical.evidence.map((ev, idx) => (
                      <li key={idx} className="bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] font-mono break-words">
                        {ev.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[var(--bg-canvas)] p-2.5 rounded-[var(--radius-container)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
              <p>Belum ada keputusan triage tersimpan untuk percakapan ini.</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Pesan ini mungkin masuk secara langsung atau belum dievaluasi oleh pipeline otomatis.
              </p>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

