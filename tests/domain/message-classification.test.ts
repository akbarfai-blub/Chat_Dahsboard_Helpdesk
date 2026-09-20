import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage, CLASSIFICATION_RULE_VERSION, MAX_CLASSIFICATION_LENGTH } from "../../lib/domain/message-classification";

test("all five PRD phrases identify connection complaints", () => {
  for (const text of ["Pak wifi mati", "internet mati sejak tadi", "internet lemot", "tidak bisa internet", "lampu LOS merah"]) {
    const result = classifyMessage(text);
    assert.equal(result.category, "connection_complaint", text);
    assert.equal(result.ruleVersion, CLASSIFICATION_RULE_VERSION);
    assert(result.matchedKeywords.length > 0);
  }
});
test("case, whitespace, line breaks and Unicode compatibility forms are normalized", () => {
  const result = classifyMessage("  ＷＩＦＩ \n\tＭＡＴＩ!  ");
  assert.equal(result.normalizedText, "wifi mati!");
  assert.deepEqual(result.matchedKeywords, ["wifi mati"]);
});
test("Unicode word boundaries reject substrings, numbers and identifiers", () => {
  for (const text of ["bolos", "losmen", "LOS123", "x_LOS", "éLOS", "LOSé", "loss"]) {
    assert.equal(classifyMessage(text).category, "other", text);
  }
  assert.equal(classifyMessage("(LOS)?").category, "connection_complaint");
});
test("matches are unique and deterministic across repeated complaints", () => {
  const result = classifyMessage("LOS LOS! Internet lemot dan wifi mati");
  assert.deepEqual(result.matchedKeywords, ["wifi mati", "internet lemot", "los"]);
  assert.deepEqual(classifyMessage("LOS LOS! Internet lemot dan wifi mati"), result);
});
test("ambiguous connection hints require review without guessing a complaint", () => {
  for (const text of ["error", "wifi error", "internet", "lemot sekali", "ada gangguan", "wifi-mati"]) {
    assert.equal(classifyMessage(text).category, "review", text);
    assert.equal(classifyMessage(text).reason, "ambiguous_keyword", text);
  }
});
test("a concrete connection phrase takes priority over ambiguous hints", () => {
  assert.equal(classifyMessage("error, wifi mati").category, "connection_complaint");
});
test("billing, thanks, and typed customer codes alone are other messages", () => {
  for (const text of ["berapa tagihan saya?", "terima kasih", "DUMMY-CUST-001"]) {
    assert.equal(classifyMessage(text).category, "other", text);
  }
});
test("empty and non-text inputs require review and never throw", () => {
  for (const text of ["", "  \n\t"]) assert.equal(classifyMessage(text).reason, "empty_text");
  for (const text of [null, undefined, 42, {}, ["wifi mati"]]) {
    assert.equal(classifyMessage(text).reason, "unsupported_content");
  }
});
test("oversized messages are not silently truncated into a classification", () => {
  const result = classifyMessage("wifi mati " + "x".repeat(MAX_CLASSIFICATION_LENGTH));
  assert.equal(result.reason, "text_too_long");
  assert.equal(result.normalizedText, null);
  assert.equal(classifyMessage("x".repeat(MAX_CLASSIFICATION_LENGTH)).category, "other");
});
test("literal matching is not sentiment, negation, or a network diagnosis", () => {
  const result = classifyMessage("kemarin wifi mati, sekarang sudah normal");
  assert.equal(result.category, "connection_complaint");
  // Decision/lifecycle stages must consider context; the classifier supplies only a keyword signal.
  assert.deepEqual(result.matchedKeywords, ["wifi mati"]);
});
