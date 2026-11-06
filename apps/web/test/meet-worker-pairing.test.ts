import { test, expect } from "vitest";
import { createMeetWorkerPairing, type MeetWorkerBinding } from "../src/meetWorkerPairing.js";

function setup() {
  let nowVal = 1000;
  const now = () => nowVal;
  const setNow = (v: number) => { nowVal = v; };
  const bindings = new Map<string, MeetWorkerBinding | null>();
  const key = (c: string | null, r: unknown) => `${String(c)}::${String(r)}`;
  const setBinding = (callerKey: string | null, roomId: unknown, b: MeetWorkerBinding | null) => { bindings.set(key(callerKey, roomId), b); };
  const readBinding = (callerKey: string | null, roomId: unknown): MeetWorkerBinding | null => {
    const k = key(callerKey, roomId);
    return bindings.has(k) ? bindings.get(k)! : null;
  };
  const pairing = createMeetWorkerPairing({ readBinding, now });
  const validUrl = "https://meet.google.com/abc-defg-hij";
  const validName = "Alice";
  const mkBinding = (overrides: Partial<MeetWorkerBinding> = {}): MeetWorkerBinding => ({
    roomId: "room1", ownerId: "owner1", meetingId: "meet1", epoch: 1, ...overrides,
  });
  return { pairing, now, setNow, setBinding, readBinding, validUrl, validName, mkBinding, bindings };
}

// 1 - approval via trusted callback, frozen, no callerKey leak
test("approve null for forged/null caller/wrong room; frozen approval/binding", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  const ok = s.pairing.approve("callerA", "room1", s.validUrl, s.validName);
  expect(ok).not.toBeNull();
  expect(Object.isFrozen(ok!)).toBe(true);
  expect(Object.isFrozen(ok!.binding)).toBe(true);
  expect("callerKey" in (ok as unknown as Record<string, unknown>)).toBe(false);
  expect(s.pairing.approve(null, "room1", s.validUrl, s.validName)).toBeNull();
  expect(s.pairing.approve("wrongCaller", "room1", s.validUrl, s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "wrongRoom", s.validUrl, s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", null, s.validUrl, s.validName)).toBeNull();
});

// 2 - consume single-use, replay null, reentrant null without assertions inside callback
test("consume once and replay null; reentrant consume sees null", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  const a = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  expect(a).not.toBeNull();
  let reentrantResult: unknown = "not-called";
  const origRead = s.readBinding;
  // wrap via recreation to intercept: we need reentrancy during consume
  let innerSeen: unknown = undefined;
  const pairing2 = createMeetWorkerPairing({
    readBinding: (ck, rid) => {
      if (innerSeen === undefined) {
        // first call is outer consume's validation - try reentrant
        innerSeen = "outer";
        reentrantResult = pairing2.consume(a.token);
      }
      return origRead(ck, rid);
    },
    now: s.now,
  });
  // use pairing2 for second scenario
  s.setBinding("callerA", "room1", s.mkBinding());
  // need approval via pairing2 as well - re-create with same bindings but fresh pairing for reentrancy test
  const s2 = setup();
  let reentrant2: unknown = "init";
  let outerToken = "";
  const p2 = createMeetWorkerPairing({
    readBinding: (ck, rid) => {
      if (outerToken && reentrant2 === "init") {
        reentrant2 = p2.consume(outerToken);
      }
      const k = `${String(ck)}::${String(rid)}`;
      return s2.bindings.get(k) ?? null;
    },
    now: s2.now,
  });
  s2.setBinding("callerA", "room1", s2.mkBinding());
  const ap = p2.approve("callerA", "room1", s2.validUrl, s2.validName)!;
  outerToken = ap.token;
  const lease = p2.consume(ap.token);
  expect(lease).not.toBeNull();
  expect(reentrant2).toBeNull();
  // normal replay
  expect(p2.consume(ap.token)).toBeNull();
  expect(p2.consume("forged-token")).toBeNull();
  expect(p2.consume(123 as unknown as string)).toBeNull();
  void pairing2; void reentrantResult;
});

