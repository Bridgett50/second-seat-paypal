/**
 * Server-side privacy gate: every outbound analysis request passes here.
 *
 * Flow: prepare(rawText) -> preview/correct -> approve -> send.
 * Raw text is sent ONLY to the Glimmer redactor. Spark/Muse endpoints
 * receive only reviewed redacted text via gate.send's sendFn callback,
 * which is handed a `GatedText` value that only this module can mint.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  GateConfigError,
  GlimmerClient,
  MOCK_LABEL,
  MockRedactor,
  maskText,
  validateGlimmerReply,
  type Redactor,
  type TextSpan,
} from "./redact.js";
import { normalizePiiText, preparePiiScanText } from "@second-seat/core";

export { GateConfigError };

export const APPROVAL_TTL_MS = 15 * 60 * 1000;
export const GLIMMER_BASE_URL_ENV = "GLIMMER_BASE_URL";

export class GateApprovalError extends Error {
  override name = "GateApprovalError";
}

export class ResidualPIIError extends Error {
  override name = "ResidualPIIError";
}

const MINT = Symbol("gate-mint");

/**
 * Truthful dispatch record written at the transport boundary by
 * `dispatchGuarded`, not on entry into an adapter. `dispatchedAt` is the
 * ISO timestamp of the gate clock at the moment fetch is invoked;
 * `attempt` is 1-based. `httpStatus` is present once a response arrives
 * and omitted while the outcome is unknown (`invoked`) or the transport
 * itself failed.
 */
export type DispatchReceipt = {
  transport: "muse" | "shield" | "support";
  runId: string;
  revision: number;
  payloadHash: string;
  dispatchedAt: string;
  attempt: number;
  outcome: "invoked" | "provider_confirmed" | "http_error" | "transport_failed";
  httpStatus?: number;
};

interface GateBinding {
  mode: "live" | "fixture";
  runId: string;
  revision: number;
  textHash: string;
  expiresAt: number;
  isCurrent: () => boolean;
  now: () => number;
  record: (receipt: DispatchReceipt) => void;
}

const bindings = new WeakMap<GatedText, GateBinding>();

/**
 * Branded text that has completed the full gate flow (redact, review,
 * approve, residual checks). Only constructible inside this module via
 * the module-private `MINT` symbol, which `send` alone holds.
 * Spark-calling functions take this instead of `string`; pass a plain
 * string and they throw.
 */
export class GatedText {
  private _text: string;

  get text(): string {
    return this._text;
  }

  set text(_value: string) {
    // Tamper-evident: keep the approved text but permanently invalidate the
    // binding, so any runtime write attempt rejects this value afterwards.
    // Object.freeze below does not disable this prototype setter.
    bindings.delete(this);
  }

  constructor(mint: unknown, text: string) {
    if (mint !== MINT) {
      throw new GateApprovalError("refusing to send text that did not come from gate.send: approval required");
    }
    this._text = text;
    Object.freeze(this);
  }
}

/**
 * Revalidate approval at the transport boundary and record a truthful
 * dispatch receipt. Synchronously (no await before `doFetch` is invoked):
 * every gated value is revalidated with `requireLiveGatedText` (throws
 * `GateApprovalError` when revoked, expired, stale, forged, fixture-mode,
 * or mutated), then one `invoked` receipt per distinct run is recorded via
 * the binding's `record` sink, then `doFetch()` is invoked. On resolve each
 * receipt becomes `provider_confirmed` (response.ok) or `http_error` with
 * the response status; on throw each becomes `transport_failed` and the
 * error is rethrown. Mutating the recorded receipt objects in place keeps
 * the stored history exact.
 */
export function dispatchGuarded(
  transport: DispatchReceipt["transport"],
  gated: readonly GatedText[],
  attempt: number,
  doFetch: () => Promise<Response>,
): Promise<Response> {
  for (const value of gated) {
    requireLiveGatedText(value);
  }
  const distinct = new Map<string, GateBinding>();
  for (const value of gated) {
    const binding = bindings.get(value);
    if (binding !== undefined && !distinct.has(binding.runId)) {
      distinct.set(binding.runId, binding);
    }
  }
  const pending: DispatchReceipt[] = [];
  for (const binding of distinct.values()) {
    const receipt: DispatchReceipt = {
      transport,
      runId: binding.runId,
      revision: binding.revision,
      payloadHash: binding.textHash,
      dispatchedAt: new Date(binding.now()).toISOString(),
      attempt,
      outcome: "invoked",
    };
    binding.record(receipt);
    pending.push(receipt);
  }
  let fetched: Promise<Response>;
  try {
    fetched = doFetch();
  } catch (err) {
    for (const receipt of pending) {
      receipt.outcome = "transport_failed";
    }
    throw err;
  }
  return fetched.then(
    (response) => {
      for (const receipt of pending) {
        receipt.outcome = response.ok ? "provider_confirmed" : "http_error";
        receipt.httpStatus = response.status;
      }
      return response;
    },
    (err: unknown) => {
      for (const receipt of pending) {
        receipt.outcome = "transport_failed";
      }
      throw err;
    },
  );
}

