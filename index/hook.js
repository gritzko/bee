//  index/hook.js — LITE-026: the git PRE-COMMIT pass that MINTS permalinks.
//  `file.c:12:24` is what humans and compilers write; committed text is where
//  it rots.  A commit is the last moment the ref is still current AND the first
//  moment every blob's hash is known (the commit id is not — which is why the
//  [LITE-025] hashlet is blob-only), so the upgrade rides the commit.
//
//  THE PASS
//   1. the paths this commit CHANGES, with the blob the index holds for each —
//      read off git, because lite has no `.git/index` reader and a pre-commit
//      hook is exactly where the index is the truth;
//   2. per changed file, one HEAD->staged fold: a token ALIVE in the staged
//      blob that the HEAD side does not carry is ADDED TEXT, and an added token
//      tagged `F` is a fresh reference — the DOG-034 lexer fuses `path:12:24`
//      into that one token, so nothing here re-scans raw bytes;
//   3. the ref's path resolves through the LITE-011 descent (the commit's own
//      new files first, they are in no tree yet); TWO answers is an ambiguity
//      the hook never guesses through;
//   4. the target's blob is its STAGED one when this commit changes it, HEAD's
//      otherwise; the line:col becomes a byte offset in exactly that blob and
//      the blob's id becomes the hashlet, extended against the path's own
//      other blobs ([LITE-025] scope: one file, never the repository);
//   5. the rewritten files are written back and RE-STAGED — standard pre-commit
//      practice, and the only staging this ticket allows.
//
//  LEFT ALONE, NEVER GUESSED: a path nothing answers, a path several files
//  answer, a line past the end of the target, and a SELF-link — rewriting a
//  file changes the blob a link into it names ([LITE-025]).
"use strict";

const idx = require("./index.js");
const rd = require("./read.js");
const pm = require("./perma.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

//  A rewrite moves the blob a link into that same file names, so the mint is
//  re-run until the images stop moving.  Two rounds settle everything short of
//  a genuine cycle; a set still moving at the ceiling is left ALONE.
const ROUNDS = 4;
const TAG_F = 0x46;                                //  the lexer's `F` anchor

//  --- bytes ------------------------------------------------------------------
function readFile(path) {
  let st;
  try { st = io.lstat(path); } catch (e) { return null; }
  if (st.kind !== "reg") return null;
  if (st.size === 0) return new Uint8Array(0);
  try { const m = io.mmap(path, "r"); return m.data ? m.data() : m; }
  catch (e) { return null; }
}

function writeFile(path, bytes) {
  let fd;
  try { fd = io.open(path, "c"); }
  catch (e) { throw "hook: cannot write " + path + " (" + e + ")"; }
  try {
    const b = io.buf(bytes.length + 8);
    b.feed(bytes);
    io.writeAll(fd, b);
  } finally { try { io.close(fd); } catch (e) {} }
}

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

//  --- the child --------------------------------------------------------------
//  Run a child to completion; -> its exit code (a signal death answers
//  128 + signal, as a shell does).
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { throw "hook: cannot run " + argv[0] + " (" + e + ")"; }
  const rc = io.reap(pid);
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

//  The same, with stdout on a scratch file — the runtime's io has no pipe, and
//  the hook asks git exactly one question.  null = the child failed.
function capture(argv, tmp) {
  let rc, fd;
  try { fd = io.open(tmp, "c"); }
  catch (e) { throw "hook: cannot write " + tmp + " (" + e + ")"; }
  try {
    let pid;
    try { pid = io.spawnFds(argv[0], argv, -1, fd); }
    catch (e) { throw "hook: cannot run " + argv[0] + " (" + e + ")"; }
    const r = io.reap(pid);
    rc = r.signal != null ? 128 + r.signal : (r.code | 0);
  } finally { try { io.close(fd); } catch (e) {} }
  const out = rc === 0 ? readFile(tmp) : null;
  try { io.unlink(tmp); } catch (e) {}
  return out === null ? null : utf8.Decode(out);
}

function allZero(s) {
  if (s.length === 0) return true;
  for (let i = 0; i < s.length; i++) if (s[i] !== "0") return false;
  return true;
}

//  --- what this commit changes ----------------------------------------------
//  -> Map rel -> the staged blob id, for every path whose staged blob differs
//  from HEAD's.  `-z` throughout, so a path with a tab or a quote in it reads
//  back verbatim.  A deletion (no new blob) and an unmerged slot are skipped.
function stagedFiles(ctx) {
  const tmp = ctx.gitdir + "/lite-hook." + io.getpid();
  const text = capture(["git", "-C", ctx.root, "diff-index", "--cached", "--raw",
                        "-z", ctx.head.sha], tmp);
  if (text === null) return null;
  //  `:<mode> <mode> <old> <new> <status>\0<path>\0` (no -M, so no renames).
  const out = new Map(), parts = text.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i], rel = parts[i + 1];
    if (meta.length === 0 || meta[0] !== ":") continue;
    const f = meta.slice(1).split(" ");
    if (f.length < 5 || allZero(f[3])) continue;
    out.set(rel, f[3]);
  }
  return out;
}

