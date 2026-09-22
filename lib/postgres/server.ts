import "server-only";
import { Pool } from "pg";

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
