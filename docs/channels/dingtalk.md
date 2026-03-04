---
summary: "DingTalk bot Stream mode setup (no public domain required)"
read_when:
  - You want to connect OpenClaw to DingTalk
  - You need DingTalk Stream mode without exposing a public webhook domain
title: "DingTalk"
---

# DingTalk (plugin)

Status: supported via plugin using DingTalk bot Stream mode and webhook mode.

The plugin supports inbound messages from Stream mode (recommended) and webhook mode.
Replies are buffered and delivered as final messages (no streaming fragments).

## Plugin required

DingTalk is plugin-based and not bundled in the core channel set.

Install from a local checkout:

```bash
openclaw plugins install ./extensions/dingtalk
```

Details: [Plugins](/tools/plugin)

## Quick setup (Stream mode, no domain)

1. Install and enable the DingTalk plugin.
2. In DingTalk Open Platform, use your enterprise app credentials:
   - `Client ID` (AppKey)
   - `Client Secret` (AppSecret)
3. Subscribe to bot messages for the app (`/v1.0/im/bot/messages/get` callback topic).
4. Configure OpenClaw:
   - `channels.dingtalk.connectionMode = "stream"`
   - `channels.dingtalk.clientId`
   - `channels.dingtalk.clientSecret`
5. Restart gateway and send a direct message to the bot.

Minimal config:

```json5
{
  channels: {
    dingtalk: {
      enabled: true,
      connectionMode: "stream",
      clientId: "dingxxxx",
      clientSecret: "xxxxxx",
      dm: {
        policy: "pairing",
      },
      groupPolicy: "allowlist",
      groupAllowFrom: ["manager_staff_id"],
      requireMention: true,
      botName: "OpenClaw",
      botUserId: "ding_bot_user_id",
    },
  },
}
```

## Access control

- DM policy defaults to pairing via `channels.dingtalk.dm.policy`.
- Allowlist mode uses `channels.dingtalk.dm.allowFrom`.
- Group sender allowlist uses `channels.dingtalk.groupAllowFrom`.
- `requireMention: true` in groups only processes messages that mention the bot (by `botUserId` in `atUsers`, or `@botName` text match).

Pairing commands:

```bash
openclaw pairing list dingtalk
openclaw pairing approve dingtalk <CODE>
```

## Outbound usage

If `defaultTo` is configured, you can send without explicit `--target`:

```bash
openclaw message send --channel dingtalk --text "hello from OpenClaw"
```

Or send to a specific webhook URL:

```bash
openclaw message send --channel dingtalk --target "https://oapi.dingtalk.com/robot/send?access_token=xxxx" --text "hello"
```

## Notes

- Stream mode does not require a public inbound domain; the gateway only needs outbound internet access.
- If multiple DingTalk accounts share the same webhook path and request signature cannot disambiguate, the plugin rejects the webhook with `401 ambiguous webhook target`.
- For production, expose only `/dingtalk` publicly and keep control UI endpoints private.

## Webhook mode (optional)

If your environment requires webhook callbacks instead of Stream:

- Set `channels.dingtalk.connectionMode = "webhook"`.
- Configure `channels.dingtalk.webhookPath` (default `/dingtalk`).
- Configure `channels.dingtalk.outboundWebhookUrl` (or `defaultTo`).
- If webhook signature is enabled, set `channels.dingtalk.secret` (or `signingSecret`).
