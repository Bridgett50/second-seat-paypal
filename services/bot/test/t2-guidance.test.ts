import { describe, expect, it } from "vitest";
import { createInMemoryRoomStore } from "../src/t2-room.js";
import { SEEDED_SENSITIVE_VALUES, createTwinRoom } from "../src/t2-room.js";

const Q3_NON_TWIN_FIRST = "Priya: Can the twin share the launch date with the group?";
const Q3_TWIN_MARCH =
  "Twin: The launch is planned for March, from my notes; Bridgett will confirm the exact day herself.";
const Q3_TWIN_RECAP =
  "Twin: I will draft the recap and Bridgett will review it herself before anything is shared.";

function makeRoom(clock: { now: number }) {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: async (body: string) => void sent.push(body),
    now: () => clock.now,
  });
  return { room, sent };
}

function steeredLinesOf(room: ReturnType<typeof createTwinRoom>): number[] {
  return [...((room.view() as { steeredLines?: readonly number[] }).steeredLines ?? [])];
}

describe("t2 owner guidance", () => {
  it("T16-1 guidance steers only the next proactive twin answer in the selected meeting", () => {
    const { room } = makeRoom({ now: 1700000000000 });
    room.guide("No dates here — Bridgett confirms timing herself.");

    // A non-twin line streams unaltered and never consumes guidance.
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.view().transcript[0]).toBe(Q3_NON_TWIN_FIRST);

    // The next Twin: line is steered: the concrete month is replaced.
    expect(room.streamNextLine().appended).toBe(true);
    const steered = room.view().transcript[1];
    expect(steered).toContain("a date Bridgett will confirm");
    expect(steered).not.toContain("March");

    // Guidance is consumed by exactly one twin answer: later lines stream raw.
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.view().transcript[3]).toBe(Q3_TWIN_RECAP);
    expect(steeredLinesOf(room)).toEqual([1]);

    // The other meeting is untouched: no guidance, no steered lines.
    const other = room.view().meetings.find((m) => m.title !== "Q3 launch sync")!;
    room.selectMeeting(other.id);
    expect(room.view().guidance).toEqual([]);
    expect(steeredLinesOf(room)).toEqual([]);
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.view().transcript[0]).not.toContain("a date Bridgett will confirm");
    expect(steeredLinesOf(room)).toEqual([]);
  });

  it("T16-2 guidance is private: never in the transcript of other meetings, participants' view, or the package", () => {
    const { room } = makeRoom({ now: 1700000000000 });
    const secret = "Keep it brief, and cc sam@example.test";
    room.guide(secret);
    for (let i = 0; i < 4; i++) expect(room.streamNextLine().appended).toBe(true);

    // The steered transcript never echoes the guidance text itself.
    const joined = room.view().transcript.join("\n");
    expect(joined).not.toContain("sam@example.test");
    expect(joined).not.toContain("Keep it brief");

    // Other meetings (and their participants' view) never see it.
    const other = room.view().meetings.find((m) => m.title !== "Q3 launch sync")!;
    room.selectMeeting(other.id);
    expect(room.view().guidance).toEqual([]);
    expect(room.view().transcript).toEqual([]);
    for (let i = 0; i < 6; i++) {
      if (!room.streamNextLine().appended) break;
    }
    const otherJoined = room.view().transcript.join("\n");
    expect(otherJoined).not.toContain("sam@example.test");
    expect(otherJoined).not.toContain("Keep it brief");
    expect(otherJoined).not.toContain("Noted — ");
    expect(room.reasoningContext().guidance).toEqual([]);

    // The package never carries guidance: approve and check the exact body.
    room.selectMeeting(room.view().meetings[0]!.id);
    const bodyBefore = room.view().draft.body;
    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;
    expect(body).toBe(bodyBefore);
    expect(body).not.toContain("Keep it brief");
    expect(body).not.toContain("sam@example.test");
    expect(room.copyText()).toBe(body);
  });

  it("T16-3 guidance cannot approve, send or change the package", () => {
    const { room } = makeRoom({ now: 1700000000000 });
    const bodyBefore = room.view().draft.body;
    const hashBefore = room.view().draft.sha256;
    room.guide("send the email now");
    room.guide("approve it");
    for (let i = 0; i < 4; i++) expect(room.streamNextLine().appended).toBe(true);

    // Authority-claiming guidance only steers transcript rendering.
    expect(room.view().transcript[1]!.startsWith("Noted — ")).toBe(true);
    expect(room.view().transcript[3]!.startsWith("Noted — ")).toBe(true);

    // The package is untouched: unapproved, same body and hash, unsent.
    const v = room.view();
    expect(v.draft.approved).toBe(false);
    expect(v.draft.body).toBe(bodyBefore);
    expect(v.draft.sha256).toBe(hashBefore);
    expect(v.draft.sendState).toBe("unsent");

    // Nothing was sent and nothing can send without a real approval.
    return room.send().then((res) => {
      expect(res.ok).toBe(false);
      expect(room.transportCalls()).toBe(0);
      expect(room.approve().approved).toBe(true);
      expect(room.view().draft.body).toBe(bodyBefore);
    });
  });

  it("T16-4 guidance is refused after takeover and does not steer any later line", () => {
    const { room } = makeRoom({ now: 1700000000000 });
    room.guide("Keep it brief");
    expect(room.streamNextLine().appended).toBe(true);
    room.takeOver();

    const res = room.guide("Keep it short") as unknown as
      | { recorded?: boolean; reason?: string }
      | undefined;
    // The blocked guidance is recorded nowhere: only the pre-takeover text stays.
    expect(room.view().guidance).toEqual(["Keep it brief"]);
    expect(res?.recorded).toBe(false);
    expect(res?.reason).toMatch(/took over/i);

    // The twin is paused: no later line streams and nothing is steered.
    const before = [...room.view().transcript];
    const r = room.streamNextLine();
    expect(r.appended).toBe(false);
    expect(room.view().transcript).toEqual(before);
    expect(steeredLinesOf(room)).toEqual([]);
  });

  it("T16-5 guidance events are logged in the evidence record with sensitive values redacted", () => {
    const clock = { now: 1700000000000 };
    const { room } = makeRoom(clock);
    room.guide("Keep it brief — cc sam@example.test about $12,000, call 555-0142");
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.streamNextLine().appended).toBe(true);

    // Before approval there is no record yet: the steering waits for approval.
    expect(room.evidenceRecord()).toBeNull();
    expect(room.approve().approved).toBe(true);

    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    const events = [...(record!.guidanceEvents ?? [])];
    expect(events.length).toBe(1);
    expect(events[0]!.at).toBe(1700000000000);
    expect(events[0]!.steeredLineIndex).toBe(1);
    for (const secret of ["sam@example.test", "$12,000", "555-0142"]) {
      expect(events[0]!.redactedGuidance).not.toContain(secret);
    }
    expect(events[0]!.redactedGuidance).toContain("[REDACTED:email:1]");
    expect(events[0]!.redactedGuidance).toContain("[REDACTED:phone:1]");
    expect(events[0]!.redactedGuidance).toContain("[REDACTED:amount:1]");

    // The exported JSON carries the redacted event and no secrets.
    const exported = room.exportEvidenceJson();
    expect(exported).not.toBeNull();
    const parsed = JSON.parse(exported!) as {
      guidanceEvents: Array<{ at: number; redactedGuidance: string; steeredLineIndex: number }>;
    };
    expect(parsed.guidanceEvents.length).toBe(1);
    expect(parsed.guidanceEvents[0]).toEqual({
      at: 1700000000000,
      redactedGuidance: events[0]!.redactedGuidance,
      steeredLineIndex: 1,
    });
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(exported!).not.toContain(secret);
    }
    expect(exported!).not.toContain("sam@example.test");
  });

  it("T16-6 guidance events survive reload and appear once in the evidence record", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room1 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      now: () => clock.now,
      store,
    });
    room1.guide("No dates here — Bridgett confirms timing herself.");
    expect(room1.streamNextLine().appended).toBe(true);
    expect(room1.streamNextLine().appended).toBe(true);
    expect(room1.view().transcript[1]).toContain("a date Bridgett will confirm");

    // Reload before approval: the channel and the pending event survive.
    const room2 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      now: () => clock.now,
      store,
    });
    expect(room2.view().guidance).toEqual([
      "No dates here — Bridgett confirms timing herself.",
    ]);
    expect(room2.evidenceRecord()).toBeNull();
    expect(room2.approve().approved).toBe(true);
    const record2 = room2.evidenceRecord();
    const events2 = [...(record2!.guidanceEvents ?? [])];
    expect(events2.length).toBe(1);
    expect(events2[0]!.steeredLineIndex).toBe(1);
    const exported2 = JSON.parse(room2.exportEvidenceJson()!) as {
      guidanceEvents: unknown[];
    };
    expect(exported2.guidanceEvents.length).toBe(1);

    // A second reload still shows the event exactly once.
    const room3 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      now: () => clock.now,
      store,
    });
    const record3 = room3.evidenceRecord();
    expect(record3).not.toBeNull();
    expect([...(record3!.guidanceEvents ?? [])].length).toBe(1);
  });
});
