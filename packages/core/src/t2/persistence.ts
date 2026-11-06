/**
 * Synchronous key-value persistence for the T2 twin meeting room (T10,
 * local only).
 *
 * A twin room can be given a `RoomStore` so a page reload mid-flow resumes
 * without ever double-sending. Per owner + meeting title (stable across
 * reloads, unlike the connector's per-room random meeting ids) the room
 * persists the draft body, its sha256, the approval state (approved body +
 * hash), the send state, the evidence record, and a DURABLE SEND INTENT.
 *
 * `send()` writes `{ meetingId, packageHash, status: "pending" }` to the
 * store BEFORE calling the transport, then marks it `sent`, `failed`, or
 * `cancelled` (takeover aborted the in-flight transport) after. A `pending`
 * intent found at load time means the previous room died
 * between the intent write and the transport result: the reloaded room must
 * NEVER auto-resend and must refuse a manual send ("unconfirmed").
 *
 * No backend, no network. The `localStorage` adapter below is guarded so it
 * is a no-op during server-side rendering.
 */

import { packageHash } from "./connector-port.js";
import type { EvidenceRecord } from "./evidence.js";
import type { CategoryRedactions } from "./redaction.js";

/** Minimal synchronous key-value surface the twin room persists through. */
export interface RoomStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** In-memory store: the default for tests and for reload simulation. */
export function createInMemoryRoomStore(): RoomStore {
  const data = new Map<string, string>();
  return {
    get: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    set: (key: string, value: string) => {
      data.set(key, value);
    },
    remove: (key: string) => {
      data.delete(key);
    },
  };
}

/**
 * `localStorage`-backed store for the web UI. When `localStorage` is
 * unavailable (server-side rendering, disabled storage) every operation is
 * a silent no-op so construction never throws.
 */
export function createLocalStorageRoomStore(
  prefix = "second-seat.t2.room.",
): RoomStore {
  const available = (() => {
    try {
      return typeof localStorage !== "undefined" && localStorage !== null;
    } catch {
      return false;
    }
  })();
  return {
    get: (key: string) => {
      if (!available) return null;
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set: (key: string, value: string) => {
      if (!available) return;
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        // Storage full or blocked: persistence is best-effort.
      }
    },
    remove: (key: string) => {
      if (!available) return;
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // Best-effort only.
      }
    },
  };
}

export type SendIntentStatus = "pending" | "sent" | "failed" | "cancelled";

/** Durable send intent: written BEFORE the transport is called. */
export interface SendIntent {
  readonly meetingId: string;
  readonly packageHash: string;
  readonly status: SendIntentStatus;
}

export type PersistedSendState = "unsent" | "sent" | "failed" | "cancelled";

/** An owner-included plugin section (redacted snapshot text). */
export interface PersistedPluginSection {
  readonly id: string;
  readonly text: string;
  /**
   * Room-clock time the snapshot was taken (include or refresh). Records
   * written before snapshots carried metadata load as `0`.
   */
  readonly snapshotAt: number;
  /**
   * Transcript length the snapshot was built from. Records written before
   * snapshots carried metadata load as `0`.
   */
  readonly transcriptLen: number;
}

/**
 * A durable per-owner takeover event. `meetingTitle` (stable across
 * reloads) names the meeting; per-room connector meeting ids do not
 * survive a reload, so they are never persisted here.
 */
export interface PersistedTakeoverEvent {
  readonly at: number;
  readonly kind: "takeover";
  readonly meetingTitle: string;
}

