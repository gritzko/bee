//  lite/test/list/pty.js — LITE-017, the REAL UI path for the four read views:
//  a list frame painted on an actual `tty.openpty()` slave by the SHIPPED
//  Pager, then NAVIGATED through the SHIPPED door (main.js's own openTarget) —
//  Enter on a file row lands in `cat`, Enter on a dir row lands in a deeper
//  `list`, Enter on a tree row lands in `blob`, `-` backs out.  fuse.js proves
//  the spans; THIS proves the wiring the user actually touches.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so ONE render is
//  followed by ONE blocking drain, and raw is entered ONCE up front
//  (tty.raw's TCSAFLUSH drops a pre-queued key).  See test/pager/pty.js.
"use strict";
const pagerlib = require("view/pager.js");
const entry = require("main.js");
const ls = require("index/list.js");
const tr = require("index/tree.js");

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

const pty = tty.openpty();
tty.setSize(pty.slave, 12, 100);
const rb = io.buf(1 << 16);
let frames = "";
function drain() {
  rb.reset();
  const k = io.read(pty.master, rb);
  if (k > 0) frames += utf8.Decode(rb.data().slice());
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

//  run.sh cds the fixture repo, so the views open on the cwd repo and every
//  hunk here is the one the CLI would build.
const listHunks = ls.list(undefined).hunks;
const treeHunks = tr.tree(undefined).hunks;

//  The display row a name sits on.  A hunk's FIRST row is its banner band and
//  carries no byte span at all, so it is skipped — slicing on its undefined
//  bounds would hand back the whole hunk and match everything.
function rowOf(p, hunk, want) {
  const rows = p.rows(100);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].banner) continue;
    if (utf8.Decode(hunk.text.slice(rows[i].off, rows[i].end)).indexOf(want) >= 0) return i;
  }
  return -1;
}

const saved = tty.raw(pty.slave);
try {
  const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
  p.setHunks(listHunks, "list");
  const f0 = frame(p);
  check("a list paints a frame", f0.length > 0, "bytes " + f0.length);
  //  The banner band is bro.js's own, carrying the view's name.
  check("the banner band names the view",
        f0.indexOf(ESC + "[38;5;0;48;5;230m") >= 0 && f0.indexOf("list") >= 0,
        f0.split("\n")[0]);
  //  The rows are painted: the marker column, the violet name, the grey
  //  summary and the cyan age all reach the glass.
  check("the wt marker column is painted yellow (E = mod)",
        f0.indexOf(ESC + "[33m") >= 0, f0.split("\n")[1]);
  check("the name column is painted violet (F)", f0.indexOf("38;5;56") >= 0);
  check("the entries and their summaries are on the glass",
        f0.indexOf("a.txt") >= 0 && f0.indexOf("C0 seed a and sub") >= 0 &&
        f0.indexOf("sub/") >= 0 && f0.indexOf("C2 edit sub") >= 0);
  check("the status bar is the pager's own",
        f0.indexOf(ESC + "[7m") >= 0 && f0.indexOf("list#L1") >= 0,
        f0.split("\n").pop());
  //  The hidden nav takes NO column: the rows painted are as wide as the
  //  visible bytes, not the bytes plus the targets.
  check("the hidden nav target takes no column",
        f0.indexOf(io.cwd() + "/a.txt") < 0, f0);

  //  ---- Enter on a FILE row lands in cat -----------------------------------
  const iFile = rowOf(p, listHunks[0], "a.txt");
  check("the a.txt row is on the glass", iFile >= 0, iFile);
  p.view.scroll = iFile;
  send("\r");
  check("Enter on a file row follows",
        pump(p, function () { return p.stack.length === 1; }), "stack " + p.stack.length);
  check("...into a CAT view of that file",
        p.view.hunks[0].kind === "cat" && p.view.hunks[0].uri === "cat a.txt",
        p.view.hunks[0].uri);
  //  Stripped of its paint the frame is the file's own bytes — the UNCOMMITTED
  //  edit included, since cat reads the worktree.
  const fc = frame(p).replace(/\x1b\[[0-9;]*m/g, "");
  check("...and the file's own bytes are on the glass, uncommitted edit and all",
        fc.indexOf("A0") >= 0 && fc.indexOf("A0-dirty") >= 0, fc);
  send("-");
  check("'-' backs out to the browser",
        pump(p, function () { return p.stack.length === 0; }), "stack " + p.stack.length);
  check("...and the browser is what comes back", p.view.hunks[0].kind === "list",
        p.view.hunks[0].kind);

  //  ---- Enter on a DIR row lands in a deeper list --------------------------
  const iDir = rowOf(p, listHunks[0], "sub/");
  p.view.scroll = iDir;
  send("\r");
  check("Enter on a dir row follows",
        pump(p, function () { return p.stack.length === 1; }), "stack " + p.stack.length);
  check("...into a deeper LIST, not out of the browser",
        p.view.hunks[0].kind === "list", p.view.hunks[0].kind);
  const fd = frame(p);
  check("...showing that dir's own entries", fd.indexOf("x.txt") >= 0, fd);
  send("-");
  pump(p, function () { return p.stack.length === 0; });

  //  ---- a TREE row's target opens a BLOB -----------------------------------
  const pt = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
  pt.setHunks(treeHunks, "tree");
  const ft = frame(pt);
  check("a tree paints its fixed rows",
        ft.indexOf("100644 blob") >= 0 && ft.indexOf("040000 tree") >= 0, ft);
  check("the meta prefix is dim and the name violet",
        ft.indexOf(ESC + "[90m") >= 0 && ft.indexOf("38;5;56") >= 0);
  const iRow = rowOf(pt, treeHunks[0], "a.txt");
  check("the a.txt tree row is on the glass", iRow >= 0, iRow);
  pt.view.scroll = iRow;
  send("\r");
  check("Enter on a tree row follows",
        pump(pt, function () { return pt.stack.length === 1; }), "stack " + pt.stack.length);
  check("...into a BLOB view addressed by sha",
        pt.view.hunks[0].kind === "blob" && /^blob [0-9a-f]{40}$/.test(pt.view.hunks[0].uri),
        pt.view.hunks[0].uri);
  const fb = frame(pt).replace(/\x1b\[[0-9;]*m/g, "");
  check("...and the COMMITTED bytes are on the glass (not the dirty worktree)",
        fb.indexOf("A0") >= 0 && fb.indexOf("A0-dirty") < 0, fb);
} finally {
  try { tty.cook(pty.slave, saved); } catch (e) {}
  try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
