/**
 * C7 regressions — honest pressure states + one connected capability.
 * Injected classifiers and fake HTTP only. Public made-up dev fixtures;
 * these are fixture checks, NOT model-accuracy evidence.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "pressure-dev-cases.json"), "utf8")) as {
  cases: { id: string; kind: string; transcript: string; expected: "pressure" | "none" }[];
};

type Snap = Awaited<ReturnType<ReturnType<typeof createSessionStore>["analyze"]>>;
interface P {
  status?: string;
  items: { id: string; tactic: string; quote: string; segmentId: string; unresolvedTerm: string }[];
  allReviewed: boolean;
  source: string;
  assessmentId: string;
}
const pOf = (s: Snap) => (s as unknown as { pressure: P | null }).pressure;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(text: string, opts: any = {}) {
  const store = createSessionStore({ offline: true, ...opts });
  const id = store.createSession();
  store.setTranscript(id, text);
  expect((await store.redact(id)).state).toBe("review_required");
  store.approve(id);
  const s = await store.analyze(id);
  return { store, id, s };
}

const PRESSURE_TEXT = "Renewal call\nThis is the last chance, the discount expires tonight\nCan we keep net-45 terms?";

describe("C7a honest pressure states", () => {
  it("C7-1: not_run, failed, valid_negative and valid_positive are distinct", async () => {
    const notRun = pOf((await run(PRESSURE_TEXT, { pressureClassifier: null })).s);
    const failed = pOf(
      (await run(PRESSURE_TEXT, { pressureClassifier: { mode: "fixture", classify: async () => { throw new Error("boom"); } } })).s,
    );
    const neg = pOf((await run("Agenda review\nNext sync is Thursday at 10")).s);
    const pos = pOf((await run(PRESSURE_TEXT)).s);
    expect([notRun?.status, failed?.status, neg?.status, pos?.status]).toEqual([
      "not_run",
      "failed",
      "valid_negative",
      "valid_positive",
    ]);
  });

  it("C7-2: absent classifier is visibly not run; throwing classifier is visibly failed; neither is a reviewed success", async () => {
    for (const [opts, word] of [
      [{ pressureClassifier: null }, /not run/i],
      [{ pressureClassifier: { mode: "live", classify: async () => { throw new Error("upstream 500"); } } }, /failed|unavailable/i],
    ] as const) {
      const { s } = await run(PRESSURE_TEXT, opts);
      const p = pOf(s)!;
      expect(p.items).toEqual([]);
      expect(p.allReviewed).toBe(false);
      const html = renderSessionPage(s);
      const src = /<p id="pressure-source">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
      expect(src).toMatch(word);
      expect(html).not.toMatch(/no pressure (found|detected)/i);
    }
  });

  it("C7-3: unresolved term needs validated provenance; else 'term not identified'", async () => {
    const pattern = pOf((await run(PRESSURE_TEXT)).s)!;
    expect(pattern.items.length).toBeGreaterThan(0);
    for (const it0 of pattern.items) {
      expect(it0.unresolvedTerm).toBe("");
      expect(it0.unresolvedTerm).not.toBe("This is the last chance, the discount expires tonight");
    }
    const html = renderSessionPage((await run(PRESSURE_TEXT)).s);
    expect(html).toContain("term not identified");
    expect(html).not.toMatch(/unresolved term: This is the last chance/);
    const label = (ask: string) => ({
      mode: "fixture",
      classify: async () => [{ segmentId: "seg-2", tactic: "scarcity", ask, target: "owner", span: "last chance", source: "fixture" }],
    });
    // valid: ask appears in the approved text and is not the whole sentence
    const ok = pOf((await run(PRESSURE_TEXT, { pressureClassifier: label("the discount") })).s)!;
    expect(ok.items[0]!.unresolvedTerm).toBe("the discount");
    // invented term, and whole-sentence default: not shown as a term
    for (const bad of ["net-90 terms", "This is the last chance, the discount expires tonight", "net-45 terms"]) {
      const p = pOf((await run(PRESSURE_TEXT, { pressureClassifier: label(bad) })).s)!;
      expect(p.items[0]!.unresolvedTerm, bad).toBe("");
    }
  });

  it("C7-4: a known positive through the default path yields a nonempty assessment, exact quote and citation", async () => {
    const { s } = await run(PRESSURE_TEXT);
    const p = pOf(s)!;
    expect(p.status).toBe("valid_positive");
    expect(p.items).toEqual([
      expect.objectContaining({ tactic: "scarcity", quote: "last chance", segmentId: "seg-2" }),
    ]);
    const seg = s.segments.find((g) => g.id === "seg-2")!;
    expect(seg.text).toContain("last chance");
    expect(renderSessionPage(s)).toMatch(/class="pressure-badge" href="#seg-2"/);
  });

  it("C7-5: dev fixtures (urgency, negotiation, neutral, pressure) behave as declared — fixture checks only", async () => {
    expect(DEV.cases.length).toBeGreaterThanOrEqual(7);
    for (const c of DEV.cases) {
      const p = pOf((await run(c.transcript)).s)!;
      expect(p.status, c.id).toBe(c.expected === "pressure" ? "valid_positive" : "valid_negative");
      expect(p.items.length > 0, c.id).toBe(c.expected === "pressure");
    }
  });
});

// ---------- C7b: one connected capability (fake HTTP only) ----------
interface Call { url: string; body: string }
function sse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
const userMsg = (c: Call) =>
  ((JSON.parse(c.body) as { messages?: { role?: string; content?: string }[] }).messages ?? []).find((m) => m.role === "user")?.content ?? "";

function brief(meetingId: string) {
  return {
    meetingId,
    model: "muse-spark-1.3",
    promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries: [{
      id: "e1", category: "decision", text: "keep net-45",
      citations: [{ kind: "segment", segmentId: "seg-3", frameId: null, region: null }],
      requester: null, assignee: null, acceptance: null, speaker: null, flags: [],
    }],
    flagged: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function liveStore(calls: Call[], respond: (body: string) => Response, extra: Record<string, unknown> = {}) {
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), body });
    return respond(body);
  }) as typeof fetch;
  const redactor = { label: "stub", redactText: async (t: string) => ({ maskedText: t, spans: [] }), health: async () => ({ ok: true, label: "stub" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: redactor as any });
  const analyzer = new MuseClient({ fetchImpl, labelTranscriptSegments: true });
  return createSessionStore({ offline: false, gate, redactor, analyzer, analyzerLabel: "MuseClient", ...extra });
}
const echo = (body: string) => {
  const m = /^meetingId: (.+)$/m.exec(userMsg({ url: "", body }));
  return sse(JSON.stringify(brief(m ? m[1]! : "missing")));
};

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"], META_API_KEY: process.env["META_API_KEY"], MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"], MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"] };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const d = mkdtempSync(join(tmpdir(), "c7-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function liveRun(store: ReturnType<typeof createSessionStore>) {
  const id = store.createSession();
  store.setTranscript(id, PRESSURE_TEXT);
  expect((await store.redact(id)).state).toBe("review_required");
  store.approve(id);
  return { id, s: await store.analyze(id) };
}

describe("C7b pressure in the owner-approved Spark request", () => {
  it("C7-7: the structured assessment rides in the single analysis request; no second classifier call", async () => {
    const calls: Call[] = [];
    const { s } = await liveRun(liveStore(calls, echo));
    expect(s.state).toBe("completed");
    expect(calls).toHaveLength(1);
    const msg = userMsg(calls[0]!);
    expect(msg).toMatch(/pressure assessment/i);
    expect(msg).toContain('"tactic":"scarcity"');
    expect(msg).toContain('"quote":"last chance"');
    expect(msg).toContain('"segmentId":"seg-2"');
    const p = pOf(s)!;
    expect(p.status).toBe("valid_positive");
    expect(p.source).not.toBe("none");
  });

  it("C7-8: invalid pressure output or failed analysis stays explicit; no silent heuristic in live mode", async () => {
    const calls: Call[] = [];
    const bad = liveStore(calls, echo, {
      pressureClassifier: { mode: "live", classify: async () => "not-an-array" },
    });
    const r = await liveRun(bad);
    const p = pOf(r.s)!;
    expect(p.status).toBe("failed");
    expect(p.items).toEqual([]);
    expect(p.allReviewed).toBe(false);
    // failed analysis: no fabricated assessment marked reviewed
    const calls2: Call[] = [];
    const down = liveStore(calls2, () => new Response("upstream bad", { status: 400 }));
    const r2 = await liveRun(down);
    expect(r2.s.state).not.toBe("completed");
    const p2 = pOf(r2.s);
    if (p2 !== null) {
      expect(p2.allReviewed).toBe(false);
      expect(["failed", "not_run"]).toContain(p2.status);
    }
  });
});
