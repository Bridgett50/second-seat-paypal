/**
 * SAM 3.1 shared-content segmentation (Phase 07).
 *
 * - `segmentShared(frame, concept)` with concept "slide" | "document" |
 *   "whiteboard" (default "slide"). Fixture mode is the default (no network).
 * - Live mode: POST https://api.meta.ai/v1/responses, model `sam-3.1`, one
 *   `input_text` noun phrase + `input_image`, Bearer MODEL_API_KEY.
 * - Live mode is experimental, outside the text-only core flow, and off by
 *   default (requires SECOND_SEAT_EXPERIMENTAL_IMAGES=1).
 * - Only the 04a-masked image is ever sent. If masking fails, the frame is
 *   dropped: an unmasked frame is never sent.
 * - String model output parses with the official `@meta-sam/parser` via
 *   parseImageStream/recordsOfKind; legacy fixture objects use a small local
 *   parser (x2/y2 inclusive, mask_encoding "one_bit").
 * - Confidence comes from request metadata.include_confidence (see
 *   meta-docs/sam/segmenting.md "Confidence scores") and surfaces as
 *   SamBox.confidence when the model returns it.
 * - Every returned box is clamped/verified inside the frame; zero matches ->
 *   full-frame box + flag `region_spotcheck_failed`.
 * - Without an API key, only fixture mode is available. Never prints the key.
 */

import { parseImageStream, recordsOfKind } from "@meta-sam/parser";

export const SAM_MODEL = "sam-3.1";
export const SAM_API_URL = "https://api.meta.ai/v1/responses";

export type SamConcept = "slide" | "document" | "whiteboard";

export interface SamFrame {
  /** Frame identifier (for logs/fixtures). */
  id: string;
  /** Image width in pixels. Must match the sent PNG pixels. */
  width: number;
  /** Image height in pixels. Must match the sent PNG pixels. */
  height: number;
  /** The 04a-masked PNG bytes. Only this is sent to the model. */
  png: Buffer;
}

export interface SamBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detection confidence (0..1) when the model returned it. */
  confidence?: number;
}

export interface SamResult {
  boxes: SamBox[];
  flags: string[];
  /** Raw model output (saved as a fixture for proof). */
  raw: unknown;
  model: string;
  fixture: boolean;
  /** Which parser produced `boxes`. */
  parser: "@meta-sam/parser" | "local";
}

export interface SamClient {
  readonly mode: "fixture" | "live";
  segmentShared(frame: SamFrame, concept?: SamConcept): Promise<SamResult>;
}

const CONCEPT_PHRASE: Record<SamConcept, string> = {
  slide: "slide",
  document: "document",
  whiteboard: "whiteboard",
};

function apiKey(): string | null {
  const key =
    process.env["MODEL_API_KEY"] ??
    process.env["META_API_KEY"] ??
    process.env["MUSE_API_KEY"] ??
    "";
  return key === "" ? null : key;
}

/** True when no API key is configured: fixture-only. */
export function isSamFixtureOnly(): boolean {
  return apiKey() === null;
}

/**
 * SAM segmentation is experimental, outside the text-only core flow, and off
 * by default. Live calls require SECOND_SEAT_EXPERIMENTAL_IMAGES=1.
 */
export function imagesExperimentalEnabled(): boolean {
  return process.env["SECOND_SEAT_EXPERIMENTAL_IMAGES"] === "1";
}

export function nounPhrase(concept: SamConcept): string {
  return CONCEPT_PHRASE[concept];
}

function clampBox(b: SamBox, frame: SamFrame): SamBox | null {
  const x = Math.max(0, Math.min(frame.width - 1, Math.floor(b.x)));
  const y = Math.max(0, Math.min(frame.height - 1, Math.floor(b.y)));
  const xEnd = Math.max(0, Math.min(frame.width, Math.ceil(b.x + b.w)));
  const yEnd = Math.max(0, Math.min(frame.height, Math.ceil(b.y + b.h)));
  const w = xEnd - x;
  const h = yEnd - y;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const out: SamBox = { x, y, w, h };
  if (typeof b.confidence === "number") out.confidence = b.confidence;
  return out;
}

/** Clamp every box inside the frame; drop degenerate ones. */
export function clampBoxes(boxes: SamBox[], frame: SamFrame): SamBox[] {
  const out: SamBox[] = [];
  for (const b of boxes) {
    const c = clampBox(b, frame);
    if (c !== null) out.push(c);
  }
  return out;
}

export function fullFrameBox(frame: SamFrame): SamBox {
  return { x: 0, y: 0, w: frame.width, h: frame.height };
}

