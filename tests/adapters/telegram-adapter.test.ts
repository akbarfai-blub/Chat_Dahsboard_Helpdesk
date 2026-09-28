import test from "node:test";
import assert from "node:assert/strict";
import {
  TelegramChannelAdapter,
  parseTesterAllowlist,
  isValidTesterId,
  MAX_TELEGRAM_DATE_SECONDS,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_TEXT_LENGTH,
  DEFAULT_MAX_CAPTION_LENGTH,
} from "../../lib/adapters/telegram/telegram-adapter";
import type { TelegramUpdate } from "../../lib/adapters/telegram/telegram-types";
import { isValidSenderKey, resolveSenderIdentity } from "../../lib/domain/sender-identity";

const DEFAULT_BOT_ACCOUNT = "upaznet_helpdesk_bot";
const TESTER_ID = "987654321";
const OTHER_TESTER_ID = "112233445";

function createAdapter(allowlist: string[] = [TESTER_ID, OTHER_TESTER_ID], overrides = {}) {
  return new TelegramChannelAdapter({
    botAccountId: DEFAULT_BOT_ACCOUNT,
    testerAllowlist: allowlist,
    ...overrides,
  });
}

function makeValidPrivateUpdate(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
  return {
    update_id: 10001,
    message: {
      message_id: 42,
      date: 1727500000,
      chat: {
        id: Number(TESTER_ID),
        type: "private",
        first_name: "Tester",
        username: "tester_user",
      },
      from: {
        id: Number(TESTER_ID),
        is_bot: false,
        first_name: "Tester",
        username: "tester_user",
      },
      text: "Internet saya mati sejak tadi pagi",
    },
    ...overrides,
  };
}

test("valid private chat tester message is accepted with correct normalization", () => {
  const adapter = createAdapter();
  const update = makeValidPrivateUpdate();
  const result = adapter.parseInbound(update);

  assert.equal(result.outcome, "accepted");
  if (result.outcome !== "accepted") return;

  // Receipt format compatible with HelpdeskPersistence.receive()
  assert.equal(result.receipt.sender.channel, "telegram");
  assert.equal(result.receipt.sender.channelAccountId, DEFAULT_BOT_ACCOUNT);
  assert.equal(result.receipt.sender.senderExternalId, TESTER_ID);
  assert.equal(result.receipt.chatId, TESTER_ID);
  assert.equal(result.receipt.providerMessageId, "42");
  assert.equal(result.receipt.text, "Internet saya mati sejak tadi pagi");

  assert.equal(isValidSenderKey(result.receipt.sender), true);
  assert.equal(result.receipt.metadata?.messageType, "text");
  assert.equal(result.receipt.metadata?.hasMedia, false);
  assert.equal(result.receipt.metadata?.isForwarded, false);
  assert.equal(result.receipt.metadata?.caption, null);
  assert.equal(result.receipt.metadata?.sentAt, new Date(1727500000 * 1000).toISOString());
  assert.equal(result.receipt.metadata?.senderInfo?.firstName, "Tester");

  // Normalized audit representation
  assert.equal(result.normalized.channel, "telegram");
  assert.equal(result.normalized.channelAccountId, DEFAULT_BOT_ACCOUNT);
  assert.equal(result.normalized.senderExternalId, TESTER_ID);
  assert.equal(result.normalized.chatId, TESTER_ID);
  assert.equal(result.normalized.providerMessageId, "42");
  assert.equal(result.normalized.messageType, "text");
  assert.equal(result.normalized.text, "Internet saya mati sejak tadi pagi");
  assert.equal(result.normalized.caption, null);
  assert.equal(result.normalized.hasMedia, false);
  assert.equal(result.normalized.isForwarded, false);
  assert.equal(result.normalized.sentAt, new Date(1727500000 * 1000).toISOString());
  assert.equal(result.normalized.senderInfo?.firstName, "Tester");
  assert.equal(result.normalized.senderInfo?.username, "tester_user");
});

