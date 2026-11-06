import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPrivacyGate, GatedText, type PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import type { Redactor } from "@second-seat/bot/dist/src/private/redact.js";
import { BRIEF_API_URL, BRIEF_MODEL } from "@second-seat/bot/dist/src/brief/muse.js";
import { createCandidateTransport, CANDIDATE_EMAIL_SCHEMA, CandidateOutputError } from "../src/candidateTransport.js";
import type { CandidateSourceRef } from "../src/meetingRoom.js";

const needle = "alice@example.com";
function makeRedactor(): Redactor {
  return {
    label: "test-fake",
    async redactText(text: string) {
      const idx = text.indexOf(needle);
      if (idx === -1) return { maskedText: text, spans: [] };
      return { maskedText: text.replace(needle, "[REDACTED_email]"), spans: [{ start: idx, end: idx + needle.length, label: "email" }] };
    },
    async redactImage() { throw new Error("no image"); },
    async health() { return { ok: true, label: "test-fake" }; },
  };
}
async function prepareGated(gate: PrivacyGate) {
  const prep = await gate.prepare("hi alice@example.com about the plan");
  const token = gate.approve(prep.runId, prep.redactedText);
  const gated = await gate.send(prep.runId, token, async (g) => g);
  return { gate, runId: prep.runId, token, gated, redactedText: prep.redactedText };
}
function fakeCost() {
  return { checkCapsPreCall: vi.fn(async () => undefined), checkPerCallTokenCap: vi.fn(), recordCall: vi.fn(async () => undefined) };
}
let prevGlimmer: string | undefined;
beforeEach(() => {
  prevGlimmer = process.env.GLIMMER_BASE_URL;
  process.env.GLIMMER_BASE_URL = "http://127.0.0.1:9";
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network blocked in test"); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (prevGlimmer === undefined) delete process.env.GLIMMER_BASE_URL;
  else process.env.GLIMMER_BASE_URL = prevGlimmer;
});

