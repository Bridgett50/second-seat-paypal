import { describe, it, expect } from "vitest";
import http from "node:http";
import net from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import { startOwnerMeetServer, type StartCapture } from "../src/ownerMeetServer.js";
import type { createGoogleConnections } from "../src/googleConnections.js";
type FakeConns = ReturnType<typeof createGoogleConnections>;
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const ok = a !== null && typeof a === "object" && "port" in a && typeof (a as { port: unknown }).port === "number";
      if (!ok) { s.close(() => rej(new Error("bad address"))); return; }
      const p = (a as { port: number }).port;
      s.close((e) => e ? rej(e) : res(p));
    });
  });
}
type Resp = { status: number; body: string; headers: IncomingHttpHeaders };
function request(opts: { method: string; path: string; port: number; body?: unknown; cookie?: string; origin?: string | null }): Promise<Resp> {
  const hasBody = opts.body !== undefined;
  const raw = hasBody ? JSON.stringify(opts.body) : null;
  const headers: Record<string, string> = { Host: `localhost:${opts.port}` };
  if (opts.method === "POST") {
    const o = opts.origin === null ? undefined : (opts.origin ?? `http://localhost:${opts.port}`);
    if (o !== undefined) headers["Origin"] = o;
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(raw ? Buffer.byteLength(raw) : 0);
  } else if (opts.origin) headers["Origin"] = opts.origin;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: opts.port, method: opts.method, path: opts.path, headers, agent: false }, (res) => {
      let d = ""; res.on("data", (c) => d += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d, headers: res.headers }));
    });
    req.on("error", reject); if (raw) req.write(raw); req.end();
  });
}
function cookieFrom(headers: IncomingHttpHeaders): string {
  const sc = headers["set-cookie"]; const first = Array.isArray(sc) ? sc[0] : sc; if (!first) throw new Error("no set-cookie"); return first.split(";")[0]!.trim();
}
describe("owner meet google", () => {
  it("configured: flag+status+connect+origin+auth", async () => {
    const port = await freePort(); let launches = 0; let counter = 0;
    const beginArgs: { k: string; p: string }[] = [];
    const fakeconnections: FakeConns = {
      begin(browserKey: string, purpose: string) { beginArgs.push({ k: browserKey, p: purpose }); return { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic-client&state=synthetic-state", expiresAt: 9999999999999 }; },
      status() { return []; },
      complete: async () => { counter++; return false; },
      getAccessToken() { return null; },
      disconnect() {},
    };
    const startCapture: StartCapture = async () => { launches++; return { sample: async () => [], stop: async () => {} }; };
    const h = await startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture, googleConnections: fakeconnections });
    try {
      const r1 = await request({ method: "GET", path: "/meeting-room", port });
      expect(r1.status).toBe(200); expect(r1.body).toContain('data-google-connect="1"');       expect(r1.body).toContain('data-ai-drafting="0"'); expect(r1.body).toContain('data-meet-worker="1"');
      const cookie = cookieFrom(r1.headers); expect(cookie).toMatch(/^[A-Za-z0-9_-]+=[A-Za-z0-9_-]+$/);
      const r2 = await request({ method: "GET", path: "/api/google/status", port, cookie });
      expect(r2.status).toBe(200); expect(JSON.parse(r2.body)).toEqual({ connections: [] });
      const r3 = await request({ method: "POST", path: "/api/google/connect", port, cookie, body: { purpose: "calendar-read" } });
      expect(r3.status).toBe(200); const j3 = JSON.parse(r3.body) as { authorizationUrl: string }; expect(j3.authorizationUrl).toContain("accounts.google.com");
      expect(beginArgs.length).toBe(1); expect(beginArgs[0]!.p).toBe("calendar-read");
      const ownerKey = cookie.split("=")[1]!; expect(beginArgs[0]!.k).toBe(ownerKey);
      const rEvil = await request({ method: "POST", path: "/api/google/connect", port, cookie, origin: "https://evil.example", body: { purpose: "calendar-read" } });
      expect(rEvil.status).toBe(403); expect(beginArgs.length).toBe(1);
      const rNo = await request({ method: "POST", path: "/api/google/connect", port, body: { purpose: "calendar-read" } });
      expect(rNo.status).toBe(401); expect(launches).toBe(0); expect(counter).toBe(0);
    } finally { await h.stop(); expect(h.server.listening).toBe(false); }
  }, 20000);
  it("default: no google controller", async () => {
    const port = await freePort(); let launches = 0;
    const startCapture: StartCapture = async () => { launches++; return { sample: async () => [], stop: async () => {} }; };
    const h = await startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture });
    try {
      const r1 = await request({ method: "GET", path: "/meeting-room", port });
      expect(r1.status).toBe(200); expect(r1.body).toContain('data-google-connect="0"');
      const cookie = cookieFrom(r1.headers);
      expect((await request({ method: "GET", path: "/api/google/status", port, cookie })).status).toBe(404);
      expect((await request({ method: "POST", path: "/api/google/connect", port, cookie, body: { purpose: "calendar-read" } })).status).toBe(404);
      expect(launches).toBe(0);
    } finally { await h.stop(); expect(h.server.listening).toBe(false); }
  }, 20000);
});
