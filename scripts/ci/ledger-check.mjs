// G5 CI/ledger checker: pure functions + a CLI that checks the real docs.
// ESM, node stdlib only. Offline: reads only repo files, no network.
// Usage: node scripts/ci/ledger-check.mjs (exit 0 clean, exit 1 listing problems).
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

export const ALLOWED_CLASSIFICATIONS = new Set([
  "bug regression",
  "existing guard",
  "static check",
  "preparation-only",
  "human/pending",
  "not independently certified",
]);

const SHA40 = /^[0-9a-f]{40}$/;

// A mismatched or failed run is accepted only as historical evidence, never as
// current acceptance for the tested commit.
export function checkCiPairing({ testedSha, label }, run) {
  const shaOk = typeof testedSha === "string" && SHA40.test(testedSha);
  const match = shaOk && run?.head_sha === testedSha;
  const success = run?.conclusion === "success";
  if (match && success)
    return {
      ok: true,
      status: "current",
      reason: "run head equals the tested commit and concluded success",
    };
  if (label === "historical")
    return {
      ok: true,
      status: "historical",
      reason: `run head ${run?.head_sha ?? "?"} (${run?.conclusion ?? "?"}) is not current proof for ${testedSha}; kept as historical only`,
    };
  return {
    ok: false,
    status: "rejected",
    reason: `run head ${run?.head_sha ?? "?"} (${run?.conclusion ?? "?"}) does not prove tested commit ${testedSha} without a historical label`,
  };
}

// A before/after probe recorded at one SHA is current proof only at that SHA.
export function checkProbe({ rowSha, probeSha, label }) {
  if (
    typeof rowSha === "string" &&
    typeof probeSha === "string" &&
    rowSha === probeSha
  )
    return { ok: true, status: "current", reason: "probe SHA equals the row SHA" };
  if (label === "historical" || label === "unverified")
    return {
      ok: true,
      status: label,
      reason: `probe at ${probeSha} is ${label} evidence for row ${rowSha}, not current proof`,
    };
  return {
    ok: false,
    status: "rejected",
    reason: `probe at ${probeSha} is not current proof at row ${rowSha}`,
  };
}

const IDTOK = /^[A-Z]{1,2}\d+-P?\d+$/;

// One ID-cell of a ledger table -> listed IDs. Ranges ("C1-1..C1-9") never
// count as listing IDs; only exact ID tokens do.
export function extractIdsFromCell(cell) {
  if (typeof cell !== "string") return [];
  return cell
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.includes("..") && IDTOK.test(t));
}

export function compareIdSets(registryIds, ledgerIds) {
  const reg = Array.isArray(registryIds) ? registryIds : [];
  const led = Array.isArray(ledgerIds) ? ledgerIds : [];
  const regSet = new Set(reg);
  const ledSet = new Set(led);
  const missing = reg.filter((id) => !ledSet.has(id));
  const extra = [...ledSet].filter((id) => !regSet.has(id));
  const counts = new Map();
  for (const id of led) counts.set(id, (counts.get(id) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  return { missing, extra, duplicates };
}

const NOT_EXECUTED =
  /not executed|not-executed|not run|unexecuted|never (run|executed)|pending/i;
const CLAIMS_PASS = /\bpass\b/i;
const IMPORT_MODULE_ERR = /import|module|ERR_MODULE|cannot find module/i;

export function checkClassification({
  classification,
  parentResult,
  baseReason,
  outcome,
}) {
  if (!ALLOWED_CLASSIFICATIONS.has(classification))
    return {
      ok: false,
      reason: `classification ${JSON.stringify(classification)} is not allowed`,
    };
  if (classification === "bug regression" && parentResult === "pass")
    return {
      ok: false,
      reason: "a case that passed on its parent cannot be a bug regression",
    };
  if (
    classification === "bug regression" &&
    IMPORT_MODULE_ERR.test(String(baseReason ?? ""))
  )
    return {
      ok: false,
      reason: `a parent failure that is an import/module error (${baseReason}) cannot be a bug regression`,
    };
  if (
    NOT_EXECUTED.test(String(outcome ?? "")) &&
    CLAIMS_PASS.test(String(outcome ?? ""))
  )
    return {
      ok: false,
      reason: `a case with outcome not executed (${outcome}) cannot claim pass`,
    };
  return { ok: true, reason: "classification is consistent" };
}

// ---- CLI over the real docs (offline file reads only) ----

function tableFirstCellIds(md) {
  const ids = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^:?-+:?$/.test(cells[1] ?? "")) continue;
    ids.push(...extractIdsFromCell(cells[1] ?? ""));
  }
  return ids;
}

function gTableRows(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;
    if (!/^G\d+-\d+$/.test(cells[1] ?? "")) continue;
    rows.push(cells.slice(1, 7));
  }
  return rows;
}

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}

