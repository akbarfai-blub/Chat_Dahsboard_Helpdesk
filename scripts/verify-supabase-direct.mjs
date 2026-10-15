#!/usr/bin/env node
/**
 * scripts/verify-supabase-direct.mjs
 *
 * Diagnostic runner for Supabase Direct PostgreSQL connection:
 * Target: SUPABASE_DIRECT_DATABASE_URL (db.saysxjdyalnbhxqqmytp.supabase.co:5432)
 *
 * Strict Compliance:
 * - Reads .env.local explicitly without logging raw credentials or passwords.
 * - Compares decoded passwords between Direct and Pooler URLs and reports boolean only.
 * - Uses pg.Client with connectionString and strict TLS verification.
 * - Executes only "SELECT 1 AS ok".
 * - Accurately categorizes any connection failure (28P01 vs Network/IPv6 vs TLS vs Timeout).
 * - Exits with code 0 only if connection, TLS, and query succeed. Nonzero otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function maskUrl(rawUrl) {
  if (!rawUrl) return '(not set)';
  try {
    const u = new URL(rawUrl);
    const user = u.username || '';
    const port = u.port || (u.protocol === 'https:' ? '443' : '5432');
    const sslmode = u.searchParams.get('sslmode') || 'none';
    return `${u.protocol}//${user ? user + ':***@' : ''}${u.hostname}:${port}${u.pathname}?sslmode=${sslmode}`;
  } catch {
    return '(invalid url format)';
  }
}

function sanitizeError(err) {
  if (!err) return '';
  let msg = err.message || String(err);
  msg = msg.replace(/(password\s*=\s*)[^\s]+/gi, '$1***');
  msg = msg.replace(/(:\/\/)([^:]+):([^@]+)@/g, '$1$2:***@');
  return msg;
}

export function parseEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEq = trimmed.indexOf('=');
    if (firstEq === -1) continue;
    const key = trimmed.slice(0, firstEq).trim();
    let val = trimmed.slice(firstEq + 1).trim();
    val = val.replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
  return env;
}

export function validateDirectTarget(urlStr) {
  if (!urlStr) {
    throw new Error('SUPABASE_DIRECT_DATABASE_URL is missing in .env.local');
  }
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format in SUPABASE_DIRECT_DATABASE_URL');
  }

  if (!['postgres:', 'postgresql:'].includes(u.protocol)) {
    throw new Error(`Invalid protocol "${u.protocol}"; expected postgres: or postgresql:`);
  }

  const expectedHost = 'db.saysxjdyalnbhxqqmytp.supabase.co';
  if (u.hostname !== expectedHost) {
    throw new Error(`Host mismatch: configured "${u.hostname}", expected "${expectedHost}"`);
  }

  const expectedUser = 'postgres';
  if (u.username !== expectedUser) {
    throw new Error(`Username mismatch: configured "${u.username}", expected "${expectedUser}"`);
  }

  const port = parseInt(u.port || '5432', 10);
  if (port !== 5432) {
    throw new Error(`Port mismatch: configured ${port}, expected 5432`);
  }

  const dbName = u.pathname.replace(/^\//, '') || 'postgres';
  if (dbName !== 'postgres') {
    throw new Error(`Database name mismatch: configured "${dbName}", expected "postgres"`);
  }

  const sslmode = u.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') {
    throw new Error(`sslmode mismatch: configured "${sslmode}", expected "verify-full"`);
  }

  const hasPlaceholder = /\[password\]|<password>|your-password|placeholder/i.test(u.password || '');
  if (hasPlaceholder) {
    throw new Error('SUPABASE_DIRECT_DATABASE_URL still contains password placeholder syntax');
  }

  if (!u.password || u.password.trim() === '') {
    throw new Error('Password in SUPABASE_DIRECT_DATABASE_URL is empty');
  }

  return {
    hostname: u.hostname,
    username: u.username,
    port,
    database: dbName,
    sslmode,
    password: u.password,
  };
}

async function main() {
  const envLocalPath = path.resolve(rootDir, '.env.local');
  const caCertPath = path.resolve(rootDir, 'certs/prod-ca-2021.crt');

  console.log(`--- Supabase Direct Connection Diagnostic Runner ---`);
  const testTimestamp = new Date().toISOString();
  console.log(`Execution Time: ${testTimestamp}`);

  // 1. Verify CA certificate existence and validity
  if (!fs.existsSync(caCertPath)) {
    console.error(`FATAL: CA certificate not found at ${caCertPath}`);
    process.exit(2);
  }
  try {
    const x509 = new crypto.X509Certificate(fs.readFileSync(caCertPath, 'utf8'));
    console.log(`CA Certificate: Valid (${x509.subject})`);
  } catch (err) {
    console.error(`FATAL: Invalid CA certificate: ${err.message}`);
    process.exit(2);
  }

  // 2. Check NODE_EXTRA_CA_CERTS
  console.log(`NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || '(unset)'}`);

  // 3. Read .env.local
  const stats = fs.statSync(envLocalPath);
  const mtimeIso = stats.mtime.toISOString();
  console.log(`.env.local Last Modified: ${mtimeIso}`);

  const env = parseEnvLocal(envLocalPath);
  const directUrl = env.SUPABASE_DIRECT_DATABASE_URL;
  const protoUrl = env.PROTOTYPE_DATABASE_URL;
  const helpdeskUrl = env.HELPDESK_DATABASE_URL;

  // 4. Validate Direct Target
  console.log(`\n--- Target Validation ---`);
  console.log(`Direct Target URI: ${maskUrl(directUrl)}`);
  let directTarget;
  try {
    directTarget = validateDirectTarget(directUrl);
    console.log(`Validation Check:`);
    console.log(`  - Host: ${directTarget.hostname} (MATCH)`);
    console.log(`  - Username: ${directTarget.username} (MATCH)`);
    console.log(`  - Port: ${directTarget.port} (MATCH)`);
    console.log(`  - Database: ${directTarget.database} (MATCH)`);
    console.log(`  - sslmode: ${directTarget.sslmode} (MATCH)`);
    console.log(`  - Placeholder detected: false (VALID)`);
  } catch (err) {
    console.error(`Validation Failed: ${err.message}`);
    process.exit(1);
  }

  // 5. Password matching check (Decoded comparisons - reported as boolean only)
  console.log(`\n--- Password Consistency Check (Boolean Only) ---`);
  const directDecodedPw = decodeURIComponent(directTarget.password);
  let protoDecodedPw = null;
  let helpdeskDecodedPw = null;

  try {
    if (protoUrl) protoDecodedPw = decodeURIComponent(new URL(protoUrl).password || '');
    if (helpdeskUrl) helpdeskDecodedPw = decodeURIComponent(new URL(helpdeskUrl).password || '');
  } catch {}

  const matchesPrototype = protoDecodedPw !== null && directDecodedPw === protoDecodedPw;
  const matchesHelpdesk = helpdeskDecodedPw !== null && directDecodedPw === helpdeskDecodedPw;

  console.log(`Decoded password matches PROTOTYPE_DATABASE_URL: ${matchesPrototype}`);
  console.log(`Decoded password matches HELPDESK_DATABASE_URL:  ${matchesHelpdesk}`);

  // 6. Execute Connection & Query Test
  console.log(`\n--- Executing Direct Connection ---`);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 7000,
    statement_timeout: 5000,
    query_timeout: 5000,
    application_name: 'upaznet-verify-direct',
  });

  const startTime = Date.now();
  let connectionSuccess = false;
  let tlsVerified = false;
  let querySuccess = false;
  let queryOkValue = null;
  let failureCategory = null;
  let failureMessage = null;
  let failureCode = null;

  try {
    await client.connect();
    const connectDurationMs = Date.now() - startTime;
    connectionSuccess = true;
    console.log(`Connection established in ${connectDurationMs}ms`);

    // Inspect TLS socket properties
    const socket = client.connection?.stream;
    const isEncrypted = socket?.encrypted ?? false;
    const tlsProtocol = socket?.getProtocol ? socket.getProtocol() : 'unknown';
    const cipher = socket?.getCipher ? socket.getCipher() : null;
    const cert = socket?.getPeerCertificate ? socket.getPeerCertificate() : null;

    if (isEncrypted) {
      tlsVerified = true;
      console.log(`TLS Verification:`);
      console.log(`  - Encrypted: ${isEncrypted}`);
      console.log(`  - Protocol: ${tlsProtocol}`);
      if (cipher) console.log(`  - Cipher: ${cipher.name}`);
      if (cert?.subject) {
        console.log(`  - Server Certificate CN: ${cert.subject.CN}`);
        console.log(`  - Issuer: ${cert.issuer?.CN || 'unknown'}`);
      }
    }

    // Execute minimal query: SELECT 1 AS ok
    const res = await client.query('SELECT 1 AS ok;');
    queryOkValue = res.rows[0]?.ok;
    console.log(`Query "SELECT 1 AS ok" result: ${queryOkValue}`);
    if (queryOkValue === 1 || queryOkValue === '1') {
      querySuccess = true;
    }

    await client.end();
  } catch (err) {
    const safeMsg = sanitizeError(err);
    failureMessage = safeMsg;
    failureCode = err.code || null;

    if (err.code === '28P01' || /password authentication failed/i.test(err.message)) {
      failureCategory = 'AUTHENTICATION_FAILED (28P01)';
    } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      failureCategory = 'DNS_RESOLUTION_FAILED';
    } else if (err.code === 'ETIMEDOUT' || /timeout/i.test(err.message)) {
      failureCategory = 'NETWORK_TIMEOUT (Potential IPv6/firewall reachability issue)';
    } else if (err.code === 'ENETUNREACH' || err.code === 'EHOSTUNREACH' || err.code === 'ECONNREFUSED') {
      failureCategory = 'NETWORK_UNREACHABLE (IPv6/routing issue)';
    } else if (err.code === 'SELF_SIGNED_CERT_IN_CHAIN' || /certificate|tls|ssl/i.test(err.message)) {
      failureCategory = 'TLS_CERTIFICATE_VERIFICATION_FAILED';
    } else {
      failureCategory = 'OTHER_CONNECTION_FAILURE';
    }

    console.error(`Direct Connection FAILED: [${failureCategory}]`);
    console.error(`Error message: ${safeMsg}`);
    if (failureCode) console.error(`Code: ${failureCode}`);
    try {
      await client.end();
    } catch {}
  }

  console.log(`\n======================================================`);
  console.log(`DIAGNOSTIC SUMMARY:`);
  console.log(`Direct Connection Established: ${connectionSuccess ? 'YES ✅' : 'NO ❌'}`);
  console.log(`TLS Verified:                  ${tlsVerified ? 'YES ✅' : 'NO ❌'}`);
  console.log(`Query ok = 1:                  ${querySuccess ? 'YES ✅' : 'NO ❌'}`);
  if (failureCategory) {
    console.log(`Failure Category:              ${failureCategory}`);
  }
  const overallSuccess = connectionSuccess && tlsVerified && querySuccess;
  console.log(`Overall Result:                ${overallSuccess ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`======================================================\n`);

  process.exit(overallSuccess ? 0 : 1);
}

main().catch((err) => {
  console.error(`Unexpected diagnostic runner failure: ${sanitizeError(err)}`);
  process.exit(1);
});
