/**
 * B3 acceptance — complete analysis-response validation and the composed
 * adapter path. Fake HTTP only: no real model, Modal, or sealed data.
 * Citation existence is checked; it is NOT proof of factual support.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { resolveAnalysisConfig } from "../src/liveConfig.js";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const RAW_NAME = "Priya Quarlesworth";
const RAW_PHONE = "555-0142";
const RAW = `${RAW_NAME} offered net-45 at ${RAW_PHONE}\nCan we lock pricing by Friday?`;
const GLIMMER_URL = "http://glimmer.fake.invalid:9";

interface Call { url: string; body: string }

function stubRedactor() {
  return {
    label: "stub-live-redactor",
    redactText: async (text: string) => {
      const spans: { start: number; end: number; label: string }[] = [];
      for (const [needle, label] of [[RAW_NAME, "person"], [RAW_PHONE, "phone"]] as const) {
        const i = text.indexOf(needle);
        if (i >= 0) spans.push({ start: i, end: i + needle.length, label });
      }
      return { maskedText: text.split(RAW_NAME).join("[person]").split(RAW_PHONE).join("[phone]"), spans };
    },
    redactImage: async () => { throw new Error("no images"); },
    health: async () => ({ ok: true, label: "stub-live-redactor" }),
  };
}

function sse(content: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function userMsg(body: string): string {
  const b = JSON.parse(body) as { messages?: { role?: string; content?: string }[] };
  return (b.messages ?? []).find((m) => m.role === "user")?.content ?? "";
}

function requestedMeetingId(body: string): string {
  const m = /^meetingId: (.+)$/m.exec(userMsg(body));
  if (!m) throw new Error("spark request has no meetingId line");
  return m[1]!;
}

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "e1", category: "unresolved_question", text: "Pricing lock date unresolved",
    citations: [{ kind: "segment", segmentId: "seg-2", frameId: null, region: null }],
    requester: null, assignee: null, acceptance: null, speaker: null, flags: [],
    ...over,
  };
}

function brief(meetingId: string, entries: unknown[], over: Record<string, unknown> = {}) {
  return {
    meetingId, model: "muse-spark-1.3", promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries, flagged: [], createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}

/** Responder receives the meeting id the app actually asked about. */
type Responder = (meetingId: string) => unknown;

function sparkStore(respond: Responder | string, calls: Call[]) {
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), body });
    const payload = typeof respond === "string" ? respond : JSON.stringify(respond(requestedMeetingId(body)));
    return sse(payload);
  }) as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as any });
  const analyzer = new MuseClient({ fetchImpl, labelTranscriptSegments: true });
  return createSessionStore({ offline: false, gate, analyzer, analyzerLabel: "MuseClient" });
}

async function analyzeWith(respond: Responder | string) {
  const calls: Call[] = [];
  const store = sparkStore(respond, calls);
  const id = store.createSession();
  store.setTranscript(id, RAW);
  await store.redact(id);
  store.approve(id);
  const s = await store.analyze(id);
  return { s, calls, id, store };
}

