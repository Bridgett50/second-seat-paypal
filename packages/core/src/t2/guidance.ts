/**
 * Owner guidance steering for the scripted twin (T16, local only).
 *
 * Owner guidance is a PRIVATE per-meeting channel: `guide(text)` records
 * text for the selected meeting only. It is never added to the transcript,
 * never shown to participants, and never put in the package body unless the
 * owner edits it in themselves.
 *
 * Steering is deterministic and synthetic. The NEXT proactive twin answer
 * streamed for that meeting (the next `Twin:`-prefixed scripted line) is
 * rendered with the oldest pending guidance applied, under these rules:
 *
 * - guidance matching "short" or "brief" trims the answer to its first
 *   sentence;
 * - guidance matching "defer dates" or "no dates" replaces concrete
 *   dates/months with "a date Bridgett will confirm";
 * - when both match, the trim applies first and the date replacement
 *   applies to the trimmed text;
 * - otherwise the answer is prefixed with the neutral acknowledgement
 *   "Noted — " and is otherwise unchanged.
 *
 * Guidance is consumed by exactly one twin answer; non-twin lines
 * (questions from other speakers) are never altered and never consume
 * pending guidance. Guidance never grants authority: text such as "send
 * the email now" or "approve it" only steers the transcript rendering —
 * it never approves, sends, or changes the package.
 *
 * Made-up data only; no network, no model calls.
 */

/** A scripted line counts as a proactive twin answer when it carries this prefix. */
export const TWIN_SPEAKER_PREFIX = "Twin:";

/** Neutral acknowledgement prefixed to a steered answer with no other rule match. */
export const GUIDANCE_ACK_PREFIX = "Noted — ";

/** Replacement text for concrete dates/months under "defer dates" / "no dates" guidance. */
export const GUIDANCE_DATE_REPLACEMENT = "a date Bridgett will confirm";

/** True when `line` is a proactive twin answer (a `Twin:`-prefixed scripted line). */
export function isTwinLine(line: string): boolean {
  return line.startsWith(TWIN_SPEAKER_PREFIX);
}

function wantsShort(guidance: string): boolean {
  return /\b(short|brief)\b/i.test(guidance);
}

function wantsNoDates(guidance: string): boolean {
  return /\bdefer dates\b/i.test(guidance) || /\bno dates\b/i.test(guidance);
}

const MONTH_PATTERN =
  "\\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\\b(?: \\d{1,2}(?:st|nd|rd|th)?)?";
const NUMERIC_DATE_PATTERN = "\\b\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?\\b";

const DATE_PATTERN = new RegExp(
  `${MONTH_PATTERN}|${NUMERIC_DATE_PATTERN}`,
  "g",
);

/**
 * Trim `answer` to its first sentence (up to and including the first
 * `.`, `!`, or `?` that ends a sentence). A single-sentence answer is
 * returned unchanged.
 */
export function firstSentence(answer: string): string {
  const match = answer.match(/^.*?[.!?](?=\s|$)/);
  if (match === null) return answer;
  return match[0];
}

/**
 * Render one proactive twin answer with one pending guidance applied,
 * following the documented rule set above. Never echoes the guidance
 * text itself, so the transcript never leaks what the owner wrote.
 */
export function applyGuidance(answer: string, guidance: string): string {
  const short = wantsShort(guidance);
  const noDates = wantsNoDates(guidance);
  if (!short && !noDates) return `${GUIDANCE_ACK_PREFIX}${answer}`;
  let steered = answer;
  if (short) steered = firstSentence(steered);
  if (noDates) steered = steered.replace(DATE_PATTERN, GUIDANCE_DATE_REPLACEMENT);
  return steered;
}
