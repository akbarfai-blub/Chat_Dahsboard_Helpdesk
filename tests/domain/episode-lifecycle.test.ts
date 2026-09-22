import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage } from "../../lib/domain/message-classification";
import { manualIdentity } from "../../lib/domain/sender-identity";
import {
  associateMessageToEpisode, classifyMessageOnEpisode, closeEpisode,
  deriveEpisodeScope, EPISODE_RULE_VERSION, isAutomationSuppressed,
  recordManualReply, reopenEpisode, reopenEpisodeFromInbound, resolveEpisode,
  splitEpisode, startHandling,
} from "../../lib/domain/episode-lifecycle";
import type {
  AssociationInput, EpisodeActionResult, EpisodeSnapshot, EpisodeStatus, StaffCommand,
} from "../../lib/domain/episode-contracts";
import type { TriageDecision } from "../../lib/domain/triage-contracts";

const at = "2026-09-22T10:00:00.000Z";
const identity = {
  outcome: "resolved" as const, ruleVersion: "sender-identity-v1" as const,
  reason: "verified_single_service" as const,
  identityId: "sender-1", customerId: "customer-1", serviceId: "service-1",
};
const command: StaffCommand = {
  actor: { kind: "staff", staffId: "staff-1" }, expectedVersion: 3, at,
};
const general: TriageDecision = {
  ruleVersion: "triage-test", evaluatedAt: at, outcome: "candidate", reason: "general_active",
  candidateTemplateKey: "MASS_GENERAL", effectiveTemplateKey: "MASS_GENERAL",
  incidentId: "incident-1", eventIds: [], evidence: [], notes: [],
  automation: { mode: "SHADOW", disposition: "blocked", blockedReasons: ["shadow_mode"] },
  dispatchAuthorized: false,
};

function episode(overrides: Partial<EpisodeSnapshot> = {}): EpisodeSnapshot {
  return {
    id: "episode-1", version: 3, status: "NEW", category: "connection_complaint",
    scope: { kind: "service", serviceId: "service-1", identityId: "sender-1" },
    automationSuppressed: false, isPrimary: true,
    closedAt: overrides.status === "CLOSED" ? at : null,
    splitFromEpisodeId: null, previousEpisodeId: null, ...overrides,
  };
}

function input(overrides: Partial<AssociationInput> = {}): AssociationInput {
  return { classification: classifyMessage("wifi mati"), identity, existingEpisodes: [], ...overrides };
}

function accepted(result: EpisodeActionResult) {
  assert.equal(result.outcome, "accepted");
  if (result.outcome !== "accepted") throw new Error("Expected accepted transition");
  return result;
}

test("identity resolution preserves service and isolates unresolved senders", () => {
  assert.deepEqual(deriveEpisodeScope(identity), episode().scope);
  assert.deepEqual(deriveEpisodeScope(manualIdentity("unverified", "sender-2")),
    { kind: "identity_only", identityId: "sender-2" });
  assert.equal(deriveEpisodeScope(manualIdentity("no_match")), null);
  assert.equal(deriveEpisodeScope(null), null);
  assert.equal(deriveEpisodeScope({ ...identity, serviceId: " " }), null);
});

test("first complaint creates an episode; follow-up reuses it across conversations", () => {
  const created = associateMessageToEpisode(input());
  assert.equal(created.outcome, "create_new");
  assert.equal(created.newEpisodeCategory, "connection_complaint");
  for (const status of ["NEW", "IN_PROGRESS"] as const) {
    const result = associateMessageToEpisode(input({ existingEpisodes: [episode({ status })] }));
    assert.equal(result.outcome, "attach_existing");
    assert.equal(result.episodeId, "episode-1");
    assert.equal(result.expectedVersion, 3);
  }
});

test("different services and unresolved sender IDs are never attached", () => {
  const foreign = episode({ scope: { kind: "service", serviceId: "service-2", identityId: "sender-2" } });
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [foreign] })).outcome, "create_new");
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [foreign],
    targetEpisodeId: foreign.id })).reason, "invalid_target_episode");
  const unresolved = episode({ scope: { kind: "identity_only", identityId: "sender-2" } });
  assert.equal(associateMessageToEpisode(input({ identity: manualIdentity("unverified", "sender-3"),
    existingEpisodes: [unresolved] })).outcome, "create_new");
});

