import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATE_BODIES,
  EMPTY_ESTIMATED_RECOVERY_FALLBACK,
  SIMULATION_PREFIX,
  type TemplateCandidateRecord,
} from "../../lib/domain/template-contracts";
import {
  applySimulationPrefix,
  renderAutomaticTemplate,
  renderStaffReplySnapshot,
  resolveActiveTemplate,
  validateTemplateBody,
} from "../../lib/domain/template-renderer";
import type { TemplateKey } from "../../lib/domain/triage-contracts";

function createCandidate(
  key: TemplateKey,
  scope: "default" | "incident" = "default",
  body = DEFAULT_TEMPLATE_BODIES[key],
  options: {
    incidentId?: string | null;
    version?: number;
    isActive?: boolean;
    versionId?: string;
    id?: string;
  } = {}
): TemplateCandidateRecord {
  return {
    id: options.id ?? `tpl-${key}-${scope}`,
    templateKey: key,
    scope,
    incidentId: options.incidentId ?? (scope === "incident" ? "inc-001" : null),
    versionId: options.versionId ?? `v-${key}-1`,
    version: options.version ?? 1,
    body,
    isActive: options.isActive ?? true,
  };
}

test("validateTemplateBody - Valid templates and placeholders", () => {
  // Test all 7 default templates pass validation
  for (const [key, body] of Object.entries(DEFAULT_TEMPLATE_BODIES)) {
    const res = validateTemplateBody(key, body);
    assert.equal(res.valid, true, `Key ${key} should be valid`);
  }
});

test("validateTemplateBody - Key and structure validation", () => {
  assert.equal(validateTemplateBody("UNKNOWN_KEY", "Some body").valid, false);
  assert.equal(validateTemplateBody(123, "Some body").valid, false);
  assert.equal(validateTemplateBody("GENERIC", null).valid, false);
  assert.equal(validateTemplateBody("GENERIC", "").valid, false);
  assert.equal(validateTemplateBody("GENERIC", "   \n\t  ").valid, false);

  const longBody = "a".repeat(4097);
  const longRes = validateTemplateBody("GENERIC", longBody);
  assert.equal(longRes.valid, false);
  if (!longRes.valid) {
    assert.equal(longRes.error, "body_too_long");
  }
});

test("validateTemplateBody - Syntax checking for curly braces", () => {
  // Unclosed opening brace
  const res1 = validateTemplateBody("MASS_GENERAL", "Gangguan {{estimated_recovery");
  assert.equal(res1.valid, false);
  if (!res1.valid) assert.equal(res1.error, "malformed_placeholder_syntax");

  // Stray closing brace
  const res2 = validateTemplateBody("MASS_GENERAL", "Gangguan estimated_recovery}}");
  assert.equal(res2.valid, false);
  if (!res2.valid) assert.equal(res2.error, "malformed_placeholder_syntax");

  // Triple braces
  const res3 = validateTemplateBody("MASS_GENERAL", "Gangguan {{{estimated_recovery}}}");
  assert.equal(res3.valid, false);
  if (!res3.valid) assert.equal(res3.error, "malformed_placeholder_syntax");

  // Empty placeholder
  const res4 = validateTemplateBody("MASS_GENERAL", "Gangguan {{}}");
  assert.equal(res4.valid, false);
  if (!res4.valid) assert.equal(res4.error, "malformed_placeholder_syntax");

  // Placeholder with spaces
  const res5 = validateTemplateBody("MASS_GENERAL", "Gangguan {{ estimated_recovery }}");
  assert.equal(res5.valid, false);
  if (!res5.valid) assert.equal(res5.error, "malformed_placeholder_syntax");

  // Single brace
  const res6 = validateTemplateBody("GENERIC", "Gangguan {x}");
  assert.equal(res6.valid, false);
  if (!res6.valid) assert.equal(res6.error, "malformed_placeholder_syntax");
});

