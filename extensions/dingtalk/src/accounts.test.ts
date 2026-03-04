import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import { resolveDingtalkAccount } from "./accounts.js";

describe("resolveDingtalkAccount", () => {
  it("treats stream mode as configured when client credentials are present", () => {
    const cfg = {
      channels: {
        dingtalk: {
          connectionMode: "stream",
          clientId: "ding-client",
          clientSecret: "ding-secret",
        },
      },
    } as OpenClawConfig;

    const account = resolveDingtalkAccount({ cfg });
    expect(account.configured).toBe(true);
  });

  it("treats stream mode as unconfigured when client credentials are missing", () => {
    const cfg = {
      channels: {
        dingtalk: {
          connectionMode: "stream",
          clientId: "ding-client",
        },
      },
    } as OpenClawConfig;

    const account = resolveDingtalkAccount({ cfg });
    expect(account.configured).toBe(false);
  });
});
