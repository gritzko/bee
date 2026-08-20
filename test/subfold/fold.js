//  bee/test/subfold/fold.js — BEE-040: the FILE tallies fold every gitlink sub.
//  One nested fixture (proj ⊃ { s1 ⊃ g, s2 }) read through the REAL
//  view/wtstat.js: the folded numbers must equal the per-repo sums the same
//  `fold` derives one repo at a time, the clean sub must add nothing, an
//  uninitialised mount must add nothing either, and a replay with nothing
//  touched must answer the identical shape (the per-sub rev memo).
//  Driven by run.sh with $SRC_ROOT on the fixture.
"use strict";

const ws = require("view/wtstat.js");
const st = require("view/status.js");
const subs = require("index/subs.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const SRC = io.getenv("SRC_ROOT");
const P = SRC + "/proj", S1 = P + "/s1", S2 = P + "/s2", G = S1 + "/g";

//  ONE repo's own tally, the top-repo-only number BEE-040 found under-reporting.
function own(root) { return ws.fold(st.status("", { from: root }).model.rows); }
function eq3(a, b) { return a.chg === b.chg && a.add === b.add && a.del === b.del; }
function spell3(a) { return "chg " + a.chg + " add " + a.add + " del " + a.del; }
function sum3() {
  const s = { chg: 0, add: 0, del: 0 };
  for (const a of arguments) { s.chg += a.chg; s.add += a.add; s.del += a.del; }
  return s;
}

//  --- 1. the mount spine ------------------------------------------------------
{
  const m = subs.mounts(P);
  check("the parent's mounts come off its HEAD tree, in order",
        m.length === 2 && m[0].path === "s1" && m[1].path === "s2",
        m.map(function (x) { return x.path; }).join(","));
  check("every mount of a checked-out parent is live",
        m.length === 2 && m[0].live === true && m[1].live === true);
  check("a mount whose HEAD sits on the recorded sha owes no bump",
        m.length === 2 && m[0].head === m[0].sha && m[1].head === m[1].sha,
        m.length === 2 ? m[0].head + " vs " + m[0].sha : "?");
  const g = subs.mounts(S1);
  check("the grandchild is the SUB's mount, not the parent's",
        g.length === 1 && g[0].path === "g" && g[0].wt === G,
        g.map(function (x) { return x.path; }).join(","));
  check("a repo with no gitlinks has no mounts", subs.mounts(G).length === 0);
}

//  --- 2. the per-repo tallies the fold must add up to --------------------------
const oP = own(P), oS1 = own(S1), oS2 = own(S2), oG = own(G);
{
  check("the parent's OWN tally is its own three files",
        eq3(oP.un, { chg: 1, add: 1, del: 1 }), spell3(oP.un));
  check("a sub's files are not the parent's untracked rows",
        oP.un.add === 1, spell3(oP.un));
  check("the sub's own tally", eq3(oS1.un, { chg: 2, add: 1, del: 0 }), spell3(oS1.un));
  check("the grandchild's own tally", eq3(oG.un, { chg: 1, add: 0, del: 1 }), spell3(oG.un));
  check("the CLEAN sub tallies zeros", eq3(oS2.un, { chg: 0, add: 0, del: 0 }) &&
        oS2.staged === 0, spell3(oS2.un));
}

//  --- 3. the fold ------------------------------------------------------------
const s = ws.stat(P);
check("the parent's stat is readable", s !== null);
if (s !== null) {
  check("the folded UNSTAGED tally equals the per-repo sums",
        eq3(s.un, sum3(oP.un, oS1.un, oS2.un, oG.un)), spell3(s.un));
  check("the folded tally is the whole tree's, spelled out",
        eq3(s.un, { chg: 4, add: 2, del: 2 }), spell3(s.un));
  check("the folded STAGED tally equals the per-repo sums",
        eq3(s.st, sum3(oP.st, oS1.st, oS2.st, oG.st)) && s.staged === 0, spell3(s.st));
  check("a tree dirty only in a SUB still reads dirty", s.dirty === true);
}
{
  const m = ws.stat(S1);
  check("the sub folds ITS grandchild the same way",
        m !== null && eq3(m.un, sum3(oS1.un, oG.un)), m && spell3(m.un));
  const c = ws.stat(S2);
  check("the clean sub's frame stays blank and silent",
        c !== null && eq3(c.un, { chg: 0, add: 0, del: 0 }) && c.dirty === false,
        c && spell3(c.un));
}

//  --- 4. an uninitialised mount tallies nothing and never errors --------------
{
  const D = SRC + "/dead";
  const m = subs.mounts(D);
  check("a clone's mounts are declared but not live",
        m.length === 2 && m[0].live === false && m[1].live === false,
        m.map(function (x) { return x.path + ":" + x.live; }).join(","));
  const d = ws.stat(D);
  check("an uninitialised sub adds nothing to its parent's tally",
        d !== null && eq3(d.un, { chg: 0, add: 0, del: 0 }) &&
        eq3(d.st, { chg: 0, add: 0, del: 0 }), d && spell3(d.un));
}

//  --- 5. the replay: nothing touched, the very same numbers -------------------
{
  const a = ws.stat(P), b = ws.stat(P);
  check("a replay with nothing touched answers identical counts",
        a !== null && b !== null && eq3(a.un, b.un) && eq3(a.st, b.st) &&
        a.staged === b.staged && eq3(a.un, s.un),
        a && b ? spell3(a.un) + " vs " + spell3(b.un) : "?");
  const f = ws.frames(P), g = ws.frames(P);
  check("and the frames it renders are byte-identical",
        f.file === g.file && f.commit === g.commit, f.file + " vs " + g.file);
  check("the FILE frame shows the FOLDED numbers",
        f.file.indexOf("~4") >= 0 && f.file.indexOf("-2") >= 0 &&
        f.file.indexOf("+2") >= 0, "|" + f.file + "|");
  //  The COMMIT frame stays TOP-repo: ahbeh is the wt's own line (be todo.js:515:TO).
  check("the COMMIT frame is the top repo's own line",
        f.commit === ws.commitFrame(ws.stat(P)), "|" + f.commit + "|");
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "SUBFOLD";
