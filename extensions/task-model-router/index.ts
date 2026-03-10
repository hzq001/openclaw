import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type TaskModelRouterConfig = {
  enabled: boolean;
  highModel: string;
  midModels: string[];
  lowModel: string;
  highKeywords: string[];
  midKeywords: string[];
  highMinChars: number;
  midMinChars: number;
  includeAgents?: string[];
  excludeAgents: string[];
};

type ModelRef = {
  provider: string;
  model: string;
};

const DEFAULT_HIGH_MODEL = "openai/gpt-5.3-codex";
const DEFAULT_MID_MODELS = ["minimax/MiniMax-M2.5-highspeed", "qwen-portal/coder-model"];
const DEFAULT_LOW_MODEL = "huggingface/deepseek-ai/DeepSeek-V3.2";
const DEFAULT_HIGH_KEYWORDS = [
  "架构",
  "重构",
  "复杂",
  "性能瓶颈",
  "debug",
  "refactor",
  "设计方案",
  "系统设计",
];
const DEFAULT_MID_KEYWORDS = ["总结", "翻译", "解释", "review", "sql", "脚本", "改写", "提炼"];
const DEFAULT_HIGH_MIN_CHARS = 1200;
const DEFAULT_MID_MIN_CHARS = 300;

function normalizeModelList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeKeywords(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeAgentIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeThreshold(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function resolveConfig(raw: unknown): TaskModelRouterConfig {
  const cfg = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const enabled = cfg.enabled !== false;
  const highModel =
    typeof cfg.highModel === "string" && cfg.highModel.trim()
      ? cfg.highModel.trim()
      : DEFAULT_HIGH_MODEL;
  const lowModel =
    typeof cfg.lowModel === "string" && cfg.lowModel.trim()
      ? cfg.lowModel.trim()
      : DEFAULT_LOW_MODEL;

  return {
    enabled,
    highModel,
    midModels: normalizeModelList(cfg.midModels, DEFAULT_MID_MODELS),
    lowModel,
    highKeywords: normalizeKeywords(cfg.highKeywords, DEFAULT_HIGH_KEYWORDS),
    midKeywords: normalizeKeywords(cfg.midKeywords, DEFAULT_MID_KEYWORDS),
    highMinChars: normalizeThreshold(cfg.highMinChars, DEFAULT_HIGH_MIN_CHARS),
    midMinChars: normalizeThreshold(cfg.midMinChars, DEFAULT_MID_MIN_CHARS),
    includeAgents: normalizeAgentIds(cfg.includeAgents),
    excludeAgents: normalizeAgentIds(cfg.excludeAgents) ?? [],
  };
}

function parseModelRef(modelRef: string): ModelRef | undefined {
  const raw = modelRef.trim();
  const slashAt = raw.indexOf("/");
  if (slashAt <= 0 || slashAt >= raw.length - 1) {
    return undefined;
  }

  const provider = raw.slice(0, slashAt).trim();
  const model = raw.slice(slashAt + 1).trim();
  if (!provider || !model) {
    return undefined;
  }

  return { provider, model };
}

function includesAnyKeyword(promptLower: string, keywords: string[]): boolean {
  return keywords.some((keyword) => promptLower.includes(keyword));
}

function resolveTier(prompt: string, cfg: TaskModelRouterConfig): "high" | "mid" | "low" {
  const promptLower = prompt.toLowerCase();
  if (prompt.length >= cfg.highMinChars || includesAnyKeyword(promptLower, cfg.highKeywords)) {
    return "high";
  }
  if (prompt.length >= cfg.midMinChars || includesAnyKeyword(promptLower, cfg.midKeywords)) {
    return "mid";
  }
  return "low";
}

function hashText(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectMidModel(models: string[], sessionKey?: string): string {
  if (models.length === 1) {
    return models[0]!;
  }
  const seed = sessionKey?.trim() || "mid-default";
  const index = hashText(seed) % models.length;
  return models[index]!;
}

function shouldApplyToAgent(
  agentId: string | undefined,
  cfg: Pick<TaskModelRouterConfig, "includeAgents" | "excludeAgents">,
): boolean {
  const normalizedAgentId = agentId?.trim().toLowerCase();
  if (cfg.includeAgents && cfg.includeAgents.length > 0) {
    if (!normalizedAgentId) {
      return false;
    }
    if (!cfg.includeAgents.includes(normalizedAgentId)) {
      return false;
    }
  }
  if (normalizedAgentId && cfg.excludeAgents.includes(normalizedAgentId)) {
    return false;
  }
  return true;
}

export default function register(api: OpenClawPluginApi) {
  const cfg = resolveConfig(api.pluginConfig);
  if (!cfg.enabled) {
    return;
  }

  api.on("before_model_resolve", async (event, ctx) => {
    if (!shouldApplyToAgent(ctx.agentId, cfg)) {
      return undefined;
    }
    if (event.hasExplicitModelSelection) {
      return undefined;
    }
    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    const tier = resolveTier(prompt, cfg);

    const selectedRef =
      tier === "high"
        ? cfg.highModel
        : tier === "mid"
          ? selectMidModel(cfg.midModels, ctx.sessionKey)
          : cfg.lowModel;

    const parsed = parseModelRef(selectedRef);
    if (!parsed) {
      api.logger.warn(
        `task-model-router: invalid model ref "${selectedRef}" for tier "${tier}", skip override`,
      );
      return undefined;
    }

    return {
      providerOverride: parsed.provider,
      modelOverride: parsed.model,
    };
  });
}
