import { describe, expect, it } from "vitest";
import { heroHeading } from "../src/index.js";

describe("web stub", () => {
  it("exposes the hero heading", () => {
    expect(heroHeading()).toBe("Second Seat");
  });
});
