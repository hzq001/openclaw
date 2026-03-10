import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { decodeStrictBase64, spawnSubagentDirect } from "./subagent-spawn.js";

const callGatewayMock = vi.fn();
const loadSessionEntryMock = vi.fn();
const readRecentSessionMessagesMock = vi.fn();

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../gateway/session-utils.js", () => ({
  loadSessionEntry: (sessionKey: string) => loadSessionEntryMock(sessionKey),
}));

vi.mock("../gateway/session-utils.fs.js", () => ({
  readRecentSessionMessages: (
    sessionId: string,
    storePath: string | undefined,
    sessionFile?: string,
    maxMessages?: number,
    readBytes?: number,
  ) => readRecentSessionMessagesMock(sessionId, storePath, sessionFile, maxMessages, readBytes),
}));

let configOverride: Record<string, unknown> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
  tools: {
    sessions_spawn: {
      attachments: {
        enabled: true,
        maxFiles: 50,
        maxFileBytes: 1 * 1024 * 1024,
        maxTotalBytes: 5 * 1024 * 1024,
      },
    },
  },
  agents: {
    defaults: {
      workspace: os.tmpdir(),
    },
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

vi.mock("./subagent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-registry.js")>();
  return {
    ...actual,
    countActiveRunsForSession: () => 0,
    registerSubagentRun: () => {},
  };
});

vi.mock("./subagent-announce.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-announce.js")>();
  return {
    ...actual,
    buildSubagentSystemPrompt: () => "system-prompt",
  };
});

vi.mock("./agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-scope.js")>();
  return {
    ...actual,
    resolveAgentWorkspaceDir: () => path.join(os.tmpdir(), "agent-workspace"),
  };
});

vi.mock("./subagent-depth.js", () => ({
  getSubagentDepthFromSessionStore: () => 0,
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => false }),
}));

function setupGatewayMock() {
  callGatewayMock.mockImplementation(async (opts: { method?: string; params?: unknown }) => {
    if (opts.method === "sessions.patch") {
      return { ok: true };
    }
    if (opts.method === "sessions.delete") {
      return { ok: true };
    }
    if (opts.method === "agent") {
      return { runId: "run-1" };
    }
    return {};
  });
}

function findAgentMessage() {
  return callGatewayMock.mock.calls.find(([opts]) => opts?.method === "agent")?.[0]?.params as
    | { message?: string }
    | undefined;
}

// --- decodeStrictBase64 ---

describe("decodeStrictBase64", () => {
  const maxBytes = 1024;

  it("valid base64 returns buffer with correct bytes", () => {
    const input = "hello world";
    const encoded = Buffer.from(input).toString("base64");
    const result = decodeStrictBase64(encoded, maxBytes);
    expect(result).not.toBeNull();
    expect(result?.toString("utf8")).toBe(input);
  });

  it("empty string returns null", () => {
    expect(decodeStrictBase64("", maxBytes)).toBeNull();
  });

  it("bad padding (length % 4 !== 0) returns null", () => {
    expect(decodeStrictBase64("abc", maxBytes)).toBeNull();
  });

  it("non-base64 chars returns null", () => {
    expect(decodeStrictBase64("!@#$", maxBytes)).toBeNull();
  });

  it("whitespace-only returns null (empty after strip)", () => {
    expect(decodeStrictBase64("   ", maxBytes)).toBeNull();
  });

  it("pre-decode oversize guard: encoded string > maxEncodedBytes * 2 returns null", () => {
    // maxEncodedBytes = ceil(1024/3)*4 = 1368; *2 = 2736
    const oversized = "A".repeat(2737);
    expect(decodeStrictBase64(oversized, maxBytes)).toBeNull();
  });

  it("decoded byteLength exceeds maxDecodedBytes returns null", () => {
    const bigBuf = Buffer.alloc(1025, 0x42);
    const encoded = bigBuf.toString("base64");
    expect(decodeStrictBase64(encoded, maxBytes)).toBeNull();
  });

  it("valid base64 at exact boundary returns Buffer", () => {
    const exactBuf = Buffer.alloc(1024, 0x41);
    const encoded = exactBuf.toString("base64");
    const result = decodeStrictBase64(encoded, maxBytes);
    expect(result).not.toBeNull();
    expect(result?.byteLength).toBe(1024);
  });
});

// --- filename validation via spawnSubagentDirect ---

describe("spawnSubagentDirect filename validation", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
    loadSessionEntryMock.mockReset();
    readRecentSessionMessagesMock.mockReset();
    loadSessionEntryMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "requester-session",
        sessionFile: "/tmp/requester-session.jsonl",
      },
    });
    readRecentSessionMessagesMock.mockReturnValue([]);
    setupGatewayMock();
  });

  const ctx = {
    agentSessionKey: "agent:main:main",
    agentChannel: "telegram" as const,
    agentAccountId: "123",
    agentTo: "456",
  };

  const validContent = Buffer.from("hello").toString("base64");

  async function spawnWithName(name: string) {
    return spawnSubagentDirect(
      {
        task: "test",
        attachments: [{ name, content: validContent, encoding: "base64" }],
      },
      ctx,
    );
  }

  it("name with / returns attachments_invalid_name", async () => {
    const result = await spawnWithName("foo/bar");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_invalid_name/);
  });

  it("name '..' returns attachments_invalid_name", async () => {
    const result = await spawnWithName("..");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_invalid_name/);
  });

  it("name '.manifest.json' returns attachments_invalid_name", async () => {
    const result = await spawnWithName(".manifest.json");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_invalid_name/);
  });

  it("name with newline returns attachments_invalid_name", async () => {
    const result = await spawnWithName("foo\nbar");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_invalid_name/);
  });

  it("duplicate name returns attachments_duplicate_name", async () => {
    const result = await spawnSubagentDirect(
      {
        task: "test",
        attachments: [
          { name: "file.txt", content: validContent, encoding: "base64" },
          { name: "file.txt", content: validContent, encoding: "base64" },
        ],
      },
      ctx,
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_duplicate_name/);
  });

  it("empty name returns attachments_invalid_name", async () => {
    const result = await spawnWithName("");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/attachments_invalid_name/);
  });

  it("injects recent requester references when task omits concrete identifiers", async () => {
    readRecentSessionMessagesMock.mockReturnValue([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请处理这个链接 https://x.com/kevinsxu/status/2029961571296743585 ，并读取文件 `kevinsxu_tweet_2029961571296743585.txt`。",
          },
        ],
      },
    ]);

    const result = await spawnSubagentDirect(
      {
        task: "将推文内容导入到NotebookLM，并请求生成信息图和PPT",
      },
      ctx,
    );

    expect(result.status).toBe("accepted");
    const params = findAgentMessage();
    expect(params?.message).toContain("[Requester Context]");
    expect(params?.message).toContain("https://x.com/kevinsxu/status/2029961571296743585");
    expect(params?.message).toContain("kevinsxu_tweet_2029961571296743585.txt");
  });

  it("does not inject requester context when task already includes a concrete reference", async () => {
    readRecentSessionMessagesMock.mockReturnValue([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请处理这个链接 https://x.com/kevinsxu/status/2029961571296743585",
          },
        ],
      },
    ]);

    const result = await spawnSubagentDirect(
      {
        task: "处理这个链接 https://x.com/kevinsxu/status/2029961571296743585 并生成 PPT",
      },
      ctx,
    );

    expect(result.status).toBe("accepted");
    const params = findAgentMessage();
    expect(params?.message).not.toContain("[Requester Context]");
  });
});
