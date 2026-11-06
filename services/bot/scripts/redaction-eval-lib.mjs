// Pure helpers for scripts/redaction-eval.mjs (unit-tested, no I/O).
export function wilson(k, n, z = 1.96) {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

function clampSpan(textLen, s) {
  const start = Math.max(0, Math.min(textLen, Math.floor(s.start)));
  const end = Math.max(0, Math.min(textLen, Math.ceil(s.end)));
  return end > start ? { start, end } : null;
}

function markRanges(textLen, spans) {
  const mask = new Array(textLen).fill(false);
  for (const s of spans) {
    const c = clampSpan(textLen, s);
    if (c === null) continue;
    for (let i = c.start; i < c.end; i++) mask[i] = true;
  }
  return mask;
}

// Score annotated spans against predicted spans (both in original coordinates).
// A span counts as covered ONLY if 100% of its characters are predicted masked.
// Returns per-case span aggregates.
export function scoreSpans(text, expectedSpans, predictedSpans) {
  const n = text.length;
  const expected = (expectedSpans ?? []).map((s) => clampSpan(n, s)).filter((s) => s !== null);
  const predictedMask = markRanges(n, predictedSpans ?? []);
  const expectedMask = markRanges(n, expected);

  let covered = 0;
  const missed = [];
  for (const s of expected) {
    let all = true;
    for (let i = s.start; i < s.end; i++) {
      if (!predictedMask[i]) {
        all = false;
        break;
      }
    }
    if (all) covered += 1;
    else missed.push({ start: s.start, end: s.end });
  }

  let piiChars = 0;
  let piiCharsMasked = 0;
  let nonPii = 0;
  let nonPiiMasked = 0;
  for (let i = 0; i < n; i++) {
    if (/\s/.test(text[i])) continue; // whitespace excluded everywhere
    if (expectedMask[i]) {
      piiChars += 1;
      if (predictedMask[i]) piiCharsMasked += 1;
    } else {
      nonPii += 1;
      if (predictedMask[i]) nonPiiMasked += 1;
    }
  }

  return {
    covered,
    expected: expected.length,
    missed,
    piiChars,
    piiCharsMasked,
    charCoverage: piiChars > 0 ? piiCharsMasked / piiChars : null,
    nonPii,
    nonPiiMasked,
    overRedaction: nonPii > 0 ? nonPiiMasked / nonPii : 0,
  };
}

// Find every occurrence of each entity string in text; each occurrence is its
// own annotated span (so a repeated email/name yields one span per occurrence).
// Spans are non-overlapping: when candidates overlap (e.g. "Zoë" inside
// "Zoë Callahan" at the same offset), the longest match wins and the shorter
// nested span is dropped. Non-overlapping repeats (standalone "Zoë" elsewhere)
// are each kept.
export function annotateOccurrences(text, entities) {
  const spans = [];
  for (const e of entities ?? []) {
    if (typeof e !== "string" || e.length === 0) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(e, from);
      if (i < 0) break;
      spans.push({ start: i, end: i + e.length });
      from = i + (e.length > 0 ? 1 : 0);
      if (from > text.length) break;
    }
  }
  // Longest match first so it wins any overlap; ties break by earliest start.
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const s of spans) {
    let overlaps = false;
    for (const a of accepted) {
      if (s.start < a.end && a.start < s.end) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) accepted.push(s);
  }
  accepted.sort((a, b) => a.start - b.start || a.end - b.end);
  return accepted;
}

// Every planned case must appear exactly once in the records: no missing,
// no duplicates, no unexpected ids. Returns { ok, reason } (reason is null
// when ok). Used by offline rescoring to keep incomplete runs honest.
export function checkRecordIntegrity(records, plannedCases) {
  const planned = new Set((plannedCases ?? []).map((c) => c.file));
  const seen = new Set();
  const missing = [];
  const duplicates = [];
  const unexpected = [];
  for (const r of records ?? []) {
    if (!planned.has(r.file)) {
      unexpected.push(r.file);
      continue;
    }
    if (seen.has(r.file)) {
      duplicates.push(r.file);
      continue;
    }
    seen.add(r.file);
  }
  for (const c of plannedCases ?? []) {
    if (!seen.has(c.file)) missing.push(c.file);
  }
  const reasons = [];
  if (missing.length > 0) reasons.push(`missing: ${missing.join(", ")}`);
  if (duplicates.length > 0) reasons.push(`duplicate: ${duplicates.join(", ")}`);
  if (unexpected.length > 0) reasons.push(`unexpected: ${unexpected.join(", ")}`);
  if (reasons.length > 0) return { ok: false, reason: reasons.join("; ") };
  return { ok: true, reason: null };
}

export function summarizeWithIntegrity(cases, plannedCases) {
  const planned = Array.isArray(plannedCases) && plannedCases.length > 0 ? plannedCases : cases;
  const integrity = checkRecordIntegrity(cases, planned);
  const summary = summarize(cases, planned);
  if (!integrity.ok) {
    summary.complete = false;
    summary.all_valid = false;
  }
  summary.integrity = integrity;
  return summary;
}

