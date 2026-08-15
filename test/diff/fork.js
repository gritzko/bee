//  test/diff/fork.js — BEE-005: THE REPRO.  A fork history (one path edited on
//  BOTH sides of one base, then merged) is where a blob-pair fold and a weave
//  rooted at the merge base part company: the +/- text can agree, the
//  PROVENANCE cannot.  A pair of loose blobs folded under `ID_FROM`/`ID_TO`
//  knows only "the to-side did it"; the ancestor-rooted weave names the COMMIT
//  that inserted each token — the side branch, not the merge that took it.
//
//  `LITE_FIX` names the fixture repo, `BEE_C0..BEE_C3` its four commits.
//
//    c0  f.txt = one two three four        (the base, the LCA of c1 and c2)
//    c1  line 2 -> TWO                     (master, the merge's FIRST parent)
//    c2  line 3 -> THREE                   (the side branch)
//    c3  merge(c1, c2) = one TWO THREE four
"use strict";
const df = require("view/diff.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got).replace(/\n/g, "\\n") + "\n");
}

const repo = io.getenv("LITE_FIX");
const C = { c0: io.getenv("BEE_C0"), c1: io.getenv("BEE_C1"),
            c2: io.getenv("BEE_C2"), c3: io.getenv("BEE_C3") };
//  the 15-hex hashlet of a sha40 is what a weave layer carries (index/dag.js).
const idx = require("index/index.js");
const HL = {};
for (const k of Object.keys(C)) HL[idx.hexOfHl(idx.hlOfSha(C[k]))] = k;

//  Every token of a hunk as { text, side, who } — `who` is BEE-005's per-token
//  inserting commit, named back to c0..c3 when it is one of the fixture's.
function toksOf(h) {
  const out = [];
  let lo = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const hi = h.toks[i] & 0xffffff, side = (h.toks[i] >>> 24) & 3;
    const who = h.who ? h.who[i] : undefined;
    out.push({ text: utf8.Decode(h.text.slice(lo, hi)), side: side,
               who: who === undefined ? "(none)" : (HL[who] || who || "(anon)") });
    lo = hi;
  }
  return out;
}
function dump(tag, hunks) {
  for (const h of hunks) {
    w1(tag + " hunk " + h.uri + "\n");
    for (const t of toksOf(h))
      if (t.side !== 0 && t.text.trim() !== "")
        w1(tag + "   " + (t.side === 1 ? "+" : "-") + t.text.trim() +
           " <- " + t.who + "\n");
  }
}

//  --- 1. the merge against its FIRST parent ---------------------------------
//  git's own answer is "-three +THREE" and so is bee's; the question the blob
//  pair cannot answer is WHO wrote THREE.  It is c2, the side branch — the
//  merge only took it.
const m = df.diff(C.c3, { from: repo });
dump("merge", m.hunks);
const mt = m.hunks.length ? toksOf(m.hunks[0]) : [];
let thr = null, three = null;
for (const t of mt) {
  if (t.side === 1 && t.text.indexOf("THREE") >= 0) thr = t;
  if (t.side === 2 && t.text === "three") three = t;
}
check("the merge diff still says -three +THREE", thr !== null && three !== null,
      mt.map(function (t) { return t.side + ":" + t.text; }).join("|"));
check("every emitted token carries a who", m.hunks.length > 0 && !!m.hunks[0].who,
      m.hunks.length ? String(m.hunks[0].who) : "(no hunk)");
check("+THREE blames the SIDE BRANCH c2, not the merge",
      thr !== null && thr.who === "c2", thr ? thr.who : "(none)");
check("-three blames the BASE c0 (the token the merge base carried)",
      three !== null && three.who === "c0", three ? three.who : "(none)");

//  --- 2. the two-tip form ---------------------------------------------------
//  Neither tip is an ancestor of the other, so the weave can only be rooted at
//  their merge base: c1's TWO and c2's THREE each blame their own commit.
const two = df.diff(C.c1 + " " + C.c2, { from: repo });
dump("revs", two.hunks);
check("diff <hexA> <hexB> is a form", two.form === "revs" && two.hunks.length > 0,
      two.form + "/" + two.hunks.length);
const tt = two.hunks.length ? toksOf(two.hunks[0]) : [];
let rmTWO = null, inTHREE = null;
for (const t of tt) {
  if (t.side === 2 && t.text.indexOf("TWO") >= 0) rmTWO = t;
  if (t.side === 1 && t.text.indexOf("THREE") >= 0) inTHREE = t;
}
check("-TWO blames c1 (ours), +THREE blames c2 (theirs)",
      rmTWO !== null && rmTWO.who === "c1" && inTHREE !== null && inTHREE.who === "c2",
      (rmTWO ? rmTWO.who : "-") + "/" + (inTHREE ? inTHREE.who : "-"));
//  A layer id is a real commit hashlet, so NO token may blame the old fake
//  ids (`ID_FROM`/`ID_TO`, the 1/2 constants BEE-005 removes).
let fake = 0;
for (const h of two.hunks)
  for (const t of toksOf(h))
    if (t.who === "000000000000001" || t.who === "000000000000002") fake++;
check("no token blames a fake layer id", fake === 0, "fake " + fake);

//  --- 3. the index as a graph reader -----------------------------------------
//  The two graphs the fold rides: the commit dag off CPAR, and the path's own
//  condensed dag off the REV rows.  Both are read by KEY — no tree is walked.
let ln = null;
try { ln = require("index/dag.js"); } catch (e) { ln = null; }
check("the index graph reader is there", ln !== null, "index/dag.js is missing");
if (ln !== null) {
const ctx = idx.openRepo(repo, false);
const ix = idx.openIndex(ctx.gitdir);
try {
  idx.bringUp(ctx, ix, { track: false, tip: C.c3 });
  const hl = function (k) { return idx.hlOfSha(C[k]); };
  check("mergeBase(c1, c2) = c0", ln.mergeBase(ix, hl("c1"), hl("c2")) === hl("c0"),
        String(ln.mergeBase(ix, hl("c1"), hl("c2"))));
  check("mergeBase(c1, c3) = c1 (an ancestor is its own base)",
        ln.mergeBase(ix, hl("c1"), hl("c3")) === hl("c1"), "");
  check("ancestors(c3) = all four commits", ln.ancestors(ix, hl("c3")).size === 4,
        String(ln.ancestors(ix, hl("c3")).size));
  check("every fixture commit is indexed",
        ln.isIndexed(ix, hl("c0")) && ln.isIndexed(ix, hl("c3")), "");
  const pr = ln.pathRevs(ix, "f.txt");
  check("the index holds one rev per path-changing commit", pr.order.length === 4,
        "revs " + pr.order.length);
  const r2 = ln.repsOf(ix, pr, hl("c2"));
  check("repsOf(c2) is c2's own rev", r2.length === 1 &&
        pr.revs.get(r2[0]).commit === hl("c2"), JSON.stringify(r2.map(String)));
  const f = ln.floorRev(pr, ln.repsOf(ix, pr, hl("c1")).concat(r2));
  check("the floor of c1 and c2 is c0's rev",
        f.floor !== null && pr.revs.get(f.floor).commit === hl("c0") &&
        f.above.length === 2, "floor " + f.floor + " above " + f.above.length);
} finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx); }
}

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
