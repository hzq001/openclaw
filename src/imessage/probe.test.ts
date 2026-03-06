import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeIMessage } from "./probe.js";

const detectBinaryMock = vi.hoisted(() => vi.fn());
const runCommandWithTimeoutMock = vi.hoisted(() => vi.fn());
const createIMessageRpcClientMock = vi.hoisted(() => vi.fn());
const accessMock = vi.hoisted(() => vi.fn());

vi.mock("../commands/onboard-helpers.js", () => ({
  detectBinary: (...args: unknown[]) => detectBinaryMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: (...args: unknown[]) => accessMock(...args),
  },
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

vi.mock("./client.js", () => ({
  createIMessageRpcClient: (...args: unknown[]) => createIMessageRpcClientMock(...args),
}));

beforeEach(() => {
  detectBinaryMock.mockClear().mockResolvedValue(true);
  runCommandWithTimeoutMock.mockClear().mockResolvedValue({
    stdout: "",
    stderr: 'unknown command "rpc" for "imsg"',
    code: 1,
    signal: null,
    killed: false,
  });
  accessMock.mockClear().mockResolvedValue(undefined);
  createIMessageRpcClientMock.mockClear();
});

describe("probeIMessage", () => {
  it("marks unknown rpc subcommand as fatal", async () => {
    const result = await probeIMessage(1000, { cliPath: "imsg" });
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(true);
    expect(result.error).toMatch(/rpc/i);
    expect(createIMessageRpcClientMock).not.toHaveBeenCalled();
  });

  it("fails fast with fatal=true when Messages DB is not readable", async () => {
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });
    accessMock.mockRejectedValueOnce(new Error("Operation not permitted"));

    const result = await probeIMessage(1000, {
      cliPath: "imsg-perm",
      dbPath: "~/Library/Messages/chat.db",
    });
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(true);
    expect(result.error?.toLowerCase()).toContain("permission");
    expect(createIMessageRpcClientMock).not.toHaveBeenCalled();
  });
});
