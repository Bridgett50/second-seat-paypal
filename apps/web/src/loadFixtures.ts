import { readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Brief,
  BriefScore,
  Frame,
  PayloadDemo,
  PressureItem,
  TranscriptSegment,
} from "./render.js";
import type { RunLogLine } from "./modelStrip.js";
import { parseGlimmerRecall } from "./modelStrip.js";
import type { CacheUsage } from "./cacheRatio.js";

const here = dirname(fileURLToPath(import.meta.url));

function findWebRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "@second-seat/web") return dir;
    } catch {
      /* keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const WEB_ROOT = findWebRoot(here);

export function parseTranscript(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const m = line.match(/^\[(\d{2}:\d{2})\]\s+([^:]+):\s*(.*)$/);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
      continue;
    }
    out.push({
      id: `t-${m[1]}`,
      time: m[1],
      speaker: m[2].trim(),
      text: m[3],
    });
  }
  return out;
}

export function parseFrames(text: string): Frame[] {
  const out: Frame[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\d{2}:\d{2})$/);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    out.push({ id: `f-${m[2]}`, file: m[1], time: m[2] });
  }
  return out;
}

export interface GlimmerAttempt {
  label: string;
  mode: "live" | "mock";
  runId: string;
  sourceRevision: string;
  ranAt: string;
  health: number | null;
  status: "complete" | "incomplete" | "invalid";
  completedK: number;
  completedN: number;
  recallK: number;
  recallN: number;
  fullK: number;
  fullN: number;
  wilson95: string | null;
}

export interface GlimmerLive extends GlimmerAttempt {
  recall: string;
  n: number;
  attempts: GlimmerAttempt[];
}

interface GlimmerRaw {
  health?: unknown;
  health_status?: unknown;
  eval_returncode?: unknown;
  eval_stdout?: unknown;
  ran_at?: unknown;
  mode?: unknown;
  mock?: unknown;
  call_id?: unknown;
  run_id?: unknown;
  runId?: unknown;
  git_sha?: unknown;
  revision?: unknown;
  source_revision?: unknown;
  sourceRevision?: unknown;
  commit?: unknown;
}

interface EvalSummary {
  complete?: unknown;
  recall?: { k?: unknown; n?: unknown };
  cases?: { total?: unknown }[];
}

function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function parseCaseCompletion(stdout: string): { completedK: number; completedN: number } | null {
  const done = stdout.match(/completed:\s*(\d+)\s*\/\s*(\d+)/i);
  if (done?.[1] !== undefined && done?.[2] !== undefined) {
    return { completedK: Number.parseInt(done[1], 10), completedN: Number.parseInt(done[2], 10) };
  }
  const okFiles = new Set<string>();
  const errorFiles = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = line.match(/^case\s+(\S+?):\s*(.*)$/);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    if (/error/i.test(m[2])) errorFiles.add(m[1]);
    else if (/\d+\s*\/\s*\d+/.test(m[2])) okFiles.add(m[1]);
  }
  const all = new Set([...okFiles, ...errorFiles]);
  if (all.size === 0) return null;
  let completedK = 0;
  for (const f of okFiles) if (!errorFiles.has(f)) completedK += 1;
  return { completedK, completedN: all.size };
}

function parseWilson95(stdout: string): string | null {
  const m = stdout.match(/wilson95:\s*(\[[^\]]*\])/i);
  return m?.[1] ?? null;
}

function parseGlimmerAttempt(label: string, basename: string, raw: GlimmerRaw, summary: EvalSummary | null): GlimmerAttempt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stdout = typeof raw.eval_stdout === "string" ? raw.eval_stdout : null;
  if (stdout === null) return null;
  const ranAt = typeof raw.ran_at === "string" ? raw.ran_at : "";
  const healthRaw = raw.health ?? raw.health_status;
  const health = typeof healthRaw === "number" ? healthRaw : null;
  const mode: "live" | "mock" = raw.mode === "mock" || raw.mock === true ? "mock" : "live";
  const callId = raw.call_id ?? raw.run_id ?? raw.runId;
  const runId = typeof callId === "string" && callId.length > 0 ? callId : `${basename} @ ${ranAt}`;
  const rev = raw.git_sha ?? raw.source_revision ?? raw.sourceRevision ?? raw.revision ?? raw.commit;
  const sourceRevision = typeof rev === "string" && rev.length > 0 ? rev : "unknown";
  const recall = parseGlimmerRecall(stdout);
  const completion = parseCaseCompletion(stdout);
  const recallK = recall === null ? 0 : Number.parseInt(recall.split("/")[0]?.trim() ?? "", 10);
  const recallN = recall === null ? 0 : Number.parseInt(recall.split("/")[1]?.trim() ?? "", 10);
  let completedK: number;
  let completedN: number;
  if (completion !== null) {
    ({ completedK, completedN } = completion);
  } else if (recall !== null && !/error/i.test(stdout)) {
    completedK = recallN;
    completedN = recallN;
  } else if (recall !== null) {
    completedK = 0;
    completedN = recallN;
  } else {
    return null;
  }
  let status: GlimmerAttempt["status"];
  if (completedK === 0 && (recall === null || /error/i.test(stdout))) {
    status = "invalid";
  } else if (summary?.complete === true || (completedK === completedN && raw.eval_returncode === 0)) {
    status = "complete";
  } else {
    status = "incomplete";
  }
  let fullK = recallK;
  let fullN = recallN;
  if (summary !== null && typeof summary === "object") {
    const k = summary.recall?.k;
    const totals = Array.isArray(summary.cases)
      ? summary.cases.map((c) => (typeof c?.total === "number" ? c.total : NaN))
      : [];
    if (typeof k === "number" && totals.length > 0 && totals.every((t) => Number.isInteger(t))) {
      fullK = k;
      fullN = totals.reduce((a, b) => a + b, 0);
    }
  }
  return {
    label, mode, runId, sourceRevision, ranAt, health, status,
    completedK, completedN, recallK, recallN, fullK, fullN,
    wilson95: parseWilson95(stdout),
  };
}

export function loadGlimmerAttempts(webRoot: string = WEB_ROOT): GlimmerAttempt[] {
  const fixtures = join(webRoot, "..", "..", "services", "bot", "fixtures");
  const candidates = [
    { file: join(fixtures, "glimmer-live-eval.json"), basename: "glimmer-live-eval.json", summary: null as string | null },
    { file: join(fixtures, "glimmer-live-eval-n10.json"), basename: "glimmer-live-eval-n10.json", summary: null as string | null },
    {
      file: join(fixtures, "glimmer-run", "glimmer-live-eval.json"),
      basename: "glimmer-live-eval.json",
      summary: join(fixtures, "glimmer-run", "eval-summary.json") as string | null,
    },
  ];
  const attempts: GlimmerAttempt[] = [];
  for (const c of candidates) {
    const base = readJsonFile(c.file) as GlimmerRaw | null;
    if (base === null) continue;
    // Optional sidecar with call ID / source revision recorded by the driver at run time.
    const meta = readJsonFile(join(dirname(c.file), "run-meta.json")) as Record<string, unknown> | null;
    const raw = (dirname(c.file) !== fixtures && meta !== null ? { ...meta, ...base } : base) as GlimmerRaw;
    const summary = c.summary === null ? null : (readJsonFile(c.summary) as EvalSummary | null);
    const attempt = parseGlimmerAttempt(relative(join(fixtures, "..", "..", ".."), c.file), c.basename, raw, summary);
    // Driver fix: surface rescore.json span-metric status next to the legacy numbers.
    const rescore = readJsonFile(join(dirname(c.file), "rescore.json")) as Record<string, unknown> | null;
    if (attempt !== null && rescore !== null && dirname(c.file) !== fixtures) {
      const reason = rescore["span_coverage_reason"];
      (attempt as GlimmerAttempt & { spanNote?: string }).spanNote =
        rescore["span_coverage"] === null
          ? "span coverage / over-redaction not re-scorable (predictions not keyed to cases)"
          : "span coverage / over-redaction: see rescore.json";
    }
    if (attempt !== null) attempts.push(attempt);
  }
  attempts.sort((a, b) => (a.ranAt < b.ranAt ? 1 : a.ranAt > b.ranAt ? -1 : 0));
  return attempts;
}

export function loadGlimmerLive(webRoot: string = WEB_ROOT): GlimmerLive | null {
  const attempts = loadGlimmerAttempts(webRoot);
  const head = attempts[0];
  if (head === undefined) return null;
  return {
    ...head,
    recall: `${head.recallK}/${head.recallN}`,
    n: head.completedN,
    attempts,
  };
}

export interface SeededScore {
  catchK: number;
  catchN: number;
  catchLo: number;
  catchHi: number;
  falseK: number;
  falseN: number;
}

export function loadSeededScore(webRoot: string = WEB_ROOT): SeededScore | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(webRoot, "..", "..", "eval", "results", "support-score-frozen-live.json"), "utf8"),
    ) as {
      catch?: { k?: unknown; n?: unknown; ci?: { lo?: unknown; hi?: unknown } };
      falseAlarm?: { k?: unknown; n?: unknown };
    };
    const ck = raw.catch?.k;
    const cn = raw.catch?.n;
    const lo = raw.catch?.ci?.lo;
    const hi = raw.catch?.ci?.hi;
    const fk = raw.falseAlarm?.k;
    const fn = raw.falseAlarm?.n;
    if (
      typeof ck !== "number" || typeof cn !== "number" ||
      typeof lo !== "number" || typeof hi !== "number" ||
      typeof fk !== "number" || typeof fn !== "number"
    ) {
      return null;
    }
    return { catchK: ck, catchN: cn, catchLo: lo, catchHi: hi, falseK: fk, falseN: fn };
  } catch {
    return null;
  }
}

export function loadBriefScore(webRoot: string = WEB_ROOT): BriefScore | null {
  try {
    const raw = JSON.parse(
      readFileSync(
        join(webRoot, "..", "..", "eval", "results", "hero-brief-score.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const resolved = {
      briefEntries: raw["briefEntries"],
      truthEntries: raw["truthEntries"],
      validatorClean: raw["citationsResolved"] ?? raw["validatorClean"],
      matched: raw["truthEntryMatch"] ?? raw["matched"],
      categoryAgree: raw["categoryAgree"],
    };
    const values = [resolved.briefEntries, resolved.truthEntries, resolved.validatorClean, resolved.matched, resolved.categoryAgree];
    if (
      !values.every((v) => typeof v === "number" && Number.isFinite(v as number))
    ) {
      return null;
    }
    return {
      briefEntries: resolved.briefEntries as number,
      truthEntries: resolved.truthEntries as number,
      validatorClean: resolved.validatorClean as number,
      matched: resolved.matched as number,
      categoryAgree: resolved.categoryAgree as number,
    };
  } catch {
    return null;
  }
}

export interface HeroChainData {
  pngBase64: string;
  boxPercent: { x: number; y: number; w: number; h: number };
  date: string | null;
  modelGenerated: boolean;
}

export function loadHeroChain(webRoot: string = WEB_ROOT): HeroChainData | null {
  try {
    const dir = join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-chain");
    const pngBase64 = readFileSync(join(dir, "slide.png")).toString("base64");
    const region = JSON.parse(readFileSync(join(dir, "sam-region.json"), "utf8")) as {
      boxPercent?: HeroChainData["boxPercent"];
    };
    if (!region.boxPercent) return null;
    let date: string | null = null;
    let modelGenerated = false;
    try {
      const spark = JSON.parse(readFileSync(join(dir, "spark.json"), "utf8")) as {
        date?: unknown;
        fixture?: unknown;
      };
      if (typeof spark.date === "string") date = spark.date;
      modelGenerated = spark.fixture === false;
    } catch {
      /* date stays null */
    }
    return { pngBase64, boxPercent: region.boxPercent, date, modelGenerated };
  } catch {
    return null;
  }
}

