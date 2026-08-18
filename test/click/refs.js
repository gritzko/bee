//  lite/test/click/refs.js — LITE-015: a FILE REFERENCE inside a viewed file
//  (`/* see abc/FSW.c */`) is a click-target that opens the file it names.  The
//  REAL UI path: the hunk painted on an actual `tty.openpty()` slave by the
//  shipped Pager, a real SGR mouse press written to the master and read back
//  through the pager's OWN input path, then the pushed view asserted.
//
//  DOG-033 (the tokenizer rule that fuses `dir/base.ext` into one `F` token) is
//  being built in parallel, so the `F` tokens here are BAKED BY HAND (the
//  view/fs.js buildDirHunk / view/log.js precedent) — the click, the door and
//  the FSEG descent are the whole of what this leg exercises.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so a render is
//  followed by a blocking drain.
"use strict";
const pagerlib = require("pager.js");
const entry = require("door.js");        // LITE-045: the door, not the CLI

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

const repo = io.getenv("LITE_FIX3");

//  ---- the viewed file: three references, one `F` token each ---------------
//  `abc/FSW.c` names ONE file, `TCP.c` names TWO, `nosuch/gone.c` none.  Every
//  line opens with the same 7-byte prefix, so the ref starts at COLUMN 8.
const REFS = ["abc/FSW.c", "TCP.c", "nosuch/gone.c"];
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

//  ---- the door ------------------------------------------------------------
//  A partial that stats nowhere must still open: the FSEG descent names it.
const uniq = entry.openTarget("abc/FSW.c");
check("a unique partial opens", uniq !== null && uniq.length === 1,
      uniq === null ? "null" : "hunks " + uniq.length);
check("...as the file the descent named", uniq !== null && ends(uniq[0].uri, "/src/abc/FSW.c"),
      uniq === null ? "null" : uniq[0].uri);
check("...with that file's bytes", uniq !== null &&
      utf8.Decode(uniq[0].text).indexOf("FSWMARK") >= 0);

const many = entry.openTarget("TCP.c");
check("an ambiguous partial is ONE chooser hunk",
      many !== null && many.length === 1 && many[0].kind === "chooser",
      many === null ? "null" : many[0].kind + " x" + many.length);
//  the VISIBLE text of a hunk's `F` spans — what a reader of the rows sees.
function fTexts(hunk) {
  const out = [];
  for (let i = 0; i < hunk.toks.length; i++) {
    if (tag(hunk.toks[i]) !== "F") continue;
    const lo = i > 0 ? (hunk.toks[i - 1] & 0xffffff) : 0, hi = hunk.toks[i] & 0xffffff;
    out.push(utf8.Decode(hunk.text.slice(lo, hi)));
  }
  return out;
}
check("the chooser lists every candidate, repo-relative",
      many !== null && fTexts(many[0]).join(" ") === "net/TCP.c src/abc/TCP.c",
      many === null ? "null" : fTexts(many[0]).join(" "));
check("the chooser banner is the partial AS TYPED",
      many !== null && many[0].uri === "TCP.c", many === null ? "null" : many[0].uri);
check("each chooser row is a visible path + a hidden U target",
      many !== null && tag(many[0].toks[0]) === "F" && tag(many[0].toks[1]) === "U",
      many === null ? "null" : tag(many[0].toks[0]) + tag(many[0].toks[1]));

check("a name no commit carries is a miss", entry.openTarget("nosuch/gone.c") === null);
//  Resolution is PER-COMMIT: an uncommitted file is not in any tree, so it does
//  not resolve — no worktree scan happens here.
check("an uncommitted file does not resolve", entry.openTarget("abc/UNCOMMITTED.c") === null);

