import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage } from "../../lib/domain/message-classification";
import { IDENTITY_RULE_VERSION, manualIdentity } from "../../lib/domain/sender-identity";
import { assessArea, assessObservation, AREA_THRESHOLD_VERSION } from "../../lib/domain/network-status";
import type { OnuStatus } from "../../lib/domain/network-status";
import { decideTriage, MAPPING_MAX_AGE_MS } from "../../lib/domain/triage-decision";
import type { AutomationMode, ManualIncidentSnapshot, TriageInput, TriageNetworkEvidence } from "../../lib/domain/triage-contracts";

const now = "2026-09-21T10:00:00.000Z";
const observedAt = "2026-09-21T09:59:00.000Z";
function network(status: OnuStatus = "online"): TriageNetworkEvidence {
  return {
    customerId: "customer", serviceId: "service", checkedAt: now,
    mapping: { serviceId: "service", version: 1, odpId: "odp", odpCode: "ODP",
      odcId: "odc", odcCode: "ODC", source: "MOCK", validFrom: "2026-09-01T00:00:00Z" },
    onu: assessObservation({ status, observedAt, eventId: status === "LOS" ? "event-los" : null }, now),
    areas: [],
    upstream: [{ linkId: "uplink", mappingVersion: 1,
      observation: assessObservation({ status: "up" as const, observedAt, eventId: null }, now) }],
  };
}
function input(status: OnuStatus = "online"): TriageInput {
  return {
    evaluatedAt: now, mode: "FULL", classification: classifyMessage("wifi mati"),
    identity: { outcome: "resolved", ruleVersion: IDENTITY_RULE_VERSION, reason: "verified_single_service",
      identityId: "identity", customerId: "customer", serviceId: "service" },
    network: network(status),
  };
}
function incident(type: "GENERAL" | "AREA_SPECIFIC" = "GENERAL"): ManualIncidentSnapshot {
  return { id: "incident", version: 2, status: "ACTIVE", type, odpIds: ["odp"], odcIds: [] };
}
function down(value: TriageInput) {
  value.network!.upstream[0].observation = assessObservation({ status: "down", observedAt, eventId: "event-upstream" }, now);
  return value;
}
function area(value: TriageInput, statuses: OnuStatus[] = ["LOS","LOS","LOS","LOS","online","online","online","online","unknown","unknown"]) {
  const members = statuses.map((status,n) => ({
    serviceId: n ? "neighbor-"+n : "service", mappingVersion: 1,
    observation: assessObservation({ status, observedAt, eventId: status === "LOS" ? "event-los" : null }, now),
  }));
  value.network!.onu = members[0].observation;
  value.network!.areas = [assessArea("ODP","odp",members),assessArea("ODC","odc",members)];
  return value;
}

