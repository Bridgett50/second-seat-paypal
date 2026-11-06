/**
 * Deterministic synthetic redactor for package text (T9, local only).
 *
 * Scans invented draft text for synthetic sensitive values and replaces each
 * match with a numbered placeholder (`[REDACTED:<category>:<n>]`). Only the
 * redacted text, per-category counts/placeholders/positions leave this module:
 * the original plaintext is never returned or stored.
 *
 * Categories:
 * - `email`: synthetic addresses such as `sam@example.test`.
 * - `phone`: synthetic North-American-style numbers like `555-0100` or
 *   `555-010-0100` (the 555-01xx range is reserved for fiction).
 * - `amount`: dollar amounts such as `$12,000` or `$45.00`.
 */

export type RedactionCategory = "email" | "phone" | "amount";

export const REDACTION_CATEGORIES: readonly RedactionCategory[] = [
  "email",
  "phone",
  "amount",
];

export interface CategoryRedactions {
  readonly category: RedactionCategory;
  readonly count: number;
  readonly placeholders: readonly string[];
  /**
   * Start offset of each placeholder in the redacted output, in the same
   * order as `placeholders`. Offsets refer to the final redacted text.
   */
  readonly positions: readonly number[];
}

export interface RedactionResult {
  readonly redactedText: string;
  readonly redactions: readonly CategoryRedactions[];
}

const EMAIL_PATTERN = "[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,24}";
const PHONE_PATTERN = "\\b\\d{3}-\\d{3}-\\d{4}\\b|\\b\\d{3}-\\d{4}\\b";
const AMOUNT_PATTERN = "\\$\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?|\\$\\d+(?:\\.\\d{2})?";

const CATEGORY_PATTERNS: ReadonlyArray<{
  readonly category: RedactionCategory;
  readonly source: string;
}> = [
  { category: "email", source: EMAIL_PATTERN },
  { category: "phone", source: PHONE_PATTERN },
  { category: "amount", source: AMOUNT_PATTERN },
];

export function placeholderFor(category: RedactionCategory, n: number): string {
  return `[REDACTED:${category}:${n}]`;
}

/** Counts redaction placeholders in text; a literal placeholder typed by the owner is also counted. */
export function countRedactionPlaceholders(text: string): Readonly<Record<RedactionCategory, number>> {
  const counts: Record<RedactionCategory, number> = {
    email: 0,
    phone: 0,
    amount: 0,
  };
  const re = /\[REDACTED:(email|phone|amount):\d+\]/g;
  for (const m of text.matchAll(re)) {
    const cat = m[1];
    if (cat === "email" || cat === "phone" || cat === "amount") {
      counts[cat] += 1;
    }
  }
  return counts;
}

/**
 * Redact `input` deterministically. Categories apply in `email`, `phone`,
 * `amount` order with per-category numbering from 1. Returns the redacted
 * text plus per-category count/placeholders/positions; never the plaintext.
 */
export function redactPackageText(input: string): RedactionResult {
  let text = input;
  const counts = new Map<RedactionCategory, string[]>();
  for (const { category, source } of CATEGORY_PATTERNS) {
    const found: string[] = [];
    let n = 0;
    text = text.replace(new RegExp(source, "g"), () => {
      n += 1;
      const placeholder = placeholderFor(category, n);
      found.push(placeholder);
      return placeholder;
    });
    counts.set(category, found);
  }
  const redactions: CategoryRedactions[] = CATEGORY_PATTERNS.map(({ category }) => {
    const placeholders = counts.get(category) ?? [];
    const positions = placeholders.map((p) => text.indexOf(p));
    return { category, count: placeholders.length, placeholders, positions };
  });
  return { redactedText: text, redactions };
}

export function redactionsFromPlaceholders(text: string): CategoryRedactions[] {
  const re = /\[REDACTED:(email|phone|amount):\d+\]/g;
  const grouped: Record<RedactionCategory, { placeholders: string[]; positions: number[] }> = {
    email: { placeholders: [], positions: [] },
    phone: { placeholders: [], positions: [] },
    amount: { placeholders: [], positions: [] },
  };
  for (const m of text.matchAll(re)) {
    const cat = m[1] as RedactionCategory;
    const placeholder = m[0];
    const pos = m.index ?? 0;
    if (cat === "email" || cat === "phone" || cat === "amount") {
      grouped[cat].placeholders.push(placeholder);
      grouped[cat].positions.push(pos);
    }
  }
  return REDACTION_CATEGORIES.map((category) => ({
    category,
    count: grouped[category].placeholders.length,
    placeholders: grouped[category].placeholders,
    positions: grouped[category].positions,
  }));
}
