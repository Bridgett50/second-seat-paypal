/**
 * B2 acceptance (docs/rescue-plan-b.md): approval is revalidated at the
 * transport boundary before EVERY HTTP attempt, and dispatch receipts are
 * recorded from that boundary. Real adapters (MuseClient, SparkPressureClassifier,
 * SparkSupportJudge) with a fake global fetch spy, deferred promises and a fake
 * gate clock. No sleeps, no network, no models.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/brief/costGuard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/brief/costGuard.js")>();
  return {
    ...actual,
    checkCapsPreCall: vi.fn(actual.checkCapsPreCall),
    checkPerCallTokenCap: vi.fn(actual.checkPerCallTokenCap),
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: actual, readFile: vi.fn(actual.readFile) };
});

import * as costGuard from "../src/brief/costGuard.js";
import * as fsp from "node:fs/promises";
import { MuseClient } from "../src/brief/muse.js";
import { SparkSupportJudge } from "../src/judge/support.js";
import { SparkPressureClassifier } from "../src/shield/classify.js";
import {
  APPROVAL_TTL_MS,
  GateApprovalError,
  GatedText,
  createPrivacyGate,
  type PrivacyGate,
} from "../src/private/gate.js";

type ClientName = "muse" | "shield" | "support";
const CLIENTS: ClientName[] = ["muse", "shield", "support"];
const APPROVED = "approved meeting notes about the renewal";

function sha(t: string): string {
  return createHash("sha256").update(t, "utf8").digest("hex");
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sse(content: string, status = 200): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + "data: [DONE]\n\n";
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function okContent(client: ClientName): string {
  if (client === "shield") {
    return JSON.stringify({ labels: [{ segmentId: "s1", tactic: "none", ask: "none", target: "none", span: "notes" }] });
  }
  if (client === "support") return JSON.stringify({ grade: "supported", missing_qualifier: null });
  return JSON.stringify({ entries: [] });
}

function callClient(client: ClientName, g: GatedText, maxAttempts?: number): Promise<unknown> {
  const opts = maxAttempts === undefined ? undefined : { maxAttempts };
  if (client === "muse") {
    return new MuseClient(opts).completeBrief({ meetingId: "m", transcriptText: g, framesSidecarText: "", fixtureMode: false });
  }
  if (client === "shield") return new SparkPressureClassifier(opts).classify([{ segmentId: "s1", text: g }]);
  return new SparkSupportJudge(opts).gradeSupport({ entryId: "e", entryText: g, citedSpans: [g] });
}

let fetchCalls: number;
let respond: () => Promise<Response>;
let clock: number;
let savedEnv: Record<string, string | undefined>;
let prevFetch: typeof fetch;

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

async function approvedRun(): Promise<{ gate: PrivacyGate; runId: string; token: string }> {
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as any, now: () => clock });
  const prepared = await gate.prepare(APPROVED);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return { gate, runId: prepared.runId, token };
}

function receipts(gate: PrivacyGate, runId: string): Array<Record<string, unknown>> {
  return (gate as unknown as { receipts(id: string): Array<Record<string, unknown>> }).receipts(runId);
}

async function flush(until: () => boolean): Promise<void> {
  // Event-loop turns (setImmediate is not faked), not wall-clock sleeps.
  for (let i = 0; i < 20000 && !until(); i += 1) await new Promise<void>((r) => setImmediate(r));
  expect(until()).toBe(true);
}

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["META_API_KEY"] = "test-dummy-not-a-secret";
  const dir = mkdtempSync(join(tmpdir(), "b2-"));
  process.env["MUSE_STATE_FILE"] = join(dir, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(dir, "cost.jsonl");
  clock = 1_000_000;
  fetchCalls = 0;
  respond = async () => sse("{}");
  prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = prevFetch;
  vi.useRealTimers();
  vi.mocked(costGuard.checkCapsPreCall).mockClear();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe.each(CLIENTS)("B2 via %s client (B2-8: all clients)", (client) => {
  it("B2-1 revoked during preflight: zero fetches", async () => {
    const { gate, runId, token } = await approvedRun();
    const hold = deferred<void>();
    let entered = false;
    vi.mocked(costGuard.checkCapsPreCall).mockImplementationOnce(async () => {
      entered = true;
      await hold.promise;
      return { date: "2026-10-27", calls: 0 } as never;
    });
    const p = gate.send(runId, token, (g) => callClient(client, g));
    p.catch(() => undefined);
    await flush(() => entered);
    gate.revoke(runId);
    hold.resolve();
    await expect(p).rejects.toThrow(GateApprovalError);
    expect(fetchCalls).toBe(0);
    expect(receipts(gate, runId)).toEqual([]);
  });

  it("B2-2 expired during preflight: zero fetches", async () => {
    const { gate, runId, token } = await approvedRun();
    const hold = deferred<void>();
    let entered = false;
    vi.mocked(costGuard.checkCapsPreCall).mockImplementationOnce(async () => {
      entered = true;
      await hold.promise;
      return { date: "2026-10-27", calls: 0 } as never;
    });
    const p = gate.send(runId, token, (g) => callClient(client, g));
    p.catch(() => undefined);
    await flush(() => entered);
    clock += APPROVAL_TTL_MS + 1;
    hold.resolve();
    await expect(p).rejects.toThrow(GateApprovalError);
    expect(fetchCalls).toBe(0);
    expect(receipts(gate, runId)).toEqual([]);
  });

  it("B2-3 revoked between retries: no second attempt, first receipt kept", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { gate, runId, token } = await approvedRun();
    respond = async () => new Response("busy", { status: 503 });
    // Support and shield default to one attempt. This case asks for a second
    // so revocation can still cancel a retry that was actually scheduled.
    const p = gate.send(runId, token, (g) => callClient(client, g, client === "muse" ? undefined : 2));
    p.catch(() => undefined);
    await flush(() => fetchCalls === 1 && vi.getTimerCount() > 0);
    gate.revoke(runId);
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(GateApprovalError);
    expect(fetchCalls).toBe(1);
    const r = receipts(gate, runId);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ transport: client, attempt: 1, outcome: "http_error", httpStatus: 503 });
  });

  it("B2-4 preflight refusals (credentials, cost cap, prompt read, token cap): zero fetches, no receipt", async () => {
    const cases: Array<{ name: string; arm: () => void; applies: boolean }> = [
      { name: "missing credentials", arm: () => delete process.env["META_API_KEY"], applies: true },
      {
        name: "cost cap",
        arm: () => vi.mocked(costGuard.checkCapsPreCall).mockRejectedValueOnce(new Error("daily cost cap reached")),
        applies: true,
      },
      {
        name: "prompt read",
        // Fail only reads of the developer prompt file (not the cost-guard state file).
        arm: () => {
          const real = vi.mocked(fsp.readFile).getMockImplementation()!;
          vi.mocked(fsp.readFile).mockImplementation(((path: unknown, ...rest: unknown[]) =>
            String(path).includes("/prompts/")
              ? Promise.reject(new Error("ENOENT prompt"))
              : (real as (...a: unknown[]) => Promise<unknown>)(path, ...rest)) as never);
          disarm.push(() => vi.mocked(fsp.readFile).mockImplementation(real));
        },
        applies: client !== "support", // support's developer prompt is an in-module constant
      },
      {
        name: "token cap",
        arm: () =>
          vi.mocked(costGuard.checkPerCallTokenCap).mockImplementationOnce(() => {
            throw new Error("per-call token cap exceeded");
          }),
        applies: true,
      },
    ];
    const disarm: Array<() => void> = [];
    for (const c of cases) {
      if (!c.applies) continue;
      process.env["META_API_KEY"] = "test-dummy-not-a-secret";
      const { gate, runId, token } = await approvedRun();
      c.arm();
      await expect(gate.send(runId, token, (g) => callClient(client, g)), c.name).rejects.toThrow();
      expect(fetchCalls, c.name).toBe(0);
      expect(receipts(gate, runId), c.name).toEqual([]);
      for (const d of disarm.splice(0)) d();
    }
  });

  it("B2-5 transport failure: receipt says attempted with failed outcome, not success", async () => {
    const { gate, runId, token } = await approvedRun();
    respond = async () => {
      throw new TypeError("fetch failed: socket hang up");
    };
    await expect(gate.send(runId, token, (g) => callClient(client, g))).rejects.toThrow();
    expect(fetchCalls).toBe(1);
    const r = receipts(gate, runId);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ transport: client, attempt: 1, outcome: "transport_failed" });
  });

  it("B2-7 exact identity: success receipt names run, revision, payload hash and dispatch time", async () => {
    const { gate, runId, token } = await approvedRun();
    gate.correct(runId, `${APPROVED} (corrected)`);
    const token2 = gate.approve(runId, `${APPROVED} (corrected)`);
    void token;
    clock = 1_200_000;
    respond = async () => {
      clock = 1_200_500; // provider latency must not change the recorded dispatch time
      return sse(okContent(client));
    };
    await gate.send(runId, token2, (g) => callClient(client, g));
    const r = receipts(gate, runId);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      transport: client,
      runId,
      revision: 1,
      payloadHash: sha(`${APPROVED} (corrected)`),
      dispatchedAt: new Date(1_200_000).toISOString(),
      attempt: 1,
      outcome: "provider_confirmed",
      httpStatus: 200,
    });
    // receipts are history: invalidation must not erase them
    gate.revoke(runId);
    expect(receipts(gate, runId)).toHaveLength(1);
  });

  it("B2-9 forged, fixture and mutated capabilities: zero live calls", async () => {
    const fake = Object.create(GatedText.prototype) as GatedText;
    await expect(callClient(client, fake)).rejects.toThrow(GateApprovalError);
    const fixtureGate = createPrivacyGate({ mode: "fixture" });
    const fp = await fixtureGate.prepare(APPROVED);
    const ft = fixtureGate.approve(fp.runId, fp.redactedText);
    await expect(fixtureGate.send(fp.runId, ft, (g) => callClient(client, g))).rejects.toThrow(GateApprovalError);
    const { gate, runId, token } = await approvedRun();
    const kept = await gate.send(runId, token, async (g) => g);
    (kept as unknown as { text: string }).text = "mutated";
    await expect(callClient(client, kept)).rejects.toThrow(GateApprovalError);
    expect(fetchCalls).toBe(0);
  });
});
