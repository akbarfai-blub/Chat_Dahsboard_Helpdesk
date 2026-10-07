export interface TestEnvironmentConfig {
  databaseUrl: string;
  apiUrl: string;
  serviceRoleKey: string;
  expectedMarker: string;
}

export interface ClientQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release: (err?: Error | boolean) => void;
}

export interface PoolQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  connect?: () => Promise<ClientQueryable>;
  end?: () => Promise<void>;
}

export interface SupabaseQueryable {
  from: (table: string) => unknown;
}

export interface CombinedTestError extends Error {
  primaryError?: Error;
  cleanupErrors: Error[];
}

export interface TrackedResources {
  identityIds: string[];
  ingressIds: string[];
  scenarioIds: string[];
  complaintIds: string[];
  conversationIds: string[];
  messageIds: string[];
  ownerIds: string[];
  customerIds?: string[];
  serviceIds?: string[];
  incidentIds?: string[];
}

export class TestResourceTracker implements TrackedResources {
  public identityIds: string[] = [];
  public ingressIds: string[] = [];
  public scenarioIds: string[] = [];
  public complaintIds: string[] = [];
  public conversationIds: string[] = [];
  public messageIds: string[] = [];
  public ownerIds: string[] = [];
  public customerIds: string[] = [];
  public serviceIds: string[] = [];
  public incidentIds: string[] = [];

  recordIdentity(id: string): void {
    if (!this.identityIds.includes(id)) this.identityIds.push(id);
  }

  recordIngress(id: string): void {
    if (!this.ingressIds.includes(id)) this.ingressIds.push(id);
  }

  recordScenario(id: string): void {
    if (!this.scenarioIds.includes(id)) this.scenarioIds.push(id);
  }

  recordComplaint(id: string): void {
    if (!this.complaintIds.includes(id)) this.complaintIds.push(id);
  }

  recordConversation(id: string): void {
    if (!this.conversationIds.includes(id)) this.conversationIds.push(id);
  }

  recordMessage(id: string): void {
    if (!this.messageIds.includes(id)) this.messageIds.push(id);
  }

  recordOwner(id: string): void {
    if (!this.ownerIds.includes(id)) this.ownerIds.push(id);
  }

  recordCustomer(id: string): void {
    if (!this.customerIds.includes(id)) this.customerIds.push(id);
  }

  recordService(id: string): void {
    if (!this.serviceIds.includes(id)) this.serviceIds.push(id);
  }

  recordIncident(id: string): void {
    if (!this.incidentIds.includes(id)) this.incidentIds.push(id);
  }
}

export class EnvRestorer {
  private originalValues = new Map<string, string | undefined>();

  public save(keys: string[]): this {
    for (const key of keys) {
      if (!this.originalValues.has(key)) {
        this.originalValues.set(key, process.env[key]);
      }
    }
    return this;
  }

  public set(key: string, value: string): void {
    if (!this.originalValues.has(key)) {
      this.originalValues.set(key, process.env[key]);
    }
    process.env[key] = value;
  }

