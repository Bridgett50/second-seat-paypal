/**
 * INPUT_FORMAT v1 parser: `[MM:SS] Speaker: text`, one segment per line,
 * plus frame timestamps from `frame-MM-SS.png` names or a `frames.txt`
 * sidecar. See docs/INPUT_FORMAT.md.
 */
import type { Frame, TranscriptSegment } from "../types.js";

export type InputParseErrorCode =
  | "malformed_line"
  | "duplicate_id"
  | "malformed_sidecar_line"
  | "unresolvable_frame_time"
  | "unsupported_input";

/** Typed parse error that always names its 1-based line number. */
export class InputParseError extends Error {
  readonly line: number;
  readonly code: InputParseErrorCode;

  constructor(code: InputParseErrorCode, line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = "InputParseError";
    this.code = code;
    this.line = line;
  }
}

const TRANSCRIPT_LINE =
  /^\[(\d+):([0-5]\d)\]\s+([^:\n][^:\n]*):\s+(.+?)\s*$/;

const FRAME_FILENAME = /^frame-(\d+)-([0-5]\d)\.(png|jpe?g)$/i;

const SIDECAR_LINE = /^(\S+)\s+(\d+):([0-5]\d)\s*$/;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format seconds as `MM:SS` (minutes may exceed 59). */
export function formatMmSs(t: number): string {
  const mm = Math.floor(t / 60);
  return `${pad2(mm)}:${pad2(t % 60)}`;
}

/** Parse an `MM:SS` timestamp into seconds. */
export function parseMmSs(mm: string, ss: string): number {
  return Number(mm) * 60 + Number(ss);
}

/**
 * Parse a transcript file into segments. Throws InputParseError naming
 * the 1-based line number on malformed lines and duplicate ids.
 */
export function parseTranscript(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? "").replace(/\r$/, "");
    const line = i + 1;
    if (raw.trim() === "") {
      continue;
    }
    const match = TRANSCRIPT_LINE.exec(raw);
    if (match === null) {
      throw new InputParseError(
        "malformed_line",
        line,
        `expected "[MM:SS] Speaker: text", got ${JSON.stringify(raw)}`,
      );
    }
    const t = parseMmSs(match[1] as string, match[2] as string);
    const id = `t-${formatMmSs(t)}`;
    if (seen.has(id)) {
      throw new InputParseError("duplicate_id", line, `duplicate segment id ${JSON.stringify(id)}`);
    }
    seen.add(id);
    segments.push({
      id,
      t,
      speaker: (match[3] as string).trim(),
      text: (match[4] as string).trim(),
    });
  }
  return segments;
}

/**
 * Read a screenshot time from a `frame-MM-SS.png` (or .jpg) file name.
 * Returns null when the name carries no timestamp.
 */
export function frameTimeFromFilename(file: string): number | null {
  const base = file.split("/").pop() ?? file;
  const match = FRAME_FILENAME.exec(base.trim());
  if (match === null) {
    return null;
  }
  return parseMmSs(match[1] as string, match[2] as string);
}

export interface SidecarRow {
  file: string;
  t: number;
  /** 1-based line number in the sidecar file. */
  line: number;
}

/** Parse a `frames.txt` sidecar (`<file> <MM:SS>` per line). */
export function parseFramesSidecar(text: string): SidecarRow[] {
  const rows: SidecarRow[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] ?? "").replace(/\r$/, "");
    const line = i + 1;
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      continue;
    }
    const match = SIDECAR_LINE.exec(raw.trim());
    if (match === null) {
      throw new InputParseError(
        "malformed_sidecar_line",
        line,
        `expected "<file> MM:SS", got ${JSON.stringify(raw)}`,
      );
    }
    rows.push({
      file: match[1] as string,
      t: parseMmSs(match[2] as string, match[3] as string),
      line,
    });
  }
  return rows;
}

export interface ResolveFramesOptions {
  /** File names present next to the transcript. */
  files: string[];
  /** Optional `frames.txt` sidecar content; wins over file names. */
  sidecarText?: string;
}

/**
 * Resolve frame files to `Frame` records. Times come from the sidecar
 * when it names a file, otherwise from the `frame-MM-SS.png` name.
 * Files with no resolvable time are skipped. Duplicate frame ids throw.
 */
export function resolveFrames(options: ResolveFramesOptions): Frame[] {
  const sidecar = new Map<string, SidecarRow>();
  if (options.sidecarText !== undefined) {
    for (const row of parseFramesSidecar(options.sidecarText)) {
      sidecar.set(row.file, row);
    }
  }
  const frames: Frame[] = [];
  const seen = new Map<string, number>();
  for (const file of options.files) {
    const row = sidecar.get(file);
    const t = row?.t ?? frameTimeFromFilename(file);
    if (t === null || t === undefined) {
      continue;
    }
    const id = `f-${formatMmSs(t)}`;
    const firstLine = seen.get(id);
    if (firstLine !== undefined) {
      throw new InputParseError(
        "duplicate_id",
        row?.line ?? 0,
        `duplicate frame id ${JSON.stringify(id)} (first seen at line ${firstLine})`,
      );
    }
    seen.set(id, row?.line ?? 0);
    frames.push({ id, t, file });
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}
