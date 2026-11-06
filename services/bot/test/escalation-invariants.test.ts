// Escalation invariants: one test per rule in ESCALATION_RULES.md.
//  - zero provider (model) dispatches while a run awaits the owner;
//  - a stale, edited, expired, or revoked approval blocks;
//  - every block names exactly one reason from the catalogue.
// Offline: every fetch is a counting stub that fails the test if reached
// while blocked; temp state files only; no network, no model.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateApproval, screenOutgoing } from "@second-seat/core";
import { MuseClient } from "../src/brief/muse.js";
import { SparkSupportJudge } from "../src/judge/support.js";
import { SparkPressureClassifier } from "../src/shield/classify.js";
import {
  APPROVAL_TTL_MS,
  GateApprovalError,
  GatedText,
  ResidualPIIError,
  createPrivacyGate,
  requireLiveGatedText,
} from "../src/private/gate.js";
import { CostCapExceeded } from "../src/brief/costGuard.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** ESCALATION_RULES.md reason catalogue: each refusal must match exactly one. */
const REASONS: Record<string, RegExp> = {
  approval_required: /approval required/,
  stale: /approval is stale/,
  expired: /approval expired/,
  residual_pii: /residual PII detected/,
  fixture_not_live: /fixture-mode approval cannot authorize/,
  cost_cap: /refusing live call:/,
};
const blocksSeen: string[] = [];

function reasonsOf(message: string): string[] {
  return Object.entries(REASONS).filter(([, re]) => re.test(message)).map(([k]) => k);
}

