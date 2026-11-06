import { describe, expect, it } from "vitest";
import { packageHash } from "../src/meeting/connector.js";
import { SEEDED_SENSITIVE_VALUES, createTwinRoom } from "../src/t2-room.js";

function makeRoom(clock: { now: number }) {
  const sent: string[] = [];
  const room = createTwinRoom({
    testMode: true,
    transport: async (body) => void sent.push(body),
    now: () => clock.now,
  });
  return { room, sent };
}

function getByCategory(redactions: readonly { category: string; count: number; placeholders: readonly string[]; positions: readonly number[] }[], category: string) {
  const found = redactions.find((r) => r.category === category);
  if (!found) throw new Error(`missing category ${category}`);
  return found;
}

function parseExported(raw: string | null) {
  expect(raw).not.toBeNull();
  if (raw === null) throw new Error("exported JSON is null");
  return JSON.parse(raw);
}

describe("t2 evidence counts", () => {
  it("EC-1 including a plugin output keeps the exported redactions matching the package body, before and after send", async () => {
    const clock = { now: Date.now() };
    const { room } = makeRoom(clock);
    const inc = room.approvePluginOutput("action-items");
    expect(inc).toEqual({ approved: true });
    room.approve();
    const body = room.view().draft.body;
    const exportedRaw = room.exportEvidenceJson();
    const exported = parseExported(exportedRaw);
    const counts = exported.redactions ?? exported.evidence?.redactions ?? exported.record?.redactions;
    // fallback if nested
    const redactions = counts as { category: string; count: number; placeholders: readonly string[]; positions: readonly number[] }[];
    const bodyCounts = (() => {
      // use placeholder count from body via regex match, or via exported helper if needed
      const re = /\[REDACTED:(email|phone|amount):\d+\]/g;
      const c: Record<string, number> = { email: 0, phone: 0, amount: 0 };
      for (const m of body.matchAll(re)) {
        const cat = m[1] as string;
        c[cat] = (c[cat] ?? 0) + 1;
      }
      return c;
    })();
    for (const cat of ["email", "phone", "amount"] as const) {
      const e = getByCategory(redactions, cat);
      expect(e.count).toBe(1);
      expect(e.count).toBe(bodyCounts[cat]);
      expect(e.placeholders.length).toBe(e.count);
      expect(e.positions.length).toBe(e.count);
      for (let i = 0; i < e.count; i++) {
        const pos = e.positions[i] as number;
        const ph = e.placeholders[i] as string;
        expect(body.slice(pos, pos + ph.length)).toBe(ph);
      }
    }
    expect((await room.send()).ok).toBe(true);
    const exported2Raw = room.exportEvidenceJson();
    const exported2 = parseExported(exported2Raw);
    const redactions2 = (exported2.redactions ?? exported2.evidence?.redactions ?? exported2.record?.redactions) as typeof redactions;
    expect(exported2.sendState ?? exported2.evidence?.sendState ?? exported2.record?.sendState).toBe("sent");
    for (const cat of ["email", "phone", "amount"] as const) {
      const e = getByCategory(redactions2, cat);
      expect(e.count).toBe(1);
    }
  });

  it("EC-2 re-saving the same text through editDraft keeps the exported redactions", () => {
    const clock = { now: Date.now() };
    const { room } = makeRoom(clock);
    const body = room.view().draft.body;
    room.editDraft(body);
    room.approve();
    const curBody = room.view().draft.body;
    const exported = parseExported(room.exportEvidenceJson());
    const redactions = (exported.redactions ?? exported.evidence?.redactions ?? exported.record?.redactions) as { category: string; count: number; placeholders: readonly string[]; positions: readonly number[] }[];
    for (const cat of ["email", "phone", "amount"] as const) {
      const e = getByCategory(redactions, cat);
      expect(e.count).toBe(1);
      expect(e.placeholders.length).toBe(1);
      expect(e.positions.length).toBe(1);
      const pos = e.positions[0] as number;
      const ph = e.placeholders[0] as string;
      expect(curBody.slice(pos, pos + ph.length)).toBe(ph);
    }
  });

  it("EC-3 an edit that adds a raw email exports two email redactions at their own positions", () => {
    const clock = { now: Date.now() };
    const { room } = makeRoom(clock);
    const body = room.view().draft.body;
    room.editDraft(body + "\nmail bob@example.test");
    room.approve();
    const curBody = room.view().draft.body;
    const exportedRaw = room.exportEvidenceJson();
    const exported = parseExported(exportedRaw);
    const redactions = (exported.redactions ?? exported.evidence?.redactions ?? exported.record?.redactions) as { category: string; count: number; placeholders: readonly string[]; positions: readonly number[] }[];
    const email = getByCategory(redactions, "email");
    expect(email.count).toBe(2);
    expect(email.placeholders.length).toBe(2);
    expect(email.positions.length).toBe(2);
    expect(email.positions[0]).not.toBe(email.positions[1]);
    for (let i = 0; i < email.count; i++) {
      const pos = email.positions[i] as number;
      const ph = email.placeholders[i] as string;
      expect(curBody.slice(pos, pos + ph.length)).toBe(ph);
    }
    const phone = getByCategory(redactions, "phone");
    expect(phone.count).toBe(1);
    const amount = getByCategory(redactions, "amount");
    expect(amount.count).toBe(1);
    expect(exportedRaw).not.toContain("bob@example.test");
  });

  it("EC-4 approving the untouched draft exports the original redactions and package hash", () => {
    const clock = { now: Date.now() };
    const { room } = makeRoom(clock);
    room.approve();
    const exported = parseExported(room.exportEvidenceJson());
    const redactions = (exported.redactions ?? exported.evidence?.redactions ?? exported.record?.redactions) as { category: string; count: number; placeholders: readonly string[]; positions: readonly number[] }[];
    const email = getByCategory(redactions, "email");
    expect(email.count).toBe(1);
    expect(email.positions).toEqual([348]);
    const phone = getByCategory(redactions, "phone");
    expect(phone.count).toBe(1);
    expect(phone.positions).toEqual([369]);
    const amount = getByCategory(redactions, "amount");
    expect(amount.count).toBe(1);
    expect(amount.positions).toEqual([397]);
    const pkgHash = exported.packageHash ?? exported.evidence?.packageHash ?? exported.record?.packageHash;
    expect(pkgHash).toBe(packageHash(room.view().draft.body));
  });
});
