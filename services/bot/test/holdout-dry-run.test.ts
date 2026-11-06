// holdout dry run: the real runEval/rescoreRun paths over a fresh dummy
// dataset with a local fake redactor. Offline only: fetch is guarded, no
// network, no model, temp dirs only.
// @ts-expect-error untyped helper module
import { dryCanaryFail, dryInterrupted, drySuccess, fetchCalls } from "../scripts/holdout-dry-run.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const madeDirs: string[] = [];
afterEach(() => {
  while (madeDirs.length > 0) {
    const d = madeDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function track(dir: string): string {
  madeDirs.push(dir);
  return dir;
}

function makeDummyDataset(): string {
  const dir = track(mkdtempSync(join(tmpdir(), "dry-dataset-")));
  const files: Record<string, { text: string; entities: string[] }> = {
    "dummy-01.txt": { text: "Call Ana Bell at 555-0100.\n", entities: ["Ana Bell", "555-0100"] },
    "dummy-02.txt": { text: "Mail Bo Ray at bo.ray@example.org.\n", entities: ["Bo Ray", "bo.ray@example.org"] },
    "dummy-03.txt": { text: "Ping Cy Fox at cy.fox@example.net.\n", entities: ["Cy Fox", "cy.fox@example.net"] },
  };
  const cases = Object.entries(files).map(([file, v]) => ({ file, entities: v.entities }));
  for (const [file, v] of Object.entries(files)) writeFileSync(join(dir, file), v.text);
  writeFileSync(join(dir, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
  return dir;
}

function makeParent(prefix: string): string {
  return track(mkdtempSync(join(tmpdir(), prefix)));
}

describe("holdout dry run", () => {
  it("success mode completes all dummy cases with no fetch", async () => {
    const result = await drySuccess(makeDummyDataset(), makeParent("holdout-test-success-"));
    expect(result.summary.complete).toBe(true);
    expect(result.canaryFailed).toBe(false);
    expect(result.records).toHaveLength(3);
    expect(result.records.every((r: { status: string }) => r.status === "ok")).toBe(true);
    expect(fetchCalls()).toBe(0);
  });

  it("failing canary stops the batch with the rest not_run", async () => {
    const result = await dryCanaryFail(makeDummyDataset(), makeParent("holdout-test-canary-"));
    expect(result.canaryFailed).toBe(true);
    expect(result.summary.complete).toBe(false);
    expect(result.records).toHaveLength(3);
    expect(result.records[0].status).toBe("error");
    expect(result.records.slice(1).every((r: { status: string }) => r.status === "not_run")).toBe(true);
    expect(result.summary.not_run).toHaveLength(2);
    expect(fetchCalls()).toBe(0);
  });

  it("interrupted batch rescores offline with the full planned denominator", async () => {
    const { result, rescore } = await dryInterrupted(
      makeDummyDataset(),
      makeParent("holdout-test-interrupted-"),
    );
    expect(result.summary.complete).toBe(false);
    expect(result.summary.not_run.length).toBeGreaterThan(0);
    // Offline rescore of the partial dir agrees: incomplete, same records.
    expect(rescore.complete).toBe(false);
    expect(rescore.records).toHaveLength(3);
    expect(rescore.summary.not_run).toHaveLength(result.summary.not_run.length);
    expect(fetchCalls()).toBe(0);
  });
});
