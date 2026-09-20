export const IDENTITY_RULE_VERSION = "sender-identity-v1";
export type SenderKey = { channel: string; channelAccountId: string; senderExternalId: string };
export type IdentityCandidate = SenderKey & {
  id: string; customerId: string | null; verificationStatus: string; verifiedAt: string | null;
  customer: {
    id: string; status: string;
    // Repository returns up to two services: enough to detect ambiguity, including inactive ones.
    services: { id: string; customerId: string; status: string }[];
  } | null;
};
export type IdentityReason = "invalid_sender" | "no_match" | "unverified" | "identity_conflict" |
  "inconsistent_data" | "customer_not_found" | "inactive_customer" | "no_service" |
  "multiple_services" | "inactive_service" | "lookup_error" | "timeout";
export type IdentityResolution =
  | { outcome: "resolved"; ruleVersion: typeof IDENTITY_RULE_VERSION;
      reason: "verified_single_service"; identityId: string; customerId: string; serviceId: string }
  | { outcome: "manual"; ruleVersion: typeof IDENTITY_RULE_VERSION;
      reason: IdentityReason; identityId: string | null; customerId: null; serviceId: null };

export function isValidSenderKey(sender: SenderKey): boolean {
  return typeof sender.channel === "string" && /^[a-z][a-z0-9_-]*$/.test(sender.channel) &&
    [sender.channelAccountId, sender.senderExternalId].every(
      value => typeof value === "string" && value.length > 0 && value.trim() === value,
    );
}

export function manualIdentity(reason: IdentityReason, identityId: string | null = null): IdentityResolution {
  return { outcome: "manual", ruleVersion: IDENTITY_RULE_VERSION, reason, identityId, customerId: null, serviceId: null };
}

// Pure policy: no DB access, message text, time lookup, or network checks.
export function resolveSenderIdentity(
  sender: SenderKey, candidates: readonly IdentityCandidate[], checkedAt: string,
): IdentityResolution {
  if (!isValidSenderKey(sender)) return manualIdentity("invalid_sender");
  if (!Number.isFinite(Date.parse(checkedAt))) return manualIdentity("inconsistent_data");
  if (!candidates.length) return manualIdentity("no_match");
  // A repository returning another account/channel is a failure, never a fallback match.
  if (candidates.some(row => row.channel !== sender.channel ||
      row.channelAccountId !== sender.channelAccountId || row.senderExternalId !== sender.senderExternalId)) {
    return manualIdentity("inconsistent_data");
  }
  if (candidates.length !== 1) return manualIdentity("identity_conflict");
  const row = candidates[0];
  if (!row.id) return manualIdentity("inconsistent_data");
  if (row.verificationStatus === "unverified") return manualIdentity("unverified", row.id);
  if (row.verificationStatus !== "verified" || !row.customerId || !row.verifiedAt ||
      !Number.isFinite(Date.parse(row.verifiedAt)) || Date.parse(row.verifiedAt) > Date.parse(checkedAt)) {
    return manualIdentity("inconsistent_data", row.id);
  }
  if (!row.customer) return manualIdentity("customer_not_found", row.id);
  if (row.customer.id !== row.customerId) return manualIdentity("inconsistent_data", row.id);
  if (row.customer.status !== "active") return manualIdentity("inactive_customer", row.id);
  const services = row.customer.services;
  if (!services.length) return manualIdentity("no_service", row.id);
  if (services.length > 1) return manualIdentity("multiple_services", row.id);
  const service = services[0];
  if (!service.id || service.customerId !== row.customerId) return manualIdentity("inconsistent_data", row.id);
  if (service.status !== "active") return manualIdentity("inactive_service", row.id);
  return {
    outcome: "resolved", ruleVersion: IDENTITY_RULE_VERSION, reason: "verified_single_service",
    identityId: row.id, customerId: row.customerId, serviceId: service.id,
  };
}
