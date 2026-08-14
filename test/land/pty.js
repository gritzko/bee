//  lite/test/land/pty.js — LITE-029: following a ref selects the TOKEN.
//  `src/abc/FSW.c:25:7` lands with the cursor ON the token covering the col's
//  byte, a permalink lands on the token the RESOLVER named, and a col that
//  falls in a gap (whitespace) or past the line end lands on the line alone.
//
//  The REAL UI path: a hunk painted on a `tty.openpty()` slave by the shipped
//  Pager, real SGR presses written to the master, then the pushed view's FRAME
//  BYTES read back — the token wash (`48;5;<tok>`) must open exactly where the
//  target token starts.  Stepped, not run(): a self-pty has no concurrent
//  reader, so a render is followed by a blocking drain.
"use strict";
const pagerlib = require("view/pager.js");
const bro = require("view/bro.js");
const entry = require("main.js");

const ESC = "\x1b";
const ends = (s, tail) => typeof s === "string" && s.slice(-tail.length) === tail;
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

//  ---- the fixture arithmetic ----------------------------------------------
//  Every numbered line is 16 bytes (`int FSWMARK020;\n`), r1 prepended 5 of
//  them, so r0's line 20 is line 25 today and its bytes are multiplication.
const LINE = 16;
const L25 = 24 * LINE;                             // line 25 starts here
const TOK_LO = L25 + 4, TOK_HI = L25 + 14;         // `FSWMARK020`
const OFF20 = 19 * LINE + 6;                       // r0 line 20, col 7 — INSIDE it
//  the wide line: 20 x `int WIDE001; ` (13 bytes each) as line 46.
const L46 = 45 * LINE, WIDE_LO = L46 + 8 * 13 + 4;
const B0 = io.getenv("LITE_B0");

//  ron64 of a number, and the hashlet: the sha1 hex packed 12 bits per PAIR of
//  ron64 chars, extended by 2 until it holds a non-digit (which is what makes
//  segment 2 read as a hashlet and not a column) — LITE-025's own mint.
function ron64(v) { const s = ron.encode(BigInt(v)); return s === "" ? "0" : s; }
function pair(hex3) { return ron.encode(BigInt(parseInt(hex3, 16))).padStart(2, "0"); }
function mint(sha) {
  let h = "";
  for (let i = 0; i < 5; i++) {
    h += pair(sha.slice(i * 3, i * 3 + 3));
    if (h.length < 4) continue;
    let nondigit = false;
    for (const c of h) if (c < "0" || c > "9") nondigit = true;
    if (nondigit) return h;
  }
  return h;
}
const FILE = "src/abc/FSW.c";
const MID = FILE + ":25:7";                        // inside `FSWMARK020`
const GAP = FILE + ":25:4";                        // the space after `int`
const PAST = FILE + ":25:80";                      // past the line end
const BARE = FILE + ":25";                         // a line, no column
const PERMA = FILE + ":" + ron64(OFF20) + ":" + mint(B0);
const WIDE = FILE + ":46:109";                     // `WIDE009`, off-screen at 100 cols
const NOTE = "src/note.c:1:10";                    // inside note.c's OWN ref token
const NOTEREF = FILE + ":25:7";                    // ...which is the ref it carries
w1("#    refs " + MID + "  " + PERMA + "  " + WIDE + "\n");

//  ---- the DOOR: the landing carries the column, and the resolver's token ----
const mid = entry.openTarget(MID);
check("a `:line:col` ref opens the file", mid !== null && mid.length === 1,
      mid === null ? "null" : "hunks " + mid.length);
check("...handing the pager the COLUMN, not just the line",
      mid !== null && mid.land && mid.land.line === 25 && mid.land.col === 7,
      mid === null ? "null" : JSON.stringify(mid.land || null));

const bare = entry.openTarget(BARE);
check("a bare `:line` still lands with no column",
      bare !== null && bare.land && bare.land.line === 25 && bare.land.col === 0,
      bare === null ? "null" : JSON.stringify(bare.land || null));

const per = entry.openTarget(PERMA);
check("a permalink opens the file it names", per !== null && per.length === 1,
      per === null ? "null" : "hunks " + per.length);
check("...on the line the later commit MOVED, column and all",
      per !== null && per.land && per.land.line === 25 && per.land.col === 7,
      per === null ? "null" : JSON.stringify(per.land || null));
//  the resolver walked to the token itself; its BYTES ride the door, so the
//  pager selects what the resolver named instead of re-deriving from the col.
check("...and the RESOLVER's own token comes through the door",
      per !== null && per.land && per.land.lo === TOK_LO && per.land.hi === TOK_HI,
      per === null ? "null" : JSON.stringify(per.land || null));

