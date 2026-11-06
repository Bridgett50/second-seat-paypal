import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import {
  PENDING_SEND_EDIT_REASON,
  REAPPROVE_AFTER_RELOAD_NOTE,
  SEND_TAKEOVER_REFUSAL,
  createTwinRoom,
} from "../src/t2-room.js";
import { createInMemoryRoomStore, roomStoreKey } from "../src/t2-room.js";
import { fakeSendAllowed, isLoopbackHost } from "../src/t2-room.js";

/**
 * Review fixes (FIX FIRST, findings #1-#4). Local only, synthetic data.
 * "Reload" = a new twin room built on the SAME in-memory store.
 */

function streamAll(room: ReturnType<typeof createTwinRoom>): void {
  for (let i = 0; i < 20; i += 1) {
    if (!room.streamNextLine().appended) break;
  }
}

describe("t2 review fixes (F1)", () => {
  it("F1-1 an in-flight send locks the package: edit and plugin changes are refused and the pending intent is never deleted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {
        await gate;
      },
    });
    streamAll(room);
    expect(room.approve().approved).toBe(true);
    const inflight = room.send();
    await new Promise((r) => setTimeout(r, 0));
    expect(room.sendIntent()?.status).toBe("pending");

    expect(() => room.editDraft("Rewritten while the send is in flight.")).toThrow(
      PENDING_SEND_EDIT_REASON,
    );
    expect(room.approvePluginOutput("action-items")).toEqual({ approved: false });
    expect(room.rejectPluginOutput("action-items")).toEqual({ rejected: false });
    expect(room.refreshPluginOutput("action-items")).toEqual({ refreshed: false });
    // The pending intent survives every refused change.
    expect(room.sendIntent()?.status).toBe("pending");
    expect(room.approve().approved).toBe(false);
    const second = await room.send();
    expect(second.ok).toBe(false);
    expect(room.transportCalls()).toBe(1);

    release();
    expect((await inflight).ok).toBe(true);
    expect(room.transportCalls()).toBe(1);
    expect(room.view().draft.sendState).toBe("sent");
  });

  it("F1-2 a store rewritten with a consistent approved body and hashes reloads unapproved and unsendable", async () => {
    const store = createInMemoryRoomStore();
    const room1 = createTwinRoom({ testMode: true, transport: async () => {}, store });
    expect(room1.approve().approved).toBe(true);
    const v1 = room1.view();
    const key = roomStoreKey(v1.ownerId, v1.selectedMeetingTitle);
    const raw = store.get(key);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw as string) as Record<string, unknown>;
    expect(record["approved"]).toBe(true);

    // Rewrite the stored package AND every hash so the record is
    // self-consistent: the loader accepts it, so only the room can refuse.
    const forged = "Forged follow-up: wire the deposit today (synthetic).";
    const forgedHash = packageHash(forged);
    record["body"] = forged;
    record["pluginBase"] = forged;
    record["pluginSections"] = [];
    record["approvedBody"] = forged;
    record["bodyHash"] = forgedHash;
    record["approvedHash"] = forgedHash;
    if (record["evidence"] !== null && typeof record["evidence"] === "object") {
      (record["evidence"] as Record<string, unknown>)["packageHash"] = forgedHash;
    }
    store.set(key, JSON.stringify(record));

    const room2 = createTwinRoom({ testMode: true, transport: async () => {}, store });
    expect(room2.restoredFromStore()).toBe(true);
    const v2 = room2.view();
    expect(v2.draft.body).toBe(forged);
    expect(v2.draft.approved).toBe(false);
    expect(room2.copyText()).toBeNull();
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(room2.transportCalls()).toBe(0);
  });

  it("F1-2b reload never restores approval: the note asks to approve again and a fresh approve sends exactly once", async () => {
    const store = createInMemoryRoomStore();
    const bodies: string[] = [];
    const transport = async (body: string) => void bodies.push(body);
    const room1 = createTwinRoom({ testMode: true, transport, store });
    expect(room1.approvalNote()).toBeNull();
    expect(room1.approve().approved).toBe(true);
    const body = room1.view().draft.body;

    const room2 = createTwinRoom({ testMode: true, transport, store });
    expect(room2.view().draft.approved).toBe(false);
    expect(room2.view().draft.body).toBe(body);
    expect(room2.approvalNote()).toBe(REAPPROVE_AFTER_RELOAD_NOTE);
    expect((await room2.send()).ok).toBe(false);
    expect(room2.approve().approved).toBe(true);
    expect(room2.approvalNote()).toBeNull();
    expect((await room2.send()).ok).toBe(true);
    expect((await room2.send()).ok).toBe(false);
    expect(bodies).toEqual([body]);
  });

  it("F1-3 the fake-send gate needs SECOND_SEAT_TEST_MODE=1 and loopback Host and X-Forwarded-Host", () => {
    const ok = { testModeEnv: "1", host: "127.0.0.1:4310", forwardedHost: null };
    expect(fakeSendAllowed(ok)).toBe(true);
    expect(fakeSendAllowed({ ...ok, host: "localhost:4310" })).toBe(true);
    expect(fakeSendAllowed({ ...ok, host: "[::1]:4310" })).toBe(true);
    expect(fakeSendAllowed({ ...ok, forwardedHost: "localhost" })).toBe(true);
    // The env flag must be exactly "1".
    expect(fakeSendAllowed({ ...ok, testModeEnv: "true" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, testModeEnv: undefined })).toBe(false);
    expect(fakeSendAllowed({ ...ok, testModeEnv: " 1" })).toBe(false);
    // Public, look-alike, and wildcard hosts are refused.
    expect(fakeSendAllowed({ ...ok, host: "second-seat.example.com" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, host: "localhost.evil.test" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, host: "0.0.0.0:4310" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, host: null })).toBe(false);
    // A forwarded public host fails closed even when Host is loopback.
    expect(fakeSendAllowed({ ...ok, forwardedHost: "second-seat.example.com" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, forwardedHost: "localhost.evil.test" })).toBe(false);
    expect(fakeSendAllowed({ ...ok, forwardedHost: "0.0.0.0" })).toBe(false);
    expect(isLoopbackHost("localhost:notaport")).toBe(false);
    expect(isLoopbackHost("127.0.0.1, evil.test")).toBe(false);
  });

  it("F1-4 approve then takeover then reload: even a re-approved frozen package is never sent or exported", async () => {
    const store = createInMemoryRoomStore();
    const bodies: string[] = [];
    const transport = async (body: string) => void bodies.push(body);
    const room1 = createTwinRoom({ testMode: true, transport, store });
    streamAll(room1);
    expect(room1.approve().approved).toBe(true);
    room1.takeOver();

    const room2 = createTwinRoom({ testMode: true, transport, store });
    expect(room2.view().twinStatus).toBe("paused (you took over)");
    expect((await room2.send()).ok).toBe(false);
    expect(room2.copyText()).toBeNull();
    // Connector sessions stay live on purpose, so the owner may re-approve
    // the frozen package; the room-level takeover still refuses every exit.
    expect(room2.approve().approved).toBe(true);
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(SEND_TAKEOVER_REFUSAL);
    expect(room2.copyText()).toBeNull();
    expect(room2.mailtoHref()).toBeNull();
    expect(room2.exportFile()).toBeNull();
    expect(room1.transportCalls() + room2.transportCalls()).toBe(0);
    expect(bodies).toEqual([]);
  });
});
