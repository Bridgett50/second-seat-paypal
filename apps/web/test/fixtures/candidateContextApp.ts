import { randomUUID } from "node:crypto";
import { createPrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { vi } from "vitest";
import { createCandidateApprovalApi } from "../../src/candidateApprovalApi.js";
import { createCandidateApprovalBroker } from "../../src/candidateApproval.js";
import { createCandidateReasoner } from "../../src/candidateReasoner.js";
import { createMeetingRoomService } from "../../src/meetingRoom.js";
import { createWebServer } from "../../src/server.js";
function fakeRedactor() {
  return {
    label: "test-fake",
    redactText: async (text: string) => {
      const needle = "alice@example.com";
      const idx = text.indexOf(needle);
      if (idx !== -1) {
        return { maskedText: text.slice(0, idx) + "[REDACTED_email]" + text.slice(idx + needle.length), spans: [{ start: idx, end: idx + needle.length, label: "email" }] };
      }
      return { maskedText: text, spans: [] };
    },
    redactImage: async () => { throw new Error("no images"); },
    health: async () => ({ ok: true, label: "test-fake" }),
  };
}
export function makeContextApp() {
  const gate = createPrivacyGate({ mode: "fixture", redactor: fakeRedactor() });
  let service: ReturnType<typeof createMeetingRoomService>;
  const broker = createCandidateApprovalBroker({ isCurrent: (binding) => service.candidateIsCurrent(binding) });
  const knownUid = randomUUID();
  const captured = { text: "" };
  const callModel = vi.fn(async (gated: { readonly text: string }) => {
    captured.text = gated.text;
    const lines = gated.text.split("\n");
    let matched: RegExpMatchArray | null = null;
    for (const line of lines) {
      const m = line.match(/([0-9a-f-]{36})\s+(\d+)\s+\S.*\s+.*/);
      if (m && Number(m[2]) > 0) { matched = m; break; }
    }
    if (!matched) throw new Error("no transcript line with uuid and positive revision found in gated.text");
    return { subject: "Meeting follow-up", body: "I will confirm the date myself.", sourceRefs: [{ utteranceId: matched[1], revision: Number(matched[2]) }] };
  });
  const reasoner = createCandidateReasoner({ SECOND_SEAT_CANDIDATE_REASONER: "1" }, {
    gate,
    isCurrent: (b) => service.candidateIsCurrent(b),
    requestOwnerApproval: (runId, redactedPreview, binding, signal) => broker.request({ gate, runId, redactedPreview, binding, signal }),
    callModel,
  });
  if (!reasoner) throw new Error("reasoner undefined");
  service = createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "0" }, conversationInput: true, sessionPolicy: true, candidateReasoner: reasoner, candidateDeadlineMs: 120000, candidateAutoDispatch: false });
  const api = createCandidateApprovalApi(service, broker);
  const server = createWebServer({ meetingRoom: service, candidateApprovalApi: api });
  return { service, gate, broker, server, callModel, knownUid, captured };
}
