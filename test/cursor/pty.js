//  lite/test/cursor/pty.js — LITE-023: the ACTIVE LINE + ACTIVE TOKEN over a
//  REAL tty.  A tty.openpty() slave takes the frames, the master takes the keys,
//  and every assertion reads the frame BYTES back: the cursor wash must be on
//  the row the keys say it is, and Enter must open what the active token names.
//
//  STEPPED, not run() — the LITE-004 pty discipline verbatim: one blocking
//  master read per drain, tty.raw entered ONCE up front (TCSAFLUSH drops
//  pre-queued keys), pump() reads first and tests its condition after.
"use strict";
const pagerlib = require("pager.js");
const ansi = require("render/ansi.js");
const fs = require("view/fs.js");
const entry = require("door.js");        // LITE-045: the door, not the CLI

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) {
  return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

const pty = tty.openpty();
tty.setSize(pty.slave, 10, 40);                  // 10 rows: 9 body + the bar

const rb = io.buf(1 << 16);
let frames = "";
function drain() {
  rb.reset();
  const k = io.read(pty.master, rb);
  if (k > 0) frames += utf8.Decode(rb.data().slice());
}
function frame(p) { p.render(); frames = ""; drain(); return frames; }
//  The painted body rows of a frame, verbatim (SGR included) — row 0 is the
//  hunk banner, row i the display row at scroll+i.
function lines(f) { return f.split("\r\n"); }

const kbuf = io.buf(64);
function send(s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); }
const krb = io.buf(64);
function pump(p, done, tries) {
  for (let r = 0; r < (tries || 20); r++) {
    krb.reset();
    const m = io.read(pty.slave, krb);
    if (m > 0) p._feed(krb.data().slice());
    if (done()) return true;
  }
  return done();
}

//  The two washes, as the SGR they spell: a cell with no bg of its own washes
//  down the grey ramp from white — line 255-2*1, token 255-2*3.
const LINE_BG = "48;5;" + (255 - 2 * ansi.WASH_CUR_LINE);
const TOK_BG = "48;5;" + (255 - 2 * ansi.WASH_CUR_TOK);

