// pw-cases.mjs: summarize a Playwright JSON report, one line per test.
// Usage: node scripts/ci/pw-cases.mjs <report.json>
// (The report path is argv[2].) Prints `PASS <title>` or
// `FAIL <title>: <first line of error>` per test, where <title> is the
// test's own title. Exit code is always 0.
import { readFileSync } from "node:fs";

function firstErrorLine(spec) {
  const tests = Array.isArray(spec.tests) ? spec.tests : [];
  for (const t of tests) {
    const results = Array.isArray(t.results) ? t.results : [];
    for (const r of results) {
      const err = r.error;
      if (err && typeof err.message === "string" && err.message.length > 0) {
        return err.message.split("\n")[0];
      }
    }
  }
  return "unknown error";
}

function walkSuites(suites, out) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const title = spec.title ?? "(untitled)";
      if (spec.ok) out.push(`PASS ${title}`);
      else out.push(`FAIL ${title}: ${firstErrorLine(spec)}`);
    }
    walkSuites(suite.suites, out);
  }
}

const path = process.argv[2];
const out = [];
if (path) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    walkSuites(report.suites, out);
  } catch (err) {
    out.push(`FAIL (unreadable report): ${String(err).split("\n")[0]}`);
  }
}
for (const line of out) console.log(line);
process.exit(0);
