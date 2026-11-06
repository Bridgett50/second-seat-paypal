import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createWebServer } from "../src/server.js";
import { meetingRoomSetCookie } from "../src/meetingRoom.js";

describe("meeting-room candidate-context routing evidence", () => {
  it("routes candidate-context via injected candidateApprovalApi", async () => {
    const read = vi.fn((): { status: number; body: Readonly<Record<string, unknown>> } => ({ status: 200, body: { preview: null } }));
    const act = vi.fn((): { status: number; body: Readonly<Record<string, unknown>> } => ({ status: 409, body: { error: "conflict" } }));
    const key = randomUUID();
    const cookie = meetingRoomSetCookie(key, { host: "127.0.0.1" }).split(";")[0];
    if (cookie === undefined) throw new Error("meetingRoomSetCookie returned empty cookie");
    const server = createWebServer({ candidateApprovalApi: { read, act } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("unexpected address");
    const base = `http://127.0.0.1:${address.port}`;
    const path = "/api/meeting-room/candidate-context?roomId=synthetic-r1";
    const getRes = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ preview: null });
    expect(getRes.headers.get("cache-control")).toBe("no-store");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(key, "synthetic-r1");
    const payload = { action: "deny", roomId: "synthetic-r1", requestId: "1".repeat(32), version: 1, previewHash: "2".repeat(64) };
    const postRes = await fetch(`${base}${path}`, { method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(postRes.status).toBe(409);
    expect(await postRes.json()).toEqual({ error: "conflict" });
    expect(postRes.headers.get("cache-control")).toBe("no-store");
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(key, payload);
    const noCookieRes = await fetch(`${base}${path}`);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]).toEqual([null, "synthetic-r1"]);
    await noCookieRes.text();
    const badPayload = { ...payload, ownerId: "o1" };
    const badRes = await fetch(`${base}${path}`, { method: "POST", headers: { Cookie: cookie, "content-type": "application/json" }, body: JSON.stringify(badPayload) });
    expect(badRes.status).toBe(400);
    expect(act).toHaveBeenCalledTimes(1);
    await badRes.text();
    } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});
