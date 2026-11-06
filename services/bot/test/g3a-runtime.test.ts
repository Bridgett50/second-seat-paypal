// G3a — Frozen settings reach actual execution (criteria G3-1, G3-2, G3-3).
// Offline only: invented dummy data, fake fetchImpl transports or a fake
// 127.0.0.1 endpoint via a node --import fetch shim (no real network, no
// Modal/GPU). No sealed paths. Temp dirs only, cleaned up on success and
// failure. No sleeps: vitest fake timers or deferred promises only.
// @ts-expect-error untyped helper module
import { runEval } from "../scripts/redaction-eval-runner.mjs";
import { GlimmerClient } from "../src/private/redact.js";
import { validateRunConfig } from "../src/release/runConfig.js";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");

// Frozen runtime prompt/schema/scorer identities for the dummy config that
// runs the CLI with --run-config (placeholder shas would now refuse).
// @ts-expect-error untyped helper module
const { runtimeIdentities: g3aRuntimeIdentities } = await import("../scripts/frozen-identities.mjs");
const G3A_IDS = (await g3aRuntimeIdentities()) as { prompt: string; schema: string; scorer: string };

afterEach(() => {
  vi.useRealTimers();
  delete process.env["GLIMMER_RAW_DIR"];
  delete process.env["GLIMMER_TIMEOUT_MS"];
});

function rmTemp(p: string): void {
  if (p.startsWith(`${tmpdir()}/`)) rmSync(p, { recursive: true, force: true });
}

function oneCase(file: string): Array<{ file: string; entities: string[] }> {
  return [{ file, entities: [] }];
}

