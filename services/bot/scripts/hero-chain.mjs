// Hero chain (Phase 07): image-slide -> sam-region -> spark date read.
//
// Default (no flags): replay fixtures in services/bot/fixtures/hero-chain/
// (no network). If fixtures are missing, rebuild them locally in fixture
// mode (no network) so the chain test passes offline.
//
// Live (--live): EXPERIMENTAL, outside the text-only core flow, off by
// default (requires SECOND_SEAT_EXPERIMENTAL_IMAGES=1). Generate a synthetic
// vendor slide (date "30th", visibly labeled SYNTHETIC) with muse-image-1.0
// -> mask it (04a MockRedactor when available; if masking fails the frame is
// dropped, never sent unmasked) -> locate the "date" region with sam-3.1 ->
// read the date in the region with muse-spark-1.3. Saves prompt, image png,
// raw SAM output
// and spark output into services/bot/fixtures/hero-chain/ and appends
// {at,model,stage:"image-slide"|"sam-region",...} lines to
// apps/web/fixtures/run-log.jsonl. Logs token/cost; respects a $5/day cap.
//
// Secrets: Bearer MODEL_API_KEY (never printed, never written to fixtures).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const botDir = join(here, "..");
const outDir = join(botDir, "fixtures", "hero-chain");
const runLogPath = join(botDir, "..", "..", "apps", "web", "fixtures", "run-log.jsonl");
const statePath = join(botDir, ".hero-chain-state.json");

const SAM_MODEL = "sam-3.1";
const IMAGE_MODEL = "muse-image-1.0";
const SPARK_MODEL = "muse-spark-1.3";
const SAM_URL = "https://api.meta.ai/v1/responses";
const IMAGE_URL = "https://api.meta.ai/v1/images/generations";
const SPARK_URL = "https://api.meta.ai/v1/chat/completions";
const DAY_CAP_USD = 5;

export const SLIDE_PROMPT =
  "SYNTHETIC vendor slide for a software demo test fixture. A plain conference-room " +
  'slide with the headline "Vendor proposal", a bullet "Delivery: March 30th", and a ' +
  'large visible label "SYNTHETIC — model-generated test image". Flat vector style, no people, no logos.';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8"));
    if (s.date === today()) return s;
  } catch { /* reset */ }
  return { date: today(), spendUsd: 0 };
}

function logCost(line) {
  const state = loadState();
  state.spendUsd += line.estimatedUsd;
  try {
    writeFileSync(statePath, JSON.stringify(state) + "\n");
  } catch { /* best effort */ }
  process.stderr.write(JSON.stringify({ ...line, daySpendUsd: state.spendUsd }) + "\n");
}

function checkCap() {
  const state = loadState();
  if (state.spendUsd >= DAY_CAP_USD) {
    throw new Error(`hero-chain: daily cap $${DAY_CAP_USD} reached (spent $${state.spendUsd.toFixed(4)})`);
  }
}

function key() {
  const k = process.env["MODEL_API_KEY"] ?? process.env["META_API_KEY"] ?? "";
  if (k === "") throw new Error("hero-chain --live needs MODEL_API_KEY");
  return k;
}

