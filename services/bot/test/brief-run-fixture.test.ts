import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runBrief } from "../src/brief/cli.js";

const RECORDED = "services/bot/fixtures/hero-brief.recorded.json";
const RECORDED_FROM_CWD = join(process.cwd(), "fixtures/hero-brief.recorded.json");
const RECORDED_PATH = existsSync(RECORDED)
  ? RECORDED
  : existsSync(join(process.cwd(), RECORDED))
    ? join(process.cwd(), RECORDED)
    : RECORDED_FROM_CWD;
const recordedExists = existsSync(RECORDED_PATH);

/**
 * End-to-end CLI run in fixture mode with the network disabled, against the
 * recorded hero fixture (services/bot/fixtures/hero-brief.recorded.json,
 * recorded from a logged live call by the driver). Skipped until that file
 * exists; the FixtureClient unit test covers the plumbing meanwhile.
 */
describe.skipIf(!recordedExists)("brief:run fixture mode (network disabled)", () => {
  it("writes schema-valid brief.json + brief.md from the hero input", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "brief-run-"));
    process.env["EVIDENCE_BRIEF_MODE"] = "fixture";
    process.env["MUSE_STATE_FILE"] = join(tmp, "state.json");
    process.env["MUSE_COST_LOG_FILE"] = join(tmp, "cost-log.jsonl");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in fixture test");
      }),
    );
    try {
      const fixturePath = RECORDED_PATH;
      const { brief, outDir } = await runBrief({
        inputDir: join(RECORDED_PATH, "..", "hero-input"),
        outDir: join(tmp, "out"),
        fixturePath,
      });
      expect(outDir).toBe(join(tmp, "out"));
      expect(Array.isArray(brief.entries)).toBe(true);
      const written = JSON.parse(readFileSync(join(tmp, "out", "brief.json"), "utf8") as string) as {
        meetingId: string;
      };
      expect(written.meetingId).toBe(brief.meetingId);
      expect(existsSync(join(tmp, "out", "brief.md"))).toBe(true);
      // Cost line was logged for the fixture call.
      const costLog = readFileSync(join(tmp, "cost-log.jsonl"), "utf8") as string;
      const line = JSON.parse(costLog.trim().split("\n").pop() as string) as { fixture: boolean };
      expect(line.fixture).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
