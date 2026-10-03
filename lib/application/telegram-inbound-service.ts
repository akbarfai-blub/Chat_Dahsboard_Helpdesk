import { timingSafeEqual } from "node:crypto";
import {
  TelegramChannelAdapter,
  DEFAULT_MAX_PAYLOAD_BYTES,
  parseTesterAllowlist,
} from "../adapters/telegram/telegram-adapter";
import type {
  InboundAdapterResult,
  InboundRejected,
  InboundUnsupported,
} from "../adapters/channel-adapter-contracts";
import type { HelpdeskPersistence } from "./helpdesk-persistence";

export interface TelegramInboundConfig {
  readonly webhookSecret: string;
  readonly botAccountId: string;
  readonly testerAllowlist: readonly string[] | ReadonlySet<string>;
  readonly maxPayloadBytes?: number;
  readonly onAccepted?: (info: { ingressId: string; duplicate: boolean }) => void | Promise<void>;
}

export type TelegramInboundServiceResult =
  | {
      readonly outcome: "unauthorized";
      readonly reason: "missing_secret" | "invalid_secret" | "unconfigured_secret";
      readonly details: string;
    }
  | {
      readonly outcome: "oversized";
      readonly reason: "payload_too_large";
      readonly details: string;
    }
  | {
      readonly outcome: "rejected";
      readonly reason: InboundRejected["reason"];
      readonly details: string;
      readonly updateId?: number;
    }
  | {
      readonly outcome: "unsupported";
      readonly reason: InboundUnsupported["reason"];
      readonly details: string;
      readonly updateId?: number;
    }
  | {
      readonly outcome: "accepted";
      readonly ingressId: string;
      readonly duplicate: boolean;
      readonly updateId?: number;
    };

/**
 * Constant-time comparison between incoming webhook secret header and configured server secret.
 * Fails closed if configured secret is missing or empty.
 */
export function verifyTelegramWebhookSecret(
  incomingSecret: string | null | undefined,
  configuredSecret: string | null | undefined,
): boolean {
  if (!configuredSecret || configuredSecret.trim() === "") {
    return false;
  }
  if (!incomingSecret || incomingSecret.trim() === "") {
    return false;
  }
  const incomingBuf = Buffer.from(incomingSecret);
  const configuredBuf = Buffer.from(configuredSecret);
  if (incomingBuf.length !== configuredBuf.length) {
    return false;
  }
  return timingSafeEqual(incomingBuf, configuredBuf);
}

/**
 * Streams the request body with a hard byte limit.
 * Cancels reader immediately if body exceeds maxBytes, even when Content-Length is missing or spoofed.
 */
export async function readLimitedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: Buffer } | { ok: false; error: "too_large" | "read_error" }> {
  // If Content-Length header is present and already exceeds limit, fail early
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsed = parseInt(contentLength, 10);
    if (!Number.isNaN(parsed) && parsed > maxBytes) {
      return { ok: false, error: "too_large" };
    }
  }

  if (!request.body) {
    return { ok: true, body: Buffer.alloc(0) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    return { ok: true, body: Buffer.concat(chunks) };
  } catch {
    return { ok: false, error: "read_error" };
  }
}

/**
 * Orchestrates Telegram webhook inbound processing:
 * 1. Verifies secret before any side effect
 * 2. Parses and validates payload with TelegramChannelAdapter
 * 3. Persists accepted messages atomically with metadata via HelpdeskPersistence.receive()
 * 4. Never triggers provider inspection, triage execution, or outbound dispatch on the ACK path.
 */
export class TelegramInboundService {
  private readonly adapter: TelegramChannelAdapter;

  constructor(
    private readonly persistence: HelpdeskPersistence,
    private readonly config: TelegramInboundConfig,
  ) {
    this.adapter = new TelegramChannelAdapter({
      botAccountId: config.botAccountId,
      testerAllowlist: config.testerAllowlist,
      maxPayloadBytes: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    });
  }

  async handleInbound(
    incomingSecret: string | null | undefined,
    rawPayload: Buffer | string | Uint8Array,
  ): Promise<TelegramInboundServiceResult> {
    // 1. Verify webhook secret
    if (!this.config.webhookSecret || this.config.webhookSecret.trim() === "") {
      return {
        outcome: "unauthorized",
        reason: "unconfigured_secret",
        details: "Server webhook secret is unconfigured; failing closed",
      };
    }

    if (!verifyTelegramWebhookSecret(incomingSecret, this.config.webhookSecret)) {
      return {
        outcome: "unauthorized",
        reason: !incomingSecret ? "missing_secret" : "invalid_secret",
        details: "Invalid or missing webhook secret token",
      };
    }

    // 2. Pre-parse byte size validation
    const sizeValidation = this.adapter.validatePayloadSize(rawPayload);
    if (!sizeValidation.valid) {
      return {
        outcome: "oversized",
        reason: "payload_too_large",
        details: sizeValidation.details ?? "Payload size exceeds maximum allowed bytes",
      };
    }

    // 3. Adapter parse and normalize
    const adapterResult: InboundAdapterResult = this.adapter.parseInbound(rawPayload);

    if (adapterResult.outcome === "unsupported") {
      return {
        outcome: "unsupported",
        reason: adapterResult.reason,
        details: adapterResult.details,
        updateId: adapterResult.updateId,
      };
    }

    if (adapterResult.outcome === "rejected") {
      return {
        outcome: "rejected",
        reason: adapterResult.reason,
        details: adapterResult.details,
        updateId: adapterResult.updateId,
      };
    }

    // 4. Persistence atomic store (only for accepted outcome)
    // Ingress + metadata + processing job committed atomically inside inHelpdeskTransaction
    const receiveResult = await this.persistence.receive(adapterResult.receipt);

    return {
      outcome: "accepted",
      ingressId: receiveResult.ingressId,
      duplicate: receiveResult.duplicate,
    };
  }
}