/** Everything the room persists per owner + meeting. */
export interface PersistedDraft {
  readonly version: 1;
  readonly ownerId: string;
  readonly meetingTitle: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly redactions: readonly CategoryRedactions[];
  readonly approvedBody: string | null;
  readonly approvedHash: string | null;
  readonly approved: boolean;
  /** Editable package base (redacted); included sections append after it. */
  readonly pluginBase: string;
  /** Owner-included plugin sections, in display order. */
  readonly pluginSections: readonly PersistedPluginSection[];
  /** Owner-excluded plugin ids. */
  readonly pluginRejected: readonly string[];
  readonly sendState: PersistedSendState;
  readonly intent: SendIntent | null;
  readonly evidence: EvidenceRecord | null;
  /**
   * Streamed transcript lines for the meeting, the script cursor (count of
   * lines consumed, always equal to `transcript.length` on honest writes),
   * and the transcript indexes steered by owner guidance. Records written
   * before transcript persistence existed carry none of these and load as
   * an empty transcript at cursor 0.
   */
  readonly transcript: readonly string[];
  readonly nextIndex: number;
  readonly steeredLineIndexes: readonly number[];
}

const STORE_VERSION = 1;

function slugForTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "meeting";
}

/** Stable store key per owner + meeting (survives reloads by design). */
export function roomStoreKey(ownerId: string, meetingTitle: string): string {
  return `v1/${ownerId}/${slugForTitle(meetingTitle)}`;
}

/** Stable store key for the per-owner takeover flag. */
export function roomTakeoverKey(ownerId: string): string {
  return `v1/${ownerId}/takeover`;
}

/** Stable store key for the per-owner private guidance channel. */
export function roomGuidanceKey(ownerId: string): string {
  return `v1/${ownerId}/guidance`;
}

/** Stable store key for the per-owner durable guidance events. */
export function roomGuidanceEventsKey(ownerId: string): string {
  return `v1/${ownerId}/guidance-events`;
}

