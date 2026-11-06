/**
 * Muse Spark brief client.
 *
 * - `BriefClient` interface: live (`MuseClient`, via fetch) and recorded
 *   (`FixtureClient`) implementations share it.
 * - Model: `muse-spark-1.3` (Standard mode, never `-contributor`) via
 *   POST https://api.meta.ai/v1/chat/completions, `developer` role,
 *   `response_format: {type:"json_schema", ...strict:true}`, sampling unset,
 *   fixed `seed` (best-effort), `max_completion_tokens` 16000.
 * - Developer prompt + schema first, transcript last inside <data> tags.
 * - Retries 429/5xx with backoff + Retry-After; never retries a 400.
 * - Without an API key, only fixture mode is available.
 */
import { EVIDENCE_BRIEF_JSON_SCHEMA, PRESSURE_TACTICS } from "@second-seat/core";
import { PROMPT_CACHE_KEYS } from "../promptCache.js";
import { checkCapsPreCall, checkPerCallTokenCap, recordCall } from "./costGuard.js";
import { dispatchGuarded, requireLiveGatedText, type GatedText } from "../private/gate.js";

/** The one shared known-tactic list (from `@second-seat/core`). */
export { PRESSURE_TACTICS };

export const BRIEF_MODEL = "muse-spark-1.3";
export const BRIEF_PROMPT_VERSION = "brief-v2";
export const BRIEF_API_URL = "https://api.meta.ai/v1/chat/completions";
export const BRIEF_MAX_COMPLETION_TOKENS = 16000;
export const BRIEF_SEED = 42;

/**
 * Structured pressure label bound to the approved transcript. There is no
 * free-string assessment channel: the client validates each label (known
 * keys, known tactic, seg-N id bound to an existing segment, span quoted
 * verbatim from that segment) and renders the outbound assessment text
 * internally only from validated labels.
 */
export interface PressureLabelInput {
  segmentId: string;
  tactic: string;
  span: string;
}

/** Thrown (with `code "UNBOUND_ASSESSMENT"`) when a pressure label is not bound to the approved transcript. */
export class UnboundAssessmentError extends Error {
  override name = "UnboundAssessmentError";
  readonly code = "UNBOUND_ASSESSMENT";
  constructor(message: string) {
    super(message);
  }
}

const KNOWN_TACTICS: ReadonlySet<string> = new Set<string>(PRESSURE_TACTICS);

/** Top-level keys accepted on a brief input (gated or source). Anything else is rejected. */
const KNOWN_INPUT_KEYS: ReadonlySet<string> = new Set<string>([
  "meetingId",
  "transcriptText",
  "framesSidecarText",
  "fixtureMode",
  "pressureLabels",
]);

/** Keys accepted on a structured pressure label. Anything else is rejected. */
const KNOWN_LABEL_KEYS: ReadonlySet<string> = new Set<string>(["segmentId", "tactic", "span"]);

/**
 * Strict meeting-id charset: letters, digits, `-`, `_`, `.` only.
 * No `@`, no spaces, no path separators: the id is interpolated into the
 * outbound user message, so anything outside this charset is rejected
 * before any fetch.
 */
const MEETING_ID_RE = /^[A-Za-z0-9._-]+$/;

/** Segment ids name a numbered transcript segment: `seg-N`, nothing else. */
const SEGMENT_ID_RE = /^seg-(\d+)$/;

/** A bound quote must be at least this long: single characters never bind. */
const MIN_SPAN_LENGTH = 2;

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Split the approved transcript into its numbered segments: one per
 * non-empty trimmed line (`seg-1`, `seg-2`, ...), mirroring
 * `labelTranscriptSegments`. A leading `[seg-N]` marker on an already
 * labelled line is stripped so labelled and raw text segment identically.
 */
function transcriptSegments(transcriptText: string): string[] {
  const segments: string[] = [];
  for (const line of transcriptText.split("\n")) {
    const text = line.trim().replace(/^\[seg-\d+\]\s*/, "");
    if (text === "") continue;
    segments.push(text);
  }
  return segments;
}

