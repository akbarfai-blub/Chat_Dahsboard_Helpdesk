import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH,
  PRE_DISPATCH_RULE_VERSION,
  type PreDispatchBlockedReason,
  type PreDispatchEvaluationInput,
  type PreDispatchEvaluationResult,
} from "../../lib/domain/dispatch-contracts";
import { evaluatePreDispatchGate } from "../../lib/domain/dispatch-gate";
import type { EpisodeSnapshot } from "../../lib/domain/episode-contracts";
import { SIMULATION_PREFIX } from "../../lib/domain/template-contracts";
import type { TriageDecision } from "../../lib/domain/triage-contracts";

function createValidEpisode(overrides: Partial<EpisodeSnapshot> = {}): EpisodeSnapshot {
  return {
    id: "ep-001",
    version: 1,
    status: "NEW",
    category: "connection_complaint",
    scope: { kind: "identity_only", identityId: "ident-001" },
    isPrimary: true,
    automationSuppressed: false,
    closedAt: null,
    splitFromEpisodeId: null,
    previousEpisodeId: null,
    ...overrides,
  };
}

function createValidDecision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    ruleVersion: "test-v1",
    evaluatedAt: "2026-10-19T00:00:00Z",
    outcome: "candidate",
    reason: "los_individual",
    candidateTemplateKey: "LOS_INDIVIDUAL",
    effectiveTemplateKey: "LOS_INDIVIDUAL",
    incidentId: null,
    eventIds: ["ont-01"],
    evidence: [{ kind: "onu", status: "LOS", observedAt: "2026-10-19T00:00:00Z", eventId: "ont-01" }],
    notes: [],
    automation: {
      mode: "LOS_AND_GENERIC",
      disposition: "pending_delivery_checks",
      blockedReasons: [],
    },
    dispatchAuthorized: false,
    ...overrides,
  };
}

function createValidAutomaticInput(
  overrides: {
    intent?: Partial<PreDispatchEvaluationInput["intent"]>;
    handoff?: Partial<PreDispatchEvaluationInput["handoff"]>;
    claims?: Partial<PreDispatchEvaluationInput["claims"]>;
    currentSettings?: Partial<NonNullable<PreDispatchEvaluationInput["currentSettings"]>> | null;
    currentIncident?: Partial<NonNullable<PreDispatchEvaluationInput["currentIncident"]>> | null;
    testerAllowlist?: readonly string[];
  } = {}
): PreDispatchEvaluationInput {
  const episode = createValidEpisode();
  const decision = createValidDecision();
  const intentId = "intent-auto-001";
  const ownerId = "owner-001";
  const complaintId = episode.id;

  return {
    evaluatedAt: "2026-10-19T05:00:00.000Z",
    testerAllowlist: overrides.testerAllowlist ?? ["12345678", "87654321"],
    intent: {
      id: intentId,
      origin: "automatic",
      status: "pending",
      complaintId,
      ownerId,
      messageId: "msg-001",
      decision,
      staffId: null,
      clientRequestId: null,
      body: `${SIMULATION_PREFIX} Halo, koneksi Anda terdeteksi mengalami gangguan kabel fiber optik (LOS).`,
      templateVersionId: "tpl-ver-001",
      templateKey: "LOS_INDIVIDUAL",
      templateVersion: 1,
      templateScope: "default",
      templateError: null,
      ...overrides.intent,
    },
    handoff: {
      episode,
      conversationId: "conv-001",
      channel: "telegram",
      channelAccountId: "bot_123",
      chatId: "12345678",
      senderExternalId: "12345678",
      customerVerifiedOwnerId: null,
      messagePersisted: true,
      assessmentPersisted: true,
      ingress: { mode: "LOS_AND_GENERIC", emergencyStop: false },
      isFirstMessageOnEpisode: true,
      hasStaffReplyOnEpisode: false,
      hasOtherActiveOrSentAutoIntentOnEpisode: false,
      ...overrides.handoff,
    },
    claims: {
      intentOwner: { id: ownerId, mergedInto: null },
      existingClaims: [
        {
          ownerId,
          scopeKind: "episode",
          scopeId: complaintId,
          outboundIntentId: intentId,
        },
        {
          ownerId,
          scopeKind: "event",
          scopeId: "ont-01",
          outboundIntentId: intentId,
        },
      ],
      ...overrides.claims,
    },
    currentSettings:
      overrides.currentSettings === null
        ? null
        : {
            mode: "LOS_AND_GENERIC",
            emergencyStop: false,
            version: 1,
            ...overrides.currentSettings,
          },
    currentIncident:
      overrides.currentIncident === null
        ? null
        : overrides.currentIncident !== undefined
        ? {
            id: "inc-001",
            type: "GENERAL",
            status: "ACTIVE",
            version: 1,
            odpIds: [],
            odcIds: [],
            ...overrides.currentIncident,
          }
        : null,
  };
}

