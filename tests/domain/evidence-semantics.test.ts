import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProofAge,
  getQualityBadge,
  getOnuStatusBadge,
  getUpstreamStatusBadge,
  getAreaStateBadge,
  getEffectiveQuality,
  formatAreaRatioString,
  getTriageReasonExplanation,
  getAreaIndicationSummaryBadge,
  DEFAULT_EVIDENCE_FRESHNESS_MS,
} from "../../lib/domain/evidence-semantics";

test("Evidence Semantics: computeProofAge calculates accurate age and stale thresholds", () => {
  assert.equal(DEFAULT_EVIDENCE_FRESHNESS_MS, 5 * 60 * 1000);
  const baseTime = 1729000000000; // arbitrary fixed epoch

  // Valid 2 minutes ago -> fresh
  const twoMinAgo = new Date(baseTime - 2 * 60 * 1000).toISOString();
  const proof2m = computeProofAge(twoMinAgo, baseTime);
  assert.ok(proof2m);
  assert.equal(proof2m.ageMinutes, 2);
  assert.equal(proof2m.isStaleNow, false);
  assert.equal(proof2m.ageLabel, "2 menit lalu");

  // Valid 6 minutes ago -> stale
  const sixMinAgo = new Date(baseTime - 6 * 60 * 1000).toISOString();
  const proof6m = computeProofAge(sixMinAgo, baseTime);
  assert.ok(proof6m);
  assert.equal(proof6m.ageMinutes, 6);
  assert.equal(proof6m.isStaleNow, true);
  assert.equal(proof6m.ageLabel, "6 menit lalu");

  // 30 seconds ago -> less than 1 min
  const thirtySecAgo = new Date(baseTime - 30 * 1000).toISOString();
  const proof30s = computeProofAge(thirtySecAgo, baseTime);
  assert.ok(proof30s);
  assert.equal(proof30s.isStaleNow, false);
  assert.equal(proof30s.ageLabel, "kurang dari 1 menit lalu");

  // Null, invalid, or future timestamps return null
  assert.equal(computeProofAge(null, baseTime), null);
  assert.equal(computeProofAge("not-a-date", baseTime), null);
  assert.equal(computeProofAge(new Date(baseTime + 10000).toISOString(), baseTime), null);
});

test("Evidence Semantics: getQualityBadge maps authoritative qualities", () => {
  const fresh = getQualityBadge("fresh");
  assert.equal(fresh.label, "Data Baru (Fresh)");
  assert.equal(fresh.badgeType, "success");

  const stale = getQualityBadge("stale");
  assert.equal(stale.label, "Data Basi (Stale)");
  assert.equal(stale.badgeType, "warning");

  const timeout = getQualityBadge("timeout");
  assert.equal(timeout.label, "Batas Waktu Habis");
  assert.equal(timeout.badgeType, "danger");

  const providerError = getQualityBadge("provider_error");
  assert.equal(providerError.label, "Gangguan Sistem Monitor");
  assert.equal(providerError.badgeType, "danger");

  const mappingInvalid = getQualityBadge("mapping_invalid");
  assert.equal(mappingInvalid.label, "Pemetaan Tidak Valid");
  assert.equal(mappingInvalid.badgeType, "warning");

  const unknown = getQualityBadge("unknown");
  assert.equal(unknown.label, "Belum Diketahui");

  const notFound = getQualityBadge("not_found");
  assert.equal(notFound.label, "Data Tidak Ditemukan");

  const uninspected = getQualityBadge("uninspected");
  assert.equal(uninspected.label, "Belum Diperiksa");
});

