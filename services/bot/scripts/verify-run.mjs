// verify-run: run the fail-closed verification layer over one recorded run,
// offline. Second Seat's take on the `./helper verify RUN --memo` step in
// Meta's legal-agent-workshop (Agents 102, agent/VERIFICATION.md, 2a8efc8;
// pattern only, no code copied; see VERIFICATION.md).
//
// Usage:
//   node scripts/verify-run.mjs --input <dir with transcript.txt [frames.txt]>
//        --brief <recorded brief .json>
//        --redacted <approved masked text> --spans <span JSON array>
//        [--meeting-id <id>]
//        (--claims <entryId -> raw judge output .json> | --skip-claims)
//        [--out <dir>]
//
// Checks, in pipeline order: verifyRedaction on the supplied approved
// text and spans (not a fresh mock redaction), verifyBrief, verifyClaims.
// A missing redaction artifact is a block. Writes
// <out>/verification.json. Exit 0 = every check ran and passed; 1 = a check
// blocked or claims were not run; 2 = usage or refused path.
// Never calls a model or the network (fetch is replaced by a throwing guard),
// and refuses any heldout/holdout/sealed path. Feedback never echoes PII.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFramesSidecar,
  parseTranscript,
  resolveFrames,
  verifyBrief,
  verifyClaims,
  verifyRedaction,
} from "@second-seat/core";
import { findResidualPII } from "../dist/src/private/gate.js";

let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount += 1;
  throw new Error("verify-run: network forbidden (fetch called)");
};
export function fetchCalls() {
  return fetchCount;
}

const FORBIDDEN_PATH = /heldout|holdout|sealed/i;

export class VerifyRunUsageError extends Error {}

function guardPath(label, p) {
  if (typeof p !== "string" || p === "") throw new VerifyRunUsageError(`${label}: path required`);
  if (FORBIDDEN_PATH.test(resolve(p))) throw new VerifyRunUsageError(`${label}: refusing heldout/holdout/sealed path`);
  return resolve(p);
}

export function parseArgs(argv) {
  const opts = { skipClaims: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new VerifyRunUsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--input") opts.input = next();
    else if (a === "--brief") opts.brief = next();
    else if (a === "--claims") opts.claims = next();
    else if (a === "--out") opts.out = next();
    else if (a === "--meeting-id") opts.meetingId = next();
    else if (a === "--redacted") opts.redacted = next();
    else if (a === "--spans") opts.spans = next();
    else if (a === "--skip-claims") opts.skipClaims = true;
    else throw new VerifyRunUsageError(`unknown argument ${a}`);
  }
  if (opts.claims !== undefined && opts.skipClaims) throw new VerifyRunUsageError("--claims and --skip-claims are exclusive");
  return opts;
}

/** Approved redaction from --redacted/--spans or the in-process fields.
 * Missing or unreadable input blocks. It never re-redacts the transcript. */
function loadSuppliedRedaction(rawOpts) {
  const missing = "redaction: approved redacted text or spans were not supplied: blocked (fail-closed)";
  let redactedText = rawOpts.redactedText;
  let spans = rawOpts.spans;
  if (typeof rawOpts.redacted === "string") {
    redactedText = readFileSync(guardPath("--redacted", rawOpts.redacted), "utf8");
  }
  if (typeof rawOpts.spans === "string") {
    try {
      spans = JSON.parse(readFileSync(guardPath("--spans", rawOpts.spans), "utf8"));
    } catch {
      return { ok: false, feedback: "redaction: spans file unreadable: blocked (fail-closed)" };
    }
  }
  if (typeof redactedText !== "string" || !Array.isArray(spans)) {
    return { ok: false, feedback: missing };
  }
  return { ok: true, redactedText, spans };
}

