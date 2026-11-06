import { describe, expect, it } from "vitest";
import { TRANSPORT_FAILURE_REASON, buildOfflineBrief, createSessionStore } from "../src/session.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function countingRedactor(counter: { calls: number }, ms = 20) {
  return {
    label: "counting-fake",
    async redactText(text: string) {
      counter.calls += 1;
      await delay(ms);
      return { maskedText: text, spans: [] };
    },
  };
}

describe("analysis session", () => {
  it("full flow input -> completed with real segment citations", async () => {
    const analyzerCounter = { calls: 0 };
    const store = createSessionStore({
      analyzer: async (text: string) => {
        analyzerCounter.calls += 1;
        return buildOfflineBrief(text, []);
      },
    });
    const id = store.createSession();
    const text = "What should we do?\nPay $50 tomorrow\njust a note";
    let s = store.setTranscript(id, text);
    expect(s.segments.map((g) => g.id)).toEqual(["seg-1", "seg-2", "seg-3"]);
    s = await store.redact(id);
    expect(s.state).toBe("review_required");
    s = store.approve(id);
    expect(s.state).toBe("approved");
    expect(s.payload?.status).toBe("prepared");
    expect(s.payload?.sentAt).toBeUndefined();
    s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.result?.offline).toBe(true);
    expect(analyzerCounter.calls).toBe(1);
    expect(s.payload?.status).toBe("dispatched");
    expect(typeof s.payload?.sentAt).toBe("string");
    const valid = new Set(s.segments.map((g) => g.id));
    expect(s.result!.entries.length).toBeGreaterThan(0);
    for (const e of s.result!.entries) {
      expect(e.segmentIds.length).toBeGreaterThan(0);
      for (const cid of e.segmentIds) expect(valid.has(cid)).toBe(true);
    }
  });

  it("duplicate redact and analyze calls hit transports once", async () => {
    const redactorCounter = { calls: 0 };
    const analyzerCounter = { calls: 0 };
    const store = createSessionStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: countingRedactor(redactorCounter) as any,
      analyzer: async (text: string) => {
        analyzerCounter.calls += 1;
        await delay(20);
        return buildOfflineBrief(text, []);
      },
    });
    const id = store.createSession();
    store.setTranscript(id, "hello?\nPay $5 tomorrow");
    const [a, b] = await Promise.all([store.redact(id), store.redact(id)]);
    expect(redactorCounter.calls).toBe(1);
    expect(a.state).toBe("review_required");
    expect(b.state).toBe("review_required");
    store.approve(id);
    await Promise.all([store.analyze(id), store.analyze(id)]);
    expect(analyzerCounter.calls).toBe(1);
    expect(store.getState(id).state).toBe("completed");
  });

  it("setTranscript after completion clears approval/result/payload", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "What now?\nPay $9 tomorrow");
    await store.redact(id);
    store.approve(id);
    await store.analyze(id);
    expect(store.getState(id).state).toBe("completed");
    const s = store.setTranscript(id, "brand new line");
    expect(s.state).toBe("input");
    expect(s.approved).toBe(false);
    expect(s.result).toBeNull();
    expect(s.payload).toBeNull();
    expect(s.segments.map((g) => g.id)).toEqual(["seg-1"]);
  });

  it("editing redacted text clears approval", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "hello world");
    await store.redact(id);
    store.approve(id);
    expect(store.getState(id).approved).toBe(true);
    const s = store.correct(id, "hello edited world");
    expect(s.approved).toBe(false);
    expect(s.state).toBe("review_required");
  });

  it("empty-findings text yields entries []", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "just a plain note\nanother plain line");
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.result?.entries).toEqual([]);
    expect(s.result?.offline).toBe(true);
  });

  it("stores a fixed line for transport failures and does not keep the provider body", async () => {
    const bodies = [
      new Error("muse-spark request rejected (400, not retried): SECRET-PROVIDER-BODY"),
      new SyntaxError("Unexpected token 'S', \"SECRET-PROVIDER-BODY\" is not valid JSON"),
    ];
    for (const err of bodies) {
      const store = createSessionStore({
        analyzer: async () => {
          throw err;
        },
      });
      const id = store.createSession();
      store.setTranscript(id, "hello world");
      await store.redact(id);
      store.approve(id);
      const s = await store.analyze(id);
      expect(s.state).toBe("error");
      expect(s.reason).toBe(TRANSPORT_FAILURE_REASON);
      expect(s.reason).not.toContain("SECRET-PROVIDER-BODY");
    }
  });

  it("stale approval blocks without calling transport", async () => {
    const analyzerCounter = { calls: 0 };
    const store = createSessionStore({
      analyzer: async () => {
        analyzerCounter.calls += 1;
        return { offline: true, entries: [] };
      },
    });
    const id = store.createSession();
    store.setTranscript(id, "hello world");
    await store.redact(id);
    store.approve(id);
    // Edit after approval makes the approval stale at send time.
    store.correct(id, "hello changed world");
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.reason).toMatch(/approval/i);
    expect(s.reason).not.toBe(TRANSPORT_FAILURE_REASON);
    expect(analyzerCounter.calls).toBe(0);
  });

  it("late redaction resolving after setTranscript writes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const store = createSessionStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: {
        label: "deferred-fake",
        async redactText(text: string) {
          await gate;
          return { maskedText: text, spans: [] };
        },
      } as any,
    });
    const id = store.createSession();
    store.setTranscript(id, "Alice was here");
    const p = store.redact(id);
    store.setTranscript(id, "Bob");
    release();
    const s = await p;
    expect(s.state).toBe("input");
    expect(s.redactedText).toBe("");
    expect(s.segments.map((g) => g.text)).toEqual(["Bob"]);
  });

  it("late analysis resolving after setTranscript records superseded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen: string[] = [];
    const store = createSessionStore({
      analyzer: async (text: string) => {
        seen.push(text);
        await gate;
        return buildOfflineBrief(text, []);
      },
    });
    const id = store.createSession();
    store.setTranscript(id, "When will you deliver it?\nPay $9 tomorrow");
    await store.redact(id);
    store.approve(id);
    const approvedText = store.getState(id).payload?.approvedText ?? "";
    expect(approvedText.length).toBeGreaterThan(0);
    const p = store.analyze(id);
    await delay(10);
    store.setTranscript(id, "Bob");
    release();
    const s = await p;
    expect(seen).toHaveLength(1);
    expect(s.state).toBe("input");
    expect(s.result).toBeNull();
    expect(s.payload).toBeNull();
    expect(s.superseded?.approvedText).toBe(approvedText);
    expect(s.superseded?.status).toBe("sent");
  });
});