test("Evidence Semantics: getOnuStatusBadge strictly separates online from internet quality and LOS from cable cuts", () => {
  // Fresh Online
  const online = getOnuStatusBadge("online", "fresh");
  assert.equal(online.label, "Perangkat Online");
  assert.equal(online.badgeType, "success");
  assert.ok(online.semanticNote.includes("bukan bukti koneksi internet atau Wi-Fi normal"));

  // Fresh LOS
  const los = getOnuStatusBadge("LOS", "fresh");
  assert.equal(los.label, "Sinyal Hilang (LOS)");
  assert.equal(los.badgeType, "danger");
  assert.ok(los.semanticNote.includes("bukan bukti kabel fisik tertentu putus"));

  // Stale quality degrades reported status
  const staleOnline = getOnuStatusBadge("online", "stale");
  assert.equal(staleOnline.label, "Status Belum Pasti (Data Basi)");
  assert.equal(staleOnline.badgeType, "warning");

  // Dynamic isStaleNow downgrades reported status even if raw quality was fresh
  const dynamicStaleOnline = getOnuStatusBadge("online", "fresh", true);
  assert.equal(dynamicStaleOnline.label, "Status Belum Pasti (Data Basi)");
  assert.equal(dynamicStaleOnline.badgeType, "warning");
  assert.ok(dynamicStaleOnline.semanticNote.includes("telah kedaluwarsa (>5 menit)"));

  const errorLos = getOnuStatusBadge("LOS", "provider_error");
  assert.equal(errorLos.label, "Status Belum Pasti");
  assert.equal(errorLos.badgeType, "warning");
});

test("Evidence Semantics: getUpstreamStatusBadge and ONU status remain two distinct facts", () => {
  const up = getUpstreamStatusBadge("up", "fresh");
  assert.equal(up.label, "Tautan Upstream Normal");
  assert.equal(up.badgeType, "success");

  const down = getUpstreamStatusBadge("down", "fresh");
  assert.equal(down.label, "Tautan Upstream Gangguan");
  assert.equal(down.badgeType, "danger");

  // Dynamic isStaleNow downgrades upstream status
  const staleUp = getUpstreamStatusBadge("up", "fresh", true);
  assert.equal(staleUp.label, "Status Tautan Tidak Pasti (Data Basi)");
  assert.equal(staleUp.badgeType, "warning");

  // An online ONU co-existing with Upstream Down must be represented as two different facts
  const onuOnline = getOnuStatusBadge("online", "fresh");
  const upstreamDown = getUpstreamStatusBadge("down", "fresh");

  assert.notEqual(onuOnline.label, upstreamDown.label);
  assert.equal(onuOnline.badgeType, "success");
  assert.equal(upstreamDown.badgeType, "danger");
});

test("Evidence Semantics: getAreaStateBadge honestly maps area states without false normals", () => {
  // Indicated fresh
  const ind = getAreaStateBadge("indicated", false);
  assert.equal(ind.label, "Indikasi Gangguan Area");
  assert.equal(ind.badgeType, "danger");

  // Indicated stale
  const indStale = getAreaStateBadge("indicated", true);
  assert.equal(indStale.label, "Indikasi Gangguan Area (Data Basi)");
  assert.equal(indStale.badgeType, "warning");

  // No indication fresh: NOT a guarantee of normal network
  const noInd = getAreaStateBadge("no_indication", false);
  assert.equal(noInd.label, "Tidak Memenuhi Indikasi Area");
  assert.equal(noInd.badgeType, "neutral");
  assert.ok(noInd.semanticNote.includes("Bukan jaminan jaringan normal"));

  // No indication stale
  const noIndStale = getAreaStateBadge("no_indication", true);
  assert.equal(noIndStale.label, "Tidak Memenuhi Indikasi Area (Data Basi)");
  assert.equal(noIndStale.badgeType, "warning");

  // Unknown state: NEVER "NORMAL", must be "Belum Dapat Ditentukan"
  const unk = getAreaStateBadge("unknown", false);
  assert.equal(unk.label, "Belum Dapat Ditentukan");
  assert.equal(unk.badgeType, "warning");
  assert.ok(unk.semanticNote.includes("Bukan status normal"));

  // Null or unexpected state
  const fallback = getAreaStateBadge(null);
  assert.equal(fallback.label, "Belum Dapat Ditentukan");
  assert.equal(fallback.badgeType, "warning");
});

