//  render/wrap.js — LITE-045: ROW GEOMETRY, and nothing else.  A hunk's bytes
//  and its tok32 spans are the input; where the display rows begin and end,
//  which token covers a byte, and where a `line:col` landing sits are the
//  output.  No colour, no markup, no fs: every renderer (plain, ansi, html) and
//  the pager index the same hunk the same way, so a row is a row in all three.
//  BEE-021: a diff hunk's rows carry a PASS — inline or split — the be
//  bro_walk_hunk heuristics decide which.  Carved out of view/bro.js (LITE-001).
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

//  BEE-021: the render PASS a row carries.  NORMAL paints both diff sides in
//  place (an inline row); RM/IN are the two rows a whole-line change splits
//  into, each HIDING the other side's bytes (be bro.js:174, BRO-009).
const PASS_NORMAL = 0, PASS_RM = 1, PASS_IN = 2;
const SIDE_EQ = 0, SIDE_IN = 1, SIDE_RM = 2;

//  A byte the row does not SHOW: a click target ('U'/'O'), or the other diff
//  side in a split pass.  The one predicate every row walker (index, paint,
//  screen->byte) reads, so a hidden byte takes no column anywhere.
function passHides(tag, pass, side) {
  return tag === "U" || tag === "O" ||
         (pass === PASS_RM && side === SIDE_IN) ||
         (pass === PASS_IN && side === SIDE_RM);
}

//  BEE-034: an `O` token's bytes are a BUTTON — `#<bg><fg> <verb args>`, one
//  token spelling both the look and the click (be views/todo/todo.js:750
//  btnSpell).  This sheds the look: everything through the FIRST space.  ""
//  means colour and no click, so the caller falls through to the row.
function oSpell(s) {
  if (s.charCodeAt(0) !== 0x23) return s;        // no `#` prefix: all spell
  const sp = s.indexOf(" ");
  return sp < 0 ? "" : s.slice(sp + 1);
}

//  BEE-035: the LOOK half of that same prefix — TWO ordered slots, each `#`-
//  opened, each optional: `#<bg><fg> ` is a button (tone over derived wash),
//  `##<fg> ` is INFO (tone alone).  -> { bg, fg } as `#rrggbb` or "", null on
//  a bare spell; ONE grammar for ansi and html alike (be view/bro.js:229).
const LOOK_RE = /^#([0-9a-fA-F]{6})?(?:#([0-9a-fA-F]{6}))?/;
function oLook(s) {
  if (s.charCodeAt(0) !== 0x23) return null;
  const m = LOOK_RE.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  return { bg: m[1] ? "#" + m[1] : "", fg: m[2] ? "#" + m[2] : "" };
}

//  ---- row index (BROAppendLines) ------------------------------------------
//  One row per logical line, codepoint soft-wrapped at `cols` (default 80 when
//  not a tty).  A row = { off, end, pass } byte span over the hunk text (the
//  '\n' is the row terminator and excluded).

//  Codepoint end of one display row starting at byte `off` (bro_row_end_pass):
//  advance until a '\n' this pass sees or `cols` columns consumed; bytes the
//  pass hides advance but take no column.  `pass` defaults to NORMAL.
function rowEnd(hunk, off, cols, pass) {
  const text = hunk.text, tlen = text.length, toks = hunk.toks;
  pass = pass | 0;
  //  toks are sorted by byte end: bisect to the tok covering `off` — a linear
  //  scan from 0 made indexing O(rows*toks), minutes on a 100k-tok log hunk.
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if (TOK_END(toks[m]) <= off) lo = m + 1; else hi = m; }
  let ti = lo;
  let cp = 0, pos = off;
  while (pos < tlen && cp < cols) {
    //  Per-BYTE: the masks are spelled inline here, not through TOK_END — a
    //  call per byte cost minutes on a 100k-tok log hunk.
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const w = ti < toks.length ? toks[ti] : 0;
    const tag = ti < toks.length ? TOK_TAG(w) : "S";
    const ch = text[pos];
    const hidden = passHides(tag, pass, (w >>> 24) & 3);
    if (ch === 0x0a && !hidden) break;       // a '\n' this pass sees ends the row
    let clen = UTF8_LEN[ch >> 4];
    if (clen === 0 || pos + clen > tlen) clen = 1;
    pos += clen;
    if (!hidden) cp++;
  }
  return pos;
}

