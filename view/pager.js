//  view/pager.js — beagle-lite's raw-mode FILE pager: a scrollable viewport over
//  view/bro.js (soft-wrap index + cellAnsi paint), a status line, SGR mouse and a
//  minimal `:` PATH bar.  Navigation is fs-only, ALWAYS through `opts.open`.
//  tty.raw sets VMIN=0 VTIME=1 (a 100ms poll), so the key loop re-polls io.read
//  until a byte arrives; cook-on-exit rides try/finally.
"use strict";

const bro = require("view/bro.js");
//  The hunk-header band SGR (pale-yellow bg), single-sourced from the theme.
const theme = require("view/theme.js");

//  BRO-007: the ONE source of the scroll-mode key bindings — `h` builds its
//  inline help hunk straight from here.  KEEP IN SYNC with _keyScroll.
const SHORTCUTS = [
  ["q  :q", "quit the pager"],
  ["j / k", "active line down / up"],
  ["h / l", "active token prev / next (followable tokens only)"],
  ["w / s", "scroll up / down one line"],
  ["a / d", "back / forward through the views"],
  ["space / b", "page down / up"],
  ["g / G", "jump to top / bottom"],
  ["m", "toggle mouse tracking (wheel + click-to-follow)"],
  [":", "open the path bar (type a file or dir path)"],
  ["Enter", "follow the active token, else the active line"],
  ["- / BS", "back — pop to the previous view"],
  ["R / r", "refresh — re-open the current view (keep the scroll pos)"],
  ["W", "toggle soft-wrap on / off (views open no-wrap)"],
  ["?", "this help screen"],
];

//  ---- terminal write helpers (raw escapes; no OPOST, so we emit CRLF) -------
const ESC = "\x1b";
const CLEAR = ESC + "[2J" + ESC + "[H";       // clear + home
const HIDE_CUR = ESC + "[?25l", SHOW_CUR = ESC + "[?25h";
//  JAB-030: SGR mouse reporting (1000 = button events, 1006 = the extended
//  `ESC[<b;col;rowM/m` encoding) — enable on enter, disable on exit.
const MOUSE_ON = ESC + "[?1000h" + ESC + "[?1006h";
const MOUSE_OFF = ESC + "[?1000l" + ESC + "[?1006l";
//  BRO-027: the ALTERNATE SCREEN buffer (smcup/rmcup) — ?1049h on enter FIRST,
//  ?1049l on exit LAST restores the shell screen.
const ALT_ON = ESC + "[?1049h", ALT_OFF = ESC + "[?1049l";
//  Bracketed paste (DEC ?2004): the terminal WRAPS a paste in ESC[200~ …ESC[201~
//  so _feed captures the payload instead of a pasted newline submitting the bar.
const PASTE_ON = ESC + "[?2004h", PASTE_OFF = ESC + "[?2004l";
const PASTE_BEG = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];   // ESC [ 2 0 0 ~
const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];   // ESC [ 2 0 1 ~

//  UTF8_LEN[b>>4]: bytes in the codepoint a lead byte starts (view/bro.js twin).
const UTF8_LEN = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 3, 4];

//  Match `seq` against `data` at i: >0 = matched length, 0 = a definite mismatch,
//  -1 = a prefix that ran off the end (the caller carries the tail to the next read).
function _matchSeq(data, i, seq) {
  for (let k = 0; k < seq.length; k++) {
    if (i + k >= data.length) return -1;
    if (data[i + k] !== seq[k]) return 0;
  }
  return seq.length;
}

//  Write a string to a tty fd (raw mode: explicit CRLF, no cooked translation).
function ttyWrite(fd, str) {
  const bytes = utf8.Encode(str);
  const b = io.buf(bytes.length + 8);
  b.feed(bytes);
  io.writeAll(fd, b);
}

//  ---- path math (lite has no shared/util) ---------------------------------
//  The directory part of a path: "" for a bare name, "/" for a root child.
function dirOf(p) {
  const i = (p || "").lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : i === 0 ? "/" : "";
}

//  Join `rel` onto `base`, collapsing "." and ".." segment-wise; an absolute
//  `rel` replaces the base, and a climb never escapes above "/" (or above "").
function resolvePath(base, rel) {
  const all = rel[0] === "/" ? rel : base ? base + "/" + rel : rel;
  const abs = all[0] === "/";                    // the JOINED path decides the root
  const out = [];
  for (const s of all.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { if (out.length) out.pop(); continue; }
    out.push(s);
  }
  const p = out.join("/");
  return abs ? "/" + p : p || ".";
}

