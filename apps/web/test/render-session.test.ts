import { describe, expect, it } from "vitest";
import { loadDemo } from "../src/loadFixtures.js";
import {
  renderBriefPage,
  renderSessionPage,
  sessionStateLabel,
  type SessionPageSnapshot,
} from "../src/render.js";

const base: SessionPageSnapshot = {
  state: "input",
  revision: 0,
  segments: [],
  redactedText: "",
  approved: false,
  result: null,
  payload: null,
  offline: true,
};

describe("renderSessionPage", () => {
  it("shows the honest empty state when there is no analysis result", () => {
    const page = renderSessionPage(base);
    expect(page).toContain("No findings yet — paste a transcript and run analysis.");
    expect(page).toContain('id="empty-state"');
  });

  it("shows the approved-transcript empty state when entries are []", () => {
    const page = renderSessionPage({
      ...base,
      state: "completed",
      result: { offline: true, entries: [] },
    });
    expect(page).toContain("No findings in the approved transcript.");
  });

  it("contains no hardcoded finding text", () => {
    const page = renderSessionPage({
      ...base,
      state: "completed",
      result: {
        offline: true,
        entries: [{ kind: "question", text: "When?", segmentIds: ["seg-1"] }],
      },
      segments: [{ id: "seg-1", text: "When?" }],
    });
    expect(page).not.toContain("Slide says the 30th");
  });

  it("renders the offline label server-side in offline mode", () => {
    const page = renderSessionPage(base);
    expect(page).toContain('id="offline-label"');
    expect(page).toContain("Offline demo");
    expect(renderSessionPage({ ...base, offline: false })).not.toContain(
      'id="offline-label"',
    );
  });

  it("labels every session state in human text", () => {
    const labels = [
      ["input", "Input"],
      ["redaction_pending", "Redaction pending"],
      ["review_required", "Review required"],
      ["approved", "Approved"],
      ["analysis_pending", "Analysis pending"],
      ["completed", "Completed"],
    ] as const;
    for (const [state, word] of labels) {
      expect(sessionStateLabel({ ...base, state })).toContain(word);
      expect(renderSessionPage({ ...base, state })).toContain('id="session-state"');
    }
    expect(sessionStateLabel({ ...base, state: "blocked", reason: "stale approval" })).toContain(
      "stale approval",
    );
    const err = sessionStateLabel({ ...base, state: "error", reason: "boom" });
    expect(err).toContain("boom");
  });

  it("renders results with citation links to #seg-N and an escaped payload panel", () => {
    const page = renderSessionPage({
      ...base,
      state: "completed",
      segments: [{ id: "seg-1", text: "Pay <b>$5</b> today?" }],
      result: {
        offline: true,
        entries: [{ kind: "commitment", text: "Pay <b>$5</b> today?", segmentIds: ["seg-1"] }],
      },
      payload: {
        approvedText: "Pay <b>$5</b> today?",
        status: "dispatched",
        sentAt: "2026-10-27T00:00:00.000Z",
        adapterLabel: "offline heuristic",
      },
    });
    expect(page).toContain('href="#seg-1"');
    expect(page).toContain('[seg-1]');
    expect(page).toContain('id="seg-1"');
    expect(page).toContain('id="payload-panel"');
    expect(page).toContain("&lt;b&gt;");
    expect(page).not.toContain("Pay <b>$5</b> today?");
    expect(page).toContain("Dispatched to offline heuristic at 2026-10-27T00:00:00.000Z");
    expect(
      renderSessionPage({
        ...base,
        state: "approved",
        payload: { approvedText: "x", status: "prepared" },
      }),
    ).toContain("Prepared (not dispatched)");
  });

  it("shows analysis-error without 'No findings' when state is error", () => {
    const page = renderSessionPage({
      ...base,
      state: "error",
      reason: "boom <b>",
      result: null,
    });
    expect(page).toContain('id="analysis-error"');
    expect(page).toContain('role="alert"');
    expect(page).toContain("boom &lt;b&gt;");
    const resultsDiv = page.slice(
      page.indexOf('<div id="results">'),
      page.indexOf("</div></section>"),
    );
    expect(resultsDiv).toContain('id="analysis-error"');
    expect(resultsDiv).not.toContain("No findings");
    expect(resultsDiv).not.toContain('id="empty-state"');
  });

  it("has the transcript input section with the required controls", () => {
    const page = renderSessionPage(base);
    for (const id of [
      "transcript-input",
      "redacted-text",
      "btn-redact",
      "btn-approve",
      "btn-analyze",
    ]) {
      expect(page).toContain(`id="${id}"`);
    }
  });
});

describe("renderBriefPage honesty", () => {
  it("contains no hardcoded conflict card text", () => {
    const demo = loadDemo();
    const page = renderBriefPage(
      demo.brief,
      demo.segments,
      demo.frames,
      demo.runLog,
      { pressureFallback: demo.pressureFallback, payloadDemo: demo.payloadDemo },
    );
    expect(page).not.toContain("Slide says the 30th");
    expect(page).not.toContain('id="conflict"');
  });
});
