/**
 * Score the deterministic brief rules and the claims check against seeded
 * mutants. $0: no model calls, no network.
 *
 *   node rules/run.mjs            check SHA256SUMS, score, print table
 *   node rules/run.mjs --write    also write eval/results/rules-score.json
 *                                 and eval/results/rules-table.md
 *   node rules/run.mjs --pin      rewrite eval/rules/SHA256SUMS (after an
 *                                 intentional generator/source change)
 *
 * Exit 1 if SHA256SUMS mismatches, a block-expected mutant passes, a benign
 * control is blocked, or a malformed judge output is not blocked.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrief, verifyBrief } from "@second-seat/core";
import { claimsCases, runClaimsCase, CORRUPTIONS, VERDICTS_PATH } from "./claims.mjs";
import {
  BENIGN_BRIEF,
  BENIGN_ENTRY,
  BRIEF_OPERATORS,
  ENTRY_OPERATORS,
  PER_SOURCE,
  REPO_ROOT,
  SEED,
  SUMS_PATH,
  buildSums,
  checkSums,
  generate,
  loadSources,
} from "./mutants.mjs";

/** Wilson 95% score interval for k/n (same as eval/shield.mjs). */
export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (center - half) / denom), Math.min(1, (center + half) / denom)];
}

const fmt = (x) => {
  const t = x.toFixed(3);
  return t === "0.000" ? "0" : t === "1.000" ? "1" : t;
};

/** The escalation each escalate-expected operator is designed to trigger. */
export const EXPECTED_SIGNAL = {
  unaccepted_action: "request_not_accepted",
  speaker_mismatch: "citation_not_found",
  negation_flip: "conflicting_sources",
  number_change: "ungrounded_number",
};

function escKeys(v, entryId) {
  return new Set(v.escalations.filter((e) => entryId === null || e.entryId === entryId).map((e) => `${e.entryId}|${e.reason}`));
}

function flagsOnly(src, brief) {
  try {
    return validateBrief(brief, { segments: src.segments, frames: src.frames });
  } catch {
    return null;
  }
}

/** Score one case against its source's unmutated control. */
export function scoreCase(src, c, controlV, controlFlags) {
  const ctx = { segments: src.segments, frames: src.frames, expectedMeetingId: src.meetingId };
  const v = verifyBrief(ctx, c.brief);
  const blocked = !v.passed;
  const before = escKeys(controlV, c.target);
  const after = escKeys(v, c.target);
  const newEscalations = [...after].filter((k) => !before.has(k)).map((k) => k.split("|")[1]);
  const changed = c.target === null && [...after].some((k) => !before.has(k));
  // Baseline: flags-only (validateBrief alone, what the repo had before the
  // verification layer). It can add flags but never refuses.
  const base = flagsOnly(src, c.brief);
  let baselineFlagged = false;
  if (base !== null && c.target !== null) {
    const was = controlFlags.entries.find((e) => e.id === c.target)?.flags ?? [];
    const now = base.entries.find((e) => e.id === c.target)?.flags ?? [];
    baselineFlagged = now.some((f) => !was.includes(f));
  }
  return {
    id: c.id,
    operator: c.operator,
    expect: c.expect ?? "none",
    blocked,
    newEscalations,
    caught: blocked || newEscalations.length > 0 || changed,
    feedback: v.feedback.slice(0, 3),
    baselineCrashed: base === null,
    baselineFlagged,
  };
}

export function scoreAll(sources = loadSources(), cases = generate(sources)) {
  const bySrc = new Map(sources.map((s) => [s.id, s]));
  const ctl = new Map(
    sources.map((s) => [
      s.id,
      {
        v: verifyBrief({ segments: s.segments, frames: s.frames, expectedMeetingId: s.meetingId }, s.brief),
        flags: validateBrief(s.brief, { segments: s.segments, frames: s.frames }),
      },
    ]),
  );
  const score = (c) => {
    const s = bySrc.get(c.source);
    const k = ctl.get(c.source);
    return scoreCase(s, c, k.v, k.flags);
  };
  const controlEntries = sources.flatMap((s) => s.brief.entries.map((e) => ({ source: s.id, id: e.id })));
  const escalatedControlEntries = sources.flatMap((s) => {
    const ids = new Set(ctl.get(s.id).v.escalations.map((e) => e.entryId));
    return [...ids].map((id) => `${s.id}:${id}`);
  });
  return {
    mutants: cases.mutants.map(score),
    controls: cases.controls.map(score),
    masked: cases.masked,
    controlBriefsBlocked: sources.filter((s) => !ctl.get(s.id).v.passed).map((s) => s.id),
    controlEntries: controlEntries.length,
    escalatedControlEntries,
  };
}

