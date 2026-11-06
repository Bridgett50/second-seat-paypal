export type MeetAdmissionTransport = {
  join: (meetingUrl: string, displayName: string, signal: AbortSignal) => Promise<boolean>;
  leave: () => Promise<void>;
};

type Phase = "idle" | "joining" | "admitted" | "failed" | "stopping" | "stopped" | "stop-unconfirmed";

export function createMeetAdmissionProof(
  opts: { ownerId: string; meetingUrl: string; displayName: string },
  transport: MeetAdmissionTransport,
) {
  const capturedOpts = Object.freeze({ ownerId: opts.ownerId, meetingUrl: opts.meetingUrl, displayName: opts.displayName });
  validate(capturedOpts);
  let phase: Phase = "idle";
  const controller = new AbortController();
  let started = false;
  let leavePromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  function ensureLeave(): Promise<void> {
    if (leavePromise === undefined) {
      leavePromise = Promise.resolve().then(() => transport.leave());
      leavePromise.catch(() => {});
    }
    return leavePromise;
  }

  async function join(): Promise<boolean> {
    if (phase === "stopping" || phase === "stopped" || phase === "stop-unconfirmed") return false;
    if (started) return false;
    started = true;
    phase = "joining";
    try {
      const ok = await transport.join(capturedOpts.meetingUrl, capturedOpts.displayName, controller.signal);
      if (controller.signal.aborted) return false;
      if (ok) {
        phase = "admitted";
        return true;
      }
      phase = "failed";
      try { await ensureLeave(); } catch {}
      return false;
    } catch {
      if (controller.signal.aborted) return false;
      phase = "failed";
      try { await ensureLeave(); } catch {}
      return false;
    }
  }

  async function stop(): Promise<void> {
    if (phase === "stopped") return stopPromise ?? ensureLeave().then(() => { phase = "stopped"; }, () => { phase = "stop-unconfirmed"; throw new Error("Meet proof cleanup unconfirmed"); });
    if (phase === "stop-unconfirmed") return stopPromise!;
    if (phase === "stopping") return stopPromise!;
    phase = "stopping";
    controller.abort();
    const base = ensureLeave();
    stopPromise = base.then(
      () => { phase = "stopped"; },
      () => { phase = "stop-unconfirmed"; throw new Error("Meet proof cleanup unconfirmed"); },
    );
    stopPromise.catch(() => {});
    return stopPromise;
  }

  function getPhase(): Phase {
    return phase;
  }

  return Object.freeze({ join, stop, phase: getPhase });
}

function validate(o: { ownerId: string; meetingUrl: string; displayName: string }): void {
  const err = new Error("Invalid supervised Meet proof configuration");
  const hasCtrl = (s: string): boolean => /[\x00-\x1F\x7F]/.test(s);
  if (!o.ownerId || o.ownerId.trim().length === 0 || o.ownerId.length > 200 || hasCtrl(o.ownerId)) throw err;
  if (o.ownerId === "owner_demo" || o.ownerId === "default") throw err;
  if (!o.displayName || o.displayName.trim().length === 0 || o.displayName.length > 80 || hasCtrl(o.displayName)) throw err;
  if (!o.displayName.toLowerCase().includes("ai twin")) throw err;
  if (!/\btest\b/i.test(o.displayName)) throw err;
  const urlRe = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
  if (!urlRe.test(o.meetingUrl)) throw err;
}
