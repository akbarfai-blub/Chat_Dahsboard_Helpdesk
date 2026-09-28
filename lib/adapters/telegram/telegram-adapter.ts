import type {
  InboundAdapterResult,
  InboundChannelAdapter,
  InboundMessageType,
  InboundPayloadSizeValidation,
} from "../channel-adapter-contracts";

export const TELEGRAM_CHANNEL = "telegram";

/**
 * Default maximum size in bytes for raw incoming JSON payloads.
 * Protects server memory from denial-of-service via huge payloads.
 */
export const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB

/**
 * Telegram standard message text maximum character length.
 * Well within HelpdeskPersistence.receive() limit of 10,000 characters.
 */
export const DEFAULT_MAX_TEXT_LENGTH = 4096;

/**
 * Telegram standard caption maximum character length.
 */
export const DEFAULT_MAX_CAPTION_LENGTH = 1024;

/**
 * Maximum representable Unix timestamp in seconds for JavaScript Date.
 * Corresponds to 100,000,000 days from epoch (+275760-09-13T00:00:00.000Z).
 * Beyond this, new Date(seconds * 1000).toISOString() throws RangeError.
 */
export const MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000;

export interface TelegramAdapterConfig {
  /**
   * Trusted identifier for this bot instance (e.g. 'upaznet_helpdesk_bot').
   * Injected by server environment, never derived from incoming webhook payload.
   */
  readonly botAccountId: string;
  /**
   * Set of authorized Telegram user IDs permitted to interact with the prototype.
   * Empty or missing allowlist fails closed (rejects all).
   */
  readonly testerAllowlist: readonly string[] | ReadonlySet<string>;
  /**
   * Maximum raw body size in bytes before JSON parsing (default: 64KB).
   */
  readonly maxPayloadBytes?: number;
  /**
   * Maximum message text length in characters (default: 4096).
   */
  readonly maxTextLength?: number;
  /**
   * Maximum media caption length in characters (default: 1024).
   */
  readonly maxCaptionLength?: number;
}

/**
 * Validates whether an allowlist entry string is a valid Telegram ID format (positive safe integer string).
 */
export function isValidTesterId(entry: unknown): entry is string {
  if (typeof entry !== "string") {
    return false;
  }
  const trimmed = entry.trim();
  if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) {
    return false;
  }
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0;
}

/**
 * Utility to parse comma-separated tester user IDs from environment variable string into a Set.
 * Enforces fail-closed configuration validation:
 * - Empty string, null, or undefined returns an empty Set (which fails closed at runtime).
 * - Any invalid, non-numeric, whitespace-only, or empty token causes an Error to be thrown
 *   to prevent partial or silently broken allowlists.
 * - Valid entries are trimmed and deduplicated into a Set.
 */
export function parseTesterAllowlist(raw: string | undefined | null): Set<string> {
  if (raw === undefined || raw === null) {
    return new Set<string>();
  }
  if (typeof raw !== "string") {
    throw new Error("Invalid tester allowlist configuration: raw value must be a string");
  }
  const trimmedRaw = raw.trim();
  if (trimmedRaw === "") {
    return new Set<string>();
  }

  const tokens = raw.split(",");
  const resultSet = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) {
      throw new Error(
        `Invalid tester allowlist configuration: empty token detected at index ${i} in '${raw}'`,
      );
    }
    if (!isValidTesterId(token)) {
      throw new Error(
        `Invalid tester allowlist configuration: entry '${token}' is not a valid Telegram user ID (must be a positive safe integer string)`,
      );
    }
    resultSet.add(token);
  }

  return resultSet;
}

/**
 * Validates whether a value is a valid Telegram ID (positive safe integer).
 */
function isValidTelegramId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validates whether a value is a valid Telegram chat ID.
 * In private chats it is a positive safe integer; in groups/channels it can be negative.
 */
function isValidTelegramChatId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value !== 0;
}

/**
 * Inbound ChannelAdapter implementation for Telegram Bot API webhook updates.
 */
export class TelegramChannelAdapter implements InboundChannelAdapter {
  readonly channel = TELEGRAM_CHANNEL;
  readonly channelAccountId: string;
  private readonly testerAllowlist: ReadonlySet<string>;
  readonly maxPayloadBytes: number;
  readonly maxTextLength: number;
  readonly maxCaptionLength: number;

