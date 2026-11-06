import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEB_ROOT, loadGlimmerAttempts, loadGlimmerLive } from "../src/loadFixtures.js";
import { renderBriefPage, type Brief } from "../src/render.js";

const baseBrief: Brief = { createdAt: "2024-01-01", entries: [] };

function fixturesDir(): string {
  return join(WEB_ROOT, "..", "..", "services", "bot", "fixtures");
}

describe("glimmer attempts", () => {
  it("keeps a newer failed attempt as the headline over an older success", () => {
    const attempts = loadGlimmerAttempts();
    expect(attempts.length).toBe(3);
    const success = attempts.find((a) => a.status === "complete");
    expect(success).toBeDefined();
    const head = loadGlimmerLive();
    expect(head).not.toBeNull();
    // Newest by ranAt wins regardless of success.
    for (const a of attempts) {
      expect(head?.ranAt as string >= a.ranAt).toBe(true);
    }
    expect(head?.status).toBe("incomplete");
    expect(head?.completedK).toBe(6);
    expect(head?.completedN).toBe(8);
    expect(success !== undefined && (head?.ranAt as string) > success.ranAt).toBe(true);
  });

  it("accepts both health and health_status keys", () => {
    const attempts = loadGlimmerAttempts();
    // glimmer-run record uses `health`, older records use `health_status`.
    const runRecord = JSON.parse(
      readFileSync(join(fixturesDir(), "glimmer-run", "glimmer-live-eval.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(runRecord).not.toHaveProperty("health_status");
    const oldRecord = JSON.parse(
      readFileSync(join(fixturesDir(), "glimmer-live-eval-n10.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(oldRecord).not.toHaveProperty("health");
    for (const a of attempts) {
      expect(a.health).toBe(200);
    }
  });

  it("never shows a live chip for an incomplete or mock run", () => {
    const head = loadGlimmerLive();
    expect(head).not.toBeNull();
    const incomplete = renderBriefPage(baseBrief, [], [], [], { glimmerLive: head });
    expect(incomplete).toContain('data-stage="glimmer-redact" data-status="incomplete"');
    expect(incomplete).toContain("glimmer-redact: incomplete");
    expect(incomplete).not.toContain('data-stage="glimmer-redact" data-status="live"');
    // A complete run in mock mode still gets no live badge.
    const mocked = renderBriefPage(baseBrief, [], [], [], {
      glimmerLive: {
        recall: "10/10",
        n: 10,
        status: "complete",
        mode: "mock",
        runId: "mock-run",
        sourceRevision: "unknown",
        ranAt: "2026-10-26T19:31:49.304955+00:00",
        completedK: 10,
        completedN: 10,
        recallK: 10,
        recallN: 10,
        fullK: 10,
        fullN: 10,
      },
    });
    expect(mocked).toContain('data-stage="glimmer-redact" data-status="incomplete"');
    expect(mocked).not.toContain('data-stage="glimmer-redact" data-status="live"');
    // A mock run-log entry also suppresses the ran badge for other stages.
    const mockLog = renderBriefPage(
      baseBrief,
      [],
      [],
      [{ stage: "spark-brief", model: "muse-spark-1.3", at: "2026-10-26T12:00:02Z", note: "mock" }],
      {},
    );
    expect(mockLog).toContain('data-stage="spark-brief" data-status="not run"');
    expect(mockLog).not.toContain('data-stage="spark-brief" data-status="run"');
  });

  it("computes the 18/39 full batch from the real glimmer-run fixtures", () => {
    const summary = JSON.parse(
      readFileSync(join(fixturesDir(), "glimmer-run", "eval-summary.json"), "utf8"),
    ) as { recall: { k: number }; cases: { total: number }[] };
    const expectedTotal = summary.cases.reduce((a, c) => a + c.total, 0);
    expect(expectedTotal).toBe(39);
    const head = loadGlimmerLive();
    expect(head?.fullK).toBe(summary.recall.k);
    expect(head?.fullN).toBe(expectedTotal);
    expect(head?.fullK).toBe(18);
    expect(head?.fullN).toBe(39);
  });

  it("shows mode, run id, revision, and status on every result", () => {
    const head = loadGlimmerLive();
    const page = renderBriefPage(baseBrief, [], [], [], { glimmerLive: head });
    expect(page).toContain("mode live");
    expect(page).toContain("revision unknown");
    expect(page).toContain("status incomplete");
    expect(page).toContain(head?.runId as string);
    expect(page).toContain("Previous runs");
  });
});
