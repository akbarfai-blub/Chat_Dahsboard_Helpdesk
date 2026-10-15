import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { spawn } from 'node:child_process';
import pg from 'pg';

import {
  parseAndValidateDbConfig,
  stripOuterTransactionWrapper,
  runPrototypeMigrations,
} from '../../scripts/apply-prototype-migrations.mjs';

import {
  runPrototypeSeed,
} from '../../scripts/apply-prototype-seed.mjs';

import {
  telegramApiRequest,
  setWebhookUrl,
  restoreWebhookUrl,
  getWebhookStatus,
  validateTelegramApiBaseUrl,
} from '../../scripts/manage-telegram-webhook.mjs';

import {
  pollJobCompletion,
  runDeploymentSmokeTest,
  isValidLoginRedirect,
} from '../../scripts/smoke-test-deployment.mjs';

const { Client } = pg;
const ISOLATED_TEST_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54332/p210_tooling_test';

// =========================================================================
// Suite 1: Database URL & TLS Validation (Finding 2)
// =========================================================================
test('Suite 1: Database URL & TLS Validation matching application runtime', async (t) => {
  await t.test('1.1: Rejects missing or non-string database URL', () => {
    assert.throws(() => parseAndValidateDbConfig(null), /Database URL is required/);
    assert.throws(() => parseAndValidateDbConfig(''), /Database URL is required/);
    assert.throws(() => parseAndValidateDbConfig(123), /Database URL is required/);
  });

  await t.test('1.2: Rejects invalid URL string', () => {
    assert.throws(() => parseAndValidateDbConfig('not-a-valid-url'), /Invalid Database URL format/);
  });

  await t.test('1.3: Rejects unsupported database protocols', () => {
    assert.throws(
      () => parseAndValidateDbConfig('http://localhost:5432/postgres'),
      /Invalid database protocol: must be postgres: or postgresql:/
    );
    assert.throws(
      () => parseAndValidateDbConfig('mysql://localhost:3306/db'),
      /Invalid database protocol: must be postgres: or postgresql:/
    );
  });

  await t.test('1.4: Accepts local database URLs without TLS enforcement', () => {
    const local1 = parseAndValidateDbConfig('postgresql://postgres:secret@localhost:54322/postgres');
    assert.equal(local1.isLocal, true);
    assert.equal(local1.ssl, false);
    assert.equal(local1.hostname, 'localhost');
    assert.equal(local1.port, 54322);
    assert.equal(local1.database, 'postgres');

    const local2 = parseAndValidateDbConfig('postgres://postgres:secret@127.0.0.1:54332/mydb');
    assert.equal(local2.isLocal, true);
    assert.equal(local2.ssl, false);
    assert.equal(local2.hostname, '127.0.0.1');

    const local3 = parseAndValidateDbConfig('postgresql://postgres:secret@[::1]:5432/postgres');
    assert.equal(local3.isLocal, true);
    assert.equal(local3.ssl, false);
    assert.equal(local3.hostname, '::1');
  });

  await t.test('1.5: Rejects remote database without sslmode=verify-full', () => {
    assert.throws(
      () => parseAndValidateDbConfig('postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'),
      /Remote database connection requires sslmode=verify-full/
    );
    assert.throws(
      () => parseAndValidateDbConfig('postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require'),
      /Remote database connection requires sslmode=verify-full/
    );
    assert.throws(
      () => parseAndValidateDbConfig('postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=disable'),
      /Remote database connection requires sslmode=verify-full/
    );
    assert.throws(
      () => parseAndValidateDbConfig('postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=no-verify'),
      /Remote database connection requires sslmode=verify-full/
    );
  });

  await t.test('1.6: Accepts remote database with sslmode=verify-full and enforces rejectUnauthorized: true', () => {
    const remote = parseAndValidateDbConfig(
      'postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full'
    );
    assert.equal(remote.isLocal, false);
    assert.equal(remote.hostname, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(remote.port, 6543);
    assert.deepEqual(remote.ssl, { rejectUnauthorized: true });
  });

  await t.test('1.7: Error messages do NOT leak passwords', () => {
    try {
      parseAndValidateDbConfig('postgresql://user:my_secret_password_123@remote.host.com:5432/db?sslmode=disable');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.equal(err.message.includes('my_secret_password_123'), false);
    }
  });
});

// =========================================================================
// Suite 2: Migration Runner Atomicity & Single Transaction (Finding 4)
// =========================================================================
test('Suite 2: Migration Runner Atomicity & Single Transaction', async (t) => {
  await t.test('2.1: stripOuterTransactionWrapper correctly strips outer BEGIN/COMMIT', () => {
    const rawSql = `
      -- Leading comment
      BEGIN;
      CREATE TABLE public.test_atomicity (id int primary key);
      -- Inner statements
      COMMENT ON TABLE public.test_atomicity IS 'test table';
      COMMIT;
      -- Trailing comment
    `;

    const unwrapped = stripOuterTransactionWrapper(rawSql);
    assert.equal(unwrapped.hadLeadingBegin, true);
    assert.equal(unwrapped.hadTrailingCommit, true);
    assert.equal(unwrapped.sql.includes('CREATE TABLE public.test_atomicity'), true);
    assert.equal(unwrapped.sql.includes('COMMENT ON TABLE'), true);
    // Outer BEGIN; and COMMIT; must be gone
    assert.equal(/^\s*BEGIN\s*;/im.test(unwrapped.sql), false);
    assert.equal(/COMMIT\s*;\s*(--.*)?$/im.test(unwrapped.sql), false);
  });

  await t.test('2.2: stripOuterTransactionWrapper preserves SQL without outer wrapper', () => {
    const rawSql = `CREATE TABLE public.test_no_wrapper (id int);`;
    const unwrapped = stripOuterTransactionWrapper(rawSql);
    assert.equal(unwrapped.hadLeadingBegin, false);
    assert.equal(unwrapped.hadTrailingCommit, false);
    assert.equal(unwrapped.sql.trim(), rawSql.trim());
  });

  await t.test('2.3: Atomic execution on isolated DB: schema DDL + version recording', async () => {
    // Setup isolated test migration directory
    const tempDir = path.resolve(process.cwd(), 'scratch/test-migrations-atomicity');
    fs.mkdirSync(tempDir, { recursive: true });

    const m1Path = path.join(tempDir, '20261013000001_create_atomicity_table.sql');
    fs.writeFileSync(
      m1Path,
      `begin;\ncreate table public.atomicity_success (id int primary key, val text);\ncommit;\n`,
      'utf8'
    );

    const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
    await client.connect();
    try {
      await client.query(`DROP TABLE IF EXISTS public.atomicity_success;`);
      await client.query(`DROP SCHEMA IF EXISTS supabase_migrations CASCADE;`);

      // Run migration
      const res = await runPrototypeMigrations(ISOLATED_TEST_DB_URL, {
        migrationsDir: tempDir,
        logger: { log: () => {}, error: () => {} },
      });

      assert.equal(res.applied, 1);
      assert.deepEqual(res.newlyApplied, ['20261013000001']);

      // Verify table exists
      const { rows: tableRows } = await client.query(
        `SELECT to_regclass('public.atomicity_success') as tbl;`
      );
      assert.notEqual(tableRows[0].tbl, null);

      // Verify version recorded in supabase_migrations.schema_migrations
      const { rows: verRows } = await client.query(
        `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261013000001';`
      );
      assert.equal(verRows.length, 1);

      // Re-run migration: must be a no-op!
      const reRunRes = await runPrototypeMigrations(ISOLATED_TEST_DB_URL, {
        migrationsDir: tempDir,
        logger: { log: () => {}, error: () => {} },
      });
      assert.equal(reRunRes.applied, 0);
      assert.equal(reRunRes.skipped, 1);
    } finally {
      await client.end();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('2.4: Injected failure before commit rolls back schema DDL AND version record', async () => {
    const tempDir = path.resolve(process.cwd(), 'scratch/test-migrations-rollback');
    fs.mkdirSync(tempDir, { recursive: true });

    const mFailPath = path.join(tempDir, '20261013000002_create_failing_table.sql');
    fs.writeFileSync(
      mFailPath,
      `begin;\ncreate table public.atomicity_fail_table (id int primary key);\ncommit;\n`,
      'utf8'
    );

    const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
    await client.connect();
    try {
      await client.query(`DROP TABLE IF EXISTS public.atomicity_fail_table;`);

      // Attempt migration with injected failure
      await assert.rejects(
        async () => {
          await runPrototypeMigrations(ISOLATED_TEST_DB_URL, {
            migrationsDir: tempDir,
            injectedFailureVersion: '20261013000002',
            logger: { log: () => {}, error: () => {} },
          });
        },
        /Injected failure for testing atomicity/
      );

      // Verify table was ROLLED BACK (does not exist)
      const { rows: tableRows } = await client.query(
        `SELECT to_regclass('public.atomicity_fail_table') as tbl;`
      );
      assert.equal(tableRows[0].tbl, null, 'Table must NOT exist after rollback');

      // Verify version was NOT recorded
      const { rows: verRows } = await client.query(
        `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261013000002';`
      );
      assert.equal(verRows.length, 0, 'Version must NOT be recorded after rollback');

      // Run again WITHOUT injected failure -> must succeed!
      const recoveryRes = await runPrototypeMigrations(ISOLATED_TEST_DB_URL, {
        migrationsDir: tempDir,
        logger: { log: () => {}, error: () => {} },
      });
      assert.equal(recoveryRes.applied, 1);

      const { rows: recoverTable } = await client.query(
        `SELECT to_regclass('public.atomicity_fail_table') as tbl;`
      );
      assert.notEqual(recoverTable[0].tbl, null, 'Table must exist after clean recovery');
    } finally {
      await client.query(`DROP TABLE IF EXISTS public.atomicity_fail_table;`);
      await client.end();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// =========================================================================
// Suite 3: Telegram Webhook Management Error Handling (Finding 5)
// =========================================================================
test('Suite 3: Telegram Webhook Management and Error Handling', async (t) => {
  await t.test('3.1: Rejects when Telegram returns ok: false', async () => {
    const mockRequester = async (method) => {
      return { ok: false, error_code: 400, description: 'Bad Request: bad webhook: IP address not allowed' };
    };

    await assert.rejects(
      async () => {
        await telegramApiRequest('dummy_token', 'setWebhook', { url: 'https://example.com' }, { requester: mockRequester });
      },
      /Telegram API request 'setWebhook' failed: \[400\] Bad Request: bad webhook/
    );
  });

  await t.test('3.2: Rejects when Telegram setWebhook succeeds but getWebhookInfo reveals mismatch', async () => {
    const mockRequester = async (method, payload) => {
      if (method === 'setWebhook') {
        return { ok: true, result: true, description: 'Webhook was set' };
      }
      if (method === 'getWebhookInfo') {
        return {
          ok: true,
          result: {
            url: 'https://different-host.com/api/webhooks/telegram',
            pending_update_count: 0,
          },
        };
      }
      return { ok: true, result: {} };
    };

    await assert.rejects(
      async () => {
        await setWebhookUrl(
          'dummy_token',
          'https://correct-host.com/api/webhooks/telegram',
          'secret123',
          { requester: mockRequester }
        );
      },
      /Webhook configuration mismatch: expected 'https:\/\/correct-host\.com\/api\/webhooks\/telegram', Telegram reports 'https:\/\/different-host\.com\/api\/webhooks\/telegram'/
    );
  });

  await t.test('3.3: Successfully sets and verifies webhook when configuration matches', async () => {
    let capturedPayload = null;
    const mockRequester = async (method, payload) => {
      if (method === 'setWebhook') {
        capturedPayload = payload;
        return { ok: true, result: true, description: 'Webhook was set' };
      }
      if (method === 'getWebhookInfo') {
        return {
          ok: true,
          result: {
            url: 'https://correct-host.com/api/webhooks/telegram',
            pending_update_count: 0,
            allowed_updates: ['message', 'edited_message'],
          },
        };
      }
      return { ok: true, result: {} };
    };

    const res = await setWebhookUrl(
      'dummy_token',
      'https://correct-host.com/api/webhooks/telegram',
      'secret123',
      { requester: mockRequester }
    );

    assert.equal(res.ok, true);
    assert.equal(res.webhook.url, 'https://correct-host.com/api/webhooks/telegram');
    assert.equal(capturedPayload.drop_pending_updates, false, 'drop_pending_updates must be false');
    assert.equal(capturedPayload.secret_token, 'secret123');
  });

  await t.test('3.4: Rejects network failure / timeout with clean message without leaking token', async () => {
    const mockRequester = async (method) => {
      throw new Error(`Telegram API network error on '${method}': connect ETIMEDOUT`);
    };

    await assert.rejects(
      async () => {
        await telegramApiRequest('secret_token_12345', 'getWebhookInfo', null, { requester: mockRequester });
      },
      (err) => {
        assert.equal(err.message.includes('ETIMEDOUT'), true);
        assert.equal(err.message.includes('secret_token_12345'), false);
        return true;
      }
    );
  });

  // Helper to create a loopback HTTP fixture server for transport tests
  async function createTelegramFixtureServer(handler) {
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        handler(req, res, body);
      });
    });

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const close = async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      await new Promise((resolve) => server.close(resolve));
    };

    return { server, port, baseUrl, close };
  }

  // Helper to execute CLI entrypoint as an isolated subprocess
  async function runCliSubprocess(args, envVars = {}, tempDir = null) {
    const scriptPath = path.resolve('scripts/manage-telegram-webhook.mjs');
    const isolatedDir = tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cli-test-'));

    const childEnv = {
      ...process.env,
      TELEGRAM_BOT_TOKEN: 'dummy_test_token_98765',
      TELEGRAM_WEBHOOK_SECRET: 'dummy_secret_54321',
      ...envVars,
    };
    delete childEnv.NODE_TEST_CONTEXT;

    return new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: isolatedDir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 5000);

      child.on('close', (code, signal) => {
        clearTimeout(killTimer);
        if (!tempDir) {
          try {
            fs.rmSync(isolatedDir, { recursive: true, force: true });
          } catch {}
        }
        resolve({ code, signal, stdout, stderr });
      });
    });
  }

  await t.test('3.5: HTTP non-200 with ok: true body rejects with HTTP error (not masked as success)', async () => {
    const fixture = await createTelegramFixtureServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: 'misleading-success' }));
    });

    try {
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: fixture.baseUrl });
        },
        /Telegram API request 'getMe' failed: \[500\] HTTP 500/
      );
    } finally {
      await fixture.close();
    }
  });

  await t.test('3.6: Malformed JSON on HTTP 200 rejects with parse error without hanging', async () => {
    const fixture = await createTelegramFixtureServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Bad Gateway</title></head><body>502 Bad Gateway</body></html>');
    });

    try {
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: fixture.baseUrl });
        },
        /Failed to parse Telegram API response \(HTTP 200\)/
      );
    } finally {
      await fixture.close();
    }
  });

  await t.test('3.7: Transport timeout halts request and rejects within deadline (< 2s)', async () => {
    const fixture = await createTelegramFixtureServer((req, res) => {
      // Intentionally do not send any response to trigger transport timeout
    });

    const start = Date.now();
    try {
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, {
            apiBaseUrl: fixture.baseUrl,
            timeoutMs: 150,
          });
        },
        /Telegram API request 'getMe' timed out after 150ms/
      );
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 2000, `Timeout must resolve promptly, took ${elapsed}ms`);
    } finally {
      await fixture.close();
    }
  });

  await t.test('3.8: CLI Subprocess exits nonzero (1) on non-200, malformed JSON, and timeout without false success', async () => {
    // 3.8a: HTTP non-200 (500)
    const fixture500 = await createTelegramFixtureServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: 'misleading' }));
    });
    try {
      const res500 = await runCliSubprocess(['status'], { TELEGRAM_API_BASE_URL: fixture500.baseUrl });
      assert.equal(res500.code, 1, 'Subprocess must exit 1 on HTTP 500');
      assert.match(res500.stderr, /Telegram API request 'getMe' failed: \[500\] HTTP 500/);
      assert.doesNotMatch(res500.stdout, /Bot Info:/, 'Must not print success bot info');
    } finally {
      await fixture500.close();
    }

    // 3.8b: Malformed JSON (HTTP 200)
    const fixtureMalformed = await createTelegramFixtureServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('INVALID_JSON_BODY');
    });
    try {
      const resMalformed = await runCliSubprocess(['status'], { TELEGRAM_API_BASE_URL: fixtureMalformed.baseUrl });
      assert.equal(resMalformed.code, 1, 'Subprocess must exit 1 on malformed JSON');
      assert.match(resMalformed.stderr, /Failed to parse Telegram API response \(HTTP 200\)/);
      assert.doesNotMatch(resMalformed.stdout, /Bot Info:/, 'Must not print success bot info');
    } finally {
      await fixtureMalformed.close();
    }

    // 3.8c: Timeout
    const fixtureTimeout = await createTelegramFixtureServer((req, res) => {
      // Deliberately hold request without responding
    });
    try {
      const resTimeout = await runCliSubprocess(['status'], {
        TELEGRAM_API_BASE_URL: fixtureTimeout.baseUrl,
        TELEGRAM_REQUEST_TIMEOUT_MS: '200',
      });
      assert.equal(resTimeout.code, 1, 'Subprocess must exit 1 on timeout');
      assert.match(resTimeout.stderr, /Telegram API request 'getMe' timed out after 200ms/);
      assert.doesNotMatch(resTimeout.stdout, /Bot Info:/, 'Must not print success bot info');
    } finally {
      await fixtureTimeout.close();
    }
  });

  await t.test('3.9: CLI Subprocess exits 0 on valid status and set commands with verification and drop_pending_updates: false', async () => {
    let capturedSetPayload = null;
    const configuredWebhookUrl = 'https://deployment.example.com/api/webhooks/telegram';

    const fixtureValid = await createTelegramFixtureServer((req, res, body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.endsWith('/getMe')) {
        res.end(JSON.stringify({
          ok: true,
          result: { id: 987654, is_bot: true, first_name: 'TestBot', username: 'test_helpdesk_bot' },
        }));
      } else if (req.url.endsWith('/getWebhookInfo')) {
        res.end(JSON.stringify({
          ok: true,
          result: {
            url: configuredWebhookUrl,
            has_custom_certificate: false,
            pending_update_count: 0,
            allowed_updates: ['message', 'edited_message'],
          },
        }));
      } else if (req.url.endsWith('/setWebhook')) {
        try {
          capturedSetPayload = JSON.parse(body);
        } catch {}
        res.end(JSON.stringify({
          ok: true,
          result: true,
          description: 'Webhook was set',
        }));
      } else {
        res.end(JSON.stringify({ ok: true, result: {} }));
      }
    });

    try {
      // 3.9a: CLI status command exits 0
      const resStatus = await runCliSubprocess(['status'], { TELEGRAM_API_BASE_URL: fixtureValid.baseUrl });
      assert.equal(resStatus.code, 0, 'CLI status must exit 0 on success');
      assert.match(resStatus.stdout, /Bot Info:/);
      assert.match(resStatus.stdout, /Username: @test_helpdesk_bot/);
      assert.match(resStatus.stdout, /Current Webhook Info:/);

      // 3.9b: CLI set command exits 0 and verifies webhook post-configuration
      const resSet = await runCliSubprocess(
        ['set', configuredWebhookUrl, 'test_secret_key_123'],
        { TELEGRAM_API_BASE_URL: fixtureValid.baseUrl }
      );
      assert.equal(resSet.code, 0, 'CLI set must exit 0 on success');
      assert.match(resSet.stdout, /Webhook successfully configured and verified/);
      assert.match(resSet.stdout, new RegExp(configuredWebhookUrl));

      // Verify payload received by fixture: drop_pending_updates must be false
      assert.notEqual(capturedSetPayload, null);
      assert.equal(capturedSetPayload.url, configuredWebhookUrl);
      assert.equal(capturedSetPayload.drop_pending_updates, false, 'drop_pending_updates must be strictly false');
      assert.equal(capturedSetPayload.secret_token, 'test_secret_key_123');
    } finally {
      await fixtureValid.close();
    }
  });

  await t.test('3.10: validateTelegramApiBaseUrl enforces HTTPS for non-local hosts and strictly loopback for HTTP', () => {
    // 3.10a: Default URL
    const def = validateTelegramApiBaseUrl();
    assert.equal(def.protocol, 'https:');
    assert.equal(def.hostname, 'api.telegram.org');

    // 3.10b: Valid loopback hostnames for HTTP
    assert.equal(validateTelegramApiBaseUrl('http://localhost:8080').hostname, 'localhost');
    assert.equal(validateTelegramApiBaseUrl('http://127.0.0.1:8080').hostname, '127.0.0.1');
    assert.equal(validateTelegramApiBaseUrl('http://[::1]:8080').hostname, '[::1]');

    // 3.10c: Valid non-local HTTPS
    assert.equal(validateTelegramApiBaseUrl('https://api.telegram.org').hostname, 'api.telegram.org');
    assert.equal(validateTelegramApiBaseUrl('https://custom-telegram.internal.example.com:8443').hostname, 'custom-telegram.internal.example.com');

    // 3.10d: Insecure non-local HTTP is rejected
    assert.throws(
      () => validateTelegramApiBaseUrl('http://api.telegram.org'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('http://remote.example.com'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );

    // 3.10e: Hostnames resembling loopback are rejected for HTTP
    assert.throws(
      () => validateTelegramApiBaseUrl('http://localhost.example.com'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('http://127.0.0.1.example.com'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('http://localhostevil.com'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('http://127.0.0.1.nip.io'),
      /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
    );

    // 3.10f: Unsupported protocols rejected even with local hostnames
    assert.throws(
      () => validateTelegramApiBaseUrl('ftp://localhost:21'),
      /Unsupported protocol 'ftp:': only HTTPS \(or HTTP loopback\) is allowed\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('ws://127.0.0.1:8080'),
      /Unsupported protocol 'ws:': only HTTPS \(or HTTP loopback\) is allowed\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl('file:///localhost/path'),
      /Unsupported protocol 'file:': only HTTPS \(or HTTP loopback\) is allowed\./
    );

    // 3.10g: Invalid URL format rejected
    assert.throws(
      () => validateTelegramApiBaseUrl('not-a-valid-url'),
      /Invalid Telegram API base URL format\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl(''),
      /Telegram API base URL must be a non-empty string\./
    );
    assert.throws(
      () => validateTelegramApiBaseUrl(null),
      /Telegram API base URL must be a non-empty string\./
    );

    // 3.10h: Credentials in URL rejected without leaking into message
    assert.throws(
      () => validateTelegramApiBaseUrl('http://user:secret123@127.0.0.1:8080'),
      (err) => {
        assert.match(err.message, /must not contain user credentials/);
        assert.equal(err.message.includes('secret123'), false, 'Credential must not leak in error message');
        return true;
      }
    );
  });

  await t.test('3.11: telegramApiRequest rejects insecure or invalid base URL with zero transport invocations', async () => {
    let httpCalls = 0;
    let httpsCalls = 0;
    const origHttp = http.request;
    const origHttps = https.request;

    http.request = () => {
      httpCalls++;
      throw new Error('http.request should never be called for rejected endpoint');
    };
    https.request = () => {
      httpsCalls++;
      throw new Error('https.request should never be called for rejected endpoint');
    };

    try {
      // Non-local HTTP
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: 'http://api.telegram.org' });
        },
        /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
      );

      // Resembling loopback HTTP
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: 'http://localhost.example.com' });
        },
        /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
      );

      // Unsupported protocol
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: 'ftp://localhost:21' });
        },
        /Unsupported protocol 'ftp:': only HTTPS \(or HTTP loopback\) is allowed\./
      );

      // Invalid URL string
      await assert.rejects(
        async () => {
          await telegramApiRequest('dummy_tok', 'getMe', null, { apiBaseUrl: 'invalid-url' });
        },
        /Invalid Telegram API base URL format\./
      );

      // Insecure configuration via process.env
      const prevEnv = process.env.TELEGRAM_API_BASE_URL;
      try {
        process.env.TELEGRAM_API_BASE_URL = 'http://insecure-external.com';
        await assert.rejects(
          async () => {
            await telegramApiRequest('dummy_tok', 'getMe');
          },
          /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./
        );
      } finally {
        if (prevEnv === undefined) {
          delete process.env.TELEGRAM_API_BASE_URL;
        } else {
          process.env.TELEGRAM_API_BASE_URL = prevEnv;
        }
      }

      // Assert zero transport invocations occurred across all rejected cases
      assert.equal(httpCalls, 0, 'http.request must have exactly zero invocations');
      assert.equal(httpsCalls, 0, 'https.request must have exactly zero invocations');
    } finally {
      http.request = origHttp;
      https.request = origHttps;
    }
  });

  await t.test('3.12: HTTPS to non-local host passes configuration validation without external network request', async () => {
    let capturedOptions = null;
    const origHttps = https.request;

    https.request = (options) => {
      capturedOptions = options;
      const mockReq = new EventEmitter();
      mockReq.write = () => {};
      mockReq.end = () => {};
      mockReq.destroy = () => {};
      return mockReq;
    };

    try {
      telegramApiRequest('dummy_tok_555', 'getMe', null, {
        apiBaseUrl: 'https://custom-telegram.internal.example.com:8443',
      });

      assert.notEqual(capturedOptions, null, 'https.request was reached after successful validation');
      assert.equal(capturedOptions.hostname, 'custom-telegram.internal.example.com');
      assert.equal(String(capturedOptions.port), '8443');
      assert.equal(capturedOptions.path, '/botdummy_tok_555/getMe');
      assert.equal(capturedOptions.rejectUnauthorized, undefined, 'TLS verification must remain default (enabled)');
    } finally {
      https.request = origHttps;
    }
  });

  await t.test('3.13: CLI Subprocess exits nonzero (1) with exact validation message on insecure/invalid TELEGRAM_API_BASE_URL', async () => {
    // 3.13a: Non-local HTTP via TELEGRAM_API_BASE_URL
    const resRemoteHttp = await runCliSubprocess(['status'], {
      TELEGRAM_API_BASE_URL: 'http://api.telegram.org',
    });
    assert.equal(resRemoteHttp.code, 1, 'Subprocess must exit 1 on remote HTTP');
    assert.match(resRemoteHttp.stderr, /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./);
    assert.doesNotMatch(resRemoteHttp.stderr, /ENOTFOUND|EAI_AGAIN|timed out|TELEGRAM_BOT_TOKEN/, 'Failure must be validation, not network/token');
    assert.doesNotMatch(resRemoteHttp.stdout, /Bot Info:/);

    // 3.13b: Hostname resembling loopback via TELEGRAM_API_BASE_URL
    const resResembling = await runCliSubprocess(['status'], {
      TELEGRAM_API_BASE_URL: 'http://localhost.example.com',
    });
    assert.equal(resResembling.code, 1, 'Subprocess must exit 1 on pseudo-loopback');
    assert.match(resResembling.stderr, /Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required\./);

    // 3.13c: Unsupported protocol via TELEGRAM_API_BASE_URL
    const resFtp = await runCliSubprocess(['status'], {
      TELEGRAM_API_BASE_URL: 'ftp://localhost:21',
    });
    assert.equal(resFtp.code, 1, 'Subprocess must exit 1 on FTP protocol');
    assert.match(resFtp.stderr, /Unsupported protocol 'ftp:': only HTTPS \(or HTTP loopback\) is allowed\./);

    // 3.13d: Invalid URL format via TELEGRAM_API_BASE_URL
    const resInvalid = await runCliSubprocess(['status'], {
      TELEGRAM_API_BASE_URL: 'not-a-valid-url',
    });
    assert.equal(resInvalid.code, 1, 'Subprocess must exit 1 on invalid URL format');
    assert.match(resInvalid.stderr, /Invalid Telegram API base URL format\./);
  });
});

