// E5 guard regressions — written by Muse Code.
// Sealed spellings appear only as split fragments inside inline-code
// payload strings passed to guardChildArgs (never opened, read, or hashed).
// Symlink fixtures live in os.tmpdir(), never in the repo.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped helper module
import { guardChildArgs } from "./support/sealed-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

// Fragments of a sealed-dir spelling; the joined form never appears
// contiguously in this file.
const FRAG_A = "eval/held";
const FRAG_B = "out/x";

describe("E5 repeat-check and child-arg guard", () => {
  it("E5-repeat: repeat-check passes on the stub test", { timeout: 120000 }, () => {
    // Node 22 writes node-compile-cache into TMPDIR, tripping the script's
    // own empty-temp-root check; the script must therefore isolate or
    // disable the compile cache. (This host runs Node 20, where the cache
    // write does not happen, so the spawn below passes either way here —
    // the assertion pins the real fix for the Node 22 CI job.)
    const script = readFileSync(join(repo, "scripts", "ci", "repeat-check.sh"), "utf8");
    expect(script).toMatch(/NODE_DISABLE_COMPILE_CACHE|NODE_COMPILE_CACHE/);
    const r = spawnSync("bash", ["scripts/ci/repeat-check.sh", "test/stub.test.ts"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 115000,
    });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
  });

  it("E5-ci: ci workflow runs repeat-check after build", () => {
    const yml = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8");
    expect(yml).toContain("bash scripts/ci/repeat-check.sh test/stub.test.ts test/d1-provenance.test.ts");
  });

  it("E5-concat: guardChildArgs refuses quote-concatenated inline code", () => {
    const pyPlus = `open("${FRAG_A}" + "${FRAG_B}").read()`;
    expect(guardChildArgs("python3", ["-c", pyPlus])).not.toBe(null);
    const pySpace = `open('${FRAG_A}' '${FRAG_B}').read()`;
    expect(guardChildArgs("python3", ["-c", pySpace])).not.toBe(null);
    const nodePlus = `require("fs").readFileSync("${FRAG_A}" + "${FRAG_B}")`;
    expect(guardChildArgs("node", ["-e", nodePlus])).not.toBe(null);
    const nodeSpace = `require("fs").readFileSync('${FRAG_A}' '${FRAG_B}')`;
    expect(guardChildArgs("node", ["-e", nodeSpace])).not.toBe(null);
  });

  it("E5-symlink: guardChildArgs refuses copy/cat through a symlink at a sealed-like target", () => {
    const base = mkdtempSync(join(tmpdir(), "e5-guard-"));
    try {
      const target = join(base, "eval", "heldout");
      mkdirSync(target, { recursive: true });
      const link = join(base, "dummy");
      symlinkSync(target, link);
      expect(guardChildArgs("cp", [link])).not.toBe(null);
      expect(guardChildArgs("cat", [link])).not.toBe(null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
