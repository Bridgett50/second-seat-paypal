import { it, expect, vi, describe } from "vitest";
import { createMeetAdmissionProof, type MeetAdmissionTransport } from "../src/meetAdmissionProof.js";
const validOpts = { ownerId: "synthetic-owner", meetingUrl: "https://meet.google.com/abc-defg-hij", displayName: "Bridgett AI twin (test)" };
describe("invalid config", () => {
  const cases: Array<{ label: string; opts: typeof validOpts }> = [
    { label: "owner empty", opts: { ...validOpts, ownerId: "" } },
    { label: "owner_demo", opts: { ...validOpts, ownerId: "owner_demo" } },
    { label: "http meet", opts: { ...validOpts, meetingUrl: "http://meet.google.com/abc-defg-hij" } },
    { label: "evil host", opts: { ...validOpts, meetingUrl: "https://evil.test/abc-defg-hij" } },
    { label: "query on URL", opts: { ...validOpts, meetingUrl: "https://meet.google.com/abc-defg-hij?x=1" } },
    { label: "displayName human only", opts: { ...validOpts, displayName: "Bridgett" } },
    { label: "displayName missing test label", opts: { ...validOpts, displayName: "Bridgett AI twin" } },
  ];
  for (const { label, opts } of cases) {
    it(`throws for ${label}`, () => {
      const transport: MeetAdmissionTransport = { join: vi.fn(async () => true), leave: vi.fn(async () => {}) };
      expect(() => createMeetAdmissionProof(opts, transport)).toThrow();
      expect(transport.join).toHaveBeenCalledTimes(0);
    });
  }
});
it("captures validated scope", async () => {
  const opts = { ...validOpts };
  let sig: AbortSignal | undefined;
  const transport: MeetAdmissionTransport = {
    join: vi.fn(async (u, n, s) => { sig = s; return true; }),
    leave: vi.fn(async () => {}),
  };
  const p = createMeetAdmissionProof(opts, transport);
  opts.meetingUrl = "https://evil.test";
  opts.displayName = "unapproved";
  const ok = await p.join();
  expect(ok).toBe(true);
  expect(transport.join).toHaveBeenCalledTimes(1);
  expect(transport.join).toHaveBeenCalledWith(validOpts.meetingUrl, validOpts.displayName, expect.any(AbortSignal));
  expect(sig).toBeInstanceOf(AbortSignal);
  await p.stop();
});
it("late admission stop aborts", async () => {
  let resolveJoin!: (v: boolean) => void;
  let sig: AbortSignal | undefined;
  let leaveCount = 0;
  const transport: MeetAdmissionTransport = {
    join: vi.fn((_, __, s) => { sig = s; return new Promise<boolean>(r => { resolveJoin = r; }); }),
    leave: vi.fn(async () => { leaveCount++; }),
  };
  const p = createMeetAdmissionProof({ ...validOpts }, transport);
  const pending = p.join();
  expect(p.phase()).toBe("joining");
  const stopping = p.stop();
  expect(p.phase()).toBe("stopping");
  expect(sig!.aborted).toBe(true);
  resolveJoin(true);
  const ok = await pending;
  expect(ok).toBe(false);
  await stopping;
  expect(p.phase()).toBe("stopped");
  expect(await p.join()).toBe(false);
  expect(transport.join).toHaveBeenCalledTimes(1);
  await p.stop();
  expect(leaveCount).toBe(1);
});
describe("admitted/failed controls", () => {
  it("admitted then stopped", async () => {
    const t: MeetAdmissionTransport = { join: vi.fn(async () => true), leave: vi.fn(async () => {}) };
    const p = createMeetAdmissionProof({ ...validOpts }, t);
    expect(await p.join()).toBe(true);
    expect(p.phase()).toBe("admitted");
    expect(await p.join()).toBe(false);
    expect(t.join).toHaveBeenCalledTimes(1);
    await p.stop();
    expect(p.phase()).toBe("stopped");
  });
  it("failed on false closes once", async () => {
    const t: MeetAdmissionTransport = { join: vi.fn(async () => false), leave: vi.fn(async () => {}) };
    const p = createMeetAdmissionProof({ ...validOpts }, t);
    expect(await p.join()).toBe(false);
    expect(p.phase()).toBe("failed");
    expect(t.leave).toHaveBeenCalledTimes(1);
  });
  it("failed on throw closes once", async () => {
    const t: MeetAdmissionTransport = { join: vi.fn(async () => { throw new Error("x"); }), leave: vi.fn(async () => {}) };
    const p = createMeetAdmissionProof({ ...validOpts }, t);
    expect(await p.join()).toBe(false);
    expect(p.phase()).toBe("failed");
    expect(t.leave).toHaveBeenCalledTimes(1);
  });
});

