import { describe, expect, it } from "vitest";
import { computeDingtalkReconnectDelay } from "./monitor.js";

describe("dingtalk reconnect delay", () => {
  it("returns base delay when jitter is disabled", () => {
    const delay = computeDingtalkReconnectDelay({
      baseDelayMs: 2000,
      jitterRatio: 0,
      random: () => 0.9,
    });
    expect(delay).toBe(2000);
  });

  it("applies lower jitter bound when random is 0", () => {
    const delay = computeDingtalkReconnectDelay({
      baseDelayMs: 2000,
      jitterRatio: 0.2,
      random: () => 0,
    });
    expect(delay).toBe(1600);
  });

  it("applies upper jitter bound when random is 1", () => {
    const delay = computeDingtalkReconnectDelay({
      baseDelayMs: 2000,
      jitterRatio: 0.2,
      random: () => 1,
    });
    expect(delay).toBe(2400);
  });
});
