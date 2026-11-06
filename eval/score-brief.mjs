/**
 * Score a brief against truth labels by shared cited segmentIds.
 * No model calls, no network. Never reads held-out data: any path
 * containing "heldout" is refused.
 *
 * Usage: node score-brief.mjs <brief.json> <labels.json>
 *
 * A truth entry is matched if some brief entry shares >= 1 cited
 * segmentId (category may differ; category agreement is reported
 * separately). All numbers printed are computed from the two files.
 */
import { readFileSync, writeFileSync } from "node:fs";

const rawArgs = process.argv.slice(2);
let jsonOutPath = null;
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--json") {
    const next = rawArgs[i + 1];
    if (next === undefined) {
      console.error("usage: node score-brief.mjs <brief.json> <labels.json> [--json <outPath>]");
      process.exit(2);
    }
    jsonOutPath = next;
    i++;
  } else {
    positional.push(rawArgs[i]);
  }
}
const [briefPath, labelsPath] = positional;
if (briefPath === undefined || labelsPath === undefined) {
  console.error("usage: node score-brief.mjs <brief.json> <labels.json> [--json <outPath>]");
  process.exit(2);
}

for (const candidate of [briefPath, labelsPath, ...(jsonOutPath ? [jsonOutPath] : [])]) {
  if (candidate.includes("heldout")) {
    console.error(`refusing path containing "heldout": ${candidate}`);
    process.exit(2);
  }
}

function loadEntries(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`cannot parse ${path}: ${(error).message}`);
    process.exit(2);
  }
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) {
    console.error(`no entries array in ${path}`);
    process.exit(2);
  }
  return entries;
}

function segmentIds(entry) {
  const ids = new Set();
  for (const citation of entry.citations ?? []) {
    if (citation !== null && typeof citation === "object" && citation.segmentId != null) {
      ids.add(citation.segmentId);
    }
  }
  return ids;
}

function isClean(entry) {
  const flags = entry.flags ?? [];
  return !flags.includes("citation_not_found") && !flags.includes("missing_source");
}

const briefEntries = loadEntries(briefPath);
const truthEntries = loadEntries(labelsPath);

const briefSegments = briefEntries.map((entry) => segmentIds(entry));
const matchedBriefIndexes = new Set();

// Per truth entry: indexes of brief entries sharing >= 1 segmentId.
const matches = truthEntries.map((truthEntry) => {
  const truthIds = segmentIds(truthEntry);
  const hits = [];
  briefSegments.forEach((briefIds, index) => {
    for (const id of truthIds) {
      if (briefIds.has(id)) {
        hits.push(index);
        matchedBriefIndexes.add(index);
        break;
      }
    }
  });
  return hits;
});

const matchedCount = matches.filter((hits) => hits.length > 0).length;
const agreeCount = truthEntries.filter((truthEntry, i) => {
  if (matches[i].length === 0) return false;
  return matches[i].some((index) => briefEntries[index].category === truthEntry.category);
}).length;
const cleanCount = briefEntries.filter(isClean).length;

const unmatchedTruthIds = truthEntries.filter((_, i) => matches[i].length === 0).map((entry) => entry.id ?? "(missing id)");
const unmatchedBriefIds = briefEntries
  .filter((_, index) => !matchedBriefIndexes.has(index))
  .map((entry) => entry.id ?? "(missing id)");

console.log(`brief entries: ${briefEntries.length}`);
console.log(`truth entries: ${truthEntries.length}`);
console.log(
  `citations_resolved (no citation_not_found and no missing_source): ${cleanCount}/${briefEntries.length}`,
);
console.log(`truth_entry_match (matched/total): ${matchedCount}/${truthEntries.length}`);
console.log(`category agreement among matched: ${agreeCount}/${matchedCount}`);
console.log(`unmatched truth ids: ${unmatchedTruthIds.length > 0 ? unmatchedTruthIds.join(", ") : "(none)"}`);
console.log(
  `brief entries matching no truth entry: ${unmatchedBriefIds.length > 0 ? unmatchedBriefIds.join(", ") : "(none)"}`,
);

if (jsonOutPath !== null && jsonOutPath !== undefined) {
  const payload = {
    briefEntries: briefEntries.length,
    truthEntries: truthEntries.length,
    citationsResolved: cleanCount,
    truthEntryMatch: matchedCount,
    categoryAgree: agreeCount,
    unmatchedTruthIds,
    scoredAt: new Date().toISOString(),
    // Deprecated aliases.
    validatorClean: cleanCount,
    matched: matchedCount,
  };
  try {
    writeFileSync(jsonOutPath, JSON.stringify(payload, null, 2) + "\n");
  } catch (error) {
    console.error(`cannot write ${jsonOutPath}: ${(error).message}`);
    process.exit(2);
  }
}
