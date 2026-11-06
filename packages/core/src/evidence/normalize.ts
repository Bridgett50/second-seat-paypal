/**
 * Normalizer: VTT/SRT captions and plain "Name: text" lines with
 * timestamps become INPUT_FORMAT v1 (`[MM:SS] Speaker: text`).
 * PDF is first on the cut list and is rejected.
 */
import {
  InputParseError,
  formatMmSs,
  frameTimeFromFilename,
  parseFramesSidecar,
  resolveFrames,
} from "./input.js";

export { frameTimeFromFilename, parseFramesSidecar, resolveFrames };

interface Cue {
  t: number;
  speaker: string;
  text: string;
  line: number;
}

function cueToLine(cue: Cue): string {
  return `[${formatMmSs(cue.t)}] ${cue.speaker}: ${cue.text}`;
}

function cuesToInputFormat(cues: Cue[]): string {
  const sorted = [...cues].sort((a, b) => a.t - b.t);
  return `${sorted.map(cueToLine).join("\n")}\n`;
}

const VTT_VOICE = /^<v\s+([^>]+)>([\s\S]*)$/i;
const SPEAKER_PREFIX = /^([^:<>]+):\s+(.+)$/;

/** Split cue payload into speaker + text; throws naming the cue line. */
function splitSpeaker(payload: string, line: number): { speaker: string; text: string } {
  const voice = VTT_VOICE.exec(payload.trim());
  if (voice !== null) {
    const text = (voice[2] as string).replace(/<[^>]*>/g, "").trim();
    if (text === "") {
      throw new InputParseError("malformed_line", line, "cue has a speaker but empty text");
    }
    return { speaker: (voice[1] as string).trim(), text };
  }
  const prefixed = SPEAKER_PREFIX.exec(payload.trim().replace(/<[^>]*>/g, ""));
  if (prefixed !== null) {
    return { speaker: (prefixed[1] as string).trim(), text: (prefixed[2] as string).trim() };
  }
  throw new InputParseError("malformed_line", line, `cue names no speaker: ${JSON.stringify(payload)}`);
}

/** `HH:MM:SS.mmm`, `MM:SS.mmm`, or `MM:SS`; floored to the second. */
function parseCaptionTimestamp(raw: string, line: number): number {
  const match = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)(?:[.,]\d+)?$/.exec(raw.trim());
  if (match === null) {
    throw new InputParseError("malformed_line", line, `bad caption timestamp ${JSON.stringify(raw)}`);
  }
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function rejectPdf(text: string): void {
  if (text.startsWith("%PDF")) {
    throw new InputParseError("unsupported_input", 1, "PDF input is out of scope (first on the cut list)");
  }
}

/** WebVTT captions to INPUT_FORMAT v1. */
export function normalizeVtt(vtt: string): string {
  rejectPdf(vtt);
  const cues: Cue[] = [];
  const lines = vtt.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = (lines[i] ?? "").replace(/\r$/, "");
    const line = i + 1;
    i += 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "WEBVTT" || trimmed.startsWith("NOTE")) {
      continue;
    }
    const arrow = trimmed.indexOf("-->");
    if (arrow === -1) {
      continue;
    }
    const start = trimmed.slice(0, arrow).trim();
    const t = parseCaptionTimestamp(start, line);
    const payload: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "") {
      payload.push(((lines[i] ?? "").replace(/\r$/, "")));
      i += 1;
    }
    const joined = payload.join(" ").trim();
    if (joined === "") {
      throw new InputParseError("malformed_line", line, "cue has no text");
    }
    const { speaker, text } = splitSpeaker(joined, line);
    cues.push({ t, speaker, text, line });
  }
  return cuesToInputFormat(cues);
}

const SRT_BLOCK_SPLIT = /\n\s*\n/;

/** SubRip captions to INPUT_FORMAT v1. */
export function normalizeSrt(srt: string): string {
  rejectPdf(srt);
  const cues: Cue[] = [];
  const blocks = srt.split(SRT_BLOCK_SPLIT);
  let line = 1;
  for (const block of blocks) {
    const rows = block.split("\n").map((row) => row.replace(/\r$/, ""));
    const blockLine = line;
    line += rows.length + 1;
    const body = rows.filter((row) => row.trim() !== "");
    if (body.length === 0) {
      continue;
    }
    const first = body[0] as string;
    const numbered = /^\d+$/.test(first.trim());
    const timingRow = numbered ? body[1] : first;
    if (timingRow === undefined) {
      throw new InputParseError("malformed_line", blockLine, `bad SRT block ${JSON.stringify(block)}`);
    }
    const arrow = timingRow.indexOf("-->");
    if (arrow === -1) {
      throw new InputParseError("malformed_line", blockLine, `bad SRT timing ${JSON.stringify(timingRow)}`);
    }
    const t = parseCaptionTimestamp(timingRow.slice(0, arrow).trim().replace(",", "."), blockLine);
    const payload = body.slice(numbered ? 2 : 1).join(" ").trim();
    if (payload === "") {
      throw new InputParseError("malformed_line", blockLine, "cue has no text");
    }
    const { speaker, text } = splitSpeaker(payload, blockLine);
    cues.push({ t, speaker, text, line: blockLine });
  }
  return cuesToInputFormat(cues);
}

const PLAIN_PATTERNS: RegExp[] = [
  /^\[(\d+):([0-5]\d)\]\s+([^:]+):\s+(.+?)\s*$/,
  /^(\d+):([0-5]\d)\s+([^:]+):\s+(.+?)\s*$/,
  /^([^:[\]()]+?)\s*[[(](\d+):([0-5]\d)[\])]\s*:\s*(.+?)\s*$/,
  /^([^:]+):\s+(.+?)\s+[[(](\d+):([0-5]\d)[\])]\s*$/,
];

/**
 * Plain `Name: text` lines that carry a timestamp to INPUT_FORMAT v1.
 * Accepts `[MM:SS] Name: text`, `MM:SS Name: text`,
 * `Name [MM:SS]: text`, `Name (MM:SS): text`, and trailing stamps.
 */
export function normalizePlainTranscript(text: string): string {
  rejectPdf(text);
  const cues: Cue[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? "").replace(/\r$/, "");
    const line = i + 1;
    if (raw.trim() === "") {
      continue;
    }
    let matched = false;
    for (const pattern of PLAIN_PATTERNS) {
      const match = pattern.exec(raw);
      if (match === null) {
        continue;
      }
      matched = true;
      if (pattern === PLAIN_PATTERNS[0] || pattern === PLAIN_PATTERNS[1]) {
        cues.push({
          t: Number(match[1]) * 60 + Number(match[2]),
          speaker: (match[3] as string).trim(),
          text: (match[4] as string).trim(),
          line,
        });
      } else if (pattern === PLAIN_PATTERNS[2]) {
        cues.push({
          t: Number(match[2]) * 60 + Number(match[3]),
          speaker: (match[1] as string).trim(),
          text: (match[4] as string).trim(),
          line,
        });
      } else {
        cues.push({
          t: Number(match[3]) * 60 + Number(match[4]),
          speaker: (match[1] as string).trim(),
          text: (match[2] as string).trim(),
          line,
        });
      }
      break;
    }
    if (!matched) {
      throw new InputParseError(
        "malformed_line",
        line,
        `expected "Name: text" with a timestamp, got ${JSON.stringify(raw)}`,
      );
    }
  }
  return cuesToInputFormat(cues);
}