//  ---- hunk stream -> a flat row index spanning EVERY hunk -------------------
//  Each entry {hunk, off, end} is one display row plus its owning hunk (so
//  cellAnsi/statusURI have it per row); a banner row heads each hunk's body.
function indexAll(hunks, cols, wrap) {
  const rows = [];
  for (const h of hunks) {
    rows.push({ hunk: h, banner: true });      // the hunk header line
    const sub = bro.indexRows(h, cols, wrap);  // BRO-014: wrap boolean (soft|no-wrap)
    for (const r of sub) rows.push({ hunk: h, off: r.off, end: r.end, pass: r.pass });
  }
  return rows;
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
  let cur = bro.A0, pos = off, runLo = -1;
  while (pos < end) {
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? String.fromCharCode(65 + ((toks[ti] >>> 27) & 0x1f)) : "S";
    let clen = UTF8_LEN[text[pos] >> 4];
    if (clen === 0 || pos + clen > end) clen = 1;
    if (tag === "U" || tag === "O") { if (runLo >= 0) { raw(runLo, pos); runLo = -1; } pos += clen; continue; }
    if (color) {
      //  LITE-010: the token's diff SIDE (tok32 [25..24]) rides along — EQ for
      //  every file/dir/log hunk, IN/RM inside a diff hunk's weave.
      const side = ti < toks.length ? ((toks[ti] >>> 24) & 3) : bro.SIDE_EQ;
      let want = bro.cellAnsi(tag, pass, side);    // PASS_NORMAL
      if (wash) want = bro.aWash(want, pos >= wash.lo && pos < wash.hi
                                      ? bro.WASH_CUR_TOK : bro.WASH_CUR_LINE);
      if (!bro.aEq(want, cur)) {
        if (runLo >= 0) { raw(runLo, pos); runLo = -1; }
        enc(bro.deltaSGR(want, cur)); cur = want;
      }
    }
    if (runLo < 0) runLo = pos;
    pos += clen;
  }
  if (runLo >= 0) raw(runLo, pos);
  if (color) enc(bro.resetSGR(cur));
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

//  ---- the pager state machine ----------------------------------------------
//  A View = { hunks, path, rows(cached per width+wrap), scroll }.  `opts.open`
//  (path -> hunks|null) is the ONE fs door: follow, `:`-path and refresh all use it.
function Pager(fd, opts) {
  this.fd = fd;
  this.color = opts && opts.color !== undefined ? opts.color : true;
  this.open = opts && opts.open;                 // (path) -> hunks | null
  this.view = null;                              // { hunks, path, rows, scroll, cols, wrap, cur }
  this.stack = [];                               // JAB-030: the view BACK-stack
  this.fwd = [];                                 // LITE-023: the FORWARD stack (`d`)
  this.mode = "scroll";                          // "scroll" | "command"
  this.cmd = "";                                 // the path-bar edit buffer
  this.pasting = false;                          // inside a bracketed paste burst
  this.message = "";                             // a transient status note
  this.mouse = true;                             // BRO-005: mouse on (`m` toggles)
  this._paintRows = 0; this._paintCols = 0;      // BRO-045: last painted geometry
  this.quit = false;
}

//  Set the current view from a hunk array.  `path` is what `open` was called with
//  (refresh replays it, a typed relative path resolves on it); default: hunk 0's uri.
Pager.prototype.setHunks = function (hunks, path) {
  const p = path !== undefined ? path
          : hunks && hunks.length ? hunks[0].uri || "" : "";
  //  BRO-014: a view opens NO-WRAP (long lines clamp at the right edge); `W` wraps.
  //  LITE-023: every view carries its OWN cursor — {row, tok}, tok -1 = no active
  //  token (the row's followable tokens are a render-side walk, never stored).
  this.view = { hunks: hunks, path: p, rows: null, scroll: 0, cols: 0, wrap: false,
                cur: { row: 0, tok: -1 } };
};

//  JAB-030: PUSH a fresh view, stacking the current one (a follow / a typed path
//  descends); popView restores the previous one (the back key).
//  LITE-023: a NEW push clears the forward stack — the branch just taken wins.
Pager.prototype.pushView = function (hunks, path) {
  if (this.view) this.stack.push(this.view);
  this.fwd.length = 0;
  this.setHunks(hunks, path);
};
Pager.prototype.popView = function () {
  if (!this.stack.length) { this.message = "(no prev view)"; return false; }
  if (this.view) this.fwd.push(this.view);       // LITE-023: `d` walks back in
  this.view = this.stack.pop();
  this.view.rows = null;                         // re-index for the live width
  return true;
};

//  LITE-023: FORWARD — un-pop a view `-`/`a` backed out of (popView parked it).
Pager.prototype.fwdView = function () {
  if (!this.fwd.length) { this.message = "(no next view)"; return false; }
  if (this.view) this.stack.push(this.view);
  this.view = this.fwd.pop();
  this.view.rows = null;                         // re-index for the live width
  return true;
};

//  The DIRECTORY a typed relative path resolves against: a dir view's own path,
//  else the parent dir of the file on screen.
Pager.prototype._viewDir = function () {
  const v = this.view;
  if (!v) return "";
  const h = v.hunks && v.hunks[0];
  const p = v.path || (h ? h.uri || "" : "");
  return h && h.kind === "dir" ? p : dirOf(p);
};

//  BRO-014: (re)index the view's rows for `cols`, cached by (cols, wrap) — a `w`
//  toggle re-indexes and a resize re-wraps, a scroll does not.
Pager.prototype.rows = function (cols) {
  const v = this.view;
  if (v.rows === null || v.cols !== cols || v.rowWrap !== v.wrap) {
    v.rows = indexAll(v.hunks, cols, v.wrap);
    v.cols = cols;
    v.rowWrap = v.wrap;
  }
  return v.rows;
};

//  ---- LITE-023: the cursor (active line + active token) ---------------------
//  The FOLLOWABLE tokens on a display row, left to right: a visible token with a
//  hidden `U` follower (the click target) or an `F` nav target.  Each entry is
//  {lo, hi} — the visible BYTE span, which is what the wash paints.
Pager.prototype._rowToks = function (r) {
  if (!r || r.banner) return [];
  const text = r.hunk.text, toks = r.hunk.toks;
  if (!toks || !toks.length) return [];
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if ((toks[m] & 0xffffff) <= r.off) lo = m + 1; else hi = m; }
  const out = [];
  for (let ti = lo; ti < toks.length; ti++) {
    const start = ti > 0 ? (toks[ti - 1] & 0xffffff) : 0;
    if (start >= r.end) break;
    const tag = String.fromCharCode(65 + ((toks[ti] >>> 27) & 0x1f));
    if (tag === "U" || tag === "O") continue;    // hidden bytes take no column
    const s = start > r.off ? start : r.off;
    const e = (toks[ti] & 0xffffff) < r.end ? (toks[ti] & 0xffffff) : r.end;
    if (e <= s || text[s] === 0x0a) continue;    // empty / the row terminator
    const next = ti + 1 < toks.length
               ? String.fromCharCode(65 + ((toks[ti + 1] >>> 27) & 0x1f)) : "";
    if (tag === "F" || next === "U") out.push({ lo: s, hi: e });
  }
  return out;
};