it("stop waits for leave cleanup and is idempotent", async () => {
  let capturedSignal: AbortSignal | undefined;
  let resolveLeave!: () => void;
  let leaveCount = 0;
  const transport: MeetAdmissionTransport = {
    join: vi.fn(async (_u: string, _n: string, s: AbortSignal) => {
      capturedSignal = s;
      return true;
    }),
    leave: vi.fn(() => {
      leaveCount++;
      return new Promise<void>((res) => {
        resolveLeave = res;
      });
    }),
  };
  const p = createMeetAdmissionProof({ ...validOpts }, transport);
  expect(await p.join()).toBe(true);
  expect(p.phase()).toBe("admitted");
  const stopPromise = p.stop();
  expect(p.phase()).toBe("stopping");
  expect(capturedSignal?.aborted).toBe(true);
  expect(await p.join()).toBe(false);
  expect(transport.join).toHaveBeenCalledTimes(1);
  resolveLeave();
  await stopPromise;
  expect(p.phase()).toBe("stopped");
  await p.stop();
  await p.stop();
  expect(leaveCount).toBe(1);
  expect(transport.leave).toHaveBeenCalledTimes(1);
});

it("stop rejects with generic cleanup message and does not leak internal error", async () => {
  let capturedSignal: AbortSignal | undefined;
  const internalMsg = "synthetic sensitive INTERNAL_SECRET_TOKEN_DO_NOT_LEAK_12345";
  const transport: MeetAdmissionTransport = {
    join: vi.fn(async (_u: string, _n: string, s: AbortSignal) => {
      capturedSignal = s;
      return true;
    }),
    leave: vi.fn(async () => {
      throw new Error(internalMsg);
    }),
  };
  const p = createMeetAdmissionProof({ ...validOpts }, transport);
  expect(await p.join()).toBe(true);
  expect(p.phase()).toBe("admitted");
  const firstStop = p.stop();
  await expect(firstStop).rejects.toThrow("Meet proof cleanup unconfirmed");
  expect(p.phase()).toBe("stop-unconfirmed");
  let firstMessage = "";
  try {
    await p.stop();
  } catch (e) {
    if (e instanceof Error) firstMessage = e.message;
  }
  expect(firstMessage).toBe("Meet proof cleanup unconfirmed");
  expect(firstMessage).not.toContain("SECRET");
  expect(capturedSignal?.aborted).toBe(true);
  expect(await p.join()).toBe(false);
  expect(transport.join).toHaveBeenCalledTimes(1);
  const secondStop = p.stop();
  await expect(secondStop).rejects.toThrow("Meet proof cleanup unconfirmed");
  expect(p.phase()).toBe("stop-unconfirmed");
  expect(transport.leave).toHaveBeenCalledTimes(1);
  let secondMessage = "";
  try {
    await p.stop();
  } catch (e) {
    if (e instanceof Error) secondMessage = e.message;
  }
  expect(secondMessage).toBe("Meet proof cleanup unconfirmed");
  expect(transport.leave).toHaveBeenCalledTimes(1);
});
