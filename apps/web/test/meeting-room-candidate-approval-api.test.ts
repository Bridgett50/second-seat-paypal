import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { createCandidateApprovalBroker } from "../src/candidateApproval.js";
import type { CandidateBinding } from "../src/candidateReasoner.js";
import { createCandidateApprovalApi } from "../src/candidateApprovalApi.js";
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
function binding(overrides: Partial<CandidateBinding> = {}): CandidateBinding & { readonly epoch: number } {
  const { epoch = 0, ...rest } = overrides;
  return {
    roomId: "r1",
    ownerId: "o1",
    meetingId: "m1",
    contextRevision: 1,
    policyGeneration: 1,
    ...rest,
    epoch,
  };
}
function must<T>(v: T | null | undefined): T { if (v === null || v === undefined) throw new Error("expected value"); return v; }
describe("meeting room candidate approval api", () => {
  it("correct preserves identity and enforces single approval of edited text", async () => {
    const controller = new AbortController();
    const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
    const prepared = await gate.prepare("initial safe text");
    const broker = createCandidateApprovalBroker({ isCurrent: () => true });
    const api = createCandidateApprovalApi({ candidateBindingAs(key: string | null, id: unknown) { return key === "owner" && id === "r1" ? binding() : null; } }, broker);
    const approveSpy = vi.spyOn(gate, "approve");
    const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "initial safe text", binding: binding(), signal: controller.signal });
    try {
      const snap = must(broker.snapshot(binding()));
      expect(api.read("owner", "r1").body).toEqual({ preview: snap });
      expect(api.read("foreign", "r1").status).toBe(404);
      expect(broker.snapshot(binding())).toEqual(snap);
      const expiryBefore = snap.expiresAt;
      const editedText = " edited exact new safe text\n ";
      const actRes = api.act("owner", { action: "correct", roomId: "r1", requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash, text: editedText });
      const corrected = must(broker.snapshot(binding()));
      expect(actRes.body).toEqual({ preview: corrected });
      expect(approveSpy).not.toHaveBeenCalled();
      expect(corrected.requestId).toBe(snap.requestId);
      expect(corrected.expiresAt).toBe(expiryBefore);
      expect(corrected.version).not.toBe(snap.version);
      expect(corrected.previewHash).toBe(sha256Hex(editedText));
      expect(corrected.redactedText).toBe(editedText);
      expect(api.act("owner", { action: "approve", roomId: "r1", requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash }).status).toBe(409);
      expect(broker.snapshot(binding())).toEqual(corrected);
      expect(approveSpy).toHaveBeenCalledTimes(0);
      expect(api.act("owner", { action: "approve", roomId: "r1", requestId: corrected.requestId, version: corrected.version, previewHash: corrected.previewHash }).body).toEqual({ approved: true });
      expect(approveSpy).toHaveBeenCalledTimes(1);
      const token = await pending;
      expect(typeof token).toBe("string");
      let delivered = "";
      await gate.send(prepared.runId, must(token), async (gated) => { delivered += gated.text; });
      expect(delivered).toBe(editedText);
      expect(api.act("owner", { action: "approve", roomId: "r1", requestId: corrected.requestId, version: corrected.version, previewHash: corrected.previewHash }).status).toBe(409);
      expect(broker.correct(binding(), { requestId: corrected.requestId, version: corrected.version, previewHash: corrected.previewHash }, "again")).toBeNull();
    } finally { controller.abort(); try { await pending; } catch {} approveSpy.mockRestore(); }
  });
it("rejects malformed, foreign and stale decisions without mutating pending request", async () => {
  const controller = new AbortController();
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  const prepared = await gate.prepare("initial safe text");
  const broker = createCandidateApprovalBroker({ isCurrent: () => true });
  const api = createCandidateApprovalApi({ candidateBindingAs(k, id) { return k === "owner" && id === "r1" ? binding() : null; } }, broker);
  const pending = broker.request({ gate, runId: prepared.runId, redactedPreview: "initial safe text", binding: binding(), signal: controller.signal });
  const snap = must(broker.snapshot(binding()));
  const base = { action: "approve", roomId: binding().roomId, requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash };
  const correctSpy = vi.spyOn(broker, "correct");
  const approveSpy = vi.spyOn(broker, "approve");
  const denySpy = vi.spyOn(broker, "deny");
  try {
    const bad400 = [
      null,
      [],
      { ...base, action: "unknownaction" },
      { ...base, ownerId: "o1" },
      { ...base, epoch: 0 },
      { ...base, runId: "x" },
      { ...base, version: 0 },
      { ...base, version: 1.5 },
      { ...base, version: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, requestId: "not-hex" },
      { ...base, previewHash: "bad" },
      { ...base, text: "hi" },
      { action: "correct", roomId: binding().roomId, requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash, text: "" },
      { action: "correct", roomId: binding().roomId, requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash, text: "   " },
      { action: "correct", roomId: binding().roomId, requestId: snap.requestId, version: snap.version, previewHash: snap.previewHash, text: "a".repeat(8001) },
    ];
    for (const b of bad400) { expect(api.act("owner", b).status).toBe(400); expect(broker.snapshot(binding())).toEqual(snap); }
    const stale409 = [
      { ...base, requestId: "0".repeat(32) },
      { ...base, version: snap.version + 1 },
      { ...base, previewHash: "0".repeat(64) },
    ];
    for (const s of stale409) { expect(api.act("owner", s).status).toBe(409); expect(broker.snapshot(binding())).toEqual(snap); }
    expect(api.act(null, base).status).toBe(404);
    expect(api.act("foreign", base).status).toBe(404);
    expect(broker.snapshot(binding())).toEqual(snap);
    expect(correctSpy).not.toHaveBeenCalled();
    expect(approveSpy).not.toHaveBeenCalled();
    expect(denySpy).not.toHaveBeenCalled();
  } finally { controller.abort(); try { await pending; } catch {} correctSpy.mockRestore(); approveSpy.mockRestore(); denySpy.mockRestore(); }
});

});