//  The active token's byte span on the active row, or {lo:-1,hi:-1} (line only).
Pager.prototype._curSpan = function (r) {
  const c = this.view.cur;
  if (!c || c.tok < 0) return { lo: -1, hi: -1 };
  const ts = this._rowToks(r);
  return c.tok < ts.length ? ts[c.tok] : { lo: -1, hi: -1 };
};

//  The viewport height (the status bar takes the last screen row).
Pager.prototype._viewRows = function () {
  const sz = tty.size(this.fd);
  return (sz.rows > 1 ? sz.rows : 24) - 1;
};

//  The live row index, at the width the last frame painted (the `_followRow`
//  idiom) — key handling runs between frames and must not re-wrap on a guess.
Pager.prototype._rowsNow = function () {
  return this.view.rows || this.rows(this._paintCols || 80);
};

//  Keep the cursor SANE: inside the hunk, inside the viewport (a scroll drags it
//  along at the edge, vim-window style), and its token inside the row.
Pager.prototype._clampCur = function (rows, viewRows) {
  const v = this.view;
  if (!v.cur) v.cur = { row: 0, tok: -1 };
  const c = v.cur;
  const last = rows.length ? rows.length - 1 : 0;
  if (c.row > last) c.row = last;
  if (c.row < v.scroll) c.row = v.scroll;
  else if (c.row > v.scroll + viewRows - 1) c.row = v.scroll + viewRows - 1;
  if (c.row > last) c.row = last;
  if (c.row < 0) c.row = 0;
  if (c.tok >= 0 && c.tok >= this._rowToks(rows[c.row]).length) c.tok = -1;
};

//  A cursor move that walked off-screen SCROLLS the viewport to it (the other
//  way round from _clampCur, which drags the cursor after a scroll).
Pager.prototype._scrollToCur = function (viewRows) {
  const v = this.view, c = v.cur;
  if (c.row < v.scroll) v.scroll = c.row;
  else if (c.row > v.scroll + viewRows - 1) v.scroll = c.row - viewRows + 1;
  if (v.scroll < 0) v.scroll = 0;
};

//  Move the active LINE by `d` rows; the active token drops (a new line's tokens
//  are reached with h/l).
Pager.prototype._moveRow = function (d) {
  const rows = this._rowsNow();
  if (!rows.length) return;
  const c = this.view.cur;
  let row = c.row + d;
  if (row < 0) row = 0;
  if (row > rows.length - 1) row = rows.length - 1;
  c.row = row; c.tok = -1;
  this._scrollToCur(this._viewRows());
};

