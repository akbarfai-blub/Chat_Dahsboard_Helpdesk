/**
 * Official Telegram Bot API types relevant for webhook inbound processing.
 * References: https://core.telegram.org/bots/api
 */

export interface TelegramUser {
  readonly id: number;
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export interface TelegramChat {
  readonly id: number;
  readonly type: TelegramChatType;
  readonly title?: string;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

export interface TelegramPhotoSize {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly file_size?: number;
}

export interface TelegramDocument {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramVoice {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly duration: number;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramVideo {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramAudio {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly duration: number;
  readonly performer?: string;
  readonly title?: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramSticker {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly width: number;
  readonly height: number;
  readonly is_animated?: boolean;
  readonly is_video?: boolean;
}

export interface TelegramLocation {
  readonly longitude: number;
  readonly latitude: number;
}

export interface TelegramContact {
  readonly phone_number: string;
  readonly first_name: string;
  readonly last_name?: string;
  readonly user_id?: number;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly date: number;
  readonly chat: TelegramChat;
  readonly from?: TelegramUser;
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: readonly TelegramPhotoSize[];
  readonly document?: TelegramDocument;
  readonly voice?: TelegramVoice;
  readonly video?: TelegramVideo;
  readonly audio?: TelegramAudio;
  readonly sticker?: TelegramSticker;
  readonly location?: TelegramLocation;
  readonly contact?: TelegramContact;
  // Forwarded message metadata (Bot API 7.0+ uses forward_origin, legacy uses forward_from/forward_date)
  readonly forward_origin?: unknown;
  readonly forward_from?: TelegramUser;
  readonly forward_from_chat?: TelegramChat;
  readonly forward_date?: number;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly channel_post?: TelegramMessage;
  readonly edited_channel_post?: TelegramMessage;
  readonly inline_query?: unknown;
  readonly chosen_inline_result?: unknown;
  readonly callback_query?: unknown;
  readonly shipping_query?: unknown;
  readonly pre_checkout_query?: unknown;
  readonly poll?: unknown;
  readonly poll_answer?: unknown;
  readonly my_chat_member?: unknown;
  readonly chat_member?: unknown;
  readonly chat_join_request?: unknown;
  readonly chat_boost?: unknown;
  readonly removed_chat_boost?: unknown;
}