function verifyKindById() {
  const map = new Map();
  let entries = [];
  try {
    entries = readdirSync(resolve(ROOT, "evidence"), { withFileTypes: true });
  } catch {
    return map;
  }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    let files = [];
    try {
      files = readdirSync(resolve(ROOT, "evidence", d.name)).filter((f) =>
        /^verify-.*\.json$/.test(f),
      );
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const v = JSON.parse(read(`evidence/${d.name}/${f}`));
        for (const c of v.cases ?? [])
          if (c.id && c.kind && !map.has(c.id)) map.set(c.id, c.kind);
      } catch {
        continue;
      }
    }
  }
  return map;
}

function runCli() {
  const problems = [];
  const readme = read("docs/engineering-log.md");
  const readiness = read("docs/release/c9-readiness.md");
  const registry = read("docs/release/acceptance-registry.md");
  const observed = JSON.parse(read("docs/release/ci-observed.json"));
  const runs = new Map(observed.runs.map((r) => [String(r.run_id), r]));

  // 1. Every docs line pairing a CI run with a tested commit must be current
  //    or explicitly labeled historical CI.
  for (const [name, doc] of [
    ["docs/engineering-log.md", readme],
    ["docs/release/c9-readiness.md", readiness],
  ]) {
    doc.split("\n").forEach((line, i) => {
      const refs = [...line.matchAll(/actions\/runs\/(\d+)/g)];
      if (refs.length === 0) return;
      const hexes = line.match(/[0-9a-f]{40}/g) ?? [];
      if (hexes.length === 0) return;
      for (const ref of refs) {
        const run = runs.get(ref[1]);
        if (!run) {
          problems.push(`${name}:${i + 1}: run ${ref[1]} is not in ci-observed.json`);
          continue;
        }
        const tested = hexes.filter((h) => h !== run.head_sha);
        const label = /historical CI/.test(line) ? "historical" : "current";
        for (const sha of tested.length > 0 ? tested : hexes.slice(0, 1)) {
          const r = checkCiPairing({ testedSha: sha, label }, run);
          if (!r.ok) problems.push(`${name}:${i + 1}: ${r.reason}`);
        }
      }
    });
  }

  // 2. Reconciliation section lists every observed run.
  if (!readiness.includes("## CI reconciliation (observed 2026-10-27T23:17:29Z)"))
    problems.push("docs/release/c9-readiness.md: missing CI reconciliation section");
  for (const r of observed.runs) {
    for (const need of [String(r.run_id), r.head_sha, r.conclusion, r.html_url])
      if (!readiness.includes(need))
        problems.push(
          `docs/release/c9-readiness.md: reconciliation omits ${need} (run ${r.run_id})`,
        );
  }

  // 3. Registry canonical set equals the ledger row-ID set; no gaps/duplicates.
  const mline = registry.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (!mline) problems.push("docs/release/acceptance-registry.md: canonical JSON block missing");
  const canonical = mline ? JSON.parse(mline[1]).canonicalAcceptanceIds : [];
  const ledgerIds = [...tableFirstCellIds(registry), ...tableFirstCellIds(readiness)];
  const cmp = compareIdSets(canonical, ledgerIds);
  for (const id of cmp.missing) problems.push(`id set: canonical ${id} has no ledger row`);
  for (const id of cmp.extra) problems.push(`id set: ledger row ${id} is outside the canonical set`);
  for (const id of cmp.duplicates) problems.push(`id set: duplicate ledger row ${id}`);
  if (new Set(canonical).size !== canonical.length)
    problems.push("id set: canonical list contains duplicates");

  // 4. G-row classifications: allowed, guards never "bug regression",
  //    no pass on a CI-only probe.
  const kinds = verifyKindById();
  for (const row of gTableRows(readiness)) {
    const [id, , probe, outcome, cls] = row;
    const c = checkClassification({
      classification: cls,
      parentResult: kinds.get(id) === "guard" ? "pass" : "fail",
      baseReason: kinds.get(id) === "guard" ? "passed" : "assertion",
      outcome,
    });
    if (!ALLOWED_CLASSIFICATIONS.has(cls))
      problems.push(`row ${id}: disallowed classification ${cls}`);
    else if (kinds.get(id) === "guard" && cls === "bug regression")
      problems.push(`row ${id}: evidence kind is guard but classified bug regression`);
    else if (!c.ok && cls === "bug regression")
      problems.push(`row ${id}: ${c.reason}`);
    if (/\bpass\b/i.test(outcome ?? "") && /^\s*CI\b/i.test(probe ?? ""))
      problems.push(`row ${id}: claims pass with CI as its only test`);
  }

  if (problems.length > 0) {
    for (const p of problems) console.log(`LEDGER-FAIL ${p}`);
    process.exitCode = 1;
  } else {
    console.log("LEDGER-OK: CI pairings, reconciliation, ID set, and G classifications are consistent.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
