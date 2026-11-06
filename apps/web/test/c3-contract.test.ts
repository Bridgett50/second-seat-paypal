import { describe, expect, it } from "vitest";
import { toLiveAnalysisResult } from "../src/session.js";
import { EVIDENCE_BRIEF_JSON_SCHEMA } from "@second-seat/core";

const SID = "sess-c3";
const IDS = new Set(["seg-1", "seg-2"]);

function region() {
  return { box: "10,10,20,20", concept: null, maskRef: null, spotCheck: null };
}
function entry(over: Record<string, unknown> = {}) {
  return {
    id: "e1", category: "decision", text: "Ship Friday.",
    citations: [{ kind: "segment", segmentId: "seg-1", frameId: null, region: region() }],
    requester: null, assignee: null, acceptance: null, speaker: null, flags: [], ...over,
  };
}
function brief(over: Record<string, unknown> = {}) {
  return {
    meetingId: SID, model: "muse-spark-1.3", promptVersion: "v1",
    settings: { fixtureMode: false, maxCostUsdPerDay: 1 },
    entries: [entry()], flagged: [], createdAt: "2026-03-01T10:00:00Z", ...over,
  };
}
const run = (b: unknown) => toLiveAnalysisResult(b, IDS, SID);

type Node = { type?: unknown; required?: readonly string[]; properties?: Record<string, Node>; items?: Node };
type Path = (string | number)[];
/** Walk the shared declared schema alongside a valid instance and yield every object node. */
function objectNodes(schema: Node, value: unknown, path: Path, out: { path: Path; schema: Node }[]) {
  if (value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    out.push({ path, schema });
    for (const [k, s] of Object.entries(schema.properties)) objectNodes(s, (value as any)[k], [...path, k], out);
  } else if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => objectNodes(schema.items!, v, [...path, i], out));
  }
  return out;
}
function mutate(b: any, path: Path, fn: (o: any) => void) {
  const c = structuredClone(b);
  let o = c;
  for (const p of path) o = o[p];
  fn(o);
  return c;
}

describe("C3 shared response contract", () => {
  it("C3-1 returned meetingId 'm' for a real session id is rejected", () => {
    expect(() => run(brief({ meetingId: "m" }))).toThrow();
  });

  it("C3-2 any other wrong meeting id is rejected even when seg-1 is valid", () => {
    for (const id of ["sess-other", "", "SESS-C3", " sess-c3"]) expect(() => run(brief({ meetingId: id }))).toThrow();
  });

  it("C3-3 malformed nested citation regions are rejected", () => {
    const bad: unknown[] = [
      { box: 123, unexpected: true },
      { box: null },
      { box: null, concept: null, maskRef: null, spotCheck: null, extra: 1 },
      { box: 5, concept: null, maskRef: null, spotCheck: null },
      { box: null, concept: false, maskRef: null, spotCheck: null },
    ];
    for (const r of bad) {
      const b = brief({ entries: [entry({ citations: [{ kind: "segment", segmentId: "seg-1", frameId: null, region: r }] })] });
      expect(() => run(b), JSON.stringify(r)).toThrow();
    }
  });

  it("C3-4 every required key and extra key at every object level of the shared schema is enforced", () => {
    const valid = brief();
    expect(() => run(valid)).not.toThrow();
    const nodes = objectNodes(EVIDENCE_BRIEF_JSON_SCHEMA as unknown as Node, valid, [], []);
    // root, settings, entry, citation, region
    expect(nodes.length).toBe(5);
    for (const { path, schema } of nodes) {
      for (const k of schema.required ?? []) {
        expect(() => run(mutate(valid, path, (o) => delete o[k])), `missing ${[...path, k].join(".")}`).toThrow();
      }
      expect(() => run(mutate(valid, path, (o) => (o.__extra = 1))), `extra at ${path.join(".")}`).toThrow();
      for (const [k, s] of Object.entries(schema.properties ?? {})) {
        const t = ([] as unknown[]).concat(s.type);
        const wrong = t.includes("string") ? 42 : "x";
        if (k === "segmentId" || k === "meetingId") continue; // covered by identity/citation tests
        expect(() => run(mutate(valid, path, (o) => (o[k] = wrong))), `wrong type ${[...path, k].join(".")}`).toThrow();
      }
    }
  });

  it("C3-5 unknown citations and uncited source-backed findings are rejected; flags preserved", () => {
    expect(() => run(brief({ entries: [entry({ citations: [{ kind: "segment", segmentId: "seg-9", frameId: null, region: null }] })] }))).toThrow();
    expect(() => run(brief({ entries: [entry({ citations: [{ kind: "frame", segmentId: null, frameId: "f-1", region: null }] })] }))).toThrow();
    expect(() => run(brief({ entries: [entry({ citations: [] })] }))).toThrow();
    const r = run(brief({ entries: [entry({ citations: [], flags: ["missing_source", "commitment_language"] })] }));
    expect(r.entries[0]!.flags).toEqual(["missing_source", "commitment_language"]);
    expect(r.entries[0]!.segmentIds).toEqual([]);
  });

  it("C3-6 valid complete and valid empty responses both work", () => {
    const full = run(brief({ entries: [entry(), entry({ id: "e2", category: "action_item", citations: [{ kind: "segment", segmentId: "seg-2", frameId: null, region: null }] })] }));
    expect(full).toEqual({ offline: false, entries: [
      { kind: "decision", text: "Ship Friday.", segmentIds: ["seg-1"] },
      { kind: "action_item", text: "Ship Friday.", segmentIds: ["seg-2"] },
    ] });
    expect(run(brief({ entries: [] }))).toEqual({ offline: false, entries: [] });
  });
});
