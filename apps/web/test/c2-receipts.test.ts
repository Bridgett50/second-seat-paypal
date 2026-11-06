/** C2 — payload panel uses actual HTTP-boundary receipts. Fake fetch only; no network, no model. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { createSessionStore } from "../src/session.js";
import * as render from "../src/render.js";

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-01T10:00:05.000Z";
const T2 = "2026-03-01T10:00:09.000Z";
const TEXT = "Please send the vendor report.\nWhat should we do?";

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}
const redactor = {
  label: "stub",
  redactText: async (text: string) => ({ maskedText: text, spans: [] }),
  redactImage: async () => {
    throw new Error("no images");
  },
  health: async () => ({ ok: true, label: "stub" }),
};
function sse(meetingId: string): Response {
  const brief = {
    meetingId,
    model: "muse-spark-1.3",
    promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries: [],
    flagged: [],
    createdAt: T0,
  };
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(brief) } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

interface Rig {
  store: ReturnType<typeof createSessionStore>;
  fetches: number;
  fetchEntered: Promise<void>;
  respond: ReturnType<typeof deferred<Response>>;
  preflight: ReturnType<typeof deferred>;
  preflightEntered: Promise<void>;
}
function rig(opts: { holdPreflight?: boolean; fetchImpl?: (n: number) => Promise<Response> } = {}): Rig {
  const respond = deferred<Response>();
  const fetchEnteredD = deferred();
  const preflight = deferred();
  const preflightEnteredD = deferred();
  const r = { fetches: 0 } as Rig;
  const fetchImpl = (async () => {
    r.fetches += 1;
    fetchEnteredD.resolve();
    if (opts.fetchImpl) return opts.fetchImpl(r.fetches);
    return respond.promise;
  }) as unknown as typeof fetch;
  const muse = new MuseClient({ fetchImpl, labelTranscriptSegments: true });
  const analyzer = {
    async completeBrief(input: Parameters<MuseClient["completeBrief"]>[0]) {
      preflightEnteredD.resolve();
      if (opts.holdPreflight) await preflight.promise;
      vi.setSystemTime(new Date(T1)); // the fetch happens at t1
      return muse.completeBrief(input);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: redactor as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.store = createSessionStore({ offline: false, gate, analyzer: analyzer as any, analyzerLabel: "MuseClient" });
  Object.assign(r, { respond, preflight, fetchEntered: fetchEnteredD.promise, preflightEntered: preflightEnteredD.promise });
  return r;
}
async function approved(r: Rig) {
  const id = r.store.createSession();
  r.store.setTranscript(id, TEXT);
  await r.store.redact(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (r.store as any).approve(id, { expectedRevision: (r.store.getState(id) as any).revision });
  return id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const label = (p: unknown): string => (render as any).payloadStatusLabel(p);

let saved: Record<string, string | undefined>;
let dir: string;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  saved = { MUSE_MAX_TOKENS_PER_CALL: process.env.MUSE_MAX_TOKENS_PER_CALL, GLIMMER_BASE_URL: process.env.GLIMMER_BASE_URL, META_API_KEY: process.env.META_API_KEY, MUSE_STATE_FILE: process.env.MUSE_STATE_FILE, MUSE_COST_LOG_FILE: process.env.MUSE_COST_LOG_FILE };
  dir = mkdtempSync(join(tmpdir(), "c2-"));
  process.env.GLIMMER_BASE_URL = "http://127.0.0.1:9";
  process.env.META_API_KEY = "test-key-not-a-secret";
  process.env.MUSE_STATE_FILE = join(dir, "state.json");
  process.env.MUSE_COST_LOG_FILE = join(dir, "cost.jsonl");
});
afterEach(() => {
  vi.useRealTimers();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

describe("C2 receipts drive the payload panel", () => {
  it("C2-1 paused preflight: no receipt, prepared/not dispatched", async () => {
    const r = rig({ holdPreflight: true });
    const id = await approved(r);
    const p = r.store.analyze(id);
    await r.preflightEntered;
    const s = r.store.getState(id);
    expect(s.receipts).toEqual([]);
    expect(s.payload?.status).toBe("prepared");
    expect(label(s.payload)).toMatch(/not dispatched|not sent/i);
    expect(r.fetches).toBe(0);
    r.preflight.resolve(undefined);
    r.respond.resolve(sse(id));
    await p;
  });

  it("C2-2/C2-3 held response: invoked/pending, never 'Prepared (not sent)'; times are t1", async () => {
    const r = rig();
    const id = await approved(r);
    const p = r.store.analyze(id);
    await r.fetchEntered;
    let s = r.store.getState(id);
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]).toMatchObject({ outcome: "invoked", dispatchedAt: T1 });
    expect(s.payload?.status).toBe("invoked");
    expect(s.payload?.sentAt).toBe(T1);
    expect(label(s.payload)).not.toContain("Prepared (not sent)");
    expect(label(s.payload)).toMatch(/pending/i);
    expect(render.renderSessionPage(s as never)).not.toContain("Prepared (not sent)");
    vi.setSystemTime(new Date(T2));
    r.respond.resolve(sse(id));
    s = await p;
    expect(s.state).toBe("completed");
    expect(s.payload).toMatchObject({ status: "dispatched", sentAt: T1 });
    expect(s.receipts[0]).toMatchObject({ outcome: "provider_confirmed", dispatchedAt: T1 });
  });

  it("C2-4 fetch invoked then throws: attempted dispatch visible with failed outcome", async () => {
    const r = rig();
    const id = await approved(r);
    const p = r.store.analyze(id);
    await r.fetchEntered;
    r.respond.reject(new TypeError("socket hang up"));
    const s = await p;
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]?.outcome).toBe("transport_failed");
    expect(s.payload?.status).toBe("failed");
    expect(s.payload?.sentAt).toBe(T1);
    const l = label(s.payload);
    expect(l).not.toContain("Prepared (not sent)");
    expect(l).not.toMatch(/nothing (was )?sent|dispatched to/i);
    expect(l).toMatch(/fail|unknown/i);
  });

  it("C2-5 edit after dispatch, old request completes: receipt kept, result discarded, history at t1", async () => {
    const r = rig();
    const id = await approved(r);
    const p = r.store.analyze(id);
    await r.fetchEntered;
    r.store.setTranscript(id, "Something else entirely.");
    vi.setSystemTime(new Date(T2));
    r.respond.resolve(sse(id));
    await p;
    const s = r.store.getState(id);
    expect(s.result).toBeNull();
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]).toMatchObject({ dispatchedAt: T1, attempt: 1 });
    expect(s.superseded?.sentAt).toBe(T1);
  });

  it("C2-6 retryable failure then revoke during backoff: exactly one fetch and one receipt", async () => {
    let storeRef!: Rig;
    let sid = "";
    const r = rig({
      fetchImpl: async () => {
        queueMicrotask(() => storeRef.store.setTranscript(sid, "edited during backoff"));
        return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
      },
    });
    storeRef = r;
    sid = await approved(r);
    await r.store.analyze(sid);
    const s = r.store.getState(sid);
    expect(r.fetches).toBe(1);
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]).toMatchObject({ attempt: 1, outcome: "http_error", httpStatus: 503 });
  });

  it("C2-7 credential, cost and token refusals: zero fetches, zero receipts", async () => {
    const cases: [string, () => void, string][] = [
      ["credential", () => delete process.env.META_API_KEY, TEXT],
      ["cost", () => writeFileSync(process.env.MUSE_STATE_FILE!, JSON.stringify({ date: T0.slice(0, 10), calls: 50, spendUsd: 0 })), TEXT],
      ["token", () => (process.env.MUSE_MAX_TOKENS_PER_CALL = "100"), TEXT],
    ];
    for (const [name, arrange, text] of cases) {
      process.env.META_API_KEY = "test-key-not-a-secret";
      delete process.env.MUSE_MAX_TOKENS_PER_CALL;
      writeFileSync(process.env.MUSE_STATE_FILE!, JSON.stringify({ date: T0.slice(0, 10), calls: 0, spendUsd: 0 }));
      arrange();
      const r = rig();
      const id = r.store.createSession();
      r.store.setTranscript(id, text);
      await r.store.redact(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r.store as any).approve(id, { expectedRevision: (r.store.getState(id) as any).revision });
      const s = await r.store.analyze(id);
      expect([name, r.fetches]).toEqual([name, 0]);
      expect([name, s.receipts]).toEqual([name, []]);
      expect([name, s.payload?.status]).toEqual([name, "prepared"]);
      expect(s.state === "error" || s.state === "blocked").toBe(true);
    }
  });
});
