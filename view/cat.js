//  view/cat.js — LITE-017: `lite cat <path>[?<rev>]`, ported from
//  be/views/cat/cat.js (JAB-020).
//
//  THE RULING (gritzko, JAB-020): cat shows the file's OWN bytes.  There is no
//  diff in it — for a diff there is `lite diff`.  So `--plain` (and a pipe) is
//  the bytes VERBATIM, nothing prepended, which makes `lite cat --plain f` and
//  `cat f` the same bytes; at a terminal those same bytes ride the pager as one
//  syntax-painted hunk under the banner `cat <path>`.
//
//  Two sources, one arg:
//    cat <path>          the WORKTREE file — the pager's own mmap+tokenize path
//    cat <path>?<rev>    the blob at that rev, off the ODB (a branch name or
//                        any 6..40 hexlet), so a file DELETED from the checkout
//                        still reads.  A path absent AT THAT REV fails LOUD, in
//                        plain words — never the silent-empty be fixed in
//                        BRO-029.
//
//  be's per-token `U` click-targets (BRO-006's `grep #<word>`) are NOT carried
//  over: lite has no grep verb, and it does not need one here — LITE-015 already
//  makes any `F` token in a file hunk a REFERENCE the pager's door resolves.
"use strict";

const idx = require("index/index.js");
const df = require("./diff.js");
const fs = require("view/fs.js");
const rd = require("index/read.js");

//  A worktree file's bytes.  An EMPTY regular file short-circuits (mmap of zero
//  bytes has nothing to map); everything else is diff.js's own reader, which
//  reads a symlink's TARGET STRING rather than following it.
function wtBytes(abs) {
  let st = null;
  try { st = io.lstat(abs); } catch (e) { st = null; }
  if (st === null) return null;
  if (st.kind === "dir") return "dir";
  if (st.kind === "reg" && st.size === 0) return new Uint8Array(0);
  const b = df.wtBytes(abs);
  return b === undefined ? null : b;
}

//  --- the verb --------------------------------------------------------------
//  cat(arg, opts) -> { uri, rel, hunks }.  `hunks` is empty for an empty
//  file, which is be's own no-banner-for-nothing case.
function cat(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const a = rd.argSplit(arg);
    if (!a.path) throw "cat: needs a path — try: lite cat <path>[?<rev>]";
    const rel = rd.repoRel("cat", ctx, a.path, opts.from);
    if (rel === "") throw "cat: " + a.path + " is the repository root, not a file";
    const uriStr = "cat " + rel + (a.rev ? "?" + a.rev : "");
    let bytes;
    if (a.rev) {
      const c = rd.revCommit("cat", ctx, a.rev);
      const e = rd.entryAt(ctx.r, c.m.tree, rel);
      if (e === null) throw "cat: there is no " + rel + " at " + c.sha.slice(0, 8);
      if (e.dir) throw "cat: " + rel + " is a directory at " + c.sha.slice(0, 8);
      const o = idx.object(ctx.r, e.sha);
      if (o === null || o.type !== "blob")
        throw "cat: the " + rel + " at " + c.sha.slice(0, 8) + " is not a readable file";
      bytes = o.bytes;
    } else {
      bytes = wtBytes(ctx.root + "/" + rel);
      if (bytes === "dir") throw "cat: " + rel + " is a directory";
      if (bytes === null) throw "cat: there is no " + rel + " in the worktree";
    }
    const hunks = bytes.length === 0 ? []
                : [rd.textHunk(uriStr, bytes, fs.pathExt(rel), "cat")];
    return { uri: uriStr, rel: rel, hunks: hunks };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { cat: cat, wtBytes: wtBytes };
