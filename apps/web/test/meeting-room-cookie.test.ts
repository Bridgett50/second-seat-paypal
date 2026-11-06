import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";

type SetCookieFn = (key: string, headers: IncomingHttpHeaders) => string;

async function loadSetCookie(): Promise<SetCookieFn> {
  const mod = (await import("../src/meetingRoom.js")) as unknown as Record<string, unknown>;
  const fn = mod["meetingRoomSetCookie"];
  expect(typeof fn).toBe("function");
  return fn as SetCookieFn;
}

describe("meeting room cookie", () => {
  it("MR-C1 a public https request gets a Secure HttpOnly SameSite=Strict cookie", async () => {
    const setCookie = await loadSetCookie();
    const v = setCookie("k1", { host: "second-seat.onrender.com", "x-forwarded-proto": "https" });
    expect(v).toContain("mr_store=k1");
    expect(v).toContain("HttpOnly");
    expect(v).toContain("SameSite=Strict");
    expect(v).toContain("; Secure");
  });
  it("MR-C2 a public Host without forwarded proto still gets Secure", async () => {
    const setCookie = await loadSetCookie();
    expect(setCookie("k2", { host: "example.com" })).toContain("; Secure");
    expect(setCookie("k2", { host: "127.0.0.1:4174", "x-forwarded-host": "example.com" })).toContain("; Secure");
    expect(setCookie("k2", { host: ["127.0.0.1", "example.com"] as unknown as string })).toContain("; Secure");
  });
  it("MR-C3 plain http on a loopback Host omits Secure", async () => {
    const setCookie = await loadSetCookie();
    expect(setCookie("k3", { host: "127.0.0.1:4174" })).not.toContain("Secure");
    expect(setCookie("k3", { host: "localhost:3000" })).not.toContain("Secure");
    expect(setCookie("k3", { host: "127.0.0.1:4174", "x-forwarded-proto": "https" })).toContain("; Secure");
  });
  it("MR-C4 server.ts sets the cookie through meetingRoomSetCookie", () => {
    const src = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(src).toContain("meetingRoomSetCookie(key, req.headers)");
    expect(src).not.toContain("SameSite=Strict; Max-Age=86400`");
  });
});
