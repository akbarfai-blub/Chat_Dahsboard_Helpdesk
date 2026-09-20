import { assessArea, AREA_THRESHOLD_VERSION, DEFAULT_FRESHNESS_MS } from "./network-status";
import type { AreaSnapshot, Mapping, Observation } from "./network-status";
import type {
  AutomationMode, DecisionReason, EvidenceReference, ManualIncidentSnapshot,
  TemplateKey, TriageDecision, TriageInput, TriageNetworkEvidence,
} from "./triage-contracts";

export const TRIAGE_RULE_VERSION = "triage-priority-v1";
export const MAPPING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function inWindow(timestamp: string | null, now: number, maxAge: number): boolean {
  const observed = timestamp === null ? NaN : Date.parse(timestamp);
  return Number.isFinite(observed) && observed <= now && now - observed <= maxAge;
}

function usable<T extends string>(
  observation: Observation<T>, checkedAt: number, evaluatedAt: number,
): boolean {
  return observation.quality === "fresh" && observation.status !== "unknown" &&
    observation.status === observation.reportedStatus &&
    inWindow(observation.observedAt, evaluatedAt, DEFAULT_FRESHNESS_MS) &&
    Date.parse(observation.observedAt!) <= checkedAt;
}

function validMapping(
  network: TriageNetworkEvidence, evaluatedAt: number,
): Mapping | null {
  const mapping = network.mapping;
  if (!mapping || mapping.serviceId !== network.serviceId ||
      !Number.isInteger(mapping.version) || mapping.version <= 0 ||
      !mapping.odpId.trim() || !mapping.odcId.trim() || !mapping.source.trim() ||
      !inWindow(network.checkedAt, evaluatedAt, MAPPING_MAX_AGE_MS) ||
      !Number.isFinite(Date.parse(mapping.validFrom)) ||
      Date.parse(mapping.validFrom) > Date.parse(network.checkedAt)) return null;
  return mapping;
}

function incidentValid(incident: ManualIncidentSnapshot): boolean {
  return Boolean(incident.id.trim()) && Number.isInteger(incident.version) && incident.version > 0 &&
    (incident.type === "GENERAL" ||
      (incident.type === "AREA_SPECIFIC" && [...incident.odpIds, ...incident.odcIds].some(id => id.trim())));
}

function currentArea(
  area: AreaSnapshot, network: TriageNetworkEvidence, mapping: Mapping, evaluatedAt: number,
): AreaSnapshot | null {
  const expectedId = area.scope === "ODP" ? mapping.odpId : mapping.odcId;
  if (area.scopeId !== expectedId || area.thresholdVersion !== AREA_THRESHOLD_VERSION ||
      !Number.isInteger(area.total) || area.total <= 0 ||
      new Set(area.members.map(member => member.serviceId)).size !== area.total ||
      area.members.some(member => !member.serviceId || !Number.isInteger(member.mappingVersion) || member.mappingVersion <= 0)) return null;
  const target = area.members.filter(member => member.serviceId === network.serviceId);
  if (target.length !== 1 || target[0].mappingVersion !== mapping.version ||
      target[0].observation.status !== network.onu.status ||
      target[0].observation.observedAt !== network.onu.observedAt ||
      !usable(target[0].observation, Date.parse(network.checkedAt), evaluatedAt)) return null;
  const members = area.members.map(member => ({
    ...member,
    observation: usable(member.observation, Date.parse(network.checkedAt), evaluatedAt)
      ? member.observation
      : { ...member.observation, status: "unknown" as const, quality: "unknown" as const },
  }));
  const recomputed = assessArea(area.scope, area.scopeId, members);
  return recomputed.state === "indicated" ? recomputed : null;
}

