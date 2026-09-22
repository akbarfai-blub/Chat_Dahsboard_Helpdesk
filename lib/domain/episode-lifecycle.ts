import type { IdentityResolution } from "./sender-identity";
import type { TriageDecision } from "./triage-contracts";
import type {
  AssociationInput, AssociationResult, EpisodeActionResult, EpisodeActor,
  EpisodeScope, EpisodeSnapshot, EpisodeStatus, LifecycleCommand,
  LifecycleReason, SplitResult, StaffCommand,
} from "./episode-contracts";

export type * from "./episode-contracts";
export const EPISODE_RULE_VERSION = "episode-lifecycle-v2";

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const validVersion = (value: number) => Number.isSafeInteger(value) && value > 0;

function validTimestamp(value: string | null): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour < 24 && minute < 60 && second < 60;
}

function validScope(scope: EpisodeScope): boolean {
  return hasText(scope.identityId) && (scope.kind === "identity_only" ||
    (scope.kind === "service" && hasText(scope.serviceId)));
}

function scopesMatch(a: EpisodeScope, b: EpisodeScope): boolean {
  if (a.kind === "service" && b.kind === "service") return a.serviceId === b.serviceId;
  return a.kind === "identity_only" && b.kind === "identity_only" &&
    a.identityId === b.identityId;
}

