/**
 * Cost guard for Muse Spark live calls.
 *
 * Daily caps (gitignored local state):
 * - calls per day: MUSE_MAX_CALLS_PER_DAY (default 50)
 * - spend per day: hard $5 USD
 * - tokens per call: MUSE_MAX_TOKENS_PER_CALL (0/unset = no cap)
 *
 * Prices are *conservative estimates, not official pricing*, configurable via:
 * - MUSE_PRICE_INPUT_PER_M  (default 1.50 USD per 1M input tokens)
 * - MUSE_PRICE_CACHED_PER_M (default 0.15 USD per 1M cached input tokens)
 * - MUSE_PRICE_OUTPUT_PER_M (default 6.00 USD per 1M output tokens)
 *
 * Every call appends one JSON log line to stderr AND to
 * services/bot/.cost-log.jsonl (gitignored) with input/cached/output/
 * reasoning tokens and estimated USD.
 */

import { dirname as dirnameFn, join as joinFn } from "node:path";
import { readFileSync as readFileSyncFn } from "node:fs";
import { fileURLToPath as fileURLToPathFn } from "node:url";

export interface CallUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface CostLogLine extends CallUsage {
  model: string;
  promptVersion: string;
  estimatedUsd: number;
  fixture: boolean;
  timestamp: string;
}

const DAY_SPEND_CAP_USD = 5;
const LOG_FILENAME = ".cost-log.jsonl";
const STATE_FILENAME = ".muse-daily-state.json";

interface DailyState {
  date: string;
  calls: number;
  spendUsd: number;
}

function botDir(): string {
  // Resolve services/bot from both src/ and dist/src/ by walking up to the
  // dir whose package.json name is "@second-seat/bot".
  // Default cost log = services/bot/.cost-log.jsonl via costLogPath().
  const fallback = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  try {
    let dir = dirnameFn(fileURLToPathFn(import.meta.url));
    for (;;) {
      try {
        const pkg = JSON.parse(readFileSyncFn(joinFn(dir, "package.json"), "utf8")) as { name?: string };
        if (pkg?.name === "@second-seat/bot") return dir;
      } catch {
        /* keep walking */
      }
      const parent = dirnameFn(dir);
      if (parent === dir) return fallback;
      dir = parent;
    }
  } catch {
    return fallback;
  }
}

export function costLogPath(): string {
  return `${botDir()}/${LOG_FILENAME}`;
}

export function dailyStatePath(): string {
  const override = process.env["MUSE_STATE_FILE"];
  if (override !== undefined && override !== "") {
    return override;
  }
  return `${botDir()}/${STATE_FILENAME}`;
}

export function maxCallsPerDay(): number {
  const raw = process.env["MUSE_MAX_CALLS_PER_DAY"];
  const parsed = raw === undefined || raw === "" ? 50 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 50;
}

export function maxTokensPerCall(): number {
  const raw = process.env["MUSE_MAX_TOKENS_PER_CALL"];
  const parsed = raw === undefined || raw === "" ? 0 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function pricePerM(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const parsed = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function estimateUsd(usage: CallUsage): number {
  const inputRate = pricePerM("MUSE_PRICE_INPUT_PER_M", 1.5);
  const cachedRate = pricePerM("MUSE_PRICE_CACHED_PER_M", 0.15);
  const outputRate = pricePerM("MUSE_PRICE_OUTPUT_PER_M", 6.0);
  const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (
    (fresh / 1_000_000) * inputRate +
    (usage.cachedTokens / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * outputRate
  );
}

function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function readState(path: string, today: string): Promise<DailyState> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<DailyState>;
    if (parsed.date === today) {
      return {
        date: today,
        calls: typeof parsed.calls === "number" ? parsed.calls : 0,
        spendUsd: typeof parsed.spendUsd === "number" ? parsed.spendUsd : 0,
      };
    }
  } catch {
    // Missing or corrupt state starts a fresh day.
  }
  return { date: today, calls: 0, spendUsd: 0 };
}

export class CostCapExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostCapExceeded";
  }
}

/**
 * Refuse when the daily call count or spend cap is already exceeded.
 * Call BEFORE making a live request.
 */
export async function checkCapsPreCall(now: Date = new Date()): Promise<DailyState> {
  const state = await readState(dailyStatePath(), todayKey(now));
  if (state.calls >= maxCallsPerDay()) {
    throw new CostCapExceeded(
      `refusing live call: ${state.calls} calls already made today (cap MUSE_MAX_CALLS_PER_DAY=${maxCallsPerDay()})`,
    );
  }
  if (state.spendUsd >= DAY_SPEND_CAP_USD) {
    throw new CostCapExceeded(
      `refusing live call: $${state.spendUsd.toFixed(4)} already spent today (cap $${DAY_SPEND_CAP_USD}/day)`,
    );
  }
  return state;
}

/** Refuse when the request would exceed the per-call token cap. */
export function checkPerCallTokenCap(inputTokens: number, outputTokens: number): void {
  const cap = maxTokensPerCall();
  if (cap > 0 && inputTokens + outputTokens > cap) {
    throw new CostCapExceeded(
      `refusing live call: ~${inputTokens + outputTokens} tokens exceed MUSE_MAX_TOKENS_PER_CALL=${cap}`,
    );
  }
}

/**
 * Record a completed call: update daily state and emit the per-call log
 * line (JSON to stderr + appended to .cost-log.jsonl).
 */
export async function recordCall(
  usage: CallUsage,
  opts: { model: string; promptVersion: string; fixture?: boolean },
): Promise<CostLogLine> {
  const estimatedUsd = estimateUsd(usage);
  const line: CostLogLine = {
    ...usage,
    model: opts.model,
    promptVersion: opts.promptVersion,
    estimatedUsd: Number(estimatedUsd.toFixed(6)),
    fixture: opts.fixture ?? false,
    timestamp: new Date().toISOString(),
  };
  const text = JSON.stringify(line);
  process.stderr.write(`${text}\n`);
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const logPath =
      process.env["MUSE_COST_LOG_FILE"] !== undefined && process.env["MUSE_COST_LOG_FILE"] !== ""
        ? (process.env["MUSE_COST_LOG_FILE"] as string)
        : costLogPath();
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${text}\n`, "utf8");
  } catch {
    // Logging must never break the call itself.
  }
  if (!line.fixture) {
    const path = dailyStatePath();
    const state = await readState(path, todayKey());
    const next: DailyState = {
      date: state.date,
      calls: state.calls + 1,
      spendUsd: state.spendUsd + estimatedUsd,
    };
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(next)}\n`, "utf8");
    } catch {
      // State write failure is non-fatal; caps were checked pre-call.
    }
  }
  return line;
}