  public restore(): void {
    for (const [key, value] of this.originalValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.originalValues.clear();
  }
}

function isLoopback(hostname: string): boolean {
  const norm = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return norm === "localhost" || norm === "127.0.0.1" || norm === "::1" || norm === "0.0.0.0";
}

export function parseAndValidateTestConfig(env: Record<string, string | undefined> = process.env): TestEnvironmentConfig {
  const dbUrlRaw = env.HELPDESK_TEST_DATABASE_URL?.trim();
  const apiUrlRaw = env.HELPDESK_TEST_API_URL?.trim();
  const roleKeyRaw = env.HELPDESK_TEST_SERVICE_ROLE_KEY?.trim();
  const markerRaw = env.HELPDESK_TEST_ENV_MARKER?.trim();

  if (!dbUrlRaw || !apiUrlRaw || !roleKeyRaw || !markerRaw) {
    throw new Error(
      "FAIL-CLOSED: Explicit test environment configurations (HELPDESK_TEST_DATABASE_URL, HELPDESK_TEST_API_URL, HELPDESK_TEST_SERVICE_ROLE_KEY, HELPDESK_TEST_ENV_MARKER) are missing or invalid."
    );
  }

  let parsedDbUrl: URL;
  let parsedApiUrl: URL;
  try {
    parsedDbUrl = new URL(dbUrlRaw);
    parsedApiUrl = new URL(apiUrlRaw);
  } catch (err) {
    throw new Error(`FAIL-CLOSED: Invalid URL format in test configuration: ${(err as Error).message}`);
  }

  // Guard against pointing to active user workspace database
  const userDbRaw = env.HELPDESK_DATABASE_URL || env.DATABASE_URL;
  if (userDbRaw) {
    try {
      const parsedUserDb = new URL(userDbRaw);
      const sameHost = (isLoopback(parsedDbUrl.hostname) && isLoopback(parsedUserDb.hostname)) || parsedDbUrl.hostname === parsedUserDb.hostname;
      const samePort = (parsedDbUrl.port || "5432") === (parsedUserDb.port || "5432");
      const samePath = parsedDbUrl.pathname === parsedUserDb.pathname;
      if (sameHost && samePort && samePath) {
        throw new Error("FAIL-CLOSED: Test database configuration points to the active user workspace database.");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("FAIL-CLOSED")) throw e;
    }
  }

  // Default user database port/pathname guard on loopback
  if (isLoopback(parsedDbUrl.hostname)) {
    const port = parsedDbUrl.port || "5432";
    const dbName = parsedDbUrl.pathname.replace(/^\//, "");
    if ((port === "54322" || port === "5432") && (dbName === "postgres" || dbName === "")) {
      throw new Error("FAIL-CLOSED: Target is the default user workspace database. Rejecting execution to protect user data.");
    }
  }

  // Guard against pointing to active user workspace Supabase API
  const userApiRaw = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (userApiRaw) {
    try {
      const parsedUserApi = new URL(userApiRaw);
      const sameHost = (isLoopback(parsedApiUrl.hostname) && isLoopback(parsedUserApi.hostname)) || parsedApiUrl.hostname === parsedUserApi.hostname;
      const samePort = (parsedApiUrl.port || "80") === (parsedUserApi.port || "80");
      if (sameHost && samePort) {
        throw new Error("FAIL-CLOSED: Test API configuration points to the active user workspace Supabase API.");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("FAIL-CLOSED")) throw e;
    }
  }

  // Default user Supabase API port guard on loopback
  if (isLoopback(parsedApiUrl.hostname)) {
    const port = parsedApiUrl.port || (parsedApiUrl.protocol === "https:" ? "443" : "80");
    if (port === "54321") {
      throw new Error("FAIL-CLOSED: Target API is the default user workspace Supabase API (port 54321). Rejecting execution to protect user data.");
    }
  }

  return {
    databaseUrl: dbUrlRaw,
    apiUrl: apiUrlRaw,
    serviceRoleKey: roleKeyRaw,
    expectedMarker: markerRaw,
  };
}

export async function verifyTestTargetIdentity(
  pool: PoolQueryable,
  supabase: SupabaseQueryable,
  expectedMarker: string
): Promise<void> {
  // 1. Read-only query to PG to verify target database and test isolation marker
  const pgRes = await pool.query(
    "SELECT id, description FROM public.mock_network_scenarios WHERE id = $1",
    [expectedMarker]
  );

  if (!pgRes.rows || pgRes.rows.length === 0) {
    throw new Error(
      `FAIL-CLOSED: Test environment marker '${expectedMarker}' not found in target database via PostgreSQL. Target is not a verified isolated test environment.`
    );
  }

  const pgToken = pgRes.rows[0].description as string;

  // 2. Query through Supabase Client to verify the API accesses the EXACT same environment
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { id: string; description: string } | null; error: Error | null }>;
        };
      };
    };
  };

  const { data: sbData, error: sbError } = await client
    .from("mock_network_scenarios")
    .select("id, description")
    .eq("id", expectedMarker)
    .maybeSingle();

  if (sbError) {
    throw new Error(
      `FAIL-CLOSED: Supabase client failed to query test environment marker '${expectedMarker}': ${sbError.message}. PostgreSQL and Supabase API are not targeting the same database.`
    );
  }

  if (!sbData) {
    throw new Error(
      `FAIL-CLOSED: Test environment marker '${expectedMarker}' not found via Supabase API. PostgreSQL and Supabase API are not targeting the same database.`
    );
  }

  // 3. Compare marker tokens from both paths
  if (sbData.id !== expectedMarker || sbData.description !== pgToken) {
    throw new Error(
      "FAIL-CLOSED: Target mismatch: PostgreSQL and Supabase API returned different marker tokens. The two connections are accessing different databases!"
    );
  }
}

