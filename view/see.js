//  view/see.js — BEE-017: `bee see [-C<n>] <ref>...`, the chunk a reference
//  names.  `door.js` seatOf has resolved every reference shape there is since
//  LITE-034:h0:MfTf — permalink, path, FSEG partial, ticket code, pocket page, another
//  registered repo — but only a pager click and http ever reached it, so from
//  argv a permalink fell through to the fs leg and answered `cannot open`.
//  Minting permalinks (BEE-016:34) with no way to read one back is half a feature.
//
//  ONE HUNK PER REF, in the order given: `see` answers what it was asked, and a
//  batch of refs is a batch of hunks — two refs landing three lines apart print
//  two overlapping chunks rather than one merged window, so the ref-to-hunk map
//  stays one-to-one.  Context is TWO lines each way, not diff's three: a diff
//  hunk frames a CHANGE and needs room for its shape, `see` frames ONE LINE
//  somebody pointed at.  `-C<n>` moves it; the view parses that itself, since
//  main.js's `modeOf` knows three mode flags and hands every other word on.
//
//  NO SECOND RESOLVER (the LITE-034:h0:MfTf ruling) and no new hunk shape: seatOf
//  answers, index/read.js `textHunk` carries it, and `bare: false` is the
//  "excerpt wears the band" case render/plain.js already spells out.  A miss
//  gets BEE-003's words, an ambiguity the door's own chooser, and neither ends
//  the batch — the rest of the refs still answer.
"use strict";

const fs = require("view/fs.js");
const pm = require("index/perma.js");
const rd = require("index/read.js");

const CONTEXT = 2;                                 //  lines each way, by default

//  --- the arg ----------------------------------------------------------------
//  `see` is the ONE view whose arg is a LIST — main.js fuses a verb's words, and
//  a reference never carries a space, so the join is lossless and the split is
//  the whole parse.  `-C<n>` and `-C <n>` both read.
function parse(arg) {
  const words = String(arg === undefined ? "" : arg).split(/\s+/).filter(Boolean);
  const refs = [];
  let ctx = CONTEXT;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "-C" && i + 1 < words.length) { ctx = num(words[++i], ctx); continue; }
    if (w.length > 2 && w.slice(0, 2) === "-C") { ctx = num(w.slice(2), ctx); continue; }
    refs.push(w);
  }
  return { refs: refs, ctx: ctx };
}

function num(s, dflt) {
  if (!/^[0-9]+$/.test(s)) throw "see: -C wants a line count, not " + s;
  const v = Number(s);
  return v >= 0 && v <= 4096 ? v : dflt;
}

//  --- the window -------------------------------------------------------------
//  Lines `line-ctx .. line+ctx`, clamped at both ends of the file.  `byteAt` is
//  the ONE line->offset reader (index/perma.js, the mint's own), so no second
//  line scanner is added here either.
//  -> { lo, hi, from } over `bytes`, or null when the file has no such line.
function window(bytes, line, ctx) {
  const from = line - ctx < 1 ? 1 : line - ctx;
  const lo = pm.byteAt(bytes, from, 1);
  if (lo < 0) return null;
  let hi = lo;
  for (let k = from; k <= line + ctx && hi < bytes.length; k++) {
    while (hi < bytes.length && bytes[hi] !== 0x0a) hi++;
    if (hi < bytes.length) hi++;                   //  the newline belongs to the line
  }
  return { lo: lo, hi: hi, from: from };
}

//  A hunk of plain words — a miss, or a landing the file can no longer show.
//  It wears the band like any excerpt, so the ref it answers is named above it.
function noteHunk(ref, words) {
  return { uri: ref, verb: "hunk", text: utf8.Encode(words + "\n"),
           toks: new Uint32Array(0), kind: "see", bare: false };
}

//  --- one reference ----------------------------------------------------------
function chunk(ref, ctx) {
  const door = require("door.js");                 //  lazy: door.js names us back
  let seat;
  try { seat = door.seatOf(ref); } catch (e) { return noteHunk(ref, "" + e); }
  //  BEE-003: a miss NAMES WHAT WAS SEARCHED rather than shrugging.
  if (seat === null) return noteHunk(ref, door.refusal(ref));
  //  BEE-012: several files answer — the door's own chooser, not a guess.
  if (seat.rels) return fs.buildChooserHunk(seat.arg, seat.rels, seat.tail);

  const bytes = require("view/cat.js").wtBytes(seat.full);
  if (bytes === "dir") return noteHunk(ref, seat.full + " is a directory");
  if (bytes === null) return noteHunk(ref, "there is no " + seat.full + " in the worktree");
  //  A ref with no anchor at all names the file's first line, which is what the
  //  fs leg shows too; `see` frames it the same as any other landing.
  const line = seat.line >= 1 ? seat.line : 1;
  const w = window(bytes, line, ctx);
  if (w === null) return noteHunk(ref, seat.full + " has no line " + line);

  const uri = seat.full + ":" + line;
  const body = bytes.slice(w.lo, w.hi);
  //  The window is tokenized AS A WINDOW: a chunk cut out of a block comment may
  //  paint oddly, and folding whole files to colour five lines is the worse deal.
  const h = rd.textHunk(uri, body, fs.pathExt(seat.full), "see");
  h.bare = false;                                  //  an EXCERPT wears the band
  //  LITE-029:YS:nBc4 the landing rides the hunk, so the pager selects the line — and
  //  the token itself when the resolver named one.
  h.land = { line: line - w.from + 1, col: seat.col || 1 };
  if (seat.hi > seat.lo) { h.land.lo = seat.lo - w.lo; h.land.hi = seat.hi - w.lo; }
  if (seat.note) h.land.note = seat.note;
  return h;
}

//  --- the verb ---------------------------------------------------------------
//  see(arg, opts) -> { hunks } — the one view shape (LITE-045:p4:t2ME), so the pager,
//  the three renderers and http all take it without knowing a verb was added.
function see(arg, opts) {
  opts = opts || {};
  const p = parse(arg);
  if (p.refs.length === 0)
    throw "see: needs a reference — try: bee see [-C<n>] <ref>...";
  const mnt = require("index/mount.js");
  const all = function () {
    const out = [];
    for (const ref of p.refs) out.push(chunk(ref, p.ctx));
    return out;
  };
  //  BEE-003: a reference resolves in the AMBIENT repo — http serves one it was
  //  never cd'd into, so the view enters it the way door.openTarget does.
  const pos = opts.from ? require("door.js").posOf(opts.from + "/") : null;
  return { hunks: pos === null ? all() : mnt.within(pos, all) };
}

module.exports = { see: see, window: window, parse: parse };
