import { get } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRIEF_API_URL,
  BRIEF_MODEL,
  MuseClient,
  buildRedactedUserMessage,
  type BriefGatedInput,
} from "../src/brief/muse.js";
import { SparkSupportJudge } from "../src/judge/support.js";
import { SparkPressureClassifier } from "../src/shield/classify.js";
import {
  GateApprovalError,
  GateConfigError,
  ResidualPIIError,
  createPrivacyGate,
  findResidualPII,
  type GatedText,
} from "../src/private/gate.js";
import { MockRedactor, defaultRedactor, liveRedactor } from "../src/private/redact.js";
import { createInspectorServer } from "../src/private/server.js";

const GLIMMER_URL = "http://glimmer.test";
const RAW =
  "Call Alice Johnson at alice@example.com or 555-010-2202. Card 4111 1111 1111 1111.";
const PII_BITS = ["Alice Johnson", "alice@example.com", "555-010-2202", "4111 1111 1111 1111"];

interface RecordedCall {
  url: string;
  body: string;
}

function spansForText(text: string) {
  const out: Array<{ start: number; end: number; label: string }> = [];
  for (const [label, value] of [
    ["person", "Alice Johnson"],
    ["email", "alice@example.com"],
    ["phone", "555-010-2202"],
    ["credit_card", "4111 1111 1111 1111"],
  ] as const) {
    const start = text.indexOf(value);
    if (start !== -1) out.push({ start, end: start + value.length, label });
  }
  return out;
}

function glimmerUserText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: unknown }> };
    const user = parsed.messages?.find((m) => m.role === "user");
    return typeof user?.content === "string" ? user.content : "";
  } catch {
    return "";
  }
}

/** Stub fetch: Glimmer replies per glimmerMode, Spark records bodies. */
function installStub(calls: RecordedCall[], glimmerMode: "ok" | "timeout" | "invalid" | "empty" = "ok") {
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    const target = String(url);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url: target, body });
    if (target.startsWith(GLIMMER_URL)) {
      if (glimmerMode === "timeout") {
        throw new DOMException("The operation timed out", "TimeoutError");
      }
      const reply =
        glimmerMode === "invalid"
          ? { choices: [{ message: { content: "sure, here is some prose" }, finish_reason: "stop" }] }
          : glimmerMode === "empty"
            ? { choices: [{ message: { content: JSON.stringify({ spans: [], boxes: [] }) }, finish_reason: "stop" }] }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ spans: spansForText(glimmerUserText(body)), boxes: [] }),
                    },
                    finish_reason: "stop",
                  },
                ],
              };
      return new Response(JSON.stringify(reply), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const prev = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = prev;
  };
}

function sparkCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.url === BRIEF_API_URL);
}

function glimmerCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.url.startsWith(GLIMMER_URL));
}