function createValidStaffInput(
  overrides: {
    intent?: Partial<PreDispatchEvaluationInput["intent"]>;
    handoff?: Partial<PreDispatchEvaluationInput["handoff"]>;
    claims?: Partial<PreDispatchEvaluationInput["claims"]>;
    currentSettings?: Partial<NonNullable<PreDispatchEvaluationInput["currentSettings"]>> | null;
    testerAllowlist?: readonly string[];
  } = {}
): PreDispatchEvaluationInput {
  const episode = createValidEpisode({
    status: "IN_PROGRESS",
    automationSuppressed: true,
  });
  const intentId = "intent-staff-001";
  const complaintId = episode.id;

  return {
    evaluatedAt: "2026-10-19T05:00:00.000Z",
    testerAllowlist: overrides.testerAllowlist ?? ["12345678"],
    intent: {
      id: intentId,
      origin: "staff",
      status: "pending",
      complaintId,
      ownerId: null,
      messageId: null,
      decision: null,
      staffId: "usr-staff-001",
      clientRequestId: "req-staff-001",
      body: `${SIMULATION_PREFIX} Halo, teknisi kami sedang menuju lokasi.`,
      templateVersionId: null,
      templateKey: null,
      templateVersion: null,
      templateScope: null,
      templateError: null,
      ...overrides.intent,
    },
    handoff: {
      episode,
      conversationId: "conv-001",
      channel: "telegram",
      channelAccountId: "bot_123",
      chatId: "12345678",
      senderExternalId: "12345678",
      customerVerifiedOwnerId: null,
      ...overrides.handoff,
    },
    claims: {
      intentOwner: null,
      existingClaims: [],
      ...overrides.claims,
    },
    currentSettings:
      overrides.currentSettings === null
        ? null
        : {
            mode: "SHADOW", // Staff replies allowed even in SHADOW mode
            emergencyStop: true, // Staff replies allowed even during emergency stop
            version: 1,
            ...overrides.currentSettings,
          },
    currentIncident: null,
  };
}

function assertBlockedContains(
  result: PreDispatchEvaluationResult,
  expectedReason: PreDispatchBlockedReason
): void {
  assert.equal(result.outcome, "blocked");
  if (result.outcome === "blocked") {
    assert.ok(
      result.blockedReasons.includes(expectedReason),
      `Expected ${result.blockedReasons.join(", ")} to include ${expectedReason}`
    );
  }
}

test("evaluatePreDispatchGate - Happy path automatic authorization in LOS_AND_GENERIC", () => {
  const input = createValidAutomaticInput();
  const result = evaluatePreDispatchGate(input);

  assert.equal(result.outcome, "authorized");
  assert.equal(result.dispatchAuthorized, true);
  assert.equal(result.ruleVersion, PRE_DISPATCH_RULE_VERSION);
  assert.equal(result.intentId, "intent-auto-001");
  assert.equal(result.origin, "automatic");
  assert.equal(result.channel, "telegram");
  assert.equal(result.channelAccountId, "bot_123");
  assert.equal(result.chatId, "12345678");
  assert.equal(result.senderExternalId, "12345678");
  assert.equal(result.effectiveMode, "LOS_AND_GENERIC");
  assert.equal(result.authorizedIncidentId, null);
  assert.equal(result.authorizedIncidentVersion, null);
  assert.equal(result.shouldCancelIntent, false);
  assert.deepEqual(result.blockedReasons, []);
});

