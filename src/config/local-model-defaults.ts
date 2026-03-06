import type { OpenClawConfig } from "./types.js";

export const DEFAULT_LOCAL_GENERAL_MODEL = "openai/gpt-5.2";
export const DEFAULT_LOCAL_CODING_MODEL = "openai-codex/gpt-5.3-codex";

function normalizeConfiguredModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveLocalGeneralModelRef(cfg: OpenClawConfig): string {
  return (
    normalizeConfiguredModel(cfg.agents?.defaults?.localModels?.general) ??
    DEFAULT_LOCAL_GENERAL_MODEL
  );
}

export function resolveLocalCodingModelRef(cfg: OpenClawConfig): string {
  return (
    normalizeConfiguredModel(cfg.agents?.defaults?.localModels?.coding) ??
    DEFAULT_LOCAL_CODING_MODEL
  );
}
