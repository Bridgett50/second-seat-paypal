import { test, expect } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { existsSync } from "node:fs";
import { GOOGLE_CONNECT_CLIENT_JS } from "../src/googleConnectClient.js";

test("google panel", async () => {
  const ep = process.env.PLAYWRIGHT_CHROME_PATH ? process.env.PLAYWRIGHT_CHROME_PATH : existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined;
  const browser = await chromium.launch({ ...(ep ? { executablePath: ep } : {}) });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let optIn = false;
    const urls: string[] = [];
    const posts: { path: string; body: string | undefined }[] = [];
    await page.route("**/*", async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      urls.push(req.url());
      if (req.method() === "POST") posts.push({ path: u.pathname, body: req.postData() ?? undefined });
      if (u.pathname === "/meeting-room" && req.method() === "GET") {
        const html = `<!doctype html><html><body ${optIn ? 'data-google-connect="1"' : ""}><div id="mr-root" data-room-id="room-A">Twin review pane</div></body></html>`;
        return route.fulfill({ status: 200, contentType: "text/html", body: html });
      }
      if (u.pathname === "/api/google/status" && req.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connections: [{ purpose: "calendar-read", expiresAt: Date.now() + 3600000 }, { purpose: "gmail-draft", expiresAt: Date.now() + 3600000 }, { purpose: "docs-create", expiresAt: Date.now() + 3600000 }] }) });
      if (u.pathname === "/api/google/disconnect" && req.method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ disconnected: true }) });
      if (u.pathname === "/api/google/connect" && req.method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authorizationUrl: "https://evil.example/oauth" }) });
      return route.fulfill({ status: 200, contentType: "text/html", body: "" });
    });
    optIn = false;
    await page.goto("http://127.0.0.1:4173/meeting-room");
    await page.addScriptTag({ content: GOOGLE_CONNECT_CLIENT_JS });
    expect(await page.locator("#mr-google-connect").count()).toBe(0);
    expect(urls.filter((x) => x.includes("/api/google"))).toHaveLength(0);
    expect(await page.locator("#mr-root").textContent()).toBe("Twin review pane");
    optIn = true;
    posts.length = 0;
    await page.goto("http://127.0.0.1:4173/meeting-room");
    await page.addScriptTag({ content: GOOGLE_CONNECT_CLIENT_JS });
    await browserExpect(page.locator(".mr-google-purpose-status")).toHaveText(["Connected for this session", "Connected for this session", "Connected for this session"]);
    await browserExpect(page.getByRole("button", { name: "Connect Calendar" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Connect Gmail drafts" })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Connect Docs" })).toBeVisible();
    expect(await page.getByRole("button", { name: "GmailSend" }).count()).toBe(0);
    expect(await page.locator("#mr-root").textContent()).toBe("Twin review pane");
    await browserExpect(page.locator("#mr-google-disconnect")).toBeEnabled();
    await page.locator("#mr-google-disconnect").click();
    await browserExpect(page.locator(".mr-google-purpose-status")).toHaveText(["Not connected for this session", "Not connected for this session", "Not connected for this session"]);
    expect(posts.some((p) => p.path === "/api/google/disconnect" && p.body === "{}")).toBe(true);
    expect(await page.locator("#mr-google-connect").textContent()).toContain("Disconnect clears this session only");
    posts.length = 0;
    await page.locator("#mr-google-calendar").click();
    await browserExpect(page.locator("#mr-google-status")).toHaveText("Google connection is unavailable. Please try again.");
    expect(posts.some((p) => p.path === "/api/google/connect" && p.body === JSON.stringify({ purpose: "calendar-read" }))).toBe(true);
    expect(page.url()).toContain("/meeting-room");
    for (const u of urls) expect(new URL(u).origin).toBe("http://127.0.0.1:4173");
    expect(await page.locator("#mr-root").textContent()).toBe("Twin review pane");
    await ctx.close();
  } finally { await browser.close(); }
}, 40000);
