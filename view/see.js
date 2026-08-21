//  view/see.js — `bee see [-C<n>] <ref>...`, the chunk a reference names: the
//  CLI's way to read a permalink back (BEE-017:9), since only a pager click and
//  http ever reached `door.js seatOf`.  One hunk per reference in the order
//  given, never merged (BEE-017:42), with 2 lines of context each way rather
//  than diff's 3 (BEE-017:43:G_).  There is no second resolver (LITE-034:40:Mf)
//  and no new hunk shape: seatOf answers and index/read.js `textHunk` carries
//  it with `bare: false`, since an excerpt wears the band (BEE-017:35:G_).  A miss
//  says BEE-003's words, an ambiguity the door's chooser; the batch goes on.
"use strict";

const fs = require("view/fs.js");
const pm = require("index/perma.js");
const rd = require("index/read.js");

const CONTEXT = 2;                                 //  lines of context each way

//  `see` is the one view whose argument is a list: main.js fuses a verb's
//  words and a reference never carries a space, so the split is the whole
//  parse.  `-C<n>` and `-C <n>` both read (BEE-017:48).
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

//  The codepoints on one line, a UTF-8 continuation byte counting for none.
function symbols(bytes, line) {
  const lo = pm.byteAt(bytes, line, 1);
  if (lo < 0) return 0;
  let n = 0;
  for (let i = lo; i < bytes.length && bytes[i] !== 0x0a; i++)
    if ((bytes[i] & 0xc0) !== 0x80) n++;
  return n;
}

//  Lines `line-up .. line+down`, clamped at both ends of the file, as { lo, hi,
//  from, to } over `bytes`, or null when the file has no such line.  `byteAt` of
//  index/perma.js is the one line-to-offset reader, so no second scanner.  `to`
//  is the last line actually reached, which clamping and `solo` both move.
//  BEE-050:49 `down` defaults to `up`: `see`'s -C is symmetric, `cite`'s is not.
function window(bytes, line, up, down, solo) {
  if (down === undefined) down = up;
  //  BEE-050:30 a line past `solo` symbols is a screenful in itself: neighbours
  //  around it read as noise, so it stands alone.  Unset, no line ever does.
  if (solo && symbols(bytes, line) > solo) { up = 0; down = 0; }
  const from = line - up < 1 ? 1 : line - up;
  const lo = pm.byteAt(bytes, from, 1);
  if (lo < 0) return null;
  let hi = lo, to = from;
  for (let k = from; k <= line + down && hi < bytes.length; k++) {
    while (hi < bytes.length && bytes[hi] !== 0x0a) hi++;
    if (hi < bytes.length) hi++;                   //  the newline joins the line
    to = k;
  }
  return { lo: lo, hi: hi, from: from, to: to };
}

//  seatOf spells an ambient landing relative and a foreign one absolute; the
//  band wants the full path either way, to say which repo answered (BEE-017:46:G_).
function abs(full) {
  try { return io.realpath(full); } catch (e) { return full; }
}

//  A hunk of plain words: a miss, or a landing the file can no longer show.
//  It wears the band like any excerpt, so the reference it answers is named.
function noteHunk(ref, words) {
  return { uri: ref, verb: "hunk", text: utf8.Encode(words + "\n"),
           toks: new Uint32Array(0), kind: "see", bare: false };
}

//  A RESOLVED seat -> its banded excerpt hunk, or the plain words saying why
//  the file cannot show that line.  Split out of `chunk` (BEE-050:50) so `cite`,
//  which resolves its own seats for the dedup, builds the identical hunk here
//  and simply drops the words instead of framing them.
function excerpt(seat, ref, up, down, solo) {
  const door = require("door.js");                 //  lazy: door.js requires us
  const bytes = require("view/cat.js").wtBytes(seat.full);
  if (bytes === "dir") return seat.full + " is a directory";
  if (bytes === null) return "there is no " + seat.full + " in the worktree";
  //  A reference with no anchor names the file's first line, as the fs leg
  //  shows too; `see` frames it the same as any other landing.
  const line = seat.line >= 1 ? seat.line : 1;
  const w = window(bytes, line, up, down, solo);
  if (w === null) return seat.full + " has no line " + line;

  //  The band is the reference with its path expanded, the anchor verbatim:
  //  one token, still a reference, so it clicks and re-reads (BEE-017:44:G_).
  const uri = abs(seat.full) + door.splitRef(ref).tail;
  const body = bytes.slice(w.lo, w.hi);
  //  Tokenized as a window (BEE-017:47:G_): a chunk out of a block comment may
  //  paint oddly, but folding whole files to colour five lines is worse.
  const h = rd.textHunk(uri, body, fs.pathExt(seat.full), "see");
  h.bare = false;                                  //  an excerpt wears the band
  //  BEE-050:31 the band's own target, RE-SPELLED as path + the line it landed
  //  on: html hangs the whole file's page off the header, opened at this very
  //  point.  The uri itself will not do — an absolute path carrying a hashlet
  //  resolves nowhere (BEE-018) — and the RESOLVED line is what a permalink
  //  meant anyway, the place its blob history pointed at.
  h.ref = seat.line >= 1
        ? seat.full + ":" + seat.line + (seat.col >= 1 ? ":" + seat.col : "")
        : seat.full;
  //  BEE-050:36 the lines this quote already shows: `cite`, the one view that
  //  weaves several, widens a window rather than quote the same lines twice.
  h.win = { from: w.from, to: w.to };
  //  The landing rides the hunk (LITE-029:39:nB): the pager selects the line,
  //  and the token itself when the resolver named one.
  h.land = { line: line - w.from + 1, col: seat.col || 1 };
  if (seat.hi > seat.lo) { h.land.lo = seat.lo - w.lo; h.land.hi = seat.hi - w.lo; }
  if (seat.note) h.land.note = seat.note;
  return h;
}

//  One reference -> one hunk, an excerpt or a plain-words miss.
function chunk(ref, ctx) {
  const door = require("door.js");                 //  lazy: door.js requires us
  let seat;
  try { seat = door.seatOf(ref); } catch (e) { return noteHunk(ref, "" + e); }
  //  A miss names what was searched rather than shrugging (BEE-003).
  if (seat === null) return noteHunk(ref, door.refusal(ref));
  //  Several files answer: the door's own chooser, not a guess (BEE-012).
  if (seat.rels) return fs.buildChooserHunk(seat.arg, seat.rels, seat.tail);
  const h = excerpt(seat, ref, ctx, ctx);
  return typeof h === "string" ? noteHunk(ref, h) : h;
}

//  see(arg, opts) -> { hunks }, the one view shape (LITE-045:42:t2), so that
//  the pager, the renderers and http take it without knowing a verb was added.
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
  //  A reference resolves in the ambient repo (BEE-003); http serves one it
  //  was never cd'd into, so the view enters it the way door.openTarget does.
  const pos = opts.from ? require("door.js").posOf(opts.from + "/") : null;
  return { hunks: pos === null ? all() : mnt.within(pos, all) };
}

module.exports = { see: see, window: window, symbols: symbols, excerpt: excerpt,
                   parse: parse };
