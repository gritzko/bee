//  bee/test/gobtn/gobtn.js — BEE-044: the `[go]` button, headless over the REAL
//  board hunks (view/todo.js) and the real click machinery (pager.js, act.js).
//  A wt-LESS OPEN row whose head names a registered repo must offer ONE frame
//  with a live 2-cell face minting the context-LESS `fork //<repo>-<KEY>`; a
//  name no repo answers to greys it dead; a row with a worktree wears its two
//  frames instead; plain stays chrome-free; and a real click must MINT the
//  worktree and grow the row's frames in place.
"use strict";

const todo = require("view/todo.js");
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");
const plainlib = require("render/plain.js");
const pagerlib = require("pager.js");
const act = require("act.js");
const door = require("door.js");
const wtstat = require("view/wtstat.js");

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
const FACE = theme.BTN_FACE;
const COLS = 110;
//  BEE-044 r2: the go frame is COMPACT — two lead spaces, brackets and the
//  2-cell face at the row's tail, right beside the ticket panel.
const GOW = 2 + 1 + 2 + 1;

function board(arg) { return todo.todo(arg === undefined ? "GET" : arg, { from: ALPHA }); }

//  A hunk -> its spans as { tag, text, lo, hi } (test/done/panel.js:36:Kf).
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
//  The row's VISIBLE bytes — the `U` targets and the `O` looks are hidden.
function seen(sp) {
  return sp.filter(function (s) { return s.tag !== "O" && s.tag !== "U"; })
           .map(function (s) { return s.text; }).join("");
}
//  The `go` face and the frame around it, or null when the row wears none.
function goOf(h, key) {
  const sp = rowSpans(h, key);
  for (let i = 0; i < sp.length; i++) {
    if (sp[i].text !== FACE.go) continue;
    const o = (i + 1 < sp.length && sp[i + 1].tag === "O") ? sp[i + 1] : null;
    return { face: sp[i], tag: sp[i].tag, o: o,
             spell: o === null ? null : wrap.oSpell(o.text),
             look: o === null ? null : wrap.oLook(o.text),
             pre: i > 0 ? sp[i - 1] : null,
             post: sp[i + (o === null ? 1 : 2)] || null };
  }
  return null;
}
//  The row's FRAMES REGION: everything the row puts after its elastic title
//  span, the trailing ticket panel (BEE-043) aside, in DISPLAY cells.
function regionOf(h, key) {
  const sp = rowSpans(h, key);
  let i = 0;
  while (i < sp.length && sp[i].tag !== "B") i++;
  const tail = seen(sp.slice(i + 1)).replace(/\n$/, "");
  const panel = " [" + FACE.done + " " + FACE.dont + "]";
  return Array.from(tail.slice(0, tail.length - panel.length)).length;
}
function anySpell(h, pre) {
  for (const s of spansOf(h))
    if (s.tag === "O" && String(wrap.oSpell(s.text)).indexOf(pre) === 0) return true;
  return false;
}

const h = board().hunks[0];

//  ---- 1. a resolvable `Rep:` opens the region with a LIVE go frame ---------
const g1 = goOf(h, "GET-001");
check("a wt-less row with a resolvable `Rep:` wears the go face", g1 !== null,
      seen(rowSpans(h, "GET-001")));
if (g1 !== null) {
  check("...in its own frame — dim brackets OUTSIDE the click zone",
        g1.pre !== null && g1.pre.text === "[" && g1.pre.tag === "D" &&
        g1.post !== null && g1.post.text.indexOf("]") === 0 && g1.post.tag === "D",
        JSON.stringify([g1.pre && g1.pre.text + g1.pre.tag,
                        g1.post && g1.post.text.slice(0, 1) + g1.post.tag]));
  check("...the 2-cell face on its class tag, never grey",
        g1.tag === theme.BTN_TAG.go && "DPQ".indexOf(g1.tag) < 0, g1.tag);
  check("...wearing the tone over its derived wash",
        g1.look !== null && g1.look.fg === theme.BTN.go &&
        g1.look.bg === theme.pale(theme.BTN.go), JSON.stringify(g1.look));
  check("...and minting `fork //alpha-GET-001` off `Rep: ///alpha` + the KEY",
        g1.spell === "fork //alpha-GET-001", g1.spell);
  check("...a MUTATION act.js owns", act.actOf(g1.spell) !== null, g1.spell);
  check("...carrying NO `//name` context — the tree does not exist yet",
        act.ctxOf(g1.spell) === null, g1.spell);
  check("...the arg being exactly the //repo-KEY word",
        act.wordsOf(g1.spell.slice("fork ".length)).join("|") === "//alpha-GET-001",
        g1.spell);
}

//  ---- 2. no `Rep:` — the region stays pure leader ---------------------------
check("a row with NO `Rep:` wears no go face", goOf(h, "GET-002") === null,
      seen(rowSpans(h, "GET-002")));
