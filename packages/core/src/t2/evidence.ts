/**
 * Local evidence record for approved/sent packages (T9, local only).
 *
 * When the owner approves a package in the twin meeting room, an
 * `EvidenceRecord` is saved: which meeting, the approved package hash, when
 * it was approved/sent, who approved it, what was redacted (categories,
 * counts, placeholders, positions -- never plaintext), and owner takeover
 * events. There is no backend; the in-memory store below is the whole
 * persistence layer (the web UI may wrap it with `localStorage`).
 */

import type { CategoryRedactions } from "./redaction.js";

export type EvidenceSendState = "unsent" | "sent" | "failed" | "cancelled";

export type TakeoverEventKind = "takeover";

export interface TakeoverEvent {
  /** Milliseconds since the Unix epoch, from the injected clock. */
  readonly at: number;
  readonly kind: TakeoverEventKind;
}

export interface GuidanceEvent {
  /** Milliseconds since the Unix epoch, from the injected clock. */
  readonly at: number;
  /**
   * The guidance text that steered the twin answer, REDACTED with the
   * package redactor (never the plaintext). The record is per-meeting, so
   * the meeting is the record's own meeting.
   */
  readonly redactedGuidance: string;
  /** Index into the meeting's transcript of the twin line this guidance steered. */
  readonly steeredLineIndex: number;
}

export interface EvidenceRedaction {
  readonly category: string;
  readonly count: number;
  readonly placeholders: readonly string[];
  /** Start offsets of each placeholder in the approved (redacted) package. */
  readonly positions: readonly number[];
}

export interface EvidenceRecord {
  readonly meetingId: string;
  readonly meetingTitle: string;
  readonly packageHash: string;
  readonly approvedAt: number;
  /** Null until the package is sent. */
  readonly sentAt: number | null;
  readonly sendState: EvidenceSendState;
  /** Owner id that approved the package. */
  readonly approvalPrincipal: string;
  readonly redactions: readonly EvidenceRedaction[];
  readonly takeoverEvents: readonly TakeoverEvent[];
  readonly guidanceEvents: readonly GuidanceEvent[];
}

function copyRedactions(
  redactions: readonly CategoryRedactions[],
): EvidenceRedaction[] {
  return [...redactions]
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((r) => ({
      category: r.category,
      count: r.count,
      placeholders: [...r.placeholders],
      positions: [...r.positions],
    }));
}

function copyRecord(record: EvidenceRecord): EvidenceRecord {
  return {
    ...record,
    redactions: record.redactions.map((r) => ({
      ...r,
      placeholders: [...r.placeholders],
      positions: [...r.positions],
    })),
    takeoverEvents: record.takeoverEvents.map((e) => ({ ...e })),
    guidanceEvents: record.guidanceEvents.map((e) => ({ ...e })),
  };
}

/** Stable, pretty JSON export of a record (fixed key order, 2-space indent). */
export function exportEvidenceJson(record: EvidenceRecord): string {
  const ordered = {
    meetingId: record.meetingId,
    meetingTitle: record.meetingTitle,
    packageHash: record.packageHash,
    approvedAt: record.approvedAt,
    sentAt: record.sentAt,
    sendState: record.sendState,
    approvalPrincipal: record.approvalPrincipal,
    redactions: record.redactions.map((r) => ({
      category: r.category,
      count: r.count,
      placeholders: [...r.placeholders],
      positions: [...r.positions],
    })),
    takeoverEvents: record.takeoverEvents.map((e) => ({ at: e.at, kind: e.kind })),
    guidanceEvents: record.guidanceEvents.map((e) => ({
      at: e.at,
      redactedGuidance: e.redactedGuidance,
      steeredLineIndex: e.steeredLineIndex,
    })),
  };
  return JSON.stringify(ordered, null, 2);
}

