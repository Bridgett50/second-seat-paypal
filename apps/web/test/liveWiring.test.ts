/**
 * PR A5 — live adapter wiring, tested with injected fake transports only.
 * No live model execution is performed: every test uses an injected fake
 * fetch and a stub redactor. Live wiring tested with fake transports; no
 * live model execution performed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { GlimmerClient } from "@second-seat/bot/dist/src/private/redact.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { resolveAnalysisConfig } from "../src/liveConfig.js";
import { TRANSPORT_FAILURE_REASON, createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const RAW_NAME = "Alice Anderson";
const RAW_PHONE = "555-0199";

function stubRedactor() {
  return {
    label: "stub-live-redactor",
    redactText: async (text: string) => {
      const spans: { start: number; end: number; label: string }[] = [];
      const person = text.indexOf(RAW_NAME);
      if (person >= 0) spans.push({ start: person, end: person + RAW_NAME.length, label: "person" });
      const phone = text.indexOf(RAW_PHONE);
      if (phone >= 0) spans.push({ start: phone, end: phone + RAW_PHONE.length, label: "phone" });
      const masked = text.split(RAW_NAME).join("[person]").split(RAW_PHONE).join("[phone]");
      return { maskedText: masked, spans };
    },
    redactImage: async () => {
      throw new Error("no images in these tests");
    },
    health: async () => ({ ok: true, label: "stub-live-redactor" }),
  };
}

interface FetchCall {
  url: string;
  body: string;
}

function sseResponse(content: string, status = 200): Response {
  const sse =
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + `data: [DONE]\n\n`;
  return new Response(sse, { status, headers: { "content-type": "text/event-stream" } });
}

function fakeFetchFactory(calls: FetchCall[], respond: () => Response): typeof fetch {
  return (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: String((init as { body?: unknown } | undefined)?.body ?? "") });
    return respond();
  }) as typeof fetch;
}

const RAW_TRANSCRIPT = `${RAW_NAME} called about ${RAW_PHONE}\nWhat should we do?`;

const APPROVED_LINE_1 = "[person] called about [phone]";
const APPROVED_LINE_2 = "What should we do?";

function briefEntry(text: string, segmentId: string, category = "decision") {
  return {
    id: "e1",
    category,
    text,
    citations: [{ kind: "segment", segmentId, frameId: null, region: null }],
    requester: null,
    assignee: null,
    acceptance: null,
    speaker: null,
    flags: [],
  };
}

function evidenceBrief(entries: unknown[]) {
  return {
    meetingId: "m",
    model: "muse-spark-1.3",
    promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries,
    flagged: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The fake echoes the meeting id the app actually requested (identity check). */
function withRequestedMeeting(payload: unknown, body: string): unknown {
  if (typeof payload !== "object" || payload === null || !("meetingId" in payload)) {
    return payload;
  }
  const m = /^meetingId: (.+)$/m.exec(userMessageText({ url: "", body }));
  return { ...(payload as Record<string, unknown>), meetingId: m ? m[1] : "missing" };
}

function liveDeps(payload: unknown, calls: FetchCall[]) {
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    const body = String((init as { body?: unknown } | undefined)?.body ?? "");
    calls.push({ url: String(url), body });
    return sseResponse(JSON.stringify(withRequestedMeeting(payload, body)));
  }) as typeof fetch;
  const gate = createPrivacyGate({
    mode: "live",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redactor: stubRedactor() as any,
  });
  const analyzer = new MuseClient({ fetchImpl, labelTranscriptSegments: true });
  return { fetchImpl, gate, analyzer };
}

function makeLiveStore(payload: unknown, calls: FetchCall[], label = "MuseClient") {
  const { gate, analyzer } = liveDeps(payload, calls);
  const store = createSessionStore({
    offline: false,
    gate,
    analyzer,
    analyzerLabel: label,
  });
  return store;
}

async function runToApproval(
  store: ReturnType<typeof createSessionStore>,
  text = RAW_TRANSCRIPT,
) {
  const id = store.createSession();
  store.setTranscript(id, text);
  const redacted = await store.redact(id);
  expect(redacted.state).toBe("review_required");
  const approved = store.approve(id);
  expect(approved.state).toBe("approved");
  expect(approved.payload?.status).toBe("prepared");
  expect(approved.payload?.sentAt).toBeUndefined();
  return id;
}

