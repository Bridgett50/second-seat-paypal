import { describe, it, expect } from "vitest";
import {
  COMPARE_CANCELLED_REASON,
  COMPARE_FAILED_REASON,
  COMPARE_PAUSED_REASON,
  COMPARE_SENT_REASON,
  COMPARE_UNCONFIRMED_REASON,
  compareUnavailableReason,
  createTwinRoom,
} from "../src/t2-room.js";

function makeRoom() {
  const room = createTwinRoom({ testMode: true, transport: async () => {} });
  return room;
}

function streamAllTranscript(room: ReturnType<typeof createTwinRoom>): string[] {
  let guard = 0;
  while (room.streamNextLine().appended && guard < 100) guard += 1;
  return [...room.view().transcript];
}

describe("compare unavailable reason", () => {
  it("CR-1 helper returns the approved text per state with paused first", () => {
    expect(COMPARE_PAUSED_REASON).toBe(
      "Compare is unavailable: you took over; the twin is paused. Resume the twin, then compare.",
    );
    expect(COMPARE_SENT_REASON).toBe("Compare is unavailable: this package was already sent.");
    expect(COMPARE_FAILED_REASON).toBe("Compare is unavailable: the last send failed.");
    expect(COMPARE_CANCELLED_REASON).toBe("Compare is unavailable: the send was cancelled by takeover.");
    expect(COMPARE_UNCONFIRMED_REASON).toBe(
      "Compare is unavailable: the send is unconfirmed — check your outbox.",
    );
    expect(compareUnavailableReason("paused (you took over)", "unsent")).toBe(COMPARE_PAUSED_REASON);
    expect(compareUnavailableReason("paused (you took over)", "unsent")).toBe(
      "Compare is unavailable: you took over; the twin is paused. Resume the twin, then compare.",
    );
    expect(compareUnavailableReason("active", "sent")).toBe(COMPARE_SENT_REASON);
    expect(compareUnavailableReason("active", "sent")).toBe(
      "Compare is unavailable: this package was already sent.",
    );
    expect(compareUnavailableReason("active", "failed")).toBe(COMPARE_FAILED_REASON);
    expect(compareUnavailableReason("active", "failed")).toBe(
      "Compare is unavailable: the last send failed.",
    );
    expect(compareUnavailableReason("active", "cancelled")).toBe(COMPARE_CANCELLED_REASON);
    expect(compareUnavailableReason("active", "cancelled")).toBe(
      "Compare is unavailable: the send was cancelled by takeover.",
    );
    expect(compareUnavailableReason("active", "unconfirmed")).toBe(COMPARE_UNCONFIRMED_REASON);
    expect(compareUnavailableReason("active", "unconfirmed")).toBe(
      "Compare is unavailable: the send is unconfirmed — check your outbox.",
    );
    expect(compareUnavailableReason("active", "unsent")).toBeNull();
    expect(compareUnavailableReason("paused (you took over)", "sent")).toBe(COMPARE_PAUSED_REASON);
    expect(compareUnavailableReason("paused (you took over)", "sent")).toBe(
      "Compare is unavailable: you took over; the twin is paused. Resume the twin, then compare.",
    );
  });

  it("CR-2 helper is non-null exactly when compareVisible is null on real rooms", async () => {
    const fresh = makeRoom();
    streamAllTranscript(fresh);
    let v = fresh.view();
    expect(fresh.compareVisible("x")).not.toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBeNull();

    fresh.approve();
    v = fresh.view();
    expect(fresh.compareVisible("x")).not.toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBeNull();

    const taken = makeRoom();
    streamAllTranscript(taken);
    taken.takeOver();
    v = taken.view();
    expect(taken.compareVisible("x")).toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBe(COMPARE_PAUSED_REASON);

    taken.resume();
    v = taken.view();
    expect(taken.compareVisible("x")).not.toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBeNull();

    const sent = makeRoom();
    streamAllTranscript(sent);
    sent.approve();
    await sent.send();
    v = sent.view();
    expect(v.draft.sendState).toBe("sent");
    expect(sent.compareVisible("x")).toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBe(COMPARE_SENT_REASON);

    const failed = createTwinRoom({
      testMode: true,
      transport: async () => {
        throw new Error("fail");
      },
    });
    streamAllTranscript(failed);
    failed.approve();
    await failed.send();
    v = failed.view();
    expect(v.draft.sendState).toBe("failed");
    expect(failed.compareVisible("x")).toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBe(COMPARE_FAILED_REASON);

    let release!: () => void;
    let aborted = false;
    const pendingTransport = async (_body: string, signal?: AbortSignal) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }
      await new Promise<void>((resolve, reject) => {
        release = () => resolve();
        if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      if (aborted) throw new Error("aborted");
    };
    const cancelled = createTwinRoom({ testMode: true, transport: pendingTransport });
    streamAllTranscript(cancelled);
    cancelled.approve();
    const sendP = cancelled.send().catch(() => {});
    cancelled.takeOver();
    v = cancelled.view();
    expect(v.twinStatus).toBe("paused (you took over)");
    // wait for send to settle after takeover abort
    await sendP;
    v = cancelled.view();
    expect(v.draft.sendState).toBe("cancelled");
    expect(cancelled.compareVisible("x")).toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBe(COMPARE_PAUSED_REASON);

    cancelled.resume();
    v = cancelled.view();
    expect(v.twinStatus).toBe("active");
    expect(v.draft.sendState).toBe("cancelled");
    expect(cancelled.compareVisible("x")).toBeNull();
    expect(compareUnavailableReason(v.twinStatus, v.draft.sendState)).toBe(COMPARE_CANCELLED_REASON);
  });
});