test("Evidence Semantics: formatAreaRatioString outputs exact denominator and coverage", () => {
  // 4 LOS out of 8 valid out of 10 total (80% coverage)
  const ratio8 = formatAreaRatioString(4, 8, 10, 0.8);
  assert.equal(ratio8, "4 LOS / 8 valid / 10 total (80% cakupan)");

  // 4 LOS out of 6 valid out of 10 total (60% coverage)
  const ratio6 = formatAreaRatioString(4, 6, 10, 0.6);
  assert.equal(ratio6, "4 LOS / 6 valid / 10 total (60% cakupan)");

  // Verify they are distinct strings
  assert.notEqual(ratio8, ratio6);
});

test("Evidence Semantics: getTriageReasonExplanation provides meaningful operational translations", () => {
  const general = getTriageReasonExplanation("general_active");
  assert.equal(general.title, "Incident Umum Aktif (Override)");

  const manualArea = getTriageReasonExplanation("manual_area_match");
  assert.equal(manualArea.title, "Incident Area Manual Cocok");

  const upstream = getTriageReasonExplanation("upstream_down");
  assert.equal(upstream.title, "Tautan Upstream Down");

  const losArea = getTriageReasonExplanation("los_area");
  assert.equal(losArea.title, "Indikasi Gangguan Area (LOS Area)");

  const losIndiv = getTriageReasonExplanation("los_individual");
  assert.equal(losIndiv.title, "Sinyal Hilang Individual (LOS)");

  const online = getTriageReasonExplanation("online");
  assert.equal(online.title, "Perangkat Online (Pemeriksaan Lanjutan)");

  const unres = getTriageReasonExplanation("identity_unresolved");
  assert.equal(unres.title, "Identitas Belum Terselesaikan");
});

test("Evidence Semantics: getAreaIndicationSummaryBadge handles stale, indicated, low coverage, and valid no-indication", () => {
  // 1. Any stale area forces Stale warning
  const withStale = getAreaIndicationSummaryBadge([
    { state: "indicated", isStale: true, coverage: 0.9 },
    { state: "no_indication", isStale: false, coverage: 0.9 },
  ]);
  assert.equal(withStale.label, "Status Belum Pasti (Data Basi)");
  assert.equal(withStale.badgeType, "warning");

  // 2. Fresh indicated area yields Indicated
  const withIndicated = getAreaIndicationSummaryBadge([
    { state: "indicated", isStale: false, coverage: 0.9 },
    { state: "no_indication", isStale: false, coverage: 0.85 },
  ]);
  assert.equal(withIndicated.label, "Terindikasi Gangguan Area");
  assert.equal(withIndicated.badgeType, "danger");

  // 3. Unknown or coverage < 80% yields insufficient coverage warning
  const withLowCoverage = getAreaIndicationSummaryBadge([
    { state: "no_indication", isStale: false, coverage: 0.75 },
  ]);
  assert.equal(withLowCoverage.label, "Belum Dapat Ditentukan (Cakupan < 80%)");
  assert.equal(withLowCoverage.badgeType, "warning");

  const withUnknownState = getAreaIndicationSummaryBadge([
    { state: "unknown", isStale: false, coverage: 0.85 },
  ]);
  assert.equal(withUnknownState.label, "Belum Dapat Ditentukan (Cakupan < 80%)");
  assert.equal(withUnknownState.badgeType, "warning");

  // 4. Sufficient coverage (>= 80%) and no_indication yields evaluated neutral badge
  const validNoIndication = getAreaIndicationSummaryBadge([
    { state: "no_indication", isStale: false, coverage: 0.85 },
    { state: "no_indication", isStale: false, coverage: 1.0 },
  ]);
  assert.equal(validNoIndication.label, "Tidak Memenuhi Indikasi Area");
  assert.equal(validNoIndication.badgeType, "neutral");

  // 5. Empty areas
  const empty = getAreaIndicationSummaryBadge([]);
  assert.equal(empty.label, "Belum Dapat Ditentukan");
  assert.equal(empty.badgeType, "neutral");
});

