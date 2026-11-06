/**
 * FR3: a structural pass is not a claim-support verification.
 * Offline only. No provider, Modal, or sealed data.
 */
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";
import { createWebServer } from "../src/server.js";
import { renderSessionPage } from "../src/render.js";
import {
  VERIFICATION_BLOCK_MESSAGE,
  VERIFICATION_WARN_MESSAGE,
  offlineEvidenceBrief,
  verifyApprovedRedaction,
  verifySessionBrief,
} from "../src/sessionVerification.js";

const SEG = [{ id: "seg-1", text: "Discussed options." }];
const ONE = [{ kind: "decision", text: "Discussed options.", segmentIds: ["seg-1"] }];

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

describe("FR3 verification labels", () => {
  it("FR3-1 does not call a structural pass verified when claims are absent", () => {
    for (const verdicts of [undefined, null]) {
      const view = verifySessionBrief(offlineEvidenceBrief("m", ONE), SEG, "m", verdicts);
      expect(view.blocked).toBe(false);
      expect(view.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
      expect(view.status).not.toBe("verified");
      expect(view.title).toBe("Structural checks passed");
      expect(view.message).toBe("Claim support not checked.");
    }
  });

  it("FR3-2 keeps an empty brief honest", () => {
    const view = verifySessionBrief(offlineEvidenceBrief("m", []), SEG, "m", undefined);
    expect(view.blocked).toBe(false);
    expect(view.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
    expect(view.title).not.toBe("Verified");
    expect(view.status).not.toBe("verified");
    expect(view.message).toBe("Claim support not checked.");
  });

  it("FR3-3 names a redaction-only pass without implying brief or claim checks", () => {
    const view = verifyApprovedRedaction("hello", [], "hello");
    expect(view.blocked).toBe(false);
    expect(view.checks.find((c) => c.id === "brief")?.result).toBe("not_run");
    expect(view.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
    expect(view.status).not.toBe("verified");
    expect(view.title).toBe("Redaction check passed");
    expect(view.message).not.toMatch(/brief passed|claims passed|Verified/i);
  });

  it("FR3-4 may say verified when a supported verdict is present", () => {
    const view = verifySessionBrief(offlineEvidenceBrief("m", ONE), SEG, "m", {
      e1: { grade: "supported", missing_qualifier: null },
    });
    expect(view.blocked).toBe(false);
    expect(view.checks.find((c) => c.id === "claims")?.result).toBe("passed");
    expect(view.status).toBe("verified");
    expect(view.title).toBe("Verified");
  });

  it("FR3-5 hard claim failures still block without leaking the qualifier", () => {
    const secret = "hidden qualifier phrase";
    const cases = [
      { e1: { grade: "partial", missing_qualifier: secret } },
      { e1: { grade: "unsupported", missing_qualifier: null } },
      { e1: { grade: "not-a-grade", missing_qualifier: null } },
      { e9: { grade: "supported", missing_qualifier: null } },
      { e1: { grade: "supported", missing_qualifier: secret } },
    ];
    for (const verdicts of cases) {
      const view = verifySessionBrief(offlineEvidenceBrief("m", ONE), SEG, "m", verdicts);
      expect(view.blocked).toBe(true);
      expect(view.message).toBe(VERIFICATION_BLOCK_MESSAGE);
      expect(JSON.stringify(view)).not.toContain(secret);
    }
  });

  it("FR3-6 keeps owner review and still says claims were not checked", () => {
    const view = verifySessionBrief(
      offlineEvidenceBrief("m", [{ kind: "commitment", text: "Pay $10 today", segmentIds: ["seg-1"] }]),
      [{ id: "seg-1", text: "Pay $10 today" }],
      "m",
      undefined,
    );
    expect(view.blocked).toBe(false);
    expect(view.status).toBe("needs_owner_review");
    expect(view.title).toBe("Needs owner review");
    expect(view.message).toContain(VERIFICATION_WARN_MESSAGE);
    expect(view.message).toContain("Claim support not checked.");
    expect(view.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
  });

  it("FR3-7 offline session DOM and state API agree claims were not run", async () => {
    const server = createWebServer();
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const post = async (path: string, body: unknown) => {
      const res = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json() as Promise<Record<string, unknown>>;
    };
    try {
      const created = await post("/api/session", {});
      const sessionId = created.sessionId as string;
      const pasted = await post("/api/session/transcript", { sessionId, text: "Discussed options." });
      const redacted = await post("/api/session/redact", { sessionId });
      const approved = await post("/api/session/approve", {
        sessionId,
        expectedRevision: (redacted.revision ?? pasted.revision) as number,
      });
      await post("/api/session/analyze", { sessionId });
      expect(approved.state).toBe("approved");
      const stateRes = await fetch(`${base}/api/session/state?sessionId=${sessionId}`);
      const state = (await stateRes.json()) as {
        state: string;
        verification: { status: string; title: string; message: string; checks: { id: string; result: string }[] };
      };
      expect(state.state).toBe("completed");
      expect(state.verification.status).not.toBe("verified");
      expect(state.verification.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
      const page = renderSessionPage(state as never);
      expect(page).toContain(`id="verification-title">${state.verification.title}`);
      expect(page).toContain("Claim support not checked.");
      expect(page).not.toContain('id="verification-title">Verified');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("FR3 store still completes neutral offline text", () => {
  it("does not mark the offline session verified", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "Discussed options.");
    await store.redact(id);
    store.approve(id);
    const snap = await store.analyze(id);
    expect(snap.state).toBe("completed");
    expect(snap.verification?.status).not.toBe("verified");
    expect(snap.verification?.title).toBe("Structural checks passed");
  });
});
