import {
  BlockStreamingCoalesceSchema,
  DmConfigSchema,
  GroupPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";

export const DingtalkConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    connectionMode: z.enum(["stream", "webhook"]).optional().default("stream"),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    streamLocalIp: z.string().optional(),
    streamUserAgent: z.string().optional(),
    streamOpenTimeoutMs: z.number().int().positive().optional(),
    streamConnectTimeoutMs: z.number().int().positive().optional(),
    streamReconnectMaxMs: z.number().int().positive().optional(),
    streamReconnectJitter: z.number().min(0).max(1).optional(),
    webhookPath: z.string().optional(),
    webhookUrl: z.string().optional(),
    outboundWebhookUrl: z.string().optional(),
    defaultTo: z.string().optional(),
    secret: z.string().optional(),
    signingSecret: z.string().optional(),
    botUserId: z.string().optional(),
    botName: z.string().optional(),
    requireMention: z.boolean().optional(),
    dm: DmConfigSchema.optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(z.string()).optional(),
    textChunkLimit: z.number().int().positive().optional(),
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.connectionMode === "stream") {
      if (!value.clientId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clientId"],
          message: 'channels.dingtalk.connectionMode="stream" requires channels.dingtalk.clientId',
        });
      }
      if (!value.clientSecret?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clientSecret"],
          message:
            'channels.dingtalk.connectionMode="stream" requires channels.dingtalk.clientSecret',
        });
      }
    }

    requireOpenAllowFrom({
      policy: value.dm?.policy,
      allowFrom: value.dm?.allowFrom,
      ctx,
      path: ["dm", "allowFrom"],
      message:
        'channels.dingtalk.dm.policy="open" requires channels.dingtalk.dm.allowFrom to include "*"',
    });
  });
