import "server-only";
import { Pool, Client, type ClientConfig } from "pg";

let pool: Pool | undefined;

export function getHelpdeskPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.HELPDESK_DATABASE_URL;
  if (!connectionString) throw new Error("HELPDESK_DATABASE_URL is required");
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error("Invalid HELPDESK_DATABASE_URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database protocol");
  if (!local && url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("Remote HELPDESK_DATABASE_URL requires sslmode=verify-full");
  }
  pool = new Pool({
    connectionString, max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, application_name: "upaznet-helpdesk",
  });
  pool.on("error", () => { console.error("Helpdesk database idle connection error"); });
  return pool;
}

export async function closeHelpdeskPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

export interface HelpdeskPoolTarget {
  host: string;
  port: number;
  database: string;
}

export function normalizeHostname(hostname: string): string {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return "127.0.0.1";
  if (h === "::1") return "::1";
  return h;
}

export function isLoopbackHost(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  return h === "127.0.0.1" || h === "::1" || h.startsWith("127.");
}

export function getHelpdeskPoolTarget(existingPool?: Pool): HelpdeskPoolTarget | null {
  const targetPool = existingPool || pool;
  if (!targetPool) return null;
  const opts = (targetPool as unknown as { options?: Record<string, unknown> }).options;
  if (!opts) return null;

  if (!opts.connectionString && !opts.host) {
    return null;
  }

  try {
    // Resolve effective connection options using the pg driver's Client parser.
    // This accurately resolves query parameters such as ?port=... or ?host=... that the driver actually connects to,
    // without opening any network connection.
    const client = new Client(opts as ClientConfig);
    const rawHost = client.host || "127.0.0.1";
    const rawPort = typeof client.port === "number" ? client.port : (client.port ? parseInt(String(client.port), 10) : 5432);
    const rawDb = client.database || "postgres";

    return {
      host: normalizeHostname(rawHost),
      port: rawPort,
      database: rawDb.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}
