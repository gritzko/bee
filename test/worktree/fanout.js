//  bee/test/worktree/fanout.js — BEE-009: ONE repository is ONE mount.
//  A LEGACY registry (BEE-001 landed the redirect only in `install`, so a bare
//  `bee` run inside a `git worktree` checkout wrote that path too) is healed at
//  RESOLVE time: `index/mount.js` folds a worktree family, so an ordinary
//  filename resolves ONCE and `door.seatOf` answers a seat, not the {rels}
//  chooser `http.js:2Yp:7s1h` drops to plain painted text.
//
//  $BEE_MAIN the main worktree, $BEE_WT the linked one, both registered.
"use strict";
const door = require("door.js");
const mnt = require("index/mount.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const MAIN = io.getenv("BEE_MAIN"), WT = io.getenv("BEE_WT");
const rows = door.resolvePartial("render/html.js") || [];
const seat = door.seatOf("render/html.js");

//  THE REPRO.  Unfixed, the family answers TWICE — one row per checkout.
check("a family file resolves ONCE, not once per checkout",
      rows.length === 1, rows.length + ": " + JSON.stringify(rows));
check("...so the door answers a SEAT, not the chooser",
      seat !== null && seat.rels === undefined && !!seat.full,
      seat === null ? "null" : JSON.stringify(seat));
check("...naming the registered repo", rows.length === 1 && rows[0].repo === "main",
      rows.length === 1 ? rows[0].repo : "");

//  The mount table itself: one line per repository, the ambient checkout first.
const tops = mnt.list().filter(function (m) { return m.prefix === ""; });
const fam = tops.filter(function (m) { return m.root === MAIN || m.root === WT; });
check("the worktree family is ONE mount", fam.length === 1,
      JSON.stringify(tops.map(function (m) { return m.name + "@" + m.root; })));
const inWt = io.cwd() === WT;
check(inWt ? "...the ambient checkout, when the reader stands in one"
           : "...the main worktree, when the reader stands elsewhere",
      fam.length === 1 && fam[0].root === (inWt ? WT : MAIN),
      fam.length === 1 ? fam[0].root : "");
//  The NAME is the registered line's, so an authority ref keeps naming the repo.
check("...under the registered repo's name", fam.length === 1 && fam[0].name === "main",
      fam.length === 1 ? fam[0].name : "");
const auth = door.resolvePartial("///main/render/html.js") || [];
check("`///main/render/html.js` resolves in that one mount",
      auth.length === 1 && auth[0].full === fam[0].root + "/render/html.js",
      JSON.stringify(auth));

w1((bad ? "FAIL " : "PASS ") + "[bee/worktree] " + n + " checks, " + bad + " bad\n");
if (bad) throw "WORKTREE";
