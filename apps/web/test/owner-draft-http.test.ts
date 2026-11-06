import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename, isAbsolute } from "node:path";
import { test, expect } from "vitest";
import { createOwnerDraftHttp } from "../src/ownerDraftHttp.js";
import { createMeetingRoomService } from "../src/meetingRoom.js";
import { createGoogleConnections } from "../src/googleConnections.js";
import { createGoogleWriteOutbox } from "../src/googleWriteOutbox.js";
import type { MeetWorkerRequest } from "../src/meetWorkerHttp.js";
test("owner draft http end-to-end", async () => {
  const origin = "http://127.0.0.1:4174";
  const host = "127.0.0.1:4174";
  const caller = "browser-A";
  const dir = mkdtempSync(join(tmpdir(), "ss-test-run-owner-draft-http-"));
  try {
    const service = createMeetingRoomService({
      env: { SECOND_SEAT_TEST_MODE: "0" },
      conversationInput: true,
      candidateAutoDispatch: false,
      sessionPolicy: true,
    });
    const roomId = service.open("", { host }, caller).roomId;
    const connections = createGoogleConnections({
      clientId: "fake-client",
      clientSecret: "fake-secret",
      redirectUri: origin + "/api/google/oauth/callback",
      now: () => 1000,
      fetcher: async () => new Response(JSON.stringify({ access_token: "fake-access", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.compose" }), { status: 200 }),
    });
    const grant = connections.begin(caller, "gmail-draft");
    const st = new URL(grant.url).searchParams.get("state");
    if (typeof st !== "string") throw new Error("missing state");
    expect(await connections.complete(caller, st, "fake-code")).toBe(true);
    const outbox = createGoogleWriteOutbox({ journalPath: join(dir, "outbox.jsonl") });
    const writes: Parameters<typeof fetch>[] = [];
    const gmailFetcher: typeof fetch = (...args: Parameters<typeof fetch>) => {
      writes.push(args);
      return Promise.resolve(new Response(JSON.stringify({ id: "draft-1", message: { id: "msg-1" } }), { status: 200 }));
    };
    const handler = createOwnerDraftHttp({ origin, service, connections, outbox, fetcher: gmailFetcher, now: () => 1000 });
    const req = (body: unknown, overrides?: Partial<MeetWorkerRequest> & { action?: string }): MeetWorkerRequest => ({
      callerKey: caller,
      origin,
      host,
      remoteAddress: "127.0.0.1",
      body,
      query: new URLSearchParams(),
      ...overrides,
      method: overrides?.method ?? "POST",
      path: overrides?.path ?? "/api/google/draft/" + (overrides?.action ?? "preview"),
    } as MeetWorkerRequest);
    const toRecord = (v: unknown): Record<string, unknown> => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
      return v as Record<string, unknown>;
    };
    expect((await handler(req({ roomId, to: "alice@example.com", subject: "  Résumé 😀  " }))).status).toBe(409);
    expect(writes.length).toBe(0);
    const hdrs = { host } as unknown as import("node:http").IncomingHttpHeaders;
    const edited = await service.actAs(caller, { roomId, action: "edit-draft", text: "Résumé 😀\r\nApproved body\nDone" }, hdrs);
    const packageId = edited.body.snapshot?.packageId;
    if (typeof packageId !== "string") throw new Error("missing packageId");
    expect((await service.actAs(caller, { roomId, action: "approve", packageId }, hdrs)).status).toBe(200);
    const approved = service.approvedGoogleDraftAs(caller, roomId);
    if (!approved) throw new Error("not approved");
    const foreignReq: MeetWorkerRequest = { method: "POST", path: "/api/google/draft/preview", callerKey: "browser-B", origin, host, remoteAddress: "127.0.0.1", body: { roomId, to: "alice@example.com", subject: "  Résumé 😀  " }, query: new URLSearchParams() };
    expect((await handler(foreignReq)).status).toBe(404);
    expect((await handler(req({ roomId, to: "alice@example.com", subject: "  Résumé 😀  " }, { origin: "http://evil.example" } as unknown as Partial<MeetWorkerRequest>))).status).toBe(403);
    expect((await handler(req({ roomId, to: "alice@example.com", subject: "hi", extra: 1 }))).status).toBe(400);
    expect(writes.length).toBe(0);
    const prevRes = await handler(req({ roomId, to: "alice@example.com", subject: "  Résumé 😀  " }));
    expect(prevRes.status).toBe(200);
    const prevBody = toRecord(prevRes.body);
    expect(prevBody["status"]).toBe("preview");
    const pkg = toRecord(prevBody["package"]);
    expect(pkg["to"]).toBe("alice@example.com");
    expect(pkg["subject"]).toBe("  Résumé 😀  ");
    expect(pkg["body"]).toBe(approved.body);
    const packageHash = prevBody["packageHash"];
    if (typeof packageHash !== "string") throw new Error("no hash");
    expect(/^[0-9a-f]{64}$/.test(packageHash)).toBe(true);
    const approveRes = await handler(req({ roomId, packageHash }, { action: "approve" }));
    expect(approveRes.status).toBe(200);
    const bodyApproved = toRecord(approveRes.body);
    expect(bodyApproved["status"]).toBe("approved");
    const created = await handler(req({ roomId, packageHash }, { action: "create" }));
    expect(created.status).toBe(200);
    const cBody = toRecord(created.body);
    expect(cBody["draftId"]).toBe("draft-1");
    expect(cBody["messageId"]).toBe("msg-1");
    expect(cBody["journalStatus"]).toBe("confirmed");
    expect(writes.length).toBe(1);
    const w0 = writes[0];
    if (!w0) throw new Error("no write");
    const [input, init] = w0;
    expect(String(input)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    if (!init || typeof init !== "object") throw new Error("no init");
    const im = init as RequestInit;
    expect(im.method).toBe("POST");
    expect(im.redirect).toBe("error");
    expect((im.headers as Record<string,string>)["Authorization"]).toBe("Bearer fake-access");
    const payload = toRecord(JSON.parse(String(im.body)));
    const msg = toRecord(payload["message"]);
    expect(typeof msg["raw"] === "string").toBe(true);
    expect(Object.keys(payload).length).toBe(1);
    const raw = msg["raw"] as string;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    const parts = mime.split("\r\n\r\n");
    const b64 = parts[parts.length - 1];
    if (typeof b64 !== "string") throw new Error("no b64");
    expect(Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf8")).toBe(approved.body);
    expect(mime.includes("alice@example.com")).toBe(true);
    const key = createHash("sha256").update(JSON.stringify([caller, roomId, "gmail-draft", packageHash])).digest("hex");
    const entry = outbox.lookup(key);
    expect(entry?.status).toBe("confirmed");
    expect(entry?.providerId).toBe("draft-1");
    const journal = readFileSync(join(dir, "outbox.jsonl"), "utf8");
    expect(journal.includes("fake-access")).toBe(false);
    expect(journal.includes(approved.body)).toBe(false);
    expect((await handler(req({ roomId, packageHash }, { action: "create" }))).status).toBe(409);
    expect(writes.length).toBe(1);
    const tok = connections.getAccessToken(caller, "gmail-draft");
    expect(tok).toBe("fake-access");
    if (prevRes.headers["Cache-Control"] !== undefined) expect(prevRes.headers["Cache-Control"]).toContain("no-store");
  } finally {
    const target = resolve(dir);
    if (isAbsolute(dir) && dirname(target) === resolve(tmpdir()) && basename(target).startsWith("ss-test-run-owner-draft-http-")) rmSync(target, { recursive: true, force: true });
  }
});
