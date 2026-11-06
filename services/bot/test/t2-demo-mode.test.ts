import { describe, expect, it, vi } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import {
  createDemoController,
  DEMO_STEPS,
  isDemoMode,
  type DemoStep,
} from "../src/t2-room.js";
import type { EmailComparison } from "../src/t2-room.js";
import { renderPluginOutput } from "../src/t2-room.js";
import { redactPackageText } from "../src/t2-room.js";
import {
  SEEDED_SENSITIVE_VALUES,
  TAKEOVER_REFUSAL,
  createTwinRoom,
} from "../src/t2-room.js";

function makeRoom() {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: async (body) => void sent.push(body),
  });
  return { room, sent };
}

describe("t2 demo mode", () => {
  it("T13-1 demo mode is enabled only by demo=1 in the query string", () => {
    expect(isDemoMode("?demo=1")).toBe(true);
    expect(isDemoMode("?x=2&demo=1")).toBe(true);
    expect(isDemoMode("demo=1")).toBe(true);
    expect(isDemoMode("https://example.test/meeting-room?demo=1")).toBe(true);
    expect(isDemoMode("?demo=0")).toBe(false);
    expect(isDemoMode("?demo=true")).toBe(false);
    expect(isDemoMode("?demo=10")).toBe(false);
    expect(isDemoMode("?demo=")).toBe(false);
    expect(isDemoMode("?Demo=1")).toBe(false);
    expect(isDemoMode("")).toBe(false);
    expect(isDemoMode("?")).toBe(false);
    expect(isDemoMode("?x=1")).toBe(false);
    expect(isDemoMode("?%zz&demo")).toBe(false);
    expect(isDemoMode("not a query at all")).toBe(false);
    expect(isDemoMode(null as unknown as string)).toBe(false);
    expect(isDemoMode(undefined as unknown as string)).toBe(false);
  });

  it("T13-2 the guided demo runs end to end against a real room and sends exactly the approved package once", async () => {
    const { room, sent } = makeRoom();
    const demo = createDemoController(room);

    const seen: string[] = [];
    let step: DemoStep | null = await demo.next();
    while (step !== null) {
      seen.push(step.id);
      const v = room.view();
      switch (step.id) {
        case "demo-join":
          expect(v.selectedMeetingTitle).toBe("Q3 launch sync");
          break;
        case "demo-stream":
          expect(v.transcript.length).toBeGreaterThan(0);
          break;
        case "demo-guide":
          expect(v.guidance.length).toBe(1);
          break;
        case "demo-plugin": {
          const plugin = v.plugins.find((p) => p.id === "action-items");
          expect(plugin?.status).toBe("approved");
          expect(v.draft.body).toContain("Action items for Q3 launch sync");
          break;
        }
        case "demo-approve":
          expect(v.draft.approved).toBe(true);
          expect(v.draft.sha256).toBe(packageHash(v.draft.body));
          break;
        case "demo-send":
          expect(v.draft.sendState).toBe("sent");
          expect(room.transportCalls()).toBe(1);
          expect(sent.length).toBe(1);
          expect(sent[0]).toBe(v.draft.body);
          break;
        case "demo-compare": {
          const res = demo.result("demo-compare") as {
            readonly comparison: EmailComparison;
            readonly importedText: string;
          };
          expect(res.comparison.identical).toBe(true);
          expect(res.comparison.flags).toEqual([]);
          expect(res.importedText.length).toBeGreaterThan(0);
          break;
        }
        case "demo-evidence": {
          const json = demo.result("demo-evidence") as string;
          expect(typeof json).toBe("string");
          expect(json).toContain(room.view().draft.sha256);
          for (const secret of SEEDED_SENSITIVE_VALUES) {
            expect(json).not.toContain(secret);
          }
          break;
        }
        case "demo-takeover":
          expect(v.twinStatus).toBe("paused (you took over)");
          break;
        default:
          throw new Error(`unexpected demo step ${step.id}`);
      }
      step = await demo.next();
    }

    expect(seen).toEqual(DEMO_STEPS.map((s) => s.id));

    // No-op after the last step: nothing resends.
    expect(await demo.next()).toBeNull();
    expect(room.transportCalls()).toBe(1);
    expect(sent.length).toBe(1);

    // The takeover paused the twin: new lines are refused.
    const before = room.view().transcript;
    const r = room.streamNextLine();
    expect(r.appended).toBe(false);
    expect(r.reason).toBe(TAKEOVER_REFUSAL);
    expect(room.view().transcript).toEqual(before);
  });

  it("T13-3 every demo step has a caption and an accessible label and steps never skip or repeat", async () => {
    expect(DEMO_STEPS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const s of DEMO_STEPS) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
    expect(DEMO_STEPS[DEMO_STEPS.length - 1]!.id).toBe("demo-takeover");

    const { room } = makeRoom();
    const demo = createDemoController(room);
    expect(demo.current()?.id).toBe(DEMO_STEPS[0]!.id);

    const ran: string[] = [];
    let s: DemoStep | null = await demo.next();
    while (s !== null) {
      ran.push(s.id);
      s = await demo.next();
    }
    expect(ran).toEqual(DEMO_STEPS.map((x) => x.id));
    expect(demo.current()).toBeNull();

    // Extra next() calls change nothing.
    const calls = room.transportCalls();
    expect(await demo.next()).toBeNull();
    expect(await demo.next()).toBeNull();
    expect(room.transportCalls()).toBe(calls);

    // Reset restarts at the first step.
    demo.reset();
    expect(demo.current()?.id).toBe(DEMO_STEPS[0]!.id);
    expect(demo.completed()).toBe(0);
  });

  it("T13-4 the keyboard shortcut advances and restarts the demo and ignores other keys and typing in inputs", async () => {
    const { room } = makeRoom();
    const demo = createDemoController(room);
    const first = DEMO_STEPS[0]!.id;
    expect(demo.current()?.id).toBe(first);

    const advanced = await demo.demoKeyAction("n");
    expect(
      advanced !== null && advanced !== "reset" ? advanced.id : advanced,
    ).toBe(first);
    expect(demo.completed()).toBe(1);

    const arrow = await demo.demoKeyAction("ArrowRight");
    expect(arrow !== null && arrow !== "reset" ? arrow.id : arrow).toBe(
      DEMO_STEPS[1]!.id,
    );
    expect(demo.completed()).toBe(2);

    // Other keys are ignored.
    expect(await demo.demoKeyAction("Enter")).toBeNull();
    expect(await demo.demoKeyAction(" ")).toBeNull();
    expect(await demo.demoKeyAction("N")).toBeNull();
    expect(await demo.demoKeyAction("Escape")).toBeNull();
    expect(demo.completed()).toBe(2);

    // Keys typed into inputs/textareas are ignored, even n/r.
    expect(await demo.demoKeyAction("n", true)).toBeNull();
    expect(await demo.demoKeyAction("ArrowRight", true)).toBeNull();
    expect(await demo.demoKeyAction("r", true)).toBeNull();
    expect(demo.completed()).toBe(2);

    // Restart returns to the first step.
    expect(await demo.demoKeyAction("r")).toBe("reset");
    expect(demo.completed()).toBe(0);
    expect(demo.current()?.id).toBe(first);
  });

  it("T13-5 plugin action items never include another meeting's scripted lines", () => {
    const { room } = makeRoom();
    const meetings = room.view().meetings;
    expect(meetings.length).toBeGreaterThanOrEqual(2);
    const a = meetings[0]!;
    const b = meetings[1]!;

    room.selectMeeting(a.id);
    const linesA: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      if (!room.streamNextLine().appended) break;
      const v = room.view();
      linesA.push(v.transcript[v.transcript.length - 1]!);
    }
    room.selectMeeting(b.id);
    const linesB: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      if (!room.streamNextLine().appended) break;
      const v = room.view();
      linesB.push(v.transcript[v.transcript.length - 1]!);
    }
    expect(linesA.length).toBeGreaterThan(0);
    expect(linesB.length).toBeGreaterThan(0);

    room.selectMeeting(a.id);
    const outA = room.runPlugins();
    expect(outA.length).toBeGreaterThan(0);
    const textA = outA
      .map((o) => `${o.title}\n${o.lines.join("\n")}`)
      .join("\n");
    // Non-vacuous: A's outputs really cover A's own scripted lines.
    expect(linesA.some((line) => textA.includes(line))).toBe(true);
    for (const line of linesB) expect(textA).not.toContain(line);

    room.selectMeeting(b.id);
    const outB = room.runPlugins();
    expect(outB.length).toBeGreaterThan(0);
    const textB = outB
      .map((o) => `${o.title}\n${o.lines.join("\n")}`)
      .join("\n");
    expect(linesB.some((line) => textB.includes(line))).toBe(true);
    for (const line of linesA) expect(textB).not.toContain(line);
  });

  it("T13-6 a plugin output containing a sensitive value is redacted before it enters the package", () => {
    // Made-up values only; none belong to a real person.
    const email = "zoe@example.test";
    const phone = "555-0199";
    const amount = "$45.00";
    const raw = [email, phone, amount];

    // A synthetic plugin output carrying sensitive values, through the same
    // render-then-redact pipeline the room applies before inclusion.
    const synthetic = {
      id: "action-items",
      title: "Action items for Q3 launch sync",
      lines: [
        `- Action: confirm the recap with ${email}`,
        `- Action: call ${phone} about the ${amount} budget`,
      ],
    };
    const section = redactPackageText(renderPluginOutput(synthetic)).redactedText;
    for (const value of raw) expect(section).not.toContain(value);
    expect(section).toMatch(/\[REDACTED:email:1\]/);
    expect(section).toMatch(/\[REDACTED:phone:1\]/);
    expect(section).toMatch(/\[REDACTED:amount:1\]/);

    // End to end through a real room: a synthetic meeting line plus an
    // included plugin section both land in the package redacted.
    const { room } = makeRoom();
    room.editDraft(
      `${room.view().draft.body}\nContact (synthetic): ${email} · ${phone} · budget ${amount}.\n`,
    );
    expect(room.approvePluginOutput("action-items").approved).toBe(true);

    // The room's included section is exactly the redacted render: a plugin
    // output that skipped redaction could not match this snapshot.
    const proposed = room.runPlugins().find((o) => o.id === "action-items");
    expect(proposed).toBeDefined();
    const expectedSection = redactPackageText(
      renderPluginOutput(proposed!),
    ).redactedText;
    expect(room.view().draft.body).toContain(expectedSection);

    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;
    expect(body).toContain("Action items for Q3 launch sync");
    for (const value of raw) expect(body).not.toContain(value);
    expect(room.view().draft.sha256).toBe(packageHash(body));
  });

  it("T13-7 two concurrent next() calls run one step each, in order, with no duplicate step 1", async () => {
    const { room } = makeRoom();
    const demo = createDemoController(room);
    const [first, second] = await Promise.all([demo.next(), demo.next()]);
    expect(first?.id, "first concurrent next() runs step 1").toBe(DEMO_STEPS[0]!.id);
    expect(second?.id, "second concurrent next() runs step 2, not step 1 again").toBe(DEMO_STEPS[1]!.id);
    expect(demo.completed(), "exactly two steps completed").toBe(2);
    expect(demo.current()?.id, "step 3 is next").toBe(DEMO_STEPS[2]!.id);
    expect(room.view().guidance.length, "the guide step ran exactly once").toBe(1);
  });

  it("T13-8 next() and skip() called together act in call order: step 1 runs, step 2 is skipped", async () => {
    const { room } = makeRoom();
    const demo = createDemoController(room);
    const [ran, skipped] = await Promise.all([demo.next(), demo.skip()]);
    expect(ran?.id, "next() runs step 1").toBe(DEMO_STEPS[0]!.id);
    expect(skipped?.id, "skip() skips step 2, not step 1").toBe(DEMO_STEPS[1]!.id);
    expect(demo.completed(), "exactly two steps completed").toBe(2);
    expect(demo.result(DEMO_STEPS[0]!.id), "step 1 ran, not marked skipped").toBe(room.view().selectedMeetingTitle);
    expect(demo.result(DEMO_STEPS[1]!.id), "step 2 is marked skipped").toEqual({ skipped: true });
    expect(room.view().guidance.length, "the skipped guide step did not run").toBe(0);
  });

  it("T13-9 reset() after pending next() calls restarts cleanly: nothing stale counts, then step 1 runs once", async () => {
    const { room } = makeRoom();
    const demo = createDemoController(room);
    const first = demo.next();
    const second = demo.next();
    demo.reset();
    await Promise.all([first, second]);
    expect(demo.completed(), "next() calls issued before reset() do not count").toBe(0);
    expect(demo.current()?.id, "the script is back at step 1").toBe(DEMO_STEPS[0]!.id);
    expect(demo.result(DEMO_STEPS[0]!.id), "no stale step-1 result").toBeUndefined();
    const again = await demo.next();
    expect(again?.id, "step 1 runs after the reset").toBe(DEMO_STEPS[0]!.id);
    expect(demo.completed(), "exactly one step completed after the reset").toBe(1);
  });

  it("T13-10 reset() while a slow step 1 runs drops the queued next(): step 1 ran once, then runs once after the reset", async () => {
    const { room } = makeRoom();
    const demo = createDemoController(room);
    const step1 = DEMO_STEPS[0]!;
    const original = step1.run.bind(step1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const spy = vi.spyOn(step1, "run").mockImplementationOnce(async (r) => {
      markStarted();
      await gate;
      return original(r);
    });
    try {
      const p1 = demo.next();
      await started;
      const p2 = demo.next();
      demo.reset();
      release();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1, "the slow step-1 call that spanned reset() does not count").toBeNull();
      expect(r2, "the next() queued before reset() resolves null").toBeNull();
      expect(spy, "step 1 ran only once: the queued call did not run it again").toHaveBeenCalledTimes(1);
      expect(demo.completed(), "nothing counts after the reset").toBe(0);
      const again = await demo.next();
      expect(again?.id, "step 1 runs after the reset").toBe(step1.id);
      expect(spy, "step 1 ran exactly once more after the reset").toHaveBeenCalledTimes(2);
      expect(demo.completed(), "exactly one step completed after the reset").toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
