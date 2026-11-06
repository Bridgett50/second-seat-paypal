/**
 * Accessibility contract for the twin meeting room and demo mode (T17,
 * local only, unit-testable).
 *
 * This module is the single source of truth for the meeting room UI's
 * accessibility surface. The repo has no DOM, browser, or screen-reader
 * tooling and dependencies are frozen, so the whole contract is expressed
 * here in plain data plus a headless keyboard driver, and the web UI
 * (`meeting-room.tsx`) renders from these labels in this DOM order:
 *
 * - an ordered list of interactive controls (stable id, role, accessible
 *   label, region, availability) defining the keyboard focus order;
 * - a WCAG 2.x contrast helper plus the room's colour palette;
 * - polite live-region announcements for state changes;
 * - `runKeyboardFlow`, which drives a real room through Tab/Shift+Tab and
 *   Enter/Space only, so the full flow is provable without pointer input.
 *
 * Made-up data only; no network, no real email, no backend.
 */

import { createDemoController } from "./demo-mode.js";
import type { EmailComparison } from "./email-compare.js";
import type { TwinRoom, TwinRoomView } from "./twin-room.js";

/** Landmark region of one control, in keyboard focus order (top to bottom). */
export type A11yRegion =
  | "meeting"
  | "demo"
  | "stream"
  | "guidance"
  | "takeover"
  | "package"
  | "plugins"
  | "approval"
  | "evidence";

/** Documented focus order of regions, top to bottom of the room. */
export const A11Y_REGION_ORDER: readonly A11yRegion[] = [
  "meeting",
  "demo",
  "stream",
  "guidance",
  "takeover",
  "package",
  "plugins",
  "approval",
  "evidence",
];

/** One interactive control of the meeting room UI. */
export interface A11yControl {
  /** Stable id; also the keyboard driver's activation key. */
  readonly id: string;
  /** ARIA role used (or implied) by the rendered element. */
  readonly role: "button" | "textbox" | "listbox";
  /** Non-empty accessible name (aria-label or visible label text). */
  readonly label: string;
  /** Region this control belongs to (defines focus order). */
  readonly region: A11yRegion;
}

/** Accessible labels for every fixed (non-plugin) control, by control id. */
export const A11Y_LABELS = {
  "meeting-picker": "Choose meeting",
  "demo-next": "Next guided demo step",
  "demo-restart": "Restart guided demo",
  "stream-next": "Stream next transcript line",
  "guidance-input": "Guide the twin (private guidance)",
  "guidance-send": "Send guidance to the twin",
  takeover: "Take over from the twin",
  resume: "Resume the twin",
  "package-editor": "Edit draft follow-up package",
  "package-save": "Save draft edit",
  "run-plugins": "Run plugins on the transcript so far",
  approve: "Approve exact package",
  send: "Send through the test fake transport",
  "compare-input": "Paste imported draft for comparison",
  "compare-file": "Upload local draft file for comparison",
  "compare-run": "Compare imported draft",
  "evidence-export": "Export evidence JSON",
} as const;

export type A11yStaticControlId = keyof typeof A11Y_LABELS;

/** Fixed controls in focus order (plugin controls slot into `plugins`). */
export const A11Y_CONTROLS: readonly A11yControl[] = [
  { id: "meeting-picker", role: "listbox", label: A11Y_LABELS["meeting-picker"], region: "meeting" },
  { id: "demo-next", role: "button", label: A11Y_LABELS["demo-next"], region: "demo" },
  { id: "demo-restart", role: "button", label: A11Y_LABELS["demo-restart"], region: "demo" },
  { id: "stream-next", role: "button", label: A11Y_LABELS["stream-next"], region: "stream" },
  { id: "guidance-input", role: "textbox", label: A11Y_LABELS["guidance-input"], region: "guidance" },
  { id: "guidance-send", role: "button", label: A11Y_LABELS["guidance-send"], region: "guidance" },
  { id: "takeover", role: "button", label: A11Y_LABELS.takeover, region: "takeover" },
  { id: "resume", role: "button", label: A11Y_LABELS.resume, region: "takeover" },
  { id: "package-editor", role: "textbox", label: A11Y_LABELS["package-editor"], region: "package" },
  { id: "package-save", role: "button", label: A11Y_LABELS["package-save"], region: "package" },
  { id: "run-plugins", role: "button", label: A11Y_LABELS["run-plugins"], region: "plugins" },
  { id: "approve", role: "button", label: A11Y_LABELS.approve, region: "approval" },
  { id: "send", role: "button", label: A11Y_LABELS.send, region: "approval" },
  { id: "compare-input", role: "textbox", label: A11Y_LABELS["compare-input"], region: "evidence" },
  // A native file input exposes a button-like control; picking a file needs
  // the OS dialog, so the keyboard driver activates it as a no-op.
  { id: "compare-file", role: "button", label: A11Y_LABELS["compare-file"], region: "evidence" },
  { id: "compare-run", role: "button", label: A11Y_LABELS["compare-run"], region: "evidence" },
  { id: "evidence-export", role: "button", label: A11Y_LABELS["evidence-export"], region: "evidence" },
];

