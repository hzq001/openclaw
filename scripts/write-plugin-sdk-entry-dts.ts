import fs from "node:fs";
import path from "node:path";

// `tsc` emits declarations under `dist/plugin-sdk/plugin-sdk/*` because the source lives
// at `src/plugin-sdk/*` and `rootDir` is `src/`.
//
// Our package export map points subpath `types` at `dist/plugin-sdk/<entry>.d.ts`, so we
// generate stable entry d.ts files that re-export the real declarations.
//
// Runtime JS subpath shims are also required because the package export map points
// `openclaw/plugin-sdk/<entry>` at `dist/plugin-sdk/<entry>.js`. tsdown currently emits a
// single `dist/plugin-sdk/index.js`, so we synthesize missing subpath files that re-export
// from the root runtime entry.
const entrypoints = [
  "index",
  "core",
  "compat",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
  "whatsapp",
  "line",
  "msteams",
  "acpx",
  "bluebubbles",
  "copilot-proxy",
  "device-pair",
  "diagnostics-otel",
  "diffs",
  "feishu",
  "google-gemini-cli-auth",
  "googlechat",
  "irc",
  "llm-task",
  "lobster",
  "matrix",
  "mattermost",
  "memory-core",
  "memory-lancedb",
  "minimax-portal-auth",
  "nextcloud-talk",
  "nostr",
  "open-prose",
  "phone-control",
  "qwen-portal-auth",
  "synology-chat",
  "talk-voice",
  "test-utils",
  "thread-ownership",
  "tlon",
  "twitch",
  "voice-call",
  "zalo",
  "zalouser",
  "account-id",
  "keyed-async-queue",
] as const;
for (const entry of entrypoints) {
  const dtsOut = path.join(process.cwd(), `dist/plugin-sdk/${entry}.d.ts`);
  fs.mkdirSync(path.dirname(dtsOut), { recursive: true });
  // NodeNext: reference the runtime specifier with `.js`, TS will map it to `.d.ts`.
  fs.writeFileSync(dtsOut, `export * from "./plugin-sdk/${entry}.js";\n`, "utf8");

  if (entry === "index") {
    continue;
  }

  const jsOut = path.join(process.cwd(), `dist/plugin-sdk/${entry}.js`);
  if (!fs.existsSync(jsOut)) {
    fs.writeFileSync(jsOut, `export * from "./index.js";\n`, "utf8");
  }
}
