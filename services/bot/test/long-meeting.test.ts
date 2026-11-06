import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseFramesSidecar, parseTranscript } from "@second-seat/core";
import { runBrief } from "../src/brief/cli.js";

const DIR_CANDIDATES = [
  "services/bot/fixtures/long-meeting",
  join(process.cwd(), "fixtures/long-meeting"),
];
const DIR = DIR_CANDIDATES.find((d) => existsSync(join(d, "transcript.txt"))) ?? DIR_CANDIDATES[0]!;

/**
 * Long-meeting fixture pipeline (fixture mode, network disabled): the
 * deterministic 110-min fixture (>=320 segments, >=32 frames) completes
 * under caps, every citation in the resulting brief resolves to a real
 * segment/frame id, and a latency/cost line is logged.
 */
describe.skipIf(!existsSync(join(DIR, "transcript.txt")))("long-meeting fixture pipeline", () => {
  it("completes under caps with all citations resolving and cost logged", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "long-meeting-"));
    process.env["EVIDENCE_BRIEF_MODE"] = "fixture";
    process.env["MUSE_STATE_FILE"] = join(tmp, "state.json");
    process.env["MUSE_COST_LOG_FILE"] = join(tmp, "cost-log.jsonl");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled in fixture test");
    }));
    try {
      const transcriptText = readFileSync(join(DIR, "transcript.txt"), "utf8");
      const framesText = readFileSync(join(DIR, "frames.txt"), "utf8");
      const segments = parseTranscript(transcriptText);
      const sidecar = parseFramesSidecar(framesText);
      expect(segments.length).toBeGreaterThanOrEqual(320);
      expect(sidecar.length).toBeGreaterThanOrEqual(32);
      // ~110 min span: last segment at or past 110:00.
      expect(segments[segments.length - 1]!.t).toBeGreaterThanOrEqual(110 * 60);

      const t0 = Date.now();
      const { brief } = await runBrief({
        inputDir: DIR,
        outDir: join(tmp, "out"),
        fixturePath: join(DIR, "brief.recorded.json"),
      });
      const elapsedMs = Date.now() - t0;
      expect(elapsedMs).toBeLessThan(60_000);

      const segIds = new Set(segments.map((s) => s.id));
      const frameIds = new Set(sidecar.map((r) => r.file));
      expect(brief.entries.length).toBeGreaterThan(0);
      for (const entry of brief.entries) {
        for (const cite of entry.citations) {
          if (cite.kind === "segment") {
            expect(cite.segmentId !== null && segIds.has(cite.segmentId), `segment citation ${cite.segmentId} resolves`).toBe(true);
          } else {
            expect(cite.frameId === null || frameIds.has(cite.frameId), `frame citation ${cite.frameId} resolves`).toBe(true);
          }
        }
      }

      // Latency/cost logged for the fixture call.
      const costLog = readFileSync(join(tmp, "cost-log.jsonl"), "utf8").trim().split("\n");
      expect(costLog.length).toBeGreaterThanOrEqual(1);
      const line = JSON.parse(costLog.pop()!) as { fixture: boolean };
      expect(line.fixture).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
