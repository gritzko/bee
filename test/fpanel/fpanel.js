//  bee/test/fpanel/fpanel.js — BEE-041: the FILE PANEL a board row wears,
//  headless over the REAL board hunks (view/todo.js) and the real click
//  machinery (pager.js, act.js).  Two fixture worktrees carry the two states
//  the panel must tell apart: one with work left to stage (three LIT buttons)
//  and one wholly staged (one INFO count, no click).  The plain bytes must be
//  what they were before the buttons landed — the panel is paint and clicks,
//  never text.
"use strict";

const todo = require("view/todo.js");
const wtstat = require("view/wtstat.js");
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");
const plain = require("render/plain.js");
const pagerlib = require("pager.js");
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
const ALPHA = SRC + "/alpha";
const DIRTY = "alpha-GET-001", STAGED = "alpha-GET-002";
const MIXED = "alpha-GET-003";                   // BEE-039 rev: one class, both axes
const COLS = 100;

function board() { return todo.todo("GET", { from: ALPHA }); }

//  A hunk -> its spans as { tag, text, lo, hi }, the one walk every check reads.
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
//  The spans of the ROW a ticket key sits on — the board is one hunk, so a row
//  is the byte range between its two newlines.
function rowSpans(h, key) {
  const text = utf8.Decode(h.text);
  const at = text.indexOf(key);
  if (at < 0) return [];
  const lo = text.lastIndexOf("\n", at) + 1, hi = text.indexOf("\n", at);
  return spansOf(h).filter(function (s) { return s.lo >= lo && s.hi <= (hi < 0 ? h.text.length : hi); });
}
//  A row's BUTTONS: every visible span whose follower is an `O` (BEE-034's
//  face + hidden spell pair), with the look and the spell split out.
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
//  The FILE frame's own spans — `[` through the `]` that closes it, so a check
//  on the panel never reads the row's lead or the commit frame beside it.
function frameSpans(sp) {
  const lo = sp.findIndex(function (s) { return s.tag === "D" && s.text === "["; });
  if (lo < 0) return [];
  for (let i = lo; i < sp.length; i++)
    if (sp[i].tag === "D" && sp[i].text === "]") return sp.slice(lo, i + 1);
  return [];
}
//  A LIT button: the face on its own class tag, the tone over the derived wash,
//  and a spell to run (theme.js:110:4o, render/wrap.js:52:ge).
function lit(bs, face, name, spell) {
  const b = byFace(bs, face);
  check("the `" + face + "` face is a button", b !== null,
        bs.map(function (x) { return x.face; }).join("|"));
  if (b === null) return;
  check("...on its class tag, never grey",
        b.tag === theme.BTN_TAG[name] && "DPQ".indexOf(b.tag) < 0, b.tag);
  check("...wearing the tone over its wash",
        b.look !== null && b.look.fg === theme.BTN[name] &&
        b.look.bg === theme.pale(theme.BTN[name]), JSON.stringify(b.look));
  check("...and spelling `" + spell + "`", b.spell === spell, b.spell);
}

//  ---- 1. a worktree with work left to stage lights the class buttons -------
const v = board();
const h = v.hunks[0];
//  BEE-042: the counts below are the FILE frame's own — the row carries the
//  COMMIT panel's buttons too, and neither frame may count the other's.
const dirty = frameSpans(rowSpans(h, "GET-001")), dbtn = buttonsOf(dirty);
lit(dbtn, theme.BTN_FACE.status, "status", "status //" + DIRTY);
lit(dbtn, "~1", "chg", "//" + DIRTY + " add");
lit(dbtn, "-1", "del", "//" + DIRTY + " rm");
lit(dbtn, "+1", "add", "//" + DIRTY + " add +");
check("the panel mints exactly the four faces", dbtn.length === 4,
      dbtn.map(function (x) { return x.face; }).join("|"));
