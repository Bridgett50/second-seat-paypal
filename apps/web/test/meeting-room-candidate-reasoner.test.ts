import { describe, expect, it, vi } from "vitest";
import { createPrivacyGate, GatedText } from "@second-seat/bot/dist/src/private/gate.js";
import { createCandidateReasoner } from "../src/candidateReasoner.js";
import { createCandidateTransport } from "../src/candidateTransport.js";
import type { CandidateReasonerInput } from "../src/meetingRoom.js";

function fakeRedactor() {
  return {
    label: "test-fake",
    redactText: async (text: string) => {
      const needle = "alice@example.com";
      const idx = text.indexOf(needle);
      if (idx !== -1) {
        return { maskedText: text.slice(0, idx) + "[REDACTED_email]" + text.slice(idx + needle.length), spans: [{ start: idx, end: idx + needle.length, label: "email" }] };
      }
      return { maskedText: text, spans: [] };
    },
    redactImage: async () => { throw new Error("no images"); },
    health: async () => ({ ok: true, label: "test-fake" }),
  };
}

function baseInput(): CandidateReasonerInput {
  return { roomId: "r1", ownerId: "o1", meetingId: "m1", contextRevision: 7, policyGeneration: 3, utterances: [{ utteranceId: "u1", sequence: 0, revision: 1, speaker: "alice", text: "hi alice@example.com" }], guidance: ["SECRET_GUIDANCE_XYZ"], notes: ["SECRET_NOTES_ABC"] };
}