export async function requireIsolatedDatabase(
  pool: PoolQueryable,
  supabase: SupabaseQueryable,
  config: TestEnvironmentConfig
): Promise<void> {
  await verifyTestTargetIdentity(pool, supabase, config.expectedMarker);
}

export function checkTestEnvAvailable(env: Record<string, string | undefined> = process.env): {
  available: boolean;
  reason?: string;
  config?: TestEnvironmentConfig;
} {
  try {
    const config = parseAndValidateTestConfig(env);
    return { available: true, config };
  } catch (err) {
    return { available: false, reason: (err as Error).message };
  }
}

export function combineErrors(primaryError?: Error, cleanupErrors: Error[] = []): CombinedTestError | Error | undefined {
  if (!primaryError && cleanupErrors.length === 0) {
    return undefined;
  }
  if (!primaryError && cleanupErrors.length > 0) {
    const err = new Error(
      `Cleanup failed on ${cleanupErrors.length} step(s):\n` +
      cleanupErrors.map((e, i) => `  [${i + 1}] ${e.message}`).join("\n")
    ) as CombinedTestError;
    err.cleanupErrors = cleanupErrors;
    return err;
  }
  if (primaryError && cleanupErrors.length === 0) {
    return primaryError;
  }
  if (primaryError && cleanupErrors.length > 0) {
    const detail =
      `Primary test error: ${primaryError.message}\nAdditionally, ${cleanupErrors.length} cleanup error(s) occurred:\n` +
      cleanupErrors.map((e, i) => `  [${i + 1}] ${e.message}`).join("\n");
    if (typeof AggregateError !== "undefined") {
      const agg = new AggregateError([primaryError, ...cleanupErrors], detail) as unknown as CombinedTestError;
      agg.primaryError = primaryError;
      agg.cleanupErrors = cleanupErrors;
      return agg;
    }
    const combined = new Error(detail) as CombinedTestError;
    combined.cause = primaryError;
    combined.primaryError = primaryError;
    combined.cleanupErrors = cleanupErrors;
    return combined;
  }
  return undefined;
}

