import type { EpisodeSnapshot } from "./episode-contracts";
import type { AutomationMode, TriageDecision } from "./triage-contracts";
import { classifyMessageOnEpisode } from "./episode-lifecycle";

export type ClaimTarget = { kind: "episode" | "incident" | "event"; id: string };
const modeRank: Record<AutomationMode, number> = { SHADOW: 0, LOS_AND_GENERIC: 1, FULL: 2 };

export function restrictiveMode(received: AutomationMode, current: AutomationMode): AutomationMode {
  return modeRank[received] <= modeRank[current] ? received : current;
}

export function evidenceTargets(decision: TriageDecision): ClaimTarget[] {
  const targets: ClaimTarget[] = [];
  if (decision.incidentId) targets.push({ kind: "incident", id: decision.incidentId });
  for (const id of [...new Set(decision.eventIds)].sort()) targets.push({ kind: "event", id });
  return targets;
}

export function planReplyClaim(episode: EpisodeSnapshot, firstMessage: boolean, decision: TriageDecision) {
  const message = classifyMessageOnEpisode(episode, firstMessage);
  let reason: string | null = null;
  if (!message.firstResponseCandidate) reason = message.suppressionApplies ? "staff_takeover" : "follow_up";
  else if (decision.outcome !== "candidate") reason = "no_candidate";
  else if (decision.automation.mode === null || decision.automation.mode === "SHADOW") reason = "shadow_mode";
  else if (decision.automation.disposition !== "pending_delivery_checks") reason = "automation_blocked";
  else if (!decision.effectiveTemplateKey) reason = "no_template";
  return {
    reason,
    targets: reason ? [] : [{ kind: "episode" as const, id: episode.id }, ...evidenceTargets(decision)],
    dispatchAuthorized: false as const,
  };
}