export type PluginControlAction = "include" | "exclude" | "refresh";

/** Stable control id for a per-plugin toggle/refresh button. */
export function pluginControlId(action: PluginControlAction, pluginId: string): string {
  return `plugin-${action}-${pluginId}`;
}

/** Accessible label for a per-plugin toggle/refresh button. */
export function pluginControlLabel(action: PluginControlAction, pluginId: string): string {
  if (action === "include") return `Include plugin output ${pluginId}`;
  if (action === "exclude") return `Exclude plugin output ${pluginId}`;
  return `Refresh plugin snapshot ${pluginId}`;
}

function pluginControlsFor(view: TwinRoomView): A11yControl[] {
  const out: A11yControl[] = [];
  for (const plugin of view.plugins) {
    if (plugin.status !== "approved") {
      out.push({
        id: pluginControlId("include", plugin.id),
        role: "button",
        label: pluginControlLabel("include", plugin.id),
        region: "plugins",
      });
    }
    if (plugin.status !== "rejected") {
      out.push({
        id: pluginControlId("exclude", plugin.id),
        role: "button",
        label: pluginControlLabel("exclude", plugin.id),
        region: "plugins",
      });
    }
    if (plugin.status === "approved" && plugin.stale) {
      out.push({
        id: pluginControlId("refresh", plugin.id),
        role: "button",
        label: pluginControlLabel("refresh", plugin.id),
        region: "plugins",
      });
    }
  }
  return out;
}

export interface AvailableControlsOptions {
  /** Demo controls appear only when the room is opened with `?demo=1`. */
  readonly demoMode?: boolean;
}

/**
 * Focus order for the current room state: the documented region order with
 * unavailable actions removed. Send is hidden until the package is approved,
 * compare is available while the twin is active and the draft is unsent,
 * Resume appears only while paused, demo controls appear only in
 * demo mode, and plugin toggles appear only while plugins may run.
 */
export function availableControls(
  view: TwinRoomView,
  opts?: AvailableControlsOptions,
): A11yControl[] {
  const demoMode = opts?.demoMode ?? false;
  const active = view.twinStatus === "active";
  const sendState = view.draft.sendState;
  const approved = view.draft.approved;
  const pluginsRunnable = active && sendState === "unsent";
  // Mirrors the room's own refusals: approve() refuses while paused and
  // once the send state leaves unsent/failed; send() needs an approved,
  // unsent package on a live twin; compareVisible() is available while
  // active and unsent (using the visible package before approval).
  const canApprove = active && !approved && (sendState === "unsent" || sendState === "failed");
  const canSend = active && approved && sendState === "unsent";
  const canCompare = active && sendState === "unsent";
  const hasEvidence = approved || sendState !== "unsent";
  const pluginControls = pluginsRunnable ? pluginControlsFor(view) : [];

  const order: A11yControl[] = [];
  for (const control of A11Y_CONTROLS) {
    switch (control.id) {
      case "demo-next":
      case "demo-restart":
        if (demoMode) order.push(control);
        break;
      case "stream-next":
      case "guidance-input":
      case "guidance-send":
      case "takeover":
        if (active) order.push(control);
        break;
      case "resume":
        if (!active) order.push(control);
        break;
      case "package-editor":
      case "package-save":
        // A sent package is locked: editing is refused, so hide the editor.
        if (sendState !== "sent") order.push(control);
        break;
      case "run-plugins":
        if (pluginsRunnable) order.push(control);
        break;
      case "approve":
        if (canApprove) order.push(control);
        break;
      case "send":
        if (canSend) order.push(control);
        break;
      case "compare-input":
      case "compare-file":
      case "compare-run":
        if (canCompare) order.push(control);
        break;
      case "evidence-export":
        if (hasEvidence) order.push(control);
        break;
      default:
        order.push(control);
    }
  }
  // Splice the per-plugin toggles into the plugins region slot (after the
  // package editor, before approval), in room display order.
  const insertAt = order.findIndex((c) => c.region === "approval");
  const at = insertAt >= 0 ? insertAt : order.length;
  return [...order.slice(0, at), ...pluginControls, ...order.slice(at)];
}

