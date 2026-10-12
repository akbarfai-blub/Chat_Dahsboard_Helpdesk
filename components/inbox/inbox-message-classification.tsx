"use client";

import React, { useState, useEffect, useRef } from "react";
import type { InboxMessageDetail, InboxStaffClassification } from "./inbox-types";
import {
  STAFF_CLASSIFICATION_CATEGORIES,
  StaffClassificationCategory,
  formatStaffCategoryLabel,
  isValidClassificationCategory,
  MAX_CLASSIFICATION_NOTES_LENGTH,
} from "@/lib/domain/staff-classification";
import { formatAbsoluteDate } from "@/lib/utils/format-date";

interface InboxMessageClassificationProps {
  conversationId: string;
  visitToken?: number;
  message: InboxMessageDetail;
  staffClassification: InboxStaffClassification | null;
  onClassificationSaved?: (saved: InboxStaffClassification, visitToken?: number) => boolean | void;
}

export function InboxMessageClassification({
  conversationId,
  visitToken,
  message,
  staffClassification,
  onClassificationSaved,
}: InboxMessageClassificationProps) {
  // Only display for inbound messages
  if (message.direction !== "inbound") {
    return null;
  }

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<StaffClassificationCategory>(
    () => {
      if (staffClassification && isValidClassificationCategory(staffClassification.labeledCategory)) {
        return staffClassification.labeledCategory as StaffClassificationCategory;
      }
      if (message.classification && isValidClassificationCategory(message.classification.category)) {
        return message.classification.category as StaffClassificationCategory;
      }
      return "connection_complaint";
    }
  );
  const [notes, setNotes] = useState<string>(() => staffClassification?.notes || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fresh references to avoid stale closure during asynchronous operations
  const latestStaffClassificationRef = useRef<InboxStaffClassification | null>(staffClassification);
  latestStaffClassificationRef.current = staffClassification;

  const latestConversationIdRef = useRef(conversationId);
  latestConversationIdRef.current = conversationId;

  const latestMessageIdRef = useRef(message.id);
  latestMessageIdRef.current = message.id;

  const latestVisitTokenRef = useRef(visitToken);
  latestVisitTokenRef.current = visitToken;

  // Reset error and editing state when active message or conversation context changes
  useEffect(() => {
    setSubmitError(null);
    setIsEditing(false);
  }, [message.id, conversationId]);

  // Synchronize draft state when message or staffClassification changes (e.g. from parent re-fetch) without clearing active error
  useEffect(() => {
    if (!isEditing) {
      if (staffClassification && isValidClassificationCategory(staffClassification.labeledCategory)) {
        setSelectedCategory(staffClassification.labeledCategory as StaffClassificationCategory);
        setNotes(staffClassification.notes || "");
      } else if (message.classification && isValidClassificationCategory(message.classification.category)) {
        setSelectedCategory(message.classification.category as StaffClassificationCategory);
        setNotes("");
      } else {
        setSelectedCategory("connection_complaint");
        setNotes("");
      }
    }
  }, [message.id, staffClassification, isEditing, message.classification]);

  // Track server updatedAt when editor opened to notify of concurrent server updates without overwriting drafts
  const editingStartedUpdatedAtRef = useRef<string | null>(null);

  const hasConcurrentUpdate = Boolean(
    isEditing &&
      staffClassification &&
      editingStartedUpdatedAtRef.current &&
      (editingStartedUpdatedAtRef.current === "__unlabeled__" ||
        staffClassification.updatedAt !== editingStartedUpdatedAtRef.current)
  );

  const originalRuleCategory = message.classification?.category || "unknown";
  const ruleReason = message.classification?.reason || "belum diklasifikasikan";
  const matchedKeywords = message.classification?.matchedKeywords || [];

  const formRef = useRef<HTMLFormElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const openCorrectionButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      // Focus checked radio button or first radio in the form
      const form = formRef.current;
      if (form) {
        const checkedRadio = form.querySelector<HTMLInputElement>('input[type="radio"]:checked');
        const firstRadio = form.querySelector<HTMLInputElement>('input[type="radio"]');
        (checkedRadio || firstRadio)?.focus();
      }
    } else if (wasEditingRef.current) {
      // Return focus to the trigger button when edit closes or cancels
      if (editButtonRef.current) {
        editButtonRef.current.focus();
      } else if (openCorrectionButtonRef.current) {
        openCorrectionButtonRef.current.focus();
      }
    }
    wasEditingRef.current = isEditing;
  }, [isEditing]);

  const handleOpenEdit = () => {
    setSubmitError(null);
    editingStartedUpdatedAtRef.current = staffClassification?.updatedAt ?? "__unlabeled__";
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSubmitError(null);
    editingStartedUpdatedAtRef.current = null;
    if (staffClassification && isValidClassificationCategory(staffClassification.labeledCategory)) {
      setSelectedCategory(staffClassification.labeledCategory as StaffClassificationCategory);
      setNotes(staffClassification.notes || "");
    } else if (message.classification && isValidClassificationCategory(message.classification.category)) {
      setSelectedCategory(message.classification.category as StaffClassificationCategory);
      setNotes("");
    }
  };

  const submitClassification = async (categoryToSave: StaffClassificationCategory, notesToSave: string | null) => {
    setIsSubmitting(true);
    setSubmitError(null);

    const activeMessageId = message.id;
    const activeConversationId = conversationId;
    const activeVisitToken = visitToken;

    try {
      const res = await fetch(
        `/api/inbox/conversations/${activeConversationId}/messages/${activeMessageId}/classification`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            category: categoryToSave,
            labeledCategory: categoryToSave,
            notes: notesToSave,
          }),
        }
      );

      // Race condition protection: if message, conversation, or visitToken changed while awaiting response, do nothing
      if (
        latestConversationIdRef.current !== activeConversationId ||
        latestMessageIdRef.current !== activeMessageId ||
        (activeVisitToken !== undefined && latestVisitTokenRef.current !== activeVisitToken)
      ) {
        return;
      }

      const json = await res.json();

      if (!res.ok || !json.success) {
        const errorMsg = json?.error?.message || `Gagal menyimpan label (HTTP ${res.status}).`;
        setSubmitError(errorMsg);
        return;
      }

      if (json.data?.classification) {
        const savedClassification: InboxStaffClassification = json.data.classification;

        // Pass to parent state owner which reconciles against conversation state
        const acceptedByParent = onClassificationSaved?.(savedClassification, activeVisitToken);

        // Check against latest server truth at the EXACT MOMENT the response is processed!
        const currentServerTruth = latestStaffClassificationRef.current;
        const isStaleComparedToCurrent =
          currentServerTruth &&
          new Date(savedClassification.updatedAt).getTime() < new Date(currentServerTruth.updatedAt).getTime();

        const isStale = acceptedByParent === false || Boolean(isStaleComparedToCurrent);

        if (!isStale) {
          setIsEditing(false);
          setSubmitError(null);
          editingStartedUpdatedAtRef.current = null;
        }

        // Emit signal for observable UI response processing
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("test:classification-response-handled", {
              detail: {
                messageId: activeMessageId,
                conversationId: activeConversationId,
                visitToken: activeVisitToken,
                savedClassification,
                isStale,
                timestamp: Date.now(),
              },
            })
          );
        }
      }
    } catch {
      if (
        latestConversationIdRef.current === activeConversationId &&
        latestMessageIdRef.current === activeMessageId
      ) {
        setSubmitError("Terjadi kesalahan jaringan saat menyimpan label.");
      }
    } finally {
      if (
        latestConversationIdRef.current === activeConversationId &&
        latestMessageIdRef.current === activeMessageId
      ) {
        setIsSubmitting(false);
      }
    }
  };

  const handleQuickConfirm = async () => {
    if (!isValidClassificationCategory(originalRuleCategory)) {
      handleOpenEdit();
      return;
    }
    await submitClassification(originalRuleCategory as StaffClassificationCategory, null);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitClassification(selectedCategory, notes.trim() ? notes.trim() : null);
  };

  // Status computation
  const isLabeled = Boolean(staffClassification);
  const statusType = staffClassification?.status; // "confirmed" | "corrected" | undefined

  return (
    <div
      data-testid="message-classification-card"
      data-message-id={message.id}
      data-submitting={isSubmitting ? "true" : "false"}
      className="mt-2.5 pt-2 border-t border-[var(--border-subtle)] text-[11px] space-y-2"
    >
      {/* 1. Header & Automatic Rule Information */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-[var(--text-secondary)]">Rule Otomatis:</span>
          <span
            data-testid="rule-category-badge"
            className="rounded bg-[var(--bg-rail)] px-1.5 py-0.5 font-mono text-[var(--text-primary)] font-medium"
          >
            {originalRuleCategory}
          </span>
          <span className="text-[var(--text-muted)] text-[10px]">({ruleReason})</span>
        </div>

        {/* Staff Label Status Badge */}
        <div className="flex items-center gap-1.5">
          {isLabeled ? (
            statusType === "confirmed" ? (
              <span
                data-testid="classification-status-badge"
                className="inline-flex items-center gap-1 rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] px-2 py-0.5 text-[10px] font-semibold"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>Terkonfirmasi</span>
              </span>
            ) : (
              <span
                data-testid="classification-status-badge"
                className="inline-flex items-center gap-1 rounded-full bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)] px-2 py-0.5 text-[10px] font-semibold"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Dikoreksi</span>
              </span>
            )
          ) : (
            <span
              data-testid="classification-status-badge"
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-rail)] text-[var(--text-secondary)] border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-medium"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
              <span>Belum Dilabeli</span>
            </span>
          )}
        </div>
      </div>

      {/* Matched keywords if available */}
      {matchedKeywords.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pt-0.5">
          <span className="text-[var(--text-muted)] text-[10px]">Kata kunci:</span>
          {matchedKeywords.map((kw, idx) => (
            <span
              key={idx}
              className="rounded-sm bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)] px-1.5 py-0.2 text-[10px] font-mono"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* 2. Staff Labeled Details (Decoupled from editing draft) */}
      {isLabeled && (
        <div
          data-testid="staff-classification-details"
          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-2 border border-[var(--border-subtle)] space-y-1"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[var(--text-primary)]">Label Staf:</span>
              <strong
                data-testid="staff-category-value"
                className="font-mono text-[var(--action-primary)] font-bold text-xs"
              >
                {formatStaffCategoryLabel(staffClassification!.labeledCategory as StaffClassificationCategory)}
              </strong>
              <span className="text-[var(--text-muted)] text-[10px]">({staffClassification!.labeledCategory})</span>
            </div>

            {!isEditing && (
              <button
                ref={editButtonRef}
                type="button"
                onClick={handleOpenEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpenEdit();
                  }
                }}
                disabled={isSubmitting}
                data-testid="edit-classification-btn"
                className="inline-flex items-center min-h-[var(--control-height-touch)] text-xs font-semibold text-[var(--action-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
              >
                Ubah Label
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] flex-wrap">
            <span>
              Oleh:{" "}
              <strong className="text-[var(--text-secondary)] font-medium">
                {staffClassification!.staffEmail || staffClassification!.staffId}
              </strong>
            </span>
            <span>·</span>
            <time dateTime={staffClassification!.updatedAt}>
              {formatAbsoluteDate(staffClassification!.updatedAt)}
            </time>
          </div>

          {staffClassification!.notes && (
            <div className="pt-1 text-[11px] text-[var(--text-secondary)] italic border-t border-[var(--border-subtle)]/50">
              <span className="font-semibold text-[var(--text-muted)] not-italic">Catatan: </span>
              &ldquo;{staffClassification!.notes}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* Error alert when labeled but not in edit mode */}
      {isLabeled && !isEditing && submitError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="classification-error-alert"
          className="p-2.5 rounded-[var(--radius-control)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs flex items-center justify-between gap-2"
        >
          <span className="leading-snug break-words">{submitError}</span>
          <button
            type="button"
            onClick={() => setSubmitError(null)}
            data-testid="dismiss-error-btn"
            aria-label="Tutup pesan error"
            className="inline-flex items-center justify-center min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] px-3 py-1 text-xs font-semibold rounded hover:bg-[var(--status-danger-border)]/20 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* 3. Action Controls for Unlabeled Messages (When not editing) */}
      {!isLabeled && !isEditing && (
        <div className="space-y-2 pt-1">
          {submitError && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="classification-error-alert"
              className="p-2.5 rounded-[var(--radius-control)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-[var(--status-danger-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="leading-snug break-words">{submitError}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleQuickConfirm}
                  disabled={isSubmitting}
                  data-testid="retry-confirm-btn"
                  className="inline-flex items-center justify-center min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] px-3 py-1 text-xs font-semibold rounded bg-[var(--bg-surface)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] cursor-pointer disabled:opacity-50"
                >
                  Coba lagi
                </button>
                <button
                  type="button"
                  onClick={() => setSubmitError(null)}
                  data-testid="dismiss-error-btn"
                  aria-label="Tutup pesan error"
                  className="inline-flex items-center justify-center min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] px-3 py-1 text-xs font-semibold rounded hover:bg-[var(--status-danger-border)]/20 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {isValidClassificationCategory(originalRuleCategory) && (
              <button
                type="button"
                onClick={handleQuickConfirm}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleQuickConfirm();
                  }
                }}
                disabled={isSubmitting}
                data-testid="quick-confirm-btn"
                className="inline-flex items-center gap-1.5 min-h-[var(--control-height-touch)] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-border)] hover:bg-[var(--status-success-bg)]/80 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Konfirmasi Benar</span>
                  </>
                )}
              </button>
            )}

            <button
              ref={openCorrectionButtonRef}
              type="button"
              onClick={handleOpenEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleOpenEdit();
                }
              }}
              disabled={isSubmitting}
              data-testid="open-correction-btn"
              className="inline-flex items-center gap-1.5 min-h-[var(--control-height-touch)] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-control)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span>Koreksi / Beri Label</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Interactive Edit/Correction Form */}
      {isEditing && (
        <form
          ref={formRef}
          onSubmit={handleSaveForm}
          data-testid="classification-edit-form"
          data-submitting={isSubmitting ? "true" : "false"}
          className="rounded-[var(--radius-control)] bg-[var(--bg-field)] p-3 border border-[var(--border-subtle)] space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
            <span className="font-semibold text-xs text-[var(--text-primary)]">
              {isLabeled ? "Ubah Label Klasifikasi" : "Beri Label Klasifikasi"}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">Evaluasi PRD §13</span>
          </div>

          {hasConcurrentUpdate && (
            <div
              data-testid="concurrent-update-notice"
              className="p-2 rounded-[var(--radius-control)] bg-[var(--status-info-bg)] text-[var(--status-info-text)] border border-[var(--status-info-border)] text-[11px] flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-[var(--status-info-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                Label diperbarui di server oleh {staffClassification?.staffEmail || staffClassification?.staffId}. Draft Anda tetap dipertahankan.
              </span>
            </div>
          )}

          {/* Category selection */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-[var(--text-secondary)] mb-1">
              Pilih Kategori Klasifikasi:
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {STAFF_CLASSIFICATION_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <label
                    key={cat}
                    data-testid={`category-option-${cat}`}
                    className={`flex items-center gap-2 p-2 min-h-[var(--control-height-touch)] rounded-[var(--radius-control)] border text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[var(--action-primary)]/10 border-[var(--action-primary)] text-[var(--text-primary)] font-semibold"
                        : "bg-[var(--bg-surface)] border-[var(--border-control)] text-[var(--text-secondary)] hover:bg-[var(--bg-rail)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`classification-category-${message.id}`}
                      value={cat}
                      checked={isSelected}
                      onChange={() => setSelectedCategory(cat)}
                      disabled={isSubmitting}
                      className="accent-[var(--action-primary)] cursor-pointer"
                    />
                    <span className="text-xs leading-tight">{formatStaffCategoryLabel(cat)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Notes input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
              <label htmlFor={`classification-notes-${message.id}`} className="font-medium">
                Catatan Staf (opsional):
              </label>
              <span
                data-testid="notes-char-counter"
                className={`text-[10px] ${notes.length > MAX_CLASSIFICATION_NOTES_LENGTH ? "text-[var(--status-danger-text)] font-bold" : "text-[var(--text-muted)]"}`}
              >
                {notes.length}/{MAX_CLASSIFICATION_NOTES_LENGTH}
              </span>
            </div>
            <textarea
              id={`classification-notes-${message.id}`}
              data-testid="classification-notes-input"
              rows={2}
              maxLength={MAX_CLASSIFICATION_NOTES_LENGTH}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="Tambahkan alasan koreksi atau konteks evaluasi staf..."
              className="w-full text-xs rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-color)] disabled:opacity-60 resize-y"
            />
          </div>

          {/* Inline Error Alert */}
          {submitError && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="classification-error-alert"
              className="p-2.5 rounded-[var(--radius-control)] bg-[var(--status-danger-bg)] text-[var(--status-danger-text)] border border-[var(--status-danger-border)] text-xs flex items-center justify-between gap-2"
            >
              <span className="leading-snug break-words">{submitError}</span>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                data-testid="dismiss-error-btn"
                aria-label="Tutup pesan error"
                className="inline-flex items-center justify-center min-h-[var(--control-height-touch)] min-w-[var(--control-height-touch)] px-3 py-1 text-xs font-semibold rounded hover:bg-[var(--status-danger-border)]/20 focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] cursor-pointer shrink-0"
              >
                Tutup
              </button>
            </div>
          )}

          {/* Form action buttons */}
          <div className="flex items-center gap-2 pt-1 justify-end">
            <button
              type="button"
              onClick={handleCancelEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCancelEdit();
                }
              }}
              disabled={isSubmitting}
              data-testid="cancel-edit-btn"
              className="min-h-[var(--control-height-touch)] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] border border-[var(--border-control)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-rail)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50 cursor-pointer"
            >
              Batal
            </button>

            <button
              type="submit"
              onClick={handleSaveForm}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSaveForm(e);
                }
              }}
              disabled={isSubmitting || notes.length > MAX_CLASSIFICATION_NOTES_LENGTH}
              data-testid="save-classification-btn"
              className="inline-flex items-center gap-1.5 min-h-[var(--control-height-touch)] px-4 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--action-primary)] text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring-color)] disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Menyimpan...</span>
                </>
              ) : (
                <span>Simpan Label</span>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