describe("candidateReasoner", () => {
  it("OFF", () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const deps = { gate, requestOwnerApproval: async () => null, isCurrent: () => true, callModel: async (_g: GatedText) => null };
    expect(createCandidateReasoner({}, deps)).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "0" }, deps)).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" })).toBeUndefined();
    expect(createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1", SECOND_SEAT_TEST_MODE: "1" }, deps)).toBeUndefined();
  });
  it("approved containment + frozen binding", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "model-ok");
    let seenBinding: unknown;
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (runId, redactedPreview, binding) => { seenBinding = binding; return gate.approve(runId, redactedPreview); }, isCurrent: () => true, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    await expect(reasoner(baseInput())).resolves.toBe("model-ok");
    expect(model).toHaveBeenCalledTimes(1);
    const call = model.mock.calls[0];
    if (call === undefined) throw new Error("no call");
    const gated = call[0];
    expect(gated).toBeInstanceOf(GatedText);
    expect(gated.text).toContain("[REDACTED_email]");
    expect(gated.text).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab");
    expect(gated.text).not.toContain("alice@example.com");
    expect(gated.text).not.toContain("SECRET_GUIDANCE_XYZ");
    expect(gated.text).not.toContain("SECRET_NOTES_ABC");
    expect(Object.isFrozen(seenBinding)).toBe(true);
    expect(seenBinding).toEqual({ roomId: "r1", ownerId: "o1", meetingId: "m1", contextRevision: 7, policyGeneration: 3 });
  });
  it("denial", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "ok");
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async () => null, isCurrent: () => true, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    await expect(reasoner(baseInput())).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(0);
  });
  it("held approval goes stale", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "ok");
    let current = true;
    let capturedRunId = "";
    let capturedPreview = "";
    let resolveEntered: (v: void) => void = () => {};
    const entered = new Promise<void>((res) => { resolveEntered = res; });
    let resolveToken: (v: string) => void = () => {};
    const heldToken = new Promise<string>((res) => { resolveToken = res; });
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (r, red) => { capturedRunId = r; capturedPreview = red; resolveEntered(); return heldToken; }, isCurrent: () => current, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    const p = reasoner(baseInput());
    await entered;
    current = false;
    const realToken = gate.approve(capturedRunId, capturedPreview);
    resolveToken(realToken);
    await expect(p).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(0);
    const fn = vi.fn(async (_g: GatedText) => "x");
    await expect(gate.send(capturedRunId, realToken, fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
  it("registered revoke during held transport preflight => 0 fetch/receipts", async () => {
    const prev = process.env.GLIMMER_BASE_URL;
    process.env.GLIMMER_BASE_URL = "http://127.0.0.1:9";
    try {
      const gate = createPrivacyGate({ mode: "live", redactor: fakeRedactor() });
      const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
      let enteredResolve: (v: void) => void = () => {};
      const enteredP = new Promise<void>((res) => { enteredResolve = res; });
      let releaseResolve: (v: void) => void = () => {};
      const releaseP = new Promise<void>((res) => { releaseResolve = res; });
      const entered = () => { enteredResolve(undefined); };
      const release = () => { releaseResolve(undefined); };
      let capturedRunId = "";
      const transport = createCandidateTransport({
        apiKey: "k",
        fetchImpl,
        checkCapsPreCall: async () => undefined,
        checkPerCallTokenCap: () => undefined,
        recordCall: async () => undefined,
        preflight: async () => { entered(); await releaseP; },
      });
      const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
        gate,
        requestOwnerApproval: async (runId, preview) => {
          capturedRunId = runId;
          return Promise.resolve(gate.approve(runId, preview));
        },
        isCurrent: () => true,
        callModel: transport,
      });
      if (reasoner === undefined) throw new Error("reasoner off");
      const regs: Array<() => void> = [];
      const input = baseInput();
      const inputWithReg = {
        roomId: input.roomId,
        ownerId: input.ownerId,
        meetingId: input.meetingId,
        contextRevision: input.contextRevision,
        policyGeneration: input.policyGeneration,
        utterances: input.utterances,
        guidance: input.guidance,
        notes: input.notes,
        registerRevoke: (fn: () => void) => { regs.push(fn); },
      };
      const p = reasoner(inputWithReg);
      await enteredP;
      const r = regs[0];
      if (r === undefined) throw new Error("no revoke registered");
      r();
      release();
      await expect(p).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(0);
      expect(gate.receipts(capturedRunId).length).toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.GLIMMER_BASE_URL;
      } else {
        process.env.GLIMMER_BASE_URL = prev;
      }
    }
  });
  it("isCurrent false during held prepare => no registration/approval/model, run revoked", async () => {
    let enteredResolve: (v: void) => void = () => {};
    const enteredP = new Promise<void>((res) => { enteredResolve = res; });
    let releaseResolve: (v: void) => void = () => {};
    const releaseP = new Promise<void>((res) => { releaseResolve = res; });
    const baseGate = createPrivacyGate({ mode: "fixture", redactor: {
      label: "test-fake-held",
      redactText: async (text: string) => {
        enteredResolve(undefined);
        await releaseP;
        const needle = "alice@example.com";
        const idx = text.indexOf(needle);
        if (idx !== -1) {
          return { maskedText: text.slice(0, idx) + "[REDACTED_email]" + text.slice(idx + needle.length), spans: [{ start: idx, end: idx + needle.length, label: "email" }] };
        }
        return { maskedText: text, spans: [] };
      },
      redactImage: async () => { throw new Error("no images"); },
      health: async () => ({ ok: true, label: "test-fake-held" }),
    }});
    const runIds: string[] = [];
    const revokeSpy = vi.spyOn(baseGate, "revoke");
    const g = {
      prepare: async (t: string) => {
        const r = await baseGate.prepare(t);
        runIds.push(r.runId);
        return r;
      },
      preview: baseGate.preview.bind(baseGate),
      correct: baseGate.correct.bind(baseGate),
      approve: baseGate.approve.bind(baseGate),
      send: baseGate.send.bind(baseGate),
      revoke: baseGate.revoke.bind(baseGate),
      receipts: baseGate.receipts.bind(baseGate),
    };
    let registerCalled = false;
    let approvalCalled = false;
    const model = vi.fn(async (_g: GatedText) => "ok");
    let current = true;
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
      gate: g,
      requestOwnerApproval: async () => { approvalCalled = true; return "tok"; },
      isCurrent: () => current,
      callModel: model,
    });
    if (reasoner === undefined) throw new Error("reasoner off");
    const input = baseInput();
    const inputWithReg = {
      roomId: input.roomId,
      ownerId: input.ownerId,
      meetingId: input.meetingId,
      contextRevision: input.contextRevision,
      policyGeneration: input.policyGeneration,
      utterances: input.utterances,
      guidance: input.guidance,
      notes: input.notes,
      registerRevoke: () => { registerCalled = true; },
    };
    const p = reasoner(inputWithReg);
    await enteredP;
    current = false;
    releaseResolve(undefined);
    await expect(p).rejects.toThrow();
    expect(registerCalled).toBe(false);
    expect(approvalCalled).toBe(false);
    expect(model).toHaveBeenCalledTimes(0);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    const firstRunId = runIds[0];
    if (firstRunId === undefined) throw new Error("no runId");
      const first = revokeSpy.mock.calls[0]; if (first === undefined) throw new Error("no revoke call");
      expect(first[0]).toBe(firstRunId);
  });
  it("registrar throws => no approval/model, run revoked", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const runIds: string[] = [];
    const baseRevoke = gate.revoke.bind(gate);
    let revokedId = "";
    let revokeCount = 0;
    const g = {
      prepare: async (t: string) => {
        const r = await gate.prepare(t);
        runIds.push(r.runId);
        return r;
      },
      preview: gate.preview.bind(gate),
      correct: gate.correct.bind(gate),
      approve: gate.approve.bind(gate),
      send: gate.send.bind(gate),
      revoke: (id: string) => { revokeCount += 1; revokedId = id; return baseRevoke(id); },
      receipts: gate.receipts.bind(gate),
    };
    let approvalCalled = false;
    const model = vi.fn(async (_g: GatedText) => "ok");
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
      gate: g,
      requestOwnerApproval: async () => { approvalCalled = true; return "tok"; },
      isCurrent: () => true,
      callModel: model,
    });
    if (reasoner === undefined) throw new Error("reasoner off");
    const input = baseInput();
    const inputWithReg = {
      roomId: input.roomId,
      ownerId: input.ownerId,
      meetingId: input.meetingId,
      contextRevision: input.contextRevision,
      policyGeneration: input.policyGeneration,
      utterances: input.utterances,
      guidance: input.guidance,
      notes: input.notes,
      registerRevoke: () => { throw new Error("registrar boom"); },
    };
    await expect(reasoner(inputWithReg)).rejects.toThrow("registrar boom");
    expect(approvalCalled).toBe(false);
    expect(model).toHaveBeenCalledTimes(0);
    expect(revokeCount).toBe(1);
    const firstRunId = runIds[0];
    if (firstRunId === undefined) throw new Error("no runId");
    expect(revokedId).toBe(firstRunId);
  });

  it("registered revoke during held approval settles before token release; old token refused", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (_g: GatedText) => "ok");
    let capturedRunId = "";
    let approvalCalls = 0;
    let seenSignal: AbortSignal | undefined;
    let mintedToken = "";
    let releaseToken: (v: string | null) => void = () => {};
    const held = new Promise<string | null>((res) => { releaseToken = res; });
    let resolveEntered: () => void = () => {};
    const entered = new Promise<void>((res) => { resolveEntered = res; });
    const regs: Array<() => void> = [];
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
      gate,
      requestOwnerApproval: async (runId, preview, _binding, signal?: AbortSignal) => {
        approvalCalls += 1;
        capturedRunId = runId;
        seenSignal = signal;
        mintedToken = gate.approve(runId, preview);
        resolveEntered();
        return held;
      },
      isCurrent: () => true,
      callModel: model,
    });
    if (reasoner === undefined) throw new Error("reasoner off");
    const input = baseInput();
    const inputWithRevoke: CandidateReasonerInput = {
      roomId: input.roomId,
      ownerId: input.ownerId,
      meetingId: input.meetingId,
      contextRevision: input.contextRevision,
      policyGeneration: input.policyGeneration,
      utterances: input.utterances,
      guidance: input.guidance,
      notes: input.notes,
      registerRevoke: (fn: () => void) => { regs.push(fn); },
    };
    let outcome = "pending";
    const done = reasoner(inputWithRevoke).then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    try {
      await entered;
      const r = regs[0];
      if (r === undefined) throw new Error("no revoke registered");
      r();
      await new Promise<void>((res) => setImmediate(res));
      expect(outcome).toBe("rejected");
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      releaseToken(mintedToken);
      await done;
    }
    await new Promise<void>((res) => setImmediate(res));
    expect(approvalCalls).toBe(1);
    expect(model).toHaveBeenCalledTimes(0);
    expect(gate.receipts(capturedRunId).length).toBe(0);
    const fn = vi.fn(async (_g: GatedText) => "x");
    await expect(gate.send(capturedRunId, mintedToken, fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it("registrar revokes synchronously => no approval/model, run revoked", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const runIds: string[] = [];
    const baseRevoke = gate.revoke.bind(gate);
    let revokedId = "";
    let revokeCount = 0;
    const g = {
      prepare: async (t: string) => {
        const r = await gate.prepare(t);
        runIds.push(r.runId);
        return r;
      },
      preview: gate.preview.bind(gate),
      correct: gate.correct.bind(gate),
      approve: gate.approve.bind(gate),
      send: gate.send.bind(gate),
      revoke: (id: string) => { revokeCount += 1; revokedId = id; return baseRevoke(id); },
      receipts: gate.receipts.bind(gate),
    };
    let approvalCalled = false;
    const model = vi.fn(async (_g: GatedText) => "ok");
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
      gate: g,
      requestOwnerApproval: async () => { approvalCalled = true; return "tok"; },
      isCurrent: () => true,
      callModel: model,
    });
    if (reasoner === undefined) throw new Error("reasoner off");
    const input = baseInput();
    const inputWithReg = {
      roomId: input.roomId,
      ownerId: input.ownerId,
      meetingId: input.meetingId,
      contextRevision: input.contextRevision,
      policyGeneration: input.policyGeneration,
      utterances: input.utterances,
      guidance: input.guidance,
      notes: input.notes,
      registerRevoke: (fn: () => void) => { fn(); },
    };
    await expect(reasoner(inputWithReg)).rejects.toThrow();
    expect(approvalCalled).toBe(false);
    expect(model).toHaveBeenCalledTimes(0);
    expect(revokeCount).toBeGreaterThanOrEqual(1);
    const firstRunId = runIds[0];
    if (firstRunId === undefined) throw new Error("no runId");
    for (const id of runIds) expect(id).toBe(firstRunId);
    expect(revokedId).toBe(firstRunId);
    expect(gate.receipts(firstRunId).length).toBe(0);
  });
  it("follow-up email task via approved gate", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async (gated: GatedText) => gated.text);
    let captured: string | undefined;
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (runId, redactedPreview, binding) => { captured = redactedPreview; return gate.approve(runId, redactedPreview); }, isCurrent: () => true, callModel: model });
    if (reasoner === undefined) throw new Error("reasoner off");
    const result = await reasoner(baseInput());
    expect(result).toBe(captured);
    expect(result).toMatch(/follow-up email/i);
    expect(result).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab");
    expect(result).toContain("[REDACTED_email]");
    expect(result).not.toContain("alice@example.com");
    expect(result).not.toContain("SECRET_GUIDANCE_XYZ");
    expect(result).not.toContain("SECRET_NOTES_ABC");
  });

