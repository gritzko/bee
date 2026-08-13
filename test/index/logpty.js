//  lite/test/index/logpty.js — LITE-007 ruling 2026-08-13, the REAL UI path:
//  the log hunk painted on an actual `tty.openpty()` slave by the shipped
//  Pager, with the frame read back off the master and asserted.  A headless
//  paint check (logcolor.js) proves the spans; THIS proves the wiring — banner
//  band, coloured body rows, status bar — is the same one a file arg gets.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so ONE render is
//  followed by ONE blocking drain (lite/test/pager/pty.js's note).
"use strict";
const pagerlib = require("view/pager.js");
const lg = require("index/log.js");

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

const pty = tty.openpty();
tty.setSize(pty.slave, 10, 100);
const p = new pagerlib.Pager(pty.slave, { color: true });
p.setHunks([h]);
p.render();
const rb = io.buf(1 << 16);
const k = io.read(pty.master, rb);
const frame = k > 0 ? utf8.Decode(rb.data().slice()) : "";
const lines = frame.split("\n");

check("frame-painted", frame.length > 0, "bytes " + frame.length);
//  The banner band is bro.js's own THEME_BANNER (black on cream) carrying the
//  log's uri — the SAME band a file hunk gets.
check("banner-band-carries-the-log-uri",
      lines[0].indexOf(ESC + "[38;5;0;48;5;230m") >= 0 &&
      lines[0].indexOf("log") >= 0, lines[0]);
//  Row 1 of the body is the newest commit, painted with the be-log palette.
const body = lines[1] || "";
check("body-row-opens-with-the-L-slot", body.indexOf(ESC + "[") === 0, body);
check("body-row-carries-summary-and-author",
      body.indexOf(out.parts[0].summary) > 0 &&
      body.indexOf(out.parts[0].authTail) > 0, body);
//  ...the pager terminates a tty row with CR, so strip those with the SGRs.
check("body-row-strips-back-to-the-plain-row",
      body.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "") === out.rows[0],
      body.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, ""));
//  The inverse status bar is the pager's, with the hunk uri and the position.
//  `ALL` when the whole log fits the viewport, `TOP` when it scrolls.
check("status-bar-is-the-pager's",
      frame.indexOf(ESC + "[7m") > 0 &&
      (frame.indexOf("ALL") > 0 || frame.indexOf("TOP") > 0),
      lines[lines.length - 1]);
check("status-bar-names-the-log-hunk",
      frame.indexOf("log#L1") > 0, lines[lines.length - 1]);

try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
