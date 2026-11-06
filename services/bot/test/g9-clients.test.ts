import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SparkSupportJudge } from "../src/judge/support.js";
import { SparkPressureClassifier } from "../src/shield/classify.js";
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
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["META_API_KEY"] = "dummy-test-key";
  delete process.env["MUSE_API_KEY"];
  process.env["MUSE_STATE_FILE"] = join(tmpdir(), `g9-${Date.now()}-${Math.random().toString(36).slice(2)}-state.json`);
  process.env["MUSE_COST_LOG_FILE"] = join(tmpdir(), `g9-${Date.now()}-${Math.random().toString(36).slice(2)}-cost.jsonl`);
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

describe("g9 clients", () => {
  it("CR2-support-cap", async () => {
    // constructor validation
    expect(() => new (SparkSupportJudge as any)({ maxAttempts: 0 }), "attempt-cap-ignored: should throw for 0").toThrow("maxAttempts must be an integer >= 1");

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("err", { status: 503, headers: { "retry-after": "0" } });
    }) as typeof fetch;

    const input = await gatedSupportInput();
    const judge1 = new (SparkSupportJudge as any)({ maxAttempts: 1 });
    await expect(judge1.gradeSupport(input)).rejects.toThrow();
    expect(calls, "attempt-cap-ignored: maxAttempts 1 should give exactly 1 fetch").toBe(1);

    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("err", { status: 503, headers: { "retry-after": "0" } });
    }) as typeof fetch;
    const judge2 = new (SparkSupportJudge as any)({ maxAttempts: 2 });
    await expect(judge2.gradeSupport(input)).rejects.toThrow();
    expect(calls, "attempt-cap-ignored: maxAttempts 2 should give exactly 2 fetches").toBe(2);
  });

  it("CR2-classify-cap", async () => {
    expect(() => new (SparkPressureClassifier as any)({ maxAttempts: 0 }), "attempt-cap-ignored: should throw for 0").toThrow("maxAttempts must be an integer >= 1");

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("err", { status: 503, headers: { "retry-after": "0" } });
    }) as typeof fetch;

    const lines = await gatedClassifyInput();
    const c1 = new (SparkPressureClassifier as any)({ maxAttempts: 1 });
    await expect(c1.classify(lines)).rejects.toThrow();
    expect(calls, "attempt-cap-ignored: maxAttempts 1 should give exactly 1 fetch").toBe(1);

    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("err", { status: 503, headers: { "retry-after": "0" } });
    }) as typeof fetch;
    const c2 = new (SparkPressureClassifier as any)({ maxAttempts: 2 });
    await expect(c2.classify(lines)).rejects.toThrow();
    expect(calls, "attempt-cap-ignored: maxAttempts 2 should give exactly 2 fetches").toBe(2);
  });

  it("CR2-support-no-body", async () => {
    const bodyText = "SECRET-PROVIDER-BODY-xyz";
    // 400 path
    globalThis.fetch = (async () => new Response(bodyText, { status: 400 })) as typeof fetch;
    const input = await gatedSupportInput();
    const judge = new (SparkSupportJudge as any)({ maxAttempts: 1 });
    let err400: Error | null = null;
    try { await judge.gradeSupport(input); } catch (e) { err400 = e as Error; }
    expect(err400, "provider-body-embedded: 400 should throw").not.toBeNull();
    expect(err400!.message.includes("SECRET-PROVIDER-BODY"), "provider-body-embedded: 400 error must not contain body text").toBe(false);
    expect(err400!.message.includes("400"), "provider-body-embedded: 400 error must contain status 400").toBe(true);

    // exhausted 503 path
    globalThis.fetch = (async () => new Response(bodyText, { status: 503, headers: { "retry-after": "0" } })) as typeof fetch;
    let err503: Error | null = null;
    try { await judge.gradeSupport(input); } catch (e) { err503 = e as Error; }
    expect(err503, "provider-body-embedded: 503 should throw").not.toBeNull();
    expect(err503!.message.includes("SECRET-PROVIDER-BODY"), "provider-body-embedded: 503 error must not contain body text").toBe(false);
    expect(err503!.message.includes("503"), "provider-body-embedded: 503 error must contain status").toBe(true);

    // 200 invalid grade containing secret
    const invalidContent = JSON.stringify({ grade: "SECRET-MODEL-CONTENT-bad", missing_qualifier: null });
    globalThis.fetch = (async () => sse(invalidContent)) as typeof fetch;
    let errGrade: Error | null = null;
    try { await judge.gradeSupport(input); } catch (e) { errGrade = e as Error; }
    expect(errGrade, "provider-body-embedded: invalid grade should throw").not.toBeNull();
    expect(errGrade!.message.includes("SECRET-MODEL-CONTENT"), "provider-body-embedded: invalid grade error must not contain model content").toBe(false);

    // Non-JSON model content. JSON.parse's own message quotes the input.
    const secret = "SECRET-PROVIDER-BODY-not-json";
    globalThis.fetch = (async () => sse(secret)) as typeof fetch;
    let errJson: Error | null = null;
    try { await judge.gradeSupport(input); } catch (e) { errJson = e as Error; }
    expect(errJson, "provider-body-embedded: non-JSON content should throw").not.toBeNull();
    expect(errJson!.message.includes(secret), "provider-body-embedded: non-JSON error must not contain the body").toBe(false);
    expect(errJson!.message).toMatch(/unreadable JSON/);

    globalThis.fetch = (async () => new Response(`data: ${secret}\n\n`, { status: 200 })) as typeof fetch;
    let errSse: Error | null = null;
    try { await judge.gradeSupport(await gatedSupportInput()); } catch (e) { errSse = e as Error; }
    expect(errSse, "provider-body-embedded: bad SSE should throw").not.toBeNull();
    expect(errSse!.message.includes(secret), "provider-body-embedded: SSE error must not contain the body").toBe(false);
    expect(errSse!.message).toMatch(/not valid JSON/);
  });

  it("CR2-classify-no-body", async () => {
    const bodyText = "SECRET-PROVIDER-BODY-xyz";
    globalThis.fetch = (async () => new Response(bodyText, { status: 400 })) as typeof fetch;
    const lines = await gatedClassifyInput();
    const cls = new (SparkPressureClassifier as any)({ maxAttempts: 1 });
    let err400: Error | null = null;
    try { await cls.classify(lines); } catch (e) { err400 = e as Error; }
    expect(err400, "provider-body-embedded: 400 should throw").not.toBeNull();
    expect(err400!.message.includes("SECRET-PROVIDER-BODY"), "provider-body-embedded: 400 error must not contain body text").toBe(false);
    expect(err400!.message.includes("400"), "provider-body-embedded: 400 error must contain status 400").toBe(true);

    globalThis.fetch = (async () => new Response(bodyText, { status: 503, headers: { "retry-after": "0" } })) as typeof fetch;
    let err503: Error | null = null;
    try { await cls.classify(lines); } catch (e) { err503 = e as Error; }
    expect(err503, "provider-body-embedded: 503 should throw").not.toBeNull();
    expect(err503!.message.includes("SECRET-PROVIDER-BODY"), "provider-body-embedded: 503 error must not contain body text").toBe(false);
    expect(err503!.message.includes("503"), "provider-body-embedded: 503 error must contain status").toBe(true);

    const secret = "SECRET-PROVIDER-BODY-not-json";
    globalThis.fetch = (async () => sse(secret)) as typeof fetch;
    let errJson: Error | null = null;
    try { await cls.classify(lines); } catch (e) { errJson = e as Error; }
    expect(errJson, "provider-body-embedded: non-JSON content should throw").not.toBeNull();
    expect(errJson!.message.includes(secret), "provider-body-embedded: non-JSON error must not contain the body").toBe(false);
    expect(errJson!.message).toMatch(/not valid JSON/);
  });

  it("CR4-citation", async () => {
    const text = await readFile(new URL("../src/promptCache.ts", import.meta.url), "utf8");
    expect(text.includes("meta-docs/"), 'bad-citation: promptCache.ts must not contain "meta-docs/"').toBe(false);
    expect(text.includes("https://dev.meta.ai/docs/prompt-caching"), 'bad-citation: promptCache.ts must contain "https://dev.meta.ai/docs/prompt-caching"').toBe(true);
  });
});