async function sendViaSpark(
  gate: ReturnType<typeof createPrivacyGate>,
  runId: string,
  token: string,
): Promise<string> {
  return gate.send(runId, token, async (gated) => {
    await fetch(BRIEF_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: BRIEF_MODEL, messages: [{ role: "user", content: gated.text }] }),
    });
    return gated.text;
  });
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_API_KEY: process.env["MUSE_API_KEY"],
  };
  process.env["GLIMMER_BASE_URL"] = GLIMMER_URL;
  process.env["META_API_KEY"] = "test-key";
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("privacy gate live flow", () => {
  it("sends raw text only to Glimmer; Spark gets only reviewed redacted text", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      const prepared = await gate.prepare(RAW);
      expect(prepared.redactedText).not.toContain("Alice Johnson");
      const token = gate.approve(prepared.runId, prepared.redactedText);
      const sentText = await sendViaSpark(gate, prepared.runId, token);

      expect(glimmerCalls(calls)).toHaveLength(1);
      const glimmerBody = glimmerCalls(calls)[0]!.body;
      expect(glimmerBody).toContain(RAW);
      for (const bit of PII_BITS) expect(sentText).not.toContain(bit);

      expect(sparkCalls(calls)).toHaveLength(1);
      const sparkBody = sparkCalls(calls)[0]!.body;
      expect(sparkBody).toContain(prepared.redactedText);
      for (const bit of PII_BITS) expect(sparkBody).not.toContain(bit);
    } finally {
      restore();
    }
  });

  it("fixture mode uses MockRedactor with no fetch", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const gate = createPrivacyGate({ mode: "fixture", redactor: new MockRedactor() });
      const prepared = await gate.prepare("call 555-010-2202 now");
      expect(prepared.redactedText).not.toContain("555-010-2202");
      const token = gate.approve(prepared.runId, prepared.redactedText);
      let sent = 0;
      await gate.send(prepared.runId, token, async () => {
        sent += 1;
      });
      expect(sent).toBe(1);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("live mode without GLIMMER_BASE_URL throws, makes zero fetches, never uses MockRedactor", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      delete process.env["GLIMMER_BASE_URL"];
      expect(() => createPrivacyGate({ mode: "live" })).toThrow(GateConfigError);
      expect(() => createPrivacyGate({ mode: "live", redactor: new MockRedactor() })).toThrow(GateConfigError);
      process.env["GLIMMER_BASE_URL"] = GLIMMER_URL;
      expect(() => createPrivacyGate({ mode: "live", redactor: new MockRedactor() })).toThrow(GateConfigError);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("muse brief live path with GLIMMER_BASE_URL unset throws with zero fetches", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      delete process.env["GLIMMER_BASE_URL"];
      process.env["META_API_KEY"] = "test-key";
      await expect(
        buildRedactedUserMessage({
          meetingId: "m",
          transcriptText: RAW,
          framesSidecarText: "",
          fixtureMode: false,
        }),
      ).rejects.toThrow(GateConfigError);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("defaultRedactor rethrows GlimmerClient construction failure; liveRedactor never returns Mock", () => {
    process.env["GLIMMER_BASE_URL"] = "::not-a-url::";
    expect(() => defaultRedactor()).toThrow();
    expect(() => liveRedactor()).toThrow();
    process.env["GLIMMER_BASE_URL"] = GLIMMER_URL;
    expect(defaultRedactor()).not.toBeInstanceOf(MockRedactor);
    expect(liveRedactor()).not.toBeInstanceOf(MockRedactor);
    delete process.env["GLIMMER_BASE_URL"];
    expect(() => liveRedactor()).toThrow(GateConfigError);
    expect(() => defaultRedactor()).not.toThrow();
  });

  it("private server health in live mode without Glimmer fails with zero fetches", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    const savedBriefMode = process.env["EVIDENCE_BRIEF_MODE"];
    try {
      delete process.env["GLIMMER_BASE_URL"];
      process.env["META_API_KEY"] = "test-key";
      process.env["EVIDENCE_BRIEF_MODE"] = "live";
      const server = createInspectorServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const status = await new Promise<number>((resolve, reject) => {
          get(`http://127.0.0.1:${port}/health`, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          }).on("error", reject);
        });
        expect(status).toBe(500);
      } finally {
        server.close();
      }
      expect(calls).toHaveLength(0);
    } finally {
      if (savedBriefMode === undefined) delete process.env["EVIDENCE_BRIEF_MODE"];
      else process.env["EVIDENCE_BRIEF_MODE"] = savedBriefMode;
      restore();
    }
  });

  it("Glimmer timeout throws and Spark is never called", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "timeout");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      await expect(gate.prepare(RAW)).rejects.toThrow();
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("invalid Glimmer reply throws and Spark is never called", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "invalid");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      await expect(gate.prepare(RAW)).rejects.toThrow();
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("stale approval (expired after 15 min) is rejected with zero Spark calls", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      let now = 1_000_000;
      const gate = createPrivacyGate({ mode: "live", now: () => now });
      const prepared = await gate.prepare(RAW);
      const token = gate.approve(prepared.runId, prepared.redactedText);
      now += 16 * 60 * 1000;
      await expect(sendViaSpark(gate, prepared.runId, token)).rejects.toThrow(GateApprovalError);
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("edited-after-approval invalidates the token with zero Spark calls", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      const prepared = await gate.prepare(RAW);
      const token = gate.approve(prepared.runId, prepared.redactedText);
      gate.correct(prepared.runId, `${prepared.redactedText} (owner note)`);
      await expect(sendViaSpark(gate, prepared.runId, token)).rejects.toThrow(GateApprovalError);
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("mismatched runId and unknown approval are rejected with zero Spark calls", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      const first = await gate.prepare(RAW);
      const second = await gate.prepare("unrelated meeting notes");
      const tokenForFirst = gate.approve(first.runId, first.redactedText);
      await expect(sendViaSpark(gate, second.runId, tokenForFirst)).rejects.toThrow(GateApprovalError);
      await expect(sendViaSpark(gate, first.runId, "bogus-token")).rejects.toThrow(GateApprovalError);
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("residual PII in reviewed text throws ResidualPIIError with zero Spark calls", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "empty");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      const leaked = "follow up with bob@example.com tomorrow";
      const prepared = await gate.prepare(leaked);
      // The live phone/email regex backstop masks what the model missed...
      expect(prepared.redactedText).not.toContain("bob@example.com");
      // ...and residual PII put back into the reviewed text is still refused.
      gate.correct(prepared.runId, leaked);
      const token = gate.approve(prepared.runId, leaked);
      await expect(sendViaSpark(gate, prepared.runId, token)).rejects.toThrow(ResidualPIIError);
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("a re-inserted redacted name is caught with zero Spark calls", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const gate = createPrivacyGate({ mode: "live" });
      const prepared = await gate.prepare(RAW);
      gate.correct(prepared.runId, `${prepared.redactedText} (it was Alice Johnson)`);
      const token = gate.approve(prepared.runId, gate.preview(prepared.runId));
      await expect(sendViaSpark(gate, prepared.runId, token)).rejects.toThrow(ResidualPIIError);
      expect(sparkCalls(calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("detects residual emails, phones, Luhn cards, IBANs and SSNs", () => {
    expect(findResidualPII("clean meeting notes")).toBeNull();
    expect(findResidualPII("mail bob@example.com")).toContain("email");
    expect(findResidualPII("call 555-010-2202")).toContain("phone");
    expect(findResidualPII("card 4111 1111 1111 1111")).toContain("card");
    expect(findResidualPII("card 1234 5678 9012 3456")).toBeNull();
    expect(findResidualPII("iban DE89370400440532013000")).toContain("IBAN");
    expect(findResidualPII("ssn 123-45-6789")).toContain("SSN");
  });

  it("detects case, spacing, format-character, digit-only, IBAN, and unicode-hyphen variants without echoing them", () => {
    const cases: Array<[string, string, string[]?]> = [
      ["call 5550102202", "phone number"],
      ["call 555-0102202", "phone number"],
      ["call \uFF15\uFF15\uFF15\uFF10\uFF11\uFF10\uFF12\uFF12\uFF10\uFF12", "phone number"],
      ["iban de89370400440532013000", "IBAN"],
      ["ssn 123\u201145\u20116789", "SSN-like number"],
      ["mail b\u200Bob@example.com", "email address"],
    ];
    for (const [text, kind] of cases) {
      const hit = findResidualPII(text);
      expect(hit).toBe(kind);
      expect(hit ?? "").not.toContain(text);
    }
    const lower = findResidualPII("Meet ana bell today", ["Ana Bell"]);
    expect(lower).toBe("unredacted name from redaction spans");
    const spaced = findResidualPII("Meet Ana  Bell today", ["Ana Bell"]);
    expect(spaced).toBe("unredacted name from redaction spans");
    const zwsp = findResidualPII("Meet Ana\u200B Bell today", ["Ana Bell"]);
    expect(zwsp).toBe("unredacted name from redaction spans");
    for (const hit of [lower, spaced, zwsp]) {
      expect(hit).not.toMatch(/ana bell/i);
    }
  });
});

describe("gated entry points reject plain strings", () => {
  async function mintGated(text: string): Promise<GatedText> {
    const prev = process.env["GLIMMER_BASE_URL"];
    process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
    try {
      const gate = createPrivacyGate({
        mode: "live",
        redactor: {
          label: "stub",
          redactText: async (t: string) => ({ maskedText: t, spans: [] }),
          redactImage: async () => {
            throw new Error("x");
          },
          health: async () => ({ ok: true, label: "stub" }),
        },
      });
      const prepared = await gate.prepare(text);
      const token = gate.approve(prepared.runId, prepared.redactedText);
      return gate.send(prepared.runId, token, async (gated) => gated);
    } finally {
      if (prev === undefined) delete process.env["GLIMMER_BASE_URL"];
      else process.env["GLIMMER_BASE_URL"] = prev;
    }
  }

  it("brief client takes GatedText, not string", async () => {
    const calls: RecordedCall[] = [];
    const restore = installStub(calls, "ok");
    try {
      const client = new MuseClient();
      const input: BriefGatedInput = {
        meetingId: "m",
        // @ts-expect-error plain strings are not GatedText
        transcriptText: "raw transcript",
        // @ts-expect-error plain strings are not GatedText
        framesSidecarText: "frames",
        fixtureMode: false,
      };
      await expect(client.completeBrief(input)).rejects.toThrow(GateApprovalError);
      expect(sparkCalls(calls)).toHaveLength(0);
      // Gated input passes the gate check: the Spark body carries only the reviewed redacted text.
      const stateDir = mkdtempSync(join(tmpdir(), "gate-test-state-"));
      const prevStateFile = process.env["MUSE_STATE_FILE"];
      const prevCostLog = process.env["MUSE_COST_LOG_FILE"];
      process.env["MUSE_STATE_FILE"] = join(stateDir, "state.json");
      process.env["MUSE_COST_LOG_FILE"] = join(stateDir, "cost.jsonl");
      try {
        const gated = await mintGated("plain meeting notes");
        const result = await client.completeBrief({
          meetingId: "m",
          transcriptText: gated,
          framesSidecarText: gated,
          fixtureMode: false,
        });
        expect(result.fixture).toBe(false);
        const sparkBody = sparkCalls(calls)[0]!.body;
        expect(sparkBody).toContain(gated.text);
      } finally {
        if (prevStateFile === undefined) delete process.env["MUSE_STATE_FILE"];
        else process.env["MUSE_STATE_FILE"] = prevStateFile;
        if (prevCostLog === undefined) delete process.env["MUSE_COST_LOG_FILE"];
        else process.env["MUSE_COST_LOG_FILE"] = prevCostLog;
        rmSync(stateDir, { recursive: true, force: true });
      }
    } finally {
      restore();
    }
  });

  it("support judge takes GatedText, not string", async () => {
    const judge = new SparkSupportJudge();
    await expect(
      judge.gradeSupport({
        entryId: "e",
        // @ts-expect-error plain strings are not GatedText
        entryText: "raw entry",
        // @ts-expect-error plain strings are not GatedText
        citedSpans: ["raw span"],
      }),
    ).rejects.toThrow(GateApprovalError);
  });

  it("shield classifier takes GatedText, not string", async () => {
    const classifier = new SparkPressureClassifier();
    await expect(
      classifier.classify([
        {
          segmentId: "s1",
          // @ts-expect-error plain strings are not GatedText
          text: "raw line",
        },
      ]),
    ).rejects.toThrow(GateApprovalError);
  });
});
