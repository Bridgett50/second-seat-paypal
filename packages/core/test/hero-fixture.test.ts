import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePlainTranscript,
  parseTranscript,
  resolveFrames,
} from "../src/evidence/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const truthDir = join(here, "..", "..", "..", "eval", "truth");

interface HeroFixture {
  transcript: string;
  segments: ReturnType<typeof parseTranscript>;
  frames: ReturnType<typeof resolveFrames>;
}

function loadFixture(): HeroFixture {
  return JSON.parse(
    readFileSync(join(here, "fixtures", "hero.normalized.json"), "utf8"),
  ) as HeroFixture;
}

describe("hero normalized fixture", () => {
  it("matches the hero transcript+frame run through the normalizer/parser", () => {
    const raw = readFileSync(join(truthDir, "hero.transcript.txt"), "utf8");
    const transcript = normalizePlainTranscript(raw);
    const segments = parseTranscript(transcript);
    const frames = resolveFrames({ files: ["frame-01-10.png"] });
    expect({ transcript, segments, frames }).toEqual(loadFixture());
  });
});
