import { rawDataToString } from "openclaw/plugin-sdk";
import type { DingtalkInboundMessage } from "./types.js";

export const DINGTALK_STREAM_OPEN_URL = "https://api.dingtalk.com/v1.0/gateway/connections/open";
export const DINGTALK_STREAM_CALLBACK_TOPIC = "/v1.0/im/bot/messages/get";

export type DingtalkStreamSubscription = {
  type: "EVENT" | "CALLBACK";
  topic: string;
};

export type DingtalkStreamOpenBody = {
  clientId: string;
  clientSecret: string;
  subscriptions: DingtalkStreamSubscription[];
  ua?: string;
  localIp?: string;
};

export type DingtalkStreamAck = {
  code: number;
  message: string;
  headers: {
    messageId: string;
    contentType: "application/json";
  };
  data: string;
};

export type DingtalkStreamFrame = {
  type?: string;
  data?: string;
  headers?: {
    messageId?: string;
    topic?: string;
  };
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function hasInboundMessageKeys(candidate: JsonRecord): boolean {
  return (
    "text" in candidate ||
    "content" in candidate ||
    "msg" in candidate ||
    "senderId" in candidate ||
    "senderStaffId" in candidate
  );
}

function extractInboundCandidate(root: unknown): DingtalkInboundMessage | null {
  const rootRecord = asRecord(root);
  if (!rootRecord) {
    return null;
  }
  if (hasInboundMessageKeys(rootRecord)) {
    return rootRecord as DingtalkInboundMessage;
  }

  const nestedCandidates: unknown[] = [rootRecord.data, rootRecord.value, rootRecord.payload];
  for (const nested of nestedCandidates) {
    const nestedRecord = asRecord(nested);
    if (nestedRecord && hasInboundMessageKeys(nestedRecord)) {
      return nestedRecord as DingtalkInboundMessage;
    }
  }
  return null;
}

export function buildDingtalkStreamOpenBody(params: {
  clientId: string;
  clientSecret: string;
  userAgent?: string;
  localIp?: string;
  subscriptions?: DingtalkStreamSubscription[];
}): DingtalkStreamOpenBody {
  const subscriptions =
    params.subscriptions && params.subscriptions.length > 0
      ? params.subscriptions
      : [
          { type: "EVENT", topic: "*" },
          { type: "CALLBACK", topic: DINGTALK_STREAM_CALLBACK_TOPIC },
        ];

  return {
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    subscriptions,
    ...(params.userAgent?.trim() ? { ua: params.userAgent.trim() } : {}),
    ...(params.localIp?.trim() ? { localIp: params.localIp.trim() } : {}),
  };
}

export function buildDingtalkStreamAck(messageId: string): DingtalkStreamAck {
  return {
    code: 200,
    message: "OK",
    headers: {
      messageId,
      contentType: "application/json",
    },
    data: '{"response":null}',
  };
}

export async function openDingtalkStreamConnection(params: {
  clientId: string;
  clientSecret: string;
  userAgent?: string;
  localIp?: string;
  timeoutMs?: number;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<{ endpoint: string; ticket: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs = Math.max(100, Math.floor(params.timeoutMs ?? 15_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(DINGTALK_STREAM_OPEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildDingtalkStreamOpenBody({
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          userAgent: params.userAgent,
          localIp: params.localIp,
        }),
      ),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`DingTalk stream open timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `DingTalk stream open failed (${response.status}): ${detail || response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    endpoint?: string;
    ticket?: string;
  };

  const endpoint = payload.endpoint?.trim();
  const ticket = payload.ticket?.trim();
  if (!endpoint || !ticket) {
    throw new Error("DingTalk stream open response missing endpoint or ticket");
  }

  return { endpoint, ticket };
}

export function parseDingtalkStreamFrame(raw: unknown): DingtalkStreamFrame | null {
  const text = rawDataToString(raw).trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as DingtalkStreamFrame;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseDingtalkStreamInbound(
  frame: DingtalkStreamFrame,
): DingtalkInboundMessage | null {
  const topic = frame.headers?.topic?.trim();
  if (typeof frame.data !== "string" || !frame.data.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(frame.data) as unknown;
    const payload = extractInboundCandidate(parsed);
    if (!payload) {
      return null;
    }
    if (topic === DINGTALK_STREAM_CALLBACK_TOPIC || frame.type === "CALLBACK") {
      return payload;
    }
    return payload;
  } catch {
    return null;
  }
}