for (const status of ["NEW", "RESOLVED", "CLOSED"] as const) {
  test(`identity linking requires reconciliation, including ${status} history`, () => {
    const old = episode({ status, scope: { kind: "identity_only", identityId: "sender-1" } });
    const result = associateMessageToEpisode(input({ existingEpisodes: [old] }));
    assert.equal(result.reason, "identity_reconciliation_required");
    assert.equal(result.outcome, "review");
    assert.equal(result.newEpisodeScope, null);
  });
}

test("identity downgrade or service reassignment requires reconciliation", () => {
  assert.equal(associateMessageToEpisode(input({ identity: manualIdentity("unverified", "sender-1"),
    existingEpisodes: [episode()] })).reason, "identity_reconciliation_required");
  assert.equal(associateMessageToEpisode(input({ identity: { ...identity, serviceId: "service-2" },
    existingEpisodes: [episode()] })).reason, "identity_reconciliation_required");
});

test("split routing uses one primary or an explicit target", () => {
  const primary = episode();
  const child = episode({ id: "child", isPrimary: false, splitFromEpisodeId: primary.id });
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [child, primary] })).episodeId, primary.id);
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [primary, child],
    targetEpisodeId: child.id })).episodeId, child.id);
  for (const isPrimary of [true, false]) {
    assert.equal(associateMessageToEpisode(input({ existingEpisodes: [
      { ...primary, isPrimary }, { ...child, isPrimary },
    ] })).reason, "multiple_candidates");
  }
});

test("mixed open/resolved problems require a target; keywords alone do not prove recurrence", () => {
  const resolved = episode({ id: "resolved", status: "RESOLVED", isPrimary: false });
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [episode(), resolved] })).reason,
    "multiple_candidates");
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [resolved] })).reason,
    "same_problem_confirmation_required");
  assert.equal(associateMessageToEpisode(input({ existingEpisodes: [episode(), resolved],
    targetEpisodeId: resolved.id })).outcome, "reopen_resolved");
});

test("thanks and ambiguous messages remain review without GENERAL and never reopen", () => {
  for (const text of ["terima kasih", "internet"]) {
    const result = associateMessageToEpisode(input({ classification: classifyMessage(text),
      existingEpisodes: [episode({ status: "RESOLVED" })], targetEpisodeId: "episode-1" }));
    assert.equal(result.outcome, "review");
    assert.equal(result.reopenIntent, false);
  }
});

test("GENERAL uses the P1.2 candidate in SHADOW and does not duplicate a resolved reception", () => {
  const request = input({ classification: classifyMessage("terima kasih"), triageDecision: general });
  assert.equal(associateMessageToEpisode(request).newEpisodeCategory, "other");
  const result = associateMessageToEpisode({ ...request,
    existingEpisodes: [episode({ status: "RESOLVED", category: "other" })] });
  assert.equal(result.outcome, "attach_existing");
  assert.equal(result.reopenIntent, false);
  assert.equal(associateMessageToEpisode({ ...request, triageDecision: { ...general,
    outcome: "review", reason: "conflicting_manual_incidents" } }).outcome, "review");
});

test("closed history sorts by timestamp, with a deterministic ID tie-break", () => {
  const old = episode({ id: "old", status: "CLOSED", version: 99, closedAt: "2026-09-20T00:00:00Z" });
  const recent = episode({ id: "recent", status: "CLOSED", version: 1 });
  const tied = episode({ id: "z-recent", status: "CLOSED", version: 2 });
  for (const episodes of [[old, recent], [recent, old]]) {
    const result = associateMessageToEpisode(input({ existingEpisodes: episodes }));
    assert.equal(result.outcome, "create_after_closed");
    assert.equal(result.previousEpisodeId, recent.id);
  }
  for (const episodes of [[recent, tied], [tied, recent]]) {
    assert.equal(associateMessageToEpisode(input({ existingEpisodes: episodes })).previousEpisodeId, tied.id);
  }
});

