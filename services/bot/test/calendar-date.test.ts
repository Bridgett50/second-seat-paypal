// The November 15 example below has no year and stays unmasked. Offline
// MockRedactor still masks a fully specified ordinary date such as
// "March 4, 2027" as date_of_birth. A stated date of birth is still
// masked, and names, phones, and emails are still masked. No model calls.
import { describe, expect, it } from "vitest";
import {
  GLIMMER_SYSTEM_PROMPT,
  MockRedactor,
  maskText,
  normalizeGlimmerLabel,
  validateGlimmerReply,
} from "../src/private/redact.js";

const MEETING = "Delivery is November 15. Call Ana Bell at 555-010-2202 or ana@example.com.";
const DOB = "She was born on March 4, 1990.";

describe("calendar dates vs dates of birth", () => {
  it("tells Glimmer to mask only a stated birthday", () => {
    expect(GLIMMER_SYSTEM_PROMPT).not.toContain("Mask every calendar date");
    expect(GLIMMER_SYSTEM_PROMPT).toContain(
      "Mask a date as date_of_birth only when the input states it is a date of birth or birthday.",
    );
    expect(GLIMMER_SYSTEM_PROMPT).toContain("Leave ordinary meeting and calendar dates unmasked.");
  });

  it("does not relabel a generic DATE, and still maps a real DOB", () => {
    expect(normalizeGlimmerLabel("DATE")).toBe("date");
    expect(normalizeGlimmerLabel("DOB")).toBe("date_of_birth");
    expect(normalizeGlimmerLabel("BIRTHDAY")).toBe("date_of_birth");
  });

  it("leaves November 15 unmasked when the model calls it DATE, and still masks a DOB plus contact details", () => {
    const text = `${MEETING} ${DOB}`;
    const reply = validateGlimmerReply(text, {
      spans: [
        { text: "November 15", label: "DATE" },
        { text: "Ana Bell", label: "person" },
        { text: "555-010-2202", label: "phone" },
        { text: "ana@example.com", label: "email" },
        { text: "March 4, 1990", label: "date_of_birth" },
      ],
      boxes: [],
    });
    const masked = maskText(text, reply.spans);
    expect(masked).toContain("November 15");
    expect(masked).not.toContain("Ana Bell");
    expect(masked).not.toContain("555-010-2202");
    expect(masked).not.toContain("ana@example.com");
    expect(masked).not.toContain("March 4, 1990");
    expect(masked).toContain("[REDACTED_person]");
    expect(masked).toContain("[REDACTED_phone]");
    expect(masked).toContain("[REDACTED_email]");
    expect(masked).toContain("[REDACTED_date_of_birth]");
    expect(reply.spans.some((span) => span.label === "date_of_birth" && text.slice(span.start, span.end) === "March 4, 1990")).toBe(true);
  });

  it("offline fixture: meeting date survives, born-on date and contacts are masked", async () => {
    const text = `${MEETING} ${DOB}`;
    const redacted = await new MockRedactor().redactText(text);
    expect(redacted.maskedText).toContain("November 15");
    expect(redacted.maskedText).not.toContain("Ana Bell");
    expect(redacted.maskedText).not.toContain("555-010-2202");
    expect(redacted.maskedText).not.toContain("ana@example.com");
    expect(redacted.maskedText).not.toContain("March 4, 1990");
    expect(redacted.maskedText).toContain("[REDACTED_date_of_birth]");
    expect(redacted.maskedText).toContain("[REDACTED_person]");
    expect(redacted.maskedText).toContain("[REDACTED_phone]");
    expect(redacted.maskedText).toContain("[REDACTED_email]");
  });

  it("offline fixture still masks a fully specified ordinary date", async () => {
    const redacted = await new MockRedactor().redactText("Delivery is March 4, 2027.");
    expect(redacted.maskedText).toBe("Delivery is [REDACTED_date_of_birth].");
  });
});
