//  bee/test/cpanel/cpanel.js — BEE-042: the COMMIT PANEL a board row wears,
//  headless over the REAL board hunks (view/todo.js) and the real click
//  machinery (pager.js, act.js).  Five fixture worktrees carry the five states
//  the panel tells apart — ahead, behind, diverged, diverged-then-detached and
//  staged — and the leg asserts the face+`O` pairs, the POSITIONAL pair, the
//  minted `KEY: <title>` message, plain parity, and two live clicks: a `-1`
//  fast-forwards its worktree, a ` ✓` commits and the row flips to `+1`.
"use strict";

const todo = require("view/todo.js");
const wtstat = require("view/wtstat.js");
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");
const plainlib = require("render/plain.js");
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
const AHEAD = "alpha-GET-001", BEHIND = "alpha-GET-002", DIVER = "alpha-GET-003",
      DETACH = "alpha-GET-004", STAGED = "alpha-GET-005";
const MSG = "GET-005: it's staged";        // the ONE title needing a quote swap
const COLS = 110;

function board() { return todo.todo("GET", { from: ALPHA }); }

//  A hunk -> its spans as { tag, text, lo, hi } (test/fpanel/fpanel.js:36:tF).
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
//  The spans of ONE row, grouped as the hunk emits them: a row ends on the span
//  carrying its newline.  Grouping beats a byte search — the row is full of
//  multibyte faces, so a string offset is no byte offset.
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
//  The row a ticket KEY sits on — its own `F` key column, never a hidden nav
//  or a spell that merely names it.
function rowSpans(h, key) {
  for (const r of rowsOf(h))
    for (const s of r) if (s.tag === "F" && s.text.indexOf(key) === 0) return r;
  return [];
}
//  The COMMIT frame's own spans: the row carries two frames, so the second `[`
//  through the `]` that closes it is this panel and nothing beside it.
function frameSpans(sp) {
  const brs = [];
  for (let i = 0; i < sp.length; i++)
    if (sp[i].tag === "D" && (sp[i].text === "[" || sp[i].text === "]")) brs.push(i);
  return brs.length < 4 ? [] : sp.slice(brs[2], brs[3] + 1);
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
function faces(bs) { return bs.map(function (x) { return x.face; }).join("|"); }
function frameText(sp) {
  return sp.filter(function (s) { return s.tag !== "O"; })
           .map(function (s) { return s.text; }).join("");
}
//  A LIT button: the face on its own class tag, the tone over the derived wash,
//  and a spell to run (render/theme.js:110:4o, render/wrap.js:52:ge).
function lit(bs, face, name, spell) {
  const b = byFace(bs, face);
  check("the `" + face + "` face is a button", b !== null, faces(bs));
  if (b === null) return;
  check("...on its class tag, never grey",
        b.tag === theme.BTN_TAG[name] && "DPQ".indexOf(b.tag) < 0, b.tag);
  check("...wearing the tone over its wash",
        b.look !== null && b.look.fg === theme.BTN[name] &&
        b.look.bg === theme.pale(theme.BTN[name]), JSON.stringify(b.look));
  check("...and spelling `" + spell + "`", b.spell === spell, b.spell);
}
//  Every row's panel: its frame spans, its buttons and its frame bytes.
function panel(h, key) {
  const fr = frameSpans(rowSpans(h, key));
  return { sp: fr, btn: buttonsOf(fr), text: frameText(fr) };
}

const h = board().hunks[0];

//  ---- 1. ahead only: the POST slot lights, the GET slot blanks -------------
const ah = panel(h, "GET-001");
check("the ahead row's frame is `[ ≡ +1      ]`", ah.text === "[ ≡ +1      ]", ah.text);
lit(ah.btn, theme.BTN_FACE.log, "log", "log //" + AHEAD);
lit(ah.btn, "+1", "push", "//" + AHEAD + " push");
check("ahead mints the log and the push button, nothing else",
      ah.btn.length === 2, faces(ah.btn));

//  ---- 2. behind only: the pair is POSITIONAL ------------------------------
const bh = panel(h, "GET-002");
check("the behind row's frame is `[ ≡    -1   ]`", bh.text === "[ ≡    -1   ]", bh.text);
lit(bh.btn, "-1", "pull", "//" + BEHIND + " pull");
check("behind mints the log and the pull button, nothing else",
      bh.btn.length === 2, faces(bh.btn));
//  The count sits in the GET slot: a behind count may never drift into the
//  push column (be todo.js:855:TO), so the two cells before it stay blank.
check("...the behind count in the SECOND slot, the push column blank",
      bh.text.indexOf("[ ≡    -") === 0, bh.text);

//  ---- 3. diverged: ONE merge button over both slots and the gap ------------
const dv = panel(h, "GET-003");
check("the diverged row's frame is `[ ≡   1⇄1   ]`", dv.text === "[ ≡   1⇄1   ]", dv.text);
lit(dv.btn, "  1⇄1", "merge", "//" + DIVER + " merge");
check("diverged mints ONE pair button, not two", dv.btn.length === 2, faces(dv.btn));
const mg = byFace(dv.btn, "  1⇄1");
check("...the face right-aligned in the pair's 5 cells",
      mg !== null && mg.face.length === 5, mg === null ? "gone" : mg.face);

//  ---- 4. detached: nothing names its tip, so nothing clicks ----------------
const dt = panel(h, "GET-004");
check("a detached worktree's pair blanks", dt.text === "[ ≡         ]", dt.text);
check("...and mints the log button alone", dt.btn.length === 1, faces(dt.btn));
lit(dt.btn, theme.BTN_FACE.log, "log", "log //" + DETACH);
//  The DEAD face itself: a diverged pair whose head tracks nothing greys — the
//  counts alone can never light a run that has nowhere to go (be todo.js:608:TO).
const dead = wtstat.commitCells(
  { model: { commits: [{ quad: ".o.." }, { quad: "o..." }] }, staged: 0, up: false },
  DETACH, "GET-004: detached");
let deadCell = null;
for (const c of dead) if (c.t.indexOf("⇄") >= 0) deadCell = c;
check("an upstream-less diverged pair is DEAD, not a button",
      deadCell !== null && deadCell.k === "dead" && deadCell.s === "",
      JSON.stringify(deadCell));
const live = wtstat.commitCells(
  { model: { commits: [{ quad: ".o.." }, { quad: "o..." }] }, staged: 0, up: true },
  DETACH, "GET-004: detached");
let liveCell = null;
for (const c of live) if (c.t.indexOf("⇄") >= 0) liveCell = c;
check("...while the same pair WITH an upstream is the merge button",
      liveCell !== null && liveCell.k === "btn" && liveCell.s === "//" + DETACH + " merge",
      JSON.stringify(liveCell));

//  ---- 5. staged: the ✓ carries the message the ROW mints -------------------
const sg = panel(h, "GET-005");
check("the staged row's frame is `[ ≡        ✓]`", sg.text === "[ ≡        ✓]", sg.text);
lit(sg.btn, theme.BTN_FACE.commit, "commit",
    "//" + STAGED + ' commit -m "' + MSG + '"');
check("staged mints the log and the ✓, nothing else", sg.btn.length === 2, faces(sg.btn));
//  The quoting is the SPELL's own job: act.js:10:aj splits on quotes, so the ✓
//  must reach sync.js as ONE `-m` message however the title is punctuated.
const act = require("act.js");
const ci = byFace(sg.btn, theme.BTN_FACE.commit);
if (ci !== null) {
  const c = act.ctxOf(ci.spell);
  const words = c === null ? [] : act.wordsOf(c.rest.slice("commit ".length));
  check("the ✓ spell splits into `-m` and ONE message arg",
        words.length === 2 && words[0] === "-m" && words[1] === MSG,
        JSON.stringify(words));
  check("...which act.js reads as a MUTATION, not the `commit <rev>` view",
        act.actOf(ci.spell) !== null, "no act");
}
//  A single-word title still mints a message, never a bare word git would read
//  as a path — the `-m` form is what makes it a mutation whatever the title is.
const one = wtstat.commitCells({ model: { commits: [] }, staged: 1, up: true },
                               STAGED, "GET-009: terse");
let oneSpell = "";
for (const c of one) if (c.t === theme.BTN_FACE.commit) oneSpell = c.s;
check("a one-word title still mints an `-m` mutation",
      oneSpell === "//" + STAGED + " commit -m 'GET-009: terse'" &&
      act.actOf(oneSpell) !== null, oneSpell);

//  ---- 6. plain is what it was before the buttons ---------------------------
const pl = utf8.Decode(h.plain);
const GOLD = [
  ["GET-001: ahead by one", "[ i            ]", "[ ≡ +1      ]"],
  ["GET-002: behind by one", "[ i            ]", "[ ≡    -1   ]"],
  ["GET-003: diverged both ways", "[ i            ]", "[ ≡   1⇄1   ]"],
  ["GET-004: detached and diverged", "[ i            ]", "[ ≡         ]"],
  ["GET-005: it's staged", "[ i ~1         ]", "[ ≡        ✓]"]];
for (const g of GOLD)
  check("plain: `" + g[0] + "` wears " + g[2],
        pl.indexOf(g[0] + " " + g[1] + " " + g[2] + "\n") >= 0, pl);
check("plain carries no look byte and no SGR",
      pl.indexOf("#") < 0 && pl.indexOf("\x1b") < 0, pl);
check("the plain SINK says the same",
      utf8.Decode(plainlib.render([h])) === pl, "sink differs");
check("the wtstat frame string is the panel's own bytes",
      wtstat.frames(SRC + "/" + DIVER).commit === "[ ≡   1⇄1   ]",
      wtstat.frames(SRC + "/" + DIVER).commit);
//  BEE-042: the region-wide `list <wt>/` U retired with the inert frame — a
//  click outside a face falls to the row's own nav, not to a listing.
const p0 = new pagerlib.Pager(-1, { tty: -1, color: false });
const close = dv.sp[dv.sp.length - 1];
check("the commit frame carries no `list` target of its own",
      !p0._targetAt(h, close.lo) && !p0._spellAt(h, close.lo),
      p0._targetAt(h, close.lo));
if (mg !== null)
  check("every cell of the merge face runs the same spell",
        p0._spellAt(h, mg.lo) === "//" + DIVER + " merge" &&
        p0._spellAt(h, mg.lo + 6) === "//" + DIVER + " merge",
        p0._spellAt(h, mg.lo) + " | " + p0._spellAt(h, mg.lo + 6));

//  ---- 7. the clicks: a `-1` fast-forwards, a ` ✓` commits ------------------
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
function clicker() {
  const p = new pagerlib.Pager(-1, { tty: -1, color: false, open: open });
  p.setHunks(board().hunks, "todo GET");
  p.view.from = ALPHA;
  return p;
}

const pp = clicker();
const pcell = cellOf(pp, "//" + BEHIND + " pull");
check("the `-1` button has a screen cell of its own", pcell !== null, JSON.stringify(pcell));
if (pcell !== null) {
  const was = opens;
  pp._mouse("0;" + pcell.col + ";" + pcell.row, true);
  check("the click RAN `pull` in the ROW's worktree",
        String(pp.message).indexOf("pull master ") === 0, pp.message);
  check("...pushing nothing", pp.stack.length === 0, "stack " + pp.stack.length);
  check("...re-opening the board in place", opens === was + 1, "opens " + opens);
  const b2 = panel(pp.view.hunks[0], "GET-002");
  check("...and the row is in sync in place", b2.text === "[ ≡         ]", b2.text);
}

const pc = clicker();
const ccell = cellOf(pc, "//" + STAGED + ' commit -m "' + MSG + '"');
check("the ` ✓` button has a screen cell of its own", ccell !== null, JSON.stringify(ccell));
if (ccell !== null) {
  pc._mouse("0;" + ccell.col + ";" + ccell.row, true);
  check("the click RAN `commit` in the ROW's worktree",
        String(pc.message).indexOf("commit ") === 0, pc.message);
  check("...pushing nothing", pc.stack.length === 0, "stack " + pc.stack.length);
  const s2 = panel(pc.view.hunks[0], "GET-005");
  check("...and the ahbeh flipped to `+1`, the ✓ gone",
        s2.text === "[ ≡ +1      ]", s2.text);
  lit(s2.btn, "+1", "push", "//" + STAGED + " push");
}

//  ---- 8. the ` ≡` face is a VIEW spell: it PUSHES, it does not run ---------
const pl2 = clicker();
const lcell = cellOf(pl2, "log //" + AHEAD);
check("the ` ≡` face has a screen cell too", lcell !== null, JSON.stringify(lcell));
if (lcell !== null) {
  pl2._mouse("0;" + lcell.col + ";" + lcell.row, true);
  check("the ` ≡` click PUSHED the worktree's log",
        pl2.stack.length === 1 && pl2.view.path === "log //" + AHEAD,
        "stack " + pl2.stack.length + " path " + pl2.view.path);
  check("...on the worktree the ROW names",
        utf8.Decode(pl2.view.hunks[0].text).indexOf("ahead by one") >= 0,
        utf8.Decode(pl2.view.hunks[0].text).slice(0, 160));
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