function rate(k, n) {
  const [lo, hi] = wilson(k, n);
  return { k, n, rate: n === 0 ? null : k / n, wilson95: [lo, hi] };
}

export function summarize(scored, claims) {
  const ops = [...ENTRY_OPERATORS.map((o) => o.id), ...BRIEF_OPERATORS.map((o) => o.id)];
  const perOperator = ops.map((op) => {
    const rows = scored.mutants.filter((m) => m.operator === op);
    return {
      operator: op,
      expect: rows[0]?.expect ?? "block",
      ...rate(rows.filter((r) => r.caught).length, rows.length),
      blocked: rows.filter((r) => r.blocked).length,
      viaExpectedSignal:
        EXPECTED_SIGNAL[op] === undefined
          ? null
          : rows.filter((r) => r.newEscalations.some((e) => e.split(":")[0] === EXPECTED_SIGNAL[op])).length,
      baselineFlagged: rows.filter((r) => r.baselineFlagged).length,
      baselineCrashed: rows.filter((r) => r.baselineCrashed).length,
      masked: scored.masked.filter((m) => m.operator === op).length,
    };
  });
  const block = scored.mutants.filter((m) => m.expect === "block");
  const esc = scored.mutants.filter((m) => m.expect === "escalate");
  const gap = scored.mutants.filter((m) => m.expect === "gap");
  const inScope = scored.mutants.filter((m) => m.expect !== "gap");
  const benign = scored.controls;
  const claimRows = claims;
  const malformed = claimRows.filter((c) => c.kind === "malformed");
  const missing = claimRows.filter((c) => c.kind === "missing_verdict");
  const well = claimRows.filter((c) => c.kind === "well_formed");
  const supported = well.filter((c) => c.grade === "supported");
  return {
    seed: SEED,
    perSource: PER_SOURCE,
    rules: {
      allMutants: rate(inScope.filter((m) => m.caught).length, inScope.length),
      blockExpected: rate(block.filter((m) => m.blocked).length, block.length),
      escalateExpected: rate(esc.filter((m) => m.caught).length, esc.length),
      escalateViaExpectedSignal: rate(
        esc.filter((m) => m.newEscalations.some((e) => e.split(":")[0] === EXPECTED_SIGNAL[m.operator])).length,
        esc.length,
      ),
      knownGaps: rate(gap.filter((m) => m.caught).length, gap.length),
      baselineFlagsOnlyAll: rate(inScope.filter((m) => m.baselineFlagged).length, inScope.length),
      baselineFlagsOnlyBlocks: rate(0, block.length),
      benignFalseAlarm: rate(benign.filter((c) => c.caught).length, benign.length),
      benignBlocked: rate(benign.filter((c) => c.blocked).length, benign.length),
      controlBriefsBlocked: scored.controlBriefsBlocked,
      controlEntryEscalationNoise: rate(scored.escalatedControlEntries.length, scored.controlEntries),
      masked: scored.masked.length,
      perOperator,
      misses: inScope.filter((m) => !m.caught).map((m) => m.id),
      gapMisses: gap.filter((m) => !m.caught).map((m) => m.id),
      benignHits: benign.filter((c) => c.caught).map((c) => c.id),
    },
    claims: {
      malformedFailClosed: rate(malformed.filter((c) => c.failClosedBlocked).length, malformed.length),
      malformedFailOpen: rate(malformed.filter((c) => c.failOpenBlocked).length, malformed.length),
      missingFailClosed: rate(missing.filter((c) => c.failClosedBlocked).length, missing.length),
      missingFailOpen: rate(missing.filter((c) => c.failOpenBlocked).length, missing.length),
      wellFormedAgreement: rate(well.filter((c) => c.failClosedBlocked === (c.grade !== "supported")).length, well.length),
      supportedFalseAlarm: rate(supported.filter((c) => c.failClosedBlocked).length, supported.length),
      perCorruption: [...CORRUPTIONS.map((c) => c.id), "missing_verdict"].map((id) => {
        const rows = claimRows.filter((c) => c.corruption === id);
        return {
          corruption: id,
          n: rows.length,
          failClosed: rows.filter((r) => r.failClosedBlocked).length,
          failOpen: rows.filter((r) => r.failOpenBlocked).length,
        };
      }),
    },
  };
}