/** True when `span` occurs in `segment` with word boundaries on both sides. */
function isWordBoundedQuote(segment: string, span: string): boolean {
  let from = 0;
  for (;;) {
    const idx = segment.indexOf(span, from);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : (segment[idx - 1] ?? "");
    const end = idx + span.length;
    const after = end >= segment.length ? "" : (segment[end] ?? "");
    if ((before === "" || !isWordChar(before)) && (after === "" || !isWordChar(after))) {
      return true;
    }
    from = idx + 1;
  }
}

/**
 * Reject any key outside `allowed` on a brief input or pressure label.
 * Throws `UnboundAssessmentError` so the rejection happens before any
 * fetch and before any dispatch receipt is recorded.
 */
function assertNoUnknownKeys(value: object, allowed: ReadonlySet<string>, what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new UnboundAssessmentError(`unbound brief input: unknown ${what} key ${JSON.stringify(key)}`);
    }
  }
}

/**
 * Legacy free-string assessment keys. They are never rendered or sent
 * (the outbound input is built explicitly from validated labels only);
 * they are dropped when the request already carries structured
 * `pressureLabels` (validated separately), and rejected as unknown keys
 * otherwise. Anything outside both the known keys and this set always
 * throws.
 */
const LEGACY_STRIPPED_KEYS: ReadonlySet<string> = new Set<string>(["pressureAssessment"]);

/**
 * Reject unknown top-level keys on a brief input, with the legacy
 * exemption above: a stale `pressureAssessment` string is dropped only
 * when structured labels are present to validate in its place. A legacy
 * field standing alone — or any other unknown key — throws
 * `UnboundAssessmentError` before any fetch and before any dispatch
 * receipt is recorded.
 */
function assertAllowedTopLevelKeys(input: object, pressureLabels: unknown): void {
  const unknownKeys = Object.keys(input).filter((key) => !KNOWN_INPUT_KEYS.has(key));
  if (unknownKeys.length === 0) return;
  const legacyOnly = unknownKeys.every((key) => LEGACY_STRIPPED_KEYS.has(key));
  if (legacyOnly && Array.isArray(pressureLabels)) return;
  throw new UnboundAssessmentError(
    `unbound brief input: unknown top-level key ${JSON.stringify(unknownKeys[0])}`,
  );
}

/**
 * Validate a meeting id against the strict id charset (letters, digits,
 * `-`, `_`, `.`; no `@`, no spaces). The id is interpolated into the
 * outbound user message, so anything else throws `UnboundAssessmentError`
 * before any fetch and before any dispatch receipt is recorded.
 */
function assertValidMeetingId(meetingId: unknown): void {
  if (typeof meetingId !== "string" || !MEETING_ID_RE.test(meetingId)) {
    throw new UnboundAssessmentError(
      `unbound brief input: invalid meetingId ${JSON.stringify(meetingId) ?? "missing"}`,
    );
  }
}

/**
 * Validate structured pressure labels against the approved transcript
 * text: every label must carry only known keys and name a known tactic.
 * G4a negative-result contract: a "none" label is an assessment-level
 * explicit negative. It is valid only when (a) it is the ONLY label in the
 * array, (b) its span is exactly "", and (c) its segmentId names an existing
 * seg-N segment. Any other "none" throws `UnboundAssessmentError` naming
 * "none". Every non-"none" label must name a `seg-N` segment id that refers
 * to an existing transcript segment, and carry a span (minimum length 2,
 * word-bounded) quoted verbatim from THAT segment — a substring of the
 * whole transcript is not enough.
 * Throws `UnboundAssessmentError` on the first unbound label, before any
 * fetch and before any dispatch receipt is recorded.
 */