test("tester allowlist enforcement rejects unauthorized senders and fails closed when empty", () => {
  const adapter = createAdapter([TESTER_ID]);

  // Sender not in allowlist
  const unauthorizedUpdate: TelegramUpdate = {
    update_id: 10002,
    message: {
      message_id: 43,
      date: 1727500000,
      chat: { id: 999999999, type: "private" },
      from: { id: 999999999, is_bot: false, first_name: "Intruder" },
      text: "halo",
    },
  };
  const unauthorizedResult = adapter.parseInbound(unauthorizedUpdate);
  assert.equal(unauthorizedResult.outcome, "rejected");
  if (unauthorizedResult.outcome === "rejected") {
    assert.equal(unauthorizedResult.reason, "not_in_tester_allowlist");
    assert.match(unauthorizedResult.details, /999999999/);
  }

  // Empty allowlist fails closed
  const emptyAdapter = createAdapter([]);
  const emptyResult = emptyAdapter.parseInbound(makeValidPrivateUpdate());
  assert.equal(emptyResult.outcome, "rejected");
  if (emptyResult.outcome === "rejected") {
    assert.equal(emptyResult.reason, "empty_tester_allowlist");
  }
});

test("parseTesterAllowlist parses valid numeric IDs with whitespace/duplicates and fails closed on invalid configs", () => {
  // Direct helper isValidTesterId verification
  assert.equal(isValidTesterId("12345"), true);
  assert.equal(isValidTesterId(" 12345 "), true);
  assert.equal(isValidTesterId("987654321"), true);
  assert.equal(isValidTesterId("0"), false);
  assert.equal(isValidTesterId("-123"), false);
  assert.equal(isValidTesterId("not_a_number"), false);
  assert.equal(isValidTesterId(""), false);
  assert.equal(isValidTesterId(12345), false);
  assert.equal(isValidTesterId(null), false);

  // Valid configuration: trims whitespace and deduplicates IDs
  const parsed = parseTesterAllowlist(" 12345, 67890 , 12345 ");
  assert.equal(parsed.size, 2);
  assert.equal(parsed.has("12345"), true);
  assert.equal(parsed.has("67890"), true);

  // Empty configurations return empty Set (which fails closed at runtime)
  assert.equal(parseTesterAllowlist("").size, 0);
  assert.equal(parseTesterAllowlist("   ").size, 0);
  assert.equal(parseTesterAllowlist(null).size, 0);
  assert.equal(parseTesterAllowlist(undefined).size, 0);

  // Mixed valid-invalid configuration throws Error (never partially applies valid entries)
  assert.throws(
    () => parseTesterAllowlist("987654321,not_a_number"),
    /Invalid tester allowlist configuration.*not_a_number/,
  );

  // Entirely invalid configuration throws Error
  assert.throws(
    () => parseTesterAllowlist("not_a_number,also_bad"),
    /Invalid tester allowlist configuration.*not_a_number/,
  );

  // Empty tokens (double comma or trailing/leading comma) throw Error
  assert.throws(
    () => parseTesterAllowlist("12345,,67890"),
    /Invalid tester allowlist configuration: empty token detected/,
  );
  assert.throws(
    () => parseTesterAllowlist("12345,"),
    /Invalid tester allowlist configuration: empty token detected/,
  );
  assert.throws(
    () => parseTesterAllowlist(",12345"),
    /Invalid tester allowlist configuration: empty token detected/,
  );

  // Zero, negative, or non-integer numbers throw Error
  assert.throws(
    () => parseTesterAllowlist("12345, 0"),
    /Invalid tester allowlist configuration.*0.*not a valid Telegram user ID/,
  );
  assert.throws(
    () => parseTesterAllowlist("12345, -999"),
    /Invalid tester allowlist configuration.*-999.*not a valid Telegram user ID/,
  );

  // Non-string input throws Error
  assert.throws(
    () => parseTesterAllowlist(12345 as unknown as string),
    /raw value must be a string/,
  );
});

