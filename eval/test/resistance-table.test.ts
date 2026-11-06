import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportSplit, resistanceTable, resolveSplit } from "../resistance-table.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "resistance-table.mjs");

describe("resistance table", () => {
  it("refuses the held-out split before any dataset read", () => {
    expect(resolveSplit("heldout").ok).toBe(false);
    const refused = reportSplit("heldout");
    expect(refused.ok).toBe(false);
    expect(refused.report).toBe("");
    const run = spawnSync(process.execPath, [script, "--split", "heldout"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/held-out/);
    expect(run.stdout).toBe("");
  });

  it("prints off and pattern-only from the dev fixtures and fills Spark from the recording", () => {
    const result = reportSplit("dev");
    expect(result.ok).toBe(true);
    expect(result.report).toContain("| off | 0 |");
    expect(result.report).toMatch(/\| pattern-only \| \d+ \| \d+ \| \[/);
    expect(result.report).toMatch(/\| pattern\+Spark \| \d+ \| \d+ \| \[/);
    expect(result.report).not.toContain("pending live run");
  });

  it("leaves pattern+Spark pending when no recorded labels are supplied", () => {
    const table = resistanceTable(
      [{ id: "1", text: "The board requires this.", expectedTactic: "authority" }],
      null,
    );
    const spark = table.columns.find((column) => column.name === "pattern+Spark");
    expect(spark?.pending).toBe(true);
    expect(table.columns.find((column) => column.name === "off")?.caught).toBe(0);
  });
});
