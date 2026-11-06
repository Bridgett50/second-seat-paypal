#!/usr/bin/env node
/**
 * brief:run <dir> [--out <dir>] [--fixture <path>] [--record-fixture <path>]
 *
 * Read transcript.txt + frames.txt from <dir>, call the model (live) or a
 * recorded fixture (default), run validateBrief, write brief.json + brief.md.
 *
 * - Fixture mode (EVIDENCE_BRIEF_MODE=fixture, the default): fixture path is
 *   --fixture, else $EVIDENCE_BRIEF_FIXTURE, else <dir>/brief.recorded.json.
 *   Missing fixture file fails clearly.
 * - --record-fixture <path> (live only): saves the raw live response +
 *   usage + model + promptVersion + timestamp marked "recorded from live call".
 */
import { parseFramesSidecar, parseTranscript, resolveFrames, validateBrief } from "@second-seat/core";
import type { EvidenceBrief } from "@second-seat/core";
import {
  BRIEF_MODEL,
  BRIEF_PROMPT_VERSION,
  FixtureClient,
  briefMode,
  type BriefResult,
} from "./muse.js";

export interface RunBriefOptions {
  inputDir: string;
  outDir: string;
  fixturePath?: string;
  recordFixturePath?: string;
}

export function parseArgs(argv: string[]): RunBriefOptions {
  const positional: string[] = [];
  let outDir: string | undefined;
  let fixturePath: string | undefined;
  let recordFixturePath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--out") {
      outDir = argv[(i += 1)] as string;
    } else if (arg === "--fixture") {
      fixturePath = argv[(i += 1)] as string;
    } else if (arg === "--record-fixture") {
      recordFixturePath = argv[(i += 1)] as string;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const inputDir = positional[0];
  if (inputDir === undefined || inputDir === "") {
    throw new Error("usage: brief:run <dir> [--out <dir>] [--fixture <path>] [--record-fixture <path>]");
  }
  return {
    inputDir,
    outDir: outDir ?? inputDir,
    ...(fixturePath === undefined ? {} : { fixturePath }),
    ...(recordFixturePath === undefined ? {} : { recordFixturePath }),
  };
}

function resolveFixturePath(options: RunBriefOptions): string {
  if (options.fixturePath !== undefined) {
    return options.fixturePath;
  }
  const envPath = process.env["EVIDENCE_BRIEF_FIXTURE"];
  if (envPath !== undefined && envPath !== "") {
    return envPath;
  }
  return `${options.inputDir.replace(/\/$/, "")}/brief.recorded.json`;
}

function renderMarkdown(brief: EvidenceBrief): string {
  const lines = [`# Brief ${brief.meetingId}`, ""];
  lines.push(`model: ${brief.model} · prompt: ${brief.promptVersion} · created: ${brief.createdAt}`);
  lines.push("");
  for (const entry of brief.entries) {
    const flagged = entry.flags.length > 0 ? ` [${entry.flags.join(", ")}]` : "";
    lines.push(`## ${entry.id} (${entry.category})${flagged}`);
    lines.push("");
    lines.push(entry.text);
    lines.push("");
    for (const citation of entry.citations) {
      const id = citation.kind === "segment" ? citation.segmentId : citation.frameId;
      lines.push(`- ${citation.kind}: ${id ?? "?"}`);
    }
    lines.push("");
  }
  if (brief.flagged.length > 0) {
    lines.push(`Flagged: ${brief.flagged.join(", ")}`);
  }
  return lines.join("\n");
}

export async function runBrief(options: RunBriefOptions): Promise<{ brief: EvidenceBrief; outDir: string }> {
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { basename, join } = await import("node:path");

  const inputPrefix = options.inputDir.replace(/\/$/, "");
  const transcriptText = await readFile(join(inputPrefix, "transcript.txt"), "utf8");
  let framesSidecarText = "";
  try {
    framesSidecarText = await readFile(join(inputPrefix, "frames.txt"), "utf8");
  } catch {
    framesSidecarText = "";
  }

  const mode = briefMode();
  let result: BriefResult;
  if (mode === "live") {
    throw new Error("brief:run live mode is disabled: owner review of the redacted text is required (use the web session)");
  } else {
    const fixturePath = resolveFixturePath(options);
    result = await new FixtureClient(fixturePath).completeBrief({
      meetingId: basename(inputPrefix),
      transcriptText,
      framesSidecarText,
      fixtureMode: true,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.rawText) as unknown;
  } catch {
    throw new Error("model output is not valid JSON");
  }
  const segments = parseTranscript(transcriptText);
  const sidecarFiles =
    framesSidecarText.trim() === "" ? [] : parseFramesSidecar(framesSidecarText).map((row) => row.file);
  const frames =
    framesSidecarText === ""
      ? resolveFrames({ files: sidecarFiles })
      : resolveFrames({ files: sidecarFiles, sidecarText: framesSidecarText });
  void BRIEF_MODEL;
  void BRIEF_PROMPT_VERSION;
  const brief = validateBrief(parsed as EvidenceBrief, {
    segments: segments.map((s) => ({ id: s.id, speaker: s.speaker, text: s.text })),
    frames: frames.map((f) => ({ id: f.id })),
  });

  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
  await writeFile(join(options.outDir, "brief.md"), renderMarkdown(brief), "utf8");
  return { brief, outDir: options.outDir };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("cli.js") || process.argv[1].endsWith("cli.ts"));
if (invokedAsScript) {
  runBrief(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
