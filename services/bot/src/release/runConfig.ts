/**
 * C9 run configuration schema — preparation only.
 *
 * This file defines the shape of the eventual bounded evidence-run
 * configuration and validates it with dummy values in tests. It does not
 * authorize, launch, or fund any run.
 *
 * Preparation only: a timeout is not a hard billing guarantee; prices and
 * resource assumptions must be checked, and enforcement confirmed, before
 * separate authorization.
 */

const HEX_40 = /^[0-9a-fA-F]{40}$/;
const HEX_64 = /^[0-9a-fA-F]{64}$/;

/** Frozen canonical run-config version. The canonical nested RunConfig is
 * the only frozen input file; the flat launch dict is a bound projection.
 * `configVersion` is optional, but when present it must equal this. */
export const RUN_CONFIG_VERSION = 1;

export const RUN_CONFIG_REQUIRED_KEYS: readonly string[] = [
  "sourceSha",
  "dataset",
  "model",
  "image",
  "prompt",
  "schema",
  "scorer",
  "review",
  "decoding",
  "tokenLimits",
  "timeouts",
  "retry",
  "modal",
  "glimmerDemoRequests",
  "budget",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Review date check mirroring launch_contract.py: a non-blank ISO calendar
 * date (real month/day) or datetime. Garbage like "not-a-date" or an
 * impossible month fails.
 */
function isValidReviewDate(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) {
      return false;
    }
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  return !Number.isNaN(Date.parse(s));
}

/**
 * Validate a run configuration. Returns an empty array when valid; each
 * error string names the offending key.
 */
