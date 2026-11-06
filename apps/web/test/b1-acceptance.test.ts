/**
 * B1 acceptance (docs/rescue-plan-b.md): every content change invalidates one
 * session revision. Real session store + real privacy gate, deferred analyzer
 * promises and transport spies. No sleeps.
 */
import { describe, expect, it } from "vitest";
import { buildOfflineBrief, createSessionStore } from "../src/session.js";
import {
  createPrivacyGate,
  requireGatedText,
  type GatedText,
  type PrivacyGate,
} from "@second-seat/bot/dist/src/private/gate.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

function spyGate() {
  const gate = createPrivacyGate({ mode: "fixture" });
  const tokens: { runId: string; token: string }[] = [];
  const minted: GatedText[] = [];
  const wrapped: PrivacyGate = {
    ...gate,
    approve(runId: string, text: string) {
      const token = gate.approve(runId, text);
      tokens.push({ runId, token });
      return token;
    },
    send(runId, token, fn) {
      return gate.send(runId, token, (g) => {
        minted.push(g);
        return fn(g);
      });
    },
  } as PrivacyGate;
  return { gate: wrapped, raw: gate, tokens, minted };
}

/** Analyzer spy: each call gets its own deferred unless `auto` is set. */
function spyAnalyzer(auto = true) {
  const calls: string[] = [];
  const pending: { text: string; d: ReturnType<typeof deferred<unknown>> }[] = [];
  const analyzer = (text: string): Promise<unknown> => {
    calls.push(text);
    if (auto) return Promise.resolve(buildOfflineBrief(text, []));
    const d = deferred<unknown>();
    pending.push({ text, d });
    return d.promise;
  };
  return { analyzer, calls, pending };
}

const A = "What is the price?\nPay $50 tomorrow";
const B = "Completely different content?\nDeliver by Oct 3";

async function approved(store: ReturnType<typeof createSessionStore>, text = A) {
  const id = store.createSession();
  store.setTranscript(id, text);
  await store.redact(id);
  store.approve(id);
  return id;
}

async function completedWithDraft(store: ReturnType<typeof createSessionStore>, text = A) {
  const id = await approved(store, text);
  const s = await store.analyze(id);
  expect(s.state).toBe("completed");
  store.editDraft(id, "Thanks, we will review.");
  const d = store.approveDraft(id, "Thanks, we will review.");
  expect(d.draft?.approved).toBe(true);
  return id;
}

