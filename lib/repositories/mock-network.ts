import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { Mapping, OnuStatus, UpstreamStatus } from "../domain/network-status";
import type { MockNetworkStore, NetworkContext, OnuRecord, Scenario, UpstreamRecord } from "../providers/mock-network-store";

type TopologyRow = {
  service_id: string; mapping_version: number; source: string; valid_from: string;
  odps: { id: string; odp_code: string; odc_id: string; odcs: { id: string; odc_code: string } };
};
function toMapping(row: TopologyRow): Mapping {
  return {
    serviceId: row.service_id, version: row.mapping_version, source: row.source, validFrom: row.valid_from,
    odpId: row.odps.id, odpCode: row.odps.odp_code,
    odcId: row.odps.odcs.id, odcCode: row.odps.odcs.odc_code,
  };
}

export class SupabaseMockNetworkStore implements MockNetworkStore {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async getScenario(id: string, signal: AbortSignal): Promise<Scenario | null> {
    const { data, error } = await this.client.from("mock_network_scenarios")
      .select("onu_failure,upstream_failure").eq("id", id).abortSignal(signal).maybeSingle();
    if (error) throw new Error("mock scenario read failed");
    return data ? {
      onuFailure: data.onu_failure as Scenario["onuFailure"],
      upstreamFailure: data.upstream_failure as Scenario["upstreamFailure"],
    } : null;
  }

  private topology(checkedAt: string) {
    return this.client.from("service_topology").select(
      "id,service_id,mapping_version,source,valid_from,services!inner(status),odps!inner(id,odp_code,odc_id,status,odcs!inner(id,odc_code,status))",
    ).is("valid_to", null).lte("valid_from", checkedAt)
      .eq("services.status", "active").eq("odps.status", "active").eq("odps.odcs.status", "active");
  }

  async getContext(customerId: string, serviceId: string, checkedAt: string, signal: AbortSignal): Promise<NetworkContext | null> {
    const service = await this.client.from("services").select("id")
      .eq("id", serviceId).eq("customer_id", customerId).eq("status", "active")
      .abortSignal(signal).maybeSingle();
    if (service.error) throw new Error("service read failed");
    if (!service.data) return null;
    const target = await this.topology(checkedAt).eq("service_id", serviceId).abortSignal(signal).maybeSingle();
    if (target.error) throw new Error("mapping read failed");
    if (!target.data) return { mapping: null, members: [] };
    const mapping = toMapping(target.data);
    const members: Mapping[] = [];
    // Explicit paging prevents the REST row limit from silently inflating area coverage.
    for (let offset = 0; ; offset += 500) {
      const page = await this.topology(checkedAt).eq("odps.odc_id", mapping.odcId)
        .order("id").range(offset, offset + 499).abortSignal(signal);
      if (page.error) throw new Error("scope read failed");
      members.push(...page.data.map(toMapping));
      if (page.data.length < 500) break;
    }
    if (!members.some(m => m.serviceId === serviceId && m.version === mapping.version && m.odpId === mapping.odpId)) {
      throw new Error("mapping changed during inspection");
    }
    return { mapping, members };
  }

  async getOnu(scenarioId: string, serviceIds: string[], signal: AbortSignal): Promise<OnuRecord[]> {
    const rows: OnuRecord[] = [];
    for (let offset = 0; offset < serviceIds.length; offset += 200) {
      const { data, error } = await this.client.from("mock_onu_status")
        .select("service_id,status,observed_at,event_id").eq("scenario_id", scenarioId)
        .in("service_id", serviceIds.slice(offset, offset + 200)).abortSignal(signal);
      if (error) throw new Error("ONU read failed");
      rows.push(...data.map(row => ({
        serviceId: row.service_id, status: row.status as OnuStatus,
        observedAt: row.observed_at, eventId: row.event_id,
      })));
    }
    return rows;
  }

  async getUpstream(scenarioId: string, serviceId: string, signal: AbortSignal): Promise<UpstreamRecord[]> {
    const rows: UpstreamRecord[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.from("mock_upstream_impacts")
        .select("link_id,mapping_version,mock_upstream_status!inner(status,observed_at,event_id)")
        .eq("scenario_id", scenarioId).eq("service_id", serviceId)
        .order("link_id").range(offset, offset + 499).abortSignal(signal);
      if (error) throw new Error("upstream read failed");
      rows.push(...data.map(row => ({
        linkId: row.link_id, mappingVersion: row.mapping_version,
        status: row.mock_upstream_status.status as UpstreamStatus,
        observedAt: row.mock_upstream_status.observed_at,
        eventId: row.mock_upstream_status.event_id,
      })));
      if (data.length < 500) break;
    }
    return rows;
  }
}