export function assertBoundPressureLabels(
  labels: readonly PressureLabelInput[] | undefined,
  transcriptText: string,
): void {
  if (typeof transcriptText !== "string") {
    throw new UnboundAssessmentError("unbound pressure assessment: transcript is not a string");
  }
  const segments = transcriptSegments(transcriptText);
  const list = labels ?? [];
  for (const label of list) {
    if (typeof label !== "object" || label === null) {
      throw new UnboundAssessmentError("unbound pressure assessment: label is not an object");
    }
    assertNoUnknownKeys(label, KNOWN_LABEL_KEYS, "pressure label");
    const { segmentId, tactic, span } = label as {
      segmentId?: unknown;
      tactic?: unknown;
      span?: unknown;
    };
    if (typeof tactic !== "string" || !KNOWN_TACTICS.has(tactic)) {
      throw new UnboundAssessmentError(
        `unbound pressure assessment: unknown tactic ${JSON.stringify(tactic) ?? "missing"}`,
      );
    }
    if (tactic === "none") {
      if (list.length !== 1) {
        throw new UnboundAssessmentError(
          'unbound pressure assessment: invalid "none" assessment: a "none" label must be the only label',
        );
      }
      if (typeof span !== "string" || span !== "") {
        throw new UnboundAssessmentError(
          'unbound pressure assessment: invalid "none" assessment: span must be exactly ""',
        );
      }
      const noneMatch = typeof segmentId === "string" ? SEGMENT_ID_RE.exec(segmentId) : null;
      const noneIndex = noneMatch === null ? -1 : Number(noneMatch[1]) - 1;
      if (noneMatch === null || !(noneIndex >= 0 && noneIndex < segments.length)) {
        throw new UnboundAssessmentError(
          `unbound pressure assessment: invalid "none" assessment: unknown segment ${JSON.stringify(segmentId) ?? "missing"}`,
        );
      }
      continue;
    }
    const match = typeof segmentId === "string" ? SEGMENT_ID_RE.exec(segmentId) : null;
    const index = match === null ? -1 : Number(match[1]) - 1;
    if (match === null || !(index >= 0 && index < segments.length)) {
      throw new UnboundAssessmentError(
        `unbound pressure assessment: unknown segment ${JSON.stringify(segmentId) ?? "missing"}`,
      );
    }
    const segment = segments[index] ?? "";
    if (typeof span !== "string" || span.length < MIN_SPAN_LENGTH) {
      throw new UnboundAssessmentError("unbound pressure assessment: span is empty or too short to bind");
    }
    if (!segment.includes(span) || !isWordBoundedQuote(segment, span)) {
      throw new UnboundAssessmentError(
        "unbound pressure assessment: span is not quoted from its bound segment",
      );
    }
  }
}

/**
 * Render the outbound assessment text internally from validated labels
 * only: one {tactic, quote, segmentId} item per non-"none" label. "none"
 * labels and an empty array render as "[]" (the caller omits the section).
 */
export function renderPressureAssessment(labels: readonly PressureLabelInput[] | undefined): string {
  const items = (labels ?? [])
    .filter((l): l is PressureLabelInput => typeof l === "object" && l !== null && l.tactic !== "none")
    .map((l) => ({ tactic: l.tactic, quote: l.span, segmentId: l.segmentId }));
  return JSON.stringify(items);
}

export interface BriefSourceInput {
  meetingId: string;
  transcriptText: string;
  framesSidecarText: string;
  fixtureMode: boolean;
  pressureLabels?: PressureLabelInput[];
}

/**
 * Gated brief input: the transcript and frames sidecar must be
 * gate-minted `GatedText` (reviewed redacted text from `gate.send`).
 * Plain strings are rejected at compile time and at runtime.
 */
export interface BriefGatedInput {
  meetingId: string;
  transcriptText: GatedText;
  // Empty string means "no frames sidecar"; any non-empty sidecar must be
  // gate-minted GatedText like the transcript.
  framesSidecarText: GatedText | "";
  fixtureMode: boolean;
  /**
   * Optional structured pressure labels carried inside the single
   * owner-approved analysis request. Validated against the approved
   * transcript (known keys, known tactic, seg-N id bound to an existing
   * segment, span quoted verbatim from that segment) before any fetch;
   * rendered internally only from validated labels. No separate classifier
   * call.
   */
  pressureLabels?: PressureLabelInput[];
}

export interface BriefUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface BriefResult {
  rawText: string;
  usage: BriefUsage;
  model: string;
  promptVersion: string;
  fixture: boolean;
}

export interface BriefClient {
  readonly mode: "fixture" | "live";
  completeBrief(input: BriefSourceInput): Promise<BriefResult>;
}

function apiKey(): string | null {
  const key = process.env["META_API_KEY"] ?? process.env["MUSE_API_KEY"] ?? "";
  return key === "" ? null : key;
}

