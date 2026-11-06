/**
 * Tiny synchronous, deterministic plugin interface (T12, local only).
 *
 * Plugins work ONLY from the scripted meeting data handed to them in
 * `MeetingContext` (the selected meeting's title, script, streamed
 * transcript, and owner notes). No network, no real calendar, no email, no
 * backend: the two built-ins below are synthetic.
 *
 * - `action-items`: extracts action items from the selected meeting's
 *   scripted transcript/notes.
 * - `calendar-followup`: proposes a follow-up slot as plain text. The
 *   date/time is fixed, made-up data derived deterministically from the
 *   meeting title; no calendar API is called and no `.ics` is fetched.
 */

export type MeetingContext = {
  readonly meetingId: string;
  readonly meetingTitle: string;
  /** Lines streamed so far for the selected meeting (scripted). */
  readonly transcript: readonly string[];
  /** Full scripted script for the selected meeting. */
  readonly script: readonly string[];
  /** The active owner's permitted notes (synthetic). */
  readonly notes: readonly string[];
};

export type PluginOutput = {
  /** Stable plugin id (also the section key in the package). */
  readonly id: string;
  /** Section heading used when the output is included in the package. */
  readonly title: string;
  /** Plain-text body lines of the proposed output. */
  readonly lines: readonly string[];
};

export interface TwinPlugin {
  readonly id: string;
  readonly label: string;
  run(context: MeetingContext): PluginOutput;
}

const ACTION_KEYWORDS =
  /will\b|due\b|follow-?up\b|draft\b|recap\b|summary\b|confirm\b|share\b|owns?\b|pass along\b|list\b/i;

function dedupedLines(context: MeetingContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Snapshot semantics: the output is built from the lines streamed so far
  // only. The full script is deliberately NOT an input — unstreamed lines
  // are not part of the meeting yet — so later streamed lines change the
  // live output and mark an included snapshot stale.
  for (const line of context.transcript) {
    if (typeof line !== "string" || line.length === 0) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

const actionItemsPlugin: TwinPlugin = {
  id: "action-items",
  label: "Action items",
  run(context: MeetingContext): PluginOutput {
    const matches = dedupedLines(context).filter((line) =>
      ACTION_KEYWORDS.test(line),
    );
    const lines =
      matches.length > 0
        ? matches.map((line) => `- Action: ${line}`)
        : [
            `- No explicit action items spotted in "${context.meetingTitle}" — review the transcript above.`,
          ];
    return {
      id: "action-items",
      title: `Action items for ${context.meetingTitle}`,
      lines,
    };
  },
};

function slotForTitle(title: string): string {
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  let sum = 0;
  for (const ch of title) sum += ch.codePointAt(0) ?? 0;
  const weekday = weekdays[sum % weekdays.length];
  const day = 3 + (sum % 20);
  const hour24 = 9 + (sum % 8);
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  return `${weekday}, March ${day}, 2026 at ${hour12}:00 ${meridiem}`;
}

const calendarFollowupPlugin: TwinPlugin = {
  id: "calendar-followup",
  label: "Calendar follow-up",
  run(context: MeetingContext): PluginOutput {
    return {
      id: "calendar-followup",
      title: `Calendar follow-up for ${context.meetingTitle}`,
      lines: [
        `Proposed (synthetic, not booked): ${slotForTitle(context.meetingTitle)} (owner confirms the time herself).`,
        "No calendar event was created and no calendar service was called.",
      ],
    };
  },
};

/** The built-in synthetic plugins, in display order. */
export const BUILTIN_PLUGINS: readonly TwinPlugin[] = [
  actionItemsPlugin,
  calendarFollowupPlugin,
];

/**
 * Render a plugin output as the package section appended when the owner
 * includes it. Plain text only.
 */
export function renderPluginOutput(output: PluginOutput): string {
  return `\n\n## ${output.title}\n${output.lines.join("\n")}\n`;
}
