#!/usr/bin/env node
/**
 * scripts/manage-telegram-webhook.mjs
 *
 * Secure Telegram Webhook Management Script.
 * - Inspects current webhook configuration (URL, pending updates, allowed updates, IP)
 * - Configures webhook to target HTTPS deployment URL with secret token
 * - drop_pending_updates is FALSE by default to avoid losing updates
 * - Allows restoring previous webhook URL for rollback/recovery
 * - Never prints or leaks bot tokens or webhook secrets to console
 */

import https from 'node:https';
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

export function telegramApiRequest(token, method, payload = null) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/${method}`,
      method: payload ? 'POST' : 'GET',
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          }
        : {},
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse Telegram API response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export async function getWebhookStatus(token) {
  const [meRes, whRes] = await Promise.all([
    telegramApiRequest(token, 'getMe'),
    telegramApiRequest(token, 'getWebhookInfo'),
  ]);

  return {
    bot: meRes.ok ? meRes.result : null,
    webhook: whRes.ok ? whRes.result : null,
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

  const res = await telegramApiRequest(token, 'setWebhook', payload);
  return res;
}

export async function deleteWebhook(token, dropPendingUpdates = false) {
  return telegramApiRequest(token, 'deleteWebhook', { drop_pending_updates: dropPendingUpdates });
}

// CLI handler
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const localEnv = loadLocalEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN || localEnv.TELEGRAM_BOT_TOKEN;
  const defaultSecret = process.env.TELEGRAM_WEBHOOK_SECRET || localEnv.TELEGRAM_WEBHOOK_SECRET;

  if (!token) {
    console.error('[Telegram] Error: TELEGRAM_BOT_TOKEN is not set.');
    process.exit(1);
  }

  const action = process.argv[2] || 'status';

  if (action === 'status') {
    getWebhookStatus(token)
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
          console.log(`  Last Error (${new Date(status.webhook.last_error_date * 1000).toISOString()}): ${status.webhook.last_error_message}`);
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
    setWebhookUrl(token, targetUrl, secret, { dropPendingUpdates: false })
      .then((res) => {
        console.log('[Telegram] Result:', JSON.stringify(res, null, 2));
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
    setWebhookUrl(token, restoreUrl, secret, { dropPendingUpdates: false })
      .then((res) => {
        console.log('[Telegram] Result:', JSON.stringify(res, null, 2));
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
