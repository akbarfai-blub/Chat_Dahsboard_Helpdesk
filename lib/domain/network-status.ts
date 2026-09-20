export const DEFAULT_FRESHNESS_MS = 5 * 60 * 1000;
export const NETWORK_TIMEOUT_MS = 2000;
export const AREA_THRESHOLD_VERSION = "mock-3-50-80-v1";
export type Quality =
  | "fresh"
  | "unknown"
  | "stale"
  | "not_found"
  | "invalid_timestamp"
  | "timeout"
  | "provider_error"
  | "mapping_invalid";
export type OnuStatus = "LOS" | "online" | "unknown";
export type UpstreamStatus = "up" | "down" | "unknown";
export type RawObservation<T extends string> = {
  status: T;
  observedAt: string | null;
  eventId: string | null;
};
export type Observation<T extends string> = {
  status: T | "unknown";
  reportedStatus: T | null;
  quality: Quality;
  observedAt: string | null;
  eventId: string | null;
  source: "MOCK";
};
export type Mapping = {
  serviceId: string;
  version: number;
  odpId: string;
  odpCode: string;
  odcId: string;
  odcCode: string;
  source: string;
  validFrom: string;
};
export type AreaMember = {
  serviceId: string;
  mappingVersion: number;
  observation: Observation<OnuStatus>;
};
export type AreaSnapshot = {
  scope: "ODP" | "ODC";
  scopeId: string;
  state: "indicated" | "no_indication" | "unknown";
  total: number;
  valid: number;
  los: number;
  coverage: number;
  losRatio: number;
  thresholdVersion: string;
  members: AreaMember[];
};

// Pure: clock, threshold and observations are explicit inputs.
export function assessObservation<T extends string>(
  raw: RawObservation<T> | null,
  checkedAt: string,
  freshnessMs = DEFAULT_FRESHNESS_MS,
  failure?: "timeout" | "provider_error" | "mapping_invalid",
): Observation<T> {
  let quality: Quality = failure ?? "not_found";
  if (!failure && raw) {
    const observed = raw.observedAt === null ? NaN : Date.parse(raw.observedAt);
    const checked = Date.parse(checkedAt);
    if (
      !Number.isFinite(observed) ||
      !Number.isFinite(checked) ||
      observed > checked ||
      !Number.isFinite(freshnessMs) ||
      freshnessMs < 0
    ) {
      quality = "invalid_timestamp";
    } else if (checked - observed > freshnessMs) quality = "stale";
    else quality = raw.status === "unknown" ? "unknown" : "fresh";
  }
  return {
    status: quality === "fresh" && raw ? raw.status : "unknown",
    reportedStatus: raw?.status ?? null,
    quality,
    observedAt: raw?.observedAt ?? null,
    eventId: raw?.eventId ?? null,
    source: "MOCK",
  };
}

export function assessArea(
  scope: "ODP" | "ODC",
  scopeId: string,
  members: AreaMember[],
): AreaSnapshot {
  const unique = new Map<string, AreaMember>();
  for (const member of members) {
    const previous = unique.get(member.serviceId);
    // Duplicate membership never increases coverage; conflicting duplicates fail closed.
    if (previous && JSON.stringify(previous) !== JSON.stringify(member)) {
      unique.set(member.serviceId, {
        ...previous,
        observation: {
          ...previous.observation,
          status: "unknown",
          quality: "mapping_invalid",
        },
      });
    } else if (!previous) unique.set(member.serviceId, member);
  }
  const rows = [...unique.values()];
  const total = rows.length;
  const valid = rows.filter(
    (m) =>
      m.observation.quality === "fresh" &&
      (m.observation.status === "online" || m.observation.status === "LOS"),
  ).length;
  const los = rows.filter(
    (m) => m.observation.quality === "fresh" && m.observation.status === "LOS",
  ).length;
  const coverage = total ? valid / total : 0;
  const losRatio = valid ? los / valid : 0;
  return {
    scope,
    scopeId,
    total,
    valid,
    los,
    coverage,
    losRatio,
    state:
      !total || coverage < 0.8
        ? "unknown"
        : los >= 3 && losRatio >= 0.5
          ? "indicated"
          : "no_indication",
    thresholdVersion: AREA_THRESHOLD_VERSION,
    members: rows,
  };
}
