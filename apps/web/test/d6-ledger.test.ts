// D6 acceptance: the complete acceptance ledger is restored and the pitch is
// reconciled. Pure file reads; no network, no models, no sealed data.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const REGISTRY = rd("docs/release/acceptance-registry.md");
const READINESS = rd("docs/release/c9-readiness.md");
const README = rd("docs/engineering-log.md");
const VIDEO = rd("docs/submission/video-script.md");

function expand(prefix: string, lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(`${prefix}-${i}`);
  return out;
}
const EXPECTED = new Set([
  ...expand("C1", 1, 9),
  ...expand("C2", 1, 7),
  ...expand("C3", 1, 8),
  ...expand("C4", 1, 11),
  ...expand("C5", 1, 12),
  ...expand("C6", 1, 7),
  ...expand("C7", 1, 8),
  ...expand("C8", 1, 9),
  ...Array.from({ length: 10 }, (_, i) => `C9-P${i + 1}`),
  ...expand("D1", 1, 5),
  ...expand("D2", 1, 6),
  ...expand("D3", 1, 5),
  ...expand("D4", 1, 6),
  ...expand("D5", 1, 5),
  ...expand("D6", 1, 5),
]);
// G5 extension: canonical set grew by 51 G IDs (G ledger rows live in
// c9-readiness.md). D6-2 stays on the C/D set below; only D6-1 uses G_IDS.
const G_IDS = new Set([
  ...expand("G1", 1, 9),
  ...expand("G2", 1, 8),
  ...expand("G3", 1, 12),
  ...expand("G4", 1, 8),
  ...expand("G5", 1, 6),
  ...expand("G6", 1, 8),
]);

function canonicalIds(): string[] {
  const m = REGISTRY.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  expect(m, "registry canonical JSON block").toBeTruthy();
  const body: string = m?.[1] ?? "";
  expect(body).not.toBe("");
  const ids = (JSON.parse(body) as { canonicalAcceptanceIds: string[] })
    .canonicalAcceptanceIds;
  expect(Array.isArray(ids)).toBe(true);
  return ids;
}

interface LedgerRow {
  id: string;
  head: string;
  probe: string;
  outcome: string;
  limitation: string;
}
function ledgerRows(): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const line of REGISTRY.split("\n")) {
    const m = line.match(
      /^\|\s*([A-Z0-9]+-P?\d+)\s*\|\s*(`[^`]*`|[A-Za-z0-9._-]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/
    );
    if (m && m[1] && m[2] && m[3] && m[4] && m[5]) {
      const id: string = m[1];
      const head: string = m[2];
      const probe: string = m[3];
      const outcome: string = m[4];
      const limitation: string = m[5];
      rows.push({
        id,
        head: head.replace(/`/g, ""),
        probe,
        outcome,
        limitation,
      });
    }
  }
  return rows;
}

