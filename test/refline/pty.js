//  lite/test/refline/pty.js — LITE-024: a ref that carries a LINE lands on it.
//  `abc/FSW.c:12:4` in a viewed file is ONE `F` token (DOG-034 fuses the tail);
//  the door sheds `:12:4` before the fs sees the name and hands the landing back,
//  and the pager scrolls that line into view.  The REAL UI path: a hunk painted
//  on a `tty.openpty()` slave by the shipped Pager, a real SGR press written to
//  the master, the pushed view's FRAME and status bar asserted.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so a render is
//  followed by a blocking drain.
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
const tag = (t) => String.fromCharCode(65 + ((t >>> 27) & 0x1f));
const ends = (s, tail) => typeof s === "string" && s.slice(-tail.length) === tail;

//  ---- the viewed file: four refs, one `F` token each -----------------------
//  Every line opens with the same 7-byte prefix, so the ref starts at COLUMN 8.
const REFS = ["abc/FSW.c:12:4", "abc/FSW.c", "TCP.c:5", "nosuch/gone.c:9"];
const COL = 8;
function refHunk(uri, refs) {
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
  return { uri: uri, verb: "hunk", text: utf8.Encode(text), toks: toks, kind: "file" };
}
const h = refHunk("see.c", REFS);
const repo = io.getenv("LITE_FIX");

//  ---- the DOOR: the tail is shed here, the landing rides the answer --------
const at = entry.openTarget("abc/FSW.c:12:4");
check("a ref with :line:col opens the file", at !== null && at.length === 1,
      at === null ? "null" : "hunks " + at.length);
check("...the one the FSEG descent named, tail SHED",
      at !== null && ends(at[0].uri, "/src/abc/FSW.c"), at === null ? "null" : at[0].uri);
check("...and the landing rides back", at !== null && at.land &&
      at.land.line === 12 && at.land.col === 4,
      at === null ? "null" : JSON.stringify(at.land || null));

const lineOnly = entry.openTarget("abc/FSW.c:12");
check("a ref with :line only lands with no column",
      lineOnly !== null && lineOnly.land && lineOnly.land.line === 12 && lineOnly.land.col === 0,
      lineOnly === null ? "null" : JSON.stringify(lineOnly.land || null));

const bare = entry.openTarget("abc/FSW.c");
check("a ref with NO tail carries no landing",
      bare !== null && !bare.land, bare === null ? "null" : JSON.stringify(bare.land || null));

//  a lone colon is not a tail (`b.c:` never fuses one either)
const colon = entry.openTarget("abc/FSW.c:");
check("a trailing lone colon is not a landing", colon === null, colon === null ? "null" : "opened");

check("a suffixed name no commit carries is still a miss",
      entry.openTarget("nosuch/gone.c:9") === null);

//  ---- the CHOOSER keeps the tail ------------------------------------------
const many = entry.openTarget("TCP.c:5");
check("an ambiguous suffixed ref is ONE chooser hunk",
      many !== null && many.length === 1 && many[0].kind === "chooser",
      many === null ? "null" : many[0].kind + " x" + many.length);
check("...bannered with the ref AS TYPED, tail and all",
      many !== null && many[0].uri === "TCP.c:5", many === null ? "null" : many[0].uri);
//  the hidden `U` spans — the bytes a row click hands back to the door.
function uTexts(hunk) {
  const out = [];
  for (let i = 0; i < hunk.toks.length; i++) {
    if (tag(hunk.toks[i]) !== "U") continue;
    const lo = i > 0 ? (hunk.toks[i - 1] & 0xffffff) : 0, hi = hunk.toks[i] & 0xffffff;
    out.push(utf8.Decode(hunk.text.slice(lo, hi)));
  }
  return out;
}
const us = many === null ? [] : uTexts(many[0]);
check("...and every chooser row CARRIES the tail",
      us.length === 2 && ends(us[0], "/net/TCP.c:5") && ends(us[1], "/src/abc/TCP.c:5"),
      us.join(" "));

//  ---- the REAL click ------------------------------------------------------
const pty = tty.openpty();
tty.setSize(pty.slave, 14, 100);
const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
p.setHunks([h], "see.c");
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
//  the i-th PAINTED row of a frame (row 0 is the top of the viewport — the hunk
//  banner band only while the view is unscrolled).
function frameRow(f, i) { return f.split("\r\n")[i] || ""; }
function bar(f) { const l = f.split("\r\n"); return l[l.length - 1] || ""; }