const webhookHeaders = { "Cache-Control": "private, no-store", "Content-Type": "application/json" };

function failure(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code, message } }),
    { status, headers: webhookHeaders },
  );
}

function success(data: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null }),
    { status, headers: webhookHeaders },
  );
}

export type PersistenceFactory = () => HelpdeskPersistence | Promise<HelpdeskPersistence>;
export type PersistenceSource = HelpdeskPersistence | PersistenceFactory;

/**
 * HTTP orchestration function for the Telegram webhook route:
 * 1. Checks secret header before body read or database/factory initialization
 * 2. Reads body with streaming byte limit
 * 3. Lazily initializes persistence with structured error handling
 * 4. Delegates validation and persistence to TelegramInboundService
 * 5. Produces standard application envelope with differentiated HTTP status codes
 */
export async function handleTelegramWebhook(
  request: Request,
  persistenceSource: PersistenceSource,
  configOverrides: Partial<TelegramInboundConfig> = {},
): Promise<Response> {
  const configuredSecret = configOverrides.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token");

  // 1. Verify secret BEFORE reading body or touching database/persistence factory
  if (!verifyTelegramWebhookSecret(incomingSecret, configuredSecret)) {
    return failure(401, "UNAUTHORIZED", "Webhook secret token tidak valid atau tidak tersedia.");
  }

  // 2. Read body with streaming byte limit (even if Content-Length is missing or spoofed)
  const maxBytes = configOverrides.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const bodyRead = await readLimitedRequestBody(request, maxBytes);
  if (!bodyRead.ok) {
    if (bodyRead.error === "too_large") {
      return failure(413, "PAYLOAD_TOO_LARGE", "Ukuran payload melebihi batas yang diizinkan.");
    }
    return failure(400, "INVALID_REQUEST", "Gagal membaca body payload.");
  }

  // 3. Lazily initialize persistence after secret and payload size validations succeed
  let persistence: HelpdeskPersistence;
  try {
    persistence = typeof persistenceSource === "function" ? await persistenceSource() : persistenceSource;
  } catch {
    return failure(
      500,
      "DATABASE_UNAVAILABLE",
      "Layanan database tidak tersedia atau gagal diinisialisasi.",
    );
  }

  // 4. Process via application service
  try {
    const botAccountId = (configOverrides.botAccountId ?? process.env.TELEGRAM_BOT_ACCOUNT_ID ?? "upaznet_helpdesk_bot").trim();
    const testerAllowlist =
      configOverrides.testerAllowlist ??
      parseTesterAllowlist(process.env.TELEGRAM_TESTER_ALLOWLIST);

    const service = new TelegramInboundService(persistence, {
      webhookSecret: configuredSecret,
      botAccountId,
      testerAllowlist,
      maxPayloadBytes: maxBytes,
    });

    const result = await service.handleInbound(incomingSecret, bodyRead.body);

    if (result.outcome === "unauthorized") {
      return failure(401, "UNAUTHORIZED", "Webhook secret token tidak valid atau tidak tersedia.");
    }

    if (result.outcome === "oversized") {
      return failure(413, "PAYLOAD_TOO_LARGE", "Ukuran payload melebihi batas yang diizinkan.");
    }

    if (result.outcome === "unsupported") {
      // Protocol-valid but unsupported update: ACK 200 with details so Telegram does not retry
      return success({ status: "ignored", reason: result.reason, details: result.details });
    }

    if (result.outcome === "rejected") {
      // Differentiate structural/malformed errors (HTTP 400) from tester policy rejections (HTTP 200 ACK)
      const isStructural = [
        "invalid_json",
        "invalid_payload_structure",
        "missing_required_fields",
        "invalid_id_format",
        "text_too_long",
      ].includes(result.reason);

      if (isStructural) {
        return failure(400, result.reason.toUpperCase(), result.details);
      }

      // Policy rejection (non-tester, non-private chat, empty allowlist): ACK 200 so Telegram does not retry
      return success({ status: "rejected", reason: result.reason, details: result.details });
    }

    // Accepted: ingress, metadata, and processing job committed before responding
    if (configOverrides.onAccepted) {
      try {
        configOverrides.onAccepted({
          ingressId: result.ingressId,
          duplicate: result.duplicate,
        });
      } catch (err) {
        console.error("Error in onAccepted callback:", err);
      }
    }

    return success({
      status: "accepted",
      ingressId: result.ingressId,
      duplicate: result.duplicate,
    });
  } catch {
    // Database or unexpected transient failure: return 500 so Telegram can retry
    return failure(
      500,
      "PERSISTENCE_FAILED",
      "Gagal memproses dan menyimpan pesan secara persisten. Coba beberapa saat lagi.",
    );
  }
}
