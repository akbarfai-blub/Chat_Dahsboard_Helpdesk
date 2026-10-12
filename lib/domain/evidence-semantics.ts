import type { Quality, OnuStatus, UpstreamStatus } from "./network-status";
import type { DecisionReason } from "./triage-contracts";

export const DEFAULT_EVIDENCE_FRESHNESS_MS = 5 * 60 * 1000; // 5 minutes

export interface FormattedProofAge {
  readonly ageMs: number;
  readonly ageMinutes: number;
  readonly isStaleNow: boolean;
  readonly ageLabel: string;
}

/**
 * Computes dynamic proof age relative to the current evaluation moment.
 * Even if proof was fresh at checkedAt, if 5 minutes have elapsed since observedAt,
 * the proof is now stale and must be displayed with an honest warning label.
 */
export function computeProofAge(
  observedAt: string | null,
  nowMs: number = Date.now()
): FormattedProofAge | null {
  if (!observedAt) return null;
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime) || observedTime > nowMs) {
    return null;
  }
  const ageMs = Math.max(0, nowMs - observedTime);
  const ageMinutes = Math.floor(ageMs / 60000);
  const isStaleNow = ageMs > DEFAULT_EVIDENCE_FRESHNESS_MS;

  let ageLabel: string;
  if (ageMinutes < 1) {
    ageLabel = "kurang dari 1 menit lalu";
  } else if (ageMinutes === 1) {
    ageLabel = "1 menit lalu";
  } else {
    ageLabel = `${ageMinutes} menit lalu`;
  }

  return {
    ageMs,
    ageMinutes,
    isStaleNow,
    ageLabel,
  };
}

/**
 * Resolves the effective quality considering dynamic proof age staleness.
 * If dynamic evaluation marks evidence as stale, raw 'fresh' quality is downgraded to 'stale'.
 * Invalid, unknown, or error qualities are preserved.
 */
export function getEffectiveQuality(
  rawQuality: Quality | string | undefined | null,
  isStaleNow: boolean
): Quality | string {
  if (isStaleNow) {
    return "stale";
  }
  if (!rawQuality) {
    return "unknown";
  }
  return rawQuality;
}

/**
 * Maps raw or evaluated quality to an authoritative Indonesian label and badge severity.
 */
export function getQualityBadge(quality: Quality | string): {
  readonly label: string;
  readonly badgeType: "success" | "warning" | "danger" | "neutral" | "info";
  readonly description: string;
} {
  switch (quality) {
    case "fresh":
      return {
        label: "Data Baru (Fresh)",
        badgeType: "success",
        description: "Bukti terverifikasi dalam batas usia 5 menit.",
      };
    case "stale":
      return {
        label: "Data Basi (Stale)",
        badgeType: "warning",
        description: "Observasi berusia lebih dari 5 menit; butuh verifikasi ulang.",
      };
    case "unknown":
      return {
        label: "Belum Diketahui",
        badgeType: "warning",
        description: "Status perangkat tidak dapat dipastikan dari data pengawasan.",
      };
    case "invalid_timestamp":
      return {
        label: "Waktu Tidak Valid",
        badgeType: "warning",
        description: "Format timestamp observasi tidak valid atau berada di masa depan.",
      };
    case "timeout":
      return {
        label: "Batas Waktu Habis",
        badgeType: "danger",
        description: "Pemeriksaan melampaui batas waktu 2 detik (bukan bukti jaringan down).",
      };
    case "provider_error":
      return {
        label: "Gangguan Sistem Monitor",
        badgeType: "danger",
        description: "Terjadi kesalahan internal pada provider (bukan bukti jaringan down).",
      };
    case "mapping_invalid":
      return {
        label: "Pemetaan Tidak Valid",
        badgeType: "warning",
        description: "Versi topologi atau keanggotaan wilayah tidak cocok dengan baseline.",
      };
    case "not_found":
      return {
        label: "Data Tidak Ditemukan",
        badgeType: "neutral",
        description: "Tidak ditemukan rekaman observasi untuk layanan ini.",
      };
    default:
      return {
        label: "Belum Diperiksa",
        badgeType: "neutral",
        description: "Belum ada pemeriksaan yang dijalankan.",
      };
  }
}