//  ---- BEE-021: inline vs whole-line (the be bro_walk_hunk twin) -----------
//  A diff hunk's text is the WEAVE.  Per '\n' segment, tally visible bytes by
//  side: a lightly edited line paints in place (NORMAL), a heavier one splits
//  into rm + in rows.  Port of be view/bro.js:393-491 (BRO-009); no DIFF-017 here.

//  A hunk is a diff hunk iff any visible tok carries a side != EQ.
function hasDiffSides(toks) {
  if (!toks) return false;
  for (let i = 0; i < toks.length; i++)
    if (TOK_SIDE(toks[i]) !== SIDE_EQ && TOK_TAG(toks[i]) !== "U") return true;
  return false;
}

//  Per segment: {lo, hi, inB, rmB, eqB, bnd} — the byte span (hi = the '\n',
//  or tlen), visible byte tallies by side, and `bnd` the side of the '\n'
//  itself (which pass sees the break).
function classifyLines(text, toks) {
  const tlen = text.length, ntoks = toks.length;
  const out = [];
  let lineLo = 0, ti = 0, inB = 0, rmB = 0, eqB = 0;
  for (let off = 0; off < tlen; off++) {
    while (ti < ntoks && (toks[ti] & 0xffffff) <= off) ti++;
    const w = ti < ntoks ? toks[ti] : 0;
    const side = (w >>> 24) & 3;
    const tag = ti < ntoks ? TOK_TAG(w) : "S";
    if (tag === "U" || tag === "O") continue;
    if (text[off] === 0x0a) {
      out.push({ lo: lineLo, hi: off, inB: inB, rmB: rmB, eqB: eqB, bnd: side });
      lineLo = off + 1; inB = rmB = eqB = 0;
    } else if (side === SIDE_IN) inB++;
    else if (side === SIDE_RM) rmB++;
    else eqB++;
  }
  if (lineLo < tlen)
    out.push({ lo: lineLo, hi: tlen, inB: inB, rmB: rmB, eqB: eqB, bnd: SIDE_EQ });
  return out;
}

//  The mode decision.  BRO-041: an edit weighs max(in,rm), not in+rm — a
//  symmetric token swap must not be charged twice against the 4x inline gate.
const K_EQ = 0, K_PURE_IN = 1, K_PURE_RM = 2, K_MOD_INLINE = 3, K_MOD_SPLIT = 4;
function lineKind(li) {
  const changed = Math.max(li.inB, li.rmB);
  if (changed === 0) return K_EQ;
  if (li.eqB === 0) {
    if (li.inB > 0 && li.rmB > 0) return K_MOD_SPLIT;
    return li.inB > 0 ? K_PURE_IN : K_PURE_RM;
  }
  return changed * 4 < changed + li.eqB ? K_MOD_INLINE : K_MOD_SPLIT;
}
//  A one-sided '\n' with the other side present: the segment bleeds into the
//  next one, so a change region is not split at a break one pass cannot see.
function lineContinues(li) {
  if (li.bnd === SIDE_IN) return li.rmB > 0;
  if (li.bnd === SIDE_RM) return li.inB > 0;
  return false;
}
function passSeesNL(pass, bnd) {
  if (pass === PASS_NORMAL) return true;
  return pass === PASS_RM ? bnd !== SIDE_IN : bnd !== SIDE_RM;
}

