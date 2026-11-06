/**
 * Test-mode network guard for the web server.
 *
 * When SECOND_SEAT_TEST_MODE === "1", installNetGuard() wraps globalThis.fetch
 * so any request whose host is not loopback is rejected with
 * "outside network blocked in test mode" and counted. recordAnalyzerCall()
 * tracks the approved texts handed to the (offline fake) analyzer.
 */

export interface OutboundStats {
  blockedOutside: number;
  analyzerCalls: string[];
}

let blockedOutside = 0;
const analyzerCalls: string[] = [];
let installed = false;

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function installNetGuard(): void {
  if (process.env.SECOND_SEAT_TEST_MODE !== "1") return;
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const guarded = async (input: unknown, init?: unknown): Promise<Response> => {
    let href: string | null = null;
    if (typeof input === "string") href = input;
    else if (input instanceof URL) href = input.href;
    else if (typeof Request !== "undefined" && input instanceof Request) href = input.url;
    if (href !== null) {
      let host = "";
      try {
        host = new URL(href).hostname;
      } catch {
        host = "";
      }
      if (host !== "" && !isLoopback(host)) {
        blockedOutside += 1;
        throw new Error(`outside network blocked in test mode: ${host}`);
      }
    }
    return (originalFetch as (...args: unknown[]) => Promise<Response>)(input, init);
  };
  globalThis.fetch = guarded as typeof fetch;
}

export function recordAnalyzerCall(text: string): void {
  analyzerCalls.push(text);
}

export function outboundStats(): OutboundStats {
  return { blockedOutside, analyzerCalls: [...analyzerCalls] };
}