//  HOP to the next (`d`>0) / previous followable token, CROSSING rows: the next
//  row that has one takes the cursor with it.  No hit anywhere = a note, no move.
Pager.prototype._hopTok = function (d) {
  const rows = this._rowsNow();
  if (!rows.length) return;
  const c = this.view.cur;
  let row = c.row;
  for (let n = 0; n <= rows.length; n++) {
    const ts = this._rowToks(rows[row]);
    //  On the cursor's OWN row step off the active token (or take the first/last
    //  when there is none); every row after that offers its first/last.
    const at = n === 0 && c.tok >= 0 ? c.tok + d : (d > 0 ? 0 : ts.length - 1);
    if (at >= 0 && at < ts.length) {
      c.row = row; c.tok = at;
      this._scrollToCur(this._viewRows());
      return;
    }
    row += d;
    if (row < 0 || row >= rows.length) break;
  }
  this.message = "(no more targets)";
};

//  Paint one frame: the viewport rows[scroll .. scroll+viewRows] + the bottom
//  status/path line, in ONE write (the whole frame) to avoid flicker.
Pager.prototype.render = function () {
  const sz = tty.size(this.fd);
  const rowsN = sz.rows > 1 ? sz.rows : 24;
  const cols = sz.cols > 0 ? sz.cols : 80;
  const viewRows = rowsN - 1;                    // last row = status/path bar
  //  BRO-045: remember the geometry THIS frame paints — the key spin wakes when
  //  tty.size leaves it (there is no signal API to hang a SIGWINCH on).
  this._paintRows = rowsN; this._paintCols = cols;
  const rows = this.rows(cols);
  const v = this.view;
  if (v.scroll > rows.length - 1) v.scroll = Math.max(0, rows.length - 1);
  if (v.scroll < 0) v.scroll = 0;
  //  LITE-023: the cursor rides THIS geometry — a resize/refresh/pop lands it.
  this._clampCur(rows, viewRows);

  //  BRO-011: build the frame as UTF-8 BYTES in a buf — SGR/ASCII via `enc`,
  //  text bytes VERBATIM via `raw` — then ONE write.
  const chunks = [];
  const enc = function (s) { if (s.length) chunks.push(utf8.Encode(s)); };
  enc(CLEAR);
  for (let i = 0; i < viewRows; i++) {
    const ri = v.scroll + i;
    if (ri < rows.length) {
      const r = rows[ri];
      if (r.banner) enc(this._banner(r.hunk, cols));
      else {
        const text = r.hunk.text;
        //  LITE-023: the ACTIVE row alone carries a wash (its own band on a banner).
        const cur = this.color && ri === v.cur.row ? this._curSpan(r) : null;
        emitBody(r.hunk, r.off, r.end, this.color, r.pass, enc,
                 function (lo, hi) { if (hi > lo) chunks.push(text.subarray(lo, hi)); },
                 cur);
      }
    }
    enc("\r\n");
  }
  enc(this._statusLine(rows, v.scroll, viewRows, cols, v.cur));
  let total = 0; for (const c of chunks) total += c.length;
  const b = io.buf(total + 8);
  for (const c of chunks) b.feed(c);
  io.writeAll(this.fd, b);
};

//  A hunk's header line: its URI.  On a tty the pale-yellow BAND — bannerOpen,
//  space-FILL to the width so it spans the row, bannerClose (ESC[0m); plain = text.
Pager.prototype._banner = function (hunk, cols) {
  let line = hunk.uri || "";
  if (line.length > cols) line = line.slice(0, cols);
  if (!this.color) return line;
  const thm = theme.DEFAULT;
  return thm.bannerOpen() + this._fit(line, cols) + thm.bannerClose();
};

//  The bottom line, inverse video and filled to the width: scroll mode = the TOP
//  row's `<path>#L<n>` left + TOP/%/BOT right; command mode = the `: ` buffer.
Pager.prototype._statusLine = function (rows, scroll, viewRows, cols, cur) {
  const open = this.color ? ESC + "[7m" : "";
  const close = this.color ? ESC + "[0m" : "";
  if (this.mode === "command")
    return open + this._fit(": " + this.cmd, cols) + close;
  const r = rows[scroll];
  let left = r ? bro.statusURI(r.hunk, r.banner ? 1 : this._srcLine(r.hunk, r.off)) : "";
  //  LITE-023: an ACTIVE TOKEN names what Enter would open, in place of the #L.
  const tgt = cur ? this._curTarget(rows[cur.row], cur) : "";
  if (tgt) left = tgt;
  if (this.message) left = this.message + "  " + left;
  //  BRO-007: `<pos>  ?: help` RIGHT-aligned, the URI left, the gap padded.
  const right = bro.statusPos(scroll, rows.length, viewRows) + "  ?: help";
  const space = cols - right.length;
  let line;
  if (space < 1) line = right.slice(0, cols);
  else {
    if (left.length > space - 1) left = left.slice(0, space - 1);
    line = left + " ".repeat(space - left.length) + right;
  }
  return open + this._fit(line, cols) + close;
};