/** A recorded brief file holds { rawText } (the model's JSON text) or the brief itself. */
function loadBrief(path) {
  const outer = JSON.parse(readFileSync(path, "utf8"));
  if (outer !== null && typeof outer === "object" && typeof outer.rawText === "string") {
    try {
      return JSON.parse(outer.rawText);
    } catch {
      return outer.rawText; // verifyBrief blocks it as malformed structure
    }
  }
  return outer;
}

export async function verifyRun(rawOpts) {
  const input = guardPath("--input", rawOpts.input);
  const briefPath = guardPath("--brief", rawOpts.brief);
  const claimsPath = rawOpts.claims === undefined ? undefined : guardPath("--claims", rawOpts.claims);
  const outDir = rawOpts.out === undefined ? undefined : guardPath("--out", rawOpts.out);

  const transcript = readFileSync(join(input, "transcript.txt"), "utf8");
  const framesPath = join(input, "frames.txt");
  const sidecar = existsSync(framesPath) ? readFileSync(framesPath, "utf8") : "";
  const segments = parseTranscript(transcript);
  const frames =
    sidecar.trim() === ""
      ? []
      : resolveFrames({ files: parseFramesSidecar(sidecar).map((r) => r.file), sidecarText: sidecar });

  // 1. Redaction of the approved preview. Missing input is a block:
  // the script does not invent a redaction with MockRedactor.
  const supplied = loadSuppliedRedaction(rawOpts);
  const redaction = supplied.ok
    ? verifyRedaction(
        { rawText: transcript, spans: supplied.spans, residualScan: findResidualPII },
        { maskedText: supplied.redactedText },
      )
    : {
        passed: false,
        feedback: [supplied.feedback],
        ownerReviewRequired: true,
      };
  const spanCount = supplied.ok ? supplied.spans.length : 0;

  // 2. Brief.
  const work = loadBrief(briefPath);
  const brief = verifyBrief(
    {
      segments,
      frames,
      ...(rawOpts.meetingId === undefined ? {} : { expectedMeetingId: rawOpts.meetingId }),
    },
    work,
  );
  const entryIds = brief.verified === null ? [] : brief.verified.entries.map((e) => e.id);

  // 3. Claims (fail-closed: not supplying judge output is not a pass).
  let claims;
  if (claimsPath !== undefined) {
    let verdicts;
    try {
      verdicts = JSON.parse(readFileSync(claimsPath, "utf8"));
    } catch {
      verdicts = null;
    }
    claims = { status: "ran", ...verifyClaims({ entryIds }, { verdicts }) };
  } else {
    claims = {
      status: rawOpts.skipClaims ? "skipped" : "not_run",
      passed: false,
      feedback: [
        rawOpts.skipClaims
          ? "claims: skipped by operator (--skip-claims): run is not verified"
          : "claims: no judge output supplied: blocked (fail-closed)",
      ],
    };
  }

  const report = {
    tool: "verify-run",
    passed: redaction.passed && brief.passed && claims.passed,
    complete: claims.status === "ran",
    checks: {
      redaction: { passed: redaction.passed, feedback: redaction.feedback, spans: spanCount, ownerReviewRequired: true },
      brief: { passed: brief.passed, feedback: brief.feedback, entries: entryIds.length, escalations: brief.escalations },
      claims,
    },
    networkCalls: fetchCount,
  };
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function main() {
  let report;
  try {
    report = await verifyRun(parseArgs(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof VerifyRunUsageError) {
      process.stderr.write(`verify-run: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  for (const [name, check] of Object.entries(report.checks)) {
    process.stdout.write(`${check.passed ? "PASS" : "BLOCK"} ${name}\n`);
    for (const line of check.feedback) process.stdout.write(`  - ${line}\n`);
  }
  process.stdout.write(`escalated entries: ${new Set(report.checks.brief.escalations.map((e) => e.entryId)).size}\n`);
  process.stdout.write(`${report.passed ? "VERIFIED" : "NOT VERIFIED"}\n`);
  process.exit(report.passed ? 0 : 1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