// cases: [{ file, hits, total, status: "ok" | "error" | "not_run", error?,
//            span?: { covered, expected, piiChars, piiCharsMasked, nonPii, nonPiiMasked } }]
// plannedCases: full planned batch [{ file, total, expected? }]; failed and
// not_run cases keep their planned expected counts with 0 covered, so the
// end-to-end denominators cover ALL planned cases. Clean negative cases
// (0 entities/expected) contribute only to over_redaction.
export function summarize(cases, plannedCases) {
  const planned = Array.isArray(plannedCases) && plannedCases.length > 0 ? plannedCases : cases;
  const plannedByFile = new Map(planned.map((c) => [c.file, c]));
  const completed = cases.filter((c) => c.status === "ok");
  const failures = cases
    .filter((c) => c.status === "error")
    .map((c) => `${c.file}: ${c.error ?? "unknown error"}`);
  const notRun = cases.filter((c) => c.status === "not_run").map((c) => c.file);

  const plannedTotal = (c) => {
    const p = plannedByFile.get(c.file);
    if (typeof c.total === "number") return c.total;
    return typeof p?.total === "number" ? p.total : 0;
  };
  const plannedExpected = (c) => {
    const p = plannedByFile.get(c.file);
    if (typeof c.span?.expected === "number") return c.span.expected;
    return typeof p?.expected === "number" ? p.expected : 0;
  };

  // Legacy per-entity metric: entity text absent from output.
  const legacyK = completed.reduce((s, c) => s + c.hits, 0);
  const legacyN = completed.reduce((s, c) => s + c.total, 0);
  const legacyEndN = planned.reduce((s, c) => s + (typeof c.total === "number" ? c.total : 0), 0);
  const [legacyLo, legacyHi] = wilson(legacyK, legacyN);
  const [legacyEndLo, legacyEndHi] = wilson(legacyK, legacyEndN);

  const spanOf = (c) => c.span ?? { covered: 0, expected: 0, piiChars: 0, piiCharsMasked: 0, nonPii: 0, nonPiiMasked: 0 };
  const spanK = completed.reduce((s, c) => s + spanOf(c).covered, 0);
  const spanN = completed.reduce((s, c) => s + spanOf(c).expected, 0);
  const spanEndN = planned.reduce((s, c) => {
    const rec = cases.find((r) => r.file === c.file);
    if (rec !== undefined && rec.status === "ok") return s + spanOf(rec).expected;
    if (typeof c.expected === "number") return s + c.expected;
    if (rec !== undefined) return s + plannedExpected(rec);
    return s;
  }, 0);
  const [spanLo, spanHi] = wilson(spanK, spanN);
  const [spanEndLo, spanEndHi] = wilson(spanK, spanEndN);

  const charMasked = completed.reduce((s, c) => s + spanOf(c).piiCharsMasked, 0);
  const charTotal = completed.reduce((s, c) => s + spanOf(c).piiChars, 0);
  const overMasked = completed.reduce((s, c) => s + spanOf(c).nonPiiMasked, 0);
  const overTotal = completed.reduce((s, c) => s + spanOf(c).nonPii, 0);

  return {
    complete: cases.length > 0 && failures.length === 0 && notRun.length === 0,
    // all_attempted: every planned case got a response (ok or error, no not_run).
    // all_valid: every planned case is ok. complete mirrors all_valid.
    all_attempted: cases.length > 0 && notRun.length === 0,
    all_valid: cases.length > 0 && failures.length === 0 && notRun.length === 0,
    request_completion: {
      completed: completed.length,
      planned: planned.length,
    },
    legacy_entity_disappearance: {
      completed: { k: legacyK, n: legacyN },
      end_to_end: { k: legacyK, n: legacyEndN },
      wilson95_completed: [legacyLo, legacyHi],
      wilson95_end_to_end: [legacyEndLo, legacyEndHi],
    },
    recall_completed: spanN > 0 ? { k: spanK, n: spanN } : null,
    recall_end_to_end: spanEndN > 0 ? { k: spanK, n: spanEndN } : null,
    wilson95_recall_completed: [spanLo, spanHi],
    wilson95_recall_end_to_end: [spanEndLo, spanEndHi],
    char_coverage: {
      completed: charTotal > 0 ? charMasked / charTotal : null,
      masked: charMasked,
      total: charTotal,
    },
    over_redaction_rate: overTotal > 0 ? overMasked / overTotal : 0,
    over_redaction: { masked: overMasked, total: overTotal },
    // Deprecated aliases: prefer legacy_entity_disappearance / recall_* above.
    recall: { k: legacyK, n: legacyN },
    wilson95: [legacyLo, legacyHi],
    cases,
    failures,
    not_run: notRun,
  };
}
