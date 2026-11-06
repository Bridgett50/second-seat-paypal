import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import { SEEDED_SENSITIVE_VALUES, createTwinRoom } from "../src/t2-room.js";

function makeRoom(clock: { now: number }) {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: async (body) => void sent.push(body),
    now: () => clock.now,
  });
  return { room, sent };
}

describe("t2 evidence record", () => {
  it("T9-1 approving a package creates an evidence record for the selected meeting", () => {
    const clock = { now: 1700000000000 };
    const { room } = makeRoom(clock);
    expect(room.evidenceRecord()).toBeNull();
    expect(room.exportEvidenceJson()).toBeNull();

    const before = room.view();
    expect(room.approve().approved).toBe(true);

    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.meetingId).toBe(before.selectedMeetingId);
    expect(record!.meetingId).toBe(room.view().selectedMeetingId);
    expect(record!.meetingTitle).toBe(before.selectedMeetingTitle);
    expect(record!.approvalPrincipal).toBe("bridgett");
    expect(record!.approvedAt).toBe(1700000000000);
    expect(record!.sentAt).toBeNull();
    expect(record!.sendState).toBe("unsent");

    // The record is per-meeting: another meeting still has none.
    const other = room.view().meetings.find((m) => m.id !== record!.meetingId);
    expect(other).toBeDefined();
    room.selectMeeting(other!.id);
    expect(room.evidenceRecord()).toBeNull();
  });

  it("T9-2 the evidence record and its JSON export contain no redacted plaintext", () => {
    const clock = { now: 1700000000000 };
    const { room } = makeRoom(clock);
    // The default selected meeting's draft carries the invented values.
    expect(room.approve().approved).toBe(true);

    const body = room.view().draft.body;
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(body).not.toContain(secret);
    }

    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    const recordJson = JSON.stringify(record);
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(recordJson).not.toContain(secret);
    }

    const exported = room.exportEvidenceJson();
    expect(exported).not.toBeNull();
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(exported!).not.toContain(secret);
    }

    // ...while the redaction metadata itself is present.
    const categories = record!.redactions.map((r) => r.category);
    expect(categories).toContain("email");
    expect(categories).toContain("phone");
    expect(categories).toContain("amount");
    for (const redaction of record!.redactions) {
      expect(redaction.count).toBeGreaterThan(0);
      expect(redaction.placeholders.length).toBe(redaction.count);
      expect(redaction.positions.length).toBe(redaction.count);
      for (const placeholder of redaction.placeholders) {
        expect(placeholder).toMatch(/^\[REDACTED:(email|phone|amount):\d+\]$/);
        expect(body).toContain(placeholder);
        expect(exported!).toContain(placeholder);
        expect(body.indexOf(placeholder)).toBe(
          redaction.positions[redaction.placeholders.indexOf(placeholder)],
        );
      }
    }
    // Stable pretty JSON: parses back to the same record fields.
    const parsed = JSON.parse(exported!);
    expect(parsed.packageHash).toBe(record!.packageHash);
    expect(parsed.approvalPrincipal).toBe("bridgett");
    expect(exported!).toContain("\n");
  });

  it("T9-3 the record's package hash matches the approved package", () => {
    const clock = { now: 1700000000000 };
    const { room } = makeRoom(clock);
    const shownHash = room.view().draft.sha256;
    expect(shownHash).toBe(packageHash(room.view().draft.body));
    expect(room.approve().approved).toBe(true);

    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.packageHash).toBe(room.view().draft.sha256);
    expect(record!.packageHash).toBe(packageHash(room.copyText()!));
    expect(room.copyText()).toBe(room.view().draft.body);
  });

  it("T9-4 owner takeover events are captured in the record", () => {
    const clock = { now: 1700000000000 };
    const { room } = makeRoom(clock);
    expect(room.approve().approved).toBe(true);
    expect(room.evidenceRecord()!.takeoverEvents).toEqual([]);

    clock.now += 1000;
    room.takeOver();
    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.takeoverEvents.length).toBeGreaterThanOrEqual(1);
    for (const event of record!.takeoverEvents) {
      expect(event.kind).toBe("takeover");
      expect(event.at).toBe(1700000001000);
    }

    // The takeover is evidence only: the approved package and hash are untouched.
    expect(room.view().draft.approved).toBe(true);
    expect(room.view().draft.sha256).toBe(record!.packageHash);

    // The exported JSON carries the events too.
    const exported = JSON.parse(room.exportEvidenceJson()!);
    expect(exported.takeoverEvents.length).toBeGreaterThanOrEqual(1);
    expect(exported.takeoverEvents[0]).toEqual({
      at: 1700000001000,
      kind: "takeover",
    });
  });

  it("T9-5 a successful send updates sentAt and sendState in the record", async () => {
    const clock = { now: 1700000000000 };
    const { room, sent } = makeRoom(clock);
    expect(room.approve().approved).toBe(true);
    const hashBefore = room.view().draft.sha256;
    expect(room.evidenceRecord()!.sentAt).toBeNull();
    expect(room.evidenceRecord()!.sendState).toBe("unsent");

    clock.now += 5000;
    const res = await room.send();
    expect(res.ok).toBe(true);
    expect(sent.length).toBe(1);

    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.sentAt).toBe(1700000005000);
    expect(record!.sendState).toBe("sent");
    // The package the record points at is still the approved one.
    expect(record!.packageHash).toBe(hashBefore);
    expect(record!.packageHash).toBe(room.view().draft.sha256);
    expect(room.view().draft.sendState).toBe("sent");
    expect(JSON.parse(room.exportEvidenceJson()!).sentAt).toBe(1700000005000);
  });
});
