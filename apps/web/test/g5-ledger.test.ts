// G5 ledger: exact release evidence and honest verification ledger.
// Pure file reads + pure-function unit checks; no network, no models, no sealed data.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(__dirname, "../../..");
const rd = (p: string) => readFileSync(resolve(root, p), "utf8");
const README = () => rd("docs/engineering-log.md");
const READINESS = () => rd("docs/release/c9-readiness.md");
const REGISTRY = () => rd("docs/release/acceptance-registry.md");
const OBSERVED = () =>
  JSON.parse(rd("docs/release/ci-observed.json")) as {
    runs: Array<{
      run_id: number;
      head_sha: string;
      conclusion: string;
      html_url: string;
    }>;
  };

const HEX40 = /[0-9a-f]{40}/g;
const RUNREF = /actions\/runs\/(\d+)/g;
const IDTOK = /^[A-Z]{1,2}\d+-P?\d+$/;

function cellIds(cell: string): string[] {
  return cell
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.includes("..") && IDTOK.test(t));
}

// First-cell IDs of every markdown table row (ledger rows, not prose ranges).
function tableIds(md: string): string[] {
  const ids: string[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const first = cells[1] ?? "";
    if (/^:?-+:?$/.test(first)) continue;
    ids.push(...cellIds(first));
  }
  return ids;
}

function gRows(md: string): string[][] {
  const rows: string[][] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue; // | ID | head | probe | outcome | classification | limitation |
    if (!/^G\d+-\d+$/.test(cells[1] ?? "")) continue;
    rows.push(cells.slice(1, 7));
  }
  return rows;
}

function gIds(prefix: string, lo: number, hi: number): string[] {
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(`${prefix}-${i}`);
  return out;
}
const ALL_G = [
  ...gIds("G1", 1, 9),
  ...gIds("G2", 1, 8),
  ...gIds("G3", 1, 12),
  ...gIds("G4", 1, 8),
  ...gIds("G5", 1, 6),
  ...gIds("G6", 1, 8),
];
const ALLOWED = new Set([
  "bug regression",
  "existing guard",
  "static check",
  "preparation-only",
  "human/pending",
  "not independently certified",
]);

async function ledgerMod(): Promise<any> {
  return await import(
    pathToFileURL(resolve(root, "scripts/ci/ledger-check.mjs")).href
  );
}

