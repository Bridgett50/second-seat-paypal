import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const REQUIRED_FIXTURES = [];
const HEX40_RE = /^[0-9a-f]{40}$/;

// Strict semver-like version pattern: X.Y.Z optionally with prerelease/build
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isExcludedName(name) {
  if (name === ".git") return true;
  if (name.startsWith(".env")) return true;
  if (name.endsWith(".pem")) return true;
  if (name.endsWith(".key")) return true;
  if (name.includes("secret")) return true;
  if (name === "eval") return true;
  if (name === "fixtures") return true;
  if (name === "test" || name === "tests") return true;
  if (name.startsWith("e2e")) return true;
  if (name === "node_modules") return true;
  if (name.endsWith(".test.js")) return true;
  if (name.endsWith(".map")) return true;
  if (name.endsWith(".d.ts")) return true;
  if (name.includes("heldout") || name.includes("holdout") || name.includes("sealed")) return true;
  return false;
}

function isForbiddenComponent(name) {
  if (name === ".git") return true;
  if (name.startsWith(".env")) return true;
  if (name === "eval") return true;
  if (name === "fixtures") return true;
  if (name.includes("heldout") || name.includes("holdout") || name.includes("sealed") || name.includes("secret")) return true;
  return false;
}

function validateSourceSha(sha) {
  if (!HEX40_RE.test(sha)) {
    throw new Error("invalid --source-sha: must be 40 lowercase hex");
  }
}

function assertNotSymlink(absPath) {
  let st;
  try {
    st = fs.lstatSync(absPath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`symlink not allowed: ${absPath}`);
  }
  return st;
}

// Check every ancestor component of fixed allowlisted paths.
// repoRoot itself may be anything and is not checked.
function checkAllowlistedAncestors(repoRoot) {
  // Fixed allowlisted input paths (files and dirs). The parser link itself is
  // allowed to be a symlink, so we only check its parent ancestors.
  const ancestorDirs = [
    "apps/web",
    "apps/web/dist",
    "apps/web/dist/src",
    "packages/core",
    "packages/core/dist",
    "packages/core/dist/src",
    "services/bot",
    "services/bot/dist",
    "services/bot/dist/src",
    "services/bot/node_modules",
    "services/bot/node_modules/@meta-sam",
  ];
  for (const rel of ancestorDirs) {
    const parts = rel.split("/").filter(Boolean);
    let cur = repoRoot;
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      let st;
      try {
        st = fs.lstatSync(cur);
      } catch (e) {
        // Missing ancestors will be reported later as missing required file/dir,
        // but if it exists as symlink we must fail.
        break;
      }
      if (st.isSymbolicLink()) {
        throw new Error(`symlinked ancestor not allowed: ${cur}`);
      }
    }
  }
}