describe("meeting-room-candidate-transport", () => {
  it("block invalid/fixture/forged/revoked/overcap => 0 fetch", async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response("{}", { status: 200 }));
    const cost = fakeCost();
    const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const { gated, runId } = await prepareGated(gate);
    const transport = createCandidateTransport({ apiKey: "k", fetchImpl, ...cost });
    await expect(Reflect.apply(transport, undefined, ["x"])).rejects.toThrow();
    await expect(Reflect.apply(transport, undefined, [{}])).rejects.toThrow();
    await expect(Reflect.apply(transport, undefined, [Object.create(GatedText.prototype)])).rejects.toThrow();
    expect(() => new GatedText(Symbol("f"), "x")).toThrow();
    const fixtureGate = createPrivacyGate({ mode: "fixture", redactor: makeRedactor() });
    const fp = await fixtureGate.prepare("hi alice@example.com about the plan");
    const ft = fixtureGate.approve(fp.runId, fp.redactedText);
    const fgated = await fixtureGate.send(fp.runId, ft, async (g) => g);
    await expect(transport(fgated)).rejects.toThrow();
    gate.revoke(runId);
    await expect(transport(gated)).rejects.toThrow();
    const gate2 = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const h2 = await prepareGated(gate2);
    const t2 = createCandidateTransport({ apiKey: "k", fetchImpl, maxInputChars: 5, ...cost });
    await expect(t2(h2.gated)).rejects.toThrow();
    const t3 = createCandidateTransport({
      apiKey: "k",
      fetchImpl,
      checkCapsPreCall: vi.fn(async () => { throw new Error("cap"); }),
      checkPerCallTokenCap: cost.checkPerCallTokenCap,
      recordCall: cost.recordCall,
    });
    await expect(t3(h2.gated)).rejects.toThrow();
    const t4 = createCandidateTransport({
      apiKey: "k",
      fetchImpl,
      checkCapsPreCall: cost.checkCapsPreCall,
      checkPerCallTokenCap: vi.fn(() => { throw new Error("per-call cap"); }),
      recordCall: cost.recordCall,
    });
    await expect(t4(h2.gated)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(() => createCandidateTransport({ apiKey: "", fetchImpl })).toThrow();
    expect(() => createCandidateTransport({ apiKey: "k", fetchImpl, timeoutMs: 0 })).toThrow(RangeError);
    expect(() => createCandidateTransport({ apiKey: "k", fetchImpl, timeoutMs: NaN })).toThrow(RangeError);
    expect(() => createCandidateTransport({ apiKey: "k", fetchImpl, maxCompletionTokens: 1.5 })).toThrow(RangeError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("approved => exactly 1 fetch with correct request", async () => {
    const email: { subject: string; body: string; sourceRefs: CandidateSourceRef[] } = { subject: "Hello", body: "World", sourceRefs: [{ utteranceId: "u1", revision: 1 }] };
    const usage = { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } };
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      return new Response(JSON.stringify({ usage, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(email) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const cost = fakeCost();
    const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const { gated, runId, redactedText } = await prepareGated(gate);
    const transport = createCandidateTransport({ apiKey: "k", fetchImpl, ...cost });
    const result = await transport(gated);
    expect(result).toEqual(email);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    if (call === undefined) throw new Error("no call");
    const url = call[0];
    const init = call[1];
    if (init === undefined || typeof init.body !== "string") throw new Error("bad init");
    expect(url).toBe(BRIEF_API_URL);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: BRIEF_MODEL,
      stream: false,
      reasoning_effort: "low",
      max_completion_tokens: 2000,
      response_format: { type: "json_schema", json_schema: { name: "candidate_email", strict: true, schema: CANDIDATE_EMAIL_SCHEMA } },
      messages: [{ role: "user", content: gated.text }],
    });
    expect(gated.text).toBe(redactedText);
    expect(gated.text).toContain("[REDACTED_email]");
    expect(gated.text).not.toContain("alice@example.com");
    expect(cost.recordCall).toHaveBeenCalledTimes(1);
    expect(cost.recordCall).toHaveBeenCalledWith({ inputTokens: 10, cachedTokens: 2, outputTokens: 5, reasoningTokens: 1 }, { model: BRIEF_MODEL, promptVersion: "candidate-none" });
    const receipts = gate.receipts(runId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ transport: "muse", attempt: 1, outcome: "provider_confirmed" });
    gate.revoke(runId);
    expect(gate.receipts(runId)).toHaveLength(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("revoke during held preflight => 0 fetch", async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response("{}", { status: 200 }));
    const cost = fakeCost();
    const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const { gated, runId, token } = await prepareGated(gate);
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const enteredP = new Promise<void>((r) => { entered = r; });
    const releaseP = new Promise<void>((r) => { release = r; });
    const transport = createCandidateTransport({ apiKey: "k", fetchImpl, ...cost, preflight: async () => { entered(); await releaseP; } });
    const p = gate.send(runId, token, (g) => transport(g));
    await enteredP;
    gate.revoke(runId);
    release();
    await expect(p).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(0);
    expect(gate.receipts(runId)).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("500 and 429 each exactly one fetch no retry", async () => {
    for (const status of [500, 429]) {
      const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response("upstream error", { status }));
      const cost = fakeCost();
      const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
      const { gated, runId, token } = await prepareGated(gate);
      void gated;
      const transport = createCandidateTransport({ apiKey: "k", fetchImpl, ...cost });
      await expect(gate.send(runId, token, (g) => transport(g))).rejects.toThrow(`candidate transport http ${status}`);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(gate.receipts(runId)[0]).toMatchObject({ transport: "muse", attempt: 1, outcome: "http_error", httpStatus: status });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });
  it("malformed output rejects with CandidateOutputError", async () => {
    const e = { subject: "Hello", body: "World", sourceRefs: [{ utteranceId: "u1", revision: 1 }] };
    const u = { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } };
    const cases: Array<{ name: string; body: string; hasValidUsage: boolean }> = [
      { name: "length", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "length", message: { content: JSON.stringify(e) } }] }), hasValidUsage: true },
      { name: "empty content", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "x" } }] }), hasValidUsage: true },
      { name: "invalid content json", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "stop", message: { content: "not json{" } }] }), hasValidUsage: true },
      { name: "extra email key", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...e, extra: 1 }) } }] }), hasValidUsage: true },
      { name: "sourceRefs strings", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ subject: "Hello", body: "World", sourceRefs: ["u1"] }) } }] }), hasValidUsage: true },
      { name: "invalid revision", body: JSON.stringify({ usage: u, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ subject: "Hello", body: "World", sourceRefs: [{ utteranceId: "u1", revision: 0 }] }) } }] }), hasValidUsage: true },
      { name: "missing usage", body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(e) } }] }), hasValidUsage: false },
      { name: "invalid usage", body: JSON.stringify({ usage: { prompt_tokens: -1, completion_tokens: 5 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(e) } }] }), hasValidUsage: false },
      { name: "envelope null", body: "null", hasValidUsage: false },
      { name: "envelope not json", body: "not json", hasValidUsage: false },
    ];
    for (const c of cases) {
      const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(c.body, { status: 200 }));
      const cost = fakeCost();
      const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
      const { runId, token } = await prepareGated(gate);
      const transport = createCandidateTransport({ apiKey: "k", fetchImpl, ...cost });
      const p = gate.send(runId, token, (g) => transport(g));
      const err = await p.then(() => undefined, (e: unknown) => e);
      if (!(err instanceof CandidateOutputError)) throw new Error("wrong error: " + c.name);
      if (c.hasValidUsage) {
        expect(err.usage).toEqual({ inputTokens: 10, cachedTokens: 2, outputTokens: 5, reasoningTokens: 1 });
        expect(cost.recordCall).toHaveBeenCalledTimes(1);
        expect(cost.recordCall).toHaveBeenCalledWith({ inputTokens: 10, cachedTokens: 2, outputTokens: 5, reasoningTokens: 1 }, { model: BRIEF_MODEL, promptVersion: "candidate-none" });
      } else {
        expect(err.usage).toBeNull();
        expect(cost.recordCall).toHaveBeenCalledTimes(0);
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(gate.receipts(runId)).toHaveLength(1);
      expect(gate.receipts(runId)[0]).toMatchObject({ transport: "muse", attempt: 1, outcome: "provider_confirmed" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  });
  it("timeout aborts pending fetch => transport_failed", async () => {
    let sig: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal == null) throw new Error("missing signal");
      sig = init.signal;
      return new Promise<Response>((_res, rej) => {
        sig?.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
      });
    });
    const cost = fakeCost();
    const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const { runId, token } = await prepareGated(gate);
    const transport = createCandidateTransport({ apiKey: "k", fetchImpl, timeoutMs: 20, ...cost });
    const p = gate.send(runId, token, (g) => transport(g));
    await expect(p).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (sig === undefined) throw new Error("no signal");
    expect(sig.aborted).toBe(true);
    expect(gate.receipts(runId)).toHaveLength(1);
    expect(gate.receipts(runId)[0]).toMatchObject({ transport: "muse", attempt: 1, outcome: "transport_failed" });
    expect(cost.recordCall).toHaveBeenCalledTimes(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("timeout during held 200 body => provider_confirmed retained, usage not fabricated", async () => {
    let sig: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.signal == null) throw new Error("missing signal");
      sig = init.signal;
      const stream = new ReadableStream<Uint8Array>({ start(c) { sig?.addEventListener("abort", () => c.error(new Error("aborted")), { once: true }); } });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    });
    const cost = fakeCost();
    const gate = createPrivacyGate({ mode: "live", redactor: makeRedactor() });
    const { runId, token } = await prepareGated(gate);
    const transport = createCandidateTransport({ apiKey: "k", fetchImpl, timeoutMs: 20, ...cost });
    const p = gate.send(runId, token, (g) => transport(g));
    await expect(p).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (sig === undefined) throw new Error("no signal");
    expect(sig.aborted).toBe(true);
    expect(gate.receipts(runId)).toHaveLength(1);
    expect(gate.receipts(runId)[0]).toMatchObject({ transport: "muse", attempt: 1, outcome: "provider_confirmed" });
    expect(cost.recordCall).toHaveBeenCalledTimes(0);
    const err = await p.then(() => undefined, (e: unknown) => e);
    if (err instanceof CandidateOutputError) expect(err.usage).toBeNull();
    if (!(err instanceof Error)) throw new Error("not error");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