//  Drive `emit(lo, hi, pass)` per logical row: an EQ/INLINE segment with an
//  EQ boundary is one NORMAL row; anything else opens a block that runs to the
//  next such segment, emitted twice — RM rows then IN rows, each grouped
//  across the '\n's its pass cannot see, empty rows dropped.
function walkHunk(text, toks, emit) {
  const info = classifyLines(text, toks);
  const nl = info.length;
  let i = 0;
  while (i < nl) {
    const k = lineKind(info[i]);
    if ((k === K_EQ || k === K_MOD_INLINE) && info[i].bnd === SIDE_EQ) {
      emit(info[i].lo, info[i].hi, PASS_NORMAL);
      i++;
      continue;
    }
    let j = i;
    while (j < nl) {
      const kj = lineKind(info[j]);
      if (info[j].bnd === SIDE_EQ && (kj === K_EQ || kj === K_MOD_INLINE) &&
          (j === i || !lineContinues(info[j - 1]))) break;
      j++;
    }
    const blockHi = info[j - 1].hi;
    for (const pass of [PASS_RM, PASS_IN]) {
      let rowStart = info[i].lo, own = 0, eq = 0;
      for (let m = i; m < j; m++) {
        own += pass === PASS_RM ? info[m].rmB : info[m].inB; eq += info[m].eqB;
        if (passSeesNL(pass, info[m].bnd)) {
          if (own > 0 || eq > 0) emit(rowStart, info[m].hi, pass);
          rowStart = info[m].hi + 1; own = eq = 0;
        }
      }
      if (own > 0 || eq > 0) emit(rowStart, blockHi, pass);
    }
    i = j;
  }
}

//  ---- BEE-030: the elastic `B` field (be view/bro.js:685, BRO-036) ---------
//  The producer tags ONE span per line `B`; at a REAL width the no-wrap index
//  …-cuts the span when the line overflows `cols` and pads it when short, so
//  trailing columns stay flush right.  Soft-wrap / unclamped never fire it.
const NO_CLAMP = 1 << 24;                 // wider than any tok32 end offset

//  The pad insert is the work-view dotted leader with one breathing space
//  against the abutting byte; `tail` = no producer byte follows the span (the
//  zero-width B), so the breath flips ends.  Each `┄` is ONE display column.
function elasticPad(n, tail) {
  if (n <= 1) return " ";
  return tail ? "┄".repeat(n - 1) + " " : " " + "┄".repeat(n - 1);
}

//  Measure the logical line at `off` and find its first `B` run; too wide →
//  cut the run's tail under a `…`, too narrow → pad after it.  Returns { end,
//  els: { lo, hi, ins } } (skip bytes [lo,hi), emit `ins` there) or null (no
//  B span / exact fit).
function elasticRow(hunk, off, cols) {
  const text = hunk.text, tlen = text.length, toks = hunk.toks;
  if (!toks || !toks.length) return null;
  let ti = 0;
  while (ti < toks.length && (toks[ti] & 0xffffff) <= off) ti++;
  let cp = 0, pos = off, bLo = -1, bHi = -1, bW = 0;
  const bCells = [];                           // byte start of each B cell
  while (pos < tlen) {
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? TOK_TAG(toks[ti]) : "S";
    const ch = text[pos];
    const hidden = tag === "U" || tag === "O";
    if (ch === 0x0a && !hidden) break;         // visible '\n' ends the line
    let clen = UTF8_LEN[ch >> 4];
    if (clen === 0 || pos + clen > tlen) clen = 1;
    if (!hidden) {
      //  Only the FIRST contiguous run of B cells is THE elastic span.
      if (tag === "B" && (bHi < 0 || pos === bHi)) {
        if (bLo < 0) bLo = pos;
        bCells.push(pos); bHi = pos + clen; bW++;
      }
      cp++;
    }
    pos += clen;
  }
  const lineEnd = pos;                         // at the '\n' (or tlen)
  if (bW <= 0) {
    //  A ZERO-WIDTH B tok (a bare-key title) still pads — the cell walk never
    //  enters it, so find its slot in the tok list directly.
    let prev = 0;
    for (let i = 0; i < toks.length; i++) {
      const e = toks[i] & 0xffffff;
      if (TOK_TAG(toks[i]) === "B" && prev >= off && e <= lineEnd) { bLo = bHi = e; break; }
      prev = e;
    }
    if (bHi < 0 || cp >= cols) return null;    // no B slot / nothing to pad
    return { end: lineEnd, els: { lo: bHi, hi: bHi, ins: elasticPad(cols - cp, true) } };
  }
  if (cp === cols) return null;
  if (cp < cols)                               // pad the span's tail to cols
    return { end: lineEnd, els: { lo: bHi, hi: bHi, ins: elasticPad(cols - cp, false) } };
  const cut = Math.min(cp - cols + 1, bW);     // the `…` itself takes 1 col
  const els = { lo: bCells[bW - cut], hi: bHi, ins: "…" };
  if (cp - cut + 1 <= cols) return { end: lineEnd, els: els };
  //  The span shrunk to nothing and STILL too wide: hard-clip the tail as today.
  return { end: elasticClip(hunk, off, cols, els), els: els };
}

