import { createHash } from "node:crypto";
import { googleDraftPackageHash, createGoogleDraftAdapter, type GoogleDraftPackage } from "./googleDraft.js";
type Outbox = ReturnType<typeof import("./googleWriteOutbox.js").createGoogleWriteOutbox>;
type ReadCurrent = (callerKey: string, roomId: string) => { identity: string; body: string } | null;
type Deps = { readCurrent: ReadCurrent; getToken: (k: string) => string | null; outbox: Outbox; fetcher: typeof fetch; now?: () => number };
type Entry = { pkg: GoogleDraftPackage; packageHash: string; identity: string; body: string; expiresAt: number; approved: boolean; used: boolean; claimed: boolean; fetchAttempted?: boolean };
const CAP = 128;
const TTL = 300000;
const MAX_K = 256;
function hasCtl(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c <= 0x1f || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return true; }
  return false;
}
function validKey(s: unknown): s is string { return typeof s === "string" && s.length > 0 && s.length <= MAX_K && s.trim().length > 0 && !hasCtl(s); }
function nowMs(now?: () => number): number | null { try { const n = now ? now() : Date.now(); if (typeof n !== "number" || !Number.isFinite(n)) return null; return n; } catch { return null; } }
function intentKey(callerKey: string, roomId: string, packageHash: string): string {
  return createHash("sha256").update(JSON.stringify([callerKey, roomId, "gmail-draft", packageHash]), "utf8").digest("hex");
}
export function createOwnerDraftExport(deps: Deps) {
  const { readCurrent, getToken, outbox, fetcher, now } = deps;
  const store = new Map<string, Entry>();
  const mk = (c: string, r: string) => c.length + ":" + c + "\0" + r;
  function prune(curNow: number) {
    for (const [k, e] of store) { if (curNow >= e.expiresAt) store.delete(k); }
  }
  function isExpired(e: Entry, curNow: number): boolean { return curNow >= e.expiresAt; }
  const api = {
    preview(callerKey: string, roomId: string, to: string, subject: string): Readonly<{ status: "preview"; package: GoogleDraftPackage; packageHash: string; expiresAt: number }> | Readonly<{ status: "denied"; reason: string }> {
      const deny = (reason: string): Readonly<{ status: "denied"; reason: string }> => Object.freeze({ status: "denied", reason });
      const denied = deny("Invalid request");
      if (!validKey(callerKey) || !validKey(roomId)) return denied;
      const key = mk(callerKey, roomId);
      store.delete(mk(callerKey, roomId));
      const t = nowMs(now); if (t === null) return denied;
      prune(t);
      let cur: { identity: string; body: string } | null;
      try { cur = readCurrent(callerKey, roomId); } catch { return deny("No approved draft yet"); }
      if (!cur || typeof cur.identity !== "string" || typeof cur.body !== "string") return deny("No approved draft yet");
      if (cur.identity.trim().length === 0 || cur.identity.length > 1024 || hasCtl(cur.identity)) return deny("Draft identity missing");
      if (typeof cur.body !== "string") return deny("No approved draft yet");
      const body = cur.body; const identity = cur.identity;
      const pkgRaw = Object.freeze({ to, subject, body });
      let hash: string;
      try { hash = googleDraftPackageHash(pkgRaw); } catch { return deny("Invalid draft package"); }
      // validate explicit owner to/subject unchanged via hash already does; need to ensure pkg equals frozen snapshot
      const pkg = Object.freeze({ to, subject, body }) as GoogleDraftPackage;
      // verify hash used pkg exact (googleDraftPackageHash validates to/subject/body constraints)
      // cap check after prune
      if (store.size >= CAP) return deny("Too many pending previews");
      const expiresAt = t + TTL;
      if (!Number.isFinite(expiresAt)) return denied;
      const entry: Entry = { pkg, packageHash: hash, identity, body, expiresAt, approved: false, used: false, claimed: false };
      store.set(key, entry);
      return Object.freeze({ status: "preview", package: pkg, packageHash: hash, expiresAt } as const);
    },
    approve(callerKey: string, roomId: string, expectedHash: string): Readonly<{ status: "approved"; packageHash: string }> | Readonly<{ status: "denied" }> {
      const denied = Object.freeze({ status: "denied" } as const);
      if (!validKey(callerKey) || !validKey(roomId) || typeof expectedHash !== "string") return denied;
      const t = nowMs(now); if (t === null) return denied;
      const key = mk(callerKey, roomId);
      const e = store.get(key);
      // backwards clock deny: if now < expiresAt-TTL (i.e. now < creation) treat as deny
      if (e && t < e.expiresAt - TTL) { store.delete(key); return denied; }
      prune(t);
      const ent = store.get(key);
      if (!ent) return denied;
      if (ent.used) return denied;
      if (isExpired(ent, t)) { store.delete(key); return denied; }
      if (ent.packageHash !== expectedHash) return denied;
      let cur: { identity: string; body: string } | null;
      try { cur = readCurrent(callerKey, roomId); } catch { store.delete(key); return denied; }
      if (!cur || cur.identity !== ent.identity || cur.body !== ent.body) { store.delete(key); return denied; }
      ent.approved = true;
      return Object.freeze({ status: "approved", packageHash: ent.packageHash } as const);
    },
    async create(callerKey: string, roomId: string, expectedHash: string, signal: AbortSignal): Promise<Readonly<{ status: string; packageHash?: string; draftId?: string; messageId?: string; journalStatus?: string }>> {
      const denied = Object.freeze({ status: "denied", packageHash: expectedHash } as const);
      const genericDenied = Object.freeze({ status: "denied" } as const);
      if (!validKey(callerKey) || !validKey(roomId) || typeof expectedHash !== "string") return genericDenied;
      const t = nowMs(now); if (t === null) return genericDenied;
      const key = mk(callerKey, roomId);
      const ent = store.get(key);
      if (!ent) return genericDenied;
      if (t < ent.expiresAt - TTL) { store.delete(key); return genericDenied; }
      if (isExpired(ent, t)) { store.delete(key); return genericDenied; }
      if (ent.packageHash !== expectedHash) return genericDenied;
      if (!ent.approved || ent.used) return genericDenied;
      let cur: { identity: string; body: string } | null;
      try { cur = readCurrent(callerKey, roomId); } catch { return genericDenied; }
      if (!cur || cur.identity !== ent.identity || cur.body !== ent.body) { store.delete(key); return genericDenied; }
      // synchronously mark before adapter call
      ent.approved = false; ent.used = true;
      const pkg = ent.pkg; const pkgHash = ent.packageHash;
      const ik = intentKey(callerKey, roomId, pkgHash);
      // Build fresh adapter with trusted closures
      const isCurrent = (browserKey: string, hash: string): boolean => {
        if (browserKey !== callerKey) return false;
        const curEnt = store.get(mk(browserKey, roomId));
        if (!curEnt) return false;
        const tn = nowMs(now); if (tn === null) return false;
        if (tn >= curEnt.expiresAt) return false;
        if (tn < curEnt.expiresAt - TTL) return false;
        if (curEnt.used !== true) return false;
        if (curEnt !== ent) return false;
        if (curEnt.packageHash !== hash) return false;
        let c2: { identity: string; body: string } | null;
        try { c2 = readCurrent(browserKey, roomId); } catch { return false; }
        if (!c2) return false;
        return c2.identity === curEnt.identity && c2.body === curEnt.body;
      };
      let claimCalled = false;
      const claimApproval = (browserKey: string, hash: string): boolean => {
        if (claimCalled) return false;
        claimCalled = true;
        if (!isCurrent(browserKey, hash)) return false;
        let ok: boolean;
        try { ok = outbox.claim(ik); } catch { return false; }
        if (!ok) return false;
        ent.claimed = true;
        return true;
      };
      const adapter = createGoogleDraftAdapter({ fetcher, getToken: (k: string) => { if (k !== callerKey || !isCurrent(k, pkgHash)) return null; try { return getToken(k); } catch { return null; } }, claimApproval, isCurrent });
      let receipt: Awaited<ReturnType<ReturnType<typeof createGoogleDraftAdapter>>>;
      try { receipt = await adapter(callerKey, pkg, signal); } catch {
        receipt = ent.claimed ? { status: "unconfirmed", packageHash: pkgHash } as Awaited<ReturnType<ReturnType<typeof createGoogleDraftAdapter>>> : { status: "denied" } as Awaited<ReturnType<ReturnType<typeof createGoogleDraftAdapter>>>;
      }
      if (ent.claimed) {
        let settleOk = false;
        if (receipt.status === "created") {
          try { outbox.settle(ik, { status: "confirmed", providerId: receipt.draftId }); settleOk = true; } catch { settleOk = false; }
        } else {
          try { outbox.settle(ik, { status: "unconfirmed" }); settleOk = true; } catch { settleOk = false; }
        }
        if (receipt.status === "created") {
          return Object.freeze({ ...receipt, journalStatus: settleOk ? "confirmed" : "unconfirmed" } as const);
        }
        return Object.freeze(receipt as Readonly<{ status: string; packageHash?: string; draftId?: string; messageId?: string; journalStatus?: string }>);
      }
      if (receipt.status === "created") {
        return Object.freeze({ ...receipt, journalStatus: "unconfirmed" } as const);
      }
      return Object.freeze(receipt as Readonly<{ status: string; packageHash?: string; draftId?: string; messageId?: string; journalStatus?: string }>);
    },
    invalidate(callerKey: string, roomId: string): void {
      if (!validKey(callerKey) || !validKey(roomId)) return;
      store.delete(mk(callerKey, roomId));
    }
  };
  // bounded pending approval only in memory, outbox metadata only, not email delivery
  return Object.freeze(api);
}