test("evaluatePreDispatchGate - Happy path automatic authorization in FULL with active incident", () => {
  const input = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_GENERAL",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_GENERAL",
        effectiveTemplateKey: "MASS_GENERAL",
        incidentId: "inc-gen-001",
        reason: "general_active",
        eventIds: [],
        automation: { mode: "FULL", disposition: "pending_delivery_checks", blockedReasons: [] },
      }),
      templateScope: "incident",
    },
    handoff: {
      ingress: { mode: "FULL", emergencyStop: false },
    },
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "incident", scopeId: "inc-gen-001", outboundIntentId: "intent-auto-001" },
      ],
    },
    currentSettings: { mode: "FULL", emergencyStop: false, version: 2 },
    currentIncident: {
      id: "inc-gen-001",
      type: "GENERAL",
      status: "ACTIVE",
      version: 3,
      odpIds: [],
      odcIds: [],
    },
  });

  const result = evaluatePreDispatchGate(input);
  assert.equal(result.outcome, "authorized");
  assert.equal(result.dispatchAuthorized, true);
  assert.equal(result.effectiveMode, "FULL");
  assert.equal(result.authorizedIncidentId, "inc-gen-001");
  assert.equal(result.authorizedIncidentVersion, 3);
});

test("evaluatePreDispatchGate - Happy path staff reply authorization even in SHADOW and emergency stop", () => {
  const input = createValidStaffInput();
  const result = evaluatePreDispatchGate(input);

  assert.equal(result.outcome, "authorized");
  assert.equal(result.dispatchAuthorized, true);
  assert.equal(result.origin, "staff");
  assert.equal(result.chatId, "12345678");
  assert.equal(result.senderExternalId, "12345678");
  assert.equal(result.effectiveMode, "SHADOW");
  assert.equal(result.shouldCancelIntent, false);
});

test("evaluatePreDispatchGate - Guard 1: intent_not_pending fails closed immediately without cancelling", () => {
  const nonPendingStatuses = ["in_flight", "sent", "failed", "unknown", "cancelled"];
  for (const status of nonPendingStatuses) {
    const input = createValidAutomaticInput({
      intent: { status },
    });
    const result = evaluatePreDispatchGate(input);
    assert.equal(result.outcome, "blocked");
    assert.equal(result.dispatchAuthorized, false);
    if (result.outcome === "blocked") {
      assert.equal(result.primaryReason, "intent_not_pending");
      assert.deepEqual(result.blockedReasons, ["intent_not_pending"]);
    }
    assert.equal(result.shouldCancelIntent, false, `Status ${status} must not be marked to cancel`);
  }
});

test("evaluatePreDispatchGate - Guard 1: invalid_intent checks for missing required fields", () => {
  // Automatic missing ownerId
  const autoNoOwner = createValidAutomaticInput({
    intent: { ownerId: null },
  });
  const res1 = evaluatePreDispatchGate(autoNoOwner);
  assertBlockedContains(res1, "invalid_intent");
  assert.equal(res1.shouldCancelIntent, true);

  // Automatic having staffId
  const autoWithStaff = createValidAutomaticInput({
    intent: { staffId: "usr-01" },
  });
  const res2 = evaluatePreDispatchGate(autoWithStaff);
  assertBlockedContains(res2, "invalid_intent");

  // Staff missing staffId or clientRequestId
  const staffNoId = createValidStaffInput({
    intent: { staffId: null },
  });
  const res3 = evaluatePreDispatchGate(staffNoId);
  assertBlockedContains(res3, "invalid_intent");

  // Staff having ownerId or messageId
  const staffWithOwner = createValidStaffInput({
    intent: { ownerId: "owner-01" },
  });
  const res4 = evaluatePreDispatchGate(staffWithOwner);
  assertBlockedContains(res4, "invalid_intent");
});

