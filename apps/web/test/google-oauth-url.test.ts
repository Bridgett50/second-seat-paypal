import { it, expect } from "vitest";
import { buildGoogleOAuthUrl } from "../src/googleOAuthUrl.js";
const cases = [
  ["calendar-read", "https://www.googleapis.com/auth/calendar.events.readonly"] as const,
  ["meet-read", "https://www.googleapis.com/auth/meetings.space.readonly"] as const,
  ["gmail-draft", "https://www.googleapis.com/auth/gmail.compose"] as const,
  ["gmail-send", "https://www.googleapis.com/auth/gmail.send"] as const,
  ["docs-create", "https://www.googleapis.com/auth/drive.file"] as const,
] as const;
const S = "a".repeat(64);
const C = "b".repeat(43);
const R = "https://example.test/oauth/callback";
const K = ["access_type","client_id","code_challenge","code_challenge_method","prompt","redirect_uri","response_type","scope","state"].sort();
it("table five purpose=>required literal scope URIs", () => {
  for (const [purpose, scope] of cases) {
    const u = new URL(buildGoogleOAuthUrl({ clientId: "fake-client", redirectUri: R, purpose, state: S, codeChallenge: C }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("fake-client");
    expect(u.searchParams.get("redirect_uri")).toBe(R);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(scope);
    expect(u.searchParams.get("state")).toBe(S);
    expect(u.searchParams.get("code_challenge")).toBe(C);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect([...u.searchParams.keys()].sort()).toEqual(K);
  }
});
it("accepts localhost http and rejects invalid", () => {
  for (const redirectUri of ["http://localhost:4173/callback","http://127.0.0.1:4173/callback","http://[::1]:4173/callback"]) {
    const u = new URL(Reflect.apply(buildGoogleOAuthUrl, null, [{ clientId: "fake-client", redirectUri, purpose: "calendar-read", state: S, codeChallenge: C }]));
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri);
  }
  const bad = [
    { redirectUri: "http://example.com/callback" },
    { redirectUri: "https://user:pass@example.test/callback" },
    { redirectUri: R + "?x=1" },
    { redirectUri: R + "#frag" },
    { redirectUri: "ftp://example.test/callback" },
    { redirectUri: "not-a-url" },
    { clientId: "" },
    { clientId: "a\x01b" },
    { state: "a".repeat(63) },
    { codeChallenge: "b".repeat(42) },
    { purpose: "toString" },
    { purpose: "__proto__" },
  ];
  for (const o of bad) {
    expect(() => Reflect.apply(buildGoogleOAuthUrl, null, [{ clientId: "fake-client", redirectUri: R, purpose: "calendar-read", state: S, codeChallenge: C, ...o }])).toThrow("Google authorization failed");
  }
});
