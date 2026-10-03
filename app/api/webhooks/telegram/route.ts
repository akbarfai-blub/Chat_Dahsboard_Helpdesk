import { after } from "next/server";
import { getHelpdeskPool } from "../../../../lib/postgres/server";
import { getHelpdeskAdminClient } from "../../../../lib/supabase/server";
import { HelpdeskPersistence } from "../../../../lib/application/helpdesk-persistence";
import {
  handleTelegramWebhook,
  type PersistenceFactory,
} from "../../../../lib/application/telegram-inbound-service";
import { drainProcessingJobs } from "../../../../lib/application/job-worker-service";

export const dynamic = "force-dynamic";

/**
 * Lazy persistence factory for the Telegram webhook route.
 * getHelpdeskPool() is only called after webhook secret and payload size verifications succeed.
 */
export const defaultPersistenceFactory: PersistenceFactory = () => {
  const pool = getHelpdeskPool();
  return new HelpdeskPersistence(pool);
};

export const defaultPoolFactory = () => getHelpdeskPool();
export const defaultAdminClientFactory = () => getHelpdeskAdminClient();

import {
  handleDiagnosticRuntimeCheck,
} from "../../../../lib/application/diagnostic-target-validator";
import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/supabase/database.types";

export interface DiagnosticFactories {
  getPool?: () => Pool;
  getClient?: () => SupabaseClient<Database>;
}

export async function handleDiagnosticWebhookRequest(
  request: Request,
  diagnosticFactories: DiagnosticFactories = {}
): Promise<Response> {
  const poolFactory = diagnosticFactories.getPool ?? defaultPoolFactory;
  const clientFactory = diagnosticFactories.getClient ?? defaultAdminClientFactory;
  return handleDiagnosticRuntimeCheck(request, poolFactory, clientFactory);
}

export async function POST(request: Request): Promise<Response> {
  // Test runtime diagnostics: strictly disabled by default.
  // Request header and secret alone can NEVER trigger diagnostics unless ENABLE_TEST_RUNTIME_DIAGNOSTICS === "true".
  const diagnosticsEnabled = process.env.ENABLE_TEST_RUNTIME_DIAGNOSTICS === "true";

  if (diagnosticsEnabled && request.headers.get("x-test-runtime-check") === "true") {
    return handleDiagnosticWebhookRequest(request);
  }

  return handleTelegramWebhook(request, defaultPersistenceFactory, {
    onAccepted: () => {
      after(async () => {
        try {
          const pool = getHelpdeskPool();
          const client = getHelpdeskAdminClient();
          await drainProcessingJobs(pool, client);
        } catch (err) {
          console.error("Background job processing failed:", err);
        }
      });
    },
  });
}