describe("B1 acceptance", () => {
  it("B1-1 immediate raw edit: invalidate before debounce; Analyze makes zero transport calls", async () => {
    const g = spyGate();
    const an = spyAnalyzer();
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await approved(store);
    // Client signals the edit immediately (before its debounce fires).
    const s = store.invalidate(id);
    expect(s.approved).toBe(false);
    const after = await store.analyze(id);
    expect(an.calls).toEqual([]);
    expect(after.state).not.toBe("completed");
    expect(after.result).toBeNull();
    // And the debounced transcript update alone (no invalidate) also blocks.
    const id2 = await approved(store);
    store.setTranscript(id2, B);
    await store.analyze(id2);
    expect(an.calls).toEqual([]);
  });

  it("B1-2 immediate preview edit: approval, findings, draft and copy-approval cleared", async () => {
    const g = spyGate();
    const an = spyAnalyzer();
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await completedWithDraft(store);
    const s = store.invalidate(id);
    expect(s.approved).toBe(false);
    expect(s.result).toBeNull();
    expect(s.draft).toBeNull();
    expect(s.payload?.status ?? null).not.toBe("prepared");
    expect(s.state).toBe("review_required");
    expect(s.redactedText.length).toBeGreaterThan(0);
    const before = an.calls.length;
    await store.analyze(id);
    expect(an.calls.length).toBe(before);
    expect(() => store.approveDraft(id, "Thanks, we will review.")).toThrow();
    expect(() => store.editDraft(id, "x")).toThrow();
  });

  it("B1-3 clearing raw or preview input removes approval, findings and draft", async () => {
    const g = spyGate();
    const an = spyAnalyzer();
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await completedWithDraft(store);
    const runA = g.tokens.at(-1)!;
    const s = store.setTranscript(id, "");
    expect([s.approved, s.result, s.draft, s.payload]).toEqual([false, null, null, null]);
    let called = false;
    await expect(
      g.raw.send(runA.runId, runA.token, async () => {
        called = true;
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);

    const id2 = await completedWithDraft(store);
    const c = store.correct(id2, "");
    expect([c.approved, c.result, c.draft]).toEqual([false, null, null]);
    const before = an.calls.length;
    await store.analyze(id2);
    expect(an.calls.length).toBe(before);
  });

  it("B1-5 pending analysis A cannot appear as result for preview B", async () => {
    const g = spyGate();
    const an = spyAnalyzer(false);
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await approved(store);
    const pA = store.analyze(id);
    await Promise.resolve();
    await Promise.resolve();
    expect(an.pending.length).toBe(1);
    store.correct(id, "Corrected preview B?\nNo money here");
    an.pending[0]!.d.resolve(buildOfflineBrief(A, []));
    const s = await pA;
    expect(s.result).toBeNull();
    expect(s.draft).toBeNull();
    expect(s.state).toBe("review_required");
    expect(store.getState(id).result).toBeNull();
  });

  it("B1-6 provider that ignores cancellation: revision check still discards (transport fn and live adapter)", async () => {
    const g = spyGate();
    const live = { calls: 0, d: deferred<{ rawText: unknown }>() };
    const store = createSessionStore({
      gate: g.gate,
      offline: false,
      analyzer: {
        completeBrief: () => {
          live.calls += 1;
          return live.d.promise; // never observes any abort signal
        },
      },
    });
    const id = await approved(store);
    const p = store.analyze(id);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(live.calls).toBe(1);
    store.invalidate(id);
    live.d.resolve({
      rawText: JSON.stringify({
        entries: [{ id: "e1", category: "decision", text: "STALE-A", citations: [{ segmentId: "seg-1" }] }],
      }),
    });
    const s = await p;
    expect(s.result).toBeNull();
    expect(JSON.stringify(store.getState(id))).not.toContain("STALE-A");
  });

  it("B1-7 correction recovery: old findings vanish before re-analysis; new draft can be approved", async () => {
    const g = spyGate();
    const an = spyAnalyzer();
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await completedWithDraft(store);
    const corrected = "Corrected text: is the $90 fee final?";
    const c = store.correct(id, corrected);
    expect(c.result).toBeNull();
    expect(c.draft).toBeNull();
    expect(c.state).toBe("review_required");
    const ap = store.approve(id);
    expect(ap.approved).toBe(true);
    expect(ap.result).toBeNull();
    const done = await store.analyze(id);
    expect(done.state).toBe("completed");
    expect(an.calls.at(-1)).toBe(corrected);
    expect(done.result!.entries.map((e) => e.text)).toEqual([corrected]);
    store.editDraft(id, "New reply");
    expect(store.approveDraft(id, "New reply").draft?.approved).toBe(true);
  });

  it("B1-8 retained capability from A fails after invalidation (token and minted GatedText)", async () => {
    const g = spyGate();
    const an = spyAnalyzer();
    const store = createSessionStore({ gate: g.gate, analyzer: an.analyzer });
    const id = await completedWithDraft(store);
    const tokA = g.tokens.at(-1)!;
    const gatedA = g.minted.at(-1)!;
    expect(() => requireGatedText(gatedA)).not.toThrow();
    store.invalidate(id);
    expect(() => requireGatedText(gatedA)).toThrow();
    let called = 0;
    await expect(g.raw.send(tokA.runId, tokA.token, async () => void (called += 1))).rejects.toThrow();
    expect(called).toBe(0);
    // setTranscript path too
    const id2 = await approved(store);
    const tok2 = g.tokens.at(-1)!;
    store.setTranscript(id2, B);
    await expect(g.raw.send(tok2.runId, tok2.token, async () => void (called += 1))).rejects.toThrow();
    expect(called).toBe(0);
  });

  it("B1-9 positive control: unedited paste-to-copy journey completes", async () => {
    const an = spyAnalyzer();
    const store = createSessionStore({ analyzer: an.analyzer });
    const id = await completedWithDraft(store);
    const s = store.getState(id);
    expect(s.state).toBe("completed");
    expect(s.result!.entries.length).toBeGreaterThan(0);
    expect(s.draft?.approved).toBe(true);
    expect(an.calls).toEqual([A]);
  });
});
