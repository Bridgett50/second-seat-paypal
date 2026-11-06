// Written fresh in the event repo on Oct 29, 2026 by Muse Code; behavior
// follows holo PR #6 (8499e74); no holo code copied.
//
// Socket-free meeting room service (no HTML in this session). One in-memory
// room store per store key (one per browser via cookie) so a reopened room
// restores its own state without leaking into other browsers; a fake
// transport that only records bodies (no network ever); and a per-request
// fake-send gate (exact "1" test mode plus a loopback host).

import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import {
  COMPARE_CANCELLED_REASON,
  COMPARE_FAILED_REASON,
  COMPARE_PAUSED_REASON,
  COMPARE_SENT_REASON,
  COMPARE_UNCONFIRMED_REASON,
  DEMO_STEPS,
  evaluateOutgoing,
  SEND_DISABLED_REASON,
  compareUnavailableReason,
  createDemoController,
  createInMemoryRoomStore,
  createMeetingPolicyRecorder,
  createTwinRoom,
  demoStepAnnouncement,
  diffAnnouncements,
  fakeSendAllowed,
  getPolicyGeneration,
  isDemoMode,
  type DemoController,
  type RoomStore,
  type TwinRoom,
  type TwinRoomView,
} from "@second-seat/bot/dist/src/t2-room.js";

export const MEETING_ROOM_PATH = "/meeting-room";
export const MEETING_ROOM_API = "/api/meeting-room";
export const MEETING_ROOM_POST_FIELDS = ["roomId", "action", "text", "id", "packageId", "contextRevision", "policyGeneration"] as const;

/** Largest accepted `packageId` for Approve and Send, in characters. */
export const MEETING_ROOM_MAX_PACKAGE_ID_CHARS = 400;

/**
 * Server-derived identity of the outgoing package the page displays: the
 * selected meeting plus the sha256 of the complete composed package body.
 * Approve and Send must echo it back; any other value is refused.
 */
export function meetingRoomPackageId(view: TwinRoomView): string {
  return `${view.selectedMeetingId}:${view.draft.sha256}`;
}

/** Announcement when Approve or Send arrives without a valid package identity. */
export const PACKAGE_ID_MISSING_REASON =
  "Approve and Send need the package you reviewed. Reload the room and review it.";

/** Announcement when Approve or Send names a package that is no longer current. */
export const PACKAGE_ID_STALE_REASON =
  "The package changed since you reviewed it. Review the current package, then approve again.";

/** Demo note when the guided Send step is not attempted (sending unavailable). */
export const DEMO_SEND_NOT_SENT =
  "Step 6 not sent: sending is unavailable on this public demo, so nothing was sent and there is no send receipt. The guide continues with the approved, unsent package.";

/** Largest accepted `text` for the "guide" action, in characters. */
export const MEETING_ROOM_MAX_GUIDANCE_CHARS = 2_000;

/** Largest accepted `text` for the "edit-draft" action, in characters. */
export const MEETING_ROOM_MAX_DRAFT_CHARS = 20_000;

/** Largest accepted `text` for the "compare" action, in characters. */
export const MEETING_ROOM_MAX_COMPARE_CHARS = 20_000;

/** Largest number of guidance entries recorded per meeting. */
export const MEETING_ROOM_MAX_GUIDANCE_ENTRIES = 50;

/** Cookie carrying one browser's meeting-room store key. */
export const MEETING_ROOM_COOKIE = "mr_store";

const STORE_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the meeting-room store key from a Cookie header. Returns the
 * `mr_store` value only when it is a UUID, else null (absent, malformed,
 * or duplicated-then-joined headers included).
 */
export function meetingRoomStoreKey(
  cookieHeader: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== MEETING_ROOM_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return STORE_KEY_RE.test(value) ? value : null;
  }
  return null;
}

/**
 * Server-side fake-send gate for one request. OFF BY DEFAULT: without exactly
 * `SECOND_SEAT_TEST_MODE=1` and a loopback Host (plus a loopback
 * X-Forwarded-Host when present) this is false. A duplicated header (array)
 * is always refused.
 */
export function meetingRoomFakeSendAllowed(
  env: Readonly<Record<string, string | undefined>>,
  headers: IncomingHttpHeaders,
): boolean {
  const host = headers.host;
  const forwardedHost = headers["x-forwarded-host"] ?? null;
  if (Array.isArray(host) || Array.isArray(forwardedHost)) return false;
  return fakeSendAllowed({
    testModeEnv: env.SECOND_SEAT_TEST_MODE,
    host,
    forwardedHost,
  });
}

// Actions that change room state; only a successful one marks a store key
// as acted. GET open, state, evidence-export, compare and refused actions
// do not, so cheap reads cannot shield a flood of keys from eviction.
const ACTING_ACTIONS = new Set([
  "stream-next",
  "guide",
  "select-meeting",
  "edit-draft",
  "approve",
  "takeover",
  "resume",
  "run-plugins",
  "plugin-include",
  "plugin-exclude",
  "plugin-refresh",
  "send",
  "demo-next",
  "demo-restart",
  "adopt-candidate",
]);

const COOKIE_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function cookieHostIsLoopback(value: string | undefined): boolean {
  if (value === undefined) return false;
  const name = value.trim().toLowerCase().replace(/:\d+$/, "");
  return COOKIE_LOOPBACK_HOSTS.has(name);
}

/**
 * Set-Cookie value for the meeting room store key. Adds `Secure` unless the
 * request is plain http on a loopback Host (local dev and the loopback test
 * server, where browsers would drop a Secure cookie). Duplicated headers,
 * a non-loopback Host or X-Forwarded-Host, or X-Forwarded-Proto https all
 * get `Secure`.
 */