test("GENERAL wins without accessing classification, identity or network", () => {
  const value: TriageInput = { evaluatedAt:now, manualIncidents:[incident()], classification:null, identity:null, network:null };
  for (const property of ["classification","identity","network"]) {
    Object.defineProperty(value,property,{get(){throw new Error("unnecessary lookup");}});
  }
  const result = decideTriage(value);
  assert.equal(result.candidateTemplateKey,"MASS_GENERAL");
  assert.equal(result.incidentId,"incident");
  assert.equal(result.automation.disposition,"blocked");
  assert.deepEqual(result.automation.blockedReasons,["shadow_mode"]);
});
test("GENERAL overrides other messages and an unresolved sender; inactive GENERAL does not", () => {
  const value = input(); value.identity = manualIdentity("unverified");
  value.classification = classifyMessage("berapa tagihan saya?");
  value.manualIncidents = [incident()];
  assert.equal(decideTriage(value).candidateTemplateKey,"MASS_GENERAL");
  value.manualIncidents[0].status = "RESOLVED";
  assert.equal(decideTriage(value).candidateTemplateKey,null);
});
test("AREA matching either ODP or ODC wins over automatic upstream and ONU evidence", () => {
  for(const byOdc of [false,true]){
    const value = down(area(input("LOS")));
    const manual = incident("AREA_SPECIFIC");
    if(byOdc){manual.odpIds=[];manual.odcIds=["odc"];}
    value.manualIncidents=[manual];
    const result=decideTriage(value);
    assert.equal(result.candidateTemplateKey,"MASS_AREA"); assert.equal(result.incidentId,"incident");
    assert.deepEqual(result.eventIds,[]);
  }
});
test("AREA never overrides non-connection/review messages", () => {
  for(const text of ["terima kasih","error"]){
    const value=input();value.classification=classifyMessage(text);value.manualIncidents=[incident("AREA_SPECIFIC")];
    assert.equal(decideTriage(value).reason,"non_connection_message");
  }
});
test("unverified identity only receives GENERIC despite matching area and network evidence", () => {
  const value=down(area(input("LOS"))); value.identity=manualIdentity("unverified","identity");
  value.manualIncidents=[incident("AREA_SPECIFIC")];
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"GENERIC");assert.deepEqual(result.evidence,[]);
});
test("AREA no-match falls through to independent automatic evidence", () => {
  const value=down(input());value.manualIncidents=[{...incident("AREA_SPECIFIC"),odpIds:["other"]}];
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"NETWORK_DISRUPTION");
  assert(result.notes.includes("manual_area_no_valid_match"));
  assert.equal(result.incidentId,null);
});
test("upstream down precedes area/individual LOS and remains usable with unknown or stale ONU", () => {
  for(const status of ["LOS","online","unknown"] as const){
    const value=down(input(status));
    assert.equal(decideTriage(value).candidateTemplateKey,"NETWORK_DISRUPTION");
  }
  const value=down(input("LOS"));
  value.network!.onu=assessObservation({status:"LOS",observedAt:"2026-09-21T09:00:00Z",eventId:"old"},now);
  assert.equal(decideTriage(value).candidateTemplateKey,"NETWORK_DISRUPTION");
});
test("failed upstream source cannot invalidate usable ONU", () => {
  const value=down(input("LOS"));
  value.network!.upstream[0].observation.quality="provider_error";
  assert.equal(decideTriage(value).candidateTemplateKey,"LOS_INDIVIDUAL");
});
test("upstream impact requires current mapping version, event ID and a valid observation", () => {
  for(const change of ["version","event","future","stale","quality"]){
    const value=down(input());
    const link=value.network!.upstream[0];
    if(change==="version")link.mappingVersion=2;
    if(change==="event")link.observation.eventId=null;
    if(change==="future")link.observation.observedAt="2026-09-21T10:01:00Z";
    if(change==="stale")link.observation.observedAt="2026-09-21T09:00:00Z";
    if(change==="quality")link.observation.quality="mapping_invalid";
    assert.equal(decideTriage(value).candidateTemplateKey,"ONLINE_CHECK",change);
  }
});
test("missing or foreign topology invalidates upstream/area but does not invalidate independent LOS", () => {
  for(const change of ["missing","service","future"]){
    const value=down(area(input("LOS")));
    if(change==="missing")value.network!.mapping=null;
    if(change==="service")value.network!.mapping!.serviceId="other";
    if(change==="future")value.network!.mapping!.validFrom="2026-09-21T11:00:00Z";
    assert.equal(decideTriage(value).candidateTemplateKey,"LOS_INDIVIDUAL",change);
  }
});
test("LOS area accepts 4/8/10 boundary and prefers ODP regardless of input order", () => {
  const value=area(input("LOS"));value.network!.areas.reverse();
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"LOS_AREA");
  const reference=result.evidence.find(row=>row.kind==="area");
  assert(reference?.kind==="area");
  assert.equal(reference.scope,"ODP");assert.equal(reference.coverage,0.8);assert.equal(reference.losRatio,0.5);
  assert.deepEqual(result.eventIds,["event-los"]);
});
test("ODC may indicate when the customer's ODP fails the minimum LOS count", () => {
  const value=area(input("LOS"));
  const members=value.network!.areas[0].members;
  value.network!.areas=[assessArea("ODP","odp",members.slice(0,2)),assessArea("ODC","odc",members)];
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"LOS_AREA");
  assert.equal(result.evidence.find(row=>row.kind==="area")?.scope,"ODC");
});
test("low coverage or too few LOS falls back to individual LOS", () => {
  for(const statuses of [
    ["LOS","LOS","LOS","LOS","online","online","unknown","unknown","unknown","unknown"],
    ["LOS","LOS","online","online","online","online","online","online","online","online"],
  ] as OnuStatus[][]){
    assert.equal(decideTriage(area(input("LOS"),statuses)).candidateTemplateKey,"LOS_INDIVIDUAL");
  }
});
test("online customer in LOS area stays ONLINE_CHECK unless relevant upstream is down", () => {
  const value=area(input(),["online","LOS","LOS","LOS","LOS","LOS","online","online","online","online"]);
  assert.equal(decideTriage(value).candidateTemplateKey,"ONLINE_CHECK");
  assert.equal(decideTriage(down(value)).candidateTemplateKey,"NETWORK_DISRUPTION");
});
test("area evidence must match scope, completeness, target mapping and threshold version", () => {
  for(const change of ["scope","total","version","threshold","target"]){
    const value=area(input("LOS"));
    value.network!.areas=value.network!.areas.slice(0,1);
    const snapshot=value.network!.areas[0];
    if(change==="scope")snapshot.scopeId="elsewhere";
    if(change==="total")snapshot.total=20;
    if(change==="version")snapshot.members[0].mappingVersion=2;
    if(change==="threshold")snapshot.thresholdVersion="unknown-threshold";
    if(change==="target")snapshot.members[0].serviceId="someone-else";
    assert.equal(decideTriage(value).candidateTemplateKey,"LOS_INDIVIDUAL",change);
  }
});
test("cached aggregates cannot forge LOS area or retain expired member evidence", () => {
  const value=area(input("LOS"),["LOS","online","online","online","online","online","online","online","online","online"]);
  for(const snapshot of value.network!.areas){snapshot.state="indicated";snapshot.los=10;snapshot.losRatio=1;}
  assert.equal(decideTriage(value).candidateTemplateKey,"LOS_INDIVIDUAL");
  const expired=area(input("LOS"));
  for(const snapshot of expired.network!.areas){
    for(const member of snapshot.members.slice(1,4))member.observation.observedAt="2026-09-21T09:00:00Z";
  }
  assert.equal(decideTriage(expired).candidateTemplateKey,"LOS_INDIVIDUAL");
});
test("candidate freshness expires at decision time even if provider previously marked it fresh", () => {
  const value=input("LOS");
  value.network!.onu.observedAt="2026-09-21T09:55:00Z";
  assert.equal(decideTriage(value).candidateTemplateKey,"LOS_INDIVIDUAL");
  value.evaluatedAt="2026-09-21T10:00:00.001Z";
  assert.equal(decideTriage(value).candidateTemplateKey,"GENERIC");
});
test("manual AREA mapping cache is limited to 24 hours", () => {
  const value=input();value.manualIncidents=[incident("AREA_SPECIFIC")];
  value.network!.checkedAt=new Date(Date.parse(now)-MAPPING_MAX_AGE_MS).toISOString();
  assert.equal(decideTriage(value).candidateTemplateKey,"MASS_AREA");
  value.evaluatedAt="2026-09-21T10:00:00.001Z";
  assert.equal(decideTriage(value).candidateTemplateKey,"GENERIC");
});
test("network snapshots cannot be reused for another customer/service or from the future", () => {
  for(const change of ["customer","service","future","invalid"]){
    const value=down(input());
    if(change==="customer")value.network!.customerId="other";
    if(change==="service")value.network!.serviceId="other";
    if(change==="future")value.network!.checkedAt="2026-09-21T11:00:00Z";
    if(change==="invalid")value.network!.checkedAt="bad";
    assert.equal(decideTriage(value).candidateTemplateKey,"GENERIC",change);
  }
});
test("generic distinguishes missing identity, no network and unusable ONU", () => {
  const identity=input();identity.identity=null;
  assert.equal(decideTriage(identity).reason,"identity_unresolved");
  const missing=input();missing.network=null;
  assert.equal(decideTriage(missing).reason,"network_unavailable");
  const unknown=input("unknown");
  assert.equal(decideTriage(unknown).reason,"onu_unusable");
});
test("all unusable ONU qualities produce generic without independent valid evidence", () => {
  for(const quality of ["stale","unknown","not_found","invalid_timestamp","timeout","provider_error","mapping_invalid"] as const){
    const value=input("LOS");value.network!.onu.quality=quality;
    assert.equal(decideTriage(value).candidateTemplateKey,"GENERIC",quality);
  }
});
test("mode changes preserve evidence candidate while applying ONLINE_CHECK downgrade", () => {
  for(const mode of ["SHADOW","LOS_AND_GENERIC","FULL"] as const){
    const value=input();value.mode=mode;
    const result=decideTriage(value);
    assert.equal(result.candidateTemplateKey,"ONLINE_CHECK");
    assert.equal(result.effectiveTemplateKey,mode==="LOS_AND_GENERIC"?"GENERIC":"ONLINE_CHECK");
    assert.equal(result.automation.disposition,mode==="SHADOW"?"blocked":"pending_delivery_checks");
    assert.equal(result.dispatchAuthorized,false);
  }
});
test("LOS_AND_GENERIC keeps outage, LOS and generic candidates; SHADOW blocks every candidate", () => {
  const cases=[input(),down(input()),area(input("LOS")),input("LOS"),input("unknown")];
  const general=input();general.manualIncidents=[incident()];cases.push(general);
  const manualArea=input();manualArea.manualIncidents=[incident("AREA_SPECIFIC")];cases.push(manualArea);
  for(const value of cases){
    value.mode="SHADOW";
    const shadow=decideTriage(value);
    assert.equal(shadow.automation.disposition,"blocked");assert(shadow.candidateTemplateKey);
    value.mode="LOS_AND_GENERIC";
    const live=decideTriage(value);
    if(live.candidateTemplateKey!=="ONLINE_CHECK")assert.equal(live.effectiveTemplateKey,live.candidateTemplateKey);
    assert.equal(live.dispatchAuthorized,false);
  }
});
test("emergency stop preserves diagnostic candidate but blocks automation", () => {
  const value=down(input());value.emergencyStop=true;
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"NETWORK_DISRUPTION");
  assert.equal(result.automation.disposition,"blocked");
  assert.deepEqual(result.automation.blockedReasons,["emergency_stop"]);
});
test("conflicting/invalid active incident snapshots fail closed; inactive incidents are ignored", () => {
  const value=input();value.manualIncidents=[incident(),{...incident("AREA_SPECIFIC"),id:"another"}];
  assert.equal(decideTriage(value).reason,"conflicting_manual_incidents");
  value.manualIncidents=[{...incident(),version:0}];
  assert.equal(decideTriage(value).reason,"invalid_manual_incident");
  value.manualIncidents=[{...incident(),status:"CLOSED"}];
  assert.equal(decideTriage(value).candidateTemplateKey,"ONLINE_CHECK");
});
test("invalid mode/time and missing classification return review", () => {
  const value=input();value.mode="LIVE" as AutomationMode;
  assert.equal(decideTriage(value).reason,"invalid_mode");
  value.mode="FULL";value.evaluatedAt="bad";
  assert.equal(decideTriage(value).reason,"invalid_evaluation_time");
  value.evaluatedAt=now;value.classification=null;
  assert.equal(decideTriage(value).reason,"missing_classification");
});
test("input remains unchanged and decision is deterministic including stable event IDs", () => {
  const value=down(input());
  value.network!.upstream.push({...value.network!.upstream[0],linkId:"another",observation:{...value.network!.upstream[0].observation,eventId:"another-event"}});
  const before=structuredClone(value),first=decideTriage(value),second=decideTriage(value);
  assert.deepEqual(first,second);assert.deepEqual(value,before);
  assert.deepEqual(first.eventIds,["another-event","event-upstream"]);
  assert.equal(first.dispatchAuthorized,false);
});
test("LOS area without a shared event retains the target event without inventing area correlation", () => {
  const value=area(input("LOS"));
  for(const snapshot of value.network!.areas)snapshot.members[1].observation.eventId=null;
  const result=decideTriage(value);
  assert.equal(result.candidateTemplateKey,"LOS_AREA");assert.deepEqual(result.eventIds,["event-los"]);
  assert.equal(result.evidence.find(row=>row.kind==="area")?.eventId,null);
  assert.equal(result.evidence.find(row=>row.kind==="area")?.thresholdVersion,AREA_THRESHOLD_VERSION);
});