export interface EvidenceStore {
  get(meetingId: string): EvidenceRecord | null;
  /**
   * Restore a previously exported record as-is (used to rehydrate the
   * store from durable persistence after a reload, preserving `approvedAt`
   * / `sentAt`). Returns a copy of the restored record, or null when the
   * input is malformed.
   */
  restore(record: EvidenceRecord): EvidenceRecord | null;
  saveApproved(input: {
    readonly meetingId: string;
    readonly meetingTitle: string;
    readonly packageHash: string;
    readonly approvalPrincipal: string;
    readonly redactions: readonly CategoryRedactions[];
  }): EvidenceRecord;
  markSent(meetingId: string, sendState: EvidenceSendState): EvidenceRecord | null;
  logTakeover(meetingId: string): TakeoverEvent;
  /**
   * Log one consumed guidance steering for `meetingId`: the room-clock
   * timestamp, the REDACTED guidance text, and which transcript line it
   * steered. Like takeovers, events logged before any approval wait in a
   * pending queue and merge into the record when that meeting is approved;
   * events logged after approval join the record immediately too.
   */
  logGuidance(
    meetingId: string,
    input: { redactedGuidance: string; steeredLineIndex: number },
  ): GuidanceEvent;
  /**
   * Rehydrate durable pre-approval guidance events after a reload. Events
   * already in the saved record or already pending are skipped, so repeated
   * reloads log each steering exactly once.
   */
  importGuidances(meetingId: string, events: readonly GuidanceEvent[]): void;
  /**
   * Rehydrate durable pre-approval takeover events after a reload: they
   * join the pending queue for `meetingId` (in order, without duplicates)
   * so a later `saveApproved` merges them into the evidence record. Saved
   * records are never touched here, so repeated reloads cannot duplicate
   * events that are already in a restored record.
   */
  importTakeovers(meetingId: string, events: readonly TakeoverEvent[]): void;
  clear(): void;
}

function isGuidanceEvent(value: unknown): value is GuidanceEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["at"] === "number" &&
    typeof (value as Record<string, unknown>)["redactedGuidance"] === "string" &&
    typeof (value as Record<string, unknown>)["steeredLineIndex"] === "number"
  );
}

function sameGuidanceEvent(a: GuidanceEvent, b: GuidanceEvent): boolean {
  return (
    a.at === b.at &&
    a.redactedGuidance === b.redactedGuidance &&
    a.steeredLineIndex === b.steeredLineIndex
  );
}

/**
 * In-memory evidence store. `now` is injectable so tests are deterministic;
 * it defaults to `Date.now()`.
 */
