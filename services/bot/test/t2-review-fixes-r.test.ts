import { describe, expect, it } from "vitest";
import {
  PENDING_SEND_EDIT_REASON,
  REAPPROVE_AFTER_RELOAD_NOTE,
  UNCONFIRMED_SEND_REASON,
  createTwinRoom,
} from "../src/t2-room.js";
import { createInMemoryRoomStore } from "../src/t2-room.js";

function streamAll(room: ReturnType<typeof createTwinRoom>): void {
  for (let i = 0; i < 20; i += 1) {
    if (!room.streamNextLine().appended) break;
  }
}

describe("t2 review fixes (R)", () => {
  it("R-1 a second send while the first is still pending is refused as unconfirmed and the transport runs once", async () => {
    const store = createInMemoryRoomStore();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {
        calls += 1;
        await gate;
      },
      store,
    });
    streamAll(room);
    expect(room.approve().approved).toBe(true);
    const first = room.send();
    await new Promise((r) => setTimeout(r, 0));
    const second = await room.send();
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe(UNCONFIRMED_SEND_REASON);
    }
    expect(room.sendIntent()?.status).toBe("pending");
    const room2 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      store,
    });
    expect(room2.view().draft.sendState).toBe("unconfirmed");
    expect(() => room.editDraft("changed while pending")).toThrow(
      PENDING_SEND_EDIT_REASON,
    );
    expect(calls).toBe(1);
    release();
    expect((await first).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("R-2 the reapproval note asks to review the text again and never claims it is unchanged", () => {
    const store = createInMemoryRoomStore();
    const room1 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      store,
    });
    streamAll(room1);
    expect(room1.approve().approved).toBe(true);
    const room2 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      store,
    });
    expect(room2.approvalNote()).toBe(REAPPROVE_AFTER_RELOAD_NOTE);
    expect(room2.approvalNote()).toBe(
      "Approval doesn't survive a reload. Review the text below, then approve again.",
    );
    expect(room2.approvalNote()).toMatch(/review/i);
    expect(room2.approvalNote()).toMatch(/approve again/i);
    expect(room2.approvalNote()).not.toMatch(/unchanged|same text|not changed|identical/i);
  });
});
