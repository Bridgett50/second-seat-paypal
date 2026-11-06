// C9 PREPARATION ONLY: run-config schema and readiness/release checklists, exercised with dummy values.
// No sealed data, model, Modal or paid calls; all network is a fake fetch.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";
import { validateRunConfig, sparkProofClientOptions, RUN_CONFIG_REQUIRED_KEYS } from "@second-seat/bot/dist/src/release/runConfig.js";
import { createSessionStore } from "../src/session.js";

const root = resolve(__dirname, "../../..");
interface Call { url: string; body: string }
function sse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
const userMsg = (c: Call) =>
  ((JSON.parse(c.body) as { messages?: { role?: string; content?: string }[] }).messages ?? []).find((m) => m.role === "user")?.content ?? "";

function brief(meetingId: string) {
  return {
    meetingId,
    model: "muse-spark-1.3",
    promptVersion: "brief-v2",
    settings: { fixtureMode: false, maxCostUsdPerDay: null },
    entries: [{
      id: "e1", category: "decision", text: "keep net-45",
      citations: [{ kind: "segment", segmentId: "seg-3", frameId: null, region: null }],
      requester: null, assignee: null, acceptance: null, speaker: null, flags: [],
    }],
    flagged: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
function liveStore(calls: Call[], respond: (body: string) => Response, extra: Record<string, unknown> = {}) {
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), body });
    return respond(body);
  }) as typeof fetch;
  const redactor = { label: "stub", redactText: async (t: string) => ({ maskedText: t, spans: [] }), health: async () => ({ ok: true, label: "stub" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: redactor as any });
  const analyzer = new MuseClient({ fetchImpl, labelTranscriptSegments: true, ...(extra["clientOpts"] as object | undefined) });
  delete extra["clientOpts"];
  return createSessionStore({ offline: false, gate, redactor, analyzer, analyzerLabel: "MuseClient", ...extra });
}

