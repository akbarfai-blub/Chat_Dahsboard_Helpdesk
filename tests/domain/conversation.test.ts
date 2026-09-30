import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_INACTIVITY_THRESHOLD_MS,
  evaluateConversationGrouping,
  isWithinInactivityWindow,
  type ConversationCandidate,
} from "../../lib/domain/conversation";

test("Conversation Grouping Domain Tests", async (t) => {
  const baseTime = new Date("2026-09-29T10:00:00.000Z");

  await t.test("1. First message creates conversation with identical startedAt and lastActivityAt", () => {
    const result = evaluateConversationGrouping({
      messageReceivedAt: baseTime.toISOString(),
      existingConversations: [],
    });

    assert.equal(result.action, "create");
    assert.equal(result.startedAt, baseTime.toISOString());
    assert.equal(result.lastActivityAt, baseTime.toISOString());
  });

  await t.test("2. Message with gap < 24h joins same conversation and updates lastActivityAt", () => {
    const existing: ConversationCandidate = {
      id: "conv-1",
      startedAt: baseTime.toISOString(),
      lastActivityAt: baseTime.toISOString(),
    };

    // 2 hours later
    const twoHoursLater = new Date(baseTime.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const result = evaluateConversationGrouping({
      messageReceivedAt: twoHoursLater,
      existingConversations: [existing],
    });

    assert.equal(result.action, "join");
    if (result.action === "join") {
      assert.equal(result.conversationId, "conv-1");
      assert.equal(result.updatedLastActivityAt, twoHoursLater);
      assert.equal(result.updatedStartedAt, undefined);
    }
  });

  await t.test("3. Message with gap 23h 59m 59s (< 24h) joins same conversation", () => {
    const existing: ConversationCandidate = {
      id: "conv-1",
      startedAt: baseTime.toISOString(),
      lastActivityAt: baseTime.toISOString(),
    };

    const justUnder24h = new Date(baseTime.getTime() + (24 * 60 * 60 * 1000 - 1000)).toISOString();
    const result = evaluateConversationGrouping({
      messageReceivedAt: justUnder24h,
      existingConversations: [existing],
    });

    assert.equal(result.action, "join");
    if (result.action === "join") {
      assert.equal(result.conversationId, "conv-1");
      assert.equal(result.updatedLastActivityAt, justUnder24h);
    }
  });

  await t.test("4. Message with gap EXACTLY 24h (86,400,000 ms) creates a new conversation", () => {
    const existing: ConversationCandidate = {
      id: "conv-1",
      startedAt: baseTime.toISOString(),
      lastActivityAt: baseTime.toISOString(),
    };

    const exactly24h = new Date(baseTime.getTime() + CONVERSATION_INACTIVITY_THRESHOLD_MS).toISOString();
    const result = evaluateConversationGrouping({
      messageReceivedAt: exactly24h,
      existingConversations: [existing],
    });

    assert.equal(result.action, "create");
    assert.equal(result.startedAt, exactly24h);
    assert.equal(result.lastActivityAt, exactly24h);
  });

  await t.test("5. Message with gap > 24h creates a new conversation", () => {
    const existing: ConversationCandidate = {
      id: "conv-1",
      startedAt: baseTime.toISOString(),
      lastActivityAt: baseTime.toISOString(),
    };

    const twentySixHoursLater = new Date(baseTime.getTime() + 26 * 60 * 60 * 1000).toISOString();
    const result = evaluateConversationGrouping({
      messageReceivedAt: twentySixHoursLater,
      existingConversations: [existing],
    });

    assert.equal(result.action, "create");
    assert.equal(result.startedAt, twentySixHoursLater);
    assert.equal(result.lastActivityAt, twentySixHoursLater);
  });

  await t.test("6. Inactivity is sliding: multiple messages keep extending conversation beyond 24h total duration", () => {
    // Day 1, 10:00 (startedAt: 10:00, lastActivityAt: 10:00)
    let conv: ConversationCandidate = {
      id: "conv-1",
      startedAt: baseTime.toISOString(),
      lastActivityAt: baseTime.toISOString(),
    };

    // Day 1, 20:00 (+10h, <24h gap from 10:00 -> joins)
    const t1 = new Date(baseTime.getTime() + 10 * 60 * 60 * 1000).toISOString();
    let res = evaluateConversationGrouping({
      messageReceivedAt: t1,
      existingConversations: [conv],
    });
    assert.equal(res.action, "join");
    conv = { ...conv, lastActivityAt: t1 };

    // Day 2, 08:00 (+12h gap from 20:00, total 22h from start -> joins)
    const t2 = new Date(baseTime.getTime() + 22 * 60 * 60 * 1000).toISOString();
    res = evaluateConversationGrouping({
      messageReceivedAt: t2,
      existingConversations: [conv],
    });
    assert.equal(res.action, "join");
    conv = { ...conv, lastActivityAt: t2 };

    // Day 2, 22:00 (+14h gap from Day 2 08:00, but total 36h from start! -> joins because sliding inactivity < 24h)
    const t3 = new Date(baseTime.getTime() + 36 * 60 * 60 * 1000).toISOString();
    res = evaluateConversationGrouping({
      messageReceivedAt: t3,
      existingConversations: [conv],
    });
    assert.equal(res.action, "join");
    assert.equal((res as { updatedLastActivityAt: string }).updatedLastActivityAt, t3);
    conv = { ...conv, lastActivityAt: t3 };

    // Day 4, 00:00 (+26h gap from Day 2 22:00, gap >= 24h -> creates NEW conversation)
    const t4 = new Date(baseTime.getTime() + 62 * 60 * 60 * 1000).toISOString();
    res = evaluateConversationGrouping({
      messageReceivedAt: t4,
      existingConversations: [conv],
    });
    assert.equal(res.action, "create");
    assert.equal(res.startedAt, t4);
  });

  await t.test("7. Out-of-order earlier message (< 24h before startedAt) joins and updates startedAt", () => {
    // Message M2 processed first at 12:00
    const m2Time = new Date(baseTime.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const conv: ConversationCandidate = {
      id: "conv-1",
      startedAt: m2Time,
      lastActivityAt: m2Time,
    };

    // Message M1 processed later at 10:00 (2h before M2)
    const result = evaluateConversationGrouping({
      messageReceivedAt: baseTime.toISOString(),
      existingConversations: [conv],
    });

    assert.equal(result.action, "join");
    if (result.action === "join") {
      assert.equal(result.conversationId, "conv-1");
      assert.equal(result.updatedStartedAt, baseTime.toISOString());
      assert.equal(result.updatedLastActivityAt, undefined);
    }
  });

  await t.test("8. Message received within existing span [startedAt, lastActivityAt] joins without shifting boundaries", () => {
    const tStart = baseTime.toISOString();
    const tEnd = new Date(baseTime.getTime() + 4 * 60 * 60 * 1000).toISOString();
    const tMid = new Date(baseTime.getTime() + 2 * 60 * 60 * 1000).toISOString();

    const conv: ConversationCandidate = {
      id: "conv-1",
      startedAt: tStart,
      lastActivityAt: tEnd,
    };

    const result = evaluateConversationGrouping({
      messageReceivedAt: tMid,
      existingConversations: [conv],
    });

    assert.equal(result.action, "join");
    if (result.action === "join") {
      assert.equal(result.conversationId, "conv-1");
      assert.equal(result.updatedStartedAt, undefined);
      assert.equal(result.updatedLastActivityAt, undefined);
    }
  });

  await t.test("9. isWithinInactivityWindow accurately evaluates timestamps", () => {
    const t1 = "2026-09-29T10:00:00.000Z";
    const t2 = "2026-09-30T09:59:59.000Z"; // 23h 59m 59s
    const t3 = "2026-09-30T10:00:00.000Z"; // 24h
    const t4 = "2026-09-30T10:00:01.000Z"; // 24h 1s

    assert.equal(isWithinInactivityWindow(t1, t2), true);
    assert.equal(isWithinInactivityWindow(t1, t3), false); // exactly 24h is false
    assert.equal(isWithinInactivityWindow(t1, t4), false);
    assert.equal(isWithinInactivityWindow(t2, t1), true); // symmetric
  });

  await t.test("10. Throws error on unparseable date", () => {
    assert.throws(() => {
      evaluateConversationGrouping({
        messageReceivedAt: "invalid-date",
        existingConversations: [],
      });
    }, /Invalid messageReceivedAt/);
  });

  await t.test("11. Bridging two conversations (0h and 40h joined by 20h) triggers merge action", () => {
    const t0 = baseTime.toISOString();
    const t20 = new Date(baseTime.getTime() + 20 * 60 * 60 * 1000).toISOString();
    const t40 = new Date(baseTime.getTime() + 40 * 60 * 60 * 1000).toISOString();

    const conv0: ConversationCandidate = {
      id: "conv-0",
      startedAt: t0,
      lastActivityAt: t0,
    };
    const conv40: ConversationCandidate = {
      id: "conv-40",
      startedAt: t40,
      lastActivityAt: t40,
    };

    const result = evaluateConversationGrouping({
      messageReceivedAt: t20,
      existingConversations: [conv0, conv40],
    });

    assert.equal(result.action, "merge");
    if (result.action === "merge") {
      assert.equal(result.survivingConversationId, "conv-0");
      assert.deepEqual(result.absorbedConversationIds, ["conv-40"]);
      assert.equal(result.startedAt, t0);
      assert.equal(result.lastActivityAt, t40);
      assert.equal(result.shouldBeActive, true);
    }
  });

  await t.test("12. Historical isolated message (>24h prior) creates closed conversation without usurping active status", () => {
    const t0 = baseTime.toISOString();
    const t40 = new Date(baseTime.getTime() + 40 * 60 * 60 * 1000).toISOString();

    const convLatest: ConversationCandidate = {
      id: "conv-latest",
      startedAt: t40,
      lastActivityAt: t40,
    };

    // Message 0h processed late (gap 40h >= 24h)
    const result = evaluateConversationGrouping({
      messageReceivedAt: t0,
      existingConversations: [convLatest],
    });

    assert.equal(result.action, "create");
    assert.equal(result.startedAt, t0);
    assert.equal(result.lastActivityAt, t0);
    assert.equal(result.shouldBeActive, false, "Historical message must not become active");
  });

  await t.test("13. Historical message joining earlier conversation does not usurp active status of later conversation", () => {
    const t0 = baseTime.toISOString();
    const t10 = new Date(baseTime.getTime() + 10 * 60 * 60 * 1000).toISOString();
    const t50 = new Date(baseTime.getTime() + 50 * 60 * 60 * 1000).toISOString();

    const convEarly: ConversationCandidate = {
      id: "conv-early",
      startedAt: t0,
      lastActivityAt: t0,
    };
    const convLatest: ConversationCandidate = {
      id: "conv-latest",
      startedAt: t50,
      lastActivityAt: t50,
    };

    // Message at 10h arrives (connects to convEarly < 24h, but convLatest exists at 50h)
    const result = evaluateConversationGrouping({
      messageReceivedAt: t10,
      existingConversations: [convEarly, convLatest],
    });

    assert.equal(result.action, "join");
    if (result.action === "join") {
      assert.equal(result.conversationId, "conv-early");
      assert.equal(result.updatedLastActivityAt, t10);
      assert.equal(result.shouldBeActive, false, "Joined early conversation must not usurp active status");
    }
  });

  await t.test("14. Exact 24h boundary bridge (0h and 24h bridged by 12h) merges cleanly", () => {
    const t0 = baseTime.toISOString();
    const t12 = new Date(baseTime.getTime() + 12 * 60 * 60 * 1000).toISOString();
    const t24 = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const conv0: ConversationCandidate = {
      id: "conv-0",
      startedAt: t0,
      lastActivityAt: t0,
    };
    const conv24: ConversationCandidate = {
      id: "conv-24",
      startedAt: t24,
      lastActivityAt: t24,
    };

    const result = evaluateConversationGrouping({
      messageReceivedAt: t12,
      existingConversations: [conv0, conv24],
    });

    assert.equal(result.action, "merge");
    if (result.action === "merge") {
      assert.equal(result.survivingConversationId, "conv-0");
      assert.deepEqual(result.absorbedConversationIds, ["conv-24"]);
      assert.equal(result.startedAt, t0);
      assert.equal(result.lastActivityAt, t24);
      assert.equal(result.shouldBeActive, true);
    }
  });

  await t.test("15. Bridging older conversations when a newer conversation exists remains closed", () => {
    const t0 = baseTime.toISOString();
    const t10 = new Date(baseTime.getTime() + 10 * 60 * 60 * 1000).toISOString();
    const t20 = new Date(baseTime.getTime() + 20 * 60 * 60 * 1000).toISOString();
    const t100 = new Date(baseTime.getTime() + 100 * 60 * 60 * 1000).toISOString();

    const conv0: ConversationCandidate = {
      id: "conv-0",
      startedAt: t0,
      lastActivityAt: t0,
    };
    const conv20: ConversationCandidate = {
      id: "conv-20",
      startedAt: t20,
      lastActivityAt: t20,
    };
    const convLatest: ConversationCandidate = {
      id: "conv-latest",
      startedAt: t100,
      lastActivityAt: t100,
    };

    const result = evaluateConversationGrouping({
      messageReceivedAt: t10,
      existingConversations: [conv0, conv20, convLatest],
    });

    assert.equal(result.action, "merge");
    if (result.action === "merge") {
      assert.equal(result.survivingConversationId, "conv-0");
      assert.deepEqual(result.absorbedConversationIds, ["conv-20"]);
      assert.equal(result.shouldBeActive, false, "Merged past conversation must remain closed since convLatest is active");
    }
  });
});
