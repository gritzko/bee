//  view/dog.js — `bee dog <path>` (BEE-046): the file WHOLE, its worktree
//  bytes as they are now, with everything that differs from HEAD under the one
//  diff wash — conflict markers and all, since they too are on disk.  It is a
//  VIEW OF A FILE, not a question about change, which is why it is not a mode
//  of `diff`: `diff <path>` must stay silent on a path that did not move, while
//  a status row's NAME (view/status.js:260:FF) must open the file whatever its
//  quad says.  No second differ and no second palette: the hunks come from
//  view/diff.js diffWt's own whole-file leg, the plain bytes from cat's.
"use strict";

const idx = require("index/index.js");
const df = require("./diff.js");
const ct = require("./cat.js");
const fs = require("view/fs.js");
const rd = require("index/read.js");

//  dog(arg, opts) -> { uri, rel, hunks }.  An empty `hunks` is impossible by
//  construction: with nothing to wash the answer is `cat`'s own plain hunk, so
//  a click on a row can never land on a blank page.
function dog(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const a = rd.argSplit(arg);
    if (!a.path) throw "dog: needs a path — try: bee dog <path>";
    //  A rev names committed bytes, which have nothing to wash against the
    //  worktree; `cat <path>?<rev>` is that view and says so.
    if (a.rev) throw "dog: " + a.path + "?" + a.rev +
                     ": a rev has no worktree — try: bee cat " + a.path + "?" + a.rev;
    const rel = rd.repoRel("dog", ctx, a.path, opts.from);
    if (rel === "") throw "dog: " + a.path + " is the repository root, not a file";
    const uriStr = "dog " + rel;
    const head = idx.readCommit(ctx.r, ctx.head.sha);
    const hunks = [];
    df.diffWt({ ctx: ctx, ix: null, blob: true }, ctx.head.sha,
              head === null ? null : head.tree, rel, true, hunks, true);
    if (hunks.length === 0) {
      //  Nothing HEAD can be read against — unchanged, untracked or a staged
      //  add — so the file itself is the answer, painted as `cat` paints it.
      const bytes = ct.wtBytes(ctx.root + "/" + rel);
      if (bytes === "dir") throw "dog: " + rel + " is a directory — try: bee list " + rel;
      if (bytes === null) throw "dog: there is no " + rel + " in the worktree";
      if (bytes.length) hunks.push(rd.textHunk(uriStr, bytes, fs.pathExt(rel), "cat"));
    }
    //  BEE-028: the hunk NAMES its ambient, as cat.js:53:j8 does, so a reference
    //  on the page resolves from the file's own dir.
    if (hunks.length) hunks[0].pos = { repo: ctx.root, path: rel, anchor: "" };
    return { uri: uriStr, rel: rel, hunks: hunks };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { dog: dog };