//  --- the two sides of a file ------------------------------------------------
function headEntry(ctx, rel) {
  if (!(ctx.head && ctx.head.sha)) return null;
  const m = idx.readCommit(ctx.r, ctx.head.sha);
  if (m === null) return null;
  const e = rd.entryAt(ctx.r, m.tree, rel);
  return e === null || e.dir ? null : e;
}

function blobOf(ctx, sha) {
  const o = sha ? idx.object(ctx.r, sha) : null;
  return o === null || o.type !== "blob" ? null : o.bytes;
}

//  --- the fresh refs ---------------------------------------------------------
//  The `F` tokens of the staged blob that the HEAD blob does not carry, in
//  order, each as { lo, hi, path, line, col } over the STAGED bytes.
function freshRefs(rel, was, now) {
  const out = [];
  const split = require("main.js").splitRef;       // the ONE ref split point
  pm.walkNew(was, now, wv.extOf(rel), function (t, lo, hi, fresh) {
    if (!fresh || t.tag !== TAG_F) return;
    const sp = split(utf8.Decode(t.text));
    //  already a permalink, or no all-digit anchor at all: nothing to mint.
    if (sp.hash || !(sp.line >= 1) || sp.path === "") return;
    out.push({ lo: lo, hi: hi, path: sp.path, line: sp.line, col: sp.col });
  });
  return out;
}

//  --- the target -------------------------------------------------------------
//  A ref's path -> the ONE repo-relative file it names, or null.  The commit's
//  own new files answer first (no tree carries them yet), then the LITE-011
//  descent at HEAD.  Several answers = an ambiguity, and the hook never guesses.
function targetOf(ctx, ix, staged, partial) {
  const q = rs.split(partial);
  if (q === null) return null;
  const hits = [];
  for (const rel of staged.keys()) if (rs.tailMatches(rel, q.segs)) hits.push(rel);
  if (ctx.head && ctx.head.sha)
    for (const rel of rs.resolveAt(ctx, ix, ctx.head.sha, partial))
      if (hits.indexOf(rel) < 0) hits.push(rel);
  return hits.length === 1 ? hits[0] : null;
}

//  One ref -> its permalink spelling, or null when it is left alone.  The path
//  is kept AS WRITTEN — only the anchor segments change.
function mintRef(ctx, ix, staged, images, srcRel, ref) {
  const rel = targetOf(ctx, ix, staged, ref.path);
  if (rel === null || rel === srcRel) return null;       // nothing, or a SELF-link
  const own = images.has(rel);
  const bytes = own ? images.get(rel) : blobOf(ctx, (headEntry(ctx, rel) || {}).sha);
  if (bytes === null || bytes === undefined) return null;
  const off = pm.byteAt(bytes, ref.line, ref.col);
  if (off < 0) return null;                              // no such line there
  const sha = own ? pm.blobIdOf(bytes) : headEntry(ctx, rel).sha;
  const h = pm.mintHashlet(sha, pm.blobHistory(ctx, ix, rel));
  if (h === null) return null;
  return ref.path + ":" + pm.packOffset(off) + ":" + h;
}

//  The staged bytes of one file with every mintable ref replaced; null when
//  none of them minted.  Ascending order, so the splice needs no re-indexing.
function rewrite(ctx, ix, staged, images, rel, src, refs) {
  const parts = [];
  let at = 0, minted = 0;
  for (const ref of refs) {
    const s = mintRef(ctx, ix, staged, images, rel, ref);
    if (s === null) continue;
    parts.push(src.slice(at, ref.lo));
    parts.push(utf8.Encode(s));
    at = ref.hi;
    minted++;
  }
  if (minted === 0) return null;
  parts.push(src.slice(at));
  return { bytes: concat(parts), minted: minted };
}