export interface DemoData {
  brief: Brief;
  segments: TranscriptSegment[];
  frames: Frame[];
  runLog: RunLogLine[];
  pressureFallback: PressureItem[];
  payloadDemo: PayloadDemo | null;
  glimmerLive: GlimmerLive | null;
  briefScore: BriefScore | null;
  seededScore: SeededScore | null;
  heroChain: HeroChainData | null;
  cacheUsage: CacheUsage[];
}

export function loadDemo(webRoot: string = WEB_ROOT): DemoData {
  const recorded = JSON.parse(
    readFileSync(
      join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-brief.recorded.json"),
      "utf8",
    ),
  );
  const brief = JSON.parse(recorded.rawText) as Brief;
  const segments = parseTranscript(
    readFileSync(
      join(webRoot, "..", "..", "services", "bot", "fixtures", "hero-input", "transcript.txt"),
      "utf8",
    ),
  );
  const heroInputDir = join(
    webRoot,
    "..",
    "..",
    "services",
    "bot",
    "fixtures",
    "hero-input",
  );
  const frames = parseFrames(
    readFileSync(join(heroInputDir, "frames.txt"), "utf8"),
  ).map((f) => {
    try {
      const pngBase64 = readFileSync(join(heroInputDir, f.file)).toString(
        "base64",
      );
      return { ...f, pngBase64 };
    } catch {
      return f;
    }
  });
  const runLog = readFileSync(join(webRoot, "fixtures", "run-log.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RunLogLine);
  let pressureFallback: PressureItem[] = [];
  try {
    const raw = JSON.parse(
      readFileSync(join(webRoot, "fixtures", "pressure-demo.json"), "utf8"),
    );
    pressureFallback = (raw.items as { id: string; text: string; segmentId: string }[]).map(
      (it) => ({ id: it.id, text: it.text, segmentIds: [it.segmentId] }),
    );
  } catch {
    pressureFallback = [];
  }
  let payloadDemo: PayloadDemo | null = null;
  try {
    payloadDemo = JSON.parse(
      readFileSync(join(webRoot, "fixtures", "payload-demo.json"), "utf8"),
    ) as PayloadDemo;
  } catch {
    payloadDemo = null;
  }
  const glimmerLive = loadGlimmerLive(webRoot);
  const briefScore = loadBriefScore(webRoot);
  const seededScore = loadSeededScore(webRoot);
  const heroChain = loadHeroChain(webRoot);
  const usage = (recorded as { usage?: { inputTokens?: unknown; cachedTokens?: unknown } }).usage;
  const cacheUsage: CacheUsage[] =
    typeof usage?.inputTokens === "number" && typeof usage?.cachedTokens === "number"
      ? [{ inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens }]
      : [];
  return { brief, segments, frames, runLog, pressureFallback, payloadDemo, glimmerLive, briefScore, seededScore, heroChain, cacheUsage };
}