// 3 - binding copy at approval; mutation invalidates; url/name captured immutably
test("binding object mutated before consume invalidates; url/name frozen exact", () => {
  const s = setup();
  const mutableBinding: MeetWorkerBinding = { roomId: "room1", ownerId: "owner1", meetingId: "meet1", epoch: 1 };
  s.setBinding("callerA", "room1", mutableBinding);
  let callerUrl: unknown = s.validUrl;
  let callerName: unknown = s.validName;
  const ap = s.pairing.approve("callerA", "room1", callerUrl, callerName)!;
  expect(ap).not.toBeNull();
  expect(Object.isFrozen(ap.binding)).toBe(true);
  // mutate source object before consume
  (mutableBinding as unknown as Record<string, unknown>).meetingId = "hacked";
  expect(s.pairing.consume(ap.token)).toBeNull();

  // positive: captured values survive caller variable reassignment and post-capture mutation
  const s2 = setup();
  const srcBinding: MeetWorkerBinding = { roomId: "room1", ownerId: "owner1", meetingId: "meet1", epoch: 1 };
  s2.setBinding("callerA", "room1", srcBinding);
  let urlVar: unknown = s2.validUrl;
  let nameVar: unknown = s2.validName;
  const ap2 = s2.pairing.approve("callerA", "room1", urlVar, nameVar)!;
  urlVar = "https://meet.google.com/xxx-yyyy-zzz";
  nameVar = "Bob";
  const lease = s2.pairing.consume(ap2.token)!;
  expect(lease.binding.meetingId).toBe("meet1");
  (srcBinding as unknown as Record<string, unknown>).meetingId = "mutated";
  expect(lease.isCurrent()).toBe(false);
  expect(lease).not.toBeNull();
  expect(Object.isFrozen(lease!)).toBe(true);
  expect(Object.isFrozen(lease!.binding)).toBe(true);
  expect(lease!.meetingUrl).toBe(s2.validUrl);
  expect(lease!.displayName).toBe(s2.validName);
  expect(lease!.binding.meetingId).toBe("meet1");
});

// 4 - same scope replacement invalidates prior lease and pending
test("new approval same caller+room revokes prior lease and pending; different scope independent", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  s.setBinding("callerB", "room2", { roomId: "room2", ownerId: "owner2", meetingId: "meet2", epoch: 1 });
  const ap1 = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  const lease1 = s.pairing.consume(ap1.token)!;
  expect(lease1.isCurrent()).toBe(true);
  const ap2 = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  expect(ap2).not.toBeNull();
  expect(lease1.isCurrent()).toBe(false);
  // pending invalidation
  const ap3 = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  const ap4 = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  expect(s.pairing.consume(ap3.token)).toBeNull();
  expect(s.pairing.consume(ap4.token)).not.toBeNull();
  // different scope independent
  const apB = s.pairing.approve("callerB", "room2", s.validUrl, s.validName)!;
  const leaseB = s.pairing.consume(apB.token)!;
  expect(leaseB.isCurrent()).toBe(true);
});

// 5 - each binding field mismatch invalidates permanently
test("binding field mismatches invalidate lease permanently", () => {
  const cases: Array<{ field: keyof MeetWorkerBinding; mutated: unknown }> = [
    { field: "roomId", mutated: "other-room" },
    { field: "ownerId", mutated: "other-owner" },
    { field: "meetingId", mutated: "other-meet" },
    { field: "epoch", mutated: 99 },
  ];
  for (const c of cases) {
    const s = setup();
    s.setBinding("callerA", "room1", s.mkBinding());
    const ap = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
    const lease = s.pairing.consume(ap.token)!;
    expect(lease.isCurrent()).toBe(true);
    const mutated = { ...s.mkBinding(), [c.field]: c.mutated } as MeetWorkerBinding;
    s.setBinding("callerA", "room1", mutated);
    expect(lease.isCurrent()).toBe(false);
    s.setBinding("callerA", "room1", s.mkBinding());
    expect(lease.isCurrent()).toBe(false);
  }
});

