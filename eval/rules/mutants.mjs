/**
 * Seeded-mutant generator for the deterministic brief ("memo") rules.
 *
 * Reads the four recorded Spark briefs (hero, dev01-03) and their inputs
 * read-only, then derives mutated copies with a fixed seed. Nothing in
 * eval/truth is written. No model calls, no network.
 *
 * Each mutant is one targeted defect a fail-closed verifier should catch:
 *   block    - verifyBrief must refuse the brief (passed: false)
 *   escalate - verifyBrief may pass the brief, but the mutated entry must
 *              carry an escalation it did not carry in the control
 * Benign controls are semantics-preserving rewrites that must NOT be
 * blocked and must NOT gain escalations.
 *
 * Pattern credit: the seeded-mutant measurement of a verification layer is
 * adapted from Meta's legal-agent-workshop (Session 2,
 * https://github.com/meta-models/legal-agent-workshop). That repo has no
 * LICENSE, so no code or text is copied; this is an independent
 * implementation over Second Seat's own briefs and rules.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFramesSidecar, parseTranscript, resolveFrames, validateBrief } from "@second-seat/core";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export const SEED = 102;
/** Max targets per (source, entry operator). */
export const PER_SOURCE = 2;

/** Recorded briefs and the inputs they were generated from (all read-only). */
export const SOURCES = [
  {
    id: "hero",
    brief: "services/bot/fixtures/hero-brief.recorded.json",
    transcript: "services/bot/fixtures/hero-input/transcript.txt",
    frames: "services/bot/fixtures/hero-input/frames.txt",
    meetingId: "hero-input",
  },
  ...["01", "02", "03"].map((n) => ({
    id: `dev${n}`,
    brief: `services/bot/fixtures/dev-briefs/dev${n}.recorded.json`,
    transcript: `eval/truth/dev${n}.transcript.txt`,
    frames: null,
    meetingId: `in-dev${n}`,
  })),
];

/** mulberry32: tiny deterministic PRNG, returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function refuseSealed(rel) {
  if (/heldout|holdout|sealed/i.test(rel)) throw new Error(`refusing sealed/held-out path: ${rel}`);
}

function read(rel) {
  refuseSealed(rel);
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Load one source: parsed brief, segments, frames, plus file hashes. */
export function loadSource(source) {
  const briefText = read(source.brief);
  const transcriptText = read(source.transcript);
  const framesText = source.frames === null ? "" : read(source.frames);
  const brief = JSON.parse(JSON.parse(briefText).rawText);
  const segments = parseTranscript(transcriptText);
  const frames =
    framesText.trim() === ""
      ? []
      : resolveFrames({ files: parseFramesSidecar(framesText).map((r) => r.file), sidecarText: framesText });
  const files = { [source.brief]: sha256(briefText), [source.transcript]: sha256(transcriptText) };
  if (source.frames !== null) files[source.frames] = sha256(framesText);
  return { ...source, brief, segments, frames, files };
}

