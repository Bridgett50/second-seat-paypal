/**
 * Synthetic imported-email comparison (T8, local only).
 *
 * Compares a pasted/uploaded existing email draft against the twin's CURRENT
 * APPROVED meeting-to-email package. Everything is invented data; the import
 * never leaves the browser (paste or local file read only, no network).
 *
 * Imported text format (documented, plain text, synthetic):
 *
 *   To: priya@example.test, marco@example.test
 *   Cc: lee@example.test
 *   Subject: Follow-up: Q3 launch sync
 *   Attachments: notes-q3-launch-sync.txt
 *
 *   <blank line>
 *   <body lines...>
 *
 * - Header names are case-insensitive (`To:`, `Cc:`, `Subject:`,
 *   `Attachments:`). Unknown headers are ignored.
 * - `To`/`Cc` accept comma- or semicolon-separated addresses; values are
 *   trimmed and lowercased, empties dropped.
 * - `Attachments` accepts comma- or semicolon-separated filenames; values are
 *   trimmed (case preserved), empties dropped.
 * - The body is everything after the first blank line, joined with `\n`.
 *   Text with no recognised header is treated as a body-only draft (empty
 *   recipients/subject/attachments, whole text as the body).
 *
 * The approved package has structured recipients/subject/body/attachments.
 * The current draft template carries no recipients or attachments, so they
 * are derived deterministically from synthetic meeting data:
 * - Recipients: scripted `Name:` speakers excluding `Twin`, mapped to
 *   `<lowercased-name>@example.test`, deduped and sorted. All go in `to`,
 *   `cc` is empty.
 * - Subject: `Follow-up: <meeting title>`.
 * - Attachments: [`notes-<slug>.txt`] where slug is the lowercased title
 *   with runs of non-`a-z0-9` replaced by `-` and leading/trailing `-`
 *   trimmed (e.g. "Q3 launch sync" -> `notes-q3-launch-sync.txt`).
 */

export type EmailMismatchField = "recipients" | "subject" | "body" | "attachments";

export type ParsedEmailDraft = {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly attachments: readonly string[];
};

export type ApprovedEmailPackage = {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly attachments: readonly string[];
};

export type RecipientsComparison = {
  readonly expected: readonly string[];
  readonly actual: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly equal: boolean;
};

export type SubjectComparison = {
  readonly expected: string;
  readonly actual: string;
  readonly equal: boolean;
};

export type BodyComparison = {
  /** Lines present in the imported draft beyond the approved multiset. */
  readonly added: readonly string[];
  /** Approved lines absent from the imported draft (multiset difference). */
  readonly removed: readonly string[];
  readonly equal: boolean;
};

export type AttachmentsComparison = {
  readonly expected: readonly string[];
  readonly actual: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly equal: boolean;
};

export type EmailComparison = {
  readonly recipients: RecipientsComparison;
  readonly subject: SubjectComparison;
  readonly body: BodyComparison;
  readonly attachments: AttachmentsComparison;
  /** One entry per differing field; empty when the drafts are identical. */
  readonly flags: readonly EmailMismatchField[];
  readonly identical: boolean;
};

export const NO_APPROVED_PACKAGE_MESSAGE =
  "No approved package for the selected meeting yet. Approve the draft first, then compare.";

function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function slugForTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "meeting";
}

/** Deterministic attachment name for a synthetic meeting title. */
export function attachmentForTitle(title: string): string {
  return `notes-${slugForTitle(title)}.txt`;
}

/**
 * Deterministic invented recipient addresses from scripted `Name:` speakers.
 * Excludes `Twin` lines; maps each other speaker to `<name>@example.test`.
 */
export function participantAddresses(script: readonly string[]): string[] {
  const names = new Set<string>();
  for (const line of script) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const raw = line.slice(0, idx).trim().toLowerCase();
    if (!/^[a-z]+$/.test(raw)) continue;
    if (raw === "twin") continue;
    names.add(`${raw}@example.test`);
  }
  return [...names].sort();
}

/** Deterministic structured approved package for a synthetic meeting. */
export function deriveApprovedPackage(input: {
  readonly title: string;
  readonly script: readonly string[];
  readonly body: string;
}): ApprovedEmailPackage {
  return {
    to: participantAddresses(input.script),
    cc: [],
    subject: `Follow-up: ${input.title}`,
    body: input.body,
    attachments: [attachmentForTitle(input.title)],
  };
}