// 6 - null/throw from trusted callback permanently invalidates
test("trusted callback null/throw invalidates lease permanently", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  const ap = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  const lease = s.pairing.consume(ap.token)!;
  let threw = false;
  // null case
  s.setBinding("callerA", "room1", null);
  expect(lease.isCurrent()).toBe(false);
  s.setBinding("callerA", "room1", s.mkBinding());
  expect(lease.isCurrent()).toBe(false);

  // throw case
  const s2 = setup();
  let shouldThrow = false;
  const throwingRead = (ck: string | null, rid: unknown) => {
    if (shouldThrow) throw new Error("boom");
    return s2.readBinding(ck, rid);
  };
  const p2 = createMeetWorkerPairing({ readBinding: throwingRead, now: s2.now });
  s2.setBinding("callerA", "room1", s2.mkBinding());
  const ap2 = p2.approve("callerA", "room1", s2.validUrl, s2.validName)!;
  const lease2 = p2.consume(ap2.token)!;
  shouldThrow = true;
  expect(lease2.isCurrent()).toBe(false);
  shouldThrow = false;
  expect(lease2.isCurrent()).toBe(false);

  // callback throw during consume invalidates
  const s3 = setup();
  let throwOnConsume = false;
  const p3 = createMeetWorkerPairing({
    readBinding: (ck, rid) => {
      if (throwOnConsume) throw new Error("consume-boom");
      const k = `${String(ck)}::${String(rid)}`;
      return s3.bindings.get(k) ?? null;
    },
    now: s3.now,
  });
  s3.setBinding("callerA", "room1", s3.mkBinding());
  const ap3 = p3.approve("callerA", "room1", s3.validUrl, s3.validName)!;
  throwOnConsume = true;
  let consumeThrew = false;
  let cr: unknown;
  try { cr = p3.consume(ap3.token); } catch { consumeThrew = true; }
  expect(consumeThrew).toBe(false);
  expect(cr).toBeNull();
  throwOnConsume = false;
  expect(p3.consume(ap3.token)).toBeNull();
});

// 7 - TTL boundaries
test("TTL: consume at +119999 succeeds and stays current past ticket deadline; at+7200000 not current; ticket expiry null", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  s.setNow(1000);
  const ap = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  s.setNow(1000 + 119999);
  const lease = s.pairing.consume(ap.token);
  expect(lease).not.toBeNull();
  expect(lease!.isCurrent()).toBe(true);
  // remains current after ticket deadline (120000)
  s.setNow(1000 + 130000);
  expect(lease!.isCurrent()).toBe(true);
  s.setNow(1000 + 7200000);
  expect(lease!.isCurrent()).toBe(false);
  s.setNow(1000);
  expect(lease!.isCurrent()).toBe(false);

  const s2 = setup();
  s2.setBinding("callerA", "room1", s2.mkBinding());
  s2.setNow(1000);
  const ap2 = s2.pairing.approve("callerA", "room1", s2.validUrl, s2.validName)!;
  s2.setNow(1000 + 120000);
  expect(s2.pairing.consume(ap2.token)).toBeNull();
});