describe("session draft reply", () => {
  async function completedStore(text = "What should we do?\nPay $50 tomorrow") {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, text);
    await store.redact(id);
    store.approve(id);
    await store.analyze(id);
    return { store, id };
  }

  it("analyze completes with an empty unapproved user draft", async () => {
    const { store, id } = await completedStore();
    const s = store.getState(id);
    expect(s.state).toBe("completed");
    expect(s.draft).toEqual({ text: "", origin: "user", approved: false });
  });

  it("zero-findings transcript still reaches an approvable draft", async () => {
    const { store, id } = await completedStore("The team will review the quarterly menu.");
    const s = store.getState(id);
    expect(s.state).toBe("completed");
    expect(s.result?.entries).toEqual([]);
    expect(s.draft).toEqual({ text: "", origin: "user", approved: false });
    store.editDraft(id, "Thanks, noted.");
    const approved = store.approveDraft(id, "Thanks, noted.");
    expect(approved.draft).toEqual({ text: "Thanks, noted.", origin: "user", approved: true });
  });

  it("edit -> approve marks the exact text approved; further edit clears approval", async () => {
    const { store, id } = await completedStore();
    let s = store.editDraft(id, "hello draft");
    expect(s.draft).toEqual({ text: "hello draft", origin: "user", approved: false });
    s = store.approveDraft(id, "hello draft");
    expect(s.draft).toEqual({ text: "hello draft", origin: "user", approved: true });
    s = store.editDraft(id, "hello draft v2");
    expect(s.draft).toEqual({ text: "hello draft v2", origin: "user", approved: false });
  });

  it("approve rejects mismatched text and empty drafts", async () => {
    const { store, id } = await completedStore();
    store.editDraft(id, "review me");
    expect(() => store.approveDraft(id, "something else")).toThrow("draft changed; review again");
    expect(() => store.approveDraft(id, "")).toThrow();
    expect(store.getState(id).draft?.approved).toBe(false);
  });

  it("reject clears approval but keeps the text", async () => {
    const { store, id } = await completedStore();
    store.editDraft(id, "keep me");
    store.approveDraft(id, "keep me");
    const s = store.rejectDraft(id);
    expect(s.draft).toEqual({ text: "keep me", origin: "user", approved: false });
  });

  it("setTranscript and correct clear the draft", async () => {
    const { store, id } = await completedStore();
    store.editDraft(id, "some draft");
    store.approveDraft(id, "some draft");
    let s = store.setTranscript(id, "brand new line");
    expect(s.draft).toBeNull();
    expect(s.result).toBeNull();
    await store.redact(id);
    store.approve(id);
    await store.analyze(id);
    store.editDraft(id, "again");
    s = store.correct(id, "brand new line edited");
    void s;
    const after = store.getState(id);
    expect(after.draft).toBeNull();
  });

  it("edit before any completed result is an error", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "hello?");
    expect(() => store.editDraft(id, "x")).toThrow();
    expect(() => store.approveDraft(id, "x")).toThrow();
  });

  it("citations resolve to the approved transcript segments", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "ignore this raw line\nWhat should we do?\nPay $50 tomorrow");
    await store.redact(id);
    store.correct(id, "What should we do?\nPay $50 tomorrow");
    const approved = store.approve(id);
    expect(approved.segments.map((g) => g.text)).toEqual([
      "What should we do?",
      "Pay $50 tomorrow",
    ]);
    const done = await store.analyze(id);
    const byId = new Map(done.segments.map((g) => [g.id, g.text]));
    expect(done.result!.entries.length).toBeGreaterThan(0);
    for (const e of done.result!.entries) {
      expect(e.segmentIds.length).toBeGreaterThan(0);
      for (const cid of e.segmentIds) {
        expect(byId.has(cid)).toBe(true);
        expect(e.text).toContain(byId.get(cid) ?? "\u0000");
      }
    }
  });
});
