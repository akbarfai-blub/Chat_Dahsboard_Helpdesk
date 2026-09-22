import type { MessageClassification } from "./message-classification";
import type { IdentityResolution } from "./sender-identity";
import type { TriageDecision } from "./triage-contracts";

export type EpisodeCategory = "connection_complaint" | "other" | "review";
export type EpisodeStatus = "NEW" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type EpisodeScope =
  | { kind: "service"; serviceId: string; identityId: string }
  | { kind: "identity_only"; identityId: string };

export type EpisodeSnapshot = {
  id: string;
  version: number;
  status: EpisodeStatus;
  category: EpisodeCategory;
  scope: EpisodeScope;
  automationSuppressed: boolean;
  isPrimary: boolean;
  closedAt: string | null;
  splitFromEpisodeId: string | null;
  previousEpisodeId: string | null;
};

// Staff identity comes from the server session; inbound messageId is an internal persisted ID.
export type StaffActor = { kind: "staff"; staffId: string };
export type EpisodeActor = StaffActor | { kind: "inbound"; identityId: string; messageId: string };
export type LifecycleCommand = { actor: EpisodeActor; expectedVersion: number; at: string };
export type StaffCommand = LifecycleCommand & { actor: StaffActor };

export type LifecycleReason =
  | "started_handling" | "resolved" | "reopened" | "closed" | "manual_reply_takeover"
  | "split_created" | "already_in_status" | "closed_is_final" | "invalid_transition"
  | "resolution_note_empty" | "split_reason_empty" | "invalid_episode_snapshot"
  | "invalid_actor" | "invalid_version" | "version_mismatch" | "invalid_timestamp"
  | "inbound_reopen_not_allowed";

// Accepted changes and audit must be committed together with a version check in P1.4.
export type EpisodeActionResult = { ruleVersion: string } & (
  | { outcome: "rejected" | "noop"; reason: LifecycleReason }
  | {
    outcome: "accepted";
    reason: LifecycleReason;
    episodeId: string;
    expectedVersion: number;
    changes: {
      status: EpisodeStatus;
      automationSuppressed: boolean;
      closedAt: string | null;
      resolutionNote?: string;
    };
    audit: {
      actor: EpisodeActor;
      at: string;
      fromStatus: EpisodeStatus;
      toStatus: EpisodeStatus;
      reason: LifecycleReason;
      resolutionNote?: string;
    };
  }
);

export type AssociationInput = {
  classification: MessageClassification | null;
  identity: IdentityResolution | null;
  existingEpisodes: readonly EpisodeSnapshot[];
  triageDecision?: TriageDecision | null;
  // Trusted application selection; for RESOLVED, confirms continuation of the same problem.
  targetEpisodeId?: string;
};

export type AssociationResult = {
  ruleVersion: string;
  outcome: "attach_existing" | "reopen_resolved" | "create_new" | "create_after_closed" | "review";
  reason: "existing_episode_found" | "resolved_episode_reopenable" | "no_eligible_episode"
    | "closed_episode_history" | "multiple_candidates" | "scope_identity_null"
    | "invalid_episode_snapshot" | "identity_reconciliation_required" | "invalid_target_episode"
    | "ambiguous_message" | "non_complaint_message" | "same_problem_confirmation_required";
  episodeId: string | null;
  expectedVersion: number | null;
  previousEpisodeId: string | null;
  newEpisodeCategory: EpisodeCategory | null;
  newEpisodeScope: EpisodeScope | null;
  reopenIntent: boolean;
};

export type SplitResult = { ruleVersion: string } & (
  | { outcome: "rejected"; reason: LifecycleReason }
  | {
    outcome: "accepted";
    reason: "split_created";
    sourceEpisodeId: string;
    expectedVersion: number;
    newEpisode: Omit<EpisodeSnapshot, "id" | "version">;
    audit: { actor: StaffActor; at: string; reason: string };
  }
);
