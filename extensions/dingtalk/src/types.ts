import type { DmConfig, GroupPolicy } from "openclaw/plugin-sdk";

export type DingtalkConfig = {
  enabled?: boolean;
  name?: string;
  connectionMode?: "stream" | "webhook";
  clientId?: string;
  clientSecret?: string;
  streamLocalIp?: string;
  streamUserAgent?: string;
  streamOpenTimeoutMs?: number;
  streamConnectTimeoutMs?: number;
  streamReconnectMaxMs?: number;
  streamReconnectJitter?: number;
  webhookPath?: string;
  webhookUrl?: string;
  outboundWebhookUrl?: string;
  defaultTo?: string;
  secret?: string;
  signingSecret?: string;
  botUserId?: string;
  botName?: string;
  requireMention?: boolean;
  dm?: DmConfig;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  textChunkLimit?: number;
  blockStreaming?: boolean;
  blockStreamingCoalesce?: {
    minChars?: number;
    idleMs?: number;
  };
};

export type DingtalkInboundMessage = {
  text?: { content?: string };
  content?: string;
  msg?: { content?: string };
  senderId?: string;
  senderStaffId?: string;
  staffId?: string;
  userId?: string;
  senderNick?: string;
  senderName?: string;
  nick?: string;
  conversationId?: string;
  openConversationId?: string;
  chatId?: string;
  conversationType?: string | number;
  conversationTitle?: string;
  sessionTitle?: string;
  msgId?: string;
  messageId?: string;
  createAt?: number;
  timestamp?: number;
  timeStamp?: number;
  sessionWebhook?: string;
  atUsers?: Array<{
    dingtalkId?: string;
    staffId?: string;
    userId?: string;
  }>;
};