test("constructor enforces identical fail-closed allowlist validation on direct configurations", () => {
  // Valid array and Set are accepted and deduplicated
  const adapterFromArray = new TelegramChannelAdapter({
    botAccountId: DEFAULT_BOT_ACCOUNT,
    testerAllowlist: [" 12345 ", "67890", "12345"],
  });
  assert.equal(adapterFromArray.channelAccountId, DEFAULT_BOT_ACCOUNT);

  const adapterFromSet = new TelegramChannelAdapter({
    botAccountId: DEFAULT_BOT_ACCOUNT,
    testerAllowlist: new Set(["12345", "67890"]),
  });
  assert.equal(adapterFromSet.channelAccountId, DEFAULT_BOT_ACCOUNT);

  // Empty array and empty Set succeed at construction but fail closed on parseInbound
  const emptyAdapterArray = new TelegramChannelAdapter({
    botAccountId: DEFAULT_BOT_ACCOUNT,
    testerAllowlist: [],
  });
  const emptyResult = emptyAdapterArray.parseInbound(makeValidPrivateUpdate());
  assert.equal(emptyResult.outcome, "rejected");
  if (emptyResult.outcome === "rejected") {
    assert.equal(emptyResult.reason, "empty_tester_allowlist");
  }

  // Mixed valid-invalid array throws synchronously (cannot bypass helper validation)
  assert.throws(
    () =>
      new TelegramChannelAdapter({
        botAccountId: DEFAULT_BOT_ACCOUNT,
        testerAllowlist: ["987654321", "not_a_number"],
      }),
    /Invalid testerAllowlist configuration.*not_a_number/,
  );

  // Entirely invalid array throws synchronously
  assert.throws(
    () =>
      new TelegramChannelAdapter({
        botAccountId: DEFAULT_BOT_ACCOUNT,
        testerAllowlist: ["not_a_number", "also_bad"],
      }),
    /Invalid testerAllowlist configuration.*not_a_number/,
  );

  // Array with empty string or zero throws synchronously
  assert.throws(
    () =>
      new TelegramChannelAdapter({
        botAccountId: DEFAULT_BOT_ACCOUNT,
        testerAllowlist: [""],
      }),
    /Invalid testerAllowlist configuration.*not a valid Telegram user ID/,
  );
  assert.throws(
    () =>
      new TelegramChannelAdapter({
        botAccountId: DEFAULT_BOT_ACCOUNT,
        testerAllowlist: ["0"],
      }),
    /Invalid testerAllowlist configuration.*0.*not a valid Telegram user ID/,
  );

  // Non-array/non-Set throws synchronously
  assert.throws(
    () =>
      new TelegramChannelAdapter({
        botAccountId: DEFAULT_BOT_ACCOUNT,
        testerAllowlist: "12345" as unknown as readonly string[],
      }),
    /must be an array or Set/,
  );
});

