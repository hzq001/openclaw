import type { MsgContext } from "./templating.js";

function formatMediaAttachedLine(params: {
  path: string;
  url?: string;
  type?: string;
  index?: number;
  total?: number;
}): string {
  const prefix =
    typeof params.index === "number" && typeof params.total === "number"
      ? `[media attached ${params.index}/${params.total}: `
      : "[media attached: ";
  const typePart = params.type?.trim() ? ` (${params.type.trim()})` : "";
  const urlRaw = params.url?.trim();
  const urlPart = urlRaw ? ` | ${urlRaw}` : "";
  return `${prefix}${params.path}${typePart}${urlPart}]`;
}

// Common audio file extensions for transcription detection
const AUDIO_EXTENSIONS = new Set([
  ".ogg",
  ".opus",
  ".mp3",
  ".m4a",
  ".wav",
  ".webm",
  ".flac",
  ".aac",
  ".wma",
  ".aiff",
  ".alac",
  ".oga",
]);

function isAudioPath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const lower = path.toLowerCase();
  for (const ext of AUDIO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function summarizeAttemptReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  const [head] = trimmed.split(":", 1);
  return head?.trim() || undefined;
}

function formatAudioStatusLine(status: string): string {
  return `[audio status: ${status}]`;
}

function buildAudioStatusByAttachmentIndex(ctx: MsgContext): Map<number, string> {
  const statuses = new Map<number, string>();
  if (!Array.isArray(ctx.MediaUnderstandingDecisions)) {
    return statuses;
  }
  for (const decision of ctx.MediaUnderstandingDecisions) {
    if (decision.capability !== "audio") {
      continue;
    }
    for (const attachment of decision.attachments) {
      if (attachment.chosen?.outcome === "success" || statuses.has(attachment.attachmentIndex)) {
        continue;
      }
      const reason = attachment.attempts
        .map((attempt) => summarizeAttemptReason(attempt.reason))
        .find(Boolean);
      const baseStatus =
        decision.outcome === "disabled"
          ? "transcription disabled"
          : decision.outcome === "scope-deny"
            ? "transcription denied"
            : "transcription unavailable";
      statuses.set(
        attachment.attachmentIndex,
        formatAudioStatusLine(`${baseStatus}${reason ? ` (${reason})` : ""}`),
      );
    }
  }
  return statuses;
}

export function buildInboundMediaNote(ctx: MsgContext): string | undefined {
  // Attachment indices follow MediaPaths/MediaUrls ordering as supplied by the channel.
  const suppressed = new Set<number>();
  const transcribedAudioIndices = new Set<number>();
  if (Array.isArray(ctx.MediaUnderstanding)) {
    for (const output of ctx.MediaUnderstanding) {
      suppressed.add(output.attachmentIndex);
      if (output.kind === "audio.transcription") {
        transcribedAudioIndices.add(output.attachmentIndex);
      }
    }
  }
  if (Array.isArray(ctx.MediaUnderstandingDecisions)) {
    for (const decision of ctx.MediaUnderstandingDecisions) {
      if (decision.outcome !== "success") {
        continue;
      }
      for (const attachment of decision.attachments) {
        if (attachment.chosen?.outcome === "success") {
          suppressed.add(attachment.attachmentIndex);
          if (decision.capability === "audio") {
            transcribedAudioIndices.add(attachment.attachmentIndex);
          }
        }
      }
    }
  }
  const pathsFromArray = Array.isArray(ctx.MediaPaths) ? ctx.MediaPaths : undefined;
  const paths =
    pathsFromArray && pathsFromArray.length > 0
      ? pathsFromArray
      : ctx.MediaPath?.trim()
        ? [ctx.MediaPath.trim()]
        : [];
  if (paths.length === 0) {
    return undefined;
  }

  const urls =
    Array.isArray(ctx.MediaUrls) && ctx.MediaUrls.length === paths.length
      ? ctx.MediaUrls
      : undefined;
  const types =
    Array.isArray(ctx.MediaTypes) && ctx.MediaTypes.length === paths.length
      ? ctx.MediaTypes
      : undefined;
  const hasTranscript = Boolean(ctx.Transcript?.trim());
  const audioStatusByIndex = buildAudioStatusByAttachmentIndex(ctx);
  // Transcript alone does not identify an attachment index; only use it as a fallback
  // when there is a single attachment to avoid stripping unrelated audio files.
  const canStripSingleAttachmentByTranscript = hasTranscript && paths.length === 1;

  const entries = paths
    .map((entry, index) => ({
      path: entry ?? "",
      type: types?.[index] ?? ctx.MediaType,
      url: urls?.[index] ?? ctx.MediaUrl,
      index,
    }))
    .filter((entry) => {
      if (suppressed.has(entry.index)) {
        return false;
      }
      // Strip audio attachments when transcription succeeded - the transcript is already
      // available in the context, raw audio binary would only waste tokens (issue #4197)
      // Note: Only trust MIME type from per-entry types array, not fallback ctx.MediaType
      // which could misclassify non-audio attachments (greptile review feedback)
      const hasPerEntryType = types !== undefined;
      const isAudioByMime = hasPerEntryType && entry.type?.toLowerCase().startsWith("audio/");
      const isAudioEntry = isAudioPath(entry.path) || isAudioByMime;
      if (!isAudioEntry) {
        return true;
      }
      if (audioStatusByIndex.has(entry.index)) {
        return false;
      }
      if (
        transcribedAudioIndices.has(entry.index) ||
        (canStripSingleAttachmentByTranscript && entry.index === 0)
      ) {
        return false;
      }
      return true;
    });
  const audioStatusLines = paths
    .map((_, index) => audioStatusByIndex.get(index))
    .filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0 && audioStatusLines.length === 0) {
    return undefined;
  }
  if (entries.length === 0) {
    return audioStatusLines.join("\n");
  }
  const parts: string[] = [...audioStatusLines];
  if (entries.length === 1) {
    parts.push(
      formatMediaAttachedLine({
        path: entries[0]?.path ?? "",
        type: entries[0]?.type,
        url: entries[0]?.url,
      }),
    );
    return parts.join("\n");
  }

  const count = entries.length;
  const lines: string[] = [`[media attached: ${count} files]`];
  for (const [idx, entry] of entries.entries()) {
    lines.push(
      formatMediaAttachedLine({
        path: entry.path,
        index: idx + 1,
        total: count,
        type: entry.type,
        url: entry.url,
      }),
    );
  }
  parts.push(...lines);
  return parts.join("\n");
}
