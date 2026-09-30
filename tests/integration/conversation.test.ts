import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { inHelpdeskTransaction } from "../../lib/postgres/transaction";
import type { InboundReceipt } from "../../lib/application/persistence-contracts";

test("P2.3 24-hour conversation grouping, history association and episode decoupling", async (t) => {
  const url = process.env.HELPDESK_TEST_DATABASE_URL;
  assert.ok(url, "Set HELPDESK_TEST_DATABASE_URL to the migrated local Supabase database");
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
    "Local database only",
  );

  const pool = new Pool({ connectionString: url, max: 8 });
  const persistence = new HelpdeskPersistence(pool);
  const tag = "p23-" + randomUUID().slice(0, 8);
  const botAccountId = "bot-" + tag;
  const testerChatId = "99001122";
  const otherChatId = "99003344";

  function makeReceipt(
    senderId: string,
    messageId: string,
    text: string,
    meta: InboundReceipt["metadata"] = {},
    accountId = botAccountId,
    chatId = senderId,
  ): InboundReceipt {
    return {
      sender: {
        channel: "telegram",
        channelAccountId: accountId,
        senderExternalId: senderId,
      },
      chatId,
      providerMessageId: messageId,
      text,
      metadata: meta,
    };
  }

  try {
    // 1. First message creates conversation
    let convId1: string;
    const baseTime = new Date("2026-09-29T10:00:00.000Z");

    await t.test("first message creates a new conversation with accurate metadata", async () => {
      const receipt1 = makeReceipt(testerChatId, "101", "Internet rumah mati lampu LOS merah");
      const ingress1 = await persistence.receive(receipt1);
      assert.equal(ingress1.duplicate, false);

      // Set explicit received_at to anchor the test timeline
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        baseTime.toISOString(),
        ingress1.ingressId,
      ]);

      const process1 = await persistence.process(ingress1.ingressId);
      assert.ok(process1.conversationId, "conversationId must be returned in ProcessingResult");
      convId1 = process1.conversationId;

      // Verify conversation snapshot
      const conv = await persistence.getConversation(convId1);
      assert.ok(conv, "Conversation record must exist");
      assert.equal(conv.id, convId1);
      assert.equal(conv.channel, "telegram");
      assert.equal(conv.accountId, botAccountId);
      assert.equal(conv.chatId, testerChatId);
      assert.equal(conv.status, "active");
      const history1 = await persistence.getConversationHistory(convId1);
      assert.equal(history1.length, 1);
      assert.equal(new Date(conv.startedAt).toISOString(), baseTime.toISOString());
      assert.equal(new Date(conv.lastActivityAt).toISOString(), baseTime.toISOString());

      // Verify message table link
      const msgRow = (
        await pool.query("select conversation_id from public.messages where id=$1", [
          ingress1.ingressId,
        ])
      ).rows[0];
      assert.equal(msgRow.conversation_id, convId1);
    });

    // 2. Gap < 24 hours joins the same conversation and advances last_activity_at
    await t.test("message with gap < 24h joins existing conversation and updates last_activity_at", async () => {
      const time2 = new Date(baseTime.getTime() + 2 * 3600 * 1000); // +2 hours
      const receipt2 = makeReceipt(testerChatId, "102", "Masih merah lampunya kak");
      const ingress2 = await persistence.receive(receipt2);

      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        time2.toISOString(),
        ingress2.ingressId,
      ]);

      const process2 = await persistence.process(ingress2.ingressId);
      assert.equal(process2.conversationId, convId1, "Must join existing conversation");

      const conv = await persistence.getConversation(convId1);
      assert.ok(conv);
      const history2 = await persistence.getConversationHistory(convId1);
      assert.equal(history2.length, 2);
      assert.equal(new Date(conv.startedAt).toISOString(), baseTime.toISOString());
      assert.equal(new Date(conv.lastActivityAt).toISOString(), time2.toISOString());
    });

    // 3. Sliding window: Inactivity is calculated from last relevant activity, not conversation creation
    await t.test("sliding window: message after 26h from start but 24h-ε from last activity joins same conversation", async () => {
      // Last activity was at baseTime + 2h.
      // Next message is at baseTime + 20h. Total age is 20h from start, 18h from last activity (< 24h).
      const time3 = new Date(baseTime.getTime() + 20 * 3600 * 1000); // +20h from base
      const receipt3 = makeReceipt(testerChatId, "103", "Sudah 20 jam belum nyala");
      const ingress3 = await persistence.receive(receipt3);

      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        time3.toISOString(),
        ingress3.ingressId,
      ]);

      const process3 = await persistence.process(ingress3.ingressId);
      assert.equal(process3.conversationId, convId1, "Must join existing conversation");

      // Now message 4 at baseTime + 38h:
      // Total age is 38h from start (> 24h!), but gap from message 3 is 18h (< 24h!).
      const time4 = new Date(baseTime.getTime() + 38 * 3600 * 1000); // +38h from base, +18h from time3
      const receipt4 = makeReceipt(testerChatId, "104", "Total 38 jam, gap dari pesan 3 hanya 18 jam");
      const ingress4 = await persistence.receive(receipt4);

      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        time4.toISOString(),
        ingress4.ingressId,
      ]);

      const process4 = await persistence.process(ingress4.ingressId);
      assert.equal(
        process4.conversationId,
        convId1,
        "Sliding window: gap < 24h from last activity joins same conversation despite age > 24h",
      );

      const conv = await persistence.getConversation(convId1);
      assert.ok(conv);
      const history4 = await persistence.getConversationHistory(convId1);
      assert.equal(history4.length, 4);
      assert.equal(new Date(conv.lastActivityAt).toISOString(), time4.toISOString());
    });

    // 4. Gap >= 24 hours triggers a new conversation and closes previous
    let convId2: string;
    await t.test("gap >= 24 hours triggers new conversation and marks previous inactive/closed", async () => {
      // Last activity was at baseTime + 38h.
      // Gap exactly 24 hours + 1 minute: baseTime + 62h + 1m
      const time5 = new Date(baseTime.getTime() + (38 + 24) * 3600 * 1000 + 60 * 1000);
      const receipt5 = makeReceipt(testerChatId, "105", "Halo ini laporan baru setelah 24 jam lewat");
      const ingress5 = await persistence.receive(receipt5);

      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        time5.toISOString(),
        ingress5.ingressId,
      ]);

      const process5 = await persistence.process(ingress5.ingressId);
      assert.notEqual(process5.conversationId, convId1, "Must create a new conversation");
      convId2 = process5.conversationId!;

      // Verify old conversation is now closed
      const oldConv = await persistence.getConversation(convId1);
      assert.ok(oldConv);
      assert.equal(oldConv.status, "closed");

      // Verify new conversation is active with messageCount = 1
      const newConv = await persistence.getConversation(convId2);
      assert.ok(newConv);
      assert.equal(newConv.status, "active");
      const historyNew = await persistence.getConversationHistory(convId2);
      assert.equal(historyNew.length, 1);
      assert.equal(new Date(newConv.startedAt).toISOString(), time5.toISOString());
      assert.equal(new Date(newConv.lastActivityAt).toISOString(), time5.toISOString());
    });

    // 5. Exactly 24 hours boundary condition
    await t.test("gap exactly equal to 24h triggers new conversation per documented default", async () => {
      // Last activity of convId2 is at time5.
      // Send message at exactly time5 + 24 hours (86_400_000 ms)
      const conv2 = await persistence.getConversation(convId2);
      assert.ok(conv2);
      const exact24hTime = new Date(new Date(conv2.lastActivityAt).getTime() + 86_400_000);

      const receiptExact = makeReceipt(testerChatId, "106", "Pesan tepat 24 jam setelah pesan 105");
      const ingressExact = await persistence.receive(receiptExact);

      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        exact24hTime.toISOString(),
        ingressExact.ingressId,
      ]);

      const processExact = await persistence.process(ingressExact.ingressId);
      assert.notEqual(processExact.conversationId, convId2, "Exact 24h gap triggers new conversation");
    });

    // 6. Duplicate / retry does not duplicate conversation or alter activity timestamps
    await t.test("duplicate or repeated process() call is idempotent and does not alter conversation", async () => {
      const convBefore = await persistence.getConversation(convId2);
      assert.ok(convBefore);

      // Query ingress 5 (which created convId2)
      const ingress5Id = (
        await pool.query("select id from public.ingress_events where provider_message_id='105' and account_id=$1", [
          botAccountId,
        ])
      ).rows[0].id;

      // Call process() again on ingress 5
      const processAgain = await persistence.process(ingress5Id);
      assert.equal(processAgain.conversationId, convId2);

      const historyBefore = await persistence.getConversationHistory(convId2);
      const convAfter = await persistence.getConversation(convId2);
      assert.ok(convAfter);
      const historyAfter = await persistence.getConversationHistory(convId2);
      assert.equal(historyAfter.length, historyBefore.length);
      assert.equal(convAfter.lastActivityAt, convBefore.lastActivityAt);
    });

    // 7. Channel / Account / Chat and Identity isolation
    await t.test("messages on different chat_id or account_id remain strictly isolated", async () => {
      // Different chat ID on same bot account
      const receiptOtherChat = makeReceipt(otherChatId, "201", "Lapor wifi tetangga");
      const ingressOtherChat = await persistence.receive(receiptOtherChat);
      const processOtherChat = await persistence.process(ingressOtherChat.ingressId);

      assert.ok(processOtherChat.conversationId);
      assert.notEqual(processOtherChat.conversationId, convId1);
      assert.notEqual(processOtherChat.conversationId, convId2);

      const convOtherChat = await persistence.getConversation(processOtherChat.conversationId!);
      assert.ok(convOtherChat);
      assert.equal(convOtherChat.chatId, otherChatId);
      assert.equal(convOtherChat.accountId, botAccountId);

      // Different bot account on same chat ID
      const otherBotAccount = "other-bot-" + tag;
      const receiptOtherBot = makeReceipt(testerChatId, "301", "Lapor di bot kedua", {}, otherBotAccount);
      const ingressOtherBot = await persistence.receive(receiptOtherBot);
      const processOtherBot = await persistence.process(ingressOtherBot.ingressId);

      assert.ok(processOtherBot.conversationId);
      assert.notEqual(processOtherBot.conversationId, convId1);
      assert.notEqual(processOtherBot.conversationId, convOtherChat.id);

      const convOtherBot = await persistence.getConversation(processOtherBot.conversationId!);
      assert.ok(convOtherBot);
      assert.equal(convOtherBot.accountId, otherBotAccount);
      assert.equal(convOtherBot.chatId, testerChatId);
    });

    await t.test("distinct identities on the same channel, account, and chat remain strictly isolated", async () => {
      const sharedChatId = "shared-group-" + tag;
      const tBase = new Date("2026-09-29T12:00:00.000Z");

      // User 1 in shared group
      const recUser1 = makeReceipt("user-01-" + tag, "u1-01", "Halo dari user 1", {}, botAccountId, sharedChatId);
      const ingUser1 = await persistence.receive(recUser1);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [tBase.toISOString(), ingUser1.ingressId]);
      const resUser1 = await persistence.process(ingUser1.ingressId);

      // User 2 in same shared group (2 hours later)
      const recUser2 = makeReceipt("user-02-" + tag, "u2-01", "Halo dari user 2", {}, botAccountId, sharedChatId);
      const ingUser2 = await persistence.receive(recUser2);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tBase.getTime() + 2 * 3600 * 1000).toISOString(),
        ingUser2.ingressId,
      ]);
      const resUser2 = await persistence.process(ingUser2.ingressId);

      // Must NOT join user 1's conversation despite same chat and gap < 24h
      assert.notEqual(resUser1.conversationId, resUser2.conversationId, "Different identity_id must create separate conversations");

      const conv1 = await persistence.getConversation(resUser1.conversationId!);
      const conv2 = await persistence.getConversation(resUser2.conversationId!);
      assert.ok(conv1);
      assert.ok(conv2);
      assert.notEqual(conv1.identityId, conv2.identityId);
      assert.equal(conv1.chatId, sharedChatId);
      assert.equal(conv2.chatId, sharedChatId);
      // Both conversations remain active for their respective identities
      assert.equal(conv1.status, "active");
      assert.equal(conv2.status, "active");

      // User 1 sends another message: joins conv1, not conv2
      const recUser1Second = makeReceipt("user-01-" + tag, "u1-02", "Pesan kedua user 1", {}, botAccountId, sharedChatId);
      const ingUser1Second = await persistence.receive(recUser1Second);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tBase.getTime() + 3 * 3600 * 1000).toISOString(),
        ingUser1Second.ingressId,
      ]);
      const resUser1Second = await persistence.process(ingUser1Second.ingressId);
      assert.equal(resUser1Second.conversationId, resUser1.conversationId);

      // User 2 sends another message: joins conv2, not conv1
      const recUser2Second = makeReceipt("user-02-" + tag, "u2-02", "Pesan kedua user 2", {}, botAccountId, sharedChatId);
      const ingUser2Second = await persistence.receive(recUser2Second);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tBase.getTime() + 4 * 3600 * 1000).toISOString(),
        ingUser2Second.ingressId,
      ]);
      const resUser2Second = await persistence.process(ingUser2Second.ingressId);
      assert.equal(resUser2Second.conversationId, resUser2.conversationId);

      // Histories are strictly isolated
      const hist1 = await persistence.getConversationHistory(resUser1.conversationId!);
      const hist2 = await persistence.getConversationHistory(resUser2.conversationId!);
      assert.equal(hist1.length, 2);
      assert.equal(hist2.length, 2);
      assert.equal(hist1[0].body, "Halo dari user 1");
      assert.equal(hist2[0].body, "Halo dari user 2");
    });

    // 8. Multiple processing order permutations for 0h, 20h, 40h dataset
    const runPermutation = async (orderName: string, orderIndices: [number, number, number]) => {
      const permChatId = `perm-${orderName}-${tag}`;
      const t0 = new Date("2026-09-29T00:00:00.000Z");
      const t20 = new Date(t0.getTime() + 20 * 3600 * 1000);
      const t40 = new Date(t0.getTime() + 40 * 3600 * 1000);

      const receipts = [
        makeReceipt(permChatId, `p0-${orderName}`, "Pesan jam 0"),
        makeReceipt(permChatId, `p20-${orderName}`, "Pesan jam 20 penghubung"),
        makeReceipt(permChatId, `p40-${orderName}`, "Pesan jam 40"),
      ];
      const times = [t0, t20, t40];

      const ingressIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const ing = await persistence.receive(receipts[i]);
        await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
          times[i].toISOString(),
          ing.ingressId,
        ]);
        ingressIds.push(ing.ingressId);
      }

      // Process in specified order
      for (const idx of orderIndices) {
        await persistence.process(ingressIds[idx]);
      }

      // Assert final state
      const conversations = await pool.query<{
        id: string;
        status: string;
        started_at: Date;
        last_activity_at: Date;
      }>(
        "select id, status, started_at, last_activity_at from public.conversations where chat_id=$1 and account_id=$2",
        [permChatId, botAccountId],
      );
      assert.equal(conversations.rows.length, 1, `Order ${orderName} must resolve to exactly 1 conversation`);
      const conv = conversations.rows[0];
      assert.equal(conv.status, "active", `Order ${orderName} final conversation must be active`);
      assert.equal(conv.started_at.toISOString(), t0.toISOString(), `Order ${orderName} startedAt must be 0h`);
      assert.equal(conv.last_activity_at.toISOString(), t40.toISOString(), `Order ${orderName} lastActivityAt must be 40h`);

      // Verify all 3 messages are associated to this surviving conversation
      const history = await persistence.getConversationHistory(conv.id);
      assert.equal(history.length, 3, `Order ${orderName} must have all 3 messages in history`);
      assert.equal(history[0].body, "Pesan jam 0");
      assert.equal(history[1].body, "Pesan jam 20 penghubung");
      assert.equal(history[2].body, "Pesan jam 40");

      // Verify messages table
      const msgCheck = await pool.query<{ id: string; conversation_id: string }>(
        "select id, conversation_id from public.messages where id = any($1)",
        [ingressIds],
      );
      assert.equal(msgCheck.rows.length, 3);
      for (const row of msgCheck.rows) {
        assert.equal(row.conversation_id, conv.id, `Order ${orderName} message ${row.id} must point to surviving conversation`);
      }

      // Verify triage assessments stored processing_result->>'conversationId'
      const assessCheck = await pool.query<{ processing_result: { conversationId: string } }>(
        "select processing_result from public.triage_assessments where message_id = any($1)",
        [ingressIds],
      );
      assert.equal(assessCheck.rows.length, 3);
      for (const row of assessCheck.rows) {
        assert.equal(row.processing_result.conversationId, conv.id, `Order ${orderName} assessment must reflect merged conversationId`);
      }

      // Verify retry idempotency: re-calling process on each ingress returns surviving conversationId
      for (let i = 0; i < 3; i++) {
        const retryResult = await persistence.process(ingressIds[i]);
        assert.equal(retryResult.conversationId, conv.id, `Retry on ingress ${i} must return surviving conversationId`);
      }
    };

    await t.test("permutation 0 -> 20 -> 40 resolves to single active conversation", async () => {
      await runPermutation("0-20-40", [0, 1, 2]);
    });

    await t.test("permutation 0 -> 40 -> 20 (bridging/merge) resolves to single active conversation", async () => {
      await runPermutation("0-40-20", [0, 2, 1]);
    });

    await t.test("permutation 40 -> 20 -> 0 (reverse arrival) resolves to single active conversation", async () => {
      await runPermutation("40-20-0", [2, 1, 0]);
    });

    // 9. Historical message handling (sliding inactive window & isolation)
    await t.test("historical message arriving late does not become active or close the newer conversation", async () => {
      const histChatId = "hist-" + tag;
      const t0 = new Date("2026-09-29T00:00:00.000Z");
      const t10 = new Date(t0.getTime() + 10 * 3600 * 1000);
      const t50 = new Date(t0.getTime() + 50 * 3600 * 1000); // 50h later (new conversation)

      // 1. Process 0h
      const rec0 = makeReceipt(histChatId, "h-00", "Pesan awal jam 0");
      const ing0 = await persistence.receive(rec0);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t0.toISOString(), ing0.ingressId]);
      const res0 = await persistence.process(ing0.ingressId);

      // 2. Process 50h (gap 50h >= 24h -> creates new active conversation, closes conv 0)
      const rec50 = makeReceipt(histChatId, "h-50", "Pesan baru jam 50");
      const ing50 = await persistence.receive(rec50);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t50.toISOString(), ing50.ingressId]);
      const res50 = await persistence.process(ing50.ingressId);

      assert.notEqual(res50.conversationId, res0.conversationId);
      const conv0Before = await persistence.getConversation(res0.conversationId!);
      const conv50Before = await persistence.getConversation(res50.conversationId!);
      assert.equal(conv0Before?.status, "closed");
      assert.equal(conv50Before?.status, "active");

      // 3. Process historical message 10h (connects to conv0 < 24h, but gap to conv50 is 40h >= 24h)
      const rec10 = makeReceipt(histChatId, "h-10", "Pesan susulan jam 10");
      const ing10 = await persistence.receive(rec10);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t10.toISOString(), ing10.ingressId]);
      const res10 = await persistence.process(ing10.ingressId);

      assert.equal(res10.conversationId, res0.conversationId, "Must join early conversation");

      // conv 0 updated last_activity_at to 10h, BUT MUST REMAIN CLOSED!
      const conv0After = await persistence.getConversation(res0.conversationId!);
      assert.equal(conv0After?.lastActivityAt, t10.toISOString());
      assert.equal(conv0After?.status, "closed", "Early conversation must remain closed");

      // conv 50 MUST REMAIN ACTIVE! Not closed by the historical message!
      const conv50After = await persistence.getConversation(res50.conversationId!);
      assert.equal(conv50After?.status, "active", "Latest conversation must remain active");

      // 4. Isolated historical message at 70h in a different chat, then 0h processed late
      const isoChatId = "iso-" + tag;
      const recLate = makeReceipt(isoChatId, "iso-70", "Pesan jam 70");
      const ingLate = await persistence.receive(recLate);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(t0.getTime() + 70 * 3600 * 1000).toISOString(),
        ingLate.ingressId,
      ]);
      const resLate = await persistence.process(ingLate.ingressId);
      assert.equal((await persistence.getConversation(resLate.conversationId!))?.status, "active");

      // Process 0h (isolated, gap 70h >= 24h)
      const recEarlyIso = makeReceipt(isoChatId, "iso-00", "Pesan terisolasi jam 0");
      const ingEarlyIso = await persistence.receive(recEarlyIso);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t0.toISOString(), ingEarlyIso.ingressId]);
      const resEarlyIso = await persistence.process(ingEarlyIso.ingressId);

      assert.notEqual(resEarlyIso.conversationId, resLate.conversationId);
      // New conversation created for 0h, but must be created with status 'closed'!
      const convEarlyIso = await persistence.getConversation(resEarlyIso.conversationId!);
      assert.equal(convEarlyIso?.status, "closed", "Isolated historical conversation must be created closed");
      // Later conversation at 70h must STILL be 'active'!
      const convLateAfter = await persistence.getConversation(resLate.conversationId!);
      assert.equal(convLateAfter?.status, "active", "Active conversation must not be closed by isolated historical message");
    });

    // 10. Exact 24h boundary bridge
    await t.test("exact 24h boundary bridged by late message merges into single active conversation", async () => {
      const bridgeChatId = "bridge-exact-" + tag;
      const t0 = new Date("2026-09-29T00:00:00.000Z");
      const t12 = new Date(t0.getTime() + 12 * 3600 * 1000);
      const t24 = new Date(t0.getTime() + 24 * 3600 * 1000); // exactly 86,400,000 ms

      // 1. Process 0h
      const rec0 = makeReceipt(bridgeChatId, "br-0", "Pesan jam 0");
      const ing0 = await persistence.receive(rec0);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t0.toISOString(), ing0.ingressId]);
      const res0 = await persistence.process(ing0.ingressId);

      // 2. Process 24h (gap exactly 24h -> creates new conversation!)
      const rec24 = makeReceipt(bridgeChatId, "br-24", "Pesan tepat jam 24");
      const ing24 = await persistence.receive(rec24);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t24.toISOString(), ing24.ingressId]);
      const res24 = await persistence.process(ing24.ingressId);
      assert.notEqual(res24.conversationId, res0.conversationId, "Exact 24h creates new conversation initially");

      // 3. Process 12h (bridges 0h and 24h -> merges!)
      const rec12 = makeReceipt(bridgeChatId, "br-12", "Pesan jam 12 penengah");
      const ing12 = await persistence.receive(rec12);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t12.toISOString(), ing12.ingressId]);
      const res12 = await persistence.process(ing12.ingressId);

      assert.equal(res12.conversationId, res0.conversationId, "Bridged message joins surviving conversation");
      const surviving = await persistence.getConversation(res0.conversationId!);
      assert.ok(surviving);
      assert.equal(surviving.status, "active");
      assert.equal(surviving.startedAt, t0.toISOString());
      assert.equal(surviving.lastActivityAt, t24.toISOString());

      // Conv 24 is absorbed and deleted
      const absorbed = await persistence.getConversation(res24.conversationId!);
      assert.equal(absorbed, null, "Absorbed conversation must be deleted");

      const history = await persistence.getConversationHistory(res0.conversationId!);
      assert.equal(history.length, 3);
    });

    // 11. Non-complaints, /start, and media without caption are preserved in history without inventing text
    await t.test("non-complaints, /start, and caption-less media are retrievable via getConversationHistory", async () => {
      const mediaChatId = "media-" + tag;
      const tMedia = new Date("2026-09-29T15:00:00.000Z");

      // 1. /start message
      const receiptStart = makeReceipt(mediaChatId, "m-01", "/start", {
        messageType: "text",
        senderInfo: { firstName: "Budi", username: "budi99" },
      });
      const ingressStart = await persistence.receive(receiptStart);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        tMedia.toISOString(),
        ingressStart.ingressId,
      ]);
      const resStart = await persistence.process(ingressStart.ingressId);
      assert.ok(resStart.conversationId);
      assert.equal(resStart.episodeId, null, "/start must not create a complaint episode");

      // 2. Chitchat message
      const receiptChat = makeReceipt(mediaChatId, "m-02", "Selamat siang kak", {
        messageType: "text",
      });
      const ingressChat = await persistence.receive(receiptChat);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tMedia.getTime() + 60 * 1000).toISOString(),
        ingressChat.ingressId,
      ]);
      const resChat = await persistence.process(ingressChat.ingressId);
      assert.equal(resChat.conversationId, resStart.conversationId);
      assert.equal(resChat.episodeId, null);

      // 3. Photo without caption
      const receiptPhoto = makeReceipt(mediaChatId, "m-03", "", {
        messageType: "photo",
        hasMedia: true,
        caption: null,
      });
      const ingressPhoto = await persistence.receive(receiptPhoto);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tMedia.getTime() + 120 * 1000).toISOString(),
        ingressPhoto.ingressId,
      ]);
      const resPhoto = await persistence.process(ingressPhoto.ingressId);
      assert.equal(resPhoto.conversationId, resStart.conversationId);

      // Retrieve history
      const history = await persistence.getConversationHistory(resStart.conversationId!);
      assert.equal(history.length, 3);

      assert.equal(history[0].body, "/start");
      assert.equal(history[0].messageType, "text");
      assert.equal(history[0].senderInfo?.firstName, "Budi");

      assert.equal(history[1].body, "Selamat siang kak");
      assert.equal(history[1].messageType, "text");

      assert.equal(history[2].body, "");
      assert.equal(history[2].messageType, "photo");
      assert.equal(history[2].hasMedia, true);
      assert.equal(history[2].caption, null);
    });

    // 12. Conversation transition preserves existing reply_claims and outbound_intents without duplicate reservations
    await t.test("conversation transition preserves existing reply_claims and outbound_intents without duplicate reservations", async () => {
      const epChatId = "claim-preserve-" + tag;
      const tBase = new Date("2026-09-29T08:00:00.000Z");

      // Inbound 1: Connection issue -> creates Episode 1
      const rec1 = makeReceipt(epChatId, "cp-01", "Wifi mati total lampu merah los");
      const ing1 = await persistence.receive(rec1);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [tBase.toISOString(), ing1.ingressId]);
      const res1 = await persistence.process(ing1.ingressId);
      assert.ok(res1.conversationId);
      assert.ok(res1.episodeId);
      const firstEpisodeId = res1.episodeId;

      // Simulate/verify a previously used reply claim and outbound intent for this episode & owner
      const ownerRow = (
        await pool.query<{ id: string }>(
          "select id from public.reply_owners where identity_id = (select identity_id from public.ingress_events where id=$1)",
          [ing1.ingressId],
        )
      ).rows[0];
      assert.ok(ownerRow);

      let intentId = res1.claim.intentId;
      if (!intentId) {
        // If unreserved (e.g. in SHADOW), insert a synthetic message to anchor the intent & claim
        const syntheticIngressId = randomUUID();
        await pool.query(
          `insert into public.ingress_events(id, channel, account_id, chat_id, provider_message_id, body)
           values ($1, 'telegram', $2, $3, 'claim-anchor', 'claim anchor')`,
          [syntheticIngressId, botAccountId, epChatId],
        );
        await pool.query(
          `insert into public.messages(id, identity_id, conversation_id, complaint_id)
           values ($1, (select identity_id from public.ingress_events where id=$2), $3, $4)`,
          [syntheticIngressId, ing1.ingressId, res1.conversationId, firstEpisodeId],
        );
        const intentRow = (
          await pool.query<{ id: string }>(
            `insert into public.outbound_intents(owner_id, complaint_id, message_id, decision, status)
             values ($1, $2, $3, '{}'::jsonb, 'pending') returning id`,
            [ownerRow.id, firstEpisodeId, syntheticIngressId],
          )
        ).rows[0];
        intentId = intentRow.id;
        await pool.query(
          `insert into public.reply_claims(owner_id, scope_kind, scope_id, complaint_id, outbound_intent_id)
           values ($1, 'episode', $2, $2, $3)`,
          [ownerRow.id, firstEpisodeId, intentId],
        );
      }

      // Verify exactly 1 claim and 1 outbound intent exist in DB
      const claimsBefore = await pool.query<{ count: string }>(
        "select count(*) from public.reply_claims where complaint_id = $1",
        [firstEpisodeId],
      );
      assert.equal(claimsBefore.rows[0].count, "1");

      const intentsBefore = await pool.query<{ count: string }>(
        "select count(*) from public.outbound_intents where complaint_id = $1",
        [firstEpisodeId],
      );
      assert.equal(intentsBefore.rows[0].count, "1");

      // Inbound 2: arrives 25 hours later -> triggers NEW conversation!
      const t2 = new Date(tBase.getTime() + 25 * 3600 * 1000);
      const rec2 = makeReceipt(epChatId, "cp-02", "Masih wifi mati dari kemarin lampu los");
      const ing2 = await persistence.receive(rec2);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t2.toISOString(), ing2.ingressId]);
      const res2 = await persistence.process(ing2.ingressId);

      // Assert conversation container transitioned
      assert.notEqual(res2.conversationId, res1.conversationId, "Gap > 24h creates new conversation container");

      // Assert episode is preserved
      assert.equal(res2.episodeId, firstEpisodeId, "Episode remains the same");

      // Assert claim outcome is skipped (debounce / follow-up preserved)
      assert.equal(res2.claim.outcome, "skipped");

      // Assert empirical proof directly in the database: NO extra claim, NO extra outbound intent
      const claimsAfter = await pool.query<{ count: string }>(
        "select count(*) from public.reply_claims where complaint_id = $1",
        [firstEpisodeId],
      );
      assert.equal(
        claimsAfter.rows[0].count,
        "1",
        "reply_claims count must remain strictly 1; existing claim is preserved",
      );

      const intentsAfter = await pool.query<{ count: string }>(
        "select count(*) from public.outbound_intents where complaint_id = $1",
        [firstEpisodeId],
      );
      assert.equal(
        intentsAfter.rows[0].count,
        "1",
        "outbound_intents count must remain strictly 1; no duplicate outbound intent",
      );
    });

    // 13. Controlled failure specifically at INSERT triage_assessments rolls back cleanly
    await t.test("controlled failure specifically at INSERT triage_assessments rolls back conversation and message associations, and retry succeeds idempotently", async () => {
      const failChatId = "fail-" + tag;
      const receiptFail = makeReceipt(failChatId, "f-01", "Pesan uji rollback");
      const ingressFail = await persistence.receive(receiptFail);

      let reachedInsertTriageAssessment = false;
      let failTriageInsert = true;

      const faultPool = {
        async connect() {
          const client = await pool.connect();
          const realQuery = client.query;
          const clientProxy = Object.create(client) as PoolClient;
          // @ts-expect-error proxying for targeted fault injection
          clientProxy.query = function (
            queryTextOrConfig: unknown,
            values?: unknown,
            callback?: unknown,
          ) {
            const q = typeof queryTextOrConfig === "string"
              ? queryTextOrConfig
              : (queryTextOrConfig as { text?: string })?.text ?? "";
            if (failTriageInsert && q.toLowerCase().includes("insert into public.triage_assessments")) {
              reachedInsertTriageAssessment = true;
              throw new Error("Simulated database failure during insert into triage_assessments");
            }
            // @ts-expect-error delegating with exact arguments
            return realQuery.call(client, queryTextOrConfig, values, callback);
          };
          clientProxy.release = function (destroy?: boolean) {
            return client.release(destroy);
          };
          return clientProxy;
        },
        query(...args: unknown[]) {
          return (pool.query as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as Pool;

      const faultPersistence = new HelpdeskPersistence(faultPool);

      // Attempt process: must fail specifically at insert into triage_assessments
      await assert.rejects(
        async () => {
          await faultPersistence.process(ingressFail.ingressId);
        },
        /Simulated database failure during insert into triage_assessments/,
      );

      // Assert that the injection point was truly reached (after conversation & message queries/inserts)
      assert.equal(
        reachedInsertTriageAssessment,
        true,
        "Fault must be injected during INSERT into public.triage_assessments, not during initial store.processed()",
      );

      // Verify outside the completed transaction that NO conversation or message row was committed
      const msgCheck = await pool.query(
        "select count(*) from public.messages where id=$1",
        [ingressFail.ingressId],
      );
      assert.equal(msgCheck.rows[0].count, "0", "Message must be rolled back completely");

      const convCheck = await pool.query(
        "select count(*) from public.conversations where chat_id=$1 and account_id=$2",
        [failChatId, botAccountId],
      );
      assert.equal(convCheck.rows[0].count, "0", "Conversation must be rolled back completely");

      const jobCheck = await pool.query<{ status: string }>(
        "select status from public.processing_jobs where ingress_id=$1",
        [ingressFail.ingressId],
      );
      assert.equal(jobCheck.rows[0].status, "pending", "Job must remain pending so it can be retried");

      // Release fault and retry process: must succeed cleanly
      failTriageInsert = false;
      const resSuccess = await faultPersistence.process(ingressFail.ingressId);
      assert.ok(resSuccess.conversationId);

      const convAfter = await persistence.getConversation(resSuccess.conversationId!);
      assert.ok(convAfter);
      const historyFailRetry = await persistence.getConversationHistory(resSuccess.conversationId!);
      assert.equal(historyFailRetry.length, 1);

      // Prove idempotency on subsequent call
      const resIdempotent = await faultPersistence.process(ingressFail.ingressId);
      assert.equal(resIdempotent.conversationId, resSuccess.conversationId);

      // Rollback of merge/reconciliation failure
      const mergeFailChatId = "fail-merge-" + tag;
      const t0 = new Date("2026-09-29T00:00:00.000Z");
      const t40 = new Date(t0.getTime() + 40 * 3600 * 1000);
      const t20 = new Date(t0.getTime() + 20 * 3600 * 1000);

      const recM0 = makeReceipt(mergeFailChatId, "fm-0", "Pesan awal");
      const ingM0 = await persistence.receive(recM0);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t0.toISOString(), ingM0.ingressId]);
      const resM0 = await persistence.process(ingM0.ingressId);

      const recM40 = makeReceipt(mergeFailChatId, "fm-40", "Pesan 40");
      const ingM40 = await persistence.receive(recM40);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t40.toISOString(), ingM40.ingressId]);
      const resM40 = await persistence.process(ingM40.ingressId);
      assert.ok(resM40.conversationId);
      assert.notEqual(resM40.conversationId, resM0.conversationId);

      // Pre-merge Snapshot:
      // 1. Snapshot both conversations (id, started_at, last_activity_at, status, updated_at)
      const convSnapshotsBefore = (
        await pool.query<{
          id: string;
          started_at: Date;
          last_activity_at: Date;
          status: string;
          updated_at: Date;
        }>(
          "select id, started_at, last_activity_at, status, updated_at from public.conversations where chat_id=$1 and account_id=$2 order by started_at asc",
          [mergeFailChatId, botAccountId],
        )
      ).rows;
      assert.equal(convSnapshotsBefore.length, 2, "Exactly two conversations must exist prior to bridging merge");

      // 2. Snapshot message conversation_id associations
      const msgAssociationsBefore = (
        await pool.query<{ id: string; conversation_id: string }>(
          "select id, conversation_id from public.messages where id in ($1, $2) order by id asc",
          [ingM0.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.equal(msgAssociationsBefore.length, 2);
      assert.equal(msgAssociationsBefore.find((m) => m.id === ingM0.ingressId)?.conversation_id, resM0.conversationId);
      assert.equal(msgAssociationsBefore.find((m) => m.id === ingM40.ingressId)?.conversation_id, resM40.conversationId);

      // 3. Snapshot triage_assessments processing_result
      const assessmentsBefore = (
        await pool.query<{ message_id: string; processing_result: Record<string, unknown> }>(
          "select message_id, processing_result from public.triage_assessments where message_id in ($1, $2) order by message_id asc",
          [ingM0.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.equal(assessmentsBefore.length, 2);

      // Reset marker and enable targeted fault injection specifically during INSERT into public.triage_assessments
      reachedInsertTriageAssessment = false;
      failTriageInsert = true;

      const recM20 = makeReceipt(mergeFailChatId, "fm-20", "Pesan 20");
      const ingM20 = await persistence.receive(recM20);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [t20.toISOString(), ingM20.ingressId]);

      await assert.rejects(
        async () => {
          await faultPersistence.process(ingM20.ingressId);
        },
        /Simulated database failure during insert into triage_assessments/,
      );

      // Assert that failure point was truly reached during the bridging merge operation
      assert.equal(
        reachedInsertTriageAssessment,
        true,
        "Fault must be injected during INSERT into public.triage_assessments for bridging message",
      );

      // Verification outside transaction via pool.query:
      // 1. Both conversations and all snapshot fields remain exactly identical
      const convSnapshotsAfterFail = (
        await pool.query<{
          id: string;
          started_at: Date;
          last_activity_at: Date;
          status: string;
          updated_at: Date;
        }>(
          "select id, started_at, last_activity_at, status, updated_at from public.conversations where chat_id=$1 and account_id=$2 order by started_at asc",
          [mergeFailChatId, botAccountId],
        )
      ).rows;
      assert.equal(convSnapshotsAfterFail.length, 2, "Both conversations must remain intact after rollback");
      assert.deepStrictEqual(
        convSnapshotsAfterFail.map((c) => ({
          id: c.id,
          started_at: new Date(c.started_at).toISOString(),
          last_activity_at: new Date(c.last_activity_at).toISOString(),
          status: c.status,
          updated_at: new Date(c.updated_at).toISOString(),
        })),
        convSnapshotsBefore.map((c) => ({
          id: c.id,
          started_at: new Date(c.started_at).toISOString(),
          last_activity_at: new Date(c.last_activity_at).toISOString(),
          status: c.status,
          updated_at: new Date(c.updated_at).toISOString(),
        })),
        "All conversation snapshot fields (id, started_at, last_activity_at, status, updated_at) must remain untouched",
      );

      // 2. Existing message associations and triage assessment processing_results remain unchanged
      const msgAssociationsAfterFail = (
        await pool.query<{ id: string; conversation_id: string }>(
          "select id, conversation_id from public.messages where id in ($1, $2) order by id asc",
          [ingM0.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.deepStrictEqual(
        msgAssociationsAfterFail,
        msgAssociationsBefore,
        "Existing message conversation_id associations must remain completely unchanged",
      );

      const assessmentsAfterFail = (
        await pool.query<{ message_id: string; processing_result: Record<string, unknown> }>(
          "select message_id, processing_result from public.triage_assessments where message_id in ($1, $2) order by message_id asc",
          [ingM0.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.deepStrictEqual(
        assessmentsAfterFail,
        assessmentsBefore,
        "Existing triage_assessments processing_result must remain completely unchanged",
      );

      // 3. Bridging message is not committed to public.messages or triage_assessments
      const msg20Check = await pool.query(
        "select count(*) from public.messages where id=$1",
        [ingM20.ingressId],
      );
      assert.equal(msg20Check.rows[0].count, "0", "Bridging message must NOT be in public.messages after rollback");

      const assess20Check = await pool.query(
        "select count(*) from public.triage_assessments where message_id=$1",
        [ingM20.ingressId],
      );
      assert.equal(assess20Check.rows[0].count, "0", "Bridging assessment must NOT be in public.triage_assessments after rollback");

      // 4. Ingress event remains and processing job remains pending
      const ingress20Check = await pool.query(
        "select count(*) from public.ingress_events where id=$1",
        [ingM20.ingressId],
      );
      assert.equal(ingress20Check.rows[0].count, "1", "Ingress event must still exist in database");

      const job20Check = await pool.query<{ status: string }>(
        "select status from public.processing_jobs where ingress_id=$1",
        [ingM20.ingressId],
      );
      assert.equal(job20Check.rows[0].status, "pending", "Bridging processing job must remain pending");

      // Release fault and retry process: merge succeeds cleanly
      failTriageInsert = false;
      const resM20Success = await faultPersistence.process(ingM20.ingressId);
      assert.ok(resM20Success.conversationId);
      assert.equal(resM20Success.conversationId, resM0.conversationId, "Surviving conversation must be resM0");

      // Verify retry produces exactly one merged conversation with correct boundaries and status
      const convsFinal = (
        await pool.query<{
          id: string;
          status: string;
          started_at: Date;
          last_activity_at: Date;
        }>(
          "select id, status, started_at, last_activity_at from public.conversations where chat_id=$1 and account_id=$2",
          [mergeFailChatId, botAccountId],
        )
      ).rows;
      assert.equal(convsFinal.length, 1, "Retry successfully completed the merge to a single conversation");
      assert.equal(convsFinal[0].id, resM0.conversationId);
      assert.equal(convsFinal[0].status, "active");
      assert.equal(new Date(convsFinal[0].started_at).toISOString(), t0.toISOString(), "started_at must be t0");
      assert.equal(new Date(convsFinal[0].last_activity_at).toISOString(), t40.toISOString(), "last_activity_at must be t40");

      // Verify all 3 messages and all 3 assessments point to the surviving conversation
      const allMsgs = (
        await pool.query<{ id: string; conversation_id: string }>(
          "select id, conversation_id from public.messages where id in ($1, $2, $3) order by id asc",
          [ingM0.ingressId, ingM20.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.equal(allMsgs.length, 3);
      for (const m of allMsgs) {
        assert.equal(
          m.conversation_id,
          resM0.conversationId,
          `Message ${m.id} must refer to surviving conversation ${resM0.conversationId}`,
        );
      }

      const allAssessments = (
        await pool.query<{ message_id: string; processing_result: Record<string, unknown> }>(
          "select message_id, processing_result from public.triage_assessments where message_id in ($1, $2, $3) order by message_id asc",
          [ingM0.ingressId, ingM20.ingressId, ingM40.ingressId],
        )
      ).rows;
      assert.equal(allAssessments.length, 3);
      for (const a of allAssessments) {
        assert.equal(
          a.processing_result?.conversationId,
          resM0.conversationId,
          `Assessment for message ${a.message_id} must have updated conversationId ${resM0.conversationId}`,
        );
      }

      // Prove idempotency: repeating process() returns valid conversationId without duplicating rows
      const resM20Repeat = await faultPersistence.process(ingM20.ingressId);
      assert.equal(resM20Repeat.conversationId, resM0.conversationId, "Idempotent re-run must return valid conversationId");

      const msgsRepeatCheck = await pool.query(
        "select count(*) from public.messages where id=$1",
        [ingM20.ingressId],
      );
      assert.equal(msgsRepeatCheck.rows[0].count, "1", "No duplicate message row on repeat call");

      const assessRepeatCheck = await pool.query(
        "select count(*) from public.triage_assessments where message_id=$1",
        [ingM20.ingressId],
      );
      assert.equal(assessRepeatCheck.rows[0].count, "1", "No duplicate assessment row on repeat call");
    });

    // 14. Concurrency: Parallel calls on same message and parallel calls on different messages
    await t.test("parallel process() calls for identical and concurrent messages preserve conversation grouping integrity", async () => {
      const concChatId = "conc-" + tag;
      const tBase = new Date("2026-09-29T16:00:00.000Z");

      // 1. Parallel calls on the same ingress ID
      const recSame = makeReceipt(concChatId, "c-same", "Pesan konkurensi identik");
      const ingSame = await persistence.receive(recSame);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [tBase.toISOString(), ingSame.ingressId]);

      const [resSame1, resSame2] = await Promise.all([
        persistence.process(ingSame.ingressId),
        persistence.process(ingSame.ingressId),
      ]);

      assert.equal(resSame1.conversationId, resSame2.conversationId);
      assert.ok(resSame1.conversationId);

      const msgRows = await pool.query("select count(*) from public.messages where id=$1", [ingSame.ingressId]);
      assert.equal(msgRows.rows[0].count, "1", "No double message association");

      // 2. Parallel calls on two different messages in the same conversation
      const recDiffA = makeReceipt(concChatId, "c-diff-a", "Pesan konkurensi beda A");
      const recDiffB = makeReceipt(concChatId, "c-diff-b", "Pesan konkurensi beda B");
      const ingDiffA = await persistence.receive(recDiffA);
      const ingDiffB = await persistence.receive(recDiffB);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tBase.getTime() + 60 * 1000).toISOString(),
        ingDiffA.ingressId,
      ]);
      await pool.query("update public.ingress_events set received_at=$1 where id=$2", [
        new Date(tBase.getTime() + 120 * 1000).toISOString(),
        ingDiffB.ingressId,
      ]);

      const [resDiffA, resDiffB] = await Promise.all([
        persistence.process(ingDiffA.ingressId),
        persistence.process(ingDiffB.ingressId),
      ]);

      assert.equal(resDiffA.conversationId, resSame1.conversationId, "Message A joins existing conversation");
      assert.equal(resDiffB.conversationId, resSame1.conversationId, "Message B joins existing conversation");

      const convsTotal = await pool.query(
        "select count(*) from public.conversations where chat_id=$1 and account_id=$2",
        [concChatId, botAccountId],
      );
      assert.equal(convsTotal.rows[0].count, "1", "No fragmented conversations created");
    });

  } finally {
    // Teardown: Clean up only test fixtures tagged with this test run!
    // Never touch or delete real Telegram webhook messages or fixtures of other tests!
    try {
      await inHelpdeskTransaction(pool, async (db) => {
        // 1. Identify all entities created for this test tag
        const identities = (
          await db.query<{ id: string }>(
            "select id from public.channel_identities where channel_account_id like $1",
            ["%" + tag + "%"],
          )
        ).rows.map((r) => r.id);

        const ingressRows = (
          await db.query<{ id: string }>(
            "select id from public.ingress_events where account_id like $1",
            ["%" + tag + "%"],
          )
        ).rows.map((r) => r.id);

        const convRows = (
          await db.query<{ id: string }>(
            "select id from public.conversations where account_id like $1",
            ["%" + tag + "%"],
          )
        ).rows.map((r) => r.id);

        const episodes = identities.length > 0
          ? (
              await db.query<{ id: string }>(
                "select id from public.complaints where identity_id = any($1)",
                [identities],
              )
            ).rows.map((r) => r.id)
          : [];

        const owners = identities.length > 0
          ? (
              await db.query<{ id: string }>(
                "select id from public.reply_owners where identity_id = any($1)",
                [identities],
              )
            ).rows.map((r) => r.id)
          : [];

        // 2. Delete audit log
        if (episodes.length > 0 || ingressRows.length > 0) {
          await db.query(
            "delete from public.complaint_audit_log where complaint_id = any($1) or message_id = any($2)",
            [episodes, ingressRows],
          );
        }

        // 3. Delete reply claims (references owners and outbound_intents)
        if (owners.length > 0) {
          await db.query("delete from public.reply_claims where owner_id = any($1)", [owners]);
        }

        // 4. Delete outbound intents (references complaints and messages)
        if (episodes.length > 0 || ingressRows.length > 0) {
          await db.query(
            "delete from public.outbound_intents where complaint_id = any($1) or message_id = any($2)",
            [episodes, ingressRows],
          );
        }

        // 5. Delete complaint evidence links
        if (episodes.length > 0) {
          await db.query("delete from public.complaint_evidence_links where complaint_id = any($1)", [episodes]);
        }

        // 6. Delete triage assessments
        if (ingressRows.length > 0) {
          await db.query("delete from public.triage_assessments where message_id = any($1)", [ingressRows]);
        }

        // 7. Unlink and delete conversations
        if (convRows.length > 0) {
          await db.query("update public.messages set conversation_id=null where conversation_id = any($1)", [convRows]);
          await db.query("delete from public.conversations where id = any($1)", [convRows]);
        }

        // 8. Delete messages
        if (ingressRows.length > 0) {
          await db.query("delete from public.messages where id = any($1)", [ingressRows]);
          await db.query("delete from public.processing_jobs where ingress_id = any($1)", [ingressRows]);
          await db.query("delete from public.ingress_events where id = any($1)", [ingressRows]);
        }

        // 9. Delete complaints
        if (episodes.length > 0) {
          await db.query("delete from public.complaints where id = any($1)", [episodes]);
        }

        // 10. Delete reply owners and channel identities
        if (owners.length > 0) {
          await db.query("delete from public.reply_owners where id = any($1)", [owners]);
        }

        if (identities.length > 0) {
          await db.query("delete from public.channel_identities where id = any($1)", [identities]);
        }
      });
    } finally {
      await pool.end();
    }
  }
});
