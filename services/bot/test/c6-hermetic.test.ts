// C6 regressions (written by test author; implementation by Muse Code).
// Never reads sealed data: probes use NONEXISTENT paths under sealed roots,
// so pre-fix code fails with ENOENT (behavioral), post-fix with SEALED_ACCESS.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const probes = [
  join(repo, "services", "bot", "fixtures", "holdout-v1", "__c6_probe_missing__.json"),
  join(repo, "eval", "heldout", "__c6_probe_missing__.txt"),
  join(repo, "eval", "heldout-presealed.sha256.__c6_probe__"),
  "/workspace/heldout-sealed/__c6_probe_missing__",
];

function errCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_ERROR";
  } catch (e) {
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}

describe("C6 hermetic isolation", () => {
  it("C6-2 in-process fs guard refuses sealed paths before touching disk", async () => {
    const fs = await import("node:fs");
    const fsp = await import("node:fs/promises");
    for (const p of probes) {
      expect(errCode(() => fs.readFileSync(p))).toBe("SEALED_ACCESS");
      expect(errCode(() => fs.cpSync(p, join(here, "never")))).toBe("SEALED_ACCESS");
      if (!p.includes(".sha256")) expect(errCode(() => fs.readdirSync(join(dirname(p), "__c6_missing_sub__")))).toBe("SEALED_ACCESS");
      await expect(fsp.readFile(p)).rejects.toMatchObject({ code: "SEALED_ACCESS" });
    }
  });

  it("C6-2 subprocess entry points inherit the guard", () => {
    const r = spawnSync(
      process.execPath,
      ["-e", `try{require('fs').readFileSync(${JSON.stringify(probes[0])})}catch(e){process.stdout.write(String(e.code))}`],
      { encoding: "utf8" },
    );
    expect(r.stdout).toBe("SEALED_ACCESS");
  });

  it("C6-1 no default test imports a sealed-reading helper or names a sealed dir", () => {
    const dirs = [here, join(repo, "apps", "web", "test")];
    const offenders: string[] = [];
    for (const d of dirs)
      for (const f of readdirSync(d).filter((x) => /\.test\.ts$/.test(x) && x !== "c6-hermetic.test.ts")) {
        const src = readFileSync(join(d, f), "utf8");
        if (/fixtures["'\s,)]*[,/]\s*["']?holdout-v1|join\([^)]*"holdout-v1"/.test(src)) offenders.push(f);
      }
    for (const d of dirs)
      for (const f of readdirSync(d).filter((x) => /\.test\.ts$/.test(x))) {
        const src = readFileSync(join(d, f), "utf8");
        for (const m of src.matchAll(/["'](\.\.\/scripts\/[\w.-]+\.mjs)["']/g)) {
          const helper = readFileSync(resolve(d, m[1]!), "utf8");
          if (/"holdout-v1"/.test(helper)) offenders.push(`${f} -> ${m[1]}`);
        }
      }
    expect(offenders).toEqual([]);
  });
});
