//  render/ansi.js — LITE-045: THE ANSI PAINTER, `render(hunks, opts) -> bytes`.
//  A tok32 tag plus a diff side becomes an ansi64 state, a run of equal states
//  shares one SGR, and a row closes with a reset — byte-identical to the C
//  speller (abc/ANSI.c ANSIu8sFeedDelta / ANSIu8sFeedReset).
//
//  VERB-BLIND: it knows tags, sides and rows, never which view made the hunk.
//  `lite --color` writes what this renders; pager.js paints one visible
//  row at a time through the SAME cellAnsi/deltaSGR pair, so a paged screen and
//  a piped dump agree cell for cell.
//
//  Carved out of the old view/bro.js (LITE-001), which mixed the painter with
//  the row index, the plain sink and the hunk builders.
"use strict";

const wrap = require("render/wrap.js");
//  UTF8_LEN[b>>4]: bytes in the codepoint a lead byte starts — the row
//  index's own table, so the painted row and the indexed row agree.
const UTF8_LEN = wrap.UTF8_LEN;

const ESC = String.fromCharCode(27);

//  --- ansi64 model (abc/ANSI.h) -------------------------------------------
//  ansi64 as {fm,fg,bm,bg,fl}: fg mode/value, bg mode/value, attr flags.
//  OR-combine is field-wise — a fg-only and a bg-only state merge cleanly,
//  exactly like the C `want |= THEMEAt(...)` (the fields never overlap).
const A0 = { fm: 0, fg: 0, bm: 0, bg: 0, fl: 0 };
function aFgB(n)   { return { fm: 1, fg: n, bm: 0, bg: 0, fl: 0 }; }  // basic 30-37/90-97
function aFg256(n) { return { fm: 2, fg: n, bm: 0, bg: 0, fl: 0 }; }
function aFlag(f)  { return { fm: 0, fg: 0, bm: 0, bg: 0, fl: f }; }
function aOr(a, b) {
  return { fm: a.fm | b.fm, fg: a.fg | b.fg, bm: a.bm | b.bm,
           bg: a.bg | b.bg, fl: a.fl | b.fl };
}
function aEq(a, b) {
  return a.fm === b.fm && a.fg === b.fg && a.bm === b.bm &&
         a.bg === b.bg && a.fl === b.fl;
}
const A_BOLD = 0x01;

//  dog/THEME.h THEME16TBL — the default terminal-adaptive palette, the
//  byte-exact C table: tok-syntax tags only (the diff/quad/button slots are
//  not part of the lite view).  'W' is the whitespace slot view/fs.js emits.
//  An absent tag (the 'S' default, 'U'/'O' hidden cells) falls through to A0.
//  LITE-017: `list` paints its wt-marker column out of the STATUS-verb slots of
//  the same C table (dog/THEME.c THEME16TBL) — E mod yellow, X del brown, Q dir
//  grey; `eq` rides the D grey already here.  No other view emits them.
const THEME = {
  D: aFgB(90), G: aFg256(149), L: aFgB(96), H: aFgB(35), R: aFgB(94), P: aFgB(90),
  N: aFlag(A_BOLD), C: aFlag(A_BOLD), F: aFg256(56), T: aFg256(56),
  W: aFgB(32),
  E: aFgB(33), X: aFg256(94), Q: aFgB(90),
};
function themeAt(tag) { return THEME[tag] || A0; }
const THEME_BANNER = { fm: 2, fg: 0, bm: 2, bg: 230, fl: 0 };

//  LITE-010: the diff WASH.  A tok32's side lives in bits [25..24] — 1 = the
//  to-side (inserted), 2 = the from-side (removed) — and a changed token takes
//  a 256-colour BACKGROUND over its syntax colour: be/view/theme.js:126 `inWash`
//  157 (salad green) / `rmWash` 217 (salmon) on its OWN pass, the PALE 194/224
//  when seen from the other pass or inline (BEE-021, be bro.js:184 WASH I/O/J/K).
//  No patched-in family: bee stamps no provenance bit 26 (DIFF-016).
const SIDE_EQ = wrap.SIDE_EQ, SIDE_IN = wrap.SIDE_IN, SIDE_RM = wrap.SIDE_RM;
const PASS_NORMAL = wrap.PASS_NORMAL, PASS_RM = wrap.PASS_RM, PASS_IN = wrap.PASS_IN;
function aBg256(n) { return { fm: 0, fg: 0, bm: 2, bg: n, fl: 0 }; }
const WASH_IN = aBg256(157), WASH_RM = aBg256(217);
const WASH_IN_PALE = aBg256(194), WASH_RM_PALE = aBg256(224);

