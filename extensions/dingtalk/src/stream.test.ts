import { describe, expect, it } from "vitest";
import {
  buildDingtalkStreamAck,
  buildDingtalkStreamOpenBody,
  openDingtalkStreamConnection,
  parseDingtalkStreamInbound,
} from "./stream.js";

describe("dingtalk stream", () => {
  it("builds default open body with bot callback topic", () => {
    const body = buildDingtalkStreamOpenBody({
      clientId: "ding-client",
      clientSecret: "ding-secret",
      userAgent: "openclaw-dingtalk/1.0.0",
      localIp: "10.0.0.8",
    });

    expect(body.clientId).toBe("ding-client");
    expect(body.clientSecret).toBe("ding-secret");
    expect(body.localIp).toBe("10.0.0.8");
    expect(body.subscriptions).toEqual([
      { type: "EVENT", topic: "*" },
      { type: "CALLBACK", topic: "/v1.0/im/bot/messages/get" },
    ]);
  });

  it("builds stream ack payload with response null", () => {
    const ack = buildDingtalkStreamAck("msg-123");

    expect(ack).toEqual({
      code: 200,
      message: "OK",
      headers: {
        messageId: "msg-123",
        contentType: "application/json",
      },
      data: '{"response":null}',
    });
  });

  it("parses inbound message even when stream topic/type differ", () => {
    const inbound = parseDingtalkStreamInbound({
      type: "EVENT",
      headers: {
        topic: "/v1.0/im/bot/messages/receive",
      },
      data: JSON.stringify({
        text: { content: "ping" },
        senderStaffId: "u-1",
        conversationId: "cid-1",
      }),
    });

    expect(inbound).toEqual({
      text: { content: "ping" },
      senderStaffId: "u-1",
      conversationId: "cid-1",
    });
  });

  it("parses nested inbound message payload from stream data wrapper", () => {
    const inbound = parseDingtalkStreamInbound({
      type: "EVENT",
      headers: {
        topic: "/v1.0/im/bot/messages/receive",
      },
      data: JSON.stringify({
        data: {
          text: { content: "ping" },
          senderId: "u-2",
          conversationId: "cid-2",
        },
      }),
    });

    expect(inbound).toEqual({
      text: { content: "ping" },
      senderId: "u-2",
      conversationId: "cid-2",
    });
  });

  it("fails fast when stream open request times out", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        init?.signal?.addEventListener("abort", onAbort, { once: true });
      });

    await expect(
      openDingtalkStreamConnection({
        clientId: "ding-client",
        clientSecret: "ding-secret",
        timeoutMs: 10,
        fetchImpl,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
