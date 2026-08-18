//  bee/test/status/quad.js — BEE-022: the PURE quad model, headless.
//  The repro: bee had no quad at all, so a path's story took three verbs
//  (`list`'s 3-char marker, `diff`, a `log` read) and never named the
//  upstream.  This pins the model alone — four sorted path->sha listings in,
//  `.xov` rows + commit rows + counts out, no repo and no globals.  Column 1
//  stands on the FORK POINT (ruling 2026-08-18b), columns 2..4 on the tip to
//  their left, so a commit only WE made leaves column 1 `.` — the whole point
//  of that ruling.  Two tips that never met have no fork: the root listing is
//  empty and every path reads `o`, still a legal quad and never a throw.
"use strict";
const q = require("view/quad.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
function L(o) {
  const out = [];
  for (const p of Object.keys(o).sort()) out.push({ path: p, sha: o[p] });
  return out;
}
function quads(m) {
  const o = {};
  for (const r of m.rows) o[r.path] = r.quad;
  return o;
}

//  --- the four rungs, one path each -----------------------------------------
//  `a` the upstream edited, `f` we added, `d` the upstream added: only `a` and
//  `d` may light column 1, since only they are the upstream's own doing.
const root  = L({ a: "1", b: "1", c: "1" });                  // the fork point
const track = L({ a: "2", b: "1", c: "1", d: "1" });          // the upstream tip
const base  = L({ a: "1", b: "1", c: "1", f: "1" });          // HEAD
const stage = L({ a: "1", b: "2", c: "1", e: "9", f: "1" });
const wt    = L({ a: "3", b: "2", e: "9", f: "1" });          // c gone on disk

const m = q.quadModel({ root: root, track: track, base: base,
                        stage: stage, wt: wt });
const Q = quads(m);
check("an upstream edit lights BOTH ends of rung 1-2", Q.a === "vv.v", Q.a);
check("a staged edit is `..v.` — the worktree matches the index", Q.b === "..v.", Q.b);
check("a file gone from the disk alone is `...x`", Q.c === "...x", Q.c);
check("a path in origin but NOT in HEAD reads `o` then `x`", Q.d === "ox..", Q.d);
check("a path WE added leaves column 1 alone", Q.f === ".o..", Q.f);
check("a staged add is `..o.`", Q.e === "..o.", Q.e);
check("an all-`.` path gets no row at all", m.rows.length === 6, m.rows.length);
check("rows come out lex by path",
      m.rows.map(function (r) { return r.path; }).join(",") === "a,b,c,d,e,f");

//  The counts are per-column tallies, the summary line's own segments.
check("counts tally per column",
      m.counts.track === 2 && m.counts.head === 3 &&
      m.counts.stage === 2 && m.counts.wt === 2, JSON.stringify(m.counts));

//  --- the fork point is what keeps our own commits out of column 1 ----------
//  A change committed locally and pushed nowhere is OURS, so column 1 stays
//  `.`; two tips that never met have no fork at all and still render.
const m2 = q.quadModel({ root: L({ g: "1" }), track: L({ g: "1" }),
                         base: L({ g: "2" }),
                         stage: L({ g: "2" }), wt: L({ g: "2" }) });
check("an unpushed commit leaves column 1 `.`", quads(m2).g === ".v..",
      JSON.stringify(quads(m2)));
const m3 = q.quadModel({ root: [], track: L({ p: "1" }), base: L({ r: "1" }),
                         stage: L({ r: "1" }), wt: L({ r: "1" }) });
check("histories that never met render, they do not throw",
      quads(m3).p === "ox.." && quads(m3).r === ".o..", JSON.stringify(quads(m3)));

//  --- the conflict flag -----------------------------------------------------
const m4 = q.quadModel({ root: L({ h: "1" }),
                         track: L({ h: "2" }), base: L({ h: "3" }),
                         stage: L({ h: "3" }), wt: L({ h: "4" }),
                         con: new Set(["h"]) });
check("a conflicted path carries the con flag", m4.rows[0].con === true);
check("...and is tallied under con", m4.counts.con === 1);

//  --- [GIT-032] absent: rung 3 is all-`.`, rung 4 stands on HEAD ------------
const m5 = q.quadModel({ root: L({ i: "1" }), track: L({ i: "1" }),
                         base: L({ i: "1" }),
                         stage: null, wt: L({ i: "2" }) });
check("with no stage reader the 3rd char is `.`", quads(m5).i === "...v",
      JSON.stringify(quads(m5)));
check("...and the model SAYS the column is absent", m5.noStage === true);

//  --- the commit rows, the same reading one level up ------------------------
const m6 = q.quadModel({ root: [], track: [], base: [], stage: [], wt: [],
                         ahead: [{ hashlet: "aaa", subject: "mine", ts: 2 }],
                         behind: [{ hashlet: "bbb", subject: "theirs", ts: 1 }] });
check("a local unposted commit is `.o..`", m6.commits[0].quad === ".o..",
      m6.commits[0].quad);
check("an unabsorbed upstream commit is `o...`", m6.commits[1].quad === "o...",
      m6.commits[1].quad);

//  --- no upstream: track = HEAD, so the first two columns are blank ---------
const m7 = q.quadModel({ root: L({ j: "1" }), track: L({ j: "1" }),
                         base: L({ j: "1" }),
                         stage: L({ j: "1" }), wt: L({ j: "2" }) });
check("no upstream leaves rungs 1 and 2 blank", quads(m7).j === "...v",
      JSON.stringify(quads(m7)));

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "quad: " + bad + " checks failed";
