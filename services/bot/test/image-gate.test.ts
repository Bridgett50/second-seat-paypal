import { afterEach, describe, expect, it } from "vitest";
import { LiveImageClient, defaultImageClient, imagesExperimentalEnabled } from "../src/vision/image.js";
import { LiveSamClient, defaultSamClient } from "../src/vision/sam.js";
// @ts-ignore - hero-chain.mjs is an untyped script; runtime import is what the test exercises.
import { requireMasked } from "../scripts/hero-chain.mjs";

const FLAG = "SECOND_SEAT_EXPERIMENTAL_IMAGES";

afterEach(() => {
  delete process.env[FLAG];
  delete process.env["IMAGE_MODE"];
  delete process.env["SAM_MODE"];
  delete process.env["MODEL_API_KEY"];
  delete process.env["META_API_KEY"];
  delete process.env["MUSE_API_KEY"];
});

describe("image processing off by default", () => {
  it("stays in fixture mode without the experimental flag", () => {
    expect(imagesExperimentalEnabled()).toBe(false);
    expect(defaultImageClient().mode).toBe("fixture");
    expect(defaultSamClient().mode).toBe("fixture");
  });

  it("refuses live image mode without the experimental flag", async () => {
    process.env["IMAGE_MODE"] = "live";
    expect(() => defaultImageClient()).toThrow(/experimental/);
    await expect(new LiveImageClient().generate("x")).rejects.toThrow(/experimental/);
  });

  it("refuses live SAM mode without the experimental flag", async () => {
    process.env["SAM_MODE"] = "live";
    expect(() => defaultSamClient()).toThrow(/experimental/);
    await expect(
      new LiveSamClient().segmentShared({ id: "f", width: 8, height: 8, png: Buffer.alloc(8) }),
    ).rejects.toThrow(/experimental/);
  });

  it("still requires an API key when the flag is set", () => {
    delete process.env["MODEL_API_KEY"];
    delete process.env["META_API_KEY"];
    delete process.env["MUSE_API_KEY"];
    process.env[FLAG] = "1";
    process.env["IMAGE_MODE"] = "live";
    process.env["SAM_MODE"] = "live";
    expect(imagesExperimentalEnabled()).toBe(true);
    expect(() => defaultImageClient()).toThrow(/API key/);
    expect(() => defaultSamClient()).toThrow(/API key/);
  });
});

describe("unmasked frames are never sent", () => {
  it("drops the frame when masking fails", () => {
    expect(() => requireMasked({ png: Buffer.alloc(8), masked: false, label: "mock" })).toThrow(
      /unmasked frame is never sent/,
    );
  });

  it("keeps a masked frame", () => {
    const kept = requireMasked({ png: Buffer.alloc(8), masked: true, label: "mock" });
    expect(kept.masked).toBe(true);
  });
});
