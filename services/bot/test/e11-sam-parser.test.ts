import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeMaskToRLE, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import {
  FixtureSamClient,
  LiveSamClient,
  buildRequestBody,
  type SamFrame,
} from "../src/vision/sam.js";

const WIRE =
  "<0f>0<|box;x1=200;y1=140;x2=259;y2=166;w=800;h=400;c=0.87|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";

const EXPECTED_BOX = { x: 200, y: 140, w: 60, h: 27, confidence: 0.87 };

const FRAME: SamFrame = { id: "e11", width: 800, height: 400, png: Buffer.alloc(8) };

const ENV_KEYS = [
  "SECOND_SEAT_EXPERIMENTAL_IMAGES",
  "MODEL_API_KEY",
  "META_API_KEY",
  "MUSE_API_KEY",
  "SAM_MODE",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

function stubLiveFetch(sse: string): { sentBody: () => Record<string, unknown> } {
  let sentBody: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    (async (_url: unknown, init?: { body?: unknown }) => {
      sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return { ok: true, status: 200, text: async () => sse };
    }) as unknown as typeof fetch,
  );
  return { sentBody: () => sentBody };
}

function enableLive(): void {
  process.env["SECOND_SEAT_EXPERIMENTAL_IMAGES"] = "1";
  process.env["MODEL_API_KEY"] = "test-key-not-real";
  delete process.env["META_API_KEY"];
  delete process.env["MUSE_API_KEY"];
}

describe("E11 sam official parser", () => {
  it("E11-1: request metadata asks for confidence", () => {
    const body = buildRequestBody(FRAME, "slide");
    const metadata = body["metadata"] as Record<string, unknown>;
    expect(metadata["include_confidence"]).toBe("true");
    expect(metadata["mask_encoding"]).toBe("one_bit");
  });

  it("E11-2: default fixture runs the official parser with confidence", async () => {
    const result = await new FixtureSamClient().segmentShared(FRAME);
    expect(result.parser).toBe("@meta-sam/parser");
    expect(result.boxes).toEqual([EXPECTED_BOX]);
  });

  it("E11-3: live path handles the api.meta.ai shape (text only in content_part.done)", async () => {
    enableLive();
    const itemId = "msg_1";
    const lane = { item_id: itemId, output_index: 0, content_index: 0 };
    const events: unknown[] = [
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_item.added", output_index: 0, item: { id: itemId, type: "message" } },
      {
        type: "response.content_part.added",
        ...lane,
        part: { type: "output_text", text: "" },
      },
      {
        type: "response.content_part.done",
        ...lane,
        part: { type: "output_text", text: WIRE },
      },
      { type: "response.output_item.done", output_index: 0, item: { id: itemId, type: "message" } },
      { type: "response.completed", response: { id: "resp_1" } },
    ];
    const sse = `${events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
    const { sentBody } = stubLiveFetch(sse);

    const result = await new LiveSamClient().segmentShared(FRAME, "slide");
    expect(result.parser).toBe("@meta-sam/parser");
    expect(result.boxes).toEqual([EXPECTED_BOX]);
    const metadata = sentBody()["metadata"] as Record<string, unknown>;
    expect(metadata["include_confidence"]).toBe("true");
  });

  it("E11-3b: live path still accepts delta-only streams", async () => {
    enableLive();
    const lane = { item_id: "msg_1", output_index: 0, content_index: 0 };
    // Split inside the mask payload so no single delta is parseable alone.
    const cut = WIRE.indexOf("data=") + 10;
    const events: unknown[] = [
      { type: "response.output_text.delta", ...lane, delta: WIRE.slice(0, cut) },
      { type: "response.output_text.delta", ...lane, delta: WIRE.slice(cut) },
      { type: "response.output_text.done", ...lane, text: WIRE },
      { type: "response.completed" },
    ];
    const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

    stubLiveFetch(sse);

    const result = await new LiveSamClient().segmentShared(FRAME, "slide");
    expect(result.parser).toBe("@meta-sam/parser");
    expect(result.boxes).toEqual([EXPECTED_BOX]);
  });

  it("E11-4: object fixture still uses the local parser", async () => {
    const client = new FixtureSamClient({
      mask_encoding: "one_bit",
      boxes: [{ x1: 10, y1: 20, x2: 19, y2: 29 }],
    });
    const result = await client.segmentShared(FRAME);
    expect(result.parser).toBe("local");
    expect(result.boxes).toEqual([{ x: 10, y: 20, w: 10, h: 10 }]);
  });

  it("E11-5: fixture box matches its own mask raster through the parser", async () => {
    const result = await new FixtureSamClient().segmentShared(FRAME);
    const wire = result.raw as string;
    async function* stream(): AsyncGenerator<unknown, void, void> {
      yield {
        type: "response.content_part.done",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: wire },
      };
      yield { type: "response.completed" };
    }
    const parsed = parseImageStream(stream());
    for await (const _ of parsed) {
      /* drain the snapshot stream; the result accumulates in finalResult */
    }
    const final = await parsed.finalResult;
    const boxRecords = recordsOfKind(final.records, "box");
    const maskRecords = recordsOfKind(final.records, "mask");
    expect(boxRecords.length).toBeGreaterThan(0);
    expect(maskRecords.length).toBeGreaterThan(0);
    const [rows, cols] = decodeMaskToRLE(maskRecords[0]!.mask).size;
    expect(result.boxes[0]!.w).toBe(cols);
    expect(result.boxes[0]!.h).toBe(rows);
    expect(boxRecords[0]!.right - boxRecords[0]!.left).toBe(cols);
  });
});
