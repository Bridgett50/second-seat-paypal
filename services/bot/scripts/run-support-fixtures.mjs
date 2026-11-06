#!/usr/bin/env node
/**
 * Run the support judge over eval/fixtures/support-cases.json and write
 * raw judge outputs as JSONL (proof artifact).
 *
 * Usage: node scripts/run-support-fixtures.mjs [--fixture <path>] [--judge-output <path>]
 *   --judge-output <path>  where to write the JSONL (default: eval/results/support-judgments.jsonl)
 *   --baseline             judge disabled: every case graded `supported`
 *
 * Requires `pnpm --filter @second-seat/bot build` first (imports dist/).
 * No live calls unless SUPPORT_JUDGE_MODE=live with META_API_KEY set.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = resolve(here, "..");
const repoRoot = resolve(botDir, "..", "..");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}
const baseline = args.includes("--baseline");
const fixturePath = flag("--fixture") ?? join(botDir, "fixtures", "support-judge-v1.json");
const outPath =
  flag("--judge-output") ?? join(repoRoot, "eval", "results", "support-judgments.jsonl");
const casesPath = flag("--cases") ?? join(repoRoot, "eval", "fixtures", "support-cases.json");

const { defaultSupportJudge, baselineGrade } = await import(
  join(botDir, "dist", "src", "judge", "support.js")
);

const cases = JSON.parse(readFileSync(casesPath, "utf8")).cases;
if (!baseline && (process.env["SUPPORT_JUDGE_MODE"] ?? "fixture") === "live") {
  throw new Error(
    "run-support-fixtures refuses live mode: model calls must go through the server-side privacy gate (services/bot/src/private/gate.ts)",
  );
}
const judge = baseline ? null : defaultSupportJudge(fixturePath);

const lines = [];
for (const c of cases) {
  const input = { entryId: c.id, entryText: c.entryText, citedSpans: c.citedSpans };
  const verdict = baseline ? baselineGrade(input) : await judge.gradeSupport(input);
  lines.push(
    JSON.stringify({
      entryId: verdict.entryId,
      grade: verdict.grade,
      missingQualifier: verdict.missingQualifier,
      overlap: verdict.overlap,
      model: verdict.model,
      promptVersion: verdict.promptVersion,
      fixture: verdict.fixture,
      usage: verdict.usage,
    }),
  );
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`wrote ${lines.length} judge outputs (${baseline ? "baseline" : (process.env.SUPPORT_JUDGE_MODE === "live" ? "live" : "fixture")}) to ${outPath}`);
