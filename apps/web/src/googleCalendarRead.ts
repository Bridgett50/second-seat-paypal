type CalendarReadWindow = Readonly<{
  timeMin: string;
  timeMax: string;
}>;

export type CalendarEvent = Readonly<{
  id: string;
  title: string;
  start: string;
  end: string;
  meetingUrl: string | null;
}>;

export type CalendarReadSuccess = Readonly<{
  status: "read";
  events: readonly CalendarEvent[];
  nextPageToken: string | null;
}>;

export type CalendarReadUnavailable = Readonly<{
  status: "unavailable";
}>;

export type CalendarReadResult = CalendarReadSuccess | CalendarReadUnavailable;

type ReaderDeps = Readonly<{
  fetcher: typeof fetch;
  getToken: (browserKey: string) => string | null;
  isCurrent: (browserKey: string) => boolean;
}>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOwn(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isFiniteString(s: unknown, max: number): s is string {
  return typeof s === "string" && s.length <= max && s.length > 0 && Number.isFinite(s.length);
}

function isValidRFC3339WithTZ(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 60) return false;
  if (m[8] !== "Z") {
    const tz = m[8] as string;
    const th = Number(tz.slice(1, 3));
    const tm = Number(tz.slice(4, 6));
    const sign = tz[0];
    if (sign !== "+" && sign !== "-") return false;
    if (th > 23 || tm > 59) return false;
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return false;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return false;
  const frac = m[7];
  if (frac !== undefined && frac.length > 9) return false;
  // calendrical validation via UTC reconstruction for date part
  // We validate Y/M/D are calendrically valid by checking Date.UTC round-trip for that date
  const dim = daysInMonth(y, mo);
  if (d > dim) return false;
  return true;
}

function isValidDateOnly(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (d > daysInMonth(y, mo)) return false;
  return true;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function checkAbort(signal: AbortSignal): boolean {
  return signal.aborted === true;
}

function unavailable(): CalendarReadUnavailable {
  const r: CalendarReadUnavailable = { status: "unavailable" };
  return Object.freeze(r) as CalendarReadUnavailable;
}

function freezeResult(r: CalendarReadSuccess): CalendarReadSuccess {
  for (const e of r.events) Object.freeze(e);
  Object.freeze(r.events);
  return Object.freeze(r) as CalendarReadSuccess;
}

function validateWindow(w: unknown): { timeMin: string; timeMax: string } | null {
  if (!isRecord(w as unknown as Record<string, unknown>)) return null;
  const rec = w as Record<string, unknown>;
  if (!hasOwn(rec, "timeMin") || !hasOwn(rec, "timeMax")) return null;
  const keys = Object.keys(rec);
  if (keys.length !== 2) return null;
  if (!keys.includes("timeMin") || !keys.includes("timeMax")) return null;
  const timeMin = rec["timeMin"];
  const timeMax = rec["timeMax"];
  if (typeof timeMin !== "string" || typeof timeMax !== "string") return null;
  if (timeMin === "" || timeMax === "") return null;
  if (!isValidRFC3339WithTZ(timeMin) || !isValidRFC3339WithTZ(timeMax)) return null;
  const a = Date.parse(timeMin);
  const b = Date.parse(timeMax);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (!(a < b)) return null;
  const diff = b - a;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (diff > sevenDaysMs) return null;
  return { timeMin, timeMax };
}

const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function isSafeMeetUrl(s: string): boolean {
  if (!MEET_RE.test(s)) return false;
  // Ensure no credentials/port/encoded tricks - regex already enforces exact
  // Additional URL parse check to reject credentials/port etc.
  try {
    const u = new URL(s);
    if (u.host !== "meet.google.com") return false;
    if (u.username !== "" || u.password !== "") return false;
    if (u.port !== "") return false;
    if (u.hash !== "") return false;
    if (u.search !== "") return false;
    // pathname already validated; ensure no encoded slash
    if (s.includes("%2F") || s.includes("%2f") || s.includes("%")) return false;
    return true;
  } catch {
    return false;
  }
}

function extractMeetingUrl(item: Record<string, unknown>): string | null | "invalid" {
  let hangout: string | null = null;
  if (hasOwn(item, "hangoutLink")) {
    const hl = item["hangoutLink"];
    if (hl === undefined) {
      // absent treated as no value? spec says fields limits expected projection; if present it should be string
      // undefined shouldn't occur via JSON, but treat as invalid if explicitly present as non-string?
      // hasOwn true with undefined => reject
      return "invalid";
    }
    // if present, must be string with reasonable size
    if (typeof hl !== "string") return "invalid";
    if (hl.length > 2048) return "invalid";
    if (hl.length === 0) {
      // empty string is not a valid URL, treat as unsafe => null? But spec says bound reasonable sizes; empty invalid shape?
      // safest: treat empty as invalid shape -> unavailable
      return "invalid";
    }
    hangout = hl;
  }

  let videoUrl: string | null = null;
  let hasVideoSection = false;

  if (hasOwn(item, "conferenceData")) {
    const cd = item["conferenceData"];
    if (cd === null || cd === undefined) return "invalid";
    if (!isRecord(cd)) return "invalid";
    // conferenceData should only contain known? but spec says reject non-object invalid shapes; allow unknown keys silently?
    // Validate entryPoints if present
    if (hasOwn(cd, "entryPoints")) {
      const eps = (cd as Record<string, unknown>)["entryPoints"];
      if (eps === undefined) return "invalid";
      if (!Array.isArray(eps)) return "invalid";
      hasVideoSection = true;
      for (const ep of eps) {
        if (!isRecord(ep)) return "invalid";
        if (!hasOwn(ep, "entryPointType") || !hasOwn(ep, "uri")) return "invalid";
        const t = (ep as Record<string, unknown>)["entryPointType"];
        const u = (ep as Record<string, unknown>)["uri"];
        if (typeof t !== "string" || typeof u !== "string") return "invalid";
        if (t.length === 0 || t.length > 256) return "invalid";
        if (u.length === 0 || u.length > 2048) return "invalid";
        // Only consider video entries
        if (t === "video" && videoUrl === null) {
          videoUrl = u;
        }
      }
    }
    // if conferenceData present but has no entryPoints, it's okay (no video url)
    // Validate that conferenceData doesn't contain non-record unexpected types for known keys
    // unknown unrelated provider keys in conferenceData are allowed to be ignored, but ensure no invalid types for expected keys already checked
    void hasVideoSection;
  }

  // Priority: hangoutLink first
  if (hangout !== null) {
    if (isSafeMeetUrl(hangout)) return hangout;
    // unsafe => return null and never follow, but still consider? spec: Unsafe strings return null
    // If hangoutLink unsafe, do we fallback to video? Spec: From hangoutLink first else video entryPoints.
    // Means if hangoutLink present (even unsafe) we don't fallback? Wording: "From hangoutLink first else video entryPoints. Unsafe strings return null"
    // Interpret as: if hangoutLink exists, use it if safe else null (don't fallback). If no hangoutLink, try video.
    return null;
  }
  if (videoUrl !== null) {
    if (isSafeMeetUrl(videoUrl)) return videoUrl;
    return null;
  }
  return null;
}

function parseEventTime(
  container: Record<string, unknown>,
  field: string,
): { kind: "dateTime" | "date"; value: string } | null | "invalid" {
  if (!hasOwn(container, field)) return null;
  const v = container[field];
  if (!isRecord(v)) return "invalid";
  const rec = v as Record<string, unknown>;
  const hasDateTime = hasOwn(rec, "dateTime");
  const hasDate = hasOwn(rec, "date");
  // must have exactly one of dateTime or date
  if (hasDateTime === hasDate) return "invalid";
  if (hasDateTime) {
    const dt = rec["dateTime"];
    if (typeof dt !== "string") return "invalid";
    if (dt.length === 0 || dt.length > 256) return "invalid";
    if (!isValidRFC3339WithTZ(dt)) return "invalid";
    return { kind: "dateTime", value: dt };
  } else {
    const d = rec["date"];
    if (typeof d !== "string") return "invalid";
    if (d.length === 0 || d.length > 32) return "invalid";
    if (!isValidDateOnly(d)) return "invalid";
    return { kind: "date", value: d };
  }
}

export function createGoogleCalendarReader(deps: ReaderDeps): {
  readCalendar: (
    browserKey: string,
    window: Readonly<{ timeMin: string; timeMax: string }>,
    signal: AbortSignal,
  ) => Promise<CalendarReadResult>;
} {
  const { fetcher, getToken, isCurrent } = deps;

  async function readCalendar(
    browserKey: string,
    window: Readonly<{ timeMin: string; timeMax: string }>,
    signal: AbortSignal,
  ): Promise<CalendarReadResult> {
    try {
      if (typeof browserKey !== "string" || browserKey.length === 0) return unavailable();
      if (checkAbort(signal)) return unavailable();

      const win = validateWindow(window as unknown);
      if (win === null) return unavailable();

      const token = getToken(browserKey);
      if (typeof token !== "string" || token.length === 0) return unavailable();
      if (!isCurrent(browserKey)) return unavailable();
      if (checkAbort(signal)) return unavailable();

      const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
      const qs = new URLSearchParams({
        timeMin: win.timeMin,
        timeMax: win.timeMax,
        maxResults: "25",
        singleEvents: "true",
        orderBy: "startTime",
        fields:
          "items(id,summary,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri))),nextPageToken",
      });
      const url = `${base}?${qs.toString()}`;

      let resp: Response;
      try {
        resp = await fetcher(url, {
          method: "GET",
          redirect: "error",
          signal: signal,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        return unavailable();
      }

      if (checkAbort(signal)) return unavailable();
      if (!isCurrent(browserKey)) return unavailable();
      const tok2 = getToken(browserKey);
      if (typeof tok2 !== "string" || tok2.length === 0) return unavailable();
      if (tok2 !== token) return unavailable();

      if (!resp.ok) return unavailable();

      let body: unknown;
      try {
        body = await resp.json();
      } catch {
        return unavailable();
      }

      if (checkAbort(signal)) return unavailable();
      if (!isCurrent(browserKey)) return unavailable();
      const tok3 = getToken(browserKey);
      if (typeof tok3 !== "string" || tok3.length === 0) return unavailable();
      if (tok3 !== token) return unavailable();

      if (!isRecord(body)) return unavailable();

      // nextPageToken
      let nextPageToken: string | null = null;
      if (hasOwn(body, "nextPageToken")) {
        const npt = (body as Record<string, unknown>)["nextPageToken"];
        if (npt === null) {
          nextPageToken = null;
        } else if (typeof npt === "string") {
          if (npt.length === 0 || npt.length > 2048) return unavailable();
          if (!Number.isFinite(npt.length)) return unavailable();
          nextPageToken = npt;
        } else {
          return unavailable();
        }
      }

      // items
      let items: unknown[] = [];
      if (hasOwn(body, "items")) {
        const rawItems = (body as Record<string, unknown>)["items"];
        if (rawItems === undefined || rawItems === null) return unavailable();
        if (!Array.isArray(rawItems)) return unavailable();
        if (rawItems.length > 25) return unavailable();
        items = rawItems;
      }

      const events: CalendarEvent[] = [];

      for (const raw of items) {
        if (!isRecord(raw)) return unavailable();

        if (!hasOwn(raw, "id")) return unavailable();
        const id = (raw as Record<string, unknown>)["id"];
        if (typeof id !== "string" || id.length === 0 || id.length > 1024) return unavailable();
        if (!Number.isFinite(id.length)) return unavailable();

        // summary optional
        let title = "";
        if (hasOwn(raw, "summary")) {
          const s = (raw as Record<string, unknown>)["summary"];
          if (typeof s !== "string") return unavailable();
          if (s.length > 4096) return unavailable();
          if (!Number.isFinite(s.length)) return unavailable();
          title = s;
        }

        if (!hasOwn(raw, "start") || !hasOwn(raw, "end")) return unavailable();

        const startRaw = (raw as Record<string, unknown>)["start"];
        const endRaw = (raw as Record<string, unknown>)["end"];
        if (!isRecord(startRaw) || !isRecord(endRaw)) return unavailable();

        const parsedStart = parseEventTime(raw as Record<string, unknown>, "start");
        if (parsedStart === "invalid" || parsedStart === null) return unavailable();

        const parsedEnd = parseEventTime(raw as Record<string, unknown>, "end");
        if (parsedEnd === "invalid" || parsedEnd === null) return unavailable();

        // parsedStart/end are guaranteed non-null here
        const ps = parsedStart as { kind: string; value: string };
        const pe = parsedEnd as { kind: string; value: string };

        // end must be strictly after start
        let startMs: number;
        let endMs: number;
        if (ps.kind === "date" && pe.kind === "date") {
          // date-only: compare lexicographically or via Date.UTC
          // Use UTC midnight
          startMs = Date.parse(ps.value + "T00:00:00Z");
          endMs = Date.parse(pe.value + "T00:00:00Z");
        } else if (ps.kind === "dateTime" && pe.kind === "dateTime") {
          startMs = Date.parse(ps.value);
          endMs = Date.parse(pe.value);
        } else {
          // mixed kinds: compare by parsing date as midnight UTC vs dateTime
          const sMs = ps.kind === "date" ? Date.parse(ps.value + "T00:00:00Z") : Date.parse(ps.value);
          const eMs = pe.kind === "date" ? Date.parse(pe.value + "T00:00:00Z") : Date.parse(pe.value);
          startMs = sMs;
          endMs = eMs;
        }
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return unavailable();
        if (!(endMs > startMs)) return unavailable();

        const mu = extractMeetingUrl(raw as Record<string, unknown>);
        if (mu === "invalid") return unavailable();
        const meetingUrl: string | null = mu;

        const ev: CalendarEvent = {
          id: id,
          title: title,
          start: ps.value,
          end: pe.value,
          meetingUrl: meetingUrl,
        };
        Object.freeze(ev);
        events.push(ev);
      }

      const result: CalendarReadSuccess = {
        status: "read",
        events: events,
        nextPageToken: nextPageToken,
      };
      return freezeResult(result);
    } catch {
      return unavailable();
    }
  }

  return { readCalendar };
}
