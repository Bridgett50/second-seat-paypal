/** Payload inspector log: records every text and image sent to Spark/SAM. */
import { createHash } from "node:crypto";

export interface LoggedText {
  kind: "text";
  sha256: string;
  masked: true;
  length: number;
  preview: string;
}

export interface LoggedImage {
  kind: "image";
  name: string;
  sha256: string;
  masked: true;
  bytes: number;
}

export interface PayloadSnapshot {
  redactorLabel: string;
  texts: LoggedText[];
  images: LoggedImage[];
}

let redactorLabel = "Glimmer: MOCK (TODO(glimmer-hosting))";
const texts: LoggedText[] = [];
const images: LoggedImage[] = [];

export function setRedactorLabel(label: string): void {
  redactorLabel = label;
}

export function logText(maskedText: string): LoggedText {
  const entry: LoggedText = {
    kind: "text",
    sha256: createHash("sha256").update(maskedText, "utf8").digest("hex"),
    masked: true,
    length: maskedText.length,
    preview: maskedText.slice(0, 200),
  };
  texts.push(entry);
  return entry;
}

export function logImage(name: string, png: Buffer, masked: boolean): LoggedImage {
  if (!masked) throw new Error("payload: refusing to log an unmasked image");
  const entry: LoggedImage = {
    kind: "image",
    name,
    sha256: createHash("sha256").update(png).digest("hex"),
    masked: true,
    bytes: png.length,
  };
  images.push(entry);
  return entry;
}

export function snapshot(): PayloadSnapshot {
  return { redactorLabel, texts: [...texts], images: [...images] };
}

export function clearPayloadLog(): void {
  texts.length = 0;
  images.length = 0;
}