// Validate and resolve the single approved parser symlink.
// Returns { lexResolved, parserReal } where both are absolute paths.
function resolveParserLink(repoRoot) {
  const parserLinkPath = path.join(repoRoot, "services/bot/node_modules/@meta-sam/parser");

  // Must be a symlink
  let lst;
  try {
    lst = fs.lstatSync(parserLinkPath);
  } catch {
    throw new Error(`missing required parser package: ${parserLinkPath}`);
  }
  if (!lst.isSymbolicLink()) {
    throw new Error(`parser link not a symlink: ${parserLinkPath}`);
  }

  // Read link value (not realpath)
  let rawTarget;
  try {
    rawTarget = fs.readlinkSync(parserLinkPath);
  } catch (e) {
    throw new Error(`parser link readlink failed: ${parserLinkPath}: ${e.message}`);
  }

  // Reject absolute targets
  if (path.isAbsolute(rawTarget)) {
    throw new Error(`parser link destination not allowed (absolute target): ${parserLinkPath} -> ${rawTarget}`);
  }

  // Reject forbidden components in the raw link value
  // Split on both / and \ to be safe
  const rawParts = rawTarget.split(/[/\\]+/).filter((p) => p.length > 0 && p !== "." && p !== "..");
  for (const comp of rawParts) {
    if (isForbiddenComponent(comp)) {
      throw new Error(`parser link destination not allowed (forbidden component in link value): ${parserLinkPath} -> ${rawTarget}`);
    }
  }

  // Lexically resolve against parent directory
  const linkParent = path.dirname(parserLinkPath);
  const lexResolved = path.resolve(linkParent, rawTarget);
  const repoResolved = path.resolve(repoRoot);

  // Must stay inside repo
  const relToRepo = path.relative(repoResolved, lexResolved);
  if (relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) {
    throw new Error(`parser link destination not allowed (escapes repo): ${parserLinkPath} -> ${rawTarget}`);
  }

  // Reject forbidden components in destination
  const destParts = relToRepo.split(path.sep).filter(Boolean);
  for (const comp of destParts) {
    if (isForbiddenComponent(comp)) {
      throw new Error(`parser link destination not allowed (forbidden component in destination): ${lexResolved}`);
    }
  }

  // Must match exact pattern: node_modules/.pnpm/@meta-sam+parser@<version>/node_modules/@meta-sam/parser
  // Validate structurally
  const expectedParts = destParts;
  // Expected: [node_modules, .pnpm, @meta-sam+parser@<version>, node_modules, @meta-sam, parser]
  if (expectedParts.length !== 6) {
    throw new Error(`parser link destination not allowed (unexpected layout): ${lexResolved}`);
  }
  if (
    expectedParts[0] !== "node_modules" ||
    expectedParts[1] !== ".pnpm" ||
    expectedParts[3] !== "node_modules" ||
    expectedParts[4] !== "@meta-sam" ||
    expectedParts[5] !== "parser"
  ) {
    throw new Error(`parser link destination not allowed (pattern mismatch): ${lexResolved}`);
  }
  const storeDir = expectedParts[2];
  const prefix = "@meta-sam+parser@";
  if (!storeDir.startsWith(prefix)) {
    throw new Error(`parser link destination not allowed (store pattern mismatch): ${lexResolved}`);
  }
  const version = storeDir.slice(prefix.length);
  if (!VERSION_RE.test(version)) {
    throw new Error(`parser link destination not allowed (bad version): ${lexResolved}`);
  }
  if (isForbiddenComponent(version)) {
    throw new Error(`parser link destination not allowed (forbidden version): ${lexResolved}`);
  }

  // lstat each component of destination below repo: none may be symlink, dest must be real directory
  let curAbs = repoResolved;
  for (let i = 0; i < destParts.length; i++) {
    curAbs = path.join(curAbs, destParts[i]);
    let st;
    try {
      st = fs.lstatSync(curAbs);
    } catch (e) {
      throw new Error(`parser link destination not allowed (missing component): ${curAbs}`);
    }
    if (st.isSymbolicLink()) {
      throw new Error(`parser link destination not allowed (symlinked component): ${curAbs}`);
    }
    if (i === destParts.length - 1) {
      if (!st.isDirectory()) {
        throw new Error(`parser link destination not allowed (not a directory): ${curAbs}`);
      }
    } else {
      // intermediate must be directory
      if (!st.isDirectory()) {
        throw new Error(`parser link destination not allowed (not a directory): ${curAbs}`);
      }
    }
  }

  // Only now may realpath be used, and must equal lexically resolved destination
  let real;
  try {
    real = fs.realpathSync(parserLinkPath);
  } catch (e) {
    throw new Error(`parser link realpath failed: ${parserLinkPath}: ${e.message}`);
  }
  // Compare resolved absolute normalized paths
  const normReal = path.resolve(real);
  const normLex = path.resolve(lexResolved);
  if (normReal !== normLex) {
    throw new Error(`parser link destination not allowed (realpath mismatch): ${normReal} != ${normLex}`);
  }

  return { lexResolved: normLex, parserReal: normLex };
}

function walkAllowlistedDir(absDir, archivePrefix) {
  const results = [];
  const stack = [absDir];
  const prefixLen = absDir.length;
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      if (cur === absDir) throw e;
      continue;
    }
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const absPath = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) {
        throw new Error(`symlink not allowed: ${absPath}`);
      }
      if (ent.isDirectory()) {
        stack.push(absPath);
      } else if (ent.isFile()) {
        if (!ent.name.endsWith(".js")) continue;
        const relInside = absPath.slice(prefixLen + 1).replace(/\\/g, "/");
        const archivePath = archivePrefix ? `${archivePrefix}/${relInside}` : relInside;
        const lst = fs.lstatSync(absPath);
        if (lst.isSymbolicLink()) throw new Error(`symlink not allowed: ${absPath}`);
        results.push({ sourceAbs: absPath, archivePath });
      }
    }
  }
  return results;
}

