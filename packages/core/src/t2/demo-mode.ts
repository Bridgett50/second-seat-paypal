/**
 * Guided demo mode (`?demo=1`) for the twin meeting room (T13, local only).
 *
 * All demo logic lives here in core — not in the web app — so the whole
 * guided script can be driven end to end headlessly against a real twin
 * room with no browser, no DOM tooling, and no network. The web UI
 * (`meeting-room.tsx`) only renders the current caption and forwards the
 * "Next step" button / keyboard shortcuts to the controller below.
 *
 * Synthetic data only; the send step uses the room's test fake transport.
 */

import {
  compareImportedText,
  deriveApprovedPackage,
  serializeApprovedPackage,
  type EmailComparison,
} from "./email-compare.js";
import type { TwinRoom } from "./twin-room.js";

/**
 * True only when the URL query string carries exactly `demo=1`.
 * Accepts a bare query (`demo=1`), a leading-`?` query (`?demo=1`,
 * `?x=2&demo=1`), or a full URL; anything else — `demo=0`,
 * `demo=true`, missing, or malformed input — is false.
 */
export function isDemoMode(search: string): boolean {
  if (typeof search !== "string" || search.length === 0) return false;
  let query = search;
  const question = query.indexOf("?");
  if (question >= 0) query = query.slice(question + 1);
  const fragment = query.indexOf("#");
  if (fragment >= 0) query = query.slice(0, fragment);
  if (query.length === 0) return false;
  try {
    return new URLSearchParams(query).get("demo") === "1";
  } catch {
    return false;
  }
}

/** One ordered step of the synthetic guided script. */
export interface DemoStep {
  /** Stable step id, also used to fetch the step's stored result. */
  readonly id: string;
  /** Short caption shown in the demo caption bar. */
  readonly caption: string;
  /** Accessible label for the caption region / Next button. */
  readonly label: string;
  /** Action run against a real twin room. May be async (send). */
  run(room: TwinRoom): Promise<unknown> | unknown;
}

/** Stream every remaining scripted line for the selected meeting. */
async function streamAllLines(room: TwinRoom): Promise<number> {
  let streamed = 0;
  for (let i = 0; i < 20; i += 1) {
    const r = room.streamNextLine();
    if (!r.appended) break;
    streamed += 1;
  }
  return streamed;
}

export const DEMO_STEP_IDS = [
  "demo-join",
  "demo-guide",
  "demo-stream",
  "demo-plugin",
  "demo-approve",
  "demo-send",
  "demo-compare",
  "demo-evidence",
  "demo-takeover",
] as const;

/**
 * The ordered synthetic guided script. Owner takeover is always last: once
 * the twin is paused, streaming, plugins, approval, and sending are refused.
 */
export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: "demo-join",
    caption: "Join the Q3 launch sync with your twin.",
    label: "Demo step 1 of 9: join the Q3 launch sync meeting",
    run(room: TwinRoom): string {
      const first = room.view().meetings[0];
      if (first !== undefined) room.selectMeeting(first.id);
      return room.view().selectedMeetingTitle;
    },
  },
  {
    id: "demo-guide",
    caption: "Send owner guidance to the twin.",
    label: "Demo step 2 of 9: send owner guidance",
    run(room: TwinRoom): number {
      room.guide("No dates in the recap; Bridgett confirms timing herself.");
      return room.view().guidance.length;
    },
  },
  {
    id: "demo-stream",
    caption: "Watch the twin stream its proactive answer, steered by your guidance.",
    label: "Demo step 3 of 9: stream the twin's steered answer",
    run(room: TwinRoom): Promise<number> {
      return streamAllLines(room);
    },
  },
  {
    id: "demo-plugin",
    caption: "Include the action-items plugin output in the package.",
    label: "Demo step 4 of 9: include a plugin output",
    run(room: TwinRoom): { approved: boolean } {
      return room.approvePluginOutput("action-items");
    },
  },
  {
    id: "demo-approve",
    caption: "Approve the exact package.",
    label: "Demo step 5 of 9: approve the exact package",
    run(room: TwinRoom): { approved: boolean; body: string; sha256: string } {
      const approved = room.approve().approved;
      const v = room.view();
      return { approved, body: v.draft.body, sha256: v.draft.sha256 };
    },
  },
  {
    id: "demo-send",
    caption: "Send through the test fake transport.",
    label: "Demo step 6 of 9: send through the test fake transport",
    run(room: TwinRoom): Promise<{ ok: boolean; transportCalls: number }> {
      return room.send().then((res) => ({
        ok: res.ok,
        transportCalls: room.transportCalls(),
      }));
    },
  },
  {
    id: "demo-compare",
    caption: "Compare imported text to the approved package.",
    label: "Demo step 7 of 9: compare imported text to the approved package",
    run(room: TwinRoom): {
      readonly importedText: string;
      readonly comparison: EmailComparison;
    } {
      // A sent package is locked by design, so the room's own
      // compareImported() (current approved package only) returns null after
      // the send step. Compare headlessly instead: rebuild the approved
      // package from the exact sent body and diff the imported text against
      // it with the same pure comparison the room uses.
      const v = room.view();
      const transported = room.transportBodies();
      const approvedBody =
        transported.length > 0 && transported[0] !== undefined
          ? transported[0]
          : v.draft.body;
      const approved = deriveApprovedPackage({
        title: v.selectedMeetingTitle,
        // The stream step drains the full script, so the transcript-derived
        // recipients match the room's script-derived ones exactly.
        script: [...v.transcript],
        body: approvedBody,
      });
      const importedText = serializeApprovedPackage(approved);
      const comparison: EmailComparison = compareImportedText(
        approved,
        importedText,
      );
      return { importedText, comparison };
    },
  },
  {
    id: "demo-evidence",
    caption: "View and export the evidence record.",
    label: "Demo step 8 of 9: view and export the evidence record",
    run(room: TwinRoom): string | null {
      return room.exportEvidenceJson();
    },
  },
  {
    id: "demo-takeover",
    caption: "Take over — the twin pauses.",
    label: "Demo step 9 of 9: take over; the twin pauses",
    run(room: TwinRoom): string {
      room.takeOver();
      return room.view().twinStatus;
    },
  },
];