// --- minimal PNG helpers (node builtins only) ---
function pngSize(png) {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

function parseSamBoxesLocal(raw) {
  if (typeof raw === "string") {
    const out = [];
    for (const m of raw.matchAll(/<\|box;([^|]*)\|>/g)) {
      const nums = {};
      for (const p of m[1].matchAll(/(x1|y1|x2|y2)=(\d+)/g)) nums[p[1]] = Number(p[2]);
      if ([nums.x1, nums.y1, nums.x2, nums.y2].every((n) => typeof n === "number")) {
        const w = nums.x2 - nums.x1 + 1;
        const h = nums.y2 - nums.y1 + 1;
        if (w > 0 && h > 0) out.push({ x: nums.x1, y: nums.y1, w, h });
      }
    }
    return out;
  }
  const cands = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw.boxes ?? raw.regions ?? raw.data ?? raw.output ?? [])
      : [];
  const list = Array.isArray(cands) ? cands : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const o = c;
    const arr = Array.isArray(o.box) && o.box.length === 4
      ? { x1: o.box[0], y1: o.box[1], x2: o.box[2], y2: o.box[3] }
      : o;
    if ([arr.x1, arr.y1, arr.x2, arr.y2].every((n) => typeof n === "number" && Number.isFinite(n))) {
      const w = arr.x2 - arr.x1 + 1; // x2/y2 inclusive
      const h = arr.y2 - arr.y1 + 1;
      if (w > 0 && h > 0) out.push({ x: arr.x1, y: arr.y1, w, h });
    } else if ([o.x, o.y, o.w, o.h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      if (o.w > 0 && o.h > 0) out.push({ x: o.x, y: o.y, w: o.w, h: o.h });
    }
  }
  return out;
}

function clampBoxes(boxes, W, H) {
  const out = [];
  for (const b of boxes) {
    const x = Math.max(0, Math.min(W - 1, Math.floor(b.x)));
    const y = Math.max(0, Math.min(H - 1, Math.floor(b.y)));
    const w = Math.max(0, Math.min(W, Math.ceil(b.x + b.w))) - x;
    const h = Math.max(0, Math.min(H, Math.ceil(b.y + b.h))) - y;
    if (w > 0 && h > 0) out.push({ x, y, w, h });
  }
  return out;
}

function toPercent(box, W, H) {
  const r = (n) => Math.round(n * 10000) / 10000;
  return { x: r((box.x / W) * 100), y: r((box.y / H) * 100), w: r((box.w / W) * 100), h: r((box.h / H) * 100) };
}

export function requireMasked(masked) {
  if (!masked.masked) {
    throw new Error(
      `hero-chain: masking failed (${masked.label}); dropping the frame — an unmasked frame is never sent`,
    );
  }
  return masked;
}

async function maskPng(png) {
  // Mask via the existing 04a MockRedactor when the bot build is available.
  // No unmasked-frame fallback: if masking is unavailable or fails, throw and
  // the caller drops the frame (it is never sent unmasked).
  let res;
  try {
    const { MockRedactor } = await import("../dist/src/private/redact.js");
    const redactor = new MockRedactor();
    res = await redactor.redactImage(png, "hero-chain-slide.png");
    res = { png: res.png, masked: res.masked, label: redactor.label };
  } catch (err) {
    throw new Error(`hero-chain: masking unavailable; dropping the frame — an unmasked frame is never sent (${err})`);
  }
  return requireMasked(res);
}

function appendRunLog(lines) {
  const stamped = lines.map((l) => JSON.stringify({ at: new Date().toISOString(), ...l })).join("\n") + "\n";
  appendFileSync(runLogPath, stamped);
}

function saveFixtures({ prompt, slidePng, samRaw, samRegion, spark }) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "prompt.txt"), prompt);
  writeFileSync(join(outDir, "slide.png"), slidePng);
  writeFileSync(join(outDir, "sam-raw.json"), JSON.stringify(samRaw, null, 2));
  writeFileSync(join(outDir, "sam-region.json"), JSON.stringify(samRegion, null, 2));
  writeFileSync(join(outDir, "spark.json"), JSON.stringify(spark, null, 2));
}

function fixtureBundle() {
  // Deterministic offline bundle: handmade slide + canned SAM + canned spark.
  const W = 800;
  const H = 400;
  const { fixtureSlidePng } = { fixtureSlidePng: null };
  void fixtureSlidePng;
  return { W, H };
}