test("invalid snapshots, duplicated IDs and missing identity are reviewed", () => {
  for (const episodes of [[episode({ status: "CLOSED", closedAt: null })], [episode(), episode()]]) {
    assert.equal(associateMessageToEpisode(input({ existingEpisodes: episodes })).reason, "invalid_episode_snapshot");
  }
  assert.equal(associateMessageToEpisode(input({ identity: null })).reason, "scope_identity_null");
});

const actions = {
  start: startHandling,
  resolve: (ep: EpisodeSnapshot, cmd: StaffCommand) => resolveEpisode(ep, { ...cmd, resolutionNote: " Pulih " }),
  reopen: reopenEpisode,
  close: closeEpisode,
  manual: recordManualReply,
};
const expected: Record<keyof typeof actions, Record<EpisodeStatus, string>> = {
  start: { NEW: "accepted", IN_PROGRESS: "accepted", RESOLVED: "rejected", CLOSED: "rejected" },
  resolve: { NEW: "accepted", IN_PROGRESS: "accepted", RESOLVED: "accepted", CLOSED: "rejected" },
  reopen: { NEW: "rejected", IN_PROGRESS: "rejected", RESOLVED: "accepted", CLOSED: "rejected" },
  close: { NEW: "rejected", IN_PROGRESS: "rejected", RESOLVED: "accepted", CLOSED: "noop" },
  manual: { NEW: "accepted", IN_PROGRESS: "accepted", RESOLVED: "accepted", CLOSED: "rejected" },
};

for (const name of Object.keys(actions) as (keyof typeof actions)[]) {
  test(`${name}: state guards and stale requests`, () => {
    for (const status of ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
      assert.equal(actions[name](episode({ status }), command).outcome, expected[name][status]);
      assert.equal(actions[name](episode({ status }), { ...command, expectedVersion: 2 }).reason, "version_mismatch");
    }
    assert.equal(actions[name](episode(), { ...command, expectedVersion: 0 }).reason, "invalid_version");
    assert.equal(actions[name](episode(), { ...command, at: "invalid" }).reason, "invalid_timestamp");
    assert.equal(actions[name](episode(), { ...command, actor: { kind: "staff", staffId: " " } }).reason, "invalid_actor");
  });
}

test("resolution preserves trimmed note and actor/time for atomic audit", () => {
  const result = accepted(resolveEpisode(episode(), { ...command, resolutionNote: "  Pulih  " }));
  assert.equal(result.changes.status, "RESOLVED");
  assert.equal(result.changes.resolutionNote, "Pulih");
  assert.equal(result.changes.automationSuppressed, true);
  assert.deepEqual(result.audit.actor, command.actor);
  assert.equal(result.audit.at, at);
  assert.equal(result.expectedVersion, 3);
  assert.equal(resolveEpisode(episode(), { ...command, resolutionNote: "  " }).reason, "resolution_note_empty");
});

test("invalid calendar dates and timestamps without timezone are rejected, including split", () => {
  for (const invalidAt of ["2026-02-30T00:00:00Z", "2026-09-22T10:00:00", "2026-09-22T24:00:00Z"]) {
    assert.equal(startHandling(episode(), { ...command, at: invalidAt }).reason, "invalid_timestamp");
    assert.equal(splitEpisode(episode(), { ...command, at: invalidAt, splitReason: "Other issue" }).reason,
      "invalid_timestamp");
  }
});

test("repeated lifecycle actions produce no state or audit mutation", () => {
  for (const result of [
    startHandling(episode({ status: "IN_PROGRESS", automationSuppressed: true }), command),
    resolveEpisode(episode({ status: "RESOLVED", automationSuppressed: true }), { ...command, resolutionNote: "Pulih" }),
    closeEpisode(episode({ status: "CLOSED" }), command),
  ]) {
    assert.equal(result.outcome, "noop");
    assert.equal("changes" in result, false);
    assert.equal("audit" in result, false);
  }
});

test("close records UTC time and staff/manual takeover suppresses pending automation", () => {
  const closed = accepted(closeEpisode(episode({ status: "RESOLVED" }), {
    ...command, at: "2026-09-22T17:00:00+07:00",
  }));
  assert.equal(closed.changes.closedAt, at);
  for (const action of [startHandling, recordManualReply]) {
    const result = accepted(action(episode(), command));
    assert.equal(result.changes.automationSuppressed, true);
    assert.equal(result.changes.status, "IN_PROGRESS");
  }
});

