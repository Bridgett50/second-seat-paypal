import { describe, expect, it } from "vitest";
import { defaultClient, FixtureModelClient } from "../src/index.js";

describe("bot stub", () => {
  it("defaults to the fixture client", async () => {
    const client = defaultClient();
    expect(client).toBeInstanceOf(FixtureModelClient);
    expect(client.mode).toBe("fixture");
    const response = await client.complete({ prompt: "hello", maxTokens: 16 });
    expect(response.fixture).toBe(true);
  });
});
