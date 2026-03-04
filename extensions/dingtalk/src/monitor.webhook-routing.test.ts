import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../../src/test-utils/mock-http-response.js";
import type { ResolvedDingtalkAccount } from "./accounts.js";
import { handleDingtalkWebhookRequest, registerDingtalkWebhookTarget } from "./monitor.js";

function createWebhookRequest(params: { payload: unknown; path?: string }): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & {
    destroyed?: boolean;
    destroy: (error?: Error) => IncomingMessage;
  };
  req.method = "POST";
  req.url = params.path ?? "/dingtalk";
  req.headers = {
    "content-type": "application/json",
  };
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
    return req;
  };

  void Promise.resolve().then(() => {
    req.emit("data", Buffer.from(JSON.stringify(params.payload), "utf-8"));
    if (!req.destroyed) {
      req.emit("end");
    }
  });

  return req;
}

const baseAccount = (accountId: string) =>
  ({
    accountId,
    enabled: true,
    configured: true,
    config: {
      webhookPath: "/dingtalk",
    },
  }) as ResolvedDingtalkAccount;

function registerTwoTargets() {
  const sinkA = vi.fn();
  const sinkB = vi.fn();
  const core = {} as PluginRuntime;
  const config = {} as OpenClawConfig;

  const unregisterA = registerDingtalkWebhookTarget({
    account: baseAccount("A"),
    config,
    runtime: {},
    core,
    path: "/dingtalk",
    statusSink: sinkA,
  });
  const unregisterB = registerDingtalkWebhookTarget({
    account: baseAccount("B"),
    config,
    runtime: {},
    core,
    path: "/dingtalk",
    statusSink: sinkB,
  });

  return {
    sinkA,
    sinkB,
    unregister: () => {
      unregisterA();
      unregisterB();
    },
  };
}

describe("DingTalk webhook routing", () => {
  it("returns 401 when multiple accounts share same webhook path", async () => {
    const { sinkA, sinkB, unregister } = registerTwoTargets();

    try {
      const res = createMockServerResponse();
      const handled = await handleDingtalkWebhookRequest(
        createWebhookRequest({
          payload: {
            text: { content: "hello" },
            senderId: "u1",
            conversationId: "cid1",
          },
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(401);
      expect(sinkA).not.toHaveBeenCalled();
      expect(sinkB).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});
