import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  parseAndValidateTestConfig,
  requireIsolatedDatabase,
  TestResourceTracker,
  cleanupFixture,
  EnvRestorer,
  combineErrors,
} from "../utils/test-guard";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import {
  listInboxConversations,
  getInboxConversationDetail,
  markConversationRead,
  InboxError,
  type Queryable,
} from "../../lib/application/inbox-service";
import type { MarkConversationReadResult } from "../../lib/application/inbox-contracts";
import {
  PersistenceError,
  type InboundReceipt,
} from "../../lib/application/persistence-contracts";
import type { Database } from "../../lib/supabase/database.types";
import { GET as getConversationsRoute } from "../../app/api/inbox/conversations/route";
import { GET as getConversationDetailRoute } from "../../app/api/inbox/conversations/[id]/route";

test("P2.6 Tahap 1: Helpdesk Inbox data layer, staff access, filters, pagination and per-staff unread tracking", async (t) => {
  const config = parseAndValidateTestConfig(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const supabase = createSupabaseClient<Database>(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const restorer = new EnvRestorer();
  restorer.save([
    "HELPDESK_DATABASE_URL",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  const tracker = new TestResourceTracker();
  const runId = randomUUID().slice(0, 8);
  const tag = `p26-${runId}`;
  const botAccountId = `bot-${tag}`;

  const staffIdA = randomUUID();
  const staffIdB = randomUUID();
  const cleanupStaffIds: string[] = [staffIdA, staffIdB];

  let primaryError: Error | undefined;
  const cleanupErrors: Error[] = [];
  let environmentGuardPassed = false;

  try {
    // 0. Verify test environment safety and isolation
    await requireIsolatedDatabase(pool, supabase, config);
    environmentGuardPassed = true;

    // Create isolated staff test accounts in auth.users
    await pool.query(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES
         ($1, '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', $3, '', now(), now()),
         ($2, '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', $4, '', now(), now())`,
      [staffIdA, staffIdB, `staff-a-${tag}@example.test`, `staff-b-${tag}@example.test`]
    );

    const persistence = new HelpdeskPersistence(pool);

    function makeReceipt(
      senderId: string,
      messageId: string,
      text: string,
      meta: InboundReceipt["metadata"] = {},
      accountId = botAccountId,
      chatId = senderId
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

    interface CreateTrackedInboundFixtureOptions {
      senderExternalId: string;
      providerMessageId: string;
      text: string;
      channelAccountId?: string;
      displayName?: string;
      metadata?: InboundReceipt["metadata"];
      chatId?: string;
      existingIdentityId?: string;
    }

    interface TrackedInboundFixture {
      identityId: string;
      ingressId: string;
      receipt: InboundReceipt;
    }

    /**
     * Pre-registers the identity fixture into public.channel_identities with a run-unique UUID
     * and records it into the tracker IMMEDIATELY before receive() is invoked.
     * When persistence.receive() runs, store.ensureIdentity() resolves to the existing row via ON CONFLICT.
     * Ingress and message are tracked immediately upon receipt return, and the relationship is asserted.
     */
    async function receiveTrackedInboundFixture(
      targetTracker: TestResourceTracker,
      opts: CreateTrackedInboundFixtureOptions,
      targetPersistence = persistence,
      targetPool = pool
    ): Promise<TrackedInboundFixture> {
      const {
        senderExternalId,
        providerMessageId,
        text,
        channelAccountId = botAccountId,
        displayName = `User ${senderExternalId}`,
        metadata = {},
        chatId = senderExternalId,
        existingIdentityId,
      } = opts;

      let identityId = existingIdentityId;

      if (!identityId) {
        // 1. Generate identity UUID in advance
        identityId = randomUUID();

        // 2. Pre-create identity fixture with unique run natural key
        await targetPool.query(
          `INSERT INTO public.channel_identities (
             id, channel, channel_account_id, sender_external_id, display_name_snapshot, verification_status
           ) VALUES ($1, 'telegram', $2, $3, $4, 'unverified')`,
          [identityId, channelAccountId, senderExternalId, displayName]
        );

        // 3. IMMEDIATELY record identity into tracker before ANY subsequent query or operation can fail
        targetTracker.recordIdentity(identityId);
      }

      // 4. Construct inbound receipt using identical channel, channelAccountId, and senderExternalId
      const receipt: InboundReceipt = {
        sender: {
          channel: "telegram",
          channelAccountId,
          senderExternalId,
        },
        chatId,
        providerMessageId,
        text,
        metadata,
      };

      // 5. Invoke production receive() — store.ensureIdentity() resolves to the existing row via ON CONFLICT
      const ingressResult = await targetPersistence.receive(receipt);
      const ingressId = ingressResult.ingressId;

      // 6. IMMEDIATELY record ingress & message into tracker
      targetTracker.recordIngress(ingressId);
      targetTracker.recordMessage(ingressId);

      // 7. On success path, prove ingress.identity_id strictly matches the tracked identity fixture
      const checkRes = await targetPool.query<{ identity_id: string }>(
        "SELECT identity_id FROM public.ingress_events WHERE id = $1",
        [ingressId]
      );
      assert.equal(
        checkRes.rows[0]?.identity_id,
        identityId,
        "ingress_events.identity_id must strictly match the pre-registered tracked identity fixture"
      );

      return {
        identityId,
        ingressId,
        receipt,
      };
    }

    // =========================================================================
    // AC 1: Validasi format staff ID pada service layer
    // =========================================================================
    await t.test("AC 1: Invalid staff ID format is rejected with 401 at the service layer", async () => {
      await assert.rejects(
        async () => {
          await listInboxConversations(pool, "invalid-uuid", { page: 1, limit: 25 });
        },
        (err: unknown) => {
          assert.ok(err instanceof InboxError);
          assert.equal(err.code, "INVALID_STAFF_ID");
          assert.equal(err.status, 401);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await getInboxConversationDetail(pool, "not-a-uuid", randomUUID());
        },
        (err: unknown) => {
          assert.ok(err instanceof InboxError);
          assert.equal(err.code, "INVALID_STAFF_ID");
          assert.equal(err.status, 401);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await markConversationRead(pool, "not-a-uuid", {
            conversationId: randomUUID(),
            lastReadMessageId: randomUUID(),
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof InboxError);
          assert.equal(err.code, "INVALID_STAFF_ID");
          assert.equal(err.status, 401);
          return true;
        }
      );
    });

    // =========================================================================
    // AC 2: Daftar percakapan, pagination 25 item stabil, dan total halaman
    // =========================================================================
    let convTestId1: string;
    const paginationFixtureIds: string[] = [];

    await t.test("AC 2: Conversation listing with stable 25-item pagination and sorting", async () => {
      // Seed 28 distinct conversations
      const convCount = 28;
      const baseEpoch = new Date("2026-10-04T00:00:00.000Z").getTime();

      for (let i = 1; i <= convCount; i++) {
        const senderExternal = `sender_${runId}_${i}`;
        const chatTime = new Date(baseEpoch + i * 60_000).toISOString();

        // 1. Create identity
        const identRes = await pool.query<{ id: string }>(
          `INSERT INTO public.channel_identities (
             channel, channel_account_id, sender_external_id, display_name_snapshot, verification_status
           )
           VALUES ('telegram', $1, $2, $3, 'unverified')
           RETURNING id`,
          [botAccountId, senderExternal, `User ${i} ${tag}`]
        );
        const identId = identRes.rows[0].id;
        tracker.recordIdentity(identId);

        // 2. Create conversation
        const convRes = await pool.query<{ id: string }>(
          `INSERT INTO public.conversations (
             identity_id, channel, account_id, chat_id, status, started_at, last_activity_at
           )
           VALUES ($1, 'telegram', $2, $3, 'active', $4, $4)
           RETURNING id`,
          [identId, botAccountId, senderExternal, chatTime]
        );
        const convId = convRes.rows[0].id;
        tracker.recordConversation(convId);
        paginationFixtureIds.push(convId);

        if (i === 1) convTestId1 = convId;

        // 3. Create message in conversation
        const ingressRes = await pool.query<{ id: string }>(
          `INSERT INTO public.ingress_events (
             identity_id, channel, account_id, chat_id, provider_message_id, body,
             received_at, mode, settings_version, emergency_stop
           )
           VALUES ($1, 'telegram', $2, $3, $4, $5, $6, 'SHADOW', 1, false)
           RETURNING id`,
          [identId, botAccountId, senderExternal, `pmsg_${i}`, `Pesan ${i} keluhan koneksi internet`, chatTime]
        );
        const ingressId = ingressRes.rows[0].id;
        tracker.recordIngress(ingressId);

        await pool.query(
          `INSERT INTO public.messages (
             id, conversation_id, identity_id, classification, review_reason, created_at
           )
           VALUES ($1, $2, $3, '{"category":"connection_complaint"}'::jsonb, null, $4)`,
          [ingressId, convId, identId, chatTime]
        );
        tracker.recordMessage(ingressId);
      }

      // Query page 1 (limit 25)
      const page1 = await listInboxConversations(pool, staffIdA, { page: 1, limit: 25 });
      assert.equal(page1.items.length, 25, "Page 1 must contain exactly 25 items");
      assert.equal(page1.page, 1);
      assert.equal(page1.limit, 25);
      assert.ok(page1.totalPages >= 2);

      // Verify stable sorting: lastActivityAt descending
      for (let i = 0; i < page1.items.length - 1; i++) {
        const timeA = new Date(page1.items[i].lastActivityAt).getTime();
        const timeB = new Date(page1.items[i + 1].lastActivityAt).getTime();
        assert.ok(timeA >= timeB, `Item ${i} (${page1.items[i].lastActivityAt}) must be >= Item ${i + 1} (${page1.items[i + 1].lastActivityAt})`);
      }

      // Query page 2 (limit 25)
      const page2 = await listInboxConversations(pool, staffIdA, { page: 2, limit: 25 });
      assert.ok(page2.items.length >= 3, `Page 2 must contain remaining items, got ${page2.items.length}`);
      assert.equal(page2.page, 2);

      // Ensure no items from page 1 appear on page 2 (strictly disjoint sets)
      const page1Ids = new Set(page1.items.map((it) => it.id));
      for (const item of page2.items) {
        assert.equal(page1Ids.has(item.id), false, `Item ${item.id} from page 2 should not be on page 1`);
      }
    });

    // =========================================================================
    // AC 3: Pesan non-komplain tetap terlihat tanpa episode
    // =========================================================================
    let nonComplaintConvId: string;
    let nonComplaintMsgId: string;

    await t.test("AC 3: Non-complaint messages remain visible with null episode", async () => {
      const nonComplaintChatId = `noncomp_${runId}`;
      const receipt = makeReceipt(nonComplaintChatId, "9001", "Terima kasih infonya min, selamat pagi");
      const ingress = await persistence.receive(receipt);
      tracker.recordIngress(ingress.ingressId);
      tracker.recordMessage(ingress.ingressId);

      const processed = await persistence.process(ingress.ingressId);
      assert.ok(processed.conversationId);
      nonComplaintConvId = processed.conversationId;
      nonComplaintMsgId = ingress.ingressId;
      tracker.recordConversation(nonComplaintConvId);

      // Non-complaint message has null episode
      assert.equal(processed.episodeId, null, "Non-complaint must not create complaint episode");

      // Verify in conversation list
      const list = await listInboxConversations(pool, staffIdA, { search: "Terima kasih infonya" });
      assert.ok(list.items.length >= 1);
      const item = list.items.find((it) => it.id === nonComplaintConvId);
      assert.ok(item, "Non-complaint conversation must appear in inbox list");
      assert.equal(item.latestEpisode, null, "latestEpisode must be null for non-complaint");
      assert.ok(item.lastMessage);
      assert.match(item.lastMessage.body, /Terima kasih/);
      assert.equal(item.needsReview, true, "Non-complaint inbound message without episode enters review");

      // Verify in conversation detail
      const detail = await getInboxConversationDetail(pool, staffIdA, nonComplaintConvId);
      assert.ok(detail);
      assert.equal(detail.latestEpisode, null);
      assert.equal(detail.messages.length, 1);
      assert.equal(detail.messages[0].id, nonComplaintMsgId);
      assert.equal(detail.messages[0].complaintId, null);
      assert.match(detail.messages[0].body, /Terima kasih/);
    });

    // =========================================================================
    // AC 4: Filter status episode, unread, needsReview, dan pencarian relevan
    // =========================================================================
    await t.test("AC 4: Filtering and search work across available fields", async () => {
      // 1. Filter episodeStatus = 'none' (returns non-complaint conversation)
      const noneList = await listInboxConversations(pool, staffIdA, {
        episodeStatus: "none",
        search: "Terima kasih infonya",
      });
      assert.ok(noneList.items.length >= 1);
      assert.equal(noneList.items[0].id, nonComplaintConvId);
      assert.equal(noneList.items[0].latestEpisode, null);

      // 2. Filter unread = true (initially all new conversations are unread)
      const unreadList = await listInboxConversations(pool, staffIdA, {
        unread: true,
        limit: 10,
      });
      assert.ok(unreadList.items.length > 0);
      for (const it of unreadList.items) {
        assert.equal(it.isUnread, true);
        assert.ok(it.unreadCount > 0);
      }

      // 3. Filter needsReview = true
      const reviewList = await listInboxConversations(pool, staffIdA, {
        needsReview: true,
        search: "Terima kasih infonya",
      });
      assert.ok(reviewList.items.some((it) => it.id === nonComplaintConvId));

      // 4. Search by sender display name
      const searchSender = await listInboxConversations(pool, staffIdA, {
        search: `User 1 ${tag}`,
      });
      assert.ok(searchSender.items.length >= 1);
      assert.ok(searchSender.items.some((it) => it.id === convTestId1));

      // 5. Search by message body
      const searchBody = await listInboxConversations(pool, staffIdA, {
        search: "keluhan koneksi internet",
      });
      assert.ok(searchBody.items.length > 0);
    });

    // =========================================================================
    // AC 5: Detail percakapan serta riwayat pesan terurut kronologis naik
    // =========================================================================
    let multiMsgConvId: string;
    let msgId1: string;
    let msgId2: string;
    let msgId3: string;

    await t.test("AC 5: Conversation detail returns messages strictly ordered ascending", async () => {
      const multiChatId = `multi_${runId}`;
      const t0 = new Date("2026-10-04T05:00:00.000Z");
      const t1 = new Date("2026-10-04T05:10:00.000Z");
      const t2 = new Date("2026-10-04T05:20:00.000Z");

      const r1 = makeReceipt(multiChatId, "m1", "Internet rumah mati lampu LOS merah");
      const ing1 = await persistence.receive(r1);
      tracker.recordIngress(ing1.ingressId);
      tracker.recordMessage(ing1.ingressId);
      await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [t0.toISOString(), ing1.ingressId]);
      const p1 = await persistence.process(ing1.ingressId);
      multiMsgConvId = p1.conversationId!;
      msgId1 = ing1.ingressId;
      tracker.recordConversation(multiMsgConvId);

      const r2 = makeReceipt(multiChatId, "m2", "Masih merah kak lampunya");
      const ing2 = await persistence.receive(r2);
      tracker.recordIngress(ing2.ingressId);
      tracker.recordMessage(ing2.ingressId);
      await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [t1.toISOString(), ing2.ingressId]);
      await persistence.process(ing2.ingressId);
      msgId2 = ing2.ingressId;

      const r3 = makeReceipt(multiChatId, "m3", "Bisa tolong dipercepat kak?");
      const ing3 = await persistence.receive(r3);
      tracker.recordIngress(ing3.ingressId);
      tracker.recordMessage(ing3.ingressId);
      await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [t2.toISOString(), ing3.ingressId]);
      await persistence.process(ing3.ingressId);
      msgId3 = ing3.ingressId;

      const detail = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.ok(detail);
      assert.equal(detail.messages.length, 3);
      assert.equal(detail.messages[0].id, msgId1);
      assert.equal(detail.messages[1].id, msgId2);
      assert.equal(detail.messages[2].id, msgId3);

      // Verify strictly ascending timestamp order
      assert.ok(new Date(detail.messages[0].receivedAt).getTime() < new Date(detail.messages[1].receivedAt).getTime());
      assert.ok(new Date(detail.messages[1].receivedAt).getTime() < new Date(detail.messages[2].receivedAt).getTime());

      // Verify triage assessment decision and claim exist
      assert.ok(detail.messages[0].triageAssessment);
      assert.equal(detail.messages[0].triageAssessment.decision.outcome, "candidate");
    });

    // =========================================================================
    // =========================================================================
    // AC 6 (4.a): Persistent unread is isolated per staff member and persists after reload
    // =========================================================================
    await t.test("AC 6 (4.a): Persistent unread is isolated per staff member and persists after reload", async () => {
      // Initially, both Staff A and Staff B have 3 unread messages in multiMsgConvId
      const detailA0 = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      const detailB0 = await getInboxConversationDetail(pool, staffIdB, multiMsgConvId);
      assert.equal(detailA0?.unreadCount, 3);
      assert.equal(detailB0?.unreadCount, 3);

      // Staff A marks up to msg2 as read acknowledging [msgId1, msgId2]
      const readResult = await markConversationRead(pool, staffIdA, {
        conversationId: multiMsgConvId,
        acknowledgedMessageIds: [msgId1, msgId2],
        lastReadMessageId: msgId2,
      });
      assert.equal(readResult.advanced, true);
      assert.equal(readResult.newlyReadCount, 2);
      assert.equal(readResult.lastReadMessageId, msgId2);
      assert.equal(readResult.unreadRemaining, 1);

      // Staff A now has unreadCount = 1 (msg3 is unread)
      const detailA1 = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.equal(detailA1?.unreadCount, 1);
      assert.equal(detailA1?.messages[0].isRead, true);
      assert.equal(detailA1?.messages[1].isRead, true);
      assert.equal(detailA1?.messages[2].isRead, false);

      // Staff B MUST STILL HAVE unreadCount = 3 (isolated per staff)
      const detailB1 = await getInboxConversationDetail(pool, staffIdB, multiMsgConvId);
      assert.equal(detailB1?.unreadCount, 3, "Staff B unread count must not be modified by Staff A's read action");
      assert.equal(detailB1?.isUnread, true);
      assert.equal(detailB1?.messages[0].isRead, false, "Staff B: msg1 must still be unread");
      assert.equal(detailB1?.messages[1].isRead, false, "Staff B: msg2 must still be unread");
      assert.equal(detailB1?.messages[2].isRead, false, "Staff B: msg3 must still be unread");

      // Staff A reloads: persistence confirmed
      const detailAReload = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.equal(detailAReload?.unreadCount, 1);
      assert.equal(detailAReload?.messages[0].isRead, true);
      assert.equal(detailAReload?.messages[1].isRead, true);
      assert.equal(detailAReload?.messages[2].isRead, false);

      // Verify DB table state directly
      const readsA = await pool.query<{ count: string }>(
        "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
        [staffIdA, multiMsgConvId]
      );
      const readsB = await pool.query<{ count: string }>(
        "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
        [staffIdB, multiMsgConvId]
      );
      assert.equal(Number(readsA.rows[0].count), 2, "Staff A must have exactly 2 read messages in DB");
      assert.equal(Number(readsB.rows[0].count), 0, "Staff B must have 0 read messages in DB");
    });

    // =========================================================================
    // AC 6.1 (4.d): Pesan diterima lebih awal tetapi baru diproses setelah snapshot staf tetap unread
    // =========================================================================
    await t.test(
      "AC 6.1 (4.d): Delayed processing message with earlier received_at committed after staff snapshot remains unread",
      async () => {
        const delayedChatId = `chat_delayed_${runId}`;
        const t1 = new Date("2026-10-04T07:00:00.000Z");
        const tEarlier = new Date("2026-10-04T06:30:00.000Z"); // 30 minutes earlier!

        // 1. Initial message arrives and is processed using tracked fixture
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: delayedChatId,
          providerMessageId: "m_init",
          text: "Pesan awal di percakapan",
        });
        await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
          t1.toISOString(),
          fix1.ingressId,
        ]);
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        // 2. Staff A fetches detail snapshot S1 (contains ONLY fix1.ingressId)
        const snapshot1 = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(snapshot1);
        assert.equal(snapshot1.messages.length, 1);
        assert.equal(snapshot1.messages[0].id, fix1.ingressId);

        // 3. Delayed message arrives in transit: received_at is 30 mins earlier, but processed AFTER snapshot1
        // Uses the pre-recorded identity fixture with the same natural key
        const fixDelayed = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: delayedChatId,
          providerMessageId: "m_delayed",
          text: "Pesan terlambat diproses tapi waktu kirim lebih awal",
          existingIdentityId: fix1.identityId,
        });
        await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
          tEarlier.toISOString(),
          fixDelayed.ingressId,
        ]);
        await persistence.process(fixDelayed.ingressId);

        // 4. Staff A marks read for snapshot S1 using acknowledgedMessageIds
        const readRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [fix1.ingressId],
          lastReadMessageId: fix1.ingressId,
        });

        assert.equal(readRes.advanced, true);
        assert.equal(readRes.newlyReadCount, 1);
        assert.equal(readRes.unreadRemaining, 1, "The delayed message must remain unread!");

        // 5. Verify conversation detail for Staff A: fix1 is read, fixDelayed is UNREAD
        const detailAfter = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailAfter);
        assert.equal(detailAfter.messages.length, 2);
        assert.equal(detailAfter.unreadCount, 1, "Delayed message must be counted as unread");
        assert.equal(detailAfter.isUnread, true);

        const msgInit = detailAfter.messages.find((m) => m.id === fix1.ingressId);
        const msgDelayed = detailAfter.messages.find((m) => m.id === fixDelayed.ingressId);
        assert.equal(msgInit?.isRead, true, "Initial snapshot message must be marked read");
        assert.equal(
          msgDelayed?.isRead,
          false,
          "Delayed message NOT in snapshot MUST REMAIN UNREAD despite older received_at"
        );

        // 6. Direct DB state verification
        const readsInDb = await pool.query<{ message_id: string }>(
          "SELECT message_id FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(readsInDb.rows.length, 1);
        assert.equal(readsInDb.rows[0].message_id, fix1.ingressId);
      }
    );

    // =========================================================================
    // AC 6.2 (4.e): Pesan baru dengan timestamp sama dan UUID lebih kecil tetap unread
    // =========================================================================
    await t.test(
      "AC 6.2 (4.e): New message with identical received_at and smaller UUID remains unread",
      async () => {
        const sameTimeChatId = `chat_sametime_${runId}`;
        const tShared = new Date("2026-10-04T08:00:00.000Z");

        // 1. Pre-register and receive two messages from same sender using tracked fixtures
        const fixA = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: sameTimeChatId,
          providerMessageId: "m_st_a",
          text: "Pesan waktu sama A",
        });
        const fixB = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: sameTimeChatId,
          providerMessageId: "m_st_b",
          text: "Pesan waktu sama B",
          existingIdentityId: fixA.identityId,
        });

        // Deterministic relation: separate into smaller UUID and larger UUID without random retry loops
        const [smallerFix, largerFix] = fixA.ingressId < fixB.ingressId ? [fixA, fixB] : [fixB, fixA];

        // M1 (initial snapshot) has larger UUID, M2 (new message) has smaller UUID
        // Set both received_at to identical timestamp
        await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = ANY($2::uuid[])", [
          tShared.toISOString(),
          [fixA.ingressId, fixB.ingressId],
        ]);

        await persistence.process(largerFix.ingressId);
        await persistence.process(smallerFix.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [largerFix.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        // 2. Staff A marks read for snapshot acknowledging ONLY largerFix (M1)
        const markRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [largerFix.ingressId],
          lastReadMessageId: largerFix.ingressId,
        });

        assert.equal(markRes.advanced, true);
        assert.equal(markRes.newlyReadCount, 1);

        // 3. Verify conversation detail: unacknowledged message with smaller UUID MUST REMAIN UNREAD
        const detailAfter = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailAfter);
        assert.equal(detailAfter.unreadCount, 1, "New message with smaller UUID and same timestamp must be unread");
        assert.equal(detailAfter.isUnread, true);

        const ackMsg = detailAfter.messages.find((m) => m.id === largerFix.ingressId);
        const unackMsg = detailAfter.messages.find((m) => m.id === smallerFix.ingressId);
        assert.equal(ackMsg?.isRead, true);
        assert.equal(
          unackMsg?.isRead,
          false,
          "New message with same timestamp and smaller UUID must NOT be marked read"
        );
      }
    );

    // =========================================================================
    // AC 6.3 (4.f): Timestamp PostgreSQL bermikrodetik (.123456 vs .123789) tidak menyebabkan salah baca
    // =========================================================================
    await t.test(
      "AC 6.3 (4.f): PostgreSQL microsecond timestamps (.123456 vs .123789) do not cause misread",
      async () => {
        const microChatId = `chat_micro_${runId}`;
        const fixA = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: microChatId,
          providerMessageId: "m_micro_a",
          text: "Pesan mikrodetik A",
        });
        const fixB = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: microChatId,
          providerMessageId: "m_micro_b",
          text: "Pesan mikrodetik B",
          existingIdentityId: fixA.identityId,
        });

        // Deterministic relation: M1 has larger UUID, M2 has smaller UUID
        const [smallerFix, largerFix] = fixA.ingressId < fixB.ingressId ? [fixA, fixB] : [fixB, fixA];
        const m1Fix = largerFix; // larger UUID
        const m2Fix = smallerFix; // smaller UUID

        // Update timestamps with microsecond precision directly in PostgreSQL
        await pool.query(
          "UPDATE public.ingress_events SET received_at = '2026-10-04 12:00:00.123456+00' WHERE id = $1",
          [m1Fix.ingressId]
        );
        await pool.query(
          "UPDATE public.ingress_events SET received_at = '2026-10-04 12:00:00.123789+00' WHERE id = $1",
          [m2Fix.ingressId]
        );

        await persistence.process(m1Fix.ingressId);
        await persistence.process(m2Fix.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [m1Fix.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        // 1. Staff marks M1 first
        const markRes1 = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [m1Fix.ingressId],
          lastReadMessageId: m1Fix.ingressId,
        });

        assert.equal(markRes1.advanced, true);
        assert.equal(markRes1.newlyReadCount, 1);
        assert.equal(markRes1.unreadRemaining, 1);
        assert.equal(markRes1.lastReadMessageId, m1Fix.ingressId);
        assert.equal(markRes1.lastReadAt, "2026-10-04T12:00:00.123456Z");

        // Stored cursor in PostgreSQL directly has exact microsecond text
        const cursor1Pg = await pool.query<{ last_read_message_id: string; last_read_at_iso: string }>(
          `SELECT last_read_message_id, to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_read_at_iso
           FROM public.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2`,
          [staffIdA, convId]
        );
        assert.equal(cursor1Pg.rows[0].last_read_message_id, m1Fix.ingressId);
        assert.equal(cursor1Pg.rows[0].last_read_at_iso, "2026-10-04T12:00:00.123456Z");

        // Granular read state
        const detail1 = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detail1);
        assert.equal(detail1.unreadCount, 1);
        const detailM1 = detail1.messages.find((m) => m.id === m1Fix.ingressId);
        const detailM2 = detail1.messages.find((m) => m.id === m2Fix.ingressId);
        assert.equal(detailM1?.isRead, true);
        assert.equal(detailM2?.isRead, false);

        // 2. Staff now marks M2
        const markRes2 = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [m1Fix.ingressId, m2Fix.ingressId],
          lastReadMessageId: m2Fix.ingressId,
        });

        assert.equal(markRes2.advanced, true);
        assert.equal(markRes2.newlyReadCount, 1);
        assert.equal(markRes2.unreadRemaining, 0);
        assert.equal(markRes2.lastReadMessageId, m2Fix.ingressId);
        assert.equal(markRes2.lastReadAt, "2026-10-04T12:00:00.123789Z");

        const cursor2Pg = await pool.query<{ last_read_message_id: string; last_read_at_iso: string }>(
          `SELECT last_read_message_id, to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_read_at_iso
           FROM public.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2`,
          [staffIdA, convId]
        );
        assert.equal(cursor2Pg.rows[0].last_read_message_id, m2Fix.ingressId);
        assert.equal(cursor2Pg.rows[0].last_read_at_iso, "2026-10-04T12:00:00.123789Z");

        const detail2 = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detail2);
        assert.equal(detail2.unreadCount, 0);
        assert.equal(detail2.messages.every((m) => m.isRead), true);

        // 3. Repeat older snapshot with M1: cursor must NOT retreat!
        const repeatOlder = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [m1Fix.ingressId],
          lastReadMessageId: m1Fix.ingressId,
        });

        assert.equal(repeatOlder.advanced, false, "Older snapshot must not advance or retreat cursor");
        assert.equal(repeatOlder.newlyReadCount, 0);
        assert.equal(repeatOlder.lastReadMessageId, m2Fix.ingressId, "Response must retain winning cursor M2");
        assert.equal(repeatOlder.lastReadAt, "2026-10-04T12:00:00.123789Z");
        assert.equal(repeatOlder.unreadRemaining, 0);

        const cursor3Pg = await pool.query<{ last_read_message_id: string; last_read_at_iso: string }>(
          `SELECT last_read_message_id, to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_read_at_iso
           FROM public.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2`,
          [staffIdA, convId]
        );
        assert.equal(cursor3Pg.rows[0].last_read_message_id, m2Fix.ingressId, "PostgreSQL cursor must not retreat");
        assert.equal(cursor3Pg.rows[0].last_read_at_iso, "2026-10-04T12:00:00.123789Z");
      }
    );

    // =========================================================================
    // AC 6.4: Fallback lastReadMessageId without acknowledgedMessageIds strictly marks single message
    // =========================================================================
    await t.test(
      "AC 6.4: Fallback lastReadMessageId without acknowledgedMessageIds strictly marks single message without range expansion",
      async () => {
        const fallbackChatId = `chat_fallback_${runId}`;
        const t1 = new Date("2026-10-04T10:00:00.000Z");
        const tEarlier = new Date("2026-10-04T09:30:00.000Z"); // 30 minutes earlier than M1

        // 1. Initial message arrives and is processed with timestamp t1
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: fallbackChatId,
          providerMessageId: "m_fb1",
          text: "Pesan fallback 1",
        });
        await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
          t1.toISOString(),
          fix1.ingressId,
        ]);
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        // 2. Staff snapshot S1 contains ONLY fix1 (M1)
        const snapshot1 = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(snapshot1);
        assert.equal(snapshot1.messages.length, 1);
        assert.equal(snapshot1.messages[0].id, fix1.ingressId);

        // 3. Message 2 (M2) is processed AFTER snapshot1, but has received_at OLDER than M1 (tEarlier < t1)
        // Under the old buggy range query (received_at < last_read_at), M2 would be falsely marked read.
        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: fallbackChatId,
          providerMessageId: "m_fb2",
          text: "Pesan fallback 2 dengan waktu kirim lebih awal",
          existingIdentityId: fix1.identityId,
        });
        await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
          tEarlier.toISOString(),
          fix2.ingressId,
        ]);
        await persistence.process(fix2.ingressId);

        // 4. Request with ONLY lastReadMessageId = fix1.ingressId (no acknowledgedMessageIds)
        const markRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          lastReadMessageId: fix1.ingressId,
        });

        assert.equal(markRes.advanced, true);
        assert.equal(markRes.newlyReadCount, 1);
        assert.equal(markRes.lastReadMessageId, fix1.ingressId);
        assert.equal(markRes.unreadRemaining, 1, "M2 arriving after snapshot with older timestamp must remain unread!");

        // 5. Verify conversation detail: M1 is read, M2 remains strictly UNREAD
        const detailAfter = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailAfter);
        assert.equal(detailAfter.unreadCount, 1);
        const m1 = detailAfter.messages.find((m) => m.id === fix1.ingressId);
        const m2 = detailAfter.messages.find((m) => m.id === fix2.ingressId);
        assert.equal(m1?.isRead, true);
        assert.equal(
          m2?.isRead,
          false,
          "M2 must NOT be marked read by fallback lastReadMessageId=M1 even though M2 has an older received_at"
        );

        // 6. Direct DB verification: only M1 is in staff_message_reads
        const readsInDb = await pool.query<{ message_id: string }>(
          "SELECT message_id FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(readsInDb.rows.length, 1);
        assert.equal(readsInDb.rows[0].message_id, fix1.ingressId);

        // 7. Repeating the request produces newlyReadCount = 0 and advanced = false
        const repeatRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          lastReadMessageId: fix1.ingressId,
        });
        assert.equal(repeatRes.advanced, false);
        assert.equal(repeatRes.newlyReadCount, 0);
        assert.equal(repeatRes.unreadRemaining, 1);

        // 8. Acknowledging M2 via acknowledgedMessageIds path marks M2 read
        const ackRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [fix1.ingressId, fix2.ingressId],
          lastReadMessageId: fix2.ingressId,
        });
        assert.equal(ackRes.advanced, true);
        assert.equal(ackRes.newlyReadCount, 1);
        assert.equal(ackRes.unreadRemaining, 0);

        const detailFinal = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.equal(detailFinal?.unreadCount, 0);
        assert.equal(detailFinal?.messages.every((m) => m.isRead), true);
      }
    );

    // =========================================================================
    // AC 6.5: Legacy unconfirmed backfill rows remain unread until explicit acknowledgement
    // =========================================================================
    await t.test(
      "AC 6.5: Legacy unconfirmed backfill rows (is_confirmed = false) remain unread until explicitly acknowledged",
      async () => {
        const legacyChatId = `chat_legacy_${runId}`;
        const fixOld = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: legacyChatId,
          providerMessageId: "m_leg_old",
          text: "Pesan lama pra-upgrade",
        });
        await pool.query(
          "UPDATE public.ingress_events SET received_at = '2026-10-04 01:00:00+00' WHERE id = $1",
          [fixOld.ingressId]
        );
        await persistence.process(fixOld.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fixOld.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fixLate = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: legacyChatId,
          providerMessageId: "m_leg_late",
          text: "Pesan terlambat pra-upgrade",
          existingIdentityId: fixOld.identityId,
        });
        await pool.query(
          "UPDATE public.ingress_events SET received_at = '2026-10-04 00:30:00+00' WHERE id = $1",
          [fixLate.ingressId]
        );
        await persistence.process(fixLate.ingressId);

        // Simulate legacy unconfirmed backfill state (as produced by migration 20261004130000):
        // staffIdA has unconfirmed read rows for fixOld
        await pool.query(
          `INSERT INTO public.staff_message_reads (staff_id, conversation_id, message_id, read_at, is_confirmed)
           VALUES ($1, $2, $3, now(), false)
           ON CONFLICT (staff_id, message_id) DO UPDATE SET is_confirmed = false`,
          [staffIdA, convId, fixOld.ingressId]
        );
        await pool.query(
          `INSERT INTO public.staff_conversation_reads (staff_id, conversation_id, last_read_message_id, last_read_at, updated_at, is_confirmed)
           VALUES ($1, $2, $3, '2026-10-04 01:00:00+00', now(), false)
           ON CONFLICT (staff_id, conversation_id) DO UPDATE SET is_confirmed = false, last_read_message_id = $3`,
          [staffIdA, convId, fixOld.ingressId]
        );

        // Verify: unconfirmed backfill rows DO NOT make messages considered read!
        // Both fixOld and fixLate must appear unread for staffIdA
        const detailLegacy = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailLegacy);
        assert.equal(detailLegacy.unreadCount, 2, "Unconfirmed legacy backfill must not mark messages read");
        assert.equal(detailLegacy.messages.every((m) => !m.isRead), true);

        // Staff B is isolated and has 0 reads
        const detailStaffB = await getInboxConversationDetail(pool, staffIdB, convId);
        assert.ok(detailStaffB);
        assert.equal(detailStaffB.unreadCount, 2);

        // Now Staff A explicitly acknowledges fixOld via acknowledgedMessageIds
        const confirmRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [fixOld.ingressId],
          lastReadMessageId: fixOld.ingressId,
        });

        assert.equal(confirmRes.advanced, true);
        assert.equal(confirmRes.newlyReadCount, 1, "Confirming unconfirmed row must count as newlyReadCount = 1");
        assert.equal(confirmRes.unreadRemaining, 1, "fixLate remains unread");

        // Verify in DB that is_confirmed is now true
        const checkDb = await pool.query<{ is_confirmed: boolean }>(
          "SELECT is_confirmed FROM public.staff_message_reads WHERE staff_id = $1 AND message_id = $2",
          [staffIdA, fixOld.ingressId]
        );
        assert.equal(checkDb.rows[0].is_confirmed, true);

        // Repeat confirmation: idempotent, newlyReadCount = 0, advanced = false
        const repeatConfirm = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: [fixOld.ingressId],
          lastReadMessageId: fixOld.ingressId,
        });
        assert.equal(repeatConfirm.advanced, false);
        assert.equal(repeatConfirm.newlyReadCount, 0);
        assert.equal(repeatConfirm.unreadRemaining, 1);

        // Staff B remains untouched
        const staffBReads = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdB, convId]
        );
        assert.equal(Number(staffBReads.rows[0].count), 0);
      }
    );

    // =========================================================================
    // AC 6.6: Real SQL migration transitions (upgrade path, fresh sequence, and policy cutoff impact)
    // using raw migration files executed in isolated schema namespaces
    // =========================================================================
    await t.test(
      "AC 6.6: Real SQL migration transitions (upgrade, fresh sequence, and policy cutoff impact) using actual migration files",
      async () => {
        const cleanRunId = runId.replace(/-/g, "_");
        const upgradeSchema = `test_mig_upg_${cleanRunId}`;
        const freshSchema = `test_mig_fresh_${cleanRunId}`;

        let migPrimaryError: Error | undefined;
        const migCleanupErrors: Error[] = [];

        try {
          // 1. Read actual migration files from repository
          const mig10Path = path.resolve(process.cwd(), "supabase/migrations/20261004100000_create_staff_conversation_reads.sql");
          const mig11Path = path.resolve(process.cwd(), "supabase/migrations/20261004110000_revoke_direct_staff_conversation_reads_mutation.sql");
          const mig12Path = path.resolve(process.cwd(), "supabase/migrations/20261004120000_create_staff_message_reads.sql");
          const mig13Path = path.resolve(process.cwd(), "supabase/migrations/20261004130000_correct_legacy_message_read_backfill.sql");

          assert.equal(fs.existsSync(mig10Path), true, "Migration 20261004100000 must exist on disk");
          assert.equal(fs.existsSync(mig11Path), true, "Migration 20261004110000 must exist on disk");
          assert.equal(fs.existsSync(mig12Path), true, "Migration 20261004120000 must exist on disk");
          assert.equal(fs.existsSync(mig13Path), true, "Migration 20261004130000 must exist on disk");

          const rawSql10 = fs.readFileSync(mig10Path, "utf-8");
          const rawSql11 = fs.readFileSync(mig11Path, "utf-8");
          const rawSql12 = fs.readFileSync(mig12Path, "utf-8");
          const rawSql13 = fs.readFileSync(mig13Path, "utf-8");

          // Map schema qualifications while strictly preserving all SQL logic, conditions, and backfill expressions
          const mapSqlToNamespace = (sql: string, targetSchema: string) => {
            return sql
              .replace(/\bbegin;\s*/gi, "")
              .replace(/\bcommit;\s*/gi, "")
              .replace(/public\.staff_message_reads/g, `${targetSchema}.staff_message_reads`)
              .replace(/public\.staff_conversation_reads/g, `${targetSchema}.staff_conversation_reads`);
          };

          // -------------------------------------------------------------------
          // Skenario 1: Upgrade path & Dampak Kebijakan Tanpa Cutoff (upgradeSchema)
          // -------------------------------------------------------------------
          await pool.query(`CREATE SCHEMA IF NOT EXISTS ${upgradeSchema}`);

          // Run initial migrations 100000 & 110000 in upgradeSchema
          await pool.query(mapSqlToNamespace(rawSql10, upgradeSchema));
          await pool.query(mapSqlToNamespace(rawSql11, upgradeSchema));

          // Domain fixtures: Create conversation with 2 messages using receiveTrackedInboundFixture
          const migChatId = `chat_mig_${runId}`;
          const t1 = new Date("2026-10-04T10:00:00.000Z");
          const tEarlier = new Date("2026-10-04T09:30:00.000Z");

          const fix1 = await receiveTrackedInboundFixture(tracker, {
            senderExternalId: migChatId,
            providerMessageId: "m_mig1",
            text: "Pesan migrasi 1",
          });
          await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
            t1.toISOString(),
            fix1.ingressId,
          ]);
          await persistence.process(fix1.ingressId);

          const convRes = await pool.query<{ conversation_id: string }>(
            "SELECT conversation_id FROM public.messages WHERE id = $1",
            [fix1.ingressId]
          );
          const convId = convRes.rows[0].conversation_id;
          tracker.recordConversation(convId);

          const fix2 = await receiveTrackedInboundFixture(tracker, {
            senderExternalId: migChatId,
            providerMessageId: "m_mig2",
            text: "Pesan migrasi 2 (terlambat, waktu kirim lebih awal)",
            existingIdentityId: fix1.identityId,
          });
          await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [
            tEarlier.toISOString(),
            fix2.ingressId,
          ]);
          await persistence.process(fix2.ingressId);

          // Populate comparator rows in upgradeSchema.staff_conversation_reads BEFORE migration:
          // Row A (Staff A): updated_at = 11:00:00 UTC (< 12:00:00 UTC), last_read_at = 11:00:00 UTC
          // Row B (Staff B): updated_at = 14:00:00 UTC (> 12:00:00 UTC), last_read_at = 14:00:00 UTC
          await pool.query(`
            INSERT INTO ${upgradeSchema}.staff_conversation_reads (staff_id, conversation_id, last_read_message_id, last_read_at, updated_at)
            VALUES ($1, $2, $3, '2026-10-04 11:00:00+00', '2026-10-04 11:00:00+00')
          `, [staffIdA, convId, fix1.ingressId]);

          await pool.query(`
            INSERT INTO ${upgradeSchema}.staff_conversation_reads (staff_id, conversation_id, last_read_message_id, last_read_at, updated_at)
            VALUES ($1, $2, $3, '2026-10-04 14:00:00+00', '2026-10-04 14:00:00+00')
          `, [staffIdB, convId, fix1.ingressId]);

          // Run migration 20261004120000 (creates staff_message_reads and executes backfill):
          await pool.query(mapSqlToNamespace(rawSql12, upgradeSchema));

          // Verify comparator rows exist BEFORE corrective migration 130000:
          // 1. staff_conversation_reads has updated_at < 12:00 and updated_at > 12:00
          const preConvsBefore = await pool.query<{ count: string }>(
            `SELECT count(*) FROM ${upgradeSchema}.staff_conversation_reads WHERE updated_at < '2026-10-04 12:00:00+00'`
          );
          const preConvsAfter = await pool.query<{ count: string }>(
            `SELECT count(*) FROM ${upgradeSchema}.staff_conversation_reads WHERE updated_at > '2026-10-04 12:00:00+00'`
          );
          assert.equal(Number(preConvsBefore.rows[0].count), 1, "Must have pre-transition conversation read before 12:00 UTC");
          assert.equal(Number(preConvsAfter.rows[0].count), 1, "Must have pre-transition conversation read after 12:00 UTC");

          // 2. staff_message_reads has read_at < 12:00 (Staff A's backfill from 11:00) and read_at > 12:00 (Staff B's backfill from 14:00)
          const preMsgsBefore = await pool.query<{ count: string }>(
            `SELECT count(*) FROM ${upgradeSchema}.staff_message_reads WHERE read_at < '2026-10-04 12:00:00+00'`
          );
          const preMsgsAfter = await pool.query<{ count: string }>(
            `SELECT count(*) FROM ${upgradeSchema}.staff_message_reads WHERE read_at > '2026-10-04 12:00:00+00'`
          );
          assert.ok(Number(preMsgsBefore.rows[0].count) > 0, "Must have pre-transition message reads before 12:00 UTC");
          assert.ok(Number(preMsgsAfter.rows[0].count) > 0, "Must have pre-transition message reads after 12:00 UTC");

          // Execute actual corrective migration 20261004130000 directly from disk
          await pool.query(mapSqlToNamespace(rawSql13, upgradeSchema));

          // Prove: ALL pre-existing rows on BOTH sides of 12:00:00 UTC became is_confirmed = false!
          // (Without any manual UPDATE simulating the migration!)
          const postCorrMsgs = await pool.query<{ read_at: string; is_confirmed: boolean }>(
            `SELECT read_at::text, is_confirmed FROM ${upgradeSchema}.staff_message_reads`
          );
          assert.ok(postCorrMsgs.rows.length >= 2, "Expected backfilled message reads to be present");
          assert.equal(
            postCorrMsgs.rows.every((r) => r.is_confirmed === false),
            true,
            "All message reads across both sides of 12:00 UTC must be is_confirmed = false"
          );

          const postCorrConvs = await pool.query<{ updated_at: string; is_confirmed: boolean }>(
            `SELECT updated_at::text, is_confirmed FROM ${upgradeSchema}.staff_conversation_reads`
          );
          assert.equal(postCorrConvs.rows.length, 2);
          assert.equal(
            postCorrConvs.rows.every((r) => r.is_confirmed === false),
            true,
            "All conversation reads across both sides of 12:00 UTC must be is_confirmed = false"
          );

          // Domain integrity check: public messages and conversations remain 100% intact
          const domainMsgCheck = await pool.query<{ count: string }>(
            "SELECT count(*) FROM public.messages WHERE conversation_id = $1",
            [convId]
          );
          assert.equal(Number(domainMsgCheck.rows[0].count), 2, "Domain messages must remain intact");

          // -------------------------------------------------------------------
          // Skenario 2: Fresh sequence pada namespace baru yang kosong (freshSchema)
          // -------------------------------------------------------------------
          await pool.query(`CREATE SCHEMA IF NOT EXISTS ${freshSchema}`);

          // Run all 4 migration files sequentially in freshSchema
          await pool.query(mapSqlToNamespace(rawSql10, freshSchema));
          await pool.query(mapSqlToNamespace(rawSql11, freshSchema));
          await pool.query(mapSqlToNamespace(rawSql12, freshSchema));
          await pool.query(mapSqlToNamespace(rawSql13, freshSchema));

          // 1. Verify schema completeness and column default 'true'
          const colInfoMsgs = await pool.query<{ column_default: string }>(`
            SELECT column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'staff_message_reads' AND column_name = 'is_confirmed'
          `, [freshSchema]);
          assert.ok(colInfoMsgs.rows[0]);
          assert.equal(colInfoMsgs.rows[0].column_default, "true", "Default value for is_confirmed on staff_message_reads must be true");

          const colInfoConvs = await pool.query<{ column_default: string }>(`
            SELECT column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'staff_conversation_reads' AND column_name = 'is_confirmed'
          `, [freshSchema]);
          assert.ok(colInfoConvs.rows[0]);
          assert.equal(colInfoConvs.rows[0].column_default, "true", "Default value for is_confirmed on staff_conversation_reads must be true");

          // 2. Prove new rows inserted without mentioning is_confirmed get default true
          await pool.query(`
            INSERT INTO ${freshSchema}.staff_conversation_reads (staff_id, conversation_id, last_read_message_id, last_read_at, updated_at)
            VALUES ($1, $2, $3, now(), now())
          `, [staffIdA, convId, fix1.ingressId]);

          await pool.query(`
            INSERT INTO ${freshSchema}.staff_message_reads (staff_id, conversation_id, message_id, read_at)
            VALUES ($1, $2, $3, now())
          `, [staffIdA, convId, fix1.ingressId]);

          const checkDefaultConv = await pool.query<{ is_confirmed: boolean }>(
            `SELECT is_confirmed FROM ${freshSchema}.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2`,
            [staffIdA, convId]
          );
          assert.equal(checkDefaultConv.rows[0].is_confirmed, true, "Row inserted without is_confirmed must default to true");

          const checkDefaultMsg = await pool.query<{ is_confirmed: boolean }>(
            `SELECT is_confirmed FROM ${freshSchema}.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
            [staffIdA, fix1.ingressId]
          );
          assert.equal(checkDefaultMsg.rows[0].is_confirmed, true, "Row inserted without is_confirmed must default to true");

          // 3. Runtime explicit staff acknowledgement
          const explicitAckRes = await pool.query<{ message_id: string }>(`
            INSERT INTO ${freshSchema}.staff_message_reads (staff_id, conversation_id, message_id, read_at, is_confirmed)
            VALUES ($1, $2, $3, now(), true)
            ON CONFLICT (staff_id, message_id) DO UPDATE
            SET is_confirmed = true, read_at = now()
            WHERE NOT ${freshSchema}.staff_message_reads.is_confirmed
            RETURNING message_id
          `, [staffIdA, convId, fix2.ingressId]);

          assert.equal(explicitAckRes.rows.length, 1);
          assert.equal(explicitAckRes.rows[0].message_id, fix2.ingressId);

          const checkExplicit = await pool.query<{ is_confirmed: boolean }>(
            `SELECT is_confirmed FROM ${freshSchema}.staff_message_reads WHERE staff_id = $1 AND message_id = $2`,
            [staffIdA, fix2.ingressId]
          );
          assert.equal(checkExplicit.rows[0].is_confirmed, true);

          // 4. Runtime explicit acknowledgement idempotency
          const repeatAckRes = await pool.query<{ message_id: string }>(`
            INSERT INTO ${freshSchema}.staff_message_reads (staff_id, conversation_id, message_id, read_at, is_confirmed)
            VALUES ($1, $2, $3, now(), true)
            ON CONFLICT (staff_id, message_id) DO UPDATE
            SET is_confirmed = true, read_at = now()
            WHERE NOT ${freshSchema}.staff_message_reads.is_confirmed
            RETURNING message_id
          `, [staffIdA, convId, fix2.ingressId]);

          assert.equal(repeatAckRes.rows.length, 0, "Repeating explicit acknowledgement must be idempotent");

          // 5. Verify baseline comparator preservation in public:
          const publicReadsCount = await pool.query<{ count: string }>(
            "SELECT count(*) FROM public.staff_message_reads WHERE conversation_id = $1",
            [convId]
          );
          assert.equal(Number(publicReadsCount.rows[0].count), 0, "Public read-state remained isolated from test schemas");
        } catch (err) {
          migPrimaryError = err instanceof Error ? err : new Error(String(err));
        } finally {
          try {
            await pool.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
          } catch (cleanUpgErr) {
            migCleanupErrors.push(cleanUpgErr instanceof Error ? cleanUpgErr : new Error(String(cleanUpgErr)));
          }

          try {
            await pool.query(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
          } catch (cleanFreshErr) {
            migCleanupErrors.push(cleanFreshErr instanceof Error ? cleanFreshErr : new Error(String(cleanFreshErr)));
          }

          const combined = combineErrors(migPrimaryError, migCleanupErrors);
          if (combined) {
            throw combined;
          }
        }
      }
    );

    // =========================================================================
    // AC 7 (4.b, 4.c): Operasi idempotent dan tidak memundurkan posisi baca (monotonicity)
    // =========================================================================
    await t.test("AC 7 (4.b, 4.c): Mark read is idempotent and monotonically non-decreasing", async () => {
      // 1. Repeating mark read for the same snapshot (msg1, msg2) is idempotent
      const repeatRead = await markConversationRead(pool, staffIdA, {
        conversationId: multiMsgConvId,
        acknowledgedMessageIds: [msgId1, msgId2],
        lastReadMessageId: msgId2,
      });
      assert.equal(repeatRead.advanced, false, "Repeating same snapshot must not advance cursor");
      assert.equal(repeatRead.newlyReadCount, 0);
      assert.equal(repeatRead.lastReadMessageId, msgId2);
      assert.equal(repeatRead.unreadRemaining, 1);

      // Staff A advances to read msg3 as well
      const read3 = await markConversationRead(pool, staffIdA, {
        conversationId: multiMsgConvId,
        acknowledgedMessageIds: [msgId1, msgId2, msgId3],
        lastReadMessageId: msgId3,
      });
      assert.equal(read3.advanced, true);
      assert.equal(read3.newlyReadCount, 1);
      assert.equal(read3.lastReadMessageId, msgId3);
      assert.equal(read3.unreadRemaining, 0);

      // 2. Marking an older snapshot (msg1, msg2) does NOT move cursor backward or erase progress
      const olderRead = await markConversationRead(pool, staffIdA, {
        conversationId: multiMsgConvId,
        acknowledgedMessageIds: [msgId1, msgId2],
        lastReadMessageId: msgId2,
      });
      assert.equal(olderRead.advanced, false, "Marking older snapshot must not advance or retreat cursor");
      assert.equal(olderRead.newlyReadCount, 0);
      assert.equal(olderRead.lastReadMessageId, msgId3, "Cursor in response must remain winning state (msg3)");
      assert.equal(olderRead.unreadRemaining, 0);

      // Verify Staff A's detail view still has all messages marked read
      const detailA = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.equal(detailA?.messages[0].isRead, true);
      assert.equal(detailA?.messages[1].isRead, true);
      assert.equal(detailA?.messages[2].isRead, true, "msg3 must still remain marked as read");
      assert.equal(detailA?.unreadCount, 0);
    });

    // =========================================================================
    // Concurrency Lifecycle Harness for AC 7.1, AC 7.2, and AC 7.3
    // Protects connection acquisition, PID discovery, timeout-bounded barrier wait with immediate
    // abort on pre-barrier failure, bounded post-barrier wait, unconditional barrier unblocking in finally,
    // safe connection destruction on error/timeout, and combined error reporting.
    // =========================================================================
    interface ConcurrentHarnessInput {
      convId: string;
      staffId: string;
      msg1: string;
      msg2: string;
      msg3: string;
      injectFaultOnConn1BeforeBarrier?: (client: PoolClient) => Queryable;
      injectQueryWrapperOnConn1?: (client: PoolClient) => Queryable;
      injectQueryWrapperOnConn2?: (client: PoolClient) => Queryable;
      postBarrierTimeoutMs?: number;
      settleTimeoutMs?: number;
      onBeforeSettleCleanup?: () => Promise<void> | void;
    }

    interface ConcurrentHarnessOutput {
      req1Result?: MarkConversationReadResult;
      req2Result?: MarkConversationReadResult;
      req1Error?: Error;
      req2Error?: Error;
      caughtHarnessError?: Error;
      pid1?: number;
      pid2?: number;
      conn1InTx: boolean;
      barrierReached: boolean;
      barrierReleased: boolean;
      verifiedOverlap: boolean;
      barrierAborted: boolean;
      postBarrierTimedOut: boolean;
      client1Destroyed: boolean;
      client2Destroyed: boolean;
      allSettled: boolean;
      settlementResults?: PromiseSettledResult<MarkConversationReadResult>[];
      req1Promise?: Promise<MarkConversationReadResult>;
      req2Promise?: Promise<MarkConversationReadResult>;
    }

    async function runConcurrentMarkReadHarness(
      input: ConcurrentHarnessInput
    ): Promise<ConcurrentHarnessOutput> {
      let client1: PoolClient | null = null;
      let client2: PoolClient | null = null;
      let client1Broken = false;
      let client2Broken = false;
      let conn1InTx = false;
      let barrierReached = false;
      let barrierReleased = false;
      let verifiedOverlap = false;
      let barrierAborted = false;
      let postBarrierTimedOut = false;

      let conn1EnteredBarrierResolve: () => void = () => {};
      let conn1EnteredBarrierReject: (err: unknown) => void = () => {};
      const conn1EnteredBarrier = new Promise<void>((resolve, reject) => {
        conn1EnteredBarrierResolve = resolve;
        conn1EnteredBarrierReject = reject;
      });

      let conn1CanCommitResolve: () => void = () => {};
      const conn1CanCommit = new Promise<void>((resolve) => {
        conn1CanCommitResolve = resolve;
      });

      let req1Promise: Promise<MarkConversationReadResult> | undefined;
      let req2Promise: Promise<MarkConversationReadResult> | undefined;
      let req1Result: MarkConversationReadResult | undefined;
      let req2Result: MarkConversationReadResult | undefined;
      let req1Error: Error | undefined;
      let req2Error: Error | undefined;
      let caughtHarnessError: Error | undefined;
      let pid1: number | undefined;
      let pid2: number | undefined;
      let client1Destroyed = false;
      let client2Destroyed = false;
      let allSettled = false;
      let settlementResults: PromiseSettledResult<MarkConversationReadResult>[] | undefined;

      try {
        // Protect acquisition of both connections and PID queries from the start
        client1 = await pool.connect();
        client2 = await pool.connect();

        const pid1Res = await client1.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const pid2Res = await client2.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        pid1 = pid1Res.rows[0].pid;
        pid2 = pid2Res.rows[0].pid;

        const effectiveClient1: Queryable = input.injectFaultOnConn1BeforeBarrier
          ? input.injectFaultOnConn1BeforeBarrier(client1)
          : input.injectQueryWrapperOnConn1
          ? input.injectQueryWrapperOnConn1(client1)
          : client1;

        const effectiveClient2: Queryable = input.injectQueryWrapperOnConn2
          ? input.injectQueryWrapperOnConn2(client2)
          : client2;

        // Launch Request 1 on effectiveClient1 acknowledging [msg1, msg2, msg3]
        req1Promise = markConversationRead(
          effectiveClient1,
          input.staffId,
          {
            conversationId: input.convId,
            acknowledgedMessageIds: [input.msg1, input.msg2, input.msg3],
            lastReadMessageId: input.msg3,
          },
          {
            onBeforeCommit: async () => {
              conn1InTx = true;
              barrierReached = true;
              conn1EnteredBarrierResolve();
              await conn1CanCommit;
            },
          }
        )
          .then((r) => {
            req1Result = r;
            return r;
          })
          .catch((err) => {
            req1Error = err instanceof Error ? err : new Error(String(err));
            // Abort barrier wait immediately if req1 throws before or during barrier
            conn1EnteredBarrierReject(err);
            throw err;
          });

        // Register immediate rejection handler so Node doesn't emit unhandledRejection
        req1Promise.catch(() => {});

        // Wait for Connection 1 to reach barrier with timeout AND early abort on req1 error
        const barrierTimeoutMs = 3000;
        let barrierTimer: NodeJS.Timeout | undefined;
        const barrierTimeoutPromise = new Promise<never>((_, reject) => {
          barrierTimer = setTimeout(() => {
            reject(new Error("BARRIER_TIMEOUT: Connection 1 did not reach barrier within 3000ms"));
          }, barrierTimeoutMs);
        });

        try {
          await Promise.race([conn1EnteredBarrier, barrierTimeoutPromise]);
        } catch (barrierErr) {
          barrierAborted = true;
          throw barrierErr;
        } finally {
          if (barrierTimer) clearTimeout(barrierTimer);
        }

        // Barrier reached successfully: Connection 1 is inside tx holding advisory lock.
        // Launch Request 2 on effectiveClient2 acknowledging older snapshot [msg1, msg2]
        req2Promise = markConversationRead(
          effectiveClient2,
          input.staffId,
          {
            conversationId: input.convId,
            acknowledgedMessageIds: [input.msg1, input.msg2],
            lastReadMessageId: input.msg2,
          }
        )
          .then((r) => {
            req2Result = r;
            return r;
          })
          .catch((err) => {
            req2Error = err instanceof Error ? err : new Error(String(err));
            throw err;
          });

        // Register immediate rejection handler so Node doesn't emit unhandledRejection
        req2Promise.catch(() => {});

        // Query pg_locks to verify client2 (pid2) is actively blocked waiting on client1 (pid1)
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const lockCheck = await pool.query<{ count: string }>(`
            SELECT COUNT(*)::integer AS count
            FROM pg_locks l_blocked
            JOIN pg_locks l_holding
              ON l_blocked.locktype = l_holding.locktype
             AND l_blocked.classid = l_holding.classid
             AND l_blocked.objid = l_holding.objid
            WHERE l_blocked.pid = $1
              AND l_holding.pid = $2
              AND NOT l_blocked.granted
              AND l_holding.granted
          `, [pid2, pid1]);
          if (Number(lockCheck.rows[0].count) >= 1) {
            verifiedOverlap = true;
            break;
          }
          await new Promise((res) => setTimeout(res, 20));
        }

        // Release Connection 1 to commit
        barrierReleased = true;
        conn1CanCommitResolve();

        // Bounded wait for both requests after barrier release
        const postBarrierTimeoutMs = input.postBarrierTimeoutMs ?? 3000;
        let postBarrierTimer: NodeJS.Timeout | undefined;
        let didPostBarrierTimeoutFired = false;
        const postBarrierTimeoutPromise = new Promise<never>((_, reject) => {
          postBarrierTimer = setTimeout(() => {
            didPostBarrierTimeoutFired = true;
            reject(
              new Error(
                `POST_BARRIER_TIMEOUT: Concurrent requests did not complete within ${postBarrierTimeoutMs}ms after barrier release`
              )
            );
          }, postBarrierTimeoutMs);
        });

        try {
          await Promise.race([
            Promise.all([req1Promise, req2Promise]),
            postBarrierTimeoutPromise,
          ]);
        } catch (postBarrierErr) {
          if (didPostBarrierTimeoutFired) {
            postBarrierTimedOut = true;
            if (!req1Result && !req1Error) {
              client1Broken = true;
            }
            client2Broken = true;
          } else {
            postBarrierTimedOut = false;
            // Preserving original query error from req1 or req2 without marking as timeout
            if (req1Error) client1Broken = true;
            if (req2Error) client2Broken = true;
          }
          throw postBarrierErr;
        } finally {
          if (postBarrierTimer) clearTimeout(postBarrierTimer);
        }
      } catch (err) {
        caughtHarnessError = err as Error;
        // Mark client1 broken if an error occurred during its execution so it is destroyed
        if (req1Error || input.injectFaultOnConn1BeforeBarrier) {
          client1Broken = true;
        }
        if (req2Error) {
          client2Broken = true;
        }
      } finally {
        const harnessCleanupErrors: Error[] = [];

        // 1. Unconditionally release barrier promises
        conn1EnteredBarrierResolve();
        conn1CanCommitResolve();

        // 2. Invoke pre-settlement cleanup hook before waiting for final settlement
        if (input.onBeforeSettleCleanup) {
          try {
            await input.onBeforeSettleCleanup();
          } catch (cleanupHookErr) {
            harnessCleanupErrors.push(
              cleanupHookErr instanceof Error ? cleanupHookErr : new Error(String(cleanupHookErr))
            );
          }
        }

        // 3. Connections that are broken or active at timeout must be cancelled/destroyed immediately
        client1Destroyed = false;
        client2Destroyed = false;

        if (client1Broken && client1) {
          try {
            client1.release(true);
            client1Destroyed = true;
          } catch (relErr) {
            harnessCleanupErrors.push(
              relErr instanceof Error ? relErr : new Error(String(relErr))
            );
          }
          client1 = null;
        }

        if (client2Broken && client2) {
          try {
            client2.release(true);
            client2Destroyed = true;
          } catch (relErr) {
            harnessCleanupErrors.push(
              relErr instanceof Error ? relErr : new Error(String(relErr))
            );
          }
          client2 = null;
        }

        // 4. Wait for actual request promises via Promise.allSettled with a bounded timer that is cleared on completion
        const pending = [req1Promise, req2Promise].filter((p): p is Promise<MarkConversationReadResult> => Boolean(p));
        allSettled = false;
        settlementResults = [];

        if (pending.length > 0) {
          const settleTimeoutMs = input.settleTimeoutMs ?? 2000;
          let settleTimer: NodeJS.Timeout | undefined;
          try {
            const settlePromise = Promise.allSettled(pending);
            const timeoutPromise = new Promise<"settle_timeout">((res) => {
              settleTimer = setTimeout(() => res("settle_timeout"), settleTimeoutMs);
            });
            const raceResult = await Promise.race([
              settlePromise.then((results) => ({ kind: "settled" as const, results })),
              timeoutPromise.then((kind) => ({ kind })),
            ]);
            if (raceResult.kind === "settled") {
              allSettled = true;
              settlementResults = raceResult.results;
            } else {
              allSettled = false;
              harnessCleanupErrors.push(
                new Error(
                  `CLEANUP_SETTLEMENT_TIMEOUT: Requests failed to settle within ${settleTimeoutMs}ms during harness cleanup`
                )
              );
            }
          } catch (settleErr) {
            allSettled = false;
            harnessCleanupErrors.push(
              settleErr instanceof Error ? settleErr : new Error(String(settleErr))
            );
          } finally {
            if (settleTimer) clearTimeout(settleTimer);
          }
        } else {
          allSettled = true;
          settlementResults = [];
        }

        // 5. If settlement still failed to complete, destroy any remaining connections immediately
        if (!allSettled) {
          if (client1) {
            try {
              client1.release(true);
              client1Destroyed = true;
            } catch (relErr) {
              harnessCleanupErrors.push(
                relErr instanceof Error ? relErr : new Error(String(relErr))
              );
            }
            client1 = null;
          }
          if (client2) {
            try {
              client2.release(true);
              client2Destroyed = true;
            } catch (relErr) {
              harnessCleanupErrors.push(
                relErr instanceof Error ? relErr : new Error(String(relErr))
              );
            }
            client2 = null;
          }
        }

        // 6. Healthy connections are only returned to the pool after all requests have settled
        if (client1) {
          try {
            client1.release();
          } catch (relErr) {
            harnessCleanupErrors.push(
              relErr instanceof Error ? relErr : new Error(String(relErr))
            );
          }
          client1 = null;
        }

        if (client2) {
          try {
            client2.release();
          } catch (relErr) {
            harnessCleanupErrors.push(
              relErr instanceof Error ? relErr : new Error(String(relErr))
            );
          }
          client2 = null;
        }

        // 7. Combine primary error and cleanup errors without masking
        if (harnessCleanupErrors.length > 0) {
          const combined = combineErrors(caughtHarnessError, harnessCleanupErrors);
          if (combined instanceof Error) {
            caughtHarnessError = combined;
          }
        }
      }

      return {
        req1Result,
        req2Result,
        req1Error,
        req2Error,
        caughtHarnessError,
        pid1,
        pid2,
        conn1InTx,
        barrierReached,
        barrierReleased,
        verifiedOverlap,
        barrierAborted,
        postBarrierTimedOut,
        client1Destroyed: client1Destroyed || client1Broken,
        client2Destroyed: client2Destroyed || client2Broken,
        allSettled,
        settlementResults,
        req1Promise,
        req2Promise,
      };
    }

    // =========================================================================
    // AC 7.1 (4.g): Dua request penandaan baca benar-benar overlap pada koneksi berbeda
    // dengan barrier deterministik dan verifikasi blocking di database
    // =========================================================================
    await t.test(
      "AC 7.1 (4.g): Two concurrent mark-read requests truly overlap on distinct connections with deterministic barrier",
      async () => {
        const concChatId = `chat_conc_${runId}`;

        // 1. Create conversation with 3 messages using receiveTrackedInboundFixture
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: concChatId,
          providerMessageId: "m_c1",
          text: "Pesan konkurensi 1",
        });
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: concChatId,
          providerMessageId: "m_c2",
          text: "Pesan konkurensi 2",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix2.ingressId);

        const fix3 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: concChatId,
          providerMessageId: "m_c3",
          text: "Pesan konkurensi 3",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix3.ingressId);

        const msg1 = fix1.ingressId;
        const msg2 = fix2.ingressId;
        const msg3 = fix3.ingressId;

        // Run concurrent harness without fault injection (success path)
        const outcome = await runConcurrentMarkReadHarness({
          convId,
          staffId: staffIdA,
          msg1,
          msg2,
          msg3,
        });

        if (outcome.caughtHarnessError) throw outcome.caughtHarnessError;

        assert.equal(outcome.conn1InTx, true, "Connection 1 must be inside transaction holding lock");
        assert.equal(outcome.barrierReached, true, "Barrier must be reached");
        assert.equal(outcome.barrierReleased, true, "Barrier must be released");
        assert.equal(outcome.postBarrierTimedOut, false, "Must not time out after barrier");
        assert.equal(outcome.allSettled, true, "All requests must be settled");
        assert.equal(outcome.client1Destroyed, false, "Connection 1 must not be destroyed");
        assert.equal(outcome.client2Destroyed, false, "Connection 2 must not be destroyed");
        assert.equal(
          outcome.verifiedOverlap,
          true,
          `EMPIRICAL PROOF: Connection 2 (PID ${outcome.pid2}) must be actively blocked waiting on advisory lock held by Connection 1 (PID ${outcome.pid1})`
        );

        assert.ok(outcome.req1Result);
        assert.ok(outcome.req2Result);

        // Assert response semantics:
        // Request 1 committed first: advanced = true, newlyReadCount = 3, cursor = msg3
        assert.equal(outcome.req1Result.advanced, true);
        assert.equal(outcome.req1Result.newlyReadCount, 3);
        assert.equal(outcome.req1Result.lastReadMessageId, msg3);
        assert.equal(outcome.req1Result.unreadRemaining, 0);

        // Request 2 ran second: all its messages were already read!
        // MUST NOT advance, MUST NOT return losing cursor msg2! Returns winning cursor msg3!
        assert.equal(outcome.req2Result.advanced, false, "Request 2 messages were already read; advanced must be false");
        assert.equal(outcome.req2Result.newlyReadCount, 0, "No new messages read by Request 2");
        assert.equal(
          outcome.req2Result.lastReadMessageId,
          msg3,
          "Request 2 MUST NOT return losing cursor msg2; must return current winning cursor msg3"
        );
        assert.equal(outcome.req2Result.unreadRemaining, 0);

        // Database state verification
        const readsInDb = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(Number(readsInDb.rows[0].count), 3, "All 3 messages must remain read in DB");

        const cursorInDb = await pool.query<{ last_read_message_id: string }>(
          "SELECT last_read_message_id FROM public.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(cursorInDb.rows[0].last_read_message_id, msg3);
      }
    );

    // =========================================================================
    // AC 7.2: Controlled failure on Connection 1 before reaching barrier cleanly aborts barrier wait, executes finally, and releases/destroys connections
    // =========================================================================
    await t.test(
      "AC 7.2: Controlled failure on Connection 1 before reaching barrier cleanly aborts barrier wait, executes finally, and releases/destroys connections",
      async () => {
        const failChatId = `chat_cfail_${runId}`;

        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: failChatId,
          providerMessageId: "m_cf1",
          text: "Pesan kegagalan sebelum barrier 1",
        });
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: failChatId,
          providerMessageId: "m_cf2",
          text: "Pesan kegagalan sebelum barrier 2",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix2.ingressId);

        const plannedLockError = new Error(
          "PLANNED_CONCURRENT_LOCK_FAILURE: Simulated database failure while acquiring pg_advisory_xact_lock"
        );

        // Run the SAME concurrent harness with fault injection on Connection 1 before reaching barrier
        const outcome = await runConcurrentMarkReadHarness({
          convId,
          staffId: staffIdA,
          msg1: fix1.ingressId,
          msg2: fix2.ingressId,
          msg3: fix2.ingressId,
          injectFaultOnConn1BeforeBarrier: (client) => {
            return new Proxy(client, {
              get(target, prop, receiver) {
                if (prop === "query") {
                  return function (this: unknown, textOrConfig: unknown, values?: unknown, cb?: unknown) {
                    const sqlText =
                      typeof textOrConfig === "string"
                        ? textOrConfig
                        : (textOrConfig as { text?: string })?.text ?? "";
                    if (sqlText.includes("pg_advisory_xact_lock")) {
                      throw plannedLockError;
                    }
                    return Reflect.apply(target.query, target, [textOrConfig, values, cb]);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
          },
        });

        // 1. Verify specific error was caught
        assert.ok(outcome.caughtHarnessError, "Harness must report error");
        assert.equal(outcome.caughtHarnessError.message, plannedLockError.message);
        assert.equal(outcome.req1Error?.message, plannedLockError.message);

        // 2. Barrier wait was immediately aborted without hang
        assert.equal(outcome.barrierAborted, true, "Barrier wait must abort on Request 1 pre-barrier failure");
        assert.equal(outcome.barrierReached, false, "Connection 1 must not have reached onBeforeCommit barrier");
        assert.equal(outcome.barrierReleased, false, "Barrier must not be released");
        assert.equal(outcome.postBarrierTimedOut, false, "Must not be post-barrier timeout");
        assert.equal(outcome.conn1InTx, false, "Connection 1 must not have reached onBeforeCommit barrier");

        // 3. Request 2 was never launched
        assert.equal(outcome.req2Result, undefined, "Request 2 must not be launched when Request 1 fails before barrier");

        // 4. Connection 1 was marked destroyed and discarded from pool, Connection 2 was never launched
        assert.equal(outcome.client1Destroyed, true, "Failing Connection 1 must be destroyed/discarded rather than returned healthy");
        assert.equal(outcome.client2Destroyed, false, "Connection 2 was never launched and must not be destroyed");
        assert.equal(outcome.allSettled, true, "Requests must be marked settled");

        // 5. Database transaction was rolled back: 0 read records created
        const dbCheck = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(Number(dbCheck.rows[0].count), 0, "No read rows must be committed after pre-barrier failure");
      }
    );

    // =========================================================================
    // =========================================================================
    // AC 7.3: Controlled timeout after barrier release cleanly reports POST_BARRIER_TIMEOUT,
    // executes finally, destroys active connections, and proves actual request promise settlement
    // =========================================================================
    await t.test(
      "AC 7.3: Controlled timeout after barrier release cleanly reports POST_BARRIER_TIMEOUT, executes finally, destroys active connections, and leaves zero dangling requests",
      async () => {
        const toChatId = `chat_cto_${runId}`;

        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: toChatId,
          providerMessageId: "m_to1",
          text: "Pesan timeout setelah barrier 1",
        });
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: toChatId,
          providerMessageId: "m_to2",
          text: "Pesan timeout setelah barrier 2",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix2.ingressId);

        const fix3 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: toChatId,
          providerMessageId: "m_to3",
          text: "Pesan timeout setelah barrier 3",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix3.ingressId);

        const cancelError = new Error("POST_BARRIER_INJECTION_CANCELLED_ON_TEARDOWN");
        let cancelHang: ((err: Error) => void) | undefined;
        let hangTriggered = false;

        const hangPromise = new Promise<void>((_, reject) => {
          cancelHang = reject;
        });

        let outcome: ConcurrentHarnessOutput | undefined;

        try {
          outcome = await runConcurrentMarkReadHarness({
            convId,
            staffId: staffIdA,
            msg1: fix1.ingressId,
            msg2: fix2.ingressId,
            msg3: fix3.ingressId,
            postBarrierTimeoutMs: 300,
            settleTimeoutMs: 1000,
            onBeforeSettleCleanup: () => {
              // Unblock/cancel injection during harness cleanup prior to final settlement wait
              if (cancelHang) {
                cancelHang(cancelError);
              }
            },
            injectQueryWrapperOnConn2: (client) => {
              return new Proxy(client, {
                get(target, prop, receiver) {
                  if (prop === "query") {
                    return async function (this: unknown, textOrConfig: unknown, values?: unknown, cb?: unknown) {
                      const sqlText =
                        typeof textOrConfig === "string"
                          ? textOrConfig
                          : (textOrConfig as { text?: string })?.text ?? "";
                      if (
                        sqlText.includes("staff_conversation_reads") ||
                        sqlText.includes("staff_message_reads")
                      ) {
                        hangTriggered = true;
                        await hangPromise;
                      }
                      return Reflect.apply(target.query, target, [textOrConfig, values, cb]);
                    };
                  }
                  return Reflect.get(target, prop, receiver);
                },
              });
            },
          });

          // 1. Verify timeout error was reported explicitly to test caller without cleanup error masking
          assert.ok(outcome.caughtHarnessError, "Harness must report error");
          assert.match(
            outcome.caughtHarnessError.message,
            /POST_BARRIER_TIMEOUT/,
            "Harness error must be an explicit POST_BARRIER_TIMEOUT"
          );
          assert.doesNotMatch(
            outcome.caughtHarnessError.message,
            /CLEANUP_SETTLEMENT_TIMEOUT/,
            "Cleanup mechanism must succeed without timing out"
          );

          // 2. Barrier was reached and released before the timeout occurred
          assert.equal(outcome.barrierReached, true, "Barrier must have been reached before timeout");
          assert.equal(outcome.barrierReleased, true, "Barrier must have been released before timeout");
          assert.equal(outcome.postBarrierTimedOut, true, "postBarrierTimedOut must be true");
          assert.equal(hangTriggered, true, "Held query injection must have been triggered after barrier release");

          // 3. Active connection still running work at timeout was destroyed (not returned healthy to pool)
          assert.equal(
            outcome.client2Destroyed,
            true,
            "Active connection 2 must be destroyed on post-barrier timeout"
          );

          // 4. Prove settlement of actual request promises
          assert.equal(outcome.allSettled, true, "All requests must have settled during harness cleanup");
          assert.ok(outcome.req1Promise, "req1Promise must exist");
          assert.ok(outcome.req2Promise, "req2Promise must exist");

          const actualSettlements = await Promise.allSettled([
            outcome.req1Promise,
            outcome.req2Promise,
          ]);
          assert.equal(actualSettlements[0].status, "fulfilled", "Request 1 must be fulfilled");
          assert.equal(
            actualSettlements[1].status,
            "rejected",
            "Request 2 must be settled as rejected due to cancellation"
          );
          assert.equal(
            (actualSettlements[1] as PromiseRejectedResult).reason?.message,
            cancelError.message,
            "Request 2 rejection reason must be the deliberate cancellation error, distinct from cleanup mechanism failure"
          );
        } finally {
          if (cancelHang) {
            try {
              cancelHang(cancelError);
            } catch {}
          }
        }
      }
    );

    // =========================================================================
    // AC 7.4: Controlled query failure on Connection 2 after barrier release preserves
    // original query error, reports postBarrierTimedOut = false, executes cleanup, and settles all requests
    // =========================================================================
    await t.test(
      "AC 7.4: Controlled query failure on Connection 2 after barrier release preserves original query error, reports postBarrierTimedOut = false, executes cleanup, and settles all requests",
      async () => {
        const failChatId = `chat_cqerr_${runId}`;

        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: failChatId,
          providerMessageId: "m_qerr1",
          text: "Pesan error query setelah barrier 1",
        });
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: failChatId,
          providerMessageId: "m_qerr2",
          text: "Pesan error query setelah barrier 2",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix2.ingressId);

        const fix3 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: failChatId,
          providerMessageId: "m_qerr3",
          text: "Pesan error query setelah barrier 3",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix3.ingressId);

        const plannedPostBarrierQueryError = new Error(
          "PLANNED_POST_BARRIER_QUERY_FAILURE: Simulated database query error on Connection 2 after barrier release"
        );

        let queryErrorTriggered = false;

        const outcome = await runConcurrentMarkReadHarness({
          convId,
          staffId: staffIdA,
          msg1: fix1.ingressId,
          msg2: fix2.ingressId,
          msg3: fix3.ingressId,
          postBarrierTimeoutMs: 3000,
          settleTimeoutMs: 1000,
          injectQueryWrapperOnConn2: (client) => {
            return new Proxy(client, {
              get(target, prop, receiver) {
                if (prop === "query") {
                  return function (this: unknown, textOrConfig: unknown, values?: unknown, cb?: unknown) {
                    const sqlText =
                      typeof textOrConfig === "string"
                        ? textOrConfig
                        : (textOrConfig as { text?: string })?.text ?? "";
                    if (
                      sqlText.includes("staff_conversation_reads") ||
                      sqlText.includes("staff_message_reads")
                    ) {
                      queryErrorTriggered = true;
                      throw plannedPostBarrierQueryError;
                    }
                    return Reflect.apply(target.query, target, [textOrConfig, values, cb]);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            });
          },
        });

        // 1. Verify original query error is preserved and forwarded (NOT converted to timeout)
        assert.ok(outcome.caughtHarnessError, "Harness must report error");
        assert.equal(
          outcome.caughtHarnessError.message,
          plannedPostBarrierQueryError.message,
          "Harness must report the original query error, NOT a timeout"
        );
        assert.equal(
          outcome.req2Error?.message,
          plannedPostBarrierQueryError.message,
          "Request 2 error must match the injected query error"
        );

        // 2. Timeout flag must be false since failure was a query rejection, not a timeout expiration
        assert.equal(
          outcome.postBarrierTimedOut,
          false,
          "postBarrierTimedOut must remain false when rejection is caused by query failure"
        );

        // 3. Barrier was reached, overlap verified, and barrier released before failure occurred
        assert.equal(outcome.barrierReached, true, "Barrier must be reached");
        assert.equal(outcome.barrierReleased, true, "Barrier must be released");
        assert.equal(outcome.verifiedOverlap, true, "Overlap must have been verified in pg_locks");
        assert.equal(queryErrorTriggered, true, "Injected query error must have been triggered");

        // 4. Request 1 succeeded and committed before Connection 2 hit error
        assert.ok(outcome.req1Result, "Request 1 must succeed and return result");
        assert.equal(outcome.req1Result.advanced, true);
        assert.equal(outcome.req1Result.newlyReadCount, 3);
        assert.equal(outcome.req1Result.lastReadMessageId, fix3.ingressId);

        // 5. Connection 2 (which encountered the query error) was destroyed and discarded from pool
        assert.equal(
          outcome.client2Destroyed,
          true,
          "Connection 2 encountering query error must be destroyed"
        );

        // 6. Prove all request promises are settled
        assert.equal(outcome.allSettled, true, "All requests must be settled during harness cleanup");
        assert.ok(outcome.req1Promise, "req1Promise must exist");
        assert.ok(outcome.req2Promise, "req2Promise must exist");

        const actualSettlements = await Promise.allSettled([
          outcome.req1Promise,
          outcome.req2Promise,
        ]);
        assert.equal(actualSettlements[0].status, "fulfilled", "Request 1 must be fulfilled");
        assert.equal(actualSettlements[1].status, "rejected", "Request 2 must be rejected");
        assert.equal(
          (actualSettlements[1] as PromiseRejectedResult).reason?.message,
          plannedPostBarrierQueryError.message,
          "Request 2 rejection reason must be the original planned query error"
        );

        // 7. Verify DB state: Request 1 committed 3 reads, Request 2 was rolled back
        const readsInDb = await pool.query<{ count: string }>(
          "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(Number(readsInDb.rows[0].count), 3, "All 3 messages read by Request 1 remain in DB");

        const cursorInDb = await pool.query<{ last_read_message_id: string }>(
          "SELECT last_read_message_id FROM public.staff_conversation_reads WHERE staff_id = $1 AND conversation_id = $2",
          [staffIdA, convId]
        );
        assert.equal(cursorInDb.rows[0].last_read_message_id, fix3.ingressId);
      }
    );

    // =========================================================================
    // AC 8: Pesan baru yang datang bersamaan tidak ikut tertelan
    // =========================================================================
    await t.test("AC 8: Concurrent new messages arriving after read mark remain unread", async () => {
      const multiChatId = `multi_${runId}`;
      const t3 = new Date("2026-10-04T05:30:00.000Z");

      // New message 4 arrives
      const r4 = makeReceipt(multiChatId, "m4", "Tolong segera dicek ya kak");
      const ing4 = await persistence.receive(r4);
      tracker.recordIngress(ing4.ingressId);
      tracker.recordMessage(ing4.ingressId);
      await pool.query("UPDATE public.ingress_events SET received_at = $1 WHERE id = $2", [t3.toISOString(), ing4.ingressId]);
      await persistence.process(ing4.ingressId);
      const msgId4 = ing4.ingressId;

      // Staff A had read up to msg3; msg4 is unread -> unreadCount must now be 1
      const detailA = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.equal(detailA?.messages.length, 4);
      assert.equal(detailA?.unreadCount, 1, "Concurrent new messages must not be swallowed; unreadCount must be 1");
      assert.equal(detailA?.messages[0].isRead, true);
      assert.equal(detailA?.messages[1].isRead, true);
      assert.equal(detailA?.messages[2].isRead, true);
      assert.equal(detailA?.messages[3].isRead, false);

      // Now Staff A marks msg4 as read
      const readResultAll = await markConversationRead(pool, staffIdA, {
        conversationId: multiMsgConvId,
        acknowledgedMessageIds: [msgId1, msgId2, msgId3, msgId4],
        lastReadMessageId: msgId4,
      });
      assert.equal(readResultAll.advanced, true);
      assert.equal(readResultAll.unreadRemaining, 0);

      const detailAAfter = await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      assert.equal(detailAAfter?.unreadCount, 0);
      assert.equal(detailAAfter?.isUnread, false);
    });

    // =========================================================================
    // AC 8.1 (4.h): Pesan yang muncul antara pengambilan snapshot dan penandaan baca tetap unread
    // =========================================================================
    await t.test(
      "AC 8.1 (4.h): Message appearing between snapshot fetch and mark-read remains unread",
      async () => {
        const snapChatId = `chat_snap_${runId}`;

        // 1. Initial messages 1 and 2 arrive using tracked fixtures
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapChatId,
          providerMessageId: "m_s1",
          text: "Pesan snapshot 1",
        });
        await persistence.process(fix1.ingressId);

        const convRes = await pool.query<{ conversation_id: string }>(
          "SELECT conversation_id FROM public.messages WHERE id = $1",
          [fix1.ingressId]
        );
        const convId = convRes.rows[0].conversation_id;
        tracker.recordConversation(convId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapChatId,
          providerMessageId: "m_s2",
          text: "Pesan snapshot 2",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix2.ingressId);

        // 2. Staff A fetches snapshot S (contains [fix1, fix2])
        const snapshot = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(snapshot);
        assert.equal(snapshot.messages.length, 2);
        assert.equal(snapshot.unreadCount, 2);

        // 3. New message 3 arrives BETWEEN snapshot fetch and mark-read request
        const fix3 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapChatId,
          providerMessageId: "m_s3",
          text: "Pesan tiba setelah snapshot",
          existingIdentityId: fix1.identityId,
        });
        await persistence.process(fix3.ingressId);

        // 4. Staff A marks read acknowledging only the messages from snapshot S ([fix1, fix2])
        const markRes = await markConversationRead(pool, staffIdA, {
          conversationId: convId,
          acknowledgedMessageIds: snapshot.messages.map((m) => m.id),
          lastReadMessageId: snapshot.messages[snapshot.messages.length - 1].id,
        });

        assert.equal(markRes.advanced, true);
        assert.equal(markRes.newlyReadCount, 2);
        assert.equal(markRes.unreadRemaining, 1, "Message 3 arriving after snapshot must remain unread!");

        // 5. Staff A reloads detail: fix1 & fix2 are read, fix3 IS UNREAD
        const detailAfter = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailAfter);
        assert.equal(detailAfter.messages.length, 3);
        assert.equal(detailAfter.unreadCount, 1);
        assert.equal(detailAfter.isUnread, true);

        const m1 = detailAfter.messages.find((m) => m.id === fix1.ingressId);
        const m2 = detailAfter.messages.find((m) => m.id === fix2.ingressId);
        const m3 = detailAfter.messages.find((m) => m.id === fix3.ingressId);
        assert.equal(m1?.isRead, true);
        assert.equal(m2?.isRead, true);
        assert.equal(m3?.isRead, false, "Message 3 appearing after snapshot MUST REMAIN UNREAD");
      }
    );

    // =========================================================================
    // AC 9: Membaca pesan tidak mengubah status episode atau menghentikan automation
    // =========================================================================
    await t.test("AC 9: Reading messages does not alter episode status or automation settings", async () => {
      // Find the complaint associated with multiMsgConvId
      const compRes = await pool.query<{ id: string; status: string; automation_suppressed: boolean }>(
        `SELECT c.id, c.status, c.automation_suppressed
         FROM public.complaints c
         JOIN public.messages m ON m.complaint_id = c.id
         WHERE m.conversation_id = $1
         LIMIT 1`,
        [multiMsgConvId]
      );
      assert.ok(compRes.rows[0], "Complaint must exist for connection complaint");
      const compBefore = compRes.rows[0];

      const settingsBefore = (
        await pool.query<{ mode: string; emergency_stop: boolean; version: number }>(
          "SELECT mode, emergency_stop, version FROM public.automation_settings WHERE singleton"
        )
      ).rows[0];

      // Mark read again
      await markConversationRead(pool, staffIdB, {
        conversationId: multiMsgConvId,
        lastReadMessageId: msgId1,
      });

      // Verify complaint is unchanged
      const compAfter = (
        await pool.query<{ id: string; status: string; automation_suppressed: boolean }>(
          "SELECT id, status, automation_suppressed FROM public.complaints WHERE id = $1",
          [compBefore.id]
        )
      ).rows[0];
      assert.equal(compAfter.status, compBefore.status, "Complaint status must remain unchanged");
      assert.equal(compAfter.automation_suppressed, compBefore.automation_suppressed, "Automation suppression must not change");

      // Verify automation settings are unchanged
      const settingsAfter = (
        await pool.query<{ mode: string; emergency_stop: boolean; version: number }>(
          "SELECT mode, emergency_stop, version FROM public.automation_settings WHERE singleton"
        )
      ).rows[0];
      assert.equal(settingsAfter.mode, settingsBefore.mode);
      assert.equal(settingsAfter.emergency_stop, settingsBefore.emergency_stop);
      assert.equal(settingsAfter.version, settingsBefore.version);

      // Verify no outbound intents were created
      const outboundRes = await pool.query<{ count: string }>(
        "SELECT count(*) FROM public.outbound_intents WHERE staff_id = $1",
        [staffIdB]
      );
      assert.equal(Number(outboundRes.rows[0].count), 0, "Reading message must never create outbound intents");
    });

    // =========================================================================
    // AC 10: GET endpoints dan polling tidak memutasi database
    // =========================================================================
    await t.test("AC 10: GET list and detail queries are strictly read-only", async () => {
      // Snapshot reads table before GETs
      const readsBefore = (
        await pool.query("SELECT * FROM public.staff_conversation_reads WHERE conversation_id = $1", [multiMsgConvId])
      ).rows;

      // Execute GET list and detail repeatedly
      for (let i = 0; i < 5; i++) {
        await listInboxConversations(pool, staffIdA, { page: 1, limit: 10 });
        await getInboxConversationDetail(pool, staffIdA, multiMsgConvId);
      }

      // Snapshot reads table after GETs
      const readsAfter = (
        await pool.query("SELECT * FROM public.staff_conversation_reads WHERE conversation_id = $1", [multiMsgConvId])
      ).rows;

      assert.deepEqual(readsAfter, readsBefore, "GET list and detail must produce zero database mutations");
    });

    // =========================================================================
    // AC 1.1: Bukti Izin Peran Database (Database Role Permission Proof)
    // Membuktikan bahwa role 'authenticated' ditolak mutasi langsung (INSERT/UPDATE/DELETE)
    // dan hanya memiliki izin SELECT pada tabel public.staff_conversation_reads.
    // =========================================================================
    await t.test(
      "AC 1.1: Database Role Permission Proof: authenticated role is denied direct INSERT/UPDATE/DELETE",
      async () => {
        // 1. Verifikasi hak istimewa tabel via has_table_privilege
        const privCheck = await pool.query<{
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          anon_select: boolean;
          anon_insert: boolean;
        }>(`
          SELECT
            has_table_privilege('authenticated', 'public.staff_conversation_reads', 'SELECT') AS can_select,
            has_table_privilege('authenticated', 'public.staff_conversation_reads', 'INSERT') AS can_insert,
            has_table_privilege('authenticated', 'public.staff_conversation_reads', 'UPDATE') AS can_update,
            has_table_privilege('authenticated', 'public.staff_conversation_reads', 'DELETE') AS can_delete,
            has_table_privilege('anon', 'public.staff_conversation_reads', 'SELECT') AS anon_select,
            has_table_privilege('anon', 'public.staff_conversation_reads', 'INSERT') AS anon_insert
        `);

        const p = privCheck.rows[0];
        assert.equal(p.can_select, true, "authenticated role must be able to SELECT");
        assert.equal(p.can_insert, false, "authenticated role must be DENIED INSERT");
        assert.equal(p.can_update, false, "authenticated role must be DENIED UPDATE");
        assert.equal(p.can_delete, false, "authenticated role must be DENIED DELETE");
        assert.equal(p.anon_select, false, "anon role must be DENIED SELECT");
        assert.equal(p.anon_insert, false, "anon role must be DENIED INSERT");

        // 1.1 Verifikasi hak istimewa pada staff_message_reads
        const privCheckMsg = await pool.query<{
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          anon_select: boolean;
          anon_insert: boolean;
        }>(`
          SELECT
            has_table_privilege('authenticated', 'public.staff_message_reads', 'SELECT') AS can_select,
            has_table_privilege('authenticated', 'public.staff_message_reads', 'INSERT') AS can_insert,
            has_table_privilege('authenticated', 'public.staff_message_reads', 'UPDATE') AS can_update,
            has_table_privilege('authenticated', 'public.staff_message_reads', 'DELETE') AS can_delete,
            has_table_privilege('anon', 'public.staff_message_reads', 'SELECT') AS anon_select,
            has_table_privilege('anon', 'public.staff_message_reads', 'INSERT') AS anon_insert
        `);

        const pMsg = privCheckMsg.rows[0];
        assert.equal(pMsg.can_select, true, "authenticated role must be able to SELECT staff_message_reads");
        assert.equal(pMsg.can_insert, false, "authenticated role must be DENIED INSERT on staff_message_reads");
        assert.equal(pMsg.can_update, false, "authenticated role must be DENIED UPDATE on staff_message_reads");
        assert.equal(pMsg.can_delete, false, "authenticated role must be DENIED DELETE on staff_message_reads");
        assert.equal(pMsg.anon_select, false, "anon role must be DENIED SELECT on staff_message_reads");
        assert.equal(pMsg.anon_insert, false, "anon role must be DENIED INSERT on staff_message_reads");

        // 2. Eksekusi nyata dengan client yang beralih peran ke 'authenticated'
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE authenticated");
          await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [staffIdA]);

          // Percobaan direct INSERT sebagai authenticated -> WAJIB error 42501 (permission_denied)
          await client.query("SAVEPOINT sp_insert");
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO public.staff_conversation_reads (
                   staff_id, conversation_id, last_read_message_id, last_read_at
                 ) VALUES ($1, $2, $3, now())`,
                [staffIdA, nonComplaintConvId, nonComplaintMsgId]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct INSERT by authenticated must be rejected with permission_denied (42501)");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_insert");

          // Percobaan direct UPDATE sebagai authenticated -> WAJIB error 42501
          await client.query("SAVEPOINT sp_update");
          await assert.rejects(
            async () => {
              await client.query(
                "UPDATE public.staff_conversation_reads SET last_read_at = now() WHERE staff_id = $1",
                [staffIdA]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct UPDATE by authenticated must be rejected with permission_denied (42501)");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_update");

          // Percobaan direct DELETE sebagai authenticated -> WAJIB error 42501
          await client.query("SAVEPOINT sp_delete");
          await assert.rejects(
            async () => {
              await client.query(
                "DELETE FROM public.staff_conversation_reads WHERE staff_id = $1",
                [staffIdA]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct DELETE by authenticated must be rejected with permission_denied (42501)");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_delete");

          // Direct mutations pada staff_message_reads sebagai authenticated -> WAJIB error 42501
          await client.query("SAVEPOINT sp_insert_msg");
          await assert.rejects(
            async () => {
              await client.query(
                `INSERT INTO public.staff_message_reads (
                   staff_id, conversation_id, message_id
                 ) VALUES ($1, $2, $3)`,
                [staffIdA, nonComplaintConvId, nonComplaintMsgId]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct INSERT on staff_message_reads must be rejected with 42501");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_insert_msg");

          await client.query("SAVEPOINT sp_update_msg");
          await assert.rejects(
            async () => {
              await client.query(
                "UPDATE public.staff_message_reads SET read_at = now() WHERE staff_id = $1",
                [staffIdA]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct UPDATE on staff_message_reads must be rejected with 42501");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_update_msg");

          await client.query("SAVEPOINT sp_delete_msg");
          await assert.rejects(
            async () => {
              await client.query(
                "DELETE FROM public.staff_message_reads WHERE staff_id = $1",
                [staffIdA]
              );
            },
            (err: unknown) => {
              const pgErr = err as { code?: string };
              assert.equal(pgErr.code, "42501", "Direct DELETE on staff_message_reads must be rejected with 42501");
              return true;
            }
          );
          await client.query("ROLLBACK TO SAVEPOINT sp_delete_msg");

          // SELECT diperbolehkan di bawah RLS owner
          const selectRes = await client.query<{ count: string }>(
            "SELECT count(*) FROM public.staff_conversation_reads WHERE staff_id = $1",
            [staffIdA]
          );
          assert.ok(selectRes.rows);

          const selectMsgRes = await client.query<{ count: string }>(
            "SELECT count(*) FROM public.staff_message_reads WHERE staff_id = $1",
            [staffIdA]
          );
          assert.ok(selectMsgRes.rows);
        } finally {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore
          }
          client.release();
        }

        // 3. Verifikasi jalur backend tersertifikasi tetap berfungsi sukses
        const backendResult = await markConversationRead(pool, staffIdA, {
          conversationId: nonComplaintConvId,
          lastReadMessageId: nonComplaintMsgId,
        });
        assert.equal(backendResult.advanced, true, "Backend markConversationRead must succeed");
        assert.equal(backendResult.lastReadMessageId, nonComplaintMsgId);
      }
    );

    // =========================================================================
    // AC 1.2: Validasi Batas Pesan Percakapan (Cross-Conversation Boundary Check)
    // Membuktikan bahwa penandaan dibaca menolak pesan yang milik percakapan lain.
    // =========================================================================
    await t.test(
      "AC 1.2: Message boundary verification: cannot mark read using message from another conversation",
      async () => {
        // nonComplaintMsgId belongs to nonComplaintConvId, NOT to multiMsgConvId
        await assert.rejects(
          async () => {
            await markConversationRead(pool, staffIdA, {
              conversationId: multiMsgConvId,
              lastReadMessageId: nonComplaintMsgId,
            });
          },
          (err: unknown) => {
            const inboxErr = err as { code?: string; status?: number };
            assert.equal(inboxErr.code, "MESSAGE_NOT_FOUND");
            assert.equal(inboxErr.status, 404);
            return true;
          }
        );
      }
    );

    // =========================================================================
    // AC 11: Preservasi Fixture Pembanding & Bukti Cleanup Graph Lengkap
    // Membuktikan graph lengkap (conversation, message, assessment, episode, audit,
    // read state) terhapus tuntas dan data pembanding 6 tabel tetap terjaga utuh.
    // Seluruh tracker (target dan pembanding) dilindungi teardown mandiri pada finally.
    // =========================================================================
    await t.test(
      "AC 11: Comparator Baseline Preservation: full graph cleanup preserves separate comparator data without global delete",
      async () => {
        const compTracker = new TestResourceTracker();
        const targetTracker = new TestResourceTracker();
        let targetCleaned = false;
        let compCleaned = false;
        let ac11PrimaryError: Error | undefined;
        const ac11CleanupErrors: Error[] = [];

        try {
          const compRunId = randomUUID().slice(0, 8);
          const compSenderId = `comp_snd_${compRunId}`;

          // 1. Buat fixture pembanding berupa graph nyata terproses penuh via receiveTrackedInboundFixture
          const compFixture = await receiveTrackedInboundFixture(compTracker, {
            senderExternalId: compSenderId,
            providerMessageId: `comp_msg_${compRunId}`,
            text: "Koneksi internet terputus modem LOS merah",
          });
          const compIngress = { ingressId: compFixture.ingressId };

          await persistence.process(compIngress.ingressId);

          const compMsgRes = await pool.query<{ conversation_id: string; complaint_id: string | null }>(
            "SELECT conversation_id, complaint_id FROM public.messages WHERE id = $1",
            [compIngress.ingressId]
          );
          const compConvId = compMsgRes.rows[0].conversation_id;
          const compComplaintId = compMsgRes.rows[0].complaint_id;

          // Assert episode/complaint pembanding benar-benar terbentuk secara tanpa syarat
          assert.ok(compComplaintId, "Comparator message must create a complaint episode");
          compTracker.recordConversation(compConvId);
          compTracker.recordComplaint(compComplaintId);

          // Berikan kursor baca pembanding
          await markConversationRead(pool, staffIdB, {
            conversationId: compConvId,
            lastReadMessageId: compIngress.ingressId,
          });

          // Snapshot data pembanding sebelum cleanup target mencakup 6 tabel:
          // conversations, messages, complaints, staff_conversation_reads, triage_assessments, complaint_audit_log
          const compConvSnapshot = (
            await pool.query<{ id: string; channel: string; account_id: string; chat_id: string; status: string }>(
              "SELECT id, channel, account_id, chat_id, status FROM public.conversations WHERE id = $1",
              [compConvId]
            )
          ).rows[0];

          const compMsgSnapshot = (
            await pool.query<{ id: string; conversation_id: string; identity_id: string; complaint_id: string | null; review_reason: string | null }>(
              "SELECT id, conversation_id, identity_id, complaint_id, review_reason FROM public.messages WHERE id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compComplaintSnapshot = (
            await pool.query<{ id: string; identity_id: string; status: string; category: string; version: number; is_primary: boolean; automation_suppressed: boolean }>(
              "SELECT id, identity_id, status, category, version, is_primary, automation_suppressed FROM public.complaints WHERE id = $1",
              [compComplaintId]
            )
          ).rows[0];

          const compReadSnapshot = (
            await pool.query<{ staff_id: string; conversation_id: string; last_read_message_id: string }>(
              "SELECT staff_id, conversation_id, last_read_message_id FROM public.staff_conversation_reads WHERE conversation_id = $1",
              [compConvId]
            )
          ).rows[0];

          const compMsgReadSnapshot = (
            await pool.query<{ staff_id: string; conversation_id: string; message_id: string }>(
              "SELECT staff_id, conversation_id, message_id FROM public.staff_message_reads WHERE conversation_id = $1 ORDER BY message_id",
              [compConvId]
            )
          ).rows;

          const compAssessSnapshot = (
            await pool.query<{ message_id: string; decision: unknown; processing_result: unknown }>(
              "SELECT message_id, decision, processing_result FROM public.triage_assessments WHERE message_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compAuditSnapshot = (
            await pool.query<{ id: string; complaint_id: string; message_id: string; action: string }>(
              "SELECT id, complaint_id, message_id, action FROM public.complaint_audit_log WHERE complaint_id = $1 ORDER BY id",
              [compComplaintId]
            )
          ).rows;

          assert.ok(compAssessSnapshot, "Comparator triage assessment must exist in snapshot");
          assert.ok(compAuditSnapshot.length >= 1, "Comparator complaint audit log must exist in snapshot");

          // 2. Buat fixture target berupa graph nyata terproses penuh via receiveTrackedInboundFixture
          const targetRunId = randomUUID().slice(0, 8);
          const targetSenderId = `tgt_snd_${targetRunId}`;
          const targetFixture = await receiveTrackedInboundFixture(targetTracker, {
            senderExternalId: targetSenderId,
            providerMessageId: `tgt_msg_${targetRunId}`,
            text: "Internet saya mati total lampu merah LOS",
          });
          const targetIngress = { ingressId: targetFixture.ingressId };

          await persistence.process(targetIngress.ingressId);

          const targetMsgRes = await pool.query<{ conversation_id: string; complaint_id: string | null }>(
            "SELECT conversation_id, complaint_id FROM public.messages WHERE id = $1",
            [targetIngress.ingressId]
          );
          const targetConvId = targetMsgRes.rows[0].conversation_id;
          const targetComplaintId = targetMsgRes.rows[0].complaint_id;

          // Assert episode/complaint target benar-benar terbentuk secara tanpa syarat
          assert.ok(targetComplaintId, "Target message must create a complaint episode");
          targetTracker.recordConversation(targetConvId);
          targetTracker.recordComplaint(targetComplaintId);

          // Berikan kursor baca target
          await markConversationRead(pool, staffIdA, {
            conversationId: targetConvId,
            lastReadMessageId: targetIngress.ingressId,
          });

          // 3. Buktikan keberadaan record target sebelum cleanup
          const preConvCount = (await pool.query("SELECT count(*) FROM public.conversations WHERE id = $1", [targetConvId])).rows[0].count;
          const preMsgCount = (await pool.query("SELECT count(*) FROM public.messages WHERE id = $1", [targetIngress.ingressId])).rows[0].count;
          const preCompCount = (await pool.query("SELECT count(*) FROM public.complaints WHERE id = $1", [targetComplaintId])).rows[0].count;
          const preReadCount = (await pool.query("SELECT count(*) FROM public.staff_conversation_reads WHERE conversation_id = $1", [targetConvId])).rows[0].count;
          const preMsgReadCount = (await pool.query("SELECT count(*) FROM public.staff_message_reads WHERE conversation_id = $1", [targetConvId])).rows[0].count;
          const preAssessCount = (await pool.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [targetIngress.ingressId])).rows[0].count;
          const preAuditCount = (await pool.query("SELECT count(*) FROM public.complaint_audit_log WHERE complaint_id = $1", [targetComplaintId])).rows[0].count;

          assert.equal(Number(preConvCount), 1, "Target conversation must exist before cleanup");
          assert.equal(Number(preMsgCount), 1, "Target message must exist before cleanup");
          assert.equal(Number(preCompCount), 1, "Target complaint must exist before cleanup");
          assert.equal(Number(preReadCount), 1, "Target read record must exist before cleanup");
          assert.equal(Number(preMsgReadCount), 1, "Target staff_message_reads must exist before cleanup");
          assert.ok(Number(preAssessCount) >= 1, "Target triage assessment must exist before cleanup");
          assert.ok(Number(preAuditCount) >= 1, "Target complaint audit log must exist before cleanup");

          // Perilaku SHADOW: verifikasi bahwa reply_claims dan outbound_intents tidak dibentuk
          const preClaimCount = (await pool.query("SELECT count(*) FROM public.reply_claims WHERE complaint_id = $1", [targetComplaintId])).rows[0].count;
          const preOutboundCount = (await pool.query("SELECT count(*) FROM public.outbound_intents WHERE message_id = $1", [targetIngress.ingressId])).rows[0].count;
          assert.equal(Number(preClaimCount), 0, "In SHADOW mode, automated reply claims are suppressed (must be 0)");
          assert.equal(Number(preOutboundCount), 0, "In SHADOW mode, automated outbound intents are suppressed (must be 0)");

          // 4. Bersihkan graph fixture target secara presisi
          await cleanupFixture(pool, targetTracker);
          targetCleaned = true;

          // 5. Assert seluruh record target yang relevan telah hilang
          const postConvCount = (await pool.query("SELECT count(*) FROM public.conversations WHERE id = $1", [targetConvId])).rows[0].count;
          const postMsgCount = (await pool.query("SELECT count(*) FROM public.messages WHERE id = $1", [targetIngress.ingressId])).rows[0].count;
          const postCompCount = (await pool.query("SELECT count(*) FROM public.complaints WHERE id = $1", [targetComplaintId])).rows[0].count;
          const postReadCount = (await pool.query("SELECT count(*) FROM public.staff_conversation_reads WHERE conversation_id = $1", [targetConvId])).rows[0].count;
          const postMsgReadCount = (await pool.query("SELECT count(*) FROM public.staff_message_reads WHERE conversation_id = $1", [targetConvId])).rows[0].count;
          const postAssessCount = (await pool.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [targetIngress.ingressId])).rows[0].count;
          const postAuditCount = (await pool.query("SELECT count(*) FROM public.complaint_audit_log WHERE complaint_id = $1", [targetComplaintId])).rows[0].count;
          const postIngressCount = (await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [targetIngress.ingressId])).rows[0].count;

          assert.equal(Number(postConvCount), 0, "Target conversation must be deleted after cleanup");
          assert.equal(Number(postMsgCount), 0, "Target message must be deleted after cleanup");
          assert.equal(Number(postCompCount), 0, "Target complaint must be deleted after cleanup");
          assert.equal(Number(postReadCount), 0, "Target read record must be deleted after cleanup");
          assert.equal(Number(postMsgReadCount), 0, "Target staff_message_reads must be deleted after cleanup");
          assert.equal(Number(postAssessCount), 0, "Target triage assessment must be deleted after cleanup");
          assert.equal(Number(postAuditCount), 0, "Target complaint audit log must be deleted after cleanup");
          assert.equal(Number(postIngressCount), 0, "Target ingress event must be deleted after cleanup");

          // 6. Assert data pembanding tetap terpreservasi pada kolom dan baris yang diperiksa
          const compConvAfter = (
            await pool.query<{ id: string; channel: string; account_id: string; chat_id: string; status: string }>(
              "SELECT id, channel, account_id, chat_id, status FROM public.conversations WHERE id = $1",
              [compConvId]
            )
          ).rows[0];

          const compMsgAfter = (
            await pool.query<{ id: string; conversation_id: string; identity_id: string; complaint_id: string | null; review_reason: string | null }>(
              "SELECT id, conversation_id, identity_id, complaint_id, review_reason FROM public.messages WHERE id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compComplaintAfter = (
            await pool.query<{ id: string; identity_id: string; status: string; category: string; version: number; is_primary: boolean; automation_suppressed: boolean }>(
              "SELECT id, identity_id, status, category, version, is_primary, automation_suppressed FROM public.complaints WHERE id = $1",
              [compComplaintId]
            )
          ).rows[0];

          const compReadAfter = (
            await pool.query<{ staff_id: string; conversation_id: string; last_read_message_id: string }>(
              "SELECT staff_id, conversation_id, last_read_message_id FROM public.staff_conversation_reads WHERE conversation_id = $1",
              [compConvId]
            )
          ).rows[0];

          const compMsgReadAfter = (
            await pool.query<{ staff_id: string; conversation_id: string; message_id: string }>(
              "SELECT staff_id, conversation_id, message_id FROM public.staff_message_reads WHERE conversation_id = $1 ORDER BY message_id",
              [compConvId]
            )
          ).rows;

          const compAssessAfter = (
            await pool.query<{ message_id: string; decision: unknown; processing_result: unknown }>(
              "SELECT message_id, decision, processing_result FROM public.triage_assessments WHERE message_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compAuditAfter = (
            await pool.query<{ id: string; complaint_id: string; message_id: string; action: string }>(
              "SELECT id, complaint_id, message_id, action FROM public.complaint_audit_log WHERE complaint_id = $1 ORDER BY id",
              [compComplaintId]
            )
          ).rows;

          assert.deepEqual(compConvAfter, compConvSnapshot, "Comparator conversation (id, channel, account_id, chat_id, status) must remain identical");
          assert.deepEqual(compMsgAfter, compMsgSnapshot, "Comparator message (id, conversation_id, identity_id, complaint_id, review_reason) must remain identical");
          assert.deepEqual(compComplaintAfter, compComplaintSnapshot, "Comparator complaint (id, identity_id, status, category, version, is_primary, automation_suppressed) must remain identical");
          assert.deepEqual(compReadAfter, compReadSnapshot, "Comparator read record (staff_id, conversation_id, last_read_message_id) must remain identical");
          assert.deepEqual(compMsgReadAfter, compMsgReadSnapshot, "Comparator staff_message_reads must remain identical");
          assert.deepEqual(compAssessAfter, compAssessSnapshot, "Comparator triage assessment (message_id, decision, processing_result) must remain identical");
          assert.deepEqual(compAuditAfter, compAuditSnapshot, "Comparator complaint audit log (id, complaint_id, message_id, action) must remain identical");
        } catch (err) {
          ac11PrimaryError = err as Error;
        } finally {
          // Seluruh tracker (target dan pembanding) memiliki teardown mandiri yang selalu dijalankan
          if (!targetCleaned) {
            try {
              await cleanupFixture(pool, targetTracker);
              targetCleaned = true;
            } catch (err) {
              ac11CleanupErrors.push(err as Error);
            }
          }
          if (!compCleaned) {
            try {
              await cleanupFixture(pool, compTracker);
              compCleaned = true;
            } catch (err) {
              ac11CleanupErrors.push(err as Error);
            }
          }

          const combined = combineErrors(ac11PrimaryError, ac11CleanupErrors);
          if (combined) {
            throw combined;
          }
        }
      }
    );

    // =========================================================================
    // AC 11.1: Kegagalan Terkontrol Pasca Pembuatan Fixture Target
    // Membuktikan bahwa jika kegagalan terjadi setelah target terbentuk, blok finally
    // membersihkan target dan pembersihan pembanding tetap berjalan tanpa kebocoran.
    // =========================================================================
    await t.test(
      "AC 11.1: Controlled Failure After Target Creation: both target and comparator trackers execute teardown without leakage",
      async () => {
        const compTracker = new TestResourceTracker();
        const targetTracker = new TestResourceTracker();
        let targetIngressId: string | undefined;
        let compIngressId: string | undefined;
        let targetIdentityId: string | undefined;
        let compIdentityId: string | undefined;
        let targetConversationId: string | undefined;
        let compConversationId: string | undefined;
        let targetComplaintId: string | undefined;
        let compComplaintId: string | undefined;
        let simulatedFailureCaught = false;

        try {
          // Buat pembanding via receiveTrackedInboundFixture
          const compRunId = randomUUID().slice(0, 8);
          const compFixture = await receiveTrackedInboundFixture(compTracker, {
            senderExternalId: `snd_cf_c_${compRunId}`,
            providerMessageId: `msg_cf_c_${compRunId}`,
            text: "Pembanding kegagalan terkontrol",
          });
          compIngressId = compFixture.ingressId;
          compIdentityId = compFixture.identityId;

          await persistence.process(compIngressId);

          const compMsgRes = await pool.query<{ conversation_id: string; complaint_id: string | null }>(
            "SELECT conversation_id, complaint_id FROM public.messages WHERE id = $1",
            [compIngressId]
          );
          compConversationId = compMsgRes.rows[0]?.conversation_id;
          if (compConversationId) {
            compTracker.recordConversation(compConversationId);
          }
          compComplaintId = compMsgRes.rows[0]?.complaint_id || undefined;
          if (compComplaintId) {
            compTracker.recordComplaint(compComplaintId);
          }

          // Buat target via receiveTrackedInboundFixture
          const targetRunId = randomUUID().slice(0, 8);
          const targetFixture = await receiveTrackedInboundFixture(targetTracker, {
            senderExternalId: `snd_cf_t_${targetRunId}`,
            providerMessageId: `msg_cf_t_${targetRunId}`,
            text: "Target kegagalan terkontrol",
          });
          targetIngressId = targetFixture.ingressId;
          targetIdentityId = targetFixture.identityId;

          await persistence.process(targetIngressId);

          const targetMsgRes = await pool.query<{ conversation_id: string; complaint_id: string | null }>(
            "SELECT conversation_id, complaint_id FROM public.messages WHERE id = $1",
            [targetIngressId]
          );
          targetConversationId = targetMsgRes.rows[0]?.conversation_id;
          if (targetConversationId) {
            targetTracker.recordConversation(targetConversationId);
          }
          targetComplaintId = targetMsgRes.rows[0]?.complaint_id || undefined;
          if (targetComplaintId) {
            targetTracker.recordComplaint(targetComplaintId);
          }

          // Verifikasi target benar-benar terbentuk di DB sebelum kegagalan disimulasikan
          const targetExistsBefore = (await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [targetIngressId])).rows[0].count;
          assert.equal(Number(targetExistsBefore), 1, "Target ingress event must exist in DB before failure");

          // Simulasikan kegagalan terkontrol pasca pembuatan fixture target
          throw new Error("Controlled simulated failure after target fixture creation");
        } catch (err) {
          if ((err as Error).message.includes("Controlled simulated failure after target fixture creation")) {
            simulatedFailureCaught = true;
          } else {
            throw err;
          }
        } finally {
          // Teardown mandiri untuk kedua tracker
          const tearDownErrors: Error[] = [];
          try {
            await cleanupFixture(pool, targetTracker);
          } catch (err) {
            tearDownErrors.push(err as Error);
          }
          try {
            await cleanupFixture(pool, compTracker);
          } catch (err) {
            tearDownErrors.push(err as Error);
          }
          if (tearDownErrors.length > 0) {
            throw combineErrors(undefined, tearDownErrors);
          }
        }

        assert.equal(simulatedFailureCaught, true, "Simulated failure after target fixture creation must be caught");

        // Buktikan tidak ada kebocoran target maupun pembanding di seluruh tabel terkait:
        // 1. channel_identities target dan pembanding hilang
        if (targetIdentityId) {
          const targetIdentAfter = (await pool.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [targetIdentityId])).rows[0].count;
          assert.equal(Number(targetIdentAfter), 0, "Target channel_identity must be cleaned up without leakage");
        }
        if (compIdentityId) {
          const compIdentAfter = (await pool.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [compIdentityId])).rows[0].count;
          assert.equal(Number(compIdentAfter), 0, "Comparator channel_identity must be cleaned up without leakage");
        }

        // 2. ingress_events hilang
        if (targetIngressId) {
          const targetIngressAfter = (await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [targetIngressId])).rows[0].count;
          assert.equal(Number(targetIngressAfter), 0, "Target ingress must be cleaned up without leakage after failure");
        }
        if (compIngressId) {
          const compIngressAfter = (await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [compIngressId])).rows[0].count;
          assert.equal(Number(compIngressAfter), 0, "Comparator ingress must be cleaned up without leakage after failure");
        }

        // 3. processing_jobs hilang
        const testedIngressIds = [targetIngressId, compIngressId].filter(Boolean) as string[];
        if (testedIngressIds.length > 0) {
          const jobsAfter = (await pool.query("SELECT count(*) FROM public.processing_jobs WHERE ingress_id = ANY($1::uuid[])", [testedIngressIds])).rows[0].count;
          assert.equal(Number(jobsAfter), 0, "Processing jobs for target and comparator must be cleaned up");

          // 4. messages hilang
          const msgsAfter = (await pool.query("SELECT count(*) FROM public.messages WHERE id = ANY($1::uuid[])", [testedIngressIds])).rows[0].count;
          assert.equal(Number(msgsAfter), 0, "Messages for target and comparator must be cleaned up");

          // 5. triage_assessments hilang
          const assessmentsAfter = (await pool.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = ANY($1::uuid[])", [testedIngressIds])).rows[0].count;
          assert.equal(Number(assessmentsAfter), 0, "Triage assessments for target and comparator must be cleaned up");
        }

        // 6. conversations hilang
        const testedConvIds = [targetConversationId, compConversationId].filter(Boolean) as string[];
        if (testedConvIds.length > 0) {
          const convsAfter = (await pool.query("SELECT count(*) FROM public.conversations WHERE id = ANY($1::uuid[])", [testedConvIds])).rows[0].count;
          assert.equal(Number(convsAfter), 0, "Conversations for target and comparator must be cleaned up");
        }

        // 7. complaints and complaint_audit_log hilang bila terbentuk
        const testedComplaintIds = [targetComplaintId, compComplaintId].filter(Boolean) as string[];
        if (testedComplaintIds.length > 0) {
          const complaintsAfter = (await pool.query("SELECT count(*) FROM public.complaints WHERE id = ANY($1::uuid[])", [testedComplaintIds])).rows[0].count;
          assert.equal(Number(complaintsAfter), 0, "Complaints for target and comparator must be cleaned up");

          const auditAfter = (await pool.query("SELECT count(*) FROM public.complaint_audit_log WHERE complaint_id = ANY($1::uuid[])", [testedComplaintIds])).rows[0].count;
          assert.equal(Number(auditAfter), 0, "Complaint audit log for target and comparator must be cleaned up");
        }
      }
    );

    // =========================================================================
    // AC 11.2: Skenario Kegagalan Query Terkontrol Segera Pasca receive() (Controlled Query Failure)
    // Menguji kegagalan query pertama setelah receive() sebelum helper mengembalikan hasil.
    // Membuktikan bahwa identity yang terlacak sebelum receive(), serta ingress & job yang terbentuk,
    // benar-benar ada sebelum cleanup, dan dibersihkan tuntas pada blok finally tanpa kebocoran.
    // =========================================================================
    await t.test(
      "AC 11.2: Controlled query failure after receive(): pre-tracked identity, ingress, and processing job are cleaned up without resource leakage",
      async () => {
        const controlledTracker = new TestResourceTracker();
        const plannedError = new Error(
          "PLANNED_POST_RECEIVE_QUERY_FAILURE: Database connection terminated during post-receive ingress identity lookup"
        );

        let targetQueryCalls = 0;
        let observedIngressIdFromQuery: string | undefined;

        // Dependency query khusus pengujian yang menginjeksi kegagalan satu kali pada query target di dalam helper
        const faultInjectedPool = new Proxy(pool, {
          get(target, prop, receiver) {
            if (prop === "query") {
              return function (
                this: unknown,
                textOrConfig: unknown,
                values?: unknown,
                cb?: unknown
              ) {
                const sqlText =
                  typeof textOrConfig === "string"
                    ? textOrConfig
                    : (textOrConfig as { text?: string })?.text ?? "";
                if (sqlText.includes("SELECT identity_id FROM public.ingress_events WHERE id = $1")) {
                  targetQueryCalls++;
                  if (Array.isArray(values) && typeof values[0] === "string") {
                    observedIngressIdFromQuery = values[0];
                  }
                  if (targetQueryCalls === 1) {
                    throw plannedError;
                  }
                }
                return Reflect.apply(target.query, target, [textOrConfig, values, cb]);
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        let helperReturned = false;
        let caughtPlannedError: Error | undefined;
        let trackedIdentityId: string | undefined;
        let trackedIngressId: string | undefined;
        let preCleanupIdentCount: number | undefined;
        let preCleanupIngressCount: number | undefined;
        let preCleanupJobCount: number | undefined;
        const cleanupErrors: Error[] = [];

        // Try/finally melindungi lifecycle sejak sebelum resource pertama dibuat
        try {
          const qfRunId = randomUUID().slice(0, 8);
          try {
            // Helper yang sama persis:
            // 1. Identity fixture dibuat dan dicatat ke tracker sebelum receive()
            // 2. Produksi receive() berjalan nyata di DB pengujian
            // 3. Ingress & message dicatat segera setelah receive() berhasil
            // 4. Query target pasca-receive() dipanggil pada faultInjectedPool dan gagal
            await receiveTrackedInboundFixture(
              controlledTracker,
              {
                senderExternalId: `snd_qf_${qfRunId}`,
                providerMessageId: `msg_qf_${qfRunId}`,
                text: "Pesan uji kegagalan query pasca receive",
              },
              persistence,
              faultInjectedPool
            );
            helperReturned = true;
          } catch (err) {
            if ((err as Error).message === plannedError.message) {
              caughtPlannedError = err as Error;

              // Ambil ID fixture dari tracker atau observasi dependency query (tanpa bergantung pada return helper yang gagal)
              trackedIdentityId = controlledTracker.identityIds[0];
              trackedIngressId =
                controlledTracker.ingressIds[0] || observedIngressIdFromQuery;

              assert.ok(trackedIdentityId, "Identity ID must be recorded in tracker before query failure");
              assert.ok(trackedIngressId, "Ingress ID must be recorded in tracker before query failure");

              // Buktikan identity, ingress, dan processing job benar-benar ada sebelum cleanup
              // Pemeriksaan menggunakan pool asli agar tidak terkena injeksi kegagalan
              const preIdentRes = await pool.query(
                "SELECT count(*) FROM public.channel_identities WHERE id = $1",
                [trackedIdentityId]
              );
              preCleanupIdentCount = Number(preIdentRes.rows[0].count);

              const preIngressRes = await pool.query(
                "SELECT count(*) FROM public.ingress_events WHERE id = $1",
                [trackedIngressId]
              );
              preCleanupIngressCount = Number(preIngressRes.rows[0].count);

              const preJobRes = await pool.query(
                "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
                [trackedIngressId]
              );
              preCleanupJobCount = Number(preJobRes.rows[0].count);
            } else {
              throw err;
            }
          }
        } finally {
          // Teardown selalu dapat berjalan menggunakan pool asli pada tracker yang sudah memiliki identity dan ingress
          try {
            await cleanupFixture(pool, controlledTracker);
          } catch (cleanupErr) {
            cleanupErrors.push(cleanupErr as Error);
          }
        }

        // Jika cleanup juga gagal, pertahankan error utama dan error cleanup tanpa saling menutupi
        if (cleanupErrors.length > 0) {
          throw combineErrors(caughtPlannedError ?? new Error("Unexpected test failure"), cleanupErrors);
        }

        // Buktikan query sasaran benar-benar dipanggil dan injeksi terjadi tepat satu kali
        assert.equal(targetQueryCalls, 1, "Target query SELECT identity_id FROM ingress_events must be called and injected exactly once");

        // Buktikan helper gagal sebelum mengembalikan hasil
        assert.equal(helperReturned, false, "receiveTrackedInboundFixture must fail before returning a result");

        // Verifikasi error spesifik yang direncanakan; jangan menerima sembarang exception
        assert.ok(caughtPlannedError, "Planned error must be caught deterministically");
        assert.equal(caughtPlannedError.message, plannedError.message);

        // Buktikan identity, ingress, dan processing job benar-benar ada sebelum cleanup
        assert.equal(preCleanupIdentCount, 1, "Identity must exist in DB before cleanup");
        assert.equal(preCleanupIngressCount, 1, "Ingress event must exist in DB before cleanup");
        assert.equal(preCleanupJobCount, 1, "Processing job must exist in DB before cleanup");

        // Setelah lifecycle selesai, buktikan ketiganya terhapus tuntas
        const postIdentCount = (
          await pool.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [trackedIdentityId])
        ).rows[0].count;
        const postIngressCount = (
          await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [trackedIngressId])
        ).rows[0].count;
        const postJobCount = (
          await pool.query("SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1", [trackedIngressId])
        ).rows[0].count;

        assert.equal(Number(postIdentCount), 0, "Channel identity must be cleanly deleted after teardown");
        assert.equal(Number(postIngressCount), 0, "Ingress event must be cleanly deleted after teardown");
        assert.equal(Number(postJobCount), 0, "Processing job must be cleanly deleted after teardown");

        // Assert bahwa resource downstream tidak pernah terbentuk karena kegagalan terjadi sebelum process()
        const postMsgCount = (
          await pool.query("SELECT count(*) FROM public.messages WHERE id = $1", [trackedIngressId])
        ).rows[0].count;
        const postAssessCount = (
          await pool.query("SELECT count(*) FROM public.triage_assessments WHERE message_id = $1", [trackedIngressId])
        ).rows[0].count;
        const postCompCount = (
          await pool.query("SELECT count(*) FROM public.complaints WHERE identity_id = $1", [trackedIdentityId])
        ).rows[0].count;
        const postOwnerCount = (
          await pool.query("SELECT count(*) FROM public.reply_owners WHERE identity_id = $1", [trackedIdentityId])
        ).rows[0].count;
        const postClaimCount = (
          await pool.query(
            "SELECT count(*) FROM public.reply_claims rc JOIN public.reply_owners ro ON ro.id = rc.owner_id WHERE ro.identity_id = $1",
            [trackedIdentityId]
          )
        ).rows[0].count;
        const postOutboundCount = (
          await pool.query("SELECT count(*) FROM public.outbound_intents WHERE message_id = $1", [trackedIngressId])
        ).rows[0].count;

        assert.equal(Number(postMsgCount), 0, "Messages must not exist when query fails before process()");
        assert.equal(Number(postAssessCount), 0, "Triage assessments must not exist when query fails before process()");
        assert.equal(Number(postCompCount), 0, "Complaints must not exist when query fails before process()");
        assert.equal(Number(postOwnerCount), 0, "Reply owners must not exist when query fails before process()");
        assert.equal(Number(postClaimCount), 0, "Reply claims must not exist in SHADOW mode");
        assert.equal(Number(postOutboundCount), 0, "Outbound intents must not exist in SHADOW mode");
      }
    );

    // =========================================================================
    // AC 12: Jalur Kegagalan Terkontrol pada Processing Nyata (Controlled Processing Failure Cleanup)
    // Memanggil jalur process() nyata dengan kondisi sewa invalid (lease token mismatch)
    // dan membuktikan sumber daya yang sempat dibuat dibersihkan tuntas pada finally.
    // =========================================================================
    await t.test(
      "AC 12: Controlled Processing Failure via actual process() path: recorded resources are cleaned up even when processing fails",
      async () => {
        const failureTracker = new TestResourceTracker();
        const failRunId = randomUUID().slice(0, 8);

        let ingressId: string | undefined;
        let identityId: string | undefined;
        let processingErrorCaught = false;

        try {
          const fixture = await receiveTrackedInboundFixture(failureTracker, {
            senderExternalId: `fail_snd_${failRunId}`,
            providerMessageId: `fail_msg_${failRunId}`,
            text: "Pesan pengujian kegagalan proses terkontrol",
          });
          ingressId = fixture.ingressId;
          identityId = fixture.identityId;

          // Panggil jalur processing yang sebenarnya dengan lease token invalid
          // HelpdeskPersistence.process() akan mengeksekusi query DB aktual dan melempar PersistenceError("lease_lost")
          await persistence.process(ingressId, { leaseToken: "controlled_invalid_lease_token" });
        } catch (err) {
          if (err instanceof PersistenceError && err.code === "lease_lost") {
            processingErrorCaught = true;
          } else {
            throw err;
          }
        } finally {
          // Teardown selalu dijalankan di blok finally
          await cleanupFixture(pool, failureTracker);
        }

        assert.equal(processingErrorCaught, true, "Actual process() method must throw PersistenceError with code 'lease_lost'");

        // Buktikan seluruh sumber daya yang sempat dibuat dibersihkan setelah kegagalan
        if (ingressId) {
          const ingressCount = (
            await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [ingressId])
          ).rows[0].count;
          const jobsCount = (
            await pool.query("SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1", [ingressId])
          ).rows[0].count;
          assert.equal(Number(ingressCount), 0, "Ingress event must be cleaned up despite processing failure");
          assert.equal(Number(jobsCount), 0, "Processing job must be cleaned up despite processing failure");
        }
        if (identityId) {
          const identCount = (
            await pool.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [identityId])
          ).rows[0].count;
          assert.equal(Number(identCount), 0, "Channel identity must be cleaned up despite processing failure");
        }
      }
    );

    // =========================================================================
    // AC 12.1: Pelaporan Error Ganda & Teardown Resilien Multi-Tracker (Dual Error Reporting)
    // Membuktikan bahwa primary error dan cleanup error digabungkan secara utuh tanpa saling
    // menutupi, dan kegagalan cleanup satu tracker tidak menghentikan cleanup tracker lainnya.
    // =========================================================================
    await t.test(
      "AC 12.1: Dual Error Reporting: primary error and cleanup error are reported together without halting other cleanups",
      async () => {
        const trackerA = new TestResourceTracker();
        const trackerB = new TestResourceTracker();
        let ingressBId: string | undefined;
        let identBId: string | undefined;
        const primaryTestError = new Error("Simulated primary operational failure during execution");
        const dualCleanupErrors: Error[] = [];
        let executionError: Error | undefined;

        try {
          // Buat resource valid di tracker B via receiveTrackedInboundFixture
          const runIdB = randomUUID().slice(0, 8);
          const fixtureB = await receiveTrackedInboundFixture(trackerB, {
            senderExternalId: `snd_dual_b_${runIdB}`,
            providerMessageId: `msg_dual_b_${runIdB}`,
            text: "Pesan pengujian multi tracker B",
          });
          ingressBId = fixtureB.ingressId;
          identBId = fixtureB.identityId;

          // Tracker A memicu cleanup error sintetis via query yang melempar exception
          trackerA.recordIngress(randomUUID());
        } catch (err) {
          executionError = err as Error;
        } finally {
          // Teardown mandiri: kegagalan cleanup Tracker A TIDAK menghentikan cleanup Tracker B
          try {
            await cleanupFixture(
              {
                query: async () => {
                  throw new Error("Tracker A simulated cleanup error: connection reset");
                },
              },
              trackerA
            );
          } catch (err) {
            dualCleanupErrors.push(err as Error);
          }

          try {
            // Tracker B tetap dibersihkan meskipun Tracker A gagal
            await cleanupFixture(pool, trackerB);
          } catch (err) {
            dualCleanupErrors.push(err as Error);
          }
        }

        if (executionError) {
          throw combineErrors(executionError, dualCleanupErrors);
        }

        // 1. Buktikan seluruh resource Tracker B bersih di database (termasuk identity, bukan hanya ingress)
        if (ingressBId) {
          const ingressBAfter = (
            await pool.query("SELECT count(*) FROM public.ingress_events WHERE id = $1", [ingressBId])
          ).rows[0].count;
          assert.equal(Number(ingressBAfter), 0, "Tracker B ingress must be cleaned up in database even when Tracker A cleanup fails");
        }
        if (identBId) {
          const identBAfter = (
            await pool.query("SELECT count(*) FROM public.channel_identities WHERE id = $1", [identBId])
          ).rows[0].count;
          assert.equal(Number(identBAfter), 0, "Tracker B identity must be cleaned up in database even when Tracker A cleanup fails");
        }

        // 2. Buktikan combineErrors menggabungkan primary error dan cleanup error secara utuh
        const combined = combineErrors(primaryTestError, dualCleanupErrors);
        assert.ok(combined, "Combined error must be created");

        const agg = combined as { primaryError?: Error; cleanupErrors?: Error[] };
        assert.equal(agg.primaryError?.message, "Simulated primary operational failure during execution");
        assert.equal(agg.cleanupErrors?.length, 1);
        assert.ok(agg.cleanupErrors?.[0].message.includes("Tracker A simulated cleanup error: connection reset"), "Cleanup error message must be preserved");
        assert.ok(combined.message.includes("Simulated primary operational failure"), "Combined message must include primary error");
        assert.ok(combined.message.includes("Tracker A simulated cleanup error"), "Combined message must include cleanup error");
      }
    );

    // =========================================================================
    // AC 13 (Koreksi B2): Factual message classification from HelpdeskPersistence.process() and explicit DB fallback
    // =========================================================================
    await t.test(
      "AC 13 (Koreksi B2): Factual message classification from HelpdeskPersistence.process() and explicit DB fallback",
      async () => {
        const senderExt = `cls_${runId}`;

        // 1. Inbound connection complaint message with keywords
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: senderExt,
          providerMessageId: "cls_m1",
          text: "Lampu LOS merah wifi mati dari jam 10",
        });
        const p1 = await persistence.process(fix1.ingressId);
        assert.ok(p1.conversationId);
        tracker.recordConversation(p1.conversationId);
        if (p1.episodeId) tracker.recordComplaint(p1.episodeId);

        // 2. Inbound empty text message -> category: review, reason: empty_text, normalizedText: null
        const fixEmpty = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: senderExt,
          providerMessageId: "cls_m2",
          text: "",
          existingIdentityId: fix1.identityId,
        });
        const p2 = await persistence.process(fixEmpty.ingressId);
        if (p2.episodeId) tracker.recordComplaint(p2.episodeId);

        // 3. Fetch conversation detail via getInboxConversationDetail
        const detail = await getInboxConversationDetail(pool, staffIdA, p1.conversationId);
        assert.ok(detail);
        assert.equal(detail.messages.length, 2);

        // Assert message 1 classification: factual fields from domain classification
        const m1 = detail.messages.find((m) => m.id === fix1.ingressId);
        assert.ok(m1);
        assert.equal(m1.classification.category, "connection_complaint");
        assert.equal(m1.classification.reason, "connection_keyword");
        assert.equal(m1.classification.ruleVersion, "connection-keywords-v1");
        assert.equal(m1.classification.normalizedText, "lampu los merah wifi mati dari jam 10");
        assert.ok(m1.classification.matchedKeywords.includes("wifi mati"));
        assert.ok(m1.classification.matchedKeywords.includes("los"));
        assert.equal("confidence" in m1.classification, false, "confidence must not exist on classification contract");
        assert.equal("flags" in m1.classification, false, "flags must not exist on classification contract");

        // Assert message 2 classification: empty string normalizedText preserved
        const m2 = detail.messages.find((m) => m.id === fixEmpty.ingressId);
        assert.ok(m2);
        assert.equal(m2.classification.category, "review");
        assert.equal(m2.classification.reason, "empty_text");
        assert.equal(m2.classification.ruleVersion, "connection-keywords-v1");
        assert.equal(m2.classification.normalizedText, "", "empty string normalizedText must be preserved exactly as stored");
        assert.deepEqual(m2.classification.matchedKeywords, []);

        // Assert message with explicit normalizedText: null in DB
        await pool.query(
          `UPDATE public.messages SET classification = '{"category":"review","reason":"unsupported_content","ruleVersion":"connection-keywords-v1","normalizedText":null,"matchedKeywords":[]}'::jsonb WHERE id = $1`,
          [fixEmpty.ingressId]
        );
        const detailNullText = await getInboxConversationDetail(pool, staffIdA, p1.conversationId);
        const m2Null = detailNullText?.messages.find((m) => m.id === fixEmpty.ingressId);
        assert.ok(m2Null);
        assert.equal(m2Null.classification.category, "review");
        assert.equal(m2Null.classification.reason, "unsupported_content");
        assert.equal(m2Null.classification.normalizedText, null, "valid normalizedText null must be preserved exactly");

        // 4. Incomplete DB classification row:
        // Update m1 classification in DB to partial json { "category": "manual_review" }
        await pool.query(
          `UPDATE public.messages SET classification = '{"category":"manual_review"}'::jsonb WHERE id = $1`,
          [fix1.ingressId]
        );
        const detailCorrupt1 = await getInboxConversationDetail(pool, staffIdA, p1.conversationId);
        const m1Corrupt = detailCorrupt1?.messages.find((m) => m.id === fix1.ingressId);
        assert.ok(m1Corrupt);
        assert.equal(m1Corrupt.classification.category, "manual_review");
        assert.equal(m1Corrupt.classification.reason, "unknown");
        assert.equal(m1Corrupt.classification.ruleVersion, "unknown");
        assert.equal(m1Corrupt.classification.normalizedText, null);
        assert.deepEqual(m1Corrupt.classification.matchedKeywords, []);

        // Update m1 classification in DB to empty JSON {} and JSON null literal 'null'::jsonb
        await pool.query(
          `UPDATE public.messages SET classification = '{}'::jsonb WHERE id = $1`,
          [fix1.ingressId]
        );
        const detailCorrupt2 = await getInboxConversationDetail(pool, staffIdA, p1.conversationId);
        const m1Empty = detailCorrupt2?.messages.find((m) => m.id === fix1.ingressId);
        assert.ok(m1Empty);
        assert.equal(m1Empty.classification.category, "unknown");
        assert.equal(m1Empty.classification.reason, "unknown");
        assert.equal(m1Empty.classification.ruleVersion, "unknown");
        assert.equal(m1Empty.classification.normalizedText, null);
        assert.deepEqual(m1Empty.classification.matchedKeywords, []);

        await pool.query(
          `UPDATE public.messages SET classification = 'null'::jsonb WHERE id = $1`,
          [fix1.ingressId]
        );
        const detailCorrupt3 = await getInboxConversationDetail(pool, staffIdA, p1.conversationId);
        const m1Null = detailCorrupt3?.messages.find((m) => m.id === fix1.ingressId);
        assert.ok(m1Null);
        assert.equal(m1Null.classification.category, "unknown");
        assert.equal(m1Null.classification.reason, "unknown");
        assert.equal(m1Null.classification.ruleVersion, "unknown");
        assert.equal(m1Null.classification.normalizedText, null);
        assert.deepEqual(m1Null.classification.matchedKeywords, []);
      }
    );

    // =========================================================================
    // AC 14 (Koreksi B2): A writer commits between the first read SQL result and service completion
    // =========================================================================
    await t.test(
      "AC 14 (Koreksi B2): List and detail snapshots remain coherent across a coordinated acknowledgement commit",
      async () => {
        const snapSender = `snap_${runId}`;
        const snapshotTag = `snapshot-${runId}`;
        const fix1 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapSender,
          providerMessageId: "snap_m1",
          text: "Internet mati lampu merah",
          displayName: snapshotTag,
        });
        const p1 = await persistence.process(fix1.ingressId);
        const convId = p1.conversationId!;
        tracker.recordConversation(convId);
        if (p1.episodeId) tracker.recordComplaint(p1.episodeId);

        const fix2 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapSender,
          providerMessageId: "snap_m2",
          text: "Masih mati min dari tadi",
          existingIdentityId: fix1.identityId,
        });
        const p2 = await persistence.process(fix2.ingressId);
        if (p2.conversationId) tracker.recordConversation(p2.conversationId);
        if (p2.episodeId) tracker.recordComplaint(p2.episodeId);
        assert.equal(p2.conversationId, convId);

        // Initial check: 2 messages, unreadCount = 2, isUnread = true
        const detail0 = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detail0);
        assert.equal(detail0.messages.length, 2);
        assert.equal(detail0.unreadCount, 2);
        assert.equal(detail0.isUnread, true);
        assert.equal(detail0.unreadCount, detail0.messages.filter((m) => !m.isRead).length);

        class SnapshotTimeoutError extends Error {}

        async function bounded<T>(pending: Promise<T>, stage: string, timeoutMs = 5000): Promise<T> {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              pending,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new SnapshotTimeoutError(`AC 14 timeout: ${stage}`)), timeoutMs);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }

        async function readAcrossCommit<T>(
          acknowledgedMessageIds: string[],
          read: (db: Queryable) => Promise<T>
        ): Promise<{ snapshot: T; queryCount: number }> {
          let writerClient: PoolClient | undefined;
          let readerClient: PoolClient | undefined;
          let writerPending: Promise<MarkConversationReadResult> | undefined;
          let readerPending: Promise<T> | undefined;
          let writerSettled = false;
          let readerSettled = false;
          let writerFailed = false;
          let readerFailed = false;
          let signalEntered!: () => void;
          let releaseCommit!: () => void;
          const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
          const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
          let result: { snapshot: T; queryCount: number } | undefined;
          let failure: Error | undefined;
          const teardownErrors: Error[] = [];
          function releaseClient(client: PoolClient, broken: boolean) {
            try {
              client.release(broken);
            } catch (error) {
              teardownErrors.push(error instanceof Error ? error : new Error(String(error)));
            }
          }

          try {
            writerClient = await pool.connect();
            readerClient = await pool.connect();
            const reader = readerClient;
            const writer = markConversationRead(writerClient, staffIdA, {
              conversationId: convId,
              acknowledgedMessageIds,
            }, {
              onBeforeCommit: async () => {
                signalEntered();
                await commitGate;
              },
            });
            writerPending = writer;
            void writer.then(
              () => { writerSettled = true; },
              () => { writerSettled = true; writerFailed = true; }
            );
            await bounded(Promise.race([
              entered,
              writer.then(() => { throw new Error("Writer completed before the read barrier"); }),
            ]), "writer barrier");
            assert.equal(writerSettled, false, "Writer must still hold its uncommitted acknowledgement");

            let queryCount = 0;
            const readDb: Queryable = {
              query: async <R extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => {
                queryCount++;
                const sqlResult = await reader.query<R>(sql, values);
                if (queryCount === 1) {
                  // The real first SELECT saw the pre-commit snapshot. Commit before returning
                  // its rows: any subsequent service SELECT would see a different snapshot.
                  releaseCommit();
                  const acknowledgement = await bounded(writer, "acknowledgement commit");
                  assert.ok(acknowledgement.success);
                  assert.equal(writerSettled, true);
                }
                return sqlResult;
              },
            };
            readerPending = read(readDb);
            void readerPending.then(
              () => { readerSettled = true; },
              () => { readerSettled = true; readerFailed = true; }
            );
            result = { snapshot: await bounded(readerPending, "service read", 8000), queryCount };
          } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
          } finally {
            releaseCommit();
            const pending = [writerPending, readerPending].filter(
              (request): request is Promise<MarkConversationReadResult> | Promise<T> => request !== undefined
            );
            let settlements: PromiseSettledResult<unknown>[] | undefined;
            try {
              settlements = await bounded(Promise.allSettled(pending), "request settlement", 3000);
            } catch (error) {
              teardownErrors.push(error instanceof Error ? error : new Error(String(error)));
              // Cancel active requests through their owned connections, then await the actual
              // service promises. An active connection is never returned healthy to the pool.
              if (writerClient && !writerSettled) {
                releaseClient(writerClient, true);
                writerClient = undefined;
              }
              if (readerClient && !readerSettled) {
                releaseClient(readerClient, true);
                readerClient = undefined;
              }
              try {
                settlements = await bounded(Promise.allSettled(pending), "settlement after cancellation", 6000);
              } catch (settlementError) {
                teardownErrors.push(settlementError instanceof Error ? settlementError : new Error(String(settlementError)));
              }
            } finally {
              if (writerClient) releaseClient(writerClient, writerFailed || !writerSettled);
              if (readerClient) releaseClient(readerClient, readerFailed || !readerSettled);
            }
            for (const settlement of settlements ?? []) {
              if (settlement.status === "rejected") {
                const error = settlement.reason instanceof Error ? settlement.reason : new Error(String(settlement.reason));
                if (error !== failure && !teardownErrors.includes(error)) teardownErrors.push(error);
              }
            }
          }

          const combined = combineErrors(failure, teardownErrors);
          if (combined) throw combined;
          assert.ok(result);
          return result;
        }

        const detailRead = await readAcrossCommit([fix1.ingressId], (db) =>
          getInboxConversationDetail(db, staffIdA, convId)
        );
        assert.equal(detailRead.queryCount, 1, "Detail must use one read statement");
        const detailBeforeCommit = detailRead.snapshot;
        assert.ok(detailBeforeCommit);
        assert.deepEqual(detailBeforeCommit.messages.map((message) => message.id).sort(), [fix1.ingressId, fix2.ingressId].sort());
        assert.equal(detailBeforeCommit.unreadCount, 2);
        assert.equal(detailBeforeCommit.isUnread, true);
        assert.ok(detailBeforeCommit.messages.every((message) => !message.isRead));
        const detailAfterCommit = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailAfterCommit);
        assert.equal(detailAfterCommit.unreadCount, 1);
        assert.equal(detailAfterCommit.messages.find((message) => message.id === fix1.ingressId)?.isRead, true);
        assert.equal(detailAfterCommit.messages.find((message) => message.id === fix2.ingressId)?.isRead, false);

        const listQuery = { search: snapshotTag, unread: true, page: 1, limit: 10 } as const;
        const listRead = await readAcrossCommit([fix2.ingressId], (db) =>
          listInboxConversations(db, staffIdA, listQuery)
        );
        assert.equal(listRead.queryCount, 1, "List count and items must use one read statement");
        assert.equal(listRead.snapshot.totalCount, 1);
        assert.deepEqual(listRead.snapshot.items.map((item) => item.id), [convId]);
        assert.equal(listRead.snapshot.items[0].unreadCount, 1);
        assert.equal(listRead.snapshot.items[0].isUnread, true);
        const listAfterCommit = await listInboxConversations(pool, staffIdA, listQuery);
        assert.equal(listAfterCommit.totalCount, 0);
        assert.equal(listAfterCommit.totalPages, 0);
        assert.deepEqual(listAfterCommit.items, []);

        // Failure before the first SQL must still release the writer barrier and settle both requests.
        const plannedReadFailure = new Error("AC14_CONTROLLED_READ_FAILURE");
        await assert.rejects(
          readAcrossCommit([fix1.ingressId], async () => { throw plannedReadFailure; }),
          (error: unknown) => error === plannedReadFailure
        );

        // A later inbound remains unread after all previously visible messages were acknowledged.
        // This is a before/after check, separate from the coordinated read-ack overlap above.
        const fix3 = await receiveTrackedInboundFixture(tracker, {
          senderExternalId: snapSender,
          providerMessageId: "snap_m3",
          text: "Tolong segera dicek kak",
          existingIdentityId: fix1.identityId,
        });
        const p3 = await persistence.process(fix3.ingressId);
        if (p3.conversationId) tracker.recordConversation(p3.conversationId);
        if (p3.episodeId) tracker.recordComplaint(p3.episodeId);
        assert.equal(p3.conversationId, convId);
        const detailWithInbound = await getInboxConversationDetail(pool, staffIdA, convId);
        assert.ok(detailWithInbound);
        assert.equal(detailWithInbound.messages.length, 3);
        assert.equal(detailWithInbound.unreadCount, 1);
        assert.equal(detailWithInbound.messages.find((message) => message.id === fix3.ingressId)?.isRead, false);
        assert.equal(detailWithInbound.isUnread, true);
      }
    );

    // =========================================================================
    // AC 15 (Koreksi B2): Complete fixture coverage, tie ordering and pagination boundaries
    // =========================================================================
    await t.test(
      "AC 15 (Koreksi B2): All 28 fixture IDs appear once across stable pages, including timestamp ties",
      async () => {
        assert.equal(paginationFixtureIds.length, 28);
        assert.equal(new Set(paginationFixtureIds).size, 28);
        // Force a tie spanning all three pages; only this run's tracked fixtures are changed.
        await pool.query(
          "UPDATE public.conversations SET last_activity_at = $1 WHERE id = ANY($2::uuid[])",
          ["2026-10-04T12:00:00.000Z", paginationFixtureIds]
        );
        const expectedIds = [...paginationFixtureIds].sort().reverse();
        const page1 = await listInboxConversations(pool, staffIdA, { search: tag, page: 1, limit: 10 });
        const page2 = await listInboxConversations(pool, staffIdA, { search: tag, page: 2, limit: 10 });
        const page3 = await listInboxConversations(pool, staffIdA, { search: tag, page: 3, limit: 10 });

        for (const [index, page] of [page1, page2, page3].entries()) {
          assert.equal(page.totalCount, 28);
          assert.equal(page.totalPages, 3);
          assert.equal(page.limit, 10);
          assert.equal(page.page, index + 1);
        }
        assert.equal(page1.items.length, 10, "Page 1 must contain 10 items");
        assert.equal(page2.items.length, 10, "Page 2 must contain 10 items");
        assert.equal(page3.items.length, 8, "Page 3 must contain exactly the remaining 8 items");

        const ids1 = new Set(page1.items.map((it) => it.id));
        const ids2 = new Set(page2.items.map((it) => it.id));
        const ids3 = new Set(page3.items.map((it) => it.id));

        // 1. Disjointness check: no duplicates across consecutive pages on unchanged dataset
        for (const id of ids2) {
          assert.equal(ids1.has(id), false, `Item ${id} from Page 2 must not duplicate item in Page 1`);
        }
        for (const id of ids3) {
          assert.equal(ids1.has(id), false, `Item ${id} from Page 3 must not duplicate item in Page 1`);
          assert.equal(ids2.has(id), false, `Item ${id} from Page 3 must not duplicate item in Page 2`);
        }

        // 2. Deterministic ordering: lastActivityAt DESC, id DESC
        const allCombined = [...page1.items, ...page2.items, ...page3.items];
        const combinedIds = allCombined.map((item) => item.id);
        assert.equal(new Set(combinedIds).size, 28, "Every fixture must appear exactly once");
        assert.deepEqual([...combinedIds].sort(), [...paginationFixtureIds].sort(), "No expected fixture may be lost or replaced");
        assert.deepEqual(combinedIds, expectedIds, "Equal timestamps must be ordered by UUID DESC across page boundaries");
        for (let i = 0; i < allCombined.length - 1; i++) {
          const curr = allCombined[i];
          const next = allCombined[i + 1];
          const currTime = new Date(curr.lastActivityAt).getTime();
          const nextTime = new Date(next.lastActivityAt).getTime();
          assert.ok(
            currTime > nextTime || (currTime === nextTime && curr.id > next.id),
            `Ordering must be strictly lastActivityAt DESC, id DESC: (${currTime}, ${curr.id}) vs (${nextTime}, ${next.id})`
          );
        }

        // Repeating all pages against the unchanged fixture set must preserve the same ID order.
        for (let page = 1; page <= 3; page++) {
          const repeated = await listInboxConversations(pool, staffIdA, { search: tag, page, limit: 10 });
          assert.equal(repeated.totalCount, 28);
          assert.deepEqual(repeated.items.map((item) => item.id), expectedIds.slice((page - 1) * 10, page * 10));
        }

        // 3. Out-of-range page check: offset exceeds totalCount
        const farPage = await listInboxConversations(pool, staffIdA, { search: tag, page: 9999, limit: 10 });
        assert.equal(farPage.totalCount, page1.totalCount);
        assert.equal(farPage.page, 9999);
        assert.equal(farPage.items.length, 0, "Out-of-range page must return empty items array");
        assert.equal(farPage.totalPages, Math.ceil(page1.totalCount / 10));

        const noMatches = await listInboxConversations(pool, staffIdA, { search: `absent-${runId}`, page: 1, limit: 10 });
        assert.equal(noMatches.totalCount, 0);
        assert.equal(noMatches.totalPages, 0);
        assert.deepEqual(noMatches.items, []);
      }
    );

    // =========================================================================
    // AC 16 (Koreksi B2): Route handler execution with real Request/Response and session actor
    // =========================================================================
    await t.test(
      "AC 16 (Koreksi B2): Route handler execution with real Request/Response and session actor",
      async () => {
        // 1. Direct GET list route handler invocation
        const listReq = new Request("http://localhost:3000/api/inbox/conversations?page=1&limit=5");
        const listRes = await getConversationsRoute(
          listReq,
          { params: Promise.resolve({}) },
          {
            getAuthClient: async () => ({
              auth: {
                getUser: async () => ({ data: { user: { id: staffIdA } }, error: null }),
              },
            }),
            getPool: () => pool,
          }
        );

        assert.equal(listRes.status, 200);
        assert.equal(listRes.headers.get("Cache-Control"), "private, no-store");
        const listBody = await listRes.json();
        assert.equal(listBody.success, true);
        assert.equal(listBody.error, null);
        assert.ok(listBody.data.items.length <= 5);
        assert.ok(listBody.data.totalCount >= listBody.data.items.length);

        // 2. Direct GET detail route handler invocation with multiMsgConvId
        const detailReq = new Request(`http://localhost:3000/api/inbox/conversations/${multiMsgConvId}`);
        const detailRes = await getConversationDetailRoute(
          detailReq,
          { params: Promise.resolve({ id: multiMsgConvId }) },
          {
            getAuthClient: async () => ({
              auth: {
                getUser: async () => ({ data: { user: { id: staffIdA } }, error: null }),
              },
            }),
            getPool: () => pool,
          }
        );

        assert.equal(detailRes.status, 200);
        assert.equal(detailRes.headers.get("Cache-Control"), "private, no-store");
        const detailBody = await detailRes.json();
        assert.equal(detailBody.success, true);
        assert.equal(detailBody.error, null);
        assert.equal(detailBody.data.id, multiMsgConvId);
        assert.ok(detailBody.data.messages.length >= 3);
        const detailUnread = detailBody.data.messages.filter((m: { isRead: boolean }) => !m.isRead).length;
        assert.equal(detailBody.data.unreadCount, detailUnread);
        assert.equal(detailBody.data.isUnread, detailUnread > 0);

        // 3. Error routes: 401 unauthenticated
        const unauthReq = new Request("http://localhost:3000/api/inbox/conversations");
        const unauthRes = await getConversationsRoute(
          unauthReq,
          { params: Promise.resolve({}) },
          {
            getAuthClient: async () => ({
              auth: {
                getUser: async () => ({ data: { user: null }, error: new Error("unauthenticated") }),
              },
            }),
            getPool: () => pool,
          }
        );
        assert.equal(unauthRes.status, 401);
        const unauthBody = await unauthRes.json();
        assert.equal(unauthBody.success, false);
        assert.equal(unauthBody.error.code, "UNAUTHENTICATED");

        // 4. Error routes: 400 invalid param
        const invalidParamReq = new Request("http://localhost:3000/api/inbox/conversations?limit=99");
        const invalidParamRes = await getConversationsRoute(
          invalidParamReq,
          { params: Promise.resolve({}) },
          {
            getAuthClient: async () => ({
              auth: {
                getUser: async () => ({ data: { user: { id: staffIdA } }, error: null }),
              },
            }),
            getPool: () => pool,
          }
        );
        assert.equal(invalidParamRes.status, 400);

        // 5. Error routes: 404 conversation not found
        const notFoundId = randomUUID();
        const notFoundReq = new Request(`http://localhost:3000/api/inbox/conversations/${notFoundId}`);
        const notFoundRes = await getConversationDetailRoute(
          notFoundReq,
          { params: Promise.resolve({ id: notFoundId }) },
          {
            getAuthClient: async () => ({
              auth: {
                getUser: async () => ({ data: { user: { id: staffIdA } }, error: null }),
              },
            }),
            getPool: () => pool,
          }
        );
        assert.equal(notFoundRes.status, 404);
      }
    );

  } catch (err) {
    primaryError = err as Error;
  } finally {
    // Hanya lakukan mutasi pembersihan jika target lingkungan terbukti lolos guard
    if (environmentGuardPassed) {
      // Teardown test staff accounts
      try {
        if (cleanupStaffIds.length > 0) {
          await pool.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [cleanupStaffIds]);
        }
      } catch (err) {
        cleanupErrors.push(new Error(`Cleanup staff users failed: ${(err as Error).message}`));
      }

      // Teardown test fixtures via cleanupFixture
      try {
        await cleanupFixture(pool, tracker);
      } catch (err) {
        cleanupErrors.push(new Error(`Cleanup test fixtures failed: ${(err as Error).message}`));
      }
    }

    // Restore environment
    try {
      restorer.restore();
    } catch (err) {
      cleanupErrors.push(new Error(`Restore env failed: ${(err as Error).message}`));
    }

    // Tangkap error pool.end() agar tidak menimpa primaryError atau menghilangkan error cleanup
    try {
      await pool.end();
    } catch (err) {
      cleanupErrors.push(new Error(`Pool end failed: ${(err as Error).message}`));
    }

    // Laporkan primaryError dan cleanupErrors secara utuh jika keduanya terjadi
    const combined = combineErrors(primaryError, cleanupErrors);
    if (combined) {
      throw combined;
    }
  }
});
