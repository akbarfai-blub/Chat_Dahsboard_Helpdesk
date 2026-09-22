import test from "node:test";
import assert from "node:assert/strict";
import { planReplyClaim, restrictiveMode, evidenceTargets } from "../../lib/domain/reply-claim";
import type { EpisodeSnapshot } from "../../lib/domain/episode-contracts";
import type { TriageDecision } from "../../lib/domain/triage-contracts";

const episode: EpisodeSnapshot = {
  id: "episode", version: 1, status: "NEW", category: "connection_complaint",
  scope: { kind: "identity_only", identityId: "sender" }, isPrimary: true,
  automationSuppressed: false, closedAt: null, splitFromEpisodeId: null, previousEpisodeId: null,
};
const decision: TriageDecision = {
  ruleVersion: "test", evaluatedAt: "2026-09-22T00:00:00Z", outcome: "candidate", reason: "identity_unresolved",
  candidateTemplateKey: "GENERIC", effectiveTemplateKey: "GENERIC",
  incidentId: null, eventIds: [], evidence: [], notes: [],
  automation: { mode: "FULL", disposition: "pending_delivery_checks", blockedReasons: [] },
  dispatchAuthorized: false,
};

test("receipt/current modes use the more restrictive setting in both directions", () => {
  const modes = ["SHADOW", "LOS_AND_GENERIC", "FULL"] as const;
  for (let a = 0; a < modes.length; a++) for (let b = 0; b < modes.length; b++) {
    assert.equal(restrictiveMode(modes[a], modes[b]), modes[Math.min(a, b)]);
  }
});

test("claim plan includes episode and distinct incident/event keys but never authorizes dispatch", () => {
  const plan = planReplyClaim(episode, true, { ...decision, incidentId: "same-id", eventIds: ["same-id", "other", "other"] });
  assert.equal(plan.reason, null);
  assert.equal(plan.targets.length, 4);
  assert.equal(plan.targets[0].kind, "episode");
  assert.equal(plan.dispatchAuthorized, false);
  assert.deepEqual(evidenceTargets(decision), []);
});

test("shadow, blocked decisions, staff takeover, follow-ups and final episodes cannot reserve", () => {
  assert.equal(planReplyClaim(episode, true, { ...decision,
    automation: { ...decision.automation, mode: "SHADOW" } }).reason, "shadow_mode");
  assert.equal(planReplyClaim(episode, true, { ...decision,
    automation: { ...decision.automation, disposition: "blocked", blockedReasons: ["emergency_stop"] } }).reason, "automation_blocked");
  assert.equal(planReplyClaim({ ...episode, automationSuppressed: true }, true, decision).reason, "staff_takeover");
  assert.equal(planReplyClaim(episode, false, decision).reason, "follow_up");
  assert.equal(planReplyClaim({ ...episode, status: "RESOLVED" }, true, decision).targets.length, 0);
  assert.equal(planReplyClaim(episode, true, { ...decision, outcome: "review" }).reason, "no_candidate");
});
