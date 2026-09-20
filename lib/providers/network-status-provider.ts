import type { AreaSnapshot, Mapping, Observation, OnuStatus, UpstreamStatus } from "../domain/network-status";

export type NetworkCheckInput = {
  // Caller establishes identity/authorization; this provider does not verify chat ownership.
  customerId: string;
  serviceId: string;
  checkedAt: string;
  deadlineAt: string;
  freshnessMs?: number;
};
export type NetworkCheckResult = {
  outcome: "ok" | "not_found" | "error";
  reason: "not_found" | "scenario_not_found" | "invalid_input" | "timeout" | "provider_error" | null;
  source: "MOCK";
  scenarioId: string;
  customerId: string;
  serviceId: string;
  checkedAt: string;
  mapping: Mapping | null;
  onu: Observation<OnuStatus>;
  areas: AreaSnapshot[];
  indicatedArea: { scope: "ODP" | "ODC"; scopeId: string } | null;
  upstream: { linkId: string; mappingVersion: number; observation: Observation<UpstreamStatus> }[];
  upstreamQuality: "ok" | "not_found" | "timeout" | "provider_error" | "mapping_invalid";
};
export interface NetworkStatusProvider {
  check(input: NetworkCheckInput): Promise<NetworkCheckResult>;
}

