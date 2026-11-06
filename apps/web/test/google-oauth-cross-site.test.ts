import { test, expect } from "vitest";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { existsSync } from "node:fs";
import { startOwnerDraftFixture } from "./ownerDraftServerFixture.js";
test("gmail draft oauth cross-site preserves cookie", async () => {
  const h = await startOwnerDraftFixture();
  let browser: Browser | undefined;
  try {
    const p = process.env.PLAYWRIGHT_CHROME_PATH || (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
    browser = await chromium.launch({ headless: true, ...(p ? { executablePath: p } : { channel: "chrome" as const }) });
    try {
      const page = await browser.newPage();
      const urls: string[] = [];
      page.on("request", (r) => urls.push(r.url()));
      const provider = new URL(h.origin);
      provider.hostname = "localhost";
      provider.pathname = "/synthetic-idp";
      provider.search = "";
      await page.goto(h.origin + "/meeting-room");
      const cookies = await page.context().cookies(h.origin);
      const mr = cookies.find((c) => c.name === "mr_store");
      if (!mr) throw new Error("mr_store missing");
      const begin = h.connections.begin(mr.value, "gmail-draft");
      const state = new URL(begin.url).searchParams.get("state");
      if (!state) throw new Error("state missing");
      const callback = new URL("/api/google/oauth/callback", h.origin);
      callback.searchParams.set("state", state);
      callback.searchParams.set("code", "synthetic-code");
      const cbHref = callback.href;
      const providerHref = provider.href;
      await page.route("**/*", async (route) => {
        const u = route.request().url();
        if (u === providerHref) { await route.fulfill({ contentType: "text/html", body: `<a id="return-to-app" href="${cbHref.replaceAll("&", "&amp;")}">return</a>` }); return; }
        const o = new URL(u).origin;
        if (o === h.origin || o === provider.origin) { await route.continue(); return; }
        await route.abort();
      });
      await page.goto(providerHref);
      const respP = page.waitForResponse((r) => r.url() === cbHref);
      await page.click("#return-to-app");
      const cbResp = await respP;
      const port = new URL(h.origin).port;
      for (const u of urls) { const uu = new URL(u); expect(["localhost", "127.0.0.1"].includes(uu.hostname)).toBe(true); expect(uu.port).toBe(port); }
      expect(cbResp.status()).toBe(303);
      await browserExpect(page).toHaveURL(h.origin + "/meeting-room?google=connected");
      await browserExpect(page.locator('[data-purpose="gmail-draft"] .mr-google-purpose-status')).toHaveText("Connected for this session");
      expect(h.gmailCalls.length).toBe(0);
    } finally { await browser?.close(); }
  } finally { await h.close(); }
}, 30000);