it("rejects over 20k aggregate context before gate.prepare", async () => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const prepareSpy = vi.spyOn(gate, "prepare");
  const model = vi.fn(async (_g: GatedText) => null);
  const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async () => null, isCurrent: () => true, callModel: model });
  if (reasoner === undefined) throw new Error("reasoner off");
  const base = baseInput();
  const first = base.utterances[0];
  if (first === undefined) throw new Error("no utterance");
  const utterances = Array.from({ length: 11 }, (_, i) => ({ ...first, utteranceId: "u" + (i + 1), sequence: i + 1, text: "x".repeat(2000) }));
  try {
    await expect(reasoner({ ...base, utterances })).rejects.toThrow();
    expect(prepareSpy).toHaveBeenCalledTimes(0);
    expect(model).toHaveBeenCalledTimes(0);
  } finally {
    prepareSpy.mockRestore();
  }
});

});

it("forwards meeting text without leaking utteranceId", async () => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const model = vi.fn(async (_g: GatedText) => "model-ok");
  const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (runId, preview) => gate.approve(runId, preview), isCurrent: () => true, callModel: model });
  if (reasoner === undefined) throw new Error("reasoner off");
  const input = { ...baseInput(), utterances: [{ utteranceId: "abcdefab-cdef-4abc-8def-123456789abc", sequence: 0, revision: 1, speaker: "Participant", text: "I will confirm the date myself." }] };
  await expect(reasoner(input)).resolves.toBe("model-ok");
  expect(model).toHaveBeenCalledTimes(1);
  const firstCall = model.mock.calls[0];
  if (!firstCall) throw new Error("no call");
  const gated = firstCall[0];
  expect(gated.text).toContain("I will confirm the date myself.");
  expect(gated.text).not.toContain("abcdefab-cdef-4abc-8def-123456789abc");
});

