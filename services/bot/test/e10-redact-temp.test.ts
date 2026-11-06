import { afterEach, describe, expect, it, vi } from "vitest";
import { GlimmerClient, parseGlimmerAnswer } from "../src/private/redact.js";

function mockChat(content = '{"spans":[],"boxes":[]}') {
  const body = {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  };
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    })),
  );
}

describe("E10 redact temperature", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("E10-1: redactText body has temperature 0 and no top_p/top_k", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("E10-2: redactImage body has temperature 0 and no top_p/top_k", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactImage(Buffer.from([1, 2, 3]), "shot.png");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("E10-3: every JSON literal the prompt tells the model to return passes the real validator", async () => {
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    const system = (body.messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "system",
    )?.content as string;
    expect(system).toContain("never guess");
    // Collect each JSON literal the prompt instructs the model to return:
    // a case-insensitive whole word "return" or "use", whitespace, then "{" or "[".
    const literals: unknown[] = [];
    const re = /\b(?:return|use)\b\s*([{\[])/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(system)) !== null) {
      const start = m.index + m[0].length - 1;
      const open = system[start] as string;
      const close = open === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let i = start; i < system.length; i += 1) {
        const ch = system[i] as string;
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
        } else if (ch === "{" || ch === "[") {
          depth += 1;
        } else if (ch === "}" || ch === "]") {
          depth -= 1;
          if (depth === 0) {
            void close;
            end = i;
            break;
          }
        }
      }
      expect(end).toBeGreaterThan(start);
      literals.push(JSON.parse(system.slice(start, end + 1)));
    }
    expect(literals.length).toBeGreaterThanOrEqual(2);
    for (const literal of literals) {
      const hasSpans =
        typeof literal === "object" &&
        literal !== null &&
        !Array.isArray(literal) &&
        Array.isArray((literal as { spans?: unknown }).spans) &&
        ((literal as { spans: unknown[] }).spans.length > 0);
      const inputText = hasSpans ? "Call Ana at 555-0100" : "";
      expect(() => parseGlimmerAnswer(inputText, JSON.stringify(literal), "stop")).not.toThrow();
    }
  });
});