interface RawBoxInclusive {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function parseBoxParams(params: string, out: SamBox[]): void {
  const nums: Record<string, number> = {};
  for (const m of params.matchAll(/(x1|y1|x2|y2|w|h)=(\d+)/g)) nums[m[1]!] = Number(m[2]);
  if (isNum(nums["x1"]) && isNum(nums["y1"]) && isNum(nums["x2"]) && isNum(nums["y2"])) {
    const w = (nums["x2"] as number) - (nums["x1"] as number) + 1;
    const h = (nums["y2"] as number) - (nums["y1"] as number) + 1;
    if (w > 0 && h > 0) out.push({ x: nums["x1"] as number, y: nums["y1"] as number, w, h });
  }
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Collect candidate raw box objects from common SAM output shapes. */
function candidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const v = value as Record<string, unknown>;
  for (const key of ["boxes", "regions", "masks", "data", "output"]) {
    if (Array.isArray(v[key])) return v[key] as unknown[];
  }
  const output = v["output"];
  if (typeof output === "object" && output !== null) {
    const o = output as Record<string, unknown>;
    for (const key of ["boxes", "regions", "masks", "data"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

/**
 * Small local SAM parser: accepts {x1,y1,x2,y2} (x2/y2 INCLUSIVE) or
 * {x,y,w,h} / {box:[x1,y1,x2,y2]} shapes. Inclusive edges convert with
 * w = x2 - x1 + 1. `mask_encoding: "one_bit"` is accepted and otherwise
 * ignored for geometry.
 */
export function parseSamBoxesLocal(raw: unknown): SamBox[] {
  const out: SamBox[] = [];
  if (typeof raw === "string") {
    for (const m of raw.matchAll(/<\|box;([^|]*)\|>/g)) parseBoxParams(m[1] ?? "", out);
    // Fallback when the regex above finds nothing (kept simple on purpose).
    for (const m of raw.matchAll(/x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+)/g)) {
      if (out.length > 0) break;
      const x1 = Number(m[1]);
      const y1 = Number(m[2]);
      const x2 = Number(m[3]);
      const y2 = Number(m[4]);
      const w = x2 - x1 + 1;
      const h = y2 - y1 + 1;
      if (w > 0 && h > 0) out.push({ x: x1, y: y1, w, h });
    }
    return out;
  }
  for (const c of candidates(raw)) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    const boxed = (
      Array.isArray(o["box"]) ? (o["box"] as unknown[]) : null
    ) as unknown;
    const src: Record<string, unknown> =
      boxed !== null && Array.isArray(boxed) && boxed.length === 4
        ? { x1: boxed[0], y1: boxed[1], x2: boxed[2], y2: boxed[3] }
        : o;
    if (isNum(src["x1"]) && isNum(src["y1"]) && isNum(src["x2"]) && isNum(src["y2"])) {
      const b = src as unknown as RawBoxInclusive;
      const w = b.x2 - b.x1 + 1;
      const h = b.y2 - b.y1 + 1;
      if (w > 0 && h > 0) out.push({ x: b.x1, y: b.y1, w, h });
      continue;
    }
    if (isNum(src["x"]) && isNum(src["y"]) && isNum(src["w"]) && isNum(src["h"])) {
      const w = src["w"] as number;
      const h = src["h"] as number;
      if (w > 0 && h > 0) out.push({ x: src["x"] as number, y: src["y"] as number, w, h });
    }
  }
  return out;
}

async function* outputTextEvents(text: string) {
  const lane = { item_id: "sam-official", output_index: 0, content_index: 0 } as const;
  yield { type: "response.output_text.delta", ...lane, delta: text };
  yield { type: "response.output_text.done", ...lane, text };
  yield { type: "response.completed" };
}

/**
 * The official "box" record shape (right/bottom half-open:
 * right = wire x2 + 1). Structural so both parser call sites share the
 * toSamBox helper below without importing package types.
 */
export interface OfficialBoxRecord {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly confidence?: number;
}

export function toSamBox(record: OfficialBoxRecord): SamBox {
  const box: SamBox = {
    x: record.left,
    y: record.top,
    w: record.right - record.left,
    h: record.bottom - record.top,
  };
  if (typeof record.confidence === "number") box.confidence = record.confidence;
  return box;
}

/**
 * Parse official SAM wire text with `@meta-sam/parser`: wrap the text as
 * response output-text events, run parseImageStream, and map "box" records
 * with toSamBox.
 */
export async function parseSamOutputOfficial(text: string): Promise<SamBox[]> {
  const parsed = parseImageStream(outputTextEvents(text));
  for await (const _ of parsed) {
    /* drain the snapshot stream; the result accumulates in finalResult */
  }
  const result = await parsed.finalResult;
  return recordsOfKind(result.records, "box").map(toSamBox);
}

/** A parsed SSE `data:` payload: any JSON object the official parser accepts. */
export interface SamStreamEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

async function* eventStream(events: SamStreamEvent[]): AsyncGenerator<SamStreamEvent, void, void> {
  for (const event of events) yield event;
}

/**
 * Parse a live Responses SSE body into event objects (one per `data:` line;
 * `[DONE]` and non-JSON lines skipped) for the official parser, which accepts
 * deltas, `response.output_text.done`, and `response.content_part.done`.
 */
export function parseSseEvents(sseText: string): SamStreamEvent[] {
  const events: SamStreamEvent[] = [];
  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as unknown;
      if (typeof evt === "object" && evt !== null) {
        events.push(evt as SamStreamEvent);
      }
    } catch {
      /* non-JSON keepalive: ignore */
    }
  }
  return events;
}

/**
 * Parse a live SSE body straight through the official parser (same box
 * mapping as parseSamOutputOfficial). The live SAM API finalizes the output
 * text lane with `response.content_part.done`, which delta-only collection
 * misses. Parser errors propagate to the caller; they are never swallowed
 * into a full-frame fallback here.
 */
export async function parseSamLiveStream(sseText: string): Promise<SamBox[]> {
  const parsed = parseImageStream(eventStream(parseSseEvents(sseText)));
  for await (const _ of parsed) {
    /* drain the snapshot stream; the result accumulates in finalResult */
  }
  const result = await parsed.finalResult;
  return recordsOfKind(result.records, "box").map(toSamBox);
}

/**
 * A string raw (official wire text) goes through the official parser; a
 * non-string legacy fixture object goes to the local parser.
 */
export async function parseSamBoxes(
  raw: unknown,
): Promise<{ boxes: SamBox[]; parser: "@meta-sam/parser" | "local" }> {
  if (typeof raw === "string") {
    return { boxes: await parseSamOutputOfficial(raw), parser: "@meta-sam/parser" };
  }
  return { boxes: parseSamBoxesLocal(raw), parser: "local" };
}

/** Zero matches -> full-frame citation + `region_spotcheck_failed`. */
export function withFallback(
  boxes: SamBox[],
  frame: SamFrame,
  raw: unknown,
  model: string,
  fixture: boolean,
  parser: "@meta-sam/parser" | "local" = "local",
): SamResult {
  const kept = clampBoxes(boxes, frame);
  if (kept.length === 0) {
    return {
      boxes: [fullFrameBox(frame)],
      flags: ["region_spotcheck_failed"],
      raw,
      model,
      fixture,
      parser,
    };
  }
  return { boxes: kept, flags: [], raw, model, fixture, parser };
}

export function buildRequestBody(frame: SamFrame, concept: SamConcept): Record<string, unknown> {
  return {
    model: SAM_MODEL,
    stream: true,
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: nounPhrase(concept) },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${frame.png.toString("base64")}`,
          },
        ],
      },
    ],
  };
}

/** Concatenate `response.output_text.delta` deltas from an SSE stream body. */
export function collectOutputTextDeltas(sseText: string): string {
  let out = "";
  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: unknown };
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
        out += evt.delta;
      }
    } catch {
      /* non-JSON keepalive: ignore */
    }
  }
  return out;
}

async function errorSnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

async function postResponses(body: Record<string, unknown>, key: string): Promise<string> {
  const res = await fetch(SAM_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const snippet = await errorSnippet(res);
    throw new Error(`sam: live call failed with status ${res.status}: ${snippet}`);
  }
  return res.text();
}

export class FixtureSamClient implements SamClient {
  readonly mode = "fixture" as const;
  private fixtureRaw: unknown;

  constructor(fixtureRaw?: unknown) {
    this.fixtureRaw =
      fixtureRaw ??
      "<0f>0<|box;x1=200;y1=140;x2=259;y2=166;w=800;h=400;c=0.87|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
  }

  async segmentShared(frame: SamFrame, concept: SamConcept = "slide"): Promise<SamResult> {
    void concept;
    const { boxes, parser } = await parseSamBoxes(this.fixtureRaw);
    return withFallback(boxes, frame, this.fixtureRaw, SAM_MODEL, true, parser);
  }
}

export class LiveSamClient implements SamClient {
  readonly mode = "live" as const;

  async segmentShared(frame: SamFrame, concept: SamConcept = "slide"): Promise<SamResult> {
    if (!imagesExperimentalEnabled()) {
      throw new Error("sam: experimental and off by default (set SECOND_SEAT_EXPERIMENTAL_IMAGES=1)");
    }
    const key = apiKey();
    if (key === null) throw new Error("sam: live mode but no API key (set MODEL_API_KEY)");
    const sseText = await postResponses(buildRequestBody(frame, concept), key);
    const boxes = await parseSamLiveStream(sseText);
    return withFallback(boxes, frame, sseText, SAM_MODEL, false, "@meta-sam/parser");
  }
}

/** Fixture mode default; live only when SAM_MODE=live with an API key and SECOND_SEAT_EXPERIMENTAL_IMAGES=1. */
export function defaultSamClient(fixtureRaw?: unknown): SamClient {
  if ((process.env["SAM_MODE"] ?? "fixture") === "live") {
    if (!imagesExperimentalEnabled()) {
      throw new Error("sam: experimental and off by default (set SECOND_SEAT_EXPERIMENTAL_IMAGES=1)");
    }
    if (isSamFixtureOnly()) throw new Error("sam: SAM_MODE=live but no API key (set MODEL_API_KEY)");
    return new LiveSamClient();
  }
  return new FixtureSamClient(fixtureRaw);
}
