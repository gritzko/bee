//  lite/test/commitnav/pty.js — LITE-021, the REAL UI path: the commit page on
//  an actual `tty.openpty()` slave through the SHIPPED Pager, driven by real
//  keys and a real SGR mouse press read back through the pager's own input.
//
//  Enter on the tree row opens the tree listing, `-` backs out to the commit
//  page, a CLICK on a parent sha opens that parent's own commit page.  The
//  hidden target bytes must never reach the screen (test/click/click.js's
//  precedent, stepped not run()).
"use strict";
const pagerlib = require("view/pager.js");
const entry = require("main.js");

const ESC = "\x1b";
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

const SHA = io.getenv("LITE_SHA"), TREE = io.getenv("LITE_TREE");
const P1 = io.getenv("LITE_P1");

const hunks = entry.openTarget("commit " + SHA);
const pty = tty.openpty();
tty.setSize(pty.slave, 20, 120);
const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
p.setHunks(hunks, "commit " + SHA);

const rb = io.buf(1 << 16);
function drain() { rb.reset(); const k = io.read(pty.master, rb); return k > 0 ? utf8.Decode(rb.data().slice()) : ""; }
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
const frame1 = drain();
//  the painted tree row, SGR stripped (the field name and the sha are different
//  colour slots, so the escapes sit between them).
const l1 = frame1.split("\n").map(function (l) {
  return l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").replace(/ +$/, "");
});
let bareTree = "";
for (const l of l1) if (l.indexOf("tree " + TREE) === 0) { bareTree = l; break; }
check("the-tree-row-is-painted", bareTree.length > 0, l1.length + " lines");
//  the hidden `tree <sha>` target rides the same bytes and must take NO column:
//  the row is the plain line, the sha appearing exactly once.
check("the-hidden-target-never-paints", bareTree === "tree " + TREE, bareTree);

const saved = tty.raw(pty.slave);
let entered = false, backed = false, clicked = false;
let tv = null, cv = null;
try {
  //  rows[0] is the banner band, rows[1] the `commit <sha40>` line, rows[2] the
  //  tree row — Enter follows the row at the scroll cursor, so `jj` then CR.
  send("jj\r");
  entered = pump(function () { return p.stack.length > 0; });
  if (entered) tv = p.view;
  p.render(); drain();
  //  `-` pops back to the commit page.
  send("-");
  backed = pump(function () { return p.stack.length === 0; });
  p.render(); drain();
  //  a plain left press INSIDE the first parent's sha.  scroll is back at 2
  //  (the `-` restored the saved view), so screen row 1 = rows[2] = the tree
  //  row and screen row 2 = rows[3] = the first parent; `g` re-tops it first so
  //  the geometry is the opening one: rows[0] banner … rows[3] parent 1.
  send("g");
  pump(function () { return p.view.scroll === 0; });
  send(ESC + "[<0;12;4M");                 // row 4 = rows[3], col 12 = mid-sha
  clicked = pump(function () { return p.stack.length > 0; });
  if (clicked) cv = p.view;
  p.render(); drain();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }

check("Enter-on-the-tree-row-pushed-a-view", entered, "stack " + p.stack.length);
if (entered && tv) {
  check("the-pushed-view-is-the-TREE-listing", tv.path === "tree " + TREE &&
        tv.hunks[0].kind === "tree", tv.path + " / " + tv.hunks[0].kind);
  const row0 = utf8.Decode(tv.hunks[0].text.slice(0, 60));
  check("its-first-row-is-a-git-tree-row",
        /^[0-7]{6} (tree|blob|commit) +[0-9a-f]{40}\t/.test(row0), row0);
}
//  `backed` is the state right after the key — the click below pushes again.
check("`-`-backed-out-to-the-commit-page", backed, "stack " + p.stack.length);
check("a-click-on-a-parent-sha-pushed-a-view", clicked, "stack " + p.stack.length);
if (clicked && cv) {
  check("the-pushed-view-is-THAT-parent's-commit-page",
        utf8.Decode(cv.hunks[0].text.slice(0, 47)) === "commit " + P1,
        utf8.Decode(cv.hunks[0].text.slice(0, 47)));
}

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