check("...its frames region is empty, the elastic ┄ leader filling it",
      regionOf(h, "GET-002") === 0, String(regionOf(h, "GET-002")));

//  ---- 3. an unresolvable `Rep:` greys the face DEAD -------------------------
const g3 = goOf(h, "GET-003");
check("a `Rep:` no registered repo answers to still shows the face", g3 !== null,
      seen(rowSpans(h, "GET-003")));
if (g3 !== null) {
  check("...GREY — the disabled signal (render/theme.js:110)",
        "DPQ".indexOf(g3.tag) >= 0, g3.tag);
  check("...and minting NO spell — a doomed `fork` never clicks",
        g3.o === null, g3.o && g3.o.text);
}
check("...so the board mints one `fork` spell, not two",
      !anySpell(h, "fork //nosuch"), "a doomed fork spell");

//  ---- 4. a row WITH a worktree never shows [go] -----------------------------
check("a row that already HAS a worktree wears no go face",
      goOf(h, "GET-004") === null, seen(rowSpans(h, "GET-004")));
check("...it wears the two wt frames instead",
      seen(rowSpans(h, "GET-004")).indexOf("[" + FACE.status + " ") >= 0 &&
      seen(rowSpans(h, "GET-004")).indexOf("[" + FACE.log + " ") >= 0,
      seen(rowSpans(h, "GET-004")));

//  ---- 5. the go frame is COMPACT, at the tail beside the ticket panel ------
check("the go frame measures its own compact width, no ┄ fill after the title",
      regionOf(h, "GET-001") === GOW, String(regionOf(h, "GET-001")));
check("...ending right where the ticket panel begins",
      seen(rowSpans(h, "GET-001")).indexOf("[" + FACE.go + "] [" + FACE.done) >= 0,
      seen(rowSpans(h, "GET-001")));

//  ---- 6. a CLOSED row a filter shows offers no fork ------------------------
const hc = board("GET Now:DONE").hunks[0];
check("a row a `Now:` filter shows CLOSED wears no go face",
      goOf(hc, "GET-005") === null, seen(rowSpans(hc, "GET-005")));
check("...so a closed listing mints no `fork` spell at all",
      !anySpell(hc, "fork "), "a fork spell");

//  ---- 7. plain stays chrome-free -------------------------------------------
const pl = utf8.Decode(h.plain);
check("plain carries no go byte", pl.indexOf("[" + FACE.go + "]") < 0 &&
      pl.indexOf("┄") < 0 && pl.indexOf("\x1b") < 0, pl);
check("...a `Rep:` row's plain line ends on its own title, as a bare one does",
      pl.indexOf("GET-001: fork me\n") >= 0 && pl.indexOf("GET-002: bare row\n") >= 0, pl);
check("the plain SINK says the same",
      utf8.Decode(plainlib.render([h])) === pl, "sink differs");

//  ---- 8. the click: fork runs and the row grows its frames in place --------
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
p.view.from = ALPHA;

//  On SCREEN, the go frame hugs its own row's ticket panel and every row's
//  ticket panel still ends flush right, [go] or leader or frames before it.
const goCell = cellOf(p, "fork //alpha-GET-001");
check("the go face has a screen cell of its own", goCell !== null, JSON.stringify(goCell));
const d1 = cellOf(p, "done GET-001"), d2 = cellOf(p, "done GET-002"),
      d4 = cellOf(p, "done GET-004");
check("...and the [go], the leader and the wt row end on ONE column",
      d1 !== null && d2 !== null && d4 !== null &&
      d1.col === d2.col && d2.col === d4.col, JSON.stringify([d1, d2, d4]));
check("...the go face hugging its own panel, 5 cells apart",
      goCell !== null && d1 !== null && d1.row === goCell.row &&
      d1.col - goCell.col === 5, JSON.stringify([goCell, d1]));

if (goCell !== null) {
  const was = opens;
  p._mouse("0;" + goCell.col + ";" + goCell.row, true);
  check("the click RAN `fork` and reported the minted tree",
        String(p.message).indexOf(SRC + "/alpha-GET-001") === 0, p.message);
  check("...pushing nothing", p.stack.length === 0, "stack " + p.stack.length);
  check("...re-opening the board in place", opens === was + 1, "opens " + opens);
  const h2 = p.view.hunks[0];
  check("...and the row GREW its two frames — the fresh wt is scanned",
        seen(rowSpans(h2, "GET-001")).indexOf("[" + FACE.status + " ") >= 0 &&
        seen(rowSpans(h2, "GET-001")).indexOf("[" + FACE.log + " ") >= 0,
        seen(rowSpans(h2, "GET-001")));
  check("...the go frame gone with it", goOf(h2, "GET-001") === null,
        seen(rowSpans(h2, "GET-001")));
  check("...while the wt-less rows kept theirs",
        goOf(h2, "GET-003") !== null && goOf(h2, "GET-002") === null,
        seen(rowSpans(h2, "GET-003")));
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
