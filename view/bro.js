//  bro.js (lib) — the SHARED render pipeline of beagle-lite: a URI → one hunk
//  (file text+tok32, or an 'F'-tagged dir listing), a row index (codepoint
//  soft-wrap), the tag→ansi64 painter, and the plain sink.  Pure JS over the
//  quickjab-shared bindings: io.mmap/stat/readdir, tok.parse (→tok32),
//  utf8, tty.size.
//
//  LITE-001: the SYNTAX file/dir view only — the be/ diff two-pass renderer,
//  the why/blame wash, the elastic `B` field, the TLV/table sinks and the URI
//  machinery are all out of the lite floor.  Every token here is side EQ and
//  the row index is one NORMAL pass, one row per (soft-wrapped) line.
"use strict";

//  tok32 bit layout (dog/tok/TOK.h, mirrored by tok.TokStream):
//    [31..27] tag (A+n)  [26] custom  [25..24] side  [23..0] end offset
//  token i's start = token i-1's end (0 for i==0).
const TOK_TAG = (w) => String.fromCharCode(65 + ((w >>> 27) & 0x1f));
const TOK_END = (w) => w & 0xffffff;

//  UTF8_LEN[b>>4]: bytes in the codepoint a lead byte starts (abc UTF8_LEN).
const UTF8_LEN = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 3, 4];

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
//  not part of the lite view).  'W' is the whitespace slot buildDirHunk emits.
//  An absent tag (the 'S' default, 'U'/'O' hidden cells) falls through to A0.
const THEME = {
  D: aFgB(90), G: aFg256(149), L: aFgB(96), H: aFgB(35), R: aFgB(94), P: aFgB(90),
  N: aFlag(A_BOLD), C: aFlag(A_BOLD), F: aFg256(56), T: aFg256(56),
  W: aFgB(32),
};
function themeAt(tag) { return THEME[tag] || A0; }
const THEME_BANNER = { fm: 2, fg: 0, bm: 2, bg: 230, fl: 0 };

//  LITE-010: the diff WASH.  A tok32's side lives in bits [25..24] — 1 = the
//  to-side (inserted), 2 = the from-side (removed) — and a changed token takes
//  a 256-colour BACKGROUND over its syntax colour: be/view/theme.js's own
//  `inWash` 157 (salad green) and `rmWash` 217 (salmon), which is exactly what
//  the C HUNK colour render paints.  lite has ONE pass, so there is no pale
//  other-pass tint and no patch-provenance family: two slots, both ways.
const SIDE_EQ = 0, SIDE_IN = 1, SIDE_RM = 2;
function aBg256(n) { return { fm: 0, fg: 0, bm: 2, bg: n, fl: 0 }; }
const WASH_IN = aBg256(157), WASH_RM = aBg256(217);

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

//  The one render pass: PASS_NORMAL, every token side EQ (a row carries it so
//  a pass-aware consumer maps 1:1 onto the be/ row shape).
const PASS_NORMAL = 0;

