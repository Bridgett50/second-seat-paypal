import { createHash } from "node:crypto";
export type GoogleDraftPackage = Readonly<{ to: string; subject: string; body: string }>;
type ReceiptDenied = Readonly<{ status: "denied"; packageHash?: string; reason?: string }>;
type ReceiptUnconfirmed = Readonly<{ status: "unconfirmed"; packageHash: string; reason?: string }>;
const RECONNECT_GMAIL = "Reconnect Gmail";
type ReceiptCreated = Readonly<{ status: "created"; draftId: string; messageId: string; packageHash: string }>;
type Receipt = ReceiptDenied | ReceiptUnconfirmed | ReceiptCreated;
const MAX_BROWSER_KEY = 256, MAX_TOKEN = 8192, MAX_ID = 512;
function isPlainNullProto(o: unknown): boolean {
  if (typeof o !== "object" || o === null) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}
function checkString(s: unknown): s is string { return typeof s === "string"; }
function hasControls(s: string, allowCRLFTab: boolean): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x7f) return true;
    if (c <= 0x1f) { if (allowCRLFTab && (c === 0x0d || c === 0x0a || c === 0x09)) continue; return true; }
    if (c >= 0x80 && c <= 0x9f) return true;
  } return false;
}
function hasUnpairedSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (Number.isNaN(n) || n < 0xdc00 || n > 0xdfff) return true; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return true;
  } return false;
}
function validateEmail(to: string): void {
  if (to.length === 0 || to.length > 320) throw new Error("Invalid package");
  if (/[\s\x00-\x1f\x7f\x80-\x9f,<>]/.test(to)) throw new Error("Invalid package");
  const at = to.indexOf("@"); if (at <= 0 || at !== to.lastIndexOf("@") || at === to.length - 1) throw new Error("Invalid package");
  const local = to.slice(0, at), domain = to.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) throw new Error("Invalid package");
  if (!/^[A-Za-z0-9._+\-]+$/.test(local)) throw new Error("Invalid package");
  const labels = domain.split("."); if (labels.length < 2) throw new Error("Invalid package");
  for (const l of labels) { if (l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-") || !/^[A-Za-z0-9\-]+$/.test(l)) throw new Error("Invalid package"); }
}
function strictSnapshot(pkg: unknown): GoogleDraftPackage {
  if (!isPlainNullProto(pkg)) throw new Error("Invalid package");
  const keys = Reflect.ownKeys(pkg as object);
  if (keys.length !== 3) throw new Error("Invalid package");
  const want = new Set(["to", "subject", "body"]);
  for (const k of keys) { if (typeof k !== "string" || !want.has(k)) throw new Error("Invalid package"); }
  for (const n of want) {
    const d = Object.getOwnPropertyDescriptor(pkg as object, n);
    if (!d || !d.enumerable || typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) throw new Error("Invalid package");
  }
  const rec = pkg as Record<string, unknown>;
  const to = rec["to"], subject = rec["subject"], body = rec["body"];
  if (!checkString(to) || !checkString(subject) || !checkString(body)) throw new Error("Invalid package");
  // Reject unpaired surrogates to avoid hash/MIME byte loss; deliberate safe policy.
  if (hasUnpairedSurrogate(to) || hasUnpairedSurrogate(subject) || hasUnpairedSurrogate(body)) throw new Error("Invalid package");
  validateEmail(to);
  if (subject.length === 0 || subject.length > 200 || subject.trim().length === 0 || hasControls(subject, false)) throw new Error("Invalid package");
  if (body.length === 0 || body.length > 20000 || body.trim().length === 0 || hasControls(body, true)) throw new Error("Invalid package");
  return Object.freeze({ to, subject, body });
}
export function googleDraftPackageHash(pkg: unknown): string {
  const s = strictSnapshot(pkg);
  const j = JSON.stringify({ to: s.to, subject: s.subject, body: s.body });
  return createHash("sha256").update(j, "utf8").digest("hex");
}
function b64urlUtf8(s: string): string { return Buffer.from(s, "utf8").toString("base64url"); }
function b64Folded(b64: string): string { let o = ""; for (let i = 0; i < b64.length; i += 76) o += b64.slice(i, i + 76) + "\r\n"; return o; }
function encodeWordRFC2047(s: string): string {
  const bytes = Buffer.from(s, "utf8");
  if (bytes.length === 0) return "=?UTF-8?B??=";
  // Build codepoint chunks with max 45 UTF-8 bytes each to keep encoded-word <=75 chars: "=?UTF-8?B?"(10)+60+ "?="(2)=72
  const chunks: string[] = []; let cur = "", curLen = 0;
  for (const ch of s) { const bl = Buffer.byteLength(ch, "utf8"); if (curLen + bl > 45) { chunks.push(cur); cur = ch; curLen = bl; } else { cur += ch; curLen += bl; } }
  if (cur) chunks.push(cur);
  return chunks.map(c => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`).join("\r\n ");
}
function buildMime(snap: GoogleDraftPackage): string {
  let h = ""; h += `To: ${snap.to}\r\nSubject: ${encodeWordRFC2047(snap.subject)}\r\n`;
  h += "MIME-Version: 1.0\r\n"; h += "Content-Type: text/plain; charset=UTF-8\r\n"; h += "Content-Transfer-Encoding: base64\r\n";
  const bodyB64 = b64Folded(Buffer.from(snap.body, "utf8").toString("base64"));
  return h + "\r\n" + bodyB64;
}
function validBrowserKey(k: unknown): k is string {
  return typeof k === "string" && k.length > 0 && k.length <= MAX_BROWSER_KEY && k.trim().length > 0 && !hasControls(k, false);
}
function validToken(t: string): boolean { return t.length > 0 && t.length <= MAX_TOKEN && /^[A-Za-z0-9._~+\/\-]+=*$/u.test(t); }
function validId(id: unknown): id is string { return typeof id === "string" && id.trim().length > 0 && id.length <= MAX_ID && id.trim() === id && !hasControls(id, false); }
export function createGoogleDraftAdapter(deps: {
  fetcher: typeof fetch; getToken: (browserKey: string) => string | null;
  claimApproval: (browserKey: string, packageHash: string) => boolean; isCurrent: (browserKey: string, packageHash: string) => boolean;
}) {
  const { fetcher, getToken, claimApproval, isCurrent } = deps;
  return async function createDraft(browserKey: string, pkg: GoogleDraftPackage, signal: AbortSignal): Promise<Receipt> {
    let snap: GoogleDraftPackage | null = null; let pkgHash: string | null = null;
    const denied = (extra?: { packageHash: string }): ReceiptDenied => Object.freeze(extra ? { status: "denied", packageHash: extra.packageHash } as const : { status: "denied" } as const);
    const abortCheck = (s: unknown): boolean => { try { return !!(s as AbortSignal).aborted; } catch { return false; } };
    const validSignal = (s: unknown): s is AbortSignal => { try { return typeof s === "object" && s !== null && typeof (s as AbortSignal).aborted === "boolean" && typeof (s as AbortSignal).addEventListener === "function"; } catch { return false; } };
    if (!validBrowserKey(browserKey) || !validSignal(signal)) return denied();
    if (abortCheck(signal)) return denied();
    try { snap = strictSnapshot(pkg); } catch { return denied(); }
    const snapFixed = snap;
    pkgHash = createHash("sha256").update(JSON.stringify({ to: snapFixed.to, subject: snapFixed.subject, body: snapFixed.body }), "utf8").digest("hex");
    const mime = buildMime(snapFixed);
    const raw = b64urlUtf8(mime);
    const bodyStr = JSON.stringify({ message: { raw } });
    const init: RequestInit = { method: "POST", redirect: "error", headers: { Authorization: "", "Content-Type": "application/json" }, signal: signal as AbortSignal, body: bodyStr };
    let token: string | null;
    try { token = getToken(browserKey as string); } catch { return denied({ packageHash: pkgHash }); }
    if (typeof token !== "string" || !validToken(token)) { const reconnect: ReceiptDenied = Object.freeze({ status: "denied", packageHash: pkgHash, reason: RECONNECT_GMAIL }); return reconnect; }
    (init.headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    let cur: boolean; try { cur = isCurrent(browserKey as string, pkgHash); } catch { return denied({ packageHash: pkgHash }); }
    if (!cur) return denied({ packageHash: pkgHash });
    if (abortCheck(signal)) return denied({ packageHash: pkgHash });
    let claimed: boolean; try { claimed = claimApproval(browserKey as string, pkgHash); } catch { return denied({ packageHash: pkgHash }); }
    if (!claimed) return denied({ packageHash: pkgHash });
    let cur2: boolean; try { cur2 = isCurrent(browserKey as string, pkgHash); } catch { return denied({ packageHash: pkgHash }); }
    if (!cur2) return denied({ packageHash: pkgHash });
    if (abortCheck(signal)) return denied({ packageHash: pkgHash });
    // Caller should maintain a durable outbox; this adapter has no restart-safe exactly-once guarantee and is not production connected.
    let resp: Response;
    try { resp = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/drafts", init as RequestInit); } catch { return Object.freeze({ status: "unconfirmed", packageHash: pkgHash } as const); }
    let ok: boolean; try { ok = resp.ok; } catch { return Object.freeze({ status: "unconfirmed", packageHash: pkgHash } as const); }
    if (!ok) {
      let code = 0; try { code = resp.status; } catch { code = 0; }
      const r: ReceiptUnconfirmed = code === 401 ? Object.freeze({ status: "unconfirmed", packageHash: pkgHash, reason: RECONNECT_GMAIL }) : Object.freeze({ status: "unconfirmed", packageHash: pkgHash });
      return r;
    }
    let j: unknown; try { j = await resp.json(); } catch { return Object.freeze({ status: "unconfirmed", packageHash: pkgHash } as const); }
    try {
      if (typeof j !== "object" || j === null) throw new Error("bad");
      const rec = j as Record<string, unknown>;
      const id = rec["id"]; const msg = rec["message"];
      if (!validId(id)) throw new Error("bad");
      if (typeof msg !== "object" || msg === null) throw new Error("bad");
      const mid = (msg as Record<string, unknown>)["id"];
      if (!validId(mid)) throw new Error("bad");
      // successful valid provider receipt remains created even if revoked after submission
      return Object.freeze({ status: "created", draftId: id as string, messageId: mid as string, packageHash: pkgHash } as const);
    } catch { return Object.freeze({ status: "unconfirmed", packageHash: pkgHash } as const); }
  };
}