//  The frame DELIMITS its own columns: an empty slot is spaces, not a leader.
const dtext = dirty.map(function (s) { return s.tag === "O" ? "" : s.text; }).join("");
const brackets = dtext.slice(dtext.indexOf("["));
check("nothing inside the brackets is ┄-filled", brackets.indexOf("┄") < 0, brackets);
check("the last slot stays blank (held for the run button)",
      /\+1 {3}\]/.test(brackets), brackets);

//  ---- 2. a wholly staged class is INFO, an empty one blanks ----------------
const st = frameSpans(rowSpans(h, "GET-002")), sbtn = buttonsOf(st);
lit(sbtn, theme.BTN_FACE.status, "status", "status //" + STAGED);
const info = byFace(sbtn, "~1");
check("a wholly staged count still shows", info !== null,
      sbtn.map(function (x) { return x.face; }).join("|"));
if (info !== null) {
  check("...in its class colour with NO wash",
        info.look !== null && info.look.fg === theme.BTN.chg && info.look.bg === "",
        JSON.stringify(info.look));
  check("...and NO spell — the click falls through to the row",
        info.spell === "", info.spell);
}
check("an empty class mints no button at all", sbtn.length === 2,
      sbtn.map(function (x) { return x.face; }).join("|"));
const sblank = st.filter(function (s) { return s.text === "  " && s.tag === "S"; });
check("...it is three plain blank cells (del, add, the run slot)",
      sblank.length === 3, String(sblank.length));
check("the staged frame reads as it always did",
      st.filter(function (s) { return s.tag !== "O"; })
        .map(function (s) { return s.text; }).join("") === "[ i ~1         ]",
      st.map(function (s) { return s.text; }).join(""));

//  ---- 2b. a class split over both axes counts BOTH (BEE-039 revised) ------
//  The slot says HOW MANY rows the class holds, staged or not; the wash says
//  whether a button still has work — a.txt is staged, b.txt is not.
const mx = frameSpans(rowSpans(h, "GET-003")), mbtn = buttonsOf(mx);
lit(mbtn, "~2", "chg", "//" + MIXED + " add");
check("a mixed class counts the staged row too",
      mx.filter(function (s) { return s.tag !== "O"; })
        .map(function (s) { return s.text; }).join("") === "[ i ~2         ]",
      mx.map(function (s) { return s.text; }).join(""));

//  ---- 3. every cell of a face clicks --------------------------------------
const p0 = new pagerlib.Pager(-1, { tty: -1, color: false });
const chg = byFace(dbtn, "~1");
if (chg !== null)
  check("both cells of a count face run the same spell",
        p0._spellAt(h, chg.lo) === "//" + DIRTY + " add" &&
        p0._spellAt(h, chg.lo + 1) === "//" + DIRTY + " add",
        p0._spellAt(h, chg.lo) + " | " + p0._spellAt(h, chg.lo + 1));
//  BEE-041: the region-wide `list <wt>/` U is retired from the FILE frame — a
//  click outside a face falls to the row's own nav, not to a listing.
const brk = dirty.filter(function (s) { return s.text === "[" && s.tag === "D"; })[0];
check("the file frame carries no `list` target of its own",
      brk !== undefined && !p0._targetAt(h, brk.lo) && !p0._spellAt(h, brk.lo),
      brk === undefined ? "no bracket" : p0._targetAt(h, brk.lo));

//  ---- 4. plain and the pipe are what they were before the buttons ----------
const GOLD = "GET-001: dirty tree [ i ~1 -1 +1   ] [ ≡         ]\n" +
             "GET-002: all staged [ i ~1         ] [ ≡        ✓]\n" +
             "GET-003: mixed class [ i ~2         ] [ ≡        ✓]\n";
const pl = utf8.Decode(h.plain);
check("plain is the pre-button golden, byte for byte", pl === GOLD, pl);
check("...with no look byte and no SGR",
      pl.indexOf("#") < 0 && pl.indexOf("\x1b") < 0, pl);
check("the plain SINK says the same", utf8.Decode(plain.render(v.hunks)) === GOLD,
      utf8.Decode(plain.render(v.hunks)));
