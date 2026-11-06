/**
 * Spark pressure classifier: ONE batched call per meeting over all
 * redacted lines.
 *
 * - Model `muse-spark-1.3` (Standard mode, never `-contributor`) via
 *   POST https://api.meta.ai/v1/chat/completions, `developer` role,
 *   `response_format: {type:"json_schema", ...strict:true}`, sampling
 *   unset, fixed `seed` (best-effort), `max_completion_tokens` 16000.
 * - `reasoning_effort: "low"`.
 * - Caps and cost logging reuse the costGuard patterns: pre-call caps,
 *   per-call token guard, `recordCall` with `reasoning_tokens` logged.
 * - Retry 429/5xx with backoff + Retry-After; never retry a 400.
 * - Fixture mode is the default (EVIDENCE_BRIEF_MODE=live selects live).
 */
import type { PressureLabel, PressureTactic } from "@second-seat/core";
import { checkCapsPreCall, checkPerCallTokenCap, recordCall } from "../brief/costGuard.js";
import { PROMPT_CACHE_KEYS } from "../promptCache.js";
import { dispatchGuarded, requireLiveGatedText, type GatedText } from "../private/gate.js";

/** Development ceiling. The omitted default is 1, the proof cap. */
export const PRESSURE_MAX_ATTEMPTS = 4;

export const PRESSURE_MODEL = "muse-spark-1.3";
export const PRESSURE_PROMPT_VERSION = "pressure-v1";
export const PRESSURE_API_URL = "https://api.meta.ai/v1/chat/completions";
export const PRESSURE_MAX_COMPLETION_TOKENS = 16000;
export const PRESSURE_SEED = 42;

export interface ShieldLine {
  segmentId: string;
  text: string;
}

/**
 * Gated shield line: the text must be gate-minted `GatedText`
 * (reviewed redacted text from `gate.send`). Plain strings are
 * rejected at compile time and at runtime.
 */
export interface ShieldGatedLine {
  segmentId: string;
  text: GatedText;
}

export interface PressureClassifier {
  readonly mode: "fixture" | "live";
  classify(lines: ShieldLine[]): Promise<PressureLabel[]>;
}

export interface ShieldRecordedFile {
  recordedFromLiveCall: boolean;
  model: string;
  promptVersion: string;
  timestamp: string;
  rawText: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const PRESSURE_LABELS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["segmentId", "tactic", "ask", "target", "span"],
        properties: {
          segmentId: { type: "string" },
          tactic: {
            type: "string",
            enum: [
              "authority",
              "commitment",
              "liking",
              "reciprocity",
              "scarcity",
              "social_proof",
              "unity",
              "none",
            ],
          },
          ask: { type: "string" },
          target: { type: "string" },
          span: { type: "string" },
        },
      },
    },
  },
};

function apiKey(): string | null {
  const key = process.env["META_API_KEY"] ?? process.env["MUSE_API_KEY"] ?? "";
  return key === "" ? null : key;
}

export function shieldMode(): "fixture" | "live" {
  if ((process.env["EVIDENCE_BRIEF_MODE"] ?? "fixture") === "live") {
    if (apiKey() === null) {
      throw new Error("EVIDENCE_BRIEF_MODE=live but no API key (set META_API_KEY)");
    }
    return "live";
  }
  return "fixture";
}

async function loadPressurePrompt(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const candidates = [
    new URL("../../prompts/pressure-v1.txt", import.meta.url),
    new URL("../../../prompts/pressure-v1.txt", import.meta.url),
  ];
  const url = candidates.find((u) => existsSync(fileURLToPath(u))) ?? candidates[0]!;
  return readFile(url, "utf8");
}

function buildPressureUserMessage(lines: ShieldLine[]): string {
  const numbered = lines.map((line, index) => `${index + 1}. [${line.segmentId}] ${line.text}`);
  return [
    "Classify each numbered utterance for persuasion pressure. Respond with ONLY the JSON object.",
    "",
    "<lines>",
    ...numbered,
    "</lines>",
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
  transport: "shield",
  maxAttempts: number,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    // Every attempt (including retries) revalidates approval at the
    // transport boundary and records a receipt.
    const response = await dispatchGuarded(transport, gated, attempt + 1, () =>
      (fetchImpl ?? globalThis.fetch)(PRESSURE_API_URL, {
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
      throw new Error(`muse-spark pressure request rejected (400, not retried; body ${Buffer.byteLength(text)} bytes)`);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= maxAttempts - 1) {
        const text = await response.text();
        throw new Error(
          `muse-spark pressure request failed after retries (${response.status}; body ${Buffer.byteLength(text)} bytes)`,
        );
      }
      await sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`muse-spark pressure request failed (${response.status}, not retried; body ${Buffer.byteLength(text)} bytes)`);
    }
    return response;
  }
}

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
        let event: { choices?: Array<{ delta?: { content?: string } }>; usage?: ChatResponse["usage"] };
        try {
          event = JSON.parse(data) as typeof event;
        } catch {
          continue;
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

interface RawLabel {
  segmentId: string;
  tactic: PressureTactic;
  ask: string;
  target: string;
  span: string;
}

function parseLabels(rawText: string): PressureLabel[] {
  let parsed: { labels?: RawLabel[] };
  try {
    parsed = JSON.parse(rawText) as { labels?: RawLabel[] };
  } catch {
    throw new Error(`pressure response was not valid JSON (${rawText.length} chars)`);
  }
  if (!Array.isArray(parsed.labels)) {
    throw new Error("pressure response has no labels array");
  }
  return parsed.labels.map((label) => ({ ...label, source: "spark" as const }));
}

export interface SparkRawResult {
  labels: PressureLabel[];
  rawText: string;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number };
}

