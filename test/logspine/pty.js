//  lite/test/logspine/pty.js — LITE-020 through the REAL UI path: the log hunk
//  painted on an actual `tty.openpty()` slave by the shipped Pager, the frame
//  read back off the master.  spine.js proves the spans; THIS proves the grey
//  actually reaches the screen — off-spine rows painted in the `Q` slot right
//  next to spine rows still carrying `L` and `G`.
//
//  Stepped, not run(): a self-pty has no concurrent reader, so ONE render is
//  followed by ONE blocking drain (test/index/logpty.js's note).
"use strict";
const pagerlib = require("view/pager.js");
const bro = require("view/bro.js");
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
tty.setSize(pty.slave, 12, 100);
const p = new pagerlib.Pager(pty.slave, { color: true });
p.setHunks([h]);
p.render();
const rb = io.buf(1 << 16);
const k = io.read(pty.master, rb);
const frame = k > 0 ? utf8.Decode(rb.data().slice()) : "";
const lines = frame.split("\n");

check("frame-painted", frame.length > 0, "bytes " + frame.length);

//  The body rows, in render order, under the banner band (line 0).
//  Fixture order: c2, merge, s2, s1, c1, c0 — rows 2 and 3 are the merged-in
//  side chain, everything else is the straight chain.
const body = [];
for (let i = 1; i < lines.length && body.length < out.rows.length; i++)
  body.push(lines[i]);

//  The slots, spelled by lite's OWN theme table — never a hand-rolled SGR.
const Q = bro.deltaSGR(bro.themeAt("Q"), bro.themeAt("S"));   // ESC[90m, the grey
const L = bro.deltaSGR(bro.themeAt("L"), bro.themeAt("S"));   // ESC[96m, the cyan
const G = bro.deltaSGR(bro.themeAt("G"), bro.themeAt("L"));   // the green sep

check("the-theme-Q-slot-is-the-grey-be-uses", Q === ESC + "[90m", Q);

//  A SPINE row opens in the cyan `L` slot and carries the green `G` separator.
check("spine-row-opens-in-the-L-slot", body[0].indexOf(L) === 0, body[0]);
check("spine-row-carries-the-G-separator", body[0].indexOf(G) > 0, body[0]);
//  An OFF-SPINE row opens in the grey `Q` slot and carries NEITHER the cyan
//  nor the green anywhere — the whole row is one colour.
check("LITE-020-off-spine-row-opens-in-the-grey-Q-slot",
      body[2].indexOf(Q) === 0, body[2]);
check("LITE-020-off-spine-row-carries-no-cyan-and-no-green",
      body[2].indexOf(L) < 0 && body[2].indexOf(G) < 0 &&
      body[3].indexOf(L) < 0 && body[3].indexOf(G) < 0, body[2] + " | " + body[3]);
//  ...and the rows below the side chain are back to normal: the split is
//  membership, not a "everything after the merge" cut.
check("the-spine-resumes-below-the-side-chain",
      body[4].indexOf(L) === 0 && body[5].indexOf(L) === 0,
      body[4] + " | " + body[5]);

//  PAINT ONLY: every painted row, grey or not, strips back to its plain row.
let allPlain = true, wrong = "";
for (let i = 0; i < out.rows.length; i++) {
  const bare = body[i].replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
  if (bare !== out.rows[i]) { allPlain = false; wrong = bare + " | " + out.rows[i]; break; }
}
check("LITE-020-every-painted-row-strips-back-to-its-plain-row", allPlain, wrong);

//  The uncoloured paint of an off-spine row has no SGR at all — a `--plain`
//  sink sees no trace of the greying.
const rows = bro.indexRows(h, 100, true);
const p2 = pagerlib.paintRow(h, rows[2].off, rows[2].end, false, rows[2].pass);
check("LITE-020-an-off-spine-row-with-colour-off-is-the-bare-row",
      p2.indexOf(ESC) < 0 && p2 === out.rows[2], p2);

try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
