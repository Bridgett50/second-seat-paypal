import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const srcDir = join(packageDir, "src");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("core dependency guard", () => {
  it("has no runtime dependencies entry", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      dependencies?: unknown;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it("imports only relative or node: modules in src", () => {
    const specifierPattern = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g;
    const bareImportPattern = /import\s*['"]([^'"]+)['"]/g;
    const violations: string[] = [];
    for (const file of listSourceFiles(srcDir)) {
      const body = readFileSync(file, "utf8");
      const specifiers: string[] = [];
      for (const pattern of [specifierPattern, bareImportPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(body)) !== null) {
          const spec = match[1];
          if (spec !== undefined) {
            specifiers.push(spec);
          }
        }
      }
      for (const spec of specifiers) {
        const ok = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:");
        if (!ok) {
          violations.push(`${file}: ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("uses no network fetch in src", () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(srcDir)) {
      const body = readFileSync(file, "utf8");
      if (/\bfetch\s*\(/.test(body)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
