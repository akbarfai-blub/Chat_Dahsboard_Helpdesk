#!/usr/bin/env node
/**
 * scripts/manage-telegram-webhook.mjs
 *
 * Secure Telegram Webhook Management Script.
 * - Inspects current webhook configuration (URL, pending updates, allowed updates, IP).
 * - Configures webhook to target HTTPS deployment URL with secret token.
 * - drop_pending_updates is FALSE by default to avoid losing updates.
 * - Explicitly verifies actual webhook configuration via getWebhookInfo after set/restore.
 * - Fails with nonzero exit on ok: false, HTTP non-200, timeout, or configuration mismatch.
 * - Never prints or leaks bot tokens or webhook secrets to console/logs.
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadLocalEnv() {
  const env = {};
  const envFile = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

export function validateTelegramApiBaseUrl(rawUrl = 'https://api.telegram.org') {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Telegram API base URL must be a non-empty string.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Telegram API base URL format.');
  }

  const protocol = parsed.protocol;
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Unsupported protocol '${protocol}': only HTTPS (or HTTP loopback) is allowed.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Telegram API base URL must not contain user credentials.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1';

  if (protocol === 'http:' && !isLoopback) {
    throw new Error('Insecure HTTP protocol is strictly prohibited for non-local hosts; HTTPS is required.');
  }

  return parsed;
}

export async function telegramApiRequest(token, method, payload = null, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const customRequester = options.requester;

  if (customRequester) {
    const res = await customRequester(method, payload);
    if (!res || !res.ok) {
      const desc = res?.description || 'Unknown error';
      const code = res?.error_code || 'ERROR';
      throw new Error(`Telegram API request '${method}' failed: [${code}] ${desc}`);
    }
    return res;
  }

  const rawBaseUrl = options.apiBaseUrl !== undefined
    ? options.apiBaseUrl
    : (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org');
  const parsedBase = validateTelegramApiBaseUrl(rawBaseUrl);
  const isHttps = parsedBase.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : null;
    const basePath = parsedBase.pathname.replace(/\/$/, '');
    const reqOptions = {
      hostname: parsedBase.hostname,
      port: parsedBase.port || (isHttps ? 443 : 80),
      path: `${basePath}/bot${token}/${method}`,
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          }
        : {},
      timeout: timeoutMs,
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return reject(new Error(`Failed to parse Telegram API response (HTTP ${res.statusCode})`));
        }

        if (res.statusCode !== 200 || !parsed.ok) {
          const desc = parsed.description || `HTTP ${res.statusCode}`;
          const code = parsed.error_code || res.statusCode;
          return reject(new Error(`Telegram API request '${method}' failed: [${code}] ${desc}`));
        }

        resolve(parsed);
      });
    });

    let timedOut = false;
    req.on('timeout', () => {
      timedOut = true;
      req.destroy();
      reject(new Error(`Telegram API request '${method}' timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      if (timedOut) return;
      const sanitized = token ? String(err.message).split(token).join('[REDACTED_TOKEN]') : err.message;
      reject(new Error(`Telegram API network error on '${method}': ${sanitized}`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

export async function getWebhookStatus(token, options = {}) {
  const [meRes, whRes] = await Promise.all([
    telegramApiRequest(token, 'getMe', null, options),
    telegramApiRequest(token, 'getWebhookInfo', null, options),
  ]);

  return {
    bot: meRes.result,
    webhook: whRes.result,
  };
}

export async function setWebhookUrl(token, webhookUrl, secretToken, options = {}) {
  const dropPendingUpdates = options.dropPendingUpdates ?? false;
  const payload = {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: dropPendingUpdates,
  };

  const setRes = await telegramApiRequest(token, 'setWebhook', payload, options);
  if (!setRes.ok) {
    throw new Error(`Telegram setWebhook failed: ${setRes.description || 'Unknown error'}`);
  }

  // Mandatory verification: verify that getWebhookInfo reflects the configured URL
  const verifyRes = await telegramApiRequest(token, 'getWebhookInfo', null, options);
  if (!verifyRes.ok) {
    throw new Error(`Failed to verify webhook after configuration: ${verifyRes.description || 'Unknown error'}`);
  }

  const actualUrl = verifyRes.result?.url;
  if (actualUrl !== webhookUrl) {
    throw new Error(`Webhook configuration mismatch: expected '${webhookUrl}', Telegram reports '${actualUrl || '(empty)'}'`);
  }

  return {
    ok: true,
    result: setRes.result,
    webhook: verifyRes.result,
  };
}

export async function restoreWebhookUrl(token, restoreUrl, secretToken, options = {}) {
  return setWebhookUrl(token, restoreUrl, secretToken, options);
}

export async function deleteWebhook(token, dropPendingUpdates = false, options = {}) {
  return telegramApiRequest(token, 'deleteWebhook', { drop_pending_updates: dropPendingUpdates }, options);
}

// CLI handler
const isCliEntry = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
      path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase())
);

if (isCliEntry) {
  const localEnv = loadLocalEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN || localEnv.TELEGRAM_BOT_TOKEN;
  const defaultSecret = process.env.TELEGRAM_WEBHOOK_SECRET || localEnv.TELEGRAM_WEBHOOK_SECRET;

  if (!token) {
    console.error('[Telegram] Error: TELEGRAM_BOT_TOKEN is not set.');
    process.exit(1);
  }

  const cliOptions = {};
  const envApiBaseUrl = process.env.TELEGRAM_API_BASE_URL;
  if (envApiBaseUrl !== undefined) {
    try {
      validateTelegramApiBaseUrl(envApiBaseUrl);
    } catch (err) {
      console.error('[Telegram] Error:', err.message);
      process.exit(1);
    }
    cliOptions.apiBaseUrl = envApiBaseUrl;
  }
  const timeoutMs = process.env.TELEGRAM_REQUEST_TIMEOUT_MS
    ? parseInt(process.env.TELEGRAM_REQUEST_TIMEOUT_MS, 10)
    : undefined;
  if (timeoutMs) cliOptions.timeoutMs = timeoutMs;

  const action = process.argv[2] || 'status';

  if (action === 'status') {
    getWebhookStatus(token, cliOptions)
      .then((status) => {
        console.log('[Telegram] Bot Info:');
        console.log(`  ID: ${status.bot?.id}`);
        console.log(`  Username: @${status.bot?.username}`);
        console.log(`  Name: ${status.bot?.first_name}`);
        console.log('[Telegram] Current Webhook Info:');
        console.log(`  URL: ${status.webhook?.url || '(none)'}`);
        console.log(`  Pending Updates: ${status.webhook?.pending_update_count ?? 0}`);
        console.log(`  Allowed Updates: ${(status.webhook?.allowed_updates || []).join(', ')}`);
        console.log(`  Has Custom Cert: ${status.webhook?.has_custom_certificate}`);
        if (status.webhook?.last_error_message) {
          console.log(`  Last Error: ${status.webhook.last_error_message}`);
        }
      })
      .catch((err) => {
        console.error('[Telegram] Error:', err.message);
        process.exit(1);
      });
  } else if (action === 'set') {
    const targetUrl = process.argv[3];
    const secret = process.argv[4] || defaultSecret;
    if (!targetUrl) {
      console.error('Usage: node scripts/manage-telegram-webhook.mjs set <WEBHOOK_URL> [SECRET]');
      process.exit(1);
    }
    if (!targetUrl.startsWith('https://')) {
      console.error('Error: Webhook URL must be HTTPS.');
      process.exit(1);
    }
    if (!secret) {
      console.error('Error: Webhook secret is required.');
      process.exit(1);
    }

    console.log(`[Telegram] Setting webhook to: ${targetUrl} (drop_pending_updates: false)...`);
    setWebhookUrl(token, targetUrl, secret, { dropPendingUpdates: false, ...cliOptions })
      .then((res) => {
        console.log('[Telegram] Webhook successfully configured and verified:');
        console.log(`  URL: ${res.webhook?.url}`);
        console.log(`  Allowed Updates: ${(res.webhook?.allowed_updates || []).join(', ')}`);
        console.log(`  Pending Updates: ${res.webhook?.pending_update_count ?? 0}`);
      })
      .catch((err) => {
        console.error('[Telegram] Error:', err.message);
        process.exit(1);
      });
  } else if (action === 'restore') {
    const restoreUrl = process.argv[3];
    const secret = process.argv[4] || defaultSecret;
    if (!restoreUrl) {
      console.error('Usage: node scripts/manage-telegram-webhook.mjs restore <OLD_URL> [SECRET]');
      process.exit(1);
    }
    console.log(`[Telegram] Restoring webhook to: ${restoreUrl}...`);
    restoreWebhookUrl(token, restoreUrl, secret, { dropPendingUpdates: false, ...cliOptions })
      .then((res) => {
        console.log('[Telegram] Webhook successfully restored and verified:');
        console.log(`  URL: ${res.webhook?.url}`);
      })
      .catch((err) => {
        console.error('[Telegram] Error:', err.message);
        process.exit(1);
      });
  } else {
    console.error('Unknown action. Supported: status, set, restore');
    process.exit(1);
  }
}
