import type { Mapping, OnuStatus, RawObservation, UpstreamStatus } from "../domain/network-status";

export type Scenario = { onuFailure: "none" | "error" | "timeout"; upstreamFailure: "none" | "error" | "timeout" };
export type NetworkContext = { mapping: Mapping | null; members: Mapping[] };
export type OnuRecord = RawObservation<OnuStatus> & { serviceId: string };
export type UpstreamRecord = RawObservation<UpstreamStatus> & { linkId: string; mappingVersion: number };
export interface MockNetworkStore {
  getScenario(id: string, signal: AbortSignal): Promise<Scenario | null>;
  getContext(customerId: string, serviceId: string, checkedAt: string, signal: AbortSignal): Promise<NetworkContext | null>;
  getOnu(scenarioId: string, serviceIds: string[], signal: AbortSignal): Promise<OnuRecord[]>;
  getUpstream(scenarioId: string, serviceId: string, signal: AbortSignal): Promise<UpstreamRecord[]>;
}

