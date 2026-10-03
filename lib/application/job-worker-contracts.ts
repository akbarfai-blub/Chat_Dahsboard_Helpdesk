export type JobStatus = "pending" | "in_progress" | "done" | "failed";

export type AttemptOutcome =
  | "in_progress"
  | "success"
  | "retryable_failure"
  | "terminal_failure"
  | "lease_expired";

export interface JobWorkerConfig {
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly baseBackoffMs: number;
  readonly maxJobsPerDrain: number;
  readonly drainTimeoutMs: number;
}

export const DEFAULT_JOB_WORKER_CONFIG: JobWorkerConfig = {
  leaseDurationMs: 30_000,   // 30 seconds: ample for mock provider and atomic transactions
  maxAttempts: 3,           // 3 attempts for inbound processing before terminal failure
  baseBackoffMs: 2_000,     // 2s base exponential backoff (2s, 4s, 8s)
  maxJobsPerDrain: 5,       // Max 5 jobs per bounded drain execution
  drainTimeoutMs: 20_000,   // 20s hard timeout per drain loop to stay within function limits
};

export interface ClaimedJob {
  readonly ingressId: string;
  readonly leaseToken: string;
  readonly attemptNumber: number;
  readonly leaseExpiresAt: string;
}

export type ClaimJobOutcome =
  | { readonly kind: "claimed"; readonly job: ClaimedJob }
  | { readonly kind: "exhausted"; readonly ingressId: string; readonly error: string }
  | { readonly kind: "none" };

export interface WorkerJobResult {
  readonly ingressId: string;
  readonly outcome: "success" | "retryable_failure" | "terminal_failure" | "lease_lost";
  readonly error?: string;
  readonly nextAttemptAt?: string | null;
}

export interface WorkerDrainResult {
  readonly processedCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly skippedCount: number;
  readonly durationMs: number;
  readonly results: readonly WorkerJobResult[];
}

export class LeaseLostError extends Error {
  constructor(message = "Lease has expired or was acquired by another worker") {
    super(message);
    this.name = "LeaseLostError";
  }
}

export class JobLeasedByOtherWorkerError extends Error {
  constructor(message = "Job is actively leased by another worker") {
    super(message);
    this.name = "JobLeasedByOtherWorkerError";
  }
}