const saved = tty.raw(pty.slave);
try {
  //  ---- a DIR view: 14 entries, 9 body rows -------------------------------
  const dh = entry.openPath(".");
  check("dir view opens", dh !== null && dh[0].kind === "dir",
        dh === null ? "null" : dh[0].kind);
  const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openPath });
  p.setHunks(dh, ".");

  const f0 = frame(p);
  check("the cursor opens on row 0", p.view.cur.row === 0 && p.view.cur.tok === -1,
        p.view.cur.row + "/" + p.view.cur.tok);
  check("no body row is washed while the cursor sits on the banner",
        lines(f0).slice(1, 9).join("").indexOf(LINE_BG) < 0, f0);

  //  ---- j / k move the ACTIVE LINE, and the wash moves with it ------------
  send("j");
  check("`j` moves the active line down", pump(p, function () { return p.view.cur.row === 1; }),
        "cur " + p.view.cur.row);
  const f1 = lines(frame(p));
  check("...the wash is on row 1", f1[1].indexOf(LINE_BG) >= 0, f1[1]);
  check("...and nowhere else",
        f1[2].indexOf(LINE_BG) < 0 && f1[3].indexOf(LINE_BG) < 0, f1[2] + " | " + f1[3]);
  check("...the scroll did NOT move", p.view.scroll === 0, "scroll " + p.view.scroll);

  send("j");
  check("`j` again", pump(p, function () { return p.view.cur.row === 2; }), "cur " + p.view.cur.row);
  const f2 = lines(frame(p));
  check("the wash MOVED to row 2, off row 1",
        f2[2].indexOf(LINE_BG) >= 0 && f2[1].indexOf(LINE_BG) < 0, f2[1] + " | " + f2[2]);
  send("k");
  check("`k` moves it back up", pump(p, function () { return p.view.cur.row === 1; }),
        "cur " + p.view.cur.row);

  //  ---- l / h hop the ACTIVE TOKEN; it takes the stronger wash ------------
  send("l");
  check("`l` lands on the row's first followable token",
        pump(p, function () { return p.view.cur.tok === 0; }), "tok " + p.view.cur.tok);
  const ft = lines(frame(p));
  check("...painted with the STRONGER wash", ft[1].indexOf(TOK_BG) >= 0, ft[1]);
  //  The two washes COMPOSE over the LITE-010 diff washes instead of drowning
  //  them: an in/rm cell under the cursor is still its own colour, only darker.
  const inL = ansi.aWash(ansi.WASH_IN, ansi.WASH_CUR_LINE);
  const rmL = ansi.aWash(ansi.WASH_RM, ansi.WASH_CUR_LINE);
  check("the wash darkens the diff washes, never merges them",
        inL.bg !== rmL.bg && inL.bg !== ansi.WASH_IN.bg && rmL.bg !== ansi.WASH_RM.bg,
        inL.bg + " / " + rmL.bg);
  check("...and the token wash is darker still",
        ansi.aWash(ansi.WASH_IN, ansi.WASH_CUR_TOK).bg < inL.bg,
        ansi.aWash(ansi.WASH_IN, ansi.WASH_CUR_TOK).bg + " < " + inL.bg);
  //  the status bar names what Enter would open, in place of the `#L`.
  const name = p._curTarget(p.rows(40)[1], p.view.cur);
  check("the bar names the active target", name.length > 0 && ft[9].indexOf(name) >= 0,
        name + " | " + ft[9]);

  //  A dir row has ONE followable token, so `l` CROSSES to the next row.
  send("l");
  check("`l` crosses to the next row's token",
        pump(p, function () { return p.view.cur.row === 2 && p.view.cur.tok === 0; }),
        p.view.cur.row + "/" + p.view.cur.tok);
  send("h");
  check("`h` hops back, cross-row",
        pump(p, function () { return p.view.cur.row === 1 && p.view.cur.tok === 0; }),
        p.view.cur.row + "/" + p.view.cur.tok);

  //  ---- Enter follows the ACTIVE TOKEN ------------------------------------
  const want = p._curTarget(p.rows(40)[1], p.view.cur);
  send("\r");
  check("Enter follows the active token",
        pump(p, function () { return p.stack.length === 1; }), "stack " + p.stack.length);
  check("...into the view that token named",
        p.view.hunks[0].uri === want, p.view.hunks[0].uri + " != " + want);

  //  ---- a / d walk back and FORWARD ---------------------------------------
  send("a");
  check("`a` backs out", pump(p, function () { return p.stack.length === 0; }),
        "stack " + p.stack.length);
  check("...to the dir view", p.view.hunks[0].kind === "dir", p.view.hunks[0].kind);
  check("...parking the view on the forward stack", p.fwd.length === 1, "fwd " + p.fwd.length);
  send("d");
  check("`d` goes forward again", pump(p, function () { return p.stack.length === 1; }),
        "stack " + p.stack.length);
  check("...to the SAME view", p.view.hunks[0].uri === want, p.view.hunks[0].uri);
  check("...and the forward stack is spent", p.fwd.length === 0, "fwd " + p.fwd.length);
  send("a");
  pump(p, function () { return p.stack.length === 0; });
  //  a NEW push clears the forward stack — the branch just taken wins.
  p.view.cur.row = 1; p.view.cur.tok = 0;
  send("\r");
  pump(p, function () { return p.stack.length === 1; });
  check("a new push clears the forward stack", p.fwd.length === 0, "fwd " + p.fwd.length);
  send("a");
  pump(p, function () { return p.stack.length === 0; });

  //  ---- the cursor DRAGS the viewport when it walks off-screen ------------
  send("g");
  pump(p, function () { return p.view.scroll === 0; });
  p.view.cur.row = 0; p.view.cur.tok = -1;
  frame(p);
  let moved = 0;
  for (let i = 0; i < 12; i++) { send("j"); if (pump(p, function () { return p.view.cur.row > moved; })) moved = p.view.cur.row; }
  check("12 `j`s walked the cursor to row 12", p.view.cur.row === 12, "cur " + p.view.cur.row);
  check("...and dragged the viewport after it", p.view.scroll === 12 - 9 + 1,
        "scroll " + p.view.scroll);
  const fd = lines(frame(p));
  check("...the wash rides the LAST body row", fd[8].indexOf(LINE_BG) >= 0, fd[8]);

  //  ---- scrolling alone leaves the cursor where it is ---------------------
  send("g");
  pump(p, function () { return p.view.scroll === 0; });
  p.view.cur.row = 3; p.view.cur.tok = -1;
  frame(p);
  send("sss");
  check("three `s` scrolled three rows", pump(p, function () { return p.view.scroll === 3; }),
        "scroll " + p.view.scroll);
  frame(p);
  check("...and the cursor never moved", p.view.cur.row === 3, "cur " + p.view.cur.row);
  send("s");
  pump(p, function () { return p.view.scroll === 4; });
  frame(p);
  check("a scroll PAST the cursor drags it to the edge", p.view.cur.row === 4,
        "cur " + p.view.cur.row);
  send("w");
  check("`w` scrolls back up", pump(p, function () { return p.view.scroll === 3; }),
        "scroll " + p.view.scroll);

  //  ---- a U-BACKED token: the hidden follower is what Enter opens ---------
  const ch = fs.buildChooserHunk("chooser", [{ rel: "one.txt", full: "f01.txt" },
                                              { rel: "two.txt", full: "f02.txt" }]);
  const pc = new pagerlib.Pager(pty.slave, { color: true, open: entry.openPath });
  pc.setHunks([ch], "chooser");
  frame(pc);
  send("j");
  pump(pc, function () { return pc.view.cur.row === 1; });
  send("l");
  check("a U-backed token is followable",
        pump(pc, function () { return pc.view.cur.tok === 0; }), "tok " + pc.view.cur.tok);
  const fc = lines(frame(pc));
  check("...and the hidden target still takes NO column",
        fc[1].replace(/\x1b\[[0-9;]*m/g, "").indexOf("f01.txt") < 0, fc[1]);
  send("\r");
  check("Enter opens the HIDDEN target, not the visible text",
        pump(pc, function () { return pc.stack.length === 1; }), "stack " + pc.stack.length);
  check("...which is f01.txt", pc.view.hunks[0].uri === "f01.txt", pc.view.hunks[0].uri);

  //  ---- the displaced keys: `?` help, `W` wrap ----------------------------
  send("a");
  pump(pc, function () { return pc.stack.length === 0; });
  send("?");
  check("`?` opens the help view", pump(pc, function () { return pc.stack.length === 1; }),
        "stack " + pc.stack.length);
  const fh = frame(pc);
  check("...built from the ONE shortcuts table (scheme B rows)",
        fh.indexOf("active line down / up") >= 0 && fh.indexOf("a / d") >= 0 &&
        fh.indexOf("w / s") >= 0, fh);
  send("a");
  pump(pc, function () { return pc.stack.length === 0; });
  check("`W` toggles soft-wrap", (function () {
    send("W");
    return pump(pc, function () { return pc.view.wrap === true; });
  })(), "wrap " + pc.view.wrap);

  //  ---- a CLICK sets the cursor, then follows -----------------------------
  const pm = new pagerlib.Pager(pty.slave, { color: true, open: entry.openPath });
  pm.setHunks(entry.openPath("."), ".");
  frame(pm);
  send(ESC + "[<0;2;3M");                          // screen row 3 = rows[2], col 2
  check("a click follows", pump(pm, function () { return pm.stack.length === 1; }),
        "stack " + pm.stack.length);
  check("...and it left the cursor on the cell it hit",
        pm.stack[0].cur.row === 2 && pm.stack[0].cur.tok === 0,
        pm.stack[0].cur.row + "/" + pm.stack[0].cur.tok);
} finally {
  tty.cook(pty.slave, saved);
}
io.close(pty.master); io.close(pty.slave);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
