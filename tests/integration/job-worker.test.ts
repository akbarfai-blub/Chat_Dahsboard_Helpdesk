import "../utils/setup-node-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import pg, { type Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { HelpdeskPersistence } from "../../lib/application/helpdesk-persistence";
import { PersistenceError } from "../../lib/application/persistence-contracts";
import {
  claimJob,
  claimNextJob,
  recordJobFailure,
  processJobWithWorker,
  drainProcessingJobs,
} from "../../lib/application/job-worker-service";
import { handleTelegramWebhook } from "../../lib/application/telegram-inbound-service";
import { POST } from "../../app/api/webhooks/telegram/route";
import { getHelpdeskPool, closeHelpdeskPool } from "../../lib/postgres/server";
import { getHelpdeskAdminClient } from "../../lib/supabase/server";
import {
  checkTestEnvAvailable,
  requireIsolatedDatabase,
  verifyTestTargetIdentity,
  cleanupFixture,
  TestResourceTracker,
  EnvRestorer,
  combineErrors,
} from "../utils/test-guard";

// Ensure globalThis.AsyncLocalStorage is available for Next.js internal storage
const customGlobal = globalThis as unknown as { AsyncLocalStorage?: unknown };
if (typeof customGlobal.AsyncLocalStorage === "undefined") {
  customGlobal.AsyncLocalStorage = AsyncLocalStorage;
}

// Next.js internal runtime harnesses for after() verification
/* eslint-disable @typescript-eslint/no-require-imports */
const next = require("next");
const { AfterRunner } = require("next/dist/server/after/run-with-after");
const { AfterContext } = require("next/dist/server/after/after-context");
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external");
/* eslint-enable @typescript-eslint/no-require-imports */

