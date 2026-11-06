import { test, expect } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { existsSync } from "node:fs";
import { OWNER_DRAFT_CLIENT_JS } from "../src/ownerDraftClient.js";

test("owner draft client", async () => {
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || (existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  const browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" as const }) });
  let heldPreview = false, heldCreate = false;
  let releasePrev: (() => void) | null = null, releaseCreate: (() => void) | null = null;
  let enteredPrev: (() => void) | null = null, donePrev: (() => void) | null = null;
  let enteredCreate: (() => void) | null = null, doneCreate: (() => void) | null = null;
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const mkDeferred = () => { let rel!: () => void; const release = new Promise<void>(r => (rel = r)); let ent!: () => void; const entered = new Promise<void>(r => (ent = r)); let don!: () => void; const done = new Promise<void>(r => (don = r)); return { release, rel, entered, ent, done, don }; };
  let dPrev = mkDeferred(), dCreate = mkDeferred();
  const syncHolds = () => { heldPreview = false; heldCreate = false; releasePrev = null; releaseCreate = null; enteredPrev = null; donePrev = null; enteredCreate = null; doneCreate = null; dPrev = mkDeferred(); dCreate = mkDeferred(); };
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route("**/*", async route => {
      const req = route.request();
      const url = req.url();
      const origin = new URL(url).origin;
      if (origin !== "http://127.0.0.1:4173") return route.abort();
      if (req.method() === "GET" && url.includes("/meeting-room")) {
        const flags = (globalThis as unknown as { __flags?: { googleDraft: number; meetWorker: number } }).__flags || { googleDraft: 1, meetWorker: 1 };
        return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body data-google-draft="${flags.googleDraft}" data-meet-worker="${flags.meetWorker}"><div id="mr-root" data-room-id="room-A"><label>Root edit<input id="root-edit"/></label><p>Twin pane</p></div></body></html>` });
      }
      if (req.method() === "POST") {
        const bodyText = req.postData() || "{}";
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(bodyText); } catch {}
        posts.push({ url, body: parsed });
        const fulfillJson = async (data: unknown) => { try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }); } catch {}
        };
        // Simplified routing with deferreds
        if (url.endsWith("/api/google/draft/preview")) {
          const doFulfill = async () => {
            const to = (parsed as { to?: string }).to;
            const subject = (parsed as { subject?: string }).subject;
            await fulfillJson({ status:"preview", package:{to,subject,body:"Approved body\n<em>literal markup</em>\nEND"}, packageHash: "a".repeat(64), expiresAt: Date.now() + 60000 });
          };
          if (heldPreview) {
            enteredPrev?.();
            await dPrev.release;
            try { await doFulfill(); } catch { /* aborted expected */ }
            donePrev?.();
            return;
          }
          return doFulfill();
        }
        if (url.endsWith("/api/google/draft/approve")) { expect(parsed).toEqual({ roomId: "room-A", packageHash: "a".repeat(64) }); return fulfillJson({ status: "approved", packageHash: "a".repeat(64) }); }
        if (url.endsWith("/api/google/draft/create")) {
          expect(parsed).toEqual({ roomId: "room-A", packageHash: "a".repeat(64) });
          const doFulfill = () => fulfillJson({ status: "created", draftId: "draft_1", messageId: "message_1", packageHash: "a".repeat(64), journalStatus: "confirmed" });
          if (heldCreate) { enteredCreate?.(); await dCreate.release; try { await doFulfill(); } catch {} doneCreate?.(); return; }
          return doFulfill();
        }
        if (url.endsWith("/api/google/draft/invalidate")) { expect(parsed).toEqual({ roomId: "room-A" }); return fulfillJson({ status: "invalidated" }); }
      }
      return route.continue();
    });
    const setFlags = (f: { googleDraft: number; meetWorker: number }) => { (globalThis as unknown as { __flags: unknown }).__flags = f; };
    const load = async () => { await page.goto("http://127.0.0.1:4173/meeting-room"); await page.addScriptTag({ content: OWNER_DRAFT_CLIENT_JS }); };
    // Phase 1
    setFlags({ googleDraft: 0, meetWorker: 1 }); await load(); await browserExpect(page.locator("#mr-gmail-to")).toHaveCount(0); expect(posts.length).toBe(0);
    setFlags({ googleDraft: 1, meetWorker: 0 }); await load(); await browserExpect(page.locator("#mr-gmail-to")).toHaveCount(0); expect(posts.length).toBe(0);
    setFlags({ googleDraft: 1, meetWorker: 1 }); await load();
    await browserExpect(page.locator("#mr-gmail-package")).toHaveCount(1);
    await browserExpect(page.locator("#mr-gmail-package")).toHaveText('');
    await browserExpect(page.locator("#mr-root")).toContainText("Twin pane");
    expect(posts.filter(p => p.url.includes("/api/google/draft"))).toHaveLength(0);
    // Phase 2
    await page.fill("#mr-gmail-to", "owner@example.test");
    await page.fill("#mr-gmail-subject", "Exact subject");
    await page.click("#mr-gmail-preview");
    await browserExpect(page.locator("#mr-gmail-package")).toContainText("Approved body\n<em>literal markup</em>\nEND");
    await browserExpect(page.locator("#mr-gmail-package")).toContainText("owner@example.test");
    await browserExpect(page.locator("#mr-gmail-package")).toContainText("Exact subject");
    expect(await page.locator("#mr-gmail-package").locator("em").count()).toBe(0);
    await browserExpect(page.locator("#mr-gmail-create")).toBeDisabled();
    await browserExpect(page.locator("#mr-gmail-approve")).toBeEnabled();
    await page.click("#mr-gmail-approve");
    await browserExpect(page.locator("#mr-gmail-create")).toBeEnabled();
    await page.click("#mr-gmail-create");
    await browserExpect(page.locator("#mr-gmail-status")).toContainText("Gmail draft created");
    await browserExpect(page.locator("#mr-gmail-status")).not.toContainText("delivered");
    expect(posts.filter(p => p.url.endsWith("/api/google/draft/create"))).toHaveLength(1);
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("draft_1");
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("message_1");
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("a".repeat(64));
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("confirmed");
    const beforeExtra = posts.filter(p => p.url.endsWith("/api/google/draft/create")).length;
    await page.locator("#mr-gmail-create").dispatchEvent("click");
    // barrier: next known invalidate
    const invPromise = page.waitForResponse(r => r.url().endsWith("/api/google/draft/invalidate"));
    await page.fill("#mr-gmail-subject", "invalidate barrier");
    await invPromise;
    expect(posts.filter(p => p.url.endsWith("/api/google/draft/create"))).toHaveLength(beforeExtra);
    // Phase 3: edit after creation
    await browserExpect(page.locator("#mr-gmail-approve")).toBeDisabled();
    await browserExpect(page.locator("#mr-gmail-create")).toBeDisabled();
    await browserExpect(page.locator("#mr-gmail-package")).not.toContainText("Approved body");
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("draft_1");
    // fresh approved preview locks/invalidates root-edit
    await page.fill("#mr-gmail-subject", "Exact subject");
    await page.click("#mr-gmail-preview");
    await page.click("#mr-gmail-approve");
    await page.fill("#root-edit", "Changed root package");
    await browserExpect(page.locator("#mr-gmail-approve")).toBeDisabled();
    await browserExpect(page.locator("#mr-gmail-create")).toBeDisabled();
    // verify origin only loopback
    for (const p of posts) expect(new URL(p.url).origin).toBe("http://127.0.0.1:4173");
    // Phase 4: stale preview
    heldPreview = true;
    dPrev = mkDeferred(); enteredPrev = dPrev.ent; donePrev = dPrev.don; releasePrev = dPrev.rel;
    // recreate deferred with proper wiring using simple promises
    let relPrev!: () => void; const relPrevP = new Promise<void>(r => (relPrev = r)); let entPrev!: () => void; const entPrevP = new Promise<void>(r => (entPrev = r)); let donPrev!: () => void; const donPrevP = new Promise<void>(r => (donPrev = r));
    (dPrev as unknown as { release: Promise<void> }).release = relPrevP;
    enteredPrev = entPrev; donePrev = donPrev;
    releasePrev = relPrev;
    // trigger preview with hold
    await page.fill("#mr-gmail-to", "owner@example.test");
    await page.fill("#mr-gmail-subject", "Exact subject");
    const clickPrev = page.click("#mr-gmail-preview");
    await entPrevP;
    await page.fill("#mr-gmail-to", "other@example.test");
    relPrev();
    await donPrevP;
    await clickPrev.catch(() => {});
    await browserExpect(page.locator("#mr-gmail-approve")).toBeDisabled();
    await browserExpect(page.locator("#mr-gmail-create")).toBeDisabled();
    heldPreview = false;
    // Phase 5: create pending uncertainty
    await page.fill("#mr-gmail-subject", "Exact subject");
    await page.fill("#mr-gmail-to", "owner@example.test");
    await page.click("#mr-gmail-preview");
    await browserExpect(page.locator("#mr-gmail-approve")).toBeEnabled();
    await page.click("#mr-gmail-approve");
    heldCreate = true;
    let relC!: () => void; const relCP = new Promise<void>(r => (relC = r)); let entC!: () => void; const entCP = new Promise<void>(r => (entC = r)); let donC!: () => void; const donCP = new Promise<void>(r => (donC = r));
    (dCreate as unknown as { release: Promise<void> }).release = relCP; enteredCreate = entC; doneCreate = donC;
    releaseCreate = relC;
    const clickCreate = page.click("#mr-gmail-create");
    await entCP;
    await page.fill("#mr-gmail-subject", "changed subject");
    await browserExpect(page.locator("#mr-gmail-status")).toContainText("Creation may have reached Gmail. Check your drafts before trying again.");
    relC(); await donCP; await clickCreate.catch(() => {});
    heldCreate = false;
    await browserExpect(page.locator("#mr-gmail-receipt")).toContainText("draft_1");
    expect(posts.filter(p => p.url.endsWith("/api/google/draft/create"))).toHaveLength(2);
    // per-approved-state one create already asserted, total 2 legit
    for (const p of posts) { const u = p.url; if (u.endsWith("/preview")) expect(p.body).toEqual({ roomId: "room-A", to: expect.any(String), subject: expect.any(String) }); if (u.endsWith("/approve") || u.endsWith("/create")) expect(p.body).toEqual({ roomId: "room-A", packageHash: "a".repeat(64) }); if (u.endsWith("/invalidate")) expect(p.body).toEqual({ roomId: "room-A" }); }
  } finally {
    releasePrev?.();
    releaseCreate?.();
    await browser.close();
  }
}, 40000);
