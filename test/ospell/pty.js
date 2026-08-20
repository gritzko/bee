//  bee/test/ospell/pty.js — BEE-034: the `O` button over a REAL tty.  The
//  test/cursor/pty.js discipline verbatim (frames to a scratch file, keys down
//  the pty master, tty.raw entered once): `l` must HOP onto a button, Enter and
//  a click must both run its spell, and a look-only button must fall through.
"use strict";
const pagerlib = require("pager.js");
const door = require("door.js");
const fixture = require(__dirname + "/fixture.js");

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
tty.setSize(pty.slave, 10, 40);
//  A self-pty has no concurrent reader, so the paint goes to a scratch FILE and
//  the pty stays the tty (size, raw, keys) — test/cursor/pty.js's rule.
const FRAMES = (io.getenv("TMPDIR") || "/tmp") + "/bee-ospell-" + io.getpid() + ".frames";
const sink = io.open(FRAMES, "c"), tap = io.open(FRAMES, "r");

const rb = io.buf(1 << 16);
let frames = "";
function drain() {
  for (;;) {
    rb.reset();
    const k = io.read(tap, rb);
    if (k <= 0) break;
    frames += utf8.Decode(rb.data().slice());
  }
}
function frame(p) { p.render(); frames = ""; drain(); return frames; }

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

function pager() {
  const p = new pagerlib.Pager(sink, { tty: pty.slave, color: true,
                                       open: door.openTarget });
  p.setHunks([fixture.hunk()], "ospell");
  frame(p);
  return p;
}

const saved = tty.raw(pty.slave);
try {
  //  ---- the frame shows the FACE and none of the spell ---------------------
  const p = pager();
  const f0 = frame(p);
  check("the button face is painted", f0.indexOf("[cat]") >= 0, f0);
  check("...and the `O` bytes take no cell",
        f0.indexOf(fixture.LOOK) < 0 && f0.indexOf("cat one.txt") < 0, f0);

  //  ---- `l` hops the button like any U-backed token ------------------------
  send("jj");
  check("the cursor reaches the button row",
        pump(p, function () { return p.view.cur.row === 2; }), "row " + p.view.cur.row);
  send("l");
  check("`l` lands on the row's own nav token",
        pump(p, function () { return p.view.cur.tok === 0; }), "tok " + p.view.cur.tok);
  const rows = p.rows(40);
  check("...which still names the `U` target",
        p._curTarget(rows[2], p.view.cur) === "cat two.txt",
        p._curTarget(rows[2], p.view.cur));
  send("l");
  check("`l` hops on to the BUTTON — a face followed by `O` is followable",
        pump(p, function () { return p.view.cur.tok === 1; }), "tok " + p.view.cur.tok);
  check("...and the bar names its SHED spell",
        p._curTarget(rows[2], p.view.cur) === "cat one.txt",
        p._curTarget(rows[2], p.view.cur));
  const fb = frame(p);
  check("...the bar line carries it", fb.indexOf("cat one.txt") >= 0, fb);

  //  ---- Enter runs the spell ----------------------------------------------
  send("\r");
  check("Enter on the button pushes a view",
        pump(p, function () { return p.stack.length === 1; }), "stack " + p.stack.length);
  check("...the view the SPELL named, not the row's",
        p.view.path === "cat one.txt", p.view.path);
  send("a");
  pump(p, function () { return p.stack.length === 0; });

  //  ---- a look-only button falls through to the row ------------------------
  p.view.cur.row = 2; p.view.cur.tok = 2;
  frame(p);
  send("\r");
  check("Enter on a spell-less button still opens something",
        pump(p, function () { return p.stack.length === 1; }), "stack " + p.stack.length);
  check("...namely the ROW's own target — the empty spell fell through",
        p.view.path === "cat two.txt", p.view.path);

  //  ---- a CLICK on the face runs the same spell ----------------------------
  //  Screen row 3 is rows[2]; `row2 [cat] [nil]` puts the faces at cols 7 / 13.
  const pc = pager();
  send(ESC + "[<0;7;3M");
  check("a click on the button face pushes",
        pump(pc, function () { return pc.stack.length === 1; }), "stack " + pc.stack.length);
  check("...the spell's view", pc.view.path === "cat one.txt", pc.view.path);

  const pn = pager();
  send(ESC + "[<0;13;3M");
  check("a click on the spell-less face pushes",
        pump(pn, function () { return pn.stack.length === 1; }), "stack " + pn.stack.length);
  check("...falling through to the row", pn.view.path === "cat two.txt", pn.view.path);

  const pu = pager();
  send(ESC + "[<0;2;3M");
  check("a click on the row's nav token pushes",
        pump(pu, function () { return pu.stack.length === 1; }), "stack " + pu.stack.length);
  check("...the `U` target, untouched by the new channel",
        pu.view.path === "cat two.txt", pu.view.path);
} finally {
  tty.cook(pty.slave, saved);
}
io.close(pty.master); io.close(pty.slave); io.close(sink); io.close(tap); io.unlink(FRAMES);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
