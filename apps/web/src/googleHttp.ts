import type { createGoogleConnections } from "./googleConnections.js";
import { GOOGLE_SCOPES } from "./googleOAuthUrl.js";

export type GoogleRequest = { method: string; path: string; callerKey: string | null; origin: string | null; body: unknown; query: URLSearchParams };
export type GoogleReply = { status: number; headers: Record<string, string>; body: unknown };

const ALLOWED = new Map<string, string>([
  ["/api/google/connect", "POST"],
  ["/api/google/status", "GET"],
  ["/api/google/disconnect", "POST"],
  ["/api/google/oauth/callback", "GET"],
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function createGoogleHttp(opts: { connections: ReturnType<typeof createGoogleConnections>; origin: string }) {
  const u = new URL(opts.origin);
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1" || u.hostname === "[::1]";
  const okProto = u.protocol === "https:" || (u.protocol === "http:" && isLocal);
  if (u.origin !== opts.origin || !okProto || u.username !== "" || u.password !== "") throw new Error("Invalid Google origin configuration");
  const base: Record<string, string> = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Type": "application/json;charset=utf-8",
  };
  const json = (status: number, body: unknown, extra?: Record<string, string>): GoogleReply => ({ status, headers: { ...base, ...extra }, body });
  const redirect = (connected: boolean): GoogleReply => ({
    status: 303,
    headers: { ...base, Location: connected ? "/meeting-room?google=connected" : "/meeting-room?google=not-connected" },
    body: null,
  });
  return async (req: GoogleRequest): Promise<GoogleReply> => {
    const expected = ALLOWED.get(req.path);
    if (!expected) return json(404, { error: "Not found" });
    if (req.method !== expected) return json(405, { error: "Method not allowed" }, { Allow: expected });
    if (req.callerKey === null) return json(401, { error: "Unauthorized" });
    if (req.path === "/api/google/status") {
      return json(200, { connections: opts.connections.status(req.callerKey) });
    }
    if (req.path === "/api/google/oauth/callback") {
      const stateAll = req.query.getAll("state");
      const codeAll = req.query.getAll("code");
      const errAll = req.query.getAll("error");
      if (stateAll.length !== 1 || codeAll.length > 1 || errAll.length > 1) return redirect(false);
      const code = errAll.length === 1 ? "" : (req.query.get("code") ?? "");
      let ok = false;
      try { ok = await opts.connections.complete(req.callerKey, stateAll[0], code); } catch { ok = false; }
      return redirect(ok);
    }
    if (req.origin !== opts.origin) return json(403, { error: "Forbidden" });
    if (!isPlainObject(req.body)) return json(400, { error: "Invalid request body" });
    if (req.path === "/api/google/connect") {
      const keys = Object.keys(req.body);
      const purposeVal = req.body["purpose"];
      if (keys.length !== 1 || keys[0] !== "purpose" || typeof purposeVal !== "string" || !Object.prototype.hasOwnProperty.call(GOOGLE_SCOPES, purposeVal)) {
        return json(400, { error: "Invalid purpose" });
      }
      try {
        const purpose = purposeVal as keyof typeof GOOGLE_SCOPES;
        const { url, expiresAt } = opts.connections.begin(req.callerKey, purpose);
        return json(200, { authorizationUrl: url, expiresAt });
      } catch { return json(503, { error: "Google connection unavailable" }); }
    }
    if (Object.keys(req.body).length !== 0) return json(400, { error: "Invalid request body" });
    opts.connections.disconnect(req.callerKey);
    return json(200, { disconnected: true });
  };
}
