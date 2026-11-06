export interface RunLogLine {
  stage: string;
  model: string;
  at: string;
  note?: string;
}

export interface ModelChip {
  stage: string;
  model: string | null;
  status: "run" | "not run";
}

export const MODEL_STAGES = [
  "glimmer-redact",
  "spark-brief",
  "spark-shield",
  "sam-region",
  "image-slide",
] as const;

export function parseGlimmerRecall(stdout: string): string | null {
  const m = stdout.match(/recall:\s*(\d+\s*\/\s*\d+)/i);
  if (!m || m[1] === undefined) return null;
  const parts = m[1].split("/");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return null;
  }
  return `${parts[0].trim()}/${parts[1].trim()}`;
}

export function modelChips(runLog: RunLogLine[]): ModelChip[] {
  const byStage = new Map(runLog.map((line) => [line.stage, line.model]));
  return MODEL_STAGES.map((stage) => {
    const model = byStage.get(stage) ?? null;
    return { stage, model, status: model === null ? "not run" : "run" };
  });
}
