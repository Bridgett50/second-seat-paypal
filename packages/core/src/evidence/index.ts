export {
  InputParseError,
  parseTranscript,
  frameTimeFromFilename,
  parseFramesSidecar,
  resolveFrames,
  formatMmSs,
  parseMmSs,
} from "./input.js";
export type { InputParseErrorCode, SidecarRow, ResolveFramesOptions } from "./input.js";
export {
  normalizeVtt,
  normalizeSrt,
  normalizePlainTranscript,
} from "./normalize.js";
export {
  EVIDENCE_BRIEF_JSON_SCHEMA,
  ENTRY_CATEGORIES,
  FLAGS,
} from "./schema.js";
export type {
  EntryCategory,
  Acceptance,
  Flag,
  FrameRegion,
  Citation,
  EvidenceEntry,
  EvidenceSettings,
  EvidenceBrief,
} from "./schema.js";
export { validateBrief } from "./validate.js";
export type { ValidateInput, ValidateSegment, ValidateFrame } from "./validate.js";
export { applyPressure, detectPressurePatterns, gateApproval, PRESSURE_TACTICS } from "./pressure.js";
export type {
  PressureTactic,
  PressureSource,
  PressureLabel,
  PressureSegment,
  ApplyPressureInput,
  ApplyPressureOptions,
  ApplyPressureResult,
  VerifiedLabel,
} from "./pressure.js";
