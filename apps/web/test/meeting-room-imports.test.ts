import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx"]);
const SELF = "meeting-room-imports.test.ts";

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (SOURCE_EXT.has(ext) && name !== SELF) out.push(full);
  }
}

const CORE_STRING = /['"`][^'"`\n]*(?:@second-seat\/core|packages\/core\/)[^'"`\n]*['"`]/;
const FORBIDDEN_NAME = /\b(?:createTwinRoom|runDemoEndToEnd)\b/;
const NON_LITERAL_IMPORT = /\bimport\s*\(\s*(?!['"])/;
const STAR_OF_CORE = /(?:import|export)\s*\*[^;]*?from\s*['"`][^'"`\n]*(?:@second-seat\/core|packages\/core\/)/;

/**
 * Violations for one source file. Any string that names core (package name, subpath,
 * node_modules path or a packages/core/ path) counts as reaching core, whatever the
 * syntax (import, export, require, createRequire, dynamic import). A file that reaches
 * core may not mention a forbidden name anywhere (identifier, string or bracket key).
 * Star imports/re-exports of core and non-literal dynamic imports are refused outright.
 */
function twinImportViolations(file: string, source: string): string[] {
  const out: string[] = [];
  if (NON_LITERAL_IMPORT.test(source) && FORBIDDEN_NAME.test(source)) {
    out.push(`${file}: non-literal dynamic import in a file that names createTwinRoom or runDemoEndToEnd`);
  }
  if (STAR_OF_CORE.test(source)) out.push(`${file}: star import or re-export of @second-seat/core`);
  if (CORE_STRING.test(source) && FORBIDDEN_NAME.test(source)) {
    out.push(`${file}: reaches @second-seat/core and names createTwinRoom or runDemoEndToEnd`);
  }
  return out;
}

describe("meeting room import guard", () => {
  it("MR-I1 apps/web never imports createTwinRoom or runDemoEndToEnd from @second-seat/core", () => {
    const files: string[] = [];
    walk(WEB_DIR, files);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) violations.push(...twinImportViolations(file, readFileSync(file, "utf8")));
    expect(violations).toEqual([]);
  });

  it("MR-I2 the meeting room service imports the twin room from the bot wrapper", () => {
    const source = readFileSync(join(WEB_DIR, "src", "meetingRoom.ts"), "utf8");
    expect(source).toContain("@second-seat/bot/dist/src/t2-room.js");
    expect(source).not.toContain("@second-seat/core");
  });

  it("MR-I3 star re-exports and namespace bracket or destructuring access are caught", () => {
    expect(twinImportViolations("a.ts", `export * from "@second-seat/core";`)).not.toEqual([]);
    expect(twinImportViolations("b.ts", `import * as ns from "@second-seat/core";\nconst r = ns["createTwinRoom"]();`)).not.toEqual([]);
    expect(twinImportViolations("c.ts", `import * as ns from "@second-seat/core";\nconst { createTwinRoom } = ns;`)).not.toEqual([]);
  });
  it("MR-I4 require and createRequire of core are caught", () => {
    expect(twinImportViolations("d.cjs", `const { createTwinRoom } = require("@second-seat/core");`)).not.toEqual([]);
    expect(twinImportViolations("e.ts", `import { createRequire } from "node:module";\nconst core = createRequire(import.meta.url)("@second-seat/core");\ncore.runDemoEndToEnd();`)).not.toEqual([]);
  });
  it("MR-I5 relative and node_modules paths into core are caught", () => {
    expect(twinImportViolations("f.ts", `import { createTwinRoom } from "../../packages/core/src/index.js";`)).not.toEqual([]);
    expect(twinImportViolations("g.ts", `import { runDemoEndToEnd } from "../node_modules/@second-seat/core/dist/index.js";`)).not.toEqual([]);
  });
  it("MR-I6 destructured, bracket and non-literal dynamic imports are caught", () => {
    expect(twinImportViolations("h.ts", `const { createTwinRoom } = await import("@second-seat/core");`)).not.toEqual([]);
    expect(twinImportViolations("i.ts", `const m = await import("@second-seat/core");\nm["runDemoEndToEnd"]();`)).not.toEqual([]);
    expect(twinImportViolations("j.ts", `const spec = "@second-seat/" + "core";\n(await import(spec)).createTwinRoom();`)).not.toEqual([]);
    expect(twinImportViolations("k.ts", "const p = 'core';\nconst { runDemoEndToEnd } = await import(`@second-seat/${p}`);")).not.toEqual([]);
    expect(twinImportViolations("k2.ts", `const m = await import(pathToFileURL("scripts/ci/ledger.mjs").href);`)).toEqual([]);
  });
  it("MR-I7 allowed imports produce no violations", () => {
    expect(twinImportViolations("l.ts", `import { EVIDENCE_BRIEF_JSON_SCHEMA } from "@second-seat/core";`)).toEqual([]);
    expect(twinImportViolations("m.ts", `import { createTwinRoom } from "@second-seat/bot/dist/src/t2-room.js";`)).toEqual([]);
    expect(twinImportViolations("n.ts", `const m = await import("../src/meetingRoom.js");`)).toEqual([]);
  });
});
