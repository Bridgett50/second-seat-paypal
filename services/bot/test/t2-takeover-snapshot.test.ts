import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import { TAKEOVER_REFUSAL, createTwinRoom } from "../src/t2-room.js";
import {
  createInMemoryRoomStore,
  loadTakeoverEvents,
} from "../src/t2-room.js";

/**
 * T15 durable pre-approval takeover + explicit plugin snapshot semantics
 * (local only, synthetic data).
 *
 * "Reload" is simulated by building a new twin room on the SAME in-memory
 * key-value store and dropping the old room. `loadTakeoverEvents` (new in
 * T15) is imported so the persisted takeover history can be inspected
 * directly; on the pre-T15 tree that import does not exist and this file
 * does not collect.
 */

function makeRoom(
  store: ReturnType<typeof createInMemoryRoomStore>,
  clock: { now: number },
  transport: (body: string) => Promise<void> = async () => {},
) {
  return createTwinRoom({ testMode: true, transport, store, now: () => clock.now });
}

function streamAll(room: ReturnType<typeof createTwinRoom>): void {
  for (let i = 0; i < 10; i += 1) {
    if (!room.streamNextLine().appended) break;
  }
}

describe("t2 durable takeover and plugin snapshots", () => {
  it("T15-1 a takeover before approval survives reload and keeps the twin paused", async () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room1 = makeRoom(store, clock);
    expect(room1.streamNextLine().appended).toBe(true);
    room1.takeOver();
    expect(room1.view().twinStatus).toBe("paused (you took over)");
    // No evidence record exists yet: the takeover happened pre-approval.
    expect(room1.evidenceRecord()).toBeNull();

    // Reload: drop room1, build room2 on the same store.
    const room2 = makeRoom(store, clock);
    expect(room2.restoredFromStore()).toBe(true);
    expect(room2.view().twinStatus).toBe("paused (you took over)");

    // No proactive answers: new lines are refused with a visible reason.
    const refused = room2.streamNextLine();
    expect(refused.appended).toBe(false);
    expect(refused.reason).toBe(TAKEOVER_REFUSAL);
    expect(room2.view().refusal).toBe(TAKEOVER_REFUSAL);

    // No plugins: nothing is proposed and nothing can be included.
    expect(room2.runPlugins()).toEqual([]);
    expect(room2.approvePluginOutput("action-items")).toEqual({ approved: false });
    expect(room2.refreshPluginOutput("action-items")).toEqual({ refreshed: false });

    // No sends, and the reload auto-approved and auto-sent nothing.
    expect(room2.view().draft.approved).toBe(false);
    expect(room2.view().draft.sendState).toBe("unsent");
    expect((await room2.send()).ok).toBe(false);

    // The earlier takeover is not lost: approving the frozen package later
    // records it in the evidence record.
    expect(room2.approve().approved).toBe(true);
    const record = room2.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.takeoverEvents).toEqual([{ at: 1700000000000, kind: "takeover" }]);
  });

  it("T15-2 pre-approval takeover events appear once and in order in the later evidence record", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room1 = makeRoom(store, clock);
    room1.streamNextLine();
    room1.takeOver();

    // A second takeover after a reload appends later events after earlier ones.
    clock.now += 1000;
    const room2 = makeRoom(store, clock);
    expect(room2.view().twinStatus).toBe("paused (you took over)");
    room2.takeOver();

    const room3 = makeRoom(store, clock);
    expect(room3.view().twinStatus).toBe("paused (you took over)");
    expect(room3.approve().approved).toBe(true);
    const record = room3.evidenceRecord();
    expect(record).not.toBeNull();
    expect(record!.takeoverEvents).toEqual([
      { at: 1700000000000, kind: "takeover" },
      { at: 1700000001000, kind: "takeover" },
    ]);
  });

  it("T15-3 repeated reloads never duplicate persisted takeover events", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    let room = makeRoom(store, clock);
    room.streamNextLine();
    const title = room.view().selectedMeetingTitle;
    room.takeOver();
    const countForMeeting = () =>
      loadTakeoverEvents(store, "bridgett").filter((e) => e.meetingTitle === title).length;
    expect(countForMeeting()).toBe(1);

    // Repeated reloads with no new takeover keep exactly one stored event.
    for (let i = 0; i < 3; i += 1) {
      room = makeRoom(store, clock);
      expect(room.view().twinStatus).toBe("paused (you took over)");
      expect(countForMeeting()).toBe(1);
    }

    expect(room.approve().approved).toBe(true);
    expect(room.evidenceRecord()!.takeoverEvents).toEqual([
      { at: 1700000000000, kind: "takeover" },
    ]);

    // One more reload after approval: still exactly one event.
    const reloaded = makeRoom(store, clock);
    expect(reloaded.evidenceRecord()!.takeoverEvents).toEqual([
      { at: 1700000000000, kind: "takeover" },
    ]);
  });

  it("T15-4 an included plugin output is a snapshot that does not change when new lines stream", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room = makeRoom(store, clock);
    expect(room.streamNextLine().appended).toBe(true);
    const action = room.runPlugins().find((o) => o.id === "action-items")!;
    expect(action.lines.length).toBeGreaterThan(0);
    expect(room.approvePluginOutput("action-items").approved).toBe(true);

    const entry = room.view().plugins.find((p) => p.id === "action-items")!;
    expect(entry.status).toBe("approved");
    expect(entry.snapshotAt).toBe(1700000000000);
    expect(entry.snapshotTranscriptLen).toBe(1);
    expect(entry.snapshotText).not.toBeNull();
    const bodyAtInclude = room.view().draft.body;
    expect(bodyAtInclude).toContain(action.title);
    for (const line of action.lines) expect(bodyAtInclude).toContain(line);

    // Stream the rest of the meeting: the included snapshot never changes.
    streamAll(room);
    expect(room.view().transcript.length).toBe(4);
    const after = room.view().plugins.find((p) => p.id === "action-items")!;
    expect(after.snapshotAt).toBe(1700000000000);
    expect(after.snapshotTranscriptLen).toBe(1);
    expect(after.snapshotText).toBe(entry.snapshotText);

    // The package still carries exactly the old snapshot section while the
    // live output has moved on with the new lines.
    const body = room.view().draft.body;
    for (const line of action.lines) expect(body).toContain(line);
    const live = room.runPlugins().find((o) => o.id === "action-items")!;
    const extra = live.lines.filter((l) => !action.lines.includes(l));
    expect(extra.length).toBeGreaterThan(0);
    for (const line of extra) expect(body).not.toContain(line);
  });

  it("T15-5 the view marks an included plugin output stale when live output differs", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room = makeRoom(store, clock);
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.approvePluginOutput("action-items").approved).toBe(true);

    // Fresh snapshot: not stale. A never-included output is never stale.
    expect(room.view().plugins.find((p) => p.id === "action-items")!.stale).toBe(false);
    expect(room.view().plugins.find((p) => p.id === "calendar-followup")!.stale).toBe(false);

    streamAll(room);
    const entry = room.view().plugins.find((p) => p.id === "action-items")!;
    expect(entry.status).toBe("approved");
    expect(entry.stale).toBe(true);
  });

  it("T15-6 refreshing a plugin snapshot changes the package and clears approval, and is refused after takeover or send", async () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room = makeRoom(store, clock);
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.approvePluginOutput("action-items").approved).toBe(true);
    expect(room.approve().approved).toBe(true);
    expect(room.view().draft.approved).toBe(true);
    const approvedHash = room.view().draft.sha256;

    streamAll(room);
    expect(room.view().plugins.find((p) => p.id === "action-items")!.stale).toBe(true);

    // Refresh re-snapshots from live output: the package changes like an edit.
    clock.now += 2000;
    expect(room.refreshPluginOutput("action-items")).toEqual({ refreshed: true });
    const entry = room.view().plugins.find((p) => p.id === "action-items")!;
    expect(entry.snapshotAt).toBe(1700000002000);
    expect(entry.snapshotTranscriptLen).toBe(4);
    expect(entry.stale).toBe(false);
    const v = room.view();
    expect(v.draft.approved).toBe(false);
    expect(v.draft.sha256).not.toBe(approvedHash);
    expect(v.draft.sha256).toBe(packageHash(v.draft.body));
    expect(room.approve().approved).toBe(true);
    expect(room.view().draft.sha256).toBe(packageHash(room.view().draft.body));

    // Unknown and never-included ids are refused without touching the package.
    const bodyBefore = room.view().draft.body;
    expect(room.refreshPluginOutput("no-such-plugin")).toEqual({ refreshed: false });
    expect(room.refreshPluginOutput("calendar-followup")).toEqual({ refreshed: false });
    expect(room.view().draft.body).toBe(bodyBefore);

    // Refused after takeover: the package is untouched.
    room.takeOver();
    expect(room.refreshPluginOutput("action-items")).toEqual({ refreshed: false });
    expect(room.view().draft.body).toBe(bodyBefore);

    // Refused once the send state leaves unsent.
    const sent: string[] = [];
    const room2 = createTwinRoom({
      testMode: true,
      transport: async (b) => void sent.push(b),
      store: createInMemoryRoomStore(),
      now: () => clock.now,
    });
    expect(room2.approvePluginOutput("action-items").approved).toBe(true);
    expect(room2.approve().approved).toBe(true);
    expect((await room2.send()).ok).toBe(true);
    const sentBody = room2.view().draft.body;
    expect(room2.refreshPluginOutput("action-items")).toEqual({ refreshed: false });
    expect(room2.view().draft.body).toBe(sentBody);
    expect(sent).toEqual([sentBody]);
  });
});
