/**
 * Owner-scoped meeting connector. Protocol meeting-connector/1.
 * Production provider dispatch stays disabled. Tests inject principals;
 * there is no public owner-id header.
 *
 * Jobs are authoritative server-issued records: `issueJob` binds a trusted
 * owner, meeting, session, source revision and authority generation under a
 * server-generated random-UUID jobId. `resolveCallback` honors only an
 * envelope that matches a pending issued job AND current state, and stores
 * the delivered artifact plus its server-computed package hash on the job
 * record. `approvePackage` binds an approval to that exact package hash
 * (never to a client-supplied digest or a bare revision number).
 * `replay(principal, ...)` sends only a consumed job with a current
 * exact-package approval, at most once.
 *
 * N2 decision (enforced): ONLY a consumed job with a current exact-package
 * approval may be sent. A pending (unresolved) job can never be sent or
 * approved. A consumed but unapproved job cannot be sent. Each approved job
 * is sent at most once: `replay` claims the job (`dispatched = true`)
 * synchronously before awaiting the async transport, so two concurrent
 * replays make exactly one transport call. A transport rejection moves the
 * job to a terminal failed state (never retried) and the outbound counter
 * advances only after the transport resolves.
 *
 * Source edits, revocation, deletion, expiry, session suspension and owner
 * takeover invalidate dependent pending AND consumed-but-unsent jobs
 * immediately (approvals cleared). Takeover additionally bars the session
 * from issuing, resolving, approving or sending further work.
 */
import { createHash, randomUUID } from "node:crypto";
export const MEETING_CONNECTOR_PROTOCOL = "meeting-connector/1" as const;

export class MeetingDenied extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`denied: ${operation}`);
    this.name = "MeetingDenied";
    this.operation = operation;
  }
}

/** sha256 hex of the UTF-8 bytes of an exact package body. */
export function packageHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export type OwnerPrincipal = { readonly ownerId: string };

export type MeetingAction =
  | { type: "read" }
  | { type: "edit"; text: string }
  | { type: "approve" }
  | { type: "export" }
  | { type: "delete" };

type Meeting = {
  id: string;
  ownerId: string;
  text: string;
  authorityGeneration: number;
  sourceRevision: number;
  revoked: boolean;
  expiresAt: number | null;
  approvedRevision: number | null;
};

type Session = {
  ownerId: string;
  generationId: string;
  suspended: boolean;
  takenOver: boolean;
  inbox: string[];
  transcriptLog: string[];
  boundMeetingId: string | null;
};

export type IssuedJob = {
  readonly jobId: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly generationId: string;
  readonly authorityGeneration: number;
  readonly sourceRevision: number;
};

export type StoredCallback = {
  readonly jobId?: string;
  readonly ownerId: string;
  readonly meetingId: string;
  readonly generationId: string;
  readonly authorityGeneration: number;
  readonly sourceRevision?: number;
  readonly artifact: string;
};

export type ProviderKind = "brain" | "capture" | "voice" | "avatar" | "email";

type JobStatus = "pending" | "consumed" | "invalidated" | "failed";

