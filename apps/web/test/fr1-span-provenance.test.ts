/**
 * FR1: preview edits must keep redaction-span evidence and still drop approval.
 * Fake transport only. No provider, Modal, or sealed data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate, dispatchGuarded } from "@second-seat/bot/dist/src/private/gate.js";
import { createSessionStore } from "../src/session.js";
import { verifyApprovedRedaction } from "../src/sessionVerification.js";

const BASE = "deliver to 42 Fictional Lane";
const MASKED = "deliver to [REDACTED_address]";
const ACCOUNT = "account 123456";
const ACCOUNT_MASKED = "account [REDACTED_account_number]";
const SAFE = "please deliver to [REDACTED_address]";
const OTHER = "Discussed options.";

interface Sent {
  calls: number;
  texts: string[];
}

function brief(meetingId: string): string {
  return JSON.stringify({
    meetingId,
    model: "muse-spark-1.3",
    promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries: [
      {
        id: "e1",
        category: "decision",
        text: "Discussed options.",
        citations: [{ kind: "segment", segmentId: "seg-1", frameId: null, region: null }],
        requester: null,
        assignee: null,
        acceptance: null,
        speaker: null,
        flags: [],
      },
    ],
    flagged: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

function redactor() {
  return {
    label: "fr1-fake-redactor",
    redactText: async (text: string) => {
      if (text === BASE) {
        return {
          maskedText: MASKED,
          spans: [{ start: 11, end: text.length, label: "address" }],
        };
      }
      if (text === ACCOUNT) {
        const start = text.indexOf("123456");
        return {
          maskedText: ACCOUNT_MASKED,
          spans: [{ start, end: start + "123456".length, label: "account_number" }],
        };
      }
      return { maskedText: text, spans: [] as { start: number; end: number; label: string }[] };
    },
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "fr1-fake-redactor" }),
  };
}

function harness(sent: Sent = { calls: 0, texts: [] }) {
  const gate = createPrivacyGate({ mode: "live", redactor: redactor() });
  const store = createSessionStore({
    offline: false,
    gate,
    analyzerLabel: "fake-adapter",
    analyzer: {
      completeBrief: async (input) => {
        const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
          sent.calls += 1;
          sent.texts.push(input.transcriptText.text);
          return new Response(brief(input.meetingId), { status: 200 });
        });
        return { rawText: await response.text() };
      },
    },
  });
  return { store, sent, gate };
}

let savedUrl: string | undefined;

beforeEach(() => {
  savedUrl = process.env["GLIMMER_BASE_URL"];
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env["GLIMMER_BASE_URL"];
  else process.env["GLIMMER_BASE_URL"] = savedUrl;
});

describe("FR1 span provenance", () => {
  it("FR1-1 blocks a restored address and does not dispatch", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, BASE);
    const redacted = await store.redact(id);
    expect(redacted.redactedText).toBe(MASKED);
    store.correct(id, BASE);
    store.approve(id);
    const after = await store.analyze(id);
    expect(sent.calls).toBe(0);
    expect(after.receipts).toHaveLength(0);
    expect(after.result).toBeNull();
    expect(after.draft).toBeNull();
    expect(after.approved).toBe(false);
    expect(after.verification?.blocked).toBe(true);
    expect(JSON.stringify(after.verification)).not.toContain("Fictional");
  });

  it("FR1-2 blocks after an explicit preview invalidation", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, BASE);
    await store.redact(id);
    store.invalidate(id, "preview");
    store.correct(id, BASE);
    store.approve(id);
    const after = await store.analyze(id);
    expect(sent.calls).toBe(0);
    expect(after.receipts).toHaveLength(0);
    expect(after.result).toBeNull();
    expect(after.draft).toBeNull();
    expect(after.approved).toBe(false);
    expect(after.verification?.blocked).toBe(true);
  });

  it("FR1-3 blocks restored account digits", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, ACCOUNT);
    await store.redact(id);
    store.correct(id, ACCOUNT);
    store.approve(id);
    const after = await store.analyze(id);
    expect(sent.calls).toBe(0);
    expect(after.result).toBeNull();
    expect(after.verification?.blocked).toBe(true);
    expect(JSON.stringify(after.verification)).not.toContain("123456");
  });

  it("FR1-4 the redaction check blocks restored text and passes a mask", () => {
    const span = { start: 11, end: BASE.length, label: "address" };
    const restored = verifyApprovedRedaction(BASE, [span], BASE);
    const masked = verifyApprovedRedaction(BASE, [span], MASKED);
    expect(restored.blocked).toBe(true);
    expect(masked.blocked).toBe(false);
  });

  it("FR1-5 allows a correction that keeps the address masked", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, BASE);
    await store.redact(id);
    store.correct(id, SAFE);
    store.approve(id);
    const after = await store.analyze(id);
    expect(sent.calls).toBe(1);
    expect(sent.texts).toEqual([SAFE]);
    expect(after.result).not.toBeNull();
    expect(after.state).toBe("completed");
  });

  it("FR1-6 a new transcript does not inherit the previous address spans", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, BASE);
    await store.redact(id);
    store.approve(id);
    const first = await store.analyze(id);
    expect(first.result).not.toBeNull();
    const replaced = store.setTranscript(id, OTHER);
    expect(replaced.result).toBeNull();
    expect(replaced.draft).toBeNull();
    expect(replaced.approved).toBe(false);
    await store.redact(id);
    store.approve(id);
    const second = await store.analyze(id);
    expect(second.result).not.toBeNull();
    expect(second.approved).toBe(true);
    expect(sent.texts.at(-1)).toBe(OTHER);
    expect(sent.texts.at(-1)).not.toContain("Fictional");
  });

  it("FR1-7 a late redaction cannot restore an older transcript's spans", async () => {
    let releaseA: () => void = () => {};
    const holdA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const sent: Sent = { calls: 0, texts: [] };
    const gate = createPrivacyGate({
      mode: "live",
      redactor: {
        label: "fr1-deferred-redactor",
        redactText: async (text: string) => {
          if (text === BASE) await holdA;
          if (text === BASE) {
            return { maskedText: MASKED, spans: [{ start: 11, end: text.length, label: "address" }] };
          }
          return { maskedText: text, spans: [] };
        },
        redactImage: async () => {
          throw new Error("no images");
        },
        health: async () => ({ ok: true, label: "fr1-deferred-redactor" }),
      },
    });
    const store = createSessionStore({
      offline: false,
      gate,
      analyzer: {
        completeBrief: async (input) => {
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            sent.calls += 1;
            sent.texts.push(input.transcriptText.text);
            return new Response(brief(input.meetingId), { status: 200 });
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = store.createSession();
    store.setTranscript(id, BASE);
    const pendingA = store.redact(id);
    store.setTranscript(id, OTHER);
    const pendingB = store.redact(id);
    const finishedB = await pendingB;
    expect(finishedB.redactedText).toBe(OTHER);
    releaseA();
    await pendingA;
    const current = store.approve(id);
    expect(current.redactedText).toBe(OTHER);
    const analyzed = await store.analyze(id);
    expect(sent.texts).toEqual([OTHER]);
    expect(analyzed.result).not.toBeNull();
    expect(JSON.stringify(analyzed)).not.toContain("Fictional");
  });

  it("FR1-8 a preview edit clears approval, findings, and copy before reapproval", async () => {
    const sent: Sent = { calls: 0, texts: [] };
    const { store } = harness(sent);
    const id = store.createSession();
    store.setTranscript(id, OTHER);
    await store.redact(id);
    store.approve(id);
    const done = await store.analyze(id);
    expect(done.result).not.toBeNull();
    expect(done.draft).not.toBeNull();
    const callsAfter = sent.calls;
    const cleared = store.invalidate(id, "preview");
    expect(cleared.result).toBeNull();
    expect(cleared.draft).toBeNull();
    expect(cleared.approved).toBe(false);
    expect(cleared.verification).toBeNull();
    const snap = await store.analyze(id);
    expect(sent.calls).toBe(callsAfter);
    expect(snap.result).toBeNull();
    expect(snap.draft).toBeNull();
    expect(snap.approved).toBe(false);
  });
});
