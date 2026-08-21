//  index/read.js — what the four read views (cat, blob, tree, list) share, so
//  no two own a copy (LITE-017:44:Cv): the repo-relative path gate, the `?<rev>`
//  resolution, the tree descent and the bytes-to-hunk builder.  The arg is a
//  URI slot split through `uri._parse` (LITE-017:45:Cv) and the path is confined
//  to the repository (LITE-017:46:Cv, LITE-017:59:Cv); the bare `bee <path>` pager
//  is a filesystem view and confines nothing.
"use strict";

const idx = require("./index.js");
const lg = require("view/log.js");
const refs = require("./refs.js");
//  BEE-050:48 the tok32 accessors, so the segment cutter reads a span end the
//  one way every renderer reads it (render/wrap.js:13:ge).
const wrap = require("render/wrap.js");

//  --- the arg ---------------------------------------------------------------
//  `<path>?<rev>` -> { path, rev }.  An absent slot is "" (uri._parse hands
//  back undefined), so a caller never tests for two spellings of empty.
function argSplit(arg) {
  const u = uri._parse(String(arg === undefined || arg === null ? "" : arg));
  return { path: u.path || "", rev: u.query || "" };
}

//  --- the path gate ---------------------------------------------------------
//  A repo path arg -> its root-relative spelling ("" is the root).  The arg
//  resolves against `from`, the dir the verb was invoked in (the cwd by
//  default); anything landing outside the worktree is refused by `verb`.
function repoRel(verb, ctx, path, from) {
  const p = String(path === undefined || path === null ? "" : path);
  if (p === "" || p === ".") return "";
  const abs = lg.normalize(p[0] === "/" ? p : (from || io.cwd()) + "/" + p);
  if (abs === ctx.root) return "";
  const pfx = ctx.root + "/";
  if (abs.length > pfx.length && abs.slice(0, pfx.length) === pfx)
    return abs.slice(pfx.length);
  throw verb + ": " + p + " is outside " + ctx.root;
}

//  A repo-relative path -> the target a pager click carries, absolute so that
//  a session started in a subdirectory navigates like one at the root.
function navPath(ctx, rel) { return rel === "" ? ctx.root + "/" : ctx.root + "/" + rel; }

//  --- the rev ---------------------------------------------------------------
//  `?<rev>` -> { sha, m }: a refname first (a branch beats a hashlet, be's own
//  order), then any 6..40 hexlet through the ODB.  Empty is the checked-out tip.
function revCommit(verb, ctx, rev) {
  if (!rev) {
    const m = idx.readCommit(ctx.r, ctx.head.sha);
    if (m === null) throw verb + ": " + ctx.head.ref + " names no readable commit";
    return { sha: ctx.head.sha, m: m };
  }
  let sha = null;
  for (const n of [rev, "refs/heads/" + rev, "refs/tags/" + rev, "refs/remotes/" + rev]) {
    try { sha = refs.resolve(ctx.gitdir, n, null, null, 0); } catch (e) { sha = null; }
    if (sha !== null) break;
  }
  const name = sha !== null ? sha : (lg.HEXARG.test(rev) ? rev.toLowerCase() : null);
  const m = name === null ? null : idx.readCommit(ctx.r, name);
  if (m === null) throw verb + ": no commit in this repository is named " + rev;
  //  A short hexlet names the object but not its own sha, so re-frame it the
  //  way LITE-007's seedOf and LITE-009's commit do.
  let full = name;
  if (!refs.isSha40(full)) {
    const o = idx.object(ctx.r, name);
    full = o === null ? name : hex.encode(lg.frameSha(o.bytes));
  }
  return { sha: full, m: m };
}

//  --- the tree descent ------------------------------------------------------
//  A root tree + a root-relative path -> that entry { sha, mode, dir }, or null
//  when the path is not there at that rev.  "" is the root tree itself.
function entryAt(r, tree, rel) {
  if (!tree) return null;
  if (rel === "") return { sha: tree, mode: 0o40000, dir: true };
  const segs = rel.split("/");
  let t = tree;
  for (let i = 0; i < segs.length; i++) {
    const M = idx.readTree(r, t);
    if (M === null) return null;
    const e = M.get(segs[i]);
    if (e === undefined) return null;
    if (i === segs.length - 1) return e;
    if (!e.dir) return null;
    t = e.sha;
  }
  return null;
}

//  --- the hunk --------------------------------------------------------------
//  A file's tok32 spans, or none: an unknown ext and a lexer that refuses both
//  yield an empty stream, view/fs.js buildFileHunk's own gate.
function fileToks(bytes, ext) {
  try { return ext ? tok.parse(bytes, ext) : new Uint32Array(0); }
  catch (e) { return new Uint32Array(0); }
}

//  Bytes -> the hunk record the pager takes, the bytes verbatim.  A `cat`/`blob`
//  hunk IS the file: on a pipe it writes those bytes and nothing else, so
//  `bee cat x | diff -` sees the source (LITE-045:28:t2).
function textHunk(uriStr, bytes, ext, kind) {
  return { uri: uriStr, verb: "hunk", text: bytes, toks: fileToks(bytes, ext),
           kind: kind, bare: true };
}

//  BEE-050:48 one segment of an ALREADY-LEXED file as its own hunk.  A view that
//  splits a file re-lexes nothing: a cut inside a block comment — where every
//  permalink lives — would paint the remainder of that comment as code.
function sliceHunk(uriStr, bytes, toks, lo, hi, kind) {
  return { uri: uriStr, verb: "hunk", text: bytes.slice(lo, hi),
           toks: tokSlice(toks, lo, hi), kind: kind, bare: true };
}

//  The tokens overlapping `[lo,hi)`, ends clamped to `hi` and shifted down by
//  `lo`; token i's start is token i-1's end, so the cut needs no start slot.
function tokSlice(toks, lo, hi) {
  const out = [];
  let start = 0;
  for (let i = 0; i < toks.length && start < hi; i++) {
    const end = wrap.TOK_END(toks[i]);
    if (end > lo)
      out.push(((toks[i] & ~0xffffff) | ((end > hi ? hi : end) - lo)) >>> 0);
    start = end;
  }
  return Uint32Array.from(out);
}

//  --- the age column (be view/render.js relAge, over epoch seconds) ---------
//  bee reads a commit's time as epoch seconds off the ident header, so no
//  ron60 decode is needed; the thresholds and the spelling are be's, byte for byte.
function relAge(secs, now) {
  if (!secs) return "";
  let d = now - secs;
  if (d < 0) d = 0;
  if (d < 60) return d + "s";
  if (d < 3600) return ((d / 60) | 0) + "m";
  if (d < 86400) return ((d / 3600) | 0) + "h";
  if (d < 31536000) return ((d / 86400) | 0) + "d";
  return ((d / 31536000) | 0) + "y";
}

//  be view/render.js verbCol: the 3-column status marker, left-justified.
function verbCol(v) { return v.length >= 3 ? v : v + "   ".slice(v.length); }

module.exports = { argSplit: argSplit, repoRel: repoRel, navPath: navPath,
                   revCommit: revCommit, entryAt: entryAt, textHunk: textHunk,
                   fileToks: fileToks, sliceHunk: sliceHunk, tokSlice: tokSlice,
                   relAge: relAge, verbCol: verbCol };