const saved = tty.raw(pty.slave);
const R = {};
try {
  R.base = frame();
  //  screen row 1 is the banner band, so ref line i sits on row i+1.
  click(2, COL + 1);
  R.landed = pump(function () { return p.stack.length === 1; });
  R.landScroll = p.view.scroll;
  R.landCur = p.view.cur ? p.view.cur.row : -1;
  R.landFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(3, COL + 1);
  R.topPushed = pump(function () { return p.stack.length === 1; });
  R.topScroll = p.view.scroll;
  R.topFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  //  the `:` bar rides the SAME door — a typed ref lands identically.
  send(":src/abc/FSW.c:12\r");
  R.barPushed = pump(function () { return p.stack.length === 1; });
  R.barScroll = p.view.scroll;
  R.barFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(4, COL + 1);
  R.chooserPushed = pump(function () { return p.stack.length === 1; });
  R.chooserFrame = frame();
  //  the chooser's row 2 (screen row 3) is the SECOND candidate, src/abc/TCP.c
  click(3, 1);
  R.chosen = pump(function () { return p.stack.length === 2; });
  R.chosenUri = p.view.hunks[0].uri;
  R.chosenScroll = p.view.scroll;
  R.chosenFrame = frame();
  send("-"); pump(function () { return p.stack.length === 1; });
  send("-"); pump(function () { return p.stack.length === 0; });

  click(5, COL + 1);
  R.missMsg = pump(function () { return p.message !== ""; }) ? p.message : "";
  R.missDepth = p.stack.length;
  R.missFrame = frame();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }

check("the suffixed reference lines paint",
      R.base.indexOf("abc/FSW.c:12:4") >= 0 && R.base.indexOf("nosuch/gone.c:9") >= 0,
      R.base.split("\r\n")[1]);

check("a click on a :line:col ref pushed a view", R.landed, "stack depth");
//  LITE-024: the landed line sits 1/4 down the 12-row page (3), cursor on it.
check("...SCROLLED to 1/4 above the line", R.landScroll === 9, "scroll " + R.landScroll);
check("...so line 12 is the 4th body row", frameRow(R.landFrame, 3).indexOf("FSWMARK12") >= 0,
      frameRow(R.landFrame, 3));
check("...the CURSOR parked on it", R.landCur === 12, "cur.row " + R.landCur);
check("...and the bar names the top #L9", bar(R.landFrame).indexOf("#L9") >= 0, bar(R.landFrame));

check("a click on the SAME ref without a tail opens at the top",
      R.topPushed && R.topScroll === 0, "scroll " + R.topScroll);
check("...line 1 on the first body row", frameRow(R.topFrame, 1).indexOf("FSWMARK1") >= 0 &&
      frameRow(R.topFrame, 1).indexOf("FSWMARK12") < 0, frameRow(R.topFrame, 1));

check("a ref TYPED on the `:` bar lands the same way",
      R.barPushed && R.barScroll === 9, "scroll " + R.barScroll);
check("...line 12 on the 4th body row", frameRow(R.barFrame, 3).indexOf("FSWMARK12") >= 0,
      frameRow(R.barFrame, 3));

check("a click on an AMBIGUOUS suffixed ref pushed the chooser", R.chooserPushed, "stack depth");
check("...bannered with the ref as typed", frameRow(R.chooserFrame, 0).indexOf("TCP.c:5") >= 0,
      frameRow(R.chooserFrame, 0));
check("...with the suffixed row targets HIDDEN (no absolute path paints)",
      R.chooserFrame.indexOf(repo + "/") < 0, frameRow(R.chooserFrame, 1));
check("a click on a chooser row opens THAT file", R.chosen, "stack depth");
check("...the second candidate, as chosen", ends(R.chosenUri, "/src/abc/TCP.c"), R.chosenUri);
check("...LANDED on line 5, the tail the row carried", R.chosenScroll === 2,
      "scroll " + R.chosenScroll);
check("...so line 5 is the 4th body row", frameRow(R.chosenFrame, 3).indexOf("ABCMARK5") >= 0,
      frameRow(R.chosenFrame, 3));

//  ---- the same click, on the LEXER's own token -----------------------------
//  No hand-baked toks: `src/see.c` is opened through the shipped door and its
//  `F` span is whatever DOG-034's rule fused — the whole chain, lexer to scroll.
const real = entry.openTarget("src/see.c");
const rtoks = real === null ? [] : (function (hunk) {
  const out = [];
  for (let i = 0; i < hunk.toks.length; i++) {
    if (tag(hunk.toks[i]) !== "F") continue;
    const lo = i > 0 ? (hunk.toks[i - 1] & 0xffffff) : 0, hi = hunk.toks[i] & 0xffffff;
    out.push(utf8.Decode(hunk.text.slice(lo, hi)));
  }
  return out;
})(real[0]);
check("the LEXER fuses `abc/FSW.c:12:4` into one F token",
      rtoks.length === 1 && rtoks[0] === "abc/FSW.c:12:4", rtoks.join(" "));

