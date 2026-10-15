#!/usr/bin/env node
/**
 * scripts/verify-supabase-cloud.mjs
 *
 * Verifies Supabase Cloud PostgreSQL connections for:
 * 1. PROTOTYPE_DATABASE_URL (Session pooler, port 5432)
 * 2. HELPDESK_DATABASE_URL (Transaction pooler, port 6543)
 *
 * Strict Compliance:
 * - Reads .env.local explicitly without logging raw credentials or passwords.
 * - Uses pg.Client with connectionString and strict TLS (no rejectUnauthorized: false).
 * - Executes only "SELECT 1 AS ok".
 * - Exits with code 0 only if both connections succeed, nonzero otherwise.
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
  // Redact any potential credentials/passwords or long tokens in error string
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
    env[key] = val; // later occurrence overwrites earlier occurrence
  }
  return env;
}

export function validateConnectionTarget(urlStr, expectedPort, expectedProjectRef) {
  if (!urlStr) {
    throw new Error('Connection URL is missing');
  }
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (!['postgres:', 'postgresql:'].includes(u.protocol)) {
    throw new Error(`Invalid protocol ${u.protocol}; expected postgres: or postgresql:`);
  }

  const port = parseInt(u.port || '5432', 10);
  if (port !== expectedPort) {
    throw new Error(`Port mismatch: configured ${port}, expected ${expectedPort}`);
  }

  const sslmode = u.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') {
    throw new Error(`sslmode mismatch: configured "${sslmode}", expected "verify-full"`);
  }

  const username = u.username;
  if (!username.includes(expectedProjectRef)) {
    throw new Error(`Username "${username}" does not contain expected project ref "${expectedProjectRef}"`);
  }

  if (/\[password\]|<password>|your-password/i.test(u.password || '')) {
    throw new Error('URL still contains password placeholder syntax');
  }

  if (!u.password || u.password.trim() === '') {
    throw new Error('Password in URL is empty');
  }

  return {
    hostname: u.hostname,
    port,
    database: u.pathname.replace(/^\//, '') || 'postgres',
    username,
    sslmode,
  };
}

async function testSingleConnection(name, urlStr, expectedPort, expectedProjectRef) {
  console.log(`\n======================================================`);
  console.log(`[TEST] Target: ${name}`);
  console.log(`Masked URI: ${maskUrl(urlStr)}`);

  let target;
  try {
    target = validateConnectionTarget(urlStr, expectedPort, expectedProjectRef);
    console.log(`Validation: Host=${target.hostname}, Port=${target.port}, User=${target.username}, sslmode=${target.sslmode} (VALID)`);
  } catch (err) {
    console.error(`Validation Failed: ${err.message}`);
    return { success: false, error: err.message, step: 'validation' };
  }

  // Use connectionString directly matching application pg pool initialization
  const client = new Client({
    connectionString: urlStr,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5000,
    application_name: `upaznet-verify-${expectedPort}`,
  });

  const startTime = Date.now();
  try {
    await client.connect();
    const connectDurationMs = Date.now() - startTime;
    console.log(`Connection established in ${connectDurationMs}ms`);

    // Inspect TLS socket properties
    const socket = client.connection?.stream;
    const isEncrypted = socket?.encrypted ?? false;
    const tlsProtocol = socket?.getProtocol ? socket.getProtocol() : 'unknown';
    const cipher = socket?.getCipher ? socket.getCipher() : null;
    const cert = socket?.getPeerCertificate ? socket.getPeerCertificate() : null;

    console.log(`TLS Verification:`);
    console.log(`  - Encrypted: ${isEncrypted}`);
    console.log(`  - Protocol: ${tlsProtocol}`);
    if (cipher) console.log(`  - Cipher: ${cipher.name}`);
    if (cert && cert.subject) {
      console.log(`  - Server Certificate CN: ${cert.subject.CN}`);
      console.log(`  - Issuer: ${cert.issuer?.CN || 'unknown'}`);
    }

    // Execute minimal read-only query
    const res = await client.query('SELECT 1 AS ok;');
    const okValue = res.rows[0]?.ok;
    console.log(`Query "SELECT 1 AS ok" result: ${okValue} (SUCCESS)`);

    await client.end();
    return {
      success: true,
      connectDurationMs,
      targetPort: target.port,
      tlsProtocol,
      cipher: cipher?.name,
      okValue,
    };
  } catch (err) {
    const safeMsg = sanitizeError(err);
    console.error(`Connection/Query FAILED: ${safeMsg}`);
    if (err.code) console.error(`PostgreSQL / Error Code: ${err.code}`);
    try {
      await client.end();
    } catch {}
    return {
      success: false,
      error: safeMsg,
      code: err.code,
      step: 'connect_or_query',
    };
  }
}

async function main() {
  const envLocalPath = path.resolve(rootDir, '.env.local');
  const caCertPath = path.resolve(rootDir, 'certs/prod-ca-2021.crt');
  const EXPECTED_PROJECT_REF = 'saysxjdyalnbhxqqmytp';

  console.log(`--- Supabase Cloud PostgreSQL Verification Runner ---`);
  console.log(`Execution Time: ${new Date().toISOString()}`);

  // 1. Check CA cert eligibility
  if (!fs.existsSync(caCertPath)) {
    console.error(`FATAL: CA Certificate not found at ${caCertPath}`);
    process.exit(2);
  }
  const caCertPem = fs.readFileSync(caCertPath, 'utf8');
  try {
    const x509 = new crypto.X509Certificate(caCertPem);
    console.log(`CA Certificate Status: Valid`);
    console.log(`  Subject: ${x509.subject}`);
    console.log(`  Issuer: ${x509.issuer}`);
    console.log(`  Valid Until: ${x509.validTo}`);
    console.log(`  SHA256 Fingerprint: ${x509.fingerprint256}`);
  } catch (err) {
    console.error(`FATAL: Invalid CA Certificate: ${err.message}`);
    process.exit(2);
  }

  // 2. Check NODE_EXTRA_CA_CERTS in process
  console.log(`Environment NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || '(unset)'}`);

  // 3. Read .env.local
  const stats = fs.statSync(envLocalPath);
  console.log(`.env.local Last Modified: ${stats.mtime.toISOString()}`);
  const env = parseEnvLocal(envLocalPath);

  const protoUrl = env.PROTOTYPE_DATABASE_URL;
  const helpdeskUrl = env.HELPDESK_DATABASE_URL;

  // 4. Test PROTOTYPE_DATABASE_URL (Port 5432, Session pooler)
  const protoResult = await testSingleConnection(
    'PROTOTYPE_DATABASE_URL (Session pooler, port 5432)',
    protoUrl,
    5432,
    EXPECTED_PROJECT_REF
  );

  // 5. Test HELPDESK_DATABASE_URL (Port 6543, Transaction pooler)
  const helpdeskResult = await testSingleConnection(
    'HELPDESK_DATABASE_URL (Transaction pooler, port 6543)',
    helpdeskUrl,
    6543,
    EXPECTED_PROJECT_REF
  );

  console.log(`\n======================================================`);
  console.log(`VERIFICATION SUMMARY:`);
  console.log(`1. PROTOTYPE_DATABASE_URL (5432): ${protoResult.success ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`2. HELPDESK_DATABASE_URL (6543):  ${helpdeskResult.success ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log(`======================================================`);

  const bothPassed = protoResult.success && helpdeskResult.success;
  process.exit(bothPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`Unexpected runner failure: ${sanitizeError(err)}`);
  process.exit(1);
});
