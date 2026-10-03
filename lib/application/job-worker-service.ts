import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import {
  DEFAULT_JOB_WORKER_CONFIG,
  type ClaimedJob,
  type ClaimJobOutcome,
  type JobWorkerConfig,
  type WorkerDrainResult,
  type WorkerJobResult,
} from "./job-worker-contracts";
import { orchestrateProcessing, type OrchestrationOptions } from "./orchestrate-processing";
import { PersistenceError } from "./persistence-contracts";

/**
 * Sanitizes error messages by stripping connection strings, credentials,
 * and sensitive tokens, then truncates to a safe length (max 500 characters).
 */
export function sanitizeErrorMessage(error: unknown): string {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = String(error);
  }

  // Remove database connection strings with passwords: postgresql://user:pass@host...
  message = message.replace(
    /(postgres|postgresql):\/\/[^@\s]+@/gi,
    "$1://[redacted]@"
  );

  // Remove Bearer tokens and API keys
  message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  message = message.replace(/key=[A-Za-z0-9._-]+/gi, "key=[redacted]");
  message = message.replace(/secret=[A-Za-z0-9._-]+/gi, "secret=[redacted]");

  const trimmed = message.trim();
  if (trimmed.length > 500) {
    return trimmed.slice(0, 497) + "...";
  }
  return trimmed || "unknown_error";
}

/**
 * Determines whether an error is retryable.
 * Permanent errors (such as missing ingress or conflict) should not be retried.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof PersistenceError) {
    const permanentCodes = new Set([
      "lease_lost",
      "job_leased_by_other_worker",
      "job_lease_expired",
      "ingress_not_found",
      "ingress_identity_conflict",
      "invalid_association",
      "invalid_reply",
      "job_already_done",
      "job_already_failed",
    ]);
    if (permanentCodes.has(error.code)) {
      return false;
    }
  }
  return true;
}

/**
 * Computes exponential backoff delay based on attempt number:
 * backoff = baseBackoffMs * 2^(attemptNumber - 1)
 */
export function computeBackoffMs(attemptNumber: number, baseBackoffMs: number): number {
  const exponent = Math.max(0, attemptNumber - 1);
  return baseBackoffMs * Math.pow(2, exponent);
}

export interface ClaimJobOptions {
  ingressId?: string;
  leaseDurationMs?: number;
  now?: Date;
}

/**
 * Atomically claims the next eligible job (or a specific job if ingressId is provided),
 * distinguishing between successfully claimed jobs, jobs terminalized due to exhausted attempts,
 * and no eligible jobs.
 * Runs inside its own application transaction with FOR UPDATE (or SKIP LOCKED for queues),
 * advances attempt count, writes attempt history, and commits before returning.
 */