it("rejects unmasked phone number before model call", async () => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const model = vi.fn(async (_g: GatedText) => "model-ok");
  const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, requestOwnerApproval: async (runId, preview) => gate.approve(runId, preview), isCurrent: () => true, callModel: model });
  if (reasoner === undefined) throw new Error("reasoner off");
  const input = { ...baseInput(), utterances: [{ utteranceId: "u1", sequence: 0, revision: 1, speaker: "Participant", text: "Call 415-555-0112." }] };
  await expect(reasoner(input)).rejects.toThrow();
  expect(model).toHaveBeenCalledTimes(0);
});

it("maps prompt-local aliases back to original utterance identities", async () => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const model = vi.fn(async (g: GatedText) => {
    const matches = [...g.text.matchAll(/^([a-f]{8}-[a-f]{4}-4[a-f]{3}-8[a-f]{3}-[a-f]{12}) 1 Participant /gm)];
    expect(matches.length).toBe(2);
    const aliases = matches.map((m) => m[1]);
    expect(aliases).not.toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab");
    expect(aliases).not.toContain("abcdefab-cdef-4abc-8def-123456789abc");
    return { subject: "Follow-up", body: "Confirm myself.", sourceRefs: aliases.map((id) => ({ utteranceId: id, revision: 1 })) };
  });
  const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, isCurrent: () => true, requestOwnerApproval: async (runId, preview) => gate.approve(runId, preview), callModel: model });
  if (!reasoner) throw new Error("reasoner off");
  const input = { ...baseInput(), utterances: [{ utteranceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", revision: 7, speaker: "Participant", text: "Confirm myself.", sequence: 0 }, { utteranceId: "abcdefab-cdef-4abc-8def-123456789abc", revision: 123456789, speaker: "Participant", text: "No commitment.", sequence: 1 }] };
  const result = await reasoner(input);
  expect(result).toEqual({ subject: "Follow-up", body: "Confirm myself.", sourceRefs: [{ utteranceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", revision: 7 }, { utteranceId: "abcdefab-cdef-4abc-8def-123456789abc", revision: 123456789 }] });
  expect(model).toHaveBeenCalledTimes(1);
});
it("rejects invalid sourceRefs", async () => {
  for (const ref of [{ utteranceId: "not-listed", revision: 1 }, { utteranceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", revision: 2 }]) {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const model = vi.fn(async () => ({ subject: "Follow-up", body: "Hi", sourceRefs: [ref] }));
    const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, { gate, isCurrent: () => true, requestOwnerApproval: async (runId, preview) => gate.approve(runId, preview), callModel: model });
    if (!reasoner) throw new Error("reasoner off");
    await expect(reasoner(baseInput())).rejects.toThrow();
    expect(model).toHaveBeenCalledTimes(1);
  }
});
