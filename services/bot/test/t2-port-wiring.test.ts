import { describe, expect, it, vi } from "vitest";
import { createTwinRoom as createCoreTwinRoom, packageHash as corePackageHash } from "@second-seat/core";
import { createMeetingConnector, packageHash as frozenPackageHash } from "../src/meeting/connector.js";
import { T2_CONNECTOR_FACTORY, createTwinRoom as createBotTwinRoom } from "../src/t2-room.js";

describe("T2 port wiring", () => {
  it("T2P-3 core packageHash equals the frozen connector packageHash", () => {
    const bodies = ["", "abc", "héllo ✓ 📎\n", "x".repeat(1000)];
    for (const body of bodies) {
      expect(corePackageHash(body)).toBe(frozenPackageHash(body));
    }
  });

  it("T2P-4 the bot twin room is built on the frozen createMeetingConnector", () => {
    expect(T2_CONNECTOR_FACTORY).toBe(createMeetingConnector);
    let calls = 0;
    const spy = () => {
      calls += 1;
      return createMeetingConnector();
    };
    createCoreTwinRoom({ connector: spy, testMode: true, transport: async () => {} });
    expect(calls).toBe(1);
    expect(createBotTwinRoom({ testMode: true, transport: async () => {} }).view().meetings.length).toBeGreaterThan(0);
  });

  it("T2P-5 the core twin room refuses to start without an injected connector", () => {
    expect(() => createCoreTwinRoom({} as never)).toThrow(/injected meeting connector/);
  });

  it("T2P-6 the wrapper ignores an injected connector and sends the exact approved body once", async () => {
    const spy = vi.fn();
    const bodies: string[] = [];
    const room = createBotTwinRoom({
      connector: spy,
      testMode: true,
      transport: async (b: string) => {
        bodies.push(b);
      },
    } as never);
    for (let i = 0; i < 20; i += 1) {
      if (!room.streamNextLine().appended) break;
    }
    expect(room.approve().approved).toBe(true);
    const approvedBody = room.view().draft.body;
    const res = await room.send();
    expect(res.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toBe(approvedBody);
    expect(room.transportCalls()).toBe(1);
  });
});
