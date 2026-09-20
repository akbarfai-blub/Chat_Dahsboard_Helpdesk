import { assessArea, assessObservation, DEFAULT_FRESHNESS_MS } from "../domain/network-status";
import type { NetworkCheckInput, NetworkCheckResult, NetworkStatusProvider } from "./network-status-provider";
import type { MockNetworkStore, Scenario } from "./mock-network-store";

type Failure = "timeout" | "provider_error";
type ReadResult<T> = { data: T; error: null } | { data: null; error: Failure };

export class MockProvider implements NetworkStatusProvider {
  constructor(
    private readonly store: MockNetworkStore,
    private readonly scenarioId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  private async read<T>(
    task: (signal: AbortSignal) => Promise<T>, deadline: number,
  ): Promise<ReadResult<T>> {
    const remaining = deadline - this.clock();
    if (remaining <= 0) return { data: null, error: "timeout" };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, remaining);
      });
      const data = await Promise.race([task(controller.signal), expiry]);
      return { data, error: null };
    } catch {
      return { data: null, error: controller.signal.aborted ? "timeout" : "provider_error" };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async simulate(failure: Scenario["onuFailure"], signal: AbortSignal) {
    if (failure === "error") throw new Error("simulated provider failure");
    if (failure === "timeout") {
      await new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  }

  async check(input: NetworkCheckInput): Promise<NetworkCheckResult> {
    const freshness = input.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    const deadline = Date.parse(input.deadlineAt);
    const result: NetworkCheckResult = {
      outcome: "ok", reason: null, source: "MOCK", scenarioId: this.scenarioId,
      customerId: input.customerId, serviceId: input.serviceId, checkedAt: input.checkedAt,
      mapping: null, onu: assessObservation(null, input.checkedAt), areas: [],
      indicatedArea: null, upstream: [], upstreamQuality: "not_found",
    };
    if (!Number.isFinite(deadline) || !Number.isFinite(Date.parse(input.checkedAt)) ||
        !Number.isFinite(freshness) || freshness < 0 || !input.serviceId || !input.customerId) {
      return { ...result, outcome: "error", reason: "invalid_input" };
    }
    const context = await this.read(async signal => {
      const [scenario, network] = await Promise.all([
        this.store.getScenario(this.scenarioId, signal),
        this.store.getContext(input.customerId, input.serviceId, input.checkedAt, signal),
      ]);
      return { scenario, network };
    }, deadline);
    if (context.error) {
      return { ...result, outcome: "error", reason: context.error,
        onu: assessObservation(null, input.checkedAt, freshness, context.error),
        upstreamQuality: context.error };
    }
    const { scenario, network } = context.data;
    if (!scenario || !network) return { ...result, outcome: "not_found",
      reason: !scenario ? "scenario_not_found" : "not_found" };
    result.mapping = network.mapping;
    const serviceIds = [...new Set([input.serviceId, ...network.members.map(m => m.serviceId)])];
    const [onuRead, upstreamRead] = await Promise.all([
      this.read(async signal => {
        await this.simulate(scenario.onuFailure, signal);
        return this.store.getOnu(this.scenarioId, serviceIds, signal);
      }, deadline),
      this.read(async signal => {
        await this.simulate(scenario.upstreamFailure, signal);
        return this.store.getUpstream(this.scenarioId, input.serviceId, signal);
      }, deadline),
    ]);
    const observations = new Map((onuRead.data ?? []).map(row => [row.serviceId, row]));
    result.onu = assessObservation(observations.get(input.serviceId) ?? null,
      input.checkedAt, freshness, onuRead.error ?? undefined);
    if (network.mapping) {
      const members = network.members.map(m => ({
        serviceId: m.serviceId, mappingVersion: m.version,
        observation: assessObservation(observations.get(m.serviceId) ?? null,
          input.checkedAt, freshness, onuRead.error ?? undefined),
      }));
      const odpServices = new Set(network.members.filter(m => m.odpId === network.mapping!.odpId).map(m => m.serviceId));
      result.areas = [
        assessArea("ODP", network.mapping.odpId, members.filter(m => odpServices.has(m.serviceId))),
        assessArea("ODC", network.mapping.odcId, members),
      ];
      const indicated = result.areas.find(area => area.state === "indicated");
      if (indicated) result.indicatedArea = { scope: indicated.scope, scopeId: indicated.scopeId };
    }
    result.upstream = (upstreamRead.data ?? []).map(row => ({
      linkId: row.linkId, mappingVersion: row.mappingVersion,
      observation: assessObservation(row, input.checkedAt, freshness,
        !network.mapping || row.mappingVersion !== network.mapping.version ? "mapping_invalid" : undefined),
    }));
    result.upstreamQuality = upstreamRead.error ??
      (result.upstream.some(row => row.observation.quality === "mapping_invalid") ? "mapping_invalid" :
        result.upstream.length ? "ok" : "not_found");
    // Partial evidence remains usable; callers must inspect each component's quality.
    if (onuRead.error && upstreamRead.error) {
      result.outcome = "error";
      result.reason = onuRead.error === "timeout" || upstreamRead.error === "timeout" ? "timeout" : "provider_error";
    }
    return result;
  }
}