function userMessageText(call: FetchCall): string {
  const body = JSON.parse(call.body) as { messages?: { role?: string; content?: string }[] };
  const user = (body.messages ?? []).find((m) => m.role === "user");
  return user?.content ?? "";
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_API_KEY: process.env["MUSE_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const dir = mkdtempSync(join(tmpdir(), "live-wiring-"));
  process.env["MUSE_STATE_FILE"] = join(dir, "daily-state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(dir, "cost-log.jsonl");
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("live analysis config", () => {
  it("selects GlimmerClient + MuseClient in live mode", () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetchFactory(calls, () => sseResponse("{}"));
    const cfg = resolveAnalysisConfig(
      { SECOND_SEAT_MODE: "live", META_API_KEY: "k", GLIMMER_BASE_URL: "http://127.0.0.1:9" },
      { fetchImpl },
    );
    expect(cfg.mode).toBe("live");
    if (cfg.mode !== "live") throw new Error("expected live config");
    expect(cfg.redactor).toBeInstanceOf(GlimmerClient);
    expect(cfg.analyzer).toBeInstanceOf(MuseClient);
    expect(calls).toHaveLength(0);
  });

  it("stays offline unless SECOND_SEAT_MODE=live", () => {
    expect(resolveAnalysisConfig({}).mode).toBe("offline");
    expect(
      resolveAnalysisConfig({
        META_API_KEY: "k",
        GLIMMER_BASE_URL: "http://127.0.0.1:9",
      }).mode,
    ).toBe("offline");
  });

  it("missing GLIMMER_BASE_URL fails clearly with the name only", () => {
    expect(() =>
      resolveAnalysisConfig({ SECOND_SEAT_MODE: "live", META_API_KEY: "super-secret-key" }),
    ).toThrow("GLIMMER_BASE_URL");
    try {
      resolveAnalysisConfig({ SECOND_SEAT_MODE: "live", META_API_KEY: "super-secret-key" });
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("super-secret-key");
      return;
    }
    throw new Error("expected a throw");
  });

  it("missing META_API_KEY fails clearly with the name only", () => {
    expect(() =>
      resolveAnalysisConfig({
        SECOND_SEAT_MODE: "live",
        GLIMMER_BASE_URL: "http://127.0.0.1:9",
      }),
    ).toThrow("META_API_KEY");
  });

  it("test mode stays offline even with provider credentials present", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetchFactory(calls, () => sseResponse("{}"));
    const cfg = resolveAnalysisConfig(
      {
        SECOND_SEAT_MODE: "live",
        SECOND_SEAT_TEST_MODE: "1",
        META_API_KEY: "k",
        GLIMMER_BASE_URL: "http://127.0.0.1:9",
      },
      { fetchImpl },
    );
    expect(cfg.mode).toBe("offline");
    const store = createSessionStore({ offline: true });
    const id = store.createSession();
    store.setTranscript(id, "team lunch at noon\nWhat should we do?");
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(calls).toHaveLength(0);
  });
});

describe("live session analysis over fake transports", () => {
  it("valid entries complete and the fake fetch saw only approved redacted text", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore(
      evidenceBrief([briefEntry("Follow up agreed", "seg-2")]),
      calls,
    );
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.result).toEqual({
      offline: false,
      entries: [{ kind: "decision", text: "Follow up agreed", segmentIds: ["seg-2"] }],
    });
    expect(s.payload?.status).toBe("dispatched");
    expect(typeof s.payload?.sentAt).toBe("string");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const outbound = userMessageText(call);
      expect(outbound).toContain("[person]");
      expect(outbound).not.toContain(RAW_NAME);
      expect(outbound).not.toContain(RAW_PHONE);
      expect(outbound).toContain(`[seg-1] ${APPROVED_LINE_1}`);
      expect(outbound).toContain(`[seg-2] ${APPROVED_LINE_2}`);
    }
  });

  it("live HTTP failure is an error with no heuristic substitution", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetchFactory(calls, () => new Response("rejected", { status: 400 }));
    const gate = createPrivacyGate({
      mode: "live",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: stubRedactor() as any,
    });
    const store = createSessionStore({
      offline: false,
      gate,
      analyzer: new MuseClient({ fetchImpl, labelTranscriptSegments: true }),
    });
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("error");
    expect(s.result).toBeNull();
    expect(s.reason).toBe(TRANSPORT_FAILURE_REASON);
    expect(s.reason).not.toContain("rejected");
    // The offline heuristic would have found a question here; live must not.
    // The transport ran and the provider refused (http_error receipt), so
    // the payload shows the failed attempt, never a success claim.
    expect(s.payload?.status).toBe("failed");
    expect(typeof s.payload?.sentAt).toBe("string");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("failed dispatch after the transport ran marks payload dispatched", async () => {
    const calls: FetchCall[] = [];
    const rawFetch = fakeFetchFactory(calls, () => sseResponse("this is not json"));
    const gate = createPrivacyGate({
      mode: "live",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: stubRedactor() as any,
    });
    const store = createSessionStore({
      offline: false,
      gate,
      analyzer: new MuseClient({ fetchImpl: rawFetch, labelTranscriptSegments: true }),
      analyzerLabel: "MuseClient",
    });
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("error");
    expect(s.result).toBeNull();
    expect(s.payload?.status).toBe("dispatched");
    expect(typeof s.payload?.sentAt).toBe("string");
    expect(s.payload?.adapterLabel).toBe("MuseClient");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("non-JSON analysis is an error, not 'No findings'", async () => {
    const rawCalls: FetchCall[] = [];
    const rawFetch = fakeFetchFactory(rawCalls, () => sseResponse("this is not json"));
    const gate = createPrivacyGate({
      mode: "live",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redactor: stubRedactor() as any,
    });
    const store = createSessionStore({
      offline: false,
      gate,
      analyzer: new MuseClient({ fetchImpl: rawFetch, labelTranscriptSegments: true }),
    });
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("error");
    expect(s.result).toBeNull();
  });

  it("missing entries array is an error", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore({ notes: [] }, calls);
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.result).toBeNull();
    expect(s.verification?.blocked).toBe(true);
    expect(s.verification?.message).toBe("Needs owner review. A verification check blocked this step.");
  });

  it("entry missing text string is an error", async () => {
    const calls: FetchCall[] = [];
    const { text, ...entryWithoutText } = briefEntry("Follow up agreed", "seg-1");
    void text;
    const store = makeLiveStore(evidenceBrief([entryWithoutText]), calls);
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.result).toBeNull();
    expect(s.verification?.message).not.toContain("Follow up");
  });

  it("entry with a bad category is an error", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore(evidenceBrief([briefEntry("Follow up agreed", "seg-1", "note")]), calls);
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.result).toBeNull();
  });

  it("citation id outside approved segments is an error", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore(
      evidenceBrief([briefEntry("Ghost citation", "seg-99")]),
      calls,
    );
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.result).toBeNull();
    expect(s.verification?.checks.find((c) => c.id === "brief")?.result).toBe("blocked");
  });

  it("valid empty entries produce the honest empty state", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore(evidenceBrief([]), calls);
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.result).toEqual({ offline: false, entries: [] });
    const page = renderSessionPage(s);
    expect(page).toContain("No findings in the approved transcript.");
  });

  it("error snapshot renders analysis-error and #results lacks 'No findings'", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore({ notes: [] }, calls);
    const id = await runToApproval(store);
    const s = await store.analyze(id);
    expect(s.state).toBe("blocked");
    expect(s.result).toBeNull();
    const page = renderSessionPage(s);
    expect(page).toContain('id="verification-title">Needs owner review');
    expect(page).toContain('id="btn-approve"');
    expect(page).toContain('id="btn-draft-approve"');
    const resultsDiv = page.slice(page.indexOf('<div id="results">'), page.indexOf("</div></section>"));
    expect(resultsDiv).not.toContain("No findings in the approved transcript.");
  });

  it("payload panel distinguishes prepared from dispatched", async () => {
    const calls: FetchCall[] = [];
    const store = makeLiveStore(
      evidenceBrief([briefEntry("Follow up agreed", "seg-2")]),
      calls,
    );
    const id = await runToApproval(store);
    const preparedPage = renderSessionPage(store.getState(id));
    expect(preparedPage).toContain('<p id="payload-status">Prepared (not dispatched)</p>');
    const done = await store.analyze(id);
    expect(done.payload?.status).toBe("dispatched");
    const dispatchedPage = renderSessionPage(done);
    expect(dispatchedPage).toContain(
      `<p id="payload-status">Dispatched to MuseClient at ${done.payload?.sentAt}</p>`,
    );
  });
});
