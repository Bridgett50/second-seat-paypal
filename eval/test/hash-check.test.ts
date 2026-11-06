import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const checker = join(here, "..", "check-hashes.mjs");
const truthDir = join(here, "..", "truth");

function runChecker(dir: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync("node", [checker, dir], { encoding: "utf8" });
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-hashes.mjs", () => {
  it("passes on the sealed truth directory", () => {
    const result = runChecker(truthDir);
    expect(result.output).toContain("hash check ok");
    expect(result.ok).toBe(true);
  });

  it("fails when one truth byte changes", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "seal-check-"));
    copyFileSync(join(truthDir, "hero.transcript.txt"), join(sandbox, "hero.transcript.txt"));
    const digest = createHash("sha256").update(readFileSync(join(sandbox, "hero.transcript.txt"))).digest("hex");
    writeFileSync(join(sandbox, "SHA256SUMS"), `${digest}  ./hero.transcript.txt\n`);

    expect(runChecker(sandbox).ok).toBe(true);

    writeFileSync(join(sandbox, "hero.transcript.txt"), "X", { flag: "a" });
    const after = runChecker(sandbox);
    expect(after.ok).toBe(false);
    expect(after.output).toContain("hash mismatch");
  });
});