/** Stable store key for the per-owner durable takeover events. */
export function roomTakeoverEventsKey(ownerId: string): string {
  return `v1/${ownerId}/takeover-events`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSendState(value: unknown): value is PersistedSendState {
  return (
    value === "unsent" ||
    value === "sent" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isIntentStatus(value: unknown): value is SendIntentStatus {
  return (
    value === "pending" ||
    value === "sent" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function readIntent(value: unknown): SendIntent | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  if (
    typeof value["meetingId"] !== "string" ||
    typeof value["packageHash"] !== "string" ||
    !isIntentStatus(value["status"])
  ) {
    return null;
  }
  return {
    meetingId: value["meetingId"],
    packageHash: value["packageHash"],
    status: value["status"],
  };
}

function readEvidence(value: unknown): EvidenceRecord | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  if (
    typeof value["meetingId"] !== "string" ||
    typeof value["meetingTitle"] !== "string" ||
    typeof value["packageHash"] !== "string" ||
    typeof value["approvalPrincipal"] !== "string" ||
    typeof value["approvedAt"] !== "number" ||
    (value["sentAt"] !== null && typeof value["sentAt"] !== "number") ||
    (value["sendState"] !== "unsent" &&
      value["sendState"] !== "sent" &&
      value["sendState"] !== "failed" &&
      value["sendState"] !== "cancelled") ||
    !Array.isArray(value["redactions"]) ||
    !Array.isArray(value["takeoverEvents"])
  ) {
    return null;
  }
  return value as unknown as EvidenceRecord;
}

/**
 * Load and validate one meeting slot. Returns null when nothing was stored,
 * the JSON is corrupt, or the stored body was tampered with (hash
 * mismatch): callers must then treat the draft as unapproved and unsendable.
 */
export function loadPersistedDraft(
  store: RoomStore,
  ownerId: string,
  meetingTitle: string,
): PersistedDraft | null {
  let raw: string | null;
  try {
    raw = store.get(roomStoreKey(ownerId, meetingTitle));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed["version"] !== STORE_VERSION) return null;
  if (parsed["ownerId"] !== ownerId || parsed["meetingTitle"] !== meetingTitle) {
    return null;
  }
  if (typeof parsed["body"] !== "string") return null;
  if (typeof parsed["bodyHash"] !== "string") return null;
  // Tamper check: the stored body must hash to the stored hash.
  if (packageHash(parsed["body"]) !== parsed["bodyHash"]) return null;
  if (!Array.isArray(parsed["redactions"])) return null;
  if (typeof parsed["approved"] !== "boolean") return null;
  // Plugin approval state: absent means "no plugin choices yet" (records
  // written before plugins existed); present-but-malformed fails closed.
  const body = parsed["body"] as string;
  const pluginBase =
    parsed["pluginBase"] === undefined ? body : parsed["pluginBase"];
  if (typeof pluginBase !== "string") return null;
  let pluginSections: PersistedPluginSection[] = [];
  if (parsed["pluginSections"] !== undefined) {
    if (!Array.isArray(parsed["pluginSections"])) return null;
    for (const entry of parsed["pluginSections"]) {
      if (
        !isRecord(entry) ||
        typeof entry["id"] !== "string" ||
        typeof entry["text"] !== "string"
      ) {
        return null;
      }
      // Snapshot metadata is required on new writes but optional when
      // reading: records written before snapshots carried metadata load
      // with `0` instead of failing closed. Present-but-malformed metadata
      // still fails closed.
      let snapshotAt = 0;
      let transcriptLen = 0;
      if (entry["snapshotAt"] !== undefined || entry["transcriptLen"] !== undefined) {
        if (
          typeof entry["snapshotAt"] !== "number" ||
          typeof entry["transcriptLen"] !== "number"
        ) {
          return null;
        }
        snapshotAt = entry["snapshotAt"];
        transcriptLen = entry["transcriptLen"];
      }
      pluginSections.push({
        id: entry["id"],
        text: entry["text"],
        snapshotAt,
        transcriptLen,
      });
    }
  }
  let pluginRejected: string[] = [];
  if (parsed["pluginRejected"] !== undefined) {
    if (
      !Array.isArray(parsed["pluginRejected"]) ||
      !parsed["pluginRejected"].every((id) => typeof id === "string")
    ) {
      return null;
    }
    pluginRejected = [...parsed["pluginRejected"]];
  }
  if (!isSendState(parsed["sendState"])) return null;
  const intent = readIntent(parsed["intent"]);
  // A present-but-malformed intent is treated like tampering: fail closed.
  if (parsed["intent"] !== null && parsed["intent"] !== undefined && intent === null) {
    return null;
  }
  const evidence = readEvidence(parsed["evidence"]);

  // The writer always keeps intent and send state in agreement; a mismatch
  // means the stored record was hand-edited: fail closed.
  if (intent !== null) {
    if (parsed["approved"] !== true) return null;
    if (intent.status === "pending" && parsed["sendState"] !== "unsent") return null;
    if (intent.status === "sent" && parsed["sendState"] !== "sent") return null;
    if (intent.status === "failed" && parsed["sendState"] !== "failed") return null;
    if (intent.status === "cancelled" && parsed["sendState"] !== "cancelled") {
      return null;
    }
  }

  if (parsed["approved"] === true) {
    if (typeof parsed["approvedBody"] !== "string") return null;
    if (typeof parsed["approvedHash"] !== "string") return null;
    // The approved body must still equal the current body and hash to the
    // approved hash; otherwise the package was edited after approval.
    if (parsed["approvedBody"] !== parsed["body"]) return null;
    if (packageHash(parsed["approvedBody"]) !== parsed["approvedHash"]) return null;
    if (parsed["approvedHash"] !== parsed["bodyHash"]) return null;
    if (intent !== null && intent.packageHash !== parsed["approvedHash"]) return null;
    // The approval must be bound to the evidence record written at approve
    // time: recomputing the stored hashes around a forged body cannot mint
    // a connector approval, so a record whose evidence still pins a
    // different package hash fails closed to unapproved/unsendable.
    if (evidence === null) return null;
    if (evidence.packageHash !== parsed["approvedHash"]) return null;
  }

  // Transcript position: absent on records written before transcript
  // persistence existed (loads as empty/0); present-but-malformed fails
  // closed like every other tamper signal.
  let transcript: string[] = [];
  if (parsed["transcript"] !== undefined) {
    if (
      !Array.isArray(parsed["transcript"]) ||
      !parsed["transcript"].every((line) => typeof line === "string")
    ) {
      return null;
    }
    transcript = [...parsed["transcript"]];
  }
  let nextIndex = 0;
  if (parsed["nextIndex"] !== undefined) {
    if (
      typeof parsed["nextIndex"] !== "number" ||
      !Number.isInteger(parsed["nextIndex"]) ||
      parsed["nextIndex"] < 0
    ) {
      return null;
    }
    nextIndex = parsed["nextIndex"];
  }
  let steeredLineIndexes: number[] = [];
  if (parsed["steeredLineIndexes"] !== undefined) {
    if (
      !Array.isArray(parsed["steeredLineIndexes"]) ||
      !parsed["steeredLineIndexes"].every(
        (index) => typeof index === "number" && Number.isInteger(index),
      )
    ) {
      return null;
    }
    steeredLineIndexes = [...parsed["steeredLineIndexes"]];
  }

  return {
    version: STORE_VERSION,
    ownerId,
    meetingTitle,
    body: parsed["body"],
    bodyHash: parsed["bodyHash"],
    redactions: parsed["redactions"] as CategoryRedactions[],
    approvedBody:
      parsed["approved"] === true ? (parsed["approvedBody"] as string) : null,
    approvedHash:
      parsed["approved"] === true ? (parsed["approvedHash"] as string) : null,
    approved: parsed["approved"],
    pluginBase,
    pluginSections,
    pluginRejected,
    sendState: parsed["sendState"],
    intent,
    evidence,
    transcript,
    nextIndex,
    steeredLineIndexes,
  };
}

/** Persist one meeting slot (best-effort: store failures never throw). */
export function savePersistedDraft(
  store: RoomStore,
  draft: PersistedDraft,
): void {
  try {
    store.set(roomStoreKey(draft.ownerId, draft.meetingTitle), JSON.stringify(draft));
  } catch {
    // Persistence is best-effort; the in-memory room keeps working.
  }
}

/** Load the persisted per-owner takeover flag (false when absent/corrupt). */
export function loadTakeover(store: RoomStore, ownerId: string): boolean {
  let raw: string | null;
  try {
    raw = store.get(roomTakeoverKey(ownerId));
  } catch {
    return false;
  }
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && parsed["takenOver"] === true;
  } catch {
    return false;
  }
}

/** Persist the per-owner takeover flag (best-effort). */
export function saveTakeover(
  store: RoomStore,
  ownerId: string,
  takenOver: boolean,
): void {
  try {
    store.set(roomTakeoverKey(ownerId), JSON.stringify({ takenOver }));
  } catch {
    // Best-effort only.
  }
}

/**
 * Load the durable per-owner takeover events, in stored order. Returns an
 * empty list when nothing was stored or the stored value is corrupt
 * (callers keep the persisted flag as the paused-state source of truth).
 */
export function loadTakeoverEvents(
  store: RoomStore,
  ownerId: string,
): PersistedTakeoverEvent[] {
  let raw: string | null;
  try {
    raw = store.get(roomTakeoverEventsKey(ownerId));
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const events: PersistedTakeoverEvent[] = [];
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry["at"] !== "number" ||
      entry["kind"] !== "takeover" ||
      typeof entry["meetingTitle"] !== "string"
    ) {
      return [];
    }
    events.push({
      at: entry["at"],
      kind: "takeover",
      meetingTitle: entry["meetingTitle"],
    });
  }
  return events;
}

/** Persist the per-owner takeover events, in order (best-effort). */
export function saveTakeoverEvents(
  store: RoomStore,
  ownerId: string,
  events: readonly PersistedTakeoverEvent[],
): void {
  try {
    store.set(roomTakeoverEventsKey(ownerId), JSON.stringify([...events]));
  } catch {
    // Best-effort only.
  }
}

/** One recorded owner guidance: room-clock timestamp plus raw text. */
export interface PersistedPendingGuidance {
  readonly text: string;
  readonly at: number;
}

/**
 * The durable private guidance channel for one meeting: every recorded
 * guidance text (shown only to the owner) plus the still-unconsumed queue
 * that will steer upcoming twin answers. `meetingTitle` (stable across
 * reloads) names the meeting.
 */
export interface PersistedMeetingGuidance {
  readonly meetingTitle: string;
  readonly history: readonly string[];
  readonly pending: readonly PersistedPendingGuidance[];
}

/** A durable guidance steering event: which twin line one guidance steered. */
export interface PersistedGuidanceEvent {
  readonly at: number;
  readonly kind: "guidance";
  readonly meetingTitle: string;
  readonly redactedGuidance: string;
  readonly steeredLineIndex: number;
}

/**
 * Load the durable per-owner guidance channel, in stored order. Returns an
 * empty list when nothing was stored or the stored value is corrupt.
 */
export function loadMeetingGuidance(
  store: RoomStore,
  ownerId: string,
): PersistedMeetingGuidance[] {
  let raw: string | null;
  try {
    raw = store.get(roomGuidanceKey(ownerId));
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PersistedMeetingGuidance[] = [];
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry["meetingTitle"] !== "string" ||
      !Array.isArray(entry["history"]) ||
      !entry["history"].every((t) => typeof t === "string") ||
      !Array.isArray(entry["pending"])
    ) {
      return [];
    }
    const pending: PersistedPendingGuidance[] = [];
    for (const item of entry["pending"]) {
      if (
        !isRecord(item) ||
        typeof item["text"] !== "string" ||
        typeof item["at"] !== "number"
      ) {
        return [];
      }
      pending.push({ text: item["text"], at: item["at"] });
    }
    out.push({
      meetingTitle: entry["meetingTitle"],
      history: [...entry["history"]],
      pending,
    });
  }
  return out;
}

