//  bee/test/logport/pty.js — BEE-020, the REAL UI path: a DESCENDED log on an
//  actual `tty.openpty()` slave through the SHIPPED Pager.  Enter on the first
//  row must open the SUB's own commit — the hunk's `pos` is what carries the
//  ambient from the view to the door (BEE-020:55:Lc), and without it the target
//  resolves in the parent, where no such commit exists.
"use strict";
const pagerlib = require("pager.js");
const entry = require("door.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const S2 = io.getenv("BEE_S2");
const hunks = entry.openTarget("log sub/g.txt");
check("the descended log opens at all", hunks !== null && hunks.length > 0,
      hunks === null ? "null" : hunks.length + " hunks");
if (hunks === null || !hunks.length) { w1("FAILED " + n + " checks\n"); }
else {

const pty = tty.openpty();
tty.setSize(pty.slave, 20, 120);
const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
p.setHunks(hunks, "log sub/g.txt");

const rb = io.buf(1 << 16);
//  One render is ONE write, but the master side may hand it over in pieces (the
//  ldisc flushes off a workqueue; arm64 CI split it) — read until the 19 view
//  rows are in, i.e. every `\r\n` the frame carries; the fds block, so this ends.
const VIEW_ROWS = 19;
function drain() {
  let s = "";
  for (let r = 0; r < 64 && s.split("\r\n").length <= VIEW_ROWS; r++) {
    rb.reset(); const k = io.read(pty.master, rb);
    if (k <= 0) break;
    s += utf8.Decode(rb.data().slice());
  }
  return s;
}
const kbuf = io.buf(64);
function send(s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); }
const krb = io.buf(64);
function pump(done, tries) {
  for (let r = 0; r < (tries || 20); r++) {
    krb.reset();
    const m = io.read(pty.slave, krb);
    if (m > 0) p._feed(krb.data().slice());
    if (done()) return true;
  }
  return done();
}

p.render();
const frame = drain();
const lines = frame.split("\n").map(function (l) {
  return l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").replace(/ +$/, "");
});
//  The hidden `commit <hex>` bytes must take no column: the row is sha8, the
//  date, the summary and the author, and the sha appears once.
let row = "";
for (const l of lines) if (l.indexOf(S2.slice(0, 8) + " ") === 0) { row = l; break; }
check("the sub's tip row is painted, the target hidden",
      row.length > 0 && row.indexOf(S2) < 0 && row.indexOf("s2 tip (T)") > 0, row);

const saved = tty.raw(pty.slave);
let entered = false, ev = null;
try {
  //  rows[0] is the banner band, rows[1] the newest log row: `j` then Enter.
  send("j\r");
  entered = pump(function () { return p.stack.length > 0; });
  if (entered) ev = p.view;
  p.render(); drain();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }

check("Enter on a descended log row pushed a view", entered, "stack " + p.stack.length);
if (entered && ev)
  check("the pushed view is the SUBMODULE's own commit page",
        utf8.Decode(ev.hunks[0].text.slice(0, 47)) === "commit " + S2,
        utf8.Decode(ev.hunks[0].text.slice(0, 47)));

w1((bad ? "FAILED " + bad + " of " : "DONE ") + n + " checks\n");
}
