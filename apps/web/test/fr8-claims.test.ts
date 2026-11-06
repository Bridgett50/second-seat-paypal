/**
 * FR8 controls. No provider call, no sealed path, no frozen-file edit.
 */
import { describe, expect, it } from "vitest";
import { createPrivacyGate, dispatchGuarded } from "@second-seat/bot/dist/src/private/gate.js";
import { createSessionStore } from "../src/session.js";
import { resolveAnalysisConfig } from "../src/liveConfig.js";

describe("FR8 claim controls", () => {
  it("FR8-6 missing explicit live config fails startup and test mode stays offline", () => {
    expect(resolveAnalysisConfig({}).mode).toBe("offline");
    expect(() => resolveAnalysisConfig({ SECOND_SEAT_MODE: "live" })).toThrow(/GLIMMER_BASE_URL/);
    expect(() =>
      resolveAnalysisConfig({ SECOND_SEAT_MODE: "live", GLIMMER_BASE_URL: "http://127.0.0.1:9" }),
    ).toThrow(/META_API_KEY/);
    expect(
      resolveAnalysisConfig({
        SECOND_SEAT_TEST_MODE: "1",
        SECOND_SEAT_MODE: "live",
        GLIMMER_BASE_URL: "http://127.0.0.1:9",
        META_API_KEY: "fabricated-test-key",
      }).mode,
    ).toBe("offline");
  });

  it("FR8-7 shows the review preview and then blocks an unsafe analysis dispatch", async () => {
    const raw = "deliver to 42 Fictional Lane";
    let calls = 0;
    const previous = process.env.GLIMMER_BASE_URL;
    process.env.GLIMMER_BASE_URL = "http://127.0.0.1:9";
    try {
      const store = createSessionStore({
        offline: false,
        gate: createPrivacyGate({
          mode: "live",
          redactor: {
            label: "fr8-fake-redactor",
            redactText: async (text: string) => ({
              maskedText: "deliver to [REDACTED_address]",
              spans: [{ start: 11, end: text.length, label: "address" }],
            }),
            redactImage: async () => {
              throw new Error("no images");
            },
            health: async () => ({ ok: true, label: "fr8-fake-redactor" }),
          },
        }),
        analyzer: {
          completeBrief: async (input) => {
            const response = await dispatchGuarded("muse", [input.transcriptText], 1, async () => {
              calls += 1;
              return new Response("{}", { status: 200 });
            });
            return { rawText: await response.text() };
          },
        },
      });
      const id = store.createSession();
      store.setTranscript(id, raw);
      const preview = await store.redact(id);
      expect(preview.state).toBe("review_required");
      expect(preview.redactedText).toContain("[REDACTED_address]");
      store.correct(id, raw);
      store.approve(id);
      const after = await store.analyze(id);
      expect(calls).toBe(0);
      expect(after.verification?.blocked).toBe(true);
      expect(after.result).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.GLIMMER_BASE_URL;
      else process.env.GLIMMER_BASE_URL = previous;
    }
  });

  it("FR8-8 lets one still-valid approval authorize two guarded attempts", async () => {
    const previous = process.env.GLIMMER_BASE_URL;
    process.env.GLIMMER_BASE_URL = "http://127.0.0.1:9";
    try {
      const gate = createPrivacyGate({
        mode: "live",
        redactor: {
          label: "fr8-gate-redactor",
          redactText: async (text: string) => ({ maskedText: text, spans: [] }),
          redactImage: async () => {
            throw new Error("no images");
          },
          health: async () => ({ ok: true, label: "fr8-gate-redactor" }),
        },
      });
      const prepared = await gate.prepare("Discussed options.");
      const token = gate.approve(prepared.runId, prepared.redactedText);
      let calls = 0;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await gate.send(prepared.runId, token, async (gated) => {
          await dispatchGuarded("muse", [gated], attempt, async () => {
            calls += 1;
            return new Response("ok", { status: 200 });
          });
          return "ok";
        });
      }
      expect(calls).toBe(2);
      expect(gate.receipts(prepared.runId).map((receipt) => receipt.outcome)).toEqual([
        "provider_confirmed",
        "provider_confirmed",
      ]);
    } finally {
      if (previous === undefined) delete process.env.GLIMMER_BASE_URL;
      else process.env.GLIMMER_BASE_URL = previous;
    }
  });
});
