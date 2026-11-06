// C6 sealed-data filesystem guard (hermetic offline tests) + D3 hardening.
// Rejects reads, listings, copies and opens under sealed roots BEFORE
// touching disk, in-process and in spawned subprocesses (via NODE_OPTIONS).
// Sealed roots come from <repo>/.sealed-paths (trailing "/" = directory,
// otherwise an exact file prefix); /workspace/heldout-sealed is always
// an extra absolute root. Matching is case-insensitive, backslashes are
// treated as separators, and symlinks are canonicalized via realpath of
// the deepest existing ancestor (both lexical and canonical forms checked).
// Recursive operations additionally refuse ancestor directories of sealed
// roots via containsSealed. Child processes are refused when the command
// or any arg names a sealed root (exclusion patternspecs starting with
// "!" or ":" excepted; plain node -e/--eval payloads are enforced in-child
// through the propagated guard, while payloads hiding a sealed spelling
// behind quote-concatenation are refused up front), or when a recursive copier/
// reader (cp -r/-R/-a, rsync, tar, zip, git grep/archive/cat-file/show,
// grep -r/-R, find, cat) is given a sealed or ancestor path. Leaves
// stat/lstat/exists untouched.
import fs from "node:fs";
import fsp from "node:fs/promises";
import child_process from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeImportSpecifier } from "./import-url.mjs";
import { syncBuiltinESMExports } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..", "..");
const ownPath = join(here, "sealed-guard.mjs");

// Originals captured before patching.
const origReadFileSync = fs.readFileSync;
const origExistsSync = fs.existsSync;
const origRealpathNative = fs.realpathSync.native;
const origLstatSync = fs.lstatSync;
const origReadlinkSync = fs.readlinkSync;

const sealedDirRoots = [resolve("/workspace/heldout-sealed")];
const sealedFilePrefixes = [];
const relTexts = [];
{
  let entries = [];
  try {
    const raw = origReadFileSync(join(repo, ".sealed-paths"), "utf8");
    entries = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    entries = [];
  }
  if (entries.length === 0) {
    entries = [
      "services/bot/fixtures/holdout-v1/",
      "eval/heldout/",
      "eval/heldout-presealed.sha256",
      "eval/shield-heldout.sha256",
    ];
  }
  for (const e of entries) {
    const clean = e.replace(/\\/g, "/").replace(/\/+$/, "");
    relTexts.push(clean.toLowerCase());
    if (e.endsWith("/")) sealedDirRoots.push(resolve(repo, clean));
    else sealedFilePrefixes.push(resolve(repo, clean));
  }
}
const fwdLower = (p) => p.replace(/\\/g, "/").toLowerCase();
const sealedDirLower = sealedDirRoots.map((d) => fwdLower(d));
const sealedFileLower = sealedFilePrefixes.map((f) => fwdLower(f));
const allRootsLower = [...sealedDirLower, ...sealedFileLower];
const needles = [...allRootsLower, ...relTexts];

function toPathString(p) {
  if (typeof p === "string") return p;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL) {
    try {
      return fileURLToPath(p);
    } catch {
      return null;
    }
  }
  return null;
}

