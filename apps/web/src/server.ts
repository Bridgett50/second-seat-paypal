import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createPrivacyGate, type PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MockRedactor } from "@second-seat/bot/dist/src/private/redact.js";
import { buildOfflineBrief, createSessionStore } from "./session.js";
import { resolveAnalysisConfig } from "./liveConfig.js";
import { installNetGuard, outboundStats, recordAnalyzerCall } from "./netGuard.js";
import { readFileSync } from "node:fs";
import { loadDemo, WEB_ROOT } from "./loadFixtures.js";
import { findAiSelf } from "./theme.js";
import { renderBriefPage, renderSessionPage } from "./render.js";
import {
  createMeetingRoomService,
  MEETING_ROOM_API,
  MEETING_ROOM_COOKIE,
  MEETING_ROOM_PATH,
  MEETING_ROOM_POST_FIELDS,
  MeetingRoomBusyError,
  type MeetingRoomService,
  meetingRoomSetCookie,
  meetingRoomStoreKey,
} from "./meetingRoom.js";
import {
  renderMeetingRoomBody,
  renderMeetingRoomPage,
} from "./meetingRoomRender.js";
import type { createMeetWorkerHttp } from "./meetWorkerHttp.js";
import type { createOwnerDraftHttp } from "./ownerDraftHttp.js";
import type { createOwnerGoogleHttp } from "./ownerGoogleHttp.js";
import type { createCandidateApprovalApi } from "./candidateApprovalApi.js";
import { createCandidateRuntime } from "./candidateRuntime.js";

const PORT = Number(process.env.PORT ?? 4173);
/** Loopback only. The demo process does not listen on other interfaces. */
export const WEB_BIND_HOST = "127.0.0.1";
const LIVE_DEV = process.env.LIVE_DEV === "1";
const SAM_ENABLED = process.env.SECOND_SEAT_EXPERIMENTAL_IMAGES === "1";

/**
 * Text-only core flow: no POST route accepts image or frame-sidecar inputs.
 * Body fields that always carry (or name) image data, matched
 * case-insensitively ("frameSidecar" -> "framesidecar").
 */
export const IMAGE_BODY_FIELDS: ReadonlySet<string> = new Set([
  "image",
  "images",
  "frame",
  "frames",
  "sidecar",
  "framesidecar",
  "screenshot",
  "png",
]);

/**
 * Allowlist of accepted JSON body fields for each POST route. The core flow
 * is text-only; the privacy-gate flow (/api/prepare, /api/correct,
 * /api/approve, /api/send) accepts only its named fields. Any other body
 * field on any POST is unknown and rejected with 400.
 */
export const POST_FIELD_ALLOWLISTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "/api/prepare": new Set(["text"]),
  "/api/correct": new Set(["runId", "editedText"]),
  "/api/approve": new Set(["runId", "text"]),
  "/api/send": new Set(["runId", "approvalToken"]),
  "/api/session": new Set(["mode"]),
  "/api/session/transcript": new Set(["sessionId", "text"]),
  "/api/session/redact": new Set(["sessionId"]),
  "/api/session/correct": new Set(["sessionId", "text", "expectedRevision"]),
  "/api/session/approve": new Set(["sessionId", "expectedRevision"]),
  "/api/session/analyze": new Set(["sessionId"]),
  "/api/session/draft": new Set(["sessionId", "text", "expectedRevision"]),
  "/api/session/draft/approve": new Set(["sessionId", "text", "expectedRevision"]),
  "/api/session/draft/reject": new Set(["sessionId", "expectedRevision"]),
  "/api/session/invalidate": new Set(["sessionId", "scope", "expectedRevision"]),
  "/api/session/pressure-review": new Set(["sessionId", "itemId", "expectedRevision", "assessmentId", "reviewed"]),
  [MEETING_ROOM_API]: new Set(MEETING_ROOM_POST_FIELDS),
  "/api/meeting-room/conversation": new Set(["roomId", "event"]),
  "/api/meeting-room/conversation/finish": new Set(["roomId"]),
  "/api/meeting-room/candidate-context": new Set(["roomId", "action", "requestId", "version", "previewHash", "text"]),
  "/api/meeting-room/worker/connect": new Set(["roomId", "meetingUrl", "displayName"]),
  "/api/meeting-room/worker/stop": new Set(["roomId"]),
  "/api/meeting-room/worker/correct": new Set(["roomId", "utteranceId", "expectedRevision", "text"]),
  "/api/meeting-room/worker/prepare": new Set(["roomId"]),
  "/api/google/connect": new Set(["purpose"]),
  "/api/google/disconnect": new Set([]),
  "/api/google/draft/preview": new Set(["roomId", "to", "subject"]),
  "/api/google/draft/approve": new Set(["roomId", "packageHash"]),
  "/api/google/draft/create": new Set(["roomId", "packageHash"]),
  "/api/google/draft/invalidate": new Set(["roomId"]),
};

