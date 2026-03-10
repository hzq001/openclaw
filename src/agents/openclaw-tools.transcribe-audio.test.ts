import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools transcribe_audio registration", () => {
  it("includes the transcribe_audio tool", () => {
    const tools = createOpenClawTools();
    expect(tools.some((tool) => tool.name === "transcribe_audio")).toBe(true);
  });
});
