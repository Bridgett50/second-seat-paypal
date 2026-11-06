// D1 regressions — bound pressure provenance in MuseClient.
// Made-up meeting text only. Fake fetch records calls; a dummy redactor
// stands in for Glimmer. No network, no model calls.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "../src/private/gate.js";
import type { PrivacyGate } from "../src/private/gate.js";
import { MuseClient, PRESSURE_TACTICS, UnboundAssessmentError } from "../src/brief/muse.js";

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

const userMsg = (c: Call): string =>
  (
    (JSON.parse(c.body) as { messages?: { role?: string; content?: string }[] }).messages ?? []
  ).find((m) => m.role === "user")?.content ?? "";

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
  const d = mkdtempSync(join(tmpdir(), "d1-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("D1 bound pressure provenance", () => {
  it("D1-1: an unbound label is rejected with zero fetches and zero receipts", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, "Approved neutral notes.");
    const outcome = await gate.send(runId, token, async (gated) => {
      try {
        await client.completeBrief({
          meetingId: "d1-meeting-1",
          transcriptText: gated,
          framesSidecarText: "",
          fixtureMode: false,
          pressureLabels: [{ segmentId: "seg-1", tactic: "scarcity", span: "uma@example.invalid" }],
        });
        return "NO_THROW";
      } catch (err: unknown) {
        return err;
      }
    });
    expect(outcome).toBeInstanceOf(UnboundAssessmentError);
    expect((outcome as UnboundAssessmentError).code).toBe("UNBOUND_ASSESSMENT");
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain("uma@example.invalid");
  });

  it("D1-2: a valid bound label sends exactly one request carrying only the validated span and tactic", async () => {
    expect([...PRESSURE_TACTICS]).toContain("scarcity");
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(
      gate,
      "Team sync notes.\nThis is the last chance to review the plan\nNext check-in Thursday",
    );
    const result = await gate.send(runId, token, (gated) =>
      client.completeBrief({
        meetingId: "d1-meeting-2",
        transcriptText: gated,
        framesSidecarText: "",
        fixtureMode: false,
        // A legacy free-string assessment must never reach the wire even
        // if a stale JS caller still passes one at runtime.
        ...( { pressureAssessment: "uma@example.invalid" } as unknown as Record<string, unknown> ),
        pressureLabels: [{ segmentId: "seg-2", tactic: "scarcity", span: "last chance" }],
      }),
    );
    expect(result.fixture).toBe(false);
    expect(calls).toHaveLength(1);
    const msg = userMsg(calls[0]!);
    expect(msg).toContain('"tactic":"scarcity"');
    expect(msg).toContain('"quote":"last chance"');
    expect(msg).not.toContain("uma@example.invalid");
    expect(gate.receipts(runId).length).toBeGreaterThan(0);
  });

  it("D1-3: revoking approval during a held preflight yields zero requests", async () => {
    const calls: Call[] = [];
    const gate = liveGate();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const client = new MuseClient({
      fetchImpl: fakeFetch(calls),
      preflight: () => {
        markEntered();
        return held;
      },
    });
    const { runId, token } = await mintApproved(
      gate,
      "Team sync notes.\nThis is the last chance to review the plan",
    );
    const pending = gate.send(runId, token, (gated) =>
      client.completeBrief({
        meetingId: "d1-meeting-3",
        transcriptText: gated,
        framesSidecarText: "",
        fixtureMode: false,
        pressureLabels: [{ segmentId: "seg-2", tactic: "scarcity", span: "last chance" }],
      }),
    );
    await entered;
    gate.revoke(runId);
    release();
    await expect(pending).rejects.toThrow(/approval/i);
    expect(calls).toHaveLength(0);
    expect(gate.receipts(runId)).toEqual([]);
  });
});
