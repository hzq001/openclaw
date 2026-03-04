import crypto from "node:crypto";

function resolveSign(secret: string, timestamp: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
}

export function buildDingtalkSignedUrl(params: {
  webhookUrl: string;
  secret?: string;
  timestamp?: number;
}): string {
  const parsed = new URL(params.webhookUrl);
  const secret = params.secret?.trim();
  if (!secret) {
    return parsed.toString();
  }
  const timestamp = String(params.timestamp ?? Date.now());
  const sign = resolveSign(secret, timestamp);
  parsed.searchParams.set("timestamp", timestamp);
  parsed.searchParams.set("sign", sign);
  return parsed.toString();
}

export async function sendDingtalkText(params: {
  webhookUrl: string;
  text: string;
  secret?: string;
}): Promise<void> {
  const { webhookUrl, text, secret } = params;
  const body = {
    msgtype: "text",
    text: { content: text },
  };

  const response = await fetch(buildDingtalkSignedUrl({ webhookUrl, secret }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`DingTalk webhook ${response.status}: ${detail || response.statusText}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    errcode?: number;
    errmsg?: string;
  } | null;
  if (payload && typeof payload.errcode === "number" && payload.errcode !== 0) {
    throw new Error(
      `DingTalk webhook error ${payload.errcode}: ${payload.errmsg ?? "unknown error"}`,
    );
  }
}

export function verifyDingtalkSignature(params: {
  secret?: string;
  timestamp?: string | null;
  sign?: string | null;
}): boolean {
  const secret = params.secret?.trim();
  if (!secret) {
    return true;
  }
  const timestamp = params.timestamp?.trim();
  const sign = params.sign?.trim();
  if (!timestamp || !sign) {
    return false;
  }

  const expected = resolveSign(secret, timestamp);
  const actualSign = decodeURIComponent(sign);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actualSign, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