//  LITE-023: the CURSOR wash — the active line and the active token take a bg
//  LIGHTNESS shift (steps DOWN the 256 cube / the grey ramp), never a hue: an
//  already washed cell keeps its own colour, only darker, so the LITE-010 diff
//  wash still reads under the cursor.  A cell with no bg starts from white.
const WASH_CUR_LINE = 1, WASH_CUR_TOK = 3;     // cube steps (grey ramp: x2)
function washBg(bg, steps) {
  if (bg >= 232) return bg - 2 * steps > 232 ? bg - 2 * steps : 232;  // grey ramp
  if (bg < 16) return bg;                       // a basic-16 bg: leave it alone
  const c = bg - 16, r = (c / 36) | 0, g = ((c % 36) / 6) | 0, b = c % 6;
  const d = function (x) { return x > steps ? x - steps : 0; };
  return 16 + 36 * d(r) + 6 * d(g) + d(b);
}
//  Shift `a`'s background `steps` darker; fg/flags ride through untouched.
function aWash(a, steps) {
  if (!steps) return a;
  const bg = a.bm === 2 ? washBg(a.bg, steps) : 255 - 2 * steps;
  return { fm: a.fm, fg: a.fg, bm: 2, bg: bg, fl: a.fl };
}

//  --- SGR delta speller (abc/ANSI.c ANSIu8sFeedDelta / ANSIu8sFeedReset) ---
//  Emit only the attributes that transitioned from `prev` to `want`, in the
//  C order: flags-off, flags-on, fg, bg.  Byte-identical to the C speller so
//  a run of identical cells shares one open SGR and a row closes with `\033[0m`.
const FLAG_ON  = { 0x01: 1, 0x02: 2, 0x04: 3, 0x08: 4, 0x10: 5, 0x20: 7, 0x40: 9 };
const FLAG_OFF = { 0x01: 22, 0x02: 22, 0x04: 23, 0x08: 24, 0x10: 25, 0x20: 27, 0x40: 29 };
function feedColor(kind, mode, val) {
  if (mode === 1) return String(val);                       // BASIC: code verbatim
  if (mode === 2) return kind + "8;5;" + (val & 0xff);      // 256
  if (mode === 3) return kind + "8;2;" + ((val >> 16) & 0xff) + ";" +
                         ((val >> 8) & 0xff) + ";" + (val & 0xff);
  return kind === "3" ? "39" : "49";                        // DEFAULT
}
function deltaSGR(want, prev) {
  if (aEq(want, prev)) return "";
  const parts = [];
  const off = prev.fl & ~want.fl, on = want.fl & ~prev.fl;
  for (let b = 1; b <= 0x40; b <<= 1) if (off & b) parts.push(String(FLAG_OFF[b]));
  for (let b = 1; b <= 0x40; b <<= 1) if (on & b) parts.push(String(FLAG_ON[b]));
  if (want.fg !== prev.fg || want.fm !== prev.fm)
    parts.push(feedColor("3", want.fm, want.fg));
  if (want.bg !== prev.bg || want.bm !== prev.bm)
    parts.push(feedColor("4", want.bm, want.bg));
  if (parts.length === 0) parts.push("0");
  return ESC + "[" + parts.join(";") + "m";
}
function resetSGR(cur) { return aEq(cur, A0) ? "" : ESC + "[0m"; }

//  --- bro_cell_ansi: (fg tag, pass, side) -> ansi64 ------------------------
//  Inline (NORMAL) paints both sides PALE; a split pass paints its own side
//  in the strong wash and the other side's stray tokens pale (be bro.js:347).
//  A file hunk's side is EQ and gets none.
function cellAnsi(tag, pass, side) {
  const want = themeAt(tag);
  if (side === SIDE_EQ) return want;
  if (pass === PASS_RM) return aOr(want, side === SIDE_RM ? WASH_RM : WASH_IN_PALE);
  if (pass === PASS_IN) return aOr(want, side === SIDE_IN ? WASH_IN : WASH_RM_PALE);
  return aOr(want, side === SIDE_IN ? WASH_IN_PALE : WASH_RM_PALE);
}

//  BRO-011: emit one row to a BYTE sink — `enc` appends SGR/ASCII, `raw(lo,hi)` the
//  VERBATIM text bytes.  BRO-010: colour = the SHARED THEME, runs batched, U/O hidden.
//  LITE-023: `wash` (or null) is the CURSOR wash for THIS row — {lo,hi} the
//  active token's byte span (lo<0: none); the line wash rides every cell.
function emitBody(hunk, off, end, color, pass, enc, raw, wash) {
  const text = hunk.text, toks = hunk.toks;
  //  bisect to the tok covering `off` (toks sorted by byte end) — the linear
  //  scan from 0 cost O(toks) per painted row, sluggish on a 100k-tok hunk.
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if ((toks[m] & 0xffffff) <= off) lo = m + 1; else hi = m; }
  let ti = lo;
  let cur = A0, pos = off, runLo = -1;
  while (pos < end) {
    //  Per-BYTE: render/wrap.js's TOK_END/TOK_TAG spell exactly these two
    //  masks, but a call per byte is measurable on a 100k-tok hunk, so the
    //  painter's inner loop keeps them inline.
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? String.fromCharCode(65 + ((toks[ti] >>> 27) & 0x1f)) : "S";
    //  LITE-010: the token's diff SIDE (tok32 [25..24]) rides along — EQ for
    //  every file/dir/log hunk, IN/RM inside a diff hunk's weave.
    const side = ti < toks.length ? ((toks[ti] >>> 24) & 3) : SIDE_EQ;
    let clen = UTF8_LEN[text[pos] >> 4];
    if (clen === 0 || pos + clen > end) clen = 1;
    if (wrap.passHides(tag, pass, side)) {       // BEE-021: a split pass hides the other side
      if (runLo >= 0) { raw(runLo, pos); runLo = -1; } pos += clen; continue; }
    if (color) {
      let want = cellAnsi(tag, pass, side);
      if (wash) want = aWash(want, pos >= wash.lo && pos < wash.hi
                                      ? WASH_CUR_TOK : WASH_CUR_LINE);
      if (!aEq(want, cur)) {
        if (runLo >= 0) { raw(runLo, pos); runLo = -1; }
        enc(deltaSGR(want, cur)); cur = want;
      }
    }
    if (runLo < 0) runLo = pos;
    pos += clen;
  }
  if (runLo >= 0) raw(runLo, pos);
  if (color) enc(resetSGR(cur));
}

