import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { HelpdeskPersistence } from "./helpdesk-persistence";
import { inspectMockNetwork } from "./inspect-network";
import { classifyMessage } from "../domain/message-classification";
import { resolveSenderIdentity } from "../domain/sender-identity";
import type { ProcessingResult } from "./persistence-contracts";
import type { ManualIncidentSnapshot } from "../domain/triage-contracts";
import type { NetworkCheckResult } from "../providers/network-status-provider";
import { PersistenceError } from "./persistence-contracts";
import { EpisodeStore } from "../repositories/episode-store";

export type OrchestrationHooks = {
  onBeforeProvider?: (ingressId: string) => Promise<void> | void;
  onAfterProvider?: (ingressId: string, network: NetworkCheckResult | null) => Promise<void> | void;
  onBeforeTransaction?: (ingressId: string) => Promise<void> | void;
  onProviderCall?: () => void;
};

export type OrchestrationOptions = {
  hooks?: OrchestrationHooks;
  scenarioId?: string;
  leaseToken?: string;
  targetEpisodeId?: string;
};

/**
 * Orchestrates the processing of a single ingress message.
 *
 * It reads the message and identity from the database, evaluates basic criteria
 * (classification and manual incidents), and only fetches network evidence from
 * the mock provider if needed. This prevents holding transactions open during async
 * provider checks.
 *
 * Mock Configuration:
 * The scenario ID used for network inspection is determined by `options.scenarioId`,
 * `NETWORK_SCENARIO_ID`, or `MOCK_SCENARIO_ID`.
 * If none is set, it defaults to `"normal"`, aligning with the mock fixture schema.
 * Invalid scenario configuration (e.g. unknown scenario) is handled gracefully by
 * the MockProvider (returning `not_found` error), which translates to a safe fallback
 * (`generic` decision and persisted provider failure details in the audit assessment).
 */
export async function orchestrateProcessing(
  pool: Pool,
  client: SupabaseClient<Database>,
  ingressId: string,
  options?: OrchestrationOptions
): Promise<ProcessingResult> {
  // 1. Fast-path idempotency check: if ingress has already been processed, return stored result
  const existingAssessment = await pool.query<{ processing_result: ProcessingResult }>(
    "select processing_result from public.triage_assessments where message_id = $1",
    [ingressId]
  );
  if (existingAssessment.rows.length > 0) {
    return existingAssessment.rows[0].processing_result;
  }

  // 2. Fetch ingress and identity info outside the main transaction
  const ingressResult = await pool.query(`
    select i.body, i.identity_id, i.channel, i.account_id, i.chat_id, i.provider_message_id, i.received_at, i.mode, i.emergency_stop
    from public.ingress_events i
    where i.id = $1
  `, [ingressId]);

  if (ingressResult.rowCount !== 1) {
    throw new PersistenceError("ingress_not_found");
  }
  const row = ingressResult.rows[0];

  // Fetch identity candidate from storage using db connection
  const dbClient = await pool.connect();
  let candidate;
  try {
    const store = new EpisodeStore(dbClient);
    candidate = await store.identity(row.identity_id);
  } finally {
    dbClient.release();
  }

  // 3. Resolve identity using candidate's stored senderExternalId (never conflating chat ID with sender ID)
  const now = new Date().toISOString();
  const senderKey = {
    channel: candidate.channel,
    channelAccountId: candidate.channelAccountId,
    senderExternalId: candidate.senderExternalId,
  };
  const identity = resolveSenderIdentity(senderKey, [candidate], now);
  const classification = classifyMessage(row.body);

  // 4. Fetch active manual incidents
  const incidentResult = await pool.query<{
    id: string; type: string; status: string; odp_ids: string[]; odc_ids: string[]; version: number;
  }>("select id, type, status, odp_ids, odc_ids, version from public.incidents where status = 'ACTIVE'");

  const manualIncidents: ManualIncidentSnapshot[] = incidentResult.rows.map(inc => ({
    id: inc.id,
    type: inc.type as "GENERAL" | "AREA_SPECIFIC",
    status: "ACTIVE" as const,
    odpIds: inc.odp_ids,
    odcIds: inc.odc_ids,
    version: inc.version,
  }));

  const hasGeneralIncident = manualIncidents.some(inc => inc.type === "GENERAL" && inc.status === "ACTIVE");

  // 5. Determine if network evidence is needed:
  // We ONLY fetch network evidence if:
  // - Message is a connection complaint
  // - Identity is resolved (verified with single customerId and serviceId)
  // - There is NO active GENERAL manual incident (which overrides everything without lookup)
  let network: NetworkCheckResult | null = null;
  let providerQuality: Record<string, unknown> | null = null;

  if (
    classification.category === "connection_complaint" &&
    identity.outcome === "resolved" &&
    !hasGeneralIncident
  ) {
    if (options?.hooks?.onBeforeProvider) {
      await options.hooks.onBeforeProvider(ingressId);
    }
    if (options?.hooks?.onProviderCall) {
      options.hooks.onProviderCall();
    }

    const scenarioId = options?.scenarioId?.trim() ||
                       process.env.NETWORK_SCENARIO_ID?.trim() ||
                       process.env.MOCK_SCENARIO_ID?.trim() ||
                       "normal";

    network = await inspectMockNetwork(client, identity.customerId!, identity.serviceId!, scenarioId);

    if (network) {
      providerQuality = {
        source: network.source,
        scenarioId: network.scenarioId,
        outcome: network.outcome,
        reason: network.reason,
        checkedAt: network.checkedAt,
        onu: {
          status: network.onu?.status,
          reportedStatus: network.onu?.reportedStatus,
          quality: network.onu?.quality,
          observedAt: network.onu?.observedAt,
          eventId: network.onu?.eventId,
        },
        upstreamQuality: network.upstreamQuality,
        upstreamCount: network.upstream?.length ?? 0,
        indicatedArea: network.indicatedArea ? {
          scope: network.indicatedArea.scope,
          scopeId: network.indicatedArea.scopeId,
        } : null,
      };
    }

    if (options?.hooks?.onAfterProvider) {
      await options.hooks.onAfterProvider(ingressId, network);
    }
  }

  if (options?.hooks?.onBeforeTransaction) {
    await options.hooks.onBeforeTransaction(ingressId);
  }

  // 6. Delegate to HelpdeskPersistence.process within a transaction
  // HelpdeskPersistence validates identity, manual incidents, and settings atomically under lock.
  const persistence = new HelpdeskPersistence(pool);
  return persistence.process(ingressId, {
    network,
    manualIncidents,
    providerQuality,
    leaseToken: options?.leaseToken,
    targetEpisodeId: options?.targetEpisodeId,
  });
}
