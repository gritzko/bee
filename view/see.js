//  view/see.js as per BEE-017: `bee see [-C<n>] <ref>...`, the chunk a reference
//  names — the CLI's way to read a permalink back (BEE-017:9), since only a
//  pager click and http ever reached `door.js seatOf`.  ONE HUNK PER REF, in the
//  order given, never merged (BEE-017:42); context 2 lines each way, not diff's 3
//  (BEE-017:43), `-C<n>` parsed by the view (BEE-017:48).  NO SECOND RESOLVER
//  (LITE-034:40:Mf), no new hunk shape: seatOf answers, index/read.js `textHunk`
//  carries it with `bare: false`, the excerpt-wears-the-band case (BEE-017:35).
//  A miss says BEE-003's words, an ambiguity the door's chooser; the batch goes on.
"use strict";

const fs = require("view/fs.js");
const pm = require("index/perma.js");
const rd = require("index/read.js");

const CONTEXT = 2;                                 //  lines each way, by default

//  --- the arg ----------------------------------------------------------------
//  `see` is the ONE view whose arg is a LIST: main.js fuses a verb's words and a
//  reference never carries a space, so the split is the whole parse.  `-C<n>`
//  and `-C <n>` both read (BEE-017:48).
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
//  Lines `line-ctx .. line+ctx`, clamped at both ends of the file; `byteAt` is
//  the ONE line->offset reader (index/perma.js), so no second line scanner.
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

//  BEE-017:46: seatOf spells an ambient landing relative, a foreign one absolute;
//  the band wants the FULL path either way, so it says which repo answered.
function abs(full) {
  try { return io.realpath(full); } catch (e) { return full; }
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

  //  BEE-017:44: THE BAND IS THE REF WITH ITS PATH EXPANDED, the anchor verbatim —
  //  ONE token, still a reference, so it clicks and re-reads (BEE-017:45).
  const uri = abs(seat.full) + door.splitRef(ref).tail;
  const body = bytes.slice(w.lo, w.hi);
  //  BEE-017:47: tokenized AS A WINDOW — a chunk out of a block comment may paint
  //  oddly, but folding whole files to colour five lines is the worse deal.
  const h = rd.textHunk(uri, body, fs.pathExt(seat.full), "see");
  h.bare = false;                                  //  an EXCERPT wears the band
  //  LITE-029:39:nB the landing rides the hunk: the pager selects the line, and
  //  the token itself when the resolver named one.
  h.land = { line: line - w.from + 1, col: seat.col || 1 };
  if (seat.hi > seat.lo) { h.land.lo = seat.lo - w.lo; h.land.hi = seat.hi - w.lo; }
  if (seat.note) h.land.note = seat.note;
  return h;
}

//  --- the verb ---------------------------------------------------------------
//  see(arg, opts) -> { hunks } — the one view shape (LITE-045:42:t2), so the
//  pager, the renderers and http all take it without knowing a verb was added.
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