export function validateRunConfig(cfg: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(cfg)) {
    return RUN_CONFIG_REQUIRED_KEYS.map((k) => `${k} is missing: config must be an object`);
  }
  for (const key of RUN_CONFIG_REQUIRED_KEYS) {
    if (!(key in cfg)) {
      errors.push(`${key} is missing`);
    }
  }

  if ("configVersion" in cfg && cfg["configVersion"] !== RUN_CONFIG_VERSION) {
    errors.push("configVersion: unsupported version");
  }

  const sourceSha = cfg["sourceSha"];
  if ("sourceSha" in cfg && !(typeof sourceSha === "string" && HEX_40.test(sourceSha))) {
    errors.push("sourceSha must be 40-hex");
  } else if (typeof sourceSha === "string" && /^0+$/.test(sourceSha)) {
    errors.push("sourceSha must not be all zeros (placeholder)");
  }

  if ("sourceSha256" in cfg) {
    const sourceSha256 = cfg["sourceSha256"];
    if (!(typeof sourceSha256 === "string" && HEX_64.test(sourceSha256) && !/^0+$/.test(sourceSha256))) {
      errors.push("sourceSha256 must be 64-hex and not all zeros");
    }
  }

  if ("dataset" in cfg) {
    const dataset = cfg["dataset"];
    if (!isRecord(dataset)) {
      errors.push("dataset must be an object");
    } else {
      const id = dataset["id"];
      if (!(typeof id === "string" && id.length > 0)) {
        errors.push("dataset.id must be a non-empty string");
      }
      const sha = dataset["sha256"];
      if (!(typeof sha === "string" && HEX_64.test(sha))) {
        errors.push("dataset.sha256 must be 64-hex");
      }
    }
  }

  if ("model" in cfg) {
    const model = cfg["model"];
    if (!isRecord(model)) {
      errors.push("model must be an object");
    } else {
      const revision = model["revision"];
      if (!(typeof revision === "string" && HEX_40.test(revision))) {
        errors.push('model.revision must be 40-hex, not a branch like "main"');
      } else if (/^0+$/.test(revision)) {
        errors.push("model.revision must not be all zeros (unpinned placeholder)");
      }
    }
  }

  if ("image" in cfg) {
    const image = cfg["image"];
    if (!isRecord(image)) {
      errors.push("image must be an object");
    } else {
      const ref = image["ref"];
      const digest = image["digest"];
      const refOk = typeof ref === "string" && /^.+@sha256:[0-9a-fA-F]{64}$/.test(ref);
      const digestOk = typeof digest === "string" && /^sha256:[0-9a-fA-F]{64}$/.test(digest);
      if (!refOk) {
        errors.push("image.ref must be pinned (@sha256:<64hex>)");
      }
      if (!digestOk) {
        errors.push("image.digest must be sha256:<64hex>");
      }
      if (refOk && digestOk && !(ref as string).endsWith(`@${digest as string}`)) {
        errors.push("image.ref must equal image.digest suffix");
      }
      const refDigest = typeof ref === "string" ? ref.split("@sha256:")[1] : undefined;
      const bareDigest = typeof digest === "string" ? digest.split("sha256:")[1] : undefined;
      for (const part of [refDigest, bareDigest]) {
        if (typeof part === "string" && /^[0-9a-fA-F]{64}$/.test(part) && /^0+$/.test(part)) {
          errors.push("image digest must not be all zeros (placeholder)");
          break;
        }
      }
    }
  }

  for (const key of ["prompt", "schema", "scorer"] as const) {
    if (key in cfg) {
      const section = cfg[key];
      if (!isRecord(section)) {
        errors.push(`${key} must be an object`);
      } else {
        const sha = section["sha256"];
        if (!(typeof sha === "string" && HEX_64.test(sha))) {
          errors.push(`${key}.sha256 must be 64-hex`);
        }
      }
    }
  }

  if ("review" in cfg) {
    const review = cfg["review"];
    if (!isRecord(review)) {
      errors.push("review must be an object");
    } else {
      if (review["status"] !== "reviewed") {
        errors.push('review.status must be "reviewed"');
      }
      const reviewer = review["reviewer"];
      if (!(typeof reviewer === "string" && reviewer.trim() !== "")) {
        errors.push("review.reviewer must be a non-blank string");
      }
      if (!isValidReviewDate(review["reviewed_at"])) {
        errors.push("review.reviewed_at must be a valid date");
      }
      const reviewSha = review["dataset_sha256"];
      const datasetSection = cfg["dataset"];
      const datasetSha = isRecord(datasetSection) ? datasetSection["sha256"] : undefined;
      if (typeof datasetSha === "string" && HEX_64.test(datasetSha)) {
        if (reviewSha !== datasetSha) {
          errors.push("review.dataset_sha256 must match dataset.sha256");
        }
      } else if (!(typeof reviewSha === "string" && HEX_64.test(reviewSha))) {
        errors.push("review.dataset_sha256 must be 64-hex");
      }
    }
  }

  if ("decoding" in cfg) {
    const decoding = cfg["decoding"];
    if (!isRecord(decoding)) {
      errors.push("decoding must be an object");
    } else {
      if (!("temperature" in decoding) || typeof decoding["temperature"] !== "number") {
        errors.push("decoding.temperature is missing or not a number");
      }
      if (!("seed" in decoding) || typeof decoding["seed"] !== "number") {
        errors.push("decoding.seed is missing or not a number");
      }
      if (!("reasoning" in decoding) || typeof decoding["reasoning"] !== "string") {
        errors.push("decoding.reasoning is missing or not a string");
      } else if (decoding["reasoning"] !== "low" && decoding["reasoning"] !== "medium" && decoding["reasoning"] !== "high") {
        errors.push(`decoding.reasoning unsupported: ${decoding["reasoning"]}`);
      }
      if ("seed" in decoding && typeof decoding["seed"] === "number" && !Number.isInteger(decoding["seed"])) {
        errors.push("decoding.seed must be an integer");
      }
    }
  }

  if ("tokenLimits" in cfg) {
    const tokenLimits = cfg["tokenLimits"];
    if (!isRecord(tokenLimits)) {
      errors.push("tokenLimits must be an object");
    } else {
      const maxTokens = tokenLimits["maxTokens"];
      if (!(typeof maxTokens === "number" && Number.isInteger(maxTokens) && maxTokens > 0)) {
        errors.push("tokenLimits.maxTokens must be a positive integer");
      }
      if ("contextTokens" in tokenLimits) {
        const contextTokens = tokenLimits["contextTokens"];
        if (!(typeof contextTokens === "number" && Number.isInteger(contextTokens) && contextTokens > 0)) {
          errors.push("tokenLimits.contextTokens must be a positive integer");
        } else if (
          typeof maxTokens === "number" &&
          Number.isInteger(maxTokens) &&
          maxTokens > 0 &&
          !(contextTokens > maxTokens)
        ) {
          errors.push("tokenLimits.contextTokens must exceed tokenLimits.maxTokens");
        }
      }
    }
  }

  if ("timeouts" in cfg) {
    const timeouts = cfg["timeouts"];
    if (!isRecord(timeouts)) {
      errors.push("timeouts must be an object");
    } else {
      const requestMs = timeouts["requestMs"];
      const workDeadlineS = timeouts["workDeadlineS"];
      const functionTimeoutS = timeouts["functionTimeoutS"];
      if (!(typeof requestMs === "number" && requestMs > 0)) {
        errors.push("timeouts.requestMs must be positive");
      }
      if (!(typeof workDeadlineS === "number" && workDeadlineS > 0)) {
        errors.push("timeouts.workDeadlineS must be positive");
      }
      if (!(typeof functionTimeoutS === "number" && functionTimeoutS > 0)) {
        errors.push("timeouts.functionTimeoutS must be positive");
      }
      if (
        typeof workDeadlineS === "number" &&
        typeof functionTimeoutS === "number" &&
        workDeadlineS > 0 &&
        functionTimeoutS > 0 &&
        !(workDeadlineS < functionTimeoutS)
      ) {
        errors.push("timeouts.workDeadlineS must be less than timeouts.functionTimeoutS");
      }
    }
  }

  if ("retry" in cfg) {
    const retry = cfg["retry"];
    if (!isRecord(retry)) {
      errors.push("retry must be an object");
    } else if (retry["maxAttempts"] !== 1) {
      errors.push("retry.maxAttempts must equal 1 for the Spark proof run");
    }
  }

  if ("modal" in cfg) {
    const modal = cfg["modal"];
    if (!isRecord(modal)) {
      errors.push("modal must be an object");
    } else {
      if (modal["allocations"] !== 1) {
        errors.push("modal.allocations must be 1 (single allocation)");
      }
      if (modal["scoredCanary"] !== true) {
        errors.push("modal.scoredCanary must be true (scored canary)");
      }
      const concurrency = modal["concurrency"];
      const maxConcurrency = modal["maxConcurrency"];
      if (
        !(typeof concurrency === "number" && typeof maxConcurrency === "number") ||
        !(Number.isInteger(concurrency) && Number.isInteger(maxConcurrency)) ||
        !(concurrency >= 1 && concurrency <= maxConcurrency)
      ) {
        errors.push("modal.concurrency must satisfy 1 <= concurrency <= modal.maxConcurrency");
      }
      if (modal["teardown"] !== true) {
        errors.push("modal.teardown must be true");
      }
      if (modal["evidenceDownload"] !== "complete") {
        errors.push('modal.evidenceDownload must be "complete"');
      }
    }
  }

  if ("glimmerDemoRequests" in cfg) {
    const value = cfg["glimmerDemoRequests"];
    if (!(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
      errors.push("glimmerDemoRequests must be a non-negative integer");
    }
  }

  if ("budget" in cfg) {
    const budget = cfg["budget"];
    if (!isRecord(budget)) {
      errors.push("budget must be an object");
    } else {
      if (budget["status"] !== "PROPOSED") {
        errors.push('budget.status must be "PROPOSED"');
      }
      const modalUsd = budget["modalUsd"];
      const sparkUsd = budget["sparkUsd"];
      const totalUsd = budget["totalUsd"];
      if (!(typeof modalUsd === "number" && Math.abs(modalUsd - 2) < 1e-9)) {
        errors.push("budget.modalUsd must be 2");
      }
      if (!(typeof sparkUsd === "number" && Math.abs(sparkUsd - 0.1) < 1e-9)) {
        errors.push("budget.sparkUsd must be 0.10");
      }
      if (!(typeof totalUsd === "number" && Math.abs(totalUsd - 2.1) < 1e-9)) {
        errors.push("budget.totalUsd must be 2.10");
      }
    }
  }

  return errors;
}

