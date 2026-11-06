import { describe, expect, it } from "vitest";
import { createTwinRoom, SEEDED_SENSITIVE_VALUES } from "../src/t2-room.js";
import {
  deriveApprovedPackage,
  serializeApprovedPackage,
} from "../src/t2-room.js";
import { packageHash } from "../src/meeting/connector.js";

function makeRoom() {
  const room = createTwinRoom({ testMode: true, transport: async () => {} });
  return room;
}

function streamAllTranscript(room: ReturnType<typeof createTwinRoom>): string[] {
  let guard = 0;
  while (room.streamNextLine().appended && guard < 100) guard += 1;
  return [...room.view().transcript];
}

/** Canonical identical draft text for the selected meeting's current body. */
function identicalTextFor(room: ReturnType<typeof createTwinRoom>): string {
  const script = streamAllTranscript(room);
  const v = room.view();
  const pkg = deriveApprovedPackage({
    title: v.selectedMeetingTitle,
    script,
    body: v.draft.body,
  });
  return serializeApprovedPackage(pkg);
}

describe("t2 evidence preview", () => {
  it("EP-1 preview shows the visible unsent, unapproved package before approve", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    const v = room.view();
    const json = room.evidencePreviewJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([
      "meetingId",
      "meetingTitle",
      "packageHash",
      "approved",
      "sendState",
      "approvedAt",
      "sentAt",
      "redactionCounts",
    ]);
    expect(parsed["meetingId"]).toBe(v.draft.meetingId);
    expect(parsed["meetingTitle"]).toBe(v.selectedMeetingTitle);
    expect(parsed["packageHash"]).toBe(packageHash(v.draft.body));
    expect(parsed["packageHash"]).toBe(v.draft.sha256);
    expect(parsed["approved"]).toBe(false);
    expect(v.draft.approved).toBe(false);
    expect(parsed["sendState"]).toBe("unsent");
    expect(parsed["approvedAt"]).toBeNull();
    expect(parsed["sentAt"]).toBeNull();
    expect(room.evidenceRecord()).toBeNull();
    expect(room.compareImported(identicalTextFor(room))).toBeNull();
  });

  it("EP-2 preview updates on approve", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    room.approve();
    const v = room.view();
    const json = room.evidencePreviewJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["approved"]).toBe(true);
    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    if (record === null) throw new Error("expected record after approve");
    expect(parsed["approvedAt"]).toBe(record.approvedAt);
    expect(parsed["packageHash"]).toBe(record.packageHash);
    expect(parsed["packageHash"]).toBe(v.draft.sha256);
    expect(parsed["sentAt"]).toBe(record.sentAt);
  });

  it("EP-3 compareVisible before approval compares the visible package, marked not approved", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    const text = identicalTextFor(room);
    expect(room.compareImported(text)).toBeNull();
    const before = room.compareVisible(text);
    expect(before).not.toBeNull();
    if (before === null) throw new Error("expected compareVisible before approve");
    expect(before.approved).toBe(false);
    expect(before.comparison.identical).toBe(true);
    room.approve();
    const after = room.compareVisible(text);
    expect(after).not.toBeNull();
    if (after === null) throw new Error("expected compareVisible after approve");
    expect(after.approved).toBe(true);
    expect(after.comparison.identical).toBe(true);
  });

  it("EP-4 an edited package is compared and previewed unapproved and still cannot send", async () => {
    const room = makeRoom();
    streamAllTranscript(room);
    room.approve();
    const editedBody = room.view().draft.body + "\nEdited line.";
    room.editDraft(editedBody);
    const preview1 = JSON.parse(room.evidencePreviewJson()) as Record<string, unknown>;
    expect(preview1["approved"]).toBe(false);
    expect(preview1["packageHash"]).toBe(packageHash(editedBody));
    const text = identicalTextFor(room);
    const cmp = room.compareVisible(text);
    expect(cmp).not.toBeNull();
    if (cmp === null) throw new Error("expected compareVisible after edit");
    expect(cmp.approved).toBe(false);
    const send1 = await room.send();
    expect(send1.ok).toBe(false);
    room.approve();
    const send2 = await room.send();
    expect(send2.ok).toBe(true);
    const preview2 = JSON.parse(room.evidencePreviewJson()) as Record<string, unknown>;
    expect(preview2["sendState"]).toBe("sent");
    expect(preview2["approved"]).toBe(true);
    expect(typeof preview2["sentAt"]).toBe("number");
  });

  it("EP-5 taken over compareVisible is null and resume restores the visible compare", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    room.takeOver();
    expect(room.compareVisible(identicalTextFor(room))).toBeNull();
    const json = room.evidencePreviewJson();
    expect(() => JSON.parse(json)).not.toThrow();
    room.resume();
    const cmp = room.compareVisible(identicalTextFor(room));
    expect(cmp).not.toBeNull();
    if (cmp === null) throw new Error("expected compareVisible after resume");
    expect(cmp.approved).toBe(false);
  });

  it("EP-6 preview and compareVisible are read-only", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    const beforeView = JSON.stringify(room.view());
    const beforeRecord = room.evidenceRecord();
    const beforeRecordJson = beforeRecord === null ? null : JSON.stringify(beforeRecord);
    room.evidencePreviewJson();
    room.compareVisible(identicalTextFor(room));
    expect(JSON.stringify(room.view())).toBe(beforeView);
    const afterRecord = room.evidenceRecord();
    expect(afterRecord === null ? null : JSON.stringify(afterRecord)).toBe(beforeRecordJson);

    room.approve();
    const beforeView2 = JSON.stringify(room.view());
    const beforeRecord2 = room.evidenceRecord();
    const beforeRecordJson2 = beforeRecord2 === null ? null : JSON.stringify(beforeRecord2);
    room.evidencePreviewJson();
    room.compareVisible(identicalTextFor(room));
    expect(JSON.stringify(room.view())).toBe(beforeView2);
    const afterRecord2 = room.evidenceRecord();
    expect(afterRecord2 === null ? null : JSON.stringify(afterRecord2)).toBe(beforeRecordJson2);
  });
  it("EP-7 preview counts redaction placeholders in the seeded draft without plaintext", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    const json = room.evidencePreviewJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["redactionCounts"]).toEqual({ email: 1, phone: 1, amount: 1 });
    expect(Object.keys(parsed["redactionCounts"] as Record<string, unknown>)).toEqual(["email", "phone", "amount"]);
    for (const v of SEEDED_SENSITIVE_VALUES) {
      expect(json).not.toContain(v);
    }
    expect(json).not.toContain("[REDACTED:");
    expect(room.evidenceRecord()).toBeNull();
  });
  it("EP-8 redaction counts follow the visible draft after an edit and per meeting", () => {
    const room = makeRoom();
    streamAllTranscript(room);
    room.editDraft(room.view().draft.body + "\nmail bob@example.test");
    const json = room.evidencePreviewJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["redactionCounts"]).toEqual({ email: 2, phone: 1, amount: 1 });
    expect(json).not.toContain("bob@example.test");
    const target = room.view().meetings.find((m) => m.title === "Design review");
    expect(target).toBeDefined();
    room.selectMeeting(target!.id);
    const json2 = room.evidencePreviewJson();
    const parsed2 = JSON.parse(json2) as Record<string, unknown>;
    expect(parsed2["redactionCounts"]).toEqual({ email: 0, phone: 0, amount: 0 });
  });
});
