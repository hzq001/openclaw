import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

const { loadWebMedia, transcribeAudioFile } = vi.hoisted(() => ({
  loadWebMedia: vi.fn(),
  transcribeAudioFile: vi.fn(),
}));

vi.mock("../../web/media.js", async () => {
  const actual = await vi.importActual<typeof import("../../web/media.js")>("../../web/media.js");
  return {
    ...actual,
    loadWebMedia,
  };
});

vi.mock("../../media-understanding/transcribe-audio.js", () => ({
  transcribeAudioFile,
}));

import { createTranscribeAudioTool } from "./transcribe-audio-tool.js";

describe("createTranscribeAudioTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transcribes audio through the configured media pipeline", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcribe-tool-"));
    try {
      const cfg = {
        tools: {
          media: {
            audio: {
              maxBytes: 20 * 1024 * 1024,
            },
          },
        },
      } as OpenClawConfig;
      loadWebMedia.mockResolvedValue({
        buffer: Buffer.from("audio-bytes"),
        kind: "audio",
        contentType: "audio/mpeg",
        fileName: "note.mp3",
      });
      transcribeAudioFile.mockImplementation(async (params: { filePath: string }) => {
        expect(await fs.readFile(params.filePath, "utf8")).toBe("audio-bytes");
        return { text: "转写成功" };
      });

      const tool = createTranscribeAudioTool({ config: cfg, workspaceDir, agentDir: workspaceDir });
      const result = await tool.execute("call1", { audio: "./note.mp3", maxBytesMb: 64 });

      expect(loadWebMedia).toHaveBeenCalledWith("./note.mp3", expect.objectContaining({}));
      expect(transcribeAudioFile).toHaveBeenCalledTimes(1);
      expect(transcribeAudioFile.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          agentDir: workspaceDir,
          mime: "audio/mpeg",
          cfg: expect.objectContaining({
            tools: {
              media: {
                audio: expect.objectContaining({
                  maxBytes: 64 * 1024 * 1024,
                }),
              },
            },
          }),
        }),
      );
      const invokedFilePath = transcribeAudioFile.mock.calls[0]?.[0]?.filePath as string;
      await expect(fs.readFile(invokedFilePath, "utf8")).rejects.toThrow();
      expect(result.content[0]).toEqual({ type: "text", text: "转写成功" });
      expect(result.details).toEqual(
        expect.objectContaining({
          source: "./note.mp3",
          mime: "audio/mpeg",
          transcript: "转写成功",
        }),
      );
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns a readable failure when no transcript is produced", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcribe-tool-"));
    try {
      loadWebMedia.mockResolvedValue({
        buffer: Buffer.from("audio-bytes"),
        kind: "audio",
        contentType: "audio/wav",
        fileName: "note.wav",
      });
      transcribeAudioFile.mockResolvedValue({ text: undefined });

      const tool = createTranscribeAudioTool({ workspaceDir, agentDir: workspaceDir });
      const result = await tool.execute("call2", { audio: "./note.wav" });

      expect(result.content[0]).toEqual({
        type: "text",
        text: "No transcript produced by the configured audio transcription pipeline.",
      });
      expect(result.details).toEqual(
        expect.objectContaining({
          error: "no_transcript",
          source: "./note.wav",
        }),
      );
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