//  The 1-based source line a byte offset falls on (count the '\n' before it) —
//  feeds statusURI's `<path>#L<n>`.
Pager.prototype._srcLine = function (hunk, off) {
  let n = 1;
  const t = hunk.text;
  for (let i = 0; i < off && i < t.length; i++) if (t[i] === 0x0a) n++;
  return n;
};

//  Pad/truncate to exactly `cols` so the inverse-video bar fills the row.
Pager.prototype._fit = function (s, cols) {
  if (s.length >= cols) return s.slice(0, cols);
  return s + " ".repeat(cols - s.length);
};

//  ---- open / follow / refresh ----------------------------------------------
//  The ONE fs door: hand `path` to opts.open and PUSH what it yields; a null/empty
//  result (unreadable, empty dir) is a plain-words bar message.
Pager.prototype._openPush = function (path) {
  if (!this.open) { this.message = "(no opener)"; return; }
  let hunks;
  try { hunks = this.open(path); }
  catch (e) { this.message = "cannot open " + path + ": " + String(e); return; }
  if (!hunks || hunks.length === 0) { this.message = "cannot open " + path; return; }
  this.pushView(hunks, path);
};

//  Follow one F TOKEN: a dir listing joins the name to the hunk's OWN path (its
//  rows are relative to the dir it lists).
//  LITE-015: in any other hunk an `F` token IS a file reference — its BYTES go
//  to the door verbatim, which is the one place that resolves anything.
Pager.prototype._follow = function (hunk, name) {
  if (!hunk) { this.message = "(nothing to follow)"; return; }
  this._openPush(hunk.kind === "dir" ? resolvePath(hunk.uri || "", name) : name);
};

//  FOLLOW the entry at display-row `ri` (Enter at the cursor, or a click's row).
Pager.prototype._followRow = function (ri) {
  const rows = this.view.rows || this.rows(80);
  if (!rows.length) return;
  const r = rows[Math.max(0, Math.min(ri, rows.length - 1))];
  if (!r || r.banner) { this.message = "(nothing to follow)"; return; }
  //  A `U` target on the row's FIRST token (a log row's sha8) opens verbatim;
  //  only a dir listing joins its entry name to the hunk's own path.
  const target = this._targetAt(r.hunk, r.off);
  if (target) { this._openPush(target); return; }
  const name = this._uriAt(r.hunk, r.off);
  if (!name) { this.message = "(nothing to follow)"; return; }
  this._follow(r.hunk, name);
};

//  The dir-ENTRY name a byte offset sits in: the token covering `off` iff tagged
//  `F` (buildDirHunk's filename token; a dir's trailing '/' is its own `P`).
Pager.prototype._uriAt = function (hunk, off) {
  const toks = hunk.toks;
  if (!toks || !toks.length) return "";
  let ti = 0;
  while (ti < toks.length && (toks[ti] & 0xffffff) <= off) ti++;
  if (ti >= toks.length) return "";
  if (String.fromCharCode(65 + ((toks[ti] >>> 27) & 0x1f)) !== "F") return "";
  const lo = ti > 0 ? (toks[ti - 1] & 0xffffff) : 0, hi = toks[ti] & 0xffffff;
  return hi > lo ? utf8.Decode(hunk.text.slice(lo, hi)) : "";
};

//  A CLICK TARGET (be's BRO-006 `U` span): a visible token FOLLOWED by a
//  `U`-tagged one whose hidden bytes ARE the target — a log row's sha8 carries
//  the commit it names.  Returns "" when the token under `off` has no target.
Pager.prototype._targetAt = function (hunk, off) {
  const toks = hunk.toks;
  if (!toks || !toks.length) return "";
  let ti = 0;
  while (ti < toks.length && (toks[ti] & 0xffffff) <= off) ti++;
  if (ti + 1 >= toks.length) return "";
  if (String.fromCharCode(65 + ((toks[ti + 1] >>> 27) & 0x1f)) !== "U") return "";
  const lo = toks[ti] & 0xffffff, hi = toks[ti + 1] & 0xffffff;
  return hi > lo ? utf8.Decode(hunk.text.slice(lo, hi)) : "";
};

//  LITE-023: what the ACTIVE TOKEN names — its `U` target, else its `F` bytes;
//  "" when there is no active token (the status bar then keeps the `#L`).
Pager.prototype._curTarget = function (r, cur) {
  if (!r || r.banner || !cur || cur.tok < 0) return "";
  const span = this._curSpan(r);
  if (span.lo < 0) return "";
  return this._targetAt(r.hunk, span.lo) || this._uriAt(r.hunk, span.lo);
};