//  --- bro_cell_ansi: (fg tag, pass, side) -> ansi64 ------------------------
//  PASS_NORMAL only (lite never splits a row into an rm-pass and an in-pass);
//  a diff hunk's side ORs the wash on, a file hunk's side is EQ and gets none.
function cellAnsi(tag, pass, side) {
  const want = themeAt(tag);
  if (side === SIDE_IN) return aOr(want, WASH_IN);
  if (side === SIDE_RM) return aOr(want, WASH_RM);
  return want;
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

//  ---- hunk build ----------------------------------------------------------
//  A hunk: { uri, verb:"hunk", text:Uint8Array, toks:Uint32Array, kind }.
//  text/toks are the raw bytes + packed tok32 the renderer indexes & paints.

//  Strip a single trailing '/' for FS ops (stat/mmap/readdir take the bare
//  path); the banner keeps the arg verbatim, so we never mutate `arg`.
function fsPath(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

//  Build a FILE hunk: mmap the bytes, tok.parse by extension (best-effort —
//  an unknown ext yields no toks, exactly like BROTokenize's KnownExt gate).
function buildFileHunk(arg, path) {
  const bytes = io.mmap(path, "r").data();
  const ext = pathExt(path);
  let toks;
  try { toks = ext ? tok.parse(bytes, ext) : new Uint32Array(0); }
  catch (e) { toks = new Uint32Array(0); }   // lex miss → no highlight, still cat
  return { uri: arg, verb: "hunk", text: bytes, toks: toks, kind: "file" };
}

//  Build a DIR hunk: one line per entry (basename, dirs get a trailing '/'),
//  tagged 'F' (filename) + 'P' for the slash, in FILEScanDir order.  Mirrors
//  BROListDir / listdir_emit (FILE_SCAN_ALL = include dotfiles).  An empty dir
//  yields NULL — BROListDir emits no hunk (no banner) for it.
function buildDirHunk(arg, path) {
  const entries = io.readdir(path, { hidden: true });
  if (entries.length === 0) return null;
  let text = "";
  const tagAt = [];                          // [{tag, end}] over the text bytes
  for (const e of entries) {
    const isDir = e.endsWith("/");
    const name = isDir ? e.slice(0, -1) : e;
    text += name;
    tagAt.push(["F", utf8.Encode(text).length]);
    if (isDir) { text += "/"; tagAt.push(["P", utf8.Encode(text).length]); }
    text += "\n";
    tagAt.push(["W", utf8.Encode(text).length]);
  }
  const bytes = utf8.Encode(text);
  const toks = new Uint32Array(tagAt.length);
  for (let i = 0; i < tagAt.length; i++) {
    const tagCode = tagAt[i][0].charCodeAt(0) - 65;
    toks[i] = ((tagCode & 0x1f) << 27) | (tagAt[i][1] & 0xffffff);
  }
  return { uri: arg, verb: "hunk", text: bytes, toks: toks, kind: "dir" };
}

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
    if ((toks[m] & 0xffffff) <= off) lo = m + 1; else hi = m; }
  let ti = lo;
  let cp = 0, pos = off;
  while (pos < tlen && cp < cols) {
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

//  ---- status bar (BROStatusURI / BROStatusBar) ----------------------------
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

//  ---- plain sink (BROPlain, !BRO_COLOR branch) ----------------------------
//  The non-interactive `--plain` rendering, byte-exact with `bro --plain`:
//  per hunk emit the ONE banner header `hunk <uri>\n` (HUNKu8sFeedBanner plain:
//  no ts/verb-date here, just `[verb ]<uri>`) then the text verbatim, with a
//  trailing '\n' appended iff the text doesn't already end in one.  No tok
//  paint, no soft-wrap — that is exactly the C `!BRO_COLOR` path.
function plainHunk(hunk) {
  let head = "hunk " + hunk.uri + "\n";       // verb "hunk" + uri (banner)
  let out = utf8.Encode(head);
  //  LITE-010: a diff hunk's TEXT is the weave (both sides interleaved, sides
  //  in the toks) — unreadable as bytes — so it carries its own already
  //  rendered `plain`, the C `diff:`-URI unified render.  Same banner, same
  //  trailing-newline rule; every other hunk has no `plain` and is unchanged.
  const text = hunk.plain || hunk.text;
  if (text.length === 0) return out;
  const needNL = text[text.length - 1] !== 0x0a;
  const buf = new Uint8Array(out.length + text.length + (needNL ? 1 : 0));
  buf.set(out, 0);
  buf.set(text, out.length);
  if (needNL) buf[buf.length - 1] = 0x0a;
  return buf;
}

//  ---- path ext (PATHu8sExt) ----------------------------------------------
//  The extension after the last '.' in the basename, or "" (no dot, or a
//  dotfile whose only dot is leading).  Drives the tok.parse language.
function pathExt(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

module.exports = {
  buildFileHunk: buildFileHunk,
  buildDirHunk: buildDirHunk,
  fsPath: fsPath,
  pathExt: pathExt,
  indexRows: indexRows,
  rowEnd: rowEnd,
  statusURI: statusURI,
  statusPos: statusPos,
  plainHunk: plainHunk,
  //  The pager paints each cell through the SAME THEME machinery (cellAnsi →
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
};
