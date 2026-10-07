import "server-only";
import { createClient } from "../supabase/server";
import { getHelpdeskPool } from "../postgres/server";
import {
  listInboxConversations,
  getInboxConversationDetail,
  markConversationRead,
  InboxError,
} from "./inbox-service";
import type {
  InboxConversationListQuery,
  MarkConversationReadCommand,
} from "./inbox-contracts";

export async function sessionStaffId(): Promise<string> {
  const auth = await createClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) {
    throw new InboxError("UNAUTHENTICATED", "Silakan login sebagai staf terlebih dahulu.", 401);
  }
  return data.user.id;
}

export async function fetchInboxConversations(query: InboxConversationListQuery) {
  const staffId = await sessionStaffId();
  return listInboxConversations(getHelpdeskPool(), staffId, query);
}

export async function fetchInboxConversationDetail(conversationId: string) {
  const staffId = await sessionStaffId();
  return getInboxConversationDetail(getHelpdeskPool(), staffId, conversationId);
}

export async function updateConversationReadStatus(command: MarkConversationReadCommand) {
  const staffId = await sessionStaffId();
  return markConversationRead(getHelpdeskPool(), staffId, command);
}