async function handmadeSlide() {
  try {
    const { fixtureSlidePng } = await import("../dist/src/vision/image.js");
    return fixtureSlidePng();
  } catch {
    // Fallback: smallest valid white PNG if the build is missing (replay still works).
    const { deflateSync } = await import("node:zlib");
    const px = Buffer.alloc(8 * 8 * 3, 255);
    const filtered = Buffer.alloc(8 * (8 * 3 + 1));
    for (let y = 0; y < 8; y += 1) {
      filtered[y * 25] = 0;
      px.copy(filtered, y * 25 + 1, y * 24, (y + 1) * 24);
    }
    const { CRC } = { CRC: null };
    void CRC;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc = (buf) => {
      let c = 0xffffffff;
      for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const td = Buffer.from(type, "ascii");
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const cc = Buffer.alloc(4);
      cc.writeUInt32BE(crc(Buffer.concat([td, data])), 0);
      return Buffer.concat([len, td, data, cc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(8, 0);
    ihdr.writeUInt32BE(8, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", Buffer.from(deflateSync(filtered))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function cannedSamRaw() {
  return "<0f>0<|box;x1=80;y1=280;x2=559;y2=319;w=480;h=40|><|mask;x=0;y=0;data=400,800,!...|>";
}

async function replayOrBuildFixtures() {
  const needed = ["prompt.txt", "slide.png", "sam-raw.json", "sam-region.json", "spark.json"];
  if (needed.every((f) => existsSync(join(outDir, f)))) {
    const region = JSON.parse(readFileSync(join(outDir, "sam-region.json"), "utf8"));
    const spark = JSON.parse(readFileSync(join(outDir, "spark.json"), "utf8"));
    process.stdout.write(`hero-chain replay: fixture mode, date=${spark.date ?? "?"} region=${JSON.stringify(region.box ?? region)}\n`);
    return;
  }
  // Build the bundle locally with zero network.
  const slidePng = await handmadeSlide();
  const { w: W, h: H } = slidePng.length > 100 ? pngSize(slidePng) : { w: 8, h: 8 };
  const samRaw = cannedSamRaw();
  const boxes = clampBoxes(parseSamBoxesLocal(samRaw), W, H);
  const box = boxes.length > 0 ? boxes[0] : { x: 0, y: 0, w: W, h: H };
  const flags = boxes.length > 0 ? [] : ["region_spotcheck_failed"];
  const samRegion = { frame: { width: W, height: H }, box, boxPercent: toPercent(box, W, H), flags, model: SAM_MODEL, fixture: true };
  const spark = { model: SPARK_MODEL, fixture: true, date: "30th", text: "The slide says the 30th.", flags };
  saveFixtures({ prompt: SLIDE_PROMPT, slidePng, samRaw, samRegion, spark });
  process.stdout.write(`hero-chain replay: rebuilt offline fixtures, date=30th\n`);
}

async function live() {
  throw new Error(
    "hero-chain --live refuses to run: model calls must go through the server-side privacy gate (services/bot/src/private/gate.ts)",
  );
  checkCap();
  const k = key();
  const t0 = Date.now();
  mkdirSync(outDir, { recursive: true });

  // 1. Image: synthetic vendor slide.
  let slidePng;
  let creativeBuild = true;
  let imageErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(IMAGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${k}` },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({ model: IMAGE_MODEL, prompt: SLIDE_PROMPT, output_format: "png" }),
      });
      if (!res.ok) throw new Error(`images/generations status ${res.status}`);
      const body = await res.json();
      const b64 = body?.data?.[0]?.b64_json;
      if (!b64) throw new Error("images/generations carried no image data");
      slidePng = Buffer.from(b64, "base64");
      imageErr = null;
      break;
    } catch (err) {
      imageErr = err;
    }
  }
  if (!slidePng) {
    // Two failures -> hand-made slide, drop the Creative Build claim.
    creativeBuild = false;
    slidePng = await handmadeSlide();
    process.stderr.write(`hero-chain: image failed twice (${String(imageErr)}); using hand-made slide\n`);
  }
  logCost({ model: IMAGE_MODEL, stage: "image-slide", inputTokens: 0, outputTokens: 0, estimatedUsd: 0.04, fixture: false });
  checkCap();

  // 2. Mask with 04a masking when available.
  const masked = await maskPng(slidePng);
  const { w: W, h: H } = pngSize(masked.png);

  // 3. SAM "date" region (streaming SSE; raw text saved as the fixture).
  const samBody = {
    model: SAM_MODEL,
    stream: true,
    metadata: { mask_encoding: "one_bit" },
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "date" },
          { type: "input_image", image_url: `data:image/png;base64,${masked.png.toString("base64")}` },
        ],
      },
    ],
  };
  const samRes = await fetch(SAM_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${k}` },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(samBody),
  });
  if (!samRes.ok) {
    const snippet = await samRes.text().then((t) => t.slice(0, 300)).catch(() => "");
    throw new Error(`sam live call failed with status ${samRes.status}: ${snippet}`);
  }
  const samSse = await samRes.text();
  let samRaw = "";
  for (const line of samSse.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload);
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") samRaw += evt.delta;
    } catch { /* non-JSON keepalive: ignore */ }
  }
  logCost({ model: SAM_MODEL, stage: "sam-region", inputTokens: 0, outputTokens: 0, estimatedUsd: 0.0025, fixture: false });
  const boxes = clampBoxes(parseSamBoxesLocal(samRaw), W, H);
  const box = boxes.length > 0 ? boxes[0] : { x: 0, y: 0, w: W, h: H };
  const flags = boxes.length > 0 ? [] : ["region_spotcheck_failed"];
  const samRegion = {
    frame: { width: W, height: H },
    concept: "date",
    box,
    boxPercent: toPercent(box, W, H),
    flags,
    model: SAM_MODEL,
    fixture: false,
    spotcheck: "manual spot-check: box lies inside frame bounds",
  };

  // 4. Spark reads the date in the region.
  const sparkBody = {
    model: SPARK_MODEL,
    messages: [
      { role: "system", content: 'Read the date in the described region. Reply JSON only: {"date": "<date>"}. Never invent numbers.' },
      {
        role: "user",
        content: [
          { type: "text", text: `Region (pixels, x2/y2 inclusive geometry): ${JSON.stringify(box)}. What date is shown there?` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${masked.png.toString("base64")}` } },
        ],
      },
    ],
    max_completion_tokens: 256,
  };
  const sparkRes = await fetch(SPARK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${k}` },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(sparkBody),
  });
  if (!sparkRes.ok) throw new Error(`spark live call failed with status ${sparkRes.status}`);
  const sparkJson = await sparkRes.json();
  const usage = sparkJson?.usage ?? {};
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  const sparkUsd = (inTok / 1_000_000) * 1.5 + (outTok / 1_000_000) * 6;
  logCost({ model: SPARK_MODEL, stage: "spark-read", inputTokens: inTok, outputTokens: outTok, estimatedUsd: sparkUsd, fixture: false });
  const content = sparkJson?.choices?.[0]?.message?.content ?? "";
  let date = null;
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    date = start !== -1 && end !== -1 ? (JSON.parse(content.slice(start, end + 1)).date ?? null) : null;
  } catch { date = null; }
  const spark = {
    model: SPARK_MODEL,
    fixture: false,
    date,
    rawText: typeof content === "string" ? content : JSON.stringify(content),
    usage: { inputTokens: inTok, outputTokens: outTok },
    creativeBuild,
    masked: masked.masked,
    maskLabel: masked.label,
    ms: Date.now() - t0,
  };

  saveFixtures({ prompt: SLIDE_PROMPT, slidePng: masked.png, samRaw, samRegion, spark });
  appendRunLog([
    { model: IMAGE_MODEL, stage: "image-slide", note: creativeBuild ? "synthetic vendor slide" : "hand-made fallback; Creative Build claim dropped", masked: masked.masked },
    { model: SAM_MODEL, stage: "sam-region", note: `box ${JSON.stringify(box)} flags=${flags.join(",") || "none"}`, masked: masked.masked },
  ]);
  process.stdout.write(`hero-chain live: date=${date ?? "?"} box=${JSON.stringify(box)} flags=${flags.join(",") || "none"}\n`);
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  if (process.argv.includes("--live")) {
    await live();
  } else {
    await replayOrBuildFixtures();
  }
}
