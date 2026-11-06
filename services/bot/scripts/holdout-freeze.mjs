// Holdout freeze check: verifies an explicit dataset dir against MANIFEST.json.
// Offline only: reads local files, never touches the network or any model.
// A path is safe only if it is a non-empty relative POSIX path, not absolute,
// contains no backslash, no NUL, and no `..` or `.` segment, and resolve(dir, p)
// stays inside resolve(dir). Unsafe manifest keys and unsafe case file paths
// are reported as failures and are NEVER opened (checked before any read).
// Every problem is collected (manifest status checks, every hash mismatch,
// missing files, unpinned files, cases.json read/parse error, case file
// problems, annotations) and all are printed, then `FAIL (n problem(s))`,
// exit 1. An unreadable MANIFEST.json is still exit 1, but the remaining
// independent checks that do not need the manifest (cases.json parse and the
// case file/annotation checks) still run and are reported.
// Exit 0 when every hash matches and every annotation occurs verbatim;
// exit 2 when --dir is missing.
//
// Usage: node scripts/holdout-freeze.mjs --dir <dataset-dir>
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, posix, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
}

const dir = flagValue("--dir");
if (dir === undefined || dir === "") {
  console.error("holdout-freeze: missing required --dir <dataset-dir>");
  process.exit(2);
}
const failures = [];
const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// A path is safe only if it is a non-empty relative POSIX path, not absolute,
// with no backslash, no NUL, and no `..` or `.` segment, and resolve(dir, p)
// stays inside resolve(dir). Checked before any read; unsafe paths are never opened.
function isSafePath(p) {
  if (typeof p !== "string") return false;
  if (p.length === 0) return false;
  if (p.includes("\0") || p.includes("\\")) return false;
  if (isAbsolute(p) || posix.isAbsolute(p)) return false;
  if (/^[A-Za-z]:(\/|$)/.test(p)) return false;
  for (const seg of p.split("/")) {
    if (seg === ".." || seg === ".") return false;
  }
  const base = resolve(dir);
  const target = resolve(dir, p);
  return target === base || target.startsWith(base + sep);
}

let manifest;
let manifestOk = false;
try {
  manifest = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
  manifestOk = true;
} catch (err) {
  failures.push(`cannot read MANIFEST.json: ${err.message}`);
}

if (manifestOk) {
  if (manifest.inference_runs !== 0) {
    failures.push(`MANIFEST inference_runs is ${JSON.stringify(manifest.inference_runs)}, expected 0`);
  }
  if (manifest?.review?.status !== "pending-manual-review") {
    failures.push(`MANIFEST review.status is ${JSON.stringify(manifest?.review?.status)}, expected "pending-manual-review"`);
  }
}

const files = manifestOk && manifest.files != null && typeof manifest.files === "object" ? manifest.files : {};
if (manifestOk) {
  for (const [file, want] of Object.entries(files)) {
    if (!isSafePath(file)) {
      failures.push(`unsafe path in manifest: ${JSON.stringify(file)}`);
      continue;
    }
    let text;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch (err) {
      failures.push(`missing file ${file}: ${err.message}`);
      continue;
    }
    const got = sha256Hex(text);
    if (got !== want) failures.push(`hash mismatch ${file}: manifest ${want}, actual ${got}`);
  }

  // Every file on disk (other than MANIFEST.json) must be pinned in the manifest.
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === "MANIFEST.json") continue;
      if (!(entry in files)) failures.push(`unpinned file on disk: ${entry}`);
    }
  } catch (err) {
    failures.push(`cannot list directory: ${err.message}`);
  }
}

let cases;
let casesOk = false;
try {
  cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
  if (!Array.isArray(cases)) {
    failures.push(`cannot read cases.json: expected an array, got ${typeof cases}`);
  } else {
    casesOk = true;
  }
} catch (err) {
  failures.push(`cannot read cases.json: ${err.message}`);
}
if (casesOk) {
  for (const c of cases) {
    if (!isSafePath(c?.file)) {
      failures.push(`unsafe case file path: ${JSON.stringify(c?.file)}`);
      continue;
    }
    let text;
    try {
      text = readFileSync(join(dir, c.file), "utf8");
    } catch (err) {
      failures.push(`missing case file ${c.file}: ${err.message}`);
      continue;
    }
    for (const e of [...(c.entities ?? []), ...(c.names ?? [])]) {
      if (!text.includes(e)) failures.push(`annotation not verbatim in ${c.file}: ${JSON.stringify(e)}`);
    }
  }
}

const annotationCount = casesOk
  ? cases.reduce((n, c) => n + (c.entities ?? []).length + (c.names ?? []).length, 0)
  : 0;
if (failures.length > 0) {
  for (const f of failures) console.error(`holdout-freeze: ${f}`);
  console.error(`holdout-freeze: FAIL (${failures.length} problem(s))`);
  process.exit(1);
}
console.log(
  `holdout-freeze: OK (${Object.keys(files).length} pinned files, ` +
    `${casesOk ? cases.length : 0} cases, ${annotationCount} annotations verbatim)`,
);
