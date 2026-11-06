import { expect, it } from "vitest";
import { createGoogleConnections } from "../src/googleConnections.js";
function getState(url: string): string { return new URL(url).searchParams.get("state") ?? ""; }
it("flow", async () => {
  let calls = 0;
  const fetcher = () => { calls++; return Promise.resolve(Response.json({ access_token: "fictional-access", refresh_token: "fictional-refresh", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar.events.readonly" })); };
  const a = createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "https://example.test/callback", now: () => 0, fetcher });
  const b = a;
  const ra = a.begin("A", "calendar-read"); const rb = b.begin("B", "calendar-read");
  const sa = getState(ra.url); const sb = getState(rb.url); expect(sb.length > 0).toBe(true); expect(calls).toBe(0);
  expect(await b.complete("B", sa, "fake")).toBe(false); expect(calls).toBe(0);
  expect(await a.complete("A", sa, "fake")).toBe(true); expect(calls).toBe(1);
  expect(await a.complete("A", sa, "fake")).toBe(false); expect(calls).toBe(1);
  expect(a.getAccessToken("A", "calendar-read")).toBe("fictional-access");
  expect(b.getAccessToken("B", "calendar-read")).toBeNull();
  expect(a.getAccessToken("A", "gmail-send")).toBeNull();
  const statusA = a.status("A");
  expect(statusA).toEqual([{ purpose: "calendar-read", expiresAt: 3600000 }]);
  expect(Object.isFrozen(statusA)).toBe(true); expect(Object.isFrozen(statusA[0])).toBe(true);
  const s = JSON.stringify(statusA);
  expect(s.includes("fictional-access")).toBe(false); expect(s.includes("fictional-refresh")).toBe(false);
  expect(s.includes("accessToken")).toBe(false); expect(s.includes("refresh")).toBe(false);
  expect(b.status("B")).toEqual([]); expect(Object.isFrozen(b.status("B"))).toBe(true);
  a.disconnect("A");
  expect(a.getAccessToken("A", "calendar-read")).toBeNull(); expect(a.status("A")).toEqual([]);
  expect(await a.complete("A", sa, "fake")).toBe(false); expect(calls).toBe(1);
});

it("callback race neither resurrects nor clears newer pending", async () => {
  for (const mode of ["disconnect", "supersede"] as const) {
    let resolveEntered!: () => void; const entered = new Promise<void>(r => { resolveEntered = r; });
    let resolveHeld!: (v: Response) => void; const heldResponse = new Promise<Response>(r => { resolveHeld = r; });
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; if (calls === 1) { resolveEntered(); return heldResponse; } return new Response(JSON.stringify({ access_token: "fake-new", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.send" }), { status: 200 }); };
    const svc = createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "https://example.test/callback", now: () => 0, fetcher });
    const a1 = svc.begin("A", "calendar-read"); const s1 = getState(a1.url); const oldP = svc.complete("A", s1, "code-old");
    await entered; if (mode === "disconnect") svc.disconnect("A");
    const a2 = svc.begin("A", "gmail-send"); const s2 = getState(a2.url);
    resolveHeld(new Response(JSON.stringify({ access_token: "fake-old", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar.events.readonly" }), { status: 200 }));
    expect(await oldP).toBe(false); expect(svc.status("A")).toEqual([]); expect(svc.getAccessToken("A", "calendar-read")).toBeNull();
    expect(await svc.complete("A", s2, "code-new")).toBe(true); expect(svc.getAccessToken("A", "gmail-send")).toBe("fake-new"); expect(calls).toBe(2);
  }
});
it("capacity expiry boundaries and maxConnections", async () => {
  let now = 0; let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ access_token: "fake", expires_in: 1, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar.events.readonly" }), { status: 200 }); };
  const svc = createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "https://example.test/callback", now: () => now, fetcher, maxConnections: 2 });
  const a = svc.begin("A", "calendar-read"); expect(await svc.complete("A", getState(a.url), "cA")).toBe(true);
  const b = svc.begin("B", "calendar-read"); expect(() => svc.begin("C", "calendar-read")).toThrow();
  expect(svc.getAccessToken("A", "calendar-read")).toBe("fake");
  now = 1000; expect(svc.getAccessToken("A", "calendar-read")).toBeNull();
  const c = svc.begin("C", "calendar-read"); expect(await svc.complete("B", getState(b.url), "cB")).toBe(true); expect(calls).toBe(2);
  now = 301000; const d = svc.begin("D", "calendar-read"); expect(svc.status("D")).toEqual([]); expect(d.expiresAt).toBe(601000);
  expect(await svc.complete("C", getState(c.url), "cC")).toBe(false); expect(calls).toBe(2); expect(svc.getAccessToken("B", "calendar-read")).toBeNull();
  expect(() => createGoogleConnections({ clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "https://example.test/callback", now: () => now, fetcher, maxConnections: 201 })).toThrow();
});