//  LITE-023: Enter — follow the ACTIVE TOKEN exactly as a click on it would,
//  falling back to the active LINE (the old top-row `_followRow`).
Pager.prototype._followCur = function () {
  const v = this.view;
  const rows = this._rowsNow();
  this._clampCur(rows, this._viewRows());
  const r = rows[v.cur.row];
  if (r && !r.banner && v.cur.tok >= 0) {
    const span = this._curSpan(r);
    if (span.lo >= 0) {
      const target = this._targetAt(r.hunk, span.lo);
      if (target) { this._openPush(target); return; }
      const name = this._uriAt(r.hunk, span.lo);
      if (name) { this._follow(r.hunk, name); return; }
    }
  }
  this._followRow(v.cur.row);
};

//  REFRESH — re-`open` the view's path and swap the hunks IN PLACE (no push, no
//  stack entry), keeping the scroll pos; render() clamps a now-shorter one.
Pager.prototype._refresh = function () {
  const v = this.view;
  if (!v || !v.path || !this.open) { this.message = "(nothing to refresh)"; return; }
  const scroll = v.scroll;
  let hunks;
  try { hunks = this.open(v.path); }
  catch (e) { this.message = "cannot open " + v.path + ": " + String(e); return; }
  if (!hunks || hunks.length === 0) { this.message = "cannot open " + v.path; return; }
  v.hunks = hunks; v.rows = null; v.scroll = scroll;   // re-index, keep the pos
  this.message = "refreshed";
};

//  BRO-007: `h` — SHORTCUTS as a plain (tok-less) hunk, pushed like any other
//  view so `-`/BS backs out of it.  One table, no drift.
Pager.prototype._help = function () {
  let text = "";
  for (const s of SHORTCUTS) {
    const key = s[0].length >= 12 ? s[0] + " " : s[0] + " ".repeat(12 - s[0].length);
    text += key + s[1] + "\n";
  }
  this.pushView([{ uri: "help", verb: "hunk", text: utf8.Encode(text),
                   toks: new Uint32Array(0), kind: "help" }], "");
};

//  ---- key handling ----------------------------------------------------------
//  One keypress drives the state machine; sets this.quit to exit.
Pager.prototype.key = function (b) {
  if (this.mode === "command") return this._keyCommand(b);
  return this._keyScroll(b);
};

Pager.prototype._page = function () {
  const sz = tty.size(this.fd);
  return (sz.rows > 2 ? sz.rows : 24) - 2;       // a near-full page (keep 1 row)
};

Pager.prototype._keyScroll = function (b) {
  const v = this.view;
  this.message = "";
  //  LITE-023: every key acts on a cursor that is inside the LIVE geometry.
  this._clampCur(this._rowsNow(), this._viewRows());
  switch (b) {
    case 0x71: this.quit = true; break;                 // q
    //  LITE-023 scheme B: vim keys drive the CURSOR, asdw scrolls + walks views.
    case 0x6a: this._moveRow(1); break;                 // j  active line down
    case 0x6b: this._moveRow(-1); break;                // k  active line up
    case 0x6c: this._hopTok(1); break;                  // l  next token
    case 0x68: this._hopTok(-1); break;                 // h  prev token
    case 0x77: v.scroll -= 1; break;                    // w  scroll up
    case 0x73: v.scroll += 1; break;                    // s  scroll down
    case 0x61: this.popView(); break;                   // a  back
    case 0x64: this.fwdView(); break;                   // d  forward
    case 0x20: v.scroll += this._page(); break;         // space  page down
    case 0x62: v.scroll -= this._page(); break;         // b      page up
    case 0x67: v.scroll = 0; break;                     // g  top
    case 0x47: v.scroll = 1 << 30; break;               // G  bottom (clamped)
    //  BRO-005: `m` toggles SGR mouse tracking, writing the enable/disable
    //  bracket to the tty so the terminal stops/starts reporting.
    case 0x6d: this._toggleMouse(); break;              // m  mouse on/off
    case 0x3a: this.mode = "command"; this.cmd = ""; break;          // :  path bar
    //  Enter follows the ACTIVE TOKEN, else the active line (a click takes it too).
    case 0x0d: case 0x0a: this._followCur(); break;                  // Enter
    //  JAB-030: BACK POPS the view stack (a follow/typed path pushed it); popView
    //  re-indexes for the live width, the saved hunks stand.
    case 0x2d: case 0x7f: case 0x08: this.popView(); break;          // - / BS
    case 0x52: case 0x72: this._refresh(); break;                    // R/r refresh
    //  BRO-014: `W` flips THIS view no-wrap (the open default) ↔ soft-wrap (rows()
    //  re-indexes on the new cache key).  Per-view only — no persisted setting.
    case 0x57: v.wrap = !v.wrap; break;                              // W  toggle
    case 0x3f: this._help(); break;                                  // ?  help
    default: break;
  }
};

