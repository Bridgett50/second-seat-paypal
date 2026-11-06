import { describe, expect, it } from "vitest";
import {
  availableControls,
  runKeyboardFlow,
  type KeyboardFlowKey,
} from "../src/t2-room.js";
import {
  deriveApprovedPackage,
  serializeApprovedPackage,
} from "../src/t2-room.js";
import { createTwinRoom } from "../src/t2-room.js";

function makeRoom() {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: async (body) => void sent.push(body),
  });
  return { room, sent };
}

function streamAll(room: ReturnType<typeof createTwinRoom>): void {
  for (let i = 0; i < 20; i += 1) {
    if (!room.streamNextLine().appended) break;
  }
}

/** Tab presses from initial focus to `target` in the current focus order. */
function tabsTo(
  room: ReturnType<typeof createTwinRoom>,
  target: string,
  demoMode = false,
): KeyboardFlowKey[] {
  const ids = availableControls(room.view(), { demoMode }).map((c) => c.id);
  const index = ids.indexOf(target);
  expect(index).toBeGreaterThanOrEqual(0);
  return Array<KeyboardFlowKey>(index).fill("Tab");
}

describe("t2 a11y compare before approve and resume", () => {
  it("A11Y-CR1 a streamed unapproved room offers compare controls after approve and no send", () => {
    const { room } = makeRoom();
    streamAll(room);
    const ids = availableControls(room.view(), {}).map((c) => c.id);
    expect(ids).toContain("compare-input");
    expect(ids).toContain("compare-file");
    expect(ids).toContain("compare-run");
    expect(ids.indexOf("compare-run")).toBeGreaterThan(ids.indexOf("approve"));
    expect(ids).not.toContain("send");
  });

  it("A11Y-CR2 keyboard compare before approval compares the visible package and leaves it unapproved", async () => {
    const { room } = makeRoom();
    streamAll(room);
    const v = room.view();
    const text = serializeApprovedPackage(
      deriveApprovedPackage({ title: v.selectedMeetingTitle, script: [...v.transcript], body: v.draft.body }),
    );
    const result = await runKeyboardFlow(room, [...tabsTo(room, "compare-input"), { key: "type", text }, "Tab", "Tab", "Enter"]);
    expect(result.activated).toContain("compare-run");
    expect(result.comparison).not.toBeNull();
    expect(result.comparison?.identical).toBe(true);
    expect(result.comparison?.flags).toEqual([]);
    expect(room.view().draft.approved).toBe(false);
  });

  it("A11Y-CR3 a paused room focuses meeting picker, resume and the package editor only", () => {
    const { room } = makeRoom();
    room.takeOver();
    const ids = availableControls(room.view(), {}).map((c) => c.id);
    expect(ids).toEqual(["meeting-picker", "resume", "package-editor", "package-save"]);
  });

  it("A11Y-CR4 Enter on resume resumes the twin and brings takeover back", async () => {
    const { room } = makeRoom();
    streamAll(room);
    room.takeOver();
    const result = await runKeyboardFlow(room, [...tabsTo(room, "resume"), "Enter"]);
    expect(room.view().twinStatus).toBe("active");
    expect(result.announcements).toContain("You resumed. The twin is active again.");
    const ids = availableControls(room.view(), {}).map((c) => c.id);
    expect(ids).toContain("takeover");
    expect(ids).not.toContain("resume");
  });

  it("A11Y-CR5 a sent room offers neither compare nor resume", async () => {
    const { room } = makeRoom();
    streamAll(room);
    room.approve();
    const res = await room.send();
    expect(res.ok).toBe(true);
    const ids = availableControls(room.view(), {}).map((c) => c.id);
    expect(ids).not.toContain("compare-input");
    expect(ids).not.toContain("compare-file");
    expect(ids).not.toContain("compare-run");
    expect(ids).not.toContain("resume");
  });
});
