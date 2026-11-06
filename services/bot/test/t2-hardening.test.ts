import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import * as t2index from "../src/t2-room.js";
import { createInMemoryRoomStore } from "../src/t2-room.js";
import { assertDemoFinalState, runDemoEndToEnd, type DemoEndToEndState } from "../src/t2-room.js";
import {
  REAPPROVE_AFTER_RELOAD_NOTE,
  SEEDED_SENSITIVE_VALUES,
  TAKEOVER_REFUSAL,
  createTwinRoom,
} from "../src/t2-room.js";

/**
 * T19 hardening review (local only, made-up data).
 *
 * Each test below fails on the pre-hardening tree for a real bug and passes
 * with the fix. See the "T19 hardening review" section in docs/t2-ui.md.
 */

function makeRoom(opts?: {
  store?: ReturnType<typeof createInMemoryRoomStore>;
  testMode?: boolean;
  transport?: (body: string, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}) {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: opts?.testMode ?? true,
    transport:
      opts?.transport ??
      (async (body: string) => {
        sent.push(body);
      }),
    ...(opts?.store ? { store: opts.store } : {}),
    ...(opts?.now ? { now: opts.now } : {}),
  });
  return { room, sent };
}

function streamAll(room: ReturnType<typeof createTwinRoom>): number {
  let streamed = 0;
  for (let i = 0; i < 20; i += 1) {
    if (!room.streamNextLine().appended) break;
    streamed += 1;
  }
  return streamed;
}

/** Connector-side transcript for the selected meeting, if the room exposes it. */
function connectorLinesOf(
  room: ReturnType<typeof createTwinRoom>,
): string[] | undefined {
  const accessor = (
    room as unknown as { connectorTranscript?: () => readonly string[] }
  ).connectorTranscript;
  if (typeof accessor !== "function") return undefined;
  return [...accessor.call(room)];
}

