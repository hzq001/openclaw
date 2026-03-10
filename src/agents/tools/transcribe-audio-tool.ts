import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { transcribeAudioFile } from "../../media-understanding/transcribe-audio.js";
import { extensionForMime } from "../../media/mime.js";
import { resolveUserPath } from "../../utils.js";
import { loadWebMedia } from "../../web/media.js";
import { readNumberParam, readStringParam } from "./common.js";
import { resolveMediaToolLocalRoots } from "./media-tool-shared.js";
import {
  createSandboxBridgeReadFile,
  resolveSandboxedBridgeMediaPath,
  type AnyAgentTool,
  type SandboxedBridgeMediaPathConfig,
  type SandboxFsBridge,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";

type AudioSandboxConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

function applyAudioMaxBytesOverride(
  cfg: OpenClawConfig,
  maxBytesMb?: number,
): { cfg: OpenClawConfig; maxBytes: number | undefined } {
  if (typeof maxBytesMb === "number" && Number.isFinite(maxBytesMb) && maxBytesMb > 0) {
    const maxBytes = Math.floor(maxBytesMb * 1024 * 1024);
    return {
      cfg: {
        ...cfg,
        tools: {
          ...cfg.tools,
          media: {
            ...cfg.tools?.media,
            audio: {
              ...cfg.tools?.media?.audio,
              maxBytes,
            },
          },
        },
      },
      maxBytes,
    };
  }
  return { cfg, maxBytes: cfg.tools?.media?.audio?.maxBytes };
}

function resolveAudioFileName(params: {
  source: string;
  fileName?: string;
  mime?: string;
}): string {
  const sourceBase = (() => {
    if (params.fileName?.trim()) {
      return path.basename(params.fileName.trim());
    }
    try {
      if (/^https?:\/\//i.test(params.source)) {
        const pathname = new URL(params.source).pathname;
        const candidate = path.basename(pathname);
        if (candidate) {
          return candidate;
        }
      }
    } catch {
      // Fall through to plain path parsing.
    }
    const candidate = path.basename(params.source);
    return candidate || "audio";
  })();
  if (path.extname(sourceBase)) {
    return sourceBase;
  }
  const ext = extensionForMime(params.mime);
  return ext ? `${sourceBase}${ext}` : `${sourceBase}.audio`;
}

export function createTranscribeAudioTool(options?: {
  config?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  sandbox?: AudioSandboxConfig;
  fsPolicy?: ToolFsPolicy;
}): AnyAgentTool {
  const localRoots = resolveMediaToolLocalRoots(options?.workspaceDir, {
    workspaceOnly: options?.fsPolicy?.workspaceOnly === true,
  });

  return {
    label: "Transcribe Audio",
    name: "transcribe_audio",
    description:
      "Transcribe an audio file through OpenClaw's configured media pipeline. Use this instead of running whisper/whisperx manually.",
    parameters: Type.Object({
      audio: Type.String({ description: "Audio path or URL to transcribe." }),
      mime: Type.Optional(
        Type.String({ description: "Optional MIME type override, e.g. audio/mpeg." }),
      ),
      maxBytesMb: Type.Optional(
        Type.Number({
          description: "Optional max download/read size in MB for this transcription request.",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const audioInput = readStringParam(params, "audio", { required: true });
      const mimeOverride = readStringParam(params, "mime");
      const maxBytesMb = readNumberParam(params, "maxBytesMb");
      const cfgBase = options?.config ?? loadConfig();
      const { cfg, maxBytes } = applyAudioMaxBytesOverride(cfgBase, maxBytesMb);
      const sandboxConfig: SandboxedBridgeMediaPathConfig | null =
        options?.sandbox && options.sandbox.root.trim()
          ? {
              root: options.sandbox.root.trim(),
              bridge: options.sandbox.bridge,
              workspaceOnly: options.fsPolicy?.workspaceOnly === true,
            }
          : null;

      const trimmed = audioInput.trim();
      const audioSource = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
      const looksLikeWindowsDrive = /^[a-zA-Z]:[\\/]/.test(audioSource);
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(audioSource);
      const isFileUrl = /^file:/i.test(audioSource);
      const isHttpUrl = /^https?:\/\//i.test(audioSource);
      if (hasScheme && !looksLikeWindowsDrive && !isFileUrl && !isHttpUrl) {
        return {
          content: [
            {
              type: "text",
              text: `Unsupported audio reference: ${audioInput}. Use a file path, file:// URL, or http(s) URL.`,
            },
          ],
          details: { error: "unsupported_audio_reference", source: audioInput },
        };
      }
      if (sandboxConfig && isHttpUrl) {
        throw new Error("Sandboxed transcribe_audio tool does not allow remote URLs.");
      }

      const resolvedAudio = (() => {
        if (sandboxConfig) {
          return audioSource;
        }
        if (audioSource.startsWith("~")) {
          return resolveUserPath(audioSource);
        }
        return audioSource;
      })();
      const resolvedPathInfo: { resolved: string; rewrittenFrom?: string } = sandboxConfig
        ? await resolveSandboxedBridgeMediaPath({
            sandbox: sandboxConfig,
            mediaPath: resolvedAudio,
            inboundFallbackDir: "media/inbound",
          })
        : {
            resolved: resolvedAudio.startsWith("file://")
              ? resolvedAudio.slice("file://".length)
              : resolvedAudio,
          };

      const media = sandboxConfig
        ? await loadWebMedia(resolvedPathInfo.resolved, {
            maxBytes,
            sandboxValidated: true,
            readFile: createSandboxBridgeReadFile({ sandbox: sandboxConfig }),
          })
        : await loadWebMedia(resolvedPathInfo.resolved, {
            maxBytes,
            localRoots,
          });
      if (media.kind !== "audio") {
        throw new Error(`Unsupported media type for transcribe_audio: ${media.kind}`);
      }

      const mime = mimeOverride?.trim() || media.contentType;
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcribe-audio-"));
      const tempFilePath = path.join(
        tempDir,
        resolveAudioFileName({
          source: audioSource,
          fileName: media.fileName,
          mime,
        }),
      );
      await fs.writeFile(tempFilePath, media.buffer);

      try {
        const result = await transcribeAudioFile({
          filePath: tempFilePath,
          cfg,
          agentDir: options?.agentDir,
          mime,
        });
        const transcript = result.text?.trim();
        if (!transcript) {
          return {
            content: [
              {
                type: "text",
                text: "No transcript produced by the configured audio transcription pipeline.",
              },
            ],
            details: {
              error: "no_transcript",
              source: audioSource,
              ...(mime ? { mime } : {}),
              ...(resolvedPathInfo.rewrittenFrom
                ? { rewrittenFrom: resolvedPathInfo.rewrittenFrom }
                : {}),
            },
          };
        }
        return {
          content: [{ type: "text", text: transcript }],
          details: {
            source: audioSource,
            transcript,
            ...(mime ? { mime } : {}),
            ...(resolvedPathInfo.rewrittenFrom
              ? { rewrittenFrom: resolvedPathInfo.rewrittenFrom }
              : {}),
          },
        };
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}
