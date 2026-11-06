import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_CATEGORIES, parseTranscript } from "@second-seat/core";

const here = dirname(fileURLToPath(import.meta.url));
const truthDir = join(here, "..", "truth");

const MEETINGS = ["hero", "dev01", "dev02", "dev03", "dev04", "dev05"];

interface TruthCitation {
  kind: string;
  segmentId?: string;
  frameId?: string;
}

interface TruthEntry {
  id: string;
  category: string;
  citations: TruthCitation[];
  truth?: { expected_support?: string };
}

interface TruthLabels {
  meetingId: string;
  entries: TruthEntry[];
  frames?: { id: string; file: string }[];
}

function loadLabels(meeting: string): TruthLabels {
  return JSON.parse(readFileSync(join(truthDir, `${meeting}.labels.json`), "utf8")) as TruthLabels;
}

describe("truth labels cite real segments", () => {
  for (const meeting of MEETINGS) {
    it(`${meeting}: every label cites an existing segment id`, () => {
      const transcript = readFileSync(join(truthDir, `${meeting}.transcript.txt`), "utf8");
      const ids = new Set(parseTranscript(transcript).map((segment) => segment.id));
      expect(ids.size).toBeGreaterThan(0);
      for (const entry of loadLabels(meeting).entries) {
        for (const citation of entry.citations) {
          if (citation.kind === "segment") {
            expect(
              ids.has(citation.segmentId ?? ""),
              `${meeting}/${entry.id} cites missing ${(citation.segmentId ?? "")}`,
            ).toBe(true);
          }
        }
      }
    });
  }
});

describe("truth labels use valid categories", () => {
  it("every entry category is an EntryCategory", () => {
    for (const meeting of MEETINGS) {
      for (const entry of loadLabels(meeting).entries) {
        expect(
          (ENTRY_CATEGORIES as readonly string[]).includes(entry.category),
          `${meeting}/${entry.id} has invalid category ${entry.category}`,
        ).toBe(true);
      }
    }
  });
});

describe("truth negatives", () => {
  it("counts >= 7 unsupported entries across hero + dev01-dev05", () => {
    let negatives = 0;
    for (const meeting of MEETINGS) {
      for (const entry of loadLabels(meeting).entries) {
        if (entry.truth?.expected_support === "unsupported") {
          negatives += 1;
        }
      }
    }
    expect(negatives).toBeGreaterThanOrEqual(7);
  });
});

describe("truth frames", () => {
  it("hero slide frame file exists and is a PNG", () => {
    const hero = loadLabels("hero");
    expect(hero.frames?.length).toBeGreaterThan(0);
    for (const frame of hero.frames ?? []) {
      const path = join(truthDir, frame.file);
      expect(existsSync(path), `${frame.file} exists`).toBe(true);
      const magic = readFileSync(path).subarray(0, 8);
      expect([...magic]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });
});
