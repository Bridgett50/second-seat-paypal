import { describe, expect, it } from "vitest";
import {
  A11Y_CONTROLS,
  A11Y_LABELS,
  availableControls,
  runKeyboardFlow,
  type KeyboardFlowKey,
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

describe("t2 run-plugins control", () => {
  it("A11Y-RP1 run-plugins has a label and a plugins-region control", () => {
    expect((A11Y_LABELS as Record<string, string>)["run-plugins"]).toBe("Run plugins on the transcript so far");
    const c = A11Y_CONTROLS.find((x) => x.id === "run-plugins");
    expect(c?.region).toBe("plugins");
    expect(c?.role).toBe("button");
  });
  it("A11Y-RP2 run-plugins is offered outside demo mode while plugins may run and hidden after takeover", () => {
    const { room } = makeRoom();
    streamAll(room);
    const ids = availableControls(room.view(), { demoMode: false }).map((c) => c.id);
    expect(ids).toContain("run-plugins");
    expect(ids.indexOf("run-plugins")).toBeLessThan(ids.indexOf("approve"));
    room.takeOver();
    expect(availableControls(room.view(), { demoMode: false }).map((c) => c.id)).not.toContain("run-plugins");
  });
  it("A11Y-RP3 the keyboard driver activates run-plugins", async () => {
    const { room } = makeRoom();
    streamAll(room);
    const ids = availableControls(room.view(), { demoMode: false }).map((c) => c.id);
    const index = ids.indexOf("run-plugins");
    expect(index).toBeGreaterThanOrEqual(0);
    const keys: KeyboardFlowKey[] = [...Array<KeyboardFlowKey>(index).fill("Tab"), "Enter"];
    const result = await runKeyboardFlow(room, keys);
    expect(result.activated).toContain("run-plugins");
  });
});
