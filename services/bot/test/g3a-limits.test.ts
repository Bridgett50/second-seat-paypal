// G3a limits: frozen output/context/input/decoding settings reach execution.
// Offline only: one invented dummy nested config, the real
// infra/modal/launch_contract.py via a python3 subprocess (stdlib only, no
// modal import), and GlimmerClient with a fake fetchImpl. No sealed paths,
// no network, no model download, no real tokenizer.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as redactMod from "../src/private/redact.js";
import { GlimmerClient } from "../src/private/redact.js";
import { validateRunConfig } from "../src/release/runConfig.js";

const here = dirname(fileURLToPath(import.meta.url));
const launchContract = join(here, "..", "..", "..", "infra", "modal", "launch_contract.py");
const CHAT_URL = "http://127.0.0.1:9";
const DS = "a".repeat(64);

// Valid dummy nested config in runConfig.ts shape (mirrors the
// test/g2-composition.test.ts dummy config): maxTokens 512, contextTokens
// 8192. Validates on the parent tree too (unknown keys are ignored there).
function dummyConfig(): Record<string, unknown> {
  return {
    configVersion: 1,
    sourceSha: "b".repeat(40),
    sourceSha256: "c".repeat(64),
    dataset: { id: "dummyx", sha256: DS },
    model: { name: "meta-models/Muse-Glimmer-30B", revision: "d".repeat(40) },
    image: {
      ref: `registry.invalid/dummy@sha256:${"e".repeat(64)}`,
      digest: `sha256:${"e".repeat(64)}`,
    },
    prompt: { sha256: "f".repeat(64) },
    schema: { sha256: "1".repeat(64) },
    scorer: { sha256: "2".repeat(64) },
    decoding: { temperature: 0, seed: 1, reasoning: "low" },
    tokenLimits: { maxTokens: 512, contextTokens: 8192 },
    timeouts: { requestMs: 60000, workDeadlineS: 700, functionTimeoutS: 840 },
    retry: { maxAttempts: 1 },
    modal: {
      allocations: 1,
      concurrency: 1,
      maxConcurrency: 2,
      scoredCanary: true,
      teardown: true,
      evidenceDownload: "complete",
    },
    review: {
      status: "reviewed",
      reviewer: "G3a Reviewer",
      reviewed_at: "2026-10-27",
      dataset_sha256: DS,
    },
    glimmerDemoRequests: 0,
    budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
  };
}