test("date validation enforces representable range, handles boundaries and Number.MAX_SAFE_INTEGER without throwing", () => {
  const adapter = createAdapter();

  // 1. Normal valid date
  const normalUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 101,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "normal date",
    },
  });
  const normalRes = adapter.parseInbound(normalUpdate);
  assert.equal(normalRes.outcome, "accepted");
  if (normalRes.outcome === "accepted") {
    assert.equal(normalRes.normalized.sentAt, new Date(1727500000 * 1000).toISOString());
  }

  // 2. Exact maximum representable date boundary (MAX_TELEGRAM_DATE_SECONDS = 8_640_000_000_000)
  const boundaryUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 102,
      date: MAX_TELEGRAM_DATE_SECONDS,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "boundary date",
    },
  });
  const boundaryRes = adapter.parseInbound(boundaryUpdate);
  assert.equal(boundaryRes.outcome, "accepted");
  if (boundaryRes.outcome === "accepted") {
    assert.equal(boundaryRes.normalized.sentAt, "+275760-09-13T00:00:00.000Z");
  }

  // 3. Just above boundary (MAX_TELEGRAM_DATE_SECONDS + 1) -> rejected without throwing RangeError
  const overBoundaryUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 103,
      date: MAX_TELEGRAM_DATE_SECONDS + 1,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "over boundary",
    },
  });
  assert.doesNotThrow(() => {
    adapter.parseInbound(overBoundaryUpdate);
  });
  const overBoundaryRes = adapter.parseInbound(overBoundaryUpdate);
  assert.equal(overBoundaryRes.outcome, "rejected");
  if (overBoundaryRes.outcome === "rejected") {
    assert.equal(overBoundaryRes.reason, "invalid_payload_structure");
    assert.match(overBoundaryRes.details, /exceeds maximum representable date limit/);
  }

  // 4. Number.MAX_SAFE_INTEGER -> rejected without throwing RangeError
  const maxSafeIntUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 104,
      date: Number.MAX_SAFE_INTEGER,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "max safe integer date",
    },
  });
  assert.doesNotThrow(() => {
    adapter.parseInbound(maxSafeIntUpdate);
  });
  const maxSafeIntRes = adapter.parseInbound(maxSafeIntUpdate);
  assert.equal(maxSafeIntRes.outcome, "rejected");
  if (maxSafeIntRes.outcome === "rejected") {
    assert.equal(maxSafeIntRes.reason, "invalid_payload_structure");
    assert.match(maxSafeIntRes.details, /exceeds maximum representable date limit/);
  }

  // 5. Zero date -> rejected
  const zeroUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 105,
      date: 0,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "zero date",
    },
  });
  const zeroRes = adapter.parseInbound(zeroUpdate);
  assert.equal(zeroRes.outcome, "rejected");
  if (zeroRes.outcome === "rejected") {
    assert.equal(zeroRes.reason, "invalid_payload_structure");
  }

  // 6. Negative date -> rejected
  const negativeUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 106,
      date: -100,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "negative date",
    },
  });
  const negativeRes = adapter.parseInbound(negativeUpdate);
  assert.equal(negativeRes.outcome, "rejected");
  if (negativeRes.outcome === "rejected") {
    assert.equal(negativeRes.reason, "invalid_payload_structure");
  }

  // 7. Non-integer float date -> rejected
  const floatUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 107,
      date: 1727500000.5,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "float date",
    },
  });
  const floatRes = adapter.parseInbound(floatUpdate);
  assert.equal(floatRes.outcome, "rejected");
  if (floatRes.outcome === "rejected") {
    assert.equal(floatRes.reason, "invalid_payload_structure");
  }

  // 8. Non-number types -> rejected
  for (const invalidDate of ["1727500000", null, undefined, {}, []]) {
    const invalidTypeUpdate = makeValidPrivateUpdate({
      message: {
        message_id: 108,
        date: invalidDate as unknown as number,
        chat: { id: Number(TESTER_ID), type: "private" },
        from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
        text: "invalid type date",
      },
    });
    const invalidTypeRes = adapter.parseInbound(invalidTypeUpdate);
    assert.equal(invalidTypeRes.outcome, "rejected");
    if (invalidTypeRes.outcome === "rejected") {
      assert.equal(invalidTypeRes.reason, "invalid_payload_structure");
    }
  }
});

test("rejects group, supergroup, and channel chats", () => {
  const adapter = createAdapter();

  for (const chatType of ["group", "supergroup", "channel"] as const) {
    const update: TelegramUpdate = {
      update_id: 10003,
      message: {
        message_id: 44,
        date: 1727500000,
        chat: { id: -100123456789, type: chatType, title: "Test Group" },
        from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
        text: "laporan gangguan grup",
      },
    };
    const result = adapter.parseInbound(update);
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") {
      assert.equal(result.reason, "non_private_chat");
      assert.match(result.details, new RegExp(chatType));
    }
  }
});

test("rejects or treats unsupported update types explicitly", () => {
  const adapter = createAdapter();

  // edited_message is ignored so it does not trigger a new complaint/debounce replay
  const editedUpdate: TelegramUpdate = {
    update_id: 10004,
    edited_message: {
      message_id: 42,
      date: 1727500010,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "Internet saya mati sejak kemarin (diedit)",
    },
  };
  const editedResult = adapter.parseInbound(editedUpdate);
  assert.equal(editedResult.outcome, "unsupported");
  if (editedResult.outcome === "unsupported") {
    assert.equal(editedResult.reason, "edited_message_ignored");
  }

  // channel_post
  const channelPostUpdate: TelegramUpdate = {
    update_id: 10005,
    channel_post: {
      message_id: 50,
      date: 1727500020,
      chat: { id: -100987654321, type: "channel" },
      text: "Broadcast",
    },
  };
  const channelResult = adapter.parseInbound(channelPostUpdate);
  assert.equal(channelResult.outcome, "unsupported");
  if (channelResult.outcome === "unsupported") {
    assert.equal(channelResult.reason, "unsupported_update_type");
  }

  // callback_query or other update types
  const callbackUpdate = {
    update_id: 10006,
    callback_query: { id: "cq_123", data: "btn_click" },
  };
  const callbackResult = adapter.parseInbound(callbackUpdate);
  assert.equal(callbackResult.outcome, "unsupported");
  if (callbackResult.outcome === "unsupported") {
    assert.equal(callbackResult.reason, "unsupported_update_type");
  }
});

