import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../../lib/providers/mock-provider";
import type { MockNetworkStore } from "../../lib/providers/mock-network-store";
import type { Mapping } from "../../lib/domain/network-status";

const checkedAt = "2026-09-20T10:00:00Z";
const mapping: Mapping = { serviceId: "svc", version: 2, source: "MOCK", validFrom: checkedAt,
  odpId: "odp", odpCode: "ODP", odcId: "odc", odcCode: "ODC" };
function store(overrides: Partial<MockNetworkStore> = {}): MockNetworkStore {
  return {
    getScenario: async () => ({ onuFailure: "none", upstreamFailure: "none" }),
    getContext: async () => ({ mapping, members: [mapping] }),
    getOnu: async () => [{ serviceId: "svc", status: "online", observedAt: checkedAt, eventId: null }],
    getUpstream: async () => [{ linkId: "link", mappingVersion: 2, status: "down", observedAt: checkedAt, eventId: "event-1" }],
    ...overrides,
  };
}
function check(source: MockNetworkStore, milliseconds = 1000) {
  return new MockProvider(source, "fixture").check({
    customerId: "customer", serviceId: "svc", checkedAt,
    deadlineAt: new Date(Date.now() + milliseconds).toISOString(),
  });
}
test("upstream down is independent from ONU online; repeated checks retain event ID", async () => {
  const first = await check(store()), second = await check(store());
  assert.equal(first.onu.status, "online");
  assert.equal(first.upstream[0].observation.status, "down");
  assert.equal(first.upstream[0].observation.eventId, second.upstream[0].observation.eventId);
});
test("ONU failure preserves usable upstream evidence", async () => {
  const result = await check(store({ getOnu: async () => { throw new Error("secret details"); } }));
  assert.equal(result.outcome, "ok"); assert.equal(result.onu.quality, "provider_error");
  assert.equal(result.upstream[0].observation.status, "down");
  assert(!JSON.stringify(result).includes("secret"));
});
test("upstream failure preserves fresh LOS", async () => {
  const result = await check(store({
    getOnu: async () => [{ serviceId: "svc", status: "LOS", observedAt: checkedAt, eventId: "los" }],
    getUpstream: async () => { throw new Error("failure"); },
  }));
  assert.equal(result.onu.status, "LOS"); assert.equal(result.upstreamQuality, "provider_error");
});
test("stale ONU does not invalidate independent upstream", async () => {
  const result = await check(store({ getOnu: async () => [{ serviceId: "svc", status: "LOS", observedAt: "2026-09-20T09:00:00Z", eventId: "old" }] }));
  assert.equal(result.onu.quality, "stale"); assert.equal(result.upstream[0].observation.status, "down");
});
test("upstream cannot assert impact against wrong or missing mapping", async () => {
  for (const source of [
    store({ getUpstream: async () => [{ linkId: "link", mappingVersion: 1, status: "down", observedAt: checkedAt, eventId: "event" }] }),
    store({ getContext: async () => ({ mapping: null, members: [] }) }),
  ]) {
    const result = await check(source);
    assert.equal(result.upstream[0].observation.quality, "mapping_invalid");
    assert.equal(result.upstream[0].observation.status, "unknown");
  }
});
test("missing service and unknown scenario return not_found without lookup observations", async () => {
  let called = false;
  const source = store({ getContext: async () => null, getOnu: async () => { called = true; return []; } });
  assert.equal((await check(source)).outcome, "not_found");
  assert.equal(called, false);
  assert.equal((await check(store({ getScenario: async () => null }))).reason, "scenario_not_found");
});
test("deadline also bounds a repository that ignores AbortSignal", async () => {
  const start = Date.now();
  const result = await check(store({ getContext: () => new Promise(() => {}) }), 25);
  assert.equal(result.reason, "timeout");
  assert(Date.now() - start < 1000);
});
test("partial timeout aborts request while preserving independent completed evidence", async () => {
  let aborted = false;
  const result = await check(store({ getOnu: async (_id, _services, signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return new Promise(() => {});
  } }), 25);
  assert.equal(result.onu.quality, "timeout");
  assert.equal(result.upstream[0].observation.status, "down");
  assert.equal(aborted, true);
});
test("simulated monitoring errors and timeouts never claim network down", async () => {
  for (const failure of ["error", "timeout"] as const) {
    const result = await check(store({ getScenario: async () => ({ onuFailure: failure, upstreamFailure: failure }) }), 25);
    assert.equal(result.outcome, "error");
    assert.equal(result.onu.status, "unknown");
    assert.deepEqual(result.upstream, []);
  }
});
test("ODP is preferred when ODP and ODC both qualify; ONU online remains online", async () => {
  const members = Array.from({ length: 5 }, (_, n) => ({ ...mapping, serviceId: n ? "svc-"+n : "svc" }));
  const result = await check(store({
    getContext: async () => ({ mapping, members }),
    getOnu: async () => members.map((m,n) => ({ serviceId: m.serviceId, status: n ? "LOS" : "online", observedAt: checkedAt, eventId: "area" })),
  }));
  assert.equal(result.indicatedArea?.scope, "ODP");
  assert.equal(result.onu.status, "online");
});

test("ODC can indicate when the target ODP has fewer than three LOS members", async () => {
  const members = Array.from({ length: 6 }, (_, n) => ({
    ...mapping, serviceId: n ? "svc-"+n : "svc", odpId: n < 2 ? "odp" : "other-odp",
  }));
  const result = await check(store({
    getContext: async () => ({ mapping, members }),
    getOnu: async () => members.map(m => ({
      serviceId: m.serviceId, status: "LOS", observedAt: checkedAt, eventId: "area",
    })),
  }));
  assert.equal(result.areas[0].state, "no_indication");
  assert.equal(result.indicatedArea?.scope, "ODC");
});

