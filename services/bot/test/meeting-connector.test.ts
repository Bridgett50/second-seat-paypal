import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MeetingDenied,
  callProvider,
  createMeetingConnector,
  packageHash,
  productionDispatch,
  type OwnerPrincipal,
  type StoredCallback,
} from "../src/meeting/connector.js";

const A: OwnerPrincipal = { ownerId: "owner-a" };
const B: OwnerPrincipal = { ownerId: "owner-b" };
const SECRET = "acme-secret-note";

function denied(fn: () => void): MeetingDenied {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MeetingDenied);
    const error = err as MeetingDenied;
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain("owner-a");
    return error;
  }
  throw new Error("expected denial");
}

async function approve(
  c: ReturnType<typeof createMeetingConnector>,
  owner: OwnerPrincipal,
  cb: StoredCallback,
): Promise<void> {
  expect(c.resolveCallback(owner, cb).delivered).toBe(true);
  expect(c.approvePackage(owner, cb.jobId as string, packageHash(cb.artifact)).approved).toBe(true);
}

describe("meeting connector", () => {
  it("T1-1 owner B cannot read, edit, approve, export, or delete A's meeting", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    const before = store.act(A, meetingId, { type: "export" }).text;
    for (const action of [
      { type: "read" } as const,
      { type: "edit", text: "changed" } as const,
      { type: "approve" } as const,
      { type: "export" } as const,
      { type: "delete" } as const,
    ]) {
      denied(() => store.act(B, meetingId, action));
    }
    expect(store.act(A, meetingId, { type: "export" }).text).toBe(before);
    expect(store.outboundCount()).toBe(0);
  });

  it("T1-2 a claimed ownerId does not replace the authenticated principal", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    denied(() => store.act(B, meetingId, { type: "read" }, A.ownerId));
    expect(() => store.act(null, meetingId, { type: "read" })).toThrow(MeetingDenied);
    expect(store.act(A, meetingId, { type: "read" }).text).toBe(SECRET);
  });

  it("T1-3 a suspended generation cannot deliver A's callback into B's session", () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    const aSession = store.openSession(A);
    const bSession = store.openSession(B);
    const generation = store.authorityGeneration(A, meetingId);
    store.suspendGeneration(A, aSession.generationId);
    const callback: StoredCallback = {
      ownerId: A.ownerId,
      meetingId,
      generationId: aSession.generationId,
      authorityGeneration: generation,
      artifact: SECRET,
    };
    expect(store.resolveCallback(B, callback).delivered).toBe(false);
    expect(store.inbox(B, bSession.generationId)).toEqual([]);
    expect(store.inbox(A, aSession.generationId)).toEqual([]);
    const fresh = store.openSession(A);
    const job = store.issueJob(A, meetingId, fresh.generationId);
    const live: StoredCallback = {
      jobId: job.jobId,
      ownerId: A.ownerId,
      meetingId,
      generationId: fresh.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: SECRET,
    };
    expect(store.resolveCallback(A, live).delivered).toBe(true);
    expect(store.inbox(A, fresh.generationId)).toEqual([SECRET]);
    expect(store.inbox(B, bSession.generationId)).toEqual([]);
  });

  it("T1-4 revocation advances authority and a replayed job does not call out", async () => {
    const store = createMeetingConnector();
    const { meetingId } = store.createMeeting(A, SECRET);
    store.act(A, meetingId, { type: "approve" });
    expect(store.approved(A, meetingId)).toBe(true);
    const generation = store.authorityGeneration(A, meetingId);
    const next = store.revoke(A, meetingId);
    expect(next).toBeGreaterThan(generation);
    expect(store.approved(A, meetingId)).toBe(false);
    let calls = 0;
    const replayed = await store.replay(
      A,
      {
        ownerId: A.ownerId,
        meetingId,
        generationId: "g-old",
        authorityGeneration: generation,
        artifact: SECRET,
      },
      async () => {
        calls += 1;
      },
    );
    expect(replayed.ran).toBe(false);
    expect(calls).toBe(0);
    expect(store.outboundCount()).toBe(0);
    expect(store.authorityGeneration(A, meetingId)).toBe(next);
  });

  it("T1-5 non-loopback provider URLs are rejected before transport; fake adapters still run", () => {
    let calls = 0;
    const transport = () => {
      calls += 1;
    };
    for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
      expect(() => callProvider(kind, "https://example.invalid/hook", transport)).toThrow(MeetingDenied);
    }
    expect(calls).toBe(0);
    expect(callProvider("email", { inProcess: true }, transport)).toBe("fake");
    expect(calls).toBe(1);
    expect(callProvider("brain", "http://127.0.0.1:9/fake", transport)).toBe("loopback");
    expect(calls).toBe(2);
    expect(() => productionDispatch()).toThrow(/production-dispatch-disabled/);
  });

  it("T1 regression: the web server does not import the meeting connector", () => {
    const server = readFileSync(resolve(__dirname, "../../../apps/web/src/server.ts"), "utf8");
    expect(server).not.toContain("meeting/connector");
    expect(server).not.toContain("createMeetingConnector");
    expect(server).not.toContain("productionDispatch");
  });
});

