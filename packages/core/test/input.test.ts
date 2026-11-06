import { describe, expect, it } from "vitest";
import {
  InputParseError,
  formatMmSs,
  frameTimeFromFilename,
  parseFramesSidecar,
  parseTranscript,
  resolveFrames,
} from "../src/evidence/input.js";

describe("parseTranscript", () => {
  it("parses [MM:SS] Speaker: text into typed segments", () => {
    const segments = parseTranscript(
      "[00:05] Dana Okafor: Thanks for making time.\n[01:10] Marco Reyes: Twelve thousand units.\n",
    );
    expect(segments).toEqual([
      { id: "t-00:05", t: 5, speaker: "Dana Okafor", text: "Thanks for making time." },
      { id: "t-01:10", t: 70, speaker: "Marco Reyes", text: "Twelve thousand units." },
    ]);
  });

  it("skips blank lines but keeps their line numbers", () => {
    const segments = parseTranscript("[00:05] Dana Okafor: Hi.\n\n[00:12] Marco Reyes: Hello.\n");
    expect(segments.map((s) => s.id)).toEqual(["t-00:05", "t-00:12"]);
  });

  it("reports the 1-based line number of a malformed line", () => {
    const text = "[00:05] Dana Okafor: Hi.\nthis line has no timestamp\n[00:12] Marco Reyes: Hello.\n";
    try {
      parseTranscript(text);
      expect.unreachable("expected InputParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(InputParseError);
      const parsed = error as InputParseError;
      expect(parsed.line).toBe(2);
      expect(parsed.code).toBe("malformed_line");
      expect(parsed.message).toContain("line 2");
    }
  });

  it("rejects duplicate ids from repeated timestamps", () => {
    const text = "[01:10] Marco Reyes: First.\n[01:10] Marco Reyes: Second.\n";
    try {
      parseTranscript(text);
      expect.unreachable("expected InputParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(InputParseError);
      const parsed = error as InputParseError;
      expect(parsed.code).toBe("duplicate_id");
      expect(parsed.line).toBe(2);
    }
  });

  it("parses the hero transcript shape end to end", () => {
    const segments = parseTranscript("[12:41] Marco Reyes: You already confirmed the 15th.\n");
    expect(segments[0]).toEqual({
      id: "t-12:41",
      t: 761,
      speaker: "Marco Reyes",
      text: "You already confirmed the 15th.",
    });
    expect(formatMmSs(761)).toBe("12:41");
  });
});

describe("frame times", () => {
  it("reads frame time from a frame-MM-SS.png filename", () => {
    expect(frameTimeFromFilename("frame-01-10.png")).toBe(70);
  });

  it("returns null when the filename carries no timestamp", () => {
    expect(frameTimeFromFilename("slide.png")).toBeNull();
  });

  it("parses a frames.txt sidecar with line numbers", () => {
    const rows = parseFramesSidecar("frame-01-10.png 01:10\nslide-q3.jpg 12:41\n");
    expect(rows).toEqual([
      { file: "frame-01-10.png", t: 70, line: 1 },
      { file: "slide-q3.jpg", t: 761, line: 2 },
    ]);
  });

  it("lets the sidecar win over the filename and skips timeless files", () => {
    const frames = resolveFrames({
      files: ["slide.png", "frame-01-10.png"],
      sidecarText: "slide.png 12:41\n",
    });
    expect(frames).toEqual([
      { id: "f-01:10", t: 70, file: "frame-01-10.png" },
      { id: "f-12:41", t: 761, file: "slide.png" },
    ]);
  });

  it("rejects duplicate frame ids", () => {
    expect(() =>
      resolveFrames({
        files: ["a.png", "b.png"],
        sidecarText: "a.png 01:10\nb.png 01:10\n",
      }),
    ).toThrowError(InputParseError);
  });
});
