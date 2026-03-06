import { describe, expect, it } from "vitest";
import { extractIMessageAutomationDenied, extractIMessagePermissionDenied } from "./client.js";

describe("extractIMessagePermissionDenied", () => {
  it("extracts permission denied details from rpc text output", () => {
    const line =
      'permissionDenied(path: "/Users/test/Library/Messages/chat.db", underlying: authorization denied (code: 23))';
    const result = extractIMessagePermissionDenied(line);
    expect(result).toBeDefined();
    expect(result?.toLowerCase()).toContain("permission denied");
    expect(result).toContain("/Users/test/Library/Messages/chat.db");
  });

  it("returns undefined for non-permission messages", () => {
    expect(extractIMessagePermissionDenied("rpc started")).toBeUndefined();
  });

  it("extracts automation denied details from AppleScript errors", () => {
    const line =
      "Internal error: code=-32603 AppleScript failed: 835:879: execution error: 未获得授权将Apple事件发送给Messages。 (-1743)";
    const result = extractIMessageAutomationDenied(line);
    expect(result).toBeDefined();
    expect(result?.toLowerCase()).toContain("automation");
    expect(result).toContain("Messages");
  });

  it("returns undefined for non-automation errors", () => {
    expect(extractIMessageAutomationDenied("network error")).toBeUndefined();
  });
});
