import { describe, expect, it } from "vitest";
import {
  InputParseError,
  frameTimeFromFilename,
  normalizePlainTranscript,
  normalizeSrt,
  normalizeVtt,
} from "../src/evidence/index.js";

const VTT_FIXTURE = `WEBVTT

00:00:05.000 --> 00:00:09.000
<v Dana Okafor>Thanks for making time, Marco.</v>

00:01:10.000 --> 00:01:14.500
Marco Reyes: Twelve thousand units, the 8-inch kraft box.
`;

const PLAIN_FIXTURE = `Dana Okafor (00:05): Thanks for making time, Marco.
00:12 Marco Reyes: Happy to help.
Priya Shah: Holiday menu launches December 1. [00:24]
`;

const SRT_FIXTURE = `1
00:00:05,000 --> 00:00:09,000
Dana Okafor: Thanks for making time, Marco.

2
00:01:10,500 --> 00:01:14,000
<v Marco Reyes>Twelve thousand units.</v>
`;

describe("normalizeVtt", () => {
  it("converts one VTT fixture to INPUT_FORMAT v1", () => {
    expect(normalizeVtt(VTT_FIXTURE)).toBe(
      "[00:05] Dana Okafor: Thanks for making time, Marco.\n" +
        "[01:10] Marco Reyes: Twelve thousand units, the 8-inch kraft box.\n",
    );
  });

  it("rejects cues with no speaker, naming the line", () => {
    try {
      normalizeVtt("WEBVTT\n\n00:00:05.000 --> 00:00:09.000\nJust some narration.\n");
      expect.unreachable("expected InputParseError");
    } catch (error) {
      expect(error).toBeInstanceOf(InputParseError);
      expect((error as InputParseError).line).toBe(3);
    }
  });
});

describe("normalizeSrt", () => {
  it("converts one SRT fixture to INPUT_FORMAT v1", () => {
    expect(normalizeSrt(SRT_FIXTURE)).toBe(
      "[00:05] Dana Okafor: Thanks for making time, Marco.\n" +
        "[01:10] Marco Reyes: Twelve thousand units.\n",
    );
  });
});

describe("normalizePlainTranscript", () => {
  it('converts "Name: text" lines with timestamps to INPUT_FORMAT v1', () => {
    expect(normalizePlainTranscript(PLAIN_FIXTURE)).toBe(
      "[00:05] Dana Okafor: Thanks for making time, Marco.\n" +
        "[00:12] Marco Reyes: Happy to help.\n" +
        "[00:24] Priya Shah: Holiday menu launches December 1.\n",
    );
  });
});

describe("hero screenshot", () => {
  it("reads the hero slide time from its filename", () => {
    expect(frameTimeFromFilename("frame-01-10.png")).toBe(70);
  });
});

describe("cut list", () => {
  it("rejects PDF input", () => {
    for (const normalize of [normalizeVtt, normalizeSrt, normalizePlainTranscript]) {
      expect(() => normalize("%PDF-1.7 fake")).toThrowError(InputParseError);
    }
  });
});
