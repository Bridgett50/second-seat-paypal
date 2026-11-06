import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FixtureClient } from "../src/brief/muse.js";

/**
 * Synthetic test data only — a small hand-made object for unit testing the
 * FixtureClient plumbing. NOT model output; never present it as such.
 */
const SYNTHETIC_TEST_DATA = {
  recordedFromLiveCall: true,
  model: "synthetic-test-data",
  promptVersion: "synthetic-test-data",
  timestamp: "2026-01-01T00:00:00.000Z",
  rawText: '{"entries": [], "synthetic-test-data": true}',
  usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 5, reasoningTokens: 0 },
};

function writeTempFixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "brief-fixture-"));
  const path = join(dir, "fixture.json");
  writeFileSync(path, content, "utf8");
  return path;
}

describe("FixtureClient", () => {
  // Keep cost logging out of the repo during unit tests.
  process.env["MUSE_COST_LOG_FILE"] = join(tmpdir(), "brief-fixture-cost-log.jsonl");
  process.env["MUSE_STATE_FILE"] = join(tmpdir(), "brief-fixture-state.json");
  it("returns the recorded raw text and usage", async () => {
    const path = writeTempFixture(JSON.stringify(SYNTHETIC_TEST_DATA));
    const client = new FixtureClient(path);
    expect(client.mode).toBe("fixture");
    const result = await client.completeBrief({
      meetingId: "test",
      transcriptText: "[00:01] A: hi",
      framesSidecarText: "",
      fixtureMode: true,
    });
    expect(result.fixture).toBe(true);
    expect(result.rawText).toBe(SYNTHETIC_TEST_DATA.rawText);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("fails clearly when the fixture file is missing", async () => {
    const client = new FixtureClient("/nonexistent/brief.recorded.json");
    await expect(
      client.completeBrief({
        meetingId: "test",
        transcriptText: "[00:01] A: hi",
        framesSidecarText: "",
        fixtureMode: true,
      }),
    ).rejects.toThrow(/no fixture file/);
  });

  it("rejects a file not marked as a recorded live response", async () => {
    const path = writeTempFixture(JSON.stringify({ rawText: "hand-written, not recorded" }));
    const client = new FixtureClient(path);
    await expect(
      client.completeBrief({
        meetingId: "test",
        transcriptText: "[00:01] A: hi",
        framesSidecarText: "",
        fixtureMode: true,
      }),
    ).rejects.toThrow(/not a recorded live response/);
  });
});