check("the frames are still the wtstat strings",
      wtstat.frames(SRC + "/" + DIRTY).file === "[ i ~1 -1 +1   ]",
      wtstat.frames(SRC + "/" + DIRTY).file);

//  ---- 5. the click STAGES the row's own worktree and the slot flips --------
//  The board stands in `alpha`; the button must act in the ROW's worktree, so
//  a bare `add` would have staged the wrong tree (act.js:52:aj ctxOf).
let opens = 0;
function open(path, from) { opens++; return door.openTarget(path, from); }
const p = new pagerlib.Pager(-1, { tty: -1, color: false, open: open });
p.setHunks(board().hunks, "todo GET");
p.view.from = ALPHA;
//  The screen cell a spell sits on, found by asking the pager itself — no
//  column arithmetic, so an elastic title cannot move the click off the face.
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
const cell = cellOf(p, "//" + DIRTY + " add");
check("the `~1` button has a screen cell of its own", cell !== null,
      JSON.stringify(cell));
if (cell !== null) {
  const was = opens;
  p._mouse("0;" + cell.col + ";" + cell.row, true);
  check("the click RAN `add` in the ROW's worktree", p.message === "add 1 staged",
        p.message);
  check("...pushing nothing", p.stack.length === 0, "stack " + p.stack.length);
  check("...re-opening the board in place", opens === was + 1, "opens " + opens);
  const s = wtstat.stat(SRC + "/" + DIRTY);
  check("...the fixture worktree really staged its modified file",
        s !== null && s.un.chg === 0 && s.st.chg === 1,
        s === null ? "null" : JSON.stringify({ un: s.un, st: s.st }));
  //  The board it left on screen is the RE-BUCKETED one: the lit `~1` is info.
  const b2 = buttonsOf(rowSpans(p.view.hunks[0], "GET-001"));
  const i2 = byFace(b2, "~1");
  check("...and the slot flipped to info in place",
        i2 !== null && i2.spell === "" && i2.look !== null && i2.look.bg === "",
        i2 === null ? "gone" : JSON.stringify(i2.look) + " " + i2.spell);
  check("...while the other two classes stay lit",
        !!byFace(b2, "-1") && byFace(b2, "-1").spell === "//" + DIRTY + " rm" &&
        !!byFace(b2, "+1") && byFace(b2, "+1").spell === "//" + DIRTY + " add +",
        b2.map(function (x) { return x.face + ":" + x.spell; }).join("|"));
  //  The COUNT does not move — the same one row, now on the staged axis — so
  //  the plain board is unchanged and only the paint and the click did.
  const pl2 = utf8.Decode(p.view.hunks[0].plain);
  check("...the plain row keeping its ASCII frame, look-free",
        pl2.indexOf("[ i ~1 -1 +1   ]") >= 0 && pl2.indexOf("#") < 0, pl2);
}

//  ---- 6. the ` i` face is a VIEW spell: it PUSHES, it does not run ---------
const pi = new pagerlib.Pager(-1, { tty: -1, color: false, open: open });
pi.setHunks(board().hunks, "todo GET");
pi.view.from = ALPHA;
const icell = cellOf(pi, "status //" + STAGED);
check("the ` i` face has a screen cell too", icell !== null, JSON.stringify(icell));
if (icell !== null) {
  pi._mouse("0;" + icell.col + ";" + icell.row, true);
  check("the ` i` click PUSHED the worktree's status",
        pi.stack.length === 1 && pi.view.path === "status //" + STAGED,
        "stack " + pi.stack.length + " path " + pi.view.path);
  check("...on the worktree the ROW names",
        utf8.Decode(pi.view.hunks[0].plain || new Uint8Array(0)).indexOf("a.txt") >= 0 ||
        utf8.Decode(pi.view.hunks[0].text).indexOf("a.txt") >= 0,
        utf8.Decode(pi.view.hunks[0].text).slice(0, 120));
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