test("validateTemplateBody - Whitelist checking for placeholders", () => {
  // Disallowed placeholder on MASS_GENERAL
  const res1 = validateTemplateBody("MASS_GENERAL", "Gangguan ODP: {{odp_id}}");
  assert.equal(res1.valid, false);
  if (!res1.valid) {
    assert.equal(res1.error, "disallowed_placeholder");
    assert.equal(res1.placeholder, "odp_id");
  }

  // estimated_recovery on GENERIC (which allows no placeholders)
  const res2 = validateTemplateBody("GENERIC", "Koneksi Anda. Estimasi: {{estimated_recovery}}");
  assert.equal(res2.valid, false);
  if (!res2.valid) {
    assert.equal(res2.error, "disallowed_placeholder");
    assert.equal(res2.placeholder, "estimated_recovery");
  }

  // customer_id on ONLINE_CHECK
  const res3 = validateTemplateBody("ONLINE_CHECK", "Customer {{customer_id}} online");
  assert.equal(res3.valid, false);
  if (!res3.valid) {
    assert.equal(res3.error, "disallowed_placeholder");
    assert.equal(res3.placeholder, "customer_id");
  }
});

test("resolveActiveTemplate - Scope priority and invariants", () => {
  const defaultCandidate = createCandidate("MASS_GENERAL", "default");
  const incidentCandidate = createCandidate("MASS_GENERAL", "incident", "Incident override", {
    incidentId: "inc-100",
  });

  // 1. Incident override wins when incidentId matches
  const res1 = resolveActiveTemplate("MASS_GENERAL", [defaultCandidate, incidentCandidate], "inc-100");
  assert.equal(res1.outcome, "resolved");
  if (res1.outcome === "resolved") {
    assert.equal(res1.candidate.scope, "incident");
    assert.equal(res1.candidate.body, "Incident override");
  }

  // 2. Fallback to default when incidentId does not match incident template
  const res2 = resolveActiveTemplate("MASS_GENERAL", [defaultCandidate, incidentCandidate], "inc-999");
  assert.equal(res2.outcome, "resolved");
  if (res2.outcome === "resolved") {
    assert.equal(res2.candidate.scope, "default");
  }

  // 3. Fallback to default when no incidentId is passed
  const res3 = resolveActiveTemplate("MASS_GENERAL", [defaultCandidate, incidentCandidate], null);
  assert.equal(res3.outcome, "resolved");
  if (res3.outcome === "resolved") {
    assert.equal(res3.candidate.scope, "default");
  }

  // 4. Missing active template
  const res4 = resolveActiveTemplate("LOS_AREA", [defaultCandidate], null);
  assert.equal(res4.outcome, "error");
  if (res4.outcome === "error") {
    assert.equal(res4.error, "missing_active_template");
  }

  // 5. Conflicting active default templates
  const defaultDup = createCandidate("MASS_GENERAL", "default", "Another default", { version: 2 });
  const res5 = resolveActiveTemplate("MASS_GENERAL", [defaultCandidate, defaultDup], null);
  assert.equal(res5.outcome, "error");
  if (res5.outcome === "error") {
    assert.equal(res5.error, "conflicting_active_templates");
  }

  // 6. Conflicting active incident templates for same incident
  const incidentDup = createCandidate("MASS_GENERAL", "incident", "Another incident override", {
    incidentId: "inc-100",
    version: 2,
  });
  const res6 = resolveActiveTemplate("MASS_GENERAL", [defaultCandidate, incidentCandidate, incidentDup], "inc-100");
  assert.equal(res6.outcome, "error");
  if (res6.outcome === "error") {
    assert.equal(res6.error, "conflicting_active_templates");
  }
});

test("renderAutomaticTemplate - Seven PRD §7 default templates render with prefix", () => {
  const keys: TemplateKey[] = [
    "MASS_GENERAL",
    "MASS_AREA",
    "NETWORK_DISRUPTION",
    "LOS_AREA",
    "LOS_INDIVIDUAL",
    "ONLINE_CHECK",
    "GENERIC",
  ];

  for (const key of keys) {
    const candidate = createCandidate(key, "default");
    const result = renderAutomaticTemplate({
      templateKey: key,
      candidates: [candidate],
      estimatedRecovery: "3 jam",
    });

    assert.equal(result.outcome, "rendered");
    assert.equal(result.canDispatch, true);
    assert.ok(result.snapshot);
    assert.ok(result.snapshot.outboundText.startsWith(SIMULATION_PREFIX));
    assert.equal(result.snapshot.templateKey, key);
    assert.equal(result.snapshot.templateVersion, 1);
    assert.equal(result.snapshot.templateScope, "default");
  }
});

