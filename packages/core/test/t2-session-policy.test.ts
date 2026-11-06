import { describe, expect, it } from "vitest";
import { applyGuidance } from "../src/t2/guidance.js";
import {
  SESSION_POLICY_VERSION,
  submitGuidance,
  evaluateOutgoing,
  holdCandidate,
  releaseHeld,
  resetAllPolicyState,
} from "../src/t2/session-policy.js";
import type { HoldHandle } from "../src/t2/session-policy.js";

// independent scanner for test assertions
function testHasProhibited(text: string): boolean {
  const pats: RegExp[] = [
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b\.?/i,
    /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/,
    /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/,
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/i,
    /\b\d{1,2}:\d{2}\b/,
    /\b\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)\b/i,
    /\b(?:today|tonight|tomorrow|yesterday)\b/i,
    /\b(?:next|this|last)\s+(?:week|month|quarter|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i,
    /\bin\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\b/i,
    /\bend of (?:the )?(?:month|week|next week)\b/i,
  ];
  return pats.some((re) => re.test(text));
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("P1 session policy", () => {
  it("P1-1 no-dates guidance and four paraphrases suppress or hold every prohibited date disclosure", () => {
    const paraphrases = [
      "Please do not share any dates",
      "keep dates out of it",
      "don't mention when",
      "no timing details, I'll handle scheduling",
    ];
    const canonical = "Do not share dates. I will confirm the date myself.";
    const allGuidances = [canonical, ...paraphrases];

    const candidates = [
      "Launch is in March.",
      "Meeting on 03-14-2027 at office",
      "See you Tuesday at 3pm in room A",
      "Let's meet next Tuesday to review",
      "mar 14th is the deadline",
      "Due on 2027-03-14 please confirm",
      "Friday 15:30 works for me",
      "in two weeks we will deliver",
    ];

    let ownerIdx = 0;
    for (const g of allGuidances) {
      const owner = `owner-p1-1-${ownerIdx++}`;
      const meeting = "meet-A";
      resetAllPolicyState();
      const sub = submitGuidance(owner, meeting, g);
      // canonical must be applied
      if (g === canonical) {
        expect(sub.status).toBe("applied");
        expect(sub.version).toBe(SESSION_POLICY_VERSION);
      } else {
        // paraphrase: either applied or needs-clarification
        expect(["applied", "needs-clarification"]).toContain(sub.status);
        if (sub.status === "needs-clarification") {
          expect(sub.clarificationQuestion !== undefined && sub.clarificationQuestion.length > 0).toBe(true);
        }
      }

      for (const cand of candidates) {
        const res = evaluateOutgoing(owner, meeting, cand, "turn");
        if (res.outcome === "released") {
          expect(res.text !== undefined).toBe(true);
          expect(testHasProhibited(res.text as string)).toBe(false);
          // guidance text never echoed
          expect((res.text as string).includes(g)).toBe(false);
        } else {
          expect(res.outcome).toBe("held");
        }
      }
    }
  });

  it("P1-1b unmatched or ambiguous guidance never reports a false applied status", () => {
    resetAllPolicyState();
    const owner = "owner-p1-1b";
    const meeting = "meet-B";
    const unmatched = ["Keep it brief", "Thank Priya for the update"];
    for (const g of unmatched) {
      resetAllPolicyState();
      const sub = submitGuidance(owner, meeting, g);
      expect(sub.status).not.toBe("applied");
      const cand = "Launch is in March on Tuesday at 3pm";
      const res = evaluateOutgoing(owner, meeting, cand, "turn");
      expect(res.outcome).toBe("released");
      expect(res.text).toBe(cand);
    }
    resetAllPolicyState();
    const amb = submitGuidance(owner, meeting, "be careful about timing");
    expect(amb.status === "needs-clarification" || amb.status === "not-applied").toBe(true);
    expect(amb.status).not.toBe("applied");
  });

  it("P1-2 restriction persists across three turns and the follow-up draft for its meeting only", () => {
    resetAllPolicyState();
    const owner = "owner-p1-2";
    const meeting = "meet-1";
    submitGuidance(owner, meeting, "Do not share dates. I will confirm the date myself.");

    const turns = [
      "We will launch in March.",
      "See you on 3/14 at noon",
      "How about next Tuesday?",
    ];
    for (const t of turns) {
      const r = evaluateOutgoing(owner, meeting, t, "turn");
      if (r.outcome === "released") expect(testHasProhibited(r.text as string)).toBe(false);
      else expect(r.outcome).toBe("held");
      expect(r.version).toBe(SESSION_POLICY_VERSION);
      expect(typeof r.generation).toBe("number");
    }
    const draft = { subject: "Follow-up for March meeting", body: "Let's meet Friday 15:30 and finalize by 03-14-2027" };
    const dr = evaluateOutgoing(owner, meeting, draft, "follow-up-draft");
    if (dr.outcome === "released") expect(testHasProhibited(dr.text as string)).toBe(false);
    else expect(dr.outcome).toBe("held");

    // different meeting same owner -> released unchanged
    const otherMeeting = "meet-2";
    for (const t of turns) {
      const r2 = evaluateOutgoing(owner, otherMeeting, t, "turn");
      expect(r2.outcome).toBe("released");
      expect(r2.text).toBe(t);
    }
    // different owner same meeting id -> released unchanged
    const otherOwner = "owner-other";
    for (const t of turns) {
      const r3 = evaluateOutgoing(otherOwner, meeting, t, "turn");
      expect(r3.outcome).toBe("released");
      expect(r3.text).toBe(t);
    }
  });

  it("P1-3 guidance arriving while an output is held invalidates it before release", async () => {
    resetAllPolicyState();
    const owner = "owner-p1-3";
    const meeting = "meet-hold";
    const candidate = "Launch is in March next Tuesday";

    // pipeline that holds and awaits barrier
    const deferred = createDeferred<void>();
    const handle = holdCandidate(owner, meeting, candidate, "turn");
    let dispatchCount = 0;
    const dispatch = (): void => {
      dispatchCount += 1;
    };

    const pipeline = (async (): Promise<ReturnType<typeof releaseHeld>> => {
      await deferred.promise;
      return releaseHeld(handle, dispatch);
    })();

    // while held, submit new guidance for same scope (increments generation)
    submitGuidance(owner, meeting, "Keep it brief");
    deferred.resolve();
    const result = await pipeline;
    expect(result.outcome).toBe("invalidated");
    expect(result.text).toBeUndefined();
    expect(dispatchCount).toBe(0);
    // second release is single-use
    const second = releaseHeld(handle, dispatch);
    expect(second.outcome).toBe("invalidated");
    expect(dispatchCount).toBe(0);

    // control: different scope does not invalidate
    resetAllPolicyState();
    const owner2 = "owner-p1-3-ctrl";
    const handle2 = holdCandidate(owner2, meeting, candidate, "turn");
    let dispatchCount2 = 0;
    const deferred2 = createDeferred<void>();
    const pipeline2 = (async () => {
      await deferred2.promise;
      return releaseHeld(handle2, () => {
        dispatchCount2 += 1;
      });
    })();
    // guidance to different scope
    submitGuidance("other-owner", "other-meet", "Do not share dates. I will confirm the date myself.");
    deferred2.resolve();
    const result2 = await pipeline2;
    expect(result2.outcome).toBe("released");
    expect(dispatchCount2).toBe(1);
  });

  // Scanner control only: P1-4 seeds a wrapper-level violation; it is not mutation proof of the production module.
  it("P1-4 seeded violation: a checker that lets March through is caught", () => {
    resetAllPolicyState();
    const owner = "owner-p1-4";
    const meeting = "meet-seeded";
    submitGuidance(owner, meeting, "Do not share dates. I will confirm the date myself.");

    const candidates = [
      "Launch is in March.",
      "Meeting on 3/14",
      "See you Tuesday at 3pm",
      "Let's do next Tuesday",
    ];

    function collectViolations(
      evalFn: (o: string, m: string, c: string) => { outcome: string; text?: string },
    ): string[] {
      const violations: string[] = [];
      for (const c of candidates) {
        const r = evalFn(owner, meeting, c);
        if (r.outcome === "released" && r.text !== undefined && testHasProhibited(r.text)) {
          violations.push(r.text);
        }
      }
      return violations;
    }

    // real checker: should have no violations
    const realViolations = collectViolations((o, m, c) => {
      const r = evaluateOutgoing(o, m, c, "turn");
      return { outcome: r.outcome, ...(r.text !== undefined ? { text: r.text } : {}) };
    });
    expect(realViolations.length).toBe(0);

    // broken checker: re-inserts March into released text
    const brokenViolations = collectViolations((o, m, c) => {
      const r = evaluateOutgoing(o, m, c, "turn");
      if (r.outcome === "released") {
        return { outcome: "released", text: `${r.text as string} March` };
      }
      // also broken: releases held as-is
      return { outcome: "released", text: c };
    });
    expect(brokenViolations.length > 0).toBe(true);
  });

  it("P1-5 legacy scripted applyGuidance behavior is unchanged", () => {
    expect(applyGuidance("Launch is in March.", "Keep it calm")).toBe("Noted — Launch is in March.");
    expect(applyGuidance("Launch is in March.", "no dates")).toBe("Launch is in a date Bridgett will confirm.");
  });
});

describe("S2 held records", () => {
  it("S2-1 a stale handle with edited generationAtHold is invalidated with zero dispatch", () => {
    resetAllPolicyState();
    const owner = "owner-s2-1";
    const meeting = "meet-s2-1";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(owner, meeting, clean, "turn");
    submitGuidance(owner, meeting, "Please do not share any dates");
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const forged = { ...handle, generationAtHold: 1 };
    const r = releaseHeld(forged, spy);
    expect(dispatched).toEqual([]);
    expect(r.outcome).toBe("invalidated");
    const dispatched2: string[] = [];
    const spy2 = (t: string): void => {
      dispatched2.push(t);
    };
    const r2 = releaseHeld(handle, spy2);
    expect(dispatched2).toEqual([]);
    expect(r2.outcome).toBe("invalidated");
  });

  it("S2-2 an unissued fabricated handle is invalidated with zero dispatch", () => {
    resetAllPolicyState();
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const clean = "Hello, please review the document.";
    const forged: HoldHandle = {
      id: "hold-forged-1",
      ownerId: "owner-s2-2",
      meetingId: "meet-s2-2",
      generationAtHold: 0,
      candidate: clean,
      kind: "turn",
    };
    const r = releaseHeld(forged, spy);
    expect(dispatched).toEqual([]);
    expect(r.outcome).toBe("invalidated");
  });

  it("S2-3 owner or meeting substitution on a handle is invalidated with zero dispatch", () => {
    resetAllPolicyState();
    const ownerA = "owner-s2-3-A";
    const meetingA = "meet-s2-3-A";
    const otherMeeting = "meet-s2-3-other";
    const otherOwner = "owner-s2-3-other";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(ownerA, meetingA, clean, "turn");
    submitGuidance(ownerA, meetingA, "Please do not share any dates");
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const forgedMeeting = { ...handle, meetingId: otherMeeting };
    const r1 = releaseHeld(forgedMeeting, spy);
    expect(dispatched).toEqual([]);
    expect(r1.outcome).toBe("invalidated");
    const dispatched2: string[] = [];
    const spy2 = (t: string): void => {
      dispatched2.push(t);
    };
    const forgedOwner = { ...handle, ownerId: otherOwner };
    const r2 = releaseHeld(forgedOwner, spy2);
    expect(dispatched2).toEqual([]);
    expect(r2.outcome).toBe("invalidated");
  });

  it("S2-4 a forged attempt does not consume a legitimate pending hold", () => {
    resetAllPolicyState();
    const owner = "owner-s2-4";
    const meeting = "meet-s2-4";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(owner, meeting, clean, "turn");
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const forged = { ...handle, candidate: "Hello, please review the document March 14" };
    const rForged = releaseHeld(forged, spy);
    expect(dispatched).toEqual([]);
    expect(rForged.outcome).toBe("invalidated");
    const dispatchedLegit: string[] = [];
    const spyLegit = (t: string): void => {
      dispatchedLegit.push(t);
    };
    const legit = releaseHeld(handle, spyLegit);
    expect(legit.outcome).toBe("released");
    expect(dispatchedLegit.length).toBe(1);
    expect(dispatchedLegit[0]).toBe(clean);
    const dispatchedSecond: string[] = [];
    const spySecond = (t: string): void => {
      dispatchedSecond.push(t);
    };
    const second = releaseHeld(handle, spySecond);
    expect(second.outcome).toBe("invalidated");
    expect(dispatchedSecond).toEqual([]);
    expect(second.text).toBeUndefined();
  });

  it("S2-5 controls: legitimate single release, same-scope invalidation, unrelated-scope release", () => {
    resetAllPolicyState();
    const owner = "owner-s2-5";
    const meeting = "meet-s2-5";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(owner, meeting, clean, "turn");
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const r = releaseHeld(handle, spy);
    expect(r.outcome).toBe("released");
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toBe(clean);
    const dispatched2: string[] = [];
    const spy2 = (t: string): void => {
      dispatched2.push(t);
    };
    const r2 = releaseHeld(handle, spy2);
    expect(r2.outcome).toBe("invalidated");
    expect(r2.text).toBeUndefined();
    expect(dispatched2).toEqual([]);
    resetAllPolicyState();
    const ownerB = "owner-s2-5-b";
    const meetingB = "meet-s2-5-b";
    const handleB = holdCandidate(ownerB, meetingB, clean, "turn");
    submitGuidance(ownerB, meetingB, "Please do not share any dates");
    const dispatchedB: string[] = [];
    const spyB = (t: string): void => {
      dispatchedB.push(t);
    };
    const rB = releaseHeld(handleB, spyB);
    expect(dispatchedB).toEqual([]);
    expect(rB.outcome).toBe("invalidated");
    resetAllPolicyState();
    const ownerC = "owner-s2-5-c";
    const meetingC = "meet-s2-5-c";
    const handleC = holdCandidate(ownerC, meetingC, clean, "turn");
    submitGuidance("other-owner-s2-5", "other-meet-s2-5", "Please do not share any dates");
    const dispatchedC: string[] = [];
    const spyC = (t: string): void => {
      dispatchedC.push(t);
    };
    const rC = releaseHeld(handleC, spyC);
    expect(rC.outcome).toBe("released");
    expect(dispatchedC.length).toBe(1);
  });
});

describe("S3 iso dates", () => {
  it("S3-1 a complete ISO date under no-date policy never releases its year fragment", () => {
    resetAllPolicyState();
    const owner = "owner-s3-1";
    const meeting = "meet-s3-1";
    const sub = submitGuidance(owner, meeting, "Please do not share any dates");
    expect(sub.status).toBe("applied");
    const candidate = "Venue is booked. The launch review is 2027-03-14, bring the slides.";
    const r = evaluateOutgoing(owner, meeting, candidate, "turn");
    const releasedText = r.outcome === "released" ? (r.text ?? "") : "";
    expect(releasedText).not.toContain("2027");
    expect(releasedText).not.toContain("03-14");
    if (r.outcome === "released") {
      expect(r.text).toContain("Venue is booked.");
      expect(r.text).toContain("The launch review is");
      expect(r.text).toContain("bring the slides.");
    } else {
      expect(r.outcome).toBe("held");
    }
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const handle = holdCandidate(owner, meeting, candidate, "turn");
    const rel = releaseHeld(handle, spy);
    expect(dispatched.join(" ")).not.toContain("2027");
    if (rel.outcome === "released") {
      expect(rel.text).not.toContain("2027");
    } else {
      expect(rel.outcome).toBe("held");
    }
  });

  it("S3-2 control: with no policy the ISO date is released unchanged", () => {
    resetAllPolicyState();
    const owner = "owner-s3-2";
    const meeting = "meet-s3-2";
    const candidate = "Venue is booked. The launch review is 2027-03-14, bring the slides.";
    const r = evaluateOutgoing(owner, meeting, candidate, "turn");
    expect(r.outcome).toBe("released");
    expect(r.text).toBe(candidate);
    expect(r.text).toContain("2027-03-14");
  });
});

describe("S4 controls and acceptance", () => {
  it("S4-1 current-generation owner-only substitution is invalidated with zero dispatch and the original still releases once", () => {
    resetAllPolicyState();
    const ownerA = "owner-s4-1-A";
    const meetingA = "meet-s4-1-A";
    const ownerB = "owner-s4-1-B";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(ownerA, meetingA, clean, "turn");
    expect(handle.generationAtHold).toBe(0);
    const probeA = evaluateOutgoing(ownerA, meetingA, clean, "turn");
    const probeB = evaluateOutgoing(ownerB, meetingA, clean, "turn");
    expect(probeA.generation).toBe(0);
    expect(probeB.generation).toBe(0);
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const forged = { ...handle, ownerId: ownerB };
    const r = releaseHeld(forged, spy);
    expect(r.outcome).toBe("invalidated");
    expect(dispatched).toEqual([]);
    const dispatched2: string[] = [];
    const spy2 = (t: string): void => {
      dispatched2.push(t);
    };
    const legit = releaseHeld(handle, spy2);
    expect(legit.outcome).toBe("released");
    expect(dispatched2.length).toBe(1);
    expect(dispatched2[0]).toBe(clean);
    const dispatched3: string[] = [];
    const spy3 = (t: string): void => {
      dispatched3.push(t);
    };
    const second = releaseHeld(handle, spy3);
    expect(second.outcome).toBe("invalidated");
    expect(dispatched3).toEqual([]);
    expect(second.text).toBeUndefined();
  });

  it("S4-2 current-generation meeting-only substitution is invalidated with zero dispatch and the original still releases once", () => {
    resetAllPolicyState();
    const ownerA = "owner-s4-2-A";
    const meetingA = "meet-s4-2-A";
    const meetingB = "meet-s4-2-B";
    const clean = "Hello, please review the document.";
    const handle = holdCandidate(ownerA, meetingA, clean, "turn");
    expect(handle.generationAtHold).toBe(0);
    const probeA = evaluateOutgoing(ownerA, meetingA, clean, "turn");
    const probeB = evaluateOutgoing(ownerA, meetingB, clean, "turn");
    expect(probeA.generation).toBe(0);
    expect(probeB.generation).toBe(0);
    const dispatched: string[] = [];
    const spy = (t: string): void => {
      dispatched.push(t);
    };
    const forged = { ...handle, meetingId: meetingB };
    const r = releaseHeld(forged, spy);
    expect(r.outcome).toBe("invalidated");
    expect(dispatched).toEqual([]);
    const dispatched2: string[] = [];
    const spy2 = (t: string): void => {
      dispatched2.push(t);
    };
    const legit = releaseHeld(handle, spy2);
    expect(legit.outcome).toBe("released");
    expect(dispatched2.length).toBe(1);
    expect(dispatched2[0]).toBe(clean);
    const dispatched3: string[] = [];
    const spy3 = (t: string): void => {
      dispatched3.push(t);
    };
    const second = releaseHeld(handle, spy3);
    expect(second.outcome).toBe("invalidated");
    expect(dispatched3).toEqual([]);
    expect(second.text).toBeUndefined();
  });

  it("S4-3 acceptance: under no-date policy released text never contains the literal March", () => {
    resetAllPolicyState();
    const owner = "owner-s4-3";
    const meeting = "meet-s4-3";
    const sub = submitGuidance(owner, meeting, "Please do not share any dates");
    expect(sub.status).toBe("applied");
    const candidates = [
      "Launch is in March, bring the slides.",
      "Venue confirmed. Kickoff is March, see you there.",
    ];
    for (const candidate of candidates) {
      const r = evaluateOutgoing(owner, meeting, candidate, "turn");
      const releasedText = r.outcome === "released" ? (r.text ?? "") : "";
      expect(releasedText).not.toContain("March");
      if (r.outcome === "released") {
        if (candidate.includes("Launch is in")) {
          expect(r.text).toContain("Launch is in");
          expect(r.text).toContain("bring the slides.");
        }
        if (candidate.includes("Venue confirmed")) {
          expect(r.text).toContain("Venue confirmed.");
          expect(r.text).toContain("Kickoff is");
          expect(r.text).toContain("see you there.");
        }
      } else {
        expect(r.outcome).toBe("held");
      }
      const dispatched: string[] = [];
      const spy = (t: string): void => {
        dispatched.push(t);
      };
      const handle = holdCandidate(owner, meeting, candidate, "turn");
      const rel = releaseHeld(handle, spy);
      expect(dispatched.join(" ")).not.toContain("March");
      if (rel.outcome === "released") {
        expect(rel.text).not.toContain("March");
      } else {
        expect(rel.outcome).toBe("held");
      }
    }
  });
});
