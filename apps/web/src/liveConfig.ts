/**
 * Explicit offline/live analysis configuration (PR A5).
 *
 * Live mode is chosen ONLY by SECOND_SEAT_MODE=live. SECOND_SEAT_TEST_MODE=1
 * always forces offline, even when provider credentials are present, so
 * credentials alone can never enable model calls. Provider URLs and keys
 * stay server-side: this module never renders them and never includes
 * values in thrown errors (variable names only).
 */
import { createPrivacyGate, type PrivacyGate } from "@second-seat/bot/dist/src/private/gate.js";
import { GlimmerClient } from "@second-seat/bot/dist/src/private/redact.js";
import { MuseClient } from "@second-seat/bot/dist/src/brief/muse.js";

/** Default live redaction timeout (web race and Glimmer per-request). */
export const LIVE_REDACT_TIMEOUT_MS = 240_000;

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface OfflineAnalysisConfig {
  mode: "offline";
}

export interface LiveAnalysisConfig {
  mode: "live";
  redactor: GlimmerClient;
  analyzer: MuseClient;
  /** Live-mode privacy gate bound to `redactor`; session analyze sends through it. */
  gate: PrivacyGate;
  /** Adapter label shown in the payload panel after a real dispatch. */
  analyzerLabel: string;
}

export type AnalysisConfig = OfflineAnalysisConfig | LiveAnalysisConfig;

export interface LiveConfigDeps {
  fetchImpl?: typeof fetch;
}

export function resolveAnalysisConfig(
  env: Record<string, string | undefined> = process.env,
  deps?: LiveConfigDeps,
): AnalysisConfig {
  if (env["SECOND_SEAT_TEST_MODE"] === "1") return { mode: "offline" };
  if ((env["SECOND_SEAT_MODE"] ?? "") !== "live") return { mode: "offline" };
  const baseUrl = env["GLIMMER_BASE_URL"] ?? "";
  if (baseUrl === "") {
    throw new Error("live analysis needs GLIMMER_BASE_URL (set GLIMMER_BASE_URL)");
  }
  const key = env["META_API_KEY"] ?? env["MUSE_API_KEY"] ?? "";
  if (key === "") {
    throw new Error("live analysis needs META_API_KEY (set META_API_KEY)");
  }
  // Live redaction of a full transcript on the private endpoint can take
  // well over a minute; use the live default unless GLIMMER_TIMEOUT_MS is set.
  const timeoutMs = positiveIntOr(env["GLIMMER_TIMEOUT_MS"], LIVE_REDACT_TIMEOUT_MS);
  const redactor =
    deps?.fetchImpl === undefined
      ? new GlimmerClient(baseUrl, { timeoutMs })
      : new GlimmerClient(baseUrl, { timeoutMs, fetchImpl: deps.fetchImpl });
  const analyzer =
    deps?.fetchImpl === undefined
      ? new MuseClient({ labelTranscriptSegments: true })
      : new MuseClient({ fetchImpl: deps.fetchImpl, labelTranscriptSegments: true });
  const gate = createPrivacyGate({ mode: "live", redactor });
  return { mode: "live", redactor, analyzer, gate, analyzerLabel: "MuseClient" };
}
