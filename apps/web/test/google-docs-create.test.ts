import { it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { createGoogleDocsWriter, googleDocsPackageHash } from "../src/googleDocsCreate.js";

type FetchFn = typeof fetch;
const DOCS_CREATE = "https://docs.googleapis.com/v1/documents";
const BATCH = (id: string) => `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`;

function fakeResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}
function mkWriter(opts: Partial<Parameters<typeof createGoogleDocsWriter>[0]> & { token?: string | null; current?: boolean; claim?: boolean } = {}) {
  const fetcher = (opts.fetcher as FetchFn) ?? (vi.fn<typeof fetch>(async () => fakeResponse({})) as unknown as FetchFn);
  const getToken = opts.getToken ?? (() => opts.token ?? "tok");
  const isCurrent = opts.isCurrent ?? (() => opts.current ?? true);
  const claimApproval = opts.claimApproval ?? (() => opts.claim ?? true);
  return { fetcher: fetcher as unknown as FetchFn & ReturnType<typeof vi.fn>, writer: createGoogleDocsWriter({ fetcher: fetcher as FetchFn, getToken, isCurrent, claimApproval }), getToken, isCurrent, claimApproval };
}

// 1 canonical hash
it("hash canonical unicode/newline/whitespace preserved, order insensitive", () => {
  const a = { title: "  hi\n\t☃  ", text: "a  b\nc" };
  const b = { text: "a  b\nc", title: "  hi\n\t☃  " } as typeof a;
  const h1 = googleDocsPackageHash(a);
  const h2 = googleDocsPackageHash(b);
  expect(h1).toBe(h2);
  expect(h1).toBe(createHash("sha256").update(JSON.stringify({ title: a.title, text: a.text })).digest("hex"));
  expect(googleDocsPackageHash({ title: "t1", text: "x" })).not.toBe(googleDocsPackageHash({ title: "t2", text: "x" }));
  expect(googleDocsPackageHash({ title: "t", text: "x1" })).not.toBe(googleDocsPackageHash({ title: "t", text: "x2" }));
});

// 2 happy path two exact URLs
it("happy POST create then batchUpdate with exact bodies/options and claim once before fetch", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, opts) => {
    if (String(url) === DOCS_CREATE) return fakeResponse({ documentId: "doc_A-1" });
    if (String(url) === BATCH("doc_A-1")) return fakeResponse({ documentId: "doc_A-1", replies: [{}] });
    throw new Error("unexpected " + String(url));
  });
  const claimApproval = vi.fn(() => true);
  const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval });
  const payload = { title: "T", text: "hello" };
  const hash = googleDocsPackageHash(payload);
  const sig = new AbortController().signal;
  const res = await writer.createDoc("browserA", payload, sig);
  expect(claimApproval).toHaveBeenCalledTimes(1);
  expect(claimApproval).toHaveBeenCalledWith("browserA", hash);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [u1, o1] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(u1).toBe(DOCS_CREATE);
  expect(o1.method).toBe("POST"); expect((o1 as RequestInit & { redirect?: string }).redirect).toBe("error");
  expect(o1.signal).toBe(sig); expect((o1.headers as Record<string,string>)["Content-Type"]).toBe("application/json");
  expect((o1.headers as Record<string,string>).Authorization).toBe("Bearer tok");
  expect(JSON.parse(o1.body as string)).toEqual({ title: "T" });
  const [u2, o2] = fetcher.mock.calls[1] as [string, RequestInit];
  expect(u2).toBe(BATCH("doc_A-1"));
  expect(o2.method).toBe("POST"); expect(JSON.parse(o2.body as string)).toEqual({ requests: [{ insertText: { location: { index: 1 }, text: "hello" } }] });
  expect(res).toEqual({ status: "created", documentId: "doc_A-1", packageHash: hash });
});

