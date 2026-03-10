import path from "node:path";
import "./reply.directive.directive-behavior.e2e-mocks.js";
import { describe, expect, it } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import type { OpenClawConfig } from "../config/config.js";
import { runEmbeddedPiAgentMock } from "./reply.directive.directive-behavior.e2e-mocks.js";
import { getReplyFromConfig } from "./reply.js";

function makeResult(text: string) {
  return {
    payloads: [{ text }],
    meta: {
      durationMs: 5,
      agentMeta: { sessionId: "s", provider: "p", model: "m" },
    },
  };
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(
    async (home) => {
      runEmbeddedPiAgentMock.mockClear();
      return await fn(home);
    },
    {
      env: {
        OPENCLAW_BUNDLED_SKILLS_DIR: (home) => path.join(home, "bundled-skills"),
      },
      prefix: "openclaw-media-note-",
    },
  );
}

function makeCfg(home: string) {
  return {
    agents: {
      defaults: {
        model: "anthropic/claude-opus-4-5",
        workspace: path.join(home, "openclaw"),
      },
    },
    channels: { whatsapp: { allowFrom: ["*"] } },
    session: { store: path.join(home, "sessions.json") },
  } as unknown as OpenClawConfig;
}

describe("getReplyFromConfig media note plumbing", () => {
  it("includes all MediaPaths in the agent prompt", async () => {
    await withTempHome(async (home) => {
      let seenPrompt: string | undefined;
      runEmbeddedPiAgentMock.mockImplementation(async (params) => {
        seenPrompt = params.prompt;
        return makeResult("ok");
      });

      const cfg = makeCfg(home);
      const res = await getReplyFromConfig(
        {
          Body: "hello",
          From: "+1001",
          To: "+2000",
          MediaPaths: ["/tmp/a.png", "/tmp/b.png"],
          MediaUrls: ["/tmp/a.png", "/tmp/b.png"],
        },
        {},
        cfg,
      );

      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text).toBe("ok");
      expect(seenPrompt).toBeTruthy();
      expect(seenPrompt).toContain("[media attached: 2 files]");
      const idxA = seenPrompt?.indexOf("[media attached 1/2: /tmp/a.png");
      const idxB = seenPrompt?.indexOf("[media attached 2/2: /tmp/b.png");
      expect(typeof idxA).toBe("number");
      expect(typeof idxB).toBe("number");
      expect((idxA ?? -1) >= 0).toBe(true);
      expect((idxB ?? -1) >= 0).toBe(true);
      expect((idxA ?? 0) < (idxB ?? 0)).toBe(true);
    });
  });

  it("shows skipped audio status without exposing the raw audio path", async () => {
    await withTempHome(async (home) => {
      let seenPrompt: string | undefined;
      runEmbeddedPiAgentMock.mockImplementation(async (params) => {
        seenPrompt = params.prompt;
        return makeResult("ok");
      });

      const cfg = makeCfg(home);
      const res = await getReplyFromConfig(
        {
          Body: "帮我总结这个音频",
          From: "+1001",
          To: "+2000",
          MediaPaths: ["/tmp/voice.ogg", "/tmp/image.png"],
          MediaUrls: ["https://example.com/voice.ogg", "https://example.com/image.png"],
          MediaTypes: ["audio/ogg", "image/png"],
          MediaUnderstandingDecisions: [
            {
              capability: "audio",
              outcome: "skipped",
              attachments: [
                {
                  attachmentIndex: 0,
                  attempts: [
                    {
                      type: "cli",
                      outcome: "skipped",
                      reason: "maxBytes: too large",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {},
        cfg,
      );

      const text = Array.isArray(res) ? res[0]?.text : res?.text;
      expect(text).toBe("ok");
      expect(seenPrompt).toContain("[audio status: transcription unavailable (maxBytes)]");
      expect(seenPrompt).toContain("[media attached: /tmp/image.png");
      expect(seenPrompt).not.toContain("/tmp/voice.ogg");
    });
  });
});
