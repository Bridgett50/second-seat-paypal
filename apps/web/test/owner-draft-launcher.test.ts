import { test, expect } from "vitest";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { startOwnerMeetServer, type StartCapture } from "../src/ownerMeetServer.js";
import { createGoogleConnections } from "../src/googleConnections.js";

test("owner draft launcher html and method guard", async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") { s.close(() => reject(new Error("bad address"))); return; }
      const p = a.port;
      s.close((e) => (e ? reject(e) : resolve(p)));
    });
  });
  const dir = mkdtempSync(join(tmpdir(), "ss-test-run-owner-draft-launcher-"));
  const journalPath = join(dir, "writes.jsonl");
  const calls: Parameters<typeof fetch>[] = [];
  const fakeFetch: typeof fetch = async (...args: Parameters<typeof fetch>) => {
    calls.push(args);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const googleConnections = createGoogleConnections({ clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "http://localhost:" + port + "/api/google/oauth/callback", fetcher: fakeFetch });
  let captures = 0;
  const startCapture: StartCapture = async () => {
    captures += 1;
    return { sample: async () => [], stop: async () => {} };
  };
  const get = (href: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const u = new URL(href);
    const req = http.get({ hostname: "127.0.0.1", port: Number(u.port), path: u.pathname + u.search, headers: { Host: u.host, Origin: u.origin }, agent: false }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
  let api: Awaited<ReturnType<typeof startOwnerMeetServer>> | undefined;
  try {
    api = await startOwnerMeetServer({ expectedOwnerEmail: "owner@example.test", port, startCapture, googleConnections, googleJournalPath: journalPath, googleDraftFetch: fakeFetch });
    const root = await get(api.url);
    expect(root.status).toBe(200);
    expect(root.body).toContain('data-google-draft="1"');
    const draft = await get(new URL("/api/google/draft/create", api.url).href);
    expect(draft.status).toBe(405);
    expect(draft.headers.allow).toBe("POST");
    expect(captures).toBe(0);
    expect(calls.length).toBe(0);
    expect(existsSync(journalPath)).toBe(false);
  } finally {
    if (api) { await api.stop(); expect(api.server.listening).toBe(false); }
    expect(isAbsolute(dir)).toBe(true);
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    expect(basename(dir).startsWith("ss-test-run-owner-draft-launcher-" )).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