//  ---- the pty: a real click on each ref form -------------------------------
//  Every ref line opens with the same 7-byte prefix, so the ref starts at col 8.
const REFS = [MID, GAP, PAST, BARE, PERMA, WIDE, NOTE];
const COL = 8;
function refHunk(uriStr, refs) {
  let text = "";
  const tagAt = [];
  for (const r of refs) {
    text += "/* see ";
    tagAt.push(["C", utf8.Encode(text).length]);
    text += r;
    tagAt.push(["F", utf8.Encode(text).length]);
    text += " */\n";
    tagAt.push(["C", utf8.Encode(text).length]);
  }
  const toks = new Uint32Array(tagAt.length);
  for (let i = 0; i < tagAt.length; i++)
    toks[i] = (((tagAt[i][0].charCodeAt(0) - 65) & 0x1f) << 27) | (tagAt[i][1] & 0xffffff);
  return { uri: uriStr, verb: "hunk", text: utf8.Encode(text), toks: toks, kind: "file" };
}

const pty = tty.openpty();
tty.setSize(pty.slave, 14, 100);                   // 13 body rows, a 100-col page
const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
p.setHunks([refHunk("see.c", REFS)], "see.c");
const rb = io.buf(1 << 16);
function drain() { rb.reset(); const k = io.read(pty.master, rb); return k > 0 ? utf8.Decode(rb.data().slice()) : ""; }
const kbuf = io.buf(64);
function send(s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); }
const krb = io.buf(64);
function pump(done, tries) {
  for (let r = 0; r < (tries || 40); r++) {
    krb.reset();
    const m = io.read(pty.slave, krb);
    if (m > 0) p._feed(krb.data().slice());
    if (done()) return true;
  }
  return done();
}
function click(row, col) { send(ESC + "[<0;" + col + ";" + row + "M"); }
function frame() { p.render(); return drain(); }
function frameRow(f, i) { return f.split("\r\n")[i] || ""; }

//  The two washes as the SGR they spell — a cell with no bg of its own washes
//  down the grey ramp from white (the LITE-023 shape).
const LINE_BG = "48;5;" + (255 - 2 * bro.WASH_CUR_LINE);
const TOK_BG = "48;5;" + (255 - 2 * bro.WASH_CUR_TOK);
//  The TEXT a wash paints: from the SGR that turns `bg` on to the next escape.
function washed(row, bg) {
  let i = row.indexOf(bg);
  if (i < 0) return "";
  i = row.indexOf("m", i);
  if (i < 0) return "";
  let out = "";
  for (i++; i < row.length && row[i] !== ESC; i++) out += row[i];
  return out;
}
//  What a followed ref left behind: the cursor, and the frame row it sits on.
function seat() {
  const c = p.view.cur, s = c && c.span;
  const f = frame();
  return { row: c ? c.row : -1, tok: c ? c.tok : -2,
           lo: s ? s.lo : -1, hi: s ? s.hi : -1,
           scroll: p.view.scroll, at: frameRow(f, (c ? c.row : 0) - p.view.scroll) };
}

const saved = tty.raw(pty.slave);
const R = {};
try {
  R.base = frame();
  //  screen row 1 is the banner band, so ref line i sits on row i+1.
  click(2, COL + 1);
  R.midPushed = pump(function () { return p.stack.length === 1; });
  R.mid = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(3, COL + 1);
  R.gapPushed = pump(function () { return p.stack.length === 1; });
  R.gap = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(4, COL + 1);
  R.pastPushed = pump(function () { return p.stack.length === 1; });
  R.past = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(5, COL + 1);
  R.barePushed = pump(function () { return p.stack.length === 1; });
  R.bare = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(6, COL + 1);
  R.permaPushed = pump(function () { return p.stack.length === 1; });
  R.perma = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  //  the `:` bar rides the SAME door — a typed ref selects the same token.
  send(":" + MID + "\r");
  R.barPushed = pump(function () { return p.stack.length === 1; });
  R.bar = seat();
  send("-"); pump(function () { return p.stack.length === 0; });

  //  the WRAP leg: col 109 of the 260-byte line is off-screen at 100 columns —
  //  the landing keeps the token's bytes and `W` seats the cursor on the
  //  display row that CONTAINS them, two rows below the line's first.
  click(7, COL + 1);
  R.widePushed = pump(function () { return p.stack.length === 1; });
  R.wide = seat();
  send("W");
  R.wrapped = pump(function () { return p.view.wrap === true; });
  frame();                                       // the wrap re-indexes the rows
  R.wideWrapped = seat();
  send("W"); pump(function () { return p.view.wrap === false; });
  send("-"); pump(function () { return p.stack.length === 0; });

  //  a landing on a FOLLOWABLE token: note.c carries a ref of its own, and the
  //  cursor lands on it as a click would — Enter then opens what it names.
  click(8, COL + 1);
  R.notePushed = pump(function () { return p.stack.length === 1; });
  R.note = seat();
  R.noteTarget = p._curTarget(p.rows(100)[p.view.cur.row], p.view.cur);
  send("\r");
  R.followed = pump(function () { return p.stack.length === 2; });
  R.followedUri = p.view.hunks[0].uri;
  R.follow = seat();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }

check("the ref lines paint", R.base.indexOf(MID) >= 0 && R.base.indexOf(WIDE) >= 0,
      frameRow(R.base, 1));

