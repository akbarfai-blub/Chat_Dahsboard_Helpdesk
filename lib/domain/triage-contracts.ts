import type { MessageClassification } from "./message-classification";
import type { IdentityResolution } from "./sender-identity";
import type { AreaSnapshot, Mapping, Observation, OnuStatus, UpstreamStatus } from "./network-status";

export type TemplateKey = "MASS_GENERAL" | "MASS_AREA" | "NETWORK_DISRUPTION" |
  "LOS_AREA" | "LOS_INDIVIDUAL" | "ONLINE_CHECK" | "GENERIC";
export type AutomationMode = "SHADOW" | "LOS_AND_GENERIC" | "FULL";

// Domain-owned structural contract: NetworkCheckResult satisfies this without vendor imports.
export type TriageNetworkEvidence = {
  customerId: string; serviceId: string; checkedAt: string;
  mapping: Mapping | null; onu: Observation<OnuStatus>; areas: AreaSnapshot[];
  upstream: { linkId: string; mappingVersion: number; observation: Observation<UpstreamStatus> }[];
};
export type ManualIncidentSnapshot = {
  id: string; version: number; status: "ACTIVE" | "RESOLVED" | "CLOSED";
  type: "GENERAL" | "AREA_SPECIFIC"; odpIds: string[]; odcIds: string[];
};
export type TriageInput = {
  evaluatedAt: string;
  classification: MessageClassification | null;
  identity: IdentityResolution | null;
  network: TriageNetworkEvidence | null;
  manualIncidents?: readonly ManualIncidentSnapshot[];
  mode?: AutomationMode; // Absent mode defaults to SHADOW.
  emergencyStop?: boolean;
};
export type DecisionReason = "general_active" | "manual_area_match" | "upstream_down" |
  "los_area" | "los_individual" | "online" | "identity_unresolved" |
  "network_unavailable" | "network_mismatch" | "network_check_invalid" | "onu_unusable" |
  "non_connection_message" | "missing_classification" | "invalid_evaluation_time" |
  "conflicting_manual_incidents" | "invalid_manual_incident" | "invalid_mode";
export type EvidenceReference =
  | { kind: "incident"; id: string; version: number }
  | { kind: "mapping"; odpId: string; odcId: string; version: number; checkedAt: string }
  | { kind: "upstream"; linkId: string; eventId: string; observedAt: string; mappingVersion: number }
  | { kind: "onu"; status: "LOS" | "online"; observedAt: string; eventId: string | null }
  | { kind: "area"; scope: "ODP" | "ODC"; scopeId: string; total: number; valid: number;
      los: number; coverage: number; losRatio: number; thresholdVersion: string; eventId: string | null };
export type TriageDecision = {
  ruleVersion: string; evaluatedAt: string; outcome: "candidate" | "review";
  reason: DecisionReason;
  candidateTemplateKey: TemplateKey | null;
  effectiveTemplateKey: TemplateKey | null;
  incidentId: string | null; eventIds: string[];
  evidence: EvidenceReference[];
  notes: string[]; // Fixed codes, never raw provider messages.
  automation: {
    mode: AutomationMode | null;
    disposition: "blocked" | "pending_delivery_checks" | "no_candidate";
    blockedReasons: ("shadow_mode" | "emergency_stop" | "invalid_mode")[];
  };
  // Even FULL is only a candidate; no authorization, claim, handoff or delivery is performed here.
  dispatchAuthorized: false;
};