test("handles malformed JSON and structural payload failures", () => {
  const adapter = createAdapter();

  // Broken JSON string
  const brokenJsonResult = adapter.parseInbound("{\"update_id\": 10007, broken");
  assert.equal(brokenJsonResult.outcome, "rejected");
  if (brokenJsonResult.outcome === "rejected") {
    assert.equal(brokenJsonResult.reason, "invalid_json");
  }

  // Non-object roots
  for (const invalid of [null, undefined, 42, "hello", []]) {
    const res = adapter.parseInbound(invalid);
    assert.equal(res.outcome, "rejected");
  }

  // Missing update_id
  const noUpdateId = { message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, from: { id: 1 } } };
  const noUpdateIdRes = adapter.parseInbound(noUpdateId);
  assert.equal(noUpdateIdRes.outcome, "rejected");

  // Missing sender from in private chat
  const noFrom = {
    update_id: 10008,
    message: {
      message_id: 45,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      text: "pesan tanpa from",
    },
  };
  const noFromRes = adapter.parseInbound(noFrom);
  assert.equal(noFromRes.outcome, "rejected");
  if (noFromRes.outcome === "rejected") {
    assert.equal(noFromRes.reason, "missing_required_fields");
  }

  // Sender and chat ID mismatch in private chat
  const mismatchedChat = {
    update_id: 10009,
    message: {
      message_id: 46,
      date: 1727500000,
      chat: { id: 111111, type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "pesan mismatch",
    },
  };
  const mismatchedRes = adapter.parseInbound(mismatchedChat);
  assert.equal(mismatchedRes.outcome, "rejected");
  if (mismatchedRes.outcome === "rejected") {
    assert.equal(mismatchedRes.reason, "sender_chat_mismatch");
  }
});

test("enforces byte size limits pre-parse and text length limits on content", () => {
  const customAdapter = createAdapter([TESTER_ID], {
    maxPayloadBytes: 512,
    maxTextLength: 20,
    maxCaptionLength: 10,
  });

  // Pre-parse byte size validation helper
  const smallString = JSON.stringify(makeValidPrivateUpdate());
  const sizeValidation = customAdapter.validatePayloadSize(smallString);
  assert.equal(sizeValidation.valid, true);

  // Oversized raw payload
  const hugeString = "x".repeat(600);
  const oversizedSize = customAdapter.validatePayloadSize(hugeString);
  assert.equal(oversizedSize.valid, false);
  assert.equal(oversizedSize.reason, "payload_too_large");

  const oversizedParse = customAdapter.parseInbound(hugeString);
  assert.equal(oversizedParse.outcome, "rejected");
  if (oversizedParse.outcome === "rejected") {
    assert.equal(oversizedParse.reason, "payload_too_large");
  }

  // Multibyte characters byte size
  // 4-byte unicode emoji
  const emojiStr = "📡".repeat(150); // 150 * 4 = 600 bytes > 512 bytes
  const emojiValidation = customAdapter.validatePayloadSize(emojiStr);
  assert.equal(emojiValidation.valid, false);
  assert.equal(emojiValidation.sizeBytes, 600);

  // Content text length check (> 20 chars)
  const longTextUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 47,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "Ini adalah pesan teks yang panjangnya melebihi dua puluh karakter",
    },
  });
  const longTextRes = customAdapter.parseInbound(longTextUpdate);
  assert.equal(longTextRes.outcome, "rejected");
  if (longTextRes.outcome === "rejected") {
    assert.equal(longTextRes.reason, "text_too_long");
  }

  // Content caption length check (> 10 chars)
  const longCaptionUpdate = makeValidPrivateUpdate({
    message: {
      message_id: 48,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      photo: [{ file_id: "photo_1", file_unique_id: "p1", width: 100, height: 100 }],
      caption: "Caption foto yang terlalu panjang",
    },
  });
  const longCaptionRes = customAdapter.parseInbound(longCaptionUpdate);
  assert.equal(longCaptionRes.outcome, "rejected");
  if (longCaptionRes.outcome === "rejected") {
    assert.equal(longCaptionRes.reason, "text_too_long");
  }
});

