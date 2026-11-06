/**
 * G4a — coherent negative pressure evidence (session boundary).
 * Invented meeting text only. Injected fixture classifiers, offline:true.
 * No network, no models.
 */
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";

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

const noneLabel = (over: Record<string, unknown> = {}) => ({
  segmentId: "seg-2",
  tactic: "none",
  ask: "",
  target: "owner",
  span: "",
  source: "fixture",
  ...over,
});

const validLabel = () => ({
  segmentId: "seg-2",
  tactic: "scarcity",
  ask: "",
  target: "owner",
  span: "last chance",
  source: "fixture",
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function copyBlocked(store: any, id: string): boolean {
  store.editDraft(id, DRAFT);
  store.approveDraft(id, DRAFT);
  return store.getState(id).draft?.approved !== true;
}

describe("G4a negative pressure evidence", () => {
  it("G4-1", async () => {
    const { store, id, s } = await run(TEXT, cls([noneLabel({ span: "last chance" })]));
    const p = s.pressure;
    expect(p?.status, "contradictory-none-accepted: none with a positive span is not valid_negative").not.toBe(
      "valid_negative",
    );
    expect(p?.allReviewed, "contradictory-none-accepted: Copy must stay blocked").toBe(false);
    expect(copyBlocked(store, id), "contradictory-none-accepted: draft approval stays refused").toBe(true);
  });

  it("G4-2", async () => {
    const bad: [string, unknown][] = [
      ["unknown segment", [noneLabel({ segmentId: "seg-99" })]],
      ["invented span", [noneLabel({ span: "invented words" })]],
    ];
    for (const [name, labels] of bad) {
      const { store, id, s } = await run(TEXT, cls(labels));
      const p = s.pressure;
      expect(p?.status, `invalid-none-accepted: ${name} is not valid_negative`).not.toBe("valid_negative");
      expect(p?.allReviewed, `invalid-none-accepted: ${name} keeps Copy blocked`).toBe(false);
      expect(copyBlocked(store, id), `invalid-none-accepted: ${name} draft stays refused`).toBe(true);
    }
    // Guard (passes on parent): a malformed span is already rejected as an
    // unusable label array. No token on this sub-case.
    const malformed = await run(TEXT, cls([{ ...noneLabel(), span: 7 }]));
    expect(malformed.s.pressure?.status).toBe("failed");
    expect(malformed.s.pressure?.allReviewed).toBe(false);
  });

  it("G4-3", async () => {
    const { store, id, s } = await run(
      TEXT,
      cls([validLabel(), noneLabel({ segmentId: "seg-99", span: "x" })]),
    );
    const p = s.pressure;
    expect(p?.status, "mixed-none-dropped: valid positive + invalid none is failed").toBe("failed");
    expect(p?.items, "mixed-none-dropped: no silently valid items").toEqual([]);
    expect(copyBlocked(store, id), "mixed-none-dropped: draft approval stays refused").toBe(true);
  });

  it("G4-4g", async () => {
    const pos = await run(TEXT, cls([validLabel()]));
    expect(pos.s.pressure?.status).toBe("valid_positive");
    expect(pos.s.pressure?.allReviewed).toBe(false);
    const pid = pos.s.pressure?.assessmentId as string;
    let snap = pos.store.getState(pos.id);
    for (const item of snap.pressure?.items ?? []) {
      snap = pos.store.reviewPressure(pos.id, item.id, {
        expectedRevision: snap.revision,
        assessmentId: pid,
      });
    }
    expect(snap.pressure?.allReviewed).toBe(true);

    const neg = await run(TEXT, cls([]));
    expect(neg.s.pressure?.status).toBe("valid_negative");
    expect(neg.s.pressure?.allReviewed).toBe(true);

    const throwing = await run(TEXT, {
      mode: "fixture",
      classify: async () => {
        throw new Error("boom");
      },
    });
    expect(throwing.s.pressure?.status).toBe("failed");

    const pattern = await run(TEXT, undefined);
    expect(pattern.s.pressure?.status).toBe("valid_positive");

    const allInvalid = await run(TEXT, cls([{ ...validLabel(), tactic: "mind_control" }]));
    expect(allInvalid.s.pressure?.status).toBe("failed");

    const explicit = await run(TEXT, cls([noneLabel()]));
    expect(explicit.s.pressure?.status).toBe("valid_negative");
    expect(explicit.s.pressure?.items).toEqual([]);
  });
});
