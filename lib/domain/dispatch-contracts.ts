import type { EpisodeSnapshot } from "./episode-contracts";
import type { AutomationMode, TriageDecision } from "./triage-contracts";

export const PRE_DISPATCH_RULE_VERSION = "pre-dispatch-gate-v1" as const;
export const MAX_TELEGRAM_OUTBOUND_TEXT_LENGTH = 4096;

export type PreDispatchBlockedReason =
  // Status & integritas intent
  | "intent_not_pending"
  | "invalid_intent"
  // Handoff tersimpan
  | "handoff_not_persisted"
  // Channel / tester / private chat
  | "unsupported_channel"
  | "empty_tester_allowlist"
  | "non_private_chat"
  | "not_in_tester_allowlist"
  // Lifecycle / follow-up / takeover
  | "episode_closed"
  | "staff_takeover"
  | "follow_up"
  // Claim & owner
  | "missing_reply_claim"
  | "claim_owner_merged_or_invalid"
  | "claim_conflict"
  // Template & body
  | "template_error"
  | "missing_template_snapshot"
  | "missing_simulation_prefix"
  | "invalid_outbound_body"
  | "template_blocked_by_mode"
  // Mode & emergency stop
  | "invalid_mode"
  | "shadow_mode_at_receipt"
  | "shadow_mode_current"
  | "emergency_stop_at_receipt"
  | "emergency_stop_active"
  // Incident relevan
  | "incident_not_found"
  | "incident_no_longer_active"
  | "incident_type_mismatch"
  | "incident_area_no_longer_matches";

export type IntentSnapshot = {
  id: string;
  origin: "automatic" | "staff";
  status: string;
  complaintId: string;
  ownerId: string | null;
  messageId: string | null;
  decision: TriageDecision | null;
  staffId: string | null;
  clientRequestId: string | null;
  body: string | null;
  templateVersionId?: string | null;
  templateKey?: string | null;
  templateVersion?: number | null;
  templateScope?: string | null;
  templateError?: string | null;
};

export type HandoffSnapshot = {
  episode: EpisodeSnapshot | null;
  conversationId: string | null;
  channel: string | null;
  channelAccountId: string | null;
  chatId: string | null;
  senderExternalId: string | null;
  customerVerifiedOwnerId?: string | null;
  // Khusus automatic:
  messagePersisted?: boolean;
  assessmentPersisted?: boolean;
  ingress?: { mode: AutomationMode; emergencyStop: boolean } | null;
  isFirstMessageOnEpisode?: boolean;
  hasStaffReplyOnEpisode?: boolean;
  hasOtherActiveOrSentAutoIntentOnEpisode?: boolean;
};

export type ClaimSnapshot = {
  intentOwner: { id: string; mergedInto: string | null } | null;
  existingClaims: readonly {
    ownerId: string;
    scopeKind: "episode" | "incident" | "event";
    scopeId: string;
    outboundIntentId: string;
  }[];
};

export type SettingsSnapshot = {
  mode: AutomationMode;
  emergencyStop: boolean;
  version: number;
};

export type IncidentSnapshot = {
  id: string;
  type: "GENERAL" | "AREA_SPECIFIC";
  status: "ACTIVE" | "RESOLVED" | "CLOSED";
  version: number;
  odpIds: readonly string[];
  odcIds: readonly string[];
};

export type PreDispatchEvaluationInput = {
  evaluatedAt: string;
  testerAllowlist: readonly string[] | ReadonlySet<string>;
  intent: IntentSnapshot;
  handoff: HandoffSnapshot;
  claims: ClaimSnapshot;
  currentSettings: SettingsSnapshot | null;
  currentIncident: IncidentSnapshot | null;
};

export type PreDispatchAuthorizedResult = {
  ruleVersion: typeof PRE_DISPATCH_RULE_VERSION;
  outcome: "authorized";
  dispatchAuthorized: true;
  intentId: string;
  origin: "automatic" | "staff";
  channel: "telegram";
  channelAccountId: string;
  chatId: string;
  senderExternalId: string;
  outboundText: string;
  effectiveMode: AutomationMode | null;
  authorizedIncidentId: string | null;
  authorizedIncidentVersion: number | null;
  evaluatedAt: string;
  blockedReasons: readonly [];
  shouldCancelIntent: false;
};

export type PreDispatchBlockedResult = {
  ruleVersion: typeof PRE_DISPATCH_RULE_VERSION;
  outcome: "blocked";
  dispatchAuthorized: false;
  intentId: string;
  origin: "automatic" | "staff";
  primaryReason: PreDispatchBlockedReason;
  blockedReasons: readonly PreDispatchBlockedReason[];
  shouldCancelIntent: boolean;
  evaluatedAt: string;
};

export type PreDispatchEvaluationResult =
  | PreDispatchAuthorizedResult
  | PreDispatchBlockedResult;
