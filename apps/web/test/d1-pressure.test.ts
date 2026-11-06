/**
 * D1 regressions — rejected pressure labels fail loudly, never valid_negative.
 * Injected fixture classifiers only; made-up meeting text. No network, no models.
 */
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage } from "../src/render.js";

const TEXT = "Team sync\nThis is the last chance to review the plan\nNext check-in Thursday";
const DRAFT = "I will follow up on Thursday.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cls = (labels: any) => ({ mode: "fixture" as const, classify: async () => labels });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(text: string, classifier: any) {
  const store = createSessionStore({ offline: true, pressureClassifier: classifier });
  const id = store.createSession();
  store.setTranscript(id, text);
  expect((await store.redact(id)).state).toBe("review_required");
  store.approve(id);
  const s = await store.analyze(id);
  return { store, id, s };
}

const validLabel = () => ({
  segmentId: "seg-2",
  tactic: "scarcity",
  ask: "",
  target: "owner",
  span: "last chance",
  source: "fixture",
});

describe("D1 rejected labels fail loudly", () => {
  it("D1-4: rejected labels fail with a reason and keep Copy disabled", async () => {
    const cases: [string, unknown][] = [
      ["unknown tactic", [{ ...validLabel(), tactic: "mind_control" }]],
      ["unknown segment", [{ ...validLabel(), segmentId: "seg-99" }]],
      ["empty quote", [{ ...validLabel(), span: "" }]],
      ["nonmatching quote", [{ ...validLabel(), span: "uma@example.invalid" }]],
      [
        "missing span",
        [{ segmentId: "seg-2", tactic: "scarcity", ask: "", target: "owner", source: "fixture" }],
      ],
      ["mixed valid+invalid", [validLabel(), { ...validLabel(), tactic: "mind_control" }]],
    ];
    for (const [name, labels] of cases) {
      const { store, id, s } = await run(TEXT, cls(labels));
      const p = s.pressure;
      expect(p?.status, name).toBe("failed");
      expect(p?.items, name).toEqual([]);
      expect(p?.allReviewed, name).toBe(false);
      expect(p?.reason ?? "", name).not.toBe("");
      store.editDraft(id, DRAFT);
      store.approveDraft(id, DRAFT);
      expect(store.getState(id).draft?.approved, `${name}: copy gate`).toBe(false);
      const html = renderSessionPage(store.getState(id));
      expect(html, `${name}: visible reason`).toContain("pressure-reason");
    }
  });

  it("D1-5: a valid positive and an explicit valid negative still work", async () => {
    const pos = await run(TEXT, cls([validLabel()]));
    expect(pos.s.pressure?.status).toBe("valid_positive");
    expect(pos.s.pressure?.items).toEqual([
      expect.objectContaining({ tactic: "scarcity", quote: "last chance", segmentId: "seg-2" }),
    ]);
    const pressureId = pos.s.pressure?.assessmentId;
    expect(typeof pressureId).toBe("string");
    let snap = pos.store.getState(pos.id);
    for (const item of snap.pressure?.items ?? []) {
      snap = pos.store.reviewPressure(pos.id, item.id, {
        expectedRevision: snap.revision,
        assessmentId: pressureId as string,
      });
    }
    expect(snap.pressure?.allReviewed).toBe(true);
    pos.store.editDraft(pos.id, DRAFT);
    pos.store.approveDraft(pos.id, DRAFT);
    expect(pos.store.getState(pos.id).draft?.approved).toBe(true);

    const neg = await run(TEXT, cls([]));
    expect(neg.s.pressure?.status).toBe("valid_negative");
    expect(neg.s.pressure?.items).toEqual([]);
    expect(neg.s.pressure?.allReviewed).toBe(true);
    neg.store.editDraft(neg.id, DRAFT);
    neg.store.approveDraft(neg.id, DRAFT);
    expect(neg.store.getState(neg.id).draft?.approved).toBe(true);

    const noneOnly = await run(TEXT, cls([{ ...validLabel(), tactic: "none", span: "" }]));
    expect(noneOnly.s.pressure?.status).toBe("valid_negative");
    expect(noneOnly.s.pressure?.items).toEqual([]);
  });
});
