/**
 * Domain types and pure functions for Conversation Grouping based on 24-hour inactivity.
 *
 * Rules (PRD §3, PRD §6.1, P2.3 Acceptance Criteria, and Decision D85):
 * - Conversations are grouped based on an inactivity gap >= 24 hours.
 * - Gap < 24 hours (86,400,000 ms) joins or bridges existing conversations.
 * - Gap >= 24 hours creates a new conversation.
 * - Inactivity is calculated from the last relevant activity timestamp (sliding window),
 *   NOT the elapsed age since the conversation was started.
 * - Out-of-order arrival is handled deterministically: messages arriving late that connect
 *   two conversations merge them cleanly into one continuous conversation.
 * - The conversation with the latest activity across the scope is marked active;
 *   historical conversations remain or become closed.
 * - Pure functions with explicit time inputs, zero I/O, deterministic.
 */

export const CONVERSATION_INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 86_400_000 ms (24 hours)

export interface ConversationCandidate {
  readonly id: string;
  readonly startedAt: string; // ISO 8601
  readonly lastActivityAt: string; // ISO 8601
  readonly status?: "active" | "closed";
}

export interface EvaluateConversationGroupingInput {
  readonly messageReceivedAt: string | Date;
  readonly existingConversations: readonly ConversationCandidate[];
  readonly thresholdMs?: number;
}

export type EvaluateConversationGroupingResult =
  | {
      readonly action: "create";
      readonly startedAt: string;
      readonly lastActivityAt: string;
      readonly shouldBeActive: boolean;
    }
  | {
      readonly action: "join";
      readonly conversationId: string;
      readonly startedAt: string;
      readonly lastActivityAt: string;
      readonly shouldBeActive: boolean;
      readonly updatedStartedAt?: string;
      readonly updatedLastActivityAt?: string;
    }
  | {
      readonly action: "merge";
      readonly survivingConversationId: string;
      readonly absorbedConversationIds: readonly string[];
      readonly startedAt: string;
      readonly lastActivityAt: string;
      readonly shouldBeActive: boolean;
    };

function parseEpoch(time: string | Date, fieldName = "timestamp"): number {
  const epoch = typeof time === "string" ? new Date(time).getTime() : time.getTime();
  if (Number.isNaN(epoch)) {
    throw new Error(`Invalid ${fieldName}: unable to parse date`);
  }
  return epoch;
}

/**
 * Checks whether the elapsed time difference between two timestamps is strictly within the inactivity window (< thresholdMs).
 */
export function isWithinInactivityWindow(
  timeA: string | Date,
  timeB: string | Date,
  thresholdMs: number = CONVERSATION_INACTIVITY_THRESHOLD_MS,
): boolean {
  const epochA = parseEpoch(timeA, "timeA");
  const epochB = parseEpoch(timeB, "timeB");
  return Math.abs(epochB - epochA) < thresholdMs;
}

/**
 * Evaluates whether an incoming message belongs to an existing conversation, starts a new one,
 * or bridges and merges two existing conversations.
 *
 * Deterministic behavior:
 * 1. If existingConversations is empty: creates a new active conversation.
 * 2. If the message falls within [startedAt, lastActivityAt] of an existing conversation:
 *    joins that conversation without shifting boundaries.
 * 3. Out-of-order bridging: If messageEpoch is within < thresholdMs of a prior conversation's end
 *    AND within < thresholdMs of a subsequent conversation's start, the two conversations are merged.
 * 4. Forward extension: If only the prior conversation is within < thresholdMs, joins and extends lastActivityAt.
 * 5. Backward extension: If only the future conversation is within < thresholdMs, joins and extends startedAt.
 * 6. Isolated message: Gap to all conversations >= thresholdMs -> creates a new conversation.
 *    Only becomes active if its timestamp is later than all existing conversations.
 */