// =========================================================================
// Suite 4: SHADOW Mode Verification in Seeder & Smoke Pre-check (Finding 6)
// =========================================================================
test('Suite 4: SHADOW Mode Enforcement in Seeder & Pre-Ingestion Guard', async (t) => {
  const initClient = new Client({ connectionString: ISOLATED_TEST_DB_URL });
  await initClient.connect();
  try {
    await initClient.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
    await initClient.query(`DROP SCHEMA IF EXISTS supabase_migrations CASCADE;`);
    await initClient.query(`CREATE SCHEMA IF NOT EXISTS auth;`);
    await initClient.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key default gen_random_uuid(), email text);`);
    await initClient.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`);
    await initClient.query(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;`);
  } finally {
    await initClient.end();
  }

  // Apply all 13 official migrations to isolated database
  await runPrototypeMigrations(ISOLATED_TEST_DB_URL, {
    logger: { log: () => {}, error: () => {} },
  });

  const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
  await client.connect();

  try {

    await t.test('4.1: Seeder reports shadowGuaranteed: true only when mode is SHADOW', async () => {
      await client.query(`
        INSERT INTO public.automation_settings (singleton, mode, emergency_stop, version)
        VALUES (true, 'SHADOW', false, 1)
        ON CONFLICT (singleton) DO UPDATE SET mode = 'SHADOW', emergency_stop = false;
      `);

      const res = await runPrototypeSeed(ISOLATED_TEST_DB_URL, {
        logger: { log: () => {}, warn: () => {} },
      });
      assert.equal(res.ok, true);
      assert.equal(res.shadowGuaranteed, true);
      assert.equal(res.mode, 'SHADOW');
    });

    await t.test('4.2: Seeder reports shadowGuaranteed: false and warns when mode is NOT SHADOW', async () => {
      await client.query(`UPDATE public.automation_settings SET mode = 'FULL', emergency_stop = false;`);

      const res = await runPrototypeSeed(ISOLATED_TEST_DB_URL, {
        logger: { log: () => {}, warn: () => {} },
      });
      assert.equal(res.ok, true);
      assert.equal(res.shadowGuaranteed, false, 'Must NOT report shadowGuaranteed when mode is FULL');
      assert.equal(res.mode, 'FULL');
    });

    await t.test('4.3: Seeder with requireShadow: true throws error when mode is NOT SHADOW', async () => {
      await client.query(`UPDATE public.automation_settings SET mode = 'LOS_AND_GENERIC', emergency_stop = false;`);

      await assert.rejects(
        async () => {
          await runPrototypeSeed(ISOLATED_TEST_DB_URL, {
            requireShadow: true,
            logger: { log: () => {}, warn: () => {} },
          });
        },
        /FAIL-CLOSED: Current automation_settings mode is 'LOS_AND_GENERIC'/
      );
    });

    await t.test('4.4: Smoke test pre-ingestion check halts test if mode is not SHADOW', async () => {
      await client.query(`UPDATE public.automation_settings SET mode = 'FULL', emergency_stop = false;`);

      let testMessageWasInjected = false;
      const mockHttp = async (url, opts) => {
        if (url.includes('/api/webhooks/telegram') && opts?.body?.includes('SmokeTest')) {
          testMessageWasInjected = true;
        }
        return { status: 200, headers: {}, body: '{}' };
      };

      const smokeRes = await runDeploymentSmokeTest({
        baseUrl: 'https://test-deploy.example.com',
        dbUrl: ISOLATED_TEST_DB_URL,
        webhookSecret: 'secret',
        logger: { log: () => {}, warn: () => {}, error: () => {} },
        httpRequester: mockHttp,
      });

      assert.equal(smokeRes.checks.preIngestionShadow.pass, false);
      assert.match(smokeRes.checks.preIngestionShadow.error, /Current mode is 'FULL', not 'SHADOW'/);
      assert.equal(testMessageWasInjected, false, 'Test message injection MUST be halted when mode is not SHADOW');
      assert.equal(smokeRes.allPassed, false);
    });
  } finally {
    // Restore mode to SHADOW
    await client.query(`UPDATE public.automation_settings SET mode = 'SHADOW', emergency_stop = false;`);
    await client.end();
  }
});

// =========================================================================
// Suite 5: Smoke Test Integrity, Polling & Schema Accuracy (Finding 1 & 3)
// =========================================================================
test('Suite 5: Smoke Test Integrity, Polling & Schema Accuracy', async (t) => {
  await t.test('5.1: Missing DB URL or staff credentials causes explicit failure, NOT silent PASS', async () => {
    const mockHttp = async (url) => {
      if (url.endsWith('/dashboard')) return { status: 307, headers: { location: '/login' }, body: '' };
      if (url.endsWith('/api/inbox/conversations')) return { status: 401, headers: {}, body: '' };
      return { status: 200, headers: {}, body: '{}' };
    };

    const resNoDb = await runDeploymentSmokeTest({
      baseUrl: 'https://test-deploy.example.com',
      dbUrl: null, // missing DB
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      httpRequester: mockHttp,
    });

    assert.equal(resNoDb.checks.dbConnection.pass, false);
    assert.equal(resNoDb.checks.staffAuth.pass, false);
    assert.equal(resNoDb.allPassed, false, 'Must NOT pass when DB or auth is missing');
  });

  await t.test('5.2: Bounded polling for job completion fails on timeout or job failure', async () => {
    // Mock DB client returning pending status forever
    const mockPgClientPending = {
      query: async () => ({
        rows: [{ ingress_id: '00000000-0000-0000-0000-000000000001', status: 'pending', attempt_count: 0 }],
      }),
    };

    const pollTimeout = await pollJobCompletion(mockPgClientPending, '00000000-0000-0000-0000-000000000001', {
      maxWaitMs: 300,
      intervalMs: 50,
    });
    assert.equal(pollTimeout.ok, false);
    assert.match(pollTimeout.error, /Job processing timed out/);

    // Mock DB client returning terminal failure
    const mockPgClientFailed = {
      query: async () => ({
        rows: [
          {
            ingress_id: '00000000-0000-0000-0000-000000000002',
            status: 'failed',
            attempt_count: 3,
            last_error: 'Terminal unrecoverable error',
          },
        ],
      }),
    };

    const pollFailed = await pollJobCompletion(mockPgClientFailed, '00000000-0000-0000-0000-000000000002', {
      maxWaitMs: 300,
      intervalMs: 50,
    });
    assert.equal(pollFailed.ok, false);
    assert.match(pollFailed.error, /Job permanently failed: Terminal unrecoverable error/);
  });

  await t.test('5.3: Webhook response envelope validation rejects ignored or duplicate status', async () => {
    const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
    await client.connect();

    try {
      // Mock HTTP returning ignored status
      const mockHttpIgnored = async (url, opts) => {
        if (url.includes('/api/webhooks/telegram')) {
          if (opts.headers['X-Telegram-Bot-Api-Secret-Token'] === 'valid_secret') {
            return {
              status: 200,
              headers: {},
              body: JSON.stringify({
                success: true,
                data: { status: 'ignored', reason: 'not_in_tester_allowlist' },
                error: null,
              }),
            };
          }
          return { status: 401, headers: {}, body: 'Unauthorized' };
        }
        if (url.endsWith('/dashboard')) return { status: 307, headers: { location: '/login' }, body: '' };
        if (url.endsWith('/api/inbox/conversations')) return { status: 401, headers: {}, body: '' };
        return { status: 200, headers: {}, body: '{}' };
      };

      const res = await runDeploymentSmokeTest({
        baseUrl: 'https://test-deploy.example.com',
        dbUrl: ISOLATED_TEST_DB_URL,
        webhookSecret: 'valid_secret',
        logger: { log: () => {}, warn: () => {}, error: () => {} },
        httpRequester: mockHttpIgnored,
      });

      assert.equal(res.checks.webhookIngestionAndShadow.pass, false);
      assert.match(res.checks.webhookIngestionAndShadow.error, /Webhook did not accept message/);
    } finally {
      await client.end();
    }
  });

  await t.test('5.4: Schema accuracy: assertions query real columns without nonexistent fields', async () => {
    const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
    await client.connect();

    try {
      const ingressId = '77777777-0000-4000-8000-000000000001';
      const complaintId = '88888888-0000-4000-8000-000000000001';
      const conversationId = '99999999-0000-4000-8000-000000000001';
      const identityId = '60000000-0000-4000-8000-000000000099';

      // Seed exact rows using actual schema
      await client.query(`
        INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot)
        VALUES ('${identityId}', 'telegram', 'upaznet_helpdesk_bot', '6727338166', 'Tester')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, mode, settings_version, emergency_stop)
        VALUES ('${ingressId}', '${identityId}', 'telegram', 'upaznet_helpdesk_bot', '6727338166', '123456', 'test body', 'SHADOW', 1, false)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at)
        VALUES ('${conversationId}', '${identityId}', 'telegram', 'upaznet_helpdesk_bot', '6727338166', 'active', now(), now())
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.complaints (id, identity_id, status, category, version)
        VALUES ('${complaintId}', '${identityId}', 'NEW', 'connection_complaint', 1)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.messages (id, identity_id, complaint_id, classification, conversation_id)
        VALUES ('${ingressId}', '${identityId}', '${complaintId}', '{"category": "connection_complaint"}'::jsonb, '${conversationId}')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.processing_jobs (ingress_id, status, attempt_count, completed_at)
        VALUES ('${ingressId}', 'done', 1, now())
        ON CONFLICT (ingress_id) DO NOTHING;

        INSERT INTO public.triage_assessments (message_id, decision, processing_result)
        VALUES ('${ingressId}', '{"candidate": "GENERIC"}'::jsonb, '{"processed": true}'::jsonb)
        ON CONFLICT (message_id) DO NOTHING;
      `);

      // Verify that the queries executed in smoke-test-deployment run cleanly and return exact data
      const { rows: ingressRows } = await client.query(
        `SELECT id, identity_id, channel, account_id, chat_id, provider_message_id, mode, emergency_stop
         FROM public.ingress_events WHERE id = $1;`,
        [ingressId]
      );
      assert.equal(ingressRows.length, 1);
      assert.equal(ingressRows[0].chat_id, '6727338166');
      assert.equal(ingressRows[0].mode, 'SHADOW');

      const { rows: jobRows } = await client.query(
        `SELECT ingress_id, status, attempt_count, max_attempts, completed_at, last_error
         FROM public.processing_jobs WHERE ingress_id = $1;`,
        [ingressId]
      );
      assert.equal(jobRows.length, 1);
      assert.equal(jobRows[0].status, 'done');
      assert.equal(jobRows[0].attempt_count, 1);

      const { rows: msgRows } = await client.query(
        `SELECT m.id, m.identity_id, m.complaint_id, m.classification, m.conversation_id
         FROM public.messages m WHERE m.id = $1;`,
        [ingressId]
      );
      assert.equal(msgRows.length, 1);
      assert.equal(msgRows[0].complaint_id, complaintId);

      const { rows: outboundRows } = await client.query(
        `SELECT id, origin, status
         FROM public.outbound_intents
         WHERE message_id = $1 OR (complaint_id = $2 AND origin = 'automatic');`,
        [ingressId, complaintId]
      );
      assert.equal(outboundRows.length, 0);

      const { rows: claimRows } = await client.query(
        `SELECT owner_id, scope_kind, scope_id
         FROM public.reply_claims
         WHERE complaint_id = $1;`,
        [complaintId]
      );
      assert.equal(claimRows.length, 0);
    } finally {
      await client.end();
    }
  });

  await t.test('5.5: Full smoke test execution with all valid checks yields allPassed === true', async () => {
    const client = new Client({ connectionString: ISOLATED_TEST_DB_URL });
    await client.connect();

    try {
      await client.query(`
        UPDATE public.automation_settings
        SET mode = 'SHADOW', emergency_stop = false
        WHERE singleton = true;
      `);

      const ingressId = '77777777-1111-4000-8000-000000000001';
      const complaintId = '88888888-1111-4000-8000-000000000001';
      const conversationId = '99999999-1111-4000-8000-000000000001';
      const identityId = '60000000-5555-4000-8000-000000000099';
      const testerChatId = '6727338999';

      const mockHttp = async (url, opts = {}) => {
        const u = new URL(url);
        const cookie = opts.headers?.Cookie || '';

        if (u.pathname === '/') {
          return { status: 200, headers: {}, body: 'OK' };
        }

        if (u.pathname === '/dashboard') {
          if (cookie.includes('sb-auth-token=active_session')) {
            return { status: 200, headers: {}, body: '<html>Dashboard</html>' };
          }
          return { status: 307, headers: { location: '/login' }, body: '' };
        }

        if (u.pathname === '/api/inbox/conversations') {
          if (cookie.includes('sb-auth-token=active_session')) {
            return { status: 200, headers: {}, body: JSON.stringify({ conversations: [] }) };
          }
          return { status: 401, headers: {}, body: 'Unauthorized' };
        }

        if (u.pathname === '/api/webhooks/telegram') {
          const secret = opts.headers?.['X-Telegram-Bot-Api-Secret-Token'];
          if (secret !== 'valid_webhook_secret') {
            return { status: 401, headers: {}, body: 'Unauthorized webhook' };
          }

          const parsedBody = JSON.parse(opts.body || '{}');
          const msg = parsedBody.message;
          const providerMsgId = String(msg?.message_id || '999999');

          await client.query(`
            INSERT INTO public.channel_identities (id, channel, channel_account_id, sender_external_id, display_name_snapshot)
            VALUES ('${identityId}', 'telegram', 'upaznet_helpdesk_bot', '${testerChatId}', 'Tester')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.ingress_events (id, identity_id, channel, account_id, chat_id, provider_message_id, body, mode, settings_version, emergency_stop)
            VALUES ('${ingressId}', '${identityId}', 'telegram', 'upaznet_helpdesk_bot', '${testerChatId}', '${providerMsgId}', '${msg?.text || 'body'}', 'SHADOW', 1, false)
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.conversations (id, identity_id, channel, account_id, chat_id, status, started_at, last_activity_at)
            VALUES ('${conversationId}', '${identityId}', 'telegram', 'upaznet_helpdesk_bot', '${testerChatId}', 'active', now(), now())
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.complaints (id, identity_id, status, category, version)
            VALUES ('${complaintId}', '${identityId}', 'NEW', 'connection_complaint', 1)
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.messages (id, identity_id, complaint_id, classification, conversation_id)
            VALUES ('${ingressId}', '${identityId}', '${complaintId}', '{"category": "connection_complaint"}'::jsonb, '${conversationId}')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.processing_jobs (ingress_id, status, attempt_count, completed_at)
            VALUES ('${ingressId}', 'done', 1, now())
            ON CONFLICT (ingress_id) DO NOTHING;

            INSERT INTO public.triage_assessments (message_id, decision, processing_result)
            VALUES ('${ingressId}', '{"candidate": "GENERIC"}'::jsonb, '{"processed": true}'::jsonb)
            ON CONFLICT (message_id) DO NOTHING;
          `);

          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              success: true,
              data: {
                status: 'accepted',
                duplicate: false,
                ingressId: ingressId,
              },
              error: null,
            }),
          };
        }

        return { status: 404, headers: {}, body: 'Not found' };
      };

      const mockAuthClientFactory = (cookieJar) => ({
        auth: {
          signInWithPassword: async ({ email, password }) => {
            if (email === 'staff@upaznet.test' && password === 'ValidPassword123!') {
              cookieJar.set('sb-auth-token', 'active_session');
              return { data: { session: { user: { email } } }, error: null };
            }
            return { data: null, error: new Error('Invalid credentials') };
          },
          signOut: async () => {
            cookieJar.clear();
            return { error: null };
          },
        },
      });

      const res = await runDeploymentSmokeTest({
        baseUrl: 'https://test-deploy.example.com',
        dbUrl: ISOLATED_TEST_DB_URL,
        webhookSecret: 'valid_webhook_secret',
        testerId: testerChatId,
        staffEmail: 'staff@upaznet.test',
        staffPassword: 'ValidPassword123!',
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'dummy-anon-key',
        httpRequester: mockHttp,
        authClientFactory: mockAuthClientFactory,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });

      assert.equal(res.allPassed, true);
      assert.equal(res.checks.httpsReachable.pass, true);
      assert.equal(res.checks.unauthenticatedProtected.pass, true);
      assert.equal(res.checks.dbConnection.pass, true);
      assert.equal(res.checks.webhookSecurity.pass, true);
      assert.equal(res.checks.preIngestionShadow.pass, true);
      assert.equal(res.checks.webhookIngestionAndShadow.pass, true);
      assert.equal(res.checks.staffAuth.pass, true);
    } finally {
      await client.end();
    }
  });

  await t.test('5.6: isValidLoginRedirect validates 307/302 and strict /login destination, rejecting non-redirects and invalid targets', () => {
    const base = 'https://deploy.example.com';

    // Valid redirects (relative and absolute)
    assert.equal(isValidLoginRedirect(307, '/login', base), true);
    assert.equal(isValidLoginRedirect(302, '/login', base), true);
    assert.equal(isValidLoginRedirect(307, 'https://deploy.example.com/login', base), true);
    assert.equal(isValidLoginRedirect(302, '/login?redirect=/dashboard', base), true);
    assert.equal(isValidLoginRedirect(307, '  /login  ', base), true);

    // Protocol-relative and uppercase scheme origin validation
    assert.equal(isValidLoginRedirect(307, '//deploy.example.com/login', base), true, '//deploy.example.com/login must be accepted');
    assert.equal(isValidLoginRedirect(307, '//other.example/login', base), false, '//other.example/login must be rejected due to different origin');
    assert.equal(isValidLoginRedirect(307, 'HTTPS://deploy.example.com/login', base), true, 'HTTPS://deploy.example.com/login must be accepted');
    assert.equal(isValidLoginRedirect(307, 'HTTPS://other.example/login', base), false, 'HTTPS://other.example/login must be rejected due to different origin');

    // 302 variants of origin validation
    assert.equal(isValidLoginRedirect(302, '//deploy.example.com/login', base), true);
    assert.equal(isValidLoginRedirect(302, '//other.example/login', base), false);
    assert.equal(isValidLoginRedirect(302, 'HTTPS://deploy.example.com/login', base), true);
    assert.equal(isValidLoginRedirect(302, 'HTTPS://other.example/login', base), false);

    // Invalid status codes
    assert.equal(isValidLoginRedirect(200, '/login', base), false, '200 with Location must be rejected');
    assert.equal(isValidLoginRedirect(401, '/login', base), false);
    assert.equal(isValidLoginRedirect(500, '/login', base), false);

    // Invalid destinations
    assert.equal(isValidLoginRedirect(307, '/dashboard', base), false, 'Redirect to /dashboard must be rejected');
    assert.equal(isValidLoginRedirect(307, '/maintenance', base), false, 'Redirect to /maintenance must be rejected');
    assert.equal(isValidLoginRedirect(307, '/login-malicious', base), false, 'Substring match /login-malicious must be rejected');
    assert.equal(isValidLoginRedirect(307, '/auth/login', base), false, 'Non-root login path must be rejected');
    assert.equal(isValidLoginRedirect(307, '/login/sub', base), false, 'Subpath under /login must be rejected');

    // Off-origin redirects
    assert.equal(isValidLoginRedirect(307, 'https://attacker.com/login', base), false, 'Off-origin redirect must be rejected');

    // Missing or invalid location headers
    assert.equal(isValidLoginRedirect(307, '', base), false);
    assert.equal(isValidLoginRedirect(307, null, base), false);
    assert.equal(isValidLoginRedirect(307, '   ', base), false);
  });

  await t.test('5.7: Check 2 rejects non-login redirect destinations and HTTP 200 on /dashboard', async () => {
    // 5.7a: Status 307 with /maintenance destination
    const mockHttpMaintenance = async (url) => {
      if (url.endsWith('/dashboard')) return { status: 307, headers: { location: '/maintenance' }, body: '' };
      if (url.endsWith('/api/inbox/conversations')) return { status: 401, headers: {}, body: '' };
      return { status: 200, headers: {}, body: '{}' };
    };

    const resMaintenance = await runDeploymentSmokeTest({
      baseUrl: 'https://test-deploy.example.com',
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      httpRequester: mockHttpMaintenance,
    });
    assert.equal(resMaintenance.checks.unauthenticatedProtected.pass, false);
    assert.equal(resMaintenance.checks.unauthenticatedProtected.dashboardRedirectValid, false);
    assert.equal(resMaintenance.allPassed, false);

    // 5.7b: Status 200 with Location: /login (not a valid redirect status)
    const mockHttp200WithLocation = async (url) => {
      if (url.endsWith('/dashboard')) return { status: 200, headers: { location: '/login' }, body: 'OK' };
      if (url.endsWith('/api/inbox/conversations')) return { status: 401, headers: {}, body: '' };
      return { status: 200, headers: {}, body: '{}' };
    };

    const res200 = await runDeploymentSmokeTest({
      baseUrl: 'https://test-deploy.example.com',
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      httpRequester: mockHttp200WithLocation,
    });
    assert.equal(res200.checks.unauthenticatedProtected.pass, false);
    assert.equal(res200.allPassed, false);
  });

  await t.test('5.8: Check 5 fails when signOut returns error, even if cookies are cleared and subsequent requests are rejected', async () => {
    const mockAuthClientSignOutFail = (jar) => ({
      auth: {
        signInWithPassword: async ({ email }) => {
          jar.set('sb-auth-token', 'active_session');
          return { data: { session: { user: { email } } }, error: null };
        },
        signOut: async () => {
          jar.clear(); // Cookies cleared locally
          return { error: new Error('Simulated network failure on session revocation') };
        },
      },
    });

    const mockHttp = async (url, opts = {}) => {
      const u = new URL(url);
      const cookie = opts.headers?.Cookie || '';

      if (u.pathname === '/') return { status: 200, headers: {}, body: 'OK' };
      if (u.pathname === '/dashboard') {
        if (cookie.includes('sb-auth-token=active_session')) {
          return { status: 200, headers: {}, body: '<html>Dashboard</html>' };
        }
        return { status: 307, headers: { location: '/login' }, body: '' };
      }
      if (u.pathname === '/api/inbox/conversations') {
        if (cookie.includes('sb-auth-token=active_session')) {
          return { status: 200, headers: {}, body: '{}' };
        }
        return { status: 401, headers: {}, body: 'Unauthorized' };
      }
      return { status: 404, headers: {}, body: 'Not found' };
    };

    const res = await runDeploymentSmokeTest({
      baseUrl: 'https://test-deploy.example.com',
      staffEmail: 'staff@upaznet.test',
      staffPassword: 'ValidPassword123!',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'dummy-anon-key',
      httpRequester: mockHttp,
      authClientFactory: mockAuthClientSignOutFail,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(res.checks.staffAuth.loginSuccess, true);
    assert.equal(res.checks.staffAuth.dashboardAuthed, true);
    assert.equal(res.checks.staffAuth.apiAuthed, true);
    assert.equal(res.checks.staffAuth.signOutSuccess, false);
    assert.match(res.checks.staffAuth.signOutError, /Simulated network failure/);
    assert.equal(res.checks.staffAuth.postLogoutDashboardProtected, true);
    assert.equal(res.checks.staffAuth.postLogoutApiProtected, true);
    assert.equal(res.checks.staffAuth.pass, false);
    assert.equal(res.allPassed, false);
  });

  await t.test('5.9: Check 5 fails when post-logout redirect does not point to /login', async () => {
    const mockAuthClientOk = (jar) => ({
      auth: {
        signInWithPassword: async ({ email }) => {
          jar.set('sb-auth-token', 'active_session');
          return { data: { session: { user: { email } } }, error: null };
        },
        signOut: async () => {
          jar.clear();
          return { error: null };
        },
      },
    });

    const mockHttpWrongPostLogout = async (url, opts = {}) => {
      const u = new URL(url);
      const cookie = opts.headers?.Cookie || '';

      if (u.pathname === '/dashboard') {
        if (cookie.includes('sb-auth-token=active_session')) {
          return { status: 200, headers: {}, body: '<html>Dashboard</html>' };
        }
        // Redirect to /maintenance instead of /login
        return { status: 307, headers: { location: '/maintenance' }, body: '' };
      }
      if (u.pathname === '/api/inbox/conversations') {
        if (cookie.includes('sb-auth-token=active_session')) {
          return { status: 200, headers: {}, body: '{}' };
        }
        return { status: 401, headers: {}, body: 'Unauthorized' };
      }
      return { status: 200, headers: {}, body: '{}' };
    };

    const res = await runDeploymentSmokeTest({
      baseUrl: 'https://test-deploy.example.com',
      staffEmail: 'staff@upaznet.test',
      staffPassword: 'ValidPassword123!',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'dummy-anon-key',
      httpRequester: mockHttpWrongPostLogout,
      authClientFactory: mockAuthClientOk,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(res.checks.staffAuth.signOutSuccess, true);
    assert.equal(res.checks.staffAuth.postLogoutDashboardProtected, false);
    assert.equal(res.checks.staffAuth.pass, false);
    assert.equal(res.allPassed, false);
  });
});

