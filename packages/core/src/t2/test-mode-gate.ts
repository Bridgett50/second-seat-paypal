/**
 * Server-side gate for the meeting room's fake send transport.
 *
 * The fake transport (sends are captured locally, nothing leaves the
 * machine) is only enabled when the operator opts in with exactly
 * `SECOND_SEAT_TEST_MODE=1` AND the request is addressed to a loopback host.
 * `Host` must be present and loopback; `X-Forwarded-Host`, when present,
 * must be loopback too (a proxy forwarding a public name never qualifies).
 * Any other value fails closed: sends stay disabled.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Hostname of a Host-style header value (`name[:port]`), lowercased, or null. */
function hostnameOf(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed.includes(",") || /\s/.test(trimmed)) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end < 0) return null;
    const rest = trimmed.slice(end + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return null;
    return trimmed.slice(0, end + 1);
  }
  const parts = trimmed.split(":");
  if (parts.length > 2) return null;
  if (parts.length === 2 && !/^\d{1,5}$/.test(parts[1] ?? "")) return null;
  return parts[0] ?? null;
}

/** True only for an exact loopback hostname (with an optional port). */
export function isLoopbackHost(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const name = hostnameOf(value);
  return name !== null && LOOPBACK_HOSTNAMES.has(name);
}

/**
 * Whether the meeting room may use its fake send transport for this request.
 */
export function fakeSendAllowed(input: {
  testModeEnv: string | undefined;
  host: string | null | undefined;
  forwardedHost: string | null | undefined;
}): boolean {
  if (input.testModeEnv !== "1") return false;
  if (!isLoopbackHost(input.host)) return false;
  if (input.forwardedHost !== null && input.forwardedHost !== undefined) {
    if (!isLoopbackHost(input.forwardedHost)) return false;
  }
  return true;
}