test("evaluatePreDispatchGate - Guard 2: handoff_not_persisted checks", () => {
  // Episode is null
  const noEpisode = createValidAutomaticInput({
    handoff: { episode: null },
  });
  const res1 = evaluatePreDispatchGate(noEpisode);
  assertBlockedContains(res1, "handoff_not_persisted");

  // Episode ID does not match intent complaintId
  const mismatchedEpisode = createValidAutomaticInput({
    handoff: { episode: createValidEpisode({ id: "different-ep" }) },
  });
  const res2 = evaluatePreDispatchGate(mismatchedEpisode);
  assertBlockedContains(res2, "handoff_not_persisted");

  // ConversationId is null or empty
  const emptyConv = createValidAutomaticInput({
    handoff: { conversationId: "   " },
  });
  const res3 = evaluatePreDispatchGate(emptyConv);
  assertBlockedContains(res3, "handoff_not_persisted");

  // Automatic: message not persisted
  const noMsgPersist = createValidAutomaticInput({
    handoff: { messagePersisted: false },
  });
  const res4 = evaluatePreDispatchGate(noMsgPersist);
  assertBlockedContains(res4, "handoff_not_persisted");

  // Automatic: assessment not persisted
  const noAssessPersist = createValidAutomaticInput({
    handoff: { assessmentPersisted: false },
  });
  const res5 = evaluatePreDispatchGate(noAssessPersist);
  assertBlockedContains(res5, "handoff_not_persisted");

  // Automatic: ingress is null
  const noIngress = createValidAutomaticInput({
    handoff: { ingress: null },
  });
  const res6 = evaluatePreDispatchGate(noIngress);
  assertBlockedContains(res6, "handoff_not_persisted");
});

test("evaluatePreDispatchGate - Guard 3: Channel, tester allowlist & private chat checks", () => {
  // Non-telegram channel
  const wrongChannel = createValidAutomaticInput({
    handoff: { channel: "whatsapp" },
  });
  const res1 = evaluatePreDispatchGate(wrongChannel);
  assertBlockedContains(res1, "unsupported_channel");

  // Empty channel account ID
  const emptyAccount = createValidAutomaticInput({
    handoff: { channelAccountId: "  " },
  });
  const res2 = evaluatePreDispatchGate(emptyAccount);
  assertBlockedContains(res2, "unsupported_channel");

  // Empty tester allowlist
  const emptyAllowlist = createValidAutomaticInput({
    testerAllowlist: [],
  });
  const res3 = evaluatePreDispatchGate(emptyAllowlist);
  assertBlockedContains(res3, "empty_tester_allowlist");

  // Non-positive-safe-integer entries in allowlist are filtered out
  const invalidAllowlist = createValidAutomaticInput({
    testerAllowlist: ["abc", "-100", "0", "9999999999999999999999"],
  });
  const res4 = evaluatePreDispatchGate(invalidAllowlist);
  assertBlockedContains(res4, "empty_tester_allowlist");

  // Non-private chat (chatId !== senderExternalId)
  const groupChat = createValidAutomaticInput({
    handoff: { chatId: "-10012345678", senderExternalId: "12345678" },
  });
  const res5 = evaluatePreDispatchGate(groupChat);
  assertBlockedContains(res5, "non_private_chat");

  // Negative chatId (Telegram group)
  const negativeChat = createValidAutomaticInput({
    handoff: { chatId: "-12345", senderExternalId: "-12345" },
  });
  const res6 = evaluatePreDispatchGate(negativeChat);
  assertBlockedContains(res6, "non_private_chat");

  // Sender or chat not in allowlist
  const notInAllowlist = createValidAutomaticInput({
    handoff: { chatId: "999999", senderExternalId: "999999" },
    testerAllowlist: ["12345678"],
  });
  const res7 = evaluatePreDispatchGate(notInAllowlist);
  assertBlockedContains(res7, "not_in_tester_allowlist");

  // Tester allowlist applies equally to staff reply
  const staffNotInAllowlist = createValidStaffInput({
    handoff: { chatId: "999999", senderExternalId: "999999" },
    testerAllowlist: ["12345678"],
  });
  const res8 = evaluatePreDispatchGate(staffNotInAllowlist);
  assertBlockedContains(res8, "not_in_tester_allowlist");
});

