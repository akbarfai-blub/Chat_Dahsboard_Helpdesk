import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  parseAndValidateTestConfig,
  requireIsolatedDatabase,
  TestResourceTracker,
  cleanupFixture,
  EnvRestorer,
} from "../utils/test-guard";
import { runTestMigrations } from "../utils/test-migration-runner";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import {
  saveStaffMessageClassification,
  getStaffMessageClassificationHistory,
  getInboxConversationDetail,
  InboxError,
  type Queryable,
} from "../../lib/application/inbox-service";
import { POST as classificationPostHandler } from "../../app/api/inbox/conversations/[id]/messages/[messageId]/classification/route";
import type { Database } from "../../lib/supabase/database.types";
import type { InboundReceipt } from "../../lib/application/persistence-contracts";

test("P2.8 Integration: Staff classification labels, corrections, audit history, and rule preservation", async (t) => {
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
  const botAccountId = `bot-p28-${runId}`;
  const senderExternalId = `sender-p28-${runId}`;

  let staffUserAId = "";
  let staffUserBId = "";

  try {
    // 1. Guard check: isolated test database required
    await requireIsolatedDatabase(pool, supabase, config);

    // 2. Run pending test migrations to apply 20261012100000_create_staff_classification_labels.sql
    await runTestMigrations();

    // 3. Create test staff users via Supabase auth admin
    const staffEmailA = `staff-a-${runId}@example.com`;
    const { data: userAData, error: userAError } = await supabase.auth.admin.createUser({
      email: staffEmailA,
      password: "password123!",
      email_confirm: true,
    });
    assert.ifError(userAError);
    assert.ok(userAData.user);
    staffUserAId = userAData.user.id;

    const staffEmailB = `staff-b-${runId}@example.com`;
    const { data: userBData, error: userBError } = await supabase.auth.admin.createUser({
      email: staffEmailB,
      password: "password123!",
      email_confirm: true,
    });
    assert.ifError(userBError);
    assert.ok(userBData.user);
    staffUserBId = userBData.user.id;

    // 4. Seed identity, ingress, and processed message fixture
    const persistence = new HelpdeskPersistence(pool);
    const identityId = randomUUID();

    await pool.query(
      `INSERT INTO public.channel_identities (
         id, channel, channel_account_id, sender_external_id, display_name_snapshot, verification_status
       ) VALUES ($1, 'telegram', $2, $3, $4, 'unverified')`,
      [identityId, botAccountId, senderExternalId, `User ${runId}`]
    );
    tracker.recordIdentity(identityId);

    const receipt: InboundReceipt = {
      sender: {
        channel: "telegram",
        channelAccountId: botAccountId,
        senderExternalId,
      },
      chatId: senderExternalId,
      providerMessageId: `msg-${runId}-1`,
      text: "Lampu LOS merah wifi mati sejak pagi",
      metadata: {},
    };

    const ingressResult = await persistence.receive(receipt);
    const ingressId = ingressResult.ingressId;
    tracker.recordIngress(ingressId);
    tracker.recordMessage(ingressId);

    const processResult = await persistence.process(ingressId);
    const conversationId = processResult.conversationId!;
    tracker.recordConversation(conversationId);
    if (processResult.episodeId) {
      tracker.recordComplaint(processResult.episodeId);
    }

    // Verify initial message classification produced by rule
    const initialMsgQuery = await pool.query<{ classification: Record<string, unknown> }>(
      "SELECT classification FROM public.messages WHERE id = $1",
      [ingressId]
    );
    const initialCls = initialMsgQuery.rows[0].classification;
    assert.equal(initialCls.category, "connection_complaint");
    assert.equal(initialCls.ruleVersion, "connection-keywords-v1");
    assert.deepEqual(initialCls.matchedKeywords, ["wifi mati", "los"]);

    await t.test("Subtest 1: Staff confirms correct automatic rule decision (status = 'confirmed')", async () => {
      const saveResult = await saveStaffMessageClassification(pool, staffUserAId, {
        conversationId,
        messageId: ingressId,
        category: "connection_complaint",
        notes: "Konfirmasi: komplain koneksi sah sesuai kata kunci",
      });

      assert.equal(saveResult.saved, true);
      assert.equal(saveResult.isIdempotent, false);
      assert.equal(saveResult.classification.labeledCategory, "connection_complaint");
      assert.equal(saveResult.classification.status, "confirmed");
      assert.equal(saveResult.classification.notes, "Konfirmasi: komplain koneksi sah sesuai kata kunci");
      assert.equal(saveResult.classification.staffId, staffUserAId);
      assert.equal(saveResult.classification.staffEmail, staffEmailA);

      // Verify active table in DB
      const activeQuery = await pool.query<{
        labeled_category: string;
        status: string;
        notes: string;
        staff_id: string;
        original_category: string;
        rule_version: string;
        matched_keywords: unknown;
      }>(
        "SELECT * FROM public.staff_message_classifications WHERE message_id = $1",
        [ingressId]
      );
      assert.equal(activeQuery.rows.length, 1);
      const row = activeQuery.rows[0];
      assert.equal(row.labeled_category, "connection_complaint");
      assert.equal(row.status, "confirmed");
      assert.equal(row.notes, "Konfirmasi: komplain koneksi sah sesuai kata kunci");
      assert.equal(row.staff_id, staffUserAId);
      assert.equal(row.original_category, "connection_complaint");
      assert.equal(row.rule_version, "connection-keywords-v1");
      assert.deepEqual(row.matched_keywords, ["wifi mati", "los"]);

      // Verify history table in DB
      const histQuery = await pool.query<{
        labeled_category: string;
        status: string;
        previous_category: string | null;
      }>(
        "SELECT * FROM public.staff_message_classification_history WHERE message_id = $1",
        [ingressId]
      );
      assert.equal(histQuery.rows.length, 1);
      assert.equal(histQuery.rows[0].labeled_category, "connection_complaint");
      assert.equal(histQuery.rows[0].status, "confirmed");
      assert.equal(histQuery.rows[0].previous_category, null);
    });

    await t.test("Subtest 2: Idempotent repeated save by Staff B returns existing owner Staff A without duplicate history", async () => {
      // In Subtest 1, Staff A saved the label.
      // Now Staff B attempts to save the IDENTICAL category and notes.
      const repeatedResult = await saveStaffMessageClassification(pool, staffUserBId, {
        conversationId,
        messageId: ingressId,
        category: "connection_complaint",
        notes: "Konfirmasi: komplain koneksi sah sesuai kata kunci",
      });

      assert.equal(repeatedResult.saved, true);
      assert.equal(repeatedResult.isIdempotent, true);
      assert.equal(repeatedResult.classification.labeledCategory, "connection_complaint");
      // Critical Attribution Check:
      // Must attribute to Staff A (the owning actor of the untouched record), NOT Staff B
      assert.equal(
        repeatedResult.classification.staffId,
        staffUserAId,
        "Idempotent save must return existing owner staffId (Staff A)"
      );
      assert.equal(
        repeatedResult.classification.staffEmail,
        staffEmailA,
        "Idempotent save must return existing owner staffEmail (Staff A)"
      );

      // Verify active record in database is completely untouched (still owned by Staff A)
      const activeQuery = await pool.query<{ staff_id: string }>(
        "SELECT staff_id FROM public.staff_message_classifications WHERE message_id = $1",
        [ingressId]
      );
      assert.equal(
        activeQuery.rows[0].staff_id,
        staffUserAId,
        "Database active record must retain original owner staffId (Staff A)"
      );

      // Verify history table still has only 1 row
      const histQuery = await pool.query(
        "SELECT count(*)::integer AS count FROM public.staff_message_classification_history WHERE message_id = $1",
        [ingressId]
      );
      assert.equal(histQuery.rows[0].count, 1, "Duplicate history row must not be created on identical save by different staff");
    });

    await t.test("Subtest 3: Staff B makes real change; active actor updates to Staff B and history is recorded", async () => {
      // When Staff B makes a REAL change (category 'other'), active actor updates to Staff B and history is appended
      const correctResult = await saveStaffMessageClassification(pool, staffUserBId, {
        conversationId,
        messageId: ingressId,
        category: "other",
        notes: "Koreksi oleh Staf B: pelanggan hanya mencoba format pesan",
      });

      assert.equal(correctResult.saved, true);
      assert.equal(correctResult.isIdempotent, false);
      assert.equal(correctResult.classification.labeledCategory, "other");
      assert.equal(correctResult.classification.status, "corrected");
      assert.equal(correctResult.classification.staffId, staffUserBId, "Real change must attribute to Staff B");
      assert.equal(correctResult.classification.staffEmail, staffEmailB, "Real change must attribute to Staff B's email");

      // Verify active table updated to Staff B
      const activeQuery = await pool.query<{ labeled_category: string; status: string; staff_id: string }>(
        "SELECT labeled_category, status, staff_id FROM public.staff_message_classifications WHERE message_id = $1",
        [ingressId]
      );
      assert.equal(activeQuery.rows[0].labeled_category, "other");
      assert.equal(activeQuery.rows[0].status, "corrected");
      assert.equal(activeQuery.rows[0].staff_id, staffUserBId);

      // Verify history table has 2 rows, latest has previous_category = 'connection_complaint'
      const historyList = await getStaffMessageClassificationHistory(
        pool,
        staffUserAId,
        conversationId,
        ingressId
      );
      assert.equal(historyList.length, 2);
      assert.equal(historyList[0].labeledCategory, "other");
      assert.equal(historyList[0].status, "corrected");
      assert.equal(historyList[0].previousCategory, "connection_complaint");
      assert.equal(historyList[0].staffId, staffUserBId);

      assert.equal(historyList[1].labeledCategory, "connection_complaint");
      assert.equal(historyList[1].status, "confirmed");
      assert.equal(historyList[1].previousCategory, null);
      assert.equal(historyList[1].staffId, staffUserAId);
    });

    await t.test("Subtest 4: Original rule classification in public.messages is completely preserved", async () => {
      const msgQuery = await pool.query<{ classification: Record<string, unknown> }>(
        "SELECT classification FROM public.messages WHERE id = $1",
        [ingressId]
      );
      const cls = msgQuery.rows[0].classification;
      assert.equal(cls.category, "connection_complaint", "Original rule category must remain connection_complaint");
      assert.equal(cls.ruleVersion, "connection-keywords-v1");
      assert.deepEqual(cls.matchedKeywords, ["wifi mati", "los"]);
    });

    await t.test("Subtest 5: Inbox conversation detail reflects staff classification", async () => {
      const detail = await getInboxConversationDetail(pool, staffUserAId, conversationId);
      assert.ok(detail);
      const targetMsg = detail.messages.find((m) => m.id === ingressId);
      assert.ok(targetMsg);
      assert.ok(targetMsg.staffClassification);
      assert.equal(targetMsg.staffClassification.labeledCategory, "other");
      assert.equal(targetMsg.staffClassification.status, "corrected");
      assert.equal(targetMsg.staffClassification.staffId, staffUserBId);
      assert.equal(targetMsg.staffClassification.staffEmail, staffEmailB);
    });

    await t.test("Subtest 6: Mid-transaction failure rolls back cleanly without partial mutation", async () => {
      // Create a secondary message to test transactional rollback
      const receipt2: InboundReceipt = {
        sender: {
          channel: "telegram",
          channelAccountId: botAccountId,
          senderExternalId,
        },
        chatId: senderExternalId,
        providerMessageId: `msg-${runId}-2`,
        text: "Pesan kedua tanpa masalah",
        metadata: {},
      };
      const ingressResult2 = await persistence.receive(receipt2);
      const ingressId2 = ingressResult2.ingressId;
      tracker.recordIngress(ingressId2);
      tracker.recordMessage(ingressId2);

      await persistence.process(ingressId2);

      // Fault injection: simulate failure before commit
      await assert.rejects(
        saveStaffMessageClassification(
          pool,
          staffUserAId,
          {
            conversationId,
            messageId: ingressId2,
            category: "other",
            notes: "Test fault",
          },
          {
            onBeforeCommit: async () => {
              throw new Error("INJECTED_TRANSACTION_FAILURE");
            },
          }
        ),
        /INJECTED_TRANSACTION_FAILURE/
      );

      // Verify neither active table nor history contains rows for ingressId2
      const activeCheck = await pool.query(
        "SELECT count(*)::integer AS count FROM public.staff_message_classifications WHERE message_id = $1",
        [ingressId2]
      );
      assert.equal(activeCheck.rows[0].count, 0, "Active record must be rolled back");

      const histCheck = await pool.query(
        "SELECT count(*)::integer AS count FROM public.staff_message_classification_history WHERE message_id = $1",
        [ingressId2]
      );
      assert.equal(histCheck.rows[0].count, 0, "History record must be rolled back");
    });

    await t.test("Subtest 7: Concurrent saves are serialized cleanly via advisory lock", async () => {
      const receipt3: InboundReceipt = {
        sender: {
          channel: "telegram",
          channelAccountId: botAccountId,
          senderExternalId,
        },
        chatId: senderExternalId,
        providerMessageId: `msg-${runId}-3`,
        text: "Pesan ketiga untuk uji penyimpanan bersamaan",
        metadata: {},
      };
      const ingressResult3 = await persistence.receive(receipt3);
      const ingressId3 = ingressResult3.ingressId;
      tracker.recordIngress(ingressId3);
      tracker.recordMessage(ingressId3);
      await persistence.process(ingressId3);

      // Fire 2 concurrent saves on ingressId3 via Promise.all
      const [resConcurrentA, resConcurrentB] = await Promise.all([
        saveStaffMessageClassification(pool, staffUserAId, {
          conversationId,
          messageId: ingressId3,
          category: "other",
          notes: "Concurrent save A",
        }),
        saveStaffMessageClassification(pool, staffUserBId, {
          conversationId,
          messageId: ingressId3,
          category: "review",
          notes: "Concurrent save B",
        }),
      ]);

      assert.equal(resConcurrentA.saved, true);
      assert.equal(resConcurrentB.saved, true);

      // Exactly 1 active row exists in public.staff_message_classifications
      const activeRes = await pool.query<{
        labeled_category: string;
        status: string;
        notes: string;
        staff_id: string;
        original_category: string;
        rule_version: string;
        updated_at: Date;
      }>(
        "SELECT labeled_category, status, notes, staff_id, original_category, rule_version, updated_at FROM public.staff_message_classifications WHERE message_id = $1",
        [ingressId3]
      );
      assert.equal(activeRes.rows.length, 1, "Exactly one active record must exist despite concurrent saves");
      const activeRow = activeRes.rows[0];

      // Exactly 2 history entries exist in public.staff_message_classification_history ordered by created_at ASC
      const histRes = await pool.query<{
        id: string;
        labeled_category: string;
        status: string;
        notes: string;
        staff_id: string;
        previous_category: string | null;
        original_category: string;
        rule_version: string;
        created_at: Date;
      }>(
        "SELECT id, labeled_category, status, notes, staff_id, previous_category, original_category, rule_version, created_at FROM public.staff_message_classification_history WHERE message_id = $1 ORDER BY created_at ASC, id ASC",
        [ingressId3]
      );
      assert.equal(
        histRes.rows.length,
        2,
        "History must capture both serialized saves without duplication or missing transitions"
      );
      const h0 = histRes.rows[0];
      const h1 = histRes.rows[1];

      // Identify which valid serial order committed first:
      // Option 1: Staff A committed first ('other'), then Staff B ('review')
      // Option 2: Staff B committed first ('review'), then Staff A ('other')
      const isOrderAThenB = h0.staff_id === staffUserAId && h1.staff_id === staffUserBId;
      const isOrderBThenA = h0.staff_id === staffUserBId && h1.staff_id === staffUserAId;
      assert.ok(
        isOrderAThenB || isOrderBThenA,
        `History entries must reflect a valid serial order between Staff A and Staff B (actual order: h0=${h0.staff_id}, h1=${h1.staff_id})`
      );

      if (isOrderAThenB) {
        // Transition 1: Staff A saved 'other' (first save has previous_category = null)
        // Note: original_category for message 3 is 'other', so saving 'other' has status 'confirmed'
        assert.equal(h0.labeled_category, "other");
        assert.equal(h0.notes, "Concurrent save A");
        assert.equal(h0.previous_category, null);
        assert.equal(h0.status, "confirmed");

        // Transition 2: Staff B saved 'review' (previous_category must chain from Staff A 'other')
        assert.equal(h1.labeled_category, "review");
        assert.equal(h1.notes, "Concurrent save B");
        assert.equal(h1.previous_category, "other", "Second transition previous_category must chain from first save");
        assert.equal(h1.status, "corrected");

        // Active record MUST strictly match Staff B (the final change in history)
        assert.equal(activeRow.staff_id, staffUserBId, "Active record actor must match winner (Staff B)");
        assert.equal(activeRow.labeled_category, "review", "Active category must match winner (review)");
        assert.equal(activeRow.notes, "Concurrent save B", "Active notes must match winner");
        assert.equal(activeRow.status, "corrected");
        assert.equal(
          new Date(activeRow.updated_at).getTime(),
          new Date(h1.created_at).getTime(),
          "Active updated_at must match final history created_at"
        );
      } else {
        // Transition 1: Staff B saved 'review' (first save has previous_category = null)
        assert.equal(h0.labeled_category, "review");
        assert.equal(h0.notes, "Concurrent save B");
        assert.equal(h0.previous_category, null);
        assert.equal(h0.status, "corrected");

        // Transition 2: Staff A saved 'other' (previous_category must chain from Staff B 'review')
        // Note: original_category is 'other', so saving 'other' has status 'confirmed'
        assert.equal(h1.labeled_category, "other");
        assert.equal(h1.notes, "Concurrent save A");
        assert.equal(h1.previous_category, "review", "Second transition previous_category must chain from first save");
        assert.equal(h1.status, "confirmed");

        // Active record MUST strictly match Staff A (the final change in history)
        assert.equal(activeRow.staff_id, staffUserAId, "Active record actor must match winner (Staff A)");
        assert.equal(activeRow.labeled_category, "other", "Active category must match winner (other)");
        assert.equal(activeRow.notes, "Concurrent save A", "Active notes must match winner");
        assert.equal(activeRow.status, "confirmed");
        assert.equal(
          new Date(activeRow.updated_at).getTime(),
          new Date(h1.created_at).getTime(),
          "Active updated_at must match final history created_at"
        );
      }
    });

    await t.test("Subtest 8: Database authorization - direct mutations by anon and authenticated are rejected (42501)", async () => {
      const dbAuthClient = await pool.connect();
      try {
        await dbAuthClient.query("BEGIN");
        await dbAuthClient.query("SET LOCAL ROLE authenticated");
        await dbAuthClient.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [staffUserAId]);

        // 1. Direct INSERT on staff_message_classifications -> 42501
        await dbAuthClient.query("SAVEPOINT sp_ins");
        await assert.rejects(
          dbAuthClient.query(
            `INSERT INTO public.staff_message_classifications (
               message_id, conversation_id, staff_id, labeled_category, status, original_category, rule_version
             ) VALUES ($1, $2, $3, 'other', 'corrected', 'other', 'v1')`,
            [ingressId, conversationId, staffUserAId]
          ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, "42501", "Direct INSERT by authenticated must fail with 42501");
            return true;
          }
        );
        await dbAuthClient.query("ROLLBACK TO SAVEPOINT sp_ins");

        // 2. Direct UPDATE on staff_message_classifications -> 42501
        await dbAuthClient.query("SAVEPOINT sp_upd");
        await assert.rejects(
          dbAuthClient.query(
            "UPDATE public.staff_message_classifications SET notes = 'unauthorized' WHERE message_id = $1",
            [ingressId]
          ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, "42501", "Direct UPDATE by authenticated must fail with 42501");
            return true;
          }
        );
        await dbAuthClient.query("ROLLBACK TO SAVEPOINT sp_upd");

        // 3. Direct DELETE on staff_message_classifications -> 42501
        await dbAuthClient.query("SAVEPOINT sp_del");
        await assert.rejects(
          dbAuthClient.query(
            "DELETE FROM public.staff_message_classifications WHERE message_id = $1",
            [ingressId]
          ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, "42501", "Direct DELETE by authenticated must fail with 42501");
            return true;
          }
        );
        await dbAuthClient.query("ROLLBACK TO SAVEPOINT sp_del");

        // 4. Direct INSERT on staff_message_classification_history -> 42501
        await dbAuthClient.query("SAVEPOINT sp_hist");
        await assert.rejects(
          dbAuthClient.query(
            `INSERT INTO public.staff_message_classification_history (
               message_id, conversation_id, staff_id, labeled_category, status, original_category, rule_version
             ) VALUES ($1, $2, $3, 'other', 'corrected', 'other', 'v1')`,
            [ingressId, conversationId, staffUserAId]
          ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, "42501", "Direct INSERT on history by authenticated must fail with 42501");
            return true;
          }
        );
        await dbAuthClient.query("ROLLBACK TO SAVEPOINT sp_hist");

        // 5. Direct mutations as anon role -> 42501
        await dbAuthClient.query("SET LOCAL ROLE anon");
        await dbAuthClient.query("SAVEPOINT sp_anon");
        await assert.rejects(
          dbAuthClient.query(
            `INSERT INTO public.staff_message_classifications (
               message_id, conversation_id, staff_id, labeled_category, status, original_category, rule_version
             ) VALUES ($1, $2, $3, 'other', 'corrected', 'other', 'v1')`,
            [ingressId, conversationId, staffUserAId]
          ),
          (err: unknown) => {
            assert.equal((err as { code?: string }).code, "42501", "Direct INSERT by anon must fail with 42501");
            return true;
          }
        );
        await dbAuthClient.query("ROLLBACK TO SAVEPOINT sp_anon");

        await dbAuthClient.query("ROLLBACK");
      } finally {
        dbAuthClient.release();
      }
    });

    await t.test("Subtest 9: Route handler prevents actor spoofing in payload (session user strictly enforced)", async () => {
      const fakeAttackerStaffId = randomUUID();
      const spoofReq = new Request(
        `http://localhost/api/inbox/conversations/${conversationId}/messages/${ingressId}/classification`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Host: "localhost",
          },
          body: JSON.stringify({
            category: "review",
            notes: "Uji payload spoofing aktor",
            staffId: fakeAttackerStaffId,
            staffEmail: "attacker@evil.com",
          }),
        }
      );

      const routeResponse = await classificationPostHandler(
        spoofReq,
        { params: Promise.resolve({ id: conversationId, messageId: ingressId }) },
        {
          getAuthClient: async () => ({
            auth: { getUser: async () => ({ data: { user: { id: staffUserAId } }, error: null }) },
          }),
          getPool: () => pool,
          validateOrigin: () => ({ valid: true, origin: "http://localhost" }),
        }
      );

      const routeJson = await routeResponse.json();
      if (!routeJson.success) {
        console.error("Subtest 9 failed routeJson:", routeJson);
      }
      assert.equal(routeJson.success, true);
      assert.equal(
        routeJson.data.classification.staffId,
        staffUserAId,
        "Actor staffId must strictly originate from authenticated session user A"
      );
      assert.equal(
        routeJson.data.classification.staffEmail,
        staffEmailA,
        "Actor staffEmail must belong to authenticated session user A"
      );
      assert.notEqual(
        routeJson.data.classification.staffId,
        fakeAttackerStaffId,
        "Payload staffId spoofing must be completely ignored"
      );
    });

    await t.test("Subtest 10: Zero operational side effects and snapshot preservation (episode, claim, debounce untouched)", async () => {
      assert.ok(processResult.episodeId, "Episode ID must be present in processResult");
      const targetComplaintId = processResult.episodeId;

      // 1. Establish authentic operational fixture: reply_owner, outbound_intent, and episode reply_claim
      const ownerRes = await pool.query<{ id: string }>(
        `INSERT INTO public.reply_owners (identity_id)
         VALUES ($1)
         ON CONFLICT (identity_id) DO UPDATE SET identity_id = EXCLUDED.identity_id
         RETURNING id`,
        [identityId]
      );
      const ownerId = ownerRes.rows[0].id;
      tracker.recordOwner(ownerId);

      const intentRes = await pool.query<{ id: string }>(
        `INSERT INTO public.outbound_intents (
           origin, owner_id, complaint_id, message_id, decision, status
         ) VALUES ('automatic', $1, $2, $3, '{"mode":"LOS_AND_GENERIC"}'::jsonb, 'pending')
         ON CONFLICT (message_id) DO UPDATE SET status = 'pending'
         RETURNING id`,
        [ownerId, targetComplaintId, ingressId]
      );
      const intentId = intentRes.rows[0].id;

      await pool.query(
        `INSERT INTO public.reply_claims (
           owner_id, scope_kind, scope_id, complaint_id, outbound_intent_id
         ) VALUES ($1, 'episode', $2, $3, $4)
         ON CONFLICT (owner_id, scope_kind, scope_id) DO NOTHING`,
        [ownerId, targetComplaintId, targetComplaintId, intentId]
      );

      // Snapshot full complaint record before staff save
      const complaintBefore = (
        await pool.query(
          `SELECT id, identity_id, service_id, status, category, version, is_primary,
                  automation_suppressed, resolution_note, split_from_episode_id, previous_episode_id,
                  created_at, updated_at, closed_at
           FROM public.complaints WHERE id = $1`,
          [targetComplaintId]
        )
      ).rows[0];

      // Snapshot full reply_claim record before staff save
      const claimBefore = (
        await pool.query(
          `SELECT owner_id, scope_kind, scope_id, complaint_id, outbound_intent_id, created_at
           FROM public.reply_claims WHERE owner_id = $1 AND scope_kind = 'episode' AND scope_id = $2`,
          [ownerId, targetComplaintId]
        )
      ).rows[0];

      // Snapshot full outbound_intent record before staff save
      const intentBefore = (
        await pool.query(
          `SELECT id, origin, owner_id, complaint_id, message_id, decision, staff_id,
                  client_request_id, body, status, created_at, updated_at
           FROM public.outbound_intents WHERE id = $1`,
          [intentId]
        )
      ).rows[0];

      // Snapshot total table counts before staff save
      const countsBefore = {
        complaints: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.complaints")).rows[0].c,
        replyClaims: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.reply_claims")).rows[0].c,
        outboundIntents: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.outbound_intents")).rows[0].c,
      };

      // Execute staff classification save via application service!
      const saveRes = await saveStaffMessageClassification(pool, staffUserAId, {
        conversationId,
        messageId: ingressId,
        category: "other",
        notes: "Uji preservasi operasional: verifikasi snapshot episode dan klaim",
      });
      assert.equal(saveRes.saved, true);

      // Snapshot after staff save
      const complaintAfter = (
        await pool.query(
          `SELECT id, identity_id, service_id, status, category, version, is_primary,
                  automation_suppressed, resolution_note, split_from_episode_id, previous_episode_id,
                  created_at, updated_at, closed_at
           FROM public.complaints WHERE id = $1`,
          [targetComplaintId]
        )
      ).rows[0];

      const claimAfter = (
        await pool.query(
          `SELECT owner_id, scope_kind, scope_id, complaint_id, outbound_intent_id, created_at
           FROM public.reply_claims WHERE owner_id = $1 AND scope_kind = 'episode' AND scope_id = $2`,
          [ownerId, targetComplaintId]
        )
      ).rows[0];

      const intentAfter = (
        await pool.query(
          `SELECT id, origin, owner_id, complaint_id, message_id, decision, staff_id,
                  client_request_id, body, status, created_at, updated_at
           FROM public.outbound_intents WHERE id = $1`,
          [intentId]
        )
      ).rows[0];

      const countsAfter = {
        complaints: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.complaints")).rows[0].c,
        replyClaims: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.reply_claims")).rows[0].c,
        outboundIntents: (await pool.query<{ c: number }>("SELECT count(*)::int as c FROM public.outbound_intents")).rows[0].c,
      };

      // Field-by-field assertions for operational immutability
      assert.deepEqual(complaintAfter, complaintBefore, "Complaint episode operational record must remain 100% identical");
      assert.deepEqual(claimAfter, claimBefore, "Reply claim and debounce guard must remain 100% identical");
      assert.deepEqual(intentAfter, intentBefore, "Outbound intent record must remain 100% identical");

      // Verify no new side effects created
      assert.equal(countsAfter.complaints, countsBefore.complaints, "No new complaints created");
      assert.equal(countsAfter.replyClaims, countsBefore.replyClaims, "No new reply claims created");
      assert.equal(countsAfter.outboundIntents, countsBefore.outboundIntents, "No new outbound intents created");

      // Verify classification and history were updated as expected
      const activeCls = (
        await pool.query<{ labeled_category: string; notes: string | null }>(
          "SELECT labeled_category, status, notes FROM public.staff_message_classifications WHERE message_id = $1",
          [ingressId]
        )
      ).rows[0];
      assert.equal(activeCls.labeled_category, "other");
      assert.equal(activeCls.notes, "Uji preservasi operasional: verifikasi snapshot episode dan klaim");
    });
  } finally {
    // Teardown and clean up test resources
    await cleanupFixture(pool, tracker);

    if (staffUserAId) {
      await supabase.auth.admin.deleteUser(staffUserAId).catch(() => {});
    }
    if (staffUserBId) {
      await supabase.auth.admin.deleteUser(staffUserBId).catch(() => {});
    }

    await pool.end();
    restorer.restore();
  }
});
