import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, join } from "node:path";
import { createWebServer } from "../src/server.js";
import { createOwnerMeetRuntime } from "../src/ownerMeetRuntime.js";
import { createGoogleConnections } from "../src/googleConnections.js";
import { createOwnerGoogleHttp } from "../src/ownerGoogleHttp.js";
import { createOwnerDraftHttp } from "../src/ownerDraftHttp.js";
import { createGoogleWriteOutbox } from "../src/googleWriteOutbox.js";
export async function startOwnerDraftFixture() {
  let inner: ReturnType<typeof createWebServer> | undefined;
  const front = createServer((req, res) => {
    if (inner) inner.emit("request", req, res);
    else { res.statusCode = 503; res.end(); }
  });
  function closeFront(s: Server): Promise<void> {
    return new Promise<void>((r) => s.close(() => r()));
  }
  await new Promise<void>((res, rej) => {
    front.once("error", rej);
    front.listen(0, "127.0.0.1", () => { front.off("error", rej); res(); });
  });
  const addr = front.address();
  if (addr === null || typeof addr === "string") throw new Error("listen failed");
  const origin = `http://127.0.0.1:${addr.port}`;
  let runtime: Awaited<ReturnType<typeof createOwnerMeetRuntime>> | undefined;
  const dir = mkdtempSync(join(tmpdir(), "ss-test-run-owner-draft-server-"));
  try {
    runtime = await createOwnerMeetRuntime({ origin, startCapture: async () => ({ sample: async () => [], stop: async () => {} }), schedule: () => () => {} });
    const connections = createGoogleConnections({ clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: origin + "/api/google/oauth/callback", fetcher: async () => new Response(JSON.stringify({ access_token: "synthetic-access", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.compose" }), { status: 200 }) });
    const gmailCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const gmailFetcher: typeof fetch = (input, init) => {
      gmailCalls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
      return Promise.resolve(new Response(JSON.stringify({ id: "draft-server-1", message: { id: "message-server-1" } }), { status: 200 }));
    };
    const outbox = createGoogleWriteOutbox({ journalPath: join(dir, "journal.ndjson") });
    inner = createWebServer({ meetingRoom: runtime.meetingRoom, meetWorkerHttp: runtime.meetWorkerHttp, googleHttp: createOwnerGoogleHttp({ origin, connections }), googleDraftHttp: createOwnerDraftHttp({ origin, service: runtime.meetingRoom, connections, outbox, fetcher: gmailFetcher }) });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      closing = (async () => {
        try { if (runtime) await runtime.dispose(); } finally {
          try { front.closeAllConnections(); if (front.listening) await closeFront(front); } finally {
            const target = resolve(dir); const base = resolve(tmpdir());
            if (target !== base && dirname(target) === base && basename(target).startsWith("ss-test-run-owner-draft-server-")) rmSync(target, { recursive: true, force: true });
          }
        }
      })();
      return closing;
    };
    return { origin, runtime, connections, gmailCalls, close };
  } catch (e) {
    try { if (runtime) await runtime.dispose(); } catch {}
    try { front.closeAllConnections(); if (front.listening) await closeFront(front); } catch {}
    try { const t = resolve(dir); const b = resolve(tmpdir()); if (t !== b && dirname(t) === b && basename(t).startsWith("ss-test-run-owner-draft-server-")) rmSync(t, { recursive: true, force: true }); } catch {}
    throw e;
  }
}
