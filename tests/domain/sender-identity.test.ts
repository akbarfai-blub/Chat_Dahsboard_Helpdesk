import test from "node:test";
import assert from "node:assert/strict";
import { resolveSenderIdentity } from "../../lib/domain/sender-identity";
import type { IdentityCandidate, IdentityReason, SenderKey } from "../../lib/domain/sender-identity";

const key: SenderKey = { channel: "telegram", channelAccountId: "bot-1", senderExternalId: "00123" };
const checkedAt = "2026-09-20T10:00:00Z";
function candidate(): IdentityCandidate {
  return { ...key, id: "identity", customerId: "customer", verificationStatus: "verified",
    verifiedAt: "2026-09-20T09:00:00Z",
    customer: { id: "customer", status: "active", services: [{ id: "service", customerId: "customer", status: "active" }] } };
}
function manual(rows: IdentityCandidate[], reason: IdentityReason) {
  const result = resolveSenderIdentity(key, rows, checkedAt);
  assert.equal(result.outcome, "manual");
  assert.equal(result.reason, reason);
  assert.equal(result.customerId, null);
  assert.equal(result.serviceId, null);
  return result;
}
test("verified sender resolves exactly one active service", () => {
  const result = resolveSenderIdentity(key, [candidate()], checkedAt);
  assert.equal(result.outcome, "resolved");
  assert.equal(result.customerId, "customer"); assert.equal(result.serviceId, "service");
});
test("channel, account and opaque sender ID must all match, without stripping leading zeros", () => {
  for (const changed of [{ channel: "whatsapp" }, { channelAccountId: "bot-2" }, { senderExternalId: "123" }]) {
    manual([{ ...candidate(), ...changed }], "inconsistent_data");
  }
});
test("unknown senders remain unresolved without inventing an internal identity ID", () => {
  assert.equal(manual([], "no_match").identityId, null);
});
test("unverified identities never return customer or service identifiers", () => {
  const row = { ...candidate(), verificationStatus: "unverified", customerId: null, verifiedAt: null, customer: null };
  assert.equal(manual([row], "unverified").identityId, "identity");
  manual([{ ...candidate(), verificationStatus: "unverified" }], "unverified");
});
test("multiple matching identities do not choose the first result", () => {
  manual([candidate(), { ...candidate(), id: "second" }], "identity_conflict");
});
test("invalid verification evidence fails closed", () => {
  for (const patch of [
    { verifiedAt: null }, { verifiedAt: "invalid" }, { verifiedAt: "2026-09-20T11:00:00Z" },
    { customerId: null }, { verificationStatus: "unexpected" },
  ]) manual([{ ...candidate(), ...patch }], "inconsistent_data");
});
test("missing or mismatched customer is never resolved", () => {
  manual([{ ...candidate(), customer: null }], "customer_not_found");
  const row = candidate(); row.customer!.id = "someone-else";
  manual([row], "inconsistent_data");
});
test("inactive customer or single inactive service goes to manual review", () => {
  const customer = candidate(); customer.customer!.status = "inactive";
  manual([customer], "inactive_customer");
  const service = candidate(); service.customer!.services[0].status = "inactive";
  manual([service], "inactive_service");
});
test("no service or multiple services requires manual review, including mixed active/inactive", () => {
  const empty = candidate(); empty.customer!.services = [];
  manual([empty], "no_service");
  const multiple = candidate();
  multiple.customer!.services.push({ id: "old-service", customerId: "customer", status: "inactive" });
  manual([multiple], "multiple_services");
});
test("a service belonging to another customer cannot be returned", () => {
  const row = candidate(); row.customer!.services[0].customerId = "another";
  manual([row], "inconsistent_data");
});
test("blank or noncanonical sender metadata and invalid evaluation time fail closed", () => {
  for (const patch of [{ channel: "Telegram" }, { channel: "" }, { channelAccountId: " " }, { senderExternalId: " 123" }]) {
    assert.equal(resolveSenderIdentity({ ...key, ...patch }, [], checkedAt).reason, "invalid_sender");
  }
  assert.equal(resolveSenderIdentity(key, [candidate()], "invalid").reason, "inconsistent_data");
});
