export const CLASSIFICATION_RULE_VERSION = "connection-keywords-v1";
export const MAX_CLASSIFICATION_LENGTH = 10_000;
export const CONNECTION_KEYWORDS = [
  "wifi mati", "internet mati", "internet lemot", "tidak bisa internet", "los",
] as const;
export const REVIEW_KEYWORDS = ["error", "wifi", "internet", "lemot", "gangguan", "mati"] as const;

export type MessageClassification = {
  category: "connection_complaint" | "other" | "review";
  reason: "connection_keyword" | "ambiguous_keyword" | "no_keyword_match" |
    "empty_text" | "unsupported_content" | "text_too_long";
  ruleVersion: typeof CLASSIFICATION_RULE_VERSION;
  normalizedText: string | null;
  matchedKeywords: string[];
};

function containsPhrase(text: string, phrase: string): boolean {
  // Rules are fixed literals; Unicode boundaries avoid matching LOS inside "bolos".
  return new RegExp("(?:^|[^\\p{L}\\p{N}\\p{M}_])" + phrase +
    "(?=$|[^\\p{L}\\p{N}\\p{M}_])", "u").test(text);
}

export function classifyMessage(text: unknown): MessageClassification {
  const base: Pick<MessageClassification, "ruleVersion" | "normalizedText" | "matchedKeywords"> = { ruleVersion: CLASSIFICATION_RULE_VERSION, normalizedText: null, matchedKeywords: [] };
  if (typeof text !== "string") return { ...base, category: "review", reason: "unsupported_content" };
  if (text.length > MAX_CLASSIFICATION_LENGTH) return { ...base, category: "review", reason: "text_too_long" };
  const normalizedText = text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  if (!normalizedText) return { ...base, normalizedText, category: "review", reason: "empty_text" };
  const matches = CONNECTION_KEYWORDS.filter(keyword => containsPhrase(normalizedText, keyword));
  if (matches.length) return {
    ...base, normalizedText, category: "connection_complaint",
    reason: "connection_keyword", matchedKeywords: [...matches],
  };
  const ambiguous = REVIEW_KEYWORDS.filter(keyword => containsPhrase(normalizedText, keyword));
  return {
    ...base, normalizedText, category: ambiguous.length ? "review" : "other",
    reason: ambiguous.length ? "ambiguous_keyword" : "no_keyword_match",
    matchedKeywords: [...ambiguous],
  };
}
