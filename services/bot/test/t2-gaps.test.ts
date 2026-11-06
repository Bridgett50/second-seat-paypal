import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import { createTwinRoom } from "../src/t2-room.js";
import type { TwinPlugin } from "../src/t2-room.js";

/**
 * T14 review gaps (local only, made-up data).
 *
 * - T14-1/T14-2 use a test-only synthetic plugin (via the `plugins` option
 *   of `createTwinRoom`) whose output carries invented sensitive values, to
 *   prove plugin-output masking inside the room end to end.
 * - T14-3/T14-4 extend the persistence tamper coverage: a body rewritten
 *   together with its approved body must not load as approved, whether the
 *   stored hashes are left stale or recomputed without a matching approval.
 * - T14-5 pins the evidence surface to a single accessor/export.
 */

const SYN_EMAIL = "synthetic-vendor@example.test";
const SYN_PHONE = "555-0187";
const SYN_AMOUNT = "$4,321.00";
const SYN_SECRETS = [SYN_EMAIL, SYN_PHONE, SYN_AMOUNT];

const sensitiveProbe: TwinPlugin = {
  id: "sensitive-probe",
  label: "Sensitive probe",
  run: () => ({
    id: "sensitive-probe",
    title: "Probe output",
    lines: [
      `Contact (synthetic): ${SYN_EMAIL} · ${SYN_PHONE} · budget ${SYN_AMOUNT}.`,
    ],
  }),
};

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

describe("t2 review gaps", () => {
  it("T14-1 a synthetic plugin output with sensitive values is masked before it enters the package", () => {
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {},
      plugins: [sensitiveProbe],
    });
    const proposed = room.runPlugins();
    expect(proposed.map((p) => p.id)).toEqual(["sensitive-probe"]);
    // The proposal itself still carries the raw values (it is shown, not
    // yet in the package): this proves the test would catch an unmasked
    // path instead of passing trivially on benign output.
    const proposedText = proposed
      .map((p) => `${p.title}\n${p.lines.join("\n")}`)
      .join("\n");
    for (const secret of SYN_SECRETS) expect(proposedText).toContain(secret);

    expect(room.approvePluginOutput("sensitive-probe").approved).toBe(true);
    const v = room.view();
    // The included section is in the package body, with every sensitive
    // value replaced by its redaction placeholder.
    expect(v.draft.body).toContain("Probe output");
    for (const secret of SYN_SECRETS) expect(v.draft.body).not.toContain(secret);
    expect(v.draft.body).toContain("[REDACTED:email:1]");
    expect(v.draft.body).toContain("[REDACTED:phone:1]");
    expect(v.draft.body).toContain("[REDACTED:amount:1]");
    // The hash is computed over the masked body, never the raw output.
    expect(v.draft.sha256).toBe(packageHash(v.draft.body));
  });

  it("T14-2 masked plugin values never reach the transport body or the exported file", async () => {
    const bodies: string[] = [];
    const room = createTwinRoom({
      testMode: true,
      transport: async (body: string) => void bodies.push(body),
      plugins: [sensitiveProbe],
    });
    expect(room.approvePluginOutput("sensitive-probe").approved).toBe(true);
    expect(room.approve().approved).toBe(true);
    // While approved (before the sent lock), every package exit is masked.
    const file = room.exportFile();
    expect(file).not.toBeNull();
    for (const secret of SYN_SECRETS) {
      expect(file!.text).not.toContain(secret);
      expect(room.copyText()!).not.toContain(secret);
      expect(room.mailtoHref()!).not.toContain(secret);
    }
    const res = await room.send();
    expect(res.ok).toBe(true);
    expect(bodies.length).toBe(1);
    for (const secret of SYN_SECRETS) expect(bodies[0]).not.toContain(secret);
    expect(bodies[0]).toContain("[REDACTED:email:1]");
    expect(bodies[0]).toContain("[REDACTED:phone:1]");
    expect(bodies[0]).toContain("[REDACTED:amount:1]");
    expect(bodies[0]).toBe(file!.text);
    expect(room.transportBodies()).toEqual(bodies);
  });

  it("T14-3 a persisted body and approved body rewritten together with stale hashes do not load as approved", async () => {
    const store = makeStore();
    const bodies: string[] = [];
    const room1 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => void bodies.push(body),
      store,
    });
    const title = room1.view().selectedMeetingTitle;
    expect(room1.approve().approved).toBe(true);
    const key = persistedKeyForMeeting(store, title);
    expect(key).not.toBeNull();
    if (key === null) throw new Error("expected a persisted key");
    const parsed = JSON.parse(store.raw.get(key) as string) as Record<
      string,
      unknown
    >;
    // Rewrite body AND approved body consistently, but leave the stored
    // hashes stale (as a hand edit outside the room would).
    const forged = `${parsed["body"]}\nForged line added outside the room.`;
    parsed["body"] = forged;
    parsed["approvedBody"] = forged;
    store.set(key, JSON.stringify(parsed));

    const room2 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => void bodies.push(body),
      store,
    });
    expect(room2.view().draft.approved).toBe(false);
    expect(room2.copyText()).toBeNull();
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(bodies).toEqual([]);
  });

  it("T14-4 a persisted package with recomputed hashes but no connector approval for that body is not sendable", async () => {
    const store = makeStore();
    const bodies: string[] = [];
    const room1 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => void bodies.push(body),
      store,
    });
    const title = room1.view().selectedMeetingTitle;
    expect(room1.approve().approved).toBe(true);
    const key = persistedKeyForMeeting(store, title);
    expect(key).not.toBeNull();
    if (key === null) throw new Error("expected a persisted key");
    const parsed = JSON.parse(store.raw.get(key) as string) as Record<
      string,
      unknown
    >;
    // Rewrite body, approved body, AND the editable base together, and
    // recompute both stored hashes — but the connector never approved this
    // forged body, and the stored evidence still pins the original hash.
    const forged = `${parsed["body"]}\nForged approval line added outside the room.`;
    const forgedHash = packageHash(forged);
    parsed["body"] = forged;
    parsed["approvedBody"] = forged;
    parsed["pluginBase"] = forged;
    parsed["bodyHash"] = forgedHash;
    parsed["approvedHash"] = forgedHash;
    store.set(key, JSON.stringify(parsed));

    const room2 = createTwinRoom({
      testMode: true,
      transport: async (body: string) => void bodies.push(body),
      store,
    });
    expect(room2.view().draft.approved).toBe(false);
    expect(room2.copyText()).toBeNull();
    const res = await room2.send();
    expect(res.ok).toBe(false);
    expect(bodies).toEqual([]);
  });

  it("T14-5 the room exposes a single evidence record accessor and a single evidence export", () => {
    const room = createTwinRoom({
      testMode: true,
      transport: async () => {},
    });
    const surface = room as unknown as Record<string, unknown>;
    expect(surface["getEvidenceRecord"]).toBeUndefined();
    expect(surface["exportEvidence"]).toBeUndefined();

    expect(room.approve().approved).toBe(true);
    const record = room.evidenceRecord();
    expect(record).not.toBeNull();
    const json = room.exportEvidenceJson();
    expect(json).not.toBeNull();
    expect(
      (JSON.parse(json!) as { packageHash: string }).packageHash,
    ).toBe(record!.packageHash);
  });
});
