/**
 * FR5: Node ESM imports use pathToFileURL. Linux checks only.
 * FR5-1 and FR5-2 need a native Windows process and stay unverified here.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toNodeImportSpecifier } from "../../services/bot/test/support/import-url.mjs";
import { containsSealed, isSealedPath } from "../../services/bot/test/support/sealed-guard.mjs";
import { reportSplit as shieldSplit } from "../shield-report.mjs";
import { reportSplit as resistanceSplit } from "../resistance-table.mjs";

const root = join(import.meta.dirname, "..", "..");
const shieldCli = join(root, "eval", "shield-report.mjs");
const resistanceCli = join(root, "eval", "resistance-table.mjs");
const guard = join(root, "services", "bot", "test", "support", "sealed-guard.mjs");

const FORBIDDEN = [
  "services/bot/fixtures/holdout-v1/case.txt",
  "eval/heldout/case.txt",
  "eval/heldout-presealed.sha256",
  "eval/shield-heldout.sha256",
];

function childEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    ...extra,
  };
}

describe("FR5 portable imports", () => {
  it("FR5-3 imports a module whose path contains a space and a hash", () => {
    const dir = join(tmpdir(), `fr5 space # ${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "mod.js");
    const side = join(dir, "runs.txt");
    writeFileSync(
      file,
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(side)}, "x");\nexport const value = 7;\n`,
    );
    const specifier = toNodeImportSpecifier(file);
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const a = await import(${JSON.stringify(specifier)}); const b = await import(${JSON.stringify(specifier)}); if (a.value !== 7 || a !== b) process.exit(1);`,
      ],
      { encoding: "utf8", env: childEnv() },
    );
    expect(run.status).toBe(0);
    expect(readFileSync(side, "utf8")).toBe("x");
  });

  it("FR5-4 refuses the four sealed spellings and does not read a dataset for heldout", () => {
    for (const path of FORBIDDEN) {
      expect(isSealedPath(join(root, path)) || containsSealed(join(root, path))).toBe(true);
    }
    expect(shieldSplit("heldout").ok).toBe(false);
    expect(resistanceSplit("heldout").ok).toBe(false);
    const trap = join(root, "services", "bot", "test", "support", "fr5-dataset-trap.mjs");
    for (const script of [shieldCli, resistanceCli]) {
      const run = spawnSync(process.execPath, ["--import", toNodeImportSpecifier(trap), script, "--split", "heldout"], {
        cwd: root,
        encoding: "utf8",
        env: childEnv(),
      });
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/held-out/);
      expect(run.stderr).not.toMatch(/dataset read/);
      expect(run.stdout).toBe("");
    }
  });

  it("FR5-5 runs the dev reports and keeps the sealed guard installed in a child", () => {
    for (const script of [shieldCli, resistanceCli]) {
      const run = spawnSync(process.execPath, [script, "--split", "dev"], {
        cwd: root,
        encoding: "utf8",
        env: childEnv(),
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/split: dev/);
    }
    const run = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(globalThis.__sealedGuardInstalled === true ? 'yes' : 'no')"],
      {
        cwd: root,
        encoding: "utf8",
        env: childEnv({ NODE_OPTIONS: `--import ${toNodeImportSpecifier(guard)}` }),
      },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("yes");
  });
});
