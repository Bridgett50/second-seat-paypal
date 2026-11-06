import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as room from "@second-seat/bot/dist/src/t2-room.js";

describe("P3g-1 public evaluateOutgoing export", () => {
  it("export shape exposes evaluateOutgoing and hides internal mutators", () => {
    expect(typeof room.evaluateOutgoing).toBe("function");
    expect(typeof room.createMeetingPolicyRecorder).toBe("function");
    expect(typeof room.getPolicyGeneration).toBe("function");
    expect("clearPolicy" in room).toBe(false);
    expect("resetAllPolicyState" in room).toBe(false);
    expect("submitGuidance" in room).toBe(false);
    expect("holdCandidate" in room).toBe(false);
    expect("releaseHeld" in room).toBe(false);
  });

  it("no policy releases dated candidate unchanged at generation 0", () => {
    expect(typeof room.evaluateOutgoing).toBe("function");
    const owner = `owner-${randomUUID()}`;
    const meeting = `meeting-${randomUUID()}`;
    const result = room.evaluateOutgoing(owner, meeting, "We can meet on March 5.", "turn");
    expect(result).toEqual({
      outcome: "released",
      text: "We can meet on March 5.",
      version: "sp-v1",
      generation: 0,
    });
  });

  it("recorded no-dates policy redacts dates and isolates by meeting", () => {
    expect(typeof room.evaluateOutgoing).toBe("function");
    const owner = `owner-${randomUUID()}`;
    const meeting = `meeting-${randomUUID()}`;
    const recorder = room.createMeetingPolicyRecorder(owner, meeting);
    const rec = recorder.record("Do not share any dates.");
    expect(rec).toEqual({ status: "applied", generation: 1 });
    const dated = room.evaluateOutgoing(owner, meeting, "We can meet on March 5.", "turn");
    expect(dated).toEqual({
      outcome: "released",
      text: "We can meet on a date the owner will confirm.",
      version: "sp-v1",
      generation: 1,
    });
    const nodate = room.evaluateOutgoing(owner, meeting, "Thanks, talk soon.", "turn");
    expect(nodate).toEqual({
      outcome: "released",
      text: "Thanks, talk soon.",
      version: "sp-v1",
      generation: 1,
    });
    const otherMeeting = `meeting-${randomUUID()}`;
    const isolated = room.evaluateOutgoing(owner, otherMeeting, "We can meet on March 5.", "turn");
    expect(isolated).toEqual({
      outcome: "released",
      text: "We can meet on March 5.",
      version: "sp-v1",
      generation: 0,
    });
  });

  it("clarification holds prohibited candidates and releases others", () => {
    expect(typeof room.evaluateOutgoing).toBe("function");
    const owner = `owner-${randomUUID()}`;
    const meeting = `meeting-${randomUUID()}`;
    const recorder = room.createMeetingPolicyRecorder(owner, meeting);
    const rec = recorder.record("Be careful about timing.");
    expect(rec).toEqual({ status: "needs-clarification", generation: 1 });
    const held = room.evaluateOutgoing(owner, meeting, "See you tomorrow.", "turn");
    expect(held).toEqual({
      outcome: "held",
      reason: "needs clarification for date disclosure",
      version: "sp-v1",
      generation: 1,
    });
    const released = room.evaluateOutgoing(owner, meeting, "Thanks, talk soon.", "turn");
    expect(released).toEqual({
      outcome: "released",
      text: "Thanks, talk soon.",
      version: "sp-v1",
      generation: 1,
    });
  });
});
