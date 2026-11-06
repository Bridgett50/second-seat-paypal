/**
 * B6 acceptance — pressure evidence connected to the current session.
 * Offline/injected classifiers only; these tests are NOT model-accuracy
 * evidence. Made-up vendor meetings only; no sealed data.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_FIXTURE = join(HERE, "..", "fixtures", "pressure-dev-cases.json");

const T1 = "Vendor wants the renewal signed now\nThe price doubles unless we sign by 5 today\nCan we keep net-45 terms?";

interface Label {
  segmentId: string; tactic: string; ask: string; target: string; span: string; source: "pattern" | "spark" | "fixture";
}
interface Pressure {
  items: { id: string; tactic: string; quote: string; segmentId: string; unresolvedTerm: string }[];
  rejected: number;
  reviewed: string[];
  allReviewed: boolean;
  source: string;
  offline: boolean;
}

function scripted(byCall: Label[][]) {
  const seen: { segmentId: string; text: string }[][] = [];
  let n = 0;
  return {
    seen,
    classifier: {
      mode: "fixture" as const,
      classify: async (lines: { segmentId: string; text: string }[]) => {
        seen.push(lines);
        return byCall[Math.min(n++, byCall.length - 1)] ?? [];
      },
    },
  };
}

const SCARCITY: Label = {
  segmentId: "seg-2", tactic: "scarcity", ask: "sign by 5 today", target: "owner",
  span: "price doubles unless we sign by 5 today", source: "fixture",
};

async function analyzed(labels: Label[][], text = T1) {
  const { classifier, seen } = scripted(labels);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = createSessionStore({ offline: true, pressureClassifier: classifier } as any);
  const id = store.createSession();
  store.setTranscript(id, text);
  const r = await store.redact(id);
  expect(r.state).toBe("review_required");
  store.approve(id);
  const s = await store.analyze(id);
  expect(s.state).toBe("completed");
  return { store, id, s, seen };
}

function pressureOf(s: unknown): Pressure {
  const p = (s as { pressure?: Pressure | null }).pressure;
  if (!p) throw new Error("snapshot has no pressure assessment");
  return p;
}

// Store API extension expected by B6 (typed loosely so this file compiles pre-change).
type B6Store = ReturnType<typeof createSessionStore> & {
  reviewPressure(
    sessionId: string,
    itemId: string,
    opts?: { expectedRevision?: number; assessmentId?: string },
  ): unknown;
};

function reviewOpts(store: ReturnType<typeof createSessionStore>, id: string) {
  const s = store.getState(id) as unknown as {
    revision: number;
    pressure: { assessmentId: string } | null;
  };
  if (!s.pressure) throw new Error("test setup has no pressure assessment");
  return { expectedRevision: s.revision, assessmentId: s.pressure.assessmentId };
}

describe("B6 pressure evidence in /session", () => {
  it("B6-1: assessment appears with quote + citation from the current approved transcript", async () => {
    const { s, seen } = await analyzed([[SCARCITY]]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((l) => l.segmentId)).toEqual(["seg-1", "seg-2", "seg-3"]);
    const p = pressureOf(s);
    expect(p.items).toHaveLength(1);
    const it0 = p.items[0]!;
    expect(it0).toMatchObject({ tactic: "scarcity", segmentId: "seg-2", quote: SCARCITY.span, unresolvedTerm: "sign by 5 today" });
    const seg = s.segments.find((g) => g.id === "seg-2")!;
    expect(seg.text).toContain(it0.quote);
    const html = renderSessionPage(s);
    expect(html).toMatch(/class="pressure-badge"[^>]*href="#seg-2"/);
    expect(html).toContain("price doubles unless we sign by 5 today");
    expect(html).toContain("sign by 5 today");
    // Assessment wording, not certainty about intent.
    expect(html).toMatch(/assessment/i);
    expect(html).not.toMatch(/is manipulating|intends to|is lying/i);
  });

  it("B6-2: fabricated quotes and unknown segments are rejected", async () => {
    const { s } = await analyzed([[
      { ...SCARCITY, span: "price triples tomorrow" },
      { ...SCARCITY, segmentId: "seg-9" },
      { ...SCARCITY, segmentId: "seg-1" }, // real text, wrong segment
      { ...SCARCITY, span: "" },
    ]]);
    const p = pressureOf(s);
    expect(p.items).toEqual([]);
    expect(p.rejected).toBe(4);
    expect(renderSessionPage(s)).not.toContain('class="pressure-badge"');
  });

  it("B6-3: public dev fixtures include ordinary urgency and negotiation as well as pressure", () => {
    expect(existsSync(DEV_FIXTURE)).toBe(true);
    const fx = JSON.parse(readFileSync(DEV_FIXTURE, "utf8")) as {
      note: string; cases: { id: string; kind: string; transcript: string; expected: "pressure" | "none" }[];
    };
    const kinds = (k: string) => fx.cases.filter((c) => c.kind === k);
    expect(kinds("pressure").length).toBeGreaterThanOrEqual(2);
    expect(kinds("ordinary_urgency").length).toBeGreaterThanOrEqual(2);
    expect(kinds("negotiation").length).toBeGreaterThanOrEqual(2);
    expect(kinds("neutral").length).toBeGreaterThanOrEqual(1);
    for (const c of fx.cases) {
      expect(c.expected).toBe(c.kind === "pressure" ? "pressure" : "none");
      expect(c.transcript.split("\n").length).toBeGreaterThanOrEqual(2);
    }
    expect(fx.note).toMatch(/made-up/i);
    expect(fx.note).toMatch(/not .*accuracy/i);
  });

  it("B6-4: a neutral result displays without a pressure badge", async () => {
    const { s } = await analyzed([[{ ...SCARCITY, tactic: "none", span: "" }]], "Agenda review\nNext sync is Thursday at 10");
    const p = pressureOf(s);
    expect(p.items).toEqual([]);
    expect(p.rejected).toBe(0);
    expect(p.allReviewed).toBe(true);
    expect(renderSessionPage(s)).not.toContain('class="pressure-badge"');
  });

  it("B6-5: editing the meeting invalidates pressure-review state and draft approval", async () => {
    const { store, id } = await analyzed([[SCARCITY], [SCARCITY]]);
    const st = store as B6Store;
    st.reviewPressure(id, "p1", reviewOpts(store, id));
    store.editDraft(id, "Thanks, we will review terms internally.");
    const ok = store.approveDraft(id, "Thanks, we will review terms internally.");
    expect(ok.draft?.approved).toBe(true);
    store.setTranscript(id, T1 + "\nAlso confirm the delivery window");
    const after = store.getState(id);
    expect(after.draft).toBeNull();
    expect((after as { pressure?: unknown }).pressure ?? null).toBeNull();
    // Re-run on the new revision: the old review does not carry over.
    await store.redact(id);
    store.approve(id);
    const again = await store.analyze(id);
    const p = pressureOf(again);
    expect(p.items).toHaveLength(1);
    expect(p.reviewed).toEqual([]);
    expect(p.allReviewed).toBe(false);
    // Invalidating the preview also drops review state.
    st.reviewPressure(id, "p1", reviewOpts(store, id));
    store.invalidate(id, "preview");
    expect((store.getState(id) as { pressure?: unknown }).pressure ?? null).toBeNull();
  });

  it("B6-6: acknowledgement is required — Copy unavailable until current findings are reviewed", async () => {
    const { store, id } = await analyzed([[SCARCITY]]);
    const st = store as B6Store;
    const draft = "We need time to review the renewal terms.";
    store.editDraft(id, draft);
    const pre = store.approveDraft(id, draft);
    expect(pre.draft?.approved).toBe(false);
    expect(renderSessionPage(pre)).toMatch(/<button type="button" id="btn-copy" disabled/);
    expect(() => st.reviewPressure(id, "p-unknown")).toThrow();
    const reviewed = st.reviewPressure(id, "p1", reviewOpts(store, id));
    expect(pressureOf(reviewed).allReviewed).toBe(true);
    const post = store.approveDraft(id, draft);
    expect(post.draft?.approved).toBe(true);
    expect(renderSessionPage(post)).toMatch(/<button type="button" id="btn-copy">/);
  });

  it("B6-7: zero-pressure cases remain usable (Copy after draft approval only)", async () => {
    const { store, id, s } = await analyzed([[]], "Agenda review\nNext sync is Thursday at 10");
    expect(pressureOf(s).items).toEqual([]);
    store.editDraft(id, "See you Thursday.");
    const d = store.approveDraft(id, "See you Thursday.");
    expect(d.draft?.approved).toBe(true);
  });

  it("B6-8: offline fixtures stay labelled offline, never as model evidence", async () => {
    const { s } = await analyzed([[SCARCITY]]);
    const p = pressureOf(s);
    expect(p.offline).toBe(true);
    expect(p.source).toMatch(/offline|fixture|pattern/i);
    const html = renderSessionPage(s);
    expect(html).toMatch(/offline/i);
    expect(html).not.toMatch(/Spark (found|detected)|Glimmer (found|detected)/i);
  });

  it("B6-8b: default offline store uses the deterministic pattern layer, labelled offline", async () => {
    const store = createSessionStore({ offline: true });
    const id = store.createSession();
    store.setTranscript(id, T1);
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    const p = pressureOf(s);
    expect(p.offline).toBe(true);
    for (const item of p.items) {
      const seg = s.segments.find((g) => g.id === item.segmentId);
      expect(seg?.text).toContain(item.quote);
    }
  });
});
