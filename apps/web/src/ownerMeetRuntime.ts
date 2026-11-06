import { createMeetingRoomService, type MeetingRoomService } from "./meetingRoom.js";
import { createMeetWorkerBridge } from "./meetWorkerBridge.js";
import { createMeetWorkerHttp } from "./meetWorkerHttp.js";
import type { createCandidateApprovalApi } from "./candidateApprovalApi.js";
import type { MeetWorkerRequest } from "./meetWorkerHttp.js";
type Opts = {
  origin: string;
  startCapture: Parameters<typeof createMeetWorkerBridge>[0]["startCapture"];
  candidateRuntime?: { meetingRoom: MeetingRoomService; candidateApprovalApi: ReturnType<typeof createCandidateApprovalApi> };
  canPrepare?: () => boolean;
  schedule?: (tick: () => void) => () => void;
  maxWorkers?: number;
};
export type StartCapture = Parameters<typeof createMeetWorkerBridge>[0]["startCapture"];
type Reply = ReturnType<ReturnType<typeof createMeetWorkerBridge>["connect"]>;
function freezeReply(s: number, b: Reply["body"]["status"], a: number): Reply {
  return Object.freeze({ status: s, body: Object.freeze({ status: b, accepted: a }) });
}
export function createOwnerMeetRuntime(opts: Opts) {
  let maxW = opts.maxWorkers ?? 1;
  if (!Number.isSafeInteger(maxW) || maxW < 1 || maxW > 2) throw new RangeError("maxWorkers");
  // Snapshot supplied candidateRuntime at construction; guard must require initially-supplied candidate, not later-mutated opts.candidateRuntime. Release authorization hook — not proof of budget/credits.
  const suppliedCandidateRuntime = opts.candidateRuntime;
  const meetingRoom = suppliedCandidateRuntime?.meetingRoom ?? createMeetingRoomService({ env: { SECOND_SEAT_TEST_MODE: "0" }, conversationInput: true, candidateAutoDispatch: false, sessionPolicy: true });
  const candidateApprovalApi = suppliedCandidateRuntime?.candidateApprovalApi;
  const raw = createMeetWorkerBridge({ service: meetingRoom, startCapture: opts.startCapture });
  let disposed = false;
  let disposeP: Promise<void> | null = null;
  type Meta = { callerKey: string; roomId: string; inFlight: boolean };
  const jobs = new Map<string, Meta>();
  const sk = (c: string, r: string) => `${c.length}:${c}\u0000${r.length}:${r}`;
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  function sweep() {
    for (const [k, m] of [...jobs]) {
      const st = raw.status(m.callerKey, m.roomId);
      if (st.status === 200 && (st.body.status === "stopped" || st.body.status === "failed")) jobs.delete(k);
    }
  }
  const tracked = {
    connect(callerKey: string | null, roomId: unknown, meetingUrl: unknown, displayName: unknown): Reply {
      if (disposed) {
        if (!isStr(callerKey) || !isStr(roomId as string)) return freezeReply(404, "stopped", 0);
        const ck = callerKey as string;
        const rid = roomId as string;
        const b = meetingRoom.workerBindingAs(ck, rid);
        if (b === null) return freezeReply(404, "stopped", 0);
        const st = raw.status(ck, rid);
        return freezeReply(503, st.body.status, st.body.accepted);
      }
      if (!isStr(callerKey) || !isStr(roomId as string)) return freezeReply(404, "stopped", 0);
      const ck = callerKey as string;
      const rid = roomId as string;
      const b = meetingRoom.workerBindingAs(ck, rid);
      if (b === null) return freezeReply(404, "stopped", 0);
      const key = sk(ck, rid);
      const existing = jobs.has(key);
      if (!existing) {
        sweep();
        if (jobs.size >= maxW) {
          const st = raw.status(ck, rid);
          if (st.status === 200) return freezeReply(409, st.body.status, st.body.accepted);
          return freezeReply(409, "stopped", 0);
        }
      }
      const r = raw.connect(callerKey, roomId, meetingUrl, displayName);
      if (r.status === 202) jobs.set(key, { callerKey: ck, roomId: rid, inFlight: false });
      return r;
    },
    status: raw.status,
    sample: raw.sample,
    stop: raw.stop,
    revoke: raw.revoke,
  };
  const guard = (): boolean => {
    if (disposed) return false;
    if (suppliedCandidateRuntime === undefined) return false;
    if (opts.canPrepare === undefined) return false;
    try { return opts.canPrepare() === true; } catch { return false; }
  };
  const meetWorkerHttp = createMeetWorkerHttp({ origin: opts.origin, service: meetingRoom, bridge: tracked, canPrepare: guard });
  let cancel: () => void;
  const tick = () => {
    if (disposed) return;
    for (const m of jobs.values()) {
      const st = raw.status(m.callerKey, m.roomId);
      if (st.status === 200 && (st.body.status === "stopped" || st.body.status === "failed")) { jobs.delete(sk(m.callerKey, m.roomId)); continue; }
      if (st.status === 404) continue;
      if (st.body.status === "stop-unconfirmed") continue;
      if (st.body.status !== "listening") continue;
      if (m.inFlight) continue;
      m.inFlight = true;
      void raw.sample(m.callerKey, m.roomId).then((r: Reply) => {
        if (r.status === 200 && (r.body.status === "stopped" || r.body.status === "failed")) { if (jobs.get(sk(m.callerKey, m.roomId)) === m) jobs.delete(sk(m.callerKey, m.roomId)); }
      }).catch(() => { if (jobs.get(sk(m.callerKey, m.roomId)) === m) { try { raw.revoke(m.callerKey, m.roomId); } catch {} } }).finally(() => { m.inFlight = false; });
    }
  };
  if (opts.schedule !== undefined) cancel = opts.schedule(tick);
  else { const id = setInterval(tick, 500); id.unref(); cancel = () => clearInterval(id); }
  function dispose(): Promise<void> {
    if (disposeP !== null) return disposeP;
    disposed = true;
    try { cancel(); } catch {}
    const snapshot = [...jobs.values()];
    for (const m of snapshot) { try { raw.revoke(m.callerKey, m.roomId); } catch {} }
    disposeP = (async () => {
      const results = await Promise.all(snapshot.map(async (m) => {
        try {
          const r = await raw.stop(m.callerKey, m.roomId);
          return r.body.status === "stopped" || r.body.status === "failed";
        } catch { return false; }
      }));
      if (results.includes(false)) throw new Error("Worker cleanup unconfirmed");
    })();
    return disposeP;
  }
  const base = { meetingRoom, meetWorkerHttp, bridge: Object.freeze(tracked), dispose };
  return Object.freeze({
    ...base,
    ...(candidateApprovalApi !== undefined ? { candidateApprovalApi } : {}),
  });
}
