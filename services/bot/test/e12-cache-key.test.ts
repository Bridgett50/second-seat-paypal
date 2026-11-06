import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuseClient } from "../src/brief/muse.js";
import { SparkSupportJudge } from "../src/judge/support.js";
import { SparkPressureClassifier } from "../src/shield/classify.js";
import { createPrivacyGate, type GatedText } from "../src/private/gate.js";

const bodies: Array<Record<string, unknown>> = [];
let savedEnv: Record<string, string | undefined>;

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("no images");
    },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

async function mintLive(text: string): Promise<GatedText> {
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gate = createPrivacyGate({ mode: "live", redactor: stubRedactor() as any });
  const prepared = await gate.prepare(text);
  const token = gate.approve(prepared.runId, prepared.redactedText);
  return gate.send(prepared.runId, token, async (gated) => gated);
}

function sse(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
  process.env["META_API_KEY"] = "test-key-not-real";
  delete process.env["MUSE_API_KEY"];
  delete process.env["EVIDENCE_BRIEF_MODE"];
  bodies.length = 0;
  let n = 0;
  vi.stubGlobal(
    "fetch",
    (async (_url: unknown, init?: { body?: unknown }) => {
      n += 1;
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (n === 2) {
        return sse(
          JSON.stringify({
            labels: [{ segmentId: "s1", tactic: "none", ask: "none", target: "none", span: "notes" }],
          }),
        );
      }
      if (n === 3) {
        return sse(JSON.stringify({ grade: "supported", missing_qualifier: null }));
      }
      return sse(JSON.stringify({ entries: [] }));
    }) as typeof fetch,
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("E12 prompt_cache_key", () => {
  it("brief, shield and support use distinct stable per-family cache keys", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "e12-cache-key-"));
    process.env["MUSE_STATE_FILE"] = join(stateDir, "state.json");
    process.env["MUSE_COST_LOG_FILE"] = join(stateDir, "cost.jsonl");
    try {
      const gated = await mintLive("approved meeting notes about the renewal");
      await new MuseClient().completeBrief({
        meetingId: "m",
        transcriptText: gated,
        framesSidecarText: "",
        fixtureMode: false,
      });
      await new SparkPressureClassifier().classify([{ segmentId: "s1", text: gated }]);
      await new SparkSupportJudge().gradeSupport({ entryId: "e", entryText: gated, citedSpans: [gated] });
      const gated2 = await mintLive("approved meeting notes about the follow-up");
      await new MuseClient().completeBrief({
        meetingId: "m2",
        transcriptText: gated2,
        framesSidecarText: "",
        fixtureMode: false,
      });
      expect(bodies).toHaveLength(4);
      for (const body of bodies) {
        expect(typeof body["prompt_cache_key"]).toBe("string");
        expect((body["prompt_cache_key"] as string).length).toBeGreaterThan(0);
      }
      const [briefKey, shieldKey, supportKey, briefKey2] = bodies.map(
        (b) => b["prompt_cache_key"],
      );
      expect(new Set([briefKey, shieldKey, supportKey]).size).toBe(3);
      expect(briefKey2).toBe(briefKey);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
