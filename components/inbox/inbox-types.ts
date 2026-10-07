import type {
  InboxConversationItem,
  InboxConversationDetail,
  InboxMessageDetail,
  InboxSenderSummary,
  InboxEpisodeSummary,
  InboxLastMessagePreview,
  InboxConversationListQuery,
  InboxConversationListResult,
  InboxEpisodeStatusFilter,
  MarkConversationReadCommand,
  MarkConversationReadResult,
} from "@/lib/application/inbox-contracts";

export type {
  InboxConversationItem,
  InboxConversationDetail,
  InboxMessageDetail,
  InboxSenderSummary,
  InboxEpisodeSummary,
  InboxLastMessagePreview,
  InboxConversationListQuery,
  InboxConversationListResult,
  InboxEpisodeStatusFilter,
  MarkConversationReadCommand,
  MarkConversationReadResult,
};

export interface InboxFilterState {
  status: "all" | "active" | "closed";
  episodeStatus: InboxEpisodeStatusFilter;
  unread: boolean | undefined;
  needsReview: boolean | undefined;
  search: string;
}

export const INITIAL_INBOX_FILTERS: InboxFilterState = {
  status: "all",
  episodeStatus: "any",
  unread: undefined,
  needsReview: undefined,
  search: "",
};

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}
