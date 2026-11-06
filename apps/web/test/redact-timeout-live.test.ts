/**
 * Live redaction timeout: a live smoke test hit "redaction timeout after
 * 30000ms" while the private Glimmer endpoint needed ~50s for one
 * transcript. Live mode now defaults to 240s (web race and Glimmer
 * per-request timeout); offline keeps 30s. No network or model calls.
 */
import { describe, expect, it } from "vitest";
import { LIVE_REDACT_TIMEOUT_MS, OFFLINE_REDACT_TIMEOUT_MS, redactTimeoutMs } from "../src/session.js";
import { resolveAnalysisConfig } from "../src/liveConfig.js";

const fakeFetch = (async () => {
  throw new Error("no network in this test");
}) as unknown as typeof fetch;

describe("redaction timeout defaults", () => {
  it("live mode defaults to 240s, offline stays 30s", () => {
    expect(LIVE_REDACT_TIMEOUT_MS).toBe(240_000);
    expect(OFFLINE_REDACT_TIMEOUT_MS).toBe(30_000);
    expect(redactTimeoutMs({ offline: false, env: {} })).toBe(240_000);
    expect(redactTimeoutMs({ offline: true, env: {} })).toBe(30_000);
  });

  it("SECOND_SEAT_REDACT_TIMEOUT_MS still overrides, and test mode stays fast", () => {
    expect(redactTimeoutMs({ offline: false, env: { SECOND_SEAT_REDACT_TIMEOUT_MS: "120000" } })).toBe(120_000);
    expect(redactTimeoutMs({ offline: false, env: { SECOND_SEAT_REDACT_TIMEOUT_MS: "junk" } })).toBe(240_000);
    expect(redactTimeoutMs({ offline: false, env: { SECOND_SEAT_TEST_MODE: "1" } })).toBe(500);
  });

  it("the live Glimmer client's per-request timeout matches the live default", () => {
    const env = { SECOND_SEAT_MODE: "live", GLIMMER_BASE_URL: "http://glimmer.invalid", META_API_KEY: "test-placeholder" };
    // The live gate also requires the private Glimmer URL in process.env.
    const prior = process.env["GLIMMER_BASE_URL"];
    process.env["GLIMMER_BASE_URL"] = env.GLIMMER_BASE_URL;
    try {
      const cfg = resolveAnalysisConfig(env, { fetchImpl: fakeFetch });
      if (cfg.mode !== "live") throw new Error("expected live config");
      expect(cfg.redactor.requestTimeoutMs).toBe(240_000);
      const overridden = resolveAnalysisConfig({ ...env, GLIMMER_TIMEOUT_MS: "200000" }, { fetchImpl: fakeFetch });
      if (overridden.mode !== "live") throw new Error("expected live config");
      expect(overridden.redactor.requestTimeoutMs).toBe(200_000);
    } finally {
      if (prior === undefined) delete process.env["GLIMMER_BASE_URL"];
      else process.env["GLIMMER_BASE_URL"] = prior;
    }
  });
});
