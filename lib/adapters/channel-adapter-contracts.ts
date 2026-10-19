import type { InboundReceipt } from "../application/persistence-contracts";
import type { PreDispatchAuthorizedResult } from "../domain/dispatch-contracts";

/**
 * Unified request payload passed to an outbound channel adapter.
 * Sourced either from automatic triage authorization or staff manual reply authorization.
 */
export interface OutboundSendRequest {
  readonly intentId: string;
  readonly origin: "automatic" | "staff";
  readonly dispatchAuthorized: true;
  readonly channel: string;
  readonly channelAccountId: string;
  readonly chatId: string;
  readonly senderExternalId: string;
  readonly text: string;
  readonly timeoutMs?: number;
}

/**
 * Maps a successful pre-dispatch authorization result (from P3.2) to an OutboundSendRequest.
 * Ensures the exact same outbound pathway is used for both automatic and staff replies.
 */
export function buildOutboundSendRequest(
  authorized: PreDispatchAuthorizedResult,
  options?: { timeoutMs?: number },
): OutboundSendRequest {
  return {
    intentId: authorized.intentId,
    origin: authorized.origin,
    dispatchAuthorized: true,
    channel: authorized.channel,
    channelAccountId: authorized.channelAccountId,
    chatId: authorized.chatId,
    senderExternalId: authorized.senderExternalId,
    text: authorized.outboundText,
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

/**
 * Pre-flight local safety failure reasons (httpDispatched: false) or permanent provider rejections (httpDispatched: true).
 */
export type OutboundPermanentFailureReason =
  // Pre-flight local (httpDispatched: false):
  | "dispatch_not_authorized"
  | "invalid_origin"
  | "unsupported_channel"
  | "account_mismatch"
  | "missing_bot_token"
  | "empty_tester_allowlist"
  | "non_private_chat"
  | "not_in_tester_allowlist"
  | "missing_simulation_prefix"
  | "empty_message_body"
  | "text_too_long"
  | "invalid_outbound_body"
  // Provider HTTP 4xx (httpDispatched: true):
  | "provider_rejected_permanent";

/**
 * Transient provider failures that may be safely retried with exponential backoff / Retry-After (P3.4).
 */
export type OutboundRetryableFailureReason =
  | "rate_limited"
  | "provider_server_error";

/**
 * Ambiguous outcomes occurring after HTTP dispatch has commenced.
 * MUST NOT be blindly retried to avoid duplicate customer messages (PRD §11 FR-16).
 */
export type OutboundUnknownReason =
  | "timeout_after_dispatch"
  | "network_error_after_dispatch"
  | "ambiguous_provider_response";

/**
 * Definite success: Telegram provider acknowledged receipt of message.
 * Never claims the recipient has read the message (PRD §11 FR-16).
 */
export interface OutboundSendAccepted {
  readonly outcome: "accepted";
  readonly deliveryStatus: "provider_accepted";
  readonly readByRecipient: false;
  readonly httpDispatched: true;
  readonly retryable: false;
  readonly providerMessageId: string;
  readonly providerAcceptedAt: string; // ISO 8601 UTC
  readonly respondedAt: string; // ISO 8601 UTC
  readonly httpStatus: number;
}

/**
 * Definite retryable failure: Rate limited (429) or server error (5xx).
 */
export interface OutboundSendFailedRetryable {
  readonly outcome: "failed_retryable";
  readonly httpDispatched: true;
  readonly retryable: true;
  readonly reason: OutboundRetryableFailureReason;
  readonly httpStatus: number;
  readonly providerErrorCode: number | null;
  readonly retryAfterMs: number | null;
  readonly errorMessage: string;
  readonly respondedAt: string;
}

/**
 * Definite permanent failure: Pre-flight rule violation or permanent 4xx provider rejection.
 */
export interface OutboundSendFailedPermanent {
  readonly outcome: "failed_permanent";
  readonly httpDispatched: boolean;
  readonly retryable: false;
  readonly reason: OutboundPermanentFailureReason;
  readonly httpStatus: number | null;
  readonly providerErrorCode: number | null;
  readonly errorMessage: string;
  readonly respondedAt: string;
}

/**
 * Ambiguous outcome: Timeout, network socket crash, or malformed provider response after dispatch.
 */
export interface OutboundSendUnknown {
  readonly outcome: "unknown";
  readonly httpDispatched: true;
  readonly retryable: false;
  readonly reason: OutboundUnknownReason;
  readonly httpStatus: number | null;
  readonly errorMessage: string;
  readonly respondedAt: string;
}

/**
 * Sum type of all possible outcomes from an outbound send attempt.
 */
export type OutboundSendResult =
  | OutboundSendAccepted
  | OutboundSendFailedRetryable
  | OutboundSendFailedPermanent
  | OutboundSendUnknown;

/**
 * Interface for channel adapters capable of sending outbound messages to external providers.
 */
export interface OutboundChannelAdapter {
  readonly channel: string;
  readonly channelAccountId: string;
  sendOutbound(request: OutboundSendRequest): Promise<OutboundSendResult>;
}

/**
 * Full channel adapter interface supporting both inbound parsing and outbound sending.
 */
export interface ChannelAdapter extends InboundChannelAdapter, OutboundChannelAdapter {}

/**
 * High-level message content classification determined by the channel adapter.
 * Retains structural message type information without performing domain triage.
 */
export type InboundMessageType =
  | "text"
  | "photo"
  | "document"
  | "voice"
  | "video"
  | "audio"
  | "sticker"
  | "location"
  | "contact"
  | "other";

/**
 * Normalized channel-agnostic inbound message representation.
 * Preserves essential audit and display metadata for downstream layers (inbox/staff review)
 * while keeping channel identity separated.
 */
export interface NormalizedInboundMessage {
  readonly channel: string;
  readonly channelAccountId: string;
  readonly senderExternalId: string;
  readonly chatId: string;
  readonly providerMessageId: string;
  readonly messageType: InboundMessageType;
  readonly text: string | null;
  readonly caption: string | null;
  readonly hasMedia: boolean;
  readonly isForwarded: boolean;
  readonly sentAt: string; // ISO 8601 UTC string
  readonly senderInfo?: {
    readonly firstName?: string;
    readonly lastName?: string;
    // Informational metadata only; Telegram usernames can change and must never be used as trusted identity keys.
    readonly username?: string;
  };
}

/**
 * Result returned when an incoming message is successfully parsed, validated,
 * and authorized for processing under tester restrictions.
 */
export type InboundAccepted = {
  readonly outcome: "accepted";
  /**
   * Receipt formatted specifically for HelpdeskPersistence.receive().
   */
  readonly receipt: InboundReceipt;
  /**
   * Enriched message details for review and display purposes.
   */
  readonly normalized: NormalizedInboundMessage;
};

/**
 * Reasons why an update is safely recognized as valid protocol data but unsupported by this automation.
 */
export type InboundUnsupportedReason =
  | "unsupported_update_type"
  | "edited_message_ignored"
  | "unsupported_message_type"
  | "missing_required_fields";

/**
 * Result returned when an update is unsupported (e.g. edited message, channel post, non-private chat).
 * This should be acknowledged to the provider without creating ingress events.
 */
export type InboundUnsupported = {
  readonly outcome: "unsupported";
  readonly reason: InboundUnsupportedReason;
  readonly details: string;
  readonly updateId?: number;
};

/**
 * Reasons why an incoming payload is rejected due to policy or structural failure.
 */
export type InboundRejectedReason =
  | "payload_too_large"
  | "invalid_json"
  | "invalid_payload_structure"
  | "missing_required_fields"
  | "non_private_chat"
  | "not_in_tester_allowlist"
  | "empty_tester_allowlist"
  | "sender_chat_mismatch"
  | "invalid_id_format"
  | "text_too_long";

/**
 * Result returned when an incoming payload fails security, sizing, or allowlist checks.
 */
export type InboundRejected = {
  readonly outcome: "rejected";
  readonly reason: InboundRejectedReason;
  readonly details: string;
  readonly updateId?: number;
};

/**
 * Sum type of all possible outcomes from processing an untrusted inbound webhook payload.
 */
export type InboundAdapterResult = InboundAccepted | InboundUnsupported | InboundRejected;

/**
 * Byte-level payload validation result prior to full JSON parsing.
 */
export interface InboundPayloadSizeValidation {
  readonly valid: boolean;
  readonly sizeBytes: number;
  readonly maxBytes: number;
  readonly reason?: InboundRejectedReason;
  readonly details?: string;
}

/**
 * Generic interface for channel adapters handling inbound messages.
 */
export interface InboundChannelAdapter {
  readonly channel: string;
  readonly channelAccountId: string;

  /**
   * Evaluates raw body byte size before JSON parsing to protect against memory exhaustion.
   */
  validatePayloadSize(rawPayload: string | Uint8Array | Buffer): InboundPayloadSizeValidation;

  /**
   * Parses and normalizes untrusted incoming webhook payloads into structured adapter results.
   */
  parseInbound(rawPayload: unknown): InboundAdapterResult;
}