export function meetingRoomSetCookie(key: string, headers: IncomingHttpHeaders): string {
  const base = `${MEETING_ROOM_COOKIE}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
  const host = headers.host;
  const fwdHost = headers["x-forwarded-host"];
  const fwdProto = headers["x-forwarded-proto"];
  if (Array.isArray(host) || Array.isArray(fwdHost) || Array.isArray(fwdProto)) return `${base}; Secure`;
  if (typeof fwdProto === "string" && fwdProto.split(",")[0]?.trim().toLowerCase() !== "http") return `${base}; Secure`;
  if (fwdHost !== undefined && !cookieHostIsLoopback(fwdHost)) return `${base}; Secure`;
  return cookieHostIsLoopback(host) ? base : `${base}; Secure`;
}

export type CandidateSourceRef = { readonly utteranceId: string; readonly revision: number };
export type CandidateReasonerInput = {
  readonly roomId: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly contextRevision: number;
  readonly policyGeneration: number;
  readonly epoch?: number;
  readonly utterances: ConversationSnapshot["utterances"];
  readonly guidance: readonly string[];
  readonly notes: readonly string[];
  readonly registerRevoke?: (revoke: () => void) => void;
};
export type CandidateReasoner = (input: CandidateReasonerInput) => Promise<unknown>;
export type CandidateCurrentBinding = { readonly roomId: string; readonly ownerId: string; readonly meetingId: string; readonly contextRevision: number; readonly policyGeneration: number; readonly epoch?: number };
export type MeetingRoomCandidateSnapshot = {
  readonly meetingId: string;
  readonly status: "none" | "pending" | "provisional" | "failed";
  readonly candidateId: string | null;
  readonly provisional: true;
  readonly policyChecked: false;
  readonly approved: false;
  readonly contextRevision: number | null;
  readonly subject: string | null;
  readonly body: string | null;
  readonly sourceRefs: readonly CandidateSourceRef[];
  readonly note: string;
};

export type ConversationSnapshot = {
  readonly version: 1;
  readonly meetingId: string;
  readonly contextRevision: number;
  readonly utterances: ReadonlyArray<{
    readonly utteranceId: string;
    readonly sequence: number;
    readonly revision: number;
    readonly speaker: string;
    readonly text: string;
  }>;
  readonly latestCorrection: null | { readonly utteranceId: string; readonly revision: number };
};

export type MeetingRoomSnapshot = {
  readonly roomId: string;
  readonly candidatePreview?: {
    readonly status: "released" | "held" | "unavailable" | "stale";
    readonly candidateId: string;
    readonly evaluatedSubject?: string;
    readonly evaluatedBody?: string;
    readonly subjectChanged?: boolean;
    readonly bodyChanged?: boolean;
    readonly reason?: string;
    readonly generation: number;
  };
  readonly demo: null | {
    readonly stepLabel: string | null;
    readonly completed: number;
    readonly total: number;
    readonly done: boolean;
    readonly caption: string | null;
    /** Set when the guided Send step was not attempted; null otherwise. */
    readonly sendNote: string | null;
    /** Guided step 7's comparison, kept until Restart; null before step 7. */
    readonly comparison?: unknown;
    /** Guided step 8's evidence JSON, kept until Restart; null before step 8. */
    readonly evidenceJson?: string | null;
  };
  readonly fakeSend: boolean;
  readonly restored: boolean;
  readonly view: TwinRoomView;
  readonly approvalNote: string | null;
  readonly copyText: string | null;
  readonly mailtoHref: string | null;
  /** Identity of the displayed outgoing package (see meetingRoomPackageId). */
  readonly packageId: string;
  /** Visible notice for a refused Send; null otherwise. */
  readonly sendNotice: string | null;
  readonly evidencePreviewJson: string;
  readonly sessionPolicy?: { readonly meetingId: string; readonly generation: number; readonly status: "none" | "applied" | "needs-clarification" | "not-applied"; readonly note: string };
  readonly conversation?: ConversationSnapshot;
  readonly candidate?: MeetingRoomCandidateSnapshot;
};

export type MeetingRoomActionResult = {
  readonly snapshot: MeetingRoomSnapshot | null;
  readonly announcements: string[];
  readonly evidenceJson?: string;
  readonly comparison?: unknown;
  readonly comparisonApproved?: boolean;
  readonly comparisonReason?: string;
};

export type MeetingRoomService = {
  open(search: string, headers: IncomingHttpHeaders, storeKey?: string): MeetingRoomSnapshot;
  act(
    body: Readonly<Record<string, unknown>>,
    headers: IncomingHttpHeaders,
  ): Promise<{ status: number; body: MeetingRoomActionResult }>;
  /**
   * act() bound to a browser: answers 404 with no snapshot, before reading
   * or changing anything, unless `callerKey` (the store key from this
   * request's own mr_store cookie) is the key that opened the room.
   */
  actAs(
    callerKey: string | null,
    body: Readonly<Record<string, unknown>>,
    headers: IncomingHttpHeaders,
  ): Promise<{ status: number; body: MeetingRoomActionResult }>;
  ingestConversationAs(
    callerKey: string | null,
    roomId: unknown,
    event: unknown,
  ): { status: number; body: MeetingRoomActionResult };
  finishConversationAs(callerKey: string | null, roomId: unknown): { status: number; body: MeetingRoomActionResult };
  approvedGoogleDraftAs(callerKey: string | null, roomId: unknown): Readonly<{ identity: string; body: string }> | null;
  workerBindingAs(callerKey: string | null, roomId: unknown): Readonly<{ roomId: string; ownerId: string; meetingId: string; epoch: number }> | null;
  correctConversationAs(callerKey: string | null, roomId: unknown, utteranceId: unknown, expectedRevision: unknown, text: unknown): { status: number; body: MeetingRoomActionResult };
  candidateBindingAs(callerKey: string | null, roomId: unknown): (CandidateCurrentBinding & { readonly epoch: number }) | null;
  candidateIsCurrent(binding: CandidateCurrentBinding): boolean;
  sentBodies(): readonly string[];
  /** Test-visible counts: pages, stores, activity entries and demo pages held. */
  sizes(): { pages: number; stores: number; activity: number; demoPages: number };
};

/** Thrown by open() when no idle store key can be evicted to admit a new one. */
export class MeetingRoomBusyError extends Error {
  constructor() {
    super("Meeting room is busy. Try again later.");
    this.name = "MeetingRoomBusyError";
  }
}

type RoomEntry = {
  readonly room: TwinRoom;
  readonly demo: DemoController | null;
  readonly testMode: boolean;
  readonly reused: boolean;
  readonly storeKey: string;
};

/**
 * Create a meeting room service. `env` defaults to `process.env` and is read
 * at each call (never cached), so flipping `SECOND_SEAT_TEST_MODE` later
 * changes later gates. Stores are capped at `maxStores` (default 200): when
 * open() needs a new store key, a key that never acted (open only) is evicted first, least
 * recently opened, else the least-recently-active key idle for at least `idleMs` (default 30
 * minutes), with its shared rooms and pages; only when every key acted within `idleMs` is a
 * `MeetingRoomBusyError` thrown and nothing evicted. Pages are capped at `maxPagesPerKey`
 * (default 20) per store
 * key by evicting only that key's own oldest page, so one browser flooding
 * the page can never evict another browser's rooms. Demo (?demo=1) pages are
 * capped at `maxDemoPages` (default 200) globally by evicting the oldest demo
 * page, never count against a key's page cap, and record no activity.
 */
export function createMeetingRoomService(opts?: {
  env?: Readonly<Record<string, string | undefined>>;
  maxStores?: number;
  maxPagesPerKey?: number;
  maxDemoPages?: number;
  idleMs?: number;
  now?: () => number;
  conversationInput?: boolean;
  sessionPolicy?: boolean;
  candidateReasoner?: CandidateReasoner;
  candidateDeadlineMs?: number;
  candidateMaxAttempts?: number;
  candidateAutoDispatch?: boolean;
}): MeetingRoomService {
  const env = opts?.env ?? process.env;
  const maxStores = opts?.maxStores ?? 200;
  const maxPagesPerKey = opts?.maxPagesPerKey ?? 20;
  const maxDemoPages = opts?.maxDemoPages ?? 200;
  const idleMs = opts?.idleMs ?? 30 * 60_000;
  const now = opts?.now ?? Date.now;
  const candidateDeadlineMs = opts?.candidateDeadlineMs ?? 10000;
  if(opts?.candidateDeadlineMs !== undefined){
    const v = opts.candidateDeadlineMs;
    if(!Number.isSafeInteger(v) || v <= 0) throw new RangeError("candidateDeadlineMs must be a positive safe integer");
  }
  const candidateMaxAttempts = opts?.candidateMaxAttempts ?? 8;
  if(opts?.candidateMaxAttempts !== undefined){
    const v = opts.candidateMaxAttempts;
    if(!Number.isSafeInteger(v) || v <= 0) throw new RangeError("candidateMaxAttempts must be a positive safe integer");
  }
  const stores = new Map<string, RoomStore>();
  const sent: string[] = [];
  const rooms = new Map<string, RoomEntry>();
  // Last activity per store key, set on open() and on every act() for a
  // page of that key. Drives idle eviction of whole store keys.
  const lastActive = new Map<string, number>();
  // Store keys that have acted (any act() on one of their pages). Keys that
  // only ever opened a page are evicted first, so a flood of plain GETs can
  // never lock new visitors out.
  const acted = new Set<string>();
  // Demo (?demo=1) page roomIds in open order, capped at maxDemoPages
  // globally; the oldest demo page is evicted first.
  const demoPages = new Set<string>();
  // One shared twin room per store key and test-mode flag (the flag is
  // fixed at creation). Two tabs with the same cookie share one room so a
  // send in one tab is visible in the other and cannot go out twice.
  const shared = new Map<string, TwinRoom>();
  const transport = async (body: string): Promise<void> => {
    sent.push(body);
  };

  /** Store for one browser key, created on first use (no eviction here). */
  function storeFor(storeKey: string): RoomStore {
    const existing = stores.get(storeKey);
    if (existing !== undefined) return existing;
    const created = createInMemoryRoomStore();
    stores.set(storeKey, created);
    return created;
  }

  /**
   * Drop a whole store key: its store, both shared rooms (`${key}:t` and
   * `${key}:p`), all its pages, and its activity record.
   */
  function evictStoreKey(storeKey: string): void {
    const tEntry = shared.get(`${storeKey}:t`);
    if(tEntry !== undefined) revokeOwnedCandidate(tEntry, null);
    const pEntry = shared.get(`${storeKey}:p`);
    if(pEntry !== undefined) revokeOwnedCandidate(pEntry, null);
    stores.delete(storeKey);
    shared.delete(`${storeKey}:t`);
    shared.delete(`${storeKey}:p`);
    for (const [roomId, entry] of rooms) {
      if (entry.storeKey === storeKey) {
        revokeOwnedCandidate(entry.room, null);
        rooms.delete(roomId);
        demoPages.delete(roomId);
      }
    }
    lastActive.delete(storeKey);
    acted.delete(storeKey);
  }

  /**
   * The store key to evict for a new key, or null when every key has acted
   * within `idleMs`. Never-acted (open-only) keys go first, least recently
   * opened; then acted keys idle for at least `idleMs`, least recently active.
   */
  function pickVictim(at: number): string | null {
    let openOnly: string | null = null;
    let openOnlyAt = Infinity;
    let idle: string | null = null;
    let idleAt = Infinity;
    for (const key of stores.keys()) {
      const active = lastActive.get(key) ?? Number.NEGATIVE_INFINITY;
      if (!acted.has(key)) {
        if (active < openOnlyAt) {
          openOnly = key;
          openOnlyAt = active;
        }
      } else if (at - active >= idleMs && active < idleAt) {
        idle = key;
        idleAt = active;
      }
    }
    return openOnly ?? idle;
  }

  type ConversationEntry = { sequence: number; revision: number; speaker: string; text: string };
  type ConversationState = {
    meetingId: string;
    contextRevision: number;
    utterances: Map<string, ConversationEntry>;
    latestCorrection: null | { utteranceId: string; revision: number };
  };
  const conversationByRoom = new WeakMap<TwinRoom, Map<string, ConversationState>>();
const workerEpochByRoom = new WeakMap<TwinRoom, number>();
const googleExportEpochByRoom = new WeakMap<TwinRoom, number>();

  function getConversationState(room: TwinRoom, meetingId: string): ConversationState {
    let byMeeting = conversationByRoom.get(room);
    if (byMeeting === undefined) {
      byMeeting = new Map<string, ConversationState>();
      conversationByRoom.set(room, byMeeting);
    }
    let conv = byMeeting.get(meetingId);
    if (conv === undefined) {
      conv = { meetingId, contextRevision: 0, utterances: new Map(), latestCorrection: null };
      byMeeting.set(meetingId, conv);
    }
    return conv;
  }

  function conversationSnapshotFor(entry: RoomEntry, view: TwinRoomView): ConversationSnapshot {
    const meetingId = view.selectedMeetingId;
    const byMeeting = conversationByRoom.get(entry.room);
    const conv = byMeeting?.get(meetingId);
    if (conv === undefined) {
      return {
        version: 1 as const,
        meetingId,
        contextRevision: 0,
        utterances: Object.freeze([] as unknown as ConversationSnapshot["utterances"]) as ConversationSnapshot["utterances"],
        latestCorrection: null,
      };
    }
    const list = [...conv.utterances.entries()]
      .map(([utteranceId, e]) => ({ utteranceId, sequence: e.sequence, revision: e.revision, speaker: e.speaker, text: e.text }))
      .sort((a, b) => a.sequence - b.sequence);
    const frozen = Object.freeze(list.map((u) => Object.freeze({ ...u })));
    return {
      version: 1 as const,
      meetingId: conv.meetingId,
      contextRevision: conv.contextRevision,
      utterances: frozen as unknown as ConversationSnapshot["utterances"],
      latestCorrection: conv.latestCorrection === null ? null : Object.freeze({ ...conv.latestCorrection }),
    };
  }

  type CandidateResult = { candidateId: string; meetingId: string; status: "provisional" | "failed"; contextRevision: number; subject: string; body: string; sourceRefs: readonly CandidateSourceRef[]; note: string };
  type CandidatePreview =
    | { status: "released"; candidateId: string; evaluatedSubject: string; evaluatedBody: string; subjectChanged: boolean; bodyChanged: boolean; generation: number }
    | { status: "held"; candidateId: string; reason: string; generation: number }
    | { status: "unavailable"; candidateId: string; reason: string; generation: number };
  type CandidatePreviewState = {
    preview: CandidatePreview | null;
    ownerId: string;
    meetingId: string;
    contextRevision: number;
    epoch: number;
    generation: number;
    candidateId: string;
  };
  type CandidateState = { epoch: number; attempt: number; active: boolean; timedOut: boolean; timer: ReturnType<typeof setTimeout> | null; pending: null | { roomId: string; entry: RoomEntry }; result: null | CandidateResult; preview: CandidatePreviewState | null; revoke: null | { attempt: number; epoch: number; roomId: string; fn: () => void } };
  const candidateByRoom = new WeakMap<TwinRoom, CandidateState>();
  const candidateAttemptsByRoom = new WeakMap<TwinRoom, Map<string, number>>();
  function isValidReleasedResult(v: unknown): v is { outcome: string; text: string; generation: number } {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    if (o["outcome"] !== "released") return false;
    if (typeof o["text"] !== "string") return false;
    if (o["text"].trim().length === 0) return false;
    if (typeof o["version"] !== "string" || o["version"].trim().length === 0) return false;
    if (typeof o["generation"] !== "number") return false;
    return true;
  }
  function isValidHeldResult(v: unknown): v is { outcome: string; reason: string; generation: number } {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    if (o["outcome"] !== "held") return false;
    if (typeof o["reason"] !== "string" || o["reason"].trim().length === 0) return false;
    if (typeof o["version"] !== "string" || o["version"].trim().length === 0) return false;
    if (typeof o["generation"] !== "number") return false;
    return true;
  }
  function buildPreviewForResult(
    ownerId: string,
    meetingId: string,
    contextRevision: number,
    epoch: number,
    generation: number,
    candidateId: string,
    subject: string,
    body: string,
  ): CandidatePreview {
    const safeReason = "preview unavailable";
    if (typeof subject !== "string" || typeof body !== "string" || subject.length > 200 || body.length > 20000) {
      return { status: "unavailable", candidateId, reason: safeReason, generation };
    }
    let sRes: unknown;
    let bRes: unknown;
    try {
      sRes = evaluateOutgoing(ownerId, meetingId, subject, "follow-up-draft");
      bRes = evaluateOutgoing(ownerId, meetingId, body, "follow-up-draft");
    } catch {
      return { status: "unavailable", candidateId, reason: safeReason, generation };
    }
    const sReleased = isValidReleasedResult(sRes);
    const bReleased = isValidReleasedResult(bRes);
    const sHeld = isValidHeldResult(sRes);
    const bHeld = isValidHeldResult(sHeld ? sRes : sRes) && sHeld;
    const bHeld2 = isValidHeldResult(bRes);
    const sValid = sReleased || sHeld;
    const bValid = bReleased || bHeld2;
    if (!sValid || !bValid) {
      return { status: "unavailable", candidateId, reason: safeReason, generation };
    }
    if (sReleased && bReleased && (sRes as { generation: number }).generation === generation && (bRes as { generation: number }).generation === generation) {
      const sText = (sRes as { text: string }).text;
      const bText = (bRes as { text: string }).text;
      if (sText.trim().length === 0 || bText.trim().length === 0) {
        return { status: "unavailable", candidateId, reason: safeReason, generation };
      }
      if (sText.length > 200 || bText.length > 20000) {
        return { status: "unavailable", candidateId, reason: safeReason, generation };
      }
      return { status: "released", candidateId, evaluatedSubject: sText, evaluatedBody: bText, subjectChanged: sText !== subject, bodyChanged: bText !== body, generation };
    }
    if (sHeld && (sRes as { generation: number }).generation === generation && bValid && (bRes as { generation: number }).generation === generation) return { status: "held", candidateId, reason: (sRes as { reason: string }).reason, generation };
    if (bHeld2 && (bRes as { generation: number }).generation === generation && sValid && (sRes as { generation: number }).generation === generation) return { status: "held", candidateId, reason: (bRes as { reason: string }).reason, generation };
    return { status: "unavailable", candidateId, reason: safeReason, generation };
  }
  function getCandidateState(room: TwinRoom){
    let s = candidateByRoom.get(room);
    if(!s){ s = { epoch:0, attempt:0, active:false, timedOut:false, timer:null, pending:null, result:null, preview: null, revoke: null }; candidateByRoom.set(room,s); }
    return s;
  }
  function isCandidateActive(): boolean{
    return opts?.conversationInput === true && opts?.sessionPolicy === true && typeof opts?.candidateReasoner === "function";
  }
  function buildCandidateSnapshot(entry: RoomEntry, view: TwinRoomView): MeetingRoomCandidateSnapshot | undefined{
    if(!isCandidateActive()) return undefined;
    const st = candidateByRoom.get(entry.room);
    const mid = view.selectedMeetingId;
    if(st?.active && !st.timedOut){
      return { meetingId: mid, status:"pending", candidateId: null, provisional:true, policyChecked:false, approved:false, contextRevision:null, subject:null, body:null, sourceRefs: Object.freeze([] as CandidateSourceRef[]), note:"Drafting a private provisional candidate." };
    }
    if(st?.result && st.result.meetingId === mid){
      const r = st.result;
      if(r.status === "provisional"){
        return { meetingId: mid, status:"provisional", candidateId: r.candidateId, provisional:true, policyChecked:false, approved:false, contextRevision: r.contextRevision, subject: r.subject, body: r.body, sourceRefs: r.sourceRefs, note: r.note };
      } else {
        return { meetingId: mid, status:"failed", candidateId: r.candidateId, provisional:true, policyChecked:false, approved:false, contextRevision:null, subject:null, body:null, sourceRefs: Object.freeze([] as CandidateSourceRef[]), note: r.note };
      }
    }
    return { meetingId: mid, status:"none", candidateId: null, provisional:true, policyChecked:false, approved:false, contextRevision:null, subject:null, body:null, sourceRefs: Object.freeze([] as CandidateSourceRef[]), note:"No candidate yet." };
  }
  function buildCandidatePreviewSnapshot(entry: RoomEntry, view: TwinRoomView): CandidatePreview | { status: "stale"; candidateId: string; generation: number } | undefined {
    if (!isCandidateActive()) return undefined;
    const st = candidateByRoom.get(entry.room);
    if (!st || !st.preview) return undefined;
    if (st.active && !st.timedOut) return undefined;
    if (!st.result || st.result.status !== "provisional") return undefined;
    const r = st.result;
    if (r.meetingId !== view.selectedMeetingId) return undefined;
    const p = st.preview;
    if (p.candidateId !== r.candidateId) return { status: "stale", candidateId: p.candidateId, generation: p.generation };
    const curOwnerId = view.ownerId;
    const curMeetingId = view.selectedMeetingId;
    const curConv = conversationByRoom.get(entry.room)?.get(curMeetingId);
    const curRevision = curConv?.contextRevision ?? 0;
    const curGen = getPolicyGeneration(curOwnerId, curMeetingId);
    if (p.ownerId !== curOwnerId || p.meetingId !== curMeetingId || p.contextRevision !== curRevision || p.epoch !== st.epoch || p.generation !== curGen) {
      return { status: "stale", candidateId: p.candidateId, generation: p.generation };
    }
    if (p.preview === null) return undefined;
    return p.preview;
  }
  function invalidateCandidate(entry: RoomEntry){
    const s = getCandidateState(entry.room);
    s.epoch += 1;
    s.pending = null;
    s.result = null;
    s.preview = null;
    const rev = s.revoke;
    s.revoke = null;
    if(rev !== null) rev.fn();
  }
  function revokeOwnedCandidate(room: TwinRoom, onlyRoomId: string | null): void {
    const s = candidateByRoom.get(room);
    if(!s) return;
    const rev = s.revoke;
    if(rev === null) return;
    if(onlyRoomId !== null && rev.roomId !== onlyRoomId) return;
    s.revoke = null;
    rev.fn();
  }
  function dispatchCandidate(entry: RoomEntry, roomId: string, force = false){
    if(!isCandidateActive()) return;
    if(opts?.candidateAutoDispatch === false && !force) return;
    if(entry.demo !== null) return;
    const st = getCandidateState(entry.room);
    if(st.active) return;
    if(rooms.get(roomId) !== entry) return;
    const view = entry.room.view();
    if(view.twinStatus !== "active") return;
    const reasoner = opts?.candidateReasoner;
    if(reasoner === undefined) return;
    const ownerId = view.ownerId;
    const meetingId = view.selectedMeetingId;
    const convMap = conversationByRoom.get(entry.room);
    const conv = convMap?.get(meetingId);
    const contextRevision = conv?.contextRevision ?? 0;
    const policyGeneration = getPolicyGeneration(ownerId, meetingId);
    const epoch = st.epoch;
    const snapConv = conversationSnapshotFor(entry, view);
    const dispatchAttempt = st.attempt + 1;
    st.attempt = dispatchAttempt;
    const capturedAttempt = dispatchAttempt;
    const registerRevoke = (revoke: () => void): void => {
      const curSt = candidateByRoom.get(capturedEntry.room);
      if(curSt !== st) { revoke(); return; }
      if(curSt !== capturedState) { revoke(); return; }
      if(!curSt.active || curSt.timedOut) { revoke(); return; }
      if(curSt.attempt !== capturedAttempt) { revoke(); return; }
      if(curSt.epoch !== capturedEpoch) { revoke(); return; }
      if(rooms.get(capturedRoomId) !== capturedEntry) { revoke(); return; }
      const freshView = capturedEntry.room.view();
      if(freshView.ownerId !== capturedOwnerId || freshView.selectedMeetingId !== capturedMeetingId) { revoke(); return; }
      if(freshView.twinStatus !== "active") { revoke(); return; }
      const curConv = conversationByRoom.get(capturedEntry.room)?.get(capturedMeetingId);
      const curRevision = curConv?.contextRevision ?? 0;
      if(curRevision !== capturedContextRevision) { revoke(); return; }
      if(getPolicyGeneration(capturedOwnerId, capturedMeetingId) !== capturedPolicyGeneration) { revoke(); return; }
      curSt.revoke = { attempt: capturedAttempt, epoch: capturedEpoch, roomId: capturedRoomId, fn: revoke };
    };
    const input: CandidateReasonerInput = Object.freeze({
      roomId,
      ownerId,
      meetingId,
      contextRevision,
      policyGeneration,
      epoch,
      utterances: snapConv.utterances,
      guidance: Object.freeze([...view.guidance]),
      notes: Object.freeze([...view.notes]),
      registerRevoke,
    });
    let attemptsMap = candidateAttemptsByRoom.get(entry.room);
    if(!attemptsMap){ attemptsMap = new Map<string, number>(); candidateAttemptsByRoom.set(entry.room, attemptsMap); }
    const attempts = attemptsMap.get(meetingId) ?? 0;
    if(attempts >= candidateMaxAttempts){
      st.pending = null;
      st.result = { candidateId: randomUUID(), meetingId, status:"failed", contextRevision, subject:"", body:"", sourceRefs: Object.freeze([] as CandidateSourceRef[]), note:"Candidate unavailable: attempt limit reached. It was not retried." };
      return;
    }
    const capturedEntry = entry;
    const capturedRoomId = roomId;
    const capturedOwnerId = ownerId;
    const capturedMeetingId = meetingId;
    const capturedContextRevision = contextRevision;
    const capturedPolicyGeneration = policyGeneration;
    const capturedEpoch = epoch;
    const capturedState = st;
    st.active = true;
    st.timedOut = false;
    st.pending = null;
    st.result = null;
    st.preview = null;
    const deadlineTimer = setTimeout(()=>{
      const curSt = candidateByRoom.get(capturedEntry.room);
      if(!curSt) return;
      if(curSt !== capturedState) return;
      if(!curSt.active) return;
      if(curSt.timedOut) return;
      if(curSt.attempt !== capturedAttempt) return;
      const freshView = capturedEntry.room.view();
      const curConv = conversationByRoom.get(capturedEntry.room)?.get(capturedMeetingId);
      const curRevision = curConv?.contextRevision ?? 0;
      const freshOk =
        rooms.get(capturedRoomId) === capturedEntry &&
        freshView.ownerId === capturedOwnerId &&
        freshView.selectedMeetingId === capturedMeetingId &&
        freshView.twinStatus === "active" &&
        curRevision === capturedContextRevision &&
        getPolicyGeneration(capturedOwnerId, capturedMeetingId) === capturedPolicyGeneration &&
        curSt.epoch === capturedEpoch;
      curSt.timedOut = true;
      curSt.timer = null;
      if(curSt.revoke !== null && curSt.revoke.attempt === capturedAttempt){
        const rev = curSt.revoke;
        curSt.revoke = null;
        rev.fn();
      }
      if(freshOk){
        curSt.result = { candidateId: randomUUID(), meetingId: capturedMeetingId, status:"failed", contextRevision: capturedContextRevision, subject:"", body:"", sourceRefs: Object.freeze([] as CandidateSourceRef[]), note:"Candidate unavailable: reasoner timed out. It was not retried." };
      }
    }, candidateDeadlineMs);
    st.timer = deadlineTimer;
    let attemptsInc = candidateAttemptsByRoom.get(entry.room);
    if(!attemptsInc){ attemptsInc = new Map<string, number>(); candidateAttemptsByRoom.set(entry.room, attemptsInc); }
    attemptsInc.set(meetingId, (attemptsInc.get(meetingId) ?? 0) + 1);
    let p: Promise<unknown>;
    try{ p = reasoner(input); } catch(e){ p = Promise.reject(e); }
    p.then((val)=>{
      const curSt = candidateByRoom.get(entry.room);
      if(!curSt) return;
      if(curSt.revoke !== null && curSt.revoke.attempt === capturedAttempt) curSt.revoke = null;
      if(curSt.timedOut){
        if(curSt.timer){ clearTimeout(curSt.timer); curSt.timer = null; }
        // late settlement discarded, free slot and drain
        curSt.active = false;
        curSt.timedOut = false;
        const next = curSt.pending;
        curSt.pending = null;
        if(next !== null){
          dispatchCandidate(next.entry, next.roomId);
        }
        return;
      }
      if(curSt.timer){ clearTimeout(curSt.timer); curSt.timer = null; }
      curSt.active = false;
      const freshView = entry.room.view();
      const curConv = conversationByRoom.get(entry.room)?.get(meetingId);
      const curRevision = curConv?.contextRevision ?? 0;
      const freshOk =
        rooms.get(roomId) === entry &&
        freshView.ownerId === ownerId &&
        freshView.selectedMeetingId === meetingId &&
        freshView.twinStatus === "active" &&
        curRevision === contextRevision &&
        getPolicyGeneration(ownerId, meetingId) === policyGeneration &&
        curSt.epoch === epoch;
      if(freshOk){
        let ok = false;
        let subject = "";
        let body = "";
        let refs: readonly CandidateSourceRef[] = [];
        let reason = "invalid output";
        if(val !== null && typeof val === "object" && !Array.isArray(val)){
          const o = val as Record<string,unknown>;
          const s = o["subject"];
          const b = o["body"];
          const sr = o["sourceRefs"];
          if(typeof s === "string" && s.trim().length>0 && s.trim().length<=200 && s.length<=200 && typeof b === "string" && b.trim().length>0 && b.length<=20000 && Array.isArray(sr) && sr.length>0){
            let allOk = true;
            const tmp: CandidateSourceRef[] = [];
            for(const e of sr){
              if(e===null||typeof e!=="object"||Array.isArray(e)){ allOk=false; break; }
              const eo = e as Record<string,unknown>;
              if(typeof eo["utteranceId"]!=="string" || typeof eo["revision"]!=="number" || !Number.isSafeInteger(eo["revision"] as number)){ allOk=false; break; }
              const uid = eo["utteranceId"] as string;
              const rev = eo["revision"] as number;
              const match = (input.utterances as readonly { readonly utteranceId: string; readonly revision: number }[]).find((u) => u.utteranceId===uid && u.revision===rev);
              if(!match){ allOk=false; reason="unknown source reference"; break; }
              tmp.push(Object.freeze({ utteranceId:uid, revision:rev }) as CandidateSourceRef);
            }
            if(allOk){ ok=true; subject=s; body=b; refs=Object.freeze(tmp); }
          }
        }
        if(ok){
          const newId = randomUUID();
          curSt.result = { candidateId: newId, meetingId, status:"provisional", contextRevision, subject, body, sourceRefs: refs, note:"Private provisional candidate: not policy-checked, not approved, and it cannot be sent." };
          const preview = buildPreviewForResult(ownerId, meetingId, contextRevision, epoch, policyGeneration, newId, subject, body);
          curSt.preview = { preview, ownerId, meetingId, contextRevision, epoch, generation: policyGeneration, candidateId: newId };
        } else {
          curSt.result = { candidateId: randomUUID(), meetingId, status:"failed", contextRevision, subject:"", body:"", sourceRefs: Object.freeze([] as CandidateSourceRef[]), note: `Candidate rejected: ${reason}. It was not retried.` };
        }
      }
      const next = curSt.pending;
      curSt.pending = null;
      if(next !== null){
        dispatchCandidate(next.entry, next.roomId);
      }
    }, (err)=>{
      const curSt = candidateByRoom.get(entry.room);
      if(!curSt) return;
      if(curSt.revoke !== null && curSt.revoke.attempt === capturedAttempt) curSt.revoke = null;
      if(curSt.timedOut){
        if(curSt.timer){ clearTimeout(curSt.timer); curSt.timer = null; }
        curSt.active = false;
        curSt.timedOut = false;
        const next = curSt.pending;
        curSt.pending = null;
        if(next !== null){
          dispatchCandidate(next.entry, next.roomId);
        }
        return;
      }
      if(curSt.timer){ clearTimeout(curSt.timer); curSt.timer = null; }
      curSt.active = false;
      const freshView = entry.room.view();
      const curConv = conversationByRoom.get(entry.room)?.get(meetingId);
      const curRevision = curConv?.contextRevision ?? 0;
      const freshOk =
        rooms.get(roomId) === entry &&
        freshView.ownerId === ownerId &&
        freshView.selectedMeetingId === meetingId &&
        freshView.twinStatus === "active" &&
        curRevision === contextRevision &&
        getPolicyGeneration(ownerId, meetingId) === policyGeneration &&
        curSt.epoch === epoch;
      if(freshOk){
        curSt.result = { candidateId: randomUUID(), meetingId, status:"failed", contextRevision, subject:"", body:"", sourceRefs: Object.freeze([] as CandidateSourceRef[]), note:"Candidate rejected: request failed. It was not retried." };
      }
      const next = curSt.pending;
      curSt.pending = null;
      if(next !== null){
        dispatchCandidate(next.entry, next.roomId);
      }
    });
  }

  const policyStatusByScope = new Map<string, "applied" | "needs-clarification" | "not-applied">();
  function snap(roomId: string, entry: RoomEntry, view: TwinRoomView, sendNotice: string | null = null): MeetingRoomSnapshot {
    const current = entry.demo?.current() ?? null;
    const base: MeetingRoomSnapshot = {
      roomId,
      demo:
        entry.demo === null
          ? null
          : {
              stepLabel: current?.label ?? null,
              completed: entry.demo.completed(),
              total: DEMO_STEPS.length,
              done: current === null,
              caption: current?.caption ?? null,
              sendNote:
                (entry.demo.result("demo-send") as { skipped?: boolean } | undefined)?.skipped === true
                  ? DEMO_SEND_NOT_SENT
                  : null,
              comparison:
                (entry.demo.result("demo-compare") as { comparison?: unknown } | undefined)?.comparison ?? null,
              evidenceJson:
                typeof entry.demo.result("demo-evidence") === "string"
                  ? (entry.demo.result("demo-evidence") as string)
                  : null,
            },
      fakeSend: entry.testMode,
      restored: entry.reused || entry.room.restoredFromStore(),
      view,
      approvalNote: entry.room.approvalNote(),
      copyText: entry.room.copyText(),
      mailtoHref: entry.room.mailtoHref(),
      packageId: meetingRoomPackageId(view),
      sendNotice,
      evidencePreviewJson: entry.room.evidencePreviewJson(),
    };
    let out: MeetingRoomSnapshot = base as MeetingRoomSnapshot;
    if (opts?.sessionPolicy === true) {
      const gen = getPolicyGeneration(view.ownerId, view.selectedMeetingId);
      const st = policyStatusByScope.get(`${view.ownerId}\0${view.selectedMeetingId}`) ?? "none";
      const note =
        st === "applied"
          ? "Policy recorded; output enforcement is not active."
          : st === "needs-clarification"
            ? "Policy needs clarification."
            : st === "not-applied"
              ? "Policy not applied."
              : "No policy recorded.";
      (out as unknown as Record<string, unknown>).sessionPolicy = { meetingId: view.selectedMeetingId, generation: gen, status: st, note };
    }
    if (opts?.conversationInput === true) {
      out = { ...out, conversation: conversationSnapshotFor(entry, view) } as MeetingRoomSnapshot;
    }
    if(isCandidateActive()){
      const cand = buildCandidateSnapshot(entry, view);
      if(cand) out = { ...out, candidate: cand } as MeetingRoomSnapshot;
      const preview = buildCandidatePreviewSnapshot(entry, view);
      if (preview !== undefined) {
        out = { ...out, candidatePreview: preview } as MeetingRoomSnapshot;
      }
    }
    return out;
  }

  function notFound(): { status: number; body: MeetingRoomActionResult } {
    return {
      status: 404,
      body: { snapshot: null, announcements: ["This room expired. Reload to start again."] },
    };
  }

  function boundEntry(callerKey: string | null, roomId: unknown): RoomEntry | null {
    if (callerKey === null) return null;
    if (typeof roomId !== "string") return null;
    const e = rooms.get(roomId);
    if (e === undefined) return null;
    if (e.storeKey !== callerKey) return null;
    return e;
  }



  const service: MeetingRoomService = {
    open(search: string, headers: IncomingHttpHeaders, storeKey = "default"): MeetingRoomSnapshot {
      const testMode = meetingRoomFakeSendAllowed(env, headers);
      // A new store key past the cap evicts an open-only key first, else a
      // key idle for idleMs; only when every key acted recently is the page
      // refused, so neither a GET flood nor one browser can push others out.
      // A ?demo=1 page always gets its own fresh, unshared room and store;
      // it uses no store slot and records no activity for its key.
      const demoMode = isDemoMode(search);
      if (!demoMode && !stores.has(storeKey) && stores.size >= maxStores) {
        const victim = pickVictim(now());
        if (victim === null) throw new MeetingRoomBusyError();
        evictStoreKey(victim);
      }
      if (!demoMode) lastActive.set(storeKey, now());
      const sharedKey = `${storeKey}:${testMode ? "t" : "p"}`;
      const existingRoom = demoMode ? undefined : shared.get(sharedKey);
      const reused = existingRoom !== undefined;
      const room =
        existingRoom ??
        (() => {
          const created = createTwinRoom({
            testMode,
            store: demoMode ? createInMemoryRoomStore() : storeFor(storeKey),
            transport,
          });
          if (!demoMode) shared.set(sharedKey, created);
          return created;
        })();
      // The demo controller and roomId stay per page (per open() call).
      const demo = demoMode ? createDemoController(room) : null;
      const roomId = randomUUID();
      if (demoMode) {
        // Cap demo pages globally, evicting only the oldest demo page.
        if (demoPages.size >= maxDemoPages) {
          const oldestDemo = demoPages.values().next().value;
          if (oldestDemo !== undefined) {
            const evicted = rooms.get(oldestDemo);
            if(evicted !== undefined) revokeOwnedCandidate(evicted.room, null);
            demoPages.delete(oldestDemo);
            rooms.delete(oldestDemo);
          }
        }
      } else {
        // Cap real pages per store key, evicting only this key's own oldest
        // real page; demo pages never count against the key.
        let pages = 0;
        let oldestOfKey: string | null = null;
        for (const [id, entry] of rooms) {
          if (entry.storeKey === storeKey && entry.demo === null) {
            pages += 1;
            if (oldestOfKey === null) oldestOfKey = id;
          }
        }
        if (pages >= maxPagesPerKey && oldestOfKey !== null) {
          const evicted = rooms.get(oldestOfKey);
          if(evicted !== undefined) revokeOwnedCandidate(evicted.room, oldestOfKey);
          rooms.delete(oldestOfKey);
        }
      }
      const entry: RoomEntry = { room, demo, testMode, reused, storeKey };
      rooms.set(roomId, entry);
      if (demoMode) demoPages.add(roomId);
      const v0 = room.view();
      return snap(roomId, entry, v0);
    },

    async act(
      body: Readonly<Record<string, unknown>>,
      headers: IncomingHttpHeaders,
    ): Promise<{ status: number; body: MeetingRoomActionResult }> {
      const roomId = body["roomId"];
      if (typeof roomId !== "string") return notFound();
      const entry = rooms.get(roomId);
      if (entry === undefined) return notFound();
      // Demo pages record no activity (their key may have no store).
      if (entry.demo === null) lastActive.set(entry.storeKey, now());
      const bad = (
        message: string,
      ): { status: number; body: MeetingRoomActionResult } => ({
        status: 400,
        body: {
          snapshot: snap(roomId, entry, entry.room.view()),
          announcements: [message],
        },
      });
      const action = body["action"];
      if (typeof action !== "string") return bad("Unknown meeting room action.");
      if (action === "send") {
        // Re-check the gate with THIS request's headers and the current env;
        // a room opened in test mode still refuses a public Host here.
        if (!meetingRoomFakeSendAllowed(env, headers) || !entry.testMode) {
          return {
            status: 403,
            body: {
              snapshot: snap(roomId, entry, entry.room.view(), SEND_DISABLED_REASON),
              announcements: [SEND_DISABLED_REASON],
            },
          };
        }
        const before = entry.room.view();
        const outcome = await entry.room.send();
        const after = entry.room.view();
        const notice = outcome.ok ? null : (outcome.reason || "Send was refused.");
        if (entry.demo === null) acted.add(entry.storeKey);
        return {
          status: 200,
          body: {
            snapshot: snap(roomId, entry, after, notice),
            announcements: diffAnnouncements(before, after, {
              sendReason: outcome.reason,
            }),
          },
        };
      }
      const id = body["id"];
      const text = body["text"];
      if (
        (action === "select-meeting" ||
          action === "plugin-include" ||
          action === "plugin-exclude" ||
          action === "plugin-refresh") &&
        typeof id !== "string"
      ) {
        return bad(`Action ${action} needs a string id.`);
      }
      if (
        (action === "guide" || action === "edit-draft" || action === "compare") &&
        typeof text !== "string"
      ) {
        return bad(`Action ${action} needs string text.`);
      }
      // Input caps: refuse over-limit text (or a full guidance log) before
      // calling any room method. Only `text.length` is checked; over-limit
      // text is never scanned or redacted. The room is left unchanged.
      const overLimit = (
        message: string,
      ): { status: number; body: MeetingRoomActionResult } => ({
        status: 413,
        body: {
          snapshot: snap(roomId, entry, entry.room.view()),
          announcements: [message],
        },
      });
      if (
        action === "guide" &&
        (text as string).length > MEETING_ROOM_MAX_GUIDANCE_CHARS
      ) {
        return overLimit("Guidance is limited to 2,000 characters.");
      }
      if (
        action === "edit-draft" &&
        (text as string).length > MEETING_ROOM_MAX_DRAFT_CHARS
      ) {
        return overLimit("Draft edits are limited to 20,000 characters.");
      }
      if (
        action === "compare" &&
        (text as string).length > MEETING_ROOM_MAX_COMPARE_CHARS
      ) {
        return overLimit("Compared text is limited to 20,000 characters.");
      }
      if (
        action === "guide" &&
        entry.room.view().guidance.length >= MEETING_ROOM_MAX_GUIDANCE_ENTRIES
      ) {
        return {
          status: 400,
          body: {
            snapshot: snap(roomId, entry, entry.room.view()),
            announcements: ["At most 50 guidance entries per meeting."],
          },
        };
      }
      let policyAnnouncementStatus: "applied" | "needs-clarification" | "not-applied" | null = null;
      const before = entry.room.view();
      switch (action) {
        case "state":
          break;
        case "select-meeting": {
          try {
            entry.room.selectMeeting(id as string);
          } catch {
            return {
              status: 404,
              body: {
                snapshot: snap(roomId, entry, entry.room.view()),
                announcements: ["Unknown meeting."],
              },
            };
          }
          invalidateCandidate(entry);
          {
            const r = (entry as unknown as { room?: TwinRoom }).room;
            if (r) workerEpochByRoom.set(r, (workerEpochByRoom.get(r) ?? 0) + 1);
          }
          break;
        }
        case "stream-next":
          entry.room.streamNextLine();
          break;
        case "guide": {
          const guideResult = entry.room.guide(text as string);
          const recorded = (guideResult as { recorded: boolean }).recorded;
          if (opts?.sessionPolicy === true && recorded === true && entry.demo === null) {
            const v = entry.room.view();
            const rec = createMeetingPolicyRecorder(v.ownerId, v.selectedMeetingId).record(text as string);
            policyStatusByScope.set(`${v.ownerId}\0${v.selectedMeetingId}`, rec.status);
            policyAnnouncementStatus = rec.status;
          }
          invalidateCandidate(entry);
          break;
        }
        case "takeover":
          entry.room.takeOver();
          invalidateCandidate(entry);
          {
            const r = (entry as unknown as { room?: TwinRoom }).room;
            if (r) workerEpochByRoom.set(r, (workerEpochByRoom.get(r) ?? 0) + 1);
          }
          break;
        case "resume":
          entry.room.resume();
          invalidateCandidate(entry);
          {
            const r = (entry as unknown as { room?: TwinRoom }).room;
            if (r) workerEpochByRoom.set(r, (workerEpochByRoom.get(r) ?? 0) + 1);
          }
          break;
        case "edit-draft":
          entry.room.editDraft(text as string);
          invalidateCandidate(entry);
          break;
        case "approve":
          entry.room.approve();
          break;
        case "run-plugins":
          entry.room.runPlugins();
          googleExportEpochByRoom.set(entry.room as unknown as TwinRoom, (googleExportEpochByRoom.get(entry.room as unknown as TwinRoom) ?? 0) + 1);
          break;
        case "plugin-include":
          entry.room.approvePluginOutput(id as string);
          googleExportEpochByRoom.set(entry.room as unknown as TwinRoom, (googleExportEpochByRoom.get(entry.room as unknown as TwinRoom) ?? 0) + 1);
          break;
        case "plugin-exclude":
          entry.room.rejectPluginOutput(id as string);
          googleExportEpochByRoom.set(entry.room as unknown as TwinRoom, (googleExportEpochByRoom.get(entry.room as unknown as TwinRoom) ?? 0) + 1);
          break;
        case "plugin-refresh":
          entry.room.refreshPluginOutput(id as string);
          googleExportEpochByRoom.set(entry.room as unknown as TwinRoom, (googleExportEpochByRoom.get(entry.room as unknown as TwinRoom) ?? 0) + 1);
          break;
        case "compare":
          break;
        case "evidence-export":
          break;
        case "demo-next": {
          if (entry.demo === null) return bad("Demo is not enabled for this room.");
          // Decide whether Send is allowed inside the queued demo call, so an
          // overlapping Next cannot act on a stale "current step".
          const sendAllowed = meetingRoomFakeSendAllowed(env, headers) && entry.testMode;
          const outcome = await entry.demo.nextUnless((s) => s.id === "demo-send" && !sendAllowed);
          const current = rooms.get(roomId);
          if (current !== undefined && current !== entry) {
            // Restart replaced this demo while the call waited: report the
            // fresh room and do nothing on the old one.
            return {
              status: 200,
              body: { snapshot: snap(roomId, current, current.room.view()), announcements: [] },
            };
          }
          if (outcome !== null && outcome.skipped) {
            // Sending is unavailable here: record the Send step as not
            // attempted and continue the guide. Nothing is sent, the package
            // stays unsent, and no send receipt is created.
            const notes = [
              SEND_DISABLED_REASON,
              DEMO_SEND_NOT_SENT,
              demoStepAnnouncement({ label: outcome.step.label, caption: outcome.step.caption }),
            ];
            return {
              status: 200,
              body: { snapshot: snap(roomId, entry, entry.room.view()), announcements: notes },
            };
          }
          const step = outcome?.step ?? null;
          const after = entry.room.view();
          const announcements = diffAnnouncements(before, after);
          if (step !== null) {
            announcements.push(
              demoStepAnnouncement({ label: step.label, caption: step.caption }),
            );
          }
          return {
            status: 200,
            body: {
              snapshot: snap(roomId, entry, after),
              announcements,
              // Guided steps 7 and 8 return their outputs in the same fields
              // the Compare and Export actions use, so the page can show them.
              ...(step?.id === "demo-compare"
                ? { comparison: (entry.demo.result("demo-compare") as { comparison?: unknown } | undefined)?.comparison ?? null }
                : {}),
              ...(step?.id === "demo-evidence" && typeof entry.demo.result("demo-evidence") === "string"
                ? { evidenceJson: entry.demo.result("demo-evidence") as string }
                : {}),
            },
          };
        }
        case "demo-restart": {
          if (entry.demo === null) return bad("Demo is not enabled for this room.");
          // Restart the real demo: a fresh isolated room, store and controller
          // for this same page (same room id, browser key and demo-cap slot).
          // Ordinary rooms and their stores are never touched.
          // Reset the old controller first, so a Next still queued on it is
          // dropped and cannot act (for example Send) on the replaced room.
          entry.demo.reset();
          const freshRoom = createTwinRoom({
            testMode: entry.testMode,
            store: createInMemoryRoomStore(),
            transport,
          });
          const fresh: RoomEntry = {
            ...entry,
            room: freshRoom,
            demo: createDemoController(freshRoom),
            reused: false,
          };
          rooms.set(roomId, fresh);
          return {
            status: 200,
            body: {
              snapshot: snap(roomId, fresh, freshRoom.view()),
              announcements: ["Demo restarted with a fresh room."],
            },
          };
        }
        default:
          return bad("Unknown meeting room action.");
      }
      const after = entry.room.view();
      const result: {
        snapshot: MeetingRoomSnapshot;
        announcements: string[];
        evidenceJson?: string;
        comparison?: unknown;
        comparisonApproved?: boolean;
        comparisonReason?: string;
      } = {
        snapshot: snap(roomId, entry, after),
        announcements: diffAnnouncements(before, after),
      };
      if (policyAnnouncementStatus === "applied") result.announcements.push("Meeting policy recorded for this meeting.");
      else if (policyAnnouncementStatus === "needs-clarification") result.announcements.push("Meeting policy needs clarification: Please clarify the date restriction.");
      else if (policyAnnouncementStatus === "not-applied") result.announcements.push("Meeting policy not applied.");
      if (action === "compare") {
        const visible = entry.room.compareVisible(text as string);
        if (visible !== null) {
          result.comparison = visible.comparison;
          result.comparisonApproved = visible.approved;
        } else {
          result.comparison = null;
          const reason = compareUnavailableReason(after.twinStatus, after.draft.sendState);
          const resolvedReason = reason ?? "Compare is unavailable right now.";
          result.comparisonReason = resolvedReason;
          result.announcements.push(resolvedReason);
        }
      }
      if (action === "evidence-export") {
        const json = entry.room.exportEvidenceJson();
        if (json !== null) result.evidenceJson = json;
      }
      if (entry.demo === null && ACTING_ACTIONS.has(action)) acted.add(entry.storeKey);
      return { status: 200, body: result };
    },

    ingestConversationAs(
      callerKey: string | null,
      roomId: unknown,
      event: unknown,
    ): { status: number; body: MeetingRoomActionResult } {
      const entry = boundEntry(callerKey, roomId);
      if (entry === null) return notFound();
      const rid = roomId as string;
      const view = entry.room.view();
      if (opts?.conversationInput !== true) {
        return {
          status: 403,
          body: { snapshot: snap(rid, entry, view), announcements: ["Conversation input is not enabled."] },
        };
      }
      // strict v1 validation
      if (event === null || typeof event !== "object" || Array.isArray(event)) {
        return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      const ev = event as Record<string, unknown>;
      if (ev["version"] !== 1) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      const meetingId = ev["meetingId"];
      const utteranceId = ev["utteranceId"];
      const sequence = ev["sequence"];
      const revision = ev["revision"];
      const speaker = ev["speaker"];
      const text = ev["text"];
      if (typeof meetingId !== "string") return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if (typeof utteranceId !== "string" || utteranceId.length === 0) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if (typeof speaker !== "string" || speaker.length === 0) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if (typeof text !== "string") return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= 0) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      // only allowed keys
      const allowed = new Set(["version", "meetingId", "utteranceId", "sequence", "revision", "speaker", "text", "ownerId"]);
      for (const k of Object.keys(ev)) if (!allowed.has(k)) return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      if ("ownerId" in ev && ev["ownerId"] !== undefined) {
        if (typeof ev["ownerId"] !== "string") return { status: 400, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      if (text.length > 2000 || speaker.length > 200) {
        return { status: 413, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      // never trust supplied ownerId
      if (typeof ev["ownerId"] === "string" && ev["ownerId"] !== view.ownerId) {
        return { status: 403, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      if (meetingId !== view.selectedMeetingId) {
        return { status: 409, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      const conv = getConversationState(entry.room, meetingId);
      const existing = conv.utterances.get(utteranceId);
      if (existing !== undefined) {
        if (revision <= existing.revision) {
          return { status: 200, body: { snapshot: snap(rid, entry, view), announcements: [] } };
        }
        // correction: keep original sequence
        conv.utterances.set(utteranceId, { sequence: existing.sequence, revision, speaker, text });
        conv.contextRevision += 1;
        conv.latestCorrection = { utteranceId, revision };
        if(isCandidateActive()){
          const v = entry.room.view();
          if(v.twinStatus==="active"){
            const st=getCandidateState(entry.room);
            if(st.active){ revokeOwnedCandidate(entry.room, null); st.pending={ roomId: rid, entry }; } else dispatchCandidate(entry, rid);
          }
        }
        return { status: 200, body: { snapshot: snap(rid, entry, view), announcements: [] } };
      }
      conv.utterances.set(utteranceId, { sequence, revision, speaker, text });
      conv.contextRevision += 1;
      if(isCandidateActive()){
        const v = entry.room.view();
        if(v.twinStatus==="active"){
          const st=getCandidateState(entry.room);
          if(st.active){ revokeOwnedCandidate(entry.room, null); st.pending={ roomId: rid, entry }; } else dispatchCandidate(entry, rid);
        }
      }
      return { status: 200, body: { snapshot: snap(rid, entry, view), announcements: [] } };
    },

    async actAs(
      callerKey: string | null,
      body: Readonly<Record<string, unknown>>,
      headers: IncomingHttpHeaders,
    ): Promise<{ status: number; body: MeetingRoomActionResult }> {
      const roomId = body["roomId"];
      const entry = boundEntry(callerKey, roomId);
      if (entry === null) return notFound();
      const action = body["action"];
      if (action === "adopt-candidate") {
        const id = body["id"];
        const cr = body["contextRevision"];
        const pg = body["policyGeneration"];
        const view0 = entry.room.view();
        const badAdopt = (status: number, msg: string): { status: number; body: MeetingRoomActionResult } => ({
          status,
          body: { snapshot: snap(roomId as string, entry, view0), announcements: [msg] },
        });
        if (typeof id !== "string" || id.length === 0) return badAdopt(400, "Invalid adopt-candidate request.");
        if (typeof cr !== "number" || !Number.isSafeInteger(cr) || cr < 0 || typeof pg !== "number" || !Number.isSafeInteger(pg) || pg < 0) return badAdopt(400, "Invalid adopt-candidate request.");
        if (!isCandidateActive() || entry.demo !== null) return badAdopt(409, "Candidate is no longer available.");
        const st = getCandidateState(entry.room);
        if (st.active && !st.timedOut) return badAdopt(409, "Candidate is no longer available.");
        if (!st.result || st.result.status !== "provisional") return badAdopt(409, "Candidate is no longer available.");
        if (st.result.meetingId !== view0.selectedMeetingId) return badAdopt(409, "Candidate is no longer available.");
        const p = st.preview;
        if (!p || !p.preview || p.preview.status !== "released") return badAdopt(409, "Candidate is no longer available.");
        if (p.candidateId !== st.result.candidateId || st.result.candidateId !== id) return badAdopt(409, "Candidate is no longer available.");
        const curOwnerId = view0.ownerId;
        const curMeetingId = view0.selectedMeetingId;
        const curConv = conversationByRoom.get(entry.room)?.get(curMeetingId);
        const curRevision = curConv?.contextRevision ?? 0;
        const curGen = getPolicyGeneration(curOwnerId, curMeetingId);
        if (p.ownerId !== curOwnerId || p.meetingId !== curMeetingId || p.contextRevision !== curRevision || p.epoch !== st.epoch || p.generation !== curGen) return badAdopt(409, "Candidate is no longer available.");
        if (cr !== curRevision || pg !== curGen) return badAdopt(409, "Candidate is no longer available.");
        if (p.contextRevision !== cr || p.generation !== pg) return badAdopt(409, "Candidate is no longer available.");
        if (view0.draft.sendState !== "unsent") return badAdopt(409, "Candidate is no longer available.");
        const evaluatedSubject = p.preview.evaluatedSubject;
        const evaluatedBody = p.preview.evaluatedBody;
        const draftText = evaluatedSubject + "\n\n" + evaluatedBody;
        if (draftText.length > MEETING_ROOM_MAX_DRAFT_CHARS) return badAdopt(413, "Draft edits are limited to 20,000 characters.");
        try {
          entry.room.editDraft(draftText);
        } catch {
          return badAdopt(409, "Candidate is no longer available.");
        }
        const after = entry.room.view();
        if (entry.demo === null && ACTING_ACTIONS.has(action as string)) acted.add(entry.storeKey);
        return { status: 200, body: { snapshot: snap(roomId as string, entry, after), announcements: [] } };
      }
      if (action === "approve" || action === "send") {
        // Bind Approve and Send to the package this browser displayed. No
        // await runs between this check and the room action in act().
        const packageId = body["packageId"];
        const view = entry.room.view();
        if (
          typeof packageId !== "string" ||
          packageId.length > MEETING_ROOM_MAX_PACKAGE_ID_CHARS ||
          !/:[0-9a-f]{64}$/.test(packageId)
        ) {
          return {
            status: 400,
            body: {
              snapshot: snap(roomId as string, entry, view),
              announcements: [PACKAGE_ID_MISSING_REASON],
            },
          };
        }
        if (packageId !== meetingRoomPackageId(view)) {
          return {
            status: 409,
            body: {
              snapshot: snap(roomId as string, entry, view),
              announcements: [PACKAGE_ID_STALE_REASON],
            },
          };
        }
      }
      return service.act(body, headers);
    },

    finishConversationAs(callerKey: string | null, roomId: unknown): { status: number; body: MeetingRoomActionResult } {
      const entry = boundEntry(callerKey, roomId);
      if(entry === null || typeof roomId !== 'string' || entry.demo !== null) return notFound();
      if(!isCandidateActive()) return { status: 403, body: { snapshot: snap(roomId, entry, entry.room.view()), announcements: ['Candidate unavailable.'] } };
      const view = entry.room.view();
      if(view.twinStatus !== 'active' || view.draft.sendState !== 'unsent') return { status: 409, body: { snapshot: snap(roomId, entry, view), announcements: ['Conversation not ready to finish.'] } };
      const conv = conversationByRoom.get(entry.room)?.get(view.selectedMeetingId);
      if(!conv || conv.utterances.size === 0) return { status: 422, body: { snapshot: snap(roomId, entry, view), announcements: ['Conversation not prepared.'] } };
      if(candidateByRoom.get(entry.room)?.active) return { status: 409, body: { snapshot: snap(roomId, entry, view), announcements: ['Candidate already running.'] } };
      if((candidateAttemptsByRoom.get(entry.room)?.get(view.selectedMeetingId) ?? 0) >= candidateMaxAttempts) return { status: 429, body: { snapshot: snap(roomId, entry, view), announcements: ['Too many attempts.'] } };
      dispatchCandidate(entry, roomId, true);
      return { status: 202, body: { snapshot: snap(roomId, entry, entry.room.view()), announcements: ['Preparing redacted meeting context for review.'] } };
    },
approvedGoogleDraftAs(callerKey: string | null, roomId: unknown): Readonly<{identity: string; body: string}> | null {
    if (opts?.conversationInput !== true) return null;
    if (opts?.candidateAutoDispatch !== false) return null;
    if (typeof callerKey !== 'string' || callerKey.length === 0) return null;
    if (typeof roomId !== 'string') return null;
    const entry = boundEntry(callerKey, roomId);
    if (!entry || entry.demo !== null) return null;
    const view = entry.room.view();
    if (view.draft.approved !== true || view.draft.sendState !== "unsent") return null;
    const identity = JSON.stringify([view.ownerId, view.selectedMeetingId, view.draft.sha256, conversationByRoom.get(entry.room)?.get(view.selectedMeetingId)?.contextRevision ?? 0, getPolicyGeneration(view.ownerId, view.selectedMeetingId), candidateByRoom.get(entry.room)?.epoch ?? 0, workerEpochByRoom.get(entry.room) ?? 0, googleExportEpochByRoom.get(entry.room) ?? 0]);
    return Object.freeze({ identity, body: view.draft.body });
  },
  workerBindingAs(callerKey: string | null, roomId: unknown): Readonly<{ roomId: string; ownerId: string; meetingId: string; epoch: number }> | null {
    if (opts?.conversationInput !== true) return null;
    if (opts?.candidateAutoDispatch !== false) return null;
    if (typeof callerKey !== 'string' || callerKey.length === 0) return null;
    if (typeof roomId !== 'string') return null;
    const entry = boundEntry(callerKey, roomId);
    if (!entry || entry.demo !== null) return null;
    const view = entry.room.view();
    if (view.twinStatus !== 'active' || view.draft.sendState !== 'unsent') return null;
    return Object.freeze({ roomId, ownerId: view.ownerId, meetingId: view.selectedMeetingId, epoch: workerEpochByRoom.get(entry.room) ?? 0 });
  },
  correctConversationAs(callerKey: string | null, roomId: unknown, utteranceId: unknown, expectedRevision: unknown, text: unknown): { status: number; body: MeetingRoomActionResult } {
    if (typeof roomId !== "string") return notFound();
    const entry = boundEntry(callerKey, roomId);
    if (!entry || entry.demo !== null) return notFound();
    if (opts?.conversationInput !== true || opts?.candidateAutoDispatch !== false) return notFound();
    const view = entry.room.view();
    const snapshot = snap(roomId, entry, view);
    if (view.draft.sendState !== "unsent") return { status: 409, body: { snapshot, announcements: [] } };
    if (typeof utteranceId !== "string" || utteranceId.length === 0) return { status: 400, body: { snapshot, announcements: [] } };
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { status: 400, body: { snapshot, announcements: [] } };
    if (typeof text !== "string") return { status: 400, body: { snapshot, announcements: [] } };
    if (text.trim().length === 0) return { status: 400, body: { snapshot, announcements: [] } };
    if (text.indexOf(String.fromCharCode(0)) >= 0) return { status: 400, body: { snapshot, announcements: [] } };
    if (text.length > 2000) return { status: 413, body: { snapshot, announcements: [] } };
    const conv = conversationByRoom.get(entry.room)?.get(view.selectedMeetingId);
    const stored = conv?.utterances.get(utteranceId);
    if (!stored) return { status: 404, body: { snapshot, announcements: [] } };
    if (stored.revision !== expectedRevision) return { status: 409, body: { snapshot, announcements: ["Transcript changed. Review it again."] } };
    if (stored.text === text) return { status: 200, body: { snapshot, announcements: [] } };
    const event = { version: 1, meetingId: view.selectedMeetingId, utteranceId, sequence: stored.sequence, revision: stored.revision + 1, speaker: stored.speaker, text };
    return service.ingestConversationAs(callerKey, roomId, event);
  },
  candidateBindingAs(callerKey: string | null, roomId: unknown): (CandidateCurrentBinding & { readonly epoch: number }) | null {
      if (!isCandidateActive()) return null;
      const entry = boundEntry(callerKey, roomId);
      if (entry === null) return null;
      if (entry.demo !== null) return null;
      if (typeof roomId !== "string") return null;
      const st = candidateByRoom.get(entry.room);
      if (st === undefined) return null;
      if (!st.active) return null;
      if (st.timedOut) return null;
      const revoke = st.revoke;
      if (revoke === null) return null;
      if (revoke.roomId !== roomId) return null;
      if (revoke.attempt !== st.attempt) return null;
      if (revoke.epoch !== st.epoch) return null;
      const view = entry.room.view();
      const ownerId = view.ownerId;
      const meetingId = view.selectedMeetingId;
      const contextRevision = conversationByRoom.get(entry.room)?.get(meetingId)?.contextRevision ?? 0;
      const policyGeneration = getPolicyGeneration(ownerId, meetingId);
      const epoch = st.epoch;
      const binding: CandidateCurrentBinding & { readonly epoch: number } = { roomId, ownerId, meetingId, contextRevision, policyGeneration, epoch };
      if (!service.candidateIsCurrent(binding)) return null;
      return Object.freeze(binding);
    },

    candidateIsCurrent(binding: CandidateCurrentBinding): boolean {
      if (!isCandidateActive()) return false;
      if (binding.epoch === undefined) return false;
      if (!Number.isSafeInteger(binding.epoch)) return false;
      if (binding.epoch < 0) return false;
      const entry = rooms.get(binding.roomId);
      if (entry === undefined) return false;
      const st = candidateByRoom.get(entry.room);
      if (st === undefined) return false;
      if (!st.active) return false;
      if (st.timedOut) return false;
      const view = entry.room.view();
      const curRev = conversationByRoom.get(entry.room)?.get(binding.meetingId)?.contextRevision ?? 0;
      return view.ownerId === binding.ownerId && view.selectedMeetingId === binding.meetingId && view.twinStatus === "active" && curRev === binding.contextRevision && getPolicyGeneration(binding.ownerId, binding.meetingId) === binding.policyGeneration && st.epoch === binding.epoch;
    },
    sentBodies(): readonly string[] {
      return [...sent];
    },

    sizes(): { pages: number; stores: number; activity: number; demoPages: number } {
      return {
        pages: rooms.size,
        stores: stores.size,
        activity: lastActive.size,
        demoPages: demoPages.size,
      };
    },
  };
  return service;
}
