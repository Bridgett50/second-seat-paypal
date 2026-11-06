export async function exchangeGoogleCode(
  args: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    requiredScope: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scope: string }> {
  try {
    const g: () => never = () => {
      throw new Error("Google authorization failed");
    };
    const s = args.requiredScope;
    const allowed = [
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/drive.file",
    ];
    if (!allowed.includes(s)) g();
    for (const v of [args.clientId, args.clientSecret, args.code]) {
      clean(v, 4096);
    }
    if (typeof args.codeVerifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(args.codeVerifier)) g();
    let u: URL;
    try {
      u = new URL(args.redirectUri);
    } catch {
      g();
      u = new URL("https://example.com");
    }
    if (u.username || u.password || u.search || u.hash) g();
    if (u.protocol === "https:") {
      if (!u.hostname) g();
    } else if (u.protocol === "http:") {
      if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) g();
    } else g();
    const body = new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
      code_verifier: args.codeVerifier,
      grant_type: "authorization_code",
    });
    const res = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-store" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) g();
    const data: unknown = await res.json();
    if (typeof data !== "object" || data === null) g();
    const r = data as Record<string, unknown>;
    if (typeof r["token_type"] !== "string" || r["token_type"].toLowerCase() !== "bearer") g();
    const at = clean(r["access_token"], 8192);
    const ei = r["expires_in"];
    if (typeof ei !== "number" || !Number.isSafeInteger(ei) || ei < 1 || ei > 86400) g();
    const sc = clean(r["scope"], 8192);
    if (!sc.split(/\s+/).includes(s)) g();
    let rt: string | undefined;
    if (r["refresh_token"] !== undefined) rt = clean(r["refresh_token"], 8192);
    const out: { accessToken: string; refreshToken?: string; expiresIn: number; scope: string } = rt
      ? { accessToken: at, refreshToken: rt, expiresIn: ei, scope: sc }
      : { accessToken: at, expiresIn: ei, scope: sc };
    return Object.freeze(out);
  } catch {
    throw new Error("Google authorization failed");
  }
}
function clean(value: unknown, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error("Google authorization failed");
  if (/[\x00-\x1F\x7F]/.test(value)) throw new Error("Google authorization failed");
  return value;
}