/** True when no API key is configured: fixture-only. */
export function isFixtureOnly(): boolean {
  return apiKey() === null;
}

export function briefMode(): "fixture" | "live" {
  if ((process.env["EVIDENCE_BRIEF_MODE"] ?? "fixture") === "live") {
    if (isFixtureOnly()) {
      throw new Error("EVIDENCE_BRIEF_MODE=live but no API key (set META_API_KEY)");
    }
    return "live";
  }
  return "fixture";
}

async function loadDeveloperPrompt(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const candidates = [
    new URL("../../prompts/brief-v2.txt", import.meta.url),
    new URL("../../../prompts/brief-v2.txt", import.meta.url),
  ];
  const url = candidates.find((u) => existsSync(fileURLToPath(u))) ?? candidates[0]!;
  return readFile(url, "utf8");
}

export async function buildUserMessage(input: BriefSourceInput): Promise<string> {
  // Strict input binding first: unknown top-level keys (a stale legacy
  // assessment string is dropped only when structured labels are present),
  // an off-charset meetingId, and unbound labels all throw before anything
  // is rendered, so this builder never interpolates raw ids or blindly
  // renders labels. Rendered internally only from validated labels (tactic
  // + quoted span from its bound segment). There is no free-string channel:
  // stray text never reaches the wire.
  assertAllowedTopLevelKeys(input, input.pressureLabels);
  assertValidMeetingId(input.meetingId);
  if (typeof input.transcriptText !== "string" || typeof input.framesSidecarText !== "string") {
    throw new UnboundAssessmentError("unbound brief input: transcript and frames sidecar must be strings");
  }
  if (input.pressureLabels !== undefined && !Array.isArray(input.pressureLabels)) {
    throw new UnboundAssessmentError("unbound pressure assessment: pressureLabels is not an array");
  }
  assertBoundPressureLabels(input.pressureLabels ?? [], input.transcriptText);
  const assessment = renderPressureAssessment(input.pressureLabels);
  return [
    `meetingId: ${input.meetingId}`,
    `model: ${BRIEF_MODEL}`,
    `promptVersion: ${BRIEF_PROMPT_VERSION}`,
    `fixtureMode: ${String(input.fixtureMode)}`,
    "",
    "JSON Schema the output must match (strict):",
    JSON.stringify(EVIDENCE_BRIEF_JSON_SCHEMA),
    "",
    "<data>",
    "frames sidecar (frames.txt):",
    input.framesSidecarText.trim() === "" ? "(no frames)" : input.framesSidecarText,
    "",
    ...(assessment === "[]" ? [] : ["pressure assessment:", assessment, ""]),
    "transcript (transcript.txt) — the evidence, last:",
    input.transcriptText,
    "</data>",
  ].join("\n");
}