//  --- the pass ---------------------------------------------------------------
function precommit(repoArg) {
  let ctx;
  try { ctx = idx.openRepo(repoArg === undefined ? io.cwd() : repoArg); }
  catch (e) {
    //  A repo with no HEAD yet (the very FIRST commit) cannot be indexed —
    //  index.js's own gate — so no ref has anything to resolve against.  A hook
    //  never blocks a commit over its own limits: it says so and stands back.
    return "lite: no permalinks minted — " + e;
  }
  try {
    const staged = stagedFiles(ctx);
    if (staged === null) throw "hook: git could not say what is staged for commit";
    if (staged.size === 0) return "";
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });
      return pass(ctx, ix, staged);
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
}

function pass(ctx, ix, staged) {
  //  The staged bytes, and the fresh refs each one carries.
  const base = new Map(), cands = new Map();
  for (const [rel, sha] of staged) {
    const now = blobOf(ctx, sha);
    if (now === null) continue;
    base.set(rel, now);
    const he = headEntry(ctx, rel);
    const was = he === null ? new Uint8Array(0) : blobOf(ctx, he.sha);
    if (was === null) continue;
    const refs = freshRefs(rel, was, now);
    if (refs.length) cands.set(rel, refs);
  }
  if (cands.size === 0) return "";

  let images = new Map(base), stable = false, minted = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const next = new Map(base);
    minted = 0;
    for (const [rel, refs] of cands) {
      const r = rewrite(ctx, ix, staged, images, rel, base.get(rel), refs);
      if (r === null) continue;
      next.set(rel, r.bytes);
      minted += r.minted;
    }
    let same = true;
    for (const [rel, b] of next) if (!wv.bytesEq(b, images.get(rel))) { same = false; break; }
    if (same) { stable = true; break; }
    images = next;
  }
  if (!stable)
    return "lite: these links name each other's changing text — none was upgraded";
  if (minted === 0) return "";

  //  Write and RE-STAGE.  A file whose worktree copy is NOT what is staged is
  //  left alone: rewriting it would swallow the unstaged half.  Said in words.
  const add = [], held = [];
  for (const [rel, bytes] of images) {
    if (wv.bytesEq(bytes, base.get(rel))) continue;
    const full = ctx.root + "/" + rel;
    const wt = readFile(full);
    if (wt === null || !wv.bytesEq(wt, base.get(rel))) { held.push(rel); continue; }
    writeFile(full, bytes);
    add.push(rel);
  }
  let note = "";
  if (add.length) {
    if (run(["git", "-C", ctx.root, "add", "--"].concat(add)) !== 0)
      throw "hook: git would not re-stage " + add.join(", ");
    note = "lite: " + minted + " reference" + (minted === 1 ? "" : "s") +
           " upgraded to permalinks in " + add.join(", ");
  }
  if (held.length)
    note += (note ? "\n" : "") + "lite: left " + held.join(", ") +
            " alone — the worktree copy is not what is staged";
  return note;
}

//  --- the plant --------------------------------------------------------------
//  Our line goes FIRST, right after the shebang, rather than at the end: an
//  existing hook that gates on its own `exit 0` would never reach an appended
//  line, and a linter later in the file should see the rewritten text.
const MARK = "#  Beagle-lite (LITE-026): fresh `file:line` refs -> permalinks.";
function hookLine(self) { return "\"" + self + "\" hook || exit $?"; }

//  plant(gitdir, self) -> true when it wrote, false when the line was there.
function plant(gitdir, self) {
  const dir = gitdir + "/hooks";
  try { io.mkdir(dir); } catch (e) {}                 // already there is fine
  const file = dir + "/pre-commit";
  const line = hookLine(self);
  let old = null;
  const b = readFile(file);
  if (b !== null && b.length > 0) old = utf8.Decode(b);
  if (old !== null)
    for (const l of old.split("\n")) if (l.trim() === line) return false;
  let text;
  if (old === null) text = "#!/bin/sh\n" + MARK + "\n" + line + "\n";
  else {
    const lines = old.split("\n");
    const at = lines[0].slice(0, 2) === "#!" ? 1 : 0;
    lines.splice(at, 0, MARK, line);
    text = lines.join("\n");
  }
  writeFile(file, utf8.Encode(text));
  try { io.chmod(file, 0o755); } catch (e) {}
  return true;
}

module.exports = { precommit: precommit, plant: plant,
                   freshRefs: freshRefs, stagedFiles: stagedFiles };
