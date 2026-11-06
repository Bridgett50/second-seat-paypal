/**
 * Semantic support judge (Phase 06).
 *
 * Input: one brief entry's text plus its cited span(s).
 * Output: `supported | partial | unsupported` plus a nullable
 * `missing_qualifier`, and an advisory lexical overlap score next to the
 * semantic grade.
 *
 * - `SupportJudge` interface: live (`SparkSupportJudge`, via fetch) and
 *   recorded (`FixtureSupportJudge`) implementations share it.
 * - Model: `muse-spark-1.3` (Standard mode, never `-contributor`) via
 *   POST https://api.meta.ai/v1/chat/completions, `developer` role,
 *   `response_format: {type:"json_schema", ...strict:true}`, sampling unset,
 *   fixed `seed` (best-effort), `max_completion_tokens` 16000, streamed.
 * - `reasoning_effort: "medium"`.
 * - Retries 429/5xx with backoff + Retry-After; never retries a 400.
 * - Fixture mode is the default. Without an API key, only fixture mode
 *   is available. Tests use recorded/made-up fixtures only: no live calls.
 * - The judge can only ADD flags: `baselineGrade` (judge disabled) returns
 *   `supported` for everything, so the seeded-error suite FAILS with the
 *   judge disabled and only the judge's flags catch mutants.
 */

import { BRIEF_API_URL, BRIEF_MAX_COMPLETION_TOKENS, BRIEF_SEED } from "../brief/muse.js";
import { checkCapsPreCall, checkPerCallTokenCap, recordCall } from "../brief/costGuard.js";
import { PROMPT_CACHE_KEYS } from "../promptCache.js";
import { dispatchGuarded, requireLiveGatedText, type GatedText } from "../private/gate.js";

/** Development ceiling. The omitted default is 1, the proof cap. */
export const SUPPORT_MAX_ATTEMPTS = 4;

export const SUPPORT_MODEL = "muse-spark-1.3";
export const SUPPORT_PROMPT_VERSION = "support-v1";
export const SUPPORT_SEED = BRIEF_SEED;
export const SUPPORT_MAX_COMPLETION_TOKENS = BRIEF_MAX_COMPLETION_TOKENS;

export type SupportGrade = "supported" | "partial" | "unsupported";

export interface SupportInput {
  entryId: string;
  entryText: string;
  citedSpans: string[];
}

export interface SupportUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface SupportVerdict {
  entryId: string;
  grade: SupportGrade;
  /** Qualifier present in the spans but dropped from the entry; null when none. */
  missingQualifier: string | null;
  /** Advisory lexical overlap (entry-token recall against the spans), 0..1. */
  overlap: number;
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: SupportUsage;
}

export interface SupportJudge {
  readonly mode: "fixture" | "live";
  gradeSupport(input: SupportInput): Promise<SupportVerdict>;
}

/**
 * Gated support input: the entry text and cited spans must be
 * gate-minted `GatedText` (reviewed redacted text from `gate.send`).
 * Plain strings are rejected at compile time and at runtime.
 */
export interface SupportGatedInput {
  entryId: string;
  entryText: GatedText;
  citedSpans: GatedText[];
}

export const SUPPORT_JSON_SCHEMA = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["supported", "partial", "unsupported"] },
    missing_qualifier: { type: ["string", "null"] },
  },
  required: ["grade", "missing_qualifier"],
  additionalProperties: false,
} as const;

const SUPPORT_DEVELOPER_PROMPT = [
  "You grade whether a brief entry is supported by its cited transcript spans.",
  'Grade "supported" when the spans fully back the entry text as written.',
  'Grade "partial" when the entry is close but drops a qualifier present in the spans',
  "(a date hedge, a condition, a cost adder, a projection caveat) or overstates",
  'confidence ("guaranteed" for "we will try"). Set missing_qualifier to the',
  "dropped qualifier text, or null when no single qualifier was dropped.",
  'Grade "unsupported" when the spans contradict the entry or describe no such',
  "agreement, date, owner, or decision. Judge ONLY the cited spans, not the",
  "rest of the meeting. Reply with exactly the JSON the schema requires.",
].join("\n");

/** Tokenize for the advisory overlap: lowercase alphanumeric words. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/**
 * Advisory lexical overlap: fraction of distinct entry tokens that appear
 * anywhere in the joined cited spans (entry-token recall, 0..1, rounded to
 * 3 decimals). Advisory only: a high score never clears a semantic flag.
 */
export function lexicalOverlap(entryText: string, citedSpans: string[]): number {
  const entryTokens = new Set(tokenize(entryText));
  if (entryTokens.size === 0 || citedSpans.length === 0) {
    return 0;
  }
  const spanTokens = new Set(tokenize(citedSpans.join("\n")));
  let hits = 0;
  for (const token of entryTokens) {
    if (spanTokens.has(token)) {
      hits += 1;
    }
  }
  return Math.round((hits / entryTokens.size) * 1000) / 1000;
}

