import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createMockServerResponse } from "../../../src/test-utils/mock-http-response.js";
import type { ResolvedDingtalkAccount } from "./accounts.js";

const { sendDingtalkTextMock } = vi.hoisted(() => ({
  sendDingtalkTextMock: vi.fn(async () => {}),
}));

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return {
    ...actual,
    sendDingtalkText: sendDingtalkTextMock,
  };
});

import { handleDingtalkWebhookRequest, registerDingtalkWebhookTarget } from "./monitor.js";

function createWebhookRequest(payload: unknown): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & {
    destroyed?: boolean;
    destroy: (error?: Error) => IncomingMessage;
  };
  req.method = "POST";
  req.url = "/dingtalk";
  req.headers = {
    "content-type": "application/json",
  };
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
    return req;
  };

  void Promise.resolve().then(() => {
    req.emit("data", Buffer.from(JSON.stringify(payload), "utf-8"));
    if (!req.destroyed) {
      req.emit("end");
    }
  });

  return req;
}

describe("DingTalk ping command", () => {
  it("replies pong without invoking model flow", async () => {
    sendDingtalkTextMock.mockClear();

    const account = {
      accountId: "default",
      enabled: true,
      configured: true,
      config: {
        webhookPath: "/dingtalk",
        dm: {
          policy: "open",
        },
      },
    } as ResolvedDingtalkAccount;

    const unregister = registerDingtalkWebhookTarget({
      account,
      config: {} as OpenClawConfig,
      runtime: {},
      core: {} as PluginRuntime,
      path: "/dingtalk",
    });

    try {
      const res = createMockServerResponse();
      const handled = await handleDingtalkWebhookRequest(
        createWebhookRequest({
          text: { content: "ping" },
          senderId: "u-test",
          conversationId: "cid-test",
          sessionWebhook: "https://example.com/dingtalk-session-webhook",
        }),
        res,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);

      await vi.waitFor(() => {
        expect(sendDingtalkTextMock).toHaveBeenCalledWith(
          expect.objectContaining({
            webhookUrl: "https://example.com/dingtalk-session-webhook",
            text: "pong",
          }),
        );
      });
    } finally {
      unregister();
    }
  });
});