async function expectBlock(attempt: () => Promise<unknown> | unknown, reason: string, type: Function = GateApprovalError) {
  let caught: unknown;
  try {
    await attempt();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected a ${reason} block`).toBeInstanceOf(type);
  const message = (caught as Error).message;
  expect(reasonsOf(message), message).toEqual([reason]);
  blocksSeen.push(reason);
}

// Every provider dispatch goes through fetch; count it everywhere.
let dispatches = 0;
const countingFetch = (async () => {
  dispatches += 1;
  return new Response("{}", { status: 500 });
}) as typeof fetch;

function stubRedactor() {
  return {
    label: "stub",
    redactText: async (t: string) => ({ maskedText: t, spans: [] }),
    redactImage: async () => {
      throw new Error("no images in this test");
    },
    health: async () => ({ ok: true, label: "stub" }),
  };
}

let clock = Date.parse("2026-10-28T17:00:00.000Z");
const now = () => clock;

function liveGate() {
  return createPrivacyGate({ mode: "live", redactor: stubRedactor(), now });
}

/** All three live Spark clients, each fed `value` as its text input. */
function providerAttempts(value: unknown): Array<() => Promise<unknown>> {
  return [
    () => new SparkSupportJudge({ maxAttempts: 1, fetchImpl: countingFetch }).gradeSupport({ entryId: "e1", entryText: value as GatedText, citedSpans: [value as GatedText] }),
    () => new SparkPressureClassifier({ maxAttempts: 1, fetchImpl: countingFetch }).classify([{ segmentId: "t-00:01", text: value as GatedText }]),
    () => new MuseClient({ maxAttempts: 1, fetchImpl: countingFetch }).completeBrief({ meetingId: "m1", transcriptText: value as GatedText, framesSidecarText: "", fixtureMode: false }),
  ];
}

async function expectNoProviderDispatch(value: unknown, reason = "approval_required") {
  for (const attempt of providerAttempts(value)) await expectBlock(attempt, reason);
  expect(dispatches).toBe(0);
}

let savedEnv: Record<string, string | undefined>;
let prevFetch: typeof fetch;
const stateFile = join(tmpdir(), `escalation-${process.pid}-${Math.random().toString(36).slice(2)}-state.json`);
const costLog = join(tmpdir(), `escalation-${process.pid}-${Math.random().toString(36).slice(2)}-cost.jsonl`);

beforeEach(() => {
  savedEnv = {
    GLIMMER_BASE_URL: process.env["GLIMMER_BASE_URL"],
    META_API_KEY: process.env["META_API_KEY"],
    MUSE_API_KEY: process.env["MUSE_API_KEY"],
    MUSE_STATE_FILE: process.env["MUSE_STATE_FILE"],
    MUSE_COST_LOG_FILE: process.env["MUSE_COST_LOG_FILE"],
    MUSE_MAX_CALLS_PER_DAY: process.env["MUSE_MAX_CALLS_PER_DAY"],
  };
  process.env["GLIMMER_BASE_URL"] = "http://127.0.0.1:9";
  process.env["META_API_KEY"] = "dummy-test-key";
  delete process.env["MUSE_API_KEY"];
  delete process.env["MUSE_MAX_CALLS_PER_DAY"];
  process.env["MUSE_STATE_FILE"] = stateFile;
  process.env["MUSE_COST_LOG_FILE"] = costLog;
  rmSync(stateFile, { force: true });
  prevFetch = globalThis.fetch;
  globalThis.fetch = countingFetch;
  dispatches = 0;
  clock = Date.parse("2026-10-28T17:00:00.000Z");
});

afterEach(() => {
  globalThis.fetch = prevFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(stateFile, { force: true });
  rmSync(costLog, { force: true });
});

const TESTED_RULES = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"];

describe("escalation invariants (ESCALATION_RULES.md)", () => {
  it("R1: awaiting approval -> send refuses, sendFn never runs, zero provider dispatches", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Notes for the supplier call.");
    let sendFnCalls = 0;
    await expectBlock(() => gate.send(run.runId, "", async () => (sendFnCalls += 1)), "approval_required");
    await expectNoProviderDispatch("Notes for the supplier call.");
    await expectNoProviderDispatch(run.redactedText);
    expect(sendFnCalls).toBe(0);
    expect(gate.receipts(run.runId)).toEqual([]);
  });

  it("R2: an edit after approval clears it; the old minted value is dead at the transport", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Ship 12,000 boxes by Nov 30.");
    const token = gate.approve(run.runId, run.redactedText);
    const minted = await gate.send(run.runId, token, async (g) => g);
    expect(() => requireLiveGatedText(minted)).not.toThrow();
    gate.correct(run.runId, "Ship 12,000 boxes by Nov 29.");
    await expectBlock(() => gate.send(run.runId, token, async () => undefined), "approval_required");
    await expectNoProviderDispatch(minted);
    expect(gate.receipts(run.runId)).toEqual([]);
  });

  it("R3: an approval for different text than the current text is stale", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Price is 41 cents a unit.");
    const token = gate.approve(run.runId, "Price is 40 cents a unit.");
    let sendFnCalls = 0;
    await expectBlock(() => gate.send(run.runId, token, async () => (sendFnCalls += 1)), "stale");
    expect(sendFnCalls).toBe(0);
    expect(dispatches).toBe(0);
  });

  it("R4: an approval older than the TTL is expired, at send and at the transport", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Artwork due Friday.");
    const token = gate.approve(run.runId, run.redactedText);
    const minted = await gate.send(run.runId, token, async (g) => g);
    clock += APPROVAL_TTL_MS + 1;
    await expectBlock(() => gate.send(run.runId, token, async () => undefined), "expired");
    await expectNoProviderDispatch(minted);
  });

  it("R5: revoking kills every value minted under the approval; no receipt is recorded", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Confirm the dock address.");
    const token = gate.approve(run.runId, run.redactedText);
    const minted = await gate.send(run.runId, token, async (g) => g);
    gate.revoke(run.runId);
    await expectNoProviderDispatch(minted);
    await expectBlock(() => gate.send(run.runId, token, async () => undefined), "approval_required");
    expect(gate.receipts(run.runId)).toEqual([]);
  });

  it("R6: residual PII in the approved text blocks naming the kind, never the value", async () => {
    const gate = createPrivacyGate({ mode: "fixture", now });
    const run = await gate.prepare("Send the quote to Marco.");
    const edited = gate.correct(run.runId, "Send the quote to marco.reyes@example.com.");
    const token = gate.approve(run.runId, edited);
    let sendFnCalls = 0;
    await expectBlock(() => gate.send(run.runId, token, async () => (sendFnCalls += 1)), "residual_pii", ResidualPIIError);
    expect(sendFnCalls).toBe(0);
    try {
      await gate.send(run.runId, token, async () => undefined);
    } catch (err) {
      expect((err as Error).message).not.toContain("example.com");
    }
  });

  it("R7: a fixture-mode approval cannot authorize a live provider request", async () => {
    const gate = createPrivacyGate({ mode: "fixture", now });
    const run = await gate.prepare("Holiday menu launches in December.");
    const token = gate.approve(run.runId, run.redactedText);
    const fixtureMinted = await gate.send(run.runId, token, async (g) => g);
    await expectNoProviderDispatch(fixtureMinted, "fixture_not_live");
  });

  it("R8: the daily cap refuses before any fetch, even with a valid live approval", async () => {
    writeFileSync(stateFile, JSON.stringify({ date: new Date().toISOString().slice(0, 10), calls: 10_000, spendUsd: 0 }));
    const gate = liveGate();
    const run = await gate.prepare("Freight quoted separately.");
    const token = gate.approve(run.runId, run.redactedText);
    const minted = await gate.send(run.runId, token, async (g) => g);
    for (const attempt of providerAttempts(minted)) await expectBlock(attempt, "cost_cap", CostCapExceeded);
    expect(dispatches).toBe(0);
    expect(gate.receipts(run.runId)).toEqual([]);
  });

  it("R9: unknown runs, forged tokens, and hand-built values are refused", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Backup plan if the 30th slips.");
    gate.approve(run.runId, run.redactedText);
    await expectBlock(() => gate.send("no-such-run", "x", async () => undefined), "approval_required");
    await expectBlock(() => gate.send(run.runId, "forged-token", async () => undefined), "approval_required");
    await expectBlock(() => new GatedText(Symbol("not-the-mint"), "hand built"), "approval_required");
    expect(dispatches).toBe(0);
  });

  it("R10: outgoing commitment language is held for the owner with exactly one reason", () => {
    const held = gateApproval("Approved. Please proceed with the purchase.");
    expect(held.held).toBe(true);
    expect(typeof held.reason).toBe("string");
    expect(held.reason!.length).toBeGreaterThan(0);
    const screened = screenOutgoing("Approved. Please proceed with the purchase.");
    expect(screened.allowed).toBe(false);
    expect(screened.reason).toBe(held.reason);
    expect(gateApproval("Thanks, I will review the proposal and get back to you.").held).toBe(false);
  });

  it("Resume: re-approval mints a new approval; old values stay dead; exactly one send per approval", async () => {
    const gate = liveGate();
    const run = await gate.prepare("Twelve thousand units.");
    const first = gate.approve(run.runId, run.redactedText);
    const oldMinted = await gate.send(run.runId, first, async (g) => g);
    const edited = gate.correct(run.runId, "Twelve thousand units, 8-inch box.");
    expect(gate.preview(run.runId)).toBe(edited);
    const second = gate.approve(run.runId, edited);
    expect(second).not.toBe(first);
    let sendFnCalls = 0;
    const fresh = await gate.send(run.runId, second, async (g) => {
      sendFnCalls += 1;
      return g;
    });
    expect(sendFnCalls).toBe(1);
    expect(fresh.text).toBe(edited);
    expect(() => requireLiveGatedText(fresh)).not.toThrow();
    await expectBlock(() => requireLiveGatedText(oldMinted), "approval_required");
    expect(dispatches).toBe(0);
  });

  it("every block seen in this file named exactly one catalogue reason", () => {
    expect(blocksSeen.length).toBeGreaterThan(20);
    expect(new Set(blocksSeen)).toEqual(new Set(Object.keys(REASONS)));
  });

  it("ESCALATION_RULES.md lists exactly the rules and reasons tested here", () => {
    const doc = readFileSync(join(repoRoot, "ESCALATION_RULES.md"), "utf8");
    const ruleIds = [...doc.matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1]);
    expect(ruleIds).toEqual(TESTED_RULES);
    const reasonIds = [...doc.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(reasonIds).toEqual(Object.keys(REASONS));
    expect(doc).toContain("| Id | Trigger | Rule | What unblocks it |");
    expect(doc).toMatch(/^## Handoff$/m);
    expect(doc).toMatch(/^## Resume$/m);
    expect(doc).toContain("https://github.com/meta-models/legal-agent-workshop");
  });
});
