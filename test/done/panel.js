//  bee/test/done/panel.js — BEE-043: the trailing ticket-state panel, headless
//  over the REAL board hunks (view/todo.js) and the real click machinery
//  (pager.js, act.js).  Every OPEN row must wear ONE frame with TWO live faces
//  minting the CONTEXT-LESS `done KEY` / `dont KEY` spells; a row a `Now:`
//  filter shows CLOSED wears none; plain carries no panel byte at all; and a
//  real ` ✓` click must flip the page and drop the row in place.
"use strict";

const todo = require("view/todo.js");
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");
const plainlib = require("render/plain.js");
const pagerlib = require("pager.js");
const act = require("act.js");
const door = require("door.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

const SRC = io.getenv("SRC_ROOT");
const BETA = SRC + "/beta";
const FACE = theme.BTN_FACE;
const FRAME = "[" + FACE.done + " " + FACE.dont + "]";      // be's PANELW, 7 cols
const COLS = 110;

function board(arg) { return todo.todo(arg === undefined ? "GET" : arg, { from: BETA }); }

//  A hunk -> its spans as { tag, text, lo, hi } (test/cpanel/cpanel.js:36:0k).
function spansOf(h) {
  const out = [];
  let lo = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const hi = h.toks[i] & 0xffffff;
    out.push({ tag: String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f)),
               text: utf8.Decode(h.text.slice(lo, hi)), lo: lo, hi: hi });
    lo = hi;
  }
  return out;
}
function rowsOf(h) {
  const rows = [];
  let cur = [];
  for (const s of spansOf(h)) {
    cur.push(s);
    if (s.text.indexOf("\n") >= 0) { rows.push(cur); cur = []; }
  }
  if (cur.length) rows.push(cur);
  return rows;
}
function rowSpans(h, key) {
  for (const r of rowsOf(h))
    for (const s of r) if (s.tag === "F" && s.text.indexOf(key) === 0) return r;
  return [];
}
//  The LAST bracket pair of a row: the ticket panel closes the row, whatever
//  frames a worktree put before it.
function panelSpans(sp) {
  let open = -1, close = -1;
  for (let i = 0; i < sp.length; i++) {
    if (sp[i].tag !== "D") continue;
    if (sp[i].text === "[") open = i;
    else if (sp[i].text === "]") close = i;
  }
  return (open < 0 || close < open) ? [] : sp.slice(open, close + 1);
}
function buttonsOf(sp) {
  const out = [];
  for (let i = 0; i + 1 < sp.length; i++) {
    if (sp[i + 1].tag !== "O") continue;
    out.push({ face: sp[i].text, tag: sp[i].tag, o: sp[i + 1].text,
               spell: wrap.oSpell(sp[i + 1].text), look: wrap.oLook(sp[i + 1].text),
               lo: sp[i].lo });
  }
  return out;
}
function byFace(bs, face) {
  for (const b of bs) if (b.face === face) return b;
  return null;
}
function frameText(sp) {
  return sp.filter(function (s) { return s.tag !== "O"; })
           .map(function (s) { return s.text; }).join("");
}
function panel(h, key) {
  const sp = panelSpans(rowSpans(h, key));
  return { sp: sp, btn: buttonsOf(sp), text: frameText(sp) };
}
//  A LIT button: the face on its own class tag, the tone over the derived wash,
//  and the spell it runs (render/theme.js:110:4o, render/wrap.js:52:ge).
function lit(bs, face, name, spell) {
  const b = byFace(bs, face);
  check("the `" + face + "` face is a button", b !== null, JSON.stringify(bs));
  if (b === null) return;
  check("...on its class tag, never grey",
        b.tag === theme.BTN_TAG[name] && "DPQ".indexOf(b.tag) < 0, b.tag);
  check("...wearing the tone over its wash",
        b.look !== null && b.look.fg === theme.BTN[name] &&
        b.look.bg === theme.pale(theme.BTN[name]), JSON.stringify(b.look));
  check("...and spelling `" + spell + "`", b.spell === spell, b.spell);
}

const h = board().hunks[0];

//  ---- 1. every OPEN row wears the frame, wt or none ------------------------
const OPEN = ["GET-001", "GET-002", "GET-004", "GET-005", "GET-007",
              "GET-008", "GET-009"];