test("renderAutomaticTemplate - estimated_recovery fallback and substitution", () => {
  const candidate = createCandidate("MASS_GENERAL", "default");

  // Fallback when null
  const resNull = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [candidate],
    estimatedRecovery: null,
  });
  assert.equal(resNull.outcome, "rendered");
  if (resNull.outcome === "rendered") {
    assert.ok(resNull.snapshot.outboundText.includes(EMPTY_ESTIMATED_RECOVERY_FALLBACK));
    assert.ok(resNull.snapshot.outboundText.includes("masih dalam pemeriksaan."));
  }

  // Fallback when empty or whitespace
  const resBlank = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [candidate],
    estimatedRecovery: "   ",
  });
  assert.equal(resBlank.outcome, "rendered");
  if (resBlank.outcome === "rendered") {
    assert.ok(resBlank.snapshot.outboundText.includes("masih dalam pemeriksaan."));
  }

  // Substitution when text provided
  const resText = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [candidate],
    estimatedRecovery: "Pukul 17:00 WIB",
  });
  assert.equal(resText.outcome, "rendered");
  if (resText.outcome === "rendered") {
    assert.ok(resText.snapshot.outboundText.includes("Estimasi pemulihan: Pukul 17:00 WIB."));
  }

  // Avoid double dot when input already ends with dot
  const resDot = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [candidate],
    estimatedRecovery: "Pukul 17:00 WIB.",
  });
  assert.equal(resDot.outcome, "rendered");
  if (resDot.outcome === "rendered") {
    assert.ok(resDot.snapshot.outboundText.includes("Estimasi pemulihan: Pukul 17:00 WIB."));
    assert.equal(resDot.snapshot.outboundText.includes("WIB.."), false);
  }

  // Anti-template injection: input containing {{...}} is not re-evaluated
  const resInjection = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [candidate],
    estimatedRecovery: "{{malicious_placeholder}}",
  });
  assert.equal(resInjection.outcome, "rendered");
  if (resInjection.outcome === "rendered") {
    assert.ok(resInjection.snapshot.outboundText.includes("{{malicious_placeholder}}"));
  }

  // Multi-occurrence of {{estimated_recovery}} in custom incident template
  const multiCandidate = createCandidate(
    "MASS_GENERAL",
    "incident",
    "Perbaikan: {{estimated_recovery}}. Sekali lagi: {{estimated_recovery}}.",
    { incidentId: "test-inc-1" }
  );
  const resMulti = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [multiCandidate],
    incidentId: "test-inc-1",
    estimatedRecovery: "17:00 WIB.",
  });
  assert.equal(resMulti.outcome, "rendered");
  if (resMulti.outcome === "rendered") {
    assert.ok(resMulti.snapshot.outboundText.includes("Perbaikan: 17:00 WIB. Sekali lagi: 17:00 WIB."));
    assert.equal(resMulti.snapshot.outboundText.includes(".."), false);
  }
});

test("renderAutomaticTemplate - Template error propagation", () => {
  // Invalid template key rejected before resolveActiveTemplate
  const resInvalidKey = renderAutomaticTemplate({
    templateKey: "UNKNOWN_KEY" as unknown as "MASS_GENERAL",
    candidates: [],
  });
  assert.equal(resInvalidKey.outcome, "template_error");
  assert.equal(resInvalidKey.canDispatch, false);
  assert.equal(resInvalidKey.snapshot, null);
  assert.equal(resInvalidKey.errorCode, "invalid_template_key");

  // Candidate with bad placeholder
  const badCandidate = createCandidate("MASS_GENERAL", "default", "Gangguan ODC: {{odc_id}}");
  const res = renderAutomaticTemplate({
    templateKey: "MASS_GENERAL",
    candidates: [badCandidate],
  });

  assert.equal(res.outcome, "template_error");
  assert.equal(res.canDispatch, false);
  assert.equal(res.snapshot, null);
  assert.equal(res.errorCode, "disallowed_placeholder");
});