describe("R134 reproductions", () => {
  function setup() {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "Synthetic scheduling note v1");
    const { generationId } = c.openSession(A);
    const job = c.issueJob(A, meetingId, generationId);
    const cb: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: "Synthetic answer v1",
    };
    return { c, meetingId, generationId, job, cb };
  }

  it("R134-1: a callback claiming another owner cannot execute replay transport", async () => {
    const { c, cb } = setup();
    let calls = 0;
    expect(
      (
        await c.replay(
          A,
          { ...cb, ownerId: B.ownerId },
          async () => {
            calls += 1;
          },
        )
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    await approve(c, A, cb);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("R134-2: a suspended generation cannot execute replay transport", async () => {
    const { c, meetingId, generationId, cb } = setup();
    let calls = 0;
    await approve(c, A, cb);
    c.suspendGeneration(A, generationId);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    const fresh = c.openSession(A);
    const job = c.issueJob(A, meetingId, fresh.generationId);
    const live: StoredCallback = {
      ...cb,
      jobId: job.jobId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
    };
    await approve(c, A, live);
    expect(
      (
        await c.replay(A, live, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("R134-3: an unknown generation cannot execute replay transport", async () => {
    const { c, cb } = setup();
    let calls = 0;
    expect(
      (
        await c.replay(
          A,
          { ...cb, generationId: "never-created" },
          async () => {
            calls += 1;
          },
        )
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    await approve(c, A, cb);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("R134-4: editing source evidence rejects its older callback", () => {
    const { c, meetingId, generationId, cb } = setup();
    c.act(A, meetingId, { type: "edit", text: "Synthetic scheduling note v2" });
    c.resolveCallback(A, cb);
    expect(c.inbox(A, generationId)).toEqual([]);
  });

  it("R134-5: duplicate callback resolution does not duplicate an artifact", () => {
    const { c, generationId, cb } = setup();
    c.resolveCallback(A, cb);
    c.resolveCallback(A, cb);
    expect(c.inbox(A, generationId).length).toBe(1);
  });

  it("R134-6: documented IPv6 loopback accepts one injected fake transport", () => {
    let calls = 0;
    let result = "threw";
    try {
      result = callProvider("brain", "http://[::1]:9/fake", () => {
        calls += 1;
      });
    } catch {
      result = "threw";
    }
    expect(result).toBe("loopback");
    expect(calls).toBe(1);
  });

  it("R134-7: in-process fake adapter actually runs once", () => {
    let calls = 0;
    expect(
      callProvider("brain", { inProcess: true }, () => {
        calls += 1;
      }),
    ).toBe("fake");
    expect(calls).toBe(1);
  });

  it("CONTROL: revoked authority blocks replay", async () => {
    const { c, meetingId, cb } = setup();
    let calls = 0;
    c.revoke(A, meetingId);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
  });

  it("CONTROL: cross-owner direct reads and production dispatch are denied", () => {
    const { c, meetingId } = setup();
    expect(() => c.act(B, meetingId, { type: "read" })).toThrow(MeetingDenied);
    expect(() => productionDispatch()).toThrow(MeetingDenied);
  });
});

describe("M1 issued jobs", () => {
  function issued(meetingText = "note v1"): {
    c: ReturnType<typeof createMeetingConnector>;
    meetingId: string;
    generationId: string;
  } {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, meetingText);
    const { generationId } = c.openSession(A);
    return { c, meetingId, generationId };
  }

  function envelope(
    job: { jobId: string; ownerId: string; meetingId: string; generationId: string },
    over: {
      jobId?: string;
      ownerId?: string;
      meetingId?: string;
      generationId?: string;
      authorityGeneration?: number;
      sourceRevision?: number;
      artifact?: string;
    },
    base: { authorityGeneration: number; sourceRevision: number },
  ): StoredCallback {
    return {
      jobId: over.jobId ?? job.jobId,
      ownerId: over.ownerId ?? job.ownerId,
      meetingId: over.meetingId ?? job.meetingId,
      generationId: over.generationId ?? job.generationId,
      authorityGeneration: over.authorityGeneration ?? base.authorityGeneration,
      sourceRevision: over.sourceRevision ?? base.sourceRevision,
      artifact: over.artifact ?? "answer",
    };
  }

  it("M1-1 forged owner, unknown generation and suspended generation cannot replay; fresh job dispatches", async () => {
    const { c, meetingId, generationId } = issued();
    const job = c.issueJob(A, meetingId, generationId);
    const base = envelope(job, {}, job);
    await approve(c, A, base);
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect((await c.replay(A, { ...base, ownerId: B.ownerId }, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    expect((await c.replay(A, { ...base, generationId: "g-never-created" }, transport)).ran).toBe(
      false,
    );
    expect(calls).toBe(0);
    const other = c.openSession(A);
    const suspended = c.issueJob(A, meetingId, other.generationId);
    const suspendedCb = envelope(suspended, {}, suspended);
    await approve(c, A, suspendedCb);
    c.suspendGeneration(A, other.generationId);
    expect((await c.replay(A, suspendedCb, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    expect((await c.replay(A, base, transport)).ran).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("M1-2 edited source rejects old work immediately; fresh revision-2 work succeeds", async () => {
    const { c, meetingId, generationId } = issued("note v1");
    const old = c.issueJob(A, meetingId, generationId);
    const oldCb = envelope(old, { artifact: "answer v1" }, old);
    c.act(A, meetingId, { type: "edit", text: "note v2" });
    expect(c.resolveCallback(A, oldCb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual([]);
    let calls = 0;
    expect(
      (
        await c.replay(A, oldCb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    const fresh = c.issueJob(A, meetingId, generationId);
    expect(fresh.sourceRevision).toBe(2);
    const freshCb = envelope(fresh, { artifact: "answer v2" }, fresh);
    await approve(c, A, freshCb);
    expect(c.inbox(A, generationId)).toEqual(["answer v2"]);
    expect(
      (
        await c.replay(A, freshCb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("M1-3 one-field tampering against valid same-owner records is rejected; unknown jobId fails", async () => {
    const c = createMeetingConnector();
    const m1 = c.createMeeting(A, "m1").meetingId;
    const m2 = c.createMeeting(A, "m2").meetingId;
    const m3 = c.createMeeting(A, "m3").meetingId;
    const g1 = c.openSession(A).generationId;
    const g2 = c.openSession(A).generationId;
    c.act(A, m3, { type: "edit", text: "m3 rev 2" });
    c.revoke(A, m2);
    const j1 = c.issueJob(A, m1, g1);
    const env = (over: {
      jobId?: string;
      ownerId?: string;
      meetingId?: string;
      generationId?: string;
      authorityGeneration?: number;
      sourceRevision?: number;
    }): StoredCallback => envelope(j1, over, j1);
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect(c.resolveCallback(A, env({ meetingId: m2 })).delivered).toBe(false);
    expect((await c.replay(A, env({ meetingId: m2 }), transport)).ran).toBe(false);
    expect(c.resolveCallback(A, env({ generationId: g2 })).delivered).toBe(false);
    expect((await c.replay(A, env({ generationId: g2 }), transport)).ran).toBe(false);
    expect(c.resolveCallback(A, env({ authorityGeneration: 2 })).delivered).toBe(false);
    expect((await c.replay(A, env({ authorityGeneration: 2 }), transport)).ran).toBe(false);
    expect(c.resolveCallback(A, env({ sourceRevision: 2 })).delivered).toBe(false);
    expect((await c.replay(A, env({ sourceRevision: 2 }), transport)).ran).toBe(false);
    expect(calls).toBe(0);
    expect(c.outboundCount()).toBe(0);
    const unknown = env({ jobId: "j-never-issued" });
    expect(c.resolveCallback(A, unknown).delivered).toBe(false);
    expect((await c.replay(A, unknown, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    const valid = env({});
    const oldShape: StoredCallback = {
      ownerId: valid.ownerId,
      meetingId: valid.meetingId,
      generationId: valid.generationId,
      authorityGeneration: valid.authorityGeneration,
      sourceRevision: valid.sourceRevision ?? j1.sourceRevision,
      artifact: valid.artifact,
    };
    expect(c.resolveCallback(A, oldShape).delivered).toBe(false);
    expect((await c.replay(A, oldShape, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    await approve(c, A, valid);
    expect(c.inbox(A, g1)).toEqual(["answer"]);
    expect((await c.replay(A, valid, transport)).ran).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("M1-4 duplicate resolve yields one artifact; duplicate replay calls transport at most once", async () => {
    const { c, meetingId, generationId } = issued();
    const job = c.issueJob(A, meetingId, generationId);
    const cb = envelope(job, { artifact: "answer" }, job);
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    expect(c.resolveCallback(A, cb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual(["answer"]);
    expect(c.approvePackage(A, job.jobId, packageHash(cb.artifact)).approved).toBe(true);
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect((await c.replay(A, cb, transport)).ran).toBe(true);
    expect((await c.replay(A, cb, transport)).ran).toBe(false);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
    const g2 = c.openSession(A).generationId;
    const job2 = c.issueJob(A, meetingId, g2);
    const cb2 = envelope(job2, { artifact: "answer 2" }, job2);
    await approve(c, A, cb2);
    expect(c.inbox(A, g2)).toEqual(["answer 2"]);
    expect((await c.replay(A, cb2, transport)).ran).toBe(true);
    expect(calls).toBe(2);
  });

  it("M1-5 each guard fails on its own: suspension, viewer, authority, expiry, revocation", async () => {
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.suspendGeneration(A, generationId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      expect(c.inbox(A, generationId)).toEqual([]);
      let calls = 0;
      expect(
        (
          await c.replay(A, cb, async () => {
            calls += 1;
          })
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(B, cb).delivered).toBe(false);
      expect(c.inbox(A, generationId)).toEqual([]);
      let calls = 0;
      expect(
        (
          await c.replay(
            A,
            { ...cb, ownerId: B.ownerId },
            async () => {
              calls += 1;
            },
          )
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
      expect(c.resolveCallback(A, cb).delivered).toBe(true);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      expect(c.act(A, meetingId, { type: "read" }).text).toBe("note");
      let calls = 0;
      const tampered = envelope(job, { authorityGeneration: job.authorityGeneration + 1 }, job);
      expect(c.resolveCallback(A, tampered).delivered).toBe(false);
      expect(
        (
          await c.replay(A, tampered, async () => {
            calls += 1;
          })
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.expire(A, meetingId, 0);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      let calls = 0;
      expect(
        (
          await c.replay(A, cb, async () => {
            calls += 1;
          })
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
    {
      const c = createMeetingConnector();
      const { meetingId } = c.createMeeting(A, "note");
      const { generationId } = c.openSession(A);
      const job = c.issueJob(A, meetingId, generationId);
      c.revoke(A, meetingId);
      const cb = envelope(job, {}, job);
      expect(c.resolveCallback(A, cb).delivered).toBe(false);
      let calls = 0;
      expect(
        (
          await c.replay(A, cb, async () => {
            calls += 1;
          })
        ).ran,
      ).toBe(false);
      expect(calls).toBe(0);
    }
  });

  it("M1-6 fake adapter runs once and propagates errors; loopback matrix is exact", () => {
    const seen: string[] = [];
    expect(
      callProvider("brain", { inProcess: true }, (url) => {
        seen.push(url);
      }),
    ).toBe("fake");
    expect(seen.length).toBe(1);
    expect(() =>
      callProvider("brain", { inProcess: true }, () => {
        throw new Error("boom-fake");
      }),
    ).toThrow("boom-fake");
    expect(seen.length).toBe(1);
    for (const target of [
      "http://127.0.0.1:9/fake",
      "http://localhost:9/fake",
      "http://[::1]:9/fake",
    ] as const) {
      for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
        const before = seen.length;
        expect(
          callProvider(kind, target, (url) => {
            seen.push(url);
          }),
        ).toBe("loopback");
        expect(seen.length).toBe(before + 1);
      }
    }
    const stuck = seen.length;
    for (const kind of ["brain", "capture", "voice", "avatar", "email"] as const) {
      expect(() =>
        callProvider(kind, "http://example.invalid/hook", () => {
          seen.push("non-loopback-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "https://example.invalid/hook", () => {
          seen.push("non-loopback-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "not a url", () => {
          seen.push("bad-url-ran");
        }),
      ).toThrow(MeetingDenied);
      expect(() =>
        callProvider(kind, "ftp://127.0.0.1:9/fake", () => {
          seen.push("scheme-ran");
        }),
      ).toThrow(MeetingDenied);
    }
    expect(() =>
      callProvider("brain", {} as unknown as { inProcess: true }, () => {
        seen.push("bad-target-ran");
      }),
    ).toThrow(MeetingDenied);
    expect(seen.length).toBe(stuck);
  });
});

describe("M2 hardening", () => {
  const UUID_SHAPE = /^[0-9a-f-]{36}$/;

  function issuedEnvelope(c: ReturnType<typeof createMeetingConnector>, meetingId: string): {
    generationId: string;
    cb: StoredCallback;
  } {
    const { generationId } = c.openSession(A, meetingId);
    const job = c.issueJob(A, meetingId, generationId);
    const cb: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: "answer",
    };
    return { generationId, cb };
  }

  it("M2-B1: a transport that throws on first replay is never sent again", async () => {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { cb } = issuedEnvelope(c, meetingId);
    await approve(c, A, cb);
    let calls = 0;
    await expect(
      c.replay(A, cb, async () => {
        calls += 1;
        throw new Error("boom-transport");
      }),
    ).rejects.toThrow("boom-transport");
    expect(calls).toBe(1);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(0);
    const { cb: fresh } = issuedEnvelope(c, meetingId);
    await approve(c, A, fresh);
    expect(
      (
        await c.replay(A, fresh, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(2);
    expect(c.outboundCount()).toBe(1);
  });

  it("M2-B2a: a forged sequential-pattern envelope cannot replay", async () => {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { generationId } = c.openSession(A, meetingId);
    const job = c.issueJob(A, meetingId, generationId);
    expect(job.jobId).toMatch(UUID_SHAPE);
    expect(job.meetingId).toMatch(UUID_SHAPE);
    expect(job.generationId).toMatch(UUID_SHAPE);
    const forged: StoredCallback = {
      jobId: "j-3",
      ownerId: A.ownerId,
      meetingId: "m-1",
      generationId: "g-2",
      authorityGeneration: 1,
      sourceRevision: 1,
      artifact: "x",
    };
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect((await c.replay(B, forged, transport)).ran).toBe(false);
    expect((await c.replay(A, forged, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    const real: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: "x",
    };
    await approve(c, A, real);
    expect((await c.replay(A, real, transport)).ran).toBe(true);
    expect(calls).toBe(1);
  });

  it("M2-B2b: another owner cannot replay a real issued envelope", async () => {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { cb } = issuedEnvelope(c, meetingId);
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect((await c.replay(B, cb, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    await approve(c, A, cb);
    expect((await c.replay(A, cb, transport)).ran).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });
});

describe("T2 connector slice", () => {
  const BODY = "Subject: Recap\r\n\r\nThanks — café ✓";

  function setupT2(artifact = BODY): {
    c: ReturnType<typeof createMeetingConnector>;
    meetingId: string;
    generationId: string;
    job: { jobId: string };
    cb: StoredCallback;
  } {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { generationId } = c.openSession(A);
    const job = c.issueJob(A, meetingId, generationId);
    const cb: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact,
    };
    return { c, meetingId, generationId, job, cb };
  }

  it("B5-1 approved exact package sends once with the exact body and hash", async () => {
    const { c, cb } = setupT2();
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    const hash = packageHash(BODY);
    expect(c.approvePackage(A, cb.jobId as string, hash).approved).toBe(true);
    const seen: { jobId: string; packageHash: string; body: string }[] = [];
    const transport = async (pkg: { jobId: string; packageHash: string; body: string }) => {
      seen.push(pkg);
    };
    expect((await c.replay(A, cb, transport)).ran).toBe(true);
    expect(seen.length).toBe(1);
    const first = seen[0];
    expect(first?.body).toBe(BODY);
    expect(first?.packageHash).toBe(hash);
    expect(first?.jobId).toBe(cb.jobId);
    expect(c.outboundCount()).toBe(1);
    expect((await c.replay(A, cb, transport)).ran).toBe(false);
    expect(seen.length).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("B5-2 a different artifact than the approved package is refused", async () => {
    const { c, cb } = setupT2();
    await approve(c, A, cb);
    const tampered: StoredCallback = { ...cb, artifact: `${BODY} forged` };
    let calls = 0;
    const seen: string[] = [];
    expect(
      (
        await c.replay(A, tampered, async (pkg) => {
          calls += 1;
          seen.push(pkg.body);
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(c.outboundCount()).toBe(0);
    expect(
      (
        await c.replay(A, cb, async (pkg) => {
          calls += 1;
          seen.push(pkg.body);
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
    expect(seen).toEqual([BODY]);
  });

  it("B5-3 approval needs the server-computed hash of the delivered package and the job owner", async () => {
    const { c, job, cb } = setupT2();
    expect(c.approvePackage(A, job.jobId, packageHash(BODY)).approved).toBe(false);
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    expect(c.approvePackage(B, job.jobId, packageHash(BODY)).approved).toBe(false);
    expect(c.approvePackage(A, job.jobId, packageHash("something else")).approved).toBe(false);
    expect(c.approvePackage(A, "job-never-issued", packageHash(BODY)).approved).toBe(false);
    expect(c.approvePackage(A, job.jobId, packageHash(BODY)).approved).toBe(true);
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("B5-4 an edit after approval invalidates the approval", async () => {
    const { c, meetingId, generationId, cb } = setupT2();
    await approve(c, A, cb);
    c.act(A, meetingId, { type: "edit", text: "note v2" });
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(() => c.exportApproved(A, cb.jobId as string)).toThrow(/export-approved/);
    expect(c.approvePackage(A, cb.jobId as string, packageHash(BODY)).approved).toBe(false);
    const job2 = c.issueJob(A, meetingId, generationId);
    const cb2: StoredCallback = { ...cb, jobId: job2.jobId, sourceRevision: 2, artifact: BODY };
    await approve(c, A, cb2);
    expect(
      (
        await c.replay(A, cb2, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
    // Isolation probe for the same invalidation branch: a future expiry
    // leaves the meeting open (currentStateOk still holds), so only the
    // consumed-but-unsent invalidation can refuse the send.
    const d = createMeetingConnector();
    const mid = d.createMeeting(A, "note").meetingId;
    const gen = d.openSession(A).generationId;
    const j = d.issueJob(A, mid, gen);
    const approved: StoredCallback = {
      jobId: j.jobId,
      ownerId: j.ownerId,
      meetingId: j.meetingId,
      generationId: j.generationId,
      authorityGeneration: j.authorityGeneration,
      sourceRevision: j.sourceRevision,
      artifact: BODY,
    };
    await approve(d, A, approved);
    d.expire(A, mid, Date.now() + 60000);
    let late = 0;
    expect(
      (
        await d.replay(A, approved, async () => {
          late += 1;
        })
      ).ran,
    ).toBe(false);
    expect(late).toBe(0);
    expect(() => d.exportApproved(A, j.jobId)).toThrow(/export-approved/);
    const j3 = d.issueJob(A, mid, gen);
    const live: StoredCallback = { ...approved, jobId: j3.jobId };
    await approve(d, A, live);
    expect(
      (
        await d.replay(A, live, async () => {
          late += 1;
        })
      ).ran,
    ).toBe(true);
    expect(late).toBe(1);
  });

  it("N1-1 a rejecting async transport marks the job failed, counts no outbound and never resends", async () => {
    const { c, cb } = setupT2();
    await approve(c, A, cb);
    let calls = 0;
    await expect(
      c.replay(A, cb, async () => {
        calls += 1;
        throw new Error("boom-send");
      }),
    ).rejects.toThrow("boom-send");
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(0);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(0);
    expect(() => c.exportApproved(A, cb.jobId as string)).toThrow(/export-approved/);
  });

  it("N1-2 concurrent replays of one approved job make one transport call", async () => {
    const { c, cb } = setupT2();
    await approve(c, A, cb);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const transport = async () => {
      calls += 1;
      await gate;
    };
    const p1 = c.replay(A, cb, transport);
    const p2 = c.replay(A, cb, transport);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(Number(r1.ran) + Number(r2.ran)).toBe(1);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("N2-1 a resolved but unapproved job cannot be sent", async () => {
    const { c, cb } = setupT2();
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(c.outboundCount()).toBe(0);
    expect(c.approvePackage(A, cb.jobId as string, packageHash(BODY)).approved).toBe(true);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("N2-2 a pending job cannot be approved or sent", async () => {
    const { c, job, cb } = setupT2();
    expect(c.approvePackage(A, job.jobId, packageHash(BODY)).approved).toBe(false);
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(c.outboundCount()).toBe(0);
    await approve(c, A, cb);
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
  });

  it("TK-1 owner takeover invalidates approved unsent work and blocks new jobs", async () => {
    const { c, meetingId, generationId, job, cb } = setupT2();
    await approve(c, A, cb);
    const pending = c.issueJob(A, meetingId, generationId);
    const pendingCb: StoredCallback = {
      ...cb,
      jobId: pending.jobId,
      artifact: "later answer",
    };
    c.takeover(A, generationId);
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(false);
    expect(calls).toBe(0);
    expect(() => c.exportApproved(A, job.jobId)).toThrow(/export-approved/);
    expect(c.approvePackage(A, job.jobId, packageHash(BODY)).approved).toBe(false);
    expect(c.resolveCallback(A, pendingCb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual([BODY]);
    expect(() => c.issueJob(A, meetingId, generationId)).toThrow(MeetingDenied);
    expect(c.outboundCount()).toBe(0);
  });

  it("TK-2 takeover invalidates a pending job so its callback cannot deliver", () => {
    const { c, generationId, cb } = setupT2();
    c.takeover(A, generationId);
    expect(c.resolveCallback(A, cb).delivered).toBe(false);
    expect(c.inbox(A, generationId)).toEqual([]);
  });

  it("TK-3 another owner cannot take over the session", async () => {
    const { c, meetingId, generationId, cb } = setupT2();
    expect(() => c.takeover(B, generationId)).toThrow(MeetingDenied);
    await approve(c, A, cb);
    let calls = 0;
    expect(
      (
        await c.replay(A, cb, async () => {
          calls += 1;
        })
      ).ran,
    ).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
    expect(() => c.issueJob(B, meetingId, generationId)).toThrow(MeetingDenied);
  });

  it("T2-4c exportApproved returns the exact approved string and refuses unapproved, stale or other-owner", async () => {
    const { c, meetingId, job, cb } = setupT2();
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    expect(() => c.exportApproved(A, job.jobId)).toThrow(/export-approved/);
    expect(() => c.exportApproved(B, job.jobId)).toThrow(/export-approved/);
    const before = c.outboundCount();
    expect(c.approvePackage(A, job.jobId, packageHash(BODY)).approved).toBe(true);
    expect(c.exportApproved(A, job.jobId)).toBe(BODY);
    expect(c.outboundCount()).toBe(before);
    expect(
      (
        await c.replay(A, cb, async () => {
          // accepted
        })
      ).ran,
    ).toBe(true);
    expect(c.exportApproved(A, job.jobId)).toBe(BODY);
    c.act(A, meetingId, { type: "edit", text: "note v2" });
    expect(() => c.exportApproved(A, job.jobId)).toThrow(/export-approved/);
  });

  it("T2-3c transcript events append only for the bound meeting and owner", () => {
    const c = createMeetingConnector();
    const m1 = c.createMeeting(A, "m1").meetingId;
    const m2 = c.createMeeting(A, "m2").meetingId;
    const { generationId } = c.openSession(A);
    expect(c.appendTranscript(A, generationId, { meetingId: m1, text: "hello" }).appended).toBe(
      true,
    );
    expect(c.transcript(A, generationId)).toEqual(["hello"]);
    expect(c.appendTranscript(A, generationId, { meetingId: m2, text: "other" }).appended).toBe(
      false,
    );
    expect(c.transcript(A, generationId)).toEqual(["hello"]);
    expect(
      c.appendTranscript(B, generationId, { meetingId: m1, text: "forged" }).appended,
    ).toBe(false);
    expect(c.transcript(B, generationId)).toEqual([]);
    expect(c.transcript(A, generationId)).toEqual(["hello"]);
    c.suspendGeneration(A, generationId);
    expect(c.appendTranscript(A, generationId, { meetingId: m1, text: "late" }).appended).toBe(
      false,
    );
    expect(c.transcript(A, generationId)).toEqual(["hello"]);
    c.revoke(A, m1);
    const g3 = c.openSession(A).generationId;
    expect(c.appendTranscript(A, g3, { meetingId: m1, text: "closed" }).appended).toBe(false);
    expect(c.transcript(A, g3)).toEqual([]);
  });
});

describe("M3 guards", () => {
  it("M3-a another owner cannot replay A's approved exact package", async () => {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { generationId } = c.openSession(A);
    const job = c.issueJob(A, meetingId, generationId);
    const cb: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: "answer",
    };
    expect(c.resolveCallback(A, cb).delivered).toBe(true);
    expect(c.approvePackage(A, job.jobId, packageHash(cb.artifact)).approved).toBe(true);
    let calls = 0;
    const transport = async () => {
      calls += 1;
    };
    expect((await c.replay(B, cb, transport)).ran).toBe(false);
    expect(calls).toBe(0);
    expect((await c.replay(A, cb, transport)).ran).toBe(true);
    expect(calls).toBe(1);
    expect(c.outboundCount()).toBe(1);
  });

  it("M3-b another owner cannot export A's approved package", async () => {
    const c = createMeetingConnector();
    const { meetingId } = c.createMeeting(A, "note");
    const { generationId } = c.openSession(A);
    const job = c.issueJob(A, meetingId, generationId);
    const cb: StoredCallback = {
      jobId: job.jobId,
      ownerId: job.ownerId,
      meetingId: job.meetingId,
      generationId: job.generationId,
      authorityGeneration: job.authorityGeneration,
      sourceRevision: job.sourceRevision,
      artifact: "answer",
    };
    await approve(c, A, cb);
    expect(() => c.exportApproved(B, job.jobId)).toThrow(MeetingDenied);
    expect(c.exportApproved(A, job.jobId)).toBe("answer");
  });

  it("M3-c another owner cannot append a transcript line naming A's meeting from its own session", () => {
    const c = createMeetingConnector();
    const mA = c.createMeeting(A, "mA").meetingId;
    const bGen = c.openSession(B).generationId;
    expect(c.appendTranscript(B, bGen, { meetingId: mA, text: "forged" }).appended).toBe(false);
    expect(c.transcript(B, bGen)).toEqual([]);
  });

  it("M3-d appendTranscript is refused after takeover", () => {
    const c = createMeetingConnector();
    const m = c.createMeeting(A, "m").meetingId;
    const { generationId: gen } = c.openSession(A, m);
    expect(c.appendTranscript(A, gen, { meetingId: m, text: "one" }).appended).toBe(true);
    c.takeover(A, gen);
    expect(c.appendTranscript(A, gen, { meetingId: m, text: "two" }).appended).toBe(false);
    expect(c.transcript(A, gen)).toEqual(["one"]);
  });

  it("Y5 a first append to a revoked or expired meeting does not bind the session", () => {
    {
      const c = createMeetingConnector();
      const closed = c.createMeeting(A, "closed note").meetingId;
      const open = c.createMeeting(A, "open note").meetingId;
      c.revoke(A, closed);
      const gen = c.openSession(A).generationId;
      expect(
        c.appendTranscript(A, gen, { meetingId: closed, text: "closed line" }).appended,
      ).toBe(false);
      expect(c.appendTranscript(A, gen, { meetingId: open, text: "open line" }).appended).toBe(
        true,
      );
      expect(c.transcript(A, gen)).toEqual(["open line"]);
    }
    {
      const t = 1000000;
      const d = createMeetingConnector({ now: () => t });
      const closed = d.createMeeting(A, "closed note").meetingId;
      const open = d.createMeeting(A, "open note").meetingId;
      d.expire(A, closed, t);
      const gen = d.openSession(A).generationId;
      expect(
        d.appendTranscript(A, gen, { meetingId: closed, text: "closed line" }).appended,
      ).toBe(false);
      expect(d.appendTranscript(A, gen, { meetingId: open, text: "open line" }).appended).toBe(
        true,
      );
      expect(d.transcript(A, gen)).toEqual(["open line"]);
    }
  });
});


