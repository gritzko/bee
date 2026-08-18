//  bee/test/status/quad.js — BEE-022: the PURE quad model, headless.
//  The repro: bee had no quad at all, so a path's story took three verbs
//  (`list`'s 3-char marker, `diff`, a `log` read) and never named the
//  upstream.  This pins the model alone — four sorted path->sha listings in,
//  `.xov` rows + commit rows + counts out, no repo and no globals.  The quad
//  is a LADDER (ruling 2026-08-18): each column reads against its NEIGHBOUR,
//  so there is no merge base here and no unrelated-histories case; columns 1
//  and 2 are one comparison from both ends and `o`/`x` carries the DIRECTION.
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
const track = L({ a: "2", b: "1", c: "1", d: "1" });          // the upstream tip
const base  = L({ a: "1", b: "1", c: "1", f: "1" });          // HEAD
const stage = L({ a: "1", b: "2", c: "1", e: "9", f: "1" });
const wt    = L({ a: "3", b: "2", e: "9", f: "1" });          // c gone on disk

const m = q.quadModel({ track: track, base: base, stage: stage, wt: wt });
const Q = quads(m);
check("an upstream edit lights BOTH ends of rung 1-2", Q.a === "vv.v", Q.a);
check("a staged edit is `..v.` — the worktree matches the index", Q.b === "..v.", Q.b);
check("a file gone from the disk alone is `...x`", Q.c === "...x", Q.c);
check("a path in origin but NOT in HEAD reads `o` then `x`", Q.d === "ox..", Q.d);
check("...and the reverse spells it the other way round", Q.f === "xo..", Q.f);
check("a staged add is `..o.`", Q.e === "..o.", Q.e);
check("an all-`.` path gets no row at all", m.rows.length === 6, m.rows.length);
check("rows come out lex by path",
      m.rows.map(function (r) { return r.path; }).join(",") === "a,b,c,d,e,f");

//  The counts are per-column tallies, the summary line's own segments.
check("counts tally per column",
      m.counts.track === 3 && m.counts.head === 3 &&
      m.counts.stage === 2 && m.counts.wt === 2, JSON.stringify(m.counts));

//  --- the ladder has no root ------------------------------------------------
//  A change committed locally and pushed nowhere lights rungs 1 and 2 and
//  NOTHING local; two tips that never met are a legal quad, not an error.
const m2 = q.quadModel({ track: L({ g: "1" }), base: L({ g: "2" }),
                         stage: L({ g: "2" }), wt: L({ g: "2" }) });
check("an unpushed commit reads `vv..`", quads(m2).g === "vv..",
      JSON.stringify(quads(m2)));
const m3 = q.quadModel({ track: L({ p: "1" }), base: L({ r: "1" }),
                         stage: L({ r: "1" }), wt: L({ r: "1" }) });
check("histories that never met render, they do not throw",
      quads(m3).p === "ox.." && quads(m3).r === "xo..", JSON.stringify(quads(m3)));

//  --- the conflict flag -----------------------------------------------------
const m4 = q.quadModel({ track: L({ h: "2" }), base: L({ h: "3" }),
                         stage: L({ h: "3" }), wt: L({ h: "4" }),
                         con: new Set(["h"]) });
check("a conflicted path carries the con flag", m4.rows[0].con === true);
check("...and is tallied under con", m4.counts.con === 1);

//  --- [GIT-032] absent: rung 3 is all-`.`, rung 4 stands on HEAD ------------
const m5 = q.quadModel({ track: L({ i: "1" }), base: L({ i: "1" }),
                         stage: null, wt: L({ i: "2" }) });
check("with no stage reader the 3rd char is `.`", quads(m5).i === "...v",
      JSON.stringify(quads(m5)));
check("...and the model SAYS the column is absent", m5.noStage === true);

//  --- the commit rows, the same reading one level up ------------------------
const m6 = q.quadModel({ track: [], base: [], stage: [], wt: [],
                         ahead: [{ hashlet: "aaa", subject: "mine", ts: 2 }],
                         behind: [{ hashlet: "bbb", subject: "theirs", ts: 1 }] });
check("a local unposted commit is `.o..`", m6.commits[0].quad === ".o..",
      m6.commits[0].quad);
check("an unabsorbed upstream commit is `o...`", m6.commits[1].quad === "o...",
      m6.commits[1].quad);

//  --- no upstream: track = HEAD, so the first two columns are blank ---------
const m7 = q.quadModel({ track: L({ j: "1" }), base: L({ j: "1" }),
                         stage: L({ j: "1" }), wt: L({ j: "2" }) });
check("no upstream leaves rungs 1 and 2 blank", quads(m7).j === "...v",
      JSON.stringify(quads(m7)));

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "quad: " + bad + " checks failed";