export function planRuntime(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const sourceSha = opts.sourceSha;
  validateSourceSha(sourceSha);

  // 1) Ancestor symlink checks before any content read
  checkAllowlistedAncestors(repoRoot);

  // 2) Parser link validation before any content read
  const { parserReal } = resolveParserLink(repoRoot);

  const plan = [];

  function requireFile(relPosix, archivePath) {
    const abs = path.join(repoRoot, relPosix);
    const st = assertNotSymlink(abs);
    if (!st || !st.isFile()) {
      throw new Error(`missing required file: ${relPosix}`);
    }
    plan.push({ sourceAbs: abs, archivePath });
  }

  function requireDir(relPosix) {
    const abs = path.join(repoRoot, relPosix);
    const st = assertNotSymlink(abs);
    if (!st || !st.isDirectory()) {
      throw new Error(`missing required directory: ${relPosix}`);
    }
    return abs;
  }

  requireFile("apps/web/package.json", "apps/web/package.json");

  const webDistSrc = requireDir("apps/web/dist/src");
  const webFiles = walkAllowlistedDir(webDistSrc, "apps/web/dist/src");
  const hasPublicStart = webFiles.some((e) => e.archivePath === "apps/web/dist/src/public-start.js");
  if (!hasPublicStart) {
    throw new Error("missing required file: apps/web/dist/src/public-start.js");
  }
  for (const e of webFiles) plan.push(e);

  for (const twin of ["apps/web/public/ai-self.png", "apps/web/public/ai-self.jpg"]) {
    const abs = path.join(repoRoot, twin);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) throw new Error(`symlink not allowed: ${abs}`);
    if (st.isFile()) {
      plan.push({ sourceAbs: abs, archivePath: twin });
      break;
    }
  }

  requireFile("packages/core/package.json", "node_modules/@second-seat/core/package.json");
  const coreDistSrc = requireDir("packages/core/dist/src");
  const coreFiles = walkAllowlistedDir(coreDistSrc, "node_modules/@second-seat/core/dist/src");
  for (const e of coreFiles) plan.push(e);

  requireFile("services/bot/package.json", "node_modules/@second-seat/bot/package.json");
  const botDistSrc = requireDir("services/bot/dist/src");
  const botFiles = walkAllowlistedDir(botDistSrc, "node_modules/@second-seat/bot/dist/src");
  for (const e of botFiles) plan.push(e);

  // parser: already validated, now read content metadata
  let parserStat;
  try { parserStat = fs.statSync(parserReal); } catch { throw new Error("missing required parser package"); }
  if (!parserStat.isDirectory()) throw new Error("missing required parser package");
  const parserPkgJson = path.join(parserReal, "package.json");
  const pSt = assertNotSymlink(parserPkgJson);
  if (!pSt || !pSt.isFile()) throw new Error("missing required parser package.json");
  const pkgRaw = fs.readFileSync(parserPkgJson, "utf8");
  let pkg;
  try { pkg = JSON.parse(pkgRaw); } catch { throw new Error("invalid parser package.json"); }
  if (pkg.name !== "@meta-sam/parser") throw new Error("parser package name mismatch");
  plan.push({ sourceAbs: parserPkgJson, archivePath: "node_modules/@meta-sam/parser/package.json" });
  const parserDist = path.join(parserReal, "dist");
  const pdSt = assertNotSymlink(parserDist);
  if (!pdSt || !pdSt.isDirectory()) throw new Error("missing required parser dist");
  const parserFiles = walkAllowlistedDir(parserDist, "node_modules/@meta-sam/parser/dist");
  for (const e of parserFiles) plan.push(e);

  for (const f of REQUIRED_FIXTURES) {
    requireFile(f, f);
  }

  plan.sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  const seen = new Set();
  for (const e of plan) {
    if (seen.has(e.archivePath)) throw new Error(`duplicate archive path: ${e.archivePath}`);
    seen.add(e.archivePath);
  }

  return plan;
}

export function packRuntime(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const outDir = path.resolve(opts.outDir);
  const sourceSha = opts.sourceSha;
  validateSourceSha(sourceSha);

  const plan = planRuntime({ repoRoot, sourceSha });

  const entries = [];
  for (const item of plan) {
    const st = fs.lstatSync(item.sourceAbs);
    if (st.isSymbolicLink()) throw new Error(`symlink not allowed: ${item.sourceAbs}`);
    const buf = fs.readFileSync(item.sourceAbs);
    entries.push({
      path: item.archivePath,
      type: "file",
      content: buf.toString("base64"),
    });
  }

  const manifest = {
    sourceSha,
    plan: plan.map((p) => p.archivePath),
  };

  const artifact = { manifest, entries };
  const json = JSON.stringify(artifact);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"));

  fs.mkdirSync(outDir, { recursive: true });
  const name = `second-seat-runtime-${sourceSha.slice(0, 12)}.json.gz`;
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, gz);
  const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
  const info = {
    name,
    size: gz.length,
    sha256,
    sourceSha,
    paths: plan.map((p) => p.archivePath),
  };
  return { outPath, info, plan };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--source-sha") args.sourceSha = argv[++i];
    else if (a === "--plan-only") args.planOnly = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.repo || !args.out || !args.sourceSha) {
    console.error("usage: pack-runtime.mjs --repo <root> --out <dir> --source-sha <40hex> [--plan-only]");
    process.exit(1);
  }
  try {
    validateSourceSha(args.sourceSha);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (args.planOnly) {
    let plan;
    try {
      plan = planRuntime({ repoRoot: args.repo, sourceSha: args.sourceSha });
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    console.log(JSON.stringify(plan.map((p) => p.archivePath)));
    return;
  }
  let result;
  try {
    result = packRuntime({ repoRoot: args.repo, outDir: args.out, sourceSha: args.sourceSha });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(JSON.stringify(result.info));
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pack-runtime.mjs");
if (isMain) main();
