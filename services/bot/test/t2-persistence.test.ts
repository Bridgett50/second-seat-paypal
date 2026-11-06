import { describe, expect, it } from "vitest";
import { createTwinRoom } from "../src/t2-room.js";
import { packageHash } from "../src/meeting/connector.js";

/**
 * T10 durable send intent + persistence (local only, synthetic data).
 *
 * "Reload" is simulated by building a second twin room on the SAME
 * in-memory key-value store and dropping the first room. Transport calls
 * are counted across both rooms through one shared transport function.
 *
 * These tests only use the long-standing `createTwinRoom({ store })`
 * surface: the store below is a plain object shaped like the room's
 * persistence store, and tampering reads back whatever keys the room
 * wrote (no knowledge of key names or file layout).
 */

type TestStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function makeStore(): TestStore & { keys: string[]; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  const keys: string[] = [];
  return {
    raw,
    keys,
    get: (k: string) => (raw.has(k) ? (raw.get(k) as string) : null),
    set: (k: string, v: string) => {
      if (!raw.has(k)) keys.push(k);
      raw.set(k, v);
    },
    remove: (k: string) => {
      raw.delete(k);
    },
  };
}

function countingTransport() {
  const bodies: string[] = [];
  return {
    bodies,
    transport: async (body: string) => {
      bodies.push(body);
    },
  };
}

function persistedKeyForMeeting(
  store: TestStore & { keys: string[]; raw: Map<string, string> },
  meetingTitle: string,
): string | null {
  for (const key of store.keys) {
    const value = store.raw.get(key);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as { meetingTitle?: unknown };
      if (parsed.meetingTitle === meetingTitle) return key;
    } catch {
      continue;
    }
  }
  return null;
}