  constructor(config: TelegramAdapterConfig) {
    if (!config || typeof config !== "object") {
      throw new Error("TelegramChannelAdapter requires a valid configuration object");
    }
    const trimmedAccountId = (config.botAccountId ?? "").trim();
    if (!trimmedAccountId || !/^[a-z][a-z0-9_-]*$/i.test(trimmedAccountId)) {
      throw new Error(
        `Invalid botAccountId '${config.botAccountId}': must be non-empty alphanumeric/dash/underscore string`,
      );
    }
    this.channelAccountId = trimmedAccountId;

    const rawAllowlist = config.testerAllowlist;
    const entries =
      rawAllowlist instanceof Set
        ? Array.from(rawAllowlist)
        : Array.isArray(rawAllowlist)
        ? rawAllowlist
        : null;

    if (!entries) {
      throw new Error(
        "Invalid testerAllowlist: must be an array or Set of Telegram user ID strings",
      );
    }

    const validatedAllowlist = new Set<string>();
    for (const entry of entries) {
      if (!isValidTesterId(entry)) {
        throw new Error(
          `Invalid testerAllowlist configuration: entry '${entry}' is not a valid Telegram user ID (must be a positive safe integer string)`,
        );
      }
      validatedAllowlist.add(entry.trim());
    }
    this.testerAllowlist = validatedAllowlist;

    this.maxPayloadBytes = config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.maxTextLength = config.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    this.maxCaptionLength = config.maxCaptionLength ?? DEFAULT_MAX_CAPTION_LENGTH;
  }

  /**
   * Pre-parse byte size validation.
   * Can be executed by the HTTP handler on raw request buffer/string before JSON.parse().
   */
  validatePayloadSize(rawPayload: string | Uint8Array | Buffer): InboundPayloadSizeValidation {
    let sizeBytes = 0;
    if (typeof rawPayload === "string") {
      sizeBytes = Buffer.byteLength(rawPayload, "utf8");
    } else if (Buffer.isBuffer(rawPayload) || rawPayload instanceof Uint8Array) {
      sizeBytes = rawPayload.byteLength;
    } else {
      return {
        valid: false,
        sizeBytes: 0,
        maxBytes: this.maxPayloadBytes,
        reason: "invalid_payload_structure",
        details: "Payload must be a string, Buffer, or Uint8Array",
      };
    }

    if (sizeBytes > this.maxPayloadBytes) {
      return {
        valid: false,
        sizeBytes,
        maxBytes: this.maxPayloadBytes,
        reason: "payload_too_large",
        details: `Payload size (${sizeBytes} bytes) exceeds maximum permitted limit of ${this.maxPayloadBytes} bytes`,
      };
    }

    return {
      valid: true,
      sizeBytes,
      maxBytes: this.maxPayloadBytes,
    };
  }

