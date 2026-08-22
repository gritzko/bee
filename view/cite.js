//  view/cite.js — BEE-050: `bee cite <path>[?<rev>]`, the file to read with its
//  references already open.  The file is lexed once and every `F` token that
//  carries a line anchor — a permalink `f.c:12:aB` as much as a plain `f.c:12`
//  — is resolved and quoted directly under the line that named it, one line
//  above and two below.  Nothing here recognises a link (index/hook.js:24:_m),
//  resolves one (door.js:112) or cuts a window (view/see.js:43:se), and since
//  BEE-057:43 nothing here orders the quotes either (view/quote.js:65:dN): cite only
//  says WHICH refs a page owes and where each one hangs.
"use strict";

const idx = require("index/index.js");
const ct = require("./cat.js");
const fs = require("view/fs.js");
const hk = require("index/hook.js");
const qt = require("./quote.js");
const rd = require("index/read.js");
const see = require("./see.js");

//  Every reference in the file worth quoting, in byte order: `hi` the end of
//  the token that named it, `cut` the end of the line it hangs under.  Deduped
//  on the TARGET a seat landed on, so a file that cites one line five times
//  quotes it at the first mention only.
function citations(bytes, ext) {
  const door = require("door.js");
  const out = [], seen = new Set();
  for (const t of hk.fTokens(bytes, ext)) {
    //  A bare name or a ticket code names a file, not a place in one; quoting
    //  its first three lines would say nothing about why it was cited.
    if (door.splitRef(t.text).line < 1) continue;
    let seat = null;
    try { seat = door.seatOf(t.text); } catch (e) { seat = null; }
    //  A miss and an ambiguity both leave the line bare (BEE-050:27): the
    //  reader asked for a file, and guesses would drown it.
    if (seat === null || seat.rels || seat.line < 1) continue;
    const at = seat.full + ":" + seat.line;
    if (seen.has(at)) continue;
    seen.add(at);
    const h = see.excerpt(seat, t.text, qt.UP, qt.DOWN, qt.SOLO);
    if (typeof h === "string") continue;           //  the file cannot show it
    qt.add(out, { hi: t.hi, cut: qt.lineEnd(bytes, t.hi), hunk: h,
                  seat: seat, ref: t.text });
  }
  return out;
}

//  cite(arg, opts) -> { uri, rel, hunks }, the one view shape (LITE-045:42:t2).
//  A file with no anchored reference in it answers as `cat` does, one hunk of
//  its own bytes — the view never refuses a page for having nothing to add.
function cite(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  let bytes, rel, uriStr, pos;
  try {
    const a = rd.argSplit(arg);
    if (!a.path) throw "cite: needs a path — try: bee cite <path>[?<rev>]";
    rel = rd.repoRel("cite", ctx, a.path, opts.from);
    if (rel === "") throw "cite: " + a.path + " is the repository root, not a file";
    uriStr = "cite " + rel + (a.rev ? "?" + a.rev : "");
    if (a.rev) {
      const c = rd.revCommit("cite", ctx, a.rev);
      const e = rd.entryAt(ctx.r, c.m.tree, rel);
      if (e === null || e.dir) throw "cite: there is no file " + rel + " at " + c.sha.slice(0, 8);
      const o = idx.object(ctx.r, e.sha);
      if (o === null || o.type !== "blob")
        throw "cite: the " + rel + " at " + c.sha.slice(0, 8) + " is not a readable file";
      bytes = o.bytes;
    } else {
      bytes = ct.wtBytes(ctx.root + "/" + rel);
      if (bytes === "dir") throw "cite: " + rel + " is a directory — try: bee list " + rel;
      if (bytes === null) throw "cite: there is no " + rel + " in the worktree";
    }
    //  BEE-028: every segment NAMES its ambient, as cat.js:53:j8 does, so a
    //  reference on the page resolves from the file's own dir, not the view's.
    pos = { repo: ctx.root, path: rel, anchor: "" };
  } finally { idx.closeRepo(ctx); }

  if (bytes.length === 0) return { uri: uriStr, rel: rel, hunks: [] };
  const ext = fs.pathExt(rel);
  //  The refs resolve in the FILE's ambient, which is what makes a relative
  //  citation in a sibling repo's page land where its author meant it.
  const mnt = require("index/mount.js");
  const cites = mnt.within(pos, function () { return citations(bytes, ext); });
  return { uri: uriStr, rel: rel,
           hunks: qt.weave(uriStr, bytes, ext, cites, pos, "cite") };
}

module.exports = { cite: cite, citations: citations };