/** Options for the Spark proof client derived from a validated run config.
 * The proof budget is exactly one HTTP attempt. Any other value is refused
 * here even if a caller skipped validateRunConfig.
 */
export function sparkProofClientOptions(cfg: { retry: { maxAttempts: number } }): { maxAttempts: number } {
  if (cfg?.retry?.maxAttempts !== 1) {
    throw new Error("retry.maxAttempts must equal 1 for the Spark proof run");
  }
  return { maxAttempts: 1 };
}

/** Structural view of a run config consumed by the mapping functions below. */
export interface RunConfigView {
  sourceSha: string;
  sourceSha256?: string;
  dataset: { id: string; sha256: string };
  model: { name: string; revision: string };
  image: { ref: string; digest: string };
  decoding: { temperature: number; seed: number; reasoning: string };
  tokenLimits: { maxTokens: number; contextTokens?: number };
  timeouts: { requestMs: number; workDeadlineS: number; functionTimeoutS: number };
  retry: { maxAttempts: number };
  modal: { concurrency: number };
  review: { status: string; reviewer: string; reviewed_at: string; dataset_sha256: string };
}

/**
 * Flat Python launch-contract config, keyed exactly as
 * infra/modal/launch_contract.py check_launch expects. source_sha256 is
 * included only when the run config carries the packaged-source identity.
 */