//  ---- `:line:col` — the cursor sits ON the token ---------------------------
check("a click on a `:line:col` ref pushed a view", R.midPushed, "stack depth");
check("...the cursor on the landed line", R.mid.row === 25, "cur.row " + R.mid.row);
check("...1/4 down the page, as the line landing always was", R.mid.scroll === 22,
      "scroll " + R.mid.scroll);
check("...holding the TOKEN the column covers", R.mid.lo === TOK_LO && R.mid.hi === TOK_HI,
      R.mid.lo + ".." + R.mid.hi);
check("...and the token wash paints exactly that token",
      washed(R.mid.at, TOK_BG) === "FSWMARK020", R.mid.at);
check("...over the active-line wash, which still spans the row",
      R.mid.at.indexOf(LINE_BG) >= 0, R.mid.at);

//  ---- a permalink — the resolver's own token is what gets selected ---------
check("a click on a permalink pushed a view", R.permaPushed, "stack depth");
check("...the cursor on the moved line", R.perma.row === 25, "cur.row " + R.perma.row);
check("...holding the token the RESOLVER named", R.perma.lo === TOK_LO && R.perma.hi === TOK_HI,
      R.perma.lo + ".." + R.perma.hi);
check("...washed on that token", washed(R.perma.at, TOK_BG) === "FSWMARK020", R.perma.at);

//  ---- the `:` bar leg is identical ----------------------------------------
check("a ref TYPED on the `:` bar selects the same token",
      R.barPushed && R.bar.row === 25 && R.bar.lo === TOK_LO, R.bar.row + " " + R.bar.lo);
check("...with the same wash", washed(R.bar.at, TOK_BG) === "FSWMARK020", R.bar.at);

//  ---- a col in a GAP or past the line end: the line alone ------------------
check("a col in the whitespace GAP lands on the line", R.gapPushed && R.gap.row === 25,
      "cur.row " + R.gap.row);
check("...with NO active token — a landing never guesses a neighbour",
      R.gap.tok === -1 && R.gap.lo === -1, R.gap.tok + " " + R.gap.lo);
check("...so no token wash paints at all", R.gap.at.indexOf(TOK_BG) < 0, R.gap.at);
check("...while the line wash is there", R.gap.at.indexOf(LINE_BG) >= 0, R.gap.at);

check("a col PAST the line end lands on the line", R.pastPushed && R.past.row === 25,
      "cur.row " + R.past.row);
check("...with no active token", R.past.tok === -1 && R.past.lo === -1,
      R.past.tok + " " + R.past.lo);
check("...and no token wash", R.past.at.indexOf(TOK_BG) < 0, R.past.at);

//  ---- a bare `:line` is UNCHANGED -----------------------------------------
check("a bare `:line` still lands on the line", R.barePushed && R.bare.row === 25,
      "cur.row " + R.bare.row);
check("...as an active LINE, tok -1", R.bare.tok === -1 && R.bare.lo === -1,
      R.bare.tok + " " + R.bare.lo);
check("...with no token wash", R.bare.at.indexOf(TOK_BG) < 0, R.bare.at);

//  ---- the WRAPPED line ----------------------------------------------------
check("a click on the wide line's ref pushed a view", R.widePushed, "stack depth");
check("...the cursor on the line, whose col is off-screen no-wrap",
      R.wide.row === 46, "cur.row " + R.wide.row);
check("...the token's bytes kept all the same", R.wide.lo === WIDE_LO && R.wide.hi === WIDE_LO + 7,
      R.wide.lo + ".." + R.wide.hi);
check("`W` wraps, and the cursor takes the display row that CONTAINS the byte",
      R.wrapped && R.wideWrapped.row === 47, "cur.row " + R.wideWrapped.row);
check("...where the token wash now paints it",
      washed(R.wideWrapped.at, TOK_BG) === "WIDE009", R.wideWrapped.at);

//  ---- a landing on a FOLLOWABLE token -------------------------------------
check("a col inside a file's OWN ref lands on that token",
      R.notePushed && R.note.row === 1, "cur.row " + R.note.row);
check("...taking the row's FOLLOWABLE slot, over the same bytes",
      R.note.tok === 0 && R.note.lo === 7 && R.note.hi === 7 + NOTEREF.length,
      R.note.tok + " " + R.note.lo + ".." + R.note.hi);
check("...washed over the whole fused ref", washed(R.note.at, TOK_BG) === NOTEREF, R.note.at);
check("...which the bar names, as any active target", R.noteTarget === NOTEREF, R.noteTarget);
check("Enter follows the LANDED token", R.followed && ends(R.followedUri, FILE),
      R.followedUri);
check("...into a view landed on ITS token in turn",
      R.follow.row === 25 && R.follow.lo === TOK_LO, R.follow.row + " " + R.follow.lo);

w1((bad ? "FAIL " : "PASS ") + "[lite/land] " + n + " checks, " + bad + " bad\n");
if (bad) throw "LAND";
