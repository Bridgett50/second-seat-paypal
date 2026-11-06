/**
 * Pure draft-approval state for the #draft section.
 *
 * Approval records the hash of the exact draft text plus the run and
 * meeting it belongs to. Any edit, rejection, or meeting change clears
 * approval, so Copy is only enabled for the text a person actually
 * approved. Approval never requires pressure flags by itself; the page
 * enables Approve only after each pressure flag is checked when flags
 * exist (zero flags means Approve is available immediately).
 */

export interface DraftApproval {
  draftHash: string;
  runId: string;
  meetingId: string;
}

export interface DraftState {
  meetingId: string;
  runId: string;
  draft: string;
  approval: DraftApproval | null;
}

/** Small deterministic string hash (FNV-1a 32-bit, hex). */
export function hashDraft(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function createDraftState(
  meetingId: string,
  runId: string,
  draft: string,
): DraftState {
  return { meetingId, runId, draft, approval: null };
}

/** Typing a new draft text clears approval. */
export function edit(state: DraftState, text: string): DraftState {
  return { ...state, draft: text, approval: null };
}

/** Rejecting clears approval; the draft text stays for reference. */
export function reject(state: DraftState): DraftState {
  return { ...state, approval: null };
}

/** Switching meetings clears approval and replaces the draft. */
export function changeMeeting(
  state: DraftState,
  meetingId: string,
  runId: string,
  draft: string,
): DraftState {
  void state;
  return { meetingId, runId, draft, approval: null };
}

/** Record approval for the current draft text, run, and meeting. */
export function approve(state: DraftState): DraftState {
  return {
    ...state,
    approval: {
      draftHash: hashDraft(state.draft),
      runId: state.runId,
      meetingId: state.meetingId,
    },
  };
}

/** True only when approval matches the current draft, run, and meeting. */
export function isApproved(state: DraftState): boolean {
  const approval = state.approval;
  if (approval === null) return false;
  return (
    approval.draftHash === hashDraft(state.draft) &&
    approval.runId === state.runId &&
    approval.meetingId === state.meetingId
  );
}

/** The exact draft text when approved, otherwise null. */
export function copyText(state: DraftState): string | null {
  return isApproved(state) ? state.draft : null;
}