test("Evidence Semantics: Independent freshness combos between ONU and Upstream", () => {
  // Scenario A: Fresh ONU, Stale Upstream
  const onuFresh = getOnuStatusBadge("online", "fresh", false);
  const upstreamStale = getUpstreamStatusBadge("up", "fresh", true);
  assert.equal(onuFresh.label, "Perangkat Online");
  assert.equal(onuFresh.badgeType, "success");
  assert.equal(upstreamStale.label, "Status Tautan Tidak Pasti (Data Basi)");
  assert.equal(upstreamStale.badgeType, "warning");

  // Scenario B: Stale ONU, Fresh Upstream
  const onuStale = getOnuStatusBadge("online", "fresh", true);
  const upstreamFresh = getUpstreamStatusBadge("up", "fresh", false);
  assert.equal(onuStale.label, "Status Belum Pasti (Data Basi)");
  assert.equal(onuStale.badgeType, "warning");
  assert.equal(upstreamFresh.label, "Tautan Upstream Normal");
  assert.equal(upstreamFresh.badgeType, "success");

  // Scenario C: Both Stale
  const onuBothStale = getOnuStatusBadge("LOS", "fresh", true);
  const upstreamBothStale = getUpstreamStatusBadge("down", "fresh", true);
  assert.equal(onuBothStale.label, "Status Belum Pasti (Data Basi)");
  assert.equal(upstreamBothStale.label, "Status Tautan Tidak Pasti (Data Basi)");
});

test("Evidence Semantics: Staggered area member timestamps derive conservative freshness and trigger staleness downgrade", () => {
  const baseTime = 1729000000000; // arbitrary fixed epoch
  const member1FreshTime = new Date(baseTime - 2 * 60 * 1000).toISOString(); // 2 min ago
  const member2StaleTime = new Date(baseTime - 6 * 60 * 1000).toISOString(); // 6 min ago

  // Conservative oldest member timestamp rule:
  const timestamps = [member1FreshTime, member2StaleTime];
  const conservativeOldestTimestamp = timestamps.sort()[0];
  assert.equal(conservativeOldestTimestamp, member2StaleTime);

  // Evaluating proof age with the oldest member timestamp
  const derivedAreaAge = computeProofAge(conservativeOldestTimestamp, baseTime);
  assert.ok(derivedAreaAge);
  assert.equal(derivedAreaAge.ageMinutes, 6);
  assert.equal(derivedAreaAge.isStaleNow, true);
  assert.equal(derivedAreaAge.ageLabel, "6 menit lalu");

  // Effective quality downgrades from fresh to stale
  const effectiveAreaQuality = getEffectiveQuality("fresh", derivedAreaAge.isStaleNow);
  assert.equal(effectiveAreaQuality, "stale");

  const qualityBadge = getQualityBadge(effectiveAreaQuality);
  assert.equal(qualityBadge.label, "Data Basi (Stale)");
  assert.equal(qualityBadge.badgeType, "warning");

  // Area state badge downgrades to stale warning
  const areaBadgeIndicated = getAreaStateBadge("indicated", derivedAreaAge.isStaleNow);
  assert.equal(areaBadgeIndicated.label, "Indikasi Gangguan Area (Data Basi)");
  assert.equal(areaBadgeIndicated.badgeType, "warning");

  const areaBadgeNoIndication = getAreaStateBadge("no_indication", derivedAreaAge.isStaleNow);
  assert.equal(areaBadgeNoIndication.label, "Tidak Memenuhi Indikasi Area (Data Basi)");
  assert.equal(areaBadgeNoIndication.badgeType, "warning");

  // Area summary badge downgrades to stale warning
  const summaryBadge = getAreaIndicationSummaryBadge([
    { state: "indicated", isStale: derivedAreaAge.isStaleNow, coverage: 0.9 },
  ]);
  assert.equal(summaryBadge.label, "Status Belum Pasti (Data Basi)");
  assert.equal(summaryBadge.badgeType, "warning");
});


