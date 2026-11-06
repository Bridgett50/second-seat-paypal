import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  A11Y_CONTROLS,
  A11Y_LABELS,
  A11Y_LIVE_POLITENESS,
  A11Y_LIVE_REGION,
  A11Y_REGION_ORDER,
  A11Y_TEXT_PAIRS,
  A11Y_FOCUS_RING,
  availableControls,
  contrastRatio,
  demoStepAnnouncement,
  diffAnnouncements,
  runKeyboardFlow,
  type KeyboardFlowKey,
} from "../src/t2-room.js";
import { createDemoController, DEMO_STEPS } from "../src/t2-room.js";
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

describe("t2 accessibility", () => {
  it("T17-1 every available control has a unique id and a non-empty accessible label in every room state", () => {
    const staticIds = A11Y_CONTROLS.map((c) => c.id);
    expect(new Set(staticIds).size).toBe(staticIds.length);
    for (const c of A11Y_CONTROLS) {
      expect(c.label.trim().length).toBeGreaterThan(0);
    }

    const { room } = makeRoom();
    const check = (name: string, demoMode: boolean): void => {
      const controls = availableControls(room.view(), { demoMode });
      expect(controls.length, `${name}: at least one control`).toBeGreaterThan(0);
      const ids = controls.map((c) => c.id);
      expect(new Set(ids).size, `${name}: unique ids`).toBe(ids.length);
      for (const c of controls) {
        expect(c.label.trim().length, `${name}: ${c.id} labelled`).toBeGreaterThan(0);
        expect(
          (A11Y_REGION_ORDER as readonly string[]).includes(c.region),
          `${name}: ${c.id} in a known region`,
        ).toBe(true);
      }
    };

    check("fresh", false);
    check("fresh demo", true);
    streamAll(room);
    check("streamed", false);
    room.guide("Keep the recap short.");
    check("guided", false);
    expect(room.approvePluginOutput("action-items").approved).toBe(true);
    check("plugin included", false);
    expect(room.approve().approved).toBe(true);
    check("approved", false);
    check("approved demo", true);
  });

  it("T17-2 focus order follows the documented region order and hides unavailable actions", async () => {
    const { room } = makeRoom();
    const fresh = availableControls(room.view(), {});
    // Exact documented order: meeting picker, stream, guidance, takeover,
    // package editor, run plugins, plugin toggles, approve (send hidden until approval).
    expect(fresh.map((c) => c.id)).toEqual([
      "meeting-picker",
      "stream-next",
      "guidance-input",
      "guidance-send",
      "takeover",
      "package-editor",
      "package-save",
      "run-plugins",
      "plugin-include-action-items",
      "plugin-exclude-action-items",
      "plugin-include-calendar-followup",
      "plugin-exclude-calendar-followup",
      "approve",
      "compare-input",
      "compare-file",
      "compare-run",
    ]);

    // Regions never run backwards.
    const regionIndex = (id: string): number =>
      A11Y_REGION_ORDER.indexOf(
        fresh.find((c) => c.id === id)?.region ?? "meeting",
      );
    const positions = fresh.map((c) => regionIndex(c.id));
    expect(
      positions.every((value, i) => i === 0 || value >= (positions[i - 1] ?? 0)),
    ).toBe(true);

    // Demo controls appear only in demo mode, right after the meeting picker.
    const demo = availableControls(room.view(), { demoMode: true });
    expect(demo.map((c) => c.id).slice(0, 3)).toEqual([
      "meeting-picker",
      "demo-next",
      "demo-restart",
    ]);

    // Send is absent until the package is approved.
    expect(fresh.some((c) => c.id === "send")).toBe(false);
    streamAll(room);
    room.guide("Keep it short.");
    expect(room.approve().approved).toBe(true);
    const approved = availableControls(room.view(), {});
    expect(approved.some((c) => c.id === "approve")).toBe(false);
    expect(approved.some((c) => c.id === "send")).toBe(true);
    expect(approved.some((c) => c.id === "compare-run")).toBe(true);
    expect(approved.some((c) => c.id === "evidence-export")).toBe(true);

    // After takeover, Approve/Send (and streaming/guidance) are hidden.
    const { room: paused } = makeRoom();
    paused.takeOver();
    const afterTakeover = availableControls(paused.view(), {});
    expect(afterTakeover.some((c) => c.id === "approve")).toBe(false);
    expect(afterTakeover.some((c) => c.id === "send")).toBe(false);
    expect(afterTakeover.some((c) => c.id === "stream-next")).toBe(false);
    expect(afterTakeover.some((c) => c.id === "guidance-send")).toBe(false);
    expect(afterTakeover.some((c) => c.id === "takeover")).toBe(false);

    // After send the package editor locks and Send leaves with it.
    const { room: sender } = makeRoom();
    streamAll(sender);
    expect(sender.approve().approved).toBe(true);
    expect(await sender.send()).toEqual({ ok: true });
    const afterSend = availableControls(sender.view(), {});
    expect(sender.view().draft.sendState).toBe("sent");
    expect(afterSend.some((c) => c.id === "package-editor")).toBe(false);
    expect(afterSend.some((c) => c.id === "send")).toBe(false);
    expect(afterSend.some((c) => c.id === "compare-run")).toBe(false);
    expect(afterSend.some((c) => c.id === "evidence-export")).toBe(true);
  });

  it("T17-3 every palette text pair meets 4.5:1 and the focus ring meets 3:1", () => {
    // Sanity: the helper is real, not a stub (identical is 1, black/white ~21).
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThan(20);
    expect(contrastRatio("#ffffff", "#000000")).toBe(
      contrastRatio("#000000", "#ffffff"),
    );

    for (const pair of A11Y_TEXT_PAIRS) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      expect(ratio, `${pair.name}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(
      contrastRatio(A11Y_FOCUS_RING.color, A11Y_FOCUS_RING.background),
      "focus ring",
    ).toBeGreaterThanOrEqual(3);
  });

  it("T17-4 a keyboard-only flow completes stream, guidance, approve, send and compare without pointer input", async () => {
    const { room, sent } = makeRoom();

    // Stream every scripted line with Tab + Enter only.
    const streamed = await runKeyboardFlow(room, [
      ...tabsTo(room, "stream-next"),
      "Enter",
      "Enter",
      "Enter",
      "Enter",
    ]);
    expect(room.view().transcript.length).toBe(4);
    expect(streamed.activated.filter((id) => id === "stream-next").length).toBe(4);

    // Guidance: Tab to the input, type, Tab to Send, Enter.
    await runKeyboardFlow(room, [
      ...tabsTo(room, "guidance-input"),
      { key: "type", text: "Keep the recap short." },
      "Tab",
      "Enter",
    ]);
    expect(room.view().guidance).toEqual(["Keep the recap short."]);

    // Include the action-items plugin output.
    await runKeyboardFlow(room, [...tabsTo(room, "plugin-include-action-items"), "Enter"]);
    expect(room.view().draft.body).toContain("Action items for Q3 launch sync");

    // Approve the exact package.
    const approvedRun = await runKeyboardFlow(room, [...tabsTo(room, "approve"), "Enter"]);
    expect(room.view().draft.approved).toBe(true);
    expect(approvedRun.announcements.some((a) => a.includes("Package approved"))).toBe(
      true,
    );

    // Compare BEFORE sending: a sent package locks, so the room only
    // compares the current approved package. Rebuild the approved package
    // from the streamed transcript (identical to the script here: guidance
    // was recorded after streaming, so no line was steered).
    const v = room.view();
    const approved = deriveApprovedPackage({
      title: v.selectedMeetingTitle,
      script: [...v.transcript],
      body: v.draft.body,
    });
    const importText = serializeApprovedPackage(approved);
    const compared = await runKeyboardFlow(room, [
      ...tabsTo(room, "compare-input"),
      { key: "type", text: importText },
      "Tab",
      "Tab",
      "Enter",
    ]);
    expect(compared.comparison).not.toBeNull();
    expect(compared.comparison?.identical).toBe(true);
    expect(compared.comparison?.flags).toEqual([]);

    // Send once through the test fake transport.
    const sentRun = await runKeyboardFlow(room, [...tabsTo(room, "send"), "Enter"]);
    expect(sentRun.sendResults).toEqual([{ ok: true }]);
    expect(room.view().draft.sendState).toBe("sent");
    expect(room.transportCalls()).toBe(1);
    expect(sent).toEqual([room.view().draft.body]);
    expect(sentRun.announcements.some((a) => a.includes("sent"))).toBe(true);

    // The whole flow used Tab navigation and activation only: every
    // activation names a control id from the documented focus order.
    const allActivated = [
      ...streamed.activated,
      ...approvedRun.activated,
      ...compared.activated,
      ...sentRun.activated,
    ];
    for (const id of ["stream-next", "approve", "compare-run", "send"]) {
      expect(allActivated).toContain(id);
    }
    expect(A11Y_LABELS["send"]).toBe("Send through the test fake transport");
  });

  it("T17-5 state changes produce polite live-region announcements, including demo step changes", () => {
    expect(A11Y_LIVE_POLITENESS).toBe("polite");
    expect(A11Y_LIVE_REGION).toEqual({ role: "status", ariaLive: "polite" });

    const { room } = makeRoom();
    // New transcript line.
    const beforeStream = room.view();
    room.streamNextLine();
    const streamNotes = diffAnnouncements(beforeStream, room.view());
    expect(streamNotes.length).toBeGreaterThan(0);
    expect(streamNotes.some((a) => a.startsWith("New transcript line:"))).toBe(true);

    // Guidance recorded.
    const beforeGuide = room.view();
    room.guide("Keep it short.");
    expect(
      diffAnnouncements(beforeGuide, room.view()).some((a) =>
        a.includes("Guidance recorded"),
      ),
    ).toBe(true);

    // Approval binds the shown hash.
    streamAll(room);
    const beforeApprove = room.view();
    expect(room.approve().approved).toBe(true);
    const approveNotes = diffAnnouncements(beforeApprove, room.view());
    expect(
      approveNotes.some((a) => a.includes(`SHA-256 ${room.view().draft.sha256}`)),
    ).toBe(true);

    // Takeover pauses the twin.
    const { room: paused } = makeRoom();
    const beforeTakeover = paused.view();
    paused.takeOver();
    expect(
      diffAnnouncements(beforeTakeover, paused.view()).some((a) =>
        a.includes("paused"),
      ),
    ).toBe(true);

    // Nothing changed: no announcements.
    const steady = room.view();
    expect(diffAnnouncements(steady, steady)).toEqual([]);

    // Demo step changes announce with the step's own label.
    const step = DEMO_STEPS[0]!;
    const stepNote = demoStepAnnouncement(step);
    expect(stepNote).toContain("Guided demo");
    expect(stepNote).toContain(step.label);
    const demoNotes = diffAnnouncements(steady, steady, { demoStep: step });
    expect(demoNotes.some((a) => a.includes(step.label))).toBe(true);
  });

  it("T17-7 demoStepAnnouncement adds a final period only when the caption lacks one", () => {
    expect(demoStepAnnouncement({ label: "Join", caption: "Join the sync." })).toBe(
      "Guided demo — Join: Join the sync.",
    );
    expect(demoStepAnnouncement({ label: "Join", caption: "Join the sync" })).toBe(
      "Guided demo — Join: Join the sync.",
    );
    for (const step of DEMO_STEPS) {
      expect(demoStepAnnouncement(step).endsWith("..")).toBe(false);
    }
  });

  // T17-6 moved to session B (web meeting-room UI not ported yet)
});
