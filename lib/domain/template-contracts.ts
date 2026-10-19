import type { TemplateKey } from "./triage-contracts";

export const SIMULATION_PREFIX = "[SIMULASI DATA DUMMY]";
export const EMPTY_ESTIMATED_RECOVERY_FALLBACK = "masih dalam pemeriksaan";

export type TemplateScope = "default" | "incident";

export const DEFAULT_TEMPLATE_BODIES: Readonly<Record<TemplateKey, string>> = Object.freeze({
  MASS_GENERAL:
    "Saat ini terdapat gangguan jaringan yang berdampak luas. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}.",
  MASS_AREA:
    "Saat ini terdapat gangguan jaringan di area layanan Anda. Laporan Anda sudah masuk antrean helpdesk. Estimasi pemulihan: {{estimated_recovery}}.",
  NETWORK_DISRUPTION:
    "Terdeteksi indikasi gangguan jaringan yang memengaruhi layanan Anda. Laporan Anda sudah masuk antrean helpdesk.",
  LOS_AREA:
    "Terdeteksi indikasi gangguan sinyal yang juga terlihat pada beberapa koneksi di area Anda. Laporan Anda sudah masuk antrean helpdesk.",
  LOS_INDIVIDUAL:
    "Terdeteksi indikasi gangguan sinyal pada koneksi Anda. Laporan Anda sudah masuk antrean helpdesk untuk diperiksa.",
  ONLINE_CHECK:
    "Perangkat koneksi Anda terdeteksi online saat pengecekan. Keluhan Anda tetap kami teruskan ke helpdesk untuk pemeriksaan lebih lanjut.",
  GENERIC:
    "Mohon maaf atas kendalanya. Kondisi koneksi Anda belum dapat kami pastikan. Laporan Anda sudah masuk antrean helpdesk untuk pemeriksaan manual.",
});

export const ALLOWED_PLACEHOLDERS_BY_KEY: Readonly<Record<TemplateKey, readonly string[]>> = Object.freeze({
  MASS_GENERAL: Object.freeze(["estimated_recovery"]),
  MASS_AREA: Object.freeze(["estimated_recovery"]),
  NETWORK_DISRUPTION: Object.freeze([]),
  LOS_AREA: Object.freeze([]),
  LOS_INDIVIDUAL: Object.freeze([]),
  ONLINE_CHECK: Object.freeze([]),
  GENERIC: Object.freeze([]),
});

export type TemplateCandidateRecord = {
  id: string; // response_templates.id
  templateKey: TemplateKey;
  scope: TemplateScope;
  incidentId?: string | null;
  versionId: string; // template_versions.id
  version: number;
  body: string;
  isActive: boolean;
};

export type TemplateSnapshot = {
  templateKey: TemplateKey;
  templateVersionId: string;
  templateVersion: number;
  templateScope: TemplateScope;
  incidentId: string | null;
  renderedBodyWithoutPrefix: string;
  outboundText: string;
  renderedAt: string; // ISO 8601 UTC
};

export type RenderAutomaticTemplateSuccess = {
  outcome: "rendered";
  canDispatch: true;
  snapshot: TemplateSnapshot;
  errorCode: null;
  reason: null;
};

export type RenderAutomaticTemplateError = {
  outcome: "template_error";
  canDispatch: false;
  snapshot: null;
  errorCode: string;
  reason: string;
};

export type RenderAutomaticTemplateResult =
  | RenderAutomaticTemplateSuccess
  | RenderAutomaticTemplateError;

export type RenderStaffReplySuccess = {
  outcome: "rendered";
  canDispatch: true;
  outboundText: string;
  cleanedBody: string;
  renderedAt: string;
  errorCode: null;
};

export type RenderStaffReplyError = {
  outcome: "template_error";
  canDispatch: false;
  outboundText: null;
  errorCode: "empty_message_body" | "body_too_long" | "invalid_input";
  reason: string;
};

export type RenderStaffReplyResult = RenderStaffReplySuccess | RenderStaffReplyError;

export type RenderAutomaticTemplateInput = {
  templateKey: TemplateKey;
  candidates: readonly TemplateCandidateRecord[];
  incidentId?: string | null;
  estimatedRecovery?: string | null;
  renderedAt?: string;
};
