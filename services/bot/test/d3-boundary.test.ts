// D3 regressions — written by Muse Code.
// Uses a fake git repo in mkdtemp only; real sealed paths appear solely as
// nonexistent string probes (never opened, listed, read, or hashed).
// Sealed locations are derived at runtime from .sealed-paths so this file
// names no sealed file and embeds no key-like text.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped helper module
import { containsSealed, guardChildArgs, isSealedPath } from "./support/sealed-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const sealedEntries = readFileSync(join(repo, ".sealed-paths"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));
const dirEntries = sealedEntries.filter((e) => e.endsWith("/"));
// Fake key-like sentinel body, split so the source carries no live pattern.
const SEN = "s" + "k-" + "D3SENTINELfakefakefake0000";
const OLD_PATTERN = "s[k]-|Bearer [A-Za-z0-9]|(MODEL|META)_API_KEY=.+";

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return String((e as { code?: unknown })?.code ?? e);
  }
}

// Fake git repo containing a sentinel file for every .sealed-paths entry
// (dir entries get `<entry>sentinel.txt`), plus src/a.ts and copies of the
// real scan assets. Returns the repo dir.
function makeFake(): string {
  const fake = mkdtempSync(join(tmpdir(), "d3-fake-"));
  git(["init"], fake);
  git(["config", "user.email", "d3@example.com"], fake);
  git(["config", "user.name", "d3"], fake);
  for (const e of sealedEntries) {
    const target = e.endsWith("/") ? join(fake, e, "sentinel.txt") : join(fake, e);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, SEN + "\n");
  }
  mkdirSync(join(fake, "src"), { recursive: true });
  writeFileSync(join(fake, "src", "a.ts"), "export const a = 1;\n");
  mkdirSync(join(fake, "scripts", "ci"), { recursive: true });
  copyFileSync(join(repo, "scripts", "ci", "secret-scan.sh"), join(fake, "scripts", "ci", "secret-scan.sh"));
  copyFileSync(join(repo, ".sealed-paths"), join(fake, ".sealed-paths"));
  mkdirSync(join(fake, ".github", "workflows"), { recursive: true });
  copyFileSync(join(repo, ".github", "workflows", "ci.yml"), join(fake, ".github", "workflows", "ci.yml"));
  git(["add", "-A"], fake);
  git(["commit", "-m", "d3 fake with sentinels"], fake);
  return fake;
}

function sparsePatterns(): string[] {
  const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
  const idx = lines.findIndex((l) => /sparse-checkout:\s*\|/.test(l));
  expect(idx).toBeGreaterThan(-1);
  const base = lines[idx]!.length - lines[idx]!.trimStart().length;
  const out: string[] = [];
  for (const l of lines.slice(idx + 1)) {
    if (l.trim() === "") continue;
    if (l.length - l.trimStart().length <= base) break;
    out.push(l.trim());
  }
  return out;
}

