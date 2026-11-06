import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createGoogleOAuthStateStore } from "../src/googleOAuthState.js";

it("isolates browser OAuth states correctly", () => {
  const store = createGoogleOAuthStateStore();
  const a = store.begin("browser-a", "calendar-read");
  const b = store.begin("browser-b", "gmail-draft");
  expect(Object.keys(a)).not.toContain("codeVerifier");
  expect(Object.keys(b)).not.toContain("codeVerifier");
  expect(store.consume("browser-a", "0".repeat(64))).toBeNull();
  expect(store.consume("browser-b", a.state)).toBeNull();
  const rA = store.consume("browser-a", a.state);
  expect(rA).not.toBeNull();
  if (rA) {
    expect(createHash("sha256").update(rA.codeVerifier).digest("base64url")).toBe(a.codeChallenge);
    expect(rA.purpose).toBe("calendar-read");
  }
  expect(store.consume("browser-a", a.state)).toBeNull();
  const rB = store.consume("browser-b", b.state);
  expect(rB).not.toBeNull();
  if (rB) expect(rB.purpose).toBe("gmail-draft");
});

it("google oauth state store: same-browser invalidation, cap, cancel isolation and expiry purge", () => {
  let time = 0;
  const store = createGoogleOAuthStateStore({ now: () => time, ttlMs: 100, maxPending: 2 });
  const a1 = store.begin("browser-a", "calendar-read");
  const a2 = store.begin("browser-a", "calendar-read");
  expect(store.consume("browser-a", a1.state)).toBeNull();
  const b = store.begin("browser-b", "calendar-read");
  expect(() => store.begin("browser-c", "calendar-read")).toThrow();
  expect(store.consume("browser-a", a2.state)).not.toBeNull();
  expect(store.consume("browser-b", b.state)).not.toBeNull();
  const c = store.begin("browser-c", "calendar-read");
  store.cancel("different-browser");
  expect(store.consume("browser-c", c.state)).not.toBeNull();
  const d = store.begin("browser-d", "calendar-read");
  store.cancel("browser-d");
  expect(store.consume("browser-d", d.state)).toBeNull();
  time = 0;
  const store2 = createGoogleOAuthStateStore({ now: () => time, ttlMs: 100, maxPending: 2 });
  const x = store2.begin("browser-x", "calendar-read");
  store2.begin("browser-y", "calendar-read");
  time = 100;
  expect(store2.consume("browser-x", x.state)).toBeNull();
  const z = store2.begin("browser-z", "calendar-read");
  const w = store2.begin("browser-w", "calendar-read");
  expect(store2.consume("browser-z", z.state)).not.toBeNull();
  expect(store2.consume("browser-w", w.state)).not.toBeNull();
  expect(() => createGoogleOAuthStateStore({ now: () => time, ttlMs: 300001, maxPending: 2 })).toThrow();
  expect(() => createGoogleOAuthStateStore({ now: () => time, ttlMs: 100, maxPending: 201 })).toThrow();
});
