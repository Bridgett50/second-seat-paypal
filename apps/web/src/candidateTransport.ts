import { requireLiveGatedText, dispatchGuarded, type GatedText } from "@second-seat/bot/dist/src/private/gate.js";
import { BRIEF_API_URL, BRIEF_MODEL } from "@second-seat/bot/dist/src/brief/muse.js";
import {
  checkCapsPreCall as defaultCheckCapsPreCall,
  checkPerCallTokenCap as defaultCheckPerCallTokenCap,
  recordCall as defaultRecordCall,
  type CallUsage,
} from "@second-seat/bot/dist/src/brief/costGuard.js";
import type { CandidateSourceRef } from "./meetingRoom.js";

export const CANDIDATE_EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body", "sourceRefs"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
    sourceRefs: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["utteranceId", "revision"],
        properties: {
          utteranceId: { type: "string", minLength: 1 },
          revision: { type: "integer", minimum: 1 },
        },
      },
    },
  },
} as const;

export type CandidateEmail = { subject: string; body: string; sourceRefs: readonly CandidateSourceRef[] };

export class CandidateOutputError extends Error {
  readonly usage: CallUsage | null;
  constructor(message: string, usage: CallUsage | null) {
    super(message);
    this.usage = usage;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function parseUsage(raw: unknown): CallUsage | null {
  if (!isRecord(raw)) return null;
  const usage = raw["usage"];
  if (!isRecord(usage)) return null;
  const pt = usage["prompt_tokens"];
  const ct = usage["completion_tokens"];
  if (!isNonNegInt(pt) || !isNonNegInt(ct)) return null;
  let cached = 0;
  let reasoning = 0;
  const ptDetails = usage["prompt_tokens_details"];
  if (ptDetails !== undefined) {
    if (!isRecord(ptDetails)) return null;
    if (ptDetails["cached_tokens"] !== undefined) {
      if (!isNonNegInt(ptDetails["cached_tokens"])) return null;
      cached = ptDetails["cached_tokens"];
    }
  }
  const ctDetails = usage["completion_tokens_details"];
  if (ctDetails !== undefined) {
    if (!isRecord(ctDetails)) return null;
    if (ctDetails["reasoning_tokens"] !== undefined) {
      if (!isNonNegInt(ctDetails["reasoning_tokens"])) return null;
      reasoning = ctDetails["reasoning_tokens"];
    }
  }
  return { inputTokens: pt, cachedTokens: cached, outputTokens: ct, reasoningTokens: reasoning };
}

function validateCandidateEmail(parsed: unknown): CandidateEmail {
  if (!isRecord(parsed)) throw new Error("not object");
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 3 || keys[0] !== "body" || keys[1] !== "sourceRefs" || keys[2] !== "subject") throw new Error("wrong keys");
  const subject = parsed["subject"];
  const body = parsed["body"];
  const sourceRefs = parsed["sourceRefs"];
  if (typeof subject !== "string" || subject.trim() === "") throw new Error("bad subject");
  if (typeof body !== "string" || body.trim() === "") throw new Error("bad body");
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) throw new Error("bad sourceRefs");
  const out: CandidateSourceRef[] = [];
  for (const entry of sourceRefs) {
    if (!isRecord(entry)) throw new Error("bad sourceRefs entry");
    const ek = Object.keys(entry).sort();
    if (ek.length !== 2 || ek[0] !== "revision" || ek[1] !== "utteranceId") throw new Error("bad sourceRefs entry");
    const uid = entry["utteranceId"];
    const rev = entry["revision"];
    if (typeof uid !== "string" || uid.trim() === "") throw new Error("bad sourceRefs entry");
    if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev <= 0) throw new Error("bad sourceRefs entry");
    out.push({ utteranceId: uid, revision: rev });
  }
  return Object.freeze({ subject, body, sourceRefs: Object.freeze([...out]) });
}