describe("D3 sealed boundary", () => {
  it("D3-1a: secret scan passes with sentinels present; old inline scan leaked", () => {
    const fake = makeFake();
    try {
      const scan = spawnSync("bash", ["scripts/ci/secret-scan.sh"], { cwd: fake, encoding: "utf8" });
      expect(scan.status).toBe(0);
      expect(scan.stdout).toContain("secret scan ok");
      const old = git(["grep", "-nE", OLD_PATTERN, "--", ".", ":!.github/workflows/ci.yml"], fake);
      expect(old.status).toBe(0);
      expect(old.stdout).toContain("sentinel");
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it("D3-1c: secret scan passes on variable-name docs but flags value-shaped keys", () => {
    const fake = makeFake();
    try {
      writeFileSync(join(fake, "docs-only.sh"), 'export MODEL_API_KEY="$META_API_KEY"\n');
      git(["add", "-A"], fake);
      const pass = spawnSync("bash", ["scripts/ci/secret-scan.sh"], { cwd: fake, encoding: "utf8" });
      expect(pass.status).toBe(0);
      expect(pass.stdout).toContain("secret scan ok");
      writeFileSync(join(fake, "src", "leak.ts"), `export const leaked = "${SEN}";\n`);
      git(["add", "-A"], fake);
      const fail = spawnSync("bash", ["scripts/ci/secret-scan.sh"], { cwd: fake, encoding: "utf8" });
      expect(fail.status).not.toBe(0);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it("D3-1b: sparse checkout omits sealed blobs without fetching them", () => {
    const patterns = sparsePatterns();
    const expected = ["/*", ...sealedEntries.map((e) => "!/" + e)];
    expect([...patterns].sort()).toEqual([...expected].sort());
    const fake = makeFake();
    const parent = mkdtempSync(join(tmpdir(), "d3-clone-"));
    try {
      const tree = git(["ls-tree", "-r", "HEAD"], fake);
      expect(tree.status).toBe(0);
      const sentinelRel = dirEntries[0]! + "sentinel.txt";
      const line = tree.stdout.split("\n").find((l) => l.endsWith("\t" + sentinelRel));
      expect(line).toBeDefined();
      const sha = line!.split(/\s+/)[2]!;
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      git(["config", "uploadpack.allowFilter", "true"], fake);
      const clone = join(parent, "c");
      const c1 = spawnSync("git", ["clone", "--no-checkout", "--filter=blob:none", "file://" + fake, clone], {
        encoding: "utf8",
      });
      expect(c1.status).toBe(0);
      expect(git(["sparse-checkout", "set", "--no-cone", ...patterns], clone).status).toBe(0);
      expect(git(["checkout"], clone).status).toBe(0);
      for (const e of sealedEntries) {
        const target = e.endsWith("/") ? join(clone, e, "sentinel.txt") : join(clone, e);
        expect(existsSync(target)).toBe(false);
      }
      expect(existsSync(join(clone, "src", "a.ts"))).toBe(true);
      const cat = spawnSync("git", ["-C", clone, "-c", "fetch.negotiationAlgorithm=noop", "cat-file", "-e", sha], {
        encoding: "utf8",
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      });
      expect(cat.status).not.toBe(0);
    } finally {
      rmSync(fake, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("D3-2: guard hardening (case, backslash, symlink, ancestors, child processes)", () => {
    const dir0 = dirEntries[0]!.replace(/\/+$/, "");
    const absDir = join(repo, dir0);
    const missing = join(absDir, "__d3_missing__.json");
    expect(isSealedPath(missing)).toBe(true);
    expect(isSealedPath(missing.toUpperCase())).toBe(true);
    expect(isSealedPath(absDir.replace(/\//g, "\\") + "\\__d3_missing__.json")).toBe(true);
    const linkBase = mkdtempSync(join(tmpdir(), "d3-link-"));
    try {
      const link = join(linkBase, "lnk");
      symlinkSync(absDir, link);
      expect(isSealedPath(join(link, "x.json"))).toBe(true);
    } finally {
      rmSync(linkBase, { recursive: true, force: true });
    }
    expect(containsSealed(join(repo, dirname(dir0)))).toBe(true);
    expect(containsSealed(join(repo, "eval"))).toBe(true);
    expect(containsSealed(tmpdir())).toBe(false);
    const dest = mkdtempSync(join(tmpdir(), "d3-cp-"));
    try {
      expect(codeOf(() => cpSync(join(repo, dirname(dir0)), dest, { recursive: true }))).toBe("SEALED_ACCESS");
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
    expect(codeOf(() => readdirSync(join(repo, "eval"), { recursive: true }))).toBe("SEALED_ACCESS");
    expect(codeOf(() => spawnSync("cat", [missing]))).toBe("SEALED_ACCESS");
    const relParent = dirname(dir0);
    expect(codeOf(() => spawnSync("git", ["grep", "x", "--", relParent], { cwd: repo }))).toBe("SEALED_ACCESS");
    expect(guardChildArgs("git", ["grep", "x", "--", relParent], repo)).toBe(relParent);
    expect(guardChildArgs("git", ["--version"])).toBe(null);
    const probe =
      `try{require("fs").readFileSync(${JSON.stringify(missing)})}` +
      `catch(e){process.stdout.write(String(e && e.code))}`;
    const r = spawnSync(process.execPath, ["-e", probe], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("SEALED_ACCESS");
    const v = spawnSync("git", ["--version"], { encoding: "utf8" });
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/git version/);
    expect(() => readFileSync(join(repo, "package.json"), "utf8")).not.toThrow();
  });
});
