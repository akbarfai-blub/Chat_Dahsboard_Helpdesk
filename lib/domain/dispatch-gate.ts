import {
  PRE_DISPATCH_RULE_VERSION,
  MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH,
  type PreDispatchBlockedReason,
  type PreDispatchEvaluationInput,
  type PreDispatchEvaluationResult,
} from "./dispatch-contracts";
import { evidenceTargets, restrictiveMode } from "./reply-claim";
import { SIMULATION_PREFIX, VALID_TEMPLATE_KEYS, type TemplateKey } from "./template-contracts";
import type { AutomationMode } from "./triage-contracts";

/**
 * Validates whether an ID string is a valid Telegram ID format (positive safe integer string).
 * Telegram user/private chat IDs are positive numbers within safe integer bounds.
 */
function isValidTelegramId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) return false;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0;
}

/**
 * Pure domain function evaluating pre-dispatch gate checks.
 * Completely deterministic: no I/O, no DB access, no implicit clock.
 */
export function evaluatePreDispatchGate(
  input: PreDispatchEvaluationInput
): PreDispatchEvaluationResult {
  const { intent, handoff, claims, currentSettings, currentIncident } = input;

  // 1. Intent Status: If not 'pending', fail closed immediately without cancelling
  if (intent.status !== "pending") {
    return {
      ruleVersion: PRE_DISPATCH_RULE_VERSION,
      outcome: "blocked",
      dispatchAuthorized: false,
      intentId: intent.id,
      origin: intent.origin,
      primaryReason: "intent_not_pending",
      blockedReasons: ["intent_not_pending"],
      shouldCancelIntent: false,
      evaluatedAt: input.evaluatedAt,
    };
  }

  const blockedReasons: PreDispatchBlockedReason[] = [];

  // Validate intent structure by origin
  if (intent.origin === "automatic") {
    if (
      !intent.ownerId ||
      !intent.messageId ||
      !intent.complaintId ||
      !intent.decision ||
      intent.staffId !== null ||
      intent.clientRequestId !== null
    ) {
      blockedReasons.push("invalid_intent");
    }
  } else if (intent.origin === "staff") {
    if (
      !intent.staffId ||
      !intent.clientRequestId ||
      !intent.complaintId ||
      intent.ownerId !== null ||
      intent.messageId !== null ||
      intent.decision !== null
    ) {
      blockedReasons.push("invalid_intent");
    }
  } else {
    blockedReasons.push("invalid_intent");
  }

  // 2. Handoff Tersimpan
  const episodeMatches = Boolean(
    handoff.episode && handoff.episode.id === intent.complaintId
  );
  const conversationValid = Boolean(
    typeof handoff.conversationId === "string" && handoff.conversationId.trim().length > 0
  );

  if (!episodeMatches || !conversationValid) {
    blockedReasons.push("handoff_not_persisted");
  } else if (intent.origin === "automatic") {
    if (
      handoff.messagePersisted !== true ||
      handoff.assessmentPersisted !== true ||
      handoff.ingress == null
    ) {
      blockedReasons.push("handoff_not_persisted");
    }
  }

  // 3. Channel, Tester Allowlist & Private Chat
  if (
    handoff.channel !== "telegram" ||
    typeof handoff.channelAccountId !== "string" ||
    !handoff.channelAccountId.trim()
  ) {
    blockedReasons.push("unsupported_channel");
  }

  // Parse valid positive safe integer tester IDs into a Set
  const allowlistSet = new Set<string>();
  if (input.testerAllowlist) {
    for (const entry of input.testerAllowlist) {
      if (isValidTelegramId(entry)) {
        allowlistSet.add(entry.trim());
      }
    }
  }

  if (allowlistSet.size === 0) {
    blockedReasons.push("empty_tester_allowlist");
  }

  const chatIdValid = isValidTelegramId(handoff.chatId);
  const senderValid = isValidTelegramId(handoff.senderExternalId);
  if (!chatIdValid || !senderValid || handoff.chatId !== handoff.senderExternalId) {
    blockedReasons.push("non_private_chat");
  }

  if (allowlistSet.size > 0) {
    const chatAllowed = handoff.chatId ? allowlistSet.has(handoff.chatId) : false;
    const senderAllowed = handoff.senderExternalId
      ? allowlistSet.has(handoff.senderExternalId)
      : false;
    if (!chatAllowed || !senderAllowed) {
      blockedReasons.push("not_in_tester_allowlist");
    }
  }

  // 4. Follow-up & Staff Takeover
  if (intent.origin === "staff") {
    if (handoff.episode?.status === "CLOSED") {
      blockedReasons.push("episode_closed");
    }
  } else if (intent.origin === "automatic") {
    if (handoff.episode?.status === "CLOSED") {
      blockedReasons.push("episode_closed");
    }
    if (handoff.episode?.automationSuppressed === true || handoff.hasStaffReplyOnEpisode === true) {
      blockedReasons.push("staff_takeover");
    }
    if (
      handoff.episode?.status !== "NEW" ||
      handoff.isFirstMessageOnEpisode !== true ||
      handoff.hasOtherActiveOrSentAutoIntentOnEpisode === true
    ) {
      blockedReasons.push("follow_up");
    }
  }

  // 5. Claim & Owner Reconciliation (Khusus automatic)
  if (intent.origin === "automatic") {
    if (!claims.intentOwner || claims.intentOwner.id !== intent.ownerId) {
      blockedReasons.push("missing_reply_claim");
    }

    const effectiveOwnerId = claims.intentOwner?.mergedInto ?? claims.intentOwner?.id;

    if (
      claims.intentOwner?.mergedInto !== null &&
      claims.intentOwner?.mergedInto !== undefined
    ) {
      // Owner has been merged into another owner
      // Check if claims on effectiveOwnerId point to this intent
      const hasClaimOnEffective = claims.existingClaims.some(
        (c) => c.ownerId === effectiveOwnerId && c.outboundIntentId === intent.id
      );
      if (!hasClaimOnEffective) {
        blockedReasons.push("claim_owner_merged_or_invalid");
      }
    } else if (
      handoff.customerVerifiedOwnerId &&
      effectiveOwnerId &&
      handoff.customerVerifiedOwnerId !== effectiveOwnerId
    ) {
      // Identity was verified to a customer owner, but intent owner differs and wasn't reconciled
      const hasReconciledClaim = claims.existingClaims.some(
        (c) =>
          c.ownerId === handoff.customerVerifiedOwnerId &&
          c.outboundIntentId === intent.id
      );
      if (!hasReconciledClaim) {
        blockedReasons.push("claim_owner_merged_or_invalid");
      }
    }

    if (intent.decision && effectiveOwnerId) {
      const requiredTargets = [
        { kind: "episode" as const, id: intent.complaintId },
        ...evidenceTargets(intent.decision),
      ];

      for (const target of requiredTargets) {
        const conflict = claims.existingClaims.find(
          (c) =>
            c.scopeKind === target.kind &&
            c.scopeId === target.id &&
            (c.ownerId === effectiveOwnerId || c.ownerId === intent.ownerId) &&
            c.outboundIntentId !== intent.id
        );
        if (conflict) {
          blockedReasons.push("claim_conflict");
        }

        const validClaim = claims.existingClaims.find(
          (c) =>
            c.scopeKind === target.kind &&
            c.scopeId === target.id &&
            c.ownerId === effectiveOwnerId &&
            c.outboundIntentId === intent.id
        );
        if (!validClaim) {
          blockedReasons.push("missing_reply_claim");
        }
      }
    }
  }

  // 6. Template & Snapshot Body
  if (typeof intent.body !== "string" || intent.body.trim().length === 0) {
    blockedReasons.push(
      intent.origin === "automatic"
        ? "missing_template_snapshot"
        : "invalid_outbound_body"
    );
  } else {
    // Must start with simulation prefix followed by a space
    if (!intent.body.startsWith(`${SIMULATION_PREFIX} `)) {
      blockedReasons.push("missing_simulation_prefix");
    } else {
      const bodyAfterPrefix = intent.body.slice(SIMULATION_PREFIX.length).trim();
      if (
        bodyAfterPrefix.length === 0 ||
        bodyAfterPrefix.startsWith(SIMULATION_PREFIX)
      ) {
        blockedReasons.push("invalid_outbound_body");
      }
    }

    if (intent.body.length > MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH) {
      blockedReasons.push("invalid_outbound_body");
    }
  }

  if (intent.origin === "automatic") {
    if (intent.templateError !== null && intent.templateError !== undefined) {
      blockedReasons.push("template_error");
    }

    if (
      typeof intent.body === "string" &&
      (intent.body.includes("{") || intent.body.includes("}"))
    ) {
      blockedReasons.push("template_error");
    }

    const templateKeyValid = Boolean(
      intent.templateKey &&
        VALID_TEMPLATE_KEYS.has(intent.templateKey as TemplateKey) &&
        intent.templateKey === intent.decision?.effectiveTemplateKey
    );
    const templateVersionIdValid = Boolean(
      typeof intent.templateVersionId === "string" &&
        intent.templateVersionId.trim().length > 0
    );
    const templateVersionValid = Boolean(
      typeof intent.templateVersion === "number" && intent.templateVersion >= 1
    );
    const templateScopeValid = Boolean(
      intent.templateScope === "default" || intent.templateScope === "incident"
    );

    if (
      !templateKeyValid ||
      !templateVersionIdValid ||
      !templateVersionValid ||
      !templateScopeValid
    ) {
      blockedReasons.push("missing_template_snapshot");
    }

    if (intent.templateScope === "incident" && !intent.decision?.incidentId) {
      blockedReasons.push("missing_template_snapshot");
    }
  }

  // 7. Mode & Backlog Replay Check
  const validModes: readonly AutomationMode[] = ["SHADOW", "LOS_AND_GENERIC", "FULL"];
  let effectiveMode: AutomationMode | null = null;

  if (!currentSettings || !validModes.includes(currentSettings.mode)) {
    blockedReasons.push("invalid_mode");
  } else if (intent.origin === "automatic") {
    const receivedMode = handoff.ingress?.mode ?? intent.decision?.automation.mode;
    if (receivedMode === "SHADOW") {
      blockedReasons.push("shadow_mode_at_receipt");
    }

    if (currentSettings.mode === "SHADOW") {
      blockedReasons.push("shadow_mode_current");
    }

    if (receivedMode && validModes.includes(receivedMode)) {
      effectiveMode = restrictiveMode(receivedMode, currentSettings.mode);
      if (
        effectiveMode === "LOS_AND_GENERIC" &&
        (intent.templateKey === "ONLINE_CHECK" ||
          intent.decision?.effectiveTemplateKey === "ONLINE_CHECK")
      ) {
        blockedReasons.push("template_blocked_by_mode");
      }
    }
  } else {
    // Staff replies are not blocked by SHADOW or LOS_AND_GENERIC
    effectiveMode = currentSettings.mode;
  }

  // 8. Emergency Stop
  if (intent.origin === "automatic") {
    if (
      handoff.ingress?.emergencyStop === true ||
      intent.decision?.automation.blockedReasons.includes("emergency_stop")
    ) {
      blockedReasons.push("emergency_stop_at_receipt");
    }
    if (currentSettings?.emergencyStop === true) {
      blockedReasons.push("emergency_stop_active");
    }
  }

  // 9. Incident Relevan (khusus automatic)
  let authorizedIncidentId: string | null = null;
  let authorizedIncidentVersion: number | null = null;

  if (intent.origin === "automatic") {
    const incidentRelevant = Boolean(
      intent.decision?.incidentId ||
        intent.templateKey === "MASS_GENERAL" ||
        intent.templateKey === "MASS_AREA" ||
        intent.templateScope === "incident"
    );

    if (incidentRelevant) {
      if (
        !intent.decision?.incidentId ||
        !currentIncident ||
        currentIncident.id !== intent.decision.incidentId
      ) {
        blockedReasons.push("incident_not_found");
      } else {
        if (currentIncident.status !== "ACTIVE") {
          blockedReasons.push("incident_no_longer_active");
        }

        if (intent.templateKey === "MASS_GENERAL" && currentIncident.type !== "GENERAL") {
          blockedReasons.push("incident_type_mismatch");
        } else if (intent.templateKey === "MASS_AREA") {
          if (currentIncident.type !== "AREA_SPECIFIC") {
            blockedReasons.push("incident_type_mismatch");
          } else {
            const mappingRef = intent.decision?.evidence.find(
              (e) => e.kind === "mapping"
            );
            if (
              !mappingRef ||
              mappingRef.kind !== "mapping" ||
              !(
                currentIncident.odpIds.includes(mappingRef.odpId) ||
                currentIncident.odcIds.includes(mappingRef.odcId)
              )
            ) {
              blockedReasons.push("incident_area_no_longer_matches");
            }
          }
        }

        if (
          !blockedReasons.includes("incident_not_found") &&
          !blockedReasons.includes("incident_no_longer_active") &&
          !blockedReasons.includes("incident_type_mismatch") &&
          !blockedReasons.includes("incident_area_no_longer_matches")
        ) {
          authorizedIncidentId = currentIncident.id;
          authorizedIncidentVersion = currentIncident.version;
        }
      }
    }
  }

  // Deduplicate blocked reasons preserving evaluation order
  const uniqueBlockedReasons = Array.from(new Set(blockedReasons));

  if (uniqueBlockedReasons.length > 0) {
    return {
      ruleVersion: PRE_DISPATCH_RULE_VERSION,
      outcome: "blocked",
      dispatchAuthorized: false,
      intentId: intent.id,
      origin: intent.origin,
      primaryReason: uniqueBlockedReasons[0],
      blockedReasons: uniqueBlockedReasons,
      shouldCancelIntent: true,
      evaluatedAt: input.evaluatedAt,
    };
  }

  return {
    ruleVersion: PRE_DISPATCH_RULE_VERSION,
    outcome: "authorized",
    dispatchAuthorized: true,
    intentId: intent.id,
    origin: intent.origin,
    channel: "telegram",
    channelAccountId: handoff.channelAccountId!,
    chatId: handoff.chatId!,
    senderExternalId: handoff.senderExternalId!,
    outboundText: intent.body!,
    effectiveMode,
    authorizedIncidentId,
    authorizedIncidentVersion,
    evaluatedAt: input.evaluatedAt,
    blockedReasons: [],
    shouldCancelIntent: false,
  };
}