// Obviously fake identities — never real sealed values.
const dummy = () => ({
  sourceSha: "a".repeat(40),
  dataset: { id: "dummy-dataset", role: "sealed-holdout", sha256: "a".repeat(64) },
  model: { name: "meta-models/Muse-Glimmer-30B", revision: "1".repeat(40) },
  image: { ref: "registry.example/dummy@sha256:" + "b".repeat(64), digest: "sha256:" + "b".repeat(64) },
  prompt: { sha256: "c".repeat(64) },
  schema: { sha256: "d".repeat(64) },
  scorer: { sha256: "e".repeat(64) },
  review: { status: "reviewed", reviewer: "Dummy Reviewer", reviewed_at: "2026-10-27", dataset_sha256: "a".repeat(64) },
  decoding: { temperature: 0, seed: 42, reasoning: "medium" },
  tokenLimits: { maxTokens: 2048 },
  timeouts: { requestMs: 90000, workDeadlineS: 780, functionTimeoutS: 840 },
  retry: { maxAttempts: 1 },
  modal: { allocations: 1, concurrency: 4, maxConcurrency: 8, scoredCanary: true, teardown: true, evidenceDownload: "complete" },
  glimmerDemoRequests: 0,
  budget: { status: "PROPOSED", modalUsd: 2, sparkUsd: 0.1, totalUsd: 2.1 },
});

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"], META_API_KEY: process.env["META_API_KEY"], MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"], MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"] };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const d = mkdtempSync(join(tmpdir(), "c9-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("C9 run configuration schema (dummy values)", () => {
  it("C9-P3: a complete config validates; dropping any bound field is an error naming it", () => {
    expect(validateRunConfig(dummy())).toEqual([]);
    for (const k of ["sourceSha", "dataset", "model", "image", "prompt", "schema", "scorer", "decoding", "tokenLimits", "timeouts", "retry"]) {
      expect(RUN_CONFIG_REQUIRED_KEYS).toContain(k);
      const c = dummy() as Record<string, unknown>;
      delete c[k];
      expect(validateRunConfig(c).join("\n"), k).toContain(k);
    }
    const c = dummy();
    c.model.revision = "main";
    expect(validateRunConfig(c).join("\n")).toMatch(/revision/);
    const d = dummy();
    d.image.ref = "registry.example/dummy:latest";
    expect(validateRunConfig(d).join("\n")).toMatch(/image/);
  });

  it("C9-P4: fake retryable failures — the Spark proof configuration makes exactly one HTTP attempt", async () => {
    const calls: Call[] = [];
    const store = liveStore(calls, () => new Response("overloaded", { status: 503, headers: { "retry-after": "0" } }), {
      clientOpts: sparkProofClientOptions(dummy()),
    });
    const id = store.createSession();
    store.setTranscript(id, "Renewal call\nCan we keep net-45 terms?");
    expect((await store.redact(id)).state).toBe("review_required");
    store.approve(id);
    const s = await store.analyze(id);
    expect(s.state).not.toBe("completed");
    expect(calls).toHaveLength(1);
    const bad = dummy();
    bad.retry.maxAttempts = 2;
    expect(validateRunConfig(bad).join("\n")).toMatch(/maxAttempts/);
  });

  it("C9-P5/P6: one allocation, scored canary, bounded concurrency, teardown, complete download, declared Glimmer demo requests", () => {
    const mut = (f: (c: ReturnType<typeof dummy>) => void) => { const c = dummy(); f(c); return validateRunConfig(c).join("\n"); };
    expect(mut((c) => { c.modal.allocations = 2; })).toMatch(/allocation/);
    expect(mut((c) => { c.modal.scoredCanary = false; })).toMatch(/canary/i);
    expect(mut((c) => { c.modal.concurrency = 9; })).toMatch(/concurrency/);
    expect(mut((c) => { c.modal.teardown = false; })).toMatch(/teardown/);
    expect(mut((c) => { c.modal.evidenceDownload = "partial"; })).toMatch(/evidenceDownload/);
    expect(mut((c) => { delete (c as Record<string, unknown>)["glimmerDemoRequests"]; })).toMatch(/glimmerDemoRequests/);
  });

  it("C9-P8: budget stays PROPOSED at $2 Modal + $0.10 Spark = $2.10", () => {
    const mut = (f: (c: ReturnType<typeof dummy>) => void) => { const c = dummy(); f(c); return validateRunConfig(c).join("\n"); };
    expect(mut((c) => { c.budget.status = "APPROVED"; })).toMatch(/PROPOSED/);
    expect(mut((c) => { c.budget.totalUsd = 3; })).toMatch(/budget/);
  });
});

describe("C9 readiness and release checklists", () => {
  const DOC = readFileSync(resolve(root, "docs/release/c9-readiness.md"), "utf8");
  it("C9-P1: readiness requires C1–C7 acceptance, not just green CI", () => {
    for (const c of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) expect(DOC).toMatch(new RegExp(`${c}-\\d`));
    expect(DOC).toMatch(/green CI (alone )?is not sufficient/i);
  });
  it("C9-P2/P9: holdout review blocked; partner verification pending", () => {
    expect(DOC).toMatch(/holdout review[^\n]*BLOCKED/i);
    expect(DOC).toMatch(/Partner verification: PENDING/);
  });
  it("C9-P7: publication policy keeps failures, incomplete runs, full denominators", () => {
    for (const r of [/failures/i, /incomplete runs/i, /full planned denominators?/i, /no undisclosed reruns/i, /cherry-pick/i]) expect(DOC).toMatch(r);
  });
  it("C9-P10: one release identity, ≤3-minute video, links checked before November 4, 3 PM CT", () => {
    expect(DOC).toMatch(/one release identity/i);
    expect(DOC).toMatch(/README[^\n]*CI[^\n]*results[^\n]*screenshots[^\n]*video/i);
    expect(DOC).toMatch(/3-minute|3:00/);
    expect(DOC).toMatch(/November 4, 3 PM CT/);
  });
  it("blocked tasks are not marked done and no sealed identity is recorded", () => {
    expect(DOC).not.toMatch(/\[x\]/i);
    expect(DOC).toMatch(/budget[^\n]*PROPOSED/i);
    expect(DOC).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(DOC).not.toMatch(/heldout-sealed|holdout-v1|\.sha256/);
  });
});
