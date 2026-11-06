import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { validatePublicStartEnv, startPublicServer, PUBLIC_BIND_HOST } from "../src/public-start.js";
import { WEB_BIND_HOST } from "../src/server.js";

// Keep original env snapshot to restore
const savedEnv: Record<string, string | undefined> = {};

function saveAndSet(overrides: Record<string, string | undefined>) {
  for (const k of Object.keys(overrides)) {
    savedEnv[k] = process.env[k];
    const v = overrides[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function restoreEnv() {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  // clear saved
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const addr = s.address() as { port: number };
      const port = addr.port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

describe("public start: accepts the offline settings", () => {
  it("public start: accepts the offline settings", async () => {
    const port = await getFreePort();
    const env = {
      PORT: String(port),
      SECOND_SEAT_MODE: "offline",
      SECOND_SEAT_TEST_MODE: undefined as unknown as string,
      LIVE_DEV: undefined as unknown as string,
      SECOND_SEAT_EXPERIMENTAL_IMAGES: undefined as unknown as string,
    };
    // Remove undefined keys to simulate unset
    const clean: Record<string, string | undefined> = { PORT: env.PORT, SECOND_SEAT_MODE: "offline" };
    // Also test with "0" values
    const clean2: Record<string, string | undefined> = { PORT: String(port), SECOND_SEAT_MODE: "offline", SECOND_SEAT_TEST_MODE: "0", LIVE_DEV: "0", SECOND_SEAT_EXPERIMENTAL_IMAGES: "0" };

    expect(validatePublicStartEnv(clean)).toEqual([]);
    expect(validatePublicStartEnv(clean2)).toEqual([]);

    // Actually start and close
    const server = await startPublicServer(clean);
    try {
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("public start: refuses each unsafe or missing setting by name only", () => {
  it("public start: refuses each unsafe or missing setting by name only", () => {
    const base = {
      PORT: "4173",
      SECOND_SEAT_MODE: "offline",
    } as Record<string, string | undefined>;

    type Case = { env: Record<string, string | undefined>; name: string; badValue: string };
    const cases: Case[] = [
      { env: { ...base, SECOND_SEAT_MODE: undefined }, name: "SECOND_SEAT_MODE", badValue: "UNSET_MODE_XYZ" },
      { env: { ...base, SECOND_SEAT_MODE: "BAD_MODE_LIVE_9999" }, name: "SECOND_SEAT_MODE", badValue: "BAD_MODE_LIVE_9999" },
      { env: { ...base, SECOND_SEAT_MODE: "live" }, name: "SECOND_SEAT_MODE", badValue: "live_livevalue_888" },
      { env: { ...base, SECOND_SEAT_TEST_MODE: "BAD_TEST_1_XYZ" }, name: "SECOND_SEAT_TEST_MODE", badValue: "BAD_TEST_1_XYZ" },
      // requirement says test mode 1 specifically, but also generic unsafe; use "1"
      { env: { ...base, SECOND_SEAT_TEST_MODE: "1" }, name: "SECOND_SEAT_TEST_MODE", badValue: "1_TESTMODE_SECRET" },
      { env: { ...base, LIVE_DEV: "1" }, name: "LIVE_DEV", badValue: "1_LIVEDEV_SEC" },
      { env: { ...base, SECOND_SEAT_EXPERIMENTAL_IMAGES: "1" }, name: "SECOND_SEAT_EXPERIMENTAL_IMAGES", badValue: "1_EXPER_SEC" },
      { env: { PORT: undefined, SECOND_SEAT_MODE: "offline" }, name: "PORT", badValue: "MISSING_PORT_XYZ123" },
      { env: { PORT: "BADPORT_XYZ_ABC", SECOND_SEAT_MODE: "offline" }, name: "PORT", badValue: "BADPORT_XYZ_ABC" },
      { env: { PORT: "99999", SECOND_SEAT_MODE: "offline" }, name: "PORT", badValue: "99999_PORT999" },
      { env: { PORT: "0", SECOND_SEAT_MODE: "offline" }, name: "PORT", badValue: "0_PORTZERO" },
    ];

    // For not-a-number case, use distinctive bad value
    // For out of range, test both low and high

    for (const c of cases) {
      // For cases where env already contains the bad value directly, check no leak
      // Also inject distinctive badValues where the PORT/field value is the secret
      // For cases where we used literal "1" etc, the bad value to check is "1" still shouldn't be considered leaked? But spec says use distinctive bad values to check.
      // We handled distinctive ones above; for the "1" cases we still ensure no leak of "1" is not meaningful. Instead check distinctive variants.
      const problems = validatePublicStartEnv(c.env);
      expect(problems.length, `expected refusal for ${c.name} with ${JSON.stringify(c.env)}`).toBeGreaterThan(0);
      const msg = problems.join("; ");
      expect(msg).toContain(c.name);
      // Bad value must not appear in message
      // For the non-distinctive 1 cases, we use a different distinctive check below via extra cases
      if (c.badValue && c.env[c.name] === c.badValue) {
        expect(msg).not.toContain(c.badValue);
      }
      // Also ensure throw works
      expect(() => startPublicServer(c.env)).toThrow();
      try {
        startPublicServer(c.env);
      } catch (e) {
        const m = (e as Error).message;
        expect(m).toContain(c.name);
        if (c.badValue && c.env[c.name] === c.badValue) {
          expect(m).not.toContain(c.badValue);
        }
      }
    }

    // Explicit distinctive bad value checks for the acceptance-required cases
    const distinctiveChecks: { env: Record<string, string | undefined>; bad: string; name: string }[] = [
      { env: { PORT: "4173", SECOND_SEAT_MODE: "live_LIVE_SECRET_77" }, bad: "live_LIVE_SECRET_77", name: "SECOND_SEAT_MODE" },
      { env: { PORT: "4173", SECOND_SEAT_MODE: "offline", SECOND_SEAT_TEST_MODE: "1" }, bad: "1", name: "SECOND_SEAT_TEST_MODE" },
      { env: { PORT: "4173", SECOND_SEAT_MODE: "offline", LIVE_DEV: "1" }, bad: "1", name: "LIVE_DEV" },
      { env: { PORT: "4173", SECOND_SEAT_MODE: "offline", SECOND_SEAT_EXPERIMENTAL_IMAGES: "1" }, bad: "1", name: "SECOND_SEAT_EXPERIMENTAL_IMAGES" },
      { env: { PORT: "NOTANUMBER_DISTINCT_555", SECOND_SEAT_MODE: "offline" }, bad: "NOTANUMBER_DISTINCT_555", name: "PORT" },
      { env: { PORT: "99999", SECOND_SEAT_MODE: "offline" }, bad: "99999", name: "PORT" },
    ];
    for (const d of distinctiveChecks) {
      const problems = validatePublicStartEnv(d.env);
      const msg = problems.join("; ");
      expect(msg).toContain(d.name);
      expect(msg).not.toContain(d.bad);
    }
  });
});

describe("public start: does not listen when refused", () => {
  it("public start: does not listen when refused", async () => {
    const env = { PORT: "4173", SECOND_SEAT_MODE: "live" } as Record<string, string | undefined>;
    const problems = validatePublicStartEnv(env);
    expect(problems.length).toBeGreaterThan(0);

    // Ensure startPublicServer throws synchronously and does not leave a server listening
    let threw = false;
    try {
      await startPublicServer(env);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Also check error message doesn't leak value
    try {
      await startPublicServer(env);
    } catch (e) {
      expect((e as Error).message).toContain("SECOND_SEAT_MODE");
      expect((e as Error).message).not.toContain("live");
    }
  });
});

describe("public start: listens on 0.0.0.0 on PORT over real HTTP", () => {
  it("public start: listens on 0.0.0.0 on PORT over real HTTP", async () => {
    const port = await getFreePort();
    const env: Record<string, string | undefined> = {
      PORT: String(port),
      SECOND_SEAT_MODE: "offline",
    };

    const server = await startPublicServer(env);
    try {
      const addr = server.address() as { address: string; port: number } | null;
      expect(addr).not.toBeNull();
      expect(addr!.address).toBe("0.0.0.0");
      expect(addr!.port).toBe(port);
      expect(WEB_BIND_HOST).toBe("127.0.0.1");

      // Real HTTP request
      const res = await fetch(`http://127.0.0.1:${port}/gate`);
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