/** Persist the per-owner guidance channel, in order (best-effort). */
export function saveMeetingGuidance(
  store: RoomStore,
  ownerId: string,
  meetings: readonly PersistedMeetingGuidance[],
): void {
  try {
    store.set(roomGuidanceKey(ownerId), JSON.stringify([...meetings]));
  } catch {
    // Best-effort only.
  }
}

/**
 * Load the durable per-owner guidance events, in stored order. Returns an
 * empty list when nothing was stored or the stored value is corrupt.
 */
export function loadGuidanceEvents(
  store: RoomStore,
  ownerId: string,
): PersistedGuidanceEvent[] {
  let raw: string | null;
  try {
    raw = store.get(roomGuidanceEventsKey(ownerId));
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const events: PersistedGuidanceEvent[] = [];
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry["at"] !== "number" ||
      entry["kind"] !== "guidance" ||
      typeof entry["meetingTitle"] !== "string" ||
      typeof entry["redactedGuidance"] !== "string" ||
      typeof entry["steeredLineIndex"] !== "number"
    ) {
      return [];
    }
    events.push({
      at: entry["at"],
      kind: "guidance",
      meetingTitle: entry["meetingTitle"],
      redactedGuidance: entry["redactedGuidance"],
      steeredLineIndex: entry["steeredLineIndex"],
    });
  }
  return events;
}

/** Persist the per-owner guidance events, in order (best-effort). */
export function saveGuidanceEvents(
  store: RoomStore,
  ownerId: string,
  events: readonly PersistedGuidanceEvent[],
): void {
  try {
    store.set(roomGuidanceEventsKey(ownerId), JSON.stringify([...events]));
  } catch {
    // Best-effort only.
  }
}
