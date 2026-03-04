import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeEnv } from "../../test-utils/runtime-env.js";
import type { ResolvedDingtalkAccount } from "./accounts.js";

const hoisted = vi.hoisted(() => ({
  startDingtalkMonitor: vi.fn(),
}));

vi.mock("./monitor.js", async () => {
  const actual = await vi.importActual<typeof import("./monitor.js")>("./monitor.js");
  return {
    ...actual,
    startDingtalkMonitor: hoisted.startDingtalkMonitor,
  };
});

import { dingtalkPlugin } from "./channel.js";

function createStartAccountCtx(params: {
  account: ResolvedDingtalkAccount;
  abortSignal: AbortSignal;
  statusPatchSink?: (next: ChannelAccountSnapshot) => void;
}): ChannelGatewayContext<ResolvedDingtalkAccount> {
  const snapshot: ChannelAccountSnapshot = {
    accountId: params.account.accountId,
    configured: true,
    enabled: true,
    running: false,
  };
  return {
    accountId: params.account.accountId,
    account: params.account,
    cfg: {} as OpenClawConfig,
    runtime: createRuntimeEnv(),
    abortSignal: params.abortSignal,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getStatus: () => snapshot,
    setStatus: (next) => {
      Object.assign(snapshot, next);
      params.statusPatchSink?.(snapshot);
    },
  };
}

describe("dingtalkPlugin gateway.startAccount", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps startAccount pending until abort, then unregisters", async () => {
    const unregister = vi.fn();
    hoisted.startDingtalkMonitor.mockResolvedValue(unregister);

    const account: ResolvedDingtalkAccount = {
      accountId: "default",
      enabled: true,
      configured: true,
      config: {
        webhookPath: "/dingtalk",
      },
    };

    const patches: ChannelAccountSnapshot[] = [];
    const abort = new AbortController();
    const task = dingtalkPlugin.gateway!.startAccount!(
      createStartAccountCtx({
        account,
        abortSignal: abort.signal,
        statusPatchSink: (next) => patches.push({ ...next }),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    let settled = false;
    void task.then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    expect(hoisted.startDingtalkMonitor).toHaveBeenCalledOnce();
    expect(unregister).not.toHaveBeenCalled();

    abort.abort();
    await task;

    expect(unregister).toHaveBeenCalledOnce();
    expect(patches.some((entry) => entry.running === true)).toBe(true);
    expect(patches.some((entry) => entry.running === false)).toBe(true);
  });
});