export async function cleanupFixture(
  pool: PoolQueryable,
  resourcesOrIdentityIds: TestResourceTracker | Partial<TrackedResources> | string[],
  legacyIngressIds?: string[],
  legacyScenarioIds?: string[]
): Promise<void> {
  const cleanupErrors: Error[] = [];

  let identityIds: string[] = [];
  let ingressIds: string[] = [];
  let scenarioIds: string[] = [];
  let trackedComplaintIds: string[] = [];
  let trackedConversationIds: string[] = [];
  let trackedMessageIds: string[] = [];
  let trackedOwnerIds: string[] = [];
  let trackedCustomerIds: string[] = [];
  let trackedServiceIds: string[] = [];
  let trackedIncidentIds: string[] = [];

  if (Array.isArray(resourcesOrIdentityIds)) {
    identityIds = resourcesOrIdentityIds;
    ingressIds = legacyIngressIds || [];
    scenarioIds = legacyScenarioIds || [];
  } else {
    identityIds = resourcesOrIdentityIds.identityIds || [];
    ingressIds = resourcesOrIdentityIds.ingressIds || [];
    scenarioIds = resourcesOrIdentityIds.scenarioIds || [];
    trackedComplaintIds = resourcesOrIdentityIds.complaintIds || [];
    trackedConversationIds = resourcesOrIdentityIds.conversationIds || [];
    trackedMessageIds = resourcesOrIdentityIds.messageIds || [];
    trackedOwnerIds = resourcesOrIdentityIds.ownerIds || [];
    trackedCustomerIds = resourcesOrIdentityIds.customerIds || [];
    trackedServiceIds = resourcesOrIdentityIds.serviceIds || [];
    trackedIncidentIds = resourcesOrIdentityIds.incidentIds || [];
  }

  // 1. Discover derived IDs from test identities / ingresses
  let discoveredMessageIds: string[] = [];
  const discoveredComplaintIds: string[] = [];
  let discoveredConversationIds: string[] = [];
  let discoveredOwnerIds: string[] = [];
  let discoveredIngressIds: string[] = [];

  try {
    if (identityIds.length > 0) {
      const ingressRes = await pool.query(
        "SELECT id FROM public.ingress_events WHERE identity_id = ANY($1::uuid[])",
        [identityIds]
      );
      discoveredIngressIds = ingressRes.rows.map((r) => r.id as string);

      const complaintsRes = await pool.query(
        "SELECT id FROM public.complaints WHERE identity_id = ANY($1::uuid[])",
        [identityIds]
      );
      const complaintsFromId = complaintsRes.rows.map((r) => r.id as string);
      discoveredComplaintIds.push(...complaintsFromId);
    }
  } catch (err) {
    cleanupErrors.push(new Error(`Discovery error (ingress/complaints from identity): ${(err as Error).message}`));
  }

  try {
    const combinedIngress = [...new Set([...ingressIds, ...discoveredIngressIds])];
    if (identityIds.length > 0 || combinedIngress.length > 0) {
      let msgQuery = "";
      const msgParams: unknown[] = [];
      if (identityIds.length > 0 && combinedIngress.length > 0) {
        msgQuery = "SELECT id, complaint_id FROM public.messages WHERE identity_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])";
        msgParams.push(identityIds, combinedIngress);
      } else if (identityIds.length > 0) {
        msgQuery = "SELECT id, complaint_id FROM public.messages WHERE identity_id = ANY($1::uuid[])";
        msgParams.push(identityIds);
      } else {
        msgQuery = "SELECT id, complaint_id FROM public.messages WHERE id = ANY($1::uuid[])";
        msgParams.push(combinedIngress);
      }
      const messagesRes = await pool.query(msgQuery, msgParams);
      discoveredMessageIds = messagesRes.rows.map((r) => r.id as string);
      discoveredComplaintIds.push(...messagesRes.rows.map((r) => r.complaint_id as string).filter(Boolean));
    }
  } catch (err) {
    cleanupErrors.push(new Error(`Discovery error (messages): ${(err as Error).message}`));
  }

  try {
    if (identityIds.length > 0) {
      const convRes = await pool.query(
        "SELECT id FROM public.conversations WHERE identity_id = ANY($1::uuid[])",
        [identityIds]
      );
      discoveredConversationIds = convRes.rows.map((r) => r.id as string);
    }
  } catch (err) {
    cleanupErrors.push(new Error(`Discovery error (conversations): ${(err as Error).message}`));
  }

  try {
    if (identityIds.length > 0) {
      const ownersRes = await pool.query(
        "SELECT id FROM public.reply_owners WHERE identity_id = ANY($1::uuid[])",
        [identityIds]
      );
      discoveredOwnerIds = ownersRes.rows.map((r) => r.id as string);
    }
  } catch (err) {
    cleanupErrors.push(new Error(`Discovery error (reply_owners): ${(err as Error).message}`));
  }

  const allMessageIds = [...new Set([...trackedMessageIds, ...discoveredMessageIds])];
  const allComplaintIds = [...new Set([...trackedComplaintIds, ...discoveredComplaintIds])];
  const allConversationIds = [...new Set([...trackedConversationIds, ...discoveredConversationIds])];
  const allOwnerIds = [...new Set([...trackedOwnerIds, ...discoveredOwnerIds])];
  const allIdentityIds = [...new Set(identityIds)];
  const allIngressIds = [...new Set([...ingressIds, ...discoveredIngressIds])];
  const allScenarioIds = [...new Set(scenarioIds)];
  const allCustomerIds = [...new Set(trackedCustomerIds)];
  const allServiceIds = [...new Set(trackedServiceIds)];
  const allIncidentIds = [...new Set(trackedIncidentIds)];

  async function runStep(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      cleanupErrors.push(new Error(`Cleanup step [${label}] failed: ${(err as Error).message}`));
    }
  }

  // 2. Leaf-to-root cascaded deletes
  await runStep("complaint_evidence_links", async () => {
    if (allComplaintIds.length > 0) {
      await pool.query("DELETE FROM public.complaint_evidence_links WHERE complaint_id = ANY($1::uuid[])", [allComplaintIds]);
    }
  });

  await runStep("reply_claims", async () => {
    if (allOwnerIds.length > 0 && allComplaintIds.length > 0) {
      await pool.query(
        "DELETE FROM public.reply_claims WHERE owner_id = ANY($1::uuid[]) OR complaint_id = ANY($2::uuid[])",
        [allOwnerIds, allComplaintIds]
      );
    } else if (allOwnerIds.length > 0) {
      await pool.query("DELETE FROM public.reply_claims WHERE owner_id = ANY($1::uuid[])", [allOwnerIds]);
    } else if (allComplaintIds.length > 0) {
      await pool.query("DELETE FROM public.reply_claims WHERE complaint_id = ANY($1::uuid[])", [allComplaintIds]);
    }
  });

  await runStep("complaint_audit_log", async () => {
    if (allMessageIds.length > 0 && allComplaintIds.length > 0) {
      await pool.query(
        "DELETE FROM public.complaint_audit_log WHERE message_id = ANY($1::uuid[]) OR complaint_id = ANY($2::uuid[])",
        [allMessageIds, allComplaintIds]
      );
    } else if (allMessageIds.length > 0) {
      await pool.query("DELETE FROM public.complaint_audit_log WHERE message_id = ANY($1::uuid[])", [allMessageIds]);
    } else if (allComplaintIds.length > 0) {
      await pool.query("DELETE FROM public.complaint_audit_log WHERE complaint_id = ANY($1::uuid[])", [allComplaintIds]);
    }
  });

  await runStep("triage_assessments", async () => {
    if (allMessageIds.length > 0) {
      await pool.query("DELETE FROM public.triage_assessments WHERE message_id = ANY($1::uuid[])", [allMessageIds]);
    }
  });

  await runStep("outbound_intents", async () => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (allMessageIds.length > 0) {
      params.push(allMessageIds);
      conditions.push(`message_id = ANY($${params.length}::uuid[])`);
    }
    if (allComplaintIds.length > 0) {
      params.push(allComplaintIds);
      conditions.push(`complaint_id = ANY($${params.length}::uuid[])`);
    }
    if (allOwnerIds.length > 0) {
      params.push(allOwnerIds);
      conditions.push(`owner_id = ANY($${params.length}::uuid[])`);
    }
    if (conditions.length > 0) {
      await pool.query(`DELETE FROM public.outbound_intents WHERE ${conditions.join(" OR ")}`, params);
    }
  });

  await runStep("staff_conversation_reads", async () => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (allConversationIds.length > 0) {
      params.push(allConversationIds);
      conditions.push(`conversation_id = ANY($${params.length}::uuid[])`);
    }
    if (allMessageIds.length > 0) {
      params.push(allMessageIds);
      conditions.push(`last_read_message_id = ANY($${params.length}::uuid[])`);
    }
    if (conditions.length > 0) {
      await pool.query(`DELETE FROM public.staff_conversation_reads WHERE ${conditions.join(" OR ")}`, params);
    }
  });

  await runStep("staff_message_reads", async () => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (allConversationIds.length > 0) {
      params.push(allConversationIds);
      conditions.push(`conversation_id = ANY($${params.length}::uuid[])`);
    }
    if (allMessageIds.length > 0) {
      params.push(allMessageIds);
      conditions.push(`message_id = ANY($${params.length}::uuid[])`);
    }
    if (conditions.length > 0) {
      await pool.query(`DELETE FROM public.staff_message_reads WHERE ${conditions.join(" OR ")}`, params);
    }
  });

  await runStep("messages", async () => {
    if (allMessageIds.length > 0) {
      await pool.query("DELETE FROM public.messages WHERE id = ANY($1::uuid[])", [allMessageIds]);
    }
  });

  await runStep("reply_owners", async () => {
    if (allOwnerIds.length > 0) {
      await pool.query("DELETE FROM public.reply_owners WHERE id = ANY($1::uuid[])", [allOwnerIds]);
    }
  });

  await runStep("complaints", async () => {
    if (allComplaintIds.length > 0) {
      await pool.query("DELETE FROM public.complaints WHERE id = ANY($1::uuid[])", [allComplaintIds]);
    }
  });

  await runStep("conversations", async () => {
    if (allConversationIds.length > 0) {
      await pool.query("DELETE FROM public.conversations WHERE id = ANY($1::uuid[])", [allConversationIds]);
    }
  });

  await runStep("processing_job_attempts", async () => {
    if (allIngressIds.length > 0) {
      await pool.query("DELETE FROM public.processing_job_attempts WHERE ingress_id = ANY($1::uuid[])", [allIngressIds]);
    }
  });

  await runStep("processing_jobs", async () => {
    if (allIngressIds.length > 0) {
      await pool.query("DELETE FROM public.processing_jobs WHERE ingress_id = ANY($1::uuid[])", [allIngressIds]);
    }
  });

  await runStep("ingress_events", async () => {
    if (allIngressIds.length > 0) {
      await pool.query("DELETE FROM public.ingress_events WHERE id = ANY($1::uuid[])", [allIngressIds]);
    }
  });

  await runStep("channel_identities", async () => {
    if (allIdentityIds.length > 0) {
      await pool.query("DELETE FROM public.channel_identities WHERE id = ANY($1::uuid[])", [allIdentityIds]);
    }
  });

  await runStep("services", async () => {
    if (allServiceIds.length > 0 || allCustomerIds.length > 0) {
      if (allServiceIds.length > 0 && allCustomerIds.length > 0) {
        await pool.query("DELETE FROM public.services WHERE id = ANY($1::uuid[]) OR customer_id = ANY($2::uuid[])", [allServiceIds, allCustomerIds]);
      } else if (allServiceIds.length > 0) {
        await pool.query("DELETE FROM public.services WHERE id = ANY($1::uuid[])", [allServiceIds]);
      } else {
        await pool.query("DELETE FROM public.services WHERE customer_id = ANY($1::uuid[])", [allCustomerIds]);
      }
    }
  });

  await runStep("customers", async () => {
    if (allCustomerIds.length > 0) {
      await pool.query("DELETE FROM public.customers WHERE id = ANY($1::uuid[])", [allCustomerIds]);
    }
  });

  await runStep("incident_activity_log", async () => {
    if (allIncidentIds.length > 0) {
      await pool.query("DELETE FROM public.incident_activity_log WHERE incident_id = ANY($1::uuid[])", [allIncidentIds]);
    }
  });

  await runStep("incidents", async () => {
    if (allIncidentIds.length > 0) {
      await pool.query("DELETE FROM public.incidents WHERE id = ANY($1::uuid[])", [allIncidentIds]);
    }
  });

  // Mock network scenario resources
  await runStep("mock_upstream_impacts", async () => {
    if (allScenarioIds.length > 0) {
      await pool.query("DELETE FROM public.mock_upstream_impacts WHERE scenario_id = ANY($1)", [allScenarioIds]);
    }
  });

  await runStep("mock_upstream_status", async () => {
    if (allScenarioIds.length > 0) {
      await pool.query("DELETE FROM public.mock_upstream_status WHERE scenario_id = ANY($1)", [allScenarioIds]);
    }
  });

  await runStep("mock_onu_status", async () => {
    if (allScenarioIds.length > 0) {
      await pool.query("DELETE FROM public.mock_onu_status WHERE scenario_id = ANY($1)", [allScenarioIds]);
    }
  });

  await runStep("mock_network_scenarios", async () => {
    if (allScenarioIds.length > 0) {
      await pool.query("DELETE FROM public.mock_network_scenarios WHERE id = ANY($1)", [allScenarioIds]);
    }
  });

  if (cleanupErrors.length > 0) {
    const combinedError = new Error(
      `Cleanup failed on ${cleanupErrors.length} step(s):\n` +
      cleanupErrors.map(e => e.message).join("\n")
    ) as CombinedTestError;
    combinedError.cleanupErrors = cleanupErrors;
    throw combinedError;
  }
}
