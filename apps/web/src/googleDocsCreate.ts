import { createHash } from "node:crypto";
type Payload = Readonly<{ title: string; text: string }>;
type HashArgs = Readonly<{ title: string; text: string }>;
export type GoogleDocsCreateResult =
| { readonly status: "created"; readonly documentId: string; readonly packageHash: string }
| { readonly status: "partial"; readonly documentId: string; readonly packageHash: string }
| { readonly status: "unconfirmed"; readonly packageHash: string; readonly documentId?: string }
| { readonly status: "unavailable" };
type WriterDeps = {
readonly fetcher: typeof fetch;
readonly getToken: (browserKey: string) => string | null;
readonly isCurrent: (browserKey: string, packageHash: string) => boolean;
readonly claimApproval: (browserKey: string, packageHash: string) => boolean;
};
const DOCS_CREATE_URL = "https://docs.googleapis.com/v1/documents";
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
function isRecord(v: unknown): v is Record<string, unknown> {
return typeof v === "object" && v !== null && !Array.isArray(v);
}
function containsNul(s: string): boolean {
return s.indexOf("\0") !== -1;
}
function validatePayload(p: unknown): Payload {
if (!isRecord(p)) throw new Error("Invalid package");
const keys = Reflect.ownKeys(p);
if (keys.length !== 2) throw new Error("Invalid package");
if (!keys.includes("title") || !keys.includes("text")) throw new Error("Invalid package");
const rec = p as Record<string, unknown>;
const title = rec["title"];
const text = rec["text"];
if (typeof title !== "string" || typeof text !== "string") throw new Error("Invalid package");
if (title.trim().length === 0 || text.trim().length === 0) throw new Error("Invalid package");
if (title.length > 200 || text.length > 20000) throw new Error("Invalid package");
if (containsNul(title) || containsNul(text)) throw new Error("Invalid package");
return { title, text };
}
export function googleDocsPackageHash(input: HashArgs): string {
let validated: Payload;
try {
validated = validatePayload(input as unknown);
} catch {
throw new Error("Invalid package");
}
return createHash("sha256").update(JSON.stringify({ title: validated.title, text: validated.text }), "utf8").digest("hex");
}
function safeIsCurrent(deps: WriterDeps, browserKey: string, packageHash: string): boolean {
try { return deps.isCurrent(browserKey, packageHash) === true; } catch { return false; }
}
function safeClaimApproval(deps: WriterDeps, browserKey: string, packageHash: string): boolean {
try { return deps.claimApproval(browserKey, packageHash) === true; } catch { return false; }
}
function safeGetToken(deps: WriterDeps, browserKey: string): string | null {
try { return deps.getToken(browserKey); } catch { return null; }
}
export function createGoogleDocsWriter(deps: WriterDeps): { createDoc: (browserKey: string, payload: unknown, signal: AbortSignal) => Promise<GoogleDocsCreateResult> } {
async function createDoc(browserKey: string, payload: unknown, signal: AbortSignal): Promise<GoogleDocsCreateResult> {
let validated: Payload;
let packageHash: string;
try {
validated = validatePayload(payload);
packageHash = googleDocsPackageHash(validated);
} catch {
return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
}
if (typeof browserKey !== "string" || browserKey.trim().length === 0) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
const titleSnap = validated.title;
const textSnap = validated.text;
const hashSnap = packageHash;
if (signal.aborted) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (!safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
const tokenBeforeClaim = safeGetToken(deps, browserKey);
if (typeof tokenBeforeClaim !== "string" || tokenBeforeClaim.length === 0) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (signal.aborted) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (!safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
const claimed = safeClaimApproval(deps, browserKey, hashSnap);
if (!claimed) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (signal.aborted) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (!safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
const token = safeGetToken(deps, browserKey);
if (typeof token !== "string" || token.length === 0) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
if (token !== tokenBeforeClaim) return Object.freeze({ status: "unavailable" } as GoogleDocsCreateResult);
let res1: Response;
try {
res1 = await deps.fetcher(DOCS_CREATE_URL, {
method: "POST",
redirect: "error",
signal,
headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
body: JSON.stringify({ title: titleSnap }),
});
} catch {
return Object.freeze({ status: "unconfirmed", packageHash: hashSnap } as GoogleDocsCreateResult);
}
const guardFailedAfterFetch1 = signal.aborted || !safeIsCurrent(deps, browserKey, hashSnap) || safeGetToken(deps, browserKey) !== token;
let json1: unknown;
try { json1 = await res1.json(); } catch { return Object.freeze({ status: "unconfirmed", packageHash: hashSnap } as GoogleDocsCreateResult); }
if (!res1.ok) return Object.freeze({ status: "unconfirmed", packageHash: hashSnap } as GoogleDocsCreateResult);
if (!isRecord(json1)) return Object.freeze({ status: "unconfirmed", packageHash: hashSnap } as GoogleDocsCreateResult);
const rawId = (json1 as Record<string, unknown>)["documentId"];
if (typeof rawId !== "string" || !ID_RE.test(rawId)) return Object.freeze({ status: "unconfirmed", packageHash: hashSnap } as GoogleDocsCreateResult);
const documentId = rawId;
if (guardFailedAfterFetch1) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (signal.aborted || !safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
const token2 = safeGetToken(deps, browserKey);
if (typeof token2 !== "string" || token2.length === 0 || token2 !== token) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
const batchUrl = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
let res2: Response;
try {
res2 = await deps.fetcher(batchUrl, {
method: "POST",
redirect: "error",
signal,
headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: textSnap } }] }),
});
} catch {
return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
}
if (signal.aborted || !safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (safeGetToken(deps, browserKey) !== token2) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (!res2.ok) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
let json2: unknown;
try { json2 = await res2.json(); } catch { return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult); }
if (signal.aborted || !safeIsCurrent(deps, browserKey, hashSnap)) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (safeGetToken(deps, browserKey) !== token2) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (!isRecord(json2)) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
const r2DocId = (json2 as Record<string, unknown>)["documentId"];
const replies = (json2 as Record<string, unknown>)["replies"];
if (typeof r2DocId !== "string" || r2DocId !== documentId) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (!Array.isArray(replies) || replies.length !== 1) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
if (!isRecord(replies[0] as unknown) || Reflect.ownKeys(replies[0] as object).length !== 0) return Object.freeze({ status: "partial", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
return Object.freeze({ status: "created", documentId, packageHash: hashSnap } as GoogleDocsCreateResult);
}
return { createDoc };
}