type JobRecord = {
  jobId: string;
  ownerId: string;
  meetingId: string;
  generationId: string;
  authorityGeneration: number;
  sourceRevision: number;
  status: JobStatus;
  dispatched: boolean;
  artifact: string | null;
  artifactHash: string | null;
  approvedHash: string | null;
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function bareHost(host: string): string {
  return host.startsWith("[") && host.endsWith("]") && host.length > 2 ? host.slice(1, -1) : host;
}

export function createMeetingConnector(opts?: { now?: () => number }) {
  const now = opts?.now ?? (() => Date.now());
  const meetings = new Map<string, Meeting>();
  const sessions = new Map<string, Session>();
  const jobs = new Map<string, JobRecord>();
  let outbound = 0;

  function requirePrincipal(principal: OwnerPrincipal | null | undefined): OwnerPrincipal {
    if (!principal || typeof principal.ownerId !== "string" || principal.ownerId.length === 0) {
      throw new MeetingDenied("missing-identity");
    }
    return principal;
  }

  function owned(principal: OwnerPrincipal, meetingId: string, operation: string): Meeting {
    const meeting = meetings.get(meetingId);
    if (!meeting || meeting.ownerId !== principal.ownerId) {
      throw new MeetingDenied(operation);
    }
    return meeting;
  }

  function ownedSession(principal: OwnerPrincipal, generationId: string, operation: string): Session {
    const session = sessions.get(generationId);
    if (!session || session.ownerId !== principal.ownerId) {
      throw new MeetingDenied(operation);
    }
    return session;
  }

  function policyOpen(meeting: Meeting): boolean {
    if (meeting.revoked) return false;
    if (meeting.expiresAt !== null && now() >= meeting.expiresAt) return false;
    return true;
  }

  function invalidateJobRecord(job: JobRecord): void {
    if (job.status === "pending" || (job.status === "consumed" && !job.dispatched)) {
      job.status = "invalidated";
    }
    job.approvedHash = null;
  }

  function invalidateMeetingJobs(meetingId: string): void {
    for (const job of jobs.values()) {
      if (job.meetingId === meetingId) {
        invalidateJobRecord(job);
      }
    }
  }

  function invalidateSessionJobs(generationId: string): void {
    for (const job of jobs.values()) {
      if (job.generationId === generationId) {
        invalidateJobRecord(job);
      }
    }
  }

  function bindSession(session: Session, meetingId: string, operation: string): void {
    if (session.boundMeetingId === null) {
      session.boundMeetingId = meetingId;
    } else if (session.boundMeetingId !== meetingId) {
      throw new MeetingDenied(operation);
    }
  }

  function envelopeMatches(callback: StoredCallback, record: JobRecord): boolean {
    return (
      callback.jobId === record.jobId &&
      callback.ownerId === record.ownerId &&
      callback.meetingId === record.meetingId &&
      callback.generationId === record.generationId &&
      callback.authorityGeneration === record.authorityGeneration &&
      callback.sourceRevision === record.sourceRevision
    );
  }

  function currentStateOk(record: JobRecord): boolean {
    const meeting = meetings.get(record.meetingId);
    const session = sessions.get(record.generationId);
    if (!meeting || meeting.ownerId !== record.ownerId || !policyOpen(meeting)) return false;
    if (
      meeting.authorityGeneration !== record.authorityGeneration ||
      meeting.sourceRevision !== record.sourceRevision
    ) {
      return false;
    }
    if (!session || session.ownerId !== record.ownerId || session.suspended || session.takenOver) {
      return false;
    }
    if (session.boundMeetingId !== null && session.boundMeetingId !== record.meetingId) return false;
    return true;
  }

  return {
    protocol: MEETING_CONNECTOR_PROTOCOL,
    outboundCount: () => outbound,
    createMeeting(principal: OwnerPrincipal | null, text: string): { meetingId: string } {
      const owner = requirePrincipal(principal);
      const id = randomUUID();
      meetings.set(id, {
        id,
        ownerId: owner.ownerId,
        text,
        authorityGeneration: 1,
        sourceRevision: 1,
        revoked: false,
        expiresAt: null,
        approvedRevision: null,
      });
      return { meetingId: id };
    },
    act(
      principal: OwnerPrincipal | null,
      meetingId: string,
      action: MeetingAction,
      claimedOwnerId?: string,
    ): { text?: string } {
      const owner = requirePrincipal(principal);
      void claimedOwnerId;
      const meeting = owned(owner, meetingId, action.type);
      if (action.type === "read" || action.type === "export") {
        if (!policyOpen(meeting)) throw new MeetingDenied(action.type);
        return { text: meeting.text };
      }
      if (action.type === "edit") {
        if (!policyOpen(meeting)) throw new MeetingDenied("edit");
        meeting.text = action.text;
        meeting.sourceRevision += 1;
        meeting.approvedRevision = null;
        invalidateMeetingJobs(meetingId);
        return {};
      }
      if (action.type === "approve") {
        if (!policyOpen(meeting)) throw new MeetingDenied("approve");
        meeting.approvedRevision = meeting.sourceRevision;
        return {};
      }
      invalidateMeetingJobs(meetingId);
      meetings.delete(meetingId);
      return {};
    },
    openSession(principal: OwnerPrincipal | null, meetingId?: string): { generationId: string } {
      const owner = requirePrincipal(principal);
      let boundMeetingId: string | null = null;
      if (meetingId !== undefined) {
        owned(owner, meetingId, "open-session");
        boundMeetingId = meetingId;
      }
      const generationId = randomUUID();
      sessions.set(generationId, {
        ownerId: owner.ownerId,
        generationId,
        suspended: false,
        takenOver: false,
        inbox: [],
        transcriptLog: [],
        boundMeetingId,
      });
      return { generationId };
    },
    issueJob(
      principal: OwnerPrincipal | null,
      meetingId: string,
      generationId: string,
    ): IssuedJob {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "issue");
      if (!policyOpen(meeting)) throw new MeetingDenied("issue");
      const session = ownedSession(owner, generationId, "issue");
      if (session.suspended || session.takenOver) throw new MeetingDenied("issue");
      bindSession(session, meetingId, "issue");
      const jobId = randomUUID();
      const record: JobRecord = {
        jobId,
        ownerId: owner.ownerId,
        meetingId,
        generationId,
        authorityGeneration: meeting.authorityGeneration,
        sourceRevision: meeting.sourceRevision,
        status: "pending",
        dispatched: false,
        artifact: null,
        artifactHash: null,
        approvedHash: null,
      };
      jobs.set(jobId, record);
      return {
        jobId,
        ownerId: owner.ownerId,
        meetingId,
        generationId,
        authorityGeneration: meeting.authorityGeneration,
        sourceRevision: meeting.sourceRevision,
      };
    },
    suspendGeneration(principal: OwnerPrincipal | null, generationId: string): void {
      const owner = requirePrincipal(principal);
      const session = ownedSession(owner, generationId, "suspend");
      session.suspended = true;
      invalidateSessionJobs(generationId);
    },
    takeover(principal: OwnerPrincipal | null, generationId: string): void {
      const owner = requirePrincipal(principal);
      const session = ownedSession(owner, generationId, "takeover");
      session.takenOver = true;
      invalidateSessionJobs(generationId);
    },
    inbox(principal: OwnerPrincipal | null, generationId: string): string[] {
      const owner = requirePrincipal(principal);
      const session = sessions.get(generationId);
      if (!session || session.ownerId !== owner.ownerId) return [];
      return [...session.inbox];
    },
    appendTranscript(
      principal: OwnerPrincipal | null,
      generationId: string,
      event: { meetingId: string; text: string },
    ): { appended: boolean } {
      const owner = requirePrincipal(principal);
      const session = sessions.get(generationId);
      if (!session || session.ownerId !== owner.ownerId) return { appended: false };
      if (session.suspended || session.takenOver) return { appended: false };
      if (!event || typeof event.meetingId !== "string" || typeof event.text !== "string") {
        return { appended: false };
      }
      const meeting = meetings.get(event.meetingId);
      if (!meeting || meeting.ownerId !== owner.ownerId) return { appended: false };
      if (!policyOpen(meeting)) return { appended: false };
      if (session.boundMeetingId === null) {
        session.boundMeetingId = event.meetingId;
      } else if (session.boundMeetingId !== event.meetingId) {
        return { appended: false };
      }
      session.transcriptLog.push(event.text);
      return { appended: true };
    },
    transcript(principal: OwnerPrincipal | null, generationId: string): string[] {
      const owner = requirePrincipal(principal);
      const session = sessions.get(generationId);
      if (!session || session.ownerId !== owner.ownerId) return [];
      return [...session.transcriptLog];
    },
    resolveCallback(viewer: OwnerPrincipal | null, callback: StoredCallback): { delivered: boolean } {
      const who = requirePrincipal(viewer);
      const before = outbound;
      const fail = (): { delivered: boolean } => {
        if (outbound !== before) throw new Error("outbound changed on a rejected callback");
        return { delivered: false };
      };
      if (!callback || typeof callback.jobId !== "string") return fail();
      const record = jobs.get(callback.jobId);
      if (!record || record.status !== "pending") return fail();
      if (who.ownerId !== record.ownerId) return fail();
      if (!envelopeMatches(callback, record)) return fail();
      if (!currentStateOk(record)) return fail();
      if (typeof callback.artifact !== "string") return fail();
      const session = sessions.get(record.generationId);
      if (!session) return fail();
      session.inbox.push(callback.artifact);
      record.artifact = callback.artifact;
      record.artifactHash = packageHash(callback.artifact);
      record.status = "consumed";
      return { delivered: true };
    },
    approvePackage(
      principal: OwnerPrincipal | null,
      jobId: string,
      suppliedHash: string,
    ): { approved: boolean } {
      const who = requirePrincipal(principal);
      const record = jobs.get(jobId);
      if (!record) return { approved: false };
      // Single B5 gate: the owner approves the server-computed hash of the
      // delivered package on a consumed job in current state. Deleting this
      // gate approves pending jobs, other owners, or foreign digests.
      const acceptable =
        who.ownerId === record.ownerId &&
        record.status === "consumed" &&
        currentStateOk(record) &&
        typeof suppliedHash === "string" &&
        suppliedHash === record.artifactHash;
      if (!acceptable) return { approved: false };
      record.approvedHash = suppliedHash;
      return { approved: true };
    },
    exportApproved(principal: OwnerPrincipal | null, jobId: string): string {
      const deny = (): never => {
        throw new MeetingDenied("export-approved");
      };
      if (!principal || typeof principal.ownerId !== "string" || principal.ownerId.length === 0) {
        deny();
      }
      const record = jobs.get(jobId);
      if (!record) deny();
      const owned = principal as OwnerPrincipal;
      if (owned.ownerId !== (record as JobRecord).ownerId) deny();
      const job = record as JobRecord;
      if (job.status !== "consumed") deny();
      if (!job.artifact || !job.artifactHash || !job.approvedHash) deny();
      if (job.approvedHash !== job.artifactHash) deny();
      if (!currentStateOk(job)) deny();
      return job.artifact as string;
    },
    revoke(principal: OwnerPrincipal | null, meetingId: string): number {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "revoke");
      meeting.authorityGeneration += 1;
      meeting.revoked = true;
      meeting.approvedRevision = null;
      invalidateMeetingJobs(meetingId);
      return meeting.authorityGeneration;
    },
    expire(principal: OwnerPrincipal | null, meetingId: string, at: number): void {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "expire");
      meeting.expiresAt = at;
      meeting.approvedRevision = null;
      invalidateMeetingJobs(meetingId);
    },
    authorityGeneration(principal: OwnerPrincipal | null, meetingId: string): number {
      const owner = requirePrincipal(principal);
      return owned(owner, meetingId, "read").authorityGeneration;
    },
    approved(principal: OwnerPrincipal | null, meetingId: string): boolean {
      const owner = requirePrincipal(principal);
      const meeting = owned(owner, meetingId, "read");
      return meeting.approvedRevision === meeting.sourceRevision && policyOpen(meeting);
    },
    async replay(
      principal: OwnerPrincipal | null,
      callback: StoredCallback,
      transport: (pkg: { jobId: string; packageHash: string; body: string }) => Promise<void>,
    ): Promise<{ ran: boolean }> {
      const who = requirePrincipal(principal);
      if (!callback || typeof callback.jobId !== "string") return { ran: false };
      const record = jobs.get(callback.jobId);
      if (!record) return { ran: false };
      if (typeof callback.artifact !== "string") return { ran: false };
      // Single N2 gate: only a consumed job with a current exact-package
      // approval sends, at most once. Deleting this statement sends
      // unapproved or substituted packages. (The null checks also narrow
      // the stored body/hash for the send below.)
      const sendable =
        record.status === "consumed" &&
        !record.dispatched &&
        who.ownerId === record.ownerId &&
        record.approvedHash !== null &&
        record.artifactHash !== null &&
        record.approvedHash === record.artifactHash &&
        packageHash(callback.artifact) === record.approvedHash;
      if (!sendable || record.approvedHash === null || record.artifact === null) {
        return { ran: false };
      }
      if (!envelopeMatches(callback, record)) return { ran: false };
      if (!currentStateOk(record)) return { ran: false };
      record.dispatched = true;
      const pkg = {
        jobId: record.jobId,
        packageHash: record.approvedHash,
        body: record.artifact,
      };
      try {
        await transport(pkg);
      } catch (err) {
        record.status = "failed";
        throw err;
      }
      outbound += 1;
      return { ran: true };
    },
  };
}

export function callProvider(
  kind: ProviderKind,
  target: string | { inProcess: true },
  transport: (url: string) => void,
): "fake" | "loopback" {
  if (typeof target !== "string") {
    if (!target || (target as { inProcess?: unknown }).inProcess !== true) {
      throw new MeetingDenied(`${kind}-bad-target`);
    }
    transport("in-process");
    return "fake";
  }
  let host = "";
  try {
    const url = new URL(target);
    if (url.protocol !== "http:") {
      throw new MeetingDenied(`${kind}-unsupported-scheme`);
    }
    host = bareHost(url.hostname);
  } catch (err) {
    if (err instanceof MeetingDenied) throw err;
    throw new MeetingDenied(`${kind}-bad-url`);
  }
  if (!LOOPBACK.has(host)) {
    throw new MeetingDenied(`${kind}-non-loopback`);
  }
  transport(target);
  return "loopback";
}

/** Production send stays off until a reviewed policy path exists. */
export function productionDispatch(): never {
  throw new MeetingDenied("production-dispatch-disabled");
}
