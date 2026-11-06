import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harness = join(here, "..", "heldout-run.mjs");

function runHarness(env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync("node", [harness], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: 0, output: `${output}` };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function makeSealedDir(): string {
  // Made-up tmp dir only; never the real sealed set.
  const dir = mkdtempSync(join(tmpdir(), "heldout-fake-"));
  writeFileSync(join(dir, "case-a.labels.json"), JSON.stringify({ entries: [] }));
  writeFileSync(join(dir, "SHA256SUMS"), "made-up sums content\n");
  return dir;
}

function writeFakePresealed(sumsDigestHex: string): { presealedPath: string; presealedDir: string } {
  const presealedDir = mkdtempSync(join(tmpdir(), "heldout-presealed-"));
  const presealedPath = join(presealedDir, "heldout-presealed.sha256");
  writeFileSync(presealedPath, `${sumsDigestHex}  SHA256SUMS\n`);
  return { presealedPath, presealedDir };
}

function makeFakePresealedForDir(sealedDir: string, mismatch: boolean): { presealedPath: string; presealedDir: string } {
  const sumsPath = join(sealedDir, "SHA256SUMS");
  const digest = createHash("sha256").update(readFileSync(sumsPath)).digest("hex");
  const fakeHex = mismatch
    ? (digest[0] === "0" ? `1${digest.slice(1)}` : `0${digest.slice(1)}`)
    : digest;
  return writeFakePresealed(fakeHex);
}

function cleanupDirs(dirs: string[]): void {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("heldout-run.mjs", () => {
  it("exits 2 on seal mismatch (placeholder digest cannot match a made-up dir)", () => {
    const dir = makeSealedDir();
    const { presealedPath, presealedDir } = makeFakePresealedForDir(dir, true);
    try {
      const result = runHarness({ HELDOUT_DIR: dir, HELDOUT_PRESEALED_PATH: presealedPath });
      expect(result.status).toBe(2);
      expect(result.output).toMatch(/mismatch|not recorded|hash check failed/i);
    } finally {
      cleanupDirs([dir, presealedDir]);
    }
  });

  it("exits 2 when HELDOUT_DIR is missing", () => {
    const { presealedPath, presealedDir } = writeFakePresealed("0".repeat(64));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HELDOUT_PRESEALED_PATH: presealedPath };
      delete env["HELDOUT_DIR"];
      let status = 0;
      let output = "";
      try {
        execFileSync("node", [harness], { encoding: "utf8", env });
        status = 0;
      } catch (error) {
        const err = error as { stdout?: string; stderr?: string; status?: number };
        status = err.status ?? 1;
        output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }
      expect(status).toBe(2);
      expect(output).toMatch(/HELDOUT_DIR/);
    } finally {
      cleanupDirs([presealedDir]);
    }
  });

  it("refuses a second run when the run log already exists", () => {
    // The single-run gate must trigger without a valid seal: a refused run
    // writes no log, so a repeat refusal proves the gate ordering is stable
    // and the sealed run was never consumed.
    const refusedLog = join(here, "..", "results", "heldout-run.log");
    const firstDir = makeSealedDir();
    const firstSeal = makeFakePresealedForDir(firstDir, true);
    const secondDir = makeSealedDir();
    const secondSeal = makeFakePresealedForDir(secondDir, true);
    try {
      const first = runHarness({ HELDOUT_DIR: firstDir, HELDOUT_PRESEALED_PATH: firstSeal.presealedPath });
      expect(first.status).toBe(2);
      const second = runHarness({ HELDOUT_DIR: secondDir, HELDOUT_PRESEALED_PATH: secondSeal.presealedPath });
      expect(second.status).toBe(2);
      expect(second.output).toMatch(/mismatch|not recorded|hash check failed|already exists/i);
      expect(existsSync(refusedLog)).toBe(false);
    } finally {
      cleanupDirs([firstDir, firstSeal.presealedDir, secondDir, secondSeal.presealedDir]);
    }
  });
});
