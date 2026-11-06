import { CANDIDATE_APPROVAL_MAX_TEXT } from "./candidateApproval.js";
import type { CandidateApprovalDecision } from "./candidateApproval.js";
import type { createCandidateApprovalBroker } from "./candidateApproval.js";
import type { MeetingRoomService } from "./meetingRoom.js";

type Broker = ReturnType<typeof createCandidateApprovalBroker>;
type Service = Pick<MeetingRoomService, "candidateBindingAs">;
type ApiResult = { status: number; body: Readonly<Record<string, unknown>> };

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function isPositiveSafeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

export function createCandidateApprovalApi(service: Service, broker: Broker) {
  function read(callerKey: string | null, roomId: unknown): ApiResult {
    try {
      const binding = service.candidateBindingAs(callerKey, roomId);
      if (binding === null) return { status: 404, body: { error: "not found" } };
      const preview = broker.snapshot(binding);
      return { status: 200, body: { preview } };
    } catch {
      return { status: 503, body: { error: "unavailable" } };
    }
  }

  function act(callerKey: string | null, body: unknown): ApiResult {
    try {
      if (!isRecord(body)) return { status: 400, body: { error: "bad request" } };

      const actionRaw = body["action"];
      if (actionRaw !== "correct" && actionRaw !== "approve" && actionRaw !== "deny") {
        return { status: 400, body: { error: "bad request" } };
      }
      const action: "correct" | "approve" | "deny" = actionRaw;

      const allowed = action === "correct"
        ? new Set(["action", "roomId", "requestId", "version", "previewHash", "text"])
        : new Set(["action", "roomId", "requestId", "version", "previewHash"]);

      for (const k of Object.keys(body)) {
        if (!allowed.has(k)) return { status: 400, body: { error: "bad request" } };
      }

      const roomId = body["roomId"];
      const requestId = body["requestId"];
      const version = body["version"];
      const previewHash = body["previewHash"];

      if (!isNonEmptyString(roomId, 128)) return { status: 400, body: { error: "bad request" } };
      if (typeof requestId !== "string" || !HEX_32.test(requestId)) return { status: 400, body: { error: "bad request" } };
      if (!isPositiveSafeInt(version)) return { status: 400, body: { error: "bad request" } };
      if (typeof previewHash !== "string" || !HEX_64.test(previewHash)) return { status: 400, body: { error: "bad request" } };

      let text = "";
      if (action === "correct") {
        const t = body["text"];
        if (typeof t !== "string" || t.length === 0 || t.length > CANDIDATE_APPROVAL_MAX_TEXT) {
          return { status: 400, body: { error: "bad request" } };
        }
        if (t.trim().length === 0) return { status: 400, body: { error: "bad request" } };
        text = t;
      } else {
        if ("text" in body) return { status: 400, body: { error: "bad request" } };
      }

      const decision: CandidateApprovalDecision = { requestId, version, previewHash };

      const binding = service.candidateBindingAs(callerKey, roomId);
      if (binding === null) return { status: 404, body: { error: "not found" } };

      const current = broker.snapshot(binding);
      if (current === null) return { status: 409, body: { error: "conflict" } };
      if (current.requestId !== decision.requestId || current.version !== decision.version || current.previewHash !== decision.previewHash) {
        return { status: 409, body: { error: "conflict" } };
      }

      if (action === "correct") {
        const next = broker.correct(binding, decision, text);
        if (next === null) return { status: 409, body: { error: "conflict" } };
        return { status: 200, body: { preview: next } };
      }
      if (action === "approve") {
        const ok = broker.approve(binding, decision);
        if (!ok) return { status: 409, body: { error: "conflict" } };
        return { status: 200, body: { approved: true } };
      }
      const ok = broker.deny(binding, decision.requestId);
      if (!ok) return { status: 409, body: { error: "conflict" } };
      return { status: 200, body: { denied: true } };
    } catch {
      return { status: 503, body: { error: "unavailable" } };
    }
  }

  return { read, act };
}
