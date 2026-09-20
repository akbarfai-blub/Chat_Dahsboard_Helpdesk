import test from "node:test";
import assert from "node:assert/strict";
import { StoredIdentityLookup } from "../../lib/providers/stored-identity-lookup";
import { analyzeInboundMessage } from "../../lib/application/analyze-inbound-message";
import type { SenderKey } from "../../lib/domain/sender-identity";

const sender: SenderKey = { channel: "telegram", channelAccountId: "bot", senderExternalId: "sender" };
test("lookup errors are distinct from no_match and expose no underlying error", async () => {
  const failing = new StoredIdentityLookup({ find: async () => { throw new Error("secret connection detail"); } });
  const result = await failing.resolve(sender);
  assert.equal(result.reason, "lookup_error");
  assert(!JSON.stringify(result).includes("secret"));
  assert.equal((await new StoredIdentityLookup({ find: async () => [] }).resolve(sender)).reason, "no_match");
});
test("deadline bounds even a store ignoring AbortSignal and aborts the request", async () => {
  let aborted = false;
  const provider = new StoredIdentityLookup({ find: async (_key, signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return new Promise(() => {});
  } }, 20);
  const start = Date.now();
  assert.equal((await provider.resolve(sender)).reason, "timeout");
  assert(aborted); assert(Date.now() - start < 1000);
});
test("invalid sender metadata never accesses the repository", async () => {
  let called = false;
  const lookup = new StoredIdentityLookup({ find: async () => { called = true; return []; } });
  assert.equal((await lookup.resolve({ ...sender, channelAccountId: "" })).reason, "invalid_sender");
  assert.equal(called, false);
});
test("customer codes typed in the message cannot become lookup keys", async () => {
  const lookup = new StoredIdentityLookup({ find: async key => {
    assert.deepEqual(key, sender); return [];
  } });
  const result = await analyzeInboundMessage({ sender, text: "DUMMY-CUST-001 wifi mati" }, lookup);
  assert.equal(result.classification.category, "connection_complaint");
  assert.equal(result.identity.reason, "no_match");
  assert.equal(result.identity.customerId, null);
});
test("classification survives lookup failure so the message can still be reviewed", async () => {
  const lookup = new StoredIdentityLookup({ find: async () => { throw new Error("offline"); } });
  const result = await analyzeInboundMessage({ sender, text: "internet lemot" }, lookup);
  assert.equal(result.classification.category, "connection_complaint");
  assert.equal(result.identity.reason, "lookup_error");
});
test("non-text messages still return identity and review classification", async () => {
  const result = await analyzeInboundMessage({ sender, text: null }, new StoredIdentityLookup({ find: async () => [] }));
  assert.equal(result.classification.category, "review");
  assert.equal(result.identity.reason, "no_match");
});
test("invalid timeout configuration is rejected instead of hanging a lookup", () => {
  for (const timeout of [0, -1, NaN, Infinity]) {
    assert.throws(() => new StoredIdentityLookup({ find: async () => [] }, timeout));
  }
});
