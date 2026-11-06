import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import { SEEDED_SENSITIVE_VALUES, createTwinRoom } from "../src/t2-room.js";

type TestStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function makeStore(): TestStore {
  const raw = new Map<string, string>();
  return {
    get: (k: string) => (raw.has(k) ? (raw.get(k) as string) : null),
    set: (k: string, v: string) => {
      raw.set(k, v);
    },
    remove: (k: string) => {
      raw.delete(k);
    },
  };
}

function makeRoom(opts?: {
  store?: TestStore;
  transport?: (body: string) => Promise<void>;
}) {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: opts?.transport ?? (async (body) => void sent.push(body)),
    ...(opts?.store ? { store: opts.store } : {}),
  });
  return { room, sent };
}

describe("t2 plugins", () => {
  it("T12-1 plugin outputs are proposed but excluded from the package until the owner approves them", async () => {
    const { room, sent } = makeRoom();
    const proposed = room.runPlugins();
    expect(proposed.map((p) => p.id).sort()).toEqual([
      "action-items",
      "calendar-followup",
    ]);
    for (const output of proposed) {
      expect(output.title.length).toBeGreaterThan(0);
      expect(output.lines.length).toBeGreaterThan(0);
    }

    // Proposed outputs are shown but NOT in the package.
    const body = room.view().draft.body;
    for (const output of proposed) {
      expect(body).not.toContain(output.title);
      for (const line of output.lines) expect(body).not.toContain(line);
    }
    const states = room.view().plugins.map((p) => p.status);
    expect(states).toEqual(["proposed", "proposed"]);

    // Approving + sending the package without plugin approval excludes them.
    expect(room.approve().approved).toBe(true);
    const res = await room.send();
    expect(res.ok).toBe(true);
    expect(sent.length).toBe(1);
    for (const output of proposed) {
      expect(sent[0]).not.toContain(output.title);
      for (const line of output.lines) expect(sent[0]).not.toContain(line);
    }
  });

  it("T12-2 approving a plugin output includes it in the package body and hash and clears the previous approval", () => {
    const { room } = makeRoom();
    const before = room.view().draft.body;
    const beforeHash = room.view().draft.sha256;
    expect(room.approve().approved).toBe(true);
    expect(room.view().draft.approved).toBe(true);

    const proposed = room.runPlugins();
    const first = proposed[0]!;
    expect(room.approvePluginOutput(first.id).approved).toBe(true);

    // The output is now in the package body, so the approval is cleared
    // exactly like an edit and the hash covers the included output.
    const v = room.view();
    expect(v.draft.approved).toBe(false);
    expect(v.draft.body).toContain(first.title);
    for (const line of first.lines) expect(v.draft.body).toContain(line);
    expect(v.draft.body).not.toBe(before);
    expect(v.draft.sha256).toBe(packageHash(v.draft.body));
    expect(v.draft.sha256).not.toBe(beforeHash);

    // Re-approving binds the new hash; removing the output clears it again.
    expect(room.approve().approved).toBe(true);
    expect(room.view().draft.approved).toBe(true);
    const approvedHash = room.view().draft.sha256;
    expect(room.rejectPluginOutput(first.id).rejected).toBe(true);
    const after = room.view();
    expect(after.draft.approved).toBe(false);
    expect(after.draft.body).not.toContain(first.title);
    expect(after.draft.sha256).toBe(packageHash(after.draft.body));
    expect(after.draft.sha256).not.toBe(approvedHash);
  });

  it("T12-3 rejected or never-approved plugin outputs never reach the transport", async () => {
    const { room, sent } = makeRoom();
    const proposed = room.runPlugins();
    expect(proposed.length).toBe(2);
    expect(room.rejectPluginOutput(proposed[0]!.id).rejected).toBe(true);
    // The second output is never approved or rejected: still excluded.
    expect(room.approve().approved).toBe(true);
    const res = await room.send();
    expect(res.ok).toBe(true);
    expect(sent.length).toBe(1);
    for (const output of proposed) {
      expect(sent[0]).not.toContain(output.title);
      for (const line of output.lines) expect(sent[0]).not.toContain(line);
    }
    expect(room.transportBodies()).toEqual(sent);
  });

  it("T12-4 plugin outputs only use the selected meeting's context", () => {
    const { room } = makeRoom();
    const meetings = room.view().meetings;
    expect(meetings.length).toBeGreaterThanOrEqual(2);
    const a = meetings[0]!;
    const b = meetings[1]!;

    room.selectMeeting(a.id);
    for (let i = 0; i < 10; i += 1) {
      if (!room.streamNextLine().appended) break;
    }
    const outA = room.runPlugins();
    expect(outA.length).toBe(2);
    for (const output of outA) {
      expect(output.title).toContain(a.title);
      expect(output.title).not.toContain(b.title);
      for (const line of output.lines) expect(line).not.toContain(b.title);
    }

    room.selectMeeting(b.id);
    const outB = room.runPlugins();
    expect(outB.length).toBe(2);
    for (const output of outB) {
      expect(output.title).toContain(b.title);
      expect(output.title).not.toContain(a.title);
      for (const line of output.lines) expect(line).not.toContain(a.title);
    }
    // Nothing streamed from A leaks into B's outputs.
    const aText = outA.map((o) => o.lines.join("\n")).join("\n");
    const bText = outB.map((o) => o.lines.join("\n")).join("\n");
    expect(aText).not.toBe(bText);
  });

  it("T12-5 plugins cannot run or change the package after takeover or after send", async () => {
    const { room } = makeRoom();
    const bodyBefore = room.view().draft.body;
    room.takeOver();
    expect(room.runPlugins()).toEqual([]);
    expect(room.approvePluginOutput("action-items").approved).toBe(false);
    expect(room.rejectPluginOutput("action-items").rejected).toBe(false);
    expect(room.view().draft.body).toBe(bodyBefore);

    const { room: room2, sent } = makeRoom();
    expect(room2.approve().approved).toBe(true);
    expect((await room2.send()).ok).toBe(true);
    expect(sent.length).toBe(1);
    const sentBody = room2.view().draft.body;
    expect(room2.runPlugins()).toEqual([]);
    expect(room2.approvePluginOutput("action-items").approved).toBe(false);
    expect(room2.rejectPluginOutput("action-items").rejected).toBe(false);
    expect(room2.view().draft.body).toBe(sentBody);
  });

  it("T12-6 approved plugin outputs survive reload and stay redacted", async () => {
    const store = makeStore();
    const { sent, room: room1 } = makeRoom({ store });
    const proposed = room1.runPlugins();
    expect(proposed.length).toBe(2);
    expect(room1.approvePluginOutput("action-items").approved).toBe(true);
    expect(room1.view().draft.approved).toBe(false);
    expect(room1.approve().approved).toBe(true);
    const body = room1.view().draft.body;
    expect(body).toContain(proposed[0]!.title);
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(body).not.toContain(secret);
    }

    // Reload on the same store: body, approval, and plugin state survive.
    const room2 = createTwinRoom({
      testMode: true,
      transport: async (text) => void sent.push(text),
      store,
    });
    const v = room2.view();
    expect(v.draft.body).toBe(body);
    expect(v.draft.sha256).toBe(packageHash(body));
    expect(v.draft.approved).toBe(false);
    expect(v.draft.body).toContain(proposed[0]!.title);
    const statuses = Object.fromEntries(
      v.plugins.map((p) => [p.id, p.status] as const),
    );
    expect(statuses["action-items"]).toBe("approved");
    for (const secret of SEEDED_SENSITIVE_VALUES) {
      expect(v.draft.body).not.toContain(secret);
    }

    // Approval is never restored: a fresh approve() is required to send.
    expect(room2.approve().approved).toBe(true);
    const res = await room2.send();
    expect(res.ok).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]).toBe(body);
    expect(sent[0]).toContain(proposed[0]!.title);
  });
});