/** Canonical serialization of a package in the documented import format. */
export function serializeApprovedPackage(pkg: ApprovedEmailPackage): string {
  const lines = [
    `To: ${pkg.to.join(", ")}`,
    `Cc: ${pkg.cc.join(", ")}`,
    `Subject: ${pkg.subject}`,
    `Attachments: ${pkg.attachments.join(", ")}`,
    ``,
    pkg.body,
  ];
  return lines.join("\n");
}

/** Parse pasted/uploaded draft text (synthetic, local only) into fields. */
export function parseImportedEmail(text: string): ParsedEmailDraft {
  const lines = text.split("\n");
  let to: string[] = [];
  let cc: string[] = [];
  let subject = "";
  let attachments: string[] = [];
  let sawHeader = false;
  let bodyStart = 0;
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      bodyStart = i + 1;
      break;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      // Not a header and no blank line seen: whole text is the body.
      bodyStart = 0;
      break;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "to") {
      to = splitList(value).map((s) => s.toLowerCase());
      sawHeader = true;
    } else if (name === "cc") {
      cc = splitList(value).map((s) => s.toLowerCase());
      sawHeader = true;
    } else if (name === "subject") {
      subject = value;
      sawHeader = true;
    } else if (name === "attachments") {
      attachments = splitList(value);
      sawHeader = true;
    } else {
      // Unknown header: ignored, but still counts as header section.
      sawHeader = true;
    }
    bodyStart = i + 1;
  }
  if (!sawHeader) return { to: [], cc: [], subject: "", body: text, attachments: [] };
  return { to, cc, subject, body: lines.slice(bodyStart).join("\n"), attachments };
}

function multisetDifference(a: readonly string[], b: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of a) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else out.push(line);
  }
  return out;
}

/** Pure field-by-field comparison; identical drafts yield zero flags. */
export function compareEmailDrafts(
  approved: ApprovedEmailPackage,
  imported: ParsedEmailDraft,
): EmailComparison {
  const expectedRecipients = [...approved.to.map((s) => s.toLowerCase()), ...approved.cc.map((s) => s.toLowerCase())].sort();
  const actualRecipients = [...imported.to.map((s) => s.toLowerCase()), ...imported.cc.map((s) => s.toLowerCase())].sort();
  const expectedSet = new Set(expectedRecipients);
  const actualSet = new Set(actualRecipients);
  const missing = expectedRecipients.filter((s) => !actualSet.has(s));
  const extra = actualRecipients.filter((s) => !expectedSet.has(s));
  const recipientsEqual = missing.length === 0 && extra.length === 0;

  const subjectEqual = imported.subject === approved.subject;

  const approvedLines = approved.body.split("\n");
  const importedLines = imported.body.split("\n");
  const added = multisetDifference(importedLines, approvedLines);
  const removed = multisetDifference(approvedLines, importedLines);
  const bodyEqual = added.length === 0 && removed.length === 0;

  const expectedAtt = [...approved.attachments];
  const actualAtt = [...imported.attachments];
  const expectedAttSet = new Set(expectedAtt);
  const actualAttSet = new Set(actualAtt);
  const missingAtt = expectedAtt.filter((s) => !actualAttSet.has(s));
  const extraAtt = actualAtt.filter((s) => !expectedAttSet.has(s));
  const attachmentsEqual = missingAtt.length === 0 && extraAtt.length === 0;

  const flags: EmailMismatchField[] = [];
  if (!recipientsEqual) flags.push("recipients");
  if (!subjectEqual) flags.push("subject");
  if (!bodyEqual) flags.push("body");
  if (!attachmentsEqual) flags.push("attachments");

  return {
    recipients: { expected: expectedRecipients, actual: actualRecipients, missing, extra, equal: recipientsEqual },
    subject: { expected: approved.subject, actual: imported.subject, equal: subjectEqual },
    body: { added, removed, equal: bodyEqual },
    attachments: { expected: expectedAtt, actual: actualAtt, missing: missingAtt, extra: extraAtt, equal: attachmentsEqual },
    flags,
    identical: flags.length === 0,
  };
}

/** Parse `text` then compare it against an approved package (pure). */
export function compareImportedText(
  approved: ApprovedEmailPackage,
  text: string,
): EmailComparison {
  return compareEmailDrafts(approved, parseImportedEmail(text));
}