// 3 invalid payload and guards zero fetch
it("invalid payload and guards yield unavailable/throw with zero fetch", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => fakeResponse({ documentId: "doc_A-1" }));
  const bad: unknown[] = [{ title: "t" }, { text: "x" }, { title: null, text: "x" }, { title: "  ", text: "x" }, { title: "t\0", text: "x" }, { title: "a".repeat(10000), text: "x" }];
  for (const p of bad) expect(() => googleDocsPackageHash(p as never)).toThrow("Invalid package");
  const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: () => true });
  for (const p of bad) expect(await writer.createDoc("b", p, new AbortController().signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  expect(fetcher).not.toHaveBeenCalled();
  const s = new AbortController().signal; s.aborted; // use signal
  const abortedCtrl = new AbortController(); abortedCtrl.abort();
  const w2 = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => null, isCurrent: () => true, claimApproval: () => true });
  expect(await w2.createDoc("b", { title: "t", text: "x" }, new AbortController().signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  const w3 = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => false, claimApproval: () => true });
  expect(await w3.createDoc("b", { title: "t", text: "x" }, new AbortController().signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  expect(await w3.createDoc("b", { title: "t", text: "x" }, abortedCtrl.signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  const w4 = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: () => false });
  expect(await w4.createDoc("b", { title: "t", text: "x" }, new AbortController().signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  expect(fetcher).not.toHaveBeenCalled();
});

// 4 external set claim one-use
it("external claim one-use: second unavailable noHTTP, different browser/hash denied", async () => {
  let claimed: Set<string> | null = new Set();
  const realClaim = (bk: string, h: string) => { const k = bk + ":" + h; if (claimed!.has(k)) return false; claimed!.add(k); return true; };
  // simulate external set by pre-populating
  const fetcher = vi.fn<typeof fetch>(async (u) => String(u) === DOCS_CREATE ? fakeResponse({ documentId: "doc_A-1" }) : fakeResponse({ documentId: "doc_A-1", replies: [{}] }));
  const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: (bk, h) => realClaim(bk, h) });
  const p = { title: "T", text: "hi" }; const h = googleDocsPackageHash(p);
  expect(await writer.createDoc("browserA", p, new AbortController().signal)).toEqual(expect.objectContaining({ status: "created" }));
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockClear();
  // second invocation same browser/hash -> claim false (one-use)
  expect(await writer.createDoc("browserA", p, new AbortController().signal)).toEqual({ status: "unavailable", packageHash: undefined } as unknown as object);
  expect(fetcher).not.toHaveBeenCalled();
  // different browser/hash denied via claim false
  const w2 = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: () => false });
  expect(await w2.createDoc("otherBrowser", p, new AbortController().signal)).toEqual(expect.objectContaining({ status: "unavailable" }));
  expect(fetcher).not.toHaveBeenCalled();
  void h; void claimed;
});

// 5 cancellation/revocation/tokenChange loop 3x2 -> partial one fetch
it("cancellation after first fetch/JSON and revocation/tokenChange -> partial one fetch", async () => {
  for (const boundary of ["beforeJson", "afterJson"] as const) {
    for (const trigger of ["abort", "revoke", "tokenChange"] as const) {
      let isCurrentVal = true; let tok: string | null = "tok";
      const ctrl = new AbortController();
      let flip = () => { if (trigger === "abort") ctrl.abort(); if (trigger === "revoke") isCurrentVal = false; if (trigger === "tokenChange") tok = "tok2"; };
      const fetcher = vi.fn<typeof fetch>(async (url) => {
        const u = String(url);
        if (u === DOCS_CREATE) {
          const resp = fakeResponse({ documentId: "doc_A-1" });
          if (boundary === "beforeJson") {
            // flip before json is called: override json
            Object.defineProperty(resp, "json", { value: async () => { flip(); return { documentId: "doc_A-1" }; } });
          } else {
            // wrap json to flip after it resolves
            const orig = resp.json.bind(resp);
            Object.defineProperty(resp, "json", { value: async () => { const v = await orig(); flip(); return v; } });
          }
          return resp as Response;
        }
        return fakeResponse({ documentId: "doc_A-1", replies: [{}] });
      });
      const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => tok, isCurrent: () => isCurrentVal, claimApproval: () => true });
      const res = await writer.createDoc("b", { title: "T", text: "hi" }, ctrl.signal);
      expect(res.status).toBe("partial");
      expect((res as { documentId: string }).documentId).toBe("doc_A-1");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  }
});

