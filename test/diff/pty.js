//  lite/test/diff/pty.js — LITE-010, the REAL UI path: the diff hunks painted
//  on an actual `tty.openpty()` slave by the shipped Pager, with the frame read
//  back off the master and asserted.  color.js proves the spans headless; THIS
//  proves the wiring — banner band per changed file, washed body rows, the
//  status bar carrying the file's own uri with the LIVE line.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so ONE render is
//  followed by ONE blocking drain (lite/test/pager/pty.js's note).
"use strict";
const pagerlib = require("view/pager.js");
const df = require("index/diff.js");

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
const out = df.diff(undefined, { from: repo });

const pty = tty.openpty();
tty.setSize(pty.slave, 16, 100);
const p = new pagerlib.Pager(pty.slave, { color: true });
p.setHunks(out.hunks);
p.render();
const rb = io.buf(1 << 16);
const k = io.read(pty.master, rb);
const frame = k > 0 ? utf8.Decode(rb.data().slice()) : "";
const lines = frame.split("\n");

check("frame-painted", frame.length > 0, "bytes " + frame.length);
//  Row 0 is the first changed file's banner — bro.js's THEME_BANNER band
//  (black on cream), carrying the hunk's own `<path>#L<n>` uri.
check("banner-band-names-the-first-changed-file",
      lines[0].indexOf(ESC + "[38;5;0;48;5;230m") >= 0 &&
      lines[0].indexOf(out.hunks[0].uri) >= 0, lines[0]);
//  The body rows carry the two washes: something is added, something removed.
check("body-carries-the-in-wash", frame.indexOf("48;5;157m") > 0, frame.slice(0, 300));
check("body-carries-the-rm-wash", frame.indexOf("48;5;217m") > 0, frame.slice(0, 300));
//  A second changed file gets its OWN banner in the same view.
if (out.hunks.length > 1)
  check("every-changed-file-gets-a-banner",
        frame.indexOf(out.hunks[1].uri) > 0, "looking for " + out.hunks[1].uri);
//  The status bar is the pager's own, and the LIVE line REPLACES the anchor the
//  diff uri already carries (never `a.txt#L1#L1`).
const bar = lines[lines.length - 1] || "";
check("status-bar-is-the-pager's",
      frame.indexOf(ESC + "[7m") > 0 &&
      (frame.indexOf("ALL") > 0 || frame.indexOf("TOP") > 0), bar);
check("status-bar-carries-ONE-line-anchor",
      /#L[0-9]+ /.test(bar) && bar.indexOf("#L1#L") < 0, bar);

try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