export function createInMemoryEvidenceStore(opts?: {
  now?: () => number;
}): EvidenceStore {
  const now = opts?.now ?? (() => Date.now());
  const records = new Map<string, EvidenceRecord>();
  const pendingTakeovers = new Map<string, TakeoverEvent[]>();
  const pendingGuidances = new Map<string, GuidanceEvent[]>();

  return {
    get(meetingId: string): EvidenceRecord | null {
      const found = records.get(meetingId);
      return found ? copyRecord(found) : null;
    },

    restore(record: EvidenceRecord): EvidenceRecord | null {
      if (
        !record ||
        typeof record.meetingId !== "string" ||
        typeof record.meetingTitle !== "string" ||
        typeof record.packageHash !== "string" ||
        typeof record.approvalPrincipal !== "string" ||
        typeof record.approvedAt !== "number" ||
        (record.sentAt !== null && typeof record.sentAt !== "number") ||
        (record.sendState !== "unsent" &&
          record.sendState !== "sent" &&
          record.sendState !== "failed" &&
          record.sendState !== "cancelled") ||
        !Array.isArray(record.redactions) ||
        !Array.isArray(record.takeoverEvents)
      ) {
        return null;
      }
      // Records written before owner guidance existed carry no guidance
      // events; they load as empty rather than failing closed.
      const guidanceEvents =
        (record as { guidanceEvents?: unknown }).guidanceEvents ?? [];
      if (!Array.isArray(guidanceEvents) || !guidanceEvents.every(isGuidanceEvent)) {
        return null;
      }
      const copy = copyRecord({ ...record, guidanceEvents: [...guidanceEvents] });
      records.set(copy.meetingId, copy);
      return copyRecord(copy);
    },

    saveApproved(input): EvidenceRecord {
      const record: EvidenceRecord = {
        meetingId: input.meetingId,
        meetingTitle: input.meetingTitle,
        packageHash: input.packageHash,
        approvedAt: now(),
        sentAt: null,
        sendState: "unsent",
        approvalPrincipal: input.approvalPrincipal,
        redactions: copyRedactions(input.redactions),
        takeoverEvents: [...(pendingTakeovers.get(input.meetingId) ?? [])],
        guidanceEvents: [...(pendingGuidances.get(input.meetingId) ?? [])],
      };
      records.set(input.meetingId, record);
      return copyRecord(record);
    },

    markSent(meetingId: string, sendState: EvidenceSendState): EvidenceRecord | null {
      const found = records.get(meetingId);
      if (!found) return null;
      const updated: EvidenceRecord = {
        ...copyRecord(found),
        sentAt: sendState === "sent" ? now() : null,
        sendState,
      };
      records.set(meetingId, updated);
      return copyRecord(updated);
    },

    logTakeover(meetingId: string): TakeoverEvent {
      const event: TakeoverEvent = { at: now(), kind: "takeover" };
      const pending = pendingTakeovers.get(meetingId) ?? [];
      pending.push(event);
      pendingTakeovers.set(meetingId, pending);
      const found = records.get(meetingId);
      if (found) {
        records.set(meetingId, {
          ...copyRecord(found),
          takeoverEvents: [...found.takeoverEvents, { ...event }],
        });
      }
      return { ...event };
    },

    importTakeovers(meetingId: string, events: readonly TakeoverEvent[]): void {
      const pending = pendingTakeovers.get(meetingId) ?? [];
      for (const event of events) {
        if (
          !event ||
          typeof event.at !== "number" ||
          event.kind !== "takeover"
        ) {
          continue;
        }
        if (pending.some((e) => e.at === event.at && e.kind === event.kind)) {
          continue;
        }
        pending.push({ at: event.at, kind: "takeover" });
      }
      pendingTakeovers.set(meetingId, pending);
    },

    logGuidance(
      meetingId: string,
      input: { redactedGuidance: string; steeredLineIndex: number },
    ): GuidanceEvent {
      const event: GuidanceEvent = {
        at: now(),
        redactedGuidance: input.redactedGuidance,
        steeredLineIndex: input.steeredLineIndex,
      };
      const pending = pendingGuidances.get(meetingId) ?? [];
      pending.push(event);
      pendingGuidances.set(meetingId, pending);
      const found = records.get(meetingId);
      if (found) {
        records.set(meetingId, {
          ...copyRecord(found),
          guidanceEvents: [...found.guidanceEvents, { ...event }],
        });
      }
      return { ...event };
    },

    importGuidances(meetingId: string, events: readonly GuidanceEvent[]): void {
      // Every imported event joins the pending list, even one the restored
      // record already holds (exactly like logGuidance), so a re-approval
      // after a reload (which rebuilds the record from the pending list)
      // keeps it. The record itself is never appended here, so nothing
      // appears twice.
      const pending = pendingGuidances.get(meetingId) ?? [];
      for (const event of events) {
        if (!isGuidanceEvent(event)) continue;
        const candidate: GuidanceEvent = {
          at: event.at,
          redactedGuidance: event.redactedGuidance,
          steeredLineIndex: event.steeredLineIndex,
        };
        if (pending.some((e) => sameGuidanceEvent(e, candidate))) continue;
        pending.push(candidate);
      }
      pendingGuidances.set(meetingId, pending);
    },

    clear(): void {
      records.clear();
      pendingTakeovers.clear();
      pendingGuidances.clear();
    },
  };
}
