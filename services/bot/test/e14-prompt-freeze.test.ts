// E14 prompt freeze: the freeze script must hash the inline Glimmer redaction
// system prompt in services/bot/src/private/redact.ts alongside prompts/*.txt.
// Temp ROOT copy only; node:fs/os/path/child_process plus vitest.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..", "..");
const SRC_FILES = [
  "services/bot/scripts/prompt-freeze.mjs",
  "services/bot/src/brief/muse.ts",
  "services/bot/src/vision/sam.ts",
  "services/bot/src/shield/classify.ts",
  "services/bot/src/private/redact.ts",
  "services/bot/src/judge/support.ts",
];
const REDACT = "services/bot/src/private/redact.ts";
const FROZEN = "eval/results/prompt-freeze.md";

function copyInto(root: string, rel: string): void {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(join(REPO, rel), "utf8"));
}

function runFreeze(root: string): string {
  execFileSync("node", [join(root, "services/bot/scripts/prompt-freeze.mjs")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return readFileSync(join(root, FROZEN), "utf8");
}

function rowsByPrefix(md: string, prefix: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(.*?)\s*\|\s*([0-9a-fA-F]+|NOT FOUND)\s*\|/);
    const file = m?.[1];
    const hash = m?.[2];
    if (file !== undefined && hash !== undefined && file.startsWith(prefix)) rows.set(file, hash);
  }
  return rows;
}

let tmp: string;
let first: string;

beforeAll(() => {
  tmp = join(tmpdir(), `e14-freeze-${process.pid}-${Date.now()}`);
  copyInto(tmp, "services/bot/scripts/prompt-freeze.mjs");
  for (const f of readdirSync(join(REPO, "services/bot/prompts"))) {
    if (f.endsWith(".txt")) copyInto(tmp, `services/bot/prompts/${f}`);
  }
  for (const f of SRC_FILES.slice(1)) copyInto(tmp, f);
  first = runFreeze(tmp);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("E14 prompt freeze inline redaction prompt", () => {
  it("E14F-1: freeze output has a redact.ts row with a 64-hex hash", () => {
    const rows = rowsByPrefix(first, "services/bot/src/private/redact.ts");
    expect(rows.size).toBeGreaterThan(0);
    const hash = [...rows.values()][0];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("E14F-2: editing the redaction prompt changes its row only", () => {
    const before = rowsByPrefix(first, "services/bot/src/private/redact.ts");
    const beforePrompts = rowsByPrefix(first, "services/bot/prompts/");
    const redactPath = join(tmp, REDACT);
    const src = readFileSync(redactPath, "utf8");
    expect(src).toContain("never guess");
    writeFileSync(redactPath, src.replace("never guess", "never invent"));
    const second = runFreeze(tmp);
    const after = rowsByPrefix(second, "services/bot/src/private/redact.ts");
    const afterPrompts = rowsByPrefix(second, "services/bot/prompts/");
    expect(after.size).toBeGreaterThan(0);
    expect([...after.values()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...after.values()][0]).not.toBe([...before.values()][0]);
    expect([...afterPrompts.entries()]).toEqual([...beforePrompts.entries()]);
  });

  it("E14F-3: committed freeze equals the unmodified temp run", () => {
    expect(readFileSync(join(REPO, FROZEN), "utf8")).toBe(first);
  });
});
