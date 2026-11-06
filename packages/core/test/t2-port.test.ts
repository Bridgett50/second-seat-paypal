import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageHash } from "../src/t2/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const t2Dir = resolve(here, "..", "src", "t2");

function listT2Files(): string[] {
  return readdirSync(t2Dir)
    .filter((entry) => entry.endsWith(".ts") && statSync(join(t2Dir, entry)).isFile())
    .map((entry) => join(t2Dir, entry));
}

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^"']*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push(match[1]!);
  }
  return out;
}

describe("T2 port guard", () => {
  it("T2P-1 core t2 sources define no meeting connector and import nothing outside core", () => {
    expect(existsSync(join(t2Dir, "connector.ts"))).toBe(false);
    for (const file of listT2Files()) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("function createMeetingConnector");
      for (const spec of importSpecifiers(source)) {
        expect(spec).not.toContain("bot");
        expect(spec).not.toContain("meeting/connector");
      }
    }
  });

  it("T2P-2 core packageHash matches node:crypto SHA-256 for ascii, empty and unicode bodies", () => {
    const bodies = ["", "abc", "héllo ✓ 📎\n", "x".repeat(1000)];
    for (const body of bodies) {
      expect(packageHash(body)).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    }
  });
});
