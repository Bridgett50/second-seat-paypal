import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { redactPackageText } from "../src/t2/redaction.js";

describe("redaction bounds", () => {
  it("RB-1 redactPackageText on 200,000 g characters finishes under 200 ms", () => {
    const moduleUrl = new URL(
      "../dist/src/t2/redaction.js",
      import.meta.url,
    ).href;
    const script = [
      `import { redactPackageText } from ${JSON.stringify(moduleUrl)};`,
      `const input = "g".repeat(200_000);`,
      `const start = performance.now();`,
      `const result = redactPackageText(input);`,
      `const elapsed = performance.now() - start;`,
      `if (result.redactedText !== input) { console.error("output mismatch"); process.exit(1); }`,
      `console.log(JSON.stringify(elapsed));`,
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 5000, encoding: "utf8" },
    );
    expect(result.error, "redaction timed out (unbounded pattern?)").toBeUndefined();
    expect(result.signal, "redaction timed out (unbounded pattern?)").toBeNull();
    expect(result.status).toBe(0);
    const elapsed = JSON.parse(result.stdout);
    expect(elapsed).toBeLessThan(200);
  });

  it("RB-2 bounded email pattern still redacts a normal email", () => {
    const result = redactPackageText("mail ana.lee@example.com now");
    expect(result.redactedText).toBe("mail [REDACTED:email:1] now");
    expect(result.redactedText).not.toContain("ana.lee@example.com");
  });

  it("RB-3 a 65-character local part is not fully matched as one email", () => {
    const local = "a".repeat(65);
    const result = redactPackageText(`${local}@example.com now`);
    expect(result.redactedText).not.toContain(`${local}@example.com`);
    expect(result.redactedText[0]).toBe("a");
  });
});
