import type { GoogleOAuthPurpose } from "./googleOAuthState.js";

export const GOOGLE_SCOPES = Object.freeze({
  "calendar-read": "https://www.googleapis.com/auth/calendar.events.readonly",
  "meet-read": "https://www.googleapis.com/auth/meetings.space.readonly",
  "gmail-draft": "https://www.googleapis.com/auth/gmail.compose",
  "gmail-send": "https://www.googleapis.com/auth/gmail.send",
  "docs-create": "https://www.googleapis.com/auth/drive.file",
} as const);

export function buildGoogleOAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  purpose: GoogleOAuthPurpose;
  state: string;
  codeChallenge: string;
}): string {
  const { clientId, redirectUri, purpose, state, codeChallenge } = args;
  if (typeof clientId !== "string" || !clientId.trim() || clientId.length > 500 || /[\x00-\x1F\x7F]/.test(clientId)) throw new Error("Google authorization failed");
  let u: URL;
  try { u = new URL(redirectUri); } catch { throw new Error("Google authorization failed"); }
  if (u.username || u.password || u.search || u.hash) throw new Error("Google authorization failed");
  if (u.protocol === "https:") { /* ok */ } else if (u.protocol === "http:") {
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1" && u.hostname !== "::1" && u.hostname !== "[::1]") throw new Error("Google authorization failed");
  } else throw new Error("Google authorization failed");
  if (!Object.prototype.hasOwnProperty.call(GOOGLE_SCOPES, purpose)) throw new Error("Google authorization failed");
  if (!/^[0-9a-f]{64}$/.test(state)) throw new Error("Google authorization failed");
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new Error("Google authorization failed");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES[purpose]);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}
