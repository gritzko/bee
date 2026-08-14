//  index/read.js — LITE-017: what the four READ views (cat / blob / tree /
//  list) share, so no two of them own a copy: the repo-relative path gate, the
//  `?<rev>` resolution, the tree descent and the bytes->hunk builder.
//  index/weave.js is the precedent — one home for what diff and merge both use.
//
//  THE ARG IS A URI SLOT SPLIT, NEVER A HAND-ROLLED ONE.  `<path>?<rev>` goes
//  through the `uri._parse` binding (quickjab/uri.c over abc/URI), the same
//  8-component split be reads, so nothing here looks for a '?' by hand.
//
//  THE PATH IS REPO-RELATIVE AND CONFINED.  A read verb names a path IN THE
//  REPOSITORY (the `?<rev>` form has no other meaning), so the arg resolves
//  against the cwd exactly as `lite log`/`lite diff` resolve theirs, and a `..`
//  climb above the root is REFUSED in plain words — never a silent read of a
//  sibling tree.  be raises BE-011's NAVESCAPE for this; lite says it in words.
//  The bare `lite <path>` pager is unchanged: it is a filesystem view and
//  confines nothing.
"use strict";

const idx = require("./index.js");
const lg = require("./log.js");
const refs = require("./refs.js");

//  --- the arg ---------------------------------------------------------------
//  `<path>?<rev>` -> { path, rev }.  An absent slot is "" (uri._parse hands
//  back undefined), so a caller never tests for two spellings of empty.
function argSplit(arg) {
  const u = uri._parse(String(arg === undefined || arg === null ? "" : arg));
  return { path: u.path || "", rev: u.query || "" };
}

//  --- the path gate ---------------------------------------------------------
//  A repo path arg -> its root-relative spelling ("" = the root itself).  The
//  arg resolves against `from` — the dir the verb was invoked in, the cwd by
//  default (log/diff's own convention); anything landing outside the worktree
//  is refused by `verb`, in plain words.
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

//  A repo-relative path -> the target a pager click carries.  ABSOLUTE, so a
//  session started in a subdirectory navigates as correctly as one at the root
//  (repoRel takes an absolute arg unchanged).
function navPath(ctx, rel) { return rel === "" ? ctx.root + "/" : ctx.root + "/" + rel; }

//  --- the rev ---------------------------------------------------------------
//  `?<rev>` -> { sha, m }: a REFNAME first (a branch beats a hashlet, be's own
//  order), then any 6..40 hexlet through the ODB.  Empty = the checked-out tip.
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
//  when the path is not there AT THAT REV.  "" is the root tree itself.
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
//  Bytes -> the lite hunk record the pager takes: the bytes verbatim, tokenized
//  by `ext` (an unknown ext yields no toks — bro.buildFileHunk's own gate).
function textHunk(uriStr, bytes, ext, kind) {
  let toks;
  try { toks = ext ? tok.parse(bytes, ext) : new Uint32Array(0); }
  catch (e) { toks = new Uint32Array(0); }
  return { uri: uriStr, verb: "hunk", text: bytes, toks: toks, kind: kind };
}

//  --- the age column (be view/render.js relAge, over epoch SECONDS) ---------
//  lite reads a commit's time as epoch seconds off the ident header, so the
//  ron60 decode be needs is not in the way: the thresholds and the spelling are
//  be's, byte for byte.
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
                   relAge: relAge, verbCol: verbCol };
