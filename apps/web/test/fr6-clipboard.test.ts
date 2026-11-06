import { describe, expect, it } from "vitest";
import { clipboardReadbackMatches } from "./clipboard-readback.js";

const APPROVED = "First synthetic line.\nSecond synthetic line.";

describe("FR6 clipboard readback", () => {
  it("FR6-3 rejects every change except a Windows CRLF conversion", () => {
    expect(clipboardReadbackMatches(APPROVED, APPROVED, "linux")).toBe(true);
    expect(clipboardReadbackMatches(APPROVED, APPROVED.replace(/\n/g, "\r\n"), "linux")).toBe(false);
    expect(clipboardReadbackMatches(APPROVED, APPROVED.replace(/\n/g, "\r\n"), "win32")).toBe(true);
    expect(clipboardReadbackMatches(APPROVED, APPROVED, "win32")).toBe(true);
    for (const bad of [
      "First synthetic line.\nSecond synthetic lines.",
      "First synthetic line.",
      "First synthetic line.\nSecond synthetic line. ",
      "First synthetic line.\nSecond synthetic line!",
      "First synthetic line.\rSecond synthetic line.",
    ]) {
      expect(clipboardReadbackMatches(APPROVED, bad, "win32")).toBe(false);
      expect(clipboardReadbackMatches(APPROVED, bad, "linux")).toBe(false);
    }
  });
});
