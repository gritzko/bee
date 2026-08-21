//  view/cite.js — BEE-050: `bee cite <path>[?<rev>]`, the file to read with its
//  references already open.  The file is lexed once and every `F` token that
//  carries a line anchor — a permalink `f.c:12:aB` as much as a plain `f.c:12`
//  — is resolved and quoted directly under the line that named it, one line
//  above and two below.  Nothing here recognises a link (index/hook.js:24:_m),
//  resolves one (door.js:106) or cuts a window (view/see.js:43:se): cite only
//  orders what those three answer.  A miss, an ambiguity or a target already
//  quoted higher up adds nothing, so the page still reads as the file.
"use strict";

const idx = require("index/index.js");
const ct = require("./cat.js");
const fs = require("view/fs.js");
const hk = require("index/hook.js");
const rd = require("index/read.js");
const see = require("./see.js");

//  BEE-050:25 gritzko's window: the reference's own line needs what leads into
//  it and what follows, and the tail is worth more than the head.
const UP = 1, DOWN = 2;
//  BEE-050:30 ...unless the cited line is a screenful in itself, and then it is
//  quoted with no neighbours at all.
const SOLO = 128;

//  The byte just past the line `off` sits on, so a segment always ends with the
//  whole line that carried the reference, its newline included.
function lineEnd(bytes, off) {
  let i = off;
  while (i < bytes.length && bytes[i] !== 0x0a) i++;
  return i < bytes.length ? i + 1 : bytes.length;
}

function countNL(bytes, lo, hi) {
  let n = 0;
  for (let i = lo; i < hi; i++) if (bytes[i] === 0x0a) n++;
  return n;
}

//  BEE-050:36 two refs quoted under the SAME line whose windows touch or overlap
//  read as one quote over the union: side by side they would repeat the lines
//  they share.  `win` is what each excerpt already shows (view/see.js:117:hS).
function joins(bytes, a, b) {
  return a.seat.full === b.seat.full && lineEnd(bytes, a.hi) === lineEnd(bytes, b.hi) &&
         a.hunk.win.from <= b.hunk.win.to + 1 && b.hunk.win.from <= a.hunk.win.to + 1;
}

//  `a` re-cut over both windows, still anchored on ITS landing — the first
//  mention is where the reader is, and `see.excerpt` stays the one hunk builder.
function widen(a, b) {
  const from = Math.min(a.hunk.win.from, b.hunk.win.from);
  const to = Math.max(a.hunk.win.to, b.hunk.win.to);
  const h = see.excerpt(a.seat, a.ref, a.seat.line - from, to - a.seat.line);
  if (typeof h === "string") return;               //  the file turned unreadable
  a.hunk = h;
  a.hi = b.hi;                                     //  weave wants `hi` climbing
}

//  Every reference in the file worth quoting, in byte order: { hi, hunk }, `hi`
//  the end of the token that named it.  Deduped on the TARGET a seat landed on,
//  so a file that cites one line five times quotes it at the first mention only.
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
    const h = see.excerpt(seat, t.text, UP, DOWN, SOLO);
    if (typeof h === "string") continue;           //  the file cannot show it
    const c = { hi: t.hi, hunk: h, seat: seat, ref: t.text };
    const last = out.length ? out[out.length - 1] : null;
    if (last !== null && joins(bytes, last, c)) widen(last, c);
    else out.push(c);
  }
  return out;
}

//  The file cut into bare segments with the excerpts between them: each segment
//  ends with the line that cited, and its citations follow.  `line0` keeps the
//  status bar's `#L` absolute across the cuts (pager.js:413:wE).
function weave(uriStr, bytes, ext, cites, pos) {
  const toks = rd.fileToks(bytes, ext);
  const out = [];
  let lo = 0, line = 1;
  const seg = function (hi) {
    const h = rd.sliceHunk(uriStr, bytes, toks, lo, hi, "cite");
    h.line0 = line;
    h.pos = pos;
    out.push(h);
    line += countNL(bytes, lo, hi);
    lo = hi;
  };
  for (let i = 0; i < cites.length; ) {
    const cut = lineEnd(bytes, cites[i].hi);
    seg(cut);
    while (i < cites.length && cites[i].hi <= cut) out.push(cites[i++].hunk);
  }
  if (lo < bytes.length) seg(bytes.length);
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
  return { uri: uriStr, rel: rel, hunks: weave(uriStr, bytes, ext, cites, pos) };
}

module.exports = { cite: cite, citations: citations };