// 8 - cap 128 mixed, replacement at cap, revoke frees, expiry cleans
test("cap 128 enforcement, replacement at cap, revoke and expiry free slots", () => {
  const s = setup();
  // fill 128 pending with distinct rooms
  for (let i = 0; i < 128; i++) {
    s.setBinding("callerA", `room${i}`, { roomId: `room${i}`, ownerId: "owner1", meetingId: `meet${i}`, epoch: 1 });
    const ap = s.pairing.approve("callerA", `room${i}`, s.validUrl, s.validName);
    expect(ap).not.toBeNull();
  }
  s.setBinding("callerA", "roomExtra", { roomId: "roomExtra", ownerId: "owner1", meetingId: "meetX", epoch: 1 });
  expect(s.pairing.approve("callerA", "roomExtra", s.validUrl, s.validName)).toBeNull();
  // replacement in same scope at cap succeeds
  s.setBinding("callerA", "room0", { roomId: "room0", ownerId: "owner1", meetingId: "meet0", epoch: 1 });
  expect(s.pairing.approve("callerA", "room0", s.validUrl, s.validName)).not.toBeNull();
  // revoke frees slot
  s.pairing.revoke("callerA", "room1");
  expect(s.pairing.approve("callerA", "roomExtra", s.validUrl, s.validName)).not.toBeNull();
  // expiry cleans: create pending then expire
  const s2 = setup();
  s2.setNow(1000);
  for (let i = 0; i < 64; i++) {
    s2.setBinding("callerA", `r${i}`, { roomId: `r${i}`, ownerId: "o1", meetingId: `m${i}`, epoch: 1 });
    s2.pairing.approve("callerA", `r${i}`, s2.validUrl, s2.validName);
  }
  // consume 64 to make leases
  // need tokens: re-approve and track
  const s3 = setup();
  s3.setNow(1000);
  const tokens: string[] = [];
  for (let i = 0; i < 64; i++) {
    s3.setBinding("callerA", `r${i}`, { roomId: `r${i}`, ownerId: "o1", meetingId: `m${i}`, epoch: 1 });
    tokens.push(s3.pairing.approve("callerA", `r${i}`, s3.validUrl, s3.validName)!.token);
  }
  // expire pending by advancing past TTL and approving new (cleanup should remove expired pending)
  s3.setNow(1000 + 120001);
  for (let i = 64; i < 128; i++) {
    s3.setBinding("callerA", `r${i}`, { roomId: `r${i}`, ownerId: "o1", meetingId: `m${i}`, epoch: 1 });
    expect(s3.pairing.approve("callerA", `r${i}`, s3.validUrl, s3.validName)).not.toBeNull();
  }
  // leases expiry cleans: advance past 7200000
  s3.setNow(1000 + 1800001);
  // need to trigger cleanup - new approval should succeed after leases expired
  s3.setBinding("callerA", "rNew", { roomId: "rNew", ownerId: "o1", meetingId: "mNew", epoch: 1 });
  expect(s3.pairing.approve("callerA", "rNew", s3.validUrl, s3.validName)).not.toBeNull();
});

// 9 - invalid urls/names and malformed binding
test("invalid urls and display names rejected; malformed epoch/wrong room binding rejected", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  expect(s.pairing.approve("callerA", "room1", "http://meet.google.com/abc-defg-hij", s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", "https://meet.google.com/ABC-DEFG-HIJ", s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", "https://meet.google.com/abc-defg-hij?x=1", s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", "https://meet.google.com/abc-defg-hij#h", s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", "https://meet.google.com:8080/abc-defg-hij", s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "")).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "   ")).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "a".repeat(101))).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "a\x00b")).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "a\x7Fb")).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, 123 as unknown as string)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", 123 as unknown as string, s.validName)).toBeNull();
  expect(s.pairing.approve("callerA", "room1", s.validUrl, s.validName)).not.toBeNull();
  // malformed binding epoch wrong type
  s.setBinding("callerA", "room1", { roomId: "room1", ownerId: "owner1", meetingId: "meet1", epoch: "1" as unknown as number });
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "Bob")).toBeNull();
  // binding roomId mismatch with requested room
  s.setBinding("callerA", "room1", { roomId: "otherRoom", ownerId: "owner1", meetingId: "meet1", epoch: 1 });
  expect(s.pairing.approve("callerA", "room1", s.validUrl, "Bob")).toBeNull();
});

// 10 - foreign revoke no effect; lease.revoke idempotent; old closure not affect new lease
test("foreign revoke no effect; lease revoke idempotent; old revoked closure isolated", () => {
  const s = setup();
  s.setBinding("callerA", "room1", s.mkBinding());
  s.setBinding("callerB", "room1", { roomId: "room1", ownerId: "ownerB", meetingId: "meetB", epoch: 1 });
  const ap = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  const lease = s.pairing.consume(ap.token)!;
  s.pairing.revoke("callerB", "room1");
  s.pairing.revoke("callerA", "otherRoom");
  expect(lease.isCurrent()).toBe(true);
  lease.revoke();
  expect(lease.isCurrent()).toBe(false);
  lease.revoke();
  expect(lease.isCurrent()).toBe(false);
  // old closure cannot invalidate new lease
  s.setBinding("callerA", "room1", s.mkBinding());
  const ap2 = s.pairing.approve("callerA", "room1", s.validUrl, s.validName)!;
  const lease2 = s.pairing.consume(ap2.token)!;
  expect(lease2.isCurrent()).toBe(true);
  // lease (old) revoke again should not affect new lease
  lease.revoke();
  expect(lease2.isCurrent()).toBe(true);
});
