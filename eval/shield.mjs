/**
 * Shield red-team harness (Phase 04b). tsx-free: plain node importing the
 * built @second-seat/core dist. No model calls.
 *
 * Dev set:   eval/shield/dev-40-55.jsonl (+ recorded Spark labels in
 *            eval/shield/spark-dev.recorded.json). Prints N/M per layer
 *            (pattern / Spark / gate).
 * Held-out:  read ONLY from $SHIELD_HELDOUT_FILE after its sha256 matches
 *            eval/shield-heldout.sha256. Never prints held-out text except
 *            missed lines. Reports per-tactic catch + false-alarm with n
 *            and Wilson 95% CIs, misses listed, gate row
 *            "0 approvals by construction".
 * Flags: --no-classifier (pattern+Spark layers off), --no-gate.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const core = await import(
  resolve(here, "..", "packages", "core", "dist", "src", "index.js")
);
const { applyPressure, detectPressurePatterns, gateApproval } = core;

const TACTICS = ["authority", "commitment", "liking", "reciprocity", "scarcity", "social_proof", "unity"];

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function expectedTactics(row) {
  const raw = row.expectedTactic;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t) => t !== "none" && t !== undefined && t !== null);
}

function isPositive(row) {
  if (row.pressure === true) return true;
  if (row.pressure === false && (row.expectedTactic === "none" || row.expectedTactic === undefined)) return false;
  return expectedTactics(row).length > 0;
}

function loadSparkLabels(recordedPath) {
  if (recordedPath === null || recordedPath === undefined || recordedPath === "") return { labels: [], live: false };
  let raw;
  try {
    raw = readFileSync(recordedPath, "utf8");
  } catch {
    return { labels: [], live: false, missing: true };
  }
  const recorded = JSON.parse(raw);
  const parsed = JSON.parse(recorded.rawText);
  return { labels: Array.isArray(parsed.labels) ? parsed.labels : [], live: recorded.recordedFromLiveCall === true };
}

/** Wilson 95% score interval for k/n. Returns [lo, hi]. */
function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, (center - half) / denom),
    Math.min(1, (center + half) / denom),
  ];
}

const fmt = (x) => x.toFixed(2);

function checkHeldoutHash(file) {
  const seal = readFileSync(join(here, "shield-heldout.sha256"), "utf8");
  const match = seal.match(/[0-9a-f]{64}/);
  if (match === null) {
    console.error("held-out seal has no sha256; refusing");
    process.exit(2);
  }
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (digest !== match[0]) {
    console.error(`held-out sha256 mismatch; refusing (got ${digest})`);
    process.exit(2);
  }
}

/**
 * Run the full shield pipeline over rows. Each row gets segmentId seg-<i>.
 * Returns per-row {row, segId, patternLabels, sparkLabels, held, badged, ownerReview}.
 */
function runPipeline(rows, sparkLabels, opts) {
  const bySeg = new Map();
  const inputs = rows.map((row, i) => ({ segId: `seg-${i}`, row }));
  for (const { segId } of inputs) bySeg.set(segId, []);
  if (!opts.noClassifier) {
    for (const { segId, row } of inputs) {
      for (const label of detectPressurePatterns(row.text, segId)) bySeg.get(segId).push(label);
    }
    for (const label of sparkLabels) {
      if (label.tactic !== "none" && bySeg.has(label.segmentId)) {
        bySeg.get(label.segmentId).push({ ...label, source: "spark" });
      }
    }
  }
  return inputs.map(({ segId, row }) => {
    const brief = {
      meetingId: "shield-eval",
      model: "eval",
      promptVersion: "eval",
      settings: { fixtureMode: true, maxCostUsdPerDay: null },
      entries: [
        {
          id: `e-${segId}`,
          category: "action_item",
          text: row.text,
          citations: [{ kind: "segment", segmentId: segId, frameId: null, region: null }],
          requester: null,
          assignee: null,
          acceptance: null,
          speaker: null,
          flags: [],
        },
      ],
      flagged: [],
      createdAt: new Date(0).toISOString(),
    };
    const labels = bySeg.get(segId).map((l) => ({ ...l, segmentId: segId }));
    const result = applyPressure({ brief, segments: [{ id: segId, text: row.text }] }, labels, {
      gate: !opts.noGate,
    });
    const verifiedCount = result.labels.filter((l) => l.verified).length;
    const held = !opts.noGate && gateApproval(row.text).held;
    const badged = verifiedCount > 0;
    return {
      row,
      segId,
      held,
      badged,
      ownerReview: badged || held,
      approvalsHeld: result.approvalsHeld,
    };
  });
}

function segIdOf(label, inputs) {
  const found = inputs.find(({ segId }) => segId === label.segmentId);
  return found === undefined ? label.segmentId : found.segId;
}

