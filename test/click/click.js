//  lite/test/click/click.js — a log row's sha8 is a CLICK-TARGET into the
//  commit view.  The REAL UI path: the log hunk painted on an actual
//  `tty.openpty()` slave by the shipped Pager, a real SGR mouse press written
//  to the master and read back through the pager's OWN input path, then the
//  pushed view asserted (test/pager/pty.js's send/pump precedent).
//
//  Stepped, not run(): a self-pty has no concurrent reader, so a render is
//  followed by a blocking drain.
"use strict";
const pagerlib = require("pager.js");
const lg = require("view/log.js");
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

const repo = io.getenv("LITE_FIX");
const out = lg.log(undefined, { from: repo });
const h = lg.hunk(out.uri, out.parts);
const tag = (t) => String.fromCharCode(65 + ((t >>> 27) & 0x1f));

//  ---- the target rides the row, invisibly --------------------------------
check("log-has-rows", out.parts.length >= 2, "rows " + out.parts.length);
check("sha8-token-first", tag(h.toks[0]) === "L", tag(h.toks[0]));
check("hidden-U-target-after-it", tag(h.toks[1]) === "U", tag(h.toks[1]));
const hexlet = out.parts[0].hex;
const target = "commit " + hexlet;
check("target-is-a-15-hex-hashlet", hexlet.length === 15 && /^[0-9a-f]+$/.test(hexlet), hexlet);
//  what the pager reads under the sha8 — the `U` span's bytes, verbatim
const targetAt = pagerlib.Pager.prototype._targetAt.call({}, h, 0);
check("the-target-is-a-verb-line", targetAt === target, targetAt);

//  The target bytes live INSIDE the row's byte span — they are hidden at PAINT
//  time (`U` takes no column), so the frame, not the bytes, is what to assert.
const wrap = require("render/wrap.js");
const rows = wrap.indexRows(h, 200, false);
const row0 = utf8.Decode(h.text.slice(rows[0].off, rows[0].end));
check("row-starts-with-the-sha8", row0.indexOf(out.parts[0].sha8) === 0, row0.slice(0, 20));

//  ---- the door ------------------------------------------------------------
const opened = entry.openTarget(target);
check("door-opens-the-target", opened !== null && opened.length >= 1,
      opened === null ? "null" : "hunks " + opened.length);
check("door-falls-back-to-a-path", entry.openTarget("nosuchfile.txt") === null);

//  ---- the REAL click ------------------------------------------------------
const pty = tty.openpty();
tty.setSize(pty.slave, 14, 100);
//  Frames go to a scratch FILE, not the slave: a self-pty has no concurrent
//  reader and macOS blocks a slave write at 1 KB unread (XNU TTYCLSIZE).  The
//  pty stays the tty (size, raw, keys); `sink` takes the paint, `tap` reads it.
const FRAMES = (io.getenv("TMPDIR") || "/tmp") + "/bee-pty-" + io.getpid() + ".frames";
const sink = io.open(FRAMES, "c"), tap = io.open(FRAMES, "r");
const p = new pagerlib.Pager(sink, { tty: pty.slave, color: true, open: entry.openTarget });
p.setHunks([h], out.uri);
const rb = io.buf(1 << 16);
function drain() {                             // to EOF: exactly the new frame
  let s = "";
  for (;;) { rb.reset(); const k = io.read(tap, rb); if (k <= 0) break; s += utf8.Decode(rb.data().slice()); }
  return s;
}
p.render();
const frame1 = drain();
//  The PAINTED log row: the sha8 then the date — the hidden hashlet must not
//  reach the screen, and the sha8 must not be doubled by it.
const lines1 = frame1.split("\n");
let logline = "";
for (const l of lines1) if (l.indexOf(out.parts[0].sha8) >= 0) { logline = l; break; }
check("the-log-row-is-painted", logline.length > 0, lines1.length + " lines");
check("the-hidden-hashlet-never-paints", logline.indexOf(hexlet) < 0, logline);
check("the-painted-row-carries-the-date",
      logline.indexOf(out.parts[0].date7.trim()) > 0, logline);

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

const saved = tty.raw(pty.slave);
let pushed = false, frame2 = "";
try {
  //  screen row 2 = the FIRST log row (row 1 is the banner band), column 3 is
  //  inside the sha8; a plain left press is SGR button 0.
  send(ESC + "[<0;3;2M");
  pushed = pump(function () { return p.stack.length > 0; });
  p.render(); frame2 = drain();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); io.close(sink); io.close(tap); io.unlink(FRAMES); }

check("click-pushed-a-view", pushed, "stack " + p.stack.length);
if (pushed) {
  const first = p.view.hunks[0];
  check("pushed-view-is-the-commit", utf8.Decode(first.text.slice(0, 7)) === "commit ",
        utf8.Decode(first.text.slice(0, 20)));
  check("it-is-THAT-commit", first.uri.indexOf(hexlet) >= 0 ||
        utf8.Decode(first.text.slice(7, 22)) === hexlet, first.uri);
  check("commit-frame-painted", frame2.length > 0 && frame2.indexOf("commit ") >= 0,
        frame2.split("\n")[0]);
  //  the commit view carries its files under the metadata
  check("files-follow-the-metadata", p.view.hunks.length >= 1,
        "hunks " + p.view.hunks.length);
}

w1((bad ? "FAIL " : "PASS ") + "[lite/click] " + n + " checks, " + bad + " bad\n");
if (bad) throw "CLICK";
