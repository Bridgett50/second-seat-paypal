// E1 regressions — public Muse adapter input/label binding (defects D1-1, F1).
// Invented meeting text only. Fake fetch records calls; a dummy redactor
// stands in for Glimmer. No network, no model calls.
//
// Every test demands rejection BEFORE any fetch with zero dispatch receipts:
// unknown top-level input keys, unvalidated segment ids, out-of-segment or
// trivially short spans, unknown label keys, and raw meeting ids.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "../src/private/gate.js";
import type { PrivacyGate } from "../src/private/gate.js";
import {
  buildUserMessage,
  MuseClient,
  UnboundAssessmentError,
} from "../src/brief/muse.js";

interface Call {
  url: string;
  body: string;
}

function sse(content: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function fakeFetch(calls: Call[]): typeof fetch {
  return (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return sse(JSON.stringify({ ok: true }));
  }) as typeof fetch;
}

function liveGate(): PrivacyGate {
  const redactor = {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    health: async () => ({ ok: true, label: "stub" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createPrivacyGate({ mode: "live", redactor: redactor as any });
}

async function mintApproved(gate: PrivacyGate, text: string): Promise<{ runId: string; token: string }> {
  const prepared = await gate.prepare(text);
  return { runId: prepared.runId, token: gate.approve(prepared.runId, prepared.redactedText) };
}

const TRANSCRIPT = [
  "Team notes for review.",
  "This is the last chance to review the plan",
  "Next check-in Thursday",
].join("\n");

const VALID_LABEL = { segmentId: "seg-2", tactic: "scarcity", span: "last chance" };

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "test-key-not-a-secret";
  const d = mkdtempSync(join(tmpdir(), "e1-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("E1 adapter input binding", () => {
  it("E1-a: an extra unknown top-level field is rejected with zero fetches and zero receipts", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-a",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          // Stale free-string channel standing alone (no structured labels
          // to validate in its place): must throw, never reach the wire.
          ...( { pressureAssessment: "contact uma@example.invalid" } as unknown as Record<string, unknown> ),
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("uma@example.invalid");
  });

  it("E1-b1: a segmentId outside the seg-N charset is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-b1",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          // "notes" IS a substring of the whole transcript, but the
          // segmentId is an email, not a seg-N id: must throw before send.
          pressureLabels: [{ segmentId: "uma@example.invalid", tactic: "scarcity", span: "notes" }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("uma@example.invalid");
  });

  it("E1-b2: a span from another segment is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-b2",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          // "last chance" is in seg-2, not seg-1: a whole-text substring
          // match is not enough.
          pressureLabels: [{ segmentId: "seg-1", tactic: "scarcity", span: "last chance" }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
  });

  it("E1-b3: a trivially short span is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-b3",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          // "e" appears in seg-2 but a single character is not a binding quote.
          pressureLabels: [{ segmentId: "seg-2", tactic: "scarcity", span: "e" }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
  });

  it("E1-b4: a segmentId with no such segment is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-b4",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          pressureLabels: [{ segmentId: "seg-99", tactic: "scarcity", span: "last chance" }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
  });

  it("E1-b5: an unknown label key is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "e1-meeting-b5",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          pressureLabels: [
            { ...VALID_LABEL, ...( { note: "contact uma@example.invalid" } as unknown as Record<string, unknown> ) },
          ],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("uma@example.invalid");
  });

  it("E1-c1: a meetingId outside the strict id charset is rejected with zero fetches", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "bad meeting uma@example.invalid",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          pressureLabels: [{ ...VALID_LABEL }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("uma@example.invalid");
  });

  it("E1-c2: buildUserMessage validates labels itself instead of rendering blindly", async () => {
    await expect(
      buildUserMessage({
        meetingId: "e1-meeting-c2",
        transcriptText: TRANSCRIPT,
        framesSidecarText: "",
        fixtureMode: false,
        pressureLabels: [{ segmentId: "uma@example.invalid", tactic: "scarcity", span: "notes" }],
      }),
    ).rejects.toBeInstanceOf(UnboundAssessmentError);
  });

  it("E1-c3: buildUserMessage validates the meetingId itself instead of interpolating raw", async () => {
    await expect(
      buildUserMessage({
        meetingId: "bad meeting uma@example.invalid",
        transcriptText: TRANSCRIPT,
        framesSidecarText: "",
        fixtureMode: false,
        pressureLabels: [{ ...VALID_LABEL }],
      }),
    ).rejects.toBeInstanceOf(UnboundAssessmentError);
  });
});