describe("t2 hardening review", () => {
  it("T19-1 the room transcript and the connector transcript agree after guidance steering", () => {
    const { room } = makeRoom();
    room.guide("No dates here — Bridgett confirms timing herself.");
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.streamNextLine().appended).toBe(true);

    // The room shows the steered twin answer, and marks it steered.
    const transcript = room.view().transcript;
    expect(transcript[1]).toContain("a date Bridgett will confirm");
    expect(transcript[1]).not.toContain("March");
    expect(room.view().steeredLines).toEqual([1]);

    // The connector-side log is the same record: no unsteered twin line
    // may survive on the connector while the room shows the steered one.
    const connectorLines = connectorLinesOf(room);
    expect(connectorLines).toBeDefined();
    expect(connectorLines).toEqual([...transcript]);
    expect((connectorLines ?? []).join("\n")).not.toContain("March");
  });

  it("T19-2 every refusal path returns a reason from an exported constant", async () => {
    const collected: Array<{ label: string; reason: unknown }> = [];

    // Stream refusals.
    {
      const { room } = makeRoom();
      expect(room.streamNextLine().appended).toBe(true);
      room.takeOver();
      collected.push({
        label: "stream after takeover",
        reason: room.streamNextLine().reason,
      });
      collected.push({
        label: "stale line after takeover",
        reason: room.staleLineAttempt().reason,
      });
    }
    {
      const { room } = makeRoom();
      streamAll(room);
      collected.push({
        label: "stream past the end of the script",
        reason: room.streamNextLine().reason,
      });
      collected.push({
        label: "stale line on a live room",
        reason: room.staleLineAttempt().reason,
      });
    }

    // Guidance refusals.
    {
      const { room } = makeRoom();
      room.takeOver();
      collected.push({
        label: "guide after takeover",
        reason: room.guide("Keep it short").reason,
      });
    }
    {
      const { room } = makeRoom();
      collected.push({
        label: "guide with empty text",
        reason: room.guide("   ").reason,
      });
    }

    // Send refusals.
    {
      const { room } = makeRoom({ testMode: false });
      collected.push({
        label: "send outside test mode",
        reason: (await room.send()).reason,
      });
    }
    {
      const { room } = makeRoom();
      collected.push({
        label: "send without approval",
        reason: (await room.send()).reason,
      });
      expect(room.approve().approved).toBe(true);
      room.editDraft(`${room.view().draft.body}\nEdited after approval.`);
      collected.push({
        label: "send after an edit",
        reason: (await room.send()).reason,
      });
    }
    {
      const { room } = makeRoom();
      expect(room.approve().approved).toBe(true);
      room.takeOver();
      collected.push({
        label: "send after takeover",
        reason: (await room.send()).reason,
      });
    }
    {
      const { room } = makeRoom();
      expect(room.approve().approved).toBe(true);
      expect((await room.send()).ok).toBe(true);
      collected.push({
        label: "second send after a successful send",
        reason: (await room.send()).reason,
      });
    }
    {
      const room = createTwinRoom({
        testMode: true,
        transport: async () => {
          throw new Error("fake transport down");
        },
      });
      expect(room.approve().approved).toBe(true);
      collected.push({
        label: "send with a failing transport",
        reason: (await room.send()).reason,
      });
      collected.push({
        label: "send retry after a failed send",
        reason: (await room.send()).reason,
      });
    }
    {
      const store = createInMemoryRoomStore();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const room1 = createTwinRoom({
        testMode: true,
        transport: async () => {
          await gate;
        },
        store,
      });
      expect(room1.approve().approved).toBe(true);
      const crashed = room1.send();
      await new Promise((r) => setTimeout(r, 0));
      const room2 = createTwinRoom({
        testMode: true,
        transport: async () => {},
        store,
      });
      collected.push({
        label: "send while a previous attempt is unconfirmed",
        reason: (await room2.send()).reason,
      });
      release();
      await crashed;
    }

    // Takeover-stream refusals keep using the long-standing constant.
    expect(TAKEOVER_REFUSAL).toContain("refused");

    const exportedStrings = new Set<string>(
      (Object.values(t2index) as unknown[]).filter(
        (value: unknown): value is string => typeof value === "string",
      ),
    );
    expect(collected.length).toBeGreaterThan(10);
    for (const { label, reason } of collected) {
      expect(typeof reason, label).toBe("string");
      expect((reason as string).length > 0, label).toBe(true);
      // One consistent wording style for every refusal.
      expect(reason as string, label).toMatch(/refus/i);
      // One exported constant per reason: no inline literal may surface.
      expect(exportedStrings.has(reason as string), label).toBe(true);
    }
  });

  it("T19-3 refusal messages never contain sensitive values or internal meeting ids", async () => {
    const store = createInMemoryRoomStore();
    const { room } = makeRoom({ store });
    // Record guidance carrying every seeded sensitive value, then steer.
    room.guide("cc sam@example.test about $12,000, call 555-0142");
    expect(room.streamNextLine().appended).toBe(true);
    expect(room.streamNextLine().appended).toBe(true);

    const reasons: Array<{ label: string; reason: unknown }> = [];
    room.takeOver();
    reasons.push({
      label: "stream after takeover",
      reason: room.streamNextLine().reason,
    });
    reasons.push({
      label: "stale line after takeover",
      reason: room.staleLineAttempt().reason,
    });
    reasons.push({
      label: "guide after takeover",
      reason: room.guide("another secret 555-0142").reason,
    });
    reasons.push({
      label: "send after takeover",
      reason: (await room.send()).reason,
    });
    reasons.push({ label: "stored room refusal", reason: room.view().refusal });

    const failing = createTwinRoom({
      testMode: true,
      transport: async () => {
        throw new Error("fake transport down");
      },
    });
    expect(failing.approve().approved).toBe(true);
    reasons.push({
      label: "send with a failing transport",
      reason: (await failing.send()).reason,
    });

    const meetingIds = room.view().meetings.map((m) => m.id);
    const packageHashNow = room.view().draft.sha256;
    expect(reasons.length).toBeGreaterThan(3);
    for (const { label, reason } of reasons) {
      // A missing message cannot be audited for leaks: every refusal path
      // must produce a real string first.
      expect(typeof reason, label).toBe("string");
      const text = reason as string;
      for (const secret of SEEDED_SENSITIVE_VALUES) {
        expect(text, `${label} leaks a sensitive value`).not.toContain(secret);
      }
      for (const id of meetingIds) {
        expect(text, `${label} leaks an internal meeting id`).not.toContain(id);
      }
      expect(text, `${label} leaks the package hash`).not.toContain(
        packageHashNow,
      );
      expect(text, `${label} leaks a random internal id`).not.toMatch(
        /\bid-[0-9a-z-]+\b/i,
      );
      expect(text, `${label} leaks a hex hash`).not.toMatch(/[0-9a-f]{64}/);
    }
  });

  it("T19-5 the view never reports an impossible combination of approval, send, takeover and stale state", async () => {
    function checkInvariants(
      room: ReturnType<typeof createTwinRoom>,
      label: string,
      approvedBeforeReload = false,
    ): void {
      const v = room.view();
      // The three export routes always agree with each other.
      expect(v.exportInventory.copy, label).toBe(v.exportInventory.mailto);
      expect(v.exportInventory.copy, label).toBe(v.exportInventory.file);
      // ...and with the accessors, which must never throw.
      let copy: string | null = null;
      let mailto: string | null = null;
      let file: { filename: string; text: string } | null = null;
      expect(() => {
        copy = room.copyText();
      }, `${label}: copyText threw`).not.toThrow();
      expect(() => {
        mailto = room.mailtoHref();
      }, `${label}: mailtoHref threw`).not.toThrow();
      expect(() => {
        file = room.exportFile();
      }, `${label}: exportFile threw`).not.toThrow();
      expect(copy !== null, label).toBe(v.exportInventory.copy);
      expect(mailto !== null, label).toBe(v.exportInventory.mailto);
      expect(file !== null, label).toBe(v.exportInventory.file);
      // The shown hash always covers the shown body.
      expect(v.draft.sha256, label).toBe(packageHash(v.draft.body));
      // Nothing exits once the send state leaves unsent.
      if (v.draft.sendState !== "unsent") {
        expect(v.exportInventory, label).toEqual({
          copy: false,
          mailto: false,
          file: false,
        });
      }
      // Approval is never restored on reload (R-3): a reloaded slot that was
      // approved before the reload is unapproved until re-approved.
      if (approvedBeforeReload) {
        expect(v.draft.approved, label).toBe(false);
        expect(room.approvalNote(), label).toBe(REAPPROVE_AFTER_RELOAD_NOTE);
      }
      // A stale snapshot is always an included one.
      for (const p of v.plugins) {
        if (p.stale) expect(p.status, `${label}: stale ${p.id}`).toBe("approved");
        if (p.status !== "approved") {
          expect(p.stale, `${label}: never-included ${p.id}`).toBe(false);
        }
      }
      // Steered lines always point at real transcript lines.
      for (const index of v.steeredLines) {
        expect(index, label).toBeLessThan(v.transcript.length);
      }
    }

    // Fresh room.
    {
      const { room } = makeRoom();
      checkInvariants(room, "fresh room");
    }
    // Approved, then sent (locked).
    {
      const { room } = makeRoom();
      expect(room.approve().approved).toBe(true);
      checkInvariants(room, "approved");
      expect((await room.send()).ok).toBe(true);
      checkInvariants(room, "sent and locked");
    }
    // Failed send: terminal, and the export routes still agree.
    {
      const room = createTwinRoom({
        testMode: true,
        transport: async () => {
          throw new Error("fake transport down");
        },
      });
      expect(room.approve().approved).toBe(true);
      expect((await room.send()).ok).toBe(false);
      checkInvariants(room, "failed send");
    }
    // Takeover after approval.
    {
      const { room } = makeRoom();
      expect(room.approve().approved).toBe(true);
      room.takeOver();
      checkInvariants(room, "takeover after approval");
    }
    // Takeover before approval.
    {
      const { room } = makeRoom();
      expect(room.streamNextLine().appended).toBe(true);
      room.takeOver();
      checkInvariants(room, "takeover before approval");
    }
    // Stale plugin snapshot next to a live approval.
    {
      const { room } = makeRoom();
      expect(room.streamNextLine().appended).toBe(true);
      expect(room.approvePluginOutput("action-items").approved).toBe(true);
      expect(room.approve().approved).toBe(true);
      streamAll(room);
      expect(
        room.view().plugins.find((p) => p.id === "action-items")?.stale,
      ).toBe(true);
      checkInvariants(room, "stale snapshot with approval");
    }
    // Reload with a pending intent: unconfirmed, approved, unexportable.
    {
      const store = createInMemoryRoomStore();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const room1 = createTwinRoom({
        testMode: true,
        transport: async () => {
          await gate;
        },
        store,
      });
      expect(room1.approve().approved).toBe(true);
      const crashed = room1.send();
      await new Promise((r) => setTimeout(r, 0));
      const room2 = createTwinRoom({
        testMode: true,
        transport: async () => {},
        store,
      });
      expect(room2.view().draft.sendState).toBe("unconfirmed");
      checkInvariants(room2, "unconfirmed after reload", true);
      release();
      await crashed;
    }
  });

  it("T19-4 a reloaded room reports the same view as the live room for the same history", () => {
    const store = createInMemoryRoomStore();
    const clock = { now: 1700000000000 };
    const room1 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      store,
      now: () => clock.now,
    });
    room1.guide("No dates here — Bridgett confirms timing herself.");
    expect(room1.streamNextLine().appended).toBe(true);
    expect(room1.streamNextLine().appended).toBe(true);
    expect(room1.approvePluginOutput("action-items").approved).toBe(true);
    expect(room1.approve().approved).toBe(true);
    expect(room1.view().transcript.length).toBe(2);
    expect(room1.view().steeredLines).toEqual([1]);

    // Reload: drop room1, build room2 on the same store.
    const room2 = createTwinRoom({
      testMode: true,
      transport: async () => {},
      store,
      now: () => clock.now,
    });
    expect(room2.restoredFromStore()).toBe(true);
    const title = room1.view().selectedMeetingTitle;
    const same = room2.view().meetings.find((m) => m.title === title);
    expect(same).toBeDefined();
    if (same === undefined) throw new Error("expected the reloaded meeting");
    room2.selectMeeting(same.id);
    // Approval is never restored: re-approve so both rooms share the history.
    expect(room2.approve().approved).toBe(true);

    // Connector meeting ids are per-room random values: normalize them
    // (and only them) before comparing the two views.
    function normalize(value: unknown): unknown {
      if (typeof value !== "string") return value;
      let out = value;
      for (const m of room1.view().meetings)
        out = out.split(m.id).join(`<id:${m.title}>`);
      for (const m of room2.view().meetings)
        out = out.split(m.id).join(`<id:${m.title}>`);
      return out;
    }
    function scrub(value: unknown): unknown {
      if (typeof value === "string") return normalize(value);
      if (Array.isArray(value)) return value.map(scrub);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [
            k,
            scrub(v),
          ]),
        );
      }
      return value;
    }

    expect(scrub(room2.view())).toEqual(scrub(room1.view()));
    expect(scrub(room2.evidenceRecord())).toEqual(
      scrub(room1.evidenceRecord()),
    );
    expect(scrub(room2.exportEvidenceJson())).toEqual(
      scrub(room1.exportEvidenceJson()),
    );
    expect(scrub(room2.sendIntent())).toEqual(scrub(room1.sendIntent()));
  });

  it("T19-6 removed dead exports are no longer exported from the t2 index", () => {
    const surface = t2index as unknown as Record<string, unknown>;
    // `runAllPlugins` was dead: the room runs its injected plugins through
    // its own meeting-scoped path and neither the web app nor any test ever
    // imported it.
    expect("runAllPlugins" in surface).toBe(false);
    // The kept surface is still intact (guards against over-deletion).
    for (const name of [
      "createTwinRoom",
      "createDemoController",
      "isDemoMode",
      "runDemoEndToEnd",
      "assertDemoFinalState",
      "compareImportedText",
      "deriveApprovedPackage",
      "NO_APPROVED_PACKAGE_MESSAGE",
      "redactPackageText",
      "createInMemoryRoomStore",
      "TAKEOVER_REFUSAL",
      "STALE_LINE_REFUSAL",
      "SEND_ALREADY_RESOLVED_REASON",
    ]) {
      expect(name in surface, name).toBe(true);
    }
  });

  it("T19-7 assertDemoFinalState reports a failure when a seeded sensitive value leaks into transcript, package or evidence", async () => {
    const clean = await runDemoEndToEnd({ search: "?demo=1" });
    expect(assertDemoFinalState(clean).ok).toBe(true);
    const secret = SEEDED_SENSITIVE_VALUES[0];
    expect(secret?.length).toBeGreaterThan(0);

    const leakedTranscript: DemoEndToEndState = {
      ...clean,
      transcript: [...clean.transcript, `leaked contact ${secret}`],
    };
    const transcriptCheck = assertDemoFinalState(leakedTranscript);
    expect(transcriptCheck.ok).toBe(false);
    expect(
      transcriptCheck.failures.some((f) => f.includes("transcript")),
      transcriptCheck.failures.join(" | "),
    ).toBe(true);

    const leakedBody = `${clean.packageBody}\nleaked contact ${secret}\n`;
    const leakedPackage: DemoEndToEndState = {
      ...clean,
      packageBody: leakedBody,
      packageHash: packageHash(leakedBody),
      transportBodies: [leakedBody],
    };
    const packageCheck = assertDemoFinalState(leakedPackage);
    expect(packageCheck.ok).toBe(false);
    expect(
      packageCheck.failures.some((f) => f.includes("package body")),
      packageCheck.failures.join(" | "),
    ).toBe(true);

    const leakedEvidence: DemoEndToEndState = {
      ...clean,
      evidenceJson: `${clean.evidenceJson ?? ""}\nleaked contact ${secret}\n`,
    };
    const evidenceCheck = assertDemoFinalState(leakedEvidence);
    expect(evidenceCheck.ok).toBe(false);
    expect(
      evidenceCheck.failures.some((f) => f.includes("evidence JSON")),
      evidenceCheck.failures.join(" | "),
    ).toBe(true);
  });

  it("T19-8 assertDemoFinalState reports a failure when the transport is called zero or two times, and the demo steers a twin line", async () => {
    const clean = await runDemoEndToEnd({ search: "?demo=1" });
    expect(assertDemoFinalState(clean).ok).toBe(true);

    // The guided demo steers at least one twin line: guidance first, then
    // the stream, so the transcript carries a steered mark and the evidence
    // record carries the steering event.
    expect(clean.steeredLines.length).toBeGreaterThan(0);
    expect(clean.guidanceEvents.length).toBeGreaterThan(0);
    for (const event of clean.guidanceEvents) {
      expect(event.steeredLineIndex).toBeGreaterThanOrEqual(0);
      expect(event.steeredLineIndex).toBeLessThan(clean.transcript.length);
      expect(clean.transcript[event.steeredLineIndex]?.startsWith("Twin:")).toBe(
        true,
      );
    }
    const unsteered: DemoEndToEndState = {
      ...clean,
      steeredLines: [],
      guidanceEvents: [],
    };
    const unsteeredCheck = assertDemoFinalState(unsteered);
    expect(unsteeredCheck.ok).toBe(false);
    expect(
      unsteeredCheck.failures.some((f) => /steer/i.test(f)),
      unsteeredCheck.failures.join(" | "),
    ).toBe(true);

    const neverSent: DemoEndToEndState = {
      ...clean,
      transportCalls: 0,
      transportBodies: [],
    };
    const neverCheck = assertDemoFinalState(neverSent);
    expect(neverCheck.ok).toBe(false);
    expect(
      neverCheck.failures.some((f) => f.includes("transport")),
      neverCheck.failures.join(" | "),
    ).toBe(true);

    const sentTwice: DemoEndToEndState = {
      ...clean,
      transportCalls: 2,
      transportBodies: [clean.packageBody, clean.packageBody],
    };
    const twiceCheck = assertDemoFinalState(sentTwice);
    expect(twiceCheck.ok).toBe(false);
    expect(
      twiceCheck.failures.some((f) => f.includes("transport")),
      twiceCheck.failures.join(" | "),
    ).toBe(true);
  });

});
