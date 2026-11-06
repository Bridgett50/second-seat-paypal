import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session.js";
import { renderSessionPage, type SessionPageSnapshot } from "../src/render.js";
import {
  VERIFICATION_BLOCK_MESSAGE,
  VERIFICATION_WARN_MESSAGE,
  verifyApprovedRedaction,
  verifySessionBrief,
  offlineEvidenceBrief,
} from "../src/sessionVerification.js";

const PHONE = "555-010-2202";

describe("verifyApprovedRedaction", () => {
  it("passes a masked preview and does not echo the source text", () => {
    const raw = `Call Ana Bell at ${PHONE} today.`;
    const view = verifyApprovedRedaction(
      raw,
      [
        { start: 5, end: 13, label: "person" },
        { start: raw.indexOf(PHONE), end: raw.indexOf(PHONE) + PHONE.length, label: "phone" },
      ],
      "Call [REDACTED_person] at [REDACTED_phone] today.",
    );
    expect(view.blocked).toBe(false);
    expect(view.status).toBe("redaction_checked");
    expect(view.title).toBe("Redaction check passed");
    expect(view.checks.find((c) => c.id === "redaction")?.result).toBe("passed");
    expect(JSON.stringify(view)).not.toContain(PHONE);
    expect(JSON.stringify(view)).not.toContain("Ana");
  });

  it("blocks a separator phone the redactor left behind", () => {
    const view = verifyApprovedRedaction(`call ${PHONE}`, [], `call ${PHONE}`);
    expect(view.blocked).toBe(true);
    expect(view.title).toBe("Needs owner review");
    expect(view.message).toBe(VERIFICATION_BLOCK_MESSAGE);
    expect(view.message).not.toContain(PHONE);
  });
});

describe("verifySessionBrief", () => {
  const segments = [{ id: "seg-1", text: "What now?" }];

  it("passes an empty offline brief and leaves claims not run", () => {
    const view = verifySessionBrief(offlineEvidenceBrief("m", []), segments, "m", null);
    expect(view.blocked).toBe(false);
    expect(view.status).toBe("structural");
    expect(view.title).toBe("Structural checks passed");
    expect(view.checks.map((c) => `${c.id}:${c.result}`)).toEqual([
      "redaction:passed",
      "brief:passed",
      "claims:not_run",
    ]);
  });

  it("escalates a warning without blocking", () => {
    const view = verifySessionBrief(
      offlineEvidenceBrief("m", [{ kind: "commitment", text: "Pay $10 today", segmentIds: ["seg-1"] }]),
      [{ id: "seg-1", text: "Pay $10 today" }],
      "m",
      null,
    );
    expect(view.blocked).toBe(false);
    expect(view.status).toBe("needs_owner_review");
    expect(view.message).toBe(`${VERIFICATION_WARN_MESSAGE} Claim support not checked.`);
    expect(view.checks.find((c) => c.id === "brief")?.result).toBe("escalated");
  });

  it("blocks a bad claims verdict without echoing it", () => {
    const work = offlineEvidenceBrief("m", [{ kind: "question", text: "What now?", segmentIds: ["seg-1"] }]);
    const secret = "plus tax and freight";
    const view = verifySessionBrief(work, segments, "m", {
      e1: { grade: "partial", missing_qualifier: secret },
    });
    expect(view.blocked).toBe(true);
    expect(view.message).toBe(VERIFICATION_BLOCK_MESSAGE);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.checks.find((c) => c.id === "claims")?.result).toBe("blocked");
  });
});

describe("session wiring", () => {
  it("offline plain text is verified and still completes", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "hello world");
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    expect(s.state).toBe("completed");
    expect(s.verification?.status).toBe("structural");
    expect(s.verification?.title).toBe("Structural checks passed");
    expect(s.verification?.checks.find((c) => c.id === "redaction")?.result).toBe("passed");
    expect(s.verification?.checks.find((c) => c.id === "brief")?.result).toBe("passed");
    expect(s.verification?.checks.find((c) => c.id === "claims")?.result).toBe("not_run");
    expect(s.draft).not.toBeNull();
  });

  it("stops before the analyzer when residual PII remains, and keeps the approve control", async () => {
    let calls = 0;
    const store = createSessionStore({
      redactor: {
        redactText: async (text: string) => ({ maskedText: text, spans: [] }),
      },
      analyzer: async () => {
        calls += 1;
        return { offline: true, entries: [] };
      },
    });
    const id = store.createSession();
    store.setTranscript(id, `please call ${PHONE}`);
    await store.redact(id);
    store.approve(id);
    const s = await store.analyze(id);
    expect(calls).toBe(0);
    expect(s.state).toBe("review_required");
    expect(s.approved).toBe(false);
    expect(s.verification?.blocked).toBe(true);
    expect(s.verification?.message).toBe(VERIFICATION_BLOCK_MESSAGE);
    expect(s.verification?.message).not.toContain(PHONE);
    expect(JSON.stringify(s.verification?.checks)).not.toContain(PHONE);
    const page = renderSessionPage(s as SessionPageSnapshot);
    expect(page).toContain('id="btn-approve"');
    expect(page).toContain('id="btn-draft-approve"');
    expect(page).toContain('id="verification-title">Needs owner review');
  });

  it("shows the brief when a warning escalates, and blocks when claims fail", async () => {
    const store = createSessionStore();
    const id = store.createSession();
    store.setTranscript(id, "Pay $10 today");
    await store.redact(id);
    store.approve(id);
    const warned = await store.analyze(id);
    expect(warned.state).toBe("completed");
    expect(warned.verification?.blocked).toBe(false);
    expect(warned.verification?.status).toBe("needs_owner_review");
    expect(warned.result).not.toBeNull();

    const blocking = createSessionStore({
      judgeVerdicts: { e1: { grade: "unsupported", missing_qualifier: null } },
    });
    const bid = blocking.createSession();
    blocking.setTranscript(bid, "What now?");
    await blocking.redact(bid);
    blocking.approve(bid);
    const blocked = await blocking.analyze(bid);
    expect(blocked.state).toBe("blocked");
    expect(blocked.result).toBeNull();
    expect(blocked.verification?.message).toBe(VERIFICATION_BLOCK_MESSAGE);
    expect(blocked.verification?.checks.find((c) => c.id === "claims")?.result).toBe("blocked");
  });
});
