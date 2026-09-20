import test from "node:test";
import assert from "node:assert/strict";
import { assessObservation, assessArea } from "../../lib/domain/network-status";
import type { AreaMember, OnuStatus } from "../../lib/domain/network-status";

const now = "2026-09-20T10:00:00.000Z";
const raw = (status: OnuStatus, time: string | null = now) => ({ status, observedAt: time, eventId: null });
function member(n: number, status: OnuStatus, time: string | null = now): AreaMember {
  return { serviceId: String(n), mappingVersion: 1, observation: assessObservation(raw(status, time), now) };
}

test("freshness includes exactly five minutes and excludes the next millisecond", () => {
  assert.equal(assessObservation(raw("LOS", "2026-09-20T09:55:00.000Z"), now).status, "LOS");
  const result = assessObservation(raw("LOS", "2026-09-20T09:54:59.999Z"), now);
  assert.equal(result.quality, "stale");
  assert.equal(result.status, "unknown");
  assert.equal(result.reportedStatus, "LOS");
});
test("missing, future and malformed timestamps never become usable status", () => {
  for (const time of [null, "invalid", "2026-09-20T10:00:00.001Z"]) {
    assert.equal(assessObservation(raw("online", time), now).quality, "invalid_timestamp");
  }
  assert.equal(assessObservation(null, now).quality, "not_found");
  assert.equal(assessObservation(raw("unknown"), now).quality, "unknown");
});
test("provider failures override data without claiming network down", () => {
  for (const failure of ["timeout", "provider_error", "mapping_invalid"] as const) {
    const result = assessObservation(raw("LOS"), now, 300000, failure);
    assert.equal(result.status, "unknown");
    assert.equal(result.quality, failure);
  }
});
test("invalid evaluation time and freshness are rejected", () => {
  assert.equal(assessObservation(raw("online"), "bad").quality, "invalid_timestamp");
  assert.equal(assessObservation(raw("online"), now, -1).quality, "invalid_timestamp");
});
test("area accepts 4 LOS / 8 valid / 10 members at both ratio and coverage boundaries", () => {
  const rows = Array.from({ length: 10 }, (_, n) => member(n, n < 4 ? "LOS" : n < 8 ? "online" : "unknown"));
  const area = assessArea("ODP", "odp-1", rows);
  assert.equal(area.state, "indicated");
  assert.equal(area.coverage, 0.8);
  assert.equal(area.losRatio, 0.5);
});
test("minimum LOS count is three, independent of ratio", () => {
  assert.equal(assessArea("ODP", "a", [member(1,"LOS"),member(2,"LOS")]).state, "no_indication");
  assert.equal(assessArea("ODP", "a", [member(1,"LOS"),member(2,"LOS"),member(3,"LOS")]).state, "indicated");
});
test("high LOS ratio with insufficient coverage stays unknown", () => {
  const rows = Array.from({ length: 10 }, (_, n) => member(n, n < 4 ? "LOS" : n < 6 ? "online" : "unknown"));
  const area = assessArea("ODP", "a", rows);
  assert.equal(area.state, "unknown");
  assert.equal(area.valid, 6);
  assert.equal(area.total, 10);
});
test("stale and absent observations remain in total but never count as valid", () => {
  const stale = member(4, "LOS", "2026-09-20T09:00:00Z");
  const missing = { ...member(5, "online"), observation: assessObservation<OnuStatus>(null, now) };
  const area = assessArea("ODC", "a", [member(1,"LOS"),member(2,"LOS"),member(3,"LOS"),stale,missing]);
  assert.equal(area.valid, 3); assert.equal(area.total, 5); assert.equal(area.state, "unknown");
});
test("duplicate memberships cannot inflate counts; conflicting duplicates fail closed", () => {
  const one = member(1, "LOS");
  const same = assessArea("ODP", "a", [one, one, one]);
  assert.equal(same.total, 1); assert.equal(same.los, 1);
  const conflict = assessArea("ODP", "a", [one, member(1,"online"), one]);
  assert.equal(conflict.valid, 0);
  assert.equal(assessArea("ODP", "a", []).state, "unknown");
});
