import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createPrivacyGate, GatedText } from "@second-seat/bot/dist/src/private/gate.js";
import { createCandidateApprovalBroker, CANDIDATE_APPROVAL_TTL_MS } from "../src/candidateApproval.js";
import type { CandidateBinding } from "../src/candidateReasoner.js";

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

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function binding(overrides: Partial<CandidateBinding> = {}): CandidateBinding {
  return {
    roomId: "r1",
    ownerId: "o1",
    meetingId: "m1",
    contextRevision: 1,
    policyGeneration: 1,
    epoch: 0,
    ...overrides,
  };
}

function must<T>(v: T | null | undefined): T { if (v === null || v === undefined) throw new Error("expected value"); return v; }

describe("candidateApproval", () => {
it.each([
  ["requestId"],
  ["version"],
  ["previewHash"],
])("%s mismatch rejects correction", async (label) => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const prepared = await gate.prepare("initial safe text");
  const broker = createCandidateApprovalBroker({ isCurrent: () => true });
  const correctSpy = vi.spyOn(gate, "correct");
  const approveSpy = vi.spyOn(gate, "approve");
  const controller = new AbortController();
  try {
    const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "initial safe text", binding: binding(), signal: controller.signal });
    const snap = must(broker.snapshot(binding()));
    const decision = { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash };
    const badDecision = label === "version" ? { ...decision, version: snap.version + 1 } : label === "requestId" ? { ...decision, requestId: "wrong-requestId" } : { ...decision, previewHash: "0".repeat(64) };
    expect(broker.correct(binding(), badDecision, "safe edited text")).toBeNull();
    expect(broker.snapshot(binding())).toEqual(snap);
    expect(gate.preview(prepared.runId)).toBe("initial safe text");
    expect(correctSpy).toHaveBeenCalledTimes(0);
    expect(approveSpy).toHaveBeenCalledTimes(0);
    const ok = must(broker.correct(binding(), decision, "safe edited text"));
    expect(ok.requestId).toBe(snap.requestId);
    expect(gate.preview(prepared.runId)).toBe("safe edited text");
    controller.abort();
    await pending;
  } finally {
    controller.abort();
    correctSpy.mockRestore();
    approveSpy.mockRestore();
  }
});