/** One text/background pair of the meeting room palette. */
export interface A11yTextPair {
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
}

/** Text pairs used by the meeting room. Every pair must meet 4.5:1. */
export const A11Y_TEXT_PAIRS: readonly A11yTextPair[] = [
  { name: "body text", fg: "#111111", bg: "#ffffff" },
  { name: "muted text", fg: "#595959", bg: "#ffffff" },
  { name: "button text", fg: "#ffffff", bg: "#1d4ed8" },
  { name: "success badge", fg: "#14532d", bg: "#dcfce7" },
  { name: "warning badge", fg: "#713f12", bg: "#fef3c7" },
];

/** Visible keyboard focus ring. Must meet 3:1 against its background. */
export const A11Y_FOCUS_RING = {
  name: "focus ring",
  color: "#1d4ed8",
  background: "#ffffff",
} as const;

export const A11Y_PALETTE = {
  textPairs: A11Y_TEXT_PAIRS,
  focusRing: A11Y_FOCUS_RING,
} as const;

function parseHexColor(color: string): [number, number, number] {
  const hex = color.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/u.exec(hex);
  if (short?.[1] !== undefined) {
    const [r, g, b] = short[1].split("");
    return [
      Number.parseInt(`${r}${r}`, 16),
      Number.parseInt(`${g}${g}`, 16),
      Number.parseInt(`${b}${b}`, 16),
    ];
  }
  const full = /^#([0-9a-f]{6})$/u.exec(hex);
  if (full?.[1] !== undefined) {
    return [
      Number.parseInt(full[1].slice(0, 2), 16),
      Number.parseInt(full[1].slice(2, 4), 16),
      Number.parseInt(full[1].slice(4, 6), 16),
    ];
  }
  throw new Error(`unsupported color (expected #rgb or #rrggbb): ${color}`);
}

function linearChannel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const [r, g, b] = parseHexColor(color);
  return (
    0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b)
  );
}

/**
 * WCAG 2.x contrast ratio of two hex colors (`#rgb`/`#rrggbb`), from 1
 * (identical) to 21 (black on white). Text pairs need at least 4.5:1;
 * the focus indicator needs at least 3:1 against its background.
 */
