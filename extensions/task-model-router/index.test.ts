import { describe, expect, it, vi } from "vitest";
import register from "./index.js";

type HookHandler = (
  event: {
    prompt: string;
    requestedProvider?: string;
    requestedModel?: string;
    hasExplicitModelSelection?: boolean;
  },
  ctx: { sessionKey?: string; agentId?: string },
) =>
  | Promise<{ providerOverride?: string; modelOverride?: string } | undefined>
  | { providerOverride?: string; modelOverride?: string }
  | undefined;

function createApi(overrides?: { pluginConfig?: Record<string, unknown> }) {
  const hooks: Record<string, HookHandler> = {};
  const api = {
    id: "task-model-router",
    name: "Task Model Router",
    pluginConfig: overrides?.pluginConfig ?? {},
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: HookHandler) => {
      hooks[hookName] = handler;
    }),
  };

  return { api, hooks };
}

describe("task-model-router", () => {
  it("默认注册 before_model_resolve 钩子", () => {
    const { api, hooks } = createApi();

    register(api as never);

    expect(api.on).toHaveBeenCalledWith("before_model_resolve", expect.any(Function));
    expect(typeof hooks.before_model_resolve).toBe("function");
  });

  it("enabled=false 时不注册钩子", () => {
    const { api, hooks } = createApi({
      pluginConfig: { enabled: false },
    });

    register(api as never);

    expect(api.on).not.toHaveBeenCalled();
    expect(hooks.before_model_resolve).toBeUndefined();
  });

  it("高复杂关键词命中 high 模型", async () => {
    const { api, hooks } = createApi();
    register(api as never);

    const result = await hooks.before_model_resolve(
      { prompt: "请给我一个跨服务架构重构方案并给出风险矩阵" },
      { sessionKey: "agent:main:main" },
    );

    expect(result).toEqual({
      providerOverride: "openai",
      modelOverride: "gpt-5.3-codex",
    });
  });

  it("中复杂关键词命中 mid 模型", async () => {
    const { api, hooks } = createApi({
      pluginConfig: {
        midModels: ["minimax/MiniMax-M2.5-highspeed"],
      },
    });
    register(api as never);

    const result = await hooks.before_model_resolve(
      { prompt: "请总结下面会议记录，给出行动项" },
      { sessionKey: "agent:main:main" },
    );

    expect(result).toEqual({
      providerOverride: "minimax",
      modelOverride: "MiniMax-M2.5-highspeed",
    });
  });

  it("普通任务默认命中 low 模型", async () => {
    const { api, hooks } = createApi();
    register(api as never);

    const result = await hooks.before_model_resolve(
      { prompt: "你好，今天天气不错" },
      { sessionKey: "agent:main:main" },
    );

    expect(result).toEqual({
      providerOverride: "huggingface",
      modelOverride: "deepseek-ai/DeepSeek-V3.2",
    });
  });

  it("显式指定模型时不覆盖请求模型", async () => {
    const { api, hooks } = createApi();
    register(api as never);

    const result = await hooks.before_model_resolve(
      {
        prompt: "请帮我总结今天的交易笔记",
        requestedProvider: "local",
        requestedModel: "gpt-5.4",
        hasExplicitModelSelection: true,
      },
      { sessionKey: "agent:main:main" },
    );

    expect(result).toBeUndefined();
  });

  it("超长文本即使无关键词也命中 high 模型", async () => {
    const { api, hooks } = createApi();
    register(api as never);

    const prompt = "a".repeat(1300);
    const result = await hooks.before_model_resolve({ prompt }, { sessionKey: "agent:main:main" });

    expect(result).toEqual({
      providerOverride: "openai",
      modelOverride: "gpt-5.3-codex",
    });
  });

  it("配置非法模型引用时返回 undefined 并记录警告", async () => {
    const { api, hooks } = createApi({
      pluginConfig: {
        lowModel: "invalid-model-ref",
      },
    });
    register(api as never);

    const result = await hooks.before_model_resolve(
      { prompt: "hi" },
      { sessionKey: "agent:main:main" },
    );

    expect(result).toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalled();
  });

  it("excludeAgents 命中时跳过当前 agent", async () => {
    const { api, hooks } = createApi({
      pluginConfig: {
        excludeAgents: ["aitrade"],
      },
    });
    register(api as never);

    const result = await hooks.before_model_resolve(
      { prompt: "请总结今天的交易笔记" },
      { sessionKey: "agent:aitrade:main", agentId: "aitrade" },
    );

    expect(result).toBeUndefined();
  });

  it("includeAgents 仅对命中的 agent 生效", async () => {
    const { api, hooks } = createApi({
      pluginConfig: {
        includeAgents: ["main"],
        lowModel: "local/gpt-5.4",
      },
    });
    register(api as never);

    const skipped = await hooks.before_model_resolve(
      { prompt: "你好" },
      { sessionKey: "agent:aitrade:main", agentId: "aitrade" },
    );
    const applied = await hooks.before_model_resolve(
      { prompt: "你好" },
      { sessionKey: "agent:main:main", agentId: "main" },
    );

    expect(skipped).toBeUndefined();
    expect(applied).toEqual({
      providerOverride: "local",
      modelOverride: "gpt-5.4",
    });
  });
});