/**
 * Maps ONU status to an authoritative Indonesian display label.
 * Crucial rule: "Perangkat online" is NOT proof of healthy internet/Wi-Fi.
 * "LOS" is NOT proof of a physical cable cut.
 * Stale observations downgrade to uncertain status warning.
 */
export function getOnuStatusBadge(
  status: OnuStatus | string | null,
  quality?: Quality | string,
  isStaleNow = false
): {
  readonly label: string;
  readonly badgeType: "success" | "warning" | "danger" | "neutral";
  readonly semanticNote: string;
} {
  if (isStaleNow || quality === "stale") {
    return {
      label: "Status Belum Pasti (Data Basi)",
      badgeType: "warning",
      semanticNote: "Bukti status ONU telah kedaluwarsa (>5 menit); tidak boleh dijadikan dasar kesimpulan kondisi saat ini.",
    };
  }

  if (
    quality === "unknown" ||
    quality === "timeout" ||
    quality === "provider_error" ||
    quality === "invalid_timestamp" ||
    quality === "mapping_invalid" ||
    quality === "not_found"
  ) {
    return {
      label: "Status Belum Pasti",
      badgeType: "warning",
      semanticNote: "Bukti status ONU tidak valid atau tidak lengkap; tidak boleh dijadikan dasar kesimpulan.",
    };
  }

  switch (status) {
    case "online":
      return {
        label: "Perangkat Online",
        badgeType: "success",
        semanticNote: "Perangkat terhubung ke OLT. Perangkat online bukan bukti koneksi internet atau Wi-Fi normal.",
      };
    case "LOS":
      return {
        label: "Sinyal Hilang (LOS)",
        badgeType: "danger",
        semanticNote: "Loss of Signal terdeteksi pada optik ONU. Sinyal hilang bukan bukti kabel fisik tertentu putus.",
      };
    default:
      return {
        label: "Belum Diketahui",
        badgeType: "neutral",
        semanticNote: "Status ONU belum dapat dipastikan dari data sistem monitor.",
      };
  }
}

/**
 * Maps Upstream status to an authoritative Indonesian display label.
 * Stale observations downgrade to uncertain status warning.
 */
export function getUpstreamStatusBadge(
  status: UpstreamStatus | string | null,
  quality?: Quality | string,
  isStaleNow = false
): {
  readonly label: string;
  readonly badgeType: "success" | "warning" | "danger" | "neutral";
  readonly semanticNote: string;
} {
  if (isStaleNow || quality === "stale") {
    return {
      label: "Status Tautan Tidak Pasti (Data Basi)",
      badgeType: "warning",
      semanticNote: "Status tautan upstream telah kedaluwarsa (>5 menit); memerlukan pembacaan ulang.",
    };
  }

  if (
    quality === "unknown" ||
    quality === "timeout" ||
    quality === "provider_error" ||
    quality === "invalid_timestamp" ||
    quality === "mapping_invalid" ||
    quality === "not_found"
  ) {
    return {
      label: "Status Tautan Tidak Pasti",
      badgeType: "warning",
      semanticNote: "Status tautan upstream belum dapat dipastikan karena kualitas bukti tidak valid.",
    };
  }

  switch (status) {
    case "up":
      return {
        label: "Tautan Upstream Normal",
        badgeType: "success",
        semanticNote: "Tautan transmisi upstream utama aktif dan beroperasi normal.",
      };
    case "down":
      return {
        label: "Tautan Upstream Gangguan",
        badgeType: "danger",
        semanticNote: "Tautan transmisi upstream terdeteksi down; dapat mempengaruhi seluruh pelanggan terdampak.",
      };
    default:
      return {
        label: "Belum Diketahui",
        badgeType: "neutral",
        semanticNote: "Status tautan upstream belum dilaporkan oleh sistem.",
      };
  }
}

/**
 * Maps Area snapshot state to an authoritative Indonesian display label.
 * Crucial rules:
 * - "unknown" is "Belum Dapat Ditentukan", NEVER "NORMAL".
 * - "no_indication" means does not meet area threshold, NOT a guarantee of normal network.
 * - Stale observations downgrade with clear re-verification warning.
 */