Pager.prototype._keyCommand = function (b) {
  if (b === 0x0d || b === 0x0a) {                        // Enter: open the path
    const cmd = this.cmd;
    this.mode = "scroll";
    this.cmd = "";
    this._applyPath(cmd);
    return;
  }
  if (b === 0x1b) { this.mode = "scroll"; this.cmd = ""; return; }   // Esc: cancel
  if (b === 0x7f || b === 0x08) {                        // Backspace
    if (this.cmd.length) this.cmd = this.cmd.slice(0, -1);
    else this.mode = "scroll";
    return;
  }
  if (b >= 0x20 && b < 0x7f) this.cmd += String.fromCharCode(b);     // printable
};

//  The `:` bar takes `q`/`quit` (leave the TUI) or a PATH — absolute as-is, `./x`,
//  `../x` or a bare name against the view's dir.  No verbs, no spells.
Pager.prototype._applyPath = function (cmd) {
  const s = (cmd || "").trim();
  if (!s) return;
  if (s === "q" || s === "quit") { this.quit = true; return; }
  this._openPush(resolvePath(this._viewDir(), s));
};

//  ---- input feed -------------------------------------------------------------
//  JAB-030: feed a whole input buffer, splitting SGR mouse + paste escapes from
//  keys.  An UNFINISHED tail escape is left for the next read (it can straddle).
Pager.prototype._feed = function (data) {
  let i = 0;
  while (i < data.length && !this.quit) {
    //  Inside a bracketed paste: swallow the payload into the path bar until the
    //  ESC[201~ marker, so a pasted newline/ESC no longer submits/cancels it.
    if (this.pasting) {
      if (data[i] === 0x1b) {
        const e = _matchSeq(data, i, PASTE_END);
        if (e < 0) return i;                     // end marker straddles the read
        if (e > 0) { this.pasting = false; i += e; continue; }
        i++; continue;                           // a stray ESC in content: drop it
      }
      if (data[i] >= 0x20 && data[i] !== 0x7f && this.mode === "command")
        this.cmd += String.fromCharCode(data[i]);   // a printable/UTF-8 paste byte
      i++;
      continue;
    }
    //  A mouse report opens with ESC '[' '<' ; scan to its M|m terminator.
    if (data[i] === 0x1b && i + 2 < data.length &&
        data[i + 1] === 0x5b && data[i + 2] === 0x3c) {
      let j = i + 3;
      while (j < data.length && data[j] !== 0x4d && data[j] !== 0x6d) j++;
      if (j >= data.length) return i;            // incomplete: wait for more
      let seq = "";
      for (let k = i + 3; k < j; k++) seq += String.fromCharCode(data[k]);
      this._mouse(seq, data[j] === 0x4d);
      i = j + 1;
      continue;
    }
    //  Bracketed-paste BEGIN (ESC[200~): probe only once ESC '[' '2' are all
    //  present, so a lone Esc keypress still falls through to key() and cancels.
    if (data[i] === 0x1b && i + 2 < data.length &&
        data[i + 1] === 0x5b && data[i + 2] === 0x32) {
      const b = _matchSeq(data, i, PASTE_BEG);
      if (b < 0) return i;                       // begin marker straddles the read
      if (b > 0) { this.pasting = true; i += b; continue; }
      //  ESC[2 but not ESC[200~ (e.g. Insert = ESC[2~): fall through to key().
    }
    this.key(data[i]);
    i++;
  }
  return i;
};

//  BRO-005: one SGR mouse report `<b;col;row>` (press iff terminator 'M').  WHEEL
//  (bit 64) scrolls 3; a plain LEFT PRESS opens the dir entry under the cursor.
Pager.prototype._mouse = function (seq, press) {
  if (!this.mouse) return;
  const f = seq.split(";");
  const b = f[0] | 0, col = f[1] | 0, row = f[2] | 0;
  if ((b & 64) !== 0) {                           // wheel: button 64 up / 65 dn
    if (!press) return;
    this.view.scroll += (b & 1) ? 3 : -3;         // 65 down, 64 up (C step = 3)
    return;
  }
  if (!press) return;
  if ((b & 0x23) !== 0) return;                  // not a plain left press (drag/btn)
  const hit = this._screenToByte(row, col);
  //  LITE-023: the click SETS the cursor first — the row it landed on and the
  //  followable token under the cell (none = line only) — then follows as before.
  const rows = this._rowsNow(), ri = this.view.scroll + (row - 1);
  if (ri >= 0 && ri < rows.length) {
    const c = this.view.cur;
    c.row = ri; c.tok = -1;
    if (hit) {
      const ts = this._rowToks(rows[ri]);
      for (let i = 0; i < ts.length; i++)
        if (hit.off >= ts[i].lo && hit.off < ts[i].hi) { c.tok = i; break; }
    }
  }
  if (hit) {
    const target = this._targetAt(hit.hunk, hit.off);   // a `U` click-target
    if (target) { this._openPush(target); return; }
    const name = this._uriAt(hit.hunk, hit.off);
    if (name) { this._follow(hit.hunk, name); return; }
  }
  this._followRow(this.view.scroll + (row - 1));   // 1-based screen row → index
};

