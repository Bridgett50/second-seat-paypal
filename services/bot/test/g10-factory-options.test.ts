import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSupportJudge, FixtureSupportJudge, SparkSupportJudge } from "../src/judge/support.js";
import { defaultPressureClassifier, SparkPressureClassifier } from "../src/shield/classify.js";
import { sparkProofClientOptions } from "../src/release/runConfig.js";
import { createPrivacyGate, type GatedText } from "../src/private/gate.js";

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => { throw new Error("x"); },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

async function mintLive(text: string): Promise<GatedText> {
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as any });
  const prepared = await gate.prepare(text);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) => gated);
}

function sse(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let savedEnv: Record<string, string | undefined>;
let prevFetch: typeof fetch;

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_API_KEY: process.env["MUSE_API_KEY"],
    EVIDENCE_BRIEF_MODE: process.env["EVIDENCE_BRIEF_MODE"],
    SUPPORT_JUDGE_MODE: process.env["SUPPORT_JUDGE_MODE"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["META_API_KEY"] = "dummy-test-key";
  delete process.env["MUSE_API_KEY"];
  process.env["MUSE_STATE_FILE"] = join(tmpdir(), `g10-${Date.now()}-${Math.random().toString(36).slice(2)}-state.json`);
  process.env["MUSE_COST_LOG_FILE"] = join(tmpdir(), `g10-${Date.now()}-${Math.random().toString(36).slice(2)}-cost.jsonl`);
  prevFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = prevFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// helper to make gated inputs
async function gatedSupportInput() {
  const g = await mintLive("approved meeting notes for support");
  return { entryId: "e1", entryText: g, citedSpans: [g] as GatedText[] };
}
async function gatedClassifyInput() {
  const g = await mintLive("approved meeting notes for classify");
  return [{ segmentId: "s1", text: g as GatedText }];
}

// G10 (review gap on #97): the default factories must forward the client
// options (maxAttempts, fetchImpl) to the live Spark clients, so the frozen
// run config's retry policy (sparkProofClientOptions) actually reaches them.
// No network: global fetch is replaced by a counting stub in every test, and
// the injected fetchImpl answers 503 with retry-after 0.

function counting503() {
  const f = { calls: 0, impl: (async () => { f.calls++; return new Response("err", { status: 503, headers: { "retry-after": "0" } }); }) as typeof fetch };
  return f;
}

describe("g10 factory options", () => {
  it("G10-1 defaultSupportJudge forwards maxAttempts and fetchImpl", async () => {
    const globalStub = counting503();
    globalThis.fetch = globalStub.impl;
    const injected = counting503();
    process.env["SUPPORT_JUDGE_MODE"] = "live";
    const input = await gatedSupportInput();
    const judge = (defaultSupportJudge as any)("unused-fixture.json", { maxAttempts: 1, fetchImpl: injected.impl });
    await expect(judge.gradeSupport(input)).rejects.toThrow();
    expect(globalStub.calls, "factory-options-dropped: global fetch must not be used when fetchImpl is given").toBe(0);
    expect(injected.calls, "factory-options-dropped: maxAttempts 1 must give exactly 1 injected fetch").toBe(1);
  });

  it("G10-2 defaultPressureClassifier forwards maxAttempts and fetchImpl", async () => {
    const globalStub = counting503();
    globalThis.fetch = globalStub.impl;
    const injected = counting503();
    process.env["EVIDENCE_BRIEF_MODE"] = "live";
    const lines = await gatedClassifyInput();
    const c = (defaultPressureClassifier as any)("unused-recorded.json", { maxAttempts: 1, fetchImpl: injected.impl });
    await expect(c.classify(lines)).rejects.toThrow();
    expect(globalStub.calls, "factory-options-dropped: global fetch must not be used when fetchImpl is given").toBe(0);
    expect(injected.calls, "factory-options-dropped: maxAttempts 1 must give exactly 1 injected fetch").toBe(1);
  });

  it("G10-3 sparkProofClientOptions refuses anything but one attempt and drives both factories", async () => {
    expect(() => sparkProofClientOptions({ retry: { maxAttempts: 2 } })).toThrow(/must equal 1/);
    const opts = sparkProofClientOptions({ retry: { maxAttempts: 1 } });
    const globalStub = counting503();
    globalThis.fetch = globalStub.impl;
    process.env["SUPPORT_JUDGE_MODE"] = "live";
    process.env["EVIDENCE_BRIEF_MODE"] = "live";
    const s = counting503();
    const judge = (defaultSupportJudge as any)("unused-fixture.json", { ...opts, fetchImpl: s.impl });
    await expect(judge.gradeSupport(await gatedSupportInput())).rejects.toThrow();
    expect(s.calls, "run-config-retry-ignored: support must honour retry.maxAttempts 1").toBe(1);
    const k = counting503();
    const c = (defaultPressureClassifier as any)("unused-recorded.json", { ...opts, fetchImpl: k.impl });
    await expect(c.classify(await gatedClassifyInput())).rejects.toThrow();
    expect(k.calls, "run-config-retry-ignored: classify must honour retry.maxAttempts 1").toBe(1);
    expect(globalStub.calls, "no global fetch").toBe(0);
  });

  it("G10-5 the omitted live default is one attempt and uses global fetch", async () => {
    const globalStub = counting503();
    globalThis.fetch = globalStub.impl;
    process.env["SUPPORT_JUDGE_MODE"] = "live";
    process.env["EVIDENCE_BRIEF_MODE"] = "live";
    const judge = (defaultSupportJudge as any)("unused-fixture.json");
    await expect(judge.gradeSupport(await gatedSupportInput())).rejects.toThrow();
    expect(globalStub.calls, "omitted maxAttempts must be 1").toBe(1);
    globalStub.calls = 0;
    const c = (defaultPressureClassifier as any)("unused-recorded.json");
    await expect(c.classify(await gatedClassifyInput())).rejects.toThrow();
    expect(globalStub.calls, "omitted maxAttempts must be 1").toBe(1);
  });

  it("G10-6 values above the attempt cap are rejected", () => {
    expect(() => new SparkSupportJudge({ maxAttempts: 5 })).toThrow(/<= 4/);
    expect(() => new SparkPressureClassifier({ maxAttempts: 1_000_000_000 })).toThrow(/<= 4/);
    expect(() => new SparkSupportJudge({ maxAttempts: 4 })).not.toThrow();
  });

  it("G10-4 fixture mode is unchanged and makes no fetch", () => {
    const globalStub = counting503();
    globalThis.fetch = globalStub.impl;
    delete process.env["SUPPORT_JUDGE_MODE"];
    const judge = (defaultSupportJudge as any)("some-fixture.json", { maxAttempts: 1 });
    expect(judge).toBeInstanceOf(FixtureSupportJudge);
    expect(globalStub.calls).toBe(0);
  });
});
