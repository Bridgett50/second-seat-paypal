import { createCandidateApprovalApi } from "./candidateApprovalApi.js";
import { createCandidateApprovalBroker } from "./candidateApproval.js";
import { createCandidateReasoner } from "./candidateReasoner.js";
import { createCandidateTransport } from "./candidateTransport.js";
import { createMeetingRoomService } from "./meetingRoom.js";
import type { AnalysisConfig } from "./liveConfig.js";
export function createCandidateRuntime(env: Readonly<Record<string, string | undefined>>, analysis: AnalysisConfig) {
  if (env.SECOND_SEAT_CANDIDATE_REASONER !== "1") return undefined;
  if (env.SECOND_SEAT_TEST_MODE === "1") return undefined;
  if (env.SECOND_SEAT_MODE !== "live") return undefined;
  if (analysis.mode !== "live") return undefined;
  const key = env.META_API_KEY ?? env.MUSE_API_KEY ?? "";
  if (!key) throw new Error("Missing required environment variable: META_API_KEY or MUSE_API_KEY");
  const transport = createCandidateTransport({ apiKey: key, fetchImpl: fetch, timeoutMs: 30000, maxCompletionTokens: 2000, maxInputChars: 20000 });
  let service: ReturnType<typeof createMeetingRoomService>;
  const broker = createCandidateApprovalBroker({ isCurrent: (binding) => service.candidateIsCurrent(binding) });
  const reasoner = createCandidateReasoner(env, { gate: analysis.gate, requestOwnerApproval: (runId, redactedPreview, binding, signal) => broker.request({ gate: analysis.gate, runId, redactedPreview, binding, signal }), isCurrent: (binding) => service.candidateIsCurrent(binding), callModel: transport });
  if (!reasoner) throw new Error("reasoner undefined");
  service = createMeetingRoomService({ env, conversationInput: true, sessionPolicy: true, candidateReasoner: reasoner, candidateDeadlineMs: 400000, candidateMaxAttempts: 2, candidateAutoDispatch: false });
  const api = createCandidateApprovalApi(service, broker);
  return { meetingRoom: service, candidateApprovalApi: api };
}
