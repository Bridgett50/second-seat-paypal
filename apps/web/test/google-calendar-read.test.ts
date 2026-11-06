import { describe, it, expect, vi } from "vitest";
import { createGoogleCalendarReader } from "../src/googleCalendarRead.js";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOK = "tok123";
const BK = "browser-key";
const TIME_MIN = "2026-01-01T00:00:00Z";
const TIME_MAX = "2026-01-02T00:00:00Z";
const WIN = { timeMin: TIME_MIN, timeMax: TIME_MAX } as const;

function mkDeps(over?: Partial<{ fetcher: typeof fetch; getToken: (k: string) => string | null; isCurrent: (k: string) => boolean }>) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
  return { fetcher, getToken: () => TOK, isCurrent: () => true, ...over } as { fetcher: typeof fetch; getToken: (k: string) => string | null; isCurrent: (k: string) => boolean };
}
function reader(deps?: ReturnType<typeof mkDeps>) {
  const d = deps ?? mkDeps();
  return { deps: d, api: createGoogleCalendarReader(d) };
}
function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function okFetcher(body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () => jsonResp(body)) as unknown as typeof fetch;
}
function validEvent(over: Record<string, unknown> = {}) {
  return { id: "e1", summary: "Hello", start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX }, ...over };
}

describe("google-calendar-read", () => {
  it("sends exact endpoint query headers and options", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResp({ items: [] }));
    const deps = mkDeps({ fetcher });
    const r = reader(deps);
    const ctrl = new AbortController();
    const res = await r.api.readCalendar(BK, WIN, ctrl.signal);
    expect(res.status).toBe("read");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(BASE);
    expect(u.searchParams.get("timeMin")).toBe(TIME_MIN);
    expect(u.searchParams.get("timeMax")).toBe(TIME_MAX);
    expect(u.searchParams.get("maxResults")).toBe("25");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("orderBy")).toBe("startTime");
    expect(u.searchParams.get("fields")).toBe("items(id,summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri))),nextPageToken");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOK}`);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBe(ctrl.signal);
  });

  it("sanitizes output: defaults summary, omits extras, freezes", async () => {
    const fetcher = okFetcher({ items: [{ id: "a", start: { date: "2026-01-01" }, end: { date: "2026-01-02" }, hangoutLink: "https://meet.google.com/abc-defg-hij", extra: 1, conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } }], nextPageToken: "npt1" });
    const { api } = reader(mkDeps({ fetcher }));
    const res = await api.readCalendar(BK, WIN, new AbortController().signal) as Extract<Awaited<ReturnType<typeof api.readCalendar>>, { status: "read" }>;
    expect(res.status).toBe("read");
    expect(res.events[0]!.title).toBe("");
    expect(res.events[0]!.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect((res.events[0] as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(res.nextPageToken).toBe("npt1");
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.events)).toBe(true);
    expect(Object.isFrozen(res.events[0]!)).toBe(true);
    // never paginated: single fetch
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("supports dateTime and all-day date events", async () => {
    for (const items of [[[validEvent()]], [[{ id: "2", start: { date: "2026-01-01" }, end: { date: "2026-01-03" } }]]]) {
      const f = okFetcher({ items: items[0] });
      const { api } = reader(mkDeps({ fetcher: f }));
      expect((await api.readCalendar(BK, WIN, new AbortController().signal)).status).toBe("read");
    }
  });

  it("meetingUrl: hangout wins, fallback to video, unsafe => null without extra HTTP", async () => {
    const safe = "https://meet.google.com/abc-defg-hij";
    const videoSafe = "https://meet.google.com/aaa-bbbb-ccc";
    // hangout priority
    const r1 = await createGoogleCalendarReader(mkDeps({ fetcher: okFetcher({ items: [{ ...validEvent({ hangoutLink: safe, conferenceData: { entryPoints: [{ entryPointType: "video", uri: videoSafe }] } }) }] }) })).readCalendar(BK, WIN, new AbortController().signal) as Extract<Awaited<ReturnType<ReturnType<typeof createGoogleCalendarReader>["readCalendar"]>>, { status: "read" }>;
    expect(r1.events[0]!.meetingUrl).toBe(safe);
    // fallback
    const r2 = await createGoogleCalendarReader(mkDeps({ fetcher: okFetcher({ items: [{ ...validEvent({ conferenceData: { entryPoints: [{ entryPointType: "video", uri: videoSafe }] } }) }] }) })).readCalendar(BK, WIN, new AbortController().signal) as Extract<Awaited<ReturnType<ReturnType<typeof createGoogleCalendarReader>["readCalendar"]>>, { status: "read" }>;
    expect(r2.events[0]!.meetingUrl).toBe(videoSafe);
    // absent => null
    const r3 = await createGoogleCalendarReader(mkDeps({ fetcher: okFetcher({ items: [validEvent()] }) })).readCalendar(BK, WIN, new AbortController().signal) as Extract<Awaited<ReturnType<ReturnType<typeof createGoogleCalendarReader>["readCalendar"]>>, { status: "read" }>;
    expect(r3.events[0]!.meetingUrl).toBeNull();
    // evil variants => null and single fetch
    const evils = ["http://meet.google.com/abc-defg-hij", "https://evil.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij?x=1", "https://meet.google.com/abc-defg-hij#h", "https://meet.google.com:443/abc-defg-hij", "https://meet.google.com/%61bc-defg-hij", "https://user:pass@meet.google.com/abc-defg-hij", "https://meet.google.com/ABC-DEFG-HIJ"];
    for (const evil of evils) {
      const f = vi.fn<typeof fetch>(async () => jsonResp({ items: [{ ...validEvent({ hangoutLink: evil }) }] }));
      const res = await createGoogleCalendarReader(mkDeps({ fetcher: f as unknown as typeof fetch })).readCalendar(BK, WIN, new AbortController().signal) as Extract<Awaited<ReturnType<ReturnType<typeof createGoogleCalendarReader>["readCalendar"]>>, { status: "read" }>;
      expect(res.events[0]!.meetingUrl).toBeNull();
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("validates window: only timeMin/timeMax, RFC3339 strict, calendrical, increasing <=7d", async () => {
    const bad: unknown[] = [
      { timeMin: TIME_MIN }, { timeMin: TIME_MIN, timeMax: TIME_MAX, extra: 1 }, { timeMin: "", timeMax: TIME_MAX }, { timeMin: TIME_MIN, timeMax: "not-rfc" },
      { timeMin: "2026-01-01T00:00:00", timeMax: TIME_MAX }, { timeMin: "2026-02-30T00:00:00Z", timeMax: TIME_MAX }, { timeMin: "2023-02-29T00:00:00Z", timeMax: TIME_MAX }, { timeMin: TIME_MAX, timeMax: TIME_MIN }, { timeMin: TIME_MIN, timeMax: TIME_MIN }, { timeMin: TIME_MIN, timeMax: "2026-01-10T00:00:00Z" }, { timeMin: "2026-04-31T00:00:00Z", timeMax: TIME_MAX },
    ];
    for (const w of bad) {
      const f = vi.fn<typeof fetch>(async () => jsonResp({ items: [] }));
      const res = await createGoogleCalendarReader(mkDeps({ fetcher: f as unknown as typeof fetch })).readCalendar(BK, w as never, new AbortController().signal);
      expect(res.status).toBe("unavailable"); expect(f).not.toHaveBeenCalled();
    }
    // leap valid
    const f2 = vi.fn<typeof fetch>(async () => jsonResp({ items: [] }));
    expect((await createGoogleCalendarReader(mkDeps({ fetcher: f2 as unknown as typeof fetch })).readCalendar(BK, { timeMin: "2024-02-29T00:00:00Z", timeMax: "2024-03-01T00:00:00Z" }, new AbortController().signal)).status).toBe("read");
  });

  it("zero fetch on unknown input keys / invalid token / not current / aborted", async () => {
    for (const deps of [mkDeps({ getToken: () => null }), mkDeps({ isCurrent: () => false })]) {
      const f = deps.fetcher as unknown as ReturnType<typeof vi.fn>; expect((await createGoogleCalendarReader(deps).readCalendar(BK, WIN, new AbortController().signal)).status).toBe("unavailable"); expect(f).not.toHaveBeenCalled();
    }
    const ac = new AbortController(); ac.abort();
    const f = vi.fn<typeof fetch>(async () => jsonResp({ items: [] }));
    expect((await createGoogleCalendarReader(mkDeps({ fetcher: f as unknown as typeof fetch })).readCalendar(BK, WIN, ac.signal)).status).toBe("unavailable"); expect(f).not.toHaveBeenCalled();
    expect((await createGoogleCalendarReader(mkDeps({ fetcher: vi.fn<typeof fetch>(async () => jsonResp({ items: [] })) as unknown as typeof fetch })).readCalendar("", WIN, new AbortController().signal)).status).toBe("unavailable");
  });

it("after fetch: changed current/token/abort => unavailable", async () => {
	for (const boundary of ["fetch", "json"] as const) {
		for (const change of ["current", "token", "abort"] as const) {
			let current = true;
			let token: string | null = TOK;
			const ctrl = new AbortController();
			let doChange: () => void;

			const fetcher = vi.fn<typeof fetch>(async () => {
				if (boundary === "fetch") {
					doChange();
				}
				if (boundary === "json") {
					return Object.defineProperty(jsonResp({ items: [] }), "json", {
						value: async () => {
							doChange();
							return { items: [] };
						},
					});
				}
				return jsonResp({ items: [] });
			});

			const reader = createGoogleCalendarReader({
				fetcher: fetcher,
				getToken: () => token,
				isCurrent: () => current,
			});

			doChange = () => {
				if (change === "current") current = false;
				if (change === "token") token = null;
				if (change === "abort") ctrl.abort();
			};

			const promise = reader.readCalendar(BK, WIN, ctrl.signal);

			if (boundary === "fetch") {
				await Promise.resolve();
			}

			await expect(promise).resolves.toEqual({ status: "unavailable" });
			expect(fetcher).toHaveBeenCalledTimes(1);
		}
	}
});


  it("provider shape errors => unavailable", async () => {
    const badBodies: unknown[] = [
      null, [], { items: "nope" }, { items: null }, { items: Array.from({ length: 26 }, (_, i) => validEvent({ id: "id" + i })) },
      { items: [{ id: 123, start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX } }] }, { items: [{ id: "", start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX } }] },
      { items: [{ id: "1", summary: 123, start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX } }] }, { items: [{ id: "1", start: "bad", end: { dateTime: TIME_MAX } }] },
      { items: [{ id: "1", start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MIN } }] }, { items: [{ id: "1", start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }] },
      { items: [{ id: "1", start: { dateTime: TIME_MIN, date: "2026-01-01" }, end: { dateTime: TIME_MAX } }] }, { items: [{ id: "1", start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX }, hangoutLink: 123 }] },
      { items: [{ id: "1", start: { dateTime: TIME_MIN }, end: { dateTime: TIME_MAX }, conferenceData: { entryPoints: [{ entryPointType: "video" }] } }] }, { nextPageToken: 123, items: [] }, { nextPageToken: "", items: [] },
    ];
    for (const b of badBodies) {
      const res = await createGoogleCalendarReader(mkDeps({ fetcher: okFetcher(b) })).readCalendar(BK, WIN, new AbortController().signal);
      expect(res.status).toBe("unavailable");
    }
  });

  it("http errors / json throw / network throw => unavailable no retry no leak", async () => {
    const f500 = vi.fn<typeof fetch>(async () => new Response("err", { status: 500 })); expect((await createGoogleCalendarReader(mkDeps({ fetcher: f500 as unknown as typeof fetch })).readCalendar(BK, WIN, new AbortController().signal)).status).toBe("unavailable"); expect(f500).toHaveBeenCalledTimes(1);
    const fBadJson = vi.fn<typeof fetch>(async () => new Response("not-json", { status: 200 })); const r2 = await createGoogleCalendarReader(mkDeps({ fetcher: fBadJson as unknown as typeof fetch })).readCalendar(BK, WIN, new AbortController().signal); expect(r2.status).toBe("unavailable"); expect((r2 as unknown as Record<string, unknown>).token).toBeUndefined();
    const fThrow = vi.fn<typeof fetch>(async () => { throw new Error("net"); }); const r3 = await createGoogleCalendarReader(mkDeps({ fetcher: fThrow as unknown as typeof fetch })).readCalendar(BK, WIN, new AbortController().signal); expect(r3.status).toBe("unavailable"); expect((r3 as unknown as Record<string, unknown>).error).toBeUndefined(); expect(fThrow).toHaveBeenCalledTimes(1);
  });
});
