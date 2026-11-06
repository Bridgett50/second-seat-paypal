import { describe, expect, it } from "vitest";
import {
  FixtureSamClient,
  SAM_MODEL,
  clampBoxes,
  defaultSamClient,
  fullFrameBox,
  parseSamBoxesLocal,
  withFallback,
  type SamFrame,
} from "../src/vision/sam.js";
import { FixtureImageClient, IMAGE_MODEL, defaultImageClient } from "../src/vision/image.js";
import { MockRedactor } from "../src/private/redact.js";

const FRAME: SamFrame = { id: "hero-chain-slide", width: 800, height: 400, png: Buffer.alloc(8) };

describe("sam segmentShared (fixture)", () => {
  it("defaults to the fixture client and keeps the box inside the frame", async () => {
    const client = defaultSamClient();
    expect(client.mode).toBe("fixture");
    const result = await client.segmentShared(FRAME);
    expect(result.model).toBe(SAM_MODEL);
    expect(result.fixture).toBe(true);
    expect(result.boxes.length).toBeGreaterThan(0);
    for (const b of result.boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(FRAME.width);
      expect(b.y + b.h).toBeLessThanOrEqual(FRAME.height);
    }
  });

  it("accepts slide/document/whiteboard concepts", async () => {
    const client = new FixtureSamClient();
    for (const concept of ["slide", "document", "whiteboard"] as const) {
      const result = await client.segmentShared(FRAME, concept);
      expect(result.boxes.length).toBeGreaterThan(0);
    }
  });

  it("treats x2/y2 as inclusive (w = x2 - x1 + 1)", () => {
    const boxes = parseSamBoxesLocal({ mask_encoding: "one_bit", boxes: [{ x1: 10, y1: 20, x2: 19, y2: 29 }] });
    expect(boxes).toEqual([{ x: 10, y: 20, w: 10, h: 10 }]);
  });

  it("clamps boxes that overflow the frame", () => {
    const kept = clampBoxes([{ x: 700, y: 350, w: 500, h: 500 }], FRAME);
    expect(kept).toEqual([{ x: 700, y: 350, w: 100, h: 50 }]);
  });
});

describe("sam zero matches", () => {
  it("falls back to the full frame with region_spotcheck_failed", async () => {
    const client = new FixtureSamClient({ mask_encoding: "one_bit", boxes: [] });
    const result = await client.segmentShared(FRAME, "slide");
    expect(result.boxes).toEqual([fullFrameBox(FRAME)]);
    expect(result.flags).toContain("region_spotcheck_failed");
  });

  it("falls back when raw output has no boxes at all", () => {
    const result = withFallback([], FRAME, {}, SAM_MODEL, true);
    expect(result.boxes).toEqual([{ x: 0, y: 0, w: 800, h: 400 }]);
    expect(result.flags).toContain("region_spotcheck_failed");
  });
});

describe("hero chain in fixture mode", () => {
  it("image -> mask -> SAM region stays inside the frame", async () => {
    const image = defaultImageClient();
    expect(image.mode).toBe("fixture");
    const slide = await image.generate("synthetic vendor slide, date 30th, labeled SYNTHETIC");
    expect(slide.model).toBe(IMAGE_MODEL);
    expect(slide.fixture).toBe(true);

    const redactor = new MockRedactor();
    const masked = await redactor.redactImage(slide.png, "hero-chain-slide.png");
    expect(masked.png.length).toBeGreaterThan(0);

    const sam = defaultSamClient();
    const frame: SamFrame = { id: "hero-chain-slide", width: 800, height: 400, png: masked.png };
    const region = await sam.segmentShared(frame, "slide");
    expect(region.boxes.length).toBeGreaterThan(0);
    for (const b of region.boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(frame.width);
      expect(b.y + b.h).toBeLessThanOrEqual(frame.height);
    }
  });
});
