import { createGoogleOAuthStateStore, type GoogleOAuthPurpose } from "./googleOAuthState.js";
import { GOOGLE_SCOPES, buildGoogleOAuthUrl } from "./googleOAuthUrl.js";
import { exchangeGoogleCode } from "./googleTokenExchange.js";

type Grant = { accessToken: string; expiresAt: number };
type Entry = { generation: object; pendingUntil: number; grants: Map<GoogleOAuthPurpose, Grant> };

export function createGoogleConnections(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  now?: () => number;
  fetcher?: typeof fetch;
  maxConnections?: number;
}) {
  const max = opts.maxConnections ?? 200;
  if (!Number.isSafeInteger(max) || max <= 0 || max > 200) throw new Error("Invalid configuration");
  const s = opts.clientSecret;
  if (typeof s !== "string" || s.trim() === "" || s.length > 4096 || /[\x00-\x1F\x7F]/.test(s))
    throw new Error("Invalid configuration");
  buildGoogleOAuthUrl({
    clientId: opts.clientId,
    redirectUri: opts.redirectUri,
    purpose: "calendar-read" as GoogleOAuthPurpose,
    state: "a".repeat(64),
    codeChallenge: "b".repeat(43),
  });
  const now = opts.now ?? Date.now;
  const store = createGoogleOAuthStateStore({ now });
  const entries = new Map<string, Entry>();

  function prune(): void {
    const t = now();
    for (const [k, e] of entries) {
      for (const [p, g] of e.grants) if (g.expiresAt <= t) e.grants.delete(p);
      if (e.pendingUntil !== 0 && e.pendingUntil <= t) {
        store.cancel(k);
        e.pendingUntil = 0;
      }
      if (e.grants.size === 0 && e.pendingUntil === 0) entries.delete(k);
    }
  }

  return {
    begin(browserKey: string, purpose: GoogleOAuthPurpose): { url: string; expiresAt: number } {
      prune();
      if (!entries.has(browserKey) && entries.size >= max) throw new Error("Invalid configuration");
      const st = store.begin(browserKey, purpose);
      let e = entries.get(browserKey);
      if (e) {
        e.generation = {};
        e.pendingUntil = st.expiresAt;
      } else {
        e = { generation: {}, pendingUntil: st.expiresAt, grants: new Map() };
        entries.set(browserKey, e);
      }
      const url = buildGoogleOAuthUrl({
        clientId: opts.clientId,
        redirectUri: opts.redirectUri,
        purpose,
        state: st.state,
        codeChallenge: st.codeChallenge,
      });
      return Object.freeze({ url, expiresAt: st.expiresAt });
    },

    async complete(browserKey: string, state: unknown, code: string): Promise<boolean> {
      const entry = entries.get(browserKey);
      if (!entry) return false;
      const consumed = store.consume(browserKey, state as string);
      if (!consumed) return false;
      const gen = entry.generation;
      const start = now();
      let res: { accessToken: string; expiresIn: number };
      try {
        res = await exchangeGoogleCode(
          {
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
            redirectUri: opts.redirectUri,
            code,
            codeVerifier: consumed.codeVerifier,
            requiredScope: (GOOGLE_SCOPES as Record<GoogleOAuthPurpose, string>)[consumed.purpose],
          },
          opts.fetcher,
        );
      } catch {
        return false;
      }
      const cur = entries.get(browserKey);
      if (cur !== entry || cur.generation !== gen) return false;
      const expiresAt = start + res.expiresIn * 1000;
      if (expiresAt <= now()) return false;
      cur.grants.set(consumed.purpose, { accessToken: res.accessToken, expiresAt });
      if (cur.generation === gen) cur.pendingUntil = 0;
      return true;
    },

    status(browserKey: string): readonly { purpose: GoogleOAuthPurpose; expiresAt: number }[] {
      prune();
      const e = entries.get(browserKey);
      if (!e) return Object.freeze([]);
      const out = [...e.grants.entries()].map(([purpose, g]) => Object.freeze({ purpose, expiresAt: g.expiresAt }));
      return Object.freeze(out);
    },

    getAccessToken(browserKey: string, purpose: GoogleOAuthPurpose): string | null {
      prune();
      const g = entries.get(browserKey)?.grants.get(purpose);
      return g ? g.accessToken : null;
    },

    disconnect(browserKey: string): void {
      store.cancel(browserKey);
      entries.delete(browserKey);
    },
  };
}
