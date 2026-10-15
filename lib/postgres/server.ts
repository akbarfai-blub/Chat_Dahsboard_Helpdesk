import "server-only";
import { Pool, Client, type ClientConfig } from "pg";
import fs from "node:fs";
import path from "node:path";

let pool: Pool | undefined;

export const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

export interface DatabaseCaResolverOptions {
  env?: Record<string, string | undefined>;
  certPath?: string;
}

export function resolveDatabaseCaCertificate(options?: DatabaseCaResolverOptions): string {
  // 1. Explicit environment variable if configured
  const envSource = options?.env ?? process.env;
  const envCa = envSource.HELPDESK_DB_CA || envSource.SUPABASE_DB_CA;
  if (envCa && envCa.trim().length > 0) {
    return envCa.trim();
  }

  // 2. Read from filesystem certs/prod-ca-2021.crt if present
  try {
    const certPath =
      options?.certPath !== undefined
        ? options.certPath
        : path.resolve(process.cwd(), "certs/prod-ca-2021.crt");
    if (certPath && fs.existsSync(certPath)) {
      const content = fs.readFileSync(certPath, "utf8").trim();
      if (content.length > 0) {
        return content;
      }
    }
  } catch {
    // Ignore and proceed to fallback
  }

  // 3. Bundled fallback for serverless runtimes (e.g. Vercel)
  return SUPABASE_ROOT_CA_2021;
}

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

  const port = url.port ? parseInt(url.port, 10) : 5432;
  const database = url.pathname.replace(/^\//, "") || "postgres";
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (local) {
    pool = new Pool({
      host: url.hostname,
      port,
      database,
      user,
      password,
      ssl: false,
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      application_name: "upaznet-helpdesk",
    });
  } else {
    const ca = resolveDatabaseCaCertificate();
    pool = new Pool({
      host: url.hostname,
      port,
      database,
      user,
      password,
      ssl: {
        ca,
        rejectUnauthorized: true,
        servername: url.hostname,
      },
      max: 4,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      application_name: "upaznet-helpdesk",
    });
  }

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