function row(label, r) {
  return `| ${label} | ${r.n} | ${r.k} | ${r.rate === null ? "—" : fmt(r.rate)} | [${fmt(r.wilson95[0])}, ${fmt(r.wilson95[1])}] |`;
}

export function renderTable(s) {
  const r = s.rules;
  const c = s.claims;
  const out = [];
  out.push("# Brief rules + claims check: seeded-mutant table");
  out.push("");
  out.push(
    `Generated by \`node eval/rules/run.mjs --write\` (seed ${s.seed}, up to ${s.perSource} targets per source and operator). ` +
      "$0: no model calls. Sources (read-only): the recorded Spark briefs for hero and dev01-03 with their transcripts; " +
      `claims verdicts from \`${VERDICTS_PATH}\`. Inputs and the generated set are pinned in \`eval/rules/SHA256SUMS\`.`,
  );
  out.push("");
  out.push("A mutant is **caught** if `verifyBrief` blocks it, or if the mutated entry gains an escalation it did not carry in the unmutated control. Baseline = flags-only (`validateBrief` alone, the pre-verification behaviour): it can add flags but never refuses.");
  out.push("");
  out.push("## Brief rules (`verifyBrief`)");
  out.push("");
  out.push("| group | n | caught | rate | Wilson 95% CI |");
  out.push("|---|---|---|---|---|");
  out.push(row("all in-scope mutants", r.allMutants));
  out.push(row("block-expected mutants, blocked", r.blockExpected));
  out.push(row("escalate-expected mutants, caught", r.escalateExpected));
  out.push(row("escalate-expected, caught by the designed signal", r.escalateViaExpectedSignal));
  out.push(row("known-gap mutants (semantic; no rule targets them), caught", r.knownGaps));
  out.push(row("baseline flags-only, all mutants (flag added)", r.baselineFlagsOnlyAll));
  out.push(row("baseline flags-only, block-expected (refused)", r.baselineFlagsOnlyBlocks));
  out.push(row("benign controls, false alarm (blocked or new escalation)", r.benignFalseAlarm));
  out.push(row("benign controls, blocked", r.benignBlocked));
  out.push(row("unmutated control entries already escalated (noise)", r.controlEntryEscalationNoise));
  out.push("");
  out.push("| operator | expect | n | caught | blocked | via designed signal | rate | Wilson 95% CI | baseline flagged | baseline crashed | masked (excluded) |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const o of r.perOperator) {
    out.push(
      `| ${o.operator} | ${o.expect} | ${o.n} | ${o.k} | ${o.blocked} | ${o.viaExpectedSignal ?? "—"} | ${o.rate === null ? "—" : fmt(o.rate)} | [${fmt(o.wilson95[0])}, ${fmt(o.wilson95[1])}] | ${o.baselineFlagged} | ${o.baselineCrashed} | ${o.masked} |`,
    );
  }
  out.push("");
  out.push(`Unmutated control briefs blocked: ${r.controlBriefsBlocked.length === 0 ? "none (0/4)" : r.controlBriefsBlocked.join(", ")}.`);
  out.push("");
  out.push(`Misses (${r.misses.length}): ${r.misses.length === 0 ? "(none)" : r.misses.map((m) => `\`${m}\``).join(", ")}`);
  out.push("");
  out.push(
    `Known-gap misses (${r.gapMisses.length}): ${r.gapMisses.length === 0 ? "(none)" : r.gapMisses.map((m) => `\`${m}\``).join(", ")}. ` +
      "A swapped assignee or a decision relabelled as an open question is invisible to the deterministic rules; only the support judge (or the owner) can catch it.",
  );
  out.push("");
  out.push(`Benign false alarms (${r.benignHits.length}): ${r.benignHits.length === 0 ? "(none)" : r.benignHits.map((m) => `\`${m}\``).join(", ")}`);
  out.push("");
  out.push(
    `"Masked" = ${r.masked} candidate targets skipped because the unmutated entry already carries the signal the mutant would add ` +
      "(e.g. `conflicting_sources` on an entry whose cited segments already disagree in polarity), so a catch could not be told apart from the control. They are listed in `rules-score.json`, not counted as catches.",
  );
  out.push("");
  out.push("## Claims check: fail-closed vs fail-open");
  out.push("");
  out.push(
    "Every recorded support verdict is fed in well-formed, under each corruption, and missing. " +
      "**Fail-closed** = `verifyClaims` (`@second-seat/core`). **Fail-open** = a reference model of the behaviour documented at " +
      "Meta legal-agent-workshop `agent/verification/verify_claims.py` L50-54 (commit 2a8efc8): an unreadable judgement does not block. " +
      "It still blocks when it can read a `partial`/`unsupported` grade.",
  );
  out.push("");
  out.push("| group | n | blocked | rate | Wilson 95% CI |");
  out.push("|---|---|---|---|---|");
  out.push(row("malformed judge output, fail-closed", c.malformedFailClosed));
  out.push(row("malformed judge output, fail-open reference", c.malformedFailOpen));
  out.push(row("missing verdict, fail-closed", c.missingFailClosed));
  out.push(row("missing verdict, fail-open reference", c.missingFailOpen));
  out.push(row("well-formed: verdict agrees with grade (fail-closed)", c.wellFormedAgreement));
  out.push(row("well-formed supported, false alarm (fail-closed)", c.supportedFalseAlarm));
  out.push("");
  out.push("| corruption | n | fail-closed blocked | fail-open blocked |");
  out.push("|---|---|---|---|");
  for (const p of c.perCorruption) out.push(`| ${p.corruption} | ${p.n} | ${p.failClosed} | ${p.failOpen} |`);
  out.push("");
  out.push("## Attribution");
  out.push("");
  out.push(
    "Measuring a verification layer with seeded mutants, and the fail-open contrast, are adapted from Meta's " +
      "[legal-agent-workshop](https://github.com/meta-models/legal-agent-workshop) (Session 2). That repo has no LICENSE, " +
      "so no code or text is copied; generator, corpus and scorer are independent implementations.",
  );
  out.push("");
  return out.join("\n");
}

/** Pass/fail gate for CI-style use. Returns a list of problems. */
export function gateProblems(s, sumsProblems) {
  const p = [...sumsProblems.map((x) => `SHA256SUMS: ${x}`)];
  if (s.rules.blockExpected.k !== s.rules.blockExpected.n) p.push("a block-expected mutant was not blocked");
  if (s.rules.benignBlocked.k !== 0) p.push("a benign control was blocked");
  if (s.rules.controlBriefsBlocked.length > 0) p.push("an unmutated control brief was blocked");
  if (s.claims.malformedFailClosed.k !== s.claims.malformedFailClosed.n) p.push("a malformed judge output was not blocked");
  if (s.claims.missingFailClosed.k !== s.claims.missingFailClosed.n) p.push("a missing verdict was not blocked");
  if (s.claims.supportedFalseAlarm.k !== 0) p.push("a well-formed supported verdict was blocked");
  return p;
}

function main(argv) {
  const sources = loadSources();
  const cases = generate(sources);
  if (argv.includes("--pin")) {
    writeFileSync(join(REPO_ROOT, SUMS_PATH), buildSums(sources, cases));
    console.log(`pinned ${SUMS_PATH}`);
  }
  const sums = checkSums(sources, cases);
  const scored = scoreAll(sources, cases);
  const claims = claimsCases().map(runClaimsCase);
  const s = summarize(scored, claims);
  const table = renderTable(s);
  if (argv.includes("--write")) {
    const detail = {
      ...s,
      mutants: scored.mutants,
      controls: scored.controls,
      masked: scored.masked,
      claimsCases: claims.map(({ verdicts, ...rest }) => rest),
    };
    writeFileSync(join(REPO_ROOT, "eval", "results", "rules-score.json"), `${JSON.stringify(detail, null, 2)}\n`);
    writeFileSync(join(REPO_ROOT, "eval", "results", "rules-table.md"), table);
  }
  console.log(table);
  const problems = gateProblems(s, sums);
  for (const x of problems) console.error(`FAIL ${x}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