const MAX_BODY_BYTES = 1_000_000;

/** Non-null means reject with HTTP 400 and this JSON error message. */
export function validatePostBody(
  pathname: string,
  contentType: string,
  rawBody: string,
  parsedBody: unknown,
): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes("multipart/") || /(^|[\s;,])image\//.test(ct)) {
    return "image uploads are not accepted: the core flow is text-only";
  }
  if (rawBody.includes("data:image/")) {
    return "base64 image data is not accepted: the core flow is text-only";
  }
  if (parsedBody !== null && typeof parsedBody === "object") {
    const record = parsedBody as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (IMAGE_BODY_FIELDS.has(key.toLowerCase())) {
        return `field "${key}" is not accepted: the core flow is text-only`;
      }
    }
    if (Object.values(record).some((v) => typeof v === "string" && v.includes("data:image/"))) {
      return "base64 image data is not accepted: the core flow is text-only";
    }
    const allowlist = POST_FIELD_ALLOWLISTS[pathname];
    for (const key of Object.keys(record)) {
      if (allowlist === undefined || !allowlist.has(key)) {
        return `unknown field "${key}" for POST ${pathname}`;
      }
    }
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export interface WebServerDeps {
  /** Privacy gate; defaults to fixture mode with MockRedactor. */
  gate?: PrivacyGate;
  /** Stubbed sender: receives only reviewed redacted text. Defaults to a recorder. */
  sender?: (text: string) => Promise<unknown> | unknown;
  /** Last text handed to the sender by /api/send (redacted only, never raw). */
  lastSent?: { text: string };
  /** Meeting room service; defaults to a new one (tests inject a fake-transport service). */
  meetingRoom?: MeetingRoomService;
  candidateApprovalApi?: ReturnType<typeof createCandidateApprovalApi>;
  meetWorkerHttp?: ReturnType<typeof createMeetWorkerHttp>;
  googleHttp?: ReturnType<typeof createOwnerGoogleHttp>;
  googleDraftHttp?: ReturnType<typeof createOwnerDraftHttp>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** True for the store's optimistic-concurrency rejection (stale revision/assessment). */
function isStaleRevision(err: unknown): err is Error {
  return err instanceof Error && err.name === "StaleRevisionError";
}

/**
 * expectedRevision names the exact server revision the caller reviewed.
 * Missing or non-numeric values cannot identify reviewed state: 400.
 */
function readExpectedRevision(body: Record<string, unknown> | null | undefined): number | null {
  const v = body?.["expectedRevision"];
  return typeof v === "number" ? v : null;
}

/** Privacy-gate review page: redacted preview in an editable textarea, then Approve. Editing clears approval. */
export function renderGatePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Privacy gate — Second Seat</title></head>
<body>
<h1>Privacy gate</h1>
<p>Raw text is redacted on private infrastructure before any analysis. Review the redacted preview, then approve.</p>
<label>Transcript to analyse:<textarea id="gate-raw" rows="4" cols="60"></textarea></label>
<div><button type="button" id="gate-prepare">Prepare redacted preview</button></div>
<label>Redacted preview (editable):<textarea id="gate-preview" rows="4" cols="60" readonly></textarea></label>
<div><button type="button" id="gate-approve" disabled>Approve</button>
<button type="button" id="gate-send" disabled>Send for analysis</button></div>
<p id="gate-status" role="status"></p>
<script>
(function(){
var runId=null,approvalToken=null,approved=false;
var raw=document.getElementById("gate-raw"),preview=document.getElementById("gate-preview");
var approveBtn=document.getElementById("gate-approve"),sendBtn=document.getElementById("gate-send");
var status=document.getElementById("gate-status");
function setStatus(t){status.textContent=t;}
function refresh(){approveBtn.disabled=!(runId&&!approved);sendBtn.disabled=!(runId&&approved&&approvalToken);}
function call(path,body){return fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(b){return {ok:r.ok,body:b};});});}
document.getElementById("gate-prepare").addEventListener("click",function(){
  runId=null;approvalToken=null;approved=false;refresh();
  call("/api/prepare",{text:raw.value}).then(function(r){
    if(!r.ok){setStatus("Prepare failed.");return;}
    runId=r.body.runId;preview.readOnly=false;preview.value=r.body.redactedText;
    setStatus("Redacted preview ready. Review it, then approve.");refresh();
  });
});
preview.addEventListener("input",function(){
  if(!runId)return;
  approved=false;approvalToken=null;refresh();
  call("/api/correct",{runId:runId,editedText:preview.value}).then(function(){
    setStatus("Edited: prior approval cleared. Review, then approve again.");refresh();
  });
});
approveBtn.addEventListener("click",function(){
  if(!runId)return;
  call("/api/approve",{runId:runId,text:preview.value}).then(function(r){
    if(!r.ok){setStatus("Approve failed.");return;}
    approvalToken=r.body.approvalToken;approved=true;
    setStatus("Approved. Only the redacted preview will be sent.");refresh();
  });
});
sendBtn.addEventListener("click",function(){
  if(!runId||!approvalToken)return;
  call("/api/send",{runId:runId,approvalToken:approvalToken}).then(function(r){
    if(!r.ok){approved=false;approvalToken=null;setStatus("Send refused.");refresh();return;}
    setStatus("Sent for analysis. Only the approved redacted text left this page.");
  });
});
refresh();
})();
</script>
</body>
</html>`;
}

type SessionStore = ReturnType<typeof createSessionStore>;

/**
 * One store per mode; every session id is owned by exactly one store and all
 * calls for that id go to its owner. Approval rules are unchanged: each store
 * enforces its own owner approvals.
 */
function routeSessions(offline: SessionStore, live: SessionStore | null) {
  const owner = new Map<string, SessionStore>();
  const of = (id: string): SessionStore => owner.get(id) ?? offline;
  const routed = {
    createSession(mode: "offline" | "live" = "offline"): string {
      const store = mode === "live" && live !== null ? live : offline;
      const id = store.createSession();
      owner.set(id, store);
      return id;
    },
    expireApprovals(): void {
      offline.expireApprovals();
      live?.expireApprovals();
    },
  };
  return new Proxy(routed, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv);
      return (id: string, ...rest: unknown[]) => {
        const store = of(id) as unknown as Record<string | symbol, (...a: unknown[]) => unknown>;
        return store[prop]!.call(store, id, ...rest);
      };
    },
  }) as unknown as SessionStore & typeof routed;
}

export function createWebServer(deps?: WebServerDeps) {
  installNetGuard();
  const testMode = process.env.SECOND_SEAT_TEST_MODE === "1";
  const analysisConfig = testMode ? { mode: "offline" as const } : resolveAnalysisConfig(process.env);
  // Offline is always available and is the default for every new session.
  // Live is available only when the server was started with
  // SECOND_SEAT_MODE=live plus its credentials (never in test mode), and a
  // session is live only when the owner picks Live (/session?mode=live).
  const offlineStore = testMode
    ? createSessionStore({
        offline: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        redactor: new MockRedactor() as any,
        analyzer: async (approvedText: string) => {
          if (approvedText.includes("[[slow]]")) {
            await new Promise((r) => setTimeout(r, 1500));
          }
          recordAnalyzerCall(approvedText);
          return buildOfflineBrief(approvedText, []);
        },
      })
    : createSessionStore();
  const liveStore =
    !testMode && analysisConfig.mode === "live"
      ? createSessionStore({
          offline: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          redactor: analysisConfig.redactor as any,
          gate: analysisConfig.gate,
          analyzer: analysisConfig.analyzer,
          analyzerLabel: analysisConfig.analyzerLabel,
        })
      : null;
  const liveAvailable = liveStore !== null;
  const sessions = routeSessions(offlineStore, liveStore);
  const candidateRuntime = !deps?.meetingRoom ? createCandidateRuntime(process.env, analysisConfig) : undefined;
  const meetingRoom = deps?.meetingRoom ?? candidateRuntime?.meetingRoom ?? createMeetingRoomService();
  const contextApprovalApi = deps?.candidateApprovalApi ?? candidateRuntime?.candidateApprovalApi;
  const gate = deps?.gate ?? createPrivacyGate({ mode: "fixture", redactor: new MockRedactor() });
  const sent: { text: string } = deps?.lastSent ?? { text: "" };
  const sender =
    deps?.sender ??
    ((text: string): void => {
      sent.text = text;
    });
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Optional AI-self image for the twin stage (apps/web/public/ai-self.png|jpg).
    // Looked up per request so dropping the file in needs no restart.
    const aiSelf = findAiSelf(WEB_ROOT);
    if (req.method === "GET" && aiSelf !== null && url.pathname === aiSelf.url) {
      res.writeHead(200, { "content-type": aiSelf.contentType, "cache-control": "no-cache" });
      res.end(readFileSync(aiSelf.file));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/briefs/demo" || url.pathname === "/briefs/demo/")) {
      const demo = loadDemo();
      const html = renderBriefPage(
        demo.brief,
        demo.segments,
        demo.frames,
        demo.runLog,
        {
          liveDev: LIVE_DEV,
          pressureFallback: demo.pressureFallback,
          payloadDemo: demo.payloadDemo,
          glimmerLive: demo.glimmerLive,
          briefScore: demo.briefScore,
          seededScore: demo.seededScore,
          // SAM / image hero chain is experimental and hidden unless enabled.
          heroChain: SAM_ENABLED ? demo.heroChain : null,
          cacheUsage: demo.cacheUsage,
          aiSelfSrc: aiSelf?.url ?? null,
        },
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/session" || url.pathname === "/session/")) {
      const wantsLive = url.searchParams.get("mode") === "live";
      const mode = wantsLive && liveAvailable ? "live" : "offline";
      const sessionId = sessions.createSession(mode);
      const html = renderSessionPage(sessions.getState(sessionId), {
        mode,
        liveAvailable,
        liveRequestedButUnavailable: wantsLive && !liveAvailable,
        aiSelfSrc: aiSelf?.url ?? null,
      });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (
      req.method === "GET" &&
      (url.pathname === MEETING_ROOM_PATH || url.pathname === `${MEETING_ROOM_PATH}/`)
    ) {
      const storeKey = meetingRoomStoreKey(req.headers.cookie);
      const key = storeKey ?? randomUUID();
      let snapshot;
      try {
        snapshot = meetingRoom.open(url.search, req.headers, key);
      } catch (err) {
        if (err instanceof MeetingRoomBusyError) {
          res.writeHead(503, {
            "content-type": "text/plain",
            "cache-control": "no-store",
          });
          res.end("Meeting room is busy. Try again later, or open the guided demo at /meeting-room?demo=1.");
          return;
        }
        throw err;
      }
      const html = renderMeetingRoomPage(snapshot, aiSelf?.url ?? null, contextApprovalApi !== undefined && snapshot.demo === null, deps?.meetWorkerHttp !== undefined && snapshot.demo === null, deps?.googleHttp !== undefined && snapshot.demo === null, deps?.googleDraftHttp !== undefined && snapshot.demo === null);
      const headers: Record<string, string> = {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      };
      if (storeKey === null) {
        headers["set-cookie"] = meetingRoomSetCookie(key, req.headers).replace("SameSite=Strict", deps?.googleHttp ? "SameSite=Lax" : "SameSite=Strict");
      } else if (deps?.googleHttp) {
        headers["set-cookie"] = meetingRoomSetCookie(key, req.headers).replace("SameSite=Strict", "SameSite=Lax");
      }
      res.writeHead(200, headers);
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/gate") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderGatePage());
      return;
    }
    if (url.pathname === "/api/test/outbound" || url.pathname === "/api/test/expire-approvals") {
      if (!testMode) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/test/outbound") {
        json(res, 200, outboundStats());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/test/expire-approvals") {
        sessions.expireApprovals();
        json(res, 200, { expired: true });
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
if (url.pathname.startsWith("/api/google/draft/")) {
  res.setHeader("Cache-Control", "no-store");
  if (!deps?.googleDraftHttp) {
    json(res, 404, { error: "Not found" });
    return;
  }
  void (async () => {
    try {
      if (req.method === "POST") {
        const ct = req.headers["content-type"] ?? "";
        const mediaType = (ct.split(";")[0] ?? "").trim().toLowerCase();
        if (mediaType !== "application/json") {
          json(res, 415, { error: "Unsupported Media Type" });
          return;
        }
        let raw: string | null = null;
        let parsed: unknown = null;
        raw = await readBody(req);
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          json(res, 400, { error: "Malformed JSON" });
          return;
        }
        const validationError = validatePostBody(url.pathname, req.headers["content-type"] ?? "", raw, parsed);
        if (validationError) {
          json(res, 400, { error: validationError });
          return;
        }
        const reply = await deps.googleDraftHttp!({
          method: req.method ?? "",
          path: url.pathname,
          callerKey: meetingRoomStoreKey(req.headers.cookie),
          origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
          host: typeof req.headers.host === "string" ? req.headers.host : null,
          remoteAddress: req.socket.remoteAddress ?? null,
          body: parsed,
          query: url.searchParams,
        });
        for (const [k, v] of Object.entries(reply.headers)) {
          res.setHeader(k, v);
        }
        json(res, reply.status, reply.body);
        return;
      }
      const reply = await deps.googleDraftHttp!({
        method: req.method ?? "",
        path: url.pathname,
        callerKey: meetingRoomStoreKey(req.headers.cookie),
        origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
        host: typeof req.headers.host === "string" ? req.headers.host : null,
        remoteAddress: req.socket.remoteAddress ?? null,
        body: null,
        query: url.searchParams,
      });
      for (const [k, v] of Object.entries(reply.headers)) {
        res.setHeader(k, v);
      }
      json(res, reply.status, reply.body);
    } catch {
      if (!res.writableEnded && !res.headersSent) {
        json(res, 503, { error: "Unavailable" });
      }
    }
  })();
  return;
}
    if (url.pathname.startsWith("/api/google/")) {
      res.setHeader("Cache-Control", "no-store");
      if (!deps?.googleHttp) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const api = deps.googleHttp;
      void (async () => {
        try {
          let raw: string | null = null;
          let parsed: unknown = null;
          if (req.method === "POST") {
            raw = await readBody(req);
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = null;
            }
            const validationError = validatePostBody(url.pathname, req.headers["content-type"] ?? "", raw, parsed);
            if (validationError) {
              json(res, 400, { error: validationError });
              return;
            }
          }
          const reply = await api({
            method: req.method ?? "",
            path: url.pathname,
            callerKey: meetingRoomStoreKey(req.headers.cookie),
            origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
            host: typeof req.headers.host === "string" ? req.headers.host : null,
            remoteAddress: req.socket.remoteAddress ?? null,
            body: parsed,
            query: url.searchParams,
          });
          for (const [k, v] of Object.entries(reply.headers)) {
            res.setHeader(k, v);
          }
          if (reply.status === 303) {
            res.writeHead(reply.status, { "cache-control": "no-store" });
            res.end();
            return;
          }
          json(res, reply.status, reply.body);
        } catch {
          if (!res.writableEnded && !res.headersSent) {
            json(res, 503, { error: "Unavailable" });
          }
        }
      })();
      return;
    }
    if (url.pathname.startsWith("/api/meeting-room/worker/")) {
      res.setHeader("Cache-Control", "no-store");
      if (!deps?.meetWorkerHttp) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const api = deps.meetWorkerHttp;
      void (async () => {
        try {
          let raw: string | null = null;
          let parsed: unknown = null;
          if (req.method === "POST") {
            raw = await readBody(req);
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = null;
            }
            const validationError = validatePostBody(url.pathname, req.headers["content-type"] ?? "", raw, parsed);
            if (validationError) {
              json(res, 400, { error: validationError });
              return;
            }
          }
          const reply = await api({
            method: req.method ?? "",
            path: url.pathname,
            callerKey: meetingRoomStoreKey(req.headers.cookie),
            origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
            host: typeof req.headers.host === "string" ? req.headers.host : null,
            remoteAddress: req.socket.remoteAddress ?? null,
            body: parsed,
            query: url.searchParams,
          });
          for (const [k, v] of Object.entries(reply.headers)) {
            res.setHeader(k, v);
          }
          json(res, reply.status, reply.body);
        } catch {
          if (!res.writableEnded && !res.headersSent) {
            json(res, 503, { error: "Unavailable" });
          }
        }
      })();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/meeting-room/candidate-context") {
      res.setHeader("Cache-Control", "no-store");
      const candidateApprovalApi = contextApprovalApi;
      if (!candidateApprovalApi) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const caller = meetingRoomStoreKey(req.headers.cookie);
      const roomId = url.searchParams.get("roomId");
      const result = candidateApprovalApi.read(caller, roomId);
      json(res, result.status, result.body);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session/state") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        json(res, 400, { error: 'query "sessionId" is required' });
        return;
      }
      try {
        json(res, 200, sessions.getState(sessionId));
      } catch (err: unknown) {
        json(res, 404, { error: err instanceof Error ? err.message : "unknown session" });
      }
      return;
    }
    if (req.method === "POST") {
      void readBody(req).then(
        (raw) => {
          let parsed: unknown = null;
          if (raw !== "") {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          const error = validatePostBody(
            url.pathname,
            req.headers["content-type"] ?? "",
            raw,
            parsed,
          );
          if (error !== null) {
            json(res, 400, { error });
            return;
          }
          const body = asRecord(parsed);
          if (url.pathname === "/api/meeting-room/conversation" || url.pathname === "/api/meeting-room/conversation/finish") {
            res.setHeader("Cache-Control", "no-store");
            if (!contextApprovalApi) { json(res, 404, { error: "not found" }); return; }
            const caller = meetingRoomStoreKey(req.headers.cookie);
            const r = url.pathname === "/api/meeting-room/conversation" ? meetingRoom.ingestConversationAs(caller, body?.["roomId"], body?.["event"]) : meetingRoom.finishConversationAs(caller, body?.["roomId"]);
            json(res, r.status, { ...r.body, html: r.body.snapshot ? renderMeetingRoomBody(r.body.snapshot) : null });
            return;
          }
          if (req.method === "POST" && url.pathname === "/api/meeting-room/candidate-context") {
            res.setHeader("Cache-Control", "no-store");
            const candidateApprovalApi = contextApprovalApi;
            if (!candidateApprovalApi) {
              json(res, 404, { error: "Not found" });
              return;
            }
            const caller = meetingRoomStoreKey(req.headers.cookie);
            const result = candidateApprovalApi.act(caller, parsed);
            json(res, result.status, result.body);
            return;
          }
          if (url.pathname === MEETING_ROOM_API) {
            // Bind every action to its browser: only the store key in this
            // request's own mr_store cookie may read or act on a room.
            const callerKey = meetingRoomStoreKey(req.headers.cookie);
            void meetingRoom
              .actAs(callerKey, body ?? {}, req.headers)
              .then((r) =>
                json(res, r.status, {
                  ...r.body,
                  html: r.body.snapshot ? renderMeetingRoomBody(r.body.snapshot) : null,
                }),
              )
              .catch(() => json(res, 500, { error: "meeting room action failed" }));
            return;
          }
          if (url.pathname === "/api/prepare") {
            const text = body?.["text"];
            if (typeof text !== "string" || text === "") {
              json(res, 400, { error: "field \"text\" must be a non-empty string" });
              return;
            }
            // Raw text goes only to the gate's redactor; it is never logged.
            gate
              .prepare(text)
              .then((prepared) => {
                json(res, 200, {
                  runId: prepared.runId,
                  redactedText: prepared.redactedText,
                  needsReview: prepared.needsReview,
                });
              })
              .catch((err: unknown) => json(res, 400, { error: err instanceof Error ? err.message : "prepare failed" }));
            return;
          }
          if (url.pathname === "/api/correct") {
            const runId = body?.["runId"];
            const editedText = body?.["editedText"];
            if (typeof runId !== "string" || typeof editedText !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"editedText\" must be strings" });
              return;
            }
            try {
              const redactedText = gate.correct(runId, editedText);
              json(res, 200, { runId, redactedText });
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "correct failed" });
            }
            return;
          }
          if (url.pathname === "/api/approve") {
            const runId = body?.["runId"];
            const text = body?.["text"];
            if (typeof runId !== "string" || typeof text !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"text\" must be strings" });
              return;
            }
            try {
              const approvalToken = gate.approve(runId, text);
              json(res, 200, { runId, approvalToken });
            } catch (err: unknown) {
              json(res, 400, { error: err instanceof Error ? err.message : "approve failed" });
            }
            return;
          }
          if (url.pathname === "/api/send") {
            const runId = body?.["runId"];
            const approvalToken = body?.["approvalToken"];
            if (typeof runId !== "string" || typeof approvalToken !== "string") {
              json(res, 400, { error: "fields \"runId\" and \"approvalToken\" must be strings" });
              return;
            }
            // The stubbed sender receives only the reviewed redacted text.
            gate
              .send(runId, approvalToken, async (gated) => {
                await sender(gated.text);
                return gated.text;
              })
              .then((sentText) => {
                json(res, 200, { runId, sentText });
              })
              .catch((err: unknown) => json(res, 400, { error: err instanceof Error ? err.message : "send failed" }));
            return;
          }
          if (url.pathname === "/api/session") {
            const sessionId = sessions.createSession(
              body?.["mode"] === "live" && liveAvailable ? "live" : "offline",
            );
            json(res, 200, { sessionId });
            return;
          }
          if (url.pathname === "/api/session/transcript") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            try {
              json(res, 200, sessions.setTranscript(sessionId, text));
            } catch (err: unknown) {
              json(res, 404, { error: err instanceof Error ? err.message : "unknown session" });
            }
            return;
          }
          if (url.pathname === "/api/session/redact") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            sessions
              .redact(sessionId)
              .then((state) => json(res, 200, state))
              .catch((err: unknown) =>
                json(res, 404, { error: err instanceof Error ? err.message : "redact failed" }),
              );
            return;
          }
          if (url.pathname === "/api/session/correct") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.correct(sessionId, text, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 400, { error: err instanceof Error ? err.message : "correct failed" });
              }
            }
            return;
          }
          if (url.pathname === "/api/session/approve") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.approve(sessionId, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 400, { error: err instanceof Error ? err.message : "approve failed" });
              }
            }
            return;
          }
          if (url.pathname === "/api/session/analyze") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            sessions
              .analyze(sessionId)
              .then((state) => json(res, 200, state))
              .catch((err: unknown) =>
                json(res, 404, { error: err instanceof Error ? err.message : "analyze failed" }),
              );
            return;
          }
          if (url.pathname === "/api/session/draft") {
            // draft routes
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.editDraft(sessionId, text, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 400, { error: err instanceof Error ? err.message : "draft failed" });
              }
            }
            return;
          }
          if (url.pathname === "/api/session/draft/approve") {
            const sessionId = body?.["sessionId"];
            const text = body?.["text"];
            if (typeof sessionId !== "string" || typeof text !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "text" must be strings' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.approveDraft(sessionId, text, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
                return;
              }
              const msg = err instanceof Error ? err.message : "approve failed";
              const status = msg === "draft changed; review again" ? 409 : 400;
              json(res, status, { error: msg });
            }
            return;
          }
          if (url.pathname === "/api/session/invalidate") {
            const sessionId = body?.["sessionId"];
            const scope = body?.["scope"] ?? "preview";
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            if (scope !== "transcript" && scope !== "preview") {
              json(res, 400, { error: 'field "scope" must be "transcript" or "preview"' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.invalidate(sessionId, scope, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 404, { error: err instanceof Error ? err.message : "unknown session" });
              }
            }
            return;
          }
          if (url.pathname === "/api/session/draft/reject") {
            const sessionId = body?.["sessionId"];
            if (typeof sessionId !== "string") {
              json(res, 400, { error: 'field "sessionId" must be a string' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            try {
              json(res, 200, sessions.rejectDraft(sessionId, { expectedRevision }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 404, { error: err instanceof Error ? err.message : "reject failed" });
              }
            }
            return;
          }
          if (url.pathname === "/api/session/pressure-review") {
            const sessionId = body?.["sessionId"];
            const itemId = body?.["itemId"];
            if (typeof sessionId !== "string" || typeof itemId !== "string") {
              json(res, 400, { error: 'fields "sessionId" and "itemId" must be strings' });
              return;
            }
            const expectedRevision = readExpectedRevision(body);
            if (expectedRevision === null) {
              json(res, 400, { error: 'field "expectedRevision" must be a number' });
              return;
            }
            const assessmentId = body?.["assessmentId"];
            if (typeof assessmentId !== "string") {
              json(res, 400, { error: 'field "assessmentId" must be a string' });
              return;
            }
            const reviewed = body?.["reviewed"] ?? true;
            if (typeof reviewed !== "boolean") {
              json(res, 400, { error: 'field "reviewed" must be a boolean when present' });
              return;
            }
            try {
              json(res, 200, reviewed
                ? sessions.reviewPressure(sessionId, itemId, { expectedRevision, assessmentId })
                : sessions.unreviewPressure(sessionId, itemId, { expectedRevision, assessmentId }));
            } catch (err: unknown) {
              if (isStaleRevision(err)) {
                json(res, 409, { error: err.message, state: sessions.getState(sessionId) });
              } else {
                json(res, 404, { error: err instanceof Error ? err.message : "review failed" });
              }
            }
            return;
          }
          json(res, 404, { error: "not found" });
        },
        () => json(res, 400, { error: "unreadable body" }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createWebServer().listen(PORT, WEB_BIND_HOST, () => {
    console.log(`web demo on http://${WEB_BIND_HOST}:${PORT}/briefs/demo`);
  });
}