export async function claimNextJob(
  pool: Pool,
  options?: ClaimJobOptions
): Promise<ClaimJobOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const effectiveNow = options?.now ?? new Date();
    const leaseDuration =
      options?.leaseDurationMs ?? DEFAULT_JOB_WORKER_CONFIG.leaseDurationMs;

    let selectQuery: string;
    let selectParams: unknown[];

    if (options?.ingressId) {
      selectQuery = `
        SELECT ingress_id, status, lease_token, lease_expires_at, attempt_count, max_attempts
        FROM public.processing_jobs
        WHERE ingress_id = $1
          AND (
            (status = 'pending' AND next_attempt_at <= $2)
            OR
            (status = 'in_progress' AND lease_expires_at <= $2)
          )
        FOR UPDATE
      `;
      selectParams = [options.ingressId, effectiveNow.toISOString()];
    } else {
      selectQuery = `
        SELECT ingress_id, status, lease_token, lease_expires_at, attempt_count, max_attempts
        FROM public.processing_jobs
        WHERE (
          (status = 'pending' AND next_attempt_at <= $1)
          OR
          (status = 'in_progress' AND lease_expires_at <= $1)
        )
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      selectParams = [effectiveNow.toISOString()];
    }

    const res = await client.query<{
      ingress_id: string;
      status: string;
      lease_token: string | null;
      lease_expires_at: string | null;
      attempt_count: number;
      max_attempts: number;
    }>(selectQuery, selectParams);

    if (res.rowCount === 0) {
      await client.query("COMMIT");
      return { kind: "none" };
    }

    const job = res.rows[0];

    // If attempts are already exhausted (e.g. expired lease on a job that reached max_attempts)
    if (job.attempt_count >= job.max_attempts) {
      await client.query(
        `UPDATE public.processing_jobs
         SET status = 'failed', completed_at = $2, lease_token = null, lease_expires_at = null,
             last_error = 'max_attempts_exhausted'
         WHERE ingress_id = $1`,
        [job.ingress_id, effectiveNow.toISOString()]
      );
      await client.query(
        `UPDATE public.processing_job_attempts
         SET outcome = 'terminal_failure', completed_at = $2, error_message = 'max_attempts_exhausted'
         WHERE ingress_id = $1 AND outcome = 'in_progress'`,
        [job.ingress_id, effectiveNow.toISOString()]
      );
      await client.query("COMMIT");
      return { kind: "exhausted", ingressId: job.ingress_id, error: "max_attempts_exhausted" };
    }

    // If an earlier worker's lease expired, mark that prior attempt as lease_expired
    if (job.status === "in_progress") {
      await client.query(
        `UPDATE public.processing_job_attempts
         SET outcome = 'lease_expired', completed_at = $2
         WHERE ingress_id = $1 AND outcome = 'in_progress'`,
        [job.ingress_id, effectiveNow.toISOString()]
      );
    }

    const newAttemptNumber = job.attempt_count + 1;
    const newLeaseToken = randomUUID();
    const leaseExpiresAt = new Date(effectiveNow.getTime() + leaseDuration).toISOString();

    // Acquire lease
    await client.query(
      `UPDATE public.processing_jobs
       SET status = 'in_progress',
           lease_token = $2,
           lease_expires_at = $3,
           attempt_count = $4
       WHERE ingress_id = $1`,
      [job.ingress_id, newLeaseToken, leaseExpiresAt, newAttemptNumber]
    );

    // Record attempt
    await client.query(
      `INSERT INTO public.processing_job_attempts
       (ingress_id, attempt_number, lease_token, started_at, outcome)
       VALUES ($1, $2, $3, $4, 'in_progress')`,
      [job.ingress_id, newAttemptNumber, newLeaseToken, effectiveNow.toISOString()]
    );

    await client.query("COMMIT");

    return {
      kind: "claimed",
      job: {
        ingressId: job.ingress_id,
        leaseToken: newLeaseToken,
        attemptNumber: newAttemptNumber,
        leaseExpiresAt,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Backward-compatible helper: claims next job and returns ClaimedJob or null.
 */
export async function claimJob(
  pool: Pool,
  options?: ClaimJobOptions
): Promise<ClaimedJob | null> {
  const result = await claimNextJob(pool, options);
  if (result.kind === "claimed") {
    return result.job;
  }
  return null;
}

export interface RecordFailureOptions {
  now?: Date;
  validationNow?: Date | (() => Date);
  baseBackoffMs?: number;
}

/**
 * Fenced failure recorder: only updates job and attempt if the job is still
 * in_progress, lease_token matches, and lease has NOT expired.
 *
 * Distinguishes:
 * - Failure event time (`options.now`), used for `completed_at` and backoff calculation.
 * - Lease authority validation time (`validationNow` or `clock_timestamp()` after row lock acquisition).
 *
 * If lease expired while waiting for connection/row lock, or was stolen, this update
 * makes zero mutations and returns "lease_lost", preventing stale workers
 * from overwriting retry schedules or attempt outcomes.
 */
export async function recordJobFailure(
  pool: Pool,
  ingressId: string,
  leaseToken: string,
  error: unknown,
  options?: RecordFailureOptions
): Promise<"retrying" | "terminal" | "lease_lost"> {
  const sanitized = sanitizeErrorMessage(error);
  const retryable = isRetryableError(error);
  // Failure event time: used for recording completed_at and backoff schedule
  const failureTime = options?.now ?? new Date();
  const baseBackoff = options?.baseBackoffMs ?? DEFAULT_JOB_WORKER_CONFIG.baseBackoffMs;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fenced check: acquire row lock first
    const check = await client.query<{
      status: string;
      lease_token: string | null;
      lease_expires_at: string | null;
      attempt_count: number;
      max_attempts: number;
    }>(
      `SELECT status, lease_token, lease_expires_at, attempt_count, max_attempts
       FROM public.processing_jobs
       WHERE ingress_id = $1
       FOR UPDATE`,
      [ingressId]
    );

    if (check.rowCount === 0) {
      await client.query("COMMIT");
      return "lease_lost";
    }

    const job = check.rows[0];

    // Read clock_timestamp() via a separate query strictly AFTER the row lock query completes,
    // ensuring the timestamp reflects any delay spent waiting for the lock.
    const clockRes = await client.query<{ lock_acquired_at: string | Date }>(
      "SELECT clock_timestamp() AS lock_acquired_at"
    );
    const lockAcquiredAt = clockRes.rows[0]?.lock_acquired_at;

    // Determine validation time:
    // In PostgreSQL, clock_timestamp() gives the wall clock time when executed,
    // reflecting time spent waiting for the lock (unlike now() which freezes at transaction start).
    // Can also be explicitly controlled in tests via options.validationNow.
    const validationTime =
      typeof options?.validationNow === "function"
        ? options.validationNow()
        : options?.validationNow ??
          (lockAcquiredAt ? new Date(lockAcquiredAt) : new Date());

    // Verify that:
    // 1. Job is still in_progress (has not been finished or marked terminal)
    // 2. lease_token matches this worker's token (not reclaimed by another worker)
    // 3. lease has not expired at validationTime (after row lock was acquired)
    const isLeaseActive =
      job.status === "in_progress" &&
      job.lease_token === leaseToken &&
      job.lease_expires_at != null &&
      new Date(job.lease_expires_at).getTime() > validationTime.getTime();

    if (!isLeaseActive) {
      await client.query("COMMIT");
      return "lease_lost";
    }

    const shouldRetry = retryable && job.attempt_count < job.max_attempts;

    if (shouldRetry) {
      // Calculate backoff from failure event time
      const backoffMs = computeBackoffMs(job.attempt_count, baseBackoff);
      const nextAttemptAt = new Date(failureTime.getTime() + backoffMs).toISOString();

      await client.query(
        `UPDATE public.processing_jobs
         SET status = 'pending',
             lease_token = null,
             lease_expires_at = null,
             next_attempt_at = $3,
             last_error = $4
         WHERE ingress_id = $1 AND lease_token = $2 AND status = 'in_progress'`,
        [ingressId, leaseToken, nextAttemptAt, sanitized]
      );

      await client.query(
        `UPDATE public.processing_job_attempts
         SET outcome = 'retryable_failure',
             completed_at = $3,
             error_message = $4
         WHERE ingress_id = $1 AND lease_token = $2 AND outcome = 'in_progress'`,
        [ingressId, leaseToken, failureTime.toISOString(), sanitized]
      );

      await client.query("COMMIT");
      return "retrying";
    } else {
      // Terminal failure
      await client.query(
        `UPDATE public.processing_jobs
         SET status = 'failed',
             completed_at = $3,
             lease_token = null,
             lease_expires_at = null,
             last_error = $4
         WHERE ingress_id = $1 AND lease_token = $2 AND status = 'in_progress'`,
        [ingressId, leaseToken, failureTime.toISOString(), sanitized]
      );

      await client.query(
        `UPDATE public.processing_job_attempts
         SET outcome = 'terminal_failure',
             completed_at = $3,
             error_message = $4
         WHERE ingress_id = $1 AND lease_token = $2 AND outcome = 'in_progress'`,
        [ingressId, leaseToken, failureTime.toISOString(), sanitized]
      );

      await client.query("COMMIT");
      return "terminal";
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface ProcessJobWithWorkerOptions {
  now?: Date | (() => Date);
  failureNow?: Date;
  validationNow?: Date | (() => Date);
  orchestrationOptions?: OrchestrationOptions;
  baseBackoffMs?: number;
}

/**
 * Executes orchestrateProcessing for a claimed job outside the claim transaction.
 * Fences mutations using the lease token. Handles success and failures with sanitized tracking.
 */
export async function processJobWithWorker(
  pool: Pool,
  client: SupabaseClient<Database>,
  claimedJob: ClaimedJob,
  options?: ProcessJobWithWorkerOptions
): Promise<WorkerJobResult> {
  try {
    await orchestrateProcessing(pool, client, claimedJob.ingressId, {
      ...options?.orchestrationOptions,
      leaseToken: claimedJob.leaseToken,
    });

    return {
      ingressId: claimedJob.ingressId,
      outcome: "success",
    };
  } catch (err) {
    if (err instanceof PersistenceError && err.code === "lease_lost") {
      return {
        ingressId: claimedJob.ingressId,
        outcome: "lease_lost",
        error: "Lease lost or expired during processing",
      };
    }

    const effectiveFailureNow =
      options?.failureNow ??
      (typeof options?.now === "function" ? options.now() : new Date());

    const failureOutcome = await recordJobFailure(
      pool,
      claimedJob.ingressId,
      claimedJob.leaseToken,
      err,
      {
        now: effectiveFailureNow,
        validationNow:
          options?.validationNow ??
          (typeof options?.now === "function" ? options.now : undefined),
        baseBackoffMs: options?.baseBackoffMs,
      }
    );

    if (failureOutcome === "lease_lost") {
      return {
        ingressId: claimedJob.ingressId,
        outcome: "lease_lost",
        error: "Lease lost or stolen before failure could be recorded",
      };
    }

    return {
      ingressId: claimedJob.ingressId,
      outcome: failureOutcome === "retrying" ? "retryable_failure" : "terminal_failure",
      error: sanitizeErrorMessage(err),
    };
  }
}

export interface DrainProcessingJobsOptions {
  config?: Partial<JobWorkerConfig>;
  now?: () => Date;
  orchestrationOptions?: OrchestrationOptions;
}

/**
 * Bounded worker drain execution:
 * Fetches eligible jobs up to maxJobsPerDrain or until drainTimeoutMs is reached.
 * Runs each job's orchestrateProcessing outside transaction, with atomic lease claim and fencing.
 * When an expired job is found whose attempts are exhausted, marks it failed and continues draining.
 */
export async function drainProcessingJobs(
  pool: Pool,
  client: SupabaseClient<Database>,
  options?: DrainProcessingJobsOptions
): Promise<WorkerDrainResult> {
  const cfg: JobWorkerConfig = {
    ...DEFAULT_JOB_WORKER_CONFIG,
    ...options?.config,
  };
  const startTime = Date.now();
  const results: WorkerJobResult[] = [];
  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  while (
    processedCount < cfg.maxJobsPerDrain &&
    Date.now() - startTime < cfg.drainTimeoutMs
  ) {
    const claimTime = options?.now ? options.now() : new Date();
    const claimResult = await claimNextJob(pool, {
      leaseDurationMs: cfg.leaseDurationMs,
      now: claimTime,
    });

    if (claimResult.kind === "none") {
      break; // No eligible jobs available
    }

    if (claimResult.kind === "exhausted") {
      // Job was found with attempts exhausted and transitioned to failed
      results.push({
        ingressId: claimResult.ingressId,
        outcome: "terminal_failure",
        error: claimResult.error,
      });
      processedCount++;
      failureCount++;
      continue; // Continue to the next eligible job!
    }

    // claimResult.kind === "claimed"
    const jobResult = await processJobWithWorker(pool, client, claimResult.job, {
      now: options?.now,
      orchestrationOptions: options?.orchestrationOptions,
      baseBackoffMs: cfg.baseBackoffMs,
    });

    results.push(jobResult);
    processedCount++;

    if (jobResult.outcome === "success") {
      successCount++;
    } else if (
      jobResult.outcome === "retryable_failure" ||
      jobResult.outcome === "terminal_failure"
    ) {
      failureCount++;
    } else if (jobResult.outcome === "lease_lost") {
      skippedCount++;
    }
  }

  return {
    processedCount,
    successCount,
    failureCount,
    skippedCount,
    durationMs: Date.now() - startTime,
    results,
  };
}
