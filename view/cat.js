//  view/cat.js — `bee cat <path>[?<rev>]`: the file's own bytes with no diff
//  in them (the ruling at LITE-017:14:Cv).  `--plain` writes the bytes
//  verbatim, so it equals cat(1); at a tty the same bytes ride the pager as
//  one painted hunk.  `?<rev>` reads the blob off the ODB, so a deleted file
//  still reads; a path absent at that rev fails in plain words rather than
//  silently empty (BRO-029:13:J7).  be's per-token grep targets are not ported,
//  since any `F` token is already a reference the door resolves (LITE-015:11:q3).
"use strict";

const idx = require("index/index.js");
const df = require("./diff.js");
const fs = require("view/fs.js");
const rd = require("index/read.js");

//  A worktree file's bytes.  An empty regular file short-circuits, since an
//  mmap of zero bytes has nothing to map; everything else goes through
//  view/diff.js wtBytes, which reads a symlink's target string, not the target.
function wtBytes(abs) {
  let st = null;
  try { st = io.lstat(abs); } catch (e) { st = null; }
  if (st === null) return null;
  if (st.kind === "dir") return "dir";
  if (st.kind === "reg" && st.size === 0) return new Uint8Array(0);
  const b = df.wtBytes(abs);
  return b === undefined ? null : b;
}

//  cat(arg, opts) -> { uri, rel, hunks }.  `hunks` is empty for an empty
//  file: no banner for nothing, as in be.
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