test("inbound reopen has a message actor, preserves suppression and requires matching association", () => {
  for (const automationSuppressed of [false, true]) {
    const ep = episode({ status: "RESOLVED", automationSuppressed });
    const request = { expectedVersion: 3, at, messageId: "message-1",
      association: input({ existingEpisodes: [ep], targetEpisodeId: ep.id }) };
    const result = accepted(reopenEpisodeFromInbound(ep, request));
    assert.equal(result.episodeId, ep.id);
    assert.equal(result.changes.status, "IN_PROGRESS");
    assert.equal(result.changes.automationSuppressed, automationSuppressed);
    assert.deepEqual(result.audit.actor, { kind: "inbound", identityId: "sender-1", messageId: "message-1" });
    assert.equal(reopenEpisodeFromInbound(ep, { ...request, expectedVersion: 2 }).reason, "version_mismatch");
    for (const text of ["terima kasih", "internet"]) {
      assert.equal(reopenEpisodeFromInbound(ep, { ...request, association: { ...request.association,
        classification: classifyMessage(text) } }).reason, "inbound_reopen_not_allowed");
    }
    assert.equal(reopenEpisodeFromInbound(ep, { ...request, association: { ...request.association,
      identity: { ...identity, serviceId: "foreign-service" } } }).reason, "inbound_reopen_not_allowed");
  }
});

test("split validates source version, timestamp and reason without changing source", () => {
  const ep = episode({ status: "IN_PROGRESS" });
  const original = structuredClone(ep);
  const request = { ...command, splitReason: " Masalah perangkat lain " };
  const result = splitEpisode(ep, request);
  assert.equal(result.outcome, "accepted");
  if (result.outcome !== "accepted") return;
  assert.equal(result.expectedVersion, ep.version);
  assert.equal(result.newEpisode.splitFromEpisodeId, ep.id);
  assert.equal(result.newEpisode.isPrimary, false);
  assert.equal(result.newEpisode.automationSuppressed, true);
  assert.equal(result.audit.reason, "Masalah perangkat lain");
  result.newEpisode.scope.identityId = "changed-output";
  assert.deepEqual(ep, original);
  assert.equal(splitEpisode(ep, { ...request, at: "" }).reason, "invalid_timestamp");
  assert.equal(splitEpisode(ep, { ...request, expectedVersion: 2 }).reason, "version_mismatch");
  assert.equal(splitEpisode(ep, { ...request, splitReason: " " }).reason, "split_reason_empty");
  assert.equal(splitEpisode(episode({ status: "CLOSED" }), request).reason, "closed_is_final");
});

test("message position, suppression and delivery authorization stay separate", () => {
  const first = classifyMessageOnEpisode(episode(), true);
  assert.equal(first.firstResponseCandidate, true);
  assert.equal(first.dispatchAuthorized, false);
  assert.equal(classifyMessageOnEpisode(episode(), false).firstResponseCandidate, false);
  const suppressed = episode({ automationSuppressed: true });
  assert.equal(isAutomationSuppressed(suppressed), true);
  assert.equal(classifyMessageOnEpisode(suppressed, true).isFollowUp, false);
  assert.equal(classifyMessageOnEpisode(suppressed, true).firstResponseCandidate, false);
  for (const status of ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
    assert.equal(classifyMessageOnEpisode(episode({ status }), true).firstResponseCandidate, false);
  }
});

test("domain decisions are deterministic and do not mutate their inputs", () => {
  const ep = episode();
  const request = input({ existingEpisodes: [ep] });
  const original = structuredClone({ ep, request, command });
  assert.deepEqual(startHandling(ep, command), startHandling(ep, command));
  assert.deepEqual(associateMessageToEpisode(request), associateMessageToEpisode(request));
  assert.deepEqual({ ep, request, command }, original);
  assert.equal(startHandling(ep, command).ruleVersion, EPISODE_RULE_VERSION);
});
