import { pathToFileURL } from "node:url";

/** Node ESM import specifier. Do not hand-build file:// strings. */
export function toNodeImportSpecifier(filePath) {
  return pathToFileURL(filePath).href;
}
