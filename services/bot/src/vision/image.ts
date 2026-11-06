/**
 * Muse Image live client (Phase 07 hero chain).
 *
 * - `ImageClient` interface: live (`LiveImageClient`, via fetch) and
 *   recorded (`FixtureImageClient`) implementations share it.
 * - Model `muse-image-1.0` via POST https://api.meta.ai/v1/images/generations.
 * - Fixture mode is the default (no network). Live mode is experimental,
 *   outside the text-only core flow, and off by default (requires
 *   SECOND_SEAT_EXPERIMENTAL_IMAGES=1). Without an API key, only
 *   fixture mode is available. Never prints the key.
 */

export const IMAGE_MODEL = "muse-image-1.0";
export const IMAGE_API_URL = "https://api.meta.ai/v1/images/generations";

export interface GeneratedImage {
  png: Buffer;
  model: string;
  fixture: boolean;
  /** Provider metadata (size, revised prompt); saved with fixtures. */
  meta: Record<string, unknown>;
}

export interface ImageClient {
  readonly mode: "fixture" | "live";
  generate(prompt: string): Promise<GeneratedImage>;
}

function apiKey(): string | null {
  const key =
    process.env["MODEL_API_KEY"] ??
    process.env["META_API_KEY"] ??
    process.env["MUSE_API_KEY"] ??
    "";
  return key === "" ? null : key;
}

/**
 * Image generation is experimental, outside the text-only core flow, and off
 * by default. Live calls require SECOND_SEAT_EXPERIMENTAL_IMAGES=1.
 */
export function imagesExperimentalEnabled(): boolean {
  return process.env["SECOND_SEAT_EXPERIMENTAL_IMAGES"] === "1";
}

/** True when no API key is configured: fixture-only. */
export function isImageFixtureOnly(): boolean {
  return apiKey() === null;
}

/**
 * Deterministic fixture slide: white canvas with a dark band where the
 * date line lives. Used in fixture mode and as the hand-made fallback when
 * the live Image call fails twice (Creative Build claim is then dropped).
 */
export function fixtureSlidePng(): Buffer {
  // Reuse the repo's dependency-free minimal PNG writer approach.
  // 800x400 white RGB; dark band marks the date region (SYNTHETIC label
  // is burned in by the hero-chain script via sidecar note, not pixels).
  const W = 800;
  const H = 400;
  const px = Buffer.alloc(W * H * 3, 255);
  for (let y = 280; y < 320; y += 1) {
    for (let x = 80; x < 560; x += 1) {
      px[(y * W + x) * 3] = 20;
      px[(y * W + x) * 3 + 1] = 20;
      px[(y * W + x) * 3 + 2] = 20;
    }
  }
  return encodePng(W, H, px);
}

function encodePng(w: number, h: number, px: Buffer): Buffer {
  const { deflateSync } = process.getBuiltinModule("node:zlib") as typeof import("node:zlib");
  const filtered = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y += 1) {
    filtered[y * (w * 3 + 1)] = 0;
    px.copy(filtered, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = (table[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const td = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const cc = Buffer.alloc(4);
    cc.writeUInt32BE(crc(Buffer.concat([td, data])), 0);
    return Buffer.concat([len, td, data, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from(deflateSync(filtered))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export class FixtureImageClient implements ImageClient {
  readonly mode = "fixture" as const;

  async generate(prompt: string): Promise<GeneratedImage> {
    return {
      png: fixtureSlidePng(),
      model: IMAGE_MODEL,
      fixture: true,
      meta: { prompt, synthetic: true, handmade: true },
    };
  }
}

export class LiveImageClient implements ImageClient {
  readonly mode = "live" as const;

  async generate(prompt: string): Promise<GeneratedImage> {
    if (!imagesExperimentalEnabled()) {
      throw new Error("image: experimental and off by default (set SECOND_SEAT_EXPERIMENTAL_IMAGES=1)");
    }
    const key = apiKey();
    if (key === null) throw new Error("image: live mode but no API key (set MODEL_API_KEY)");
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(IMAGE_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(180_000),
          body: JSON.stringify({ model: IMAGE_MODEL, prompt }),
        });
        if (!res.ok) throw new Error(`image: generations failed with status ${res.status}`);
        const body = (await res.json()) as {
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        const first = body.data?.[0];
        if (first?.b64_json) {
          return {
            png: Buffer.from(first.b64_json, "base64"),
            model: IMAGE_MODEL,
            fixture: false,
            meta: { prompt, synthetic: true },
          };
        }
        throw new Error("image: response carried no image data");
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("image: generation failed twice");
  }
}

/** Fixture mode default; live only when IMAGE_MODE=live with an API key and SECOND_SEAT_EXPERIMENTAL_IMAGES=1. */
export function defaultImageClient(): ImageClient {
  if ((process.env["IMAGE_MODE"] ?? "fixture") === "live") {
    if (!imagesExperimentalEnabled()) {
      throw new Error("image: experimental and off by default (set SECOND_SEAT_EXPERIMENTAL_IMAGES=1)");
    }
    if (isImageFixtureOnly()) throw new Error("image: IMAGE_MODE=live but no API key (set MODEL_API_KEY)");
    return new LiveImageClient();
  }
  return new FixtureImageClient();
}