describe("t2 persistence", () => {
  it("T10-1 reload before approval restores the draft unapproved", async () => {
    const store = makeStore();
    const { transport } = countingTransport();
    const room1 = createTwinRoom({ testMode: true, transport, store });
    const before = room1.view().draft.body;
    room1.editDraft(`${before}\nP.S. Added before reload.`);
    const edited = room1.view().draft.body;
    expect(edited).toContain("P.S. Added before reload.");
    expect(room1.view().draft.approved).toBe(false);

    // Reload: drop room1, build room2 on the same store.
    const room2 = createTwinRoom({ testMode: true, transport, store });
    const v = room2.view();
    expect(v.draft.body).toBe(edited);
    expect(v.draft.sha256).toBe(packageHash(edited));
    expect(v.draft.approved).toBe(false);
    expect(v.draft.sendState).toBe("unsent");

    // An unapproved restored draft still cannot send.
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(0);
  });

  it("T10-2 reload after approval restores the approved package and hash and sends exactly once", async () => {
    const store = makeStore();
    const { bodies, transport } = countingTransport();
    const room1 = createTwinRoom({ testMode: true, transport, store });
    expect(room1.approve().approved).toBe(true);
    const body = room1.view().draft.body;
    const hash = room1.view().draft.sha256;
    expect(hash).toBe(packageHash(body));

    // Reload: drop room1, build room2 on the same store.
    const room2 = createTwinRoom({ testMode: true, transport, store });
    const v = room2.view();
    expect(v.draft.approved).toBe(false);
    expect(v.draft.body).toBe(body);
    expect(v.draft.sha256).toBe(hash);
    expect(v.draft.sha256).toBe(packageHash(body));
    // Approval is never restored: the reloaded package needs a fresh approve().
    expect((await room2.send()).ok).toBe(false);
    expect(room2.approve().approved).toBe(true);

    const first = await room2.send();
    expect(first.ok).toBe(true);
    expect(bodies).toEqual([body]);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);

    const second = await room2.send();
    expect(second.ok).toBe(false);
    expect(bodies).toEqual([body]);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);
  });

  it("T10-3 reload with a pending send intent never resends and reports the send as unconfirmed", async () => {
    const store = makeStore();
    const firstAttemptBodies: string[] = [];
    let releaseTransport!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    // Crash simulation: the transport never resolves, so the first room is
    // discarded between the durable intent write and the transport result.
    const hanging = async (body: string) => {
      firstAttemptBodies.push(body);
      await gate;
    };
    const room1 = createTwinRoom({ testMode: true, transport: hanging, store });
    expect(room1.approve().approved).toBe(true);
    const crashed = room1.send();
    // Let the first room reach the transport (intent is written first).
    await new Promise((r) => setTimeout(r, 0));
    expect(firstAttemptBodies.length).toBe(1);

    // Reload: drop the crashed room, build room2 on the same store.
    const secondAttemptBodies: string[] = [];
    const room2 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => {
        secondAttemptBodies.push(body);
      },
      store,
    });
    expect(room2.view().draft.sendState).toBe("unconfirmed");

    // Manual send is refused while the first attempt is unconfirmed, and the
    // transport is never called again: exactly one attempt overall.
    const retry = await room2.send();
    expect(retry.ok).toBe(false);
    expect(retry.reason ?? "").toContain("unconfirmed");
    expect(secondAttemptBodies).toEqual([]);
    expect(firstAttemptBodies.length + secondAttemptBodies.length).toBe(1);

    // Cleanup: let the crashed attempt settle so no promise dangles.
    releaseTransport();
    await crashed;
  });

  it("T10-4 reload after a successful send keeps it sent and refuses a second send", async () => {
    const store = makeStore();
    const { bodies, transport } = countingTransport();
    const room1 = createTwinRoom({ testMode: true, transport, store });
    expect(room1.approve().approved).toBe(true);
    const body = room1.view().draft.body;
    expect((await room1.send()).ok).toBe(true);
    expect(room1.view().draft.sendState).toBe("sent");
    expect(bodies).toEqual([body]);

    // Reload: drop room1, build room2 on the same store.
    const room2 = createTwinRoom({ testMode: true, transport, store });
    expect(room2.view().draft.sendState).toBe("sent");

    const second = await room2.send();
    expect(second.ok).toBe(false);
    expect(bodies).toEqual([body]);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);
  });

  it("T10-5 reload after a failed send keeps it failed and never resends", async () => {
    const store = makeStore();
    let attempts = 0;
    const room1 = createTwinRoom({
      testMode: true,
      transport: async () => {
        attempts += 1;
        throw new Error("fake transport down");
      },
      store,
    });
    expect(room1.approve().approved).toBe(true);
    const res = await room1.send();
    expect(res.ok).toBe(false);
    expect(room1.view().draft.sendState).toBe("failed");
    expect(attempts).toBe(1);

    // Reload: drop room1, build room2 on the same store with a working
    // transport. The failed send must still never be retried.
    const room2 = createTwinRoom({
      testMode: true,
      transport: async () => {
        attempts += 1;
      },
      store,
    });
    expect(room2.view().draft.sendState).toBe("failed");

    const retry = await room2.send();
    expect(retry.ok).toBe(false);
    expect(attempts).toBe(1);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);
  });

  it("T10-6 a tampered or corrupt persisted package is not treated as approved", async () => {
    // Tampered body: the stored body no longer matches the stored hash.
    {
      const store = makeStore();
      const { transport } = countingTransport();
      const room1 = createTwinRoom({ testMode: true, transport, store });
      const title = room1.view().selectedMeetingTitle;
      expect(room1.approve().approved).toBe(true);
      const key = persistedKeyForMeeting(store, title);
      // The room must have recorded the approved package in the store.
      expect(key).not.toBeNull();
      if (key === null) throw new Error("expected a persisted key");
      const parsed = JSON.parse(store.raw.get(key) as string) as Record<string, unknown>;
      parsed["body"] = `${parsed["body"]}\nTampered line added outside the room.`;
      store.set(key, JSON.stringify(parsed));

      const room2 = createTwinRoom({ testMode: true, transport, store });
      expect(room2.view().draft.approved).toBe(false);
      const res = await room2.send();
      expect(res.ok).toBe(false);
      expect(room1.transportCalls() + room2.transportCalls()).toBe(0);
    }

    // Corrupt JSON: unreadable persisted state restores nothing approved.
    {
      const store = makeStore();
      const { transport } = countingTransport();
      const room1 = createTwinRoom({ testMode: true, transport, store });
      const title = room1.view().selectedMeetingTitle;
      expect(room1.approve().approved).toBe(true);
      const key = persistedKeyForMeeting(store, title);
      // The room must have recorded the approved package in the store.
      expect(key).not.toBeNull();
      if (key === null) throw new Error("expected a persisted key");
      store.set(key, "{{{ this is not JSON");

      const room2 = createTwinRoom({ testMode: true, transport, store });
      expect(room2.view().draft.approved).toBe(false);
      const res = await room2.send();
      expect(res.ok).toBe(false);
      expect(room1.transportCalls() + room2.transportCalls()).toBe(0);
    }
  });
});