// Real vllm_argv from the real launch_contract.py (subprocess, stdlib only).
function vllmArgv(cfg: unknown): string[] {
  const prog = [
    "import importlib.util, json",
    `spec = importlib.util.spec_from_file_location("lc", ${JSON.stringify(launchContract)})`,
    "lc = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(lc)",
    `cfg = json.loads(${JSON.stringify(JSON.stringify(cfg))})`,
    "print('G3AOUT ' + json.dumps(lc.vllm_argv(cfg)))",
  ].join("\n");
  const res = spawnSync("python3", ["-c", prog], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  expect(res.status).toBe(0);
  const line = res.stdout.split("\n").find((l) => l.startsWith("G3AOUT "));
  expect(line).toBeDefined();
  return JSON.parse((line as string).slice("G3AOUT ".length)) as string[];
}

function maxModelLen(argv: string[]): string {
  const i = argv.indexOf("--max-model-len");
  expect(i).toBeGreaterThan(-1);
  return argv[i + 1] as string;
}

// Fake chat transport: records the serialized body, answers empty spans.
function fakeChat(captured: Array<{ body: Record<string, unknown> }>): typeof fetch {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    captured.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const content = JSON.stringify({ spans: [], boxes: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function requestBody(
  opts: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    const captured: Array<{ body: Record<string, unknown> }> = [];
    const client = new GlimmerClient(CHAT_URL, { fetchImpl: fakeChat(captured), ...opts } as {
      fetchImpl: typeof fetch;
    });
    await client.redactText("Call Ana at 555-0100");
    expect(captured.length).toBe(1);
    return (captured[0] as { body: Record<string, unknown> }).body;
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
  }
}

afterEach(() => {
  for (const k of [
    "GLIMMER_MAX_TOKENS",
    "GLIMMER_TEMPERATURE",
    "GLIMMER_SEED",
    "GLIMMER_REASONING",
    "GLIMMER_CONTEXT_TOKENS",
  ]) delete process.env[k];
});

describe("g3a output/context/input/decoding limits", () => {
  it("G3-4", async () => {
    const cfg = dummyConfig();
    expect(validateRunConfig(cfg), "positive control: dummy nested config must validate").toEqual([]);

    // Server context comes from contextTokens, never from maxTokens.
    const mml = maxModelLen(vllmArgv(cfg));
    expect(mml, `output-as-context: --max-model-len must be contextTokens 8192, got ${mml}`).toBe("8192");
    expect(mml, "output-as-context: --max-model-len reused the generation limit maxTokens 512").not.toBe("512");

    // The live request still generates at most maxTokens.
    const body = await requestBody({}, { GLIMMER_MAX_TOKENS: "512" });
    expect(body["max_tokens"]).toBe(512);

    // Deterministic local budget helper (dynamic check: assertion failure,
    // not an import error, on the parent tree).
    const est = (redactMod as unknown as Record<string, unknown>)["estimateInputTokens"];
    expect(typeof est, "output-as-context: estimateInputTokens helper is missing").toBe("function");
    const big = "x".repeat(9000);
    const estimate = (est as (msgs: Array<{ content: string }>) => number)([{ content: big }]);
    expect(estimate, "output-as-context: estimate must cover the 9000-char input").toBeGreaterThan(8192 - 512);

    // Oversized input refuses before any transport call (opts path).
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      throw new Error("transport must not be called");
    }) as unknown as typeof fetch;
    const limited = new GlimmerClient(CHAT_URL, { fetchImpl: counting, contextTokens: 8192 } as unknown as {
      fetchImpl: typeof fetch;
    });
    await expect(
      limited.redactText(big),
      "output-as-context: oversized input must be refused",
    ).rejects.toThrow("input budget exceeded");
    expect(calls, "output-as-context: oversized input must make zero transport calls").toBe(0);

    // Same refusal through the env fallback (no opts).
    let envCalls = 0;
    const envCounting = (async () => {
      envCalls += 1;
      throw new Error("transport must not be called");
    }) as unknown as typeof fetch;
    process.env["GLIMMER_CONTEXT_TOKENS"] = "8192";
    try {
      const envLimited = new GlimmerClient(CHAT_URL, { fetchImpl: envCounting });
      await expect(
        envLimited.redactText(big),
        "output-as-context: oversized input via env budget must be refused",
      ).rejects.toThrow("input budget exceeded");
      expect(envCalls, "output-as-context: env-budget refusal must make zero transport calls").toBe(0);
    } finally {
      delete process.env["GLIMMER_CONTEXT_TOKENS"];
    }
  });

  it("G3-4g", () => {
    const cfg = dummyConfig();
    delete cfg["tokenLimits"];
    expect(maxModelLen(vllmArgv(cfg))).toBe("16384");
  });

  it("G3-5", async () => {
    // Unsupported decoding values are rejected, not silently replaced.
    const badReasoning = dummyConfig();
    (badReasoning["decoding"] as Record<string, unknown>)["reasoning"] = "turbo";
    expect(
      validateRunConfig(badReasoning).join(";"),
      "decoding-constant: reasoning 'turbo' must be rejected",
    ).toMatch(/reasoning/);
    const badSeed = dummyConfig();
    (badSeed["decoding"] as Record<string, unknown>)["seed"] = 1.5;
    expect(validateRunConfig(badSeed).join(";"), "decoding-constant: seed 1.5 must be rejected").toMatch(/seed/);

    // Without decoding the body is exactly today's: temperature 0,
    // reasoning_strength low, no seed key.
    const plain = await requestBody({});
    expect(plain["temperature"]).toBe(0);
    expect((plain["chat_template_kwargs"] as Record<string, unknown>)["reasoning_strength"]).toBe("low");
    expect("seed" in plain).toBe(false);

    // Each decoding dimension reaches the serialized body via opts.
    const t = await requestBody({ decoding: { temperature: 0.3, seed: 1, reasoning: "low" } });
    expect(t["temperature"], "decoding-constant: opts temperature 0.3 missing from body").toBe(0.3);
    const s = await requestBody({ decoding: { temperature: 0, seed: 12, reasoning: "low" } });
    expect(s["seed"], "decoding-constant: opts seed 12 missing from body").toBe(12);
    const r = await requestBody({ decoding: { temperature: 0, seed: 1, reasoning: "high" } });
    expect(
      (r["chat_template_kwargs"] as Record<string, unknown>)["reasoning_strength"],
      "decoding-constant: opts reasoning high missing from body",
    ).toBe("high");

    // And via env fallbacks.
    const et = await requestBody({}, { GLIMMER_TEMPERATURE: "0.3" });
    expect(et["temperature"], "decoding-constant: env temperature 0.3 missing from body").toBe(0.3);
    const es = await requestBody({}, { GLIMMER_SEED: "11" });
    expect(es["seed"], "decoding-constant: env seed 11 missing from body").toBe(11);
    const er = await requestBody({}, { GLIMMER_REASONING: "high" });
    expect(
      (er["chat_template_kwargs"] as Record<string, unknown>)["reasoning_strength"],
      "decoding-constant: env reasoning high missing from body",
    ).toBe("high");
  });
});
