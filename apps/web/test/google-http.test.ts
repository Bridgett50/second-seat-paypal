import { it, expect, vi } from "vitest";
import { createGoogleConnections } from "../src/googleConnections.js";
import { createGoogleHttp } from "../src/googleHttp.js";
import type { GoogleRequest } from "../src/googleHttp.js";
const origin = "http://localhost:4173";
const redirectUri = origin + "/api/google/oauth/callback";
const now = 0;
function isUrlBody(v: unknown): v is { authorizationUrl: string } {
  if (typeof v !== "object" || v === null) return false;
  if (!("authorizationUrl" in v)) return false;
  return typeof Reflect.get(v, "authorizationUrl") === "string";
}
function make() {
  const fetcher = vi.fn(async () => Response.json({ access_token: "fictional-access", refresh_token: "fictional-refresh", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events.readonly" }));
  const connections = createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri, now: () => now, fetcher });
  const http = createGoogleHttp({ connections, origin });
  const base = (): GoogleRequest => ({ method: "POST", path: "/api/google/connect", callerKey: "browser-A", origin, body: { purpose: "calendar-read" }, query: new URLSearchParams() });
  const send = (o: Partial<GoogleRequest>): ReturnType<typeof http> => http({ ...base(), ...o });
  return { fetcher, http, send };
}
it("rejects bad requests without fetching", async () => {
  const { fetcher, send } = make();
  const checks: Array<{ override: Partial<GoogleRequest>; expected: number }> = [
    { override: { callerKey: null }, expected: 401 },
    { override: { origin: "http://evil.example" }, expected: 403 },
    { override: { body: { purpose: "invalidpurpose" } }, expected: 400 },
    { override: { body: { purpose: "calendar-read", extra: 1 } }, expected: 400 },
    { override: { method: "GET" }, expected: 405 },
  ];
  for (const { override, expected } of checks) {
    const r = await send(override);
    expect(r.status).toBe(expected);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.headers["Referrer-Policy"]).toBe("no-referrer");
    if (expected === 405) expect(r.headers["Allow"]).toBe("POST");
    const s = JSON.stringify(r.body);
    expect(s.includes("fictional-access")).toBe(false);
    expect(s.includes("fictional-refresh")).toBe(false);
    expect(s.includes("fake-secret")).toBe(false);
  }
  expect(fetcher).toHaveBeenCalledTimes(0);
});
it("connect issues oauth url and status empty", async () => {
  const { fetcher, send } = make();
  const r = await send({});
  expect(r.status).toBe(200);
  expect(isUrlBody(r.body)).toBe(true);
  if (!isUrlBody(r.body)) throw new Error("missing authorizationUrl");
  const u = new URL(r.body.authorizationUrl);
  expect(u.host).toBe("accounts.google.com");
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  expect(u.searchParams.get("state")?.length).toBeGreaterThan(0);
  expect(u.searchParams.get("code_challenge")?.length).toBeGreaterThan(0);
  expect(fetcher).toHaveBeenCalledTimes(0);
  const s = await send({ callerKey: "browser-B", method: "GET", path: "/api/google/status", body: undefined });
  expect(s.body).toEqual({ connections: [] });
  expect(JSON.stringify(s.body).includes("fictional-access")).toBe(false);
  expect(JSON.stringify(s.body).includes("fictional-refresh")).toBe(false);
});
it("rejects non-loopback http origin at construction", () => {
  const fetcher = vi.fn(async () => Response.json({ access_token: "fictional-access", refresh_token: "fictional-refresh", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events.readonly" }));
  const connections = createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri, now: () => now, fetcher });
  expect(() => createGoogleHttp({ connections, origin: "http://evil.example" })).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(0);
});

it("callback binds state to initiator and status reflects connection", async () => {
  const { fetcher, send } = make();
  const begin = await send({});
  expect(begin.status).toBe(200);
  expect(isUrlBody(begin.body)).toBe(true);
  if (!isUrlBody(begin.body)) throw new Error("missing authorizationUrl");
  const rawState = new URL(begin.body.authorizationUrl).searchParams.get("state");
  if (!rawState) throw new Error("missing state");
  const state = rawState;
  const bad = await send({ method: "GET", path: "/api/google/oauth/callback", callerKey: "browser-B", origin: null, body: null, query: new URLSearchParams({ state, code: "fake-code" }) });
  expect(bad.status).toBe(303);
  expect(bad.headers.Location).toBe("/meeting-room?google=not-connected");
  expect(fetcher).toHaveBeenCalledTimes(0);
  const ok = await send({ method: "GET", path: "/api/google/oauth/callback", callerKey: "browser-A", origin: null, body: null, query: new URLSearchParams({ state, code: "fake-code" }) });
  expect(ok.status).toBe(303);
  expect(ok.headers.Location).toBe("/meeting-room?google=connected");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const replay = await send({ method: "GET", path: "/api/google/oauth/callback", callerKey: "browser-A", origin: null, body: null, query: new URLSearchParams({ state, code: "fake-code" }) });
  expect(replay.status).toBe(303);
  expect(replay.headers.Location).toBe("/meeting-room?google=not-connected");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const aStatus = await send({ method: "GET", path: "/api/google/status", callerKey: "browser-A", body: undefined });
  expect(aStatus.body).toEqual({ connections: [{ purpose: "calendar-read", expiresAt: 3600000 }] });
  const bStatus = await send({ method: "GET", path: "/api/google/status", callerKey: "browser-B", body: undefined });
  expect(bStatus.body).toEqual({ connections: [] });
  for (const v of [begin, bad, ok, replay, aStatus, bStatus]) {
    const s = JSON.stringify(v.body) + JSON.stringify(v.headers);
    expect(s.includes("fictional-access")).toBe(false);
    expect(s.includes("fictional-refresh")).toBe(false);
    expect(s.includes("fake-secret")).toBe(false);
    expect(s.includes("fake-code")).toBe(false);
  }
});

it("disconnect during in-flight exchange revokes token and callback stays not-connected", async () => {
  const { fetcher, send } = make();
  const begin = await send({});
  expect(isUrlBody(begin.body)).toBe(true);
  if (!isUrlBody(begin.body)) throw new Error("missing authorizationUrl");
  const state = new URL(begin.body.authorizationUrl).searchParams.get("state")!;
  let resolveEntered!: () => void;
  const entered = new Promise<void>((r) => { resolveEntered = r; });
  let resolveHeld!: (v: Response) => void;
  const held = new Promise<Response>((r) => { resolveHeld = r; });
  fetcher.mockImplementationOnce(async () => { resolveEntered(); return held; });
  const pending = send({ method: "GET", path: "/api/google/oauth/callback", callerKey: "browser-A", origin: null, body: null, query: new URLSearchParams({ state, code: "fake-code" }) });
  await entered;
  const disc = await send({ method: "POST", path: "/api/google/disconnect", callerKey: "browser-A", origin, body: {} });
  expect(disc.status).toBe(200);
  resolveHeld(Response.json({ access_token: "fictional-access", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events.readonly" }));
  const cb = await pending;
  expect(cb.status).toBe(303);
  expect(cb.headers.Location).toBe("/meeting-room?google=not-connected");
  const st = await send({ method: "GET", path: "/api/google/status", callerKey: "browser-A", body: undefined });
  expect(st.body).toEqual({ connections: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const replay = await send({ method: "GET", path: "/api/google/oauth/callback", callerKey: "browser-A", origin: null, body: null, query: new URLSearchParams({ state, code: "fake-code" }) });
  expect(replay.headers.Location).toBe("/meeting-room?google=not-connected");
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const v of [disc, cb, st, replay]) { const s = JSON.stringify(v.body) + JSON.stringify(v.headers); expect(s.includes("fictional-access")).toBe(false); expect(s.includes("fake-code")).toBe(false); }
});