test("P2.5 Job Worker with Leases, Attempts, and Post-ACK Drain", async (t) => {
  const { available, config, reason } = checkTestEnvAvailable();
  if (!available || !config) {
    t.skip(`Skipping P2.5 integration tests: ${reason}`);
    return;
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const supabase = createClient<Database>(config.apiUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let origSettings: { mode: string; emergency_stop: boolean } | null = null;

  try {
    await requireIsolatedDatabase(pool, supabase, config);

    // Verify that the server runtime factory getHelpdeskAdminClient() points to the verified test environment
    const runtimeAdminClient = getHelpdeskAdminClient();
    const adminUrl = (runtimeAdminClient as unknown as { supabaseUrl?: string }).supabaseUrl;
    if (adminUrl !== config.apiUrl) {
      throw new Error(
        `FAIL-CLOSED: getHelpdeskAdminClient target (${adminUrl}) does not match test API environment (${config.apiUrl}). Refusing to run tests.`
      );
    }
    await verifyTestTargetIdentity(pool, runtimeAdminClient, config.expectedMarker);

    // Refresh mock observation timestamps for the test run so observations are fresh
    const refreshSql = readFileSync(
      resolve(process.cwd(), "supabase/fixtures/refresh-network-observations.sql"),
      "utf8"
    ).replace(/^\uFEFF/, "");
    await pool.query(refreshSql);

    const persistence = new HelpdeskPersistence(pool);

    // Record original automation settings
    const settingsRes = await pool.query<{ mode: string; emergency_stop: boolean }>(
      "SELECT mode, emergency_stop FROM public.automation_settings WHERE singleton = true"
    );
    if (settingsRes.rows.length > 0) {
      origSettings = {
        mode: settingsRes.rows[0].mode,
        emergency_stop: settingsRes.rows[0].emergency_stop,
      };
    }

    const seedCustomerId = "10000000-0000-4000-8000-000000000001";

    async function createTestIdentity(
      tracker: TestResourceTracker,
      suffix: string,
      verified = true,
      customerId = seedCustomerId,
      numericSenderId?: string,
      botAccountId?: string
    ) {
      const id = randomUUID();
      const accountId = botAccountId ?? `acc_${suffix}`;
      const senderId = numericSenderId ?? `snd_${suffix}`;
      await pool.query(
        `INSERT INTO public.channel_identities(
          id, channel, channel_account_id, sender_external_id, customer_id, verification_status, verified_at
        ) VALUES ($1, 'telegram', $2, $3, $4, $5, $6)`,
        [
          id,
          accountId,
          senderId,
          verified ? customerId : null,
          verified ? "verified" : "unverified",
          verified ? new Date().toISOString() : null,
        ]
      );
      tracker.recordIdentity(id);
      return { id, accountId, senderId };
    }

    // -------------------------------------------------------------------------
    // AC 1: Concurrency Protection — Two parallel triggers result in exactly 1 claim
    // -------------------------------------------------------------------------
    await t.test("Concurrency Protection: parallel claims grant exactly one active lease", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p1_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Internet saya mati total",
        });
        tracker.recordIngress(ingress.ingressId);

        // Run 2 parallel claim attempts for this specific job
        const [claim1, claim2] = await Promise.all([
          claimJob(pool, { ingressId: ingress.ingressId, leaseDurationMs: 10_000 }),
          claimJob(pool, { ingressId: ingress.ingressId, leaseDurationMs: 10_000 }),
        ]);

        // Exactly one claim succeeds, the other returns null
        const successfulClaim = claim1 ?? claim2;
        const failedClaim = claim1 ? claim2 : claim1;

        assert.ok(successfulClaim != null, "One worker must successfully claim the job");
        assert.equal(failedClaim, null, "The concurrent worker must receive null");
        assert.equal(successfulClaim.ingressId, ingress.ingressId);
        assert.equal(successfulClaim.attemptNumber, 1);
        assert.ok(successfulClaim.leaseToken.length > 0);

        // Check database state
        const jobRow = await pool.query<{
          status: string;
          lease_token: string;
          attempt_count: number;
        }>(
          "SELECT status, lease_token, attempt_count FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobRow.rows[0].status, "in_progress");
        assert.equal(jobRow.rows[0].lease_token, successfulClaim.leaseToken);
        assert.equal(jobRow.rows[0].attempt_count, 1);

        // Check attempts history
        const attempts = await pool.query<{
          attempt_number: number;
          lease_token: string;
          outcome: string;
        }>(
          "SELECT attempt_number, lease_token, outcome FROM public.processing_job_attempts WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(attempts.rowCount, 1);
        assert.equal(attempts.rows[0].attempt_number, 1);
        assert.equal(attempts.rows[0].lease_token, successfulClaim.leaseToken);
        assert.equal(attempts.rows[0].outcome, "in_progress");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 2: Valid Lease Protection & Expired Lease Recovery
    // -------------------------------------------------------------------------
    await t.test("Valid Lease Protection & Expired Lease Recovery", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p2_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Internet saya gangguan",
        });
        tracker.recordIngress(ingress.ingressId);

        const startTime = new Date(1700000000000); // Fixed deterministic start
        const leaseDurationMs = 5000;
        await pool.query(
          "UPDATE public.processing_jobs SET next_attempt_at = $1 WHERE ingress_id = $2",
          [startTime.toISOString(), ingress.ingressId]
        );

        // 1. Worker 1 claims job with 5-second lease
        const claim1 = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs,
          now: startTime,
        });
        assert.ok(claim1 != null);
        assert.equal(claim1.attemptNumber, 1);

        // 2. Worker 2 attempts to claim at startTime + 2s (lease still valid) -> rejected
        const claimDuringLease = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs,
          now: new Date(startTime.getTime() + 2000),
        });
        assert.equal(claimDuringLease, null, "Active valid lease cannot be claimed");

        // 3. Worker 2 attempts to claim at startTime + 6s (lease expired) -> recovery succeeds!
        const recoveryTime = new Date(startTime.getTime() + 6000);
        const claim2 = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs,
          now: recoveryTime,
        });
        assert.ok(claim2 != null, "Expired lease must be recoverable by another worker");
        assert.equal(claim2.attemptNumber, 2);
        assert.notEqual(claim2.leaseToken, claim1.leaseToken, "New claim must generate distinct lease token");

        // Verify attempts history: attempt 1 marked 'lease_expired', attempt 2 is 'in_progress'
        const attempts = await pool.query<{
          attempt_number: number;
          outcome: string;
          lease_token: string;
        }>(
          "SELECT attempt_number, outcome, lease_token FROM public.processing_job_attempts WHERE ingress_id = $1 ORDER BY attempt_number ASC",
          [ingress.ingressId]
        );
        assert.equal(attempts.rowCount, 2);
        assert.equal(attempts.rows[0].attempt_number, 1);
        assert.equal(attempts.rows[0].outcome, "lease_expired");
        assert.equal(attempts.rows[0].lease_token, claim1.leaseToken);

        assert.equal(attempts.rows[1].attempt_number, 2);
        assert.equal(attempts.rows[1].outcome, "in_progress");
        assert.equal(attempts.rows[1].lease_token, claim2.leaseToken);
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 3: Fenced Stale Worker Execution & Mutation Protection
    // -------------------------------------------------------------------------
    await t.test("Fenced Stale Worker Execution: stale worker cannot commit or overwrite state", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p3_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Lampu LOS merah berkedip",
        });
        tracker.recordIngress(ingress.ingressId);

        // 1. Worker A claims job with short 1000ms lease
        const workerAClaim = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 1000,
        });
        assert.ok(workerAClaim != null);

        // 2. Wait 1100ms for Worker A's lease to expire
        await new Promise((r) => setTimeout(r, 1100));

        // 3. Worker B reclaims job with active 30s lease
        const workerBClaim = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 30_000,
        });
        assert.ok(workerBClaim != null);
        assert.equal(workerBClaim.attemptNumber, 2);

        // 4. Stale Worker A wakes up and attempts to commit via persistence.process()
        await assert.rejects(
          async () => {
            await persistence.process(ingress.ingressId, {
              leaseToken: workerAClaim.leaseToken,
            });
          },
          (err: unknown) => {
            assert.ok(err instanceof PersistenceError);
            assert.equal(err.code, "lease_lost");
            return true;
          },
          "Stale Worker A must be rejected with lease_lost"
        );

        // Verify that Worker A's transaction rolled back completely: 0 messages, 0 assessments
        const messagesCheck = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(messagesCheck.rows[0].count), 0, "No messages committed by stale worker");

        const assessmentCheck = await pool.query(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(assessmentCheck.rows[0].count), 0, "No assessments committed by stale worker");

        // 5. Stale Worker A also tries to record failure via recordJobFailure()
        const failureRecordResult = await recordJobFailure(
          pool,
          ingress.ingressId,
          workerAClaim.leaseToken,
          new Error("Simulated late failure from Worker A")
        );
        assert.equal(failureRecordResult, "lease_lost", "recordJobFailure must reject stale leaseToken");

        // 6. Worker B processes successfully
        const workerBResult = await processJobWithWorker(pool, supabase, workerBClaim, {
          orchestrationOptions: { scenarioId: "normal" },
        });
        assert.equal(workerBResult.outcome, "success");

        // Verify database state: job is done, attempt 2 is success
        const jobRow = await pool.query<{ status: string; completed_at: string | null }>(
          "SELECT status, completed_at FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobRow.rows[0].status, "done");
        assert.ok(jobRow.rows[0].completed_at != null);

        const attemptRow = await pool.query<{ outcome: string }>(
          "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 2",
          [ingress.ingressId]
        );
        assert.equal(attemptRow.rows[0].outcome, "success");

        // 6. Direct process() on a done job is idempotent and does not revert to pending/in_progress
        const directDone = await persistence.process(ingress.ingressId);
        assert.equal(directDone.messageId, ingress.ingressId);
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 3b: recordJobFailure rejects expired lease without reclaim
    // -------------------------------------------------------------------------
    await t.test("recordJobFailure: rejects expired lease even before another worker reclaims it", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p1exp_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Lampu LOS merah",
        });
        tracker.recordIngress(ingress.ingressId);

        // 1. Worker A claims job with short 500ms lease
        const workerAClaim = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 500,
        });
        assert.ok(workerAClaim != null);
        assert.equal(workerAClaim.attemptNumber, 1);

        // 2. Wait 600ms for Worker A's lease to expire without another worker reclaiming it
        await new Promise((r) => setTimeout(r, 600));

        // 3. Stale Worker A wakes up and attempts to record failure via recordJobFailure()
        // Note: lease_token in database STILL belongs to Worker A, but lease_expires_at has expired!
        const failureOutcome = await recordJobFailure(
          pool,
          ingress.ingressId,
          workerAClaim.leaseToken,
          new Error("Late failure from Worker A whose lease expired")
        );
        assert.equal(failureOutcome, "lease_lost", "recordJobFailure must reject expired lease without reclaim");

        // 4. Verify ZERO mutations occurred on processing_jobs
        const jobCheck = await pool.query<{
          status: string;
          lease_token: string | null;
          last_error: string | null;
        }>(
          "SELECT status, lease_token, last_error FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobCheck.rows[0].status, "in_progress", "Job status must remain in_progress");
        assert.equal(jobCheck.rows[0].lease_token, workerAClaim.leaseToken, "Lease token must not be cleared or changed");
        assert.equal(jobCheck.rows[0].last_error, null, "last_error must not be updated by stale worker");

        // 5. Verify ZERO mutations occurred on processing_job_attempts
        const attemptCheck = await pool.query<{
          outcome: string;
          completed_at: string | null;
          error_message: string | null;
        }>(
          "SELECT outcome, completed_at, error_message FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
          [ingress.ingressId]
        );
        assert.equal(attemptCheck.rows[0].outcome, "in_progress", "Attempt outcome must not be altered by stale worker");
        assert.equal(attemptCheck.rows[0].completed_at, null, "Attempt completed_at must remain null");
        assert.equal(attemptCheck.rows[0].error_message, null, "Attempt error_message must remain null");

        // 6. Now Worker B reclaims the expired job via claimJob()
        const workerBClaim = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 30_000,
        });
        assert.ok(workerBClaim != null, "Worker B must be able to reclaim expired job");
        assert.equal(workerBClaim.attemptNumber, 2);

        // Attempt 1 is now marked lease_expired by Worker B's claim
        const attempt1AfterReclaim = await pool.query<{ outcome: string }>(
          "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
          [ingress.ingressId]
        );
        assert.equal(attempt1AfterReclaim.rows[0].outcome, "lease_expired");

        // Worker B finishes processing successfully
        const workerBResult = await processJobWithWorker(pool, supabase, workerBClaim, {
          orchestrationOptions: { scenarioId: "normal" },
        });
        assert.equal(workerBResult.outcome, "success");

        const finalJob = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(finalJob.rows[0].status, "done");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 4: Direct process() protects against actively leased jobs
    // -------------------------------------------------------------------------
    await t.test("Direct process() without leaseToken rejects actively leased jobs", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p4_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Koneksi drop terus",
        });
        tracker.recordIngress(ingress.ingressId);

        // Worker claims job with 30s lease
        const claimed = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 30_000,
        });
        assert.ok(claimed != null);

        // Direct call without leaseToken while lease is active
        await assert.rejects(
          async () => {
            await persistence.process(ingress.ingressId);
          },
          (err: unknown) => {
            assert.ok(err instanceof PersistenceError);
            assert.equal(err.code, "job_leased_by_other_worker");
            return true;
          },
          "Direct process() without lease token must reject actively leased job"
        );
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 4b: Direct process() without leaseToken rejects expired in_progress jobs
    // -------------------------------------------------------------------------
    await t.test("Direct process() without leaseToken rejects in_progress job with expired lease and preserves attempt consistency", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p2exp_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Koneksi tidak stabil",
        });
        tracker.recordIngress(ingress.ingressId);

        // 1. Worker claims job with short 500ms lease
        const claimed = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 500,
        });
        assert.ok(claimed != null);
        assert.equal(claimed.attemptNumber, 1);

        // 2. Wait 600ms for lease to expire
        await new Promise((r) => setTimeout(r, 600));

        // Verify in database: status is still in_progress and lease has expired
        const jobBefore = await pool.query<{ status: string; lease_expires_at: string }>(
          "SELECT status, lease_expires_at FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobBefore.rows[0].status, "in_progress");
        assert.ok(new Date(jobBefore.rows[0].lease_expires_at).getTime() < Date.now());

        // 3. Direct call persistence.process() WITHOUT leaseToken on this expired in_progress job
        await assert.rejects(
          async () => {
            await persistence.process(ingress.ingressId);
          },
          (err: unknown) => {
            assert.ok(err instanceof PersistenceError);
            assert.equal(err.code, "job_lease_expired");
            return true;
          },
          "Direct process() without lease token on an expired in_progress job must reject with job_lease_expired"
        );

        // 4. Assert ZERO side effects:
        // - 0 messages created
        const msgCheck = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(msgCheck.rows[0].count), 0, "No messages must be created");

        // - 0 triage_assessments created
        const assessmentCheck = await pool.query(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(assessmentCheck.rows[0].count), 0, "No triage assessments must be created");

        // - job status remains in_progress (NOT done)
        const jobAfter = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobAfter.rows[0].status, "in_progress", "Job status must remain in_progress");

        // - attempt 1 remains in_progress with completed_at = null (no inconsistent history)
        const attemptCheck = await pool.query<{ outcome: string; completed_at: string | null }>(
          "SELECT outcome, completed_at FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
          [ingress.ingressId]
        );
        assert.equal(attemptCheck.rows[0].outcome, "in_progress", "Attempt must remain in_progress until properly reclaimed");
        assert.equal(attemptCheck.rows[0].completed_at, null);

        // 5. Recovery through proper claimJob succeeds and completes cleanly
        const recoveryClaim = await claimJob(pool, {
          ingressId: ingress.ingressId,
          leaseDurationMs: 30_000,
        });
        assert.ok(recoveryClaim != null);
        assert.equal(recoveryClaim.attemptNumber, 2);

        // Attempt 1 transitioned to lease_expired by claimJob
        const attempt1Final = await pool.query<{ outcome: string }>(
          "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
          [ingress.ingressId]
        );
        assert.equal(attempt1Final.rows[0].outcome, "lease_expired");

        // Recovery worker completes job
        const recoveryResult = await processJobWithWorker(pool, supabase, recoveryClaim, {
          orchestrationOptions: { scenarioId: "normal" },
        });
        assert.equal(recoveryResult.outcome, "success");

        const finalJobState = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(finalJobState.rows[0].status, "done");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 5: Retry Scheduling, Exponential Backoff, and Terminal Failure
    // -------------------------------------------------------------------------
    await t.test("Retry Scheduling: respects next_attempt_at backoff and max attempts limit", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p5_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Internet saya mati total",
        });
        tracker.recordIngress(ingress.ingressId);

        const t0 = new Date(1700000000000);
        const baseBackoffMs = 2000;
        await pool.query(
          "UPDATE public.processing_jobs SET next_attempt_at = $1 WHERE ingress_id = $2",
          [t0.toISOString(), ingress.ingressId]
        );

        // Attempt 1: Claim at t0
        const claim1 = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: t0,
        });
        assert.ok(claim1 != null);
        assert.equal(claim1.attemptNumber, 1);

        // Attempt 1 fails with transient network error
        const fail1 = await recordJobFailure(
          pool,
          ingress.ingressId,
          claim1.leaseToken,
          new Error("Transient connection error"),
          { now: t0, validationNow: t0, baseBackoffMs }
        );
        assert.equal(fail1, "retrying");

        // Verify status is pending, next_attempt_at is t0 + 2000ms
        const jobAfterFail1 = await pool.query<{
          status: string;
          next_attempt_at: string;
          last_error: string;
        }>(
          "SELECT status, next_attempt_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobAfterFail1.rows[0].status, "pending");
        assert.equal(
          new Date(jobAfterFail1.rows[0].next_attempt_at).getTime(),
          t0.getTime() + 2000
        );
        assert.equal(jobAfterFail1.rows[0].last_error, "Transient connection error");

        // At t0 + 1000ms: job is NOT eligible yet
        const claimTooEarly = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: new Date(t0.getTime() + 1000),
        });
        assert.equal(claimTooEarly, null, "Job must not be eligible before next_attempt_at");

        // At t0 + 2000ms: job is eligible -> Claim Attempt 2
        const t1 = new Date(t0.getTime() + 2000);
        const claim2 = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: t1,
        });
        assert.ok(claim2 != null);
        assert.equal(claim2.attemptNumber, 2);

        // Attempt 2 fails
        const fail2 = await recordJobFailure(
          pool,
          ingress.ingressId,
          claim2.leaseToken,
          new Error("Second transient error"),
          { now: t1, validationNow: t1, baseBackoffMs }
        );
        assert.equal(fail2, "retrying");

        // Next attempt backoff: 2000 * 2^1 = 4000ms -> t1 + 4000ms
        const jobAfterFail2 = await pool.query<{ next_attempt_at: string }>(
          "SELECT next_attempt_at FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(
          new Date(jobAfterFail2.rows[0].next_attempt_at).getTime(),
          t1.getTime() + 4000
        );

        // At t1 + 4000ms: Claim Attempt 3 (final allowed attempt, max_attempts = 3)
        const t2 = new Date(t1.getTime() + 4000);
        const claim3 = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: t2,
        });
        assert.ok(claim3 != null);
        assert.equal(claim3.attemptNumber, 3);

        // Attempt 3 fails -> terminal failure
        const fail3 = await recordJobFailure(
          pool,
          ingress.ingressId,
          claim3.leaseToken,
          new Error("Third failure - max attempts reached"),
          { now: t2, validationNow: t2, baseBackoffMs }
        );
        assert.equal(fail3, "terminal", "Third failure must trigger terminal outcome");

        // Verify job is now failed and completed
        const jobFinal = await pool.query<{
          status: string;
          completed_at: string | null;
          last_error: string;
        }>(
          "SELECT status, completed_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobFinal.rows[0].status, "failed");
        assert.ok(jobFinal.rows[0].completed_at != null);

        // Attempt 3 outcome in attempts table is terminal_failure
        const attempt3 = await pool.query<{ outcome: string }>(
          "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 3",
          [ingress.ingressId]
        );
        assert.equal(attempt3.rows[0].outcome, "terminal_failure");

        // Subsequent claim returns null
        const claimAfterTerminal = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: new Date(t2.getTime() + 10000),
        });
        assert.equal(claimAfterTerminal, null, "Failed terminal job cannot be claimed");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 5b: Deterministic Failure-Time Backoff Calculation
    // -------------------------------------------------------------------------
    await t.test("Deterministic failure-time backoff: claim at t0, fail at t0+5s, next_attempt_at is t0+7s and gating before t0+7s", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p3det_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Internet mati lampu merah",
        });
        tracker.recordIngress(ingress.ingressId);

        const t0 = new Date("2026-10-02T10:00:00.000Z");
        const baseBackoffMs = 2000;
        await pool.query(
          "UPDATE public.processing_jobs SET next_attempt_at = $1 WHERE ingress_id = $2",
          [t0.toISOString(), ingress.ingressId]
        );

        // 1. Claim at t0 with 30s lease
        const claimed = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: t0,
          leaseDurationMs: 30_000,
        });
        assert.ok(claimed != null);
        assert.equal(claimed.attemptNumber, 1);

        // 2. Failure occurs at t0 + 5 seconds
        const tFailure = new Date(t0.getTime() + 5000);
        const failOutcome = await recordJobFailure(
          pool,
          ingress.ingressId,
          claimed.leaseToken,
          new Error("Simulated failure at t0+5s"),
          { now: tFailure, validationNow: tFailure, baseBackoffMs }
        );
        assert.equal(failOutcome, "retrying");

        // 3. Verify next_attempt_at is calculated from failure time: t0 + 5s + 2s = t0 + 7s
        const expectedNextAttempt = new Date(t0.getTime() + 7000).toISOString();
        const jobRow = await pool.query<{
          status: string;
          next_attempt_at: string;
          lease_token: string | null;
        }>(
          "SELECT status, next_attempt_at, lease_token FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobRow.rows[0].status, "pending");
        assert.equal(jobRow.rows[0].lease_token, null);
        assert.equal(
          new Date(jobRow.rows[0].next_attempt_at).toISOString(),
          expectedNextAttempt,
          "next_attempt_at must be exactly failure time + base backoff (t0 + 7s)"
        );

        // Attempt completed_at must be failure time (t0 + 5s)
        const attempt1 = await pool.query<{ outcome: string; completed_at: string }>(
          "SELECT outcome, completed_at FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
          [ingress.ingressId]
        );
        assert.equal(attempt1.rows[0].outcome, "retryable_failure");
        assert.equal(
          new Date(attempt1.rows[0].completed_at).toISOString(),
          tFailure.toISOString(),
          "Attempt completed_at must match failure time (t0 + 5s)"
        );

        // 4. Job is NOT eligible before t0 + 7s: claim at t0 + 6s returns null
        const tEarly = new Date(t0.getTime() + 6000);
        const claimEarly = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: tEarly,
        });
        assert.equal(claimEarly, null, "Job must NOT be eligible before next_attempt_at");

        // 5. Job BECOMES eligible at t0 + 7s: claim at t0 + 7s succeeds
        const tEligible = new Date(t0.getTime() + 7000);
        const claimEligible = await claimJob(pool, {
          ingressId: ingress.ingressId,
          now: tEligible,
        });
        assert.ok(claimEligible != null, "Job must be eligible at next_attempt_at");
        assert.equal(claimEligible.attemptNumber, 2);
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 6: Mid-Transaction Rollback leaves no partial mutations
    // -------------------------------------------------------------------------
    await t.test("Mid-Transaction Rollback: fault injection rolls back cleanly", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const ident = await createTestIdentity(tracker, `p6_${runId}`);
        const ingress = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: ident.accountId,
            senderExternalId: ident.senderId,
          },
          chatId: `chat_${runId}`,
          providerMessageId: `msg_${runId}`,
          text: "Internet saya mati total",
        });
        tracker.recordIngress(ingress.ingressId);

        const claimed = await claimJob(pool, { ingressId: ingress.ingressId });
        assert.ok(claimed != null);

        // Proxy pool with fault injection on triage_assessments INSERT
        let faultInjected = true;
        const faultPool = {
          async connect() {
            const client = await pool.connect();
            const realQuery = client.query;
            const clientProxy = Object.create(client) as typeof client;
            // @ts-expect-error proxying for targeted fault injection
            clientProxy.query = function (
              queryTextOrConfig: unknown,
              values?: unknown,
              callback?: unknown,
            ) {
              const q = typeof queryTextOrConfig === "string"
                ? queryTextOrConfig
                : (queryTextOrConfig as { text?: string })?.text ?? "";
              if (faultInjected && q.toLowerCase().includes("insert into public.triage_assessments")) {
                throw new Error("Simulated mid-transaction database crash on assessment insert");
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

        // Run processJobWithWorker with fault injection
        const resultWithFault = await processJobWithWorker(faultPool, supabase, claimed);
        assert.equal(resultWithFault.outcome, "retryable_failure");

        // Verify 0 partial records committed
        const messagesCount = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(messagesCount.rows[0].count), 0, "No messages committed");

        const assessmentsCount = await pool.query(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(assessmentsCount.rows[0].count), 0, "No assessments committed");

        // Disable fault injection and re-claim & retry
        faultInjected = false;
        // Make job immediately eligible for retry
        await pool.query(
          "UPDATE public.processing_jobs SET next_attempt_at = now() WHERE ingress_id = $1",
          [ingress.ingressId]
        );

        const retryClaim = await claimJob(pool, { ingressId: ingress.ingressId });
        assert.ok(retryClaim != null);
        assert.equal(retryClaim.attemptNumber, 2);

        const retryResult = await processJobWithWorker(pool, supabase, retryClaim);
        assert.equal(retryResult.outcome, "success");

        // Now mutations are cleanly committed
        const messagesAfter = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [ingress.ingressId]
        );
        assert.equal(Number(messagesAfter.rows[0].count), 1);

        const jobAfter = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [ingress.ingressId]
        );
        assert.equal(jobAfter.rows[0].status, "done");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 7: Webhook Post-ACK Scheduling and Drain
    // -------------------------------------------------------------------------
    await t.test("Webhook Post-ACK Scheduling: commits before ACK and drains to completion", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const numericSender = `123${Math.floor(100000 + Math.random() * 900000)}`;
        const ident = await createTestIdentity(tracker, `p7_${runId}`, true, seedCustomerId, numericSender);

        const secret = "test_webhook_secret_p7";
        const updateId = Math.floor(100000 + Math.random() * 900000);
        const providerMsgId = Math.floor(1000 + Math.random() * 9000);

        const payload = JSON.stringify({
          update_id: updateId,
          message: {
            message_id: providerMsgId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(numericSender), type: "private" },
            from: { id: Number(numericSender), is_bot: false, first_name: "Tester" },
            text: "Internet saya gangguan lambat sekali",
          },
        });

        let onAcceptedCalled = false;
        let acceptedIngressId = "";

        const req = new Request("http://localhost/api/webhooks/telegram", {
          method: "POST",
          headers: {
            "x-telegram-bot-api-secret-token": secret,
            "content-type": "application/json",
          },
          body: payload,
        });

        const res = await handleTelegramWebhook(req, () => persistence, {
          webhookSecret: secret,
          botAccountId: ident.accountId,
          testerAllowlist: [numericSender],
          onAccepted: (info) => {
            onAcceptedCalled = true;
            acceptedIngressId = info.ingressId;
          },
        });

        // 1. HTTP 200 returned immediately with status accepted
        assert.equal(res.status, 200);
        const resBody = await res.json();
        assert.equal(resBody.data.status, "accepted");
        assert.equal(onAcceptedCalled, true);
        assert.equal(resBody.data.ingressId, acceptedIngressId);
        tracker.recordIngress(acceptedIngressId);

        // 2. Before drain: ingress_events and processing_jobs exist; messages and assessments do NOT exist
        const jobBefore = await pool.query<{ status: string }>(
          "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
          [acceptedIngressId]
        );
        assert.equal(jobBefore.rowCount, 1);
        assert.equal(jobBefore.rows[0].status, "pending");

        const msgBefore = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [acceptedIngressId]
        );
        assert.equal(Number(msgBefore.rows[0].count), 0, "No messages before worker drain");

        // 3. Post-ACK drain execution
        const drainResult = await drainProcessingJobs(pool, supabase, {
          config: { maxJobsPerDrain: 1 },
          orchestrationOptions: { scenarioId: "normal" },
        });

        assert.equal(drainResult.processedCount, 1);
        assert.equal(drainResult.successCount, 1);

        // 4. After drain: processing_job is done, message and assessment exist
        const jobAfter = await pool.query<{ status: string; completed_at: string | null }>(
          "SELECT status, completed_at FROM public.processing_jobs WHERE ingress_id = $1",
          [acceptedIngressId]
        );
        assert.equal(jobAfter.rows[0].status, "done");
        assert.ok(jobAfter.rows[0].completed_at != null);

        const msgAfter = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [acceptedIngressId]
        );
        assert.equal(Number(msgAfter.rows[0].count), 1);

        // In SHADOW mode, verify 0 reply claims and 0 outbound intents
        const assessmentAfter = await pool.query<{
          decision: Record<string, unknown>;
          processing_result: Record<string, unknown>;
        }>(
          "SELECT decision, processing_result FROM public.triage_assessments WHERE message_id = $1",
          [acceptedIngressId]
        );
        assert.equal(assessmentAfter.rowCount, 1);
        assert.equal(assessmentAfter.rows[0].processing_result.dispatchAuthorized, false);

        const autoIntents = await pool.query(
          "SELECT count(*) FROM public.outbound_intents WHERE message_id = $1",
          [acceptedIngressId]
        );
        assert.equal(Number(autoIntents.rows[0].count), 0, "SHADOW mode must produce 0 auto intents");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 7b: Drain resilience across exhausted and eligible jobs
    // -------------------------------------------------------------------------
    await t.test("Drain resilience: exhausted job A transitions to failed and drain continues to eligible job B in same drain", async () => {
      const tracker = new TestResourceTracker();
      const runId = randomUUID().slice(0, 8);
      try {
        const identA = await createTestIdentity(tracker, `p4a_${runId}`);
        const ingressA = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: identA.accountId,
            senderExternalId: identA.senderId,
          },
          chatId: `chat_a_${runId}`,
          providerMessageId: `msg_a_${runId}`,
          text: "Gangguan total Job A",
        });
        tracker.recordIngress(ingressA.ingressId);

        const identB = await createTestIdentity(tracker, `p4b_${runId}`);
        const ingressB = await persistence.receive({
          sender: {
            channel: "telegram",
            channelAccountId: identB.accountId,
            senderExternalId: identB.senderId,
          },
          chatId: `chat_b_${runId}`,
          providerMessageId: `msg_b_${runId}`,
          text: "Gangguan total Job B",
        });
        tracker.recordIngress(ingressB.ingressId);

        // Set up Job A as having reached max_attempts (3 of 3) with an expired lease
        const leaseTokenA = randomUUID();
        const expiredTimeA = new Date(Date.now() - 10000).toISOString();
        await pool.query(
          `UPDATE public.processing_jobs
           SET status = 'in_progress',
               lease_token = $2,
               lease_expires_at = $3,
               attempt_count = 3,
               max_attempts = 3
           WHERE ingress_id = $1`,
          [ingressA.ingressId, leaseTokenA, expiredTimeA]
        );
        await pool.query(
          `INSERT INTO public.processing_job_attempts
           (ingress_id, attempt_number, lease_token, started_at, outcome)
           VALUES ($1, 3, $2, $3, 'in_progress')`,
          [ingressA.ingressId, leaseTokenA, new Date(Date.now() - 15000).toISOString()]
        );

        // Job B is fresh and pending (eligible immediately)
        await pool.query(
          `UPDATE public.processing_jobs
           SET status = 'pending',
               next_attempt_at = now() - interval '1 second'
           WHERE ingress_id = $1`,
          [ingressB.ingressId]
        );

        // Single drain call with bounded maxJobsPerDrain = 5
        const drainResult = await drainProcessingJobs(pool, supabase, {
          config: { maxJobsPerDrain: 5 },
          orchestrationOptions: { scenarioId: "normal" },
        });

        // Verify that drain did NOT abort on Job A:
        // Both Job A and Job B were handled in this single drain!
        assert.ok(drainResult.processedCount >= 2, `Expected at least 2 jobs processed, got ${drainResult.processedCount}`);
        assert.ok(drainResult.failureCount >= 1, `Expected at least 1 failure, got ${drainResult.failureCount}`);
        assert.ok(drainResult.successCount >= 1, `Expected at least 1 success, got ${drainResult.successCount}`);

        const resultA = drainResult.results.find((r) => r.ingressId === ingressA.ingressId);
        assert.ok(resultA != null, "Job A must be in drain results");
        assert.equal(resultA.outcome, "terminal_failure");
        assert.equal(resultA.error, "max_attempts_exhausted");

        const resultB = drainResult.results.find((r) => r.ingressId === ingressB.ingressId);
        assert.ok(resultB != null, "Job B must be in drain results");
        assert.equal(resultB.outcome, "success");

        // Verify database state for Job A
        const jobRowA = await pool.query<{
          status: string;
          completed_at: string | null;
          last_error: string;
        }>(
          "SELECT status, completed_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
          [ingressA.ingressId]
        );
        assert.equal(jobRowA.rows[0].status, "failed");
        assert.ok(jobRowA.rows[0].completed_at != null);
        assert.equal(jobRowA.rows[0].last_error, "max_attempts_exhausted");

        const attemptRowA = await pool.query<{ outcome: string; error_message: string }>(
          "SELECT outcome, error_message FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 3",
          [ingressA.ingressId]
        );
        assert.equal(attemptRowA.rows[0].outcome, "terminal_failure");
        assert.equal(attemptRowA.rows[0].error_message, "max_attempts_exhausted");

        // Verify database state for Job B
        const jobRowB = await pool.query<{
          status: string;
          completed_at: string | null;
        }>(
          "SELECT status, completed_at FROM public.processing_jobs WHERE ingress_id = $1",
          [ingressB.ingressId]
        );
        assert.equal(jobRowB.rows[0].status, "done");
        assert.ok(jobRowB.rows[0].completed_at != null);

        const msgB = await pool.query(
          "SELECT count(*) FROM public.messages WHERE id = $1",
          [ingressB.ingressId]
        );
        assert.equal(Number(msgB.rows[0].count), 1, "Job B must have message persisted");

        const assessmentB = await pool.query(
          "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
          [ingressB.ingressId]
        );
        assert.equal(Number(assessmentB.rows[0].count), 1, "Job B must have triage assessment persisted");
      } finally {
        await cleanupFixture(pool, tracker);
      }
    });

    // -------------------------------------------------------------------------
    // AC 12: Targeted Lease Validation Timing on Default Path (PostgreSQL clock_timestamp)
    // -------------------------------------------------------------------------
    await t.test(
      "Targeted Lease Validation Timing (Default Path): row lock delay causes lease expiration and returns lease_lost via PostgreSQL clock_timestamp() without validationNow override",
      async () => {
        const tracker = new TestResourceTracker();
        const runId = randomUUID().slice(0, 8);
        const holdingClient = await pool.connect();
        try {
          const ident = await createTestIdentity(tracker, `lock_${runId}`);
          const ingress = await persistence.receive({
            sender: {
              channel: "telegram",
              channelAccountId: ident.accountId,
              senderExternalId: ident.senderId,
            },
            chatId: `chat_${runId}`,
            providerMessageId: `msg_${runId}`,
            text: "Koneksi bermasalah",
          });
          tracker.recordIngress(ingress.ingressId);

          // Claim with short lease of 400ms
          const claim = await claimJob(pool, {
            ingressId: ingress.ingressId,
            leaseDurationMs: 400,
          });
          assert.ok(claim != null);

          // Snapshot job and attempt before locking
          const jobBefore = (
            await pool.query(
              "SELECT status, lease_token, lease_expires_at, attempt_count, max_attempts, next_attempt_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
              [ingress.ingressId]
            )
          ).rows[0];
          const attemptBefore = (
            await pool.query(
              "SELECT attempt_number, lease_token, started_at, completed_at, outcome, error_message FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
              [ingress.ingressId]
            )
          ).rows[0];

          // Dedicated holding client acquires row lock
          await holdingClient.query("BEGIN");
          await holdingClient.query(
            "SELECT ingress_id FROM public.processing_jobs WHERE ingress_id = $1 FOR UPDATE",
            [ingress.ingressId]
          );

          // Start recordJobFailure on DEFAULT path (NO validationNow override!)
          const failurePromise = recordJobFailure(
            pool,
            ingress.ingressId,
            claim.leaseToken,
            new Error("Transient connection error")
          );

          // Prove caller is actively waiting on the row lock in PostgreSQL
          let isWaiting = false;
          for (let i = 0; i < 40; i++) {
            const lockCheck = await pool.query<{ count: string }>(
              `SELECT count(*) FROM pg_locks l
               JOIN pg_stat_activity a ON l.pid = a.pid
               WHERE a.query LIKE '%public.processing_jobs%' AND NOT l.granted`
            );
            if (Number(lockCheck.rows[0].count) > 0) {
              isWaiting = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
          assert.ok(isWaiting, "recordJobFailure must be actively waiting on the row lock in PostgreSQL");

          // Poll PostgreSQL until PostgreSQL's wall clock confirms the lease has expired
          let isExpiredInPg = false;
          for (let i = 0; i < 40; i++) {
            const checkExp = await holdingClient.query<{ expired: boolean }>(
              `SELECT clock_timestamp() > $1::timestamptz AS expired`,
              [claim.leaseExpiresAt]
            );
            if (checkExp.rows[0]?.expired) {
              isExpiredInPg = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
          assert.ok(isExpiredInPg, "Lease must have expired according to PostgreSQL clock_timestamp()");

          // Release the lock
          await holdingClient.query("COMMIT");

          // Await recordJobFailure
          const outcome = await failurePromise;
          assert.equal(outcome, "lease_lost", "Must return lease_lost because lease expired while waiting for lock");

          // Verify snapshots of processing_jobs and processing_job_attempts are identical (zero mutation)
          const jobAfter = (
            await pool.query(
              "SELECT status, lease_token, lease_expires_at, attempt_count, max_attempts, next_attempt_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
              [ingress.ingressId]
            )
          ).rows[0];
          const attemptAfter = (
            await pool.query(
              "SELECT attempt_number, lease_token, started_at, completed_at, outcome, error_message FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
              [ingress.ingressId]
            )
          ).rows[0];

          assert.deepEqual(jobAfter, jobBefore, "processing_jobs row must remain strictly identical (zero mutations)");
          assert.deepEqual(attemptAfter, attemptBefore, "processing_job_attempts row must remain strictly identical (zero mutations)");

          // Verify recovery: subsequent claim after lease expiry succeeds as attempt 2
          const recoveryResult = await claimNextJob(pool);
          assert.equal(recoveryResult.kind, "claimed");
          if (recoveryResult.kind === "claimed") {
            assert.equal(recoveryResult.job.ingressId, ingress.ingressId);
            assert.equal(recoveryResult.job.attemptNumber, 2);
            assert.notEqual(recoveryResult.job.leaseToken, claim.leaseToken);

            const procRes = await processJobWithWorker(pool, supabase, recoveryResult.job);
            assert.equal(procRes.outcome, "success");
          }

          // Prior attempt was closed as lease_expired
          const oldAttempt = await pool.query<{ outcome: string }>(
            "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
            [ingress.ingressId]
          );
          assert.equal(oldAttempt.rows[0].outcome, "lease_expired");

          const jobDone = await pool.query<{ status: string }>(
            "SELECT status FROM public.processing_jobs WHERE ingress_id = $1",
            [ingress.ingressId]
          );
          assert.equal(jobDone.rows[0].status, "done");
        } finally {
          try {
            await holdingClient.query("ROLLBACK").catch(() => {});
          } finally {
            holdingClient.release();
          }
          await cleanupFixture(pool, tracker);
        }
      }
    );

    // -------------------------------------------------------------------------
    // AC 13: Telegram Route Controlled Integration (afterRunner harness)
    // -------------------------------------------------------------------------
    await t.test(
      "Telegram Route Controlled Integration (afterRunner harness): commit before ACK, after executes drain, negative branches and background failure",
      async () => {
        const tracker = new TestResourceTracker();
        const envRestorer = new EnvRestorer();
        const runId = randomUUID().slice(0, 8);
        const webhookSecret = `sec_${runId}`;
        const botAccountId = `acc_rt_${runId}`;
        const numericSenderId = "88812345";
        let primaryError: Error | undefined;

        try {
          envRestorer.set("HELPDESK_DATABASE_URL", config.databaseUrl);
          envRestorer.set("SUPABASE_URL", config.apiUrl);
          envRestorer.set("HELPDESK_TEST_API_URL", config.apiUrl);
          envRestorer.set("NEXT_PUBLIC_SUPABASE_URL", config.apiUrl);
          envRestorer.set("SUPABASE_SERVICE_ROLE_KEY", config.serviceRoleKey);
          envRestorer.set("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
          envRestorer.set("TELEGRAM_BOT_ACCOUNT_ID", botAccountId);
          envRestorer.set("TELEGRAM_TESTER_ALLOWLIST", numericSenderId);
          await closeHelpdeskPool();

          const fixtureIdent = await createTestIdentity(
            tracker,
            `rt_${runId}`,
            true,
            seedCustomerId,
            numericSenderId,
            botAccountId
          );

          // Subtest A: Happy Path Route POST + Next.js after() execution
          const afterRunner = new AfterRunner();
          const afterContext = new AfterContext(afterRunner.context);
          const workStore = { afterContext };
          const workUnitStore = { phase: "action" };

          const messageId = 77001;
          const payload = {
            update_id: 600001,
            message: {
              message_id: messageId,
              from: { id: Number(numericSenderId), is_bot: false, first_name: "RouteTester" },
              chat: { id: Number(numericSenderId), type: "private" },
              date: Math.floor(Date.now() / 1000),
              text: "Internet saya mati total",
            },
          };

          const request = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: JSON.stringify(payload),
          });

          let response!: Response;
          await workAsyncStorage.run(workStore, () =>
            workUnitAsyncStorage.run(workUnitStore, async () => {
              response = await POST(request);
            })
          );

          assert.equal(response.status, 200, "Webhook route must return 200");
          const bodyJson = await response.json();
          assert.equal(bodyJson.success, true);
          assert.equal(bodyJson.data.status, "accepted", "Envelope data must match status: accepted");
          assert.equal(bodyJson.error, null);

          // PROOF: Ingress and job are COMMITTED before executeAfter() runs!
          const ingressId = bodyJson.data.ingressId as string;
          assert.ok(ingressId, "Route response must return ingressId in data envelope");
          tracker.recordIngress(ingressId);

          const ingressRes = await pool.query<{ id: string; identity_id: string }>(
            "SELECT id, identity_id FROM public.ingress_events WHERE id = $1",
            [ingressId]
          );
          assert.equal(ingressRes.rowCount, 1, "Ingress event must be committed before HTTP response finishes");
          assert.equal(ingressRes.rows[0].identity_id, fixtureIdent.id, "Ingress must use the exact fixture identity created for this test run");

          const jobPre = await pool.query<{ status: string; attempt_count: number }>(
            "SELECT status, attempt_count FROM public.processing_jobs WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(jobPre.rowCount, 1);
          assert.equal(jobPre.rows[0].status, "pending", "Job must be pending prior to after() execution");
          assert.equal(jobPre.rows[0].attempt_count, 0, "No attempts yet prior to after() execution");

          const attemptsPre = await pool.query(
            "SELECT count(*) FROM public.processing_job_attempts WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(Number(attemptsPre.rows[0].count), 0, "Response returned without waiting for worker attempt");

          const assessmentsPre = await pool.query(
            "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
            [ingressId]
          );
          assert.equal(Number(assessmentsPre.rows[0].count), 0, "Response returned without waiting for domain processing");

          // Execute Next.js after() callbacks and await drain promise
          await workAsyncStorage.run(workStore, () => afterRunner.executeAfter());

          // PROOF: Callback after completed drain to 'done', success attempt, and triage assessment
          const jobPost = await pool.query<{ status: string; completed_at: string | null; attempt_count: number }>(
            "SELECT status, completed_at, attempt_count FROM public.processing_jobs WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(jobPost.rows[0].status, "done", "Job must be done after after() execution");
          assert.ok(jobPost.rows[0].completed_at != null);
          assert.equal(jobPost.rows[0].attempt_count, 1);

          const attemptsPost = await pool.query<{ outcome: string }>(
            "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(attemptsPost.rowCount, 1);
          assert.equal(attemptsPost.rows[0].outcome, "success");

          const assessmentPost = await pool.query(
            "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
            [ingressId]
          );
          assert.equal(Number(assessmentPost.rows[0].count), 1, "Triage assessment must be persisted");

          // Subtest B: Duplicate accepted does NOT create new job
          const dupRequest = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: JSON.stringify(payload),
          });

          const dupRunner = new AfterRunner();
          const dupContext = new AfterContext(dupRunner.context);
          const dupWorkStore = { afterContext: dupContext };
          let dupResponse!: Response;
          await workAsyncStorage.run(dupWorkStore, () =>
            workUnitAsyncStorage.run({ phase: "action" }, async () => {
              dupResponse = await POST(dupRequest);
            })
          );

          assert.equal(dupResponse.status, 200);
          const dupJson = await dupResponse.json();
          assert.equal(dupJson.success, true);
          assert.equal(dupJson.data.status, "accepted");
          assert.equal(dupJson.data.duplicate, true);

          const jobCount = await pool.query(
            "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(Number(jobCount.rows[0].count), 1, "Duplicate accepted must not create a duplicate job");

          // Subtest C: Negative branches do NOT schedule worker
          // C1: Unauthorized (wrong secret)
          const unauthReq = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": "invalid_secret",
            },
            body: JSON.stringify(payload),
          });
          const unauthRes = await POST(unauthReq);
          assert.equal(unauthRes.status, 401, "Wrong secret must return 401");

          // C2: Malformed JSON body
          const malformedReq = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: "invalid{json",
          });
          const malformedRes = await POST(malformedReq);
          assert.equal(malformedRes.status, 400, "Malformed JSON must return 400");

          // C3: Unsupported update type (no message)
          const unsupportedReq = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: JSON.stringify({ update_id: 999999, edited_channel_post: { id: 1 } }),
          });
          const unsupportedRes = await POST(unsupportedReq);
          assert.equal(unsupportedRes.status, 200, "Unsupported update type returns 200 ignored");
          const unsupportedJson = await unsupportedRes.json();
          assert.equal(unsupportedJson.success, true);
          assert.equal(unsupportedJson.data.status, "ignored", "Must return status: ignored");

          // Subtest D: Controlled background failure executed in after() callback
          const bgFailMsgId = 77002;
          const bgFailPayload = {
            update_id: 600002,
            message: {
              message_id: bgFailMsgId,
              from: { id: Number(numericSenderId), is_bot: false, first_name: "BGFailTester" },
              chat: { id: Number(numericSenderId), type: "private" },
              date: Math.floor(Date.now() / 1000),
              text: "Lampu LOS merah",
            },
          };

          const bgFailReq = new Request("http://localhost:3000/api/webhooks/telegram", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: JSON.stringify(bgFailPayload),
          });

          const bgAfterRunner = new AfterRunner();
          const bgAfterContext = new AfterContext(bgAfterRunner.context);
          const bgWorkStore = { afterContext: bgAfterContext };

          let bgResponse!: Response;
          await workAsyncStorage.run(bgWorkStore, () =>
            workUnitAsyncStorage.run({ phase: "action" }, async () => {
              bgResponse = await POST(bgFailReq);
            })
          );
          assert.equal(bgResponse.status, 200);
          const bgJson = await bgResponse.json();
          assert.equal(bgJson.success, true);
          assert.equal(bgJson.data.status, "accepted");
          const bgIngressId = bgJson.data.ingressId as string;
          tracker.recordIngress(bgIngressId);

          // 1. PROOF: Ingress event is committed before background failure occurs
          const bgIngressRes = await pool.query<{ id: string; identity_id: string }>(
            "SELECT id, identity_id FROM public.ingress_events WHERE id = $1",
            [bgIngressId]
          );
          assert.equal(bgIngressRes.rowCount, 1, "Ingress event must remain committed before background callback");
          assert.equal(bgIngressRes.rows[0].identity_id, fixtureIdent.id, "Background ingress must resolve to expected fixture identity UUID");


          // 2. Controlled Fault Injection Harness: intercept queries on getHelpdeskPool()
          // 2. Controlled Fault Injection: Hook into Helpdesk Pool during background after() execution
          // to trigger a database fault on triage insert
          const sharedPool = getHelpdeskPool();
          const origConnect = sharedPool.connect.bind(sharedPool);
          let injectFault = true;
          (sharedPool as unknown as { connect: (...args: unknown[]) => unknown }).connect = function (...args: unknown[]) {
            if (typeof args[0] === "function") {
              const cb = args[0] as (err: unknown, client: unknown, release: unknown) => void;
              return (origConnect as (callback: (err: unknown, client: unknown, release: unknown) => void) => void)((err: unknown, client: unknown, release: unknown) => {
                if (err || !client) return cb(err, client, release);
                const rawClient = client as { query: (q: unknown, ...qArgs: unknown[]) => unknown };
                const origQuery = rawClient.query.bind(rawClient);
                rawClient.query = function (q: unknown, ...qArgs: unknown[]) {
                  const sql = typeof q === "string" ? q : (q as { text?: string })?.text ?? "";
                  if (injectFault && sql.toLowerCase().includes("insert into public.triage_assessments")) {
                    if (typeof qArgs[qArgs.length - 1] === "function") {
                      const queryCb = qArgs[qArgs.length - 1] as (err: Error) => void;
                      return queryCb(new Error("Controlled background fault injection on assessment insert"));
                    }
                    return Promise.reject(new Error("Controlled background fault injection on assessment insert"));
                  }
                  return origQuery(q, ...qArgs);
                };
                return cb(err, client, release);
              });
            }

            return (origConnect as () => Promise<{ query: (q: unknown, ...qArgs: unknown[]) => unknown }>)(
            ).then((client) => {
              if (!client) return client;
              const origQuery = client.query.bind(client);
              client.query = function (q: unknown, ...qArgs: unknown[]) {
                const sql = typeof q === "string" ? q : (q as { text?: string })?.text ?? "";
                if (injectFault && sql.toLowerCase().includes("insert into public.triage_assessments")) {
                  if (typeof qArgs[qArgs.length - 1] === "function") {
                    const queryCb = qArgs[qArgs.length - 1] as (err: Error) => void;
                    return queryCb(new Error("Controlled background fault injection on assessment insert"));
                  }
                  return Promise.reject(new Error("Controlled background fault injection on assessment insert"));
                }
                return origQuery(q, ...qArgs);
              };
              return client;
            });
          };

          try {
            // Execute background callback with fault injected
            await workAsyncStorage.run(bgWorkStore, () => bgAfterRunner.executeAfter());
          } finally {
            // Restore pool connect immediately
            sharedPool.connect = origConnect;
            injectFault = false;
          }

          // 3. PROOF: Background failure was caught and recorded deterministically
          const ingressCheck = await pool.query(
            "SELECT id FROM public.ingress_events WHERE id = $1",
            [bgIngressId]
          );
          assert.equal(ingressCheck.rowCount, 1, "Committed ingress must NOT be rolled back by background failure");

          const bgJobCheck = await pool.query<{
            status: string;
            attempt_count: number;
            next_attempt_at: string;
            last_error: string;
          }>(
            "SELECT status, attempt_count, next_attempt_at, last_error FROM public.processing_jobs WHERE ingress_id = $1",
            [bgIngressId]
          );
          assert.equal(bgJobCheck.rows[0].status, "pending");
          assert.equal(bgJobCheck.rows[0].attempt_count, 1);
          assert.ok(new Date(bgJobCheck.rows[0].next_attempt_at).getTime() > Date.now());
          assert.ok(
            bgJobCheck.rows[0].last_error.includes("Controlled background fault injection"),
            "last_error must record sanitized fault message"
          );

          const bgAttemptCheck = await pool.query<{ outcome: string; error_message: string }>(
            "SELECT outcome, error_message FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 1",
            [bgIngressId]
          );
          assert.equal(bgAttemptCheck.rows[0].outcome, "retryable_failure");
          assert.ok(bgAttemptCheck.rows[0].error_message.includes("Controlled background fault injection"));

          // 4. PROOF: Recovery succeeds on subsequent retry when fault is cleared
          await pool.query(
            "UPDATE public.processing_jobs SET next_attempt_at = now() WHERE ingress_id = $1",
            [bgIngressId]
          );
          const recoveryClaim = await claimJob(pool, { ingressId: bgIngressId });
          assert.ok(recoveryClaim != null);
          const retryRes = await processJobWithWorker(pool, supabase, recoveryClaim);
          assert.equal(retryRes.outcome, "success");

          const jobDoneCheck = await pool.query<{ status: string; attempt_count: number }>(
            "SELECT status, attempt_count FROM public.processing_jobs WHERE ingress_id = $1",
            [bgIngressId]
          );
          assert.equal(jobDoneCheck.rows[0].status, "done");
          assert.equal(jobDoneCheck.rows[0].attempt_count, 2);

          const attempt2Check = await pool.query<{ outcome: string }>(
            "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1 AND attempt_number = 2",
            [bgIngressId]
          );
          assert.equal(attempt2Check.rows[0].outcome, "success");
        } catch (err) {
          primaryError = err as Error;
          throw err;
        } finally {
          const teardownErrors: Error[] = [];
          try {
            envRestorer.restore();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await closeHelpdeskPool();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await cleanupFixture(pool, tracker);
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          const finalError = combineErrors(primaryError, teardownErrors);
          if (finalError && finalError !== primaryError) {
            throw finalError;
          }
        }
      }
    );

    // -------------------------------------------------------------------------
    // AC 14: Telegram Route Real Next.js Server & after() Lifecycle
    // -------------------------------------------------------------------------
    await t.test(
      "Telegram Route Real Next.js Server & after() Lifecycle: real HTTP POST on dedicated port, automated after() execution without manual runner, barrier verification, negative branches and duplicate idempotency",
      async () => {
        const tracker = new TestResourceTracker();
        const envRestorer = new EnvRestorer();
        const runId = randomUUID().slice(0, 8);
        const serverPort = 3188;
        const serverSecret = `srv_sec_${runId}`;
        const botAccountId = `acc_srv_${runId}`;
        const numericSenderId = "77766655";
        let nextApp: ReturnType<typeof next> | null = null;
        let httpServer: ReturnType<typeof createServer> | null = null;
        let barrierClient: pg.PoolClient | null = null;
        let primaryError: Error | undefined;

        try {
          envRestorer.set("HELPDESK_DATABASE_URL", config.databaseUrl);
          envRestorer.set("SUPABASE_URL", config.apiUrl);
          envRestorer.set("HELPDESK_TEST_API_URL", config.apiUrl);
          envRestorer.set("NEXT_PUBLIC_SUPABASE_URL", config.apiUrl);
          envRestorer.set("SUPABASE_SERVICE_ROLE_KEY", config.serviceRoleKey);
          envRestorer.set("TELEGRAM_WEBHOOK_SECRET", serverSecret);
          envRestorer.set("TELEGRAM_BOT_ACCOUNT_ID", botAccountId);
          envRestorer.set("TELEGRAM_TESTER_ALLOWLIST", numericSenderId);
          envRestorer.set("APP_MODE", "SHADOW");
          envRestorer.set("NETWORK_PROVIDER", "mock");
          envRestorer.set("NETWORK_SCENARIO_ID", "normal");
          envRestorer.set("HELPDESK_TEST_ENV_MARKER", config.expectedMarker);

          const fixtureIdent = await createTestIdentity(
            tracker,
            `srv_${runId}`,
            true,
            seedCustomerId,
            numericSenderId,
            botAccountId
          );

          // Start Next.js programmatic server
          nextApp = next({ dev: false, dir: process.cwd(), hostname: "127.0.0.1", port: serverPort });
          await nextApp.prepare();

          // Enforce test configuration AFTER Next.js prepare() has finished its .env loading
          process.env.HELPDESK_DATABASE_URL = config.databaseUrl;
          process.env.SUPABASE_URL = config.apiUrl;
          process.env.HELPDESK_TEST_API_URL = config.apiUrl;
          process.env.NEXT_PUBLIC_SUPABASE_URL = config.apiUrl;
          process.env.SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;
          process.env.TELEGRAM_WEBHOOK_SECRET = serverSecret;
          process.env.TELEGRAM_BOT_ACCOUNT_ID = botAccountId;
          process.env.TELEGRAM_TESTER_ALLOWLIST = numericSenderId;
          process.env.APP_MODE = "SHADOW";
          process.env.NETWORK_PROVIDER = "mock";
          process.env.NETWORK_SCENARIO_ID = "normal";
          process.env.HELPDESK_TEST_ENV_MARKER = config.expectedMarker;
          await closeHelpdeskPool();

          const requestHandler = nextApp.getRequestHandler();
          const createdServer = createServer((req, res) => requestHandler(req, res));
          httpServer = createdServer;
          await new Promise<void>((resolve, reject) => {
            createdServer.listen(serverPort, "127.0.0.1", () => resolve());
            createdServer.on("error", reject);
          });

          // 1. Verification of Runtime Diagnostic Guard
          // Scenario A: Server diagnostics disabled by default (normal configuration).
          // Request with X-Test-Runtime-Check and valid secret MUST NOT return diagnostic metadata.
          // It must follow the normal webhook pipeline (which rejects empty body {} as 400 structural error).
          delete process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS;
          const normalConfigRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(normalConfigRes.status, 400, "In normal config, test header must not trigger diagnostics; empty body follows normal webhook validation (400)");
          const normalConfigJson = (await normalConfigRes.json()) as {
            success: boolean;
            data: unknown;
            error: { code: string; message: string } | null;
          };
          assert.equal(normalConfigJson.success, false);
          assert.equal(normalConfigJson.data, null);
          assert.ok(normalConfigJson.error && typeof normalConfigJson.error.code === "string");
          assert.equal(
            "apiEndpoint" in ((normalConfigJson.data as unknown as Record<string, unknown>) ?? {}),
            false,
            "Normal configuration must never leak runtime endpoint or test metadata"
          );

          // Scenario B: Diagnostics enabled on server, but request sends invalid secret.
          // Must reject 401 with standard envelope error before querying DB or API.
          process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS = "true";
          const wrongSecretRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": "wrong_secret_token",
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(wrongSecretRes.status, 401, "Diagnostics must require valid secret token");
          const wrongSecretJson = (await wrongSecretRes.json()) as {
            success: boolean;
            data: unknown;
            error: { code: string; message: string };
          };
          assert.equal(wrongSecretJson.success, false);
          assert.equal(wrongSecretJson.data, null);
          assert.equal(wrongSecretJson.error.code, "UNAUTHORIZED");

          // Scenario C: Diagnostics enabled, valid secret, but test environment configuration is incomplete.
          // Must fail-closed (403) with standard envelope error without providing fallback markers.
          delete process.env.HELPDESK_TEST_ENV_MARKER;
          const missingMarkerRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(missingMarkerRes.status, 403, "Diagnostics must fail-closed if test configuration is incomplete");
          const missingMarkerJson = (await missingMarkerRes.json()) as {
            success: boolean;
            data: unknown;
            error: { code: string; message: string };
          };
          assert.equal(missingMarkerJson.success, false);
          assert.equal(missingMarkerJson.data, null);
          assert.equal(missingMarkerJson.error.code, "TEST_CONFIG_INCOMPLETE");
          process.env.HELPDESK_TEST_ENV_MARKER = config.expectedMarker;

          // Scenario C.1: Diagnostics enabled, valid secret, but expected test DB target mismatch (port 54339 instead of 54332).
          // Must fail-closed (403 TEST_TARGET_MISMATCH) before running queries.
          const originalTestDbUrl = process.env.HELPDESK_TEST_DATABASE_URL;
          process.env.HELPDESK_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54339/postgres";
          const mismatchDbRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(mismatchDbRes.status, 403, "Target DB mismatch must reject 403 before running queries");
          const mismatchDbJson = (await mismatchDbRes.json()) as {
            success: boolean;
            data: unknown;
            error: { code: string; message: string };
          };
          assert.equal(mismatchDbJson.success, false);
          assert.equal(mismatchDbJson.data, null);
          assert.equal(mismatchDbJson.error.code, "TEST_TARGET_MISMATCH");
          process.env.HELPDESK_TEST_DATABASE_URL = originalTestDbUrl;

          // Scenario C.2: Diagnostics enabled, valid secret, but expected test API target mismatch (port 54339 instead of 54331).
          // Must fail-closed (403 TEST_TARGET_MISMATCH) before running queries.
          const originalTestApiUrl = process.env.HELPDESK_TEST_API_URL;
          process.env.HELPDESK_TEST_API_URL = "http://127.0.0.1:54339";
          const mismatchApiRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(mismatchApiRes.status, 403, "Target API mismatch must reject 403 before running queries");
          const mismatchApiJson = (await mismatchApiRes.json()) as {
            success: boolean;
            data: unknown;
            error: { code: string; message: string };
          };
          assert.equal(mismatchApiJson.success, false);
          assert.equal(mismatchApiJson.data, null);
          assert.equal(mismatchApiJson.error.code, "TEST_TARGET_MISMATCH");
          process.env.HELPDESK_TEST_API_URL = originalTestApiUrl;

          // Scenario D: Diagnostics enabled, valid secret, complete test configuration targeting isolated test env.
          // Both PostgreSQL pool and Supabase admin client in route bundle read identical marker.
          const checkRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
              "X-Test-Runtime-Check": "true",
            },
            body: JSON.stringify({}),
          });
          assert.equal(checkRes.status, 200, "Runtime environment check must succeed on verified test environment");
          const checkJson = (await checkRes.json()) as {
            success: boolean;
            data: { verified: boolean; apiEndpoint: string; dbMarker: string; apiMarker: string };
          };
          assert.equal(checkJson.success, true);
          assert.equal(checkJson.data.verified, true, "Both PostgreSQL and Supabase API in server route bundle must read identical marker tokens");
          assert.equal(checkJson.data.apiEndpoint, config.apiUrl, "Server route API client must target test Supabase port, not primary port");
          assert.equal(checkJson.data.dbMarker, checkJson.data.apiMarker, "Marker from DB and Supabase API must be identical");

          // Reset diagnostic flag back to disabled for normal webhook lifecycle execution
          delete process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS;

          barrierClient = await pool.connect();

          // 1. Barrier Setup: active incident locked FOR UPDATE by barrierClient
          // Blocks HelpdeskPersistence.process() (which executes SELECT ... FOR SHARE on active incidents)
          // while leaving HelpdeskPersistence.receive() unblocked.
          const barrierIncId = randomUUID();
          tracker.recordIncident(barrierIncId);
          await pool.query(
            "INSERT INTO public.incidents (id, type, status, version) VALUES ($1, 'GENERAL', 'ACTIVE', 1)",
            [barrierIncId]
          );

          await barrierClient.query("BEGIN");
          await barrierClient.query(
            "SELECT id FROM public.incidents WHERE id = $1 FOR UPDATE",
            [barrierIncId]
          );

          // 2. Real HTTP POST from client
          const payload = {
            update_id: 700001,
            message: {
              message_id: 88001,
              from: { id: Number(numericSenderId), is_bot: false, first_name: "RealSrvTester" },
              chat: { id: Number(numericSenderId), type: "private" },
              date: Math.floor(Date.now() / 1000),
              text: "Internet saya mati total lampu merah",
            },
          };

          const postRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
            },
            body: JSON.stringify(payload),
          });

          // 3. PROOF: HTTP 200 ACK received immediately
          assert.equal(postRes.status, 200);
          const postJson = (await postRes.json()) as { success: boolean; data: { status: string; ingressId: string; duplicate: boolean } };
          assert.equal(postJson.success, true);
          assert.equal(postJson.data.status, "accepted");
          const ingressId = postJson.data.ingressId;
          tracker.recordIngress(ingressId);

          // 4. PROOF: While barrier is held, ingress is committed but domain processing has NOT finished
          const ingressCheck = await pool.query<{ id: string; identity_id: string }>(
            "SELECT id, identity_id FROM public.ingress_events WHERE id = $1",
            [ingressId]
          );
          assert.equal(ingressCheck.rowCount, 1, "Ingress must be committed before ACK is returned");
          assert.equal(ingressCheck.rows[0].identity_id, fixtureIdent.id, "Ingress in real HTTP route must resolve to expected fixture identity UUID");

          const assessmentsPre = await pool.query(
            "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
            [ingressId]
          );
          assert.equal(
            Number(assessmentsPre.rows[0].count),
            0,
            "ACK must be returned before domain processing finishes (verified via active incident barrier)"
          );

          // 5. Release barrier: allow background after() worker to proceed
          await barrierClient.query("COMMIT");

          // 6. Automated after() execution: wait for worker to complete without manual drain call!
          let isJobDone = false;
          for (let i = 0; i < 100; i++) {
            const jobCheck = await pool.query<{ status: string; completed_at: string | null; attempt_count: number }>(
              "SELECT status, completed_at, attempt_count FROM public.processing_jobs WHERE ingress_id = $1",
              [ingressId]
            );
            if (jobCheck.rows[0]?.status === "done") {
              isJobDone = true;
              assert.ok(jobCheck.rows[0].completed_at != null);
              assert.equal(jobCheck.rows[0].attempt_count, 1);
              break;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
          assert.ok(isJobDone, "Next.js after() must automatically process job to 'done' without manual drain call");

          // 7. Verify attempt success, assessment persisted, 0 outbound intents
          const attemptCheck = await pool.query<{ outcome: string }>(
            "SELECT outcome FROM public.processing_job_attempts WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(attemptCheck.rowCount, 1);
          assert.equal(attemptCheck.rows[0].outcome, "success");

          const assessmentPost = await pool.query(
            "SELECT count(*) FROM public.triage_assessments WHERE message_id = $1",
            [ingressId]
          );
          assert.equal(Number(assessmentPost.rows[0].count), 1, "Triage assessment must be persisted automatically");

          const outboundIntents = await pool.query(
            "SELECT count(*) FROM public.outbound_intents WHERE message_id = $1",
            [ingressId]
          );
          assert.equal(Number(outboundIntents.rows[0].count), 0, "SHADOW mode must produce 0 outbound intents");

          // 8. Negative branches & duplicate idempotency over real HTTP
          // A: Duplicate accepted
          const dupRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
            },
            body: JSON.stringify(payload),
          });
          assert.equal(dupRes.status, 200);
          const dupJson = (await dupRes.json()) as { success: boolean; data: { status: string; duplicate: boolean } };
          assert.equal(dupJson.data.status, "accepted");
          assert.equal(dupJson.data.duplicate, true);

          const jobCount = await pool.query(
            "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
            [ingressId]
          );
          assert.equal(Number(jobCount.rows[0].count), 1, "Duplicate accepted must not create extra job");

          // B: Unauthorized (wrong secret)
          const unauthRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": "invalid_secret_token",
            },
            body: JSON.stringify(payload),
          });
          assert.equal(unauthRes.status, 401);

          // C: Malformed JSON
          const malformedRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
            },
            body: "invalid{json[not_valid",
          });
          assert.equal(malformedRes.status, 400);

          // D: Unsupported update
          const unsupportedRes = await fetch(`http://127.0.0.1:${serverPort}/api/webhooks/telegram`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": serverSecret,
            },
            body: JSON.stringify({ update_id: 999901, channel_post: { id: 1 } }),
          });
          assert.equal(unsupportedRes.status, 200);
          const unsuppJson = (await unsupportedRes.json()) as { success: boolean; data: { status: string } };
          assert.equal(unsuppJson.data.status, "ignored");
        } catch (err) {
          primaryError = err as Error;
          throw err;
        } finally {
          const teardownErrors: Error[] = [];
          if (barrierClient) {
            try {
              await barrierClient.query("ROLLBACK").catch(() => {});
            } catch (e) {
              teardownErrors.push(e as Error);
            } finally {
              barrierClient.release();
            }
          }
          if (httpServer) {
            const serverToClose = httpServer;
            try {
              await new Promise<void>((resolve) => serverToClose.close(() => resolve()));
            } catch (e) {
              teardownErrors.push(e as Error);
            }
          }
          if (nextApp) {
            try {
              await nextApp.close();
            } catch (e) {
              teardownErrors.push(e as Error);
            }
          }
          try {
            envRestorer.restore();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await closeHelpdeskPool();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await cleanupFixture(pool, tracker);
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          const finalError = combineErrors(primaryError, teardownErrors);
          if (finalError && finalError !== primaryError) {
            throw finalError;
          }
        }
      }
    );

    // -------------------------------------------------------------------------
    // AC 14.1 / Setup Failure Teardown: Cleanup and Resource Release on Setup Exception
    // -------------------------------------------------------------------------
    await t.test(
      "Controlled Setup Failure Teardown: cleanupFixture and EnvRestorer run in finally when setup is aborted",
      async () => {
        const failTracker = new TestResourceTracker();
        const failEnvRestorer = new EnvRestorer();
        const failRunId = randomUUID().slice(0, 8);
        const failBotAccountId = `acc_fail_${failRunId}`;
        const failSenderId = "66655544";
        let setupErrorCaught = false;
        let createdIdentId = "";

        try {
          failEnvRestorer.set("TELEGRAM_BOT_ACCOUNT_ID", failBotAccountId);
          failEnvRestorer.set("TELEGRAM_TESTER_ALLOWLIST", failSenderId);

          // 1. Create fixture identity before failure
          const ident = await createTestIdentity(
            failTracker,
            `fail_${failRunId}`,
            true,
            seedCustomerId,
            failSenderId,
            failBotAccountId
          );
          createdIdentId = ident.id;

          // Verify fixture exists
          const preCheck = await pool.query(
            "SELECT count(*) FROM public.channel_identities WHERE id = $1",
            [createdIdentId]
          );
          assert.equal(Number(preCheck.rows[0].count), 1);

          // 2. Simulate controlled failure when setup is aborted before server listen
          throw new Error("CONTROLLED_SETUP_FAILURE: Simulated failure during setup before server listen");
        } catch (err) {
          if ((err as Error).message.includes("CONTROLLED_SETUP_FAILURE")) {
            setupErrorCaught = true;
          } else {
            throw err;
          }
        } finally {
          const teardownErrors: Error[] = [];
          try {
            failEnvRestorer.restore();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await closeHelpdeskPool();
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          try {
            await cleanupFixture(pool, failTracker);
          } catch (e) {
            teardownErrors.push(e as Error);
          }
          if (teardownErrors.length > 0) {
            throw combineErrors(undefined, teardownErrors);
          }
        }

        assert.equal(setupErrorCaught, true, "Setup failure must be caught and handled");

        // 3. PROOF: Fixture identity created before setup failure is 100% cleaned up by UUID
        const postCheck = await pool.query(
          "SELECT count(*) FROM public.channel_identities WHERE id = $1",
          [createdIdentId]
        );
        assert.equal(
          Number(postCheck.rows[0].count),
          0,
          "Fixture identity created during aborted setup must be cleaned up in finally block"
        );

        // 4. PROOF: EnvRestorer properly restored original/deleted environment variable
        assert.notEqual(
          process.env.TELEGRAM_BOT_ACCOUNT_ID,
          failBotAccountId,
          "Environment variable must be restored after setup failure"
        );
      }
    );

    // -------------------------------------------------------------------------
    // AC 14: Fixture Cleanup Preserves Separate Comparator Baseline Data
    // -------------------------------------------------------------------------
    await t.test(
      "Comparator Baseline Preservation: UUID-scoped cleanup preserves separate comparator data without global delete",
      async () => {
        const mainTracker = new TestResourceTracker();
        const compTracker = new TestResourceTracker();
        const runId = randomUUID().slice(0, 8);

        try {
          // 1. Create separate comparator fixture (non-eligible job: status 'done', completed_at non-null)
          const compSenderId = `comp_snd_${runId}`;
          const compIdent = await createTestIdentity(compTracker, `comp_${runId}`, true, seedCustomerId, compSenderId);

          const compIngress = await persistence.receive({
            sender: {
              channel: "telegram",
              channelAccountId: compIdent.accountId,
              senderExternalId: compIdent.senderId,
            },
            chatId: `chat_comp_${runId}`,
            providerMessageId: `msg_comp_${runId}`,
            text: "comparator message baseline",
          });
          compTracker.recordIngress(compIngress.ingressId);

          const compJobTimestamp = new Date("2026-10-02T08:00:00.000Z").toISOString();
          await pool.query(
            `UPDATE public.processing_jobs
             SET status = 'done', completed_at = $2, attempt_count = 1
             WHERE ingress_id = $1`,
            [compIngress.ingressId, compJobTimestamp]
          );

          await pool.query(
            `INSERT INTO public.processing_job_attempts(ingress_id, attempt_number, lease_token, started_at, completed_at, outcome)
             VALUES ($1, 1, 'comp-lease-token', $2, $2, 'success')`,
            [compIngress.ingressId, compJobTimestamp]
          );

          // 2. Take exact snapshot of comparator data
          const compJobSnapshot = (
            await pool.query(
              "SELECT ingress_id, status, created_at, completed_at, attempt_count, max_attempts FROM public.processing_jobs WHERE ingress_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compAttemptSnapshot = (
            await pool.query(
              "SELECT ingress_id, attempt_number, lease_token, started_at, completed_at, outcome FROM public.processing_job_attempts WHERE ingress_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compIdentitySnapshot = (
            await pool.query(
              "SELECT id, channel, channel_account_id, sender_external_id, customer_id, verification_status FROM public.channel_identities WHERE id = $1",
              [compIdent.id]
            )
          ).rows[0];

          // 3. Create and process MAIN fixture
          const mainIdent = await createTestIdentity(mainTracker, `main_${runId}`);
          const mainIngress = await persistence.receive({
            sender: {
              channel: "telegram",
              channelAccountId: mainIdent.accountId,
              senderExternalId: mainIdent.senderId,
            },
            chatId: `chat_main_${runId}`,
            providerMessageId: `msg_main_${runId}`,
            text: "Lampu LOS merah",
          });
          mainTracker.recordIngress(mainIngress.ingressId);

          const mainClaim = await claimJob(pool, { ingressId: mainIngress.ingressId });
          assert.ok(mainClaim != null);
          const mainResult = await processJobWithWorker(pool, supabase, mainClaim, {
            orchestrationOptions: { scenarioId: "normal" },
          });
          assert.equal(mainResult.outcome, "success");

          // Verify main fixture exists before cleanup
          const mainJobsPre = await pool.query(
            "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
            [mainIngress.ingressId]
          );
          assert.equal(Number(mainJobsPre.rows[0].count), 1);

          // 4. Run cleanup strictly on MAIN fixture
          await cleanupFixture(pool, mainTracker);

          // 5. Assert: MAIN fixture rows are deleted
          const mainJobsPost = await pool.query(
            "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
            [mainIngress.ingressId]
          );
          assert.equal(Number(mainJobsPost.rows[0].count), 0, "Main job must be deleted after cleanup");

          const mainAttemptsPost = await pool.query(
            "SELECT count(*) FROM public.processing_job_attempts WHERE ingress_id = $1",
            [mainIngress.ingressId]
          );
          assert.equal(Number(mainAttemptsPost.rows[0].count), 0, "Main attempts must be deleted after cleanup");

          const mainIdentPost = await pool.query(
            "SELECT count(*) FROM public.channel_identities WHERE id = $1",
            [mainIdent.id]
          );
          assert.equal(Number(mainIdentPost.rows[0].count), 0, "Main identity must be deleted after cleanup");

          // 6. Assert: COMPARATOR fixture rows remain strictly IDENTICAL
          const compJobCurrent = (
            await pool.query(
              "SELECT ingress_id, status, created_at, completed_at, attempt_count, max_attempts FROM public.processing_jobs WHERE ingress_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compAttemptCurrent = (
            await pool.query(
              "SELECT ingress_id, attempt_number, lease_token, started_at, completed_at, outcome FROM public.processing_job_attempts WHERE ingress_id = $1",
              [compIngress.ingressId]
            )
          ).rows[0];

          const compIdentityCurrent = (
            await pool.query(
              "SELECT id, channel, channel_account_id, sender_external_id, customer_id, verification_status FROM public.channel_identities WHERE id = $1",
              [compIdent.id]
            )
          ).rows[0];

          assert.deepEqual(compJobCurrent, compJobSnapshot, "Comparator job must remain strictly identical after main cleanup");
          assert.deepEqual(compAttemptCurrent, compAttemptSnapshot, "Comparator attempt must remain strictly identical after main cleanup");
          assert.deepEqual(compIdentityCurrent, compIdentitySnapshot, "Comparator identity must remain strictly identical after main cleanup");

          // 7. Clean up comparator separately by UUID
          await cleanupFixture(pool, compTracker);

          const compJobFinal = await pool.query(
            "SELECT count(*) FROM public.processing_jobs WHERE ingress_id = $1",
            [compIngress.ingressId]
          );
          assert.equal(Number(compJobFinal.rows[0].count), 0, "Comparator job must be deleted after comparator cleanup");
        } finally {
          await cleanupFixture(pool, mainTracker);
          await cleanupFixture(pool, compTracker);
        }
      }
    );

    // -------------------------------------------------------------------------
    // AC 15: Controlled Failure Teardown & Connection Closure
    // -------------------------------------------------------------------------
    await t.test(
      "Controlled Failure Teardown: errors during processing trigger proper cleanup and pool release",
      async () => {
        const tracker = new TestResourceTracker();
        const runId = randomUUID().slice(0, 8);
        let errorCaught = false;
        let identId = "";

        try {
          const ident = await createTestIdentity(tracker, `err_${runId}`);
          identId = ident.id;
          const ingress = await persistence.receive({
            sender: {
              channel: "telegram",
              channelAccountId: ident.accountId,
              senderExternalId: ident.senderId,
            },
            chatId: `chat_err_${runId}`,
            providerMessageId: `msg_err_${runId}`,
            text: "Controlled error test",
          });
          tracker.recordIngress(ingress.ingressId);

          // Dedicated connection from pool to verify connection lifecycle under error
          const dedicatedClient = await pool.connect();
          try {
            await dedicatedClient.query("SELECT 1");
            throw new Error("Controlled test fault injection");
          } finally {
            dedicatedClient.release();
          }
        } catch (err) {
          if (err instanceof Error && err.message === "Controlled test fault injection") {
            errorCaught = true;
          } else {
            throw err;
          }
        } finally {
          await cleanupFixture(pool, tracker);
        }

        assert.ok(errorCaught, "Controlled fault injection must be caught");
        // Verify fixture cleaned up despite the error
        const idents = await pool.query(
          "SELECT count(*) FROM public.channel_identities WHERE id = $1",
          [identId]
        );
        assert.equal(Number(idents.rows[0].count), 0, "Tracker cleanup in finally must succeed after error");
      }
    );

  } finally {
    // Restore original automation settings if needed
    if (origSettings) {
      await pool.query(
        "UPDATE public.automation_settings SET mode = $1, emergency_stop = $2 WHERE singleton = true",
        [origSettings.mode, origSettings.emergency_stop]
      );
    }
    await closeHelpdeskPool();
    await pool.end();
  }
});