function lexResolve(p) {
  const s = toPathString(p);
  if (s === null) return null;
  try {
    return resolve(s.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

// Canonicalize without reading file contents: realpath the deepest
// existing ancestor (stat only), then re-append the remainder.
function canonicalize(abs, depth = 0) {
  try {
    if (depth > 40) return null;
    let cur = abs;
    const tail = [];
    for (;;) {
      let st;
      try {
        st = origLstatSync(cur, { throwIfNoEntry: false });
      } catch {
        st = undefined;
      }
      if (
        st !== undefined &&
        st !== null &&
        typeof st.isSymbolicLink === "function" &&
        st.isSymbolicLink()
      ) {
        let ex = false;
        try {
          ex = origExistsSync(cur);
        } catch {
          ex = false;
        }
        if (!ex) {
          let target;
          try {
            target = origReadlinkSync(cur);
          } catch {
            return null;
          }
          const s = toPathString(target);
          if (s === null) return null;
          const t = s.replace(/\\/g, "/");
          const resolved =
            t.startsWith("/") || /^[A-Za-z]:\//.test(t)
              ? resolve(t)
              : resolve(dirname(cur), t);
          const next = tail.length === 0 ? resolved : join(resolved, ...tail);
          return canonicalize(next, depth + 1);
        }
      }
      let ex = false;
      try {
        ex = origExistsSync(cur);
      } catch {
        ex = false;
      }
      if (ex) break;
      const parent = dirname(cur);
      if (parent === cur) return null;
      tail.unshift(cur.slice(parent.length).replace(/^[/\\]/, ""));
      cur = parent;
    }
    let real;
    try {
      real = origRealpathNative(cur);
    } catch {
      return null;
    }
    return tail.length === 0 ? real : join(real, ...tail);
  } catch {
    return null;
  }
}

function matchSealed(abs) {
  const l = fwdLower(abs);
  for (const d of sealedDirLower) {
    if (l === d || l.startsWith(d + "/")) return true;
  }
  for (const f of sealedFileLower) {
    if (l === f || l.startsWith(f)) return true;
  }
  return false;
}

export function isSealedPath(p) {
  const lex = lexResolve(p);
  if (lex === null) return false;
  if (matchSealed(lex)) return true;
  const canon = canonicalize(lex);
  return canon !== null && canon !== lex && matchSealed(canon);
}

// True when p is sealed OR p is an ancestor directory of any sealed root
// (case-insensitive, canonicalized). Used for recursive operations.
export function containsSealed(p) {
  if (isSealedPath(p)) return true;
  const lex = lexResolve(p);
  if (lex === null) return false;
  const forms = [lex];
  const canon = canonicalize(lex);
  if (canon !== null && canon !== lex) forms.push(canon);
  for (const f of forms) {
    const l = fwdLower(f);
    for (const r of allRootsLower) {
      if (r === l || r.startsWith(l + "/")) return true;
    }
  }
  return false;
}

function splitShell(s) {
  const out = [];
  let cur = "";
  let q = null;
  for (const ch of s) {
    if (q !== null) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function baseCmd(cmdStr) {
  const toks = splitShell(cmdStr.trim());
  const first = (toks[0] ?? "").replace(/^["']+|["']+$/g, "");
  const last = first.replace(/\\/g, "/").split("/").pop() ?? "";
  return last.toLowerCase().replace(/\.exe$/, "");
}

// Strip quote-concatenation joins used to split a sealed spelling across
// adjacent string literals ("a" + "b", 'a' 'b') before text matching.
function normalizeInline(s) {
  return s.replace(/['"]\s*\+?\s*['"]/g, "");
}

function hasSealedText(s) {
  const h = fwdLower(s);
  for (const n of needles) {
    let i = h.indexOf(n);
    while (i !== -1) {
      const after = h[i + n.length];
      if (
        after === undefined ||
        after === "/" ||
        after === '"' ||
        after === "'" ||
        after === " " ||
        after === "\t" ||
        after === "\n" ||
        after === "\r" ||
        after === ":" ||
        after === "=" ||
        after === "," ||
        after === ";"
      ) {
        return true;
      }
      i = h.indexOf(n, i + 1);
    }
  }
  return false;
}

function isRecursiveCmd(base, argStrs, toks) {
  const dash = argStrs.concat(toks).filter((a) => a.startsWith("-"));
  if (base === "cp") return dash.some((a) => /[rRa]/.test(a));
  if (base === "grep") return dash.some((a) => /[rR]/.test(a));
  if (base === "rsync" || base === "tar" || base === "zip" || base === "find" || base === "cat") return true;
  if (base === "git") {
    const words = argStrs.concat(toks);
    return words.some((a) => a === "grep" || a === "archive" || a === "cat-file" || a === "show");
  }
  return false;
}

// Returns null when the spawn is allowed, else the offending string.
export function guardChildArgs(cmd, args, cwd = process.cwd()) {
  const cmdStr = toPathString(cmd) ?? (cmd === undefined || cmd === null ? "" : String(cmd));
  const raw = Array.isArray(args) ? args : args === undefined ? [] : [args];
  const argStrs = [];
  for (const a of raw) {
    const s = toPathString(a);
    if (s !== null) argStrs.push(s);
  }
  const base = baseCmd(cmdStr);
  const isNode = base === "node" || base === "nodejs";
  const evalFlags = new Set(["-e", "--eval", "-p", "--print"]);
  const toks = splitShell(cmdStr);
  // Direct sealed-root naming. Node -e/--eval payloads are enforced
  // in-child via the propagated guard, so they are skipped here;
  // exclusion patternspecs ("!"/":") never read data either.
  let scan = [];
  if (isNode && toks.some((t) => evalFlags.has(t))) scan.push(toks[0] ?? "");
  else scan.push(cmdStr);
  let skipNext = false;
  for (const a of argStrs) {
    if (isNode && evalFlags.has(a)) {
      skipNext = true;
      continue;
    }
    if (skipNext) {
      skipNext = false;
      // Node -e/--eval payloads are enforced in-child via the propagated
      // guard, so plain sealed text stays skipped here; only refuse up front
      // when the payload hides the spelling behind quote-concatenation.
      if (!hasSealedText(a) && hasSealedText(normalizeInline(a))) return a;
      continue;
    }
    scan.push(a);
  }
  for (const s of scan) {
    if (s.startsWith("!") || s.startsWith(":")) continue;
    if (hasSealedText(s) || hasSealedText(normalizeInline(s))) return s;
  }
  // cp/mv/cat-like commands: resolve the realpath of existing paths before
  // checking, so a symlink at an innocent name pointing at a sealed or
  // sealed-like target is still refused.
  if (base === "cp" || base === "mv" || base === "cat") {
    const cands = [];
    for (const t of toks.slice(1)) {
      if (t === "" || t.startsWith("-") || t.startsWith(":") || t.startsWith("!")) continue;
      cands.push(t);
    }
    for (const a of argStrs) {
      if (a === "" || a.startsWith("-") || a.startsWith(":") || a.startsWith("!")) continue;
      cands.push(a);
    }
    const cwdStr = toPathString(cwd) || process.cwd();
    for (const c of cands) {
      const lex = lexResolve(resolve(cwdStr, c));
      if (lex === null) continue;
      const canon = canonicalize(lex);
      const real = canon ?? lex;
      if (hasSealedText(real)) return c;
      if (canon !== null && canon !== lex && matchSealed(canon)) return c;
    }
  }
  if (isRecursiveCmd(base, argStrs, toks)) {
    const cands = [];
    for (const t of toks.slice(1)) {
      if (t === "" || t.startsWith("-") || t.startsWith(":") || t.startsWith("!")) continue;
      cands.push(t);
    }
    for (const a of argStrs) {
      if (a === "" || a.startsWith("-") || a.startsWith(":") || a.startsWith("!")) continue;
      cands.push(a);
    }
    const cwdStr = toPathString(cwd) || process.cwd();
    for (const c of cands) {
      if (containsSealed(resolve(cwdStr, c))) return c;
    }
  }
  return null;
}

function sealedError(p) {
  const err = new Error(`sealed data access forbidden: ${String(toPathString(p) ?? p)}`);
  err.code = "SEALED_ACCESS";
  return err;
}

function checkOne(p) {
  if (isSealedPath(p)) throw sealedError(p);
}

function isCallback(v) {
  return typeof v === "function";
}

function optsRecursive(rest) {
  return rest.some((a) => a !== null && typeof a === "object" && !Array.isArray(a) && a.recursive === true);
}

// Callback-style async fs fn: fail via callback when one is present,
// otherwise throw synchronously (mirrors Node's sync validation).
function guardFirstArgCallback(orig, recursiveAware) {
  return function guarded(...args) {
    if (args.length > 0) {
      const blocked = recursiveAware && optsRecursive(args.slice(1)) ? containsSealed(args[0]) : isSealedPath(args[0]);
      if (blocked) {
        const err = sealedError(args[0]);
        const last = args[args.length - 1];
        if (isCallback(last)) {
          process.nextTick(() => last(err));
          return undefined;
        }
        throw err;
      }
    }
    return orig.apply(this, args);
  };
}

function guardCopyCallback(orig) {
  return function guarded(src, dest, ...rest) {
    if (containsSealed(src)) {
      const err = sealedError(src);
      const last = rest[rest.length - 1];
      if (isCallback(last)) {
        process.nextTick(() => last(err));
        return undefined;
      }
      throw err;
    }
    if (isSealedPath(dest)) {
      const err = sealedError(dest);
      const last = rest[rest.length - 1];
      if (isCallback(last)) {
        process.nextTick(() => last(err));
        return undefined;
      }
      throw err;
    }
    return orig.call(this, src, dest, ...rest);
  };
}

function guardCopyFileCallback(orig) {
  return function guarded(src, dest, ...rest) {
    if (isSealedPath(src) || isSealedPath(dest)) {
      const err = sealedError(isSealedPath(src) ? src : dest);
      const last = rest[rest.length - 1];
      if (isCallback(last)) {
        process.nextTick(() => last(err));
        return undefined;
      }
      throw err;
    }
    return orig.call(this, src, dest, ...rest);
  };
}

function guardSync(orig, recursiveAware) {
  return function guarded(...args) {
    if (args.length > 0) {
      if (recursiveAware && optsRecursive(args.slice(1))) {
        if (containsSealed(args[0])) throw sealedError(args[0]);
      } else checkOne(args[0]);
    }
    return orig.apply(this, args);
  };
}

function guardCopySync(orig) {
  return function guarded(src, dest, ...rest) {
    if (containsSealed(src)) throw sealedError(src);
    if (isSealedPath(dest)) throw sealedError(dest);
    return orig.call(this, src, dest, ...rest);
  };
}

function guardCopyFileSync(orig) {
  return function guarded(src, dest, ...rest) {
    if (isSealedPath(src)) throw sealedError(src);
    if (isSealedPath(dest)) throw sealedError(dest);
    return orig.call(this, src, dest, ...rest);
  };
}

function guardPromiseFirstArg(orig, recursiveAware) {
  return function guarded(...args) {
    if (args.length > 0) {
      const blocked = recursiveAware && optsRecursive(args.slice(1)) ? containsSealed(args[0]) : isSealedPath(args[0]);
      if (blocked) return Promise.reject(sealedError(args[0]));
    }
    return orig.apply(this, args);
  };
}

function guardPromiseCopy(orig) {
  return function guarded(src, dest, ...rest) {
    if (containsSealed(src)) return Promise.reject(sealedError(src));
    if (isSealedPath(dest)) return Promise.reject(sealedError(dest));
    return orig.call(this, src, dest, ...rest);
  };
}

function guardPromiseCopyFile(orig) {
  return function guarded(src, dest, ...rest) {
    if (isSealedPath(src)) return Promise.reject(sealedError(src));
    if (isSealedPath(dest)) return Promise.reject(sealedError(dest));
    return orig.call(this, src, dest, ...rest);
  };
}

function guardStream(orig) {
  return function guarded(path, ...rest) {
    checkOne(path);
    return orig.call(this, path, ...rest);
  };
}

function checkGlob(pats, opts) {
  let cwd = process.cwd();
  if (opts !== null && typeof opts === "object" && typeof opts.cwd === "string" && opts.cwd !== "") cwd = opts.cwd;
  if (containsSealed(cwd)) throw sealedError(cwd);
  const list = Array.isArray(pats) ? pats : [pats];
  for (const p of list) {
    if (typeof p !== "string") continue;
    const m = p.search(/[*?{\[]/);
    const head = m === -1 ? p : p.slice(0, m);
    const base = head === "" ? cwd : resolve(cwd, head.replace(/\\/g, "/"));
    if (containsSealed(base)) throw sealedError(p);
  }
}

function splitChildArgs(all) {
  const cmd = all[0];
  let list = [];
  let options;
  for (const a of all.slice(1)) {
    if (Array.isArray(a)) list = a;
    else if (a !== null && typeof a === "object" && typeof a !== "function") options = a;
  }
  return { cmd, list, options };
}

// Async child entry points throw synchronously on refusal.
function guardChild(orig) {
  return function guarded(...all) {
    const { cmd, list, options } = splitChildArgs(all);
    const cwdOpt = options?.cwd;
    const childCwd = typeof cwdOpt === "string" || cwdOpt instanceof URL ? cwdOpt : process.cwd();
    const off = guardChildArgs(cmd, list, childCwd);
    if (off !== null) throw sealedError(off);
    if (options !== undefined && options !== null && typeof options === "object") {
      const env = options.env;
      if (env !== undefined && env !== null && typeof env === "object") {
        try {
          const flag = `--import ${toNodeImportSpecifier(ownPath)}`;
          const cur = env["NODE_OPTIONS"] ?? "";
          if (typeof cur === "string" && !cur.includes(ownPath)) {
            env["NODE_OPTIONS"] = cur ? `${cur} ${flag}` : flag;
          }
        } catch {
          /* env propagation is best-effort */
        }
      }
    }
    return orig.apply(this, all);
  };
}

if (!globalThis.__sealedGuardInstalled) {
  // Sync reads / listings / copies / opens.
  fs.readFileSync = guardSync(fs.readFileSync, false);
  fs.readdirSync = guardSync(fs.readdirSync, true);
  fs.opendirSync = guardSync(fs.opendirSync, true);
  fs.cpSync = guardCopySync(fs.cpSync);
  fs.copyFileSync = guardCopyFileSync(fs.copyFileSync);
  fs.openSync = guardSync(fs.openSync, false);
  // Callback-style async entry points.
  fs.readFile = guardFirstArgCallback(fs.readFile, false);
  fs.readdir = guardFirstArgCallback(fs.readdir, true);
  fs.opendir = guardFirstArgCallback(fs.opendir, true);
  fs.cp = guardCopyCallback(fs.cp);
  fs.copyFile = guardCopyFileCallback(fs.copyFile);
  fs.open = guardFirstArgCallback(fs.open, false);
  fs.createReadStream = guardStream(fs.createReadStream);
  // Promise entry points.
  fsp.readFile = guardPromiseFirstArg(fsp.readFile, false);
  fsp.readdir = guardPromiseFirstArg(fsp.readdir, true);
  fsp.opendir = guardPromiseFirstArg(fsp.opendir, true);
  fsp.cp = guardPromiseCopy(fsp.cp);
  fsp.copyFile = guardPromiseCopyFile(fsp.copyFile);
  fsp.open = guardPromiseFirstArg(fsp.open, false);
  // Glob entry points, where present (Node 22+).
  if (typeof fs.globSync === "function") {
    const orig = fs.globSync;
    fs.globSync = function guarded(...args) {
      checkGlob(args[0], args[1]);
      return orig.apply(this, args);
    };
  }
  if (typeof fsp.glob === "function") {
    const orig = fsp.glob;
    fsp.glob = function guarded(...args) {
      checkGlob(args[0], args[1]);
      return orig.apply(this, args);
    };
  }
  // Spawned processes: refuse sealed argv, propagate the guard.
  for (const k of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    child_process[k] = guardChild(child_process[k]);
  }
  try {
    syncBuiltinESMExports();
  } catch {
    /* older runtimes: named ESM bindings already share the CJS object */
  }
  globalThis.__sealedGuardInstalled = true;
}

// Propagate to spawned node subprocesses that inherit this env.
try {
  const flag = `--import ${toNodeImportSpecifier(ownPath)}`;
  const cur = process.env["NODE_OPTIONS"] ?? "";
  if (!cur.includes(ownPath)) {
    process.env["NODE_OPTIONS"] = cur ? `${cur} ${flag}` : flag;
  }
} catch {
  /* env propagation is best-effort */
}
