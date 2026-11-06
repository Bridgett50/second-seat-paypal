import { describe, expect, it } from "vitest";
import { MockRedactor } from "../src/private/redact.js";

async function masked(input: string): Promise<string> {
  const redactor = new MockRedactor();
  const { maskedText } = await redactor.redactText(input);
  return maskedText;
}

describe("mock redactor extended PII patterns", () => {
  it("masks Amex 4-6-5 with spaces and contiguous", async () => {
    expect(await masked("card 3401 123456 78901 on file")).not.toContain("3401 123456 78901");
    expect(await masked("card 371449635398431 on file")).not.toContain("371449635398431");
  });

  it("masks IBAN-shaped strings", async () => {
    expect(await masked("refund to DE89370400440532013000 please")).not.toContain("DE89370400440532013000");
    expect(await masked("refund to FR1420041010050500013M02606 please")).not.toContain("FR1420041010050500013M02606");
  });

  it("masks Month D, YYYY and MM/DD/YYYY dates", async () => {
    expect(await masked("born January 5, 2001 ok")).not.toContain("January 5, 2001");
    expect(await masked("born 12/03/1975 ok")).not.toContain("12/03/1975");
  });

  it("masks street addresses with the extended suffixes", async () => {
    for (const addr of ["44 Oak Court", "9 Pine Ct", "3 Elm Way", "27 Birch Place", "8 Maple Pl"]) {
      expect(await masked(`ship to ${addr} now`)).not.toContain(addr);
    }
  });
});
