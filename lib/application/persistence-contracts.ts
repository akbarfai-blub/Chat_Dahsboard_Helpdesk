import type { AssociationResult, EpisodeActionResult, SplitResult } from "../domain/episode-contracts";
import type { SenderKey } from "../domain/sender-identity";
import type { ManualIncidentSnapshot, TriageDecision, TriageNetworkEvidence } from "../domain/triage-contracts";

export type InboundMessageMetadata = {
  readonly messageType?: string;
  readonly hasMedia?: boolean;
  readonly isForwarded?: boolean;
  readonly caption?: string | null;
  readonly sentAt?: string | null; // ISO 8601 UTC
  readonly senderInfo?: {
    readonly firstName?: string;
    readonly lastName?: string;
    readonly username?: string;
  } | null;
};

export type InboundReceipt = {
  sender: SenderKey;
  chatId: string;
  providerMessageId: string;
  text: string;
  metadata?: InboundMessageMetadata;
};
export type ProcessingContext = {
  network?: TriageNetworkEvidence | null;
  manualIncidents?: readonly ManualIncidentSnapshot[];
  targetEpisodeId?: string;
};
export type ConversationSnapshot = {
  readonly id: string;
  readonly identityId: string;
  readonly channel: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly status: "active" | "closed";
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConversationMessageItem = {
  readonly messageId: string;
  readonly conversationId: string;
  readonly identityId: string;
  readonly channel: string;
  readonly accountId: string;
  readonly chatId: string;
  readonly providerMessageId: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly sentAt: string | null;
  readonly messageType: string;
  readonly hasMedia: boolean;
  readonly isForwarded: boolean;
  readonly caption: string | null;
  readonly senderInfo: Record<string, unknown>;
  readonly complaintId: string | null;
  readonly classification: unknown;
  readonly reviewReason: string | null;
  readonly createdAt: string;
};

export type ProcessingResult = {
  messageId: string;
  conversationId?: string;
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