export function decideTriage(input: TriageInput): TriageDecision {
  const modeValue = input.mode ?? "SHADOW";
  const mode: AutomationMode | null = ["SHADOW", "LOS_AND_GENERIC", "FULL"].includes(modeValue) ? modeValue : null;
  const now = Date.parse(input.evaluatedAt);
  const notes: string[] = [];

  function finish(
    key: TemplateKey | null, reason: DecisionReason,
    evidence: EvidenceReference[] = [], incidentId: string | null = null, eventIds: string[] = [],
  ): TriageDecision {
    const blockedReasons: TriageDecision["automation"]["blockedReasons"] = [];
    if (!mode) blockedReasons.push("invalid_mode");
    if (mode === "SHADOW") blockedReasons.push("shadow_mode");
    if (input.emergencyStop) blockedReasons.push("emergency_stop");
    const effective = key === "ONLINE_CHECK" && mode === "LOS_AND_GENERIC" ? "GENERIC" : key;
    return {
      ruleVersion: TRIAGE_RULE_VERSION, evaluatedAt: input.evaluatedAt,
      outcome: key ? "candidate" : "review", reason,
      candidateTemplateKey: key, effectiveTemplateKey: effective,
      incidentId, eventIds: [...new Set(eventIds.filter(id => id.trim()))].sort(),
      evidence, notes: [...notes],
      automation: {
        mode, blockedReasons,
        disposition: !key ? "no_candidate" : blockedReasons.length ? "blocked" : "pending_delivery_checks",
      },
      dispatchAuthorized: false,
    };
  }

  if (!Number.isFinite(now)) return finish(null, "invalid_evaluation_time");
  if (!mode) return finish(null, "invalid_mode");
  const active = (input.manualIncidents ?? []).filter(incident => incident.status === "ACTIVE");
  if (active.length > 1) return finish(null, "conflicting_manual_incidents");
  const incident = active[0];
  if (incident && !incidentValid(incident)) return finish(null, "invalid_manual_incident");
  // GENERAL is the sole keyword exception and needs no identity/network access.
  if (incident?.type === "GENERAL") {
    return finish("MASS_GENERAL", "general_active",
      [{ kind: "incident", id: incident.id, version: incident.version }], incident.id);
  }

  if (!input.classification) return finish(null, "missing_classification");
  if (input.classification.category !== "connection_complaint") return finish(null, "non_connection_message");
  if (!input.identity || input.identity.outcome !== "resolved") {
    if (input.identity) notes.push("identity_" + input.identity.reason);
    return finish("GENERIC", "identity_unresolved");
  }
  const network = input.network;
  if (!network) return finish("GENERIC", "network_unavailable");
  if (network.customerId !== input.identity.customerId || network.serviceId !== input.identity.serviceId) {
    return finish("GENERIC", "network_mismatch");
  }
  const checked = Date.parse(network.checkedAt);
  if (!Number.isFinite(checked) || checked > now) return finish("GENERIC", "network_check_invalid");
  const mapping = validMapping(network, now);
  const mappingEvidence: EvidenceReference[] = mapping ? [{
    kind: "mapping", odpId: mapping.odpId, odcId: mapping.odcId,
    version: mapping.version, checkedAt: network.checkedAt,
  }] : [];
  if (!mapping) notes.push("mapping_unavailable_or_invalid");
  if (incident?.type === "AREA_SPECIFIC") {
    if (mapping && (incident.odpIds.includes(mapping.odpId) || incident.odcIds.includes(mapping.odcId))) {
      return finish("MASS_AREA", "manual_area_match",
        [{ kind: "incident", id: incident.id, version: incident.version }, ...mappingEvidence], incident.id);
    }
    notes.push("manual_area_no_valid_match");
  }

  const upstream = network.upstream.filter(link => mapping && link.mappingVersion === mapping.version &&
    link.linkId.trim() && link.observation.eventId?.trim() &&
    link.observation.status === "down" && usable(link.observation, checked, now))
    .sort((a, b) => a.linkId < b.linkId ? -1 : a.linkId > b.linkId ? 1 : 0);
  if (upstream.length) {
    const references: EvidenceReference[] = upstream.map(link => ({
      kind: "upstream", linkId: link.linkId, eventId: link.observation.eventId!,
      observedAt: link.observation.observedAt!, mappingVersion: link.mappingVersion,
    }));
    return finish("NETWORK_DISRUPTION", "upstream_down", [...mappingEvidence, ...references],
      null, upstream.map(link => link.observation.eventId!));
  }

  const onu = network.onu;
  if (!usable(onu, checked, now) || (onu.status !== "LOS" && onu.status !== "online")) {
    notes.push("onu_" + (onu.quality === "fresh" ? "expired_or_inconsistent" : onu.quality));
    return finish("GENERIC", "onu_unusable");
  }
  const onuReference: EvidenceReference = {
    kind: "onu", status: onu.status, observedAt: onu.observedAt!, eventId: onu.eventId,
  };
  if (onu.status === "LOS") {
    const areas = mapping ? network.areas
      .filter(area => area.scope === "ODP" || area.scope === "ODC")
      .map(area => currentArea(area, network, mapping, now))
      .filter((area): area is AreaSnapshot => area !== null)
      .sort((a, b) => (a.scope === "ODP" ? 0 : 1) - (b.scope === "ODP" ? 0 : 1)) : [];
    const area = areas[0];
    if (area) {
      const areaReference: EvidenceReference = {
        kind: "area", scope: area.scope, scopeId: area.scopeId, total: area.total,
        valid: area.valid, los: area.los, coverage: area.coverage, losRatio: area.losRatio,
        thresholdVersion: area.thresholdVersion, eventId: null,
      };
      // No synthetic event ID. Only a common, explicit LOS event may label the area.
      const los = area.members.filter(member => member.observation.status === "LOS");
      const common = los.length && los.every(member => member.observation.eventId &&
        member.observation.eventId === onu.eventId) ? onu.eventId : null;
      areaReference.eventId = common;
      return finish("LOS_AREA", "los_area", [...mappingEvidence, onuReference, areaReference],
        null, onu.eventId ? [onu.eventId] : []);
    }
    return finish("LOS_INDIVIDUAL", "los_individual", [onuReference], null, onu.eventId ? [onu.eventId] : []);
  }
  // Neighbor LOS alone does not establish that this online service is affected.
  return finish("ONLINE_CHECK", "online", [onuReference]);
}
