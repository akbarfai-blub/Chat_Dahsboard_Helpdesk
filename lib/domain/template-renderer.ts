import {
  ALLOWED_PLACEHOLDERS_BY_KEY,
  EMPTY_ESTIMATED_RECOVERY_FALLBACK,
  SIMULATION_PREFIX,
  type RenderAutomaticTemplateInput,
  type RenderAutomaticTemplateResult,
  type RenderStaffReplyResult,
  type TemplateCandidateRecord,
  type TemplateSnapshot,
} from "./template-contracts";
import type { TemplateKey } from "./triage-contracts";

const VALID_TEMPLATE_KEYS: ReadonlySet<string> = new Set<TemplateKey>([
  "MASS_GENERAL",
  "MASS_AREA",
  "NETWORK_DISRUPTION",
  "LOS_AREA",
  "LOS_INDIVIDUAL",
  "ONLINE_CHECK",
  "GENERIC",
]);

export type ValidationSuccess = {
  valid: true;
  placeholders: string[];
};

export type ValidationError = {
  valid: false;
  error:
    | "invalid_template_key"
    | "invalid_template_body"
    | "empty_template_body"
    | "body_too_long"
    | "malformed_placeholder_syntax"
    | "disallowed_placeholder";
  placeholder?: string;
  message: string;
};

export type ValidationResult = ValidationSuccess | ValidationError;

export type ResolveActiveTemplateResult =
  | { outcome: "resolved"; candidate: TemplateCandidateRecord }
  | { outcome: "error"; error: "conflicting_active_templates" | "missing_active_template"; message: string };

/**
 * Validates a template body string against template rules and whitelist placeholders.
 */
export function validateTemplateBody(key: unknown, body: unknown): ValidationResult {
  if (typeof key !== "string" || !VALID_TEMPLATE_KEYS.has(key)) {
    return {
      valid: false,
      error: "invalid_template_key",
      message: `Invalid template key '${String(key)}'`,
    };
  }

  if (typeof body !== "string") {
    return {
      valid: false,
      error: "invalid_template_body",
      message: "Template body must be a string",
    };
  }

  if (body.trim().length === 0) {
    return {
      valid: false,
      error: "empty_template_body",
      message: "Template body cannot be empty",
    };
  }

  if (body.length > 4096) {
    return {
      valid: false,
      error: "body_too_long",
      message: "Template body exceeds maximum length of 4096 characters",
    };
  }

  // Detect malformed, unclosed, or stray braces
  const validPlaceholderRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const stripped = body.replace(validPlaceholderRegex, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    return {
      valid: false,
      error: "malformed_placeholder_syntax",
      message: "Template body contains malformed, unclosed, or stray placeholder syntax",
    };
  }

  // Extract all placeholders and check against whitelist
  const matches = [...body.matchAll(validPlaceholderRegex)];
  const placeholders = matches.map((m) => m[1]);
  const allowed = ALLOWED_PLACEHOLDERS_BY_KEY[key as TemplateKey] ?? [];

  for (const ph of placeholders) {
    if (!allowed.includes(ph)) {
      return {
        valid: false,
        error: "disallowed_placeholder",
        placeholder: ph,
        message: `Placeholder '{{${ph}}}' is not allowed for template key '${key}'`,
      };
    }
  }

  return {
    valid: true,
    placeholders,
  };
}

/**
 * Resolves the active template candidate for a given key and incident ID following FR-07 priority rules.
 * Incident-scoped templates override default-scoped templates.
 */
export function resolveActiveTemplate(
  key: TemplateKey,
  candidates: readonly TemplateCandidateRecord[],
  incidentId?: string | null
): ResolveActiveTemplateResult {
  const activeCandidates = candidates.filter((c) => c.templateKey === key && c.isActive === true);

  // 1. If incidentId is provided, check incident scope first
  if (incidentId) {
    const incidentCandidates = activeCandidates.filter(
      (c) => c.scope === "incident" && c.incidentId === incidentId
    );

    if (incidentCandidates.length > 1) {
      return {
        outcome: "error",
        error: "conflicting_active_templates",
        message: `Multiple active templates found for incident '${incidentId}' and key '${key}'`,
      };
    }

    if (incidentCandidates.length === 1) {
      return {
        outcome: "resolved",
        candidate: incidentCandidates[0],
      };
    }
    // Fallback to default scope if no incident template found
  }

  // 2. Check default scope
  const defaultCandidates = activeCandidates.filter((c) => c.scope === "default");
  if (defaultCandidates.length > 1) {
    return {
      outcome: "error",
      error: "conflicting_active_templates",
      message: `Multiple active default templates found for key '${key}'`,
    };
  }

  if (defaultCandidates.length === 1) {
    return {
      outcome: "resolved",
      candidate: defaultCandidates[0],
    };
  }

  return {
    outcome: "error",
    error: "missing_active_template",
    message: `No active template found for key '${key}'`,
  };
}

