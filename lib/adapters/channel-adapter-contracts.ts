import type { InboundReceipt } from "../application/persistence-contracts";

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
