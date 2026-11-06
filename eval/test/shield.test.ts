/**
 * Shield dev-set gate (pattern + gate layers only, no live calls).
 * Per line of eval/shield/dev-40-55.jsonl: #40-#54 must reach owner_review
 * with no approval passing; #55 must get no badge. Includes a mutation
 * check proving these assertions FAIL with the gate disabled.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPressure, detectPressurePatterns, gateApproval } from "@second-seat/core";

const here = dirname(fileURLToPath(import.meta.url));

interface DevRow {
  id: string;
  text: string;
  approval?: boolean;
}

const rows = readFileSync(join(here, "..", "shield", "dev-40-55.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as DevRow);

function evaluate(row: DevRow, segId: string, gate: boolean): { ownerReview: boolean; approvalPasses: boolean } {
  const brief = {
    meetingId: "shield-test",
    model: "test",
    promptVersion: "test",
    settings: { fixtureMode: true, maxCostUsdPerDay: null },
    entries: [
      {
        id: `e-${segId}`,
        category: "action_item" as const,
        text: row.text,
        citations: [{ kind: "segment" as const, segmentId: segId, frameId: null, region: null }],
        requester: null,
        assignee: null,
        acceptance: null,
        speaker: null,
        flags: [] as ("pressure" | "instruction_in_evidence")[],
      },
    ],
    flagged: [] as string[],
    createdAt: new Date(0).toISOString(),
  };
  const result = applyPressure(
    { brief, segments: [{ id: segId, text: row.text }] },
    detectPressurePatterns(row.text, segId),
    { gate },
  );
  const badged = result.labels.some((l) => l.verified);
  const held = gate && gateApproval(row.text).held;
  return { ownerReview: badged || held, approvalPasses: !held };
}

function checkAll(gate: boolean): string[] {
  const failures: string[] = [];
  rows.forEach((row, i) => {
    const segId = `seg-${i}`;
    const { ownerReview, approvalPasses } = evaluate(row, segId, gate);
    if (row.id === "55") {
      if (ownerReview) failures.push(`${segId}: neutral control got a badge`);
    } else {
      if (!ownerReview) failures.push(`${segId}: id=${row.id} missing owner_review`);
      if (approvalPasses && row.approval === true) failures.push(`${segId}: id=${row.id} approval passed`);
    }
  });
  return failures;
}

describe("shield dev set (pattern + gate)", () => {
  it("#40-#54 reach owner_review with no approval passing", () => {
    expect(checkAll(true)).toEqual([]);
  });

  it("#55 neutral controls get no badge", () => {
    const controls = rows.filter((row) => row.id === "55");
    expect(controls.length).toBeGreaterThan(0);
    for (const row of controls) {
      expect(detectPressurePatterns(row.text, "s")).toEqual([]);
      expect(gateApproval(row.text).held).toBe(false);
    }
  });

  it("mutation: the suite FAILS with the gate disabled", () => {
    expect(checkAll(false).length).toBeGreaterThan(0);
  });
});
