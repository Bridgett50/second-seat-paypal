import { test, expect } from "@playwright/test";

test.describe.serial("transcript invalidation", () => {
  async function analyzerCalls(page): Promise<string[]> {
    const res = await page.request.get("/api/test/outbound");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    return body.analyzerCalls as string[];
  }

  async function gotoSession(page): Promise<string> {
    const respPromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/session") &&
        r.request().method() === "POST",
    );
    await page.goto("/session");
    const resp = await respPromise;
    const body = await resp.json();
    return body.sessionId as string;
  }

  async function sessionState(page, sessionId: string) {
    const res = await page.request.get(
      `/api/session/state?sessionId=${encodeURIComponent(sessionId)}`,
    );
    expect(res.ok()).toBe(true);
    return res.json();
  }

  async function approveFlow(page, text: string): Promise<string> {
    await page.locator("#transcript-input").fill(text);
    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText(
      "Review required",
    );
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    return page.locator("#redacted-text").inputValue();
  }

  test("approve A, type B, immediate Analyze sends neither", async ({
    page,
  }) => {
    await gotoSession(page);
    const A = "When will you deliver the vendor report?";
    await approveFlow(page, A);
    const before = (await analyzerCalls(page)).length;
    const B = "Something entirely different, typed late";
    await page.locator("#transcript-input").fill(B);
    await page.locator("#btn-analyze").click({ force: true });
    await page.waitForTimeout(900);
    const after = await analyzerCalls(page);
    const delta = after.slice(before);
    expect(delta).toEqual([]);
  });

  test("editing redacted preview then Analyze sends nothing", async ({
    page,
  }) => {
    await gotoSession(page);
    const approved = await approveFlow(
      page,
      "When will you deliver the vendor report?",
    );
    const before = (await analyzerCalls(page)).length;
    await page.locator("#redacted-text").fill(`${approved} Extra edit.`);
    await expect(page.locator("#payload-status")).toContainText(
      "Not prepared — preview edited, approve again",
    );
    await page.locator("#btn-analyze").click({ force: true });
    await page.waitForTimeout(900);
    const after = await analyzerCalls(page);
    expect(after.slice(before)).toEqual([]);
  });

  test("clearing transcript clears preview, results, payload and approval", async ({
    page,
  }) => {
    const sessionId = await gotoSession(page);
    await approveFlow(page, "When will you deliver the vendor report?");
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText("Completed");
    await page.locator("#transcript-input").fill("");
    await expect(page.locator("#redacted-text")).toHaveValue("");
    await expect(page.locator("#payload-status")).toContainText(
      "Not prepared yet",
    );
    await expect
      .poll(async () => (await sessionState(page, sessionId)).redactedText, {
        timeout: 5000,
      })
      .toBe("");
    const s = await sessionState(page, sessionId);
    expect(s.approved).toBe(false);
    expect(s.payload).toBeNull();
    expect(s.result).toBeNull();
    expect(s.redactedText).toBe("");
  });

  test("slow redaction resolving late leaves no stale redactedText", async ({
    page,
  }) => {
    const sessionId = await gotoSession(page);
    await page.locator("#transcript-input").fill("Alice [[slow]]");
    await page.locator("#btn-redact").click();
    await page.locator("#transcript-input").fill("Bob");
    await page.waitForTimeout(2200);
    const s = await sessionState(page, sessionId);
    expect(s.redactedText ?? "").not.toContain("Alice");
    expect(s.redactedText).toBe("");
    expect(s.state).toBe("input");
  });

  test("slow analysis resolving late leaves result null with superseded notice", async ({
    page,
  }) => {
    const sessionId = await gotoSession(page);
    await page.locator("#transcript-input").fill("Alice owes $5 tomorrow");
    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText(
      "Review required",
    );
    const base = await page.locator("#redacted-text").inputValue();
    await page.locator("#redacted-text").fill(`${base} [[slow]]`);
    await page.locator("#btn-approve").click();
    await expect(page.locator("#session-state")).toContainText("Approved");
    const approved = (await sessionState(page, sessionId)).payload
      .approvedText as string;
    expect(approved).toContain("[[slow]]");
    await page.locator("#btn-analyze").click();
    await expect(page.locator("#session-state")).toContainText(
      "Analysis pending",
    );
    await page.locator("#transcript-input").fill("Bob");
    await page.waitForTimeout(1000);
    await expect(page.locator("#superseded-notice")).toBeVisible();
    await expect(page.locator("#superseded-notice")).toContainText(approved);
    await page.waitForTimeout(1200);
    const s = await sessionState(page, sessionId);
    expect(s.result).toBeNull();
    expect(s.superseded?.approvedText).toBe(approved);
    // A subsequent render surfaces the notice with the discarded text.
    await page.locator("#btn-redact").click();
    await expect(page.locator("#session-state")).toContainText(
      "Review required",
    );
    await expect(page.locator("#superseded-notice")).toBeVisible();
    await expect(page.locator("#superseded-notice")).toContainText(
      "An earlier approved text was sent to the analyzer before your edit; its result was discarded.",
    );
    await expect(page.locator("#superseded-notice")).toContainText(approved);
  });
});
