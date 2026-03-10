export type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

export type SessionKeyChatType = "direct" | "group" | "channel" | "unknown";

function normalizeGatewayArtifactSubagentRest(rest: string): string {
  return rest.replaceAll("-subagent-", ":subagent:");
}

/**
 * Normalize legacy gateway/UI session keys into the canonical agent-scoped form when possible.
 * These artifacts look like "webchat:g-agent-main-subagent-..." or "g-agent-main-main".
 */
export function normalizeComparableSessionKey(sessionKey: string | undefined | null): string {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  const parsed = parseAgentSessionKey(raw);
  if (parsed) {
    return `agent:${parsed.agentId}:${parsed.rest}`;
  }

  const withoutChannelPrefix = (() => {
    const channelPrefixMatch = /^([a-z0-9_-]+):(g-agent-.+)$/.exec(raw);
    return channelPrefixMatch?.[2] ?? raw;
  })();
  if (!withoutChannelPrefix.startsWith("g-agent-")) {
    return raw;
  }

  const legacyPayload = withoutChannelPrefix.slice(2);
  const agentPrefix = "agent-";
  if (!legacyPayload.startsWith(agentPrefix)) {
    return raw;
  }

  const remainder = legacyPayload.slice(agentPrefix.length);
  const agentSeparator = remainder.indexOf("-");
  if (agentSeparator <= 0) {
    return raw;
  }

  const agentId = remainder.slice(0, agentSeparator).trim();
  const rest = remainder.slice(agentSeparator + 1).trim();
  if (!agentId || !rest) {
    return raw;
  }
  if (rest === "main") {
    return `agent:${agentId}:main`;
  }
  if (rest.startsWith("subagent-")) {
    const subagentRest = rest.slice("subagent-".length).trim();
    if (!subagentRest) {
      return raw;
    }
    return `agent:${agentId}:subagent:${normalizeGatewayArtifactSubagentRest(subagentRest)}`;
  }
  return raw;
}

export function sessionKeysMatch(
  left: string | undefined | null,
  right: string | undefined | null,
): boolean {
  return normalizeComparableSessionKey(left) === normalizeComparableSessionKey(right);
}

/**
 * Parse agent-scoped session keys in a canonical, case-insensitive way.
 * Returned values are normalized to lowercase for stable comparisons/routing.
 */
export function parseAgentSessionKey(
  sessionKey: string | undefined | null,
): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  if (parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

/**
 * Best-effort chat-type extraction from session keys across canonical and legacy formats.
 */
export function deriveSessionChatType(sessionKey: string | undefined | null): SessionKeyChatType {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return "unknown";
  }
  const scoped = parseAgentSessionKey(raw)?.rest ?? raw;
  const tokens = new Set(scoped.split(":").filter(Boolean));
  if (tokens.has("group")) {
    return "group";
  }
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("direct") || tokens.has("dm")) {
    return "direct";
  }
  // Legacy Discord keys can be shaped like:
  // discord:<accountId>:guild-<guildId>:channel-<channelId>
  if (/^discord:(?:[^:]+:)?guild-[^:]+:channel-[^:]+$/.test(scoped)) {
    return "channel";
  }
  return "unknown";
}

export function isCronRunSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return /^cron:[^:]+:run:[^:]+$/.test(parsed.rest);
}

export function isCronSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return parsed.rest.toLowerCase().startsWith("cron:");
}

export function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("subagent:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("subagent:"));
}

export function getSubagentDepth(sessionKey: string | undefined | null): number {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return 0;
  }
  return raw.split(":subagent:").length - 1;
}

export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("acp:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("acp:"));
}

const THREAD_SESSION_MARKERS = [":thread:", ":topic:"];

export function resolveThreadParentSessionKey(
  sessionKey: string | undefined | null,
): string | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  let idx = -1;
  for (const marker of THREAD_SESSION_MARKERS) {
    const candidate = normalized.lastIndexOf(marker);
    if (candidate > idx) {
      idx = candidate;
    }
  }
  if (idx <= 0) {
    return null;
  }
  const parent = raw.slice(0, idx).trim();
  return parent ? parent : null;
}
