//  view/quote.js — BEE-057:43 the quoting rules `cite` invented, held where
//  both directions can reach them: the window (BEE-050:25), the solo cap
//  (BEE-050:30), the merge of two quotes hanging under ONE page line
//  (BEE-050:36) and the split of the page around a sorted list of them.
//  `cite` quotes what a file names and `cited` what names it, so nothing but
//  the direction differs; left private to cite.js the two would drift apart.
//  A quote is `{ cut, hi, seat, ref, hunk }`: `hi` a byte on the page line it
//  hangs under, `cut` the end of that line, `seat` the place it quotes.
"use strict";

const rd = require("index/read.js");
const see = require("./see.js");

//  BEE-050:25 gritzko's window: the quoted line needs what leads into it and
//  what follows, and the tail is worth more than the head.
const UP = 1, DOWN = 2;
//  BEE-050:30 ...unless the quoted line is a screenful in itself, and then it
//  is quoted with no neighbours at all.
const SOLO = 128;

//  The byte just past the line `off` sits on, so a segment always ends with the
//  whole line the quotes hang under, its newline included.
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

//  BEE-050:36 two quotes under the SAME page line whose windows touch or
//  overlap read as one quote over the union: side by side they would repeat the
//  lines they share.  `win` is what each excerpt already shows (view/see.js:117:hS).
function joins(a, b) {
  return a.seat.full === b.seat.full && a.cut === b.cut &&
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

//  One quote appended, or merged into the one before it when the two touch.
//  Callers add in PAGE order, so only the last entry can ever be the neighbour.
function add(out, c) {
  const last = out.length ? out[out.length - 1] : null;
  if (last !== null && joins(last, c)) widen(last, c);
  else out.push(c);
}

//  The file cut into bare segments with the quotes between them: each segment
//  ends with the line its quotes hang under, and they follow it.  `line0` keeps
//  the status bar's `#L` absolute across the cuts (pager.js:413:wE).
function weave(uriStr, bytes, ext, cites, pos, kind) {
  const toks = rd.fileToks(bytes, ext);
  const out = [];
  let lo = 0, line = 1;
  const seg = function (hi) {
    const h = rd.sliceHunk(uriStr, bytes, toks, lo, hi, kind);
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

module.exports = { UP: UP, DOWN: DOWN, SOLO: SOLO, lineEnd: lineEnd,
                   countNL: countNL, joins: joins, widen: widen, add: add,
                   weave: weave };
