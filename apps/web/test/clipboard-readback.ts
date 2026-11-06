/** Exact approved text versus a native clipboard readback. Linux stays exact. */
export function clipboardReadbackMatches(
  approved: string,
  readback: string,
  platform: "linux" | "win32",
): boolean {
  if (platform === "linux") return approved === readback;
  if (approved === readback) return true;
  if (approved.includes("\r")) return false;
  return readback === approved.replace(/\n/g, "\r\n");
}