  /**
   * Parses, validates, and normalizes an untrusted incoming Telegram update.
   */
  parseInbound(rawPayload: unknown): InboundAdapterResult {
    // 1. Handle byte size validation and JSON parsing if raw string or buffer provided
    let payload: unknown = rawPayload;
    if (
      typeof rawPayload === "string" ||
      Buffer.isBuffer(rawPayload) ||
      rawPayload instanceof Uint8Array
    ) {
      const sizeCheck = this.validatePayloadSize(rawPayload);
      if (!sizeCheck.valid) {
        return {
          outcome: "rejected",
          reason: sizeCheck.reason ?? "payload_too_large",
          details: sizeCheck.details ?? "Payload size exceeds maximum allowed bytes",
        };
      }

      const rawString =
        typeof rawPayload === "string"
          ? rawPayload
          : Buffer.from(rawPayload).toString("utf8");

      try {
        payload = JSON.parse(rawString);
      } catch {
        return {
          outcome: "rejected",
          reason: "invalid_json",
          details: "Incoming payload is not valid JSON",
        };
      }
    }

    // 2. Structural validation of root object
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        outcome: "rejected",
        reason: "invalid_payload_structure",
        details: "Payload root must be a JSON object",
      };
    }

    const updateObj = payload as Record<string, unknown>;

    // 3. update_id validation
    if (!isValidTelegramId(updateObj.update_id)) {
      return {
        outcome: "rejected",
        reason: "invalid_payload_structure",
        details: "Missing or invalid 'update_id' field; must be a positive safe integer",
      };
    }
    const updateId = updateObj.update_id;

    // 4. Update type discrimination
    // Handle edited messages explicitly: do not treat as new messages
    if ("edited_message" in updateObj && updateObj.edited_message) {
      return {
        outcome: "unsupported",
        reason: "edited_message_ignored",
        details: "Edited messages are ignored to prevent inconsistent lifecycle and debounce replay",
        updateId,
      };
    }

    if ("channel_post" in updateObj || "edited_channel_post" in updateObj) {
      return {
        outcome: "unsupported",
        reason: "unsupported_update_type",
        details: "Channel broadcast posts are not supported",
        updateId,
      };
    }

    // Check for message field
    if (!("message" in updateObj) || !updateObj.message || typeof updateObj.message !== "object") {
      const detectedKeys = Object.keys(updateObj).filter(k => k !== "update_id");
      return {
        outcome: "unsupported",
        reason: "unsupported_update_type",
        details: `Update does not contain a message field (detected fields: ${detectedKeys.join(", ") || "none"})`,
        updateId,
      };
    }

    const messageObj = updateObj.message as Record<string, unknown>;

    // 5. Message structural validation
    if (!isValidTelegramId(messageObj.message_id)) {
      return {
        outcome: "rejected",
        reason: "invalid_id_format",
        details: "Invalid or missing 'message_id'; must be a positive safe integer",
        updateId,
      };
    }

    if (
      typeof messageObj.date !== "number" ||
      !Number.isSafeInteger(messageObj.date) ||
      messageObj.date <= 0 ||
      messageObj.date > MAX_TELEGRAM_DATE_SECONDS
    ) {
      return {
        outcome: "rejected",
        reason: "invalid_payload_structure",
        details:
          typeof messageObj.date === "number" && messageObj.date > MAX_TELEGRAM_DATE_SECONDS
            ? `Message 'date' (${messageObj.date}) exceeds maximum representable date limit of ${MAX_TELEGRAM_DATE_SECONDS} seconds`
            : "Invalid or missing message 'date'; must be a positive integer Unix timestamp",
        updateId,
      };
    }

    // 6. Chat validation
    if (!messageObj.chat || typeof messageObj.chat !== "object") {
      return {
        outcome: "rejected",
        reason: "missing_required_fields",
        details: "Message missing required 'chat' object",
        updateId,
      };
    }
    const chatObj = messageObj.chat as Record<string, unknown>;

    if (!isValidTelegramChatId(chatObj.id)) {
      return {
        outcome: "rejected",
        reason: "invalid_id_format",
        details: "Invalid or missing 'chat.id'; must be a non-zero safe integer",
        updateId,
      };
    }

    if (typeof chatObj.type !== "string") {
      return {
        outcome: "rejected",
        reason: "invalid_payload_structure",
        details: "Missing or invalid 'chat.type'",
        updateId,
      };
    }

    // Only private chats are permitted
    if (chatObj.type !== "private") {
      return {
        outcome: "rejected",
        reason: "non_private_chat",
        details: `Chat type '${chatObj.type}' is not supported; only 'private' chat is permitted`,
        updateId,
      };
    }

    // 7. Sender (from) validation
    if (!messageObj.from || typeof messageObj.from !== "object") {
      return {
        outcome: "rejected",
        reason: "missing_required_fields",
        details: "Message missing required 'from' sender object in private chat",
        updateId,
      };
    }
    const fromObj = messageObj.from as Record<string, unknown>;

    if (!isValidTelegramId(fromObj.id)) {
      return {
        outcome: "rejected",
        reason: "invalid_id_format",
        details: "Invalid or missing 'from.id'; must be a positive safe integer",
        updateId,
      };
    }

    // In Telegram private chat, chat.id must equal from.id
    if (chatObj.id !== fromObj.id) {
      return {
        outcome: "rejected",
        reason: "sender_chat_mismatch",
        details: "Private chat ID must equal sender ID",
        updateId,
      };
    }

    // 8. Tester allowlist validation
    const senderExternalId = String(fromObj.id);

    if (this.testerAllowlist.size === 0) {
      return {
        outcome: "rejected",
        reason: "empty_tester_allowlist",
        details: "Tester allowlist is empty or unconfigured; rejecting all messages (fail-closed)",
        updateId,
      };
    }

    if (!this.testerAllowlist.has(senderExternalId)) {
      return {
        outcome: "rejected",
        reason: "not_in_tester_allowlist",
        details: `Sender '${senderExternalId}' is not authorized in the tester allowlist`,
        updateId,
      };
    }

    // 9. Content length validation
    if (typeof messageObj.text === "string" && messageObj.text.length > this.maxTextLength) {
      return {
        outcome: "rejected",
        reason: "text_too_long",
        details: `Message text length (${messageObj.text.length} chars) exceeds maximum limit of ${this.maxTextLength} chars`,
        updateId,
      };
    }

    if (
      typeof messageObj.caption === "string" &&
      messageObj.caption.length > this.maxCaptionLength
    ) {
      return {
        outcome: "rejected",
        reason: "text_too_long",
        details: `Message caption length (${messageObj.caption.length} chars) exceeds maximum limit of ${this.maxCaptionLength} chars`,
        updateId,
      };
    }

    // 10. Service messages check
    const serviceFields = [
      "new_chat_members",
      "left_chat_member",
      "new_chat_title",
      "new_chat_photo",
      "delete_chat_photo",
      "group_chat_created",
      "supergroup_chat_created",
      "channel_chat_created",
      "migrate_to_chat_id",
      "migrate_from_chat_id",
      "pinned_message",
    ];
    for (const serviceField of serviceFields) {
      if (serviceField in messageObj && messageObj[serviceField]) {
        return {
          outcome: "unsupported",
          reason: "unsupported_message_type",
          details: `Service message '${serviceField}' is not supported`,
          updateId,
        };
      }
    }

    // 11. Classify message content type
    let messageType: InboundMessageType = "other";
    let hasMedia = false;
    let textContent: string | null = null;
    let captionContent: string | null = null;

    if (typeof messageObj.text === "string") {
      messageType = "text";
      textContent = messageObj.text;
    } else if (Array.isArray(messageObj.photo) && messageObj.photo.length > 0) {
      messageType = "photo";
      hasMedia = true;
    } else if (messageObj.document && typeof messageObj.document === "object") {
      messageType = "document";
      hasMedia = true;
    } else if (messageObj.voice && typeof messageObj.voice === "object") {
      messageType = "voice";
      hasMedia = true;
    } else if (messageObj.video && typeof messageObj.video === "object") {
      messageType = "video";
      hasMedia = true;
    } else if (messageObj.audio && typeof messageObj.audio === "object") {
      messageType = "audio";
      hasMedia = true;
    } else if (messageObj.sticker && typeof messageObj.sticker === "object") {
      messageType = "sticker";
      hasMedia = true;
    } else if (messageObj.location && typeof messageObj.location === "object") {
      messageType = "location";
    } else if (messageObj.contact && typeof messageObj.contact === "object") {
      messageType = "contact";
    }

    if (typeof messageObj.caption === "string") {
      captionContent = messageObj.caption;
    }

    // 12. Normalize text for InboundReceipt
    // If text is present, use text.
    // If caption is present (e.g. photo with caption), use caption.
    // If neither is present (e.g. pure photo/sticker/voice without caption), use empty string.
    // Empty string satisfies HelpdeskPersistence.receive() while not inventing false customer words.
    const normalizedReceiptText = textContent ?? captionContent ?? "";

    // 13. Forwarding detection
    const isForwarded = Boolean(
      messageObj.forward_origin ||
        messageObj.forward_from ||
        messageObj.forward_from_chat ||
        messageObj.forward_date,
    );

    // 14. Convert date to ISO 8601 UTC
    const dateObj = new Date((messageObj.date as number) * 1000);
    if (Number.isNaN(dateObj.getTime())) {
      return {
        outcome: "rejected",
        reason: "invalid_payload_structure",
        details: "Message 'date' cannot be converted to a valid ISO 8601 date",
        updateId,
      };
    }
    const sentAt = dateObj.toISOString();

    const chatId = String(chatObj.id);
    const providerMessageId = String(messageObj.message_id);

    return {
      outcome: "accepted",
      receipt: {
        sender: {
          channel: this.channel,
          channelAccountId: this.channelAccountId,
          senderExternalId,
        },
        chatId,
        providerMessageId,
        text: normalizedReceiptText,
        metadata: {
          messageType,
          hasMedia,
          isForwarded,
          caption: captionContent,
          sentAt,
          senderInfo: {
            firstName: typeof fromObj.first_name === "string" ? fromObj.first_name : undefined,
            lastName: typeof fromObj.last_name === "string" ? fromObj.last_name : undefined,
            username: typeof fromObj.username === "string" ? fromObj.username : undefined,
          },
        },
      },
      normalized: {
        channel: this.channel,
        channelAccountId: this.channelAccountId,
        senderExternalId,
        chatId,
        providerMessageId,
        messageType,
        text: textContent,
        caption: captionContent,
        hasMedia,
        isForwarded,
        sentAt,
        senderInfo: {
          firstName: typeof fromObj.first_name === "string" ? fromObj.first_name : undefined,
          lastName: typeof fromObj.last_name === "string" ? fromObj.last_name : undefined,
          username: typeof fromObj.username === "string" ? fromObj.username : undefined,
        },
      },
    };
  }
}
