//  render/wrap.js — LITE-045: ROW GEOMETRY, and nothing else.  A hunk's bytes
//  and its tok32 spans are the input; where the display rows begin and end,
//  which token covers a byte, and where a `line:col` landing sits are the
//  output.  No colour, no markup, no fs: every renderer (plain, ansi, html) and
//  the pager index the same hunk the same way, so a row is a row in all three.
//
//  Carved out of the old view/bro.js (LITE-001), which mixed this with the
//  painter, the plain sink and the hunk builders.
"use strict";

//  tok32 bit layout (dog/tok/TOK.h, mirrored by tok.TokStream):
//    [31..27] tag (A+n)  [26] custom  [25..24] side  [23..0] end offset
//  token i's start = token i-1's end (0 for i==0).  THE one accessor set —
//  render/ansi.js and render/html.js read a tag through these, never their own.
const TOK_TAG = (w) => String.fromCharCode(65 + ((w >>> 27) & 0x1f));
const TOK_SIDE = (w) => (w >>> 24) & 3;
const TOK_END = (w) => w & 0xffffff;

//  UTF8_LEN[b>>4]: bytes in the codepoint a lead byte starts (abc UTF8_LEN).
const UTF8_LEN = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 3, 4];

//  The one render pass: PASS_NORMAL, every token side EQ (a row carries it so
//  a pass-aware consumer maps 1:1 onto the be/ row shape).
const PASS_NORMAL = 0;

//  ---- row index (BROAppendLines, NORMAL pass) -----------------------------
//  One row per logical line, codepoint soft-wrapped at `cols` (default 80 when
//  not a tty).  A row = { off, end } byte span over the hunk text (the '\n' is
//  the row terminator and excluded).

//  Codepoint end of one display row starting at byte `off` (BROAppendLines/
//  bro_row_end_pass for PASS_NORMAL): advance until a visible '\n' or `cols`
//  columns consumed; 'U'/'O'-tagged bytes are skipped (invisible, no column).
function rowEnd(hunk, off, cols) {
  const text = hunk.text, tlen = text.length, toks = hunk.toks;
  //  toks are sorted by byte end: bisect to the tok covering `off` — a linear
  //  scan from 0 made indexing O(rows*toks), minutes on a 100k-tok log hunk.
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if (TOK_END(toks[m]) <= off) lo = m + 1; else hi = m; }
  let ti = lo;
  let cp = 0, pos = off;
  while (pos < tlen && cp < cols) {
    //  Per-BYTE: the end mask is spelled inline here, not through TOK_END — a
    //  call per byte cost minutes on a 100k-tok log hunk.
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? TOK_TAG(toks[ti]) : "S";
    const ch = text[pos];
    const hidden = tag === "U" || tag === "O";   // click-target bytes take no column
    if (ch === 0x0a && !hidden) break;       // visible '\n' ends the row
    let clen = UTF8_LEN[ch >> 4];
    if (clen === 0 || pos + clen > tlen) clen = 1;
    pos += clen;
    if (!hidden) cp++;
  }
  return pos;
}

//  Walk one hunk's text into display rows (one per soft-wrap segment), all
//  PASS_NORMAL.  `wrap` boolean — false (no-wrap) emits ONE row per logical
//  line, clamped by rowEnd to `cols`, then skips the tail to the next '\n';
//  true (or undefined, the default) soft-wraps.
function indexRows(hunk, cols, wrap) {
  const rows = [];
  const text = hunk.text, tlen = text.length;
  let off = 0;
  while (off < tlen) {
    const end = rowEnd(hunk, off, cols);
    rows.push({ off: off, end: end, pass: PASS_NORMAL });
    let next;
    if (wrap === false) {
      //  No-wrap: the clamped tail is hidden — skip to past the logical line's
      //  '\n' so the next row is the next line, not a wrap of this one.
      let nl = end; while (nl < tlen && text[nl] !== 0x0a) nl++;
      next = nl < tlen ? nl + 1 : nl;
    } else {
      //  Next row starts past the terminating '\n' (rowEnd stops AT it), else at
      //  the wrap point.  Guard against a zero-width row (cols 0) stalling.
      next = end < tlen && text[end] === 0x0a ? end + 1 : end;
    }
    off = next > off ? next : off + 1;
  }
  return rows;
}

//  ---- the LANDING (LITE-034: shared, was welded into the pager) ---------
//  A door that resolved a reference names a 1-based `line:col`; both the pager
//  (which scrolls to it) and the HTML painter (which anchors on it) need the
//  same two answers, so the math lives here once.

//  A landing -> { off, at, oncol }: `off` the line's first byte, `at` the byte
//  the landing names, `oncol` whether the COLUMN named a real byte of the line
//  (a column past the line's end names none: the LINE START is the landing).
//  null = the text has no such line.
function landAt(text, line, col) {
  if (!(line >= 1)) return null;
  let off = 0, n = 1;
  while (n < line && off < text.length) { if (text[off] === 0x0a) n++; off++; }
  if (n < line) return null;
  let eol = off;
  while (eol < text.length && text[eol] !== 0x0a) eol++;
  const c = col > 0 ? off + col - 1 : -1;
  const on = c >= off && c < eol;
  return { off: off, at: on ? c : off, oncol: on };
}

//  The token covering byte `at` -> { lo, hi, tag }, or null (no toks, or past
//  the last one).  Token i starts where token i-1 ended, so one bisect names it.
function tokSpanAt(hunk, at) {
  const toks = hunk.toks;
  if (!toks || !toks.length || at < 0) return null;
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if (TOK_END(toks[m]) <= at) lo = m + 1; else hi = m; }
  if (lo >= toks.length) return null;
  const s = lo > 0 ? TOK_END(toks[lo - 1]) : 0, e = TOK_END(toks[lo]);
  return e > s ? { lo: s, hi: e, tag: TOK_TAG(toks[lo]) } : null;
}

//  ---- status bar (BROStatusURI / BROStatusBar) ----------------------------
//  Where the viewport SITS, in words: the same row geometry read out for a
//  human.  The pager is the only app with a viewport, but the arithmetic is
//  the row index's, not the app's.

//  The live re-typeable URI of the current view position: `<path>#L<line>`.
//  LITE-001: plain concat — a lite hunk URI IS a filesystem path (no scheme,
//  no authority, no query), so there is nothing to parse or rebuild.  Takes a
//  hunk or a bare path string; an empty URI has no anchor and stays verbatim.
function statusURI(hunk, line) {
  const u = typeof hunk === "string" ? hunk : hunk.uri;
  if (!u) return u;
  //  LITE-010: the LIVE line REPLACES an anchor the uri already carries (a diff
  //  hunk's uri is `<path>#L<window start>`), never stacks a second one.
  const h = u.lastIndexOf("#L");
  const bare = h > 0 ? u.slice(0, h) : u;
  return bare + "#L" + line;
}

function statusPos(scroll, nrows, viewRows) {
  if (nrows <= viewRows) return "ALL";
  if (scroll === 0) return "TOP";
  if (scroll + viewRows >= nrows) return "BOT";
  return Math.floor((scroll * 100) / (nrows - viewRows)) + "%";
}

module.exports = {
  TOK_TAG: TOK_TAG, TOK_SIDE: TOK_SIDE, TOK_END: TOK_END,
  UTF8_LEN: UTF8_LEN,
  PASS_NORMAL: PASS_NORMAL,
  indexRows: indexRows,
  rowEnd: rowEnd,
  landAt: landAt,
  tokSpanAt: tokSpanAt,
  statusURI: statusURI,
  statusPos: statusPos,
};