//  BRO-005: map a 1-based screen (row, col) to the {hunk, off} under it — paintRow's
//  walk, U/O skipped so `col` counts EMITTED cells; null for banner/blank/past-EOL.
Pager.prototype._screenToByte = function (row, col) {
  if (row < 1 || col < 1) return null;
  const rows = this.view.rows || this.rows(80);
  const ri = this.view.scroll + (row - 1);
  if (ri < 0 || ri >= rows.length) return null;
  const r = rows[ri];
  if (r.banner) return null;                     // headers carry no entry
  const hunk = r.hunk, text = hunk.text, toks = hunk.toks;
  let ti = 0;
  while (ti < toks.length && (toks[ti] & 0xffffff) <= r.off) ti++;
  let cp = 1, pos = r.off;
  while (pos < r.end) {
    while (ti < toks.length && (toks[ti] & 0xffffff) <= pos) ti++;
    const tag = ti < toks.length ? String.fromCharCode(65 + ((toks[ti] >>> 27) & 0x1f)) : "S";
    let clen = UTF8_LEN[text[pos] >> 4];
    if (clen === 0 || pos + clen > r.end) clen = 1;
    if (tag !== "U" && tag !== "O") {             // hidden cells take no column
      if (cp === col) return { hunk: hunk, off: pos };
      cp++;
    }
    pos += clen;
  }
  return null;
};

//  BRO-005: flip mouse tracking, writing the enable/disable bracket to the tty.
Pager.prototype._toggleMouse = function () {
  this.mouse = !this.mouse;
  if (this.fd >= 0) ttyWrite(this.fd, this.mouse ? MOUSE_ON : MOUSE_OFF);
  this.message = "mouse: " + (this.mouse ? "on" : "off");
};

//  BRO-045: changed size since the LAST PAINTED frame?  Both axes count — cols
//  re-wraps, rows alone still moves viewRows + the status bar.
Pager.prototype._resized = function () {
  const sz = tty.size(this.fd);
  return (sz.rows > 1 ? sz.rows : 24) !== this._paintRows ||
         (sz.cols > 0 ? sz.cols : 80) !== this._paintCols;
};

//  ---- the run loop ----------------------------------------------------------
//  Raw mode, paint, block-poll a key, repaint — until q.  cook + restore cursor
//  and mouse on EVERY exit path (try/finally) so a throw never wedges the tty.
Pager.prototype.run = function () {
  this._saved = tty.raw(this.fd);
  //  BRO-027: ALT_ON first — the whole raw-mode session lives on the alt screen.
  ttyWrite(this.fd, ALT_ON + HIDE_CUR + MOUSE_ON + PASTE_ON);
  try {
    const rb = io.buf(64);
    let pend = null;                             // a straddling escape tail
    while (!this.quit) {
      this.render();
      //  Block on a key: VMIN=0 VTIME=1 means io.read returns 0 on a 100ms
      //  timeout, so spin until a byte arrives (portable, no platform poll).
      let n = 0;
      while (n === 0 && !this.quit) {
        n = io.read(this.fd, rb);
        if (n !== 0) break;
        //  BRO-045: a RESIZE repaints without a key — one ioctl per 100ms
        //  io.read timeout, never per inner pass.
        if (this._resized()) break;
      }
      //  Prepend any unfinished tail from the previous read, then feed; carry a
      //  still-unfinished escape forward (a click can straddle reads).
      let data = rb.data();
      if (pend) { const m = new Uint8Array(pend.length + data.length);
        m.set(pend, 0); m.set(data, pend.length); data = m; pend = null; }
      const used = this._feed(data);
      if (used < data.length) pend = data.slice(used);
      rb.reset();
    }
  } finally {
    //  BRO-027: ALT_OFF last restores the pre-pager screen (no CLEAR needed).
    ttyWrite(this.fd, MOUSE_OFF + PASTE_OFF + ESC + "[0m" + SHOW_CUR + ALT_OFF);
    tty.cook(this.fd, this._saved);
    this._saved = null;
  }
};

module.exports = {
  Pager: Pager,
  indexAll: indexAll,
  paintRow: paintRow,
  SHORTCUTS: SHORTCUTS,        // BRO-007: single-sourced for the `h` help view
};
