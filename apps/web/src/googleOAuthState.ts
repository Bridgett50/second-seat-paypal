import { randomBytes, createHash } from "node:crypto";

export type GoogleOAuthPurpose =
  | "calendar-read"
  | "meet-read"
  | "gmail-draft"
  | "gmail-send"
  | "docs-create";

const ALLOWED = new Set<string>([
  "calendar-read",
  "meet-read",
  "gmail-draft",
  "gmail-send",
  "docs-create",
]);
const STATE_RE = /^[0-9a-f]{64}$/;

export function createGoogleOAuthStateStore(opts?: {
  now?: () => number;
  ttlMs?: number;
  maxPending?: number;
}) {
  const nowFn = opts?.now ?? (() => Date.now());
  const ttlMs = opts?.ttlMs ?? 300000;
  const maxPending = opts?.maxPending ?? 200;
  if (opts?.now !== undefined && typeof opts.now !== "function") throw new Error("Invalid options");
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 300000 || !Number.isFinite(ttlMs))
    throw new Error("Invalid options");
  if (!Number.isSafeInteger(maxPending) || maxPending <= 0 || maxPending > 200)
    throw new Error("Invalid options");
  type Entry = { browserKey: string; purpose: GoogleOAuthPurpose; codeVerifier: string; expiresAt: number };
  const store = new Map<string, Entry>();
  function purge(t: number): void {
    for (const [k, v] of store) if (t >= v.expiresAt) store.delete(k);
  }
  function validKey(k: unknown): k is string {
    return typeof k === "string" && k.trim().length > 0 && k.length <= 200;
  }
  return {
    begin(browserKey: string, purpose: GoogleOAuthPurpose) {
      if (!validKey(browserKey) || !ALLOWED.has(purpose)) throw new Error("Invalid options");
      const t = nowFn();
      purge(t);
      let existing: string | null = null;
      for (const [s, e] of store) if (e.browserKey === browserKey) { existing = s; break; }
      if (existing) store.delete(existing);
      else if (store.size >= maxPending) throw new Error("Invalid options");
      const state = randomBytes(32).toString("hex");
      const codeVerifier = randomBytes(32).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
      const expiresAt = t + ttlMs;
      store.set(state, { browserKey, purpose, codeVerifier, expiresAt });
      return Object.freeze({ state, codeChallenge, codeChallengeMethod: "S256" as const, expiresAt });
    },
    consume(browserKey: string | null, state: unknown) {
      if (typeof browserKey !== "string" || !validKey(browserKey)) return null;
      if (typeof state !== "string" || !STATE_RE.test(state)) return null;
      const e = store.get(state);
      if (!e) return null;
      if (e.browserKey !== browserKey) return null;
      if (nowFn() >= e.expiresAt) { store.delete(state); return null; }
      store.delete(state);
      return Object.freeze({ codeVerifier: e.codeVerifier, purpose: e.purpose });
    },
    cancel(browserKey: string): void {
      if (!validKey(browserKey)) return;
      for (const [s, e] of store) if (e.browserKey === browserKey) { store.delete(s); break; }
    },
  };
}