async function expectRejected(respond: Responder | string) {
  const { s, calls } = await analyzeWith(respond);
  expect(calls.length).toBe(1); // the fake Spark transport actually ran
  // Schema failures are a verification block. Unreadable output stays an error.
  // Either way the brief is not shown.
  expect(["error", "blocked"]).toContain(s.state);
  expect(s.result).toBeNull();
  if (s.state === "blocked") {
    expect(s.verification?.blocked).toBe(true);
    expect(s.reason).toBe("Needs owner review. A verification check blocked this step.");
  }
  return s;
}

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(
    ["GLIMMER_BASE_URL", "META_API_KEY", "MUSE_API_KEY", "MUSE_STATE_FILE", "MUSE_COST_LOG_FILE", "GLIMMER_RAW_DIR", "SECOND_SEAT_TEST_MODE"]
      .map((k) => [k, process.env[k]]),
  );
  process.env["GLIMMER_BASE_URL"] = GLIMMER_URL;
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const dir = mkdtempSync(join(tmpdir(), "b3-"));
  process.env["MUSE_STATE_FILE"] = join(dir, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(dir, "cost.jsonl");
  delete process.env["GLIMMER_RAW_DIR"];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("B3 response validation (fake Spark HTTP)", () => {
  it("B3-1: schema-invalid {entries: []} is rejected, not shown as empty", async () => {
    await expectRejected(() => ({ entries: [] }));
  });

  it("B3-2a: missing required top-level fields are rejected", async () => {
    for (const drop of ["model", "promptVersion", "settings", "flagged", "createdAt", "meetingId"]) {
      await expectRejected((mid) => {
        const b = brief(mid, [entry()]) as Record<string, unknown>;
        delete b[drop];
        return b;
      });
    }
  });

  it("B3-2b: missing required entry fields are rejected", async () => {
    for (const drop of ["flags", "requester", "assignee", "acceptance", "speaker", "id"]) {
      await expectRejected((mid) => {
        const e = entry() as Record<string, unknown>;
        delete e[drop];
        return brief(mid, [e]);
      });
    }
  });

  it("B3-2c: invalid category / flag / acceptance values are rejected", async () => {
    await expectRejected((mid) => brief(mid, [entry({ category: "gossip" })]));
    await expectRejected((mid) => brief(mid, [entry({ flags: ["totally_fine"] })]));
    await expectRejected((mid) => brief(mid, [entry({ acceptance: "maybe" })]));
  });

  it("B3-2d: malformed citations are rejected", async () => {
    const bad: unknown[] = [
      { kind: "segment", segmentId: null, frameId: null, region: null },
      { kind: "bogus", segmentId: "seg-1", frameId: null, region: null },
      { kind: "segment", segmentId: "seg-1" },
      "seg-1",
    ];
    for (const c of bad) await expectRejected((mid) => brief(mid, [entry({ citations: [c] })]));
  });

  it("B3-2e: additional properties are rejected (strict schema)", async () => {
    await expectRejected((mid) => ({ ...brief(mid, [entry()]), extra: 1 }));
    await expectRejected((mid) => brief(mid, [{ ...entry(), confidence: 0.9 }]));
  });

  it("B3-3: wrong meeting id citing an otherwise valid seg-1 is rejected", async () => {
    await expectRejected(() =>
      brief("some-other-meeting", [
        entry({ citations: [{ kind: "segment", segmentId: "seg-1", frameId: null, region: null }] }),
      ]),
    );
  });

  it("B3-4: unknown segment ids are rejected", async () => {
    await expectRejected((mid) =>
      brief(mid, [entry({ citations: [{ kind: "segment", segmentId: "seg-99", frameId: null, region: null }] })]),
    );
  });

  it("B3-5: a source-backed finding cannot silently have no citations", async () => {
    // No citations and no missing_source flag: presented as source-backed -> rejected.
    await expectRejected((mid) => brief(mid, [entry({ citations: [] })]));
    // Honestly flagged missing_source: accepted, and the flag is preserved, not dropped.
    const { s } = await analyzeWith((mid) =>
      brief(mid, [entry({ citations: [], flags: ["missing_source"] })], { flagged: ["e1"] }),
    );
    expect(s.state).toBe("completed");
    expect(s.result?.entries).toHaveLength(1);
    expect(s.result?.entries[0]?.segmentIds).toEqual([]);
    expect((s.result?.entries[0] as { flags?: string[] }).flags).toEqual(["missing_source"]);
  });

  it("B3-5b: relevant flags on cited entries are preserved", async () => {
    const { s } = await analyzeWith((mid) =>
      brief(mid, [entry({ flags: ["commitment_language", "pressure"] })], { flagged: ["e1"] }),
    );
    expect(s.state).toBe("completed");
    expect((s.result?.entries[0] as { flags?: string[] }).flags).toEqual(["commitment_language", "pressure"]);
    expect(s.result?.entries[0]?.segmentIds).toEqual(["seg-2"]);
  });

  it("B3-6: a fully valid empty response produces the honest empty state", async () => {
    const { s } = await analyzeWith((mid) => brief(mid, []));
    expect(s.state).toBe("completed");
    expect(s.result).toEqual({ offline: false, entries: [] });
    const html = renderSessionPage(s);
    expect(html).toContain('<p id="empty-state">No findings in the approved transcript.</p>');
  });

  it("B3-7: non-JSON or invalid live output never substitutes fixture/heuristic", async () => {
    for (const body of ["Sure! Here are the findings: pricing by Friday?", "", "```json\n{}\n```", "null", "[]"]) {
      const s = await expectRejected(body);
      expect(s.offline).toBe(false);
      const html = renderSessionPage(s);
      expect(html).not.toContain('<p id="empty-state">No findings in the approved transcript.</p>');
      // The offline heuristic would have produced a "question" entry for line 2.
      expect(JSON.stringify(s)).not.toContain('"kind":"question"');
    }
  });
});

describe("B3 composed path: configured GlimmerClient + gate + MuseClient over one fake fetch", () => {
  function composed() {
    const glimmer: Call[] = [];
    const spark: Call[] = [];
    const other: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      const body = String(init?.body ?? "");
      if (u.startsWith(GLIMMER_URL)) {
        glimmer.push({ url: u, body });
        const req = JSON.parse(body) as { messages?: { content?: unknown }[] };
        const text = JSON.stringify(req);
        void text;
        const spans: { start: number; end: number; label: string }[] = [];
        for (const [needle, label] of [[RAW_NAME, "person"], [RAW_PHONE, "phone"]] as const) {
          const i = RAW.indexOf(needle);
          spans.push({ start: i, end: i + needle.length, label });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ spans, boxes: [] }) }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u === "https://api.meta.ai/v1/chat/completions") {
        spark.push({ url: u, body });
        return sse(JSON.stringify(brief(requestedMeetingId(body), [entry()])));
      }
      other.push({ url: u, body });
      throw new Error(`unexpected network target ${u}`);
    }) as typeof fetch;
    const cfg = resolveAnalysisConfig(
      { SECOND_SEAT_MODE: "live", META_API_KEY: "k-not-secret", GLIMMER_BASE_URL: GLIMMER_URL },
      { fetchImpl },
    );
    if (cfg.mode !== "live") throw new Error("expected live config");
    const store = createSessionStore({
      offline: false, gate: cfg.gate, redactor: cfg.redactor as never, analyzer: cfg.analyzer,
      analyzerLabel: cfg.analyzerLabel,
    });
    return { store, glimmer, spark, other };
  }

  it("B3-8: raw input goes only to the fake private redactor; Spark waits for owner approval", async () => {
    const { store, glimmer, spark, other } = composed();
    const id = store.createSession();
    store.setTranscript(id, RAW);
    const red = await store.redact(id);
    expect(red.state).toBe("review_required");
    expect(glimmer.length).toBeGreaterThan(0);
    expect(glimmer.some((c) => c.body.includes(RAW_NAME))).toBe(true);
    expect(spark).toHaveLength(0);
    // Analyze before approval must not reach Spark.
    let pre: unknown;
    try { pre = await store.analyze(id); } catch (e) { pre = e; }
    void pre;
    expect(spark).toHaveLength(0);
    const ap = store.approve(id);
    expect(ap.state).toBe("approved");
    const s = await store.analyze(id);
    expect({ state: s.state, reason: s.reason }).toEqual({ state: "completed", reason: undefined });
    expect(spark).toHaveLength(1);
    expect(other).toHaveLength(0);
    for (const c of spark) {
      expect(c.body).not.toContain(RAW_NAME);
      expect(c.body).not.toContain(RAW_PHONE);
    }
  });

  it("B3-9: Spark request carries exactly the approved, segment-prefixed meeting content", async () => {
    const { store, spark } = composed();
    const id = store.createSession();
    store.setTranscript(id, RAW);
    const red = await store.redact(id);
    const approvedLines = red.redactedText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    expect(approvedLines).toHaveLength(2);
    store.approve(id);
    await store.analyze(id);
    expect(spark).toHaveLength(1);
    const body = JSON.parse(spark[0]!.body) as { messages: { role: string; content: string }[] } & Record<string, unknown>;
    const user = body.messages.find((m) => m.role === "user")!.content;
    const m = /transcript \(transcript\.txt\) — the evidence, last:\n([\s\S]*)\n<\/data>$/.exec(user);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(`[seg-1] ${approvedLines[0]}\n[seg-2] ${approvedLines[1]}`);
    expect(user).toContain(`meetingId: ${id}`);
    expect(user).toContain("frames sidecar (frames.txt):\n(no frames)");
    // No raw text (or raw fragments) in ANY field of the request.
    for (const needle of [RAW_NAME, RAW_PHONE, "Quarlesworth", "0142"]) {
      expect(spark[0]!.body).not.toContain(needle);
    }
  });

  it("B3-10: test mode stays offline even with live settings and credentials present", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push({ url: String(url), body: "" });
      throw new Error("network forbidden in test mode");
    }) as typeof fetch;
    const cfg = resolveAnalysisConfig(
      { SECOND_SEAT_MODE: "live", SECOND_SEAT_TEST_MODE: "1", META_API_KEY: "k", GLIMMER_BASE_URL: GLIMMER_URL },
      { fetchImpl },
    );
    expect(cfg.mode).toBe("offline");
    const store = createSessionStore({ offline: true });
    const id = store.createSession();
    store.setTranscript(id, "Vendor offered net-45\nCan we lock pricing by Friday?");
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.offline).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