export function createCandidateTransport(deps: {
  apiKey: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  maxInputChars?: number;
  preflight?: () => Promise<void>;
  checkCapsPreCall?: () => Promise<unknown>;
  checkPerCallTokenCap?: (inputTokens: number, outputTokens: number) => void;
  recordCall?: (usage: CallUsage, opts: { model: string; promptVersion: string }) => Promise<unknown>;
}): (gated: GatedText) => Promise<CandidateEmail> {
  const timeoutMs = deps.timeoutMs ?? 30000;
  const maxCompletionTokens = deps.maxCompletionTokens ?? 2000;
  const maxInputChars = deps.maxInputChars ?? 20000;
  if (typeof deps.apiKey !== "string" || deps.apiKey.trim() === "") throw new Error("invalid apiKey");
  for (const v of [timeoutMs, maxCompletionTokens, maxInputChars]) {
    if (!Number.isSafeInteger(v) || v <= 0) throw new RangeError("invalid limit");
  }
  const apiKey = deps.apiKey;
  const fetchImpl = deps.fetchImpl;
  const checkCapsPreCall = deps.checkCapsPreCall ?? defaultCheckCapsPreCall;
  const checkPerCallTokenCap = deps.checkPerCallTokenCap ?? defaultCheckPerCallTokenCap;
  const recordCall = deps.recordCall ?? defaultRecordCall;
  // future integration must reconcile the 10000ms default candidateDeadlineMs service deadline (apps/web/src/meetingRoom.ts ~L337) with this 30s transport timeout; this unit does NOT wire it.
  return async (gated: GatedText): Promise<CandidateEmail> => {
    requireLiveGatedText(gated);
    if (gated.text.length > maxInputChars) throw new Error("input too large");
    const inputBytes = new TextEncoder().encode(gated.text).length;
    checkPerCallTokenCap(inputBytes, maxCompletionTokens);
    await checkCapsPreCall();
    await deps.preflight?.();
    requireLiveGatedText(gated);
    const REQUEST = {
      model: BRIEF_MODEL,
      stream: false as const,
      reasoning_effort: "low" as const,
      max_completion_tokens: maxCompletionTokens,
      response_format: { type: "json_schema" as const, json_schema: { name: "candidate_email", strict: true, schema: CANDIDATE_EMAIL_SCHEMA } },
      messages: [{ role: "user" as const, content: gated.text }],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await dispatchGuarded("muse", [gated], 1, () =>
        fetchImpl(BRIEF_API_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(REQUEST),
          signal: controller.signal,
        }),
      );
      if (!res.ok) throw new Error(`candidate transport http ${res.status}`);
      const text = await res.text();
      let bodyJson: unknown;
      try { bodyJson = JSON.parse(text); } catch { throw new CandidateOutputError("candidate model output rejected: invalid json", null); }
      if (!isRecord(bodyJson)) throw new CandidateOutputError("candidate model output rejected: not object", null);
      const usage = parseUsage(bodyJson);
      if (usage === null) throw new CandidateOutputError("candidate model output rejected: usage unknown", null);
      await recordCall(usage, { model: BRIEF_MODEL, promptVersion: "candidate-none" });
      const choices = (bodyJson as Record<string, unknown>)["choices"];
      if (!Array.isArray(choices) || choices.length === 0) throw new CandidateOutputError("candidate model output rejected: missing choices", usage);
      const c0 = choices[0];
      if (!isRecord(c0)) throw new CandidateOutputError("candidate model output rejected: missing choices", usage);
      if (c0["finish_reason"] !== "stop") throw new CandidateOutputError("candidate model output rejected: finish_reason", usage);
      const message = c0["message"];
      if (!isRecord(message)) throw new CandidateOutputError("candidate model output rejected: missing message", usage);
      const content = message["content"];
      if (typeof content !== "string" || content.trim() === "") throw new CandidateOutputError("candidate model output rejected: empty content", usage);
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { throw new CandidateOutputError("candidate model output rejected: invalid json", usage); }
      try { return validateCandidateEmail(parsed); } catch { throw new CandidateOutputError("candidate model output rejected: bad email", usage); }
    } finally { clearTimeout(timer); }
  };
}