test("applySimulationPrefix & renderStaffReplySnapshot", () => {
  // applySimulationPrefix
  assert.equal(applySimulationPrefix("Halo pelanggan"), `${SIMULATION_PREFIX} Halo pelanggan`);
  assert.equal(
    applySimulationPrefix(`${SIMULATION_PREFIX} Halo pelanggan`),
    `${SIMULATION_PREFIX} Halo pelanggan`
  );
  // Repeated prefix in applySimulationPrefix
  assert.equal(
    applySimulationPrefix(`${SIMULATION_PREFIX} ${SIMULATION_PREFIX} ${SIMULATION_PREFIX} Halo pelanggan`),
    `${SIMULATION_PREFIX} Halo pelanggan`
  );

  // renderStaffReplySnapshot - normal
  const res1 = renderStaffReplySnapshot("Selamat siang, kami sedang mengecek.");
  assert.equal(res1.outcome, "rendered");
  if (res1.outcome === "rendered") {
    assert.equal(res1.canDispatch, true);
    assert.equal(
      res1.outboundText,
      `${SIMULATION_PREFIX} Selamat siang, kami sedang mengecek.`
    );
    assert.equal(res1.cleanedBody, "Selamat siang, kami sedang mengecek.");
  }

  // renderStaffReplySnapshot - already has prefix
  const res2 = renderStaffReplySnapshot(`${SIMULATION_PREFIX} Selamat siang.`);
  assert.equal(res2.outcome, "rendered");
  if (res2.outcome === "rendered") {
    assert.equal(res2.outboundText, `${SIMULATION_PREFIX} Selamat siang.`);
    assert.equal(res2.cleanedBody, "Selamat siang.");
  }

  // renderStaffReplySnapshot - repeated prefix (2x or 3x)
  const resRepeated = renderStaffReplySnapshot(
    `${SIMULATION_PREFIX} ${SIMULATION_PREFIX} Selamat siang.`
  );
  assert.equal(resRepeated.outcome, "rendered");
  if (resRepeated.outcome === "rendered") {
    assert.equal(resRepeated.outboundText, `${SIMULATION_PREFIX} Selamat siang.`);
    assert.equal(resRepeated.cleanedBody, "Selamat siang.");
  }

  // renderStaffReplySnapshot - empty or whitespace only
  const resEmpty = renderStaffReplySnapshot("   ");
  assert.equal(resEmpty.outcome, "template_error");
  if (resEmpty.outcome === "template_error") {
    assert.equal(resEmpty.errorCode, "empty_message_body");
  }

  // renderStaffReplySnapshot - only prefix
  const resOnlyPrefix = renderStaffReplySnapshot(SIMULATION_PREFIX);
  assert.equal(resOnlyPrefix.outcome, "template_error");
  if (resOnlyPrefix.outcome === "template_error") {
    assert.equal(resOnlyPrefix.errorCode, "empty_message_body");
  }

  // renderStaffReplySnapshot - only repeated prefix
  const resOnlyRepeatedPrefix = renderStaffReplySnapshot(
    `${SIMULATION_PREFIX} ${SIMULATION_PREFIX} ${SIMULATION_PREFIX}`
  );
  assert.equal(resOnlyRepeatedPrefix.outcome, "template_error");
  if (resOnlyRepeatedPrefix.outcome === "template_error") {
    assert.equal(resOnlyRepeatedPrefix.errorCode, "empty_message_body");
  }

  // renderStaffReplySnapshot - non-string
  const resNonString = renderStaffReplySnapshot(null);
  assert.equal(resNonString.outcome, "template_error");
  if (resNonString.outcome === "template_error") {
    assert.equal(resNonString.errorCode, "invalid_input");
  }

  // renderStaffReplySnapshot - body too long
  const longBody = "a".repeat(10001);
  const resTooLong = renderStaffReplySnapshot(longBody);
  assert.equal(resTooLong.outcome, "template_error");
  if (resTooLong.outcome === "template_error") {
    assert.equal(resTooLong.errorCode, "body_too_long");
  }
});
