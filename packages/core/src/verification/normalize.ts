/**
 * Comparison form for residual-PII checks.
 *
 * NFKC, drop Unicode format characters (Cf, including zero-width),
 * casefold, and collapse whitespace. The result is for matching only
 * and is never written into feedback.
 */
export function normalizePiiText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const UNICODE_DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * Scan form: NFKC, strip format characters, fold unicode dashes to "-".
 * Case is preserved so a caller can casefold only the checks that need it.
 */
export function preparePiiScanText(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(UNICODE_DASH, "-");
}
