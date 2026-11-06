/**
 * FR2: a rejected brief must not hide a confirmed dispatch as "prepared".
 * Fake transport only. No provider, Modal, or sealed data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate, dispatchGuarded } from "@second-seat/bot/dist/src/private/gate.js";
import { createSessionStore } from "../src/session.js";
import { payloadStatusLabel, renderSessionPage } from "../src/render.js";

const SAFE = "Discussed options.";

function validBrief(meetingId: string): string {
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
    label: "fr2-fake-redactor",
    redactText: async (text: string) => ({ maskedText: text, spans: [] as { start: number; end: number; label: string }[] }),
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "fr2-fake-redactor" }),
  };
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

async function ready(store: ReturnType<typeof createSessionStore>, text = SAFE) {
  const id = store.createSession();
  store.setTranscript(id, text);
  await store.redact(id);
  store.approve(id);
  return id;
}

describe("FR2 receipt settlement", () => {
  it("FR2-1 keeps a confirmed receipt when the returned brief is rejected", async () => {
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            calls += 1;
            return new Response('{"notes":[]}', { status: 200 });
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const after = await store.analyze(id);
    expect(calls).toBe(1);
    expect(after.state).toBe("blocked");
    expect(after.result).toBeNull();
    expect(after.draft).toBeNull();
    expect(after.receipts.map((r) => r.outcome)).toEqual(["provider_confirmed"]);
    expect(after.payload?.status).toBe("dispatched");
    const page = renderSessionPage(after);
    expect(page).toMatch(/id="payload-status">Dispatched/);
    expect(page).not.toMatch(/id="payload-status">Prepared \(not dispatched\)/);
    expect(payloadStatusLabel(after.payload)).not.toContain("Prepared (not dispatched)");
  });

  it("FR2-2 keeps a confirmed receipt when claims block the brief", async () => {
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      judgeVerdicts: { e1: { grade: "unsupported", missing_qualifier: null } },
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            calls += 1;
            return new Response(validBrief(input.meetingId), { status: 200 });
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const after = await store.analyze(id);
    expect(calls).toBe(1);
    expect(after.state).toBe("blocked");
    expect(after.result).toBeNull();
    expect(after.draft).toBeNull();
    expect(after.receipts.map((r) => r.outcome)).toEqual(["provider_confirmed"]);
    expect(after.payload?.status).toBe("dispatched");
  });

  it("FR2-3 does not mark dispatch before the transport callback", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          await hold;
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            calls += 1;
            return new Response(validBrief(input.meetingId), { status: 200 });
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const pending = store.analyze(id);
    await Promise.resolve();
    const mid = store.getState(id);
    expect(calls).toBe(0);
    expect(mid.receipts).toHaveLength(0);
    expect(mid.payload?.status).toBe("prepared");
    release();
    const after = await pending;
    expect(calls).toBe(1);
    expect(after.receipts.map((r) => r.outcome)).toEqual(["provider_confirmed"]);
    expect(after.payload?.status).toBe("dispatched");
  });

  it("FR2-4 shows invoked while the provider response is held, then dispatched after rejection", async () => {
    let release: (response: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, () => {
            calls += 1;
            return held;
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const pending = store.analyze(id);
    await Promise.resolve();
    await Promise.resolve();
    const mid = store.getState(id);
    expect(calls).toBe(1);
    expect(mid.receipts.map((r) => r.outcome)).toEqual(["invoked"]);
    expect(mid.payload?.status).toBe("invoked");
    release(new Response('{"notes":[]}', { status: 200 }));
    const after = await pending;
    expect(after.state).toBe("blocked");
    expect(after.receipts.map((r) => r.outcome)).toEqual(["provider_confirmed"]);
    expect(after.payload?.status).toBe("dispatched");
  });

  it("FR2-5 keeps an attempt when the provider fails or the transport throws", async () => {
    const httpStore = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => new Response("no", { status: 500 }));
          return { rawText: await response.text() };
        },
      },
    });
    const httpId = await ready(httpStore);
    const httpAfter = await httpStore.analyze(httpId);
    expect(httpAfter.receipts.map((r) => r.outcome)).toEqual(["http_error"]);
    expect(httpAfter.payload?.status).toBe("failed");
    expect(payloadStatusLabel(httpAfter.payload)).not.toContain("Prepared");
    expect(payloadStatusLabel(httpAfter.payload)).not.toContain("Dispatched to");

    const throwStore = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            throw new TypeError("fetch failed");
          });
          return { rawText: "" };
        },
      },
    });
    const throwId = await ready(throwStore);
    const throwAfter = await throwStore.analyze(throwId);
    expect(throwAfter.receipts.map((r) => r.outcome)).toEqual(["transport_failed"]);
    expect(throwAfter.payload?.status).toBe("failed");
  });

  it("FR2-6 records nothing when approval is revoked before the callback", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          await hold;
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            calls += 1;
            return new Response(validBrief(input.meetingId), { status: 200 });
          });
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const pending = store.analyze(id);
    await Promise.resolve();
    store.invalidate(id, "preview");
    release();
    await pending;
    const after = store.getState(id);
    expect(calls).toBe(0);
    expect(after.receipts).toHaveLength(0);
    expect(after.payload?.status).not.toBe("dispatched");
  });

  it("FR2-7 does not retry after revocation and keeps the failed attempt", async () => {
    let releaseRetry: () => void = () => {};
    const retryHold = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let calls = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          const first = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
            calls += 1;
            return new Response("busy", { status: 503 });
          });
          await retryHold;
          try {
            await dispatchGuarded("muse", [input.transcriptText], 2, async () => {
              calls += 1;
              return new Response(validBrief(input.meetingId), { status: 200 });
            });
          } catch {
            return { rawText: await first.text() };
          }
          return { rawText: await first.text() };
        },
      },
    });
    const id = await ready(store);
    const pending = store.analyze(id);
    await Promise.resolve();
    await Promise.resolve();
    store.invalidate(id, "preview");
    releaseRetry();
    await pending;
    const after = store.getState(id);
    expect(calls).toBe(1);
    expect(after.receipts.some((r) => r.outcome === "http_error")).toBe(true);
    expect(after.payload === null || after.payload.status !== "prepared").toBe(true);
  });

  it("FR2-8 an older rejected analysis cannot replace a newer completed payload", async () => {
    let releaseA: (response: Response) => void = () => {};
    const heldA = new Promise<Response>((resolve) => {
      releaseA = resolve;
    });
    let which = 0;
    const store = createSessionStore({
      offline: false,
      gate: createPrivacyGate({ mode: "live", redactor: redactor() }),
      analyzer: {
        completeBrief: async (input) => {
          which += 1;
          const mine = which;
          const response = await dispatchGuarded("muse", [input.transcriptText], 1, () =>
            mine === 1 ? heldA : Promise.resolve(new Response(validBrief(input.meetingId), { status: 200 })),
          );
          return { rawText: await response.text() };
        },
      },
    });
    const id = await ready(store);
    const pendingA = store.analyze(id);
    await Promise.resolve();
    await Promise.resolve();
    store.invalidate(id, "preview");
    store.approve(id);
    const pendingB = store.analyze(id);
    const doneB = await pendingB;
    releaseA(new Response('{"notes":[]}', { status: 200 }));
    await pendingA;
    const after = store.getState(id);
    expect(after.result).toEqual(doneB.result);
    expect(after.payload?.status).toBe(doneB.payload?.status);
    expect(after.result).not.toBeNull();
  });
});
