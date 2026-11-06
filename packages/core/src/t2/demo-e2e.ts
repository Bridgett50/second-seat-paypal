/**
 * Headless end-to-end runner for the whole `?demo=1` guided flow (T18).
 *
 * `runDemoEndToEnd` parses a `demo=1` query exactly as the web page does
 * (via `isDemoMode`, the same function `meeting-room.tsx` calls on
 * `window.location.search`), creates a real twin room (in-memory store,
 * injectable clock), runs EVERY guided step in order through the public
 * demo-mode API (`createDemoController` + `next()`, no internal
 * shortcuts), and returns a structured final state plus assertion results.
 *
 * `assertDemoFinalState` checks the documented end state and returns
 * `{ ok, failures[] }`. Synthetic data only; the send step uses the
 * room's test fake transport. Local only: no network, no real email.
 */

import { packageHash, type MeetingConnectorFactory } from "./connector-port.js";
import {
  createDemoController,
  DEMO_STEP_IDS,
  isDemoMode,
} from "./demo-mode.js";
import type { EmailComparison } from "./email-compare.js";
import type { EvidenceRecord, GuidanceEvent } from "./evidence.js";
import { createInMemoryRoomStore } from "./persistence.js";
import { SEEDED_SENSITIVE_VALUES, createTwinRoom } from "./twin-room.js";

/** One named check outcome from a headless demo run. */
export interface DemoAssertionResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Structured final state of one headless `?demo=1` run. */
export interface DemoEndToEndState {
  /** False when the query refused the guided flow (no `demo=1`). */
  readonly started: boolean;
  /** The query string the run parsed, as the web page passes it. */
  readonly search: string;
  /** Completed step ids, in completion order. */
  readonly stepsCompleted: readonly string[];
  /** Live transcript of the selected meeting after the run. */
  readonly transcript: readonly string[];
  /** Owner guidance texts recorded for the selected meeting. */
  readonly guidance: readonly string[];
  /** Transcript indexes steered by owner guidance. */
  readonly steeredLines: readonly number[];
  /** Guidance steering events merged into the evidence record. */
  readonly guidanceEvents: readonly GuidanceEvent[];
  /** Final package body (always the redacted text). */
  readonly packageBody: string;
  /** sha256 of the final package body. */
  readonly packageHash: string;
  /** Whether the package is approved at the end of the run. */
  readonly approved: boolean;
  /** Final send state (`sent` on a clean run). */
  readonly sendState: string;
  /** Transport calls made during the run (1 on a clean run). */
  readonly transportCalls: number;
  /** Bodies handed to the test fake transport. */
  readonly transportBodies: readonly string[];
  /** Imported draft text compared in the compare step. */
  readonly importedText: string;
  /** Field-by-field comparison from the compare step (null if refused). */
  readonly comparison: EmailComparison | null;
  /** Whether the comparison found the drafts identical. */
  readonly identical: boolean;
  /** Twin status after the run (`paused (you took over)` on a clean run). */
  readonly twinStatus: string;
  /** Evidence record for the selected meeting (null when never approved). */
  readonly evidence: EvidenceRecord | null;
  /** Exported evidence JSON (null when there is no record). */
  readonly evidenceJson: string | null;
  /** Per-check outcomes for this run (failures carry the reason). */
  readonly assertions: readonly DemoAssertionResult[];
}

function refusedState(search: string, detail: string): DemoEndToEndState {
  return {
    started: false,
    search,
    stepsCompleted: [],
    transcript: [],
    guidance: [],
    steeredLines: [],
    guidanceEvents: [],
    packageBody: "",
    packageHash: "",
    approved: false,
    sendState: "unsent",
    transportCalls: 0,
    transportBodies: [],
    importedText: "",
    comparison: null,
    identical: false,
    twinStatus: "active",
    evidence: null,
    evidenceJson: null,
    assertions: [{ id: "demo-mode-required", ok: false, detail }],
  };
}

