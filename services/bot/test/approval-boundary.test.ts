import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBrief } from "../src/brief/cli.js";
import { MuseClient, buildRedactedUserMessage } from "../src/brief/muse.js";
import { SparkSupportJudge } from "../src/judge/support.js";
import { PRESSURE_API_URL, SparkPressureClassifier } from "../src/shield/classify.js";
import {
  APPROVAL_TTL_MS,
  GateApprovalError,
  GateConfigError,
  GatedText,
  ResidualPIIError,
  createPrivacyGate,
  requireLiveGatedText,
} from "../src/private/gate.js";

interface RecordedCall {
  url: string;
  body: string;
}

let calls: RecordedCall[] = [];
let prevFetch: typeof fetch;
let savedEnv: Record<string, string | undefined>;

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("x");
    },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

function liveGate(now?: () => number) {
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  return createPrivacyGate({ mode: "live", redactor: stubRedactor(), ...(now === undefined ? {} : { now }) });
}

async function mintLive(text: string, now?: () => number): Promise<GatedText> {
  const gate = liveGate(now);
  const prepared = await gate.prepare(text);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) => gated);
}

async function mintFixture(text: string): Promise<GatedText> {
  const gate = createPrivacyGate({ mode: "fixture" });
  const prepared = await gate.prepare(text);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) => gated);
}

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_API_KEY: process.env["MUSE_API_KEY"],
    EVIDENCE_BRIEF_MODE: process.env["EVIDENCE_BRIEF_MODE"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
  };
  process.env["META_API_KEY"] = "test-dummy";
  delete process.env["EVIDENCE_BRIEF_MODE"];
  calls = [];
  prevFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const target = String(url);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url: target, body });
    if (target === PRESSURE_API_URL) {
      const payload = JSON.stringify({
        labels: [{ segmentId: "s1", tactic: "none", ask: "none", target: "none", span: "approved meeting notes" }],
      });
      const sse =
        `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n` + `data: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = prevFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("approval boundary", () => {
  it("forged GatedText values are rejected everywhere", async () => {
    expect((GatedText as unknown as Record<string, unknown>)["issue"]).toBeUndefined();
    expect(() => new (GatedText as unknown as new (text: string) => GatedText)("x")).toThrow(GateApprovalError);
    const fake = Object.create(GatedText.prototype) as GatedText;
    (fake as unknown as Record<string, unknown>)["text"] = "approved meeting notes";
    expect(() => requireLiveGatedText(fake)).toThrow(GateApprovalError);
    await expect(
      new MuseClient().completeBrief({ meetingId: "m", transcriptText: fake, framesSidecarText: fake, fixtureMode: false }),
    ).rejects.toThrow(GateApprovalError);
    await expect(
      new SparkSupportJudge().gradeSupport({ entryId: "e", entryText: fake, citedSpans: [fake] }),
    ).rejects.toThrow(GateApprovalError);
    await expect(new SparkPressureClassifier().classify([{ segmentId: "s1", text: fake }])).rejects.toThrow(
      GateApprovalError,
    );
    expect(calls).toHaveLength(0);
  });

  it("fixture-gate-issued GatedText cannot authorize live provider requests", async () => {
    const gated = await mintFixture("plain meeting notes");
    await expect(
      new MuseClient().completeBrief({
        meetingId: "m",
        transcriptText: gated,
        framesSidecarText: gated,
        fixtureMode: false,
      }),
    ).rejects.toThrow("fixture-mode approval cannot authorize a live provider request");
    await expect(
      new SparkSupportJudge().gradeSupport({ entryId: "e", entryText: gated, citedSpans: [gated] }),
    ).rejects.toThrow("fixture-mode approval cannot authorize a live provider request");
    await expect(new SparkPressureClassifier().classify([{ segmentId: "s1", text: gated }])).rejects.toThrow(
      "fixture-mode approval cannot authorize a live provider request",
    );
    expect(calls).toHaveLength(0);
  });

  it("editing after send invalidates the minted value", async () => {
    const gate = liveGate();
    const prepared = await gate.prepare("meeting notes alpha");
    const token = gate.approve(prepared.runId, prepared.redactedText);
    const gated = await gate.send(prepared.runId, token, async (g) => g);
    gate.correct(prepared.runId, "something else entirely");
    expect(() => requireLiveGatedText(gated)).toThrow(GateApprovalError);
    expect(calls).toHaveLength(0);
  });

  it("minted values expire after APPROVAL_TTL_MS", async () => {
    let nowMs = Date.now();
    const gated = await mintLive("meeting notes alpha", () => nowMs);
    nowMs += APPROVAL_TTL_MS + 1000;
    expect(() => requireLiveGatedText(gated)).toThrow(GateApprovalError);
    expect(calls).toHaveLength(0);
  });

  it("residual PII is refused and the send callback never runs", async () => {
    const gate = liveGate();
    const prepared = await gate.prepare("clean meeting notes");
    gate.correct(prepared.runId, "call 555-010-2202");
    const token = gate.approve(prepared.runId, "call 555-010-2202");
    let sent = 0;
    await expect(
      gate.send(prepared.runId, token, async () => {
        sent += 1;
      }),
    ).rejects.toThrow(ResidualPIIError);
    expect(sent).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("buildRedactedUserMessage refuses live auto-approval", async () => {
    process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
    await expect(
      buildRedactedUserMessage({ meetingId: "m", transcriptText: "hello", framesSidecarText: "", fixtureMode: false }),
    ).rejects.toThrow(GateApprovalError);
    expect(calls).toHaveLength(0);
    delete process.env["GLIMMER_BASE_URL"];
    await expect(
      buildRedactedUserMessage({ meetingId: "m", transcriptText: "hello", framesSidecarText: "", fixtureMode: false }),
    ).rejects.toThrow(GateConfigError);
    expect(calls).toHaveLength(0);
  });

  it("runBrief live mode is disabled", async () => {
    process.env["EVIDENCE_BRIEF_MODE"] = "live";
    const dir = await mkdtemp(join(tmpdir(), "brief-"));
    await writeFile(join(dir, "transcript.txt"), "hello", "utf8");
    await expect(runBrief({ inputDir: dir, outDir: dir })).rejects.toThrow(/live mode is disabled/);
    expect(calls).toHaveLength(0);
  });

  it("live classifier without an API key rejects before any fetch", async () => {
    delete process.env["META_API_KEY"];
    delete process.env["MUSE_API_KEY"];
    const gated = await mintLive("approved meeting notes");
    await expect(new SparkPressureClassifier().classify([{ segmentId: "s1", text: gated }])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("live approval sends the approved text in exactly one provider call", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "approval-boundary-state-"));
    process.env["MUSE_STATE_FILE"] = join(stateDir, "state.json");
    process.env["MUSE_COST_LOG_FILE"] = join(stateDir, "cost.jsonl");
    try {
      const gated = await mintLive("approved meeting notes");
      let rawText = "";
      try {
        const result = await new SparkPressureClassifier().classifyRaw([{ segmentId: "s1", text: gated }]);
        rawText = result.rawText;
      } catch {
        // Fall through: the fetch count and request body are asserted below regardless.
      }
      void rawText;
      const providerCalls = calls.filter((c) => c.url === PRESSURE_API_URL);
      expect(providerCalls).toHaveLength(1);
      expect(calls).toHaveLength(1);
      const parsed = JSON.parse(providerCalls[0]!.body) as { messages?: Array<{ content?: unknown }> };
      const contents = (parsed.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : ""));
      expect(contents.some((c) => c.includes("approved meeting notes"))).toBe(true);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("runtime mutation of a live minted value is rejected with zero fetch calls", async () => {
    const v = await mintLive("approved meeting notes");
    const original = v.text;
    try {
      (v as { text: string }).text = "Alice Johnson 555-010-2202";
    } catch {
      // Frozen assignment throws in strict mode; fall through to assertions.
    }
    expect(v.text).toBe(original);
    await expect(new SparkPressureClassifier().classifyRaw([{ segmentId: "s1", text: v }])).rejects.toThrow(
      GateApprovalError,
    );
    await expect(
      new SparkSupportJudge().gradeSupport({ entryId: "e", entryText: v, citedSpans: [v] }),
    ).rejects.toThrow(GateApprovalError);
    await expect(
      new MuseClient().completeBrief({
        meetingId: "m",
        transcriptText: v,
        framesSidecarText: v,
        fixtureMode: false,
      }),
    ).rejects.toThrow(GateApprovalError);
    expect(calls).toHaveLength(0);
  });
});
