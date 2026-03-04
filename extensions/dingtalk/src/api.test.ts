import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDingtalkSignedUrl, sendDingtalkText } from "./api.js";

describe("dingtalk api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends timestamp and sign when secret is configured", () => {
    const signed = buildDingtalkSignedUrl({
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=test",
      secret: "SECxxx",
      timestamp: 1700000000000,
    });
    const parsed = new URL(signed);
    expect(parsed.searchParams.get("access_token")).toBe("test");
    expect(parsed.searchParams.get("timestamp")).toBe("1700000000000");
    expect(parsed.searchParams.get("sign")).toBeTruthy();
  });

  it("sends text payload to dingtalk webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errcode: 0 }),
      status: 200,
      statusText: "OK",
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendDingtalkText({
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=test",
      text: "hello",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("oapi.dingtalk.com/robot/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      msgtype: "text",
      text: { content: "hello" },
    });
  });
});
