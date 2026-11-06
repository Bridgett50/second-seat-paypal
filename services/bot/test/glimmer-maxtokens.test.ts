import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLIMMER_MAX_TOKENS_DEFAULT, GlimmerClient, extractGlimmerJson } from "../src/private/redact.js";

function mockChat(content = '{"spans":[],"boxes":[]}') {
  const body = { choices: [{ message: { content } }] };
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

describe("glimmer chat max_tokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GLIMMER_MAX_TOKENS"];
    delete process.env["GLIMMER_RAW_DIR"];
    delete process.env["GLIMMER_TIMEOUT_MS"];
    delete process.env["GLIMMER_JSON_SCHEMA"];
  });

  it("includes default max_tokens in the request body", async () => {
    mockChat();
    const client = new GlimmerClient("http://localhost:9");
    await client.redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(GLIMMER_MAX_TOKENS_DEFAULT);
    expect(GLIMMER_MAX_TOKENS_DEFAULT).toBe(2048);
  });

  it("honours GLIMMER_MAX_TOKENS env", async () => {
    process.env["GLIMMER_MAX_TOKENS"] = "512";
    mockChat();
    const client = new GlimmerClient("http://localhost:9");
    await client.redactText("hello");
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(512);
  });
});

describe("extractGlimmerJson", () => {
  it("never parses reasoning_content: empty content is an error", () => {
    const body = {
      choices: [{ message: { content: "", reasoning_content: '{"spans":[],"boxes":[]}' } }],
    };
    expect(() => extractGlimmerJson(body)).toThrow("glimmer: no JSON in reply");
  });

  it("throws on finish_reason=length without parsing", () => {
    const body = {
      choices: [
        {
          message: { content: '{"spans":[],"boxes":[]}' },
          finish_reason: "length",
        },
      ],
    };
    expect(() => extractGlimmerJson(body)).toThrow("glimmer: finish_reason=length");
  });

  it("extracts fenced JSON", () => {
    const body = {
      choices: [{ message: { content: '```json\n{"spans":[],"boxes":[]}\n```' } }],
    };
    expect(extractGlimmerJson(body)).toEqual({ spans: [], boxes: [] });
  });

  it("throws a descriptive error when no JSON is present", () => {
    const body = { choices: [{ message: { content: "" }, finish_reason: "stop" }] };
    expect(() => extractGlimmerJson(body)).toThrow(
      "glimmer: no JSON in reply (finish_reason=stop, len=0)",
    );
  });

  it("appends one JSON line per reply when GLIMMER_RAW_DIR is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glimmer-raw-"));
    process.env["GLIMMER_RAW_DIR"] = dir;
    mockChat();
    await new GlimmerClient("http://localhost:9").redactText("hello");
    const lines = (await readFile(join(dir, "glimmer-raw.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] as string) as {
      kind: unknown;
      status: unknown;
      content: unknown;
      contentLen: unknown;
      finishReason: unknown;
    };
    expect(row.kind).toBe("text");
    expect(row.status).toBe(200);
    expect(row.content).toContain("spans");
    expect(row.contentLen).toBe((row.content as string).length);
  });
});
