import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidClassificationCategory,
  validateClassificationCategory,
  sanitizeClassificationNotes,
  determineStaffClassificationStatus,
  formatStaffCategoryLabel,
  evaluateClassificationAgreement,
  STAFF_CLASSIFICATION_CATEGORIES,
  MAX_CLASSIFICATION_NOTES_LENGTH,
} from "../../lib/domain/staff-classification";

test("isValidClassificationCategory validates known categories correctly", () => {
  for (const cat of STAFF_CLASSIFICATION_CATEGORIES) {
    assert.equal(isValidClassificationCategory(cat), true);
  }
  assert.equal(isValidClassificationCategory("unknown"), false);
  assert.equal(isValidClassificationCategory(""), false);
  assert.equal(isValidClassificationCategory(null), false);
  assert.equal(isValidClassificationCategory(123), false);
});

test("validateClassificationCategory returns valid category or throws descriptive error", () => {
  assert.equal(validateClassificationCategory("connection_complaint"), "connection_complaint");
  assert.equal(validateClassificationCategory("other"), "other");
  assert.equal(validateClassificationCategory("review"), "review");

  assert.throws(
    () => validateClassificationCategory("invalid_cat"),
    /Kategori klasifikasi tidak valid: "invalid_cat"/
  );
  assert.throws(
    () => validateClassificationCategory(null),
    /Kategori klasifikasi tidak valid: "null"/
  );
});

test("sanitizeClassificationNotes trims whitespace, converts empty to null, and enforces length", () => {
  assert.equal(sanitizeClassificationNotes(undefined), null);
  assert.equal(sanitizeClassificationNotes(null), null);
  assert.equal(sanitizeClassificationNotes(""), null);
  assert.equal(sanitizeClassificationNotes("   \n\t  "), null);
  assert.equal(sanitizeClassificationNotes("  Pelanggan mengeluhkan kabel lepas  "), "Pelanggan mengeluhkan kabel lepas");

  const longNotes = "a".repeat(MAX_CLASSIFICATION_NOTES_LENGTH + 1);
  assert.throws(
    () => sanitizeClassificationNotes(longNotes),
    /Catatan klasifikasi tidak boleh melebihi 1000 karakter/
  );

  assert.throws(
    () => sanitizeClassificationNotes(12345),
    /Catatan klasifikasi harus berupa teks/
  );
});

test("determineStaffClassificationStatus distinguishes confirmed from corrected", () => {
  // Confirmed: labeled category matches original automatic category
  assert.equal(
    determineStaffClassificationStatus("connection_complaint", "connection_complaint"),
    "confirmed"
  );
  assert.equal(determineStaffClassificationStatus("other", "other"), "confirmed");
  assert.equal(determineStaffClassificationStatus("review", "review"), "confirmed");

  // Corrected: labeled category differs from original automatic category
  assert.equal(
    determineStaffClassificationStatus("connection_complaint", "other"),
    "corrected"
  );
  assert.equal(
    determineStaffClassificationStatus("other", "connection_complaint"),
    "corrected"
  );
  assert.equal(
    determineStaffClassificationStatus("review", "other"),
    "corrected"
  );
  assert.equal(
    determineStaffClassificationStatus("connection_complaint", "unknown"),
    "corrected"
  );
});

test("formatStaffCategoryLabel provides Indonesian labels", () => {
  assert.equal(formatStaffCategoryLabel("connection_complaint"), "Komplain Koneksi");
  assert.equal(formatStaffCategoryLabel("other"), "Bukan Komplain");
  assert.equal(formatStaffCategoryLabel("review"), "Perlu Tinjauan");
});

test("evaluateClassificationAgreement produces accurate PRD §13 comparison", () => {
  const match = evaluateClassificationAgreement(
    "connection_complaint",
    "connection_complaint",
    "connection-keywords-v1"
  );
  assert.equal(match.agreement, true);
  assert.equal(match.originalCategory, "connection_complaint");
  assert.equal(match.staffCategory, "connection_complaint");
  assert.equal(match.ruleVersion, "connection-keywords-v1");
  assert.equal(match.confusionMatrixCell, "rule:connection_complaint|staff:connection_complaint");

  const mismatch = evaluateClassificationAgreement(
    "other",
    "connection_complaint",
    "connection-keywords-v1"
  );
  assert.equal(mismatch.agreement, false);
  assert.equal(mismatch.confusionMatrixCell, "rule:other|staff:connection_complaint");
});
