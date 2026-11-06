import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeetingConnector } from "../src/meeting/connector.js";
import { createTwinRoom } from "../src/t2-room.js";
import {
  createInMemoryRoomStore,
  loadTakeoverEvents,
  roomStoreKey,
  type RoomStore,
} from "../src/t2-room.js";

/**
 * Review fixes F2 (findings #5-#10, plus a stronger #1 lock check).
 * Local only, synthetic data. "Reload" = a new room on the SAME store.
 */

function streamAll(room: ReturnType<typeof createTwinRoom>): void {
  for (let i = 0; i < 20; i += 1) {
    if (!room.streamNextLine().appended) break;
  }
}

/** In-memory store that also remembers every value ever written. */
function recordingStore(): { store: RoomStore; written: string[] } {
  const inner = createInMemoryRoomStore();
  const written: string[] = [];
  return {
    written,
    store: {
      get: (key) => inner.get(key),
      set: (key, value) => {
        written.push(key, value);
        inner.set(key, value);
      },
      remove: (key) => inner.remove(key),
    },
  };
}

describe("t2 review fixes (F2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("F2-1 an included plugin output cannot be refreshed or removed while a send is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {
        await gate;
      },
    });
    streamAll(room);
    expect(room.approvePluginOutput("action-items")).toEqual({ approved: true });
    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;
    const inflight = room.send();
    await new Promise((r) => setTimeout(r, 0));
    expect(room.sendIntent()?.status).toBe("pending");
    expect(room.refreshPluginOutput("action-items")).toEqual({ refreshed: false });
    expect(room.rejectPluginOutput("action-items")).toEqual({ rejected: false });
    expect(room.view().draft.body).toBe(body);
    expect(room.sendIntent()?.status).toBe("pending");
    release();
    expect((await inflight).ok).toBe(true);
    expect(room.transportCalls()).toBe(1);
  });

  it("F2-5 a reloaded pending intent with the stored send state forced to unsent still refuses send", async () => {
    const store = createInMemoryRoomStore();
    const room1 = createTwinRoom({
      testMode: true,
      transport: () => new Promise<void>(() => {}),
      store,
    });
    streamAll(room1);
    expect(room1.approve().approved).toBe(true);
    void room1.send();
    await new Promise((r) => setTimeout(r, 0));
    expect(room1.sendIntent()?.status).toBe("pending");

    const v1 = room1.view();
    const key = roomStoreKey(v1.ownerId, v1.selectedMeetingTitle);
    const record = JSON.parse(store.get(key) as string) as Record<string, unknown>;
    record["sendState"] = "unsent";
    store.set(key, JSON.stringify(record));

    const room2 = createTwinRoom({ testMode: true, transport: async () => {}, store });
    expect(room2.sendIntent()?.status).toBe("pending");
    expect(room2.sendIntent()?.meetingId).toBe(room2.view().selectedMeetingId);
    expect(room2.view().draft.sendState).toBe("unconfirmed");
    expect(room2.approve().approved).toBe(false);
    expect((await room2.send()).ok).toBe(false);
    expect(room2.transportCalls()).toBe(0);
  });

  it("F2-7 takeOver is idempotent: a second call adds no event for any meeting", () => {
    const store = createInMemoryRoomStore();
    const room = createTwinRoom({ testMode: true, transport: async () => {}, store });
    streamAll(room);
    expect(room.approve().approved).toBe(true);
    const v = room.view();
    room.takeOver();
    room.takeOver();
    const events = loadTakeoverEvents(store, v.ownerId);
    expect(events.length).toBe(v.meetings.length);
    for (const m of v.meetings) {
      expect(events.filter((e) => e.meetingTitle === m.title).length).toBe(1);
    }
    expect(room.evidenceRecord()?.takeoverEvents.length).toBe(1);
  });

  it("F2-8 guidance is stored redacted: no stored value holds the raw sensitive text", () => {
    const { store, written } = recordingStore();
    const room = createTwinRoom({ testMode: true, transport: async () => {}, store });
    const seeded = ["sam.rivera@example.test", "555-0142", "$1,250"];
    expect(room.guide("Mention sam.rivera@example.test, 555-0142 and $1,250 (synthetic).").recorded).toBe(true);
    expect(room.guide("Queued too: call 555-0142 before $1,250 is due.").recorded).toBe(true);
    room.streamNextLine();
    expect(written.length).toBeGreaterThan(0);
    for (const value of written) {
      for (const s of seeded) expect(value.includes(s), s).toBe(false);
    }
    const room2 = createTwinRoom({ testMode: true, transport: async () => {}, store });
    expect(room2.restoredFromStore()).toBe(true);
  });

// F2-9 removed in port: asserted holo mirror-connector id generation; frozen services/bot/src/meeting/connector.ts uses node:crypto (see PROVENANCE.md).
});