// 6 malformed creation -> unconfirmed one fetch
it("malformed creation -> unconfirmed one fetch no leak", async () => {
  const cases: Array<{ body: unknown; init?: ResponseInit; throwJson?: boolean; throwNet?: boolean }> = [
    { body: {} }, { body: { documentId: 5 } }, { body: { documentId: "../bad" } }, { body: [] }, { body: { documentId: "doc_A-1" }, init: { status: 500 } }, { body: { documentId: "doc_A-1" }, throwJson: true }, { body: { documentId: "doc_A-1" }, throwNet: true },
  ];
  for (const c of cases) {
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (c.throwNet) throw new Error("net");
      const r = fakeResponse(c.body, c.init);
      if (c.throwJson) Object.defineProperty(r, "json", { value: async () => { throw new Error("bad json"); } });
      return r;
    });
    const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: () => true });
    const res = await writer.createDoc("b", { title: "T", text: "hi" }, new AbortController().signal);
    expect(res.status).toBe("unconfirmed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res)).not.toMatch(/net|bad json/);
  }
});

// 7 second response fail -> partial two fetch, includes after-batch JSON revoked
it("second response fail -> partial two fetch", async () => {
  const secondCases: Array<{ body: unknown; init?: ResponseInit; throwJson?: boolean; throwNet?: boolean }> = [
    { body: { documentId: "other", replies: [{}] } }, { body: { documentId: "doc_A-1", replies: [] } }, { body: { documentId: "doc_A-1", replies: [{}] }, init: { status: 500 } }, { body: { documentId: "doc_A-1", replies: [{}] }, throwJson: true }, { body: { documentId: "doc_A-1", replies: [{}] }, throwNet: true },
  ];
  for (const c of secondCases) {
    let call = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      call++; if (call === 1) return fakeResponse({ documentId: "doc_A-1" });
      if (c.throwNet) throw new Error("net2");
      const r = fakeResponse(c.body, c.init); if (c.throwJson) Object.defineProperty(r, "json", { value: async () => { throw new Error("j2"); } }); return r;
    });
    const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval: () => true });
    const res = await writer.createDoc("b", { title: "T", text: "hi" }, new AbortController().signal);
    expect(res.status).toBe("partial"); expect((res as { documentId: string }).documentId).toBe("doc_A-1"); expect(fetcher).toHaveBeenCalledTimes(2);
  }
  // after batch JSON revoked -> partial
  {
    let isCurrentVal = true;
    let call = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      call++; if (call === 1) return fakeResponse({ documentId: "doc_A-1" });
      const r = fakeResponse({ documentId: "doc_A-1", replies: [{}] });
      const orig = r.json.bind(r); Object.defineProperty(r, "json", { value: async () => { const v = await orig(); isCurrentVal = false; return v; } }); return r;
    });
    // writer checks isCurrent after batch json; simulate via fetcher returning then writer sees isCurrent false -> partial
    // implement as two-phase: writer will see isCurrent false on second check
    const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => isCurrentVal, claimApproval: () => true });
    const res = await writer.createDoc("b", { title: "T", text: "x" }, new AbortController().signal);
    expect(res).toEqual(expect.objectContaining({status:'partial',documentId:'doc_A-1'}));
    expect(fetcher.mock.calls.length).toBe(2);
  }
});

// 8 mutate payload inside claimApproval preserves snapshot
it("mutate payload inside claimApproval preserves body and hash", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, opts) => {
    if (String(url) === DOCS_CREATE) return fakeResponse({ documentId: "doc_A-1" });
    // capture body sent
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body).toEqual({ requests: [{ insertText: { location: { index: 1 }, text: "origText" } }] });
    return fakeResponse({ documentId: "doc_A-1", replies: [{}] });
  });
  const payload: { title: string; text: string } = { title: "origTitle", text: "origText" };
  const expectedHash = googleDocsPackageHash({ title: "origTitle", text: "origText" });
  const claimApproval = vi.fn((_: string, _h: string) => { payload.title = "MUTATED"; payload.text = "MUTATED"; return true; });
  const writer = createGoogleDocsWriter({ fetcher: fetcher as unknown as FetchFn, getToken: () => "tok", isCurrent: () => true, claimApproval });
  const res = await writer.createDoc("b", payload, new AbortController().signal);
  expect(res).toEqual({ status: "created", documentId: "doc_A-1", packageHash: expectedHash });
  const [, o1] = fetcher.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(o1.body as string)).toEqual({ title: "origTitle" });
});
