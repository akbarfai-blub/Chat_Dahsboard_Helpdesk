import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { DEFAULT_FRESHNESS_MS, NETWORK_TIMEOUT_MS } from "../domain/network-status";
import { MockProvider } from "../providers/mock-provider";
import { SupabaseMockNetworkStore } from "../repositories/mock-network";

export async function inspectMockNetwork(
  client: SupabaseClient<Database>,
  customerId: string,
  serviceId: string,
  scenarioId: string,
) {
  const now = Date.now();
  const provider = new MockProvider(new SupabaseMockNetworkStore(client), scenarioId);
  return provider.check({
    customerId, serviceId, checkedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + NETWORK_TIMEOUT_MS).toISOString(),
    freshnessMs: DEFAULT_FRESHNESS_MS,
  });
}