export async function buildRedactedUserMessage(input: BriefSourceInput): Promise<string> {
  const { createPrivacyGate, GateApprovalError } = await import("../private/gate.js");
  const { logText, setRedactorLabel } = await import("../private/payloadLog.js");
  const { GLIMMER_MODEL, MOCK_LABEL } = await import("../private/redact.js");
  // Live for explicit live input or EVIDENCE_BRIEF_MODE=live: the gate then
  // uses its Glimmer redactor and throws before any fetch when
  // GLIMMER_BASE_URL is unset. No direct redactor path: the text below comes
  // only from gate.send's GatedText. (An ambient API key alone does not imply
  // live: explicit fixture input stays fixture.)
  const live = !input.fixtureMode || briefMode() === "live";
  const gate = createPrivacyGate({ mode: live ? "live" : "fixture" });
  if (live) {
    throw new GateApprovalError("live brief requests require owner review in the web session; auto-approval is disabled");
  }
  setRedactorLabel(live ? `Glimmer: ${GLIMMER_MODEL}` : MOCK_LABEL);
  const prepared = await gate.prepare(input.transcriptText);
  logText(prepared.redactedText);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) =>
    buildUserMessage({ ...input, transcriptText: gated.text }),
  );
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
  transport: "muse",
  fetchImpl?: typeof fetch,
  maxAttempts = 4,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    // Every attempt (including retries) revalidates approval at the
    // transport boundary and records a receipt. `fetch` is read here at
    // call time so a test-installed global applies to every attempt.
    const response = await dispatchGuarded(transport, gated, attempt + 1, () =>
      (fetchImpl ?? fetch)(BRIEF_API_URL, {
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
      throw new Error(`muse-spark request rejected (400, not retried): ${text.slice(0, 500)}`);
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= maxAttempts - 1) {
        const text = await response.text();
        throw new Error(`muse-spark request failed after retries (${response.status}): ${text.slice(0, 500)}`);
      }
      await sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`muse-spark request failed (${response.status}, not retried): ${text.slice(0, 500)}`);
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

/**
 * Prefix each non-empty trimmed line of gate-approved text with its
 * session segment id ("[seg-N] ", numbered like the session segments).
 * Deterministic transform of the gated text only: nothing else is added.
 */
export function labelTranscriptSegments(gatedText: string): string {
  const lines: string[] = [];
  let n = 0;
  for (const line of gatedText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    n += 1;
    lines.push(`[seg-${n}] ${trimmed}`);
  }
  return lines.join("\n");
}

export class MuseClient {
  readonly mode = "live" as const;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly labelSegments: boolean;
  private readonly maxAttempts: number;
  private readonly preflightHook: (() => Promise<void>) | undefined;

  constructor(opts?: {
    fetchImpl?: typeof fetch;
    labelTranscriptSegments?: boolean;
    maxAttempts?: number;
    /**
     * Extra preflight step, awaited after the built-in preflight and
     * before the approval re-check. Tests use a deferred promise here to
     * hold the preflight window while revoking approval.
     */
    preflight?: () => Promise<void>;
  }) {
    this.fetchImpl = opts?.fetchImpl;
    this.labelSegments = opts?.labelTranscriptSegments ?? false;
    this.maxAttempts = opts?.maxAttempts ?? 4;
    this.preflightHook = opts?.preflight;
  }

  /**
   * Live Spark call. The transcript and frames sidecar must arrive as
   * gate-minted `GatedText` (via `gate.send` after owner review):
   * plain strings are rejected at runtime (an empty sidecar string means
   * "no frames"). All outbound analysis goes through the privacy gate;
   * this method never redacts or approves raw text itself.
   */
  async completeBrief(input: BriefGatedInput): Promise<BriefResult> {
    // Strict pre-fetch input binding: unknown top-level keys (a stale
    // legacy assessment string is dropped only when structured labels are
    // present; there is no free-string channel either way) and an
    // off-charset meetingId throw here, before any fetch and before any
    // dispatch receipt is recorded.
    assertAllowedTopLevelKeys(input, input.pressureLabels);
    assertValidMeetingId(input.meetingId);
    if (input.pressureLabels !== undefined && !Array.isArray(input.pressureLabels)) {
      throw new UnboundAssessmentError("unbound pressure assessment: pressureLabels is not an array");
    }
    const key = apiKey();
    if (key === null) {
      throw new Error("live mode requires META_API_KEY; without the key, stay fixture-only");
    }
    const gatedTranscriptValue = requireLiveGatedText(input.transcriptText);
    const gatedTranscript = gatedTranscriptValue.text;
    // The model can only cite seg-N ids it has seen: send the gated text
    // with each non-empty line prefixed by its segment id.
    const transcriptText = this.labelSegments ? labelTranscriptSegments(gatedTranscript) : gatedTranscript;
    const framesSidecarValue =
      input.framesSidecarText === "" ? null : requireLiveGatedText(input.framesSidecarText);
    const framesSidecarText = framesSidecarValue === null ? "" : framesSidecarValue.text;
    const gatedValues: readonly GatedText[] =
      framesSidecarValue === null ? [gatedTranscriptValue] : [gatedTranscriptValue, framesSidecarValue];
    // Bound assessment first: every label must carry only known keys,
    // name a known tactic, bind a seg-N id to an existing segment, and
    // quote that segment verbatim (min length, word-bounded). Throws
    // UNBOUND_ASSESSMENT before any fetch and before any dispatch receipt
    // is recorded. The input is built explicitly so no free-string channel
    // can reach the wire.
    const labels = Array.isArray(input.pressureLabels) ? input.pressureLabels : [];
    assertBoundPressureLabels(labels, gatedTranscript);
    const redactedInput: BriefSourceInput = {
      meetingId: input.meetingId,
      transcriptText,
      framesSidecarText,
      fixtureMode: input.fixtureMode,
      pressureLabels: labels,
    };
    // Preflight order: the static developer prompt loads before the dynamic
    // caps check reads its state file, so a prompt-read failure refuses the
    // call before any fetch with no dispatch receipt. Caps and token guards
    // still run before any network attempt.
    const [developerPrompt, userMessage] = await Promise.all([loadDeveloperPrompt(), buildUserMessage(redactedInput)]);
    await checkCapsPreCall();
    const { logText } = await import("../private/payloadLog.js");
    logText(`${transcriptText}\n${framesSidecarText}`);
    // Rough pre-call guard: ~4 chars per token.
    checkPerCallTokenCap(Math.ceil((developerPrompt.length + userMessage.length) / 4), BRIEF_MAX_COMPLETION_TOKENS);
    await this.preflightHook?.();
    // Re-check gate approval immediately before fetch, after every awaited
    // preflight step: a revoke or edit during a held preflight throws here
    // with zero requests. (dispatchGuarded revalidates again per attempt.)
    requireLiveGatedText(gatedTranscriptValue);
    if (framesSidecarValue !== null) {
      requireLiveGatedText(framesSidecarValue);
    }
    const startedAt = Date.now();
    void startedAt;
    const response = await postChat(
      {
        model: BRIEF_MODEL,
        prompt_cache_key: PROMPT_CACHE_KEYS.brief,
        reasoning_effort: "medium",
        seed: BRIEF_SEED,
        max_completion_tokens: BRIEF_MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "evidence_brief",
            strict: true,
            schema: EVIDENCE_BRIEF_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: userMessage },
        ],
      },
      key,
      gatedValues,
      "muse",
      this.fetchImpl,
      this.maxAttempts,
    );
    const { content, usage } = await readStreamedChat(response);
    const result: BriefResult = {
      rawText: content,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
      model: BRIEF_MODEL,
      promptVersion: BRIEF_PROMPT_VERSION,
      fixture: false,
    };
    await recordCall(result.usage, { model: result.model, promptVersion: result.promptVersion });
    return result;
  }
}