test("evaluatePreDispatchGate - Guard 4: Follow-up & staff takeover", () => {
  // Episode closed blocks both automatic and staff
  const closedAuto = createValidAutomaticInput({
    handoff: { episode: createValidEpisode({ status: "CLOSED" }) },
  });
  const res1 = evaluatePreDispatchGate(closedAuto);
  assertBlockedContains(res1, "episode_closed");

  const closedStaff = createValidStaffInput({
    handoff: { episode: createValidEpisode({ status: "CLOSED" }) },
  });
  const res2 = evaluatePreDispatchGate(closedStaff);
  assertBlockedContains(res2, "episode_closed");

  // Staff takeover blocks automatic: automationSuppressed = true
  const suppressedAuto = createValidAutomaticInput({
    handoff: { episode: createValidEpisode({ automationSuppressed: true }) },
  });
  const res3 = evaluatePreDispatchGate(suppressedAuto);
  assertBlockedContains(res3, "staff_takeover");

  // Staff takeover blocks automatic: hasStaffReplyOnEpisode = true
  const staffRepliedAuto = createValidAutomaticInput({
    handoff: { hasStaffReplyOnEpisode: true },
  });
  const res4 = evaluatePreDispatchGate(staffRepliedAuto);
  assertBlockedContains(res4, "staff_takeover");

  // Follow-up blocks automatic: episode status !== "NEW"
  const inProgressAuto = createValidAutomaticInput({
    handoff: { episode: createValidEpisode({ status: "IN_PROGRESS" }) },
  });
  const res5 = evaluatePreDispatchGate(inProgressAuto);
  assertBlockedContains(res5, "follow_up");

  // Follow-up blocks automatic: not first message on episode
  const notFirstMsgAuto = createValidAutomaticInput({
    handoff: { isFirstMessageOnEpisode: false },
  });
  const res6 = evaluatePreDispatchGate(notFirstMsgAuto);
  assertBlockedContains(res6, "follow_up");

  // Follow-up blocks automatic: another active or sent auto intent exists on episode
  const otherActiveAuto = createValidAutomaticInput({
    handoff: { hasOtherActiveOrSentAutoIntentOnEpisode: true },
  });
  const res7 = evaluatePreDispatchGate(otherActiveAuto);
  assertBlockedContains(res7, "follow_up");

  // Staff replies are NOT blocked by IN_PROGRESS, RESOLVED, or automationSuppressed
  const staffInProgress = createValidStaffInput({
    handoff: { episode: createValidEpisode({ status: "IN_PROGRESS", automationSuppressed: true }) },
  });
  assert.equal(evaluatePreDispatchGate(staffInProgress).outcome, "authorized");

  const staffResolved = createValidStaffInput({
    handoff: { episode: createValidEpisode({ status: "RESOLVED", automationSuppressed: true }) },
  });
  assert.equal(evaluatePreDispatchGate(staffResolved).outcome, "authorized");
});

