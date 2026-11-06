/**
 * Connector port for the T2 twin room (no core -> bot import).
 *
 * `@second-seat/bot` depends on `@second-seat/core`, and core's dependency
 * guard allows only relative or `node:` imports in core `src`. So the twin
 * room takes the connector as an injected factory, and
 * `services/bot/src/t2-room.ts` wires in the real frozen connector.
 */
import { sha256Hex } from "./sha256.js";

export type OwnerPrincipal = { readonly ownerId: string };

export type MeetingAction =
  | { type: "read" }
  | { type: "edit"; text: string }
  | { type: "approve" }
  | { type: "export" }
  | { type: "delete" };

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

export type MeetingConnectorPort = {
    protocol: "meeting-connector/1";
    outboundCount: () => number;
    createMeeting(principal: OwnerPrincipal | null, text: string): {
        meetingId: string;
    };
    act(principal: OwnerPrincipal | null, meetingId: string, action: MeetingAction, claimedOwnerId?: string): {
        text?: string;
    };
    openSession(principal: OwnerPrincipal | null, meetingId?: string): {
        generationId: string;
    };
    issueJob(principal: OwnerPrincipal | null, meetingId: string, generationId: string): IssuedJob;
    suspendGeneration(principal: OwnerPrincipal | null, generationId: string): void;
    takeover(principal: OwnerPrincipal | null, generationId: string): void;
    inbox(principal: OwnerPrincipal | null, generationId: string): string[];
    appendTranscript(principal: OwnerPrincipal | null, generationId: string, event: {
        meetingId: string;
        text: string;
    }): {
        appended: boolean;
    };
    transcript(principal: OwnerPrincipal | null, generationId: string): string[];
    resolveCallback(viewer: OwnerPrincipal | null, callback: StoredCallback): {
        delivered: boolean;
    };
    approvePackage(principal: OwnerPrincipal | null, jobId: string, suppliedHash: string): {
        approved: boolean;
    };
    exportApproved(principal: OwnerPrincipal | null, jobId: string): string;
    revoke(principal: OwnerPrincipal | null, meetingId: string): number;
    expire(principal: OwnerPrincipal | null, meetingId: string, at: number): void;
    authorityGeneration(principal: OwnerPrincipal | null, meetingId: string): number;
    approved(principal: OwnerPrincipal | null, meetingId: string): boolean;
    replay(principal: OwnerPrincipal | null, callback: StoredCallback, transport: (pkg: {
        jobId: string;
        packageHash: string;
        body: string;
    }) => Promise<void>): Promise<{
        ran: boolean;
    }>;
};

export type MeetingConnectorFactory = () => MeetingConnectorPort;

/** sha256 hex of the UTF-8 bytes of an exact package body. */
export function packageHash(body: string): string {
  return sha256Hex(body);
}