describe("g3a frozen settings reach execution", () => {
  it("G3-1", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const transports: Array<{ signal: AbortSignal | null }> = [];
    const fetchImpl = (async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      const signal = init?.signal ?? null;
      transports.push({ signal });
      await new Promise<void>((_resolve, reject) => {
        if (signal === null) return; // never: keeps the attempt pending, not failed
        if (signal.aborted) {
          reject((signal.reason ?? new Error("aborted")) as Error);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject((signal.reason ?? new Error("aborted")) as Error);
          },
          { once: true },
        );
      });
      throw new Error("unreachable");
    }) as unknown as typeof fetch;
    const pending = runEval({
      cases: oneCase("g3a-01.txt"),
      readText: async () => "Call Zara at 555-0100",
      makeRedactor: () => new GlimmerClient("http://127.0.0.1:9", { fetchImpl }),
      requestMs: 1234,
    });
    await vi.advanceTimersByTimeAsync(1233);
    expect(transports.length, "timeout-not-applied: expected one transport entry before the bound").toBe(1);
    expect(
      transports[0]?.signal?.aborted,
      "timeout-not-applied: transport aborted before requestMs 1234",
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      transports[0]?.signal?.aborted,
      "timeout-not-applied: transport not aborted at requestMs 1234",
    ).toBe(true);
    const res = await pending;
    expect(res.records.length, "timeout-not-applied: expected one terminal record").toBe(1);
    expect(
      res.records[0]?.status,
      "timeout-not-applied: aborted case must be recorded failed, not hung",
    ).toBe("error");
    expect(
      transports.length,
      "timeout-not-applied: expected exactly one transport entry per attempt",
    ).toBe(1);
  });

  it("G3-2", { timeout: 120000 }, async () => {
    const ds = "a".repeat(64);
    const cfg: Record<string, unknown> = {
      configVersion: 1,
      sourceSha: "1".repeat(40),
      sourceSha256: "b".repeat(64),
      dataset: { id: "dummyx", sha256: ds },
      model: { name: "meta-models/Muse-Glimmer-30B", revision: "9".repeat(40) },
      image: {
        ref: `registry.invalid/dummy@sha256:${"7".repeat(64)}`,
        digest: `sha256:${"7".repeat(64)}`,
      },
      prompt: { sha256: G3A_IDS.prompt },
      schema: { sha256: G3A_IDS.schema },
      scorer: { sha256: G3A_IDS.scorer },
      decoding: { temperature: 0, seed: 1, reasoning: "low" },
      tokenLimits: { maxTokens: 256 },
      timeouts: { requestMs: 4321, workDeadlineS: 7, functionTimeoutS: 180 },
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
        dataset_sha256: ds,
      },
      glimmerDemoRequests: 0,
      budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
    };
    expect(validateRunConfig(cfg), "positive control: dummy run config must validate").toEqual([]);
    const tree = mkdtempSync(join(tmpdir(), "g3a-tree-"));
    const outParent = mkdtempSync(join(tmpdir(), "g3a-out-"));
    const cfgDir = mkdtempSync(join(tmpdir(), "g3a-cfg-"));
    try {
      mkdirSync(join(tree, "scripts"), { recursive: true });
      for (const f of ["redaction-eval.mjs", "redaction-eval-runner.mjs", "redaction-eval-lib.mjs", "frozen-identities.mjs"]) {
        copyFileSync(join(botDir, "scripts", f), join(tree, "scripts", f));
      }
      symlinkSync(join(botDir, "dist"), join(tree, "dist"));
      symlinkSync(join(botDir, "node_modules"), join(tree, "node_modules"));
      mkdirSync(join(tree, "fixtures", "dummyx"), { recursive: true });
      writeFileSync(join(tree, "fixtures", "dummyx", "dummyx-01.txt"), "Call Zara at 555-0100");
      writeFileSync(
        join(tree, "fixtures", "dummyx", "cases.json"),
        JSON.stringify([{ file: "dummyx-01.txt", entities: ["Zara"] }]),
      );
      const cfgPath = join(cfgDir, "run-config.json");
      writeFileSync(cfgPath, JSON.stringify(cfg));
      const shimPath = join(cfgDir, "g3a-shim.mjs");
      writeFileSync(
        shimPath,
        String.raw`
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("g3a-fake: network blocked for " + url);
  const u = new URL(url);
  if ((init?.method ?? "GET").toUpperCase() === "POST" && u.pathname === "/v1/chat/completions") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const user = (body.messages ?? []).find((m) => m?.role === "user");
    const text = typeof user?.content === "string" ? user.content : "";
    const idx = text.indexOf("Zara");
    const spans = idx >= 0 ? [{ start: idx, end: idx + 4, label: "person" }] : [];
    const content = JSON.stringify({ spans, boxes: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("g3a-fake: unsupported " + url);
};
`,
      );
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          shimPath,
          "scripts/redaction-eval.mjs",
          "--cases",
          "dummyx",
          "--run-config",
          cfgPath,
          "--out-dir",
          outParent,
          "--run-id",
          "g3a-run-1",
        ],
        {
          cwd: tree,
          encoding: "utf8",
          timeout: 90000,
          env: {
            PATH: process.env["PATH"] ?? "",
            GLIMMER_BASE_URL: "http://127.0.0.1:18002",
          },
        },
      );
      expect(
        child.status,
        `deadline-ignored: child eval exited ${child.status} stderr=${child.stderr.slice(-2000)}`,
      ).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(outParent, "g3a-run-1", "manifest.json"), "utf8"),
      ) as { deadline_ms?: unknown; request_ms?: unknown };
      expect(
        manifest.deadline_ms,
        "deadline-ignored: manifest deadline_ms must equal frozen workDeadlineS 7s",
      ).toBe(7000);
      expect(
        manifest.request_ms,
        "deadline-ignored: manifest request_ms must equal frozen requestMs 4321",
      ).toBe(4321);
    } finally {
      rmTemp(tree);
      rmTemp(outParent);
      rmTemp(cfgDir);
    }
    // In-process: 3000ms of preparation against a 7000ms budget with a large
    // requestMs; the redactor must see the remaining ~4000ms, not 60000/90000.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let seen: unknown;
    const res = await runEval({
      cases: oneCase("g3a-02.txt"),
      readText: async () => {
        await vi.advanceTimersByTimeAsync(3000);
        return "Call Zara at 555-0100";
      },
      makeRedactor: () => {
        const r = {
          timeoutMs: undefined as unknown,
          redactText: async (t: string) => {
            seen = (r as { timeoutMs: unknown }).timeoutMs;
            return { maskedText: t, spans: [] };
          },
        };
        return r;
      },
      deadlineMs: 7000,
      requestMs: 60000,
    });
    expect(typeof seen === "number" && (seen as number) <= 4000, `remaining budget: redactor saw timeoutMs ${String(seen)}, want <= 4000`).toBe(true);
    expect(res.records[0]?.status, "remaining budget: case should complete in budget").toBe("ok");
  });

  it("G3-2g", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let redactorCalls = 0;
    const res = await runEval({
      cases: [
        { file: "g3a-g1.txt", entities: [] },
        { file: "g3a-g2.txt", entities: [] },
      ],
      readText: async () => {
        await vi.advanceTimersByTimeAsync(2000);
        return "Call Zara at 555-0100";
      },
      makeRedactor: () => {
        redactorCalls += 1;
        return { redactText: async (t: string) => ({ maskedText: t, spans: [] }) };
      },
      deadlineMs: 1000,
    });
    expect(redactorCalls, "guard: preparation past the deadline must make zero redactor requests").toBe(0);
    expect(
      res.records.map((r: { status: string }) => r.status),
      "guard: every planned case past the deadline must be not_run",
    ).toEqual(["not_run", "not_run"]);
  });

  it("G3-3", async () => {
    for (const v of [0, -1, 1.5]) {
      let readCalls = 0;
      let redactorCalls = 0;
      let err: unknown = null;
      try {
        await runEval({
          cases: oneCase("g3a-03.txt"),
          readText: async () => {
            readCalls += 1;
            return "Call Zara at 555-0100";
          },
          makeRedactor: () => {
            redactorCalls += 1;
            return { redactText: async (t: string) => ({ maskedText: t, spans: [] }) };
          },
          concurrency: v,
        });
      } catch (e) {
        err = e;
      }
      expect(
        String((err as Error | null)?.message ?? err),
        `invalid-concurrency-accepted: concurrency ${v} must throw before any request`,
      ).toMatch("runEval: invalid concurrency");
      expect(
        redactorCalls,
        `invalid-concurrency-accepted: concurrency ${v} must throw before makeRedactor`,
      ).toBe(0);
      expect(
        readCalls,
        `invalid-concurrency-accepted: concurrency ${v} must throw before readText`,
      ).toBe(0);
    }
  });

  it("G3-3g", async () => {
    for (const concurrency of [3, 1]) {
      let active = 0;
      let maxActive = 0;
      let entries = 0;
      const cases = ["a", "b", "c", "d", "e"].map((n) => ({ file: `g3a-c-${n}.txt`, entities: [] }));
      const res = await runEval({
        cases,
        readText: async () => "Call Zara at 555-0100",
        makeRedactor: () => ({
          redactText: async (t: string) => {
            entries += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            await Promise.resolve();
            active -= 1;
            return { maskedText: t, spans: [] };
          },
        }),
        concurrency,
      });
      expect(
        maxActive,
        `guard: concurrency ${concurrency} must enter exactly ${concurrency} simultaneous transports`,
      ).toBe(concurrency);
      expect(entries, `guard: concurrency ${concurrency} must attempt every planned case`).toBe(5);
      expect(
        res.records.map((r: { status: string }) => r.status),
        `guard: concurrency ${concurrency} must complete all planned cases`,
      ).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    }
  });
});
