import {
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  missingTargetError,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { resolveDingtalkAccount, type ResolvedDingtalkAccount } from "./accounts.js";
import { sendDingtalkText } from "./api.js";
import { DingtalkConfigSchema } from "./config-schema.js";
import { startDingtalkMonitor, resolveDingtalkWebhookPath } from "./monitor.js";
import { getDingtalkRuntime } from "./runtime.js";

function normalizeAllowEntry(raw: string): string {
  return raw
    .trim()
    .replace(/^(dingtalk|dingding):/i, "")
    .toLowerCase();
}

function normalizeDingtalkTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(dingtalk|dingding):/i, "").trim() || undefined;
}

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
  id: "dingtalk",
  meta: {
    id: "dingtalk",
    label: "DingTalk",
    selectionLabel: "DingTalk (Stream/Webhook)",
    detailLabel: "DingTalk Bot",
    docsPath: "/channels/dingtalk",
    docsLabel: "dingtalk",
    blurb: "DingTalk bot integration via Stream mode (no domain) or webhook mode.",
    aliases: ["dingding"],
    order: 68,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: (entry) => normalizeAllowEntry(entry),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveDingtalkAccount({ cfg });
      const webhookUrl =
        account.config.outboundWebhookUrl?.trim() || account.config.defaultTo?.trim();
      if (!webhookUrl) {
        return;
      }
      await sendDingtalkText({
        webhookUrl,
        secret: account.config.secret,
        text: `OpenClaw: your access has been approved. user=${id}`,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: buildChannelConfigSchema(DingtalkConfigSchema),
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveDingtalkAccount({ cfg }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...cfg.channels?.dingtalk,
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as OpenClawConfig;
      const channels = { ...cfg.channels };
      delete channels.dingtalk;
      if (Object.keys(channels).length > 0) {
        next.channels = channels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      connectionMode: account.config.connectionMode ?? "stream",
      clientId: account.config.clientId ? "[set]" : "[missing]",
      webhookPath: account.config.webhookPath,
      outboundWebhookUrl: account.config.outboundWebhookUrl ? "[set]" : "[missing]",
    }),
    resolveAllowFrom: ({ cfg }) =>
      (resolveDingtalkAccount({ cfg }).config.dm?.allowFrom ?? []).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry))
        .filter(Boolean)
        .map((entry) => normalizeAllowEntry(entry)),
    resolveDefaultTo: ({ cfg }) =>
      resolveDingtalkAccount({ cfg }).config.defaultTo?.trim() || undefined,
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dm?.policy ?? "pairing",
      allowFrom: account.config.dm?.allowFrom ?? [],
      allowFromPath: "channels.dingtalk.dm.allowFrom",
      policyPath: "channels.dingtalk.dm.policy",
      approveHint: formatPairingApproveHint("dingtalk"),
      normalizeEntry: normalizeAllowEntry,
    }),
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const mode = account.config.connectionMode ?? "stream";
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.dingtalk !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        warnings.push(
          '- DingTalk groups: groupPolicy="open" allows any group sender to trigger. Set channels.dingtalk.groupPolicy="allowlist" and configure channels.dingtalk.groupAllowFrom.',
        );
      }
      if (account.config.dm?.policy === "open") {
        warnings.push(
          '- DingTalk DMs are open to anyone. Set channels.dingtalk.dm.policy="pairing" or "allowlist" for production.',
        );
      }
      if (mode === "stream") {
        if (!account.config.clientId?.trim() || !account.config.clientSecret?.trim()) {
          warnings.push(
            "- DingTalk stream mode requires channels.dingtalk.clientId and channels.dingtalk.clientSecret.",
          );
        }
      } else if (!account.config.outboundWebhookUrl?.trim() && !account.config.defaultTo?.trim()) {
        warnings.push(
          "- DingTalk outbound webhook is not configured. Set channels.dingtalk.outboundWebhookUrl or channels.dingtalk.defaultTo.",
        );
      }
      return warnings;
    },
  },
  messaging: {
    normalizeTarget: normalizeDingtalkTarget,
    targetResolver: {
      looksLikeId: (raw, normalized) => {
        const value = normalized ?? raw.trim();
        return /^https?:\/\//i.test(value);
      },
      hint: "<DingTalk webhook URL>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit }) => {
      const q = query?.trim().toLowerCase() || "";
      const allowFrom = resolveDingtalkAccount({ cfg }).config.dm?.allowFrom ?? [];
      return Array.from(new Set(allowFrom.map((entry) => normalizeAllowEntry(String(entry)))))
        .filter((id) => id && id !== "*")
        .filter((id) => (q ? id.includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
    },
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getDingtalkRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 1800,
    resolveTarget: ({ cfg, to }) => {
      const explicit = normalizeDingtalkTarget(to ?? "");
      const fallback = resolveDingtalkAccount({ cfg }).config.defaultTo?.trim();
      const target = explicit || fallback;
      if (!target) {
        return {
          ok: false,
          error: missingTargetError("DingTalk", "<DingTalk webhook URL>"),
        };
      }
      if (!/^https?:\/\//i.test(target)) {
        return {
          ok: false,
          error: new Error("DingTalk target must be a webhook URL (http/https)."),
        };
      }
      return { ok: true, to: target };
    },
    sendText: async ({ cfg, to, text }) => {
      const account = resolveDingtalkAccount({ cfg });
      await sendDingtalkText({
        webhookUrl: to,
        secret: account.config.secret,
        text,
      });
      return {
        channel: "dingtalk",
        messageId: "",
        chatId: to,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl }) => {
      const account = resolveDingtalkAccount({ cfg });
      const merged = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      await sendDingtalkText({
        webhookUrl: to,
        secret: account.config.secret,
        text: merged,
      });
      return {
        channel: "dingtalk",
        messageId: "",
        chatId: to,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      mode: account.config.connectionMode ?? "stream",
      webhookPath:
        account.config.connectionMode === "webhook" ? account.config.webhookPath : undefined,
      clientId: account.config.clientId ? "[set]" : "[missing]",
      outboundWebhookUrl: account.config.outboundWebhookUrl ? "[set]" : "[missing]",
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      dmPolicy: account.config.dm?.policy ?? "pairing",
      groupPolicy: account.config.groupPolicy ?? "allowlist",
    }),
    buildChannelSummary: ({ snapshots, issues }) =>
      buildBaseChannelStatusSummary({ channel: "dingtalk", snapshots, issues }),
  },
  gateway: {
    startAccount: async (ctx) => {
      if (!ctx.account.enabled) {
        return;
      }
      const mode = ctx.account.config.connectionMode ?? "stream";
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: true,
        lastStartAt: Date.now(),
        mode,
        webhookPath:
          mode === "webhook" ? resolveDingtalkWebhookPath({ account: ctx.account }) : undefined,
      });

      const unregister = await startDingtalkMonitor({
        account: ctx.account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.account.accountId, ...patch }),
      });

      await new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) {
          resolve();
          return;
        }
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });

      unregister();
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};