describe("D6 acceptance ledger", () => {
  it("D6-1: registry canonical ID set equals the exact expected set, including C1-9, C2-7, C4-7..C4-11, C6-7 (and all D1-D6 IDs).", () => {
    const ids = canonicalIds();
    expect(new Set(ids)).toEqual(new Set([...EXPECTED, ...G_IDS]));
    expect(ids).toHaveLength(EXPECTED.size + G_IDS.size);
    for (const must of [
      "C1-9",
      "C2-7",
      "C4-7",
      "C4-8",
      "C4-9",
      "C4-10",
      "C4-11",
      "C6-7",
      ...expand("D1", 1, 5),
      ...expand("D2", 1, 6),
      ...expand("D3", 1, 5),
      ...expand("D4", 1, 6),
      ...expand("D5", 1, 5),
      ...expand("D6", 1, 5),
    ]) {
      expect(ids, must).toContain(must);
    }
    // The readiness doc restores the same complete set: no truncated ranges.
    for (const id of EXPECTED) expect(READINESS, id).toContain(id);
    for (const id of G_IDS) expect(READINESS, id).toContain(id);
    expect(READINESS).toMatch(/C1-9/);
    expect(READINESS).toMatch(/C2-7/);
    expect(READINESS).toMatch(/C4-11/);
    expect(READINESS).toMatch(/C6-7/);
  });

  it("D6-2: every ledger row names exact tested head (commit sha), behavioral test/probe, outcome, limitation; no row whose only evidence is CI.", () => {
    const rows = ledgerRows();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of EXPECTED) {
      const row = byId.get(id);
      expect(row, `ledger row ${id}`).toBeTruthy();
      // Exact tested head: 40-hex sha, or TBD-head where no head exists yet.
      expect(row!.head, `${id} head`).toMatch(/^([0-9a-f]{40}|TBD-head)$/);
      // Behavioral test/probe: names a repo file, never bare CI.
      expect(row!.probe, `${id} probe`).toMatch(
        /(apps|services|docs|packages|eval|infra)\/[A-Za-z0-9_./-]+\.(ts|mjs|py|md|json|yml)/
      );
      expect(row!.probe, `${id} probe is not CI-only`).not.toMatch(
        /^\s*CI\b/i
      );
      expect(row!.outcome.trim(), `${id} outcome`).not.toBe("");
      expect(row!.limitation.trim(), `${id} limitation`).not.toBe("");
    }
    // TBD-head is allowed only where no tested head can exist yet (D2, D6).
    for (const row of rows) {
      if (row.head === "TBD-head") {
        expect(row.id, `${row.id} TBD-head scope`).toMatch(/^(D2|D6)-/);
      }
    }
  });

  it("D6-3: model rows distinguish current session patterns, standalone/historical model paths, live verification (live = not performed).", () => {
    for (const doc of [README, REGISTRY]) {
      // Current session path: deterministic patterns, not a model call.
      expect(doc).toMatch(/deterministic offline patterns/i);
      // Standalone/historical model path labelled as such.
      expect(doc).toMatch(/standalone\/historical/i);
      // Live verification explicitly not performed.
      expect(doc).toMatch(/live not performed/i);
      // Official Meta-docs facts: Standard vs Contributor, recursive schema 400.
      expect(doc).toMatch(/Standard mode/);
      expect(doc).toMatch(/Contributor mode/);
      expect(doc).toMatch(/muse-spark-1\.3-contributor/);
      expect(doc).toMatch(/recursive/);
      expect(doc).toMatch(/HTTP 400/);
    }
  });

  it("D6-4: video proof shot cites the executed D2-6 e2e; scripted walkthrough proof references that spec and says video is pending human recording.", () => {
    const shot = VIDEO.split("\n").find((l) => /^\| 0:50/.test(l))!;
    expect(shot, "proof shot row").toBeTruthy();
    expect(shot).toContain("apps/web/e2e/d2-approval.spec.ts");
    expect(shot).toContain("D2-6");
    expect(shot.toLowerCase()).toContain("exact clipboard bytes");
    expect(shot.toLowerCase()).toContain("fake transport");
    expect(shot.toLowerCase()).not.toContain("recorded public-dummy");
    const proofPath = "apps/web/proof/d6-public-demo-session.md";
    expect(shot).toContain(proofPath);
    expect(existsSync(resolve(root, proofPath)), proofPath).toBe(true);
    const proof = rd(proofPath);
    expect(proof).toMatch(/invented/i);
    expect(proof).toMatch(/scripted walkthrough/i);
    expect(proof).toMatch(/pending a human recording/i);
    expect(proof).toContain("apps/web/e2e/d2-approval.spec.ts");
    expect(proof).toContain("D2-6");
    expect(proof).not.toMatch(/recorded/i);
    for (const doc of [VIDEO, README]) {
      expect(doc).toMatch(/explicit click/i);
      expect(doc).toMatch(/any edit[^.\n]*clears the approval/i);
    }
  });

  it("D6-5: founder story is supplied; user observations, video, and partner facts stay pending where marked", () => {
    expect(README).toMatch(/Founder story: done/);
    expect(README).toMatch(/User observations: PENDING/);
    expect(README).toMatch(/Video URLs: PENDING/);
    expect(VIDEO).toMatch(/PENDING/);
    expect(READINESS).toMatch(/PENDING/);
    const ALL = [README, VIDEO, READINESS, REGISTRY].join("\n");
    expect(ALL).not.toMatch(/saved (me|us|them) \$|customers (said|told)|market validation (shows|proves)/i);
  });
});
