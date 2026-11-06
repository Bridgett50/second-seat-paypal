/**
 * B2 session-level acceptance: dispatch receipts come from the transport
 * boundary (real MuseClient + live gate + fake fetch), survive invalidation,
 * and a stale result never lands in the current state. Deferred promises,
 * no sleeps, no network, no models.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { createSessionStore } from "../src/session.js";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

function sse(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** The fake echoes the meeting id the app actually requested (identity check). */
function sparkUserText(requestBody: string): string {
  try {
    const b = JSON.parse(requestBody) as { messages?: { role?: string; content?: string }[] };
    return (b.messages ?? []).find((m) => m.role === "user")?.content ?? "";
  } catch {
    return "";
  }
}

function briefBody(requestBody: string): string {
  const m = /^meetingId: (.+)$/m.exec(sparkUserText(requestBody));
  return JSON.stringify({ ...BRIEF, meetingId: m ? m[1] : "missing" });
}

const BRIEF = {
  meetingId: "m",
  model: "muse-spark-1.3",
  promptVersion: "brief-v2",
  settings: { fixtureMode: false, maxCostUsdPerDay: null },
  entries: [
    {
      id: "e1",
      category: "decision",
      text: "Renewal moves to Friday",
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
};

function stubRedactor() {
  return {
    label: "stub-live-redactor",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "stub-live-redactor" }),
  };
}

type Receipt = Record<string, unknown>;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const dir = mkdtempSync(join(tmpdir(), "b2-web-"));
  process.env["MUSE_STATE_FILE"] = join(dir, "s.json");
  process.env["MUSE_COST_LOG_FILE"] = join(dir, "c.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function liveStore(fetchImpl: typeof fetch) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as any });
  const analyzer = new MuseClient({ fetchImpl, labelTranscriptSegments: true });
  return createSessionStore({ offline: false, gate, analyzer, analyzerLabel: "MuseClient" });
}

describe("B2 session receipts", () => {
  it("B2-6 already dispatched: A's receipt is kept, A's result is discarded from B", async () => {
    let fetches = 0;
    let release!: (r: Response) => void;
    const held = new Promise<Response>((r) => (release = r));
    let fetched!: () => void;
    const sawFetch = new Promise<void>((r) => (fetched = r));
    const store = liveStore((async () => {
      fetches += 1;
      fetched();
      return held;
    }) as typeof fetch);
    const id = store.createSession();
    store.setTranscript(id, "Renewal moves to Friday\nVendor wants an answer");
    await store.redact(id);
    const approvedA = store.approve(id).payload?.approvedText ?? "";
    const pending = store.analyze(id);
    await sawFetch;
    store.setTranscript(id, "A different meeting entirely");
    release(sse(JSON.stringify({ ...BRIEF, meetingId: id })));
    const after = await pending;
    expect(fetches).toBe(1);
    expect(after.result).toBeNull();
    expect(after.state).not.toBe("completed");
    const receipts = (after as unknown as { receipts?: Receipt[] }).receipts ?? [];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      transport: "muse",
      payloadHash: sha(approvedA),
      attempt: 1,
      outcome: "provider_confirmed",
    });
    expect(after.superseded?.approvedText).toBe(approvedA);
  });

  it("B2-4 (session) preflight refusal never reports the payload as dispatched", async () => {
    let fetches = 0;
    const store = liveStore((async (_url: unknown, init?: { body?: unknown }) => {
      fetches += 1;
      return sse(briefBody(String(init?.body ?? "")));
    }) as typeof fetch);
    const id = store.createSession();
    store.setTranscript(id, "Renewal moves to Friday");
    await store.redact(id);
    store.approve(id);
    delete process.env["META_API_KEY"]; // credentials refusal happens inside the adapter, after gate.send
    const after = await store.analyze(id);
    expect(fetches).toBe(0);
    expect(after.state).toBe("error");
    expect(after.payload?.status).not.toBe("dispatched");
    expect((after as unknown as { receipts?: Receipt[] }).receipts ?? []).toEqual([]);
  });

  it("B2-7 (session) completed analysis exposes the transport receipt for the approved payload", async () => {
    const store = liveStore((async (_url: unknown, init?: { body?: unknown }) =>
      sse(briefBody(String(init?.body ?? "")))) as typeof fetch);
    const id = store.createSession();
    store.setTranscript(id, "Renewal moves to Friday");
    await store.redact(id);
    const approved = store.approve(id).payload?.approvedText ?? "";
    const after = await store.analyze(id);
    expect(after.state).toBe("completed");
    const receipts = (after as unknown as { receipts?: Receipt[] }).receipts ?? [];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ transport: "muse", payloadHash: sha(approved), outcome: "provider_confirmed", httpStatus: 200 });
    expect(typeof receipts[0]?.["runId"]).toBe("string");
    expect(typeof receipts[0]?.["revision"]).toBe("number");
    expect(Number.isNaN(Date.parse(String(receipts[0]?.["dispatchedAt"])))).toBe(false);
  });
});