export interface RecordedFixture {
  recordedFromLiveCall: boolean;
  model: string;
  promptVersion: string;
  timestamp: string;
  rawText: string;
  usage: BriefUsage;
}

/**
 * Fixture client: returns a recorded response from a logged live call.
 * Never hand-write a fixture shown as model output: the file must carry
 * `recordedFromLiveCall: true`. Fixture mode with no fixture file fails.
 */
export class FixtureClient implements BriefClient {
  readonly mode = "fixture" as const;
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async completeBrief(_input: BriefSourceInput): Promise<BriefResult> {
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(this.fixturePath, "utf8");
    } catch {
      throw new Error(`fixture mode: no fixture file at ${this.fixturePath}`);
    }
    const recorded = JSON.parse(raw) as Partial<RecordedFixture>;
    if (recorded.recordedFromLiveCall !== true || typeof recorded.rawText !== "string") {
      throw new Error(`fixture mode: ${this.fixturePath} is not a recorded live response`);
    }
    const usage: BriefUsage = {
      inputTokens: recorded.usage?.inputTokens ?? 0,
      cachedTokens: recorded.usage?.cachedTokens ?? 0,
      outputTokens: recorded.usage?.outputTokens ?? 0,
      reasoningTokens: recorded.usage?.reasoningTokens ?? 0,
    };
    await recordCall(usage, {
      model: recorded.model ?? "unknown",
      promptVersion: recorded.promptVersion ?? "unknown",
      fixture: true,
    });
    return {
      rawText: recorded.rawText,
      usage,
      model: recorded.model ?? "unknown",
      promptVersion: recorded.promptVersion ?? BRIEF_PROMPT_VERSION,
      fixture: true,
    };
  }
}

/** Default client: fixture unless EVIDENCE_BRIEF_MODE=live with a key. */
export function defaultBriefClient(fixturePath: string): BriefClient | MuseClient {
  if (briefMode() === "live") {
    return new MuseClient();
  }
  return new FixtureClient(fixturePath);
}