function validSnapshot(episode: EpisodeSnapshot): boolean {
  return hasText(episode.id) && validVersion(episode.version) && validScope(episode.scope) &&
    ["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(episode.status) &&
    ["connection_complaint", "other", "review"].includes(episode.category) &&
    typeof episode.isPrimary === "boolean" && typeof episode.automationSuppressed === "boolean" &&
    (episode.status === "CLOSED" ? validTimestamp(episode.closedAt) : episode.closedAt === null);
}

export function deriveEpisodeScope(identity: IdentityResolution | null): EpisodeScope | null {
  if (!identity || !hasText(identity.identityId)) return null;
  const scope: EpisodeScope = identity.outcome === "resolved"
    ? { kind: "service", serviceId: identity.serviceId, identityId: identity.identityId }
    : { kind: "identity_only", identityId: identity.identityId };
  return validScope(scope) ? scope : null;
}

function generalEligible(decision: TriageDecision | null | undefined): boolean {
  // SHADOW still needs an episode; delivery eligibility is checked separately.
  return decision?.outcome === "candidate" && decision.reason === "general_active" &&
    decision.candidateTemplateKey === "MASS_GENERAL" && hasText(decision.incidentId);
}

/** Caller supplies all relevant service/sender episodes, including pre-link identity scopes. */
export function associateMessageToEpisode(input: AssociationInput): AssociationResult {
  const { classification, identity, existingEpisodes, targetEpisodeId } = input;
  const base = {
    ruleVersion: EPISODE_RULE_VERSION, episodeId: null, expectedVersion: null,
    previousEpisodeId: null, newEpisodeCategory: null, newEpisodeScope: null,
    reopenIntent: false,
  };
  const review = (reason: AssociationResult["reason"]): AssociationResult =>
    ({ ...base, outcome: "review", reason });
  const scope = deriveEpisodeScope(identity);
  if (!scope) return review("scope_identity_null");
  if (existingEpisodes.some(ep => !validSnapshot(ep)) ||
      new Set(existingEpisodes.map(ep => ep.id)).size !== existingEpisodes.length) {
    return review("invalid_episode_snapshot");
  }

  // Scope changes require atomic episode/claim reconciliation before any new episode.
  if (existingEpisodes.some(ep => ep.scope.identityId === scope.identityId &&
      !scopesMatch(ep.scope, scope))) return review("identity_reconciliation_required");

  const isComplaint = classification?.category === "connection_complaint";
  if (!isComplaint && !generalEligible(input.triageDecision)) {
    return review(classification?.category === "review" || !classification
      ? "ambiguous_message" : "non_complaint_message");
  }

  const matched = existingEpisodes.filter(ep => scopesMatch(ep.scope, scope));
  const active = matched.filter(ep => ep.status !== "CLOSED");
  let selected: EpisodeSnapshot | undefined;
  if (targetEpisodeId !== undefined) {
    selected = active.find(ep => ep.id === targetEpisodeId);
    if (!selected) return review("invalid_target_episode");
  } else if (active.length === 1) {
    selected = active[0];
  } else if (active.length > 1) {
    // A primary open episode cannot disambiguate a potentially recurring resolved issue.
    if (active.some(ep => ep.status === "RESOLVED")) return review("multiple_candidates");
    const primary = active.filter(ep => ep.isPrimary);
    if (primary.length !== 1) return review("multiple_candidates");
    selected = primary[0];
  }

  if (selected) {
    if (selected.status === "RESOLVED" && isComplaint) {
      if (selected.category !== "connection_complaint" || targetEpisodeId !== selected.id) {
        return review("same_problem_confirmation_required");
      }
      return { ...base, outcome: "reopen_resolved", reason: "resolved_episode_reopenable",
        episodeId: selected.id, expectedVersion: selected.version, reopenIntent: true };
    }
    return { ...base, outcome: "attach_existing", reason: "existing_episode_found",
      episodeId: selected.id, expectedVersion: selected.version };
  }

  const closed = matched.filter(ep => ep.status === "CLOSED");
  // Compare instants rather than revision counts; ID gives deterministic ordering on ties.
  const previous = closed.reduce<EpisodeSnapshot | null>((latest, ep) => {
    if (!latest) return ep;
    const difference = Date.parse(ep.closedAt!) - Date.parse(latest.closedAt!);
    return difference > 0 || (difference === 0 && ep.id > latest.id) ? ep : latest;
  }, null);
  return { ...base, outcome: previous ? "create_after_closed" : "create_new",
    reason: previous ? "closed_episode_history" : "no_eligible_episode",
    previousEpisodeId: previous?.id ?? null,
    newEpisodeCategory: isComplaint ? "connection_complaint" : "other",
    newEpisodeScope: { ...scope } };
}

function validateCommand(episode: EpisodeSnapshot, command: LifecycleCommand): LifecycleReason | null {
  if (!validSnapshot(episode)) return "invalid_episode_snapshot";
  if (!validVersion(command.expectedVersion)) return "invalid_version";
  if (command.expectedVersion !== episode.version) return "version_mismatch";
  if (!validTimestamp(command.at)) return "invalid_timestamp";
  const actor = command.actor;
  if (actor.kind === "staff" ? !hasText(actor.staffId) :
      actor.kind !== "inbound" || !hasText(actor.messageId) || !hasText(actor.identityId)) {
    return "invalid_actor";
  }
  return null;
}

function reject(reason: LifecycleReason): EpisodeActionResult {
  return { ruleVersion: EPISODE_RULE_VERSION, outcome: "rejected", reason };
}

function transition(
  episode: EpisodeSnapshot, command: LifecycleCommand, status: EpisodeStatus,
  reason: LifecycleReason, suppress: boolean, resolutionNote?: string,
): EpisodeActionResult {
  const automationSuppressed = episode.automationSuppressed || suppress;
  if (status === episode.status && automationSuppressed === episode.automationSuppressed) {
    return { ruleVersion: EPISODE_RULE_VERSION, outcome: "noop", reason: "already_in_status" };
  }
  return {
    ruleVersion: EPISODE_RULE_VERSION, outcome: "accepted", reason,
    episodeId: episode.id, expectedVersion: command.expectedVersion,
    changes: { status, automationSuppressed,
      closedAt: status === "CLOSED" ? new Date(command.at).toISOString() : null,
      ...(resolutionNote === undefined ? {} : { resolutionNote }) },
    audit: { actor: { ...command.actor }, at: new Date(command.at).toISOString(),
      fromStatus: episode.status, toStatus: status, reason,
      ...(resolutionNote === undefined ? {} : { resolutionNote }) },
  };
}

function staffError(episode: EpisodeSnapshot, command: StaffCommand): LifecycleReason | null {
  return validateCommand(episode, command) ??
    (command.actor.kind !== "staff" ? "invalid_actor" : null);
}

export function startHandling(episode: EpisodeSnapshot, command: StaffCommand): EpisodeActionResult {
  const error = staffError(episode, command);
  if (error) return reject(error);
  if (episode.status === "CLOSED") return reject("closed_is_final");
  if (episode.status === "RESOLVED") return reject("invalid_transition");
  return transition(episode, command, "IN_PROGRESS", "started_handling", true);
}

export function resolveEpisode(
  episode: EpisodeSnapshot, command: StaffCommand & { resolutionNote: string },
): EpisodeActionResult {
  const error = staffError(episode, command);
  if (error) return reject(error);
  if (!hasText(command.resolutionNote)) return reject("resolution_note_empty");
  if (episode.status === "CLOSED") return reject("closed_is_final");
  if (episode.status === "RESOLVED") return transition(episode, command, "RESOLVED", "resolved", true);
  return transition(episode, command, "RESOLVED", "resolved", true, command.resolutionNote.trim());
}

export function reopenEpisode(episode: EpisodeSnapshot, command: StaffCommand): EpisodeActionResult {
  const error = staffError(episode, command);
  if (error) return reject(error);
  if (episode.status === "CLOSED") return reject("closed_is_final");
  if (episode.status !== "RESOLVED") return reject("invalid_transition");
  return transition(episode, command, "IN_PROGRESS", "reopened", true);
}

export function reopenEpisodeFromInbound(
  episode: EpisodeSnapshot,
  command: { expectedVersion: number; at: string; messageId: string; association: AssociationInput },
): EpisodeActionResult {
  const identityId = command.association.identity?.identityId;
  if (!hasText(identityId)) return reject("invalid_actor");
  const actor: EpisodeActor = { kind: "inbound", identityId, messageId: command.messageId };
  const context = { expectedVersion: command.expectedVersion, at: command.at, actor };
  const error = validateCommand(episode, context);
  if (error) return reject(error);
  if (episode.status === "CLOSED") return reject("closed_is_final");
  if (episode.status !== "RESOLVED") return reject("invalid_transition");

  // Re-evaluate association against the current target snapshot, retaining other candidates.
  const association = associateMessageToEpisode({ ...command.association,
    existingEpisodes: [...command.association.existingEpisodes.filter(ep => ep.id !== episode.id), episode] });
  if (association.outcome !== "reopen_resolved" || association.episodeId !== episode.id) {
    return reject("inbound_reopen_not_allowed");
  }
  return transition(episode, context, "IN_PROGRESS", "reopened", false);
}

export function closeEpisode(episode: EpisodeSnapshot, command: StaffCommand): EpisodeActionResult {
  const error = staffError(episode, command);
  if (error) return reject(error);
  if (episode.status === "CLOSED") return { ruleVersion: EPISODE_RULE_VERSION,
    outcome: "noop", reason: "already_in_status" };
  if (episode.status !== "RESOLVED") return reject("invalid_transition");
  return transition(episode, command, "CLOSED", "closed", true);
}

/** Takeover intent does not send a reply or claim cancellation of an in-flight send. */
export function recordManualReply(episode: EpisodeSnapshot, command: StaffCommand): EpisodeActionResult {
  const error = staffError(episode, command);
  if (error) return reject(error);
  if (episode.status === "CLOSED") return reject("closed_is_final");
  return transition(episode, command, episode.status === "NEW" ? "IN_PROGRESS" : episode.status,
    "manual_reply_takeover", true);
}

export function splitEpisode(
  episode: EpisodeSnapshot, command: StaffCommand & { splitReason: string },
): SplitResult {
  const error = staffError(episode, command);
  if (error) return { ruleVersion: EPISODE_RULE_VERSION, outcome: "rejected", reason: error };
  if (episode.status === "CLOSED") return { ruleVersion: EPISODE_RULE_VERSION,
    outcome: "rejected", reason: "closed_is_final" };
  if (!hasText(command.splitReason)) return { ruleVersion: EPISODE_RULE_VERSION,
    outcome: "rejected", reason: "split_reason_empty" };
  return {
    ruleVersion: EPISODE_RULE_VERSION, outcome: "accepted", reason: "split_created",
    sourceEpisodeId: episode.id, expectedVersion: command.expectedVersion,
    newEpisode: { status: "NEW", category: episode.category, scope: { ...episode.scope },
      automationSuppressed: true, isPrimary: false, closedAt: null,
      splitFromEpisodeId: episode.id, previousEpisodeId: null },
    audit: { actor: { ...command.actor }, at: new Date(command.at).toISOString(),
      reason: command.splitReason.trim() },
  };
}

export function isAutomationSuppressed(episode: EpisodeSnapshot): boolean {
  return episode.automationSuppressed;
}

export function classifyMessageOnEpisode(episode: EpisodeSnapshot, isFirstMessageOnEpisode: boolean) {
  return {
    isFollowUp: !isFirstMessageOnEpisode,
    suppressionApplies: episode.automationSuppressed,
    firstResponseCandidate: validSnapshot(episode) && isFirstMessageOnEpisode && episode.status === "NEW" &&
      !episode.automationSuppressed,
    dispatchAuthorized: false as const,
  };
}
