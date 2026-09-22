import "server-only";
import { createClient } from "../supabase/server";
import { getHelpdeskPool } from "../postgres/server";
import { HelpdeskPersistence } from "./helpdesk-persistence";
import { linkVerifiedIdentity, type IdentityLinkCommand } from "./link-identity";
import { PersistenceError, type StaffEpisodeAction } from "./persistence-contracts";

async function sessionStaffId(): Promise<string> {
  const auth = await createClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) throw new PersistenceError("unauthenticated");
  return data.user.id;
}

// These are internal server services, not public endpoints or Server Actions.
export async function mutateStaffEpisode(input: StaffEpisodeAction) {
  const staffId = await sessionStaffId();
  return new HelpdeskPersistence(getHelpdeskPool()).staffAction(staffId, input);
}

export async function verifyAndLinkIdentity(input: IdentityLinkCommand) {
  const staffId = await sessionStaffId();
  return linkVerifiedIdentity(getHelpdeskPool(), staffId, input);
}