export function getAreaStateBadge(
  state: "indicated" | "no_indication" | "unknown" | string | null,
  isStaleNow = false
): {
  readonly label: string;
  readonly badgeType: "success" | "warning" | "danger" | "neutral" | "info";
  readonly semanticNote: string;
} {
  if (state === "indicated") {
    if (isStaleNow) {
      return {
        label: "Indikasi Gangguan Area (Data Basi)",
        badgeType: "warning",
        semanticNote: "Sebelumnya terindikasi gangguan area, namun observasi telah berusia lebih dari 5 menit. Butuh verifikasi ulang.",
      };
    }
    return {
      label: "Indikasi Gangguan Area",
      badgeType: "danger",
      semanticNote: "Terdeteksi indikasi gangguan massal pada area (memenuhi threshold LOS >= 3, rasio >= 50%, cakupan >= 80%).",
    };
  }

  if (state === "no_indication") {
    if (isStaleNow) {
      return {
        label: "Tidak Memenuhi Indikasi Area (Data Basi)",
        badgeType: "warning",
        semanticNote: "Tidak memenuhi indikasi area saat diperiksa, namun data telah basi. Tidak menjamin jaringan normal saat ini.",
      };
    }
    return {
      label: "Tidak Memenuhi Indikasi Area",
      badgeType: "neutral",
      semanticNote: "Tidak memenuhi indikasi gangguan area berdasarkan bukti yang tersedia saat pemeriksaan. Bukan jaminan jaringan normal.",
    };
  }

  return {
    label: "Belum Dapat Ditentukan",
    badgeType: "warning",
    semanticNote: "Status area belum dapat ditentukan (cakupan pengawasan tidak mencukupi atau data tidak valid). Bukan status normal.",
  };
}

/**
 * Evaluates the overall Area Indication summary badge across areas and freshness.
 * Rules:
 * - If any area indication is stale: "Status Belum Pasti (Data Basi)" (warning).
 * - If any area is fresh and state is "indicated": "Terindikasi Gangguan Area" (danger).
 * - If no areas exist or any area has state "unknown": "Belum Dapat Ditentukan (Cakupan < 80%)" (warning).
 * - Only if all areas are fresh, coverage is sufficient (>= 80%), and state is "no_indication":
 *   "Tidak Memenuhi Indikasi Area" (neutral).
 */
export function getAreaIndicationSummaryBadge(
  areas: readonly {
    state: "indicated" | "no_indication" | "unknown" | string | null;
    isStale?: boolean;
    coverage?: number;
  }[]
): {
  readonly label: string;
  readonly badgeType: "success" | "warning" | "danger" | "neutral";
  readonly semanticNote: string;
} {
  if (!areas || areas.length === 0) {
    return {
      label: "Belum Dapat Ditentukan",
      badgeType: "neutral",
      semanticNote: "Tidak ada observasi area terkait untuk dianalisis.",
    };
  }

  const hasStale = areas.some((a) => a.isStale);
  if (hasStale) {
    return {
      label: "Status Belum Pasti (Data Basi)",
      badgeType: "warning",
      semanticNote: "Observasi area telah kedaluwarsa (>5 menit); tidak dapat memastikan indikasi area saat ini.",
    };
  }

  const hasIndicated = areas.some((a) => a.state === "indicated");
  if (hasIndicated) {
    return {
      label: "Terindikasi Gangguan Area",
      badgeType: "danger",
      semanticNote: "Terdeteksi indikasi gangguan massal pada area (LOS >= 3, rasio >= 50%, cakupan >= 80%).",
    };
  }

  const hasUnknown = areas.some(
    (a) => a.state === "unknown" || (typeof a.coverage === "number" && a.coverage < 0.8)
  );
  if (hasUnknown) {
    return {
      label: "Belum Dapat Ditentukan (Cakupan < 80%)",
      badgeType: "warning",
      semanticNote: "Cakupan observasi area tidak mencukupi untuk menentukan kondisi area. Bukan status normal.",
    };
  }

  return {
    label: "Tidak Memenuhi Indikasi Area",
    badgeType: "neutral",
    semanticNote: "Tidak memenuhi threshold gangguan area berdasarkan bukti fresh saat ini. Bukan jaminan jaringan pelanggan normal.",
  };
}

/**
 * Formats area coverage with explicit denominators.
 * Formula: `${los} LOS / ${valid} valid / ${total} total (${Math.round(coverage * 100)}% cakupan)`
 */
