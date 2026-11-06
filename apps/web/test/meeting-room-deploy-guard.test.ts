import { expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const DEPLOY_BASENAMES = new Set([
  "render.yaml",
  "render.yml",
  "Procfile",
  "fly.toml",
  "app.json",
  "vercel.json",
  "netlify.toml",
  ".env.example",
]);

const DEPLOY_BASENAME_RX = /deploy|render|release|publish/i;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function listDir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

/** Push every regular file under dir (recursive, skipping __pycache__). */
function walkFiles(dir: string, out: string[]): void {
  for (const name of listDir(dir)) {
    if (name === "__pycache__") continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync> | null = null;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, out);
    else if (st.isFile()) out.push(p);
  }
}

/**
 * Deploy-config files that must never enable test mode. An EXPLICIT
 * allow-list, never a full-repo walk: fixed basenames at the repo root and
 * in each apps/* and services/* dir, every file under infra/, and
 * deploy/render/release/publish-named files in .github/workflows/ and
 * scripts/ (CI in .github/workflows/ci.yml and local loopback scripts in
 * scripts/ci/* plus Playwright configs are allowed and NOT scanned).
 * Only existing regular files.
 */
function deployConfigFiles(root: string): string[] {
  const out: string[] = [];
  const topDirs = [root];
  for (const scope of ["apps", "services"]) {
    for (const name of listDir(join(root, scope))) {
      const d = join(root, scope, name);
      try {
        if (statSync(d).isDirectory()) topDirs.push(d);
      } catch {
        continue;
      }
    }
  }
  for (const dir of topDirs) {
    for (const name of listDir(dir)) {
      const p = join(dir, name);
      if ((DEPLOY_BASENAMES.has(name) || name.startsWith("Dockerfile") || name.startsWith("docker-compose")) && isFile(p)) {
        out.push(p);
      }
    }
  }
  const infraFiles: string[] = [];
  if (existsSync(join(root, "infra"))) walkFiles(join(root, "infra"), infraFiles);
  out.push(...infraFiles);
  for (const rel of [".github/workflows", "scripts"]) {
    const base = join(root, rel);
    if (!existsSync(base)) continue;
    const found: string[] = [];
    walkFiles(base, found);
    for (const p of found) {
      if (p.includes("scripts/ci/") || p.includes("scripts/tests/")) continue;
      if (DEPLOY_BASENAME_RX.test(basename(p))) out.push(p);
    }
  }
  return out.sort();
}

/** True if the text mentions SECOND_SEAT_TEST_MODE at all. */
function setsTestMode(text: string): boolean {
  return text.includes("SECOND_SEAT_TEST_MODE");
}

it("MR-D1 SECOND_SEAT_TEST_MODE is never set in render.yaml or any deploy config", () => {
  const files = deployConfigFiles(ROOT);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    expect(setsTestMode(readFileSync(f, "utf8")), `test mode set in ${f}`).toBe(false);
  }
});

it("MR-D2 the deploy guard flags a render.yaml that sets SECOND_SEAT_TEST_MODE", () => {
  const fixture = 'services:\n  - type: web\n    envVars:\n      - key: SECOND_SEAT_TEST_MODE\n        value: "1"\n';
  expect(setsTestMode(fixture)).toBe(true);
  expect(setsTestMode("services:\n  - type: web\n")).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), "deploy-guard-"));
  writeFileSync(join(dir, "render.yaml"), fixture);
  expect(deployConfigFiles(dir)).toContain(join(dir, "render.yaml"));
});

it("MR-D3 render.yaml, when present, never enables test mode", () => {
  for (const name of ["render.yaml", "render.yml"]) {
    const p = join(ROOT, name);
    if (!isFile(p)) continue;
    expect(setsTestMode(readFileSync(p, "utf8")), `test mode set in ${name}`).toBe(false);
  }
});