/**
 * Judge-disabled baseline: grades every entry `supported` with no qualifier.
 * Code-only verification (IDs exist, spans are substrings) cannot catch
 * semantic mutants, so the seeded-error suite FAILS in this mode. The live
 * or fixture judge can only ADD flags on top of this baseline.
 */
export function baselineGrade(input: SupportInput): SupportVerdict {
  return {
    entryId: input.entryId,
    grade: "supported",
    missingQualifier: null,
    overlap: lexicalOverlap(input.entryText, input.citedSpans),
    model: "baseline-disabled",
    promptVersion: SUPPORT_PROMPT_VERSION,
    fixture: true,
    usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  };
}

function apiKey(): string | null {
  const key = process.env["META_API_KEY"] ?? process.env["MUSE_API_KEY"] ?? "";
  return key === "" ? null : key;
}

export function supportMode(): "fixture" | "live" {
  if ((process.env["SUPPORT_JUDGE_MODE"] ?? "fixture") === "live") {
    if (apiKey() === null) {
      throw new Error("SUPPORT_JUDGE_MODE=live but no API key (set META_API_KEY)");
    }
    return "live";
  }
  return "fixture";
}

export function buildSupportUserMessage(input: SupportInput): string {
  const spans =
    input.citedSpans.length === 0
      ? "(no cited spans)"
      : input.citedSpans.map((span, index) => `[span ${index + 1}]\n${span}`).join("\n\n");
  return [
    `entryId: ${input.entryId}`,
    `model: ${SUPPORT_MODEL}`,
    `promptVersion: ${SUPPORT_PROMPT_VERSION}`,
    "",
    "Entry text to grade:",
    input.entryText,
    "",
    "Cited spans (the ONLY evidence; grade against these):",
    spans,
  ].join("\n");
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null, attempt: number): number {
  const retryAfter = header === null ? NaN : Number(header);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

async function postChat(
  body: Record<string, unknown>,
  key: string,
  gated: readonly GatedText[],
  transport: "support",
  maxAttempts: number,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    // Every attempt (including retries) revalidates approval at the
    // transport boundary and records a receipt.
    const response = await dispatchGuarded(transport, gated, attempt + 1, () =>
      (fetchImpl ?? globalThis.fetch)(BRIEF_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ ...body, stream: true }),
      }),
    );
    if (response.status === 400) {
      const text = await response.text();
      throw new Error(`muse-spark request rejected (400, not retried; body ${Buffer.byteLength(text)} bytes)`);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= maxAttempts - 1) {
        const text = await response.text();
        throw new Error(`muse-spark request failed after retries (${response.status}; body ${Buffer.byteLength(text)} bytes)`);
      }
      await sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`muse-spark request failed (${response.status}, not retried; body ${Buffer.byteLength(text)} bytes)`);
    }
    return response;
  }
}

/** Accumulate a streamed SSE chat-completion body into content + usage. */
async function readStreamedChat(response: Response): Promise<{ content: string; usage: ChatResponse["usage"] }> {
  const chunks: string[] = [];
  let usage: ChatResponse["usage"] = {};
  const reader = response.body?.getReader();
  if (reader === undefined || reader === null) {
    throw new Error("muse-spark streaming response has no body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice("data:".length).trim();
        if (data === "[DONE]") {
          continue;
        }
        let event: {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: ChatResponse["usage"];
        };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          throw new Error(`muse-spark streaming response was not valid JSON (${data.length} chars)`);
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          chunks.push(delta);
        }
        if (event.usage !== undefined) {
          usage = event.usage;
        }
      }
    }
  }
  return { content: chunks.join(""), usage };
}

function parseGrade(content: string): { grade: SupportGrade; missingQualifier: string | null } {
  let parsed: { grade?: unknown; missing_qualifier?: unknown };
  try {
    parsed = JSON.parse(content) as { grade?: unknown; missing_qualifier?: unknown };
  } catch {
    throw new Error(`support judge returned unreadable JSON (${content.length} chars)`);
  }
  if (parsed.grade !== "supported" && parsed.grade !== "partial" && parsed.grade !== "unsupported") {
    throw new Error(`support judge returned invalid grade (content ${content.length} chars)`);
  }
  const missingQualifier =
    typeof parsed.missing_qualifier === "string" ? parsed.missing_qualifier : null;
  return { grade: parsed.grade, missingQualifier };
}