export function evaluateConversationGrouping(
  input: EvaluateConversationGroupingInput,
): EvaluateConversationGroupingResult {
  const messageEpoch = parseEpoch(input.messageReceivedAt, "messageReceivedAt");
  const messageIso = new Date(messageEpoch).toISOString();
  const thresholdMs = input.thresholdMs ?? CONVERSATION_INACTIVITY_THRESHOLD_MS;

  if (!input.existingConversations || input.existingConversations.length === 0) {
    return {
      action: "create",
      startedAt: messageIso,
      lastActivityAt: messageIso,
      shouldBeActive: true,
    };
  }

  // Parse and sort conversations by startedAt ascending
  const sorted = input.existingConversations
    .map((c) => ({
      id: c.id,
      startedEpoch: parseEpoch(c.startedAt, "conversation.startedAt"),
      lastActivityEpoch: parseEpoch(c.lastActivityAt, "conversation.lastActivityAt"),
      startedAt: c.startedAt,
      lastActivityAt: c.lastActivityAt,
    }))
    .sort((a, b) => a.startedEpoch - b.startedEpoch);

  // 1. Check if message falls directly inside an existing conversation span [startedEpoch, lastActivityEpoch]
  for (const c of sorted) {
    if (messageEpoch >= c.startedEpoch && messageEpoch <= c.lastActivityEpoch) {
      const maxLastActivity = Math.max(...sorted.map((x) => x.lastActivityEpoch));
      const shouldBeActive = c.lastActivityEpoch === maxLastActivity;
      return {
        action: "join",
        conversationId: c.id,
        startedAt: c.startedAt,
        lastActivityAt: c.lastActivityAt,
        shouldBeActive,
      };
    }
  }

  // 2. Identify closest prior and closest future conversations
  const priorConversations = sorted
    .filter((c) => messageEpoch > c.lastActivityEpoch)
    .sort((a, b) => b.lastActivityEpoch - a.lastActivityEpoch); // closest prior first
  const closestPrior = priorConversations[0] ?? null;
  const priorConnected =
    closestPrior !== null && messageEpoch - closestPrior.lastActivityEpoch < thresholdMs;

  const futureConversations = sorted
    .filter((c) => messageEpoch < c.startedEpoch)
    .sort((a, b) => a.startedEpoch - b.startedEpoch); // closest future first
  const closestFuture = futureConversations[0] ?? null;
  const futureConnected =
    closestFuture !== null && closestFuture.startedEpoch - messageEpoch < thresholdMs;

  // Case 2A: Both prior and future connected -> BRIDGING & MERGE!
  if (priorConnected && futureConnected && closestPrior !== null && closestFuture !== null) {
    const mergedStartedAt = new Date(Math.min(closestPrior.startedEpoch, messageEpoch)).toISOString();
    const mergedLastActivityAt = new Date(
      Math.max(closestFuture.lastActivityEpoch, messageEpoch),
    ).toISOString();
    const mergedLastActivityEpoch = Math.max(closestFuture.lastActivityEpoch, messageEpoch);

    const otherConversations = sorted.filter(
      (x) => x.id !== closestPrior.id && x.id !== closestFuture.id,
    );
    const otherMax =
      otherConversations.length > 0
        ? Math.max(...otherConversations.map((x) => x.lastActivityEpoch))
        : 0;
    const shouldBeActive = mergedLastActivityEpoch >= otherMax;

    return {
      action: "merge",
      survivingConversationId: closestPrior.id,
      absorbedConversationIds: [closestFuture.id],
      startedAt: mergedStartedAt,
      lastActivityAt: mergedLastActivityAt,
      shouldBeActive,
    };
  }

  // Case 2B: Only prior connected -> Extend prior forward
  if (priorConnected && closestPrior !== null) {
    const updatedStartedAt = closestPrior.startedAt;
    const updatedLastActivityAt = messageIso;
    const otherConversations = sorted.filter((x) => x.id !== closestPrior.id);
    const otherMax =
      otherConversations.length > 0
        ? Math.max(...otherConversations.map((x) => x.lastActivityEpoch))
        : 0;
    const shouldBeActive = messageEpoch >= otherMax;

    return {
      action: "join",
      conversationId: closestPrior.id,
      startedAt: updatedStartedAt,
      lastActivityAt: updatedLastActivityAt,
      updatedLastActivityAt: messageIso,
      shouldBeActive,
    };
  }

  // Case 2C: Only future connected -> Extend future backward
  if (futureConnected && closestFuture !== null) {
    const updatedStartedAt = messageIso;
    const updatedLastActivityAt = closestFuture.lastActivityAt;
    const otherConversations = sorted.filter((x) => x.id !== closestFuture.id);
    const otherMax =
      otherConversations.length > 0
        ? Math.max(...otherConversations.map((x) => x.lastActivityEpoch))
        : 0;
    const shouldBeActive = closestFuture.lastActivityEpoch >= otherMax;

    return {
      action: "join",
      conversationId: closestFuture.id,
      startedAt: updatedStartedAt,
      lastActivityAt: updatedLastActivityAt,
      updatedStartedAt: messageIso,
      shouldBeActive,
    };
  }

  // Case 2D: Neither connected -> Create new conversation
  const maxLastActivity = Math.max(...sorted.map((x) => x.lastActivityEpoch));
  const shouldBeActive = messageEpoch >= maxLastActivity;

  return {
    action: "create",
    startedAt: messageIso,
    lastActivityAt: messageIso,
    shouldBeActive,
  };
}