//  STRING form of a painted row (pty tests + any string consumer): the SAME cell
//  walk, text DECODED to real codepoints so a re-encoding caller sees no mojibake.
function paintRow(hunk, off, end, color, pass, wash) {
  let out = "";
  emitBody(hunk, off, end, color, pass,
           function (s) { out += s; },
           function (lo, hi) { if (hi > lo) out += utf8.Decode(hunk.text.subarray(lo, hi)); },
           wash);
  return out;
}

//  Render the THEME_BANNER colour band for a hunk URI, space-filled to `cols`
//  (HUNKu8sFeedBanner HUNKOutColor).  `used` is the URI BYTE length (the C
//  u8csLen), matching the C fill exactly.
function bannerColor(uriStr, cols, enc) {
  const uriBytes = utf8.Encode(uriStr);
  enc(deltaSGR(THEME_BANNER, A0));
  enc(uriStr);
  let used = uriBytes.length, pad = "";
  while (used < cols) { pad += " "; used++; }
  enc(pad);
  enc(resetSGR(THEME_BANNER));
  enc("\n");
}


//  ---- the RENDERER (LITE-045) ---------------------------------------------
//  render(hunks, opts) -> bytes: the pager's paint WITHOUT the viewport.  One
//  banner band per hunk, then one painted row per LOGICAL line — no soft-wrap
//  and no column clamp, because a pipe has no width to lose bytes to: `lite
//  --color <file> | less -R` sees every byte the file has, coloured.
//  `opts.cols` is the width the banner band fills to (the terminal's when there
//  is one, else 80); it never clamps a body row.
const NO_CLAMP = 1 << 24;                 // wider than any tok32 end offset

function termCols() {
  try { const sz = tty.size(1); if (sz && sz.cols > 0) return sz.cols; } catch (e) {}
  return 80;
}

function render(hunks, opts) {
  if (!hunks || !hunks.length) return new Uint8Array(0);
  const cols = (opts && opts.cols) || termCols();
  const b = io.buf(1 << 16);
  const enc = function (s) {
    const worst = s.length * 4 + 4;
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(s);
  };
  for (const h of hunks) {
    const raw = function (lo, hi) {
      if (hi <= lo) return;
      if (b.room < hi - lo + 4) b.grow(Math.max(b.cap * 2, b.cap + (hi - lo) + 4));
      b.feed(h.text.subarray(lo, hi));
    };
    bannerColor(h.uri, cols, enc);
    for (const r of wrap.indexRows(h, NO_CLAMP, false)) {
      emitBody(h, r.off, r.end, true, r.pass, enc, raw, null);
      enc("\n");
    }
  }
  return b.data();
}

module.exports = {
  render: render,
  //  The pager paints one VISIBLE row at a time through the same cell walk.
  emitBody: emitBody, paintRow: paintRow,
  //  The pager paints each cell through the SAME machinery (cellAnsi →
  //  deltaSGR), so it needs the ansi64 identity (A0) + equality (aEq) too.
  cellAnsi: cellAnsi,
  themeAt: themeAt,
  deltaSGR: deltaSGR,
  resetSGR: resetSGR,
  A0: A0,
  aEq: aEq,
  //  The banner band the colour sink opens each hunk with.
  bannerColor: bannerColor,
  THEME_BANNER: THEME_BANNER,
  //  LITE-010: the diff wash slots + the tok32 side vocabulary.
  SIDE_EQ: SIDE_EQ, SIDE_IN: SIDE_IN, SIDE_RM: SIDE_RM,
  WASH_IN: WASH_IN, WASH_RM: WASH_RM,
  WASH_IN_PALE: WASH_IN_PALE, WASH_RM_PALE: WASH_RM_PALE,
  //  LITE-023: the cursor wash — the shifts + the compose the pager paints with.
  WASH_CUR_LINE: WASH_CUR_LINE, WASH_CUR_TOK: WASH_CUR_TOK,
  aWash: aWash,
};
