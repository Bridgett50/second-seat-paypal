import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, "..");
const scorer = join(evalDir, "support.mjs");
const truthDir = join(evalDir, "truth");
const casesPath = join(evalDir, "fixtures", "support-cases.json");
const judgmentsPath = join(evalDir, "results", "support-judgments.jsonl");

function runScorer(args: string[]): { ok: boolean; status: number | null; output: string } {
  try {
    const output = execFileSync("node", [scorer, ...args], { encoding: "utf8" }) as string;
    return { ok: true, status: 0, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number | null };
    return { ok: false, status: err.status ?? null, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("support scorer", () => {
  it("aborts on hash mismatch (tmp copy with a tampered file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "support-hash-"));
    cpSync(truthDir, dir, { recursive: true });
    const victim = join(dir, "seeded-errors-spec.md");
    writeFileSync(victim, `${readFileSync(victim, "utf8")}\ntampered\n`, "utf8");
    const result = runScorer(["--cases", casesPath, "--baseline", "--truth", dir]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(2);
    expect(result.output).toMatch(/hash check failed/i);
  });

  it("aborts when a path touches held-out data", () => {
    const result = runScorer(["--cases", casesPath, "--baseline", "--truth", join(evalDir, "heldout-x")]);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/held-out/i);
  });

  it("the seeded-error suite FAILS with the judge disabled", () => {
    const result = runScorer(["--cases", casesPath, "--baseline", "--truth", truthDir]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/SUPPORT SUITE FAILED/);
    expect(result.output).toMatch(/catch|caught|non-control/);
  });

  it("the seeded-error suite PASSES on the recorded judge outputs", () => {
    const result = runScorer(["--cases", casesPath, "--judge", judgmentsPath, "--truth", truthDir]);
    expect(result.output).toMatch(/hash check ok/);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/SUPPORT SUITE PASSED/);
    expect(result.output).toMatch(/Wilson 95% CI/);
  });
});
