//  bee/test/elastic/board.js — BEE-030: the elastic `B` field, headless over
//  the REAL board hunks (view/todo.js) and the real row/paint/click machinery
//  (render/wrap.js, render/ansi.js, pager.js) plus the html twin.  At COLS a
//  cut row and a pad row must both come out exactly COLS cells wide with the
//  [BEE-027] frames flush right; soft-wrap and the NO_CLAMP (piped) index must
//  carry no elastic at all.  Driven by run.sh with $SRC_ROOT on the fixture.
"use strict";

const todo = require("view/todo.js");
const wrap = require("render/wrap.js");
const ansi = require("render/ansi.js");
const html = require("render/html.js");
const pager = require("pager.js");
const wtstat = require("view/wtstat.js");
const theme = require("render/theme.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const SRC = io.getenv("SRC_ROOT");
const ALPHA = SRC + "/alpha";
const COLS = 72;
//  BEE-043: the ticket-state panel now CLOSES an open row, so the flush-right
//  region is the two [BEE-027] frames plus it (view/todo.js:523:TO doneCells).
const PANEL = " [" + theme.BTN_FACE.done + " " + theme.BTN_FACE.dont + "]";

const v = todo.todo("", { from: ALPHA });
const h = v.hunks[0];

//  The display row a key's bytes fall on, in a no-wrap index at `cols`.
function hasBytes(r, kb) {
  for (let p = r.off; p + kb.length <= r.end; p++) {
    let m = true;
    for (let i = 0; i < kb.length; i++) if (h.text[p + i] !== kb[i]) { m = false; break; }
    if (m) return true;
  }
  return false;
}
function rowOf(rows, key) {
  const kb = utf8.Encode(key);
  for (const r of rows) if (hasBytes(r, kb)) return r;
  return null;
}

//  The painted row as visible codepoints (color OFF: no SGR to strip).
function painted(r) {
  return ansi.paintRow(h, r.off, r.end, false, r.pass, null, r.els);
}

//  --- 1. the producer tags the title `B` -------------------------------------
let hasB = false;
for (let i = 0; i < h.toks.length; i++)
  if (((h.toks[i] >>> 27) & 0x1f) === 1) hasB = true;   // 'B' = A+1
check("the-title-is-a-B-span", hasB);

//  --- 2. the …-cut: a long row comes out exactly COLS wide, frames visible ---
const rows = wrap.indexRows(h, COLS, false);
const frames1 = wtstat.frames(SRC + "/alpha-GET-001");
const cut = rowOf(rows, "GET-001");
check("cut-row-found", cut !== null);
if (cut !== null) {
  const s = painted(cut);
  check("cut-row-is-cols-wide", s.length === COLS, s.length + " |" + s + "|");
  check("cut-row-wears-the-ellipsis", s.indexOf("…") >= 0, s);
  check("cut-row-keeps-the-frames-flush-right",
        s.endsWith(frames1.file + " " + frames1.commit + PANEL), "|" + s + "|");
  check("cut-row-spans-the-whole-line",
        cut.end === h.text.length || h.text[cut.end] === 0x0a, cut.end);
}

//  --- 3. the pad: a short row fills to COLS, dotted leader, no frames --------
const padr = rowOf(rows, "GET-002");
check("pad-row-found", padr !== null);
if (padr !== null) {
  const s = painted(padr);
  check("pad-row-is-cols-wide", s.length === COLS, s.length + " |" + s + "|");
  check("pad-row-wears-the-leader", s.indexOf("┄") >= 0, s);
  check("pad-row-keeps-the-title", s.indexOf("tiny") >= 0, s);
}

//  --- 4. a ZERO-WIDTH B (bare-key title) still pads, frames flush right ------
const frames3 = wtstat.frames(SRC + "/alpha-GET-003");
const zero = rowOf(rows, "GET-003");
check("zero-row-found", zero !== null);
if (zero !== null) {
  const s = painted(zero);
  check("zero-row-is-cols-wide", s.length === COLS, s.length + " |" + s + "|");
  check("zero-row-keeps-the-frames-flush-right",
        s.endsWith(frames3.file + " " + frames3.commit + PANEL), "|" + s + "|");
}

//  --- 5. soft-wrap and the unclamped (piped) index never stretch -------------
let softEls = false;
for (const r of wrap.indexRows(h, COLS, true)) if (r.els) softEls = true;
check("soft-wrap-carries-no-els", !softEls);
let pipeEls = false;
for (const r of wrap.indexRows(h, wrap.NO_CLAMP, false)) if (r.els) pipeEls = true;
check("an-unclamped-index-carries-no-els", !pipeEls);
const plain = utf8.Decode(h.plain);
check("plain-keeps-the-full-title-unpadded",
      plain.indexOf("wide margin") >= 0 && plain.indexOf("┄") < 0 &&
      plain.indexOf("…") < 0, plain);

//  --- 6. the flush-right frames carry no region nav of their own -------------
const p = new pager.Pager(-1, { color: false });
p.setHunks(v.hunks);
const prows = p.rows(COLS);
let ri = -1;
for (let i = 0; i < prows.length; i++)
  if (!prows[i].banner && cut !== null && prows[i].off === cut.off) ri = i;
check("cut-row-sits-in-the-pager-index", ri >= 0, ri);
if (ri >= 0) {
  const hit = p._screenToByte(ri + 1, COLS);     // the frames' last `]` cell
  check("the-last-cell-is-a-byte-again", hit !== null);
  if (hit !== null) {
    //  BEE-042: the COMMIT frame's `list <wt>/` U retired with the panel that
    //  replaced it — the last cell is a bracket and names nothing of its own.
    const spell = p._targetAt(hit.hunk, hit.off);
    check("the-frames-carry-no-list-target",
          !spell && !p._spellAt(hit.hunk, hit.off), spell);
  }
  //  A cell inside the …-cut span maps to the CUT byte, never past the row.
  const mid = p._screenToByte(ri + 1, 30);
  check("a-title-cell-still-maps-into-the-row",
        mid === null || (cut !== null && mid.off >= cut.off && mid.off < cut.end),
        mid === null ? "null" : mid.off);
}

//  --- 7. the html twin: a flex `.row`, the `B` span wears `.els` -------------
const page = utf8.Decode(html.render(v.hunks, {}));
check("html-wraps-a-B-line-in-a-flex-row", page.indexOf('class="row"') >= 0);
check("html-marks-the-elastic-span", page.indexOf("els") >= 0 &&
      page.indexOf('tok-B') >= 0, page.slice(0, 400));
check("html-stylesheet-stretches-els",
      page.indexOf(".row{display:flex") >= 0 && page.indexOf("text-overflow:ellipsis") >= 0);

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
