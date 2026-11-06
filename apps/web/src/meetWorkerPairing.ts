import { randomUUID } from "node:crypto";
export type MeetWorkerBinding = Readonly<{ roomId: string; ownerId: string; meetingId: string; epoch: number; }>;
type Deps = { readBinding: (callerKey: string | null, roomId: unknown) => MeetWorkerBinding | null; now?: () => number; };
type ApproveResult = Readonly<{ token: string; expiresAt: number; binding: MeetWorkerBinding; meetingUrl: string; displayName: string; }>;
type ConsumeResult = Readonly<{ binding: MeetWorkerBinding; meetingUrl: string; displayName: string; isCurrent(): boolean; revoke(): void; }>;
const TTL_MS = 120_000; const LEASE_MS = 7_200_000; const MAX_LIVE = 128;
const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
function isNonBlankString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
function isValidDisplayName(v: unknown): v is string {
  if (typeof v !== "string") return false; if (v.length === 0 || v.trim().length === 0) return false; if (v.length > 100) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c <= 0x1f || c === 0x7f) return false; if (c >= 0x80 && c <= 0x9f) return false; } return true;
}
function isValidBinding(b: MeetWorkerBinding | null | undefined): b is MeetWorkerBinding {
  if (b === null || b === undefined) return false; if (typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  if (!isNonBlankString(r["roomId"])) return false; if (!isNonBlankString(r["ownerId"])) return false; if (!isNonBlankString(r["meetingId"])) return false;
  const epoch = r["epoch"]; if (typeof epoch !== "number") return false; if (!Number.isSafeInteger(epoch)) return false; if (epoch < 0) return false; return true;
}
function copyBinding(b: MeetWorkerBinding): MeetWorkerBinding {
  return Object.freeze({ roomId: b.roomId, ownerId: b.ownerId, meetingId: b.meetingId, epoch: b.epoch });
}
function bindingsEqual(a: MeetWorkerBinding, b: MeetWorkerBinding): boolean { return a.roomId === b.roomId && a.ownerId === b.ownerId && a.meetingId === b.meetingId && a.epoch === b.epoch; }
function scopeKey(callerKey: string, roomId: string): string { return `${callerKey.length}:${callerKey}\u0000${roomId.length}:${roomId}`; }
type RecordEntry = { callerKey: string; roomId: string; scope: string; token: string; expiresAt: number; leaseExpiresAt: number; approvedAt: number; meetingUrl: string; displayName: string; binding: MeetWorkerBinding; consumed: boolean; revoked: boolean; };
export function createMeetWorkerPairing(deps: Deps): Readonly<{
  approve(callerKey: string | null, roomId: unknown, meetingUrl: unknown, displayName: unknown): ApproveResult | null;
  consume(token: unknown): ConsumeResult | null;
  revoke(callerKey: string | null, roomId: unknown): void;
}> {
  const readBinding = deps.readBinding; const nowFn = deps.now;
  const store = new Map<string, RecordEntry>();
  function revokeEntry(e: RecordEntry): void { if (e.revoked) return; e.revoked = true; if (store.get(e.scope) === e) store.delete(e.scope); }
  function revokeAll(): void { for (const e of store.values()) revokeEntry(e); }
  function safeNow(): number | null {
    try {
      const v = nowFn !== undefined ? nowFn() : Date.now();
      if (typeof v !== "number" || !Number.isFinite(v)) { revokeAll(); return null; }
      return v;
    } catch { revokeAll(); return null; }
  }
  function safeReadBinding(callerKey: string, roomId: string): MeetWorkerBinding | null {
    try {
      const b = readBinding(callerKey, roomId); if (b === null) return null;
      let roomIdV: unknown, ownerIdV: unknown, meetingIdV: unknown, epochV: unknown;
      try { roomIdV = (b as Record<string, unknown>)["roomId"]; ownerIdV = (b as Record<string, unknown>)["ownerId"]; meetingIdV = (b as Record<string, unknown>)["meetingId"]; epochV = (b as Record<string, unknown>)["epoch"]; } catch { return null; }
      const snap = Object.freeze({ roomId: roomIdV, ownerId: ownerIdV, meetingId: meetingIdV, epoch: epochV } as unknown as MeetWorkerBinding);
      if (!isValidBinding(snap)) return null; return snap;
    } catch { return null; }
  }
  function cleanup(now: number): void {
    for (const e of store.values()) {
      if (e.revoked) continue;
      if (!e.consumed) { if (now >= e.expiresAt) revokeEntry(e); }
      else { if (now >= e.leaseExpiresAt) revokeEntry(e); }
    }
  }
  function isCurrentCheck(entry: RecordEntry): boolean {
    if (entry.revoked) return false; if (store.get(entry.scope) !== entry) { entry.revoked = true; return false; }
    const n = safeNow(); if (n === null) { revokeEntry(entry); return false; }
    if (n >= entry.leaseExpiresAt) { revokeEntry(entry); return false; }
    let cur: MeetWorkerBinding | null;
    try { cur = safeReadBinding(entry.callerKey, entry.roomId); } catch { revokeEntry(entry); return false; }
    if (cur === null) { revokeEntry(entry); return false; }
    if (!bindingsEqual(cur, entry.binding)) { revokeEntry(entry); return false; }
    if (entry.revoked) return false; if (store.get(entry.scope) !== entry) { entry.revoked = true; return false; }
    return true;
  }
  const api = {
    approve(callerKey: string | null, roomId: unknown, meetingUrl: unknown, displayName: unknown): ApproveResult | null {
      if (!isNonBlankString(callerKey)) return null; if (!isNonBlankString(roomId)) return null;
      if (typeof meetingUrl !== "string") return null; if (!MEET_RE.test(meetingUrl)) return null; if (!isValidDisplayName(displayName)) return null;
      const n = safeNow(); if (n === null) return null; cleanup(n);
      const trusted = safeReadBinding(callerKey, roomId); if (trusted === null) return null; if (trusted.roomId !== roomId) return null;
      const sk = scopeKey(callerKey, roomId); if (store.size >= MAX_LIVE && !store.has(sk)) return null;
      const existing = store.get(sk); if (existing !== undefined) revokeEntry(existing);
      const token = randomUUID(); const expiresAt = n + TTL_MS; const leaseExpiresAt = n + LEASE_MS; const bindingCopy = copyBinding(trusted);
      const entry: RecordEntry = { callerKey, roomId, scope: sk, token, expiresAt, leaseExpiresAt, approvedAt: n, meetingUrl, displayName: displayName as string, binding: bindingCopy, consumed: false, revoked: false };
      store.set(sk, entry);
      return Object.freeze({ token, expiresAt, binding: bindingCopy, meetingUrl, displayName: displayName as string });
    },
    consume(token: unknown): ConsumeResult | null {
      if (typeof token !== "string") return null;
      let found: RecordEntry | null = null; for (const e of store.values()) if (e.token === token) { found = e; break; }
      if (found === null) return null; if (found.revoked) return null; if (found.consumed) return null;
      found.consumed = true;
      const n = safeNow(); if (n === null) { revokeEntry(found); return null; }
      cleanup(n);
      if (n >= found.expiresAt) { revokeEntry(found); return null; }
      const cur = safeReadBinding(found.callerKey, found.roomId);
      if (cur === null) { revokeEntry(found); return null; }
      if (!bindingsEqual(cur, found.binding)) { revokeEntry(found); return null; }
      if (found.revoked) return null; if (store.get(found.scope) !== found) { found.revoked = true; return null; }
      const entry = found;
      const lease: ConsumeResult = Object.freeze({
        binding: entry.binding, meetingUrl: entry.meetingUrl, displayName: entry.displayName,
        isCurrent(): boolean { return isCurrentCheck(entry); },
        revoke(): void { revokeEntry(entry); },
      });
      return lease;
    },
    revoke(callerKey: string | null, roomId: unknown): void {
      if (!isNonBlankString(callerKey)) return; if (!isNonBlankString(roomId)) return;
      const n = safeNow(); if (n === null) return; cleanup(n);
      const sk = scopeKey(callerKey, roomId); const e = store.get(sk); if (e === undefined) return; revokeEntry(e);
    },
  };
  return Object.freeze(api);
}
