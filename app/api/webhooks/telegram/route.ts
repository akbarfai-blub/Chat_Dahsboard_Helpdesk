import { getHelpdeskPool } from "../../../../lib/postgres/server";
import { HelpdeskPersistence } from "../../../../lib/application/helpdesk-persistence";
import {
  handleTelegramWebhook,
  type PersistenceFactory,
} from "../../../../lib/application/telegram-inbound-service";

export const dynamic = "force-dynamic";

/**
 * Lazy persistence factory for the Telegram webhook route.
 * getHelpdeskPool() is only called after webhook secret and payload size verifications succeed.
 */
export const defaultPersistenceFactory: PersistenceFactory = () => {
  const pool = getHelpdeskPool();
  return new HelpdeskPersistence(pool);
};

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, defaultPersistenceFactory);
}