const pty2 = tty.openpty();
tty.setSize(pty2.slave, 14, 100);
const p2 = new pagerlib.Pager(pty2.slave, { color: true, open: entry.openTarget });
p2.setHunks(real, "src/see.c");
const saved2 = tty.raw(pty2.slave);
let realScroll = -1, realFrame = "";
try {
  p2.render(); rb.reset(); io.read(pty2.master, rb);
  kbuf.reset(); kbuf.feed(utf8.Encode(ESC + "[<0;" + (COL + 1) + ";2M"));
  io.writeAll(pty2.master, kbuf);
  for (let r = 0; r < 40 && p2.stack.length === 0; r++) {
    krb.reset();
    const m = io.read(pty2.slave, krb);
    if (m > 0) p2._feed(krb.data().slice());
  }
  realScroll = p2.view.scroll;
  p2.render(); rb.reset();
  const k = io.read(pty2.master, rb);
  realFrame = k > 0 ? utf8.Decode(rb.data().slice()) : "";
} finally { tty.cook(pty2.slave, saved2); io.close(pty2.master); io.close(pty2.slave); }

check("a click on THAT token lands on line 12", realScroll === 9, "scroll " + realScroll);
check("...line 12 painted 4th from the top", frameRow(realFrame, 3).indexOf("FSWMARK12") >= 0,
      frameRow(realFrame, 3));

check("a suffixed ref that names nothing opens nothing", R.missDepth === 0,
      "stack " + R.missDepth);
check("...and says so in plain words, the ref as written",
      R.missMsg === "cannot open nosuch/gone.c:9", R.missMsg);
check("...on the status bar", R.missFrame.indexOf("cannot open nosuch/gone.c:9") >= 0,
      bar(R.missFrame));

//  ---- the NO-GIT leg (LITE-024): a plain dir still resolves a ref ----------
//  No .git anywhere up from LITE_NOGIT — the bounded fs walk names the file
//  the ref stands for, and the landing rides exactly as in the git leg.
const nogit = io.getenv("LITE_NOGIT");
const cd0 = io.cwd();
io.chdir(nogit);
const ng = entry.openTarget("log0.js:20");
check("NO-GIT: the fs walk resolves the ref", ng !== null && ng.length === 1 &&
      ends(String(ng[0].uri), "/deep/log0.js"), ng === null ? "null" : String(ng[0].uri));
check("...the landing rides back", ng !== null && ng.land && ng.land.line === 20,
      ng === null ? "null" : JSON.stringify(ng.land || null));
check("NO-GIT: an unmatched ref stays a quiet null", entry.openTarget("gone.js:9") === null,
      "opened");

const ngh = entry.openTarget("note.c");
const pty3 = tty.openpty();
tty.setSize(pty3.slave, 14, 100);
const p3 = new pagerlib.Pager(pty3.slave, { color: true, open: entry.openTarget });
p3.setHunks(ngh, "note.c");
const saved3 = tty.raw(pty3.slave);
let ngScroll = -1, ngUri = "";
try {
  p3.render(); rb.reset(); io.read(pty3.master, rb);
  kbuf.reset(); kbuf.feed(utf8.Encode(ESC + "[<0;" + (COL + 1) + ";2M"));
  io.writeAll(pty3.master, kbuf);
  for (let r = 0; r < 40 && p3.stack.length === 0; r++) {
    krb.reset();
    const m = io.read(pty3.slave, krb);
    if (m > 0) p3._feed(krb.data().slice());
  }
  ngScroll = p3.view.scroll;
  ngUri = p3.view.hunks && p3.view.hunks[0] ? String(p3.view.hunks[0].uri) : "";
} finally { tty.cook(pty3.slave, saved3); io.close(pty3.master); io.close(pty3.slave); }
io.chdir(cd0);
check("NO-GIT: the click opens deep/log0.js", ends(ngUri, "/deep/log0.js"), ngUri);
check("...landed 1/4 above line 20", ngScroll === 17, "scroll " + ngScroll);

w1((bad ? "FAIL " : "PASS ") + "[lite/refline] " + n + " checks, " + bad + " bad\n");
if (bad) throw "REFLINE";