/**
 * Run the whole guided demo headlessly. Defaults to `?demo=1`, exactly the
 * query the web page enables on. A query without `demo=1` refuses to start
 * the guided flow and returns `started: false` without touching a room.
 */
export type DemoEndToEndOptions = {
  readonly connector: MeetingConnectorFactory;
  readonly search?: string;
  readonly now?: () => number;
};

export async function runDemoEndToEnd(opts: DemoEndToEndOptions): Promise<DemoEndToEndState> {
  const search = opts?.search ?? "?demo=1";
  if (!isDemoMode(search)) {
    return refusedState(
      search,
      `Guided flow refused: query ${JSON.stringify(search)} does not carry demo=1.`,
    );
  }

  // Deterministic synthetic clock by default; injectable for tests.
  let tick = 1_700_000_000_000;
  const now = opts?.now ?? ((): number => (tick += 1000));

  const room = createTwinRoom({
    connector: opts.connector,
    testMode: true,
    transport: async () => {},
    store: createInMemoryRoomStore(),
    now,
  });
  const demo = createDemoController(room);

  // Every guided step in order through the public demo-mode API.
  const stepsCompleted: string[] = [];
  let step = await demo.next();
  while (step !== null) {
    stepsCompleted.push(step.id);
    step = await demo.next();
  }

  const compare = demo.result("demo-compare") as {
    readonly importedText: string;
    readonly comparison: EmailComparison;
  } | null;

  const v = room.view();
  const evidence = room.evidenceRecord();
  const partial: DemoEndToEndState = {
    started: true,
    search,
    stepsCompleted,
    transcript: [...v.transcript],
    guidance: [...v.guidance],
    steeredLines: [...v.steeredLines],
    guidanceEvents: [...(evidence?.guidanceEvents ?? [])],
    packageBody: v.draft.body,
    packageHash: v.draft.sha256,
    approved: v.draft.approved,
    sendState: v.draft.sendState,
    transportCalls: room.transportCalls(),
    transportBodies: [...room.transportBodies()],
    importedText: compare?.importedText ?? "",
    comparison: compare?.comparison ?? null,
    identical: compare?.comparison.identical ?? false,
    twinStatus: v.twinStatus,
    evidence,
    evidenceJson: room.exportEvidenceJson(),
    assertions: [],
  };
  const check = assertDemoFinalState(partial);
  const assertions: DemoAssertionResult[] =
    check.failures.length === 0
      ? [
          {
            id: "demo-end-to-end",
            ok: true,
            detail: `All ${stepsCompleted.length} guided steps completed once in order; package approved, sent once, evidence exported, twin paused.`,
          },
        ]
      : check.failures.map((detail, i) => ({
          id: `demo-final-state-${i + 1}`,
          ok: false,
          detail,
        }));
  return { ...partial, assertions };
}

/**
 * Check the documented end state of a headless demo run:
 * every step done once in order with takeover last, package approved
 * before send, final send state, evidence present with the takeover
 * recorded, no un-redacted sensitive value in transcript/package/
 * evidence, and a consistent compare result.
 */
