import { describe, expect, it } from "vitest";
import {
  approve,
  changeMeeting,
  copyText,
  createDraftState,
  edit,
  isApproved,
  reject,
} from "../src/draftApproval.js";

describe("draftApproval", () => {
  it("starts unapproved and copyText returns null", () => {
    const state = createDraftState("m1", "r1", "hello");
    expect(isApproved(state)).toBe(false);
    expect(copyText(state)).toBeNull();
  });

  it("approve records hash + runId + meetingId and copyText returns the draft", () => {
    const state = approve(createDraftState("m1", "r1", "hello"));
    expect(isApproved(state)).toBe(true);
    expect(copyText(state)).toBe("hello");
    expect(state.approval).toMatchObject({ runId: "r1", meetingId: "m1" });
  });

  it("edit clears approval", () => {
    const approved = approve(createDraftState("m1", "r1", "hello"));
    const edited = edit(approved, "hello!");
    expect(isApproved(edited)).toBe(false);
    expect(copyText(edited)).toBeNull();
    expect(edited.draft).toBe("hello!");
  });

  it("reject clears approval", () => {
    const approved = approve(createDraftState("m1", "r1", "hello"));
    const rejected = reject(approved);
    expect(isApproved(rejected)).toBe(false);
    expect(copyText(rejected)).toBeNull();
  });

  it("changeMeeting clears approval and replaces draft", () => {
    const approved = approve(createDraftState("m1", "r1", "hello"));
    const next = changeMeeting(approved, "m2", "r2", "");
    expect(isApproved(next)).toBe(false);
    expect(copyText(next)).toBeNull();
    expect(next.draft).toBe("");
    expect(next.meetingId).toBe("m2");
    expect(next.runId).toBe("r2");
  });

  it("isApproved is false when runId or meetingId drift after approval", () => {
    const approved = approve(createDraftState("m1", "r1", "hello"));
    expect(isApproved({ ...approved, runId: "r2" })).toBe(false);
    expect(isApproved({ ...approved, meetingId: "m2" })).toBe(false);
  });

  it("isApproved is false when the draft no longer matches the recorded hash", () => {
    const approved = approve(createDraftState("m1", "r1", "hello"));
    expect(isApproved({ ...approved, draft: "hello?" })).toBe(false);
  });

  it("approves with zero pressure flags (approval needs no flags)", () => {
    const state = approve(createDraftState("blank", "r1", "typed text"));
    expect(isApproved(state)).toBe(true);
    expect(copyText(state)).toBe("typed text");
  });
});
