import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { DingtalkConfig } from "./types.js";

export type ResolvedDingtalkAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  config: DingtalkConfig;
};

export function listDingtalkAccountIds(_cfg: OpenClawConfig): string[] {
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDingtalkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedDingtalkAccount {
  const config = (params.cfg.channels?.dingtalk ?? {}) as DingtalkConfig;
  const enabled = config.enabled !== false;
  const connectionMode = config.connectionMode ?? "stream";
  const outbound = config.outboundWebhookUrl?.trim() || config.defaultTo?.trim();
  const hasWebhookConfig = Boolean(
    outbound || config.webhookPath?.trim() || config.webhookUrl?.trim(),
  );
  const hasStreamConfig = Boolean(config.clientId?.trim() && config.clientSecret?.trim());
  const configured = connectionMode === "stream" ? hasStreamConfig : hasWebhookConfig;
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled,
    configured,
    name: config.name?.trim() || undefined,
    config,
  };
}
