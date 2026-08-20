//  bee/test/actspell/pty.js — BEE-038: the mutation click over a REAL tty, the
//  test/ospell/pty.js discipline verbatim (frames to a scratch file, keys down
//  the pty master, tty.raw entered once).  The smoke the ticket asks for: Enter
//  on a button and a click do the SAME thing — the staged count flips, the
//  screen stays the board (no pushed result page) — and a view spell still navs.
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
const FRAMES = (io.getenv("TMPDIR") || "/tmp") + "/bee-actspell-" + io.getpid() + ".frames";
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

//  Put the fixture index back to empty between the click and the Enter leg, so
//  the SECOND mutation has something of its own to prove.
function unstage() {
  const st = require("stage.js");
  st.run(["git", "-C", st.root(), "reset", "-q"]);
}

let opens = 0;
function open(path, from) {
  if (path === "actspell") { opens++; return [fixture.hunk()]; }
  return door.openTarget(path, from);
}
function pager() {
  const p = new pagerlib.Pager(sink, { tty: pty.slave, color: true, open: open });
  p.setHunks([fixture.hunk()], "actspell");
  frame(p);
  return p;
}

const saved = tty.raw(pty.slave);
try {
  check("the fixture repo starts with nothing staged", fixture.staged() === "",
        fixture.staged());

  //  ---- a CLICK on the button: the staged count flips, the board stays -----
  const pa = pager(), was = opens;
  send(ESC + "[<0;6;3M");                      // `[add]` — screen row 3, col 6
  check("a click on the button RAN the verb",
        pump(pa, function () { return fixture.staged() === "one.txt"; }),
        fixture.staged());
  check("...pushing nothing", pa.stack.length === 0, "stack " + pa.stack.length);
  check("...re-opening this view in place", opens === was + 1, "opens " + opens);
  const f1 = frame(pa);
  check("...so the screen is still the BOARD", f1.indexOf("[add]") >= 0, f1);
  check("...and the report is on the bar", f1.indexOf("add 1 staged") >= 0, f1);

  //  ---- Enter on the same button does the SAME (keyboard parity) -----------
  unstage();
  const p = pager(), was2 = opens;
  send("jjll");
  check("the cursor reaches the `[add]` button",
        pump(p, function () { return p.view.cur.row === 2 && p.view.cur.tok === 1; }),
        p.view.cur.row + "/" + p.view.cur.tok);
  send("\r");
  check("Enter on the button stages it too",
        pump(p, function () { return fixture.staged() === "one.txt"; }),
        fixture.staged());
  check("...pushing nothing either", p.stack.length === 0, "stack " + p.stack.length);
  check("...and refreshing in place", opens === was2 + 1, "opens " + opens);

  //  ---- a click on a VIEW spell still push-navs ---------------------------
  const pc = pager();
  send(ESC + "[<0;18;3M");                     // `[cat]` — screen row 3, col 18
  check("a click on the view button pushes",
        pump(pc, function () { return pc.stack.length === 1; }), "stack " + pc.stack.length);
  check("...the view its spell named", pc.view.path === "cat one.txt", pc.view.path);

  //  ---- a click on the refusing button: words, no page --------------------
  const pr = pager();
  send(ESC + "[<0;12;3M");                     // `[bad]` — bare `push`, no upstream
  check("a refused mutation says so and stays put",
        pump(pr, function () { return pr.message.indexOf("no upstream") >= 0; }),
        pr.message);
  check("...with nothing pushed", pr.stack.length === 0, "stack " + pr.stack.length);
} finally {
  tty.cook(pty.slave, saved);
}
io.close(pty.master); io.close(pty.slave); io.close(sink); io.close(tap); io.unlink(FRAMES);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