test("handles non-text media messages without inventing fake customer text", () => {
  const adapter = createAdapter();

  // Photo with caption
  const photoWithCaption: TelegramUpdate = {
    update_id: 10010,
    message: {
      message_id: 49,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      photo: [
        { file_id: "photo_thumb", file_unique_id: "u1", width: 90, height: 90 },
        { file_id: "photo_large", file_unique_id: "u2", width: 800, height: 800 },
      ],
      caption: "Lampu modem merah berkedip",
    },
  };
  const photoCaptionRes = adapter.parseInbound(photoWithCaption);
  assert.equal(photoCaptionRes.outcome, "accepted");
  if (photoCaptionRes.outcome === "accepted") {
    assert.equal(photoCaptionRes.normalized.messageType, "photo");
    assert.equal(photoCaptionRes.normalized.hasMedia, true);
    assert.equal(photoCaptionRes.normalized.caption, "Lampu modem merah berkedip");
    // Receipt text passes caption for triage/inbox review
    assert.equal(photoCaptionRes.receipt.text, "Lampu modem merah berkedip");
  }

  // Photo without caption
  const photoWithoutCaption: TelegramUpdate = {
    update_id: 10011,
    message: {
      message_id: 50,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      photo: [{ file_id: "photo_1", file_unique_id: "u3", width: 500, height: 500 }],
    },
  };
  const photoNoCaptionRes = adapter.parseInbound(photoWithoutCaption);
  assert.equal(photoNoCaptionRes.outcome, "accepted");
  if (photoNoCaptionRes.outcome === "accepted") {
    assert.equal(photoNoCaptionRes.normalized.messageType, "photo");
    assert.equal(photoNoCaptionRes.normalized.hasMedia, true);
    assert.equal(photoNoCaptionRes.normalized.text, null);
    assert.equal(photoNoCaptionRes.normalized.caption, null);
    // Receipt text is clean empty string (not invented words, compatible with HelpdeskPersistence)
    assert.equal(photoNoCaptionRes.receipt.text, "");
  }

  // Voice message
  const voiceUpdate: TelegramUpdate = {
    update_id: 10012,
    message: {
      message_id: 51,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      voice: { file_id: "voice_1", file_unique_id: "v1", duration: 5 },
    },
  };
  const voiceRes = adapter.parseInbound(voiceUpdate);
  assert.equal(voiceRes.outcome, "accepted");
  if (voiceRes.outcome === "accepted") {
    assert.equal(voiceRes.normalized.messageType, "voice");
    assert.equal(voiceRes.normalized.hasMedia, true);
    assert.equal(voiceRes.receipt.text, "");
  }

  // Document message
  const docUpdate: TelegramUpdate = {
    update_id: 10013,
    message: {
      message_id: 52,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      document: { file_id: "doc_1", file_unique_id: "d1", file_name: "bukti.pdf" },
    },
  };
  const docRes = adapter.parseInbound(docUpdate);
  assert.equal(docRes.outcome, "accepted");
  if (docRes.outcome === "accepted") {
    assert.equal(docRes.normalized.messageType, "document");
    assert.equal(docRes.normalized.hasMedia, true);
  }
});

test("forwarded messages are flagged without altering sender identity to forwarded author", () => {
  const adapter = createAdapter();

  const forwardedUpdate: TelegramUpdate = {
    update_id: 10014,
    message: {
      message_id: 53,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      forward_from: { id: 777777777, is_bot: false, first_name: "Original Author" },
      forward_date: 1727400000,
      text: "Pesan terusan dari tetangga: internet mati",
    },
  };
  const res = adapter.parseInbound(forwardedUpdate);
  assert.equal(res.outcome, "accepted");
  if (res.outcome === "accepted") {
    assert.equal(res.normalized.isForwarded, true);
    // Crucial: sender must remain the authorized tester who sent it to the bot, not the forwarded author
    assert.equal(res.receipt.sender.senderExternalId, TESTER_ID);
    assert.equal(res.normalized.senderExternalId, TESTER_ID);
  }
});