export function contrastRatio(fg: string, bg: string): number {
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Politeness of the room's live region: state changes never interrupt. */
export const A11Y_LIVE_POLITENESS = "polite" as const;

/** Props shared by every live-region element in the room UI. */
export const A11Y_LIVE_REGION = {
  role: "status",
  ariaLive: A11Y_LIVE_POLITENESS,
} as const;

/** A guided demo step that just completed, for announcements. */
export interface A11yDemoStep {
  readonly label: string;
  readonly caption: string;
}

/** Polite announcement for a guided demo step change. */
export function demoStepAnnouncement(step: A11yDemoStep): string {
  const caption = step.caption.endsWith(".") ? step.caption : `${step.caption}.`;
  return `Guided demo — ${step.label}: ${caption}`;
}

export interface DiffAnnouncementsOptions {
  /** Reason from the send call that produced `next` (failed/cancelled). */
  readonly sendReason?: string | undefined;
  /** Demo step that just completed, if any. */
  readonly demoStep?: A11yDemoStep | null;
}

/**
 * Polite live-region announcements for the change from `prev` to `next`:
 * new transcript lines, meeting switches, recorded guidance, takeover,
 * approval (or approval cleared), send results, and demo step changes.
 * Returns no messages when nothing worth announcing changed.
 */
export function diffAnnouncements(
  prev: TwinRoomView,
  next: TwinRoomView,
  opts?: DiffAnnouncementsOptions,
): string[] {
  const out: string[] = [];
  if (next.selectedMeetingId !== prev.selectedMeetingId) {
    out.push(`Switched to meeting ${next.selectedMeetingTitle}.`);
  }
  if (next.transcript.length > prev.transcript.length) {
    for (let i = prev.transcript.length; i < next.transcript.length; i += 1) {
      const line = next.transcript[i] ?? "";
      out.push(`New transcript line: ${line}`);
    }
  }
  if (next.guidance.length > prev.guidance.length) {
    out.push("Guidance recorded. It stays private to you.");
  }
  if (prev.twinStatus !== next.twinStatus && next.twinStatus !== "active") {
    out.push("You took over. The twin is paused.");
  }
  if (prev.twinStatus !== next.twinStatus && next.twinStatus === "active") {
    out.push("You resumed. The twin is active again.");
  }
  if (next.refusal !== null && next.refusal !== prev.refusal) {
    out.push(next.refusal);
  }
  if (!prev.draft.approved && next.draft.approved) {
    out.push(`Package approved. SHA-256 ${next.draft.sha256}.`);
  }
  if (prev.draft.approved && !next.draft.approved) {
    out.push("Approval cleared. Review the package and approve again.");
  }
  if (next.draft.sendState !== prev.draft.sendState) {
    const reason = opts?.sendReason;
    switch (next.draft.sendState) {
      case "sent":
        out.push("Package sent through the test fake transport.");
        break;
      case "failed":
        out.push(`Send failed.${reason !== undefined ? ` ${reason}` : ""}`);
        break;
      case "cancelled":
        out.push("Send cancelled by takeover before the transport finished. It will not be retried.");
        break;
      case "unconfirmed":
        out.push("Send unconfirmed. Check your outbox before retrying.");
        break;
      case "unsent":
        break;
    }
  }
  if (opts?.demoStep !== undefined && opts.demoStep !== null) {
    out.push(demoStepAnnouncement(opts.demoStep));
  }
  return out;
}

export type KeyboardFlowKey =
  | "Tab"
  | "Shift+Tab"
  | "Enter"
  | " "
  | { readonly key: "type"; readonly text: string };

export interface KeyboardFlowOptions {
  readonly demoMode?: boolean;
}

export interface KeyboardFlowResult {
  /** Control ids that received focus, in order (first entry is initial focus). */
  readonly visited: string[];
  /** Control ids activated with Enter/Space, in order. */
  readonly activated: string[];
  /** Polite live-region announcements produced along the way. */
  readonly announcements: string[];
  /** Most recent comparison run, or null when none ran (or none applied). */
  readonly comparison: EmailComparison | null;
  /** Most recent evidence export, or null when never exported. */
  readonly evidenceJson: string | null;
  /** Every send outcome in order. */
  readonly sendResults: ReadonlyArray<{ readonly ok: boolean; readonly reason?: string | undefined }>;
  /** Demo step ids completed in order. */
  readonly demoCompleted: string[];
}

function pluginActionFromId(id: string): { action: PluginControlAction; pluginId: string } | null {
  for (const action of ["include", "exclude", "refresh"] as const) {
    const prefix = `plugin-${action}-`;
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return { action, pluginId: id.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Drive a real room keyboard-only: `Tab`/`Shift+Tab` move focus through
 * `availableControls`, `Enter`/`Space` activate the focused control, and
 * `{ key: "type", text }` types into the focused textbox (guidance input,
 * package editor, compare input). No pointer input: every state change goes
 * through a control id in focus order, exactly as a keyboard user would.
 */
export async function runKeyboardFlow(
  room: TwinRoom,
  keys: readonly KeyboardFlowKey[],
  opts?: KeyboardFlowOptions,
): Promise<KeyboardFlowResult> {
  const demoMode = opts?.demoMode ?? false;
  const visited: string[] = [];
  const activated: string[] = [];
  const announcements: string[] = [];
  const sendResults: Array<{ ok: boolean; reason?: string | undefined }> = [];
  const demoCompleted: string[] = [];
  let comparison: EmailComparison | null = null;
  let evidenceJson: string | null = null;

  let controls = availableControls(room.view(), { demoMode });
  let focus = 0;
  if (controls[0] !== undefined) visited.push(controls[0].id);
  const buffers = new Map<string, string>();
  buffers.set("package-editor", room.view().draft.body);
  const demo = createDemoController(room);

  async function activate(id: string): Promise<void> {
    const prev = room.view();
    let sendReason: string | undefined;
    let demoStep: A11yDemoStep | null = null;
    const bufferOf = (controlId: string): string => buffers.get(controlId) ?? "";

    if (id === "meeting-picker") {
      const meetings = prev.meetings;
      if (meetings.length > 1) {
        const current = meetings.findIndex((m) => m.id === prev.selectedMeetingId);
        const next = meetings[(current + 1) % meetings.length];
        if (next !== undefined && next.id !== prev.selectedMeetingId) {
          room.selectMeeting(next.id);
        }
      }
    } else if (id === "demo-next") {
      const step = await demo.next();
      if (step !== null) {
        demoCompleted.push(step.id);
        demoStep = { label: step.label, caption: step.caption };
      }
    } else if (id === "demo-restart") {
      demo.reset();
    } else if (id === "stream-next") {
      room.streamNextLine();
    } else if (id === "run-plugins") {
      room.runPlugins();
    } else if (id === "guidance-input" || id === "guidance-send") {
      const text = bufferOf("guidance-input");
      if (text.trim().length > 0) room.guide(text);
    } else if (id === "takeover") {
      room.takeOver();
    } else if (id === "resume") {
      room.resume();
    } else if (id === "package-editor" || id === "package-save") {
      const text = bufferOf("package-editor");
      if (text.length > 0 && text !== prev.draft.body) room.editDraft(text);
    } else if (id === "approve") {
      room.approve();
    } else if (id === "send") {
      const res = await room.send();
      sendResults.push(res.ok ? { ok: true } : { ok: false, reason: res.reason });
      sendReason = res.reason;
    } else if (id === "compare-input" || id === "compare-run") {
      const text = bufferOf("compare-input");
      if (text.length > 0) {
        const visible = room.compareVisible(text);
        comparison = visible === null ? null : visible.comparison;
      }
    } else if (id === "evidence-export") {
      const json = room.exportEvidenceJson();
      if (json !== null) evidenceJson = json;
    } else {
      const plugin = pluginActionFromId(id);
      if (plugin !== null) {
        if (plugin.action === "include") room.approvePluginOutput(plugin.pluginId);
        else if (plugin.action === "exclude") room.rejectPluginOutput(plugin.pluginId);
        else room.refreshPluginOutput(plugin.pluginId);
      }
    }

    activated.push(id);
    const next = room.view();
    announcements.push(...diffAnnouncements(prev, next, { sendReason, demoStep }));
    controls = availableControls(next, { demoMode });
    const same = controls.findIndex((c) => c.id === id);
    focus = same >= 0 ? same : Math.min(focus, Math.max(controls.length - 1, 0));
  }

  for (const key of keys) {
    if (controls.length === 0) break;
    if (typeof key === "string") {
      if (key === "Tab") {
        focus = Math.min(focus + 1, controls.length - 1);
        const current = controls[focus];
        if (current !== undefined) visited.push(current.id);
      } else if (key === "Shift+Tab") {
        focus = Math.max(focus - 1, 0);
        const current = controls[focus];
        if (current !== undefined) visited.push(current.id);
      } else if (key === "Enter" || key === " ") {
        const current = controls[focus];
        if (current !== undefined) await activate(current.id);
      }
    } else if (key.key === "type") {
      const current = controls[focus];
      if (current !== undefined && current.role === "textbox") {
        buffers.set(current.id, `${buffers.get(current.id) ?? ""}${key.text}`);
      }
    }
  }

  return {
    visited,
    activated,
    announcements,
    comparison,
    evidenceJson,
    sendResults,
    demoCompleted,
  };
}
