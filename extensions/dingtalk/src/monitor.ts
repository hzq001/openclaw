import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
  createScopedPairingAccess,
  formatTextWithAttachmentLinks,
  readJsonBodyWithLimit,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  requestBodyErrorToText,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveDmGroupAccessWithLists,
  resolveOutboundMediaUrls,
  resolveSingleWebhookTarget,
  resolveWebhookPath,
  resolveWebhookTargets,
} from "openclaw/plugin-sdk";
import WebSocket from "ws";
import type { ResolvedDingtalkAccount } from "./accounts.js";
import { sendDingtalkText, verifyDingtalkSignature } from "./api.js";
import { getDingtalkRuntime } from "./runtime.js";
import {
  buildDingtalkStreamAck,
  openDingtalkStreamConnection,
  parseDingtalkStreamFrame,
  parseDingtalkStreamInbound,
} from "./stream.js";
import type { DingtalkInboundMessage } from "./types.js";

export type DingtalkRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type DingtalkMonitorOptions = {
  account: ResolvedDingtalkAccount;
  config: OpenClawConfig;
  runtime: DingtalkRuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type DingtalkCoreRuntime = ReturnType<typeof getDingtalkRuntime>;

type InboundTarget = {
  account: ResolvedDingtalkAccount;
  config: OpenClawConfig;
  runtime: DingtalkRuntimeEnv;
  core: DingtalkCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type WebhookTarget = InboundTarget & {
  path: string;
};

const webhookTargets = new Map<string, WebhookTarget[]>();

const DINGTALK_STREAM_INITIAL_RECONNECT_MS = 1_000;
const DINGTALK_STREAM_DEFAULT_RECONNECT_MAX_MS = 30_000;
const DINGTALK_STREAM_DEFAULT_OPEN_TIMEOUT_MS = 15_000;
const DINGTALK_STREAM_DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DINGTALK_STREAM_DEFAULT_RECONNECT_JITTER = 0.2;

type ParsedInboundMessage = {
  text: string;
  senderId: string;
  senderName?: string;
  conversationId: string;
  conversationTitle?: string;
  sessionWebhook?: string;
  messageId?: string;
  timestamp: number;
  isGroup: boolean;
  wasMentioned: boolean;
};

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeInboundCommand(text: string): string {
  return text.trim().toLowerCase();
}

function isSenderAllowed(senderId: string, allowFrom: readonly (string | number)[]): boolean {
  const normalizedSender = normalizeId(senderId);
  return allowFrom.some((entry) => {
    const normalized = normalizeId(String(entry));
    return normalized === "*" || normalized === normalizedSender;
  });
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function resolveIncomingSecret(account: ResolvedDingtalkAccount): string | undefined {
  return account.config.signingSecret?.trim() || account.config.secret?.trim() || undefined;
}

function parseInboundMessage(
  payload: DingtalkInboundMessage,
  account: ResolvedDingtalkAccount,
): ParsedInboundMessage | null {
  const text =
    getString(payload.text?.content) ??
    getString(payload.content) ??
    getString(payload.msg?.content) ??
    "";
  if (!text) {
    return null;
  }

  const senderId =
    getString(payload.senderStaffId) ??
    getString(payload.senderId) ??
    getString(payload.staffId) ??
    getString(payload.userId) ??
    "";
  if (!senderId) {
    return null;
  }

  const conversationId =
    getString(payload.conversationId) ??
    getString(payload.openConversationId) ??
    getString(payload.chatId) ??
    getString(payload.sessionWebhook) ??
    senderId;

  const conversationType = String(payload.conversationType ?? "")
    .trim()
    .toLowerCase();
  const isGroup =
    conversationType === "2" ||
    conversationType === "group" ||
    Boolean(getString(payload.openConversationId));

  const senderName =
    getString(payload.senderNick) ?? getString(payload.senderName) ?? getString(payload.nick);
  const conversationTitle =
    getString(payload.conversationTitle) ?? getString(payload.sessionTitle) ?? undefined;
  const timestamp =
    getNumber(payload.createAt) ??
    getNumber(payload.timestamp) ??
    getNumber(payload.timeStamp) ??
    Date.now();
  const messageId = getString(payload.msgId) ?? getString(payload.messageId);
  const sessionWebhook = getString(payload.sessionWebhook);

  let wasMentioned = true;
  if (isGroup && account.config.requireMention === true) {
    wasMentioned = false;
    const botUserId = account.config.botUserId?.trim();
    if (botUserId) {
      const mentions = payload.atUsers ?? [];
      wasMentioned = mentions.some((entry) => {
        const candidate =
          getString(entry.dingtalkId) ?? getString(entry.staffId) ?? getString(entry.userId);
        return candidate === botUserId;
      });
    }
    if (!wasMentioned) {
      const botName = account.config.botName?.trim();
      if (botName) {
        wasMentioned = text.includes(`@${botName}`);
      }
    }
  }

  return {
    text,
    senderId,
    senderName,
    conversationId,
    conversationTitle,
    sessionWebhook,
    messageId,
    timestamp,
    isGroup,
    wasMentioned,
  };
}

function resolveRequestSignature(req: IncomingMessage): { timestamp?: string; sign?: string } {
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryTimestamp = url.searchParams.get("timestamp");
  const querySign = url.searchParams.get("sign");

  const headerTimestamp =
    getString(req.headers["x-dingtalk-timestamp"]) ?? getString(req.headers["timestamp"]);
  const headerSign = getString(req.headers["x-dingtalk-sign"]) ?? getString(req.headers["sign"]);

  return {
    timestamp: queryTimestamp ?? headerTimestamp,
    sign: querySign ?? headerSign,
  };
}

export function resolveDingtalkWebhookPath(params: {
  account: ResolvedDingtalkAccount;
  webhookPath?: string;
  webhookUrl?: string;
}): string {
  return (
    resolveWebhookPath({
      webhookPath: params.webhookPath ?? params.account.config.webhookPath,
      webhookUrl: params.webhookUrl ?? params.account.config.webhookUrl,
      defaultPath: "/dingtalk",
    }) ?? "/dingtalk"
  );
}

export function registerDingtalkWebhookTarget(target: WebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function clampRatio(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value;
  }
  return fallback;
}

export function computeDingtalkReconnectDelay(params: {
  baseDelayMs: number;
  jitterRatio: number;
  random?: () => number;
}): number {
  const baseDelayMs = Math.max(1, Math.floor(params.baseDelayMs));
  const jitterRatio = Math.max(0, Math.min(1, params.jitterRatio));
  if (jitterRatio <= 0) {
    return baseDelayMs;
  }
  const random = params.random ?? Math.random;
  const unit = Math.max(0, Math.min(1, random()));
  const factor = 1 + (unit * 2 - 1) * jitterRatio;
  return Math.max(1, Math.round(baseDelayMs * factor));
}

async function startDingtalkWebhookMonitor(options: DingtalkMonitorOptions): Promise<() => void> {
  const core = getDingtalkRuntime();
  const path = resolveDingtalkWebhookPath({
    account: options.account,
    webhookPath: options.webhookPath,
    webhookUrl: options.webhookUrl,
  });
  const unregister = registerDingtalkWebhookTarget({
    account: options.account,
    config: options.config,
    runtime: options.runtime,
    core,
    path,
    statusSink: options.statusSink,
  });

  if (options.abortSignal.aborted) {
    unregister();
    return () => {};
  }

  options.abortSignal.addEventListener("abort", () => unregister(), { once: true });
  return unregister;
}

async function startDingtalkStreamMonitor(options: DingtalkMonitorOptions): Promise<() => void> {
  const clientId = options.account.config.clientId?.trim();
  const clientSecret = options.account.config.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("DingTalk stream mode requires clientId and clientSecret");
  }

  const core = getDingtalkRuntime();
  const target: InboundTarget = {
    account: options.account,
    config: options.config,
    runtime: options.runtime,
    core,
    statusSink: options.statusSink,
  };

  let closed = false;
  let reconnectDelayMs = DINGTALK_STREAM_INITIAL_RECONNECT_MS;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let socket: WebSocket | null = null;
  const reconnectMaxDelayMs = clampPositiveInt(
    options.account.config.streamReconnectMaxMs,
    DINGTALK_STREAM_DEFAULT_RECONNECT_MAX_MS,
  );
  const streamOpenTimeoutMs = clampPositiveInt(
    options.account.config.streamOpenTimeoutMs,
    DINGTALK_STREAM_DEFAULT_OPEN_TIMEOUT_MS,
  );
  const streamConnectTimeoutMs = clampPositiveInt(
    options.account.config.streamConnectTimeoutMs,
    DINGTALK_STREAM_DEFAULT_CONNECT_TIMEOUT_MS,
  );
  const reconnectJitter = clampRatio(
    options.account.config.streamReconnectJitter,
    DINGTALK_STREAM_DEFAULT_RECONNECT_JITTER,
  );

  const clearReconnectTimer = () => {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (closed) {
      return;
    }
    if (reconnectTimer) {
      return;
    }
    const baseDelay = reconnectDelayMs;
    const delay = computeDingtalkReconnectDelay({
      baseDelayMs: baseDelay,
      jitterRatio: reconnectJitter,
    });
    reconnectDelayMs = Math.min(baseDelay * 2, reconnectMaxDelayMs);
    options.runtime.log?.(`[dingtalk:${options.account.accountId}] stream reconnect in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectStream();
    }, delay);
  };

  const handleFrame = async (raw: unknown, ws: WebSocket) => {
    const frame = parseDingtalkStreamFrame(raw);
    if (!frame) {
      return;
    }

    const messageId = frame.headers?.messageId?.trim();
    if (messageId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(buildDingtalkStreamAck(messageId)));
    }

    const inbound = parseDingtalkStreamInbound(frame);
    if (!inbound) {
      return;
    }

    target.statusSink?.({ lastInboundAt: Date.now() });
    await processDingtalkInbound(inbound, target);
  };

  const connectStream = async () => {
    if (closed) {
      return;
    }

    try {
      const { endpoint, ticket } = await openDingtalkStreamConnection({
        clientId,
        clientSecret,
        userAgent: options.account.config.streamUserAgent,
        localIp: options.account.config.streamLocalIp,
        timeoutMs: streamOpenTimeoutMs,
      });
      if (closed) {
        return;
      }

      const wsUrl = new URL(endpoint);
      wsUrl.searchParams.set("ticket", ticket);
      options.runtime.log?.(`[dingtalk:${options.account.accountId}] stream connecting`);

      const ws = new WebSocket(wsUrl.toString());
      socket = ws;
      let connectTimer: NodeJS.Timeout | null = setTimeout(() => {
        connectTimer = null;
        if (closed || ws.readyState !== WebSocket.CONNECTING) {
          return;
        }
        options.runtime.error?.(
          `[dingtalk:${options.account.accountId}] stream connect timeout after ${streamConnectTimeoutMs}ms`,
        );
        ws.terminate();
        scheduleReconnect();
      }, streamConnectTimeoutMs);
      const clearConnectTimer = () => {
        if (!connectTimer) {
          return;
        }
        clearTimeout(connectTimer);
        connectTimer = null;
      };

      ws.on("open", () => {
        clearConnectTimer();
        clearReconnectTimer();
        reconnectDelayMs = DINGTALK_STREAM_INITIAL_RECONNECT_MS;
        options.runtime.log?.(`[dingtalk:${options.account.accountId}] stream connected`);
      });

      ws.on("message", (data) => {
        void handleFrame(data, ws).catch((error) => {
          options.runtime.error?.(
            `[dingtalk:${options.account.accountId}] stream message handling failed: ${String(error)}`,
          );
        });
      });

      ws.on("error", (error) => {
        clearConnectTimer();
        options.runtime.error?.(
          `[dingtalk:${options.account.accountId}] stream socket error: ${String(error)}`,
        );
        if (closed) {
          return;
        }
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
        scheduleReconnect();
      });

      ws.on("close", () => {
        clearConnectTimer();
        if (socket === ws) {
          socket = null;
        }
        if (closed) {
          return;
        }
        scheduleReconnect();
      });
    } catch (error) {
      options.runtime.error?.(
        `[dingtalk:${options.account.accountId}] stream connect failed: ${String(error)}`,
      );
      scheduleReconnect();
    }
  };

  void connectStream();

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearReconnectTimer();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    if (socket && socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
    socket = null;
  };

  if (options.abortSignal.aborted) {
    close();
    return () => {};
  }

  options.abortSignal.addEventListener("abort", () => close(), { once: true });
  return () => close();
}

export async function startDingtalkMonitor(options: DingtalkMonitorOptions): Promise<() => void> {
  const mode = options.account.config.connectionMode ?? "stream";
  if (mode === "stream") {
    return await startDingtalkStreamMonitor(options);
  }
  return await startDingtalkWebhookMonitor(options);
}

export async function handleDingtalkWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }

  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }

  const body = await readJsonBodyWithLimit(req, {
    maxBytes: 1024 * 1024,
    timeoutMs: 30_000,
    emptyObjectOnEmpty: false,
  });
  if (!body.ok) {
    res.statusCode =
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
    res.end(
      body.code === "REQUEST_BODY_TIMEOUT"
        ? requestBodyErrorToText("REQUEST_BODY_TIMEOUT")
        : body.error,
    );
    return true;
  }

  const payload = body.value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }

  const signature = resolveRequestSignature(req);
  const selected = resolveSingleWebhookTarget(resolved.targets, (target) => {
    return verifyDingtalkSignature({
      secret: resolveIncomingSecret(target.account),
      timestamp: signature.timestamp,
      sign: signature.sign,
    });
  });

  if (selected.kind === "none") {
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  if (selected.kind === "ambiguous") {
    res.statusCode = 401;
    res.end("ambiguous webhook target");
    return true;
  }

  selected.target.statusSink?.({ lastInboundAt: Date.now() });
  void processDingtalkInbound(payload as DingtalkInboundMessage, selected.target).catch((error) => {
    selected.target.runtime.error?.(
      `[dingtalk:${selected.target.account.accountId}] webhook processing failed: ${String(error)}`,
    );
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end('{"msg":"ok"}');
  return true;
}

async function processDingtalkInbound(payload: DingtalkInboundMessage, target: InboundTarget) {
  const parsed = parseInboundMessage(payload, target.account);
  if (!parsed) {
    return;
  }

  const { account, config, runtime, core, statusSink } = target;
  runtime.log?.(
    `[dingtalk:${account.accountId}] inbound accepted payload sender=${parsed.senderId} group=${parsed.isGroup ? "yes" : "no"}`,
  );

  const dmPolicy = account.config.dm?.policy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config);
  const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: config.channels?.dingtalk !== undefined,
    groupPolicy: account.config.groupPolicy,
    defaultGroupPolicy,
  });

  const configAllowFrom = account.config.dm?.allowFrom ?? [];
  const configGroupAllowFrom = account.config.groupAllowFrom ?? [];
  let pairingAccess: ReturnType<typeof createScopedPairingAccess> | undefined;
  const storeAllowFrom =
    !parsed.isGroup && dmPolicy === "pairing"
      ? await (pairingAccess ??= createScopedPairingAccess({
          core,
          channel: "dingtalk",
          accountId: account.accountId,
        }))
          .readAllowFromStore()
          .catch(() => [])
      : [];

  const access = resolveDmGroupAccessWithLists({
    isGroup: parsed.isGroup,
    dmPolicy,
    groupPolicy,
    allowFrom: configAllowFrom,
    groupAllowFrom: configGroupAllowFrom,
    storeAllowFrom,
    isSenderAllowed: (allowFrom) => isSenderAllowed(parsed.senderId, allowFrom),
  });

  if (parsed.isGroup) {
    if (account.config.requireMention === true && !parsed.wasMentioned) {
      runtime.log?.(
        `[dingtalk:${account.accountId}] inbound skipped: group mention required but not found`,
      );
      return;
    }
    if (access.decision !== "allow") {
      runtime.log?.(
        `[dingtalk:${account.accountId}] inbound blocked by group policy decision=${access.decision}`,
      );
      return;
    }
  } else if (access.decision !== "allow") {
    runtime.log?.(
      `[dingtalk:${account.accountId}] inbound blocked by dm policy decision=${access.decision}`,
    );
    if (access.decision === "pairing") {
      const { code, created } = await (pairingAccess ??= createScopedPairingAccess({
        core,
        channel: "dingtalk",
        accountId: account.accountId,
      })).upsertPairingRequest({
        id: parsed.senderId,
        meta: { name: parsed.senderName },
      });
      if (created) {
        const pairingWebhook =
          parsed.sessionWebhook?.trim() ||
          account.config.outboundWebhookUrl?.trim() ||
          account.config.defaultTo?.trim();
        if (pairingWebhook) {
          await sendDingtalkText({
            webhookUrl: pairingWebhook,
            secret: account.config.secret,
            text: core.channel.pairing.buildPairingReply({
              channel: "dingtalk",
              idLine: `Your DingTalk user id: ${parsed.senderId}`,
              code,
            }),
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        }
      }
    }
    return;
  }

  if (normalizeInboundCommand(parsed.text) === "ping") {
    const replyWebhook =
      parsed.sessionWebhook?.trim() ||
      account.config.outboundWebhookUrl?.trim() ||
      account.config.defaultTo?.trim();
    if (!replyWebhook) {
      runtime.error?.(
        `[dingtalk:${account.accountId}] missing reply webhook; set channels.dingtalk.outboundWebhookUrl`,
      );
      return;
    }
    await sendDingtalkText({
      webhookUrl: replyWebhook,
      secret: account.config.secret,
      text: "pong",
    });
    runtime.log?.(`[dingtalk:${account.accountId}] ping command handled: pong sent`);
    statusSink?.({ lastOutboundAt: Date.now() });
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "dingtalk",
    accountId: account.accountId,
    peer: {
      kind: parsed.isGroup ? "group" : "direct",
      id: parsed.isGroup ? parsed.conversationId : parsed.senderId,
    },
  });

  const fromLabel =
    parsed.senderName ||
    (parsed.isGroup ? `conversation:${parsed.conversationId}` : parsed.senderId);
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "DingTalk",
    from: fromLabel,
    timestamp: parsed.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: parsed.text,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: parsed.text,
    RawBody: parsed.text,
    CommandBody: parsed.text,
    From: `dingtalk:${parsed.senderId}`,
    To: `dingtalk:${parsed.conversationId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: parsed.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: parsed.senderName,
    SenderId: parsed.senderId,
    Provider: "dingtalk",
    Surface: "dingtalk",
    MessageSid: parsed.messageId,
    Timestamp: parsed.timestamp,
    WasMentioned: parsed.isGroup ? parsed.wasMentioned : undefined,
    GroupSubject: parsed.isGroup ? parsed.conversationTitle : undefined,
    OriginatingChannel: "dingtalk",
    OriginatingTo: `dingtalk:${parsed.conversationId}`,
  });

  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((error) => {
      runtime.error?.(`dingtalk session update failed: ${String(error)}`);
    });

  const replyWebhook =
    parsed.sessionWebhook?.trim() ||
    account.config.outboundWebhookUrl?.trim() ||
    account.config.defaultTo?.trim();
  if (!replyWebhook) {
    runtime.error?.(
      `[dingtalk:${account.accountId}] missing reply webhook; set channels.dingtalk.outboundWebhookUrl`,
    );
    return;
  }

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "dingtalk",
    accountId: route.accountId,
  });

  const deliver = createNormalizedOutboundDeliverer(async (reply) => {
    const text = formatTextWithAttachmentLinks(reply.text, resolveOutboundMediaUrls(reply));
    if (!text) {
      runtime.log?.(
        `[dingtalk:${account.accountId}] skip outbound: empty normalized reply payload`,
      );
      return;
    }
    runtime.log?.(
      `[dingtalk:${account.accountId}] sending outbound reply textLength=${text.length}`,
    );
    await sendDingtalkText({
      webhookUrl: replyWebhook,
      secret: account.config.secret,
      text,
    });
    runtime.log?.(`[dingtalk:${account.accountId}] outbound reply sent`);
    statusSink?.({ lastOutboundAt: Date.now() });
  });

  const dispatchResult = await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver,
      onError: (error, info) => {
        runtime.error?.(`dingtalk ${info.kind} reply failed: ${String(error)}`);
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
  runtime.log?.(
    `[dingtalk:${account.accountId}] dispatch completed queuedFinal=${dispatchResult.queuedFinal} counts=${JSON.stringify(dispatchResult.counts)}`,
  );
}