export interface DemoController {
  /** The ordered guided script. */
  readonly steps: readonly DemoStep[];
  /** The next step to run, or null when the script is finished. */
  current(): DemoStep | null;
  /**
   * Run the next step exactly once and advance. Never skips, never repeats;
   * a no-op returning null after the last step (the room is untouched).
   */
  next(): Promise<DemoStep | null>;
  /**
   * Advance past the next step WITHOUT running it and store
   * `{ skipped: true }` as its result (used when a step is not permitted,
   * e.g. sending on a public demo). Returns the skipped step, or null after
   * the last step. Waits behind any in-flight next() or skip() call.
   */
  skip(): Promise<DemoStep | null>;
  /**
   * Run the next step, or skip it exactly as skip() does when
   * `skipWhen(step)` is true. The check runs inside the same queue as next()
   * and skip(), so it sees the step this call really acts on. Returns the
   * step and whether it was skipped, or null after the last step or when a
   * reset() was issued after this call.
   */
  nextUnless(skipWhen: (step: DemoStep) => boolean): Promise<{ step: DemoStep; skipped: boolean } | null>;
  /**
   * Restart the script position and clear stored results (room untouched).
   * Takes effect immediately; next() and skip() calls issued before it,
   * including one whose step is still running, do not advance the script.
   */
  reset(): void;
  /** Stored return value of a completed step, or undefined. */
  result(id: string): unknown;
  /** Number of steps completed since the last reset. */
  completed(): number;
  /**
   * Keyboard shortcut mapping: Right arrow / `n` runs the next step,
   * `r` restarts; everything else is ignored. Keys typed into inputs or
   * textareas (pass true for `isTypingInInput`) are always ignored.
   */
  demoKeyAction(
    key: string,
    isTypingInInput?: boolean,
  ): Promise<DemoStep | "reset" | null>;
}

/** Small controller driving the guided script against one twin room. */
export function createDemoController(room: TwinRoom): DemoController {
  let index = 0;
  const results = new Map<string, unknown>();

  // Overlapping next() calls (a double click or two Next requests) run one at
  // a time, in call order, so each one advances exactly one step.
  // skip() waits in the same queue, and reset() bumps the generation so
  // calls issued before it do nothing.
  let pending: Promise<unknown> = Promise.resolve();
  let generation = 0;

  function queued(work: (gen: number) => DemoStep | null | Promise<DemoStep | null>): Promise<DemoStep | null> {
    const gen = generation;
    const run = pending.then(() => (gen === generation ? work(gen) : null));
    pending = run.catch(() => undefined);
    return run;
  }

  async function runNext(gen: number): Promise<DemoStep | null> {
    const step = DEMO_STEPS[index];
    if (step === undefined) return null;
    const out = await step.run(room);
    if (gen !== generation) return null; // reset() while this step ran
    results.set(step.id, out);
    index += 1;
    return step;
  }

  function next(): Promise<DemoStep | null> {
    return queued(runNext);
  }

  function skip(): Promise<DemoStep | null> {
    return queued(() => {
      const step = DEMO_STEPS[index];
      if (step === undefined) return null;
      results.set(step.id, { skipped: true });
      index += 1;
      return step;
    });
  }

  function nextUnless(
    skipWhen: (step: DemoStep) => boolean,
  ): Promise<{ step: DemoStep; skipped: boolean } | null> {
    let skipped = false;
    return queued(async (gen) => {
      const step = DEMO_STEPS[index];
      if (step === undefined) return null;
      if (skipWhen(step)) {
        results.set(step.id, { skipped: true });
        index += 1;
        skipped = true;
        return step;
      }
      return runNext(gen);
    }).then((step) => (step === null ? null : { step, skipped }));
  }

  function reset(): void {
    generation += 1;
    index = 0;
    results.clear();
  }

  async function demoKeyAction(
    key: string,
    isTypingInInput = false,
  ): Promise<DemoStep | "reset" | null> {
    if (isTypingInInput) return null;
    if (key === "ArrowRight" || key === "n") return next();
    if (key === "r") {
      reset();
      return "reset";
    }
    return null;
  }

  return {
    steps: DEMO_STEPS,
    current(): DemoStep | null {
      return DEMO_STEPS[index] ?? null;
    },
    next,
    skip,
    nextUnless,
    reset,
    result(id: string): unknown {
      return results.get(id);
    },
    completed(): number {
      return index;
    },
    demoKeyAction,
  };
}