//  ---- the REAL click ------------------------------------------------------
const pty = tty.openpty();
tty.setSize(pty.slave, 14, 100);
//  Frames go to a scratch FILE, not the slave: a self-pty has no concurrent
//  reader and macOS blocks a slave write at 1 KB unread (XNU TTYCLSIZE).  The
//  pty stays the tty (size, raw, keys); `sink` takes the paint, `tap` reads it.
const FRAMES = (io.getenv("TMPDIR") || "/tmp") + "/bee-pty-" + io.getpid() + ".frames";
const sink = io.open(FRAMES, "c"), tap = io.open(FRAMES, "r");
const p = new pagerlib.Pager(sink, { tty: pty.slave, color: true, open: entry.openTarget });
p.setHunks([h], "see.c");
const rb = io.buf(1 << 16);
function drain() {                             // to EOF: exactly the new frame
  let s = "";
  for (;;) { rb.reset(); const k = io.read(tap, rb); if (k <= 0) break; s += utf8.Decode(rb.data().slice()); }
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
function click(row, col) { send(ESC + "[<0;" + col + ";" + row + "M"); }
function frame() { p.render(); return drain(); }

const saved = tty.raw(pty.slave);
const R = {};
try {
  R.base = frame();
  //  screen row 1 is the banner band, so ref line i sits on row i+1.
  click(2, COL + 1);
  R.uniqPushed = pump(function () { return p.stack.length === 1; });
  R.uniqUri = p.view.hunks[0].uri;
  R.uniqFrame = frame();
  send("-");
  pump(function () { return p.stack.length === 0; });

  click(3, COL + 1);
  R.chooserPushed = pump(function () { return p.stack.length === 1; });
  R.chooserKind = p.view.hunks[0].kind;
  R.chooserFrame = frame();
  //  the chooser's row 2 (screen row 3) is the SECOND candidate, src/abc/TCP.c
  click(3, 1);
  R.chosen = pump(function () { return p.stack.length === 2; });
  R.chosenUri = p.view.hunks[0].uri;
  R.chosenFrame = frame();
  send("-"); pump(function () { return p.stack.length === 1; });
  send("-"); pump(function () { return p.stack.length === 0; });

  click(4, COL + 1);
  R.missMsg = pump(function () { return p.message !== ""; }) ? p.message : "";
  R.missDepth = p.stack.length;
  R.missFrame = frame();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); io.close(sink); io.close(tap); io.unlink(FRAMES); }

//  the `F` span carries its own colour, so a painted line is `/* see ` + SGR +
//  the reference — assert the pieces, not one contiguous string.
check("the reference lines paint",
      R.base.indexOf("/* see ") >= 0 && R.base.indexOf("abc/FSW.c") >= 0 &&
      R.base.indexOf("nosuch/gone.c") >= 0, R.base.split("\n")[1]);

check("a click on a UNIQUE reference pushed a view", R.uniqPushed, "stack depth");
check("...the file the reference names", ends(R.uniqUri, "/src/abc/FSW.c"), R.uniqUri);
check("...and its bytes are on the screen", R.uniqFrame.indexOf("FSWMARK") >= 0,
      R.uniqFrame.split("\n")[1]);

check("a click on an AMBIGUOUS reference pushed a view", R.chooserPushed, "stack depth");
check("...which is the chooser", R.chooserKind === "chooser", R.chooserKind);
check("...listing both candidates on screen",
      R.chooserFrame.indexOf("net/TCP.c") >= 0 && R.chooserFrame.indexOf("src/abc/TCP.c") >= 0,
      R.chooserFrame);
check("...under the partial as typed, on the banner",
      R.chooserFrame.split("\n")[0].indexOf("TCP.c") >= 0, R.chooserFrame.split("\n")[0]);
check("...with the click targets HIDDEN (no absolute path paints)",
      R.chooserFrame.indexOf(repo + "/") < 0, R.chooserFrame);
check("a click on a chooser row opens THAT file", R.chosen, "stack depth");
check("...the second candidate, as chosen", ends(R.chosenUri, "/src/abc/TCP.c"), R.chosenUri);
check("...and its bytes are on the screen", R.chosenFrame.indexOf("ABCMARK") >= 0,
      R.chosenFrame.split("\n")[1]);

check("a click on a reference that names nothing opens nothing", R.missDepth === 0,
      "stack " + R.missDepth);
check("...and says so in plain words", R.missMsg === "cannot open nosuch/gone.c", R.missMsg);
check("...on the status bar", R.missFrame.indexOf("cannot open nosuch/gone.c") >= 0,
      R.missFrame.split("\n").slice(-1)[0]);

w1((bad ? "FAIL " : "PASS ") + "[lite/refs] " + n + " checks, " + bad + " bad\n");
if (bad) throw "REFS";