export function formatAreaRatioString(
  los: number,
  valid: number,
  total: number,
  coverage?: number
): string {
  const covPct = typeof coverage === "number" ? Math.round(coverage * 100) : total > 0 ? Math.round((valid / total) * 100) : 0;
  return `${los} LOS / ${valid} valid / ${total} total (${covPct}% cakupan)`;
}

/**
 * Human-readable Indonesian explanation for triage decision reasons.
 */
export function getTriageReasonExplanation(reason: DecisionReason | string): {
  readonly title: string;
  readonly explanation: string;
  readonly recommendation: string;
} {
  switch (reason) {
    case "general_active":
      return {
        title: "Incident Umum Aktif (Override)",
        explanation: "Pemberitahuan gangguan massal umum sedang diberlakukan oleh staf; melewati pemeriksaan topologi.",
        recommendation: "Pelanggan mendapatkan informasi penanganan massal tanpa lookup wilayah.",
      };
    case "manual_area_match":
      return {
        title: "Incident Area Manual Cocok",
        explanation: "Topologi ODP/ODC pelanggan cocok dengan area gangguan manual yang telah diverifikasi staf.",
        recommendation: "Gunakan panduan penanganan incident area manual yang aktif.",
      };
    case "upstream_down":
      return {
        title: "Tautan Upstream Down",
        explanation: "Tautan transmisi upstream terindikasi gangguan. Terbukti independen dari status perangkat ONU pelanggan.",
        recommendation: "Informasikan perbaikan upstream backbone/transmisi kepada pelanggan.",
      };
    case "los_area":
      return {
        title: "Indikasi Gangguan Area (LOS Area)",
        explanation: "Terdeteksi sedikitnya 3 perangkat LOS dengan rasio >= 50% dan cakupan pengawasan >= 80% pada ODP/ODC.",
        recommendation: "Pemeriksaan teknisi disarankan diarahkan pada titik distribusi ODP/ODC bersama.",
      };
    case "los_individual":
      return {
        title: "Sinyal Hilang Individual (LOS)",
        explanation: "Perangkat pelanggan mengalami LOS, namun area sekitar tidak memenuhi ambang batas gangguan massal.",
        recommendation: "Jadwalkan pemeriksaan jalur kabel drop optic atau konektor individual ke rumah pelanggan.",
      };
    case "online":
      return {
        title: "Perangkat Online (Pemeriksaan Lanjutan)",
        explanation: "ONU pelanggan terhubung aktif ke OLT. Perangkat online tidak menjamin kualitas layanan/aplikasi lancar.",
        recommendation: "Lakukan diagnosa lanjutan terkait kendala Wi-Fi, DNS, atau rute pelanggan di Custpanel.",
      };
    case "identity_unresolved":
      return {
        title: "Identitas Belum Terselesaikan",
        explanation: "Pengirim belum terverifikasi atau memiliki lebih dari satu layanan aktif tanpa penautan pasti.",
        recommendation: "Verifikasi identitas dan layanan pelanggan secara manual melalui direktori pelanggan.",
      };
    case "onu_unusable":
      return {
        title: "Status ONU Tidak Layak Digunakan",
        explanation: "Data monitoring perangkat ONU tidak lengkap, basi, atau mengalami kendala sistem.",
        recommendation: "Gunakan pemeriksaan ulang on-demand atau verifikasi manual ke tim NOC.",
      };
    case "non_connection_message":
      return {
        title: "Pesan Bukan Komplain Koneksi",
        explanation: "Pesan diklasifikasikan sebagai pertanyaan non-koneksi, administrasi, atau salam.",
        recommendation: "Tanggapi pesan melalui composer balasan staf.",
      };
    case "network_unavailable":
      return {
        title: "Sistem Jaringan Tidak Tersedia",
        explanation: "Layanan provider jaringan mock tidak dapat diakses saat pesan diproses.",
        recommendation: "Periksa koneksi sistem monitor dan coba kembali pemeriksaan on-demand.",
      };
    default:
      return {
        title: `Alasan: ${reason}`,
        explanation: "Keputusan triage dievaluasi berdasarkan aturan sistem otomatis.",
        recommendation: "Tinjau riwayat bukti terkait.",
      };
  }
}
