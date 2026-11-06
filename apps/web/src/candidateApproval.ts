import { randomBytes, createHash } from "node:crypto";
import type { CandidateBinding } from "./candidateReasoner.js";
import type { PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";

export const CANDIDATE_APPROVAL_TTL_MS = 120_000;
export const CANDIDATE_APPROVAL_MAX_TEXT = 8_000;
export const CANDIDATE_APPROVAL_MAX_PENDING = 200;

export type CandidateApprovalSnapshot = Readonly<{
  requestId: string;
  redactedText: string;
  version: number;
  previewHash: string;
  expiresAt: number;
  status: "pending";
}>;

export type CandidateApprovalDecision = Readonly<{
  requestId: string;
  version: number;
  previewHash: string;
}>;

type Entry = {
  binding: CandidateBinding;
  gate: PrivacyGate;
  runId: string;
  text: string;
  previewHash: string;
  version: number;
  requestId: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal;
  onAbort: () => void;
  resolve: (value: string | null) => void;
  settled: boolean;
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isValidBinding(binding: CandidateBinding): binding is CandidateBinding & { readonly epoch: number } {
  if (typeof binding.roomId !== "string" || binding.roomId.length === 0) return false;
  if (typeof binding.ownerId !== "string" || binding.ownerId.length === 0) return false;
  if (typeof binding.meetingId !== "string" || binding.meetingId.length === 0) return false;
  if (typeof binding.contextRevision !== "number" || !Number.isSafeInteger(binding.contextRevision) || binding.contextRevision < 0) return false;
  if (typeof binding.policyGeneration !== "number" || !Number.isSafeInteger(binding.policyGeneration) || binding.policyGeneration < 0) return false;
  if (typeof binding.epoch !== "number" || !Number.isSafeInteger(binding.epoch) || binding.epoch < 0) return false;
  return true;
}

function bindingEquals(a: CandidateBinding, b: CandidateBinding): boolean {
  return (
    a.roomId === b.roomId &&
    a.ownerId === b.ownerId &&
    a.meetingId === b.meetingId &&
    a.contextRevision === b.contextRevision &&
    a.policyGeneration === b.policyGeneration &&
    a.epoch === b.epoch
  );
}

export function createCandidateApprovalBroker(deps: {
  isCurrent: (binding: CandidateBinding) => boolean;
  now?: () => number;
  ttlMs?: number;
  maxTextLength?: number;
  maxPending?: number;
}): {
  request(args: { gate: PrivacyGate; runId: string; redactedPreview: string; binding: CandidateBinding; signal: AbortSignal }): Promise<string | null>;
  snapshot(binding: CandidateBinding): CandidateApprovalSnapshot | null;
  correct(binding: CandidateBinding, decision: CandidateApprovalDecision, editedText: string): CandidateApprovalSnapshot | null;
  approve(binding: CandidateBinding, decision: CandidateApprovalDecision): boolean;
  deny(binding: CandidateBinding, requestId: string): boolean;
  pendingCount(): number;
} {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? CANDIDATE_APPROVAL_TTL_MS;
  const maxTextLength = deps.maxTextLength ?? CANDIDATE_APPROVAL_MAX_TEXT;
  const maxPending = deps.maxPending ?? CANDIDATE_APPROVAL_MAX_PENDING;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(maxTextLength) || maxTextLength <= 0 || !Number.isSafeInteger(maxPending) || maxPending <= 0) throw new RangeError("invalid config");
  const entries = new Map<string, Entry>();
  let nextVersion = 1;

  function settleNull(entry: Entry): void {
    if (entry.settled) return;
    entry.settled = true;
    try {
      entry.gate.revoke(entry.runId);
    } catch {
    }
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.signal.removeEventListener("abort", entry.onAbort);
    entries.delete(entry.binding.roomId);
    entry.resolve(null);
  }

  return {
    request(args: { gate: PrivacyGate; runId: string; redactedPreview: string; binding: CandidateBinding; signal: AbortSignal }): Promise<string | null> {
      const { gate, runId, redactedPreview, binding, signal } = args;

      if (signal.aborted) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      if (!isValidBinding(binding)) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      if (!deps.isCurrent(binding)) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      let preview: string;
      try {
        preview = gate.preview(runId);
      } catch {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }
      if (preview !== redactedPreview) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      if (redactedPreview.length > maxTextLength) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      if (entries.has(binding.roomId)) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      if (entries.size >= maxPending) {
        try {
          gate.revoke(runId);
        } catch {
        }
        return Promise.resolve(null);
      }

      const frozenBinding = Object.freeze<CandidateBinding>({ roomId: binding.roomId, ownerId: binding.ownerId, meetingId: binding.meetingId, contextRevision: binding.contextRevision, policyGeneration: binding.policyGeneration, epoch: binding.epoch });
      const previewHash = sha256Hex(redactedPreview);
      const requestId = randomBytes(16).toString("hex");
      const version = nextVersion++;
      const expiresAt = now() + ttlMs;

      let resolve: (value: string | null) => void = () => {};
      const promise = new Promise<string | null>((res) => {
        resolve = res;
      });

      const entry: Entry = {
        binding: frozenBinding,
        gate,
        runId,
        text: redactedPreview,
        previewHash,
        version,
        requestId,
        expiresAt,
        timer: null,
        signal,
        onAbort: () => {},
        resolve,
        settled: false,
      };

      entry.onAbort = () => {
        settleNull(entry);
      };

      entry.timer = setTimeout(() => {
        settleNull(entry);
      }, ttlMs);

      signal.addEventListener("abort", entry.onAbort);

      entries.set(binding.roomId, entry);

      return promise;
    },

    snapshot(binding: CandidateBinding): CandidateApprovalSnapshot | null {
      const entry = entries.get(binding.roomId);
      if (entry === undefined) return null;
      if (!bindingEquals(binding, entry.binding)) return null;
      if (entry.signal.aborted || now() >= entry.expiresAt || !deps.isCurrent(entry.binding)) {
        settleNull(entry);
        return null;
      }
      return {
        requestId: entry.requestId,
        redactedText: entry.text,
        version: entry.version,
        previewHash: entry.previewHash,
        expiresAt: entry.expiresAt,
        status: "pending",
      };
    },

    correct(binding: CandidateBinding, decision: CandidateApprovalDecision, editedText: string): CandidateApprovalSnapshot | null {
      const entry = entries.get(binding.roomId);
      if (entry === undefined) return null;
      if (!bindingEquals(binding, entry.binding)) return null;
      if (decision.requestId !== entry.requestId) return null;
      if (decision.version !== entry.version) return null;
      if (decision.previewHash !== entry.previewHash) return null;
      if (editedText.trim().length === 0) return null;
      if (editedText.length > maxTextLength) return null;
      if (entry.signal.aborted || now() >= entry.expiresAt || !deps.isCurrent(entry.binding)) {
        settleNull(entry);
        return null;
      }
      let currentText: string;
      try {
        currentText = entry.gate.preview(entry.runId);
      } catch {
        settleNull(entry);
        return null;
      }
      if (currentText !== entry.text) {
        settleNull(entry);
        return null;
      }
      if (sha256Hex(currentText) !== entry.previewHash) {
        settleNull(entry);
        return null;
      }
      try {
        entry.gate.correct(entry.runId, editedText);
      } catch {
        settleNull(entry);
        return null;
      }
      entry.text = editedText;
      entry.previewHash = sha256Hex(editedText);
      entry.version = nextVersion++;
      return {
        requestId: entry.requestId,
        redactedText: entry.text,
        version: entry.version,
        previewHash: entry.previewHash,
        expiresAt: entry.expiresAt,
        status: "pending",
      };
    },

    approve(binding: CandidateBinding, decision: CandidateApprovalDecision): boolean {
      const entry = entries.get(binding.roomId);
      if (entry === undefined) return false;
      if (!bindingEquals(binding, entry.binding)) return false;
      if (decision.requestId !== entry.requestId) return false;
      if (decision.version !== entry.version) return false;
      if (decision.previewHash !== entry.previewHash) return false;

      if (entry.signal.aborted || now() >= entry.expiresAt) {
        settleNull(entry);
        return false;
      }

      if (!deps.isCurrent(entry.binding)) {
        settleNull(entry);
        return false;
      }

      let currentText: string;
      try {
        currentText = entry.gate.preview(entry.runId);
      } catch {
        settleNull(entry);
        return false;
      }
      if (currentText !== entry.text) {
        settleNull(entry);
        return false;
      }
      const currentHash = sha256Hex(currentText);
      if (currentHash !== entry.previewHash || currentHash !== decision.previewHash) {
        settleNull(entry);
        return false;
      }

      const token = entry.gate.approve(entry.runId, entry.text);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
      entry.signal.removeEventListener("abort", entry.onAbort);
      entries.delete(entry.binding.roomId);
      entry.settled = true;
      entry.resolve(token);
      return true;
    },

    deny(binding: CandidateBinding, requestId: string): boolean {
      const entry = entries.get(binding.roomId);
      if (entry === undefined) return false;
      if (!bindingEquals(binding, entry.binding)) return false;
      if (entry.requestId !== requestId) return false;
      settleNull(entry);
      return true;
    },

    pendingCount(): number {
      return entries.size;
    },
  };
}