export function loadSources() {
  return SOURCES.map(loadSource);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function pick(rng, list, k) {
  const pool = [...list];
  const out = [];
  while (pool.length > 0 && out.length < k) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

const NEGATION_WORDS =
  /\b(not|never|no|cannot|can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|unable|refus\w*|declin\w*|reject\w*)\b|n't\b/i;
const AUX = /\b(will|is|are|was|were|can|should|must|does|did|has|have|would|could)\b/i;

/** Flip a claim's polarity: drop every negation, or add one. */
export function flipNegation(text) {
  if (NEGATION_WORDS.test(text)) {
    let out = text;
    for (let i = 0; i < 20 && NEGATION_WORDS.test(out); i += 1) {
      out = out
        .replace(/\bcannot\b/i, "can")
        .replace(/\bcan't\b/i, "can")
        .replace(/\bwon't\b/i, "will")
        .replace(/n't\b/i, "")
        .replace(/\b(not|never|no)\s+/i, "")
        .replace(/\b(not|never|no)\b/i, "")
        .replace(/\bunable\b/i, "able")
        .replace(/\brefus(\w*)/i, "accept$1")
        .replace(/\bdeclin(\w*)/i, "accept$1")
        .replace(/\breject(\w*)/i, "accept$1");
    }
    return out;
  }
  if (AUX.test(text)) return text.replace(AUX, (m) => `${m} not`);
  return `It is not the case that ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** Change the first number in the text; null if the text has none. */
export function changeNumber(text, rng) {
  const m = /\d+(?:\.\d+)?/.exec(text);
  if (m === null) return null;
  const bumped = String(Number(m[0]) + 1 + Math.floor(rng() * 8));
  return text.slice(0, m.index) + bumped + text.slice(m.index + m[0].length);
}

function segmentCitations(entry) {
  return entry.citations.filter((c) => c.kind === "segment" && c.segmentId !== null);
}

function controlFlags(src, entryId) {
  const verified = validateBrief(src.brief, { segments: src.segments, frames: src.frames });
  return verified.entries.find((e) => e.id === entryId)?.flags ?? [];
}

/**
 * Entry operators. `eligible(entry, src)` excludes targets where the defect
 * could not be told apart from the control (the entry already carries the
 * signal); those are counted as "masked", never silently dropped.
 */
export const ENTRY_OPERATORS = [
  {
    id: "unknown_segment",
    expect: "block",
    eligible: (e) => segmentCitations(e).length > 0,
    apply(e, rng) {
      const c = segmentCitations(e)[0];
      c.segmentId = `t-9${Math.floor(rng() * 10)}:${String(Math.floor(rng() * 60)).padStart(2, "0")}`;
    },
  },
  {
    id: "unknown_frame",
    expect: "block",
    eligible: () => true,
    apply(e, rng) {
      e.citations.push({ kind: "frame", segmentId: null, frameId: `f-9${Math.floor(rng() * 10)}:00`, region: null });
    },
  },
  {
    id: "drop_citations",
    expect: "block",
    eligible: (e) => e.citations.length > 0,
    apply(e) {
      e.citations = [];
      e.flags = e.flags.filter((f) => f !== "missing_source");
    },
  },
  {
    id: "malformed_entry",
    expect: "block",
    eligible: () => true,
    apply(e, rng) {
      const variants = [
        () => delete e.acceptance,
        () => delete e.speaker,
        () => (e.category = "note"),
        () => (e.citations = "t-00:00"),
        () => (e.extra = true),
      ];
      variants[Math.floor(rng() * variants.length)]();
    },
  },
  {
    id: "unaccepted_action",
    expect: "escalate",
    masked: (flags) => flags.includes("request_not_accepted"),
    eligible: () => true,
    apply(e) {
      e.category = "action_item";
      e.acceptance = "not_established";
    },
  },
  {
    id: "speaker_mismatch",
    expect: "escalate",
    masked: (flags) => flags.includes("citation_not_found"),
    eligible: (e, src) => otherSpeakers(e, src).length > 0,
    apply(e, rng, src) {
      const others = otherSpeakers(e, src);
      e.speaker = others[Math.floor(rng() * others.length)];
    },
  },
  {
    id: "negation_flip",
    expect: "escalate",
    masked: (flags) => flags.includes("conflicting_sources"),
    eligible: (e) => segmentCitations(e).length > 0,
    apply(e) {
      e.text = flipNegation(e.text);
    },
  },
  {
    id: "number_change",
    expect: "escalate",
    eligible: (e) => /\d/.test(e.text),
    apply(e, rng) {
      e.text = changeNumber(e.text, rng);
    },
  },
  // Known gaps: semantic defects no deterministic rule can see (the support
  // judge's job). Reported separately so the misses stay visible.
  {
    id: "assignee_swap",
    expect: "gap",
    eligible: (e, src) => e.assignee !== null && speakersExcept(src, e.assignee).length > 0,
    apply(e, rng, src) {
      const others = speakersExcept(src, e.assignee);
      e.assignee = others[Math.floor(rng() * others.length)];
    },
  },
  {
    id: "category_swap",
    expect: "gap",
    eligible: (e) => e.category === "decision" || e.category === "unresolved_question",
    apply(e) {
      e.category = e.category === "decision" ? "unresolved_question" : "decision";
    },
  },
];

function speakersExcept(src, name) {
  return [...new Set(src.segments.map((s) => s.speaker))].sort().filter((s) => s !== name);
}

function otherSpeakers(entry, src) {
  const cited = new Set(
    segmentCitations(entry).map((c) => src.segments.find((s) => s.id === c.segmentId)?.speaker),
  );
  const all = [...new Set(src.segments.map((s) => s.speaker))].sort();
  if (cited.size === 0) return [];
  return all.filter((s) => !cited.has(s));
}

/** Brief-level operators (always expected to block). */
export const BRIEF_OPERATORS = [
  {
    id: "meeting_swap",
    apply(b, rng, src, all) {
      const others = all.filter((o) => o.id !== src.id);
      b.meetingId = others[Math.floor(rng() * others.length)].meetingId;
    },
  },
  {
    id: "dangling_flagged",
    apply(b, rng) {
      b.flagged.push(`e9${Math.floor(rng() * 10)}`);
    },
  },
  {
    id: "malformed_brief",
    apply(b, rng) {
      const variants = [
        () => delete b.meetingId,
        () => (b.entries = {}),
        () => (b.flagged = "e1"),
        () => delete b.createdAt,
      ];
      variants[Math.floor(rng() * variants.length)]();
    },
  },
];

/** Semantics-preserving rewrites (false-alarm controls). */
export const BENIGN_ENTRY = [
  {
    id: "reverse_citations",
    eligible: (e) => e.citations.length > 1,
    apply(e) {
      e.citations.reverse();
    },
  },
  {
    id: "trailing_whitespace",
    eligible: () => true,
    apply(e) {
      e.text = `${e.text} `;
    },
  },
];
export const BENIGN_BRIEF = [
  { id: "unmutated", apply() {} },
  {
    id: "shuffle_entries",
    apply(b, rng) {
      for (let i = b.entries.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [b.entries[i], b.entries[j]] = [b.entries[j], b.entries[i]];
      }
    },
  },
];

/**
 * Generate every case deterministically from (sources, seed).
 * Returns { mutants, controls, masked }.
 */
export function generate(sources = loadSources(), seed = SEED) {
  const rng = mulberry32(seed);
  const mutants = [];
  const controls = [];
  const masked = [];
  for (const src of sources) {
    for (const op of ENTRY_OPERATORS) {
      const candidates = [];
      for (const entry of src.brief.entries) {
        if (!op.eligible(entry, src)) continue;
        if (op.masked !== undefined && op.masked(controlFlags(src, entry.id))) {
          masked.push({ id: `${src.id}:${op.id}:${entry.id}`, source: src.id, operator: op.id, target: entry.id });
          continue;
        }
        candidates.push(entry.id);
      }
      for (const target of pick(rng, candidates, PER_SOURCE)) {
        const brief = clone(src.brief);
        op.apply(brief.entries.find((e) => e.id === target), rng, src);
        mutants.push({ id: `${src.id}:${op.id}:${target}`, source: src.id, operator: op.id, expect: op.expect, target, brief });
      }
    }
    for (const op of BRIEF_OPERATORS) {
      const brief = clone(src.brief);
      op.apply(brief, rng, src, sources);
      mutants.push({ id: `${src.id}:${op.id}`, source: src.id, operator: op.id, expect: "block", target: null, brief });
    }
    for (const op of BENIGN_BRIEF) {
      const brief = clone(src.brief);
      op.apply(brief, rng);
      controls.push({ id: `${src.id}:${op.id}`, source: src.id, operator: op.id, target: null, brief });
    }
    for (const op of BENIGN_ENTRY) {
      const candidates = src.brief.entries.filter((e) => op.eligible(e)).map((e) => e.id);
      for (const target of pick(rng, candidates, PER_SOURCE)) {
        const brief = clone(src.brief);
        op.apply(brief.entries.find((e) => e.id === target));
        controls.push({ id: `${src.id}:${op.id}:${target}`, source: src.id, operator: op.id, target, brief });
      }
    }
  }
  return { mutants, controls, masked };
}

/** Canonical digest of the generated set (pinned in eval/rules/SHA256SUMS). */
export function digestCases(cases) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
  return sha256(JSON.stringify(canon({ mutants: cases.mutants, controls: cases.controls, masked: cases.masked })));
}

export const SUMS_PATH = "eval/rules/SHA256SUMS";
export const DIGEST_LABEL = `@generated-cases seed=${SEED} per_source=${PER_SOURCE}`;

/** Build the SHA256SUMS text: input file hashes plus the generated-set digest. */
export function buildSums(sources, cases) {
  const lines = [];
  for (const src of sources) for (const [path, hash] of Object.entries(src.files)) lines.push(`${hash}  ${path}`);
  lines.push(`${digestCases(cases)}  ${DIGEST_LABEL}`);
  return `${lines.join("\n")}\n`;
}

/** Compare against the committed SHA256SUMS. Returns a list of mismatches. */
export function checkSums(sources, cases) {
  const expected = read(SUMS_PATH);
  const want = new Map(
    expected
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => {
        const i = l.indexOf("  ");
        return [l.slice(i + 2), l.slice(0, i)];
      }),
  );
  const got = new Map(
    buildSums(sources, cases)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => {
        const i = l.indexOf("  ");
        return [l.slice(i + 2), l.slice(0, i)];
      }),
  );
  const problems = [];
  for (const [k, v] of want) if (got.get(k) !== v) problems.push(`${k}: expected ${v}, got ${got.get(k) ?? "(absent)"}`);
  for (const k of got.keys()) if (!want.has(k)) problems.push(`${k}: not pinned`);
  return problems;
}