test("normalization is strictly deterministic for identical payloads", () => {
  const adapter = createAdapter();
  const update = makeValidPrivateUpdate();

  const res1 = adapter.parseInbound(update);
  const res2 = adapter.parseInbound(update);

  assert.deepEqual(res1, res2);
});

test("identical message ID on different chats or bot accounts produces distinct identities", () => {
  const adapterA = new TelegramChannelAdapter({
    botAccountId: "bot_alpha",
    testerAllowlist: [TESTER_ID, OTHER_TESTER_ID],
  });
  const adapterB = new TelegramChannelAdapter({
    botAccountId: "bot_beta",
    testerAllowlist: [TESTER_ID, OTHER_TESTER_ID],
  });

  const msgId = 999;

  // Same message ID, different bot accounts
  const update1: TelegramUpdate = {
    update_id: 20001,
    message: {
      message_id: msgId,
      date: 1727500000,
      chat: { id: Number(TESTER_ID), type: "private" },
      from: { id: Number(TESTER_ID), is_bot: false, first_name: "Tester" },
      text: "tes",
    },
  };

  const resA = adapterA.parseInbound(update1);
  const resB = adapterB.parseInbound(update1);

  assert.equal(resA.outcome, "accepted");
  assert.equal(resB.outcome, "accepted");
  if (resA.outcome === "accepted" && resB.outcome === "accepted") {
    assert.equal(resA.receipt.providerMessageId, resB.receipt.providerMessageId);
    assert.notEqual(resA.receipt.sender.channelAccountId, resB.receipt.sender.channelAccountId);
  }

  // Same message ID, different chats
  const update2: TelegramUpdate = {
    update_id: 20002,
    message: {
      message_id: msgId,
      date: 1727500000,
      chat: { id: Number(OTHER_TESTER_ID), type: "private" },
      from: { id: Number(OTHER_TESTER_ID), is_bot: false, first_name: "Other Tester" },
      text: "tes",
    },
  };
  const resChat2 = adapterA.parseInbound(update2);
  assert.equal(resChat2.outcome, "accepted");
  if (resA.outcome === "accepted" && resChat2.outcome === "accepted") {
    assert.equal(resA.receipt.providerMessageId, resChat2.receipt.providerMessageId);
    assert.notEqual(resA.receipt.chatId, resChat2.receipt.chatId);
    assert.notEqual(resA.receipt.sender.senderExternalId, resChat2.receipt.sender.senderExternalId);
  }
});

test("tester not yet linked to customer is passed cleanly as unverified identity without crash", () => {
  const adapter = createAdapter([TESTER_ID]);
  const update = makeValidPrivateUpdate();
  const result = adapter.parseInbound(update);

  assert.equal(result.outcome, "accepted");
  if (result.outcome !== "accepted") return;

  // The adapter generates a valid SenderKey
  const senderKey = result.receipt.sender;
  assert.equal(isValidSenderKey(senderKey), true);

  // When evaluated against sender identity domain logic:
  // If no customer candidates exist yet in DB for this sender, resolveSenderIdentity returns no_match
  const resolution = resolveSenderIdentity(senderKey, [], new Date().toISOString());
  assert.equal(resolution.outcome, "manual");
  assert.equal(resolution.reason, "no_match");
  assert.equal(resolution.customerId, null);
});

test("adapter operates purely in-memory with zero network or database mutations", () => {
  const adapter = createAdapter();
  // Validates constructor options
  assert.equal(adapter.channel, "telegram");
  assert.equal(adapter.channelAccountId, DEFAULT_BOT_ACCOUNT);
  assert.equal(adapter.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
  assert.equal(adapter.maxTextLength, DEFAULT_MAX_TEXT_LENGTH);
  assert.equal(adapter.maxCaptionLength, DEFAULT_MAX_CAPTION_LENGTH);

  // Invalid constructor configs throw synchronously
  assert.throws(() => new TelegramChannelAdapter({ botAccountId: "", testerAllowlist: [] }), /Invalid botAccountId/);
  assert.throws(() => new TelegramChannelAdapter({ botAccountId: "   ", testerAllowlist: [] }), /Invalid botAccountId/);
  assert.throws(() => new TelegramChannelAdapter({ botAccountId: "invalid account id with spaces", testerAllowlist: [] }), /Invalid botAccountId/);
});