test("evaluatePreDispatchGate - Guard 5: Claim & Owner reconciliation", () => {
  // Missing intentOwner
  const noOwner = createValidAutomaticInput({
    claims: { intentOwner: null, existingClaims: [] },
  });
  const res1 = evaluatePreDispatchGate(noOwner);
  assertBlockedContains(res1, "missing_reply_claim");

  // Mismatched intentOwner ID
  const wrongOwner = createValidAutomaticInput({
    claims: {
      intentOwner: { id: "different-owner", mergedInto: null },
      existingClaims: [],
    },
  });
  const res2 = evaluatePreDispatchGate(wrongOwner);
  assertBlockedContains(res2, "missing_reply_claim");

  // Missing claim for required target (e.g. event claim missing)
  const missingEventClaim = createValidAutomaticInput({
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res3 = evaluatePreDispatchGate(missingEventClaim);
  assertBlockedContains(res3, "missing_reply_claim");

  // Claim conflict: claim for scopeId belongs to another outbound intent
  const claimConflict = createValidAutomaticInput({
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "event", scopeId: "ont-01", outboundIntentId: "other-intent" },
      ],
    },
  });
  const res4 = evaluatePreDispatchGate(claimConflict);
  assertBlockedContains(res4, "claim_conflict");

  // Merged owner: owner mergedInto another owner, but effective owner has no reconciled claim
  const mergedUnreconciled = createValidAutomaticInput({
    claims: {
      intentOwner: { id: "owner-001", mergedInto: "owner-master" },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "event", scopeId: "ont-01", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res5 = evaluatePreDispatchGate(mergedUnreconciled);
  assertBlockedContains(res5, "claim_owner_merged_or_invalid");

  // Merged owner: reconciled claims on effectiveOwnerId pass authorization
  const mergedReconciled = createValidAutomaticInput({
    claims: {
      intentOwner: { id: "owner-001", mergedInto: "owner-master" },
      existingClaims: [
        { ownerId: "owner-master", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-master", scopeKind: "event", scopeId: "ont-01", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res6 = evaluatePreDispatchGate(mergedReconciled);
  assert.equal(res6.outcome, "authorized");
});

test("evaluatePreDispatchGate - Guard 6: Template & snapshot body checks", () => {
  // Empty body
  const emptyBody = createValidAutomaticInput({
    intent: { body: "   " },
  });
  const res1 = evaluatePreDispatchGate(emptyBody);
  assertBlockedContains(res1, "missing_template_snapshot");

  // Missing simulation prefix
  const noPrefix = createValidAutomaticInput({
    intent: { body: "Halo, ini pesan tanpa prefix simulasi." },
  });
  const res2 = evaluatePreDispatchGate(noPrefix);
  assertBlockedContains(res2, "missing_simulation_prefix");

  // Double simulation prefix or empty body after prefix
  const doublePrefix = createValidAutomaticInput({
    intent: { body: `${SIMULATION_PREFIX} ${SIMULATION_PREFIX} Halo` },
  });
  const res3 = evaluatePreDispatchGate(doublePrefix);
  assertBlockedContains(res3, "invalid_outbound_body");

  const emptyAfterPrefix = createValidAutomaticInput({
    intent: { body: `${SIMULATION_PREFIX}    ` },
  });
  const res4 = evaluatePreDispatchGate(emptyAfterPrefix);
  assertBlockedContains(res4, "invalid_outbound_body");

  // Body length exceeding MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH (4096)
  const tooLongBody = createValidAutomaticInput({
    intent: { body: `${SIMULATION_PREFIX} ${"x".repeat(MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH)}` },
  });
  const res5 = evaluatePreDispatchGate(tooLongBody);
  assertBlockedContains(res5, "invalid_outbound_body");

  // Automatic: templateError is non-null
  const withTemplateError = createValidAutomaticInput({
    intent: { templateError: "missing_parameter" },
  });
  const res6 = evaluatePreDispatchGate(withTemplateError);
  assertBlockedContains(res6, "template_error");

  // Automatic: unreplaced placeholder { or } in body
  const withUnreplacedVar = createValidAutomaticInput({
    intent: { body: `${SIMULATION_PREFIX} Halo {{nama}}, koneksi gangguan.` },
  });
  const res7 = evaluatePreDispatchGate(withUnreplacedVar);
  assertBlockedContains(res7, "template_error");

  // Automatic: missing template version id or version < 1
  const missingVersionId = createValidAutomaticInput({
    intent: { templateVersionId: null },
  });
  const res8 = evaluatePreDispatchGate(missingVersionId);
  assertBlockedContains(res8, "missing_template_snapshot");

  const invalidVersionNum = createValidAutomaticInput({
    intent: { templateVersion: 0 },
  });
  const res9 = evaluatePreDispatchGate(invalidVersionNum);
  assertBlockedContains(res9, "missing_template_snapshot");

  // Automatic: templateScope === 'incident' but decision has no incidentId
  const incidentScopeNoIncident = createValidAutomaticInput({
    intent: { templateScope: "incident" },
  });
  const res10 = evaluatePreDispatchGate(incidentScopeNoIncident);
  assertBlockedContains(res10, "missing_template_snapshot");
});

test("evaluatePreDispatchGate - Guard 7: Mode checks & No SHADOW backlog replay (AC-06)", () => {
  // Received in SHADOW, evaluated when current is FULL -> must block (no SHADOW backlog replay)
  const shadowAtReceipt = createValidAutomaticInput({
    handoff: { ingress: { mode: "SHADOW", emergencyStop: false } },
    currentSettings: { mode: "FULL", emergencyStop: false, version: 1 },
  });
  const res1 = evaluatePreDispatchGate(shadowAtReceipt);
  assertBlockedContains(res1, "shadow_mode_at_receipt");

  // Received in FULL, evaluated when current mode is SHADOW -> must block
  const shadowCurrent = createValidAutomaticInput({
    handoff: { ingress: { mode: "FULL", emergencyStop: false } },
    intent: {
      decision: createValidDecision({
        automation: { mode: "FULL", disposition: "pending_delivery_checks", blockedReasons: [] },
      }),
    },
    currentSettings: { mode: "SHADOW", emergencyStop: false, version: 2 },
  });
  const res2 = evaluatePreDispatchGate(shadowCurrent);
  assertBlockedContains(res2, "shadow_mode_current");

  // Received in FULL for ONLINE_CHECK, evaluated when current mode dropped to LOS_AND_GENERIC -> blocked_by_mode
  const onlineCheckBlockedByMode = createValidAutomaticInput({
    intent: {
      templateKey: "ONLINE_CHECK",
      body: `${SIMULATION_PREFIX} Koneksi Anda terdeteksi online.`,
      decision: createValidDecision({
        candidateTemplateKey: "ONLINE_CHECK",
        effectiveTemplateKey: "ONLINE_CHECK",
        reason: "online",
        automation: { mode: "FULL", disposition: "pending_delivery_checks", blockedReasons: [] },
      }),
    },
    handoff: { ingress: { mode: "FULL", emergencyStop: false } },
    currentSettings: { mode: "LOS_AND_GENERIC", emergencyStop: false, version: 2 },
  });
  const res3 = evaluatePreDispatchGate(onlineCheckBlockedByMode);
  assertBlockedContains(res3, "template_blocked_by_mode");

  // Current settings is null or invalid mode
  const invalidMode = createValidAutomaticInput({
    currentSettings: null,
  });
  const res4 = evaluatePreDispatchGate(invalidMode);
  assertBlockedContains(res4, "invalid_mode");
});

test("evaluatePreDispatchGate - Guard 8: Emergency stop checks", () => {
  // Emergency stop active at receipt
  const esAtReceipt = createValidAutomaticInput({
    handoff: { ingress: { mode: "LOS_AND_GENERIC", emergencyStop: true } },
  });
  const res1 = evaluatePreDispatchGate(esAtReceipt);
  assertBlockedContains(res1, "emergency_stop_at_receipt");

  // Emergency stop active currently
  const esCurrent = createValidAutomaticInput({
    currentSettings: { mode: "LOS_AND_GENERIC", emergencyStop: true, version: 2 },
  });
  const res2 = evaluatePreDispatchGate(esCurrent);
  assertBlockedContains(res2, "emergency_stop_active");

  // Staff reply is NOT blocked by emergency stop
  const staffDuringEs = createValidStaffInput({
    currentSettings: { mode: "LOS_AND_GENERIC", emergencyStop: true, version: 2 },
  });
  const res3 = evaluatePreDispatchGate(staffDuringEs);
  assert.equal(res3.outcome, "authorized");
});

test("evaluatePreDispatchGate - Guard 9: Incident checks", () => {
  // Incident not found
  const incidentNotFound = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_GENERAL",
      templateScope: "incident",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_GENERAL",
        effectiveTemplateKey: "MASS_GENERAL",
        incidentId: "inc-missing",
        eventIds: [],
      }),
    },
    currentIncident: null,
  });
  const res1 = evaluatePreDispatchGate(incidentNotFound);
  assertBlockedContains(res1, "incident_not_found");

  // Incident resolved before send
  const incidentResolved = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_GENERAL",
      templateScope: "incident",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_GENERAL",
        effectiveTemplateKey: "MASS_GENERAL",
        incidentId: "inc-001",
        eventIds: [],
      }),
    },
    currentIncident: {
      id: "inc-001",
      type: "GENERAL",
      status: "RESOLVED",
      version: 2,
      odpIds: [],
      odcIds: [],
    },
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "incident", scopeId: "inc-001", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res2 = evaluatePreDispatchGate(incidentResolved);
  assertBlockedContains(res2, "incident_no_longer_active");

  // Incident type mismatch (MASS_GENERAL with AREA_SPECIFIC incident)
  const typeMismatch = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_GENERAL",
      templateScope: "incident",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_GENERAL",
        effectiveTemplateKey: "MASS_GENERAL",
        incidentId: "inc-001",
        eventIds: [],
      }),
    },
    currentIncident: {
      id: "inc-001",
      type: "AREA_SPECIFIC",
      status: "ACTIVE",
      version: 1,
      odpIds: ["ODP-01"],
      odcIds: ["ODC-01"],
    },
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "incident", scopeId: "inc-001", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res3 = evaluatePreDispatchGate(typeMismatch);
  assertBlockedContains(res3, "incident_type_mismatch");

  // MASS_AREA: area mapping changed/removed from incident odpIds/odcIds
  const areaMismatch = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_AREA",
      templateScope: "incident",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_AREA",
        effectiveTemplateKey: "MASS_AREA",
        incidentId: "inc-001",
        eventIds: [],
        evidence: [{ kind: "mapping", odpId: "ODP-KEC-01", odcId: "ODC-KEC-01", version: 1, checkedAt: "2026-10-19T00:00:00Z" }],
      }),
    },
    currentIncident: {
      id: "inc-001",
      type: "AREA_SPECIFIC",
      status: "ACTIVE",
      version: 2,
      odpIds: ["ODP-OTHER"],
      odcIds: ["ODC-OTHER"],
    },
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "incident", scopeId: "inc-001", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res4 = evaluatePreDispatchGate(areaMismatch);
  assertBlockedContains(res4, "incident_area_no_longer_matches");

  // MASS_AREA valid mapping matching incident odpIds
  const areaMatch = createValidAutomaticInput({
    intent: {
      templateKey: "MASS_AREA",
      templateScope: "incident",
      decision: createValidDecision({
        candidateTemplateKey: "MASS_AREA",
        effectiveTemplateKey: "MASS_AREA",
        incidentId: "inc-001",
        eventIds: [],
        evidence: [{ kind: "mapping", odpId: "ODP-KEC-01", odcId: "ODC-KEC-01", version: 1, checkedAt: "2026-10-19T00:00:00Z" }],
      }),
    },
    currentIncident: {
      id: "inc-001",
      type: "AREA_SPECIFIC",
      status: "ACTIVE",
      version: 2,
      odpIds: ["ODP-KEC-01"],
      odcIds: ["ODC-KEC-01"],
    },
    claims: {
      intentOwner: { id: "owner-001", mergedInto: null },
      existingClaims: [
        { ownerId: "owner-001", scopeKind: "episode", scopeId: "ep-001", outboundIntentId: "intent-auto-001" },
        { ownerId: "owner-001", scopeKind: "incident", scopeId: "inc-001", outboundIntentId: "intent-auto-001" },
      ],
    },
  });
  const res5 = evaluatePreDispatchGate(areaMatch);
  assert.equal(res5.outcome, "authorized");
  assert.equal(res5.authorizedIncidentId, "inc-001");
  assert.equal(res5.authorizedIncidentVersion, 2);
});