function printDevReport(results, sparkLive) {
  const positives = results.filter((r) => isPositive(r.row));
  const approvals = results.filter((r) => r.row.approval === true);
  const patternHit = positives.filter((r) => patternCovers(r));
  const sparkHit = positives.filter((r) => sparkCovers(r));
  const gateHeld = approvals.filter((r) => r.held);
  console.log(`dev: pattern ${patternHit.length}/${positives.length} pressure lines flagged (tactic match)`);
  console.log(
    `dev: spark ${sparkHit.length}/${positives.length} pressure lines flagged` +
      (sparkLive ? "" : " (placeholder recording, not a live call)"),
  );
  console.log(`dev: gate ${gateHeld.length}/${approvals.length} approval lines held`);
  const misses = results.filter((r) => (isPositive(r.row) || r.row.approval === true) && !r.ownerReview);
  if (misses.length > 0) {
    console.log("dev misses (no owner_review):");
    for (const m of misses) console.log(`  id=${m.row.id} text=${m.row.text}`);
  } else {
    console.log("dev misses: none");
  }
  const falseBadges = results.filter((r) => !isPositive(r.row) && r.row.approval !== true && r.ownerReview);
  console.log(`dev: false badges on neutral controls: ${falseBadges.length}`);
}

function patternCovers(r) {
  const labels = detectPressurePatterns(r.row.text);
  const expected = expectedTactics(r.row);
  return expected.length > 0 && expected.every((t) => labels.some((l) => l.tactic === t));
}

let SPARK_BY_SEG = new Map();
function sparkCovers(r) {
  const labels = SPARK_BY_SEG.get(r.segId) ?? [];
  const expected = expectedTactics(r.row);
  return expected.length > 0 && expected.every((t) => labels.some((l) => l.tactic === t));
}

function printHeldoutReport(results) {
  const positives = results.filter((r) => isPositive(r.row));
  const negatives = results.filter((r) => !isPositive(r.row));
  console.log(`held-out: ${positives.length} pressure lines, ${negatives.length} negative controls`);
  for (const tactic of TACTICS) {
    const denom = positives.filter((r) => expectedTactics(r.row).includes(tactic));
    const caught = denom.filter((r) => r.badged).length;
    const [lo, hi] = wilson(caught, denom.length);
    console.log(
      `held-out catch ${tactic}: ${caught}/${denom.length} n=${denom.length} Wilson95 [${fmt(lo)}, ${fmt(hi)}]`,
    );
  }
  for (const tactic of TACTICS) {
    const flagged = negatives.filter((r) =>
      detectPressurePatterns(r.row.text).some((l) => l.tactic === tactic),
    ).length;
    const [lo, hi] = wilson(flagged, negatives.length);
    console.log(
      `held-out false-alarm ${tactic}: ${flagged}/${negatives.length} n=${negatives.length} Wilson95 [${fmt(lo)}, ${fmt(hi)}]`,
    );
  }
  const misses = positives.filter((r) => !r.badged && !r.held);
  console.log(`held-out misses (${misses.length}):`);
  for (const m of misses) console.log(`  id=${m.row.id} text=${m.row.text}`);
  const alarmIds = negatives.filter((r) => r.badged || r.held).map((r) => String(r.row.id));
  console.log(`held-out false-alarm ids: ${alarmIds.length === 0 ? "none" : alarmIds.join(",")}`);
  const heldApprovals = results.filter((r) => r.held).length;
  console.log(`gate: 0 approvals by construction (held ${heldApprovals}/${results.length} lines)`);
}

async function main() {
  const args = process.argv.slice(2);
  const opts = { noClassifier: args.includes("--no-classifier"), noGate: args.includes("--no-gate") };
  console.log(`shield harness${opts.noClassifier ? " --no-classifier" : ""}${opts.noGate ? " --no-gate" : ""}`);

  const devRows = readJsonl(join(here, "shield", "dev-40-55.jsonl"));
  const devSpark = loadSparkLabels(join(here, "shield", "spark-dev.recorded.json"));
  if (devSpark.missing) console.log("dev: no spark recording found");
  const devResults = runPipeline(devRows, opts.noClassifier ? [] : devSpark.labels, opts);
  SPARK_BY_SEG = new Map();
  devResults.forEach((r, i) => SPARK_BY_SEG.set(`seg-${i}`, []));
  if (!opts.noClassifier) {
    for (const label of devSpark.labels) {
      if (SPARK_BY_SEG.has(label.segmentId)) SPARK_BY_SEG.get(label.segmentId).push(label);
    }
  }
  printDevReport(devResults, devSpark.live);

  const heldoutFile = process.env["SHIELD_HELDOUT_FILE"];
  if (heldoutFile !== undefined && heldoutFile !== "") {
    checkHeldoutHash(heldoutFile);
    const heldoutRows = readJsonl(heldoutFile);
    const sparkPath = process.env["SHIELD_HELDOUT_SPARK"] ?? "";
    const heldoutSpark = loadSparkLabels(sparkPath === "" ? null : sparkPath);
    const heldoutResults = runPipeline(heldoutRows, opts.noClassifier ? [] : heldoutSpark.labels, opts);
    printHeldoutReport(heldoutResults);
  } else {
    console.log("held-out: skipped (SHIELD_HELDOUT_FILE unset)");
  }
}

await main();
