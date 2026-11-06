import { expect, test } from "vitest";
import { createServer, type Server as NodeServer } from "node:http";
import { createWebServer } from "../src/server.js";
import { createGoogleConnections } from "../src/googleConnections.js";
import { createOwnerGoogleHttp } from "../src/ownerGoogleHttp.js";

async function listen(server: NodeServer): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("no port");
  return `http://127.0.0.1:${(a as { port: number }).port}`;
}
async function closeServer(s: NodeServer): Promise<void> {
  if (!s.listening) return;
  s.closeAllConnections();
  await new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));
}

test("google server integration", async () => {
  // --- unconfigured default server: 404 + flag 0 ---
  const defInner = createWebServer();
  const defFront = createServer((req, res) => {
    defInner.emit("request", req, res);
  });
  const defOrigin = await listen(defFront);
  try {
    const r404 = await fetch(defOrigin + "/api/google/status", { redirect: "manual" });
    expect(r404.status).toBe(404);
    const html0 = await (await fetch(defOrigin + "/meeting-room")).text();
    expect(html0).toContain('data-google-connect="0"');
  } finally {
    await closeServer(defFront);
  }

  // --- configured server ---
  const fakeJson: Record<string, unknown> = {
    access_token: "synthetic-access",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/calendar.events.readonly",
  };
  let fetchCount = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCount++;
    return new Response(JSON.stringify(fakeJson), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  let inner: ReturnType<typeof createWebServer> | null = null;
  const front = createServer((req, res) => {
    if (inner) inner.emit("request", req, res);
    else {
      res.statusCode = 503;
      res.end();
    }
  });
  const origin = await listen(front);
  const redirectUri = origin + "/api/google/oauth/callback";
  const connections = createGoogleConnections({
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret-not-live",
    redirectUri,
    now: () => 1000,
    fetcher: fakeFetch,
  });
  const controller = createOwnerGoogleHttp({ origin, connections });
  inner = createWebServer({ googleHttp: controller });

  try {
    // GET /meeting-room gives Cookie + data-google-connect=1 and demo flag 0
    const res = await fetch(origin + "/meeting-room");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-google-connect="1"');
    // no CORS headers on page
    expect(res.headers.has("access-control-allow-origin")).toBe(false);
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) throw new Error("no set-cookie");
    const cookie: string = setCookie.split(";")[0] ?? "";
    if (!cookie) throw new Error("empty cookie");

    const demoRes = await fetch(origin + "/meeting-room?demo=1");
    const demoHtml = await demoRes.text();
    expect(demoHtml).toContain('data-google-connect="0"');

    // POST connect same-origin+cookie -> authorizationUrl
    const connectRes = await fetch(origin + "/api/google/connect", {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "calendar-read" }),
    });
    expect(connectRes.status).toBe(200);
    expect(connectRes.headers.get("cache-control")).toBe("no-store");
    expect([...connectRes.headers.keys()].some((k) => k.toLowerCase().startsWith("access-control-"))).toBe(false);
    const connectBody = (await connectRes.json()) as { authorizationUrl: string };
    const authUrl = new URL(connectBody.authorizationUrl);
    expect(authUrl.hostname).toBe("accounts.google.com");
    const state = authUrl.searchParams.get("state");
    if (!state) throw new Error("no state");
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    // foreign cookie callback with same state -> 303 not-connected, fetch 0
    const foreignCookie = "mr_store=00000000-0000-4000-a000-000000000000";
    const foreignCb = await fetch(origin + `/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`, {
      redirect: "manual",
      headers: { Cookie: foreignCookie },
    });
    expect(foreignCb.status).toBe(303);
    expect(foreignCb.headers.get("location")).toBe("/meeting-room?google=not-connected");
    expect(fetchCount).toBe(0);

    // owning callback -> 303 connected, no-store, empty body, fetch 1
    const owningCb = await fetch(origin + `/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`, {
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    expect(owningCb.status).toBe(303);
    expect(owningCb.headers.get("location")).toBe("/meeting-room?google=connected");
    expect(owningCb.headers.get("cache-control")).toBe("no-store");
    const cbText = await owningCb.text();
    expect(cbText).toBe("");
    expect(fetchCount).toBe(1);

    // status same cookie -> metadata only
    const statusRes = await fetch(origin + "/api/google/status", { headers: { Cookie: cookie } });
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get("cache-control")).toBe("no-store");
    expect([...statusRes.headers.keys()].some((k) => k.toLowerCase().startsWith("access-control-"))).toBe(false);
    const statusBody = (await statusRes.json()) as { connections: Array<{ purpose: string; expiresAt: number }> };
    expect(statusBody.connections).toEqual([{ purpose: "calendar-read", expiresAt: 3601000 }]);
    const statusStr = JSON.stringify(statusBody);
    expect(statusStr).not.toMatch(/synthetic-access/);
    expect(statusStr).not.toMatch(/synthetic-code/);
    expect(statusStr.toLowerCase()).not.toContain("secret");
    // also ensure no token in headers
    const statusLoc = statusRes.headers.get("location") ?? "";
    expect(statusLoc).not.toMatch(/synthetic-access/);

    // replay callback -> 303 not-connected, fetch still 1
    const replay = await fetch(origin + `/api/google/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`, {
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe("/meeting-room?google=not-connected");
    expect(fetchCount).toBe(1);

    // malicious origin rejected 403 before exchange
    const malRes = await fetch(origin + "/api/google/connect", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "calendar-read" }),
    });
    expect(malRes.status).toBe(403);
    expect(fetchCount).toBe(1);

    // extra POST body rejected 400 before exchange
    const extraRes = await fetch(origin + "/api/google/connect", {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "calendar-read", extra: 1 }),
    });
    expect(extraRes.status).toBe(400);
    expect(fetchCount).toBe(1);

    // no cookie 401
    const noCookieRes = await fetch(origin + "/api/google/connect", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "calendar-read" }),
    });
    expect(noCookieRes.status).toBe(401);
    expect(fetchCount).toBe(1);

    // no CORS on any google endpoint
    for (const u of [connectRes, statusRes, owningCb]) {
      expect([...u.headers.keys()].some((k) => k.toLowerCase().startsWith("access-control-"))).toBe(false);
    }
  } finally {
    await closeServer(front);
  }
});