export interface LaunchConfig {
  dataset: string;
  dataset_sha256: string;
  source_sha: string;
  source_sha256?: string;
  image: string;
  model: string;
  model_revision: string;
  review: { status: string; reviewer: string; reviewed_at: string; dataset_sha256: string };
}

/** Map a TS run config to the flat Python launch config. */
export function toLaunchConfig(cfg: RunConfigView): LaunchConfig {
  const out: LaunchConfig = {
    dataset: cfg.dataset.id,
    dataset_sha256: cfg.dataset.sha256,
    source_sha: cfg.sourceSha,
    image: cfg.image.ref,
    model: cfg.model.name,
    model_revision: cfg.model.revision,
    review: {
      status: cfg.review.status,
      reviewer: cfg.review.reviewer,
      reviewed_at: cfg.review.reviewed_at,
      dataset_sha256: cfg.review.dataset_sha256,
    },
  };
  if (typeof cfg.sourceSha256 === "string" && cfg.sourceSha256 !== "") {
    out.source_sha256 = cfg.sourceSha256;
  }
  return out;
}

/** Runner/request settings derived from a run config. */
export interface RunnerSettings {
  concurrency: number;
  deadlineMs: number;
  requestMs: number;
  maxTokens: number;
  /** Whole-server context capacity (vLLM --max-model-len). Defaults to 16384. */
  contextTokens: number;
  decoding: { temperature: number; seed: number; reasoning: string };
  maxAttempts: number;
}

/** Default server context capacity (vLLM --max-model-len) when the frozen
 * config carries no tokenLimits.contextTokens. */
export const RUNNER_CONTEXT_TOKENS_DEFAULT = 16384;

/**
 * Map a TS run config to runner/request settings: eval worker concurrency,
 * deadlines, token/decoding settings, and the proof retry budget.
 */
export function toRunnerSettings(cfg: RunConfigView): RunnerSettings {
  const contextTokens = cfg.tokenLimits.contextTokens;
  return {
    concurrency: cfg.modal.concurrency,
    deadlineMs: cfg.timeouts.workDeadlineS * 1000,
    requestMs: cfg.timeouts.requestMs,
    maxTokens: cfg.tokenLimits.maxTokens,
    contextTokens: typeof contextTokens === "number" ? contextTokens : RUNNER_CONTEXT_TOKENS_DEFAULT,
    decoding: {
      temperature: cfg.decoding.temperature,
      seed: cfg.decoding.seed,
      reasoning: cfg.decoding.reasoning,
    },
    maxAttempts: cfg.retry.maxAttempts,
  };
}
