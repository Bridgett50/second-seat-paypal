// G4a — coherent negative pressure evidence (Muse adapter boundary).
// Invented meeting text only. Fake fetch records calls; a dummy redactor
// stands in for Glimmer. No network, no model calls.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivacyGate } from "../src/private/gate.js";
import type { PrivacyGate } from "../src/private/gate.js";
import { MuseClient, UnboundAssessmentError } from "../src/brief/muse.js";

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

const TRANSCRIPT = [
  "Team notes for review.",
  "This is the last chance to review the plan",
  "Next check-in Thursday",
].join("\n");

const CONTACT = "call 555-0199 now";

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
  const d = mkdtempSync(join(tmpdir(), "g4a-"));
  process.env["MUSE_STATE_FILE"] = join(d, "state.json");
  process.env["MUSE_COST_LOG_FILE"] = join(d, "cost.jsonl");
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("G4a adapter negative pressure evidence", () => {
  it("G4-2b", async () => {
    const bad: [string, { segmentId: string; tactic: string; span: string }][] = [
      ["unknown segment", { segmentId: "seg-99", tactic: "none", span: "" }],
      ["nonempty span", { segmentId: "seg-1", tactic: "none", span: "call me at 555-0100" }],
    ];
    for (const [name, label] of bad) {
      const calls: Call[] = [];
      const gate = liveGate();
      const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
      const { runId, token } = await mintApproved(gate, TRANSCRIPT);
      const outcome = await gate.send(runId, token, async (gated) => {
        try {
          await client.completeBrief({
            meetingId: "g4a-meeting-none",
            transcriptText: gated,
            framesSidecarText: "",
            fixtureMode: false,
            pressureLabels: [label],
          });
          return "NO_THROW";
        } catch (err: unknown) {
          return err;
        }
      });
      expect(outcome, `adapter-none-unvalidated: ${name} none rejects`).toBeInstanceOf(
        UnboundAssessmentError,
      );
      expect(String((outcome as Error)?.message), `adapter-none-unvalidated: ${name} names none`).toContain(
        "none",
      );
      expect(calls, `adapter-none-unvalidated: ${name} zero fetches`).toHaveLength(0);
      expect(gate.receipts(runId), `adapter-none-unvalidated: ${name} zero receipts`).toEqual([]);
    }
  });

  it("G4-5g", async () => {
    // An invented contact string in an accepted label field is rejected.
    const rejected: [string, Record<string, unknown>][] = [
      ["unquoted span", { segmentId: "seg-2", tactic: "scarcity", span: CONTACT }],
      ["unknown key", { segmentId: "seg-2", tactic: "scarcity", span: "last chance", note: CONTACT }],
    ];
    for (const [name, label] of rejected) {
      const calls: Call[] = [];
      const gate = liveGate();
      const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
      const { runId, token } = await mintApproved(gate, TRANSCRIPT);
      const outcome = await gate.send(runId, token, async (gated) => {
        try {
          await client.completeBrief({
            meetingId: "g4a-meeting-5g",
            transcriptText: gated,
            framesSidecarText: "",
            fixtureMode: false,
            pressureLabels: [label as { segmentId: string; tactic: string; span: string }],
          });
          return "NO_THROW";
        } catch (err: unknown) {
          return err;
        }
      });
      expect(outcome, `${name} rejects`).toBeInstanceOf(UnboundAssessmentError);
      expect(calls, `${name} zero fetches`).toHaveLength(0);
      expect(gate.receipts(runId), `${name} zero receipts`).toEqual([]);
      expect(JSON.stringify(calls), `${name} contact never sent`).not.toContain("555-0199");
    }

    // A valid positive label sends once with only approved text + assessment.
    const calls: Call[] = [];
    const gate = liveGate();
    const client = new MuseClient({ fetchImpl: fakeFetch(calls) });
    const { runId, token } = await mintApproved(gate, TRANSCRIPT);
    await gate.send(runId, token, (gated) =>
      client.completeBrief({
        meetingId: "g4a-meeting-5g-ok",
        transcriptText: gated,
        framesSidecarText: "",
        fixtureMode: false,
        pressureLabels: [{ segmentId: "seg-2", tactic: "scarcity", span: "last chance" }],
      }),
    );
    expect(calls).toHaveLength(1);
    const msg = userMsg(calls[0]!);
    expect(msg).toContain('"tactic":"scarcity"');
    expect(msg).toContain('"quote":"last chance"');
    expect(msg).not.toContain("555-0199");

    // A valid explicit none renders no assessment text: nothing leaks.
    const noneCalls: Call[] = [];
    const gate2 = liveGate();
    const client2 = new MuseClient({ fetchImpl: fakeFetch(noneCalls) });
    const approved = await mintApproved(gate2, TRANSCRIPT);
    await gate2.send(approved.runId, approved.token, (gated) =>
      client2.completeBrief({
        meetingId: "g4a-meeting-5g-none",
        transcriptText: gated,
        framesSidecarText: "",
        fixtureMode: false,
        pressureLabels: [{ segmentId: "seg-2", tactic: "none", span: "" }],
      }),
    );
    expect(noneCalls).toHaveLength(1);
    expect(userMsg(noneCalls[0]!)).not.toContain('"tactic":"none"');
  });
});
