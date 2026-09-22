import type { AssociationResult, EpisodeActionResult, SplitResult } from "../domain/episode-contracts";
import type { SenderKey } from "../domain/sender-identity";
import type { ManualIncidentSnapshot, TriageDecision, TriageNetworkEvidence } from "../domain/triage-contracts";

export type InboundReceipt = {
  sender: SenderKey;
  chatId: string;
  providerMessageId: string;
  text: string;
};
export type ProcessingContext = {
  network?: TriageNetworkEvidence | null;
  manualIncidents?: readonly ManualIncidentSnapshot[];
  targetEpisodeId?: string;
};
export type ProcessingResult = {
  messageId: string;
  episodeId: string | null;
  association: AssociationResult;
  decision: TriageDecision;
  claim: { outcome: "reserved" | "skipped"; reason: string; intentId: string | null };
  dispatchAuthorized: false;
};
export type StaffEpisodeAction = {
  requestId: string;
  episodeId: string;
  expectedVersion: number;
} & (
  | { action: "start" | "reopen" | "close" | "primary" }
  | { action: "resolve"; note: string }
  | { action: "split"; reason: string }
  | { action: "manual_reply"; body: string }
);
export type StaffMutationResult = EpisodeActionResult | SplitResult | {
  outcome: "accepted"; reason: "primary_selected"; episodeId: string;
};
export class PersistenceError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "PersistenceError"; }
}
