/** Shared evidence input types for the Second Seat workspace. */

/** One transcript line: `[MM:SS] Speaker: text` (see docs/INPUT_FORMAT.md). */
export interface TranscriptSegment {
  /** Derived from the timestamp, e.g. `[01:10]` becomes `t-01:10`. */
  id: string;
  /** Seconds since meeting start, e.g. 70. */
  t: number;
  speaker: string;
  text: string;
}

/** One screenshot frame attached to a meeting by timestamp. */
export interface Frame {
  /** Derived from the timestamp, e.g. 70 seconds becomes `f-01:10`. */
  id: string;
  /** Seconds since meeting start, e.g. 70. */
  t: number;
  /** Image file name, e.g. `frame-01-10.png`. */
  file: string;
}
