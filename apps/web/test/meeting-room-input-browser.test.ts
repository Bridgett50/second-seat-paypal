import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { chromium, expect as pwExpect } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { existsSync } from "node:fs";
import { makeContextApp } from "./fixtures/candidateContextApp.js";

describe("real transcript import", () => {
  it("redacts, edits, approves and adopts via real gate", async () => {
    const app = makeContextApp();
    const prepareSpy = vi.spyOn(app.gate, "prepare");
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
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
      await page.fill("#mr-meeting-text", "");
      await page.click("#mr-meeting-prepare");
      await pwExpect(page.locator("#mr-meeting-prepare")).toBeEnabled();
      expect(prepareSpy).toHaveBeenCalledTimes(0);
      expect(app.callModel).toHaveBeenCalledTimes(0);
      const raw = "Contact alice@example.com. " + "Synthetic meeting discussion. ".repeat(90) + " I will confirm the date myself.";
      await page.locator("#mr-meeting-file").setInputFiles({ name: "synthetic-meeting.txt", mimeType: "text/plain", buffer: Buffer.from(raw) });
      await pwExpect(page.locator("#mr-meeting-text")).toHaveValue(raw);
      expect(app.callModel).toHaveBeenCalledTimes(0);
      expect(prepareSpy).toHaveBeenCalledTimes(0);
      await page.click("#mr-meeting-prepare");
      const ctxArea = page.locator("#mr-context-text");
      await pwExpect(ctxArea).toBeVisible();
      await pwExpect(ctxArea).toHaveValue(/\[REDACTED_email\]/);
      await pwExpect(ctxArea).not.toHaveValue(/alice@example\.com/);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(app.callModel).toHaveBeenCalledTimes(0);
      const before = (await ctxArea.inputValue()) + " I will confirm the date myself.";
      await ctxArea.fill(before);
      await pwExpect(page.locator("#mr-context-approve")).toBeDisabled();
      await page.click("#mr-context-save");
      await pwExpect(page.locator("#mr-context-approve")).toBeEnabled();
      expect(app.callModel).toHaveBeenCalledTimes(0);
      let signalHeld: () => void = () => {};
      let release: () => void = () => {};
      const heldPromise = new Promise<void>((r) => { signalHeld = r; });
      const releasePromise = new Promise<void>((r) => { release = r; });
      await page.route("**/api/meeting-room/candidate-context?*", async (route) => {
        signalHeld();
        await releasePromise;
        await route.continue();
      }, { times: 1 });
      try {
        await heldPromise;
        await pwExpect(page.locator("#mr-context-approve")).toBeEnabled();
        await page.click("#mr-context-approve");
      } finally {
        release();
      }
      try {
        await pwExpect(page.locator("#mr-adopt-candidate")).toBeVisible();
      } catch (e) {
        console.log({modelCalls: app.callModel.mock.calls.length, candidate: (await app.service.actAs(key ?? null, {roomId, action: "state"}, {host: new URL(base).host})).body.snapshot?.candidate, contextStatus: await page.locator("#mr-context-status").textContent(), liveStatus: await page.locator("#mr-live").textContent()});
        throw e;
      }
      expect(app.callModel).toHaveBeenCalledTimes(1);
      expect(app.captured.text).toBe(before);
      await page.click("#mr-adopt-candidate");
      const editor = page.locator("#package-editor");
      await pwExpect(editor).toHaveValue(/I will confirm the date myself\./);
      const cur = await editor.inputValue();
      await editor.fill(cur + " Further review required.");
      await pwExpect(page.locator("#approve")).toBeDisabled();
      await page.click("#package-save");
      await pwExpect(page.locator("#approve")).toBeEnabled();
      await page.click("#approve");
      await pwExpect(page.locator("#mr-approval-state")).toContainText("Approved: yes");
      const gateRes = await app.service.actAs(key ?? null, { roomId, action: "state" }, { host: new URL(base).host });
      const body = gateRes.body;
      expect(body.snapshot).toBeTruthy();
      if (!body.snapshot) throw new Error("missing approved snapshot");
      expect(body.snapshot.view.draft.approved).toBe(true);
      const expected = body.snapshot.view.draft.body;
      const actual = body.snapshot.view.draft.sha256;
      expect(createHash("sha256").update(expected).digest("hex")).toBe(actual);
      await page.locator("#mr-copy-email").click();
      await pwExpect(page.locator("#mr-live")).toHaveText("Approved email copied.");
      const clipboardText = await page.evaluate<string>("navigator.clipboard.readText()");
      const norm = (s: string) => s.replace(/\r\n/g, "\n");
      expect(norm(clipboardText)).toBe(norm(expected));
      await editor.fill((await editor.inputValue()) + " x");
      await pwExpect(page.locator("#approve")).toBeDisabled();
      await pwExpect(page.locator("#send")).toBeDisabled();
      await page.click('#package-save');
      await pwExpect(page.locator('#approve')).toBeEnabled();
      await page.click('#approve');
      await pwExpect(page.locator('#mr-approval-state')).toContainText('Approved: yes');
      const [sendResponse] = await Promise.all([
        page.waitForResponse(r => r.request().method()==='POST' && new URL(r.url()).pathname==='/api/meeting-room' && JSON.parse(r.request().postData()||'{}').action==='send'),
        page.click('#send'),
      ]);
      expect(sendResponse.status()).toBe(403);
      expect(app.service.sentBodies()).toEqual([]);
      await pwExpect(page.locator('#send-notice')).toContainText(/(refused|unavailable|disabled)/i);
      await page.click("#takeover");
      await pwExpect(page.locator("#mr-root").getByText("You took over. The twin is paused.", {exact: true})).toBeVisible();
      await pwExpect(page.locator("#takeover")).toBeDisabled();
      await pwExpect(page.locator("#mr-copy-email")).toBeDisabled();
      expect(externalOrigins).toEqual([]);
    } finally {
      prepareSpy.mockRestore();
      if (key && roomId) { try { await app.service.actAs(key, { roomId, action: "takeover" }, { host: new URL(base).host }); } catch {} }
      if (browser) await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60000);
});