export function assertDemoFinalState(state: DemoEndToEndState): {
  ok: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const expected = [...DEMO_STEP_IDS];

  if (!state.started) {
    failures.push("The demo flow never started (the query refused demo mode).");
  }
  const inOrder =
    state.stepsCompleted.length === expected.length &&
    expected.every((id, i) => state.stepsCompleted[i] === id);
  if (!inOrder) {
    failures.push(
      `Steps completed [${state.stepsCompleted.join(", ")}] are not every guided step exactly once in order [${expected.join(", ")}].`,
    );
  }
  if (new Set(state.stepsCompleted).size !== state.stepsCompleted.length) {
    failures.push("A guided demo step was completed more than once.");
  }
  if (
    state.stepsCompleted.length > 0 &&
    state.stepsCompleted[state.stepsCompleted.length - 1] !== "demo-takeover"
  ) {
    failures.push("Owner takeover is not the last completed step.");
  }

  if (!state.approved) {
    failures.push("The package was not approved (approval must precede send).");
  }
  if (state.sendState !== "sent") {
    failures.push(
      `The send state is ${JSON.stringify(state.sendState)}, not the final "sent".`,
    );
  }
  if (state.transportCalls !== 1) {
    failures.push(
      `The test fake transport ran ${state.transportCalls} time(s), expected exactly once.`,
    );
  }
  if (
    state.transportBodies.length !== 1 ||
    state.transportBodies[0] !== state.packageBody
  ) {
    failures.push("The transported body is not exactly the final package body.");
  }

  // The guided demo sends guidance before streaming, so at least one twin
  // line is steered and the evidence record carries the steering event.
  if (state.steeredLines.length === 0 || state.guidanceEvents.length === 0) {
    failures.push(
      "The demo steered no twin line: guidance must steer at least one streamed line.",
    );
  } else {
    for (const event of state.guidanceEvents) {
      const line = state.transcript[event.steeredLineIndex];
      if (
        event.steeredLineIndex < 0 ||
        event.steeredLineIndex >= state.transcript.length ||
        typeof line !== "string" ||
        !line.startsWith("Twin:")
      ) {
        failures.push(
          `A guidance steering event points at transcript index ${event.steeredLineIndex}, which is not a steered Twin: line.`,
        );
        break;
      }
    }
  }
  if (
    state.packageBody.length > 0 &&
    state.packageHash !== packageHash(state.packageBody)
  ) {
    failures.push("The package hash does not equal packageHash(packageBody).");
  }

  if (state.evidence === null || state.evidenceJson === null) {
    failures.push("The evidence record is missing (approve, then export).");
  } else {
    const record = state.evidence;
    if (record.packageHash !== state.packageHash) {
      failures.push("The evidence record pins a different package hash.");
    }
    if (record.sendState !== "sent" || record.sentAt === null) {
      failures.push("The evidence record does not show the completed send.");
    }
    if (!(record.approvedAt <= (record.sentAt ?? Number.NaN))) {
      failures.push("The evidence record does not show approval before send.");
    }
    if (record.takeoverEvents.length === 0) {
      failures.push("The evidence record carries no takeover event.");
    } else {
      const latestGuidance = Math.max(
        0,
        ...record.guidanceEvents.map((e) => e.at),
      );
      const earliestTakeover = Math.min(
        ...record.takeoverEvents.map((e) => e.at),
      );
      if (!(earliestTakeover >= latestGuidance)) {
        failures.push("The takeover event is not last in the evidence record.");
      }
    }
    if (!state.evidenceJson.includes(state.packageHash)) {
      failures.push("The exported evidence JSON does not carry the package hash.");
    }
  }

  const haystacks: ReadonlyArray<readonly [string, string]> = [
    ["transcript", state.transcript.join("\n")],
    ["package body", state.packageBody],
    ["evidence JSON", state.evidenceJson ?? ""],
  ];
  for (const [where, text] of haystacks) {
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      if (secret.length > 0 && text.includes(secret)) {
        failures.push(
          `An un-redacted synthetic sensitive value reached the ${where}.`,
        );
        break;
      }
    }
  }

  if (state.comparison === null) {
    failures.push("The compare step produced no comparison result.");
  } else {
    const c = state.comparison;
    if (!c.identical || c.flags.length !== 0) {
      failures.push(
        `The compare result is not clean for the round-tripped approved package (flags: ${c.flags.join(", ")}).`,
      );
    }
    if (c.identical !== state.identical) {
      failures.push("The identical flag disagrees with the comparison result.");
    }
    if (c.body.added.length !== 0 || c.body.removed.length !== 0) {
      failures.push("The compare body diff is not empty for identical drafts.");
    }
  }

  if (state.twinStatus !== "paused (you took over)") {
    failures.push(
      `The twin is ${JSON.stringify(state.twinStatus)}, not paused by the final takeover.`,
    );
  }

  return { ok: failures.length === 0, failures };
}
