/**
 * lib/domain/staff-classification.ts
 *
 * Pure domain logic for P2.8 — Staff classification labeling and corrections.
 * Implements category validation, status derivation (confirmed vs corrected),
 * note sanitization, and evaluation metrics mapping aligned with PRD §13 and FR-03.
 */

export const STAFF_CLASSIFICATION_CATEGORIES = [
  "connection_complaint",
  "other",
  "review",
] as const;

export type StaffClassificationCategory = (typeof STAFF_CLASSIFICATION_CATEGORIES)[number];

export const STAFF_CLASSIFICATION_STATUSES = ["confirmed", "corrected"] as const;

export type StaffClassificationStatus = (typeof STAFF_CLASSIFICATION_STATUSES)[number];

export const MAX_CLASSIFICATION_NOTES_LENGTH = 1000;

export interface StaffClassificationRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly staffId: string;
  readonly labeledCategory: StaffClassificationCategory;
  readonly status: StaffClassificationStatus;
  readonly notes: string | null;
  readonly originalCategory: string;
  readonly ruleVersion: string;
  readonly matchedKeywords: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StaffClassificationHistoryRecord {
  readonly id: string;
  readonly messageId: string;
  readonly conversationId: string;
  readonly staffId: string;
  readonly labeledCategory: StaffClassificationCategory;
  readonly status: StaffClassificationStatus;
  readonly notes: string | null;
  readonly previousCategory: StaffClassificationCategory | null;
  readonly originalCategory: string;
  readonly ruleVersion: string;
  readonly matchedKeywords: readonly string[];
  readonly createdAt: string;
}

export interface ClassificationEvaluationComparison {
  readonly agreement: boolean;
  readonly originalCategory: string;
  readonly staffCategory: StaffClassificationCategory;
  readonly ruleVersion: string;
  readonly confusionMatrixCell: string;
}

/**
 * Type guard for StaffClassificationCategory.
 */
export function isValidClassificationCategory(val: unknown): val is StaffClassificationCategory {
  return typeof val === "string" && (STAFF_CLASSIFICATION_CATEGORIES as readonly string[]).includes(val);
}

/**
 * Validates staff classification category input. Fails closed with descriptive error.
 */
export function validateClassificationCategory(val: unknown): StaffClassificationCategory {
  if (!isValidClassificationCategory(val)) {
    throw new Error(
      `Kategori klasifikasi tidak valid: "${String(val)}". Kategori yang diperbolehkan: ${STAFF_CLASSIFICATION_CATEGORIES.join(", ")}.`
    );
  }
  return val;
}

/**
 * Trims and validates staff annotation notes.
 * Returns null if absent or empty. Fails closed if length exceeds MAX_CLASSIFICATION_NOTES_LENGTH.
 */
export function sanitizeClassificationNotes(val: unknown): string | null {
  if (val === undefined || val === null) {
    return null;
  }
  if (typeof val !== "string") {
    throw new Error("Catatan klasifikasi harus berupa teks.");
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_CLASSIFICATION_NOTES_LENGTH) {
    throw new Error(`Catatan klasifikasi tidak boleh melebihi ${MAX_CLASSIFICATION_NOTES_LENGTH} karakter.`);
  }
  return trimmed;
}

/**
 * Derives classification status:
 * - "confirmed": Staff verified that the automatic rule decision was correct.
 * - "corrected": Staff corrected a misclassification made by the automatic rule.
 */
export function determineStaffClassificationStatus(
  labeledCategory: StaffClassificationCategory,
  originalCategory: string
): StaffClassificationStatus {
  return labeledCategory === originalCategory ? "confirmed" : "corrected";
}

/**
 * Human-readable label in Indonesian for dashboard presentation.
 */
export function formatStaffCategoryLabel(category: StaffClassificationCategory): string {
  switch (category) {
    case "connection_complaint":
      return "Komplain Koneksi";
    case "other":
      return "Bukan Komplain";
    case "review":
      return "Perlu Tinjauan";
    default:
      return category;
  }
}

/**
 * Evaluation metric comparator for PRD §13 precision/recall calculation.
 */
export function evaluateClassificationAgreement(
  originalCategory: string,
  staffCategory: StaffClassificationCategory,
  ruleVersion: string
): ClassificationEvaluationComparison {
  const agreement = originalCategory === staffCategory;
  return {
    agreement,
    originalCategory,
    staffCategory,
    ruleVersion,
    confusionMatrixCell: `rule:${originalCategory}|staff:${staffCategory}`,
  };
}