describe("G5 exact release evidence", () => {
  it("G5-1", async () => {
    for (const doc of [README(), READINESS()]) {
      for (const line of doc.split("\n")) {
        const refs = [...line.matchAll(RUNREF)];
        if (refs.length === 0) continue;
        const hexes = line.match(HEX40) ?? [];
        if (hexes.length === 0) continue;
        for (const ref of refs) {
          const run = OBSERVED().runs.find(
            (r) => String(r.run_id) === ref[1],
          );
          expect(run, `ci-identity-mismatch: run ${ref[1]} is not in ci-observed.json`).toBeTruthy();
          const mismatch =
            hexes.some((h) => h !== run!.head_sha) ||
            run!.conclusion !== "success";
          if (mismatch)
            expect(
              line,
              `ci-identity-mismatch: run ${run!.run_id} head ${run!.head_sha.slice(0, 7)} (${run!.conclusion}) is not the tested commit but the line lacks "historical CI"`,
            ).toContain("historical CI");
        }
      }
    }
    const m = await ledgerMod();
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    let r = m.checkCiPairing(
      { testedSha: B, label: "current" },
      { head_sha: A, conclusion: "success" },
    );
    expect(r.ok, "ci-identity-mismatch: mismatched run must be rejected").toBe(false);
    expect(r.status, "ci-identity-mismatch: mismatched run status must be rejected").toBe("rejected");
    r = m.checkCiPairing(
      { testedSha: B, label: "historical" },
      { head_sha: A, conclusion: "success" },
    );
    expect(r.ok, "ci-identity-mismatch: historical label must be accepted").toBe(true);
    expect(r.status, "ci-identity-mismatch: historical label status must be historical").toBe("historical");
    r = m.checkCiPairing(
      { testedSha: A, label: "current" },
      { head_sha: A, conclusion: "success" },
    );
    expect(r.ok, "ci-identity-mismatch: exact match with success must be current").toBe(true);
    expect(r.status, "ci-identity-mismatch: exact match status must be current").toBe("current");
  });

  it("G5-2", () => {
    const readiness = READINESS();
    expect(
      readiness,
      "stale-ci-unrecorded: missing CI reconciliation section for 2026-10-27T23:17:29Z",
    ).toContain("## CI reconciliation (observed 2026-10-27T23:17:29Z)");
    for (const run of OBSERVED().runs) {
      expect(readiness, `stale-ci-unrecorded: run ${run.run_id} missing`).toContain(String(run.run_id));
      expect(readiness, `stale-ci-unrecorded: run ${run.run_id} head missing`).toContain(run.head_sha);
      expect(readiness, `stale-ci-unrecorded: run ${run.run_id} conclusion missing`).toContain(run.conclusion);
      expect(readiness, `stale-ci-unrecorded: run ${run.run_id} url missing`).toContain(run.html_url);
    }
  });

  it("G5-3", async () => {
    const sents = READINESS().split(/(?<=[.!?])\s+/);
    const found = sents.find((s) => /probe/i.test(s) && /historical/i.test(s));
    expect(
      found,
      "probe-sha-unverified: no sentence states a probe at one SHA is historical, not current proof at another",
    ).toBeTruthy();
    const m = await ledgerMod();
    const A = "a".repeat(40);
    const B = "b".repeat(40);
    let r = m.checkProbe({ rowSha: A, probeSha: B, label: "historical" });
    expect(r.status, "probe-sha-unverified: different SHAs must not be current").not.toBe("current");
    expect(r.ok, "probe-sha-unverified: historical probe label must be accepted").toBe(true);
    r = m.checkProbe({ rowSha: A, probeSha: B, label: "current" });
    expect(r.ok, "probe-sha-unverified: unverified cross-SHA probe must be rejected").toBe(false);
    r = m.checkProbe({ rowSha: A, probeSha: A, label: "current" });
    expect(r.status, "probe-sha-unverified: equal SHAs must be current").toBe("current");
  });

  it("G5-4", async () => {
    const mline = REGISTRY().match(/```json\s*(\{[\s\S]*?\})\s*```/);
    expect(mline, "id-set-incomplete: registry canonical JSON block missing").toBeTruthy();
    const canonical = (
      JSON.parse(mline![1] ?? "{}") as { canonicalAcceptanceIds: string[] }
    ).canonicalAcceptanceIds;
    const ledger = [...tableIds(REGISTRY()), ...tableIds(READINESS())];
    const cset = new Set(canonical);
    const lset = new Set(ledger);
    const missing = canonical.filter((id) => !lset.has(id));
    expect(missing, `id-set-incomplete: registry IDs missing from ledger rows: ${missing.join(",")}`).toEqual([]);
    const extra = [...lset].filter((id) => !cset.has(id));
    expect(extra, `id-set-incomplete: ledger row IDs outside the canonical set: ${extra.join(",")}`).toEqual([]);
    const dupes = ledger.filter((id, i) => ledger.indexOf(id) !== i);
    expect([...new Set(dupes)], `id-set-incomplete: duplicate ledger row IDs: ${[...new Set(dupes)].join(",")}`).toEqual([]);
    for (const id of ALL_G)
      expect(cset, `id-set-incomplete: canonical set lacks ${id}`).toContain(id);
    expect(canonical, "id-set-incomplete: canonical IDs contain duplicates").toHaveLength(cset.size);
    const m = await ledgerMod();
    let c = m.compareIdSets(["A-1", "A-2"], ["A-1", "A-2", "A-2", "B-1"]);
    expect(c.missing, "id-set-incomplete: unit missing must be empty").toEqual([]);
    expect(c.extra, "id-set-incomplete: unit must detect extra B-1").toEqual(["B-1"]);
    expect(c.duplicates, "id-set-incomplete: unit must detect duplicate A-2").toEqual(["A-2"]);
    c = m.compareIdSets(["A-1", "A-2"], ["A-1"]);
    expect(c.missing, "id-set-incomplete: unit must detect missing A-2").toEqual(["A-2"]);
    expect(
      m.extractIdsFromCell("C1-1..C1-9"),
      "id-set-incomplete: a range cell must not count as listing IDs",
    ).toEqual([]);
  });

  it("G5-5", async () => {
    const rows = gRows(READINESS());
    expect(rows.length, "classification-missing: expected 51 G ledger rows in c9-readiness").toBe(51);
    for (const row of rows)
      expect(
        ALLOWED.has(row[4] ?? ""),
        `classification-missing: row ${row[0]} has disallowed classification ${row[4]}`,
      ).toBe(true);
    const kindById = new Map<string, string>();
    for (const dir of readdirSync(resolve(root, "evidence"), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      let files: string[] = [];
      try {
        files = readdirSync(resolve(root, "evidence", dir.name)).filter((f) =>
          /^verify-.*\.json$/.test(f),
        );
      } catch {
        continue;
      }
      for (const f of files) {
        try {
          const v = JSON.parse(rd(`evidence/${dir.name}/${f}`)) as {
            cases?: Array<{ id?: string; kind?: string }>;
          };
          for (const c of v.cases ?? [])
            if (c.id && c.kind && !kindById.has(c.id)) kindById.set(c.id, c.kind);
        } catch {
          continue;
        }
      }
    }
    for (const row of rows) {
      const kind = kindById.get(row[0] ?? "");
      if (kind === "guard")
        expect(
          row[4],
          `classification-missing: row ${row[0]} is a guard in evidence but classified "${row[4]}"`,
        ).not.toBe("bug regression");
      if (/\bpass\b/i.test(row[3] ?? "")) {
        expect(row[2] ?? "", `classification-missing: row ${row[0]} claims pass with CI as its only test`).not.toMatch(/^\s*CI\b/i);
        expect(row[2] ?? "", `classification-missing: row ${row[0]} claims pass without naming a test file`).toMatch(/\//);
      }
    }
    const m = await ledgerMod();
    let r = m.checkClassification({
      classification: "bug regression",
      parentResult: "pass",
      baseReason: "assertion",
      outcome: "pass (before/after probe)",
    });
    expect(r.ok, "classification-missing: parent pass must not be bug regression").toBe(false);
    r = m.checkClassification({
      classification: "bug regression",
      parentResult: "fail",
      baseReason: "import error: Cannot find module 'x'",
      outcome: "pass",
    });
    expect(r.ok, "classification-missing: import/module parent failure must not be bug regression").toBe(false);
    r = m.checkClassification({
      classification: "existing guard",
      parentResult: "pass",
      baseReason: "passed",
      outcome: "pass (not executed)",
    });
    expect(r.ok, "classification-missing: pass claimed with outcome not executed must fail").toBe(false);
    r = m.checkClassification({
      classification: "bug regression",
      parentResult: "fail",
      baseReason: "assertion",
      outcome: "pass (before/after probe)",
    });
    expect(r.ok, "classification-missing: real assertion failure must allow bug regression").toBe(true);
    r = m.checkClassification({
      classification: "human/pending",
      parentResult: "fail",
      baseReason: "not executed",
      outcome: "pending",
    });
    expect(r.ok, "classification-missing: pending human case must be accepted").toBe(true);
  });

  it("G5-6g", () => {
    const two = [README(), READINESS()].join("\n");
    expect(two, "g5-guard").toMatch(/blocked/i);
    expect(two, "g5-guard").toMatch(/proposed/i);
    expect(two, "g5-guard").toMatch(/deterministic/i);
    expect(two, "g5-guard").toMatch(/6\/8/);
    expect(two, "g5-guard").toMatch(/founder story/i);
    expect(two, "g5-guard").toMatch(/pending/i);
    expect(two, "g5-guard").toMatch(/video/i);
    expect(README(), "g5-guard").toMatch(/execution blocked/);
    expect(READINESS(), "g5-guard").toMatch(/BLOCKED/);
    expect(READINESS(), "g5-guard").toMatch(/PROPOSED/);
  });
});
