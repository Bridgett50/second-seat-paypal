import { it, expect } from "vitest";
import { exchangeGoogleCode } from "../src/googleTokenExchange.js";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const base = { clientId: "fake-client", clientSecret: "fake-secret", code: "fake-code", codeVerifier: "a".repeat(43), requiredScope: SCOPE };
const validBody = { access_token: "made-up-access", refresh_token: "made-up-refresh", expires_in: 3600, token_type: "Bearer", scope: SCOPE, extra: "ignored" };
it("valid exchange posts correct form and returns frozen object", async () => {
  for (const redirectUri of ["https://example.test/callback", "http://[::1]:4173/callback"]) {
    let url = ""; let init: RequestInit = {}; let calls = 0;
    const fetcher: typeof fetch = async (i, o) => {
      calls++; url = String(i); init = o as RequestInit;
      return new Response(JSON.stringify(validBody), { status: 200 });
    };
    await expect(exchangeGoogleCode({ ...base, redirectUri }, fetcher)).resolves.toEqual({
      accessToken: "made-up-access", refreshToken: "made-up-refresh", expiresIn: 3600, scope: SCOPE,
    });
    expect(calls).toBe(1);
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const p = new URLSearchParams(init.body as string);
    expect([...p.keys()].sort()).toEqual(["client_id", "client_secret", "code", "code_verifier", "grant_type", "redirect_uri"].sort());
    expect(p.get("client_id")).toBe("fake-client");
    expect(p.get("client_secret")).toBe("fake-secret");
    expect(p.get("redirect_uri")).toBe(redirectUri);
    expect(p.get("code")).toBe("fake-code");
    expect(p.get("code_verifier")).toBe("a".repeat(43));
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(Object.isFrozen(await exchangeGoogleCode({ ...base, redirectUri }, async () => new Response(JSON.stringify(validBody), { status: 200 })))).toBe(true);
  }
});
it("malformed responses reject with generic message", async () => {
  const cases: Array<[string, () => typeof fetch]> = [
    ["no access_token", () => async () => new Response(JSON.stringify({ ...validBody, access_token: undefined }), { status: 200 }) as Response],
    ["token_type Basic", () => async () => new Response(JSON.stringify({ ...validBody, token_type: "Basic" }), { status: 200 })],
    ["expires_in 0", () => async () => new Response(JSON.stringify({ ...validBody, expires_in: 0 }), { status: 200 })],
    ["scope wrong", () => async () => new Response(JSON.stringify({ ...validBody, scope: "https://www.googleapis.com/auth/drive.file" }), { status: 200 })],
    ["refresh_token control char", () => async () => new Response(JSON.stringify({ ...validBody, refresh_token: "bad\x01token" }), { status: 200 })],
    ["http 400 with fake-secret", () => async () => new Response(JSON.stringify({ error: "fake-secret" }), { status: 400 })],
    ["network throw fake-secret", () => async () => { throw new Error("fake-secret network"); }],
    ["bad json", () => async () => new Response("not-json", { status: 200 })],
  ];
  for (const [, make] of cases) {
    let calls = 0;
    const inner = make() as unknown as typeof fetch;
    const fetcher: typeof fetch = async (a, b) => { calls++; return inner(a, b); };
    await expect(exchangeGoogleCode({ ...base, redirectUri: "https://example.test/callback" }, fetcher)).rejects.toThrow("Google authorization failed");
    expect(calls).toBe(1);
    try { await exchangeGoogleCode({ ...base, redirectUri: "https://example.test/callback" }, fetcher); } catch (e) {
      expect((e as Error).message).toBe("Google authorization failed");
      expect((e as Error).message).not.toContain("fake-secret");
      expect(String(e)).not.toContain("fake-secret");
    }
  }
});
it("invalid inputs never call fetch", async () => {
  const invalids = [
    { ...base, code: "", redirectUri: "https://example.test/callback" },
    { ...base, codeVerifier: "short", redirectUri: "https://example.test/callback" },
    { ...base, requiredScope: "https://www.googleapis.com/auth/bogus.scope", redirectUri: "https://example.test/callback" },
    { ...base, redirectUri: "http://example.com/callback" },
  ];
  for (const args of invalids) {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response(JSON.stringify(validBody), { status: 200 }); };
    await expect(exchangeGoogleCode(args, fetcher)).rejects.toThrow("Google authorization failed");
    expect(calls).toBe(0);
  }
});