/** Throw unless the value is gate-minted with a current, unexpired binding. Plain strings are rejected. */
export function requireGatedText(value: unknown, required: "live" | "any" = "any"): GatedText {
  if (value instanceof GatedText) {
    const binding = bindings.get(value);
    if (
      binding !== undefined &&
      binding.isCurrent() &&
      binding.now() <= binding.expiresAt &&
      sha256Hex(value.text) === binding.textHash
    ) {
      if (required === "live" && binding.mode !== "live") {
        throw new GateApprovalError("fixture-mode approval cannot authorize a live provider request");
      }
      return value;
    }
  }
  throw new GateApprovalError("refusing to send text that did not come from gate.send: approval required");
}

export function requireLiveGatedText(v: unknown): GatedText {
  return requireGatedText(v, "live");
}

export interface PrivacyGateOptions {
  redactor?: Redactor;
  mode: "live" | "fixture";
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface PreparedRun {
  runId: string;
  redactedText: string;
  spans: TextSpan[];
  needsReview: boolean;
  /** An empty span list is never a PII-free claim, it requires owner review. */
  piiFree: false;
}

interface StoredRun {
  revision: number;
  currentText: string;
  spans: TextSpan[];
  rawNames: string[];
  approval: { token: string; textHash: string; at: number; revision: number } | null;
  /** Dispatch history: appended only, never cleared by correct/revoke/approve. */
  receipts: DispatchReceipt[];
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b\d{3}-\d{4}\b/;
const CARD_GROUP_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/;
const CARD_LONG_RE = /\b\d{13,19}\b/;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

/**
 * Deterministic phone/email backstop: spans for every phone- or email-shaped
 * run in `text` (the same patterns the residual-PII check refuses on), in
 * order. Live prepare() masks these even when the model missed or misaligned
 * them, so a model slip on contact details cannot leave a fragment behind.
 */
export function backstopContactSpans(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  for (const [re, label] of [
    [new RegExp(PHONE_RE.source, "g"), "phone"],
    [new RegExp(EMAIL_RE.source, "g"), "email"],
  ] as const) {
    for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, label });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

const DIGIT_RUN_RE = /(?<!\d)\d{7,15}(?!\d)/;

/** Residual-pattern scan over candidate send text. Returns a hit kind or null.
 * The kind never includes the matched text. Comparison is NFKC, format-stripped,
 * and case-insensitive; phones also match a separator-free 7–15 digit run.
 */
export function findResidualPII(text: string, rawNames: readonly string[] = []): string | null {
  const scanned = preparePiiScanText(text);
  const cardGroup = CARD_GROUP_RE.exec(scanned);
  if (cardGroup !== null) {
    const digits = cardGroup[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) return "card number";
  }
  const cardLong = CARD_LONG_RE.exec(scanned);
  if (cardLong !== null && luhnOk(cardLong[0])) return "card number";
  if (EMAIL_RE.test(scanned)) return "email address";
  if (PHONE_RE.test(scanned)) return "phone number";
  if (IBAN_RE.test(scanned.toUpperCase())) return "IBAN";
  if (SSN_RE.test(scanned)) return "SSN-like number";
  const folded = normalizePiiText(text);
  for (const name of rawNames) {
    const foldedName = normalizePiiText(name);
    if (foldedName.length >= 2 && folded.includes(foldedName)) return "unredacted name from redaction spans";
  }
  if (DIGIT_RUN_RE.test(scanned)) return "phone number";
  return null;
}

async function withFetch<T>(fetchImpl: typeof fetch | undefined, fn: () => Promise<T>): Promise<T> {
  if (fetchImpl === undefined) return fn();
  const scope = globalThis as unknown as Record<string, unknown>;
  const prev = scope["fetch"];
  scope["fetch"] = fetchImpl;
  try {
    return await fn();
  } finally {
    scope["fetch"] = prev;
  }
}

export interface PrivacyGate {
  prepare(rawText: string): Promise<PreparedRun>;
  preview(runId: string): string;
  correct(runId: string, editedText: string): string;
  approve(runId: string, text: string): string;
  send<T>(runId: string, approvalToken: string, sendFn: (gated: GatedText) => Promise<T>): Promise<T>;
  revoke(runId: string): void;
  /** Copies of the recorded dispatch receipts for a run; unknown run -> []. */
  receipts(runId: string): DispatchReceipt[];
}

export function createPrivacyGate(options: PrivacyGateOptions): PrivacyGate {
  const { mode, fetchImpl, now = () => Date.now() } = options;
  if (mode === "live") {
    if ((process.env[GLIMMER_BASE_URL_ENV] ?? "") === "") {
      throw new GateConfigError(
        "live mode requires a private Glimmer redactor (GLIMMER_BASE_URL is unset); refusing to fall back to MockRedactor",
      );
    }
    const candidate = options.redactor;
    if (candidate !== undefined && (candidate instanceof MockRedactor || candidate.label === MOCK_LABEL)) {
      throw new GateConfigError("live mode forbids MockRedactor: configure the private Glimmer redactor");
    }
  }
  const redactor: Redactor =
    options.redactor ?? (mode === "live" ? new GlimmerClient() : new MockRedactor());

  const runs = new Map<string, StoredRun>();

  function lookup(runId: string): StoredRun {
    const run = runs.get(runId);
    if (run === undefined) throw new GateApprovalError("unknown runId: approval required");
    return run;
  }

  return {
    async prepare(rawText: string): Promise<PreparedRun> {
      // Raw text goes ONLY to the Glimmer redactor. Timeout or an
      // invalid reply throws here, before any further calls.
      const redacted = await withFetch(fetchImpl, () => redactor.redactText(rawText));
      let maskedText = redacted.maskedText;
      let spans = redacted.spans;
      if (mode === "live") {
        validateGlimmerReply(rawText, { spans: redacted.spans, boxes: [] });
        // Regex backstop before any residual-PII check: add phone/email spans
        // the model did not fully cover and re-mask from the raw text. This
        // only ever masks more; the residual check in send() stays strict.
        const extra = backstopContactSpans(rawText).filter(
          (b) => !redacted.spans.some((s) => s.start <= b.start && s.end >= b.end),
        );
        if (extra.length > 0) {
          spans = [...redacted.spans, ...extra];
          maskedText = maskText(rawText, spans);
        }
      }
      const runId = randomUUID();
      const rawNames = [
        ...new Set(
          redacted.spans
            .filter((s) => s.label === "person")
            .map((s) => rawText.slice(s.start, s.end))
            .filter((v) => v.length >= 2),
        ),
      ];
      runs.set(runId, {
        revision: 0,
        currentText: maskedText,
        spans,
        rawNames,
        approval: null,
        receipts: [],
      });
      return {
        runId,
        redactedText: maskedText,
        spans,
        needsReview: redacted.spans.length === 0,
        piiFree: false,
      };
    },

    preview(runId: string): string {
      return lookup(runId).currentText;
    },

    correct(runId: string, editedText: string): string {
      const run = lookup(runId);
      run.currentText = editedText;
      run.revision += 1;
      run.approval = null;
      return run.currentText;
    },

    approve(runId: string, text: string): string {
      const run = lookup(runId);
      const textHash = sha256Hex(text);
      const token = sha256Hex(`${runId}:${textHash}`);
      run.approval = { token, textHash, at: now(), revision: run.revision };
      return token;
    },

    async send<T>(runId: string, approvalToken: string, sendFn: (gated: GatedText) => Promise<T>): Promise<T> {
      const run = lookup(runId);
      const approval = run.approval;
      if (approval === null || approval.token !== approvalToken) {
        throw new GateApprovalError("missing or mismatched approval: approval required");
      }
      if (approval.revision !== run.revision) {
        throw new GateApprovalError("approval is stale: the text changed after approval");
      }
      if (now() - approval.at > APPROVAL_TTL_MS) {
        throw new GateApprovalError("approval expired: re-approve the current text");
      }
      if (approval.textHash !== sha256Hex(run.currentText)) {
        throw new GateApprovalError("approval is stale: the text changed after approval");
      }
      const hit = findResidualPII(run.currentText, run.rawNames);
      if (hit !== null) {
        throw new ResidualPIIError(`residual PII detected (${hit}): refusing to send`);
      }
      const gated = new GatedText(MINT, run.currentText);
      const revision = run.revision;
      const textHash = sha256Hex(run.currentText);
      const expiresAt = approval.at + APPROVAL_TTL_MS;
      bindings.set(gated, {
        mode,
        runId,
        revision,
        textHash,
        expiresAt,
        now,
        isCurrent: () => {
          const current = runs.get(runId);
          return (
            current !== undefined &&
            current.revision === revision &&
            sha256Hex(current.currentText) === textHash &&
            current.approval === approval
          );
        },
        record: (receipt: DispatchReceipt) => {
          const current = runs.get(runId);
          if (current !== undefined) {
            current.receipts.push(receipt);
          }
        },
      });
      return sendFn(gated);
    },

    revoke(runId: string): void {
      const run = runs.get(runId);
      if (run === undefined) return;
      run.approval = null;
      run.revision += 1;
    },

    receipts(runId: string): DispatchReceipt[] {
      return (runs.get(runId)?.receipts ?? []).map((receipt) => ({ ...receipt }));
    },
  };
}