/**
 * Renders an automatic response template with deterministic substitution and simulation prefix.
 */
export function renderAutomaticTemplate(
  input: RenderAutomaticTemplateInput
): RenderAutomaticTemplateResult {
  if (typeof input.templateKey !== "string" || !VALID_TEMPLATE_KEYS.has(input.templateKey)) {
    return {
      outcome: "template_error",
      canDispatch: false,
      snapshot: null,
      errorCode: "invalid_template_key",
      reason: `Invalid template key '${String(input.templateKey)}'`,
    };
  }

  const resolved = resolveActiveTemplate(input.templateKey, input.candidates, input.incidentId);
  if (resolved.outcome === "error") {
    return {
      outcome: "template_error",
      canDispatch: false,
      snapshot: null,
      errorCode: resolved.error,
      reason: resolved.message,
    };
  }

  const validation = validateTemplateBody(input.templateKey, resolved.candidate.body);
  if (!validation.valid) {
    return {
      outcome: "template_error",
      canDispatch: false,
      snapshot: null,
      errorCode: validation.error,
      reason: validation.message,
    };
  }

  let renderedBody = resolved.candidate.body;
  if (validation.placeholders.includes("estimated_recovery")) {
    const rawEst = input.estimatedRecovery;
    const recoveryVal =
      rawEst == null || rawEst.trim() === ""
        ? EMPTY_ESTIMATED_RECOVERY_FALLBACK
        : rawEst.trim();

    // Prevent double dot `..` if recoveryVal ends with a dot and template has `{{estimated_recovery}}.`
    if (recoveryVal.endsWith(".")) {
      renderedBody = renderedBody.replaceAll("{{estimated_recovery}}.", () => recoveryVal);
    }
    renderedBody = renderedBody.replaceAll("{{estimated_recovery}}", () => recoveryVal);
  }

  const outboundText = `${SIMULATION_PREFIX} ${renderedBody}`;
  const snapshot: TemplateSnapshot = {
    templateKey: resolved.candidate.templateKey,
    templateVersionId: resolved.candidate.versionId,
    templateVersion: resolved.candidate.version,
    templateScope: resolved.candidate.scope,
    incidentId: resolved.candidate.incidentId ?? null,
    renderedBodyWithoutPrefix: renderedBody,
    outboundText,
    renderedAt: input.renderedAt ?? new Date().toISOString(),
  };

  return {
    outcome: "rendered",
    canDispatch: true,
    snapshot,
    errorCode: null,
    reason: null,
  };
}

/**
 * Applies the mandatory simulation prefix [SIMULASI DATA DUMMY] idempotently.
 */
export function applySimulationPrefix(text: string): string {
  let cleaned = text.trim();
  while (cleaned.startsWith(SIMULATION_PREFIX)) {
    cleaned = cleaned.slice(SIMULATION_PREFIX.length).trim();
  }
  return `${SIMULATION_PREFIX} ${cleaned}`;
}

/**
 * Validates and formats a staff manual reply, ensuring proper simulation prefix and length bounds.
 */
export function renderStaffReplySnapshot(
  rawBody: unknown,
  renderedAt?: string
): RenderStaffReplyResult {
  if (typeof rawBody !== "string") {
    return {
      outcome: "template_error",
      canDispatch: false,
      outboundText: null,
      errorCode: "invalid_input",
      reason: "Staff reply body must be a string",
    };
  }

  let body = rawBody.trim();
  while (body.startsWith(SIMULATION_PREFIX)) {
    body = body.slice(SIMULATION_PREFIX.length).trim();
  }

  if (body.length === 0) {
    return {
      outcome: "template_error",
      canDispatch: false,
      outboundText: null,
      errorCode: "empty_message_body",
      reason: "Staff reply body cannot be empty",
    };
  }

  const outboundText = `${SIMULATION_PREFIX} ${body}`;
  if (outboundText.length > 10000) {
    return {
      outcome: "template_error",
      canDispatch: false,
      outboundText: null,
      errorCode: "body_too_long",
      reason: "Staff reply outbound text exceeds maximum length of 10000 characters",
    };
  }

  return {
    outcome: "rendered",
    canDispatch: true,
    outboundText,
    cleanedBody: body,
    renderedAt: renderedAt ?? new Date().toISOString(),
    errorCode: null,
  };
}
