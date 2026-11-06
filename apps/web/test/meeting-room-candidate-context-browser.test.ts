import { describe, it, expect } from "vitest";
import { chromium, expect as pwExpect } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { existsSync } from "node:fs";
import { makeContextApp } from "./fixtures/candidateContextApp.js";

describe("chrome privacy-gate", () => {
  it("redacts, edits, approves and adopts via real gate", async () => {
    const app = makeContextApp();
    const server = app.server;
    await new Promise<void>((r, j) => server.listen(0, "127.0.0.1", (e?: Error) => (e ? j(e) : r())));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bad address");
    const base = `http://127.0.0.1:${addr.port}`;
    let browser: Browser | undefined;
    let key: string | undefined;
    let roomId: string | undefined;
    const externalOrigins: string[] = [];
    try {
      const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
      browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
      const context = await browser.newContext();
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
          externalOrigins.push(url.origin);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(`${base}/meeting-room`);
      await page.fill("#guidance-input", "Do not share any dates.");
      const [resp] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/meeting-room" && r.request().postDataJSON()?.action === "guide"), page.click("#guidance-send")]);
      expect(resp.ok()).toBe(true);
      const rootId = await page.getAttribute("#mr-root", "data-room-id");
      if (!rootId) throw new Error("missing roomId");
      roomId = rootId;
      const cookies = await context.cookies();
      const found = cookies.find((c) => c.name === "mr_store");
      if (!found) throw new Error("missing mr_store");
      key = found.value;
      if (!key) throw new Error("missing key");
      const st = await app.service.actAs(key, { roomId, action: "state" }, { host: new URL(base).host });
      if (!st.body.snapshot) throw new Error("null snapshot");
      const meetingId = st.body.snapshot.view.selectedMeetingId;
      if (!meetingId) throw new Error("missing meetingId");
      const ing = await app.service.ingestConversationAs(key, roomId, { version: 1, meetingId, utteranceId: app.knownUid, sequence: 1, revision: 1, speaker: "Synthetic owner", text: "Contact alice@example.com after this meeting." });
      expect(ing.status).toBe(200);
      const fin = await app.service.finishConversationAs(key, roomId);
      expect(fin.status).toBe(202);
      const ctxArea = page.locator("#mr-context-text");
      await pwExpect(ctxArea).toBeVisible();
      await pwExpect(ctxArea).toHaveValue(/\[REDACTED_email\]/);
      await pwExpect(ctxArea).not.toHaveValue(/alice@example\.com/);
      expect(app.callModel).toHaveBeenCalledTimes(0);
      const before = (await ctxArea.inputValue()) + " I will confirm the date myself.";
      await ctxArea.fill(before);
      await pwExpect(page.locator("#mr-context-approve")).toBeDisabled();
      await page.click("#mr-context-save");
      await pwExpect(page.locator("#mr-context-approve")).toBeEnabled();
      expect(app.callModel).toHaveBeenCalledTimes(0);
      await page.click("#mr-context-approve");
      await pwExpect(page.locator("#mr-adopt-candidate")).toBeVisible();
      expect(app.callModel).toHaveBeenCalledTimes(1);
      expect(app.captured.text).toBe(before);
      await page.click("#mr-adopt-candidate");
      const editor = page.locator("#package-editor");
      await pwExpect(editor).toHaveValue(/I will confirm the date myself\./);
      const cur = await editor.inputValue();
      await editor.fill(cur + " Further review required.");
      await pwExpect(page.locator("#approve")).toBeDisabled();
      expect(externalOrigins).toEqual([]);
    } finally {
      if (key && roomId) { try { await app.service.actAs(key, { roomId, action: "takeover" }, { host: new URL(base).host }); } catch {} }
      if (browser) await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60000);
});
