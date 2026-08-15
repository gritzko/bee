//  lite/test/commit/pty.js — LITE-009, the REAL UI path: the commit hunk
//  painted on an actual `tty.openpty()` slave by the SHIPPED Pager, with the
//  frame read back off the master and asserted.  color.js proves the spans;
//  THIS proves the wiring — banner band, coloured header rows, status bar — is
//  the one a file arg or a log already gets (index/logpty.js's precedent).
//
//  Stepped, not run(): a self-pty has no concurrent reader, so ONE render is
//  followed by ONE blocking drain (lite/test/pager/pty.js's note).
"use strict";
const pagerlib = require("pager.js");
const cm = require("view/commit.js");

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

const repo = io.getenv("LITE_FIX"), SHA = io.getenv("LITE_SHA");
const out = cm.commit(SHA, { from: repo });
const h = out.hunks[0];      // LITE-045: the metadata hunk leads the view
//  LITE-021: the hunk body carries hidden `U` targets that take no column, so
//  a painted row strips back to the hunk's PLAIN line, not to its body's.
const plain = utf8.Decode(h.plain).split("\n");

const pty = tty.openpty();
tty.setSize(pty.slave, 12, 100);
const p = new pagerlib.Pager(pty.slave, { color: true });
p.setHunks([h]);
p.render();
const rb = io.buf(1 << 16);
const k = io.read(pty.master, rb);
const frame = k > 0 ? utf8.Decode(rb.data().slice()) : "";
const lines = frame.split("\n");

check("frame-painted", frame.length > 0, "bytes " + frame.length);
//  The banner band is render/ansi.js's own THEME_BANNER carrying the commit uri — the
//  SAME band a file hunk gets.
check("banner-band-carries-the-commit-uri",
      lines[0].indexOf(ESC + "[38;5;0;48;5;230m") >= 0 &&
      lines[0].indexOf("commit " + SHA) >= 0, lines[0]);
//  Row 1 of the body is the `commit <sha40>` line, painted R then L.
const body = lines[1] || "";
check("body-row-opens-with-an-SGR", body.indexOf(ESC + "[") === 0, body);
check("body-row-strips-back-to-the-plain-line",
      body.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "") === plain[0],
      body.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, ""));
//  ...and the header rows below it are the object's own, in object order.
const bare = [];
for (let i = 1; i < lines.length; i++)
  bare.push(lines[i].replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, ""));
check("tree-and-both-parent-rows-follow-in-object-order",
      bare[1] === plain[1] && bare[2] === plain[2] && bare[3] === plain[3] &&
      plain[1].indexOf("tree ") === 0 && plain[2].indexOf("parent ") === 0 &&
      plain[3].indexOf("parent ") === 0, bare.slice(0, 4).join(" | "));
//  The field NAME and its value are painted in DIFFERENT slots on a real frame.
check("a-header-row-carries-two-distinct-SGRs",
      (lines[2].match(/\x1b\[[0-9;]*m/g) || []).length >= 2, lines[2]);
//  The inverse status bar is the pager's, with the hunk uri and the position.
check("status-bar-is-the-pager's",
      frame.indexOf(ESC + "[7m") > 0 &&
      (frame.indexOf("ALL") > 0 || frame.indexOf("TOP") > 0),
      lines[lines.length - 1]);
check("status-bar-names-the-commit-hunk",
      frame.indexOf("commit " + SHA + "#L1") > 0, lines[lines.length - 1]);

try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