/** Live classifier: exactly ONE batched call over all redacted lines. */
export class SparkPressureClassifier {
  readonly mode = "live" as const;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(opts?: { maxAttempts?: number; fetchImpl?: typeof fetch }) {
    const maxAttempts = opts?.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > PRESSURE_MAX_ATTEMPTS) {
      throw new Error(`maxAttempts must be an integer >= 1 and <= ${PRESSURE_MAX_ATTEMPTS}`);
    }
    this.maxAttempts = maxAttempts;
    this.fetchImpl = opts?.fetchImpl;
  }

  /**
   * Live Spark call. Lines must arrive as gate-minted `GatedText`
   * (via `gate.send` after owner review): plain strings are rejected
   * at runtime. All outbound analysis goes through the privacy gate.
   */
  async classify(lines: ShieldGatedLine[]): Promise<PressureLabel[]> {
    return (await this.classifyRaw(lines)).labels;
  }

  /** Live call returning the raw response text so callers can record it. */
  async classifyRaw(lines: ShieldGatedLine[]): Promise<SparkRawResult> {
    const key = apiKey();
    if (key === null) {
      throw new Error("live mode requires META_API_KEY; without the key, stay fixture-only");
    }
    const gatedValues: readonly GatedText[] = lines.map((line) => requireLiveGatedText(line.text));
    const redacted = lines.map((line, index) => ({
      segmentId: line.segmentId,
      text: gatedValues[index]!.text,
    }));
    // Preflight order: the static pressure prompt loads before the dynamic
    // caps check reads its state file, so a prompt-read failure refuses the
    // call before any fetch with no dispatch receipt. Caps and token guards
    // still run before any network attempt.
    const [developerPrompt, userMessage] = await Promise.all([
      loadPressurePrompt(),
      Promise.resolve(buildPressureUserMessage(redacted)),
    ]);
    await checkCapsPreCall();
    const { logText } = await import("../private/payloadLog.js");
    logText(redacted.map((line) => `[${line.segmentId}] ${line.text}`).join("\n"));
    checkPerCallTokenCap(
      Math.ceil((developerPrompt.length + userMessage.length) / 4),
      PRESSURE_MAX_COMPLETION_TOKENS,
    );
    const response = await postChat(
      {
        model: PRESSURE_MODEL,
        prompt_cache_key: PROMPT_CACHE_KEYS.shield,
        reasoning_effort: "low",
        seed: PRESSURE_SEED,
        max_completion_tokens: PRESSURE_MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "pressure_labels",
            strict: true,
            schema: PRESSURE_LABELS_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: userMessage },
        ],
      },
      key,
      gatedValues,
      "shield",
      this.maxAttempts,
      this.fetchImpl,
    );
    const { content, usage } = await readStreamedChat(response);
    const usageRecord = {
      inputTokens: usage?.prompt_tokens ?? 0,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
    await recordCall(usageRecord, { model: PRESSURE_MODEL, promptVersion: PRESSURE_PROMPT_VERSION });
    return { labels: parseLabels(content), rawText: content, usage: usageRecord };
  }
}

/**
 * Fixture classifier: reads labels from a recorded file. Never hand-write
 * a file shown as model output: live-recorded files carry
 * `recordedFromLiveCall: true`.
 */
export class FixturePressureClassifier implements PressureClassifier {
  readonly mode = "fixture" as const;
  private readonly recordedPath: string;

  constructor(recordedPath: string) {
    this.recordedPath = recordedPath;
  }

  async classify(_lines: ShieldLine[]): Promise<PressureLabel[]> {
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(this.recordedPath, "utf8");
    } catch {
      throw new Error(`fixture mode: no recorded file at ${this.recordedPath}`);
    }
    const recorded = JSON.parse(raw) as ShieldRecordedFile;
    return parseLabels(recorded.rawText);
  }
}

export function defaultPressureClassifier(
  recordedPath: string,
  opts?: { maxAttempts?: number; fetchImpl?: typeof fetch },
): PressureClassifier | SparkPressureClassifier {
  if (shieldMode() === "live") {
    return new SparkPressureClassifier(opts);
  }
  return new FixturePressureClassifier(recordedPath);
}
