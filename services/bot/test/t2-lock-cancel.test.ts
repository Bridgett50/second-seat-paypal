import { describe, expect, it } from "vitest";
import { createTwinRoom } from "../src/t2-room.js";

/**
 * T11 takeover-cancel + sent-lock (local only, synthetic data).
 *
 * "Reload" is simulated by building a second twin room on the SAME
 * in-memory key-value store and dropping the first room. Transport calls
 * are counted in every test through shared counters plus the rooms'
 * own `transportCalls()`.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i += 1) {
    await sleep(5);
  }
  expect(cond(), label).toBe(true);
}

describe("t2 takeover cancel and sent lock", () => {
  it("T11-1 takeover during an in-flight send aborts the transport and marks the send cancelled", async () => {
    const store = makeStore();
    let calls = 0;
    const bodies: string[] = [];
    let signalSeen: AbortSignal | null | undefined;
    const room = createTwinRoom({
      testMode: true,
      store,
      transport: async (body: string, signal?: AbortSignal) => {
        calls += 1;
        bodies.push(body);
        signalSeen = signal;
        // Completes on its own when never aborted, so a room that cannot
        // cancel still settles instead of hanging the test.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("send aborted by takeover"));
            },
            { once: true },
          );
        });
      },
    });
    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;

    const sendP = room.send();
    await waitFor(() => calls === 1, "transport started before takeover");
    room.takeOver();
    const res = await sendP;

    expect(res.ok).toBe(false);
    expect(res.reason ?? "").toMatch(/cancel/i);
    expect(signalSeen instanceof AbortSignal).toBe(true);
    expect(room.view().draft.sendState).toBe("cancelled");
    expect(room.sendIntent()?.status).toBe("cancelled");
    expect(room.evidenceRecord()?.sendState).toBe("cancelled");
    expect(bodies).toEqual([body]);
    expect(calls).toBe(1);
    expect(room.transportCalls()).toBe(1);

    // A cancelled send is never retried automatically.
    const retry = await room.send();
    expect(retry.ok).toBe(false);
    expect(calls).toBe(1);
    expect(room.transportCalls()).toBe(1);
  });

  it("T11-2 a cancelled send is never retried, survives reload, and cannot be re-approved", async () => {
    const store = makeStore();
    const bodies: string[] = [];
    const abortable = async (body: string, signal?: AbortSignal) => {
      bodies.push(body);
      await new Promise<void>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("stalled without abort")), 5000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("send aborted by takeover"));
          },
          { once: true },
        );
      });
    };
    const room1 = createTwinRoom({ testMode: true, transport: abortable, store });
    expect(room1.approve().approved).toBe(true);
    const sendP = room1.send();
    await waitFor(() => bodies.length === 1, "transport started before takeover");
    room1.takeOver();
    const res = await sendP;
    expect(res.ok).toBe(false);
    expect(room1.view().draft.sendState).toBe("cancelled");
    expect(room1.sendIntent()?.status).toBe("cancelled");

    // No retry and no re-approval on the same room.
    expect((await room1.send()).ok).toBe(false);
    expect(room1.approve()).toEqual({ approved: false });
    expect(bodies.length).toBe(1);

    // Reload: drop room1, build room2 on the same store.
    const room2 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => {
        bodies.push(body);
      },
      store,
    });
    expect(room2.view().draft.sendState).toBe("cancelled");
    expect(room2.sendIntent()?.status).toBe("cancelled");
    expect(room2.approve()).toEqual({ approved: false });
    expect(room2.view().draft.sendState).toBe("cancelled");
    const retry = await room2.send();
    expect(retry.ok).toBe(false);
    expect(bodies.length).toBe(1);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);
  });

  it("T11-3 a sent package is locked: export, edit and re-approve are refused immediately after send", async () => {
    let calls = 0;
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {
        calls += 1;
      },
    });
    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;
    expect((await room.send()).ok).toBe(true);
    expect(room.view().draft.sendState).toBe("sent");

    // The package is locked: nothing exits through the package routes.
    expect(room.view().exportInventory).toEqual({ copy: false, mailto: false, file: false });
    expect(room.copyText()).toBeNull();
    expect(room.mailtoHref()).toBeNull();
    expect(room.exportFile()).toBeNull();
    expect(() => room.editDraft(`${body}\nSneaky extra line.`)).toThrow();
    expect(room.view().draft.body).toBe(body);
    expect(room.approve()).toEqual({ approved: false });
    expect((await room.send()).ok).toBe(false);
    expect(calls).toBe(1);
    expect(room.transportCalls()).toBe(1);

    // The evidence record is the audit trail, not the package: its JSON
    // export stays available after the send.
    const json = room.exportEvidenceJson();
    expect(json).not.toBeNull();
    expect((JSON.parse(json as string) as { sendState: string }).sendState).toBe("sent");
  });

  it("T11-4 after reload an unconfirmed package cannot be re-approved or resent", async () => {
    const store = makeStore();
    const firstAttemptBodies: string[] = [];
    let releaseTransport!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    const hanging = async (body: string) => {
      firstAttemptBodies.push(body);
      await gate;
    };
    const room1 = createTwinRoom({ testMode: true, transport: hanging, store });
    expect(room1.approve().approved).toBe(true);
    const crashed = room1.send();
    await waitFor(() => firstAttemptBodies.length === 1, "first attempt reached the transport");
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

    // Re-approval is refused while the first attempt is unconfirmed, so the
    // same package cannot be re-armed and sent a second time.
    expect(room2.approve()).toEqual({ approved: false });
    expect(room2.view().draft.sendState).toBe("unconfirmed");

    const retry = await room2.send();
    expect(retry.ok).toBe(false);
    expect(retry.reason ?? "").toContain("unconfirmed");
    expect(secondAttemptBodies).toEqual([]);
    expect(firstAttemptBodies.length + secondAttemptBodies.length).toBe(1);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(1);

    // Cleanup: let the crashed attempt settle so no promise dangles.
    releaseTransport();
    await crashed;
  });

  it("T11-5 a consistently rewritten persisted package with stale hashes is not approved", async () => {
    const store = makeStore();
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    const room1 = createTwinRoom({ testMode: true, transport, store });
    const title = room1.view().selectedMeetingTitle;
    expect(room1.approve().approved).toBe(true);
    const key = persistedKeyForMeeting(store, title);
    expect(key).not.toBeNull();
    if (key === null) throw new Error("expected a persisted key");

    // Rewrite the body and the approved body consistently, but leave the
    // stored hashes stale: approval must not survive.
    const parsed = JSON.parse(store.raw.get(key) as string) as Record<string, unknown>;
    const rewritten = `${parsed["body"] as string}\nConsistent rewrite outside the room.`;
    parsed["body"] = rewritten;
    parsed["approvedBody"] = rewritten;
    store.set(key, JSON.stringify(parsed));

    const room2 = createTwinRoom({ testMode: true, transport, store });
    expect(room2.view().draft.approved).toBe(false);
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(calls).toBe(0);
    expect(room1.transportCalls() + room2.transportCalls()).toBe(0);
  });

  it("T11-6 a transport that completes despite takeover is reported as sent, not cancelled", async () => {
    const calls: string[] = [];
    let signalSeen: AbortSignal | null | undefined;
    const room = createTwinRoom({
      testMode: true,
      transport: async (body: string, signal?: AbortSignal) => {
        calls.push(body);
        signalSeen = signal;
        // Ignores the abort and completes anyway: the recall did not happen.
        await sleep(20);
      },
    });
    expect(room.approve().approved).toBe(true);
    const body = room.view().draft.body;
    const sendP = room.send();
    await waitFor(() => calls.length === 1, "transport started before takeover");
    room.takeOver();
    const res = await sendP;

    expect(signalSeen instanceof AbortSignal).toBe(true);
    expect(res.ok).toBe(true);
    expect(room.view().draft.sendState).toBe("sent");
    expect(room.sendIntent()?.status).toBe("sent");
    expect(room.evidenceRecord()?.sendState).toBe("sent");
    expect(calls).toEqual([body]);
    expect(room.transportCalls()).toBe(1);
  });
});