for (const key of OPEN) {
  const p = panel(h, key);
  check(key + " wears the `" + FRAME + "` panel", p.text === FRAME, p.text);
  check("...its two faces and nothing else", p.btn.length === 2,
        JSON.stringify(p.btn.map(function (b) { return b.face; })));
}
lit(panel(h, "GET-001").btn, FACE.done, "done", "done GET-001");
lit(panel(h, "GET-001").btn, FACE.dont, "dont", "dont GET-001");
//  A ROW WITH A WORKTREE keeps both [BEE-041/042] frames — the ticket panel is
//  appended, never a replacement, and it stands LAST.
const wtRow = rowSpans(h, "GET-005");
check("a wt row still carries all THREE frames, the ticket panel last",
      frameText(wtRow).indexOf("[ i ") >= 0 && frameText(wtRow).indexOf("[ ≡ ") >= 0 &&
      frameText(wtRow).indexOf(FRAME + "\n") >= 0, frameText(wtRow));

//  ---- 2. the spells are CONTEXT-LESS mutations -----------------------------
const dn = byFace(panel(h, "GET-005").btn, FACE.done);
check("the ` ✓` spell is a MUTATION act.js owns", dn !== null && act.actOf(dn.spell) !== null,
      dn === null ? "no button" : dn.spell);
check("...and carries NO `//name` context — the KEY is the whole argument",
      dn !== null && act.ctxOf(dn.spell) === null, dn === null ? "no button" : dn.spell);
check("...the arg being exactly the row's key",
      dn !== null && act.wordsOf(dn.spell.slice("done ".length)).join("|") === "GET-005",
      dn === null ? "no button" : dn.spell);

//  ---- 3. a CLOSED row wears no panel at all --------------------------------
const hc = board("GET Now:DONE").hunks[0];
const cl = panel(hc, "GET-003");
check("a row a `Now:` filter shows CLOSED wears no panel", cl.btn.length === 0, cl.text);
let anyDone = false;
for (const s of spansOf(hc))
  if (s.tag === "O" && String(wrap.oSpell(s.text)).indexOf("done ") === 0) anyDone = true;
check("...so a closed listing mints no closing spell at all", !anyDone, "a done spell");

//  ---- 4. plain stays chrome-free -------------------------------------------
const pl = utf8.Decode(h.plain);
check("plain carries no panel byte", pl.indexOf(FACE.done.trim()) < 0 &&
      pl.indexOf(FACE.dont.trim()) < 0 && pl.indexOf("\x1b") < 0, pl);
check("...a wt-less plain row still ends on its own title",
      pl.indexOf("GET-001: flip me\n") >= 0, pl);
check("the plain SINK says the same",
      utf8.Decode(plainlib.render([h])) === pl, "sink differs");

//  ---- 5. the click: the page flips and the row goes, in place --------------
let opens = 0;
function open(path, from) { opens++; return door.openTarget(path, from); }
//  The screen cell a spell sits on, asked of the pager itself — no column
//  arithmetic, so an elastic title cannot move the click off the face.
function cellOf(pg, spell) {
  const rows = pg.rows(COLS);
  for (let i = 0; i < rows.length; i++)
    for (let c = 1; c <= COLS; c++) {
      const hit = pg._screenToByte(i + 1, c);
      if (hit !== null && pg._spellAt(hit.hunk, hit.off) === spell)
        return { row: i + 1, col: c };
    }
  return null;
}
const p = new pagerlib.Pager(-1, { tty: -1, color: false, open: open });
p.setHunks(board().hunks, "todo GET");
p.view.from = BETA;
const cell = cellOf(p, "done GET-009");
check("the ` ✓` button has a screen cell of its own", cell !== null, JSON.stringify(cell));
if (cell !== null) {
  const was = opens;
  p._mouse("0;" + cell.col + ";" + cell.row, true);
  check("the click RAN `done` and reported the key and its title",
        String(p.message).indexOf("GET-009") === 0 &&
        String(p.message).indexOf("clicked shut") > 0, p.message);
  check("...pushing nothing", p.stack.length === 0, "stack " + p.stack.length);
  check("...re-opening the board in place", opens === was + 1, "opens " + opens);
  check("...and the row is GONE — the open filter reads `Now:`",
        rowSpans(p.view.hunks[0], "GET-009").length === 0,
        utf8.Decode(p.view.hunks[0].plain));
  check("...while every other row kept its panel",
        panel(p.view.hunks[0], "GET-001").text === FRAME, "the panel went");
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