//  rowEnd's twin that applies an els insert/skip — the clamp for a line that
//  overflows even with its elastic span shrunk to nothing.
function elasticClip(hunk, off, cols, els) {
  const text = hunk.text, tlen = text.length, toks = hunk.toks;
  let ti = 0;
  while (ti < toks.length && (toks[ti] & 0xffffff) <= off) ti++;
  let cp = 0, pos = off;
  while (pos < tlen && cp < cols) {
    if (pos === els.lo) { cp++; pos = els.hi; continue; }   // the 1-col `…`
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? TOK_TAG(toks[ti]) : "S";
    const ch = text[pos];
    const hidden = tag === "U" || tag === "O";
    if (ch === 0x0a && !hidden) break;
    let clen = UTF8_LEN[ch >> 4];
    if (clen === 0 || pos + clen > tlen) clen = 1;
    pos += clen;
    if (!hidden) cp++;
  }
  return pos;
}

//  A diff hunk's row index: walkHunk's logical rows, each soft-wrapped by the
//  pass-aware rowEnd (or one clamped row when `wrap` is false).
function indexDiffRows(hunk, cols, wrap) {
  const rows = [];
  walkHunk(hunk.text, hunk.toks, function (lo, endNl, pass) {
    let off = lo;
    while (off <= endNl) {
      const end = rowEnd(hunk, off, cols, pass);
      rows.push({ off: off, end: end < endNl ? end : endNl, pass: pass });
      if (end >= endNl || wrap === false) break;
      off = end;
    }
  });
  return rows;
}

//  Walk one hunk's text into display rows (one per soft-wrap segment); a diff
//  hunk (tok sides) takes the two-pass index.  `wrap` boolean — false (no-wrap)
//  emits ONE row per logical line, clamped by rowEnd to `cols`, then skips the
//  tail to the next '\n'; true (or undefined, the default) soft-wraps.
function indexRows(hunk, cols, wrap) {
  if (hasDiffSides(hunk.toks)) return indexDiffRows(hunk, cols, wrap);
  const rows = [];
  const text = hunk.text, tlen = text.length;
  let off = 0;
  while (off < tlen) {
    let end = rowEnd(hunk, off, cols);
    const row = { off: off, end: end, pass: PASS_NORMAL };
    rows.push(row);
    let next;
    if (wrap === false) {
      //  BEE-030: at a REAL width an elastic `B` span resizes the row to
      //  `cols`; the row then spans the whole line, `els` riding to the paint.
      if (cols < NO_CLAMP) {
        const el = elasticRow(hunk, off, cols);
        if (el) { end = row.end = el.end; row.els = el.els; }
      }
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
  PASS_NORMAL: PASS_NORMAL, PASS_RM: PASS_RM, PASS_IN: PASS_IN,
  SIDE_EQ: SIDE_EQ, SIDE_IN: SIDE_IN, SIDE_RM: SIDE_RM,
  passHides: passHides,
  oSpell: oSpell,                        // BEE-034: the `O` button's click bytes
  oLook: oLook,                          // BEE-035: ...and its colour pair
  indexRows: indexRows,
  rowEnd: rowEnd,
  //  BEE-030: the elastic `B` field + the width past which no index clamps.
  NO_CLAMP: NO_CLAMP,
  elasticRow: elasticRow, elasticClip: elasticClip, elasticPad: elasticPad,
  //  BEE-021: the inline/split classifier, exported for the render tests.
  hasDiffSides: hasDiffSides,
  classifyLines: classifyLines, lineKind: lineKind, walkHunk: walkHunk,
  K_EQ: K_EQ, K_PURE_IN: K_PURE_IN, K_PURE_RM: K_PURE_RM,
  K_MOD_INLINE: K_MOD_INLINE, K_MOD_SPLIT: K_MOD_SPLIT,
  landAt: landAt,
  tokSpanAt: tokSpanAt,
  statusURI: statusURI,
  statusPos: statusPos,
};
