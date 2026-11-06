// VERIFICATION.md's table must match VERIFICATION_POINTS row for row.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERIFICATION_POINTS } from "../src/index.js";

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "VERIFICATION.md"), "utf8");

export function parseDocTable(text: string): string[][] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.startsWith("|"));
  return lines.slice(2).map((l) => l.slice(1, -1).split("|").map((c) => c.trim().replace(/^`|`$/g, "")));
}

function tableRows(): string[][] {
  return parseDocTable(doc);
}

describe("VERIFICATION.md", () => {
  it("uses the When / File / Check / Built by / On failure header", () => {
    expect(doc).toContain("| When | File | Check | Built by | On failure |");
  });

  it("has one row per verification point, in order, with identical cells", () => {
    expect(tableRows()).toEqual(VERIFICATION_POINTS.map((p) => [p.when, p.file, p.check, p.builtBy, p.onFailure]));
  });

  it("credits the Meta workshop and records its license status", () => {
    expect(doc).toContain("https://github.com/meta-models/legal-agent-workshop");
    expect(doc).toMatch(/no license file/);
  });

  it("says claim feedback does not repeat the qualifier text", () => {
    expect(doc).toMatch(/does not repeat the qualifier text/);
  });

  it("says verify-run reads the approved redaction and does not invent one", () => {
    expect(doc).toMatch(/does not run a fresh redactor/);
  });

  it("FR4-4 parses the same five-column row from LF and CRLF", () => {
    const cells = ["When", "File", "Check", "Built by", "On failure"];
    const header = `| ${cells.join(" | ")} |`;
    const rule = "|---|---|---|---|---|";
    const row = "| after review | packages/core/src/verification/verifyBrief.ts | verifyBrief | this repo | block |";
    const lf = `${header}\n${rule}\n${row}\n`;
    const crlf = `${header}\r\n${rule}\r\n${row}\r\n`;
    const fromLf = parseDocTable(lf);
    const fromCrlf = parseDocTable(crlf);
    expect(fromLf).toEqual(fromCrlf);
    expect(fromLf[0]).toEqual(["after review", "packages/core/src/verification/verifyBrief.ts", "verifyBrief", "this repo", "block"]);
    expect(fromLf[0]).toHaveLength(5);
  });
});