/** Live Spark judge. Never called without an API key and the cost-guard caps. */
export class SparkSupportJudge {
  readonly mode = "live" as const;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(opts?: { maxAttempts?: number; fetchImpl?: typeof fetch }) {
    const maxAttempts = opts?.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > SUPPORT_MAX_ATTEMPTS) {
      throw new Error(`maxAttempts must be an integer >= 1 and <= ${SUPPORT_MAX_ATTEMPTS}`);
    }
    this.maxAttempts = maxAttempts;
    this.fetchImpl = opts?.fetchImpl;
  }

  /**
   * Live Spark call. Entry text and cited spans must arrive as
   * gate-minted `GatedText` (via `gate.send` after owner review):
   * plain strings are rejected at runtime. All outbound analysis
   * goes through the privacy gate.
   */
  async gradeSupport(input: SupportGatedInput): Promise<SupportVerdict> {
    const key = apiKey();
    if (key === null) {
      throw new Error("live mode requires META_API_KEY; without the key, stay fixture-only");
    }
    const entryTextValue = requireLiveGatedText(input.entryText);
    const citedSpanValues = input.citedSpans.map((span) => requireLiveGatedText(span));
    const gatedValues: readonly GatedText[] = [entryTextValue, ...citedSpanValues];
    const entryText = entryTextValue.text;
    const citedSpans = citedSpanValues.map((span) => span.text);
    await checkCapsPreCall();
    const userMessage = buildSupportUserMessage({ entryId: input.entryId, entryText, citedSpans });
    checkPerCallTokenCap(
      Math.ceil((SUPPORT_DEVELOPER_PROMPT.length + userMessage.length) / 4),
      SUPPORT_MAX_COMPLETION_TOKENS,
    );
    const response = await postChat(
      {
        model: SUPPORT_MODEL,
        prompt_cache_key: PROMPT_CACHE_KEYS.support,
        reasoning_effort: "medium",
        seed: SUPPORT_SEED,
        max_completion_tokens: SUPPORT_MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: { name: "support_grade", strict: true, schema: SUPPORT_JSON_SCHEMA },
        },
        messages: [
          { role: "developer", content: SUPPORT_DEVELOPER_PROMPT },
          { role: "user", content: userMessage },
        ],
      },
      key,
      gatedValues,
      "support",
      this.maxAttempts,
      this.fetchImpl,
    );
    const { content, usage } = await readStreamedChat(response);
    const { grade, missingQualifier } = parseGrade(content);
    const verdictUsage: SupportUsage = {
      inputTokens: usage?.prompt_tokens ?? 0,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    await recordCall(verdictUsage, { model: SUPPORT_MODEL, promptVersion: SUPPORT_PROMPT_VERSION });
    return {
      entryId: input.entryId,
      grade,
      missingQualifier,
      overlap: lexicalOverlap(entryText, citedSpans),
      model: SUPPORT_MODEL,
      promptVersion: SUPPORT_PROMPT_VERSION,
      fixture: false,
      usage: verdictUsage,
    };
  }
}

export interface RecordedSupportFixture {
  /** Synthetic test doubles for offline runs; never model output. */
  syntheticFixture: boolean;
  model: string;
  promptVersion: string;
  verdicts: Record<string, { grade: SupportGrade; missingQualifier: string | null }>;
}

/**
 * Fixture judge: returns recorded grades keyed by entryId, attaching the
 * advisory lexical overlap computed live from the input. Fixture mode with
 * no matching verdict fails loudly instead of inventing a grade.
 */
export class FixtureSupportJudge implements SupportJudge {
  readonly mode = "fixture" as const;
  private readonly fixturePath: string;
  private cached: RecordedSupportFixture | null = null;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  private async load(): Promise<RecordedSupportFixture> {
    if (this.cached !== null) {
      return this.cached;
    }
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(this.fixturePath, "utf8");
    } catch {
      throw new Error(`fixture mode: no fixture file at ${this.fixturePath}`);
    }
    const parsed = JSON.parse(raw) as Partial<RecordedSupportFixture>;
    if (parsed.syntheticFixture !== true || typeof parsed.verdicts !== "object" || parsed.verdicts === null) {
      throw new Error(`fixture mode: ${this.fixturePath} is not a synthetic support fixture`);
    }
    this.cached = parsed as RecordedSupportFixture;
    return this.cached;
  }

  async gradeSupport(input: SupportInput): Promise<SupportVerdict> {
    const fixture = await this.load();
    const recorded = fixture.verdicts[input.entryId];
    if (recorded === undefined) {
      throw new Error(`fixture mode: no recorded verdict for entry ${input.entryId}`);
    }
    return {
      entryId: input.entryId,
      grade: recorded.grade,
      missingQualifier: recorded.missingQualifier,
      overlap: lexicalOverlap(input.entryText, input.citedSpans),
      model: fixture.model,
      promptVersion: fixture.promptVersion,
      fixture: true,
      usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    };
  }
}

/** Default judge: live only with an API key and explicit opt-in; else fixture.
 * `opts` (e.g. `sparkProofClientOptions(runConfig)`) is forwarded to the live client. */
export function defaultSupportJudge(
  fixturePath: string,
  opts?: { maxAttempts?: number; fetchImpl?: typeof fetch },
): SupportJudge | SparkSupportJudge {
  if (supportMode() === "live") {
    return new SparkSupportJudge(opts);
  }
  return new FixtureSupportJudge(fixturePath);
}