it.each([
  ["blank", " \n "],
  ["oversized", "x".repeat(33)],
] as const)("%s edited text is rejected", async (_label, editedText) => {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const prepared = await gate.prepare("initial safe text");
  const broker = createCandidateApprovalBroker({ isCurrent: () => true, maxTextLength: 32 });
  const correctSpy = vi.spyOn(gate, "correct");
  const approveSpy = vi.spyOn(gate, "approve");
  const controller = new AbortController();
  try {
    const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "initial safe text", binding: binding(), signal: controller.signal });
    const snap = must(broker.snapshot(binding()));
    expect(broker.correct(binding(), { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash }, editedText)).toBeNull();
    expect(broker.snapshot(binding())).toEqual(snap);
    expect(gate.preview(prepared.runId)).toBe("initial safe text");
    expect(correctSpy).toHaveBeenCalledTimes(0);
    expect(approveSpy).toHaveBeenCalledTimes(0);
    const boundary = "x".repeat(32);
    const ok = must(broker.correct(binding(), { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash }, boundary));
    expect(ok.version).not.toBe(snap.version);
    expect(gate.preview(prepared.runId)).toBe(boundary);
    controller.abort();
    await pending;
  } finally {
    controller.abort();
    correctSpy.mockRestore();
    approveSpy.mockRestore();
  }
});

  it("correct preserves identity and enforces single approval of edited text", async () => {
    const controller = new AbortController();
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const prepared = await gate.prepare("initial safe text");
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    const approveSpy = vi.spyOn(gate, "approve");
    try {
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "initial safe text", binding: binding(), signal: controller.signal });
      const snap = must(broker.snapshot(binding()));
      const expiryBefore = snap.expiresAt;
      const editedText = " edited exact new safe text\n ";
      const corrected = broker.correct(binding(), { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash }, editedText);
      expect(corrected).not.toBeNull();
      expect(approveSpy).not.toHaveBeenCalled();
      expect(must(corrected).requestId).toBe(snap.requestId);
      expect(must(corrected).expiresAt).toBe(expiryBefore);
      expect(must(corrected).version).not.toBe(snap.version);
      expect(must(corrected).previewHash).toBe(sha256Hex(editedText));
      expect(must(corrected).redactedText).toBe(editedText);
      const forged = broker.correct(binding({ ownerId: "evil" }), { requestId: must(corrected).requestId, version: must(corrected).version, previewHash: must(corrected).previewHash }, "evil");
      expect(forged).toBeNull();
      expect(broker.snapshot(binding())).toEqual(corrected);
      const preApprove = broker.approve(binding(), { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(preApprove).toBe(false);
      expect(approveSpy).toHaveBeenCalledTimes(0);
      const ok = broker.approve(binding(), { requestId: must(corrected).requestId, version: must(corrected).version, previewHash: must(corrected).previewHash });
      expect(ok).toBe(true);
      expect(approveSpy).toHaveBeenCalledTimes(1);
      const token = await pending;
      expect(typeof token).toBe("string");
      let delivered = "";
      await gate.send(prepared.runId, must(token), async (gated) => { delivered += gated.text; });
      expect(delivered).toBe(editedText);
      expect(broker.correct(binding(), { requestId: must(corrected).requestId, version: must(corrected).version, previewHash: must(corrected).previewHash }, "again")).toBeNull();
    } finally { controller.abort(); approveSpy.mockRestore(); }
  });
  it("corrected PII is still blocked by gate send", async () => {
    const controller = new AbortController();
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const prepared = await gate.prepare("safe start");
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    try {
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "safe start", binding: binding(), signal: controller.signal });
      const snap = must(broker.snapshot(binding()));
      const piiText = "hello alice@example.com world";
      const corrected = must(broker.correct(binding(), { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash }, piiText));
      expect(corrected.redactedText).toBe(piiText);
      const ok = broker.approve(binding(), { requestId: corrected.requestId, version: corrected.version, previewHash: corrected.previewHash });
      expect(ok).toBe(true);
      const token = await pending;
      let count = 0;
      await expect(gate.send(prepared.runId, must(token), async (gated) => { count++; })).rejects.toThrow(/residual PII/);
      expect(count).toBe(0);
      expect(gate.receipts(prepared.runId)).toEqual([]);
    } finally { controller.abort(); }
  });

  it("snapshot has exactly six keys and correct values", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const prepared = await gate.prepare("hi alice@example.com");
    const b = binding();
    let isCurrentFlag = true;
    const broker = createCandidateApprovalBroker({ isCurrent: () => isCurrentFlag });
    const controller = new AbortController();
    const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: controller.signal });
    try {
      const snap = broker.snapshot(b);
      expect(snap !== null).toBe(true);
      if (snap === null) return;
      expect(Object.keys(snap).sort()).toEqual(["expiresAt", "previewHash", "redactedText", "requestId", "status", "version"].sort());
      expect(snap.redactedText).toBe(prepared.redactedText);
      expect(snap.redactedText.includes("[REDACTED_email]")).toBe(true);
      expect(snap.previewHash).toBe(sha256Hex(prepared.redactedText));
      expect(snap.status).toBe("pending");
      const json = JSON.stringify(snap);
      expect(json.includes(prepared.runId)).toBe(false);
      expect(json.includes("alice@example.com")).toBe(false);
      // token not leaked: snapshot has no gate token shape check - ensure no extra leakage via stringify
      // wrong bindings
      expect(broker.snapshot(binding({ roomId: "r2" }))).toBe(null);
      expect(broker.snapshot(binding({ ownerId: "o2" }))).toBe(null);
    } finally {
      const s = broker.snapshot(b);
      if (s !== null) broker.deny(b, s.requestId);
      await pending;
    }
  });

  it("approve once mints token and second approve does nothing", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const baseApprove = gate.approve.bind(gate);
    let mintCount = 0;
    const g = {
      prepare: gate.prepare.bind(gate),
      preview: gate.preview.bind(gate),
      correct: gate.correct.bind(gate),
      approve: (runId: string, text: string) => {
        mintCount += 1;
        return baseApprove(runId, text);
      },
      send: gate.send.bind(gate),
      revoke: gate.revoke.bind(gate),
      receipts: gate.receipts.bind(gate),
    };
    const prepared = await gate.prepare("hi alice@example.com");
    const b = binding();
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    const controller = new AbortController();
    const pending = broker.request({ gate: g, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: controller.signal });
    try {
      const snap = broker.snapshot(b);
      expect(snap !== null).toBe(true);
      if (snap === null) return;
      const ok = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(ok).toBe(true);
      const token = await pending;
      expect(typeof token).toBe("string");
      if (token === null) return;
      let receivedText = "";
      const spy = async (gated: GatedText) => {
        receivedText = gated.text;
      };
      await gate.send(prepared.runId, token, spy);
      expect(receivedText).toBe(prepared.redactedText);
      // second identical approve
      const ok2 = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(ok2).toBe(false);
      expect(mintCount).toBe(1);
      expect(broker.snapshot(b)).toBe(null);
    } finally {
      const s = broker.snapshot(b);
      if (s !== null) broker.deny(b, s.requestId);
      // ensure pending settled
      await new Promise<void>((res) => setImmediate(res));
    }
  });

  it("validation no-mint wrong fields and refusals", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const baseApprove = gate.approve.bind(gate);
    let mintCount = 0;
    const g = {
      prepare: gate.prepare.bind(gate),
      preview: gate.preview.bind(gate),
      correct: gate.correct.bind(gate),
      approve: (runId: string, text: string) => {
        mintCount += 1;
        return baseApprove(runId, text);
      },
      send: gate.send.bind(gate),
      revoke: gate.revoke.bind(gate),
      receipts: gate.receipts.bind(gate),
    };
    const prepared = await gate.prepare("hi alice@example.com");
    const b = binding();
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    const controller = new AbortController();
    const pending = broker.request({ gate: g, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: controller.signal });
    try {
      const snap = broker.snapshot(b);
      expect(snap !== null).toBe(true);
      if (snap === null) return;
      const wrongCases: Array<{ b: CandidateBinding; label: string }> = [
        { b: binding({ roomId: "wrong" }), label: "roomId" },
        { b: binding({ ownerId: "wrong" }), label: "ownerId" },
        { b: binding({ meetingId: "wrong" }), label: "meetingId" },
        { b: binding({ contextRevision: 999 }), label: "contextRevision" },
        { b: binding({ policyGeneration: 999 }), label: "policyGeneration" },
        { b: binding({ epoch: 5 }), label: "epoch missing vs present" },
      ];
      for (const c of wrongCases) {
        const r = broker.approve(c.b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
        expect(r).toBe(false);
      }
      // wrong requestId/version/previewHash
      expect(broker.approve(b, { requestId: "bad", version: snap.version, previewHash: snap.previewHash })).toBe(false);
      expect(broker.approve(b, { requestId: snap.requestId, version: 9999, previewHash: snap.previewHash })).toBe(false);
      expect(broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: "bad" })).toBe(false);
      expect(mintCount).toBe(0);
      // snapshot unchanged
      const snap2 = broker.snapshot(b);
      expect(snap2 !== null).toBe(true);
      if (snap2 !== null) {
        expect(snap2.requestId).toBe(snap.requestId);
      }
      // legitimate approve still succeeds
      const ok = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(ok).toBe(true);
      expect(mintCount).toBe(1);
      await pending;
    } finally {
      const s = broker.snapshot(b);
      if (s !== null) {
        const b2 = binding();
        broker.deny(b2, s.requestId);
      }
      await new Promise<void>((res) => setImmediate(res));
    }

    // refusals resolve null with no entry
    // preview mismatch
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const p = br.request({ gate, runId: prep.runId, redactedPreview: "mismatch", binding: binding({ roomId: "rx1" }), signal: ctrl.signal });
      const v = await p;
      expect(v).toBe(null);
      expect(br.pendingCount()).toBe(0);
    }
    // text over cap
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => true, maxTextLength: 2 });
      const ctrl = new AbortController();
      const p = br.request({ gate, runId: prep.runId, redactedPreview: prep.redactedText, binding: binding({ roomId: "rx2" }), signal: ctrl.signal });
      const v = await p;
      expect(v).toBe(null);
      expect(br.pendingCount()).toBe(0);
      // ensure no truncation: preview still original
      expect(prep.redactedText.length > 2).toBe(true);
    }
    // already-aborted signal
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      ctrl.abort();
      const p = br.request({ gate, runId: prep.runId, redactedPreview: prep.redactedText, binding: binding({ roomId: "rx3" }), signal: ctrl.signal });
      const v = await p;
      expect(v).toBe(null);
      expect(br.pendingCount()).toBe(0);
    }
    // invalid epoch
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const p1 = br.request({ gate, runId: prep.runId, redactedPreview: prep.redactedText, binding: binding({ roomId: "rx4", epoch: -1 }), signal: ctrl.signal });
      expect(await p1).toBe(null);
      const prep2 = await gate.prepare("hello2");
      const p2 = br.request({ gate, runId: prep2.runId, redactedPreview: prep2.redactedText, binding: binding({ roomId: "rx5", epoch: 1.5 }), signal: ctrl.signal });
      expect(await p2).toBe(null);
    }
    // isCurrent false
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => false });
      const ctrl = new AbortController();
      const p = br.request({ gate, runId: prep.runId, redactedPreview: prep.redactedText, binding: binding({ roomId: "rx6" }), signal: ctrl.signal });
      expect(await p).toBe(null);
      expect(br.pendingCount()).toBe(0);
    }
    // second request same room
    {
      const prep1 = await gate.prepare("hello");
      const prep2 = await gate.prepare("hello2");
      const br = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl1 = new AbortController();
      const ctrl2 = new AbortController();
      const b1 = binding({ roomId: "sameRoom" });
      const p1 = br.request({ gate, runId: prep1.runId, redactedPreview: prep1.redactedText, binding: b1, signal: ctrl1.signal });
      const snapBefore = br.snapshot(b1);
      const p2 = br.request({ gate, runId: prep2.runId, redactedPreview: prep2.redactedText, binding: b1, signal: ctrl2.signal });
      expect(await p2).toBe(null);
      expect(br.pendingCount()).toBe(1);
      expect(br.snapshot(b1)).not.toBe(null);
      if (snapBefore !== null) {
        const cur = br.snapshot(b1);
        if (cur !== null) expect(cur.requestId).toBe(snapBefore.requestId);
      }
      // cleanup
      const s = br.snapshot(b1);
      if (s !== null) br.deny(b1, s.requestId);
      await p1;
    }
    // missing epoch refusal
    {
      const prep = await gate.prepare("hello");
      const br = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const fiveFields = { roomId: "rxMissing", ownerId: "o1", meetingId: "m1", contextRevision: 1, policyGeneration: 1 };
      const before = br.pendingCount();
      let settled = false;
      const p = br.request({ gate, runId: prep.runId, redactedPreview: prep.redactedText, binding: fiveFields, signal: ctrl.signal });
      p.then(() => { settled = true; });
      await new Promise<void>((res) => setImmediate(res));
      try {
        expect(br.pendingCount()).toBe(before);
        expect(br.snapshot(fiveFields)).toBe(null);
      } finally {
        ctrl.abort();
        await new Promise<void>((res) => setImmediate(res));
      }
    }
    // capacity overflow maxPending 1
    {
      const prep1 = await gate.prepare("hello");
      const prep2 = await gate.prepare("hello2");
      const br = createCandidateApprovalBroker({ isCurrent: () => true, maxPending: 1 });
      const ctrl1 = new AbortController();
      const ctrl2 = new AbortController();
      const b1 = binding({ roomId: "cap1" });
      const b2 = binding({ roomId: "cap2" });
      const p1 = br.request({ gate, runId: prep1.runId, redactedPreview: prep1.redactedText, binding: b1, signal: ctrl1.signal });
      const p2 = br.request({ gate, runId: prep2.runId, redactedPreview: prep2.redactedText, binding: b2, signal: ctrl2.signal });
      expect(await p2).toBe(null);
      expect(br.pendingCount()).toBe(1);
      const capSnap = must(br.snapshot(b1));
      expect(capSnap.requestId.length > 0).toBe(true);
      const capOk = br.approve(b1, { requestId: capSnap.requestId, version: capSnap.version, previewHash: capSnap.previewHash });
      expect(capOk).toBe(true);
      const capToken = await p1;
      expect(typeof capToken).toBe("string");
    }
  });

  it("settle-null cases", async () => {
    // abort signal
    {
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prep3 = await gate.prepare("abort-token-check");
      const approveSpy = vi.spyOn(gate, "approve");
      const preexistingToken = gate.approve(prep3.runId, prep3.redactedText);
      const b = binding({ roomId: "abortR" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true });
      const controller = new AbortController();
      const pending = broker.request({ gate, runId: prep3.runId, redactedPreview: prep3.redactedText, binding: b, signal: controller.signal });
      const snap = must(broker.snapshot(b));
      expect(snap.requestId.length > 0).toBe(true);
      controller.abort();
      const v = await pending;
      expect(v).toBe(null);
      expect(broker.snapshot(b)).toBe(null);
      expect(broker.pendingCount()).toBe(0);
      expect(approveSpy).toHaveBeenCalledTimes(1);
      const cb = vi.fn(async () => {});
      let threw = false;
      try {
        await gate.send(prep3.runId, preexistingToken, cb);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      expect(cb).toHaveBeenCalledTimes(0);
      approveSpy.mockRestore();
    }
    // deny
    {
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hi alice@example.com");
      const b = binding({ roomId: "denyR" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      const snap = broker.snapshot(b);
      expect(snap !== null).toBe(true);
      if (snap !== null) {
        const ok = broker.deny(b, snap.requestId);
        expect(ok).toBe(true);
        const v = await pending;
        expect(v).toBe(null);
        expect(broker.snapshot(b)).toBe(null);
      }
    }
    // stale isCurrent false at approve time
    {
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hi alice@example.com");
      const b = binding({ roomId: "staleR" });
      let current = true;
      const broker = createCandidateApprovalBroker({ isCurrent: () => current });
      const approveSpy = vi.spyOn(gate, "approve");
      const ctrl = new AbortController();
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      const snap = must(broker.snapshot(b));
      current = false;
      const ok = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(ok).toBe(false);
      expect(approveSpy).toHaveBeenCalledTimes(0);
      expect(await pending).toBe(null);
      approveSpy.mockRestore();
    }
    // TTL
    {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hi alice@example.com");
      const b = binding({ roomId: "ttlR" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      try {
        expect(must(broker.snapshot(b)).requestId.length > 0).toBe(true);
        vi.advanceTimersByTime(CANDIDATE_APPROVAL_TTL_MS);
        const v = await pending;
        expect(v).toBe(null);
        expect(broker.snapshot(b)).toBe(null);
      } finally {
        vi.useRealTimers();
        const s = broker.snapshot(b);
        if (s !== null) broker.deny(b, s.requestId);
        await new Promise<void>((res) => setImmediate(res));
      }
    }
    // t1260: gate.correct after snapshot
    {
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hi alice@example.com");
      const b = binding({ roomId: "t1260R" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true });
      const ctrl = new AbortController();
      const baseApprove = gate.approve.bind(gate);
      let mintCount = 0;
      const g = {
        prepare: gate.prepare.bind(gate),
        preview: gate.preview.bind(gate),
        correct: gate.correct.bind(gate),
        approve: (runId: string, text: string) => {
          mintCount += 1;
          return baseApprove(runId, text);
        },
        send: gate.send.bind(gate),
        revoke: gate.revoke.bind(gate),
        receipts: gate.receipts.bind(gate),
      };
      const pending = broker.request({ gate: g, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      const snap = must(broker.snapshot(b));
      gate.correct(prepared.runId, "changed text");
      const ok = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
      expect(ok).toBe(false);
      expect(mintCount).toBe(0);
      const v = await pending;
      expect(v).toBe(null);
    }
  });

  it("timestamp expiry before timer: approve refuses", async () => {
      let t = 1_000;
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hello");
      const b = binding({ roomId: "tsF1" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true, now: () => t });
      const ctrl = new AbortController();
      const approveSpy = vi.spyOn(gate, "approve");
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      try {
        const snap = must(broker.snapshot(b));
        t = snap.expiresAt;
        const ok = broker.approve(b, { requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash });
        expect(ok).toBe(false);
        expect(approveSpy).toHaveBeenCalledTimes(0);
        await new Promise<void>((res) => setImmediate(res));
        expect(await pending).toBe(null);
        const s2 = broker.snapshot(b);
        if (s2 !== null) broker.deny(b, s2.requestId);
      } finally {
        approveSpy.mockRestore();
        ctrl.abort();
        await new Promise<void>((res) => setImmediate(res));
      }
  });

  it("timestamp expiry before timer: snapshot withdraws", async () => {
      let t = 1_000;
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hello-f2");
      const b = binding({ roomId: "tsF2" });
      const broker = createCandidateApprovalBroker({ isCurrent: () => true, now: () => t });
      const ctrl = new AbortController();
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      try {
        const snap = must(broker.snapshot(b));
        t = snap.expiresAt + 1;
        await new Promise<void>((res) => setImmediate(res));
        expect(broker.snapshot(b)).toBe(null);
        expect(await pending).toBe(null);
        expect(broker.pendingCount()).toBe(0);
      } finally {
        ctrl.abort();
        await new Promise<void>((res) => setImmediate(res));
      }
  });

  it("snapshot withdraws stale entry", async () => {
      const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
      const prepared = await gate.prepare("hello");
      const b = binding({ roomId: "staleSnap" });
      let cur = true;
      const broker = createCandidateApprovalBroker({ isCurrent: () => cur });
      const ctrl = new AbortController();
      const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: prepared.redactedText, binding: b, signal: ctrl.signal });
      try {
        must(broker.snapshot(b));
        cur = false;
        expect(broker.snapshot(b)).toBe(null);
        expect(await pending).toBe(null);
        expect(broker.pendingCount()).toBe(0);
      } finally {
        ctrl.abort();
        await new Promise<void>((res) => setImmediate(res));
      }
  });

  it("isolation between rooms", async () => {
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const prep1 = await gate.prepare("hi alice@example.com");
    const prep2 = await gate.prepare("hello2");
    const b1 = binding({ roomId: "r1" });
    const b2 = binding({ roomId: "r2" });
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    const p1 = broker.request({ gate, runId: prep1.runId, redactedPreview: prep1.redactedText, binding: b1, signal: ctrl1.signal });
    const p2 = broker.request({ gate, runId: prep2.runId, redactedPreview: prep2.redactedText, binding: b2, signal: ctrl2.signal });
    try {
      const snap1 = must(broker.snapshot(b1));
      const snap2 = must(broker.snapshot(b2));
      const version2Before = snap2.version;
      const hash2Before = snap2.previewHash;
      // approving r1 leaves r2 unchanged
      const ok1 = broker.approve(b1, { requestId: snap1.requestId, version: snap1.version, previewHash: snap1.previewHash });
      expect(ok1).toBe(true);
      await p1;
      const afterSnap2 = must(broker.snapshot(b2));
      {
        expect(afterSnap2.version).toBe(version2Before);
        expect(afterSnap2.previewHash).toBe(hash2Before);
      }
      // decision from r1 applied with r2 binding -> false
      // need fresh r1 entry for cross test: create new r1 entry
      const prep3 = await gate.prepare("hi alice@example.com");
      const b1b = binding({ roomId: "r1" });
      const ctrl3 = new AbortController();
      const p3 = broker.request({ gate, runId: prep3.runId, redactedPreview: prep3.redactedText, binding: b1b, signal: ctrl3.signal });
      const snap1b = must(broker.snapshot(b1b));
      {
        const cross = broker.approve(b2, { requestId: snap1b.requestId, version: snap1b.version, previewHash: snap1b.previewHash });
        expect(cross).toBe(false);
        // r2 still pending
        expect(broker.snapshot(b2) !== null).toBe(true);
        // r2 approves independently
        const snap2Now = must(broker.snapshot(b2));
        {
          const ok2 = broker.approve(b2, { requestId: snap2Now.requestId, version: snap2Now.version, previewHash: snap2Now.previewHash });
          expect(ok2).toBe(true);
          const token2 = await p2;
          expect(typeof token2).toBe("string");
        }
        // cleanup r1
        const s = broker.snapshot(b1b);
        if (s !== null) broker.deny(b1b, s.requestId);
        await p3;
      }
    } finally {
      const s1 = broker.snapshot(b1);
      if (s1 !== null) broker.deny(b1, s1.requestId);
      const s2 = broker.snapshot(b2);
      if (s2 !== null) broker.deny(b2, s2.requestId);
      await new Promise<void>((res) => setImmediate(res));
    }
  });
});
