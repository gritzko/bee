//  bee/test/wtsplit/split.js — BEE-039: the three-state count model.  Four
//  fixture worktrees carry the four states a staging button knows (unstaged
//  only, wholly staged, mixed, clean) and are read through the REAL
//  view/wtstat.js — the derived shape first, then the two frames it renders at
//  be's CI-004 geometry.  The tail is pure: a synthetic stat for the 99 clamp
//  and the diverged pair, and `fold` alone for the quad char no mapping knows.
//  Driven by run.sh with $SRC_ROOT on the fixture and $HOME on its registry.
"use strict";

const ws = require("view/wtstat.js");

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
const BL = "  ";
//  The two geometries spelled ONCE, so no check hand-counts a space run:
//  FILE `[ i <chg> <del> <add> <blank>]`, COMMIT `[ ≡ <push> <pull> <ci>]`.
function fileF(chg, del, add) { return "[ i " + chg + " " + del + " " + add + " " + BL + "]"; }
function commitF(a, b, ci) { return "[ ≡ " + a + " " + b + " " + ci + "]"; }
function pairF(p, ci) { return "[ ≡ " + p + " " + ci + "]"; }
function cells(s) { return Array.from(s).length; }

//  --- 1. the four fixture states --------------------------------------------
const CASES = {
  EMPTY: { un: { chg: 0, add: 0, del: 0 }, st: { chg: 0, add: 0, del: 0 },
           staged: 0, dirty: false, file: fileF(BL, BL, BL), ci: BL },
  //  two edits, one on-disk deletion, one untracked add — none of it staged.
  UN:    { un: { chg: 2, add: 1, del: 1 }, st: { chg: 0, add: 0, del: 0 },
           staged: 0, dirty: true, file: fileF("~2", "-1", "+1"), ci: BL },
  //  one edit, one removal, three adds — all of it staged, so the slots show
  //  the STAGED number and the commit ✓ appears.
  ST:    { un: { chg: 0, add: 0, del: 0 }, st: { chg: 1, add: 3, del: 1 },
           staged: 5, dirty: false, file: fileF("~1", "-1", "+3"), ci: " ✓" },
  //  m1 staged then edited again, m2 edited: 2 unstaged against 1 staged, and
  //  the UNSTAGED number wins the slot while any remains.
  MIX:   { un: { chg: 2, add: 0, del: 0 }, st: { chg: 1, add: 0, del: 0 },
           staged: 1, dirty: true, file: fileF("~2", BL, BL), ci: " ✓" },
};
function eq3(a, b) { return a.chg === b.chg && a.add === b.add && a.del === b.del; }
function spell3(a) { return "chg " + a.chg + " add " + a.add + " del " + a.del; }

for (const k in CASES) {
  const w = CASES[k], root = SRC + "/proj-" + k;
  const s = ws.stat(root);
  check(k + "-is-readable", s !== null);
  if (s === null) continue;
  check(k + "-unstaged-split", eq3(s.un, w.un), spell3(s.un));
  check(k + "-staged-split", eq3(s.st, w.st), spell3(s.st));
  check(k + "-staged-total", s.staged === w.staged, s.staged);
  check(k + "-dirty-flag", s.dirty === w.dirty, s.dirty);
  const f = ws.frames(root);
  check(k + "-file-frame", f.file === w.file, "|" + f.file + "| want |" + w.file + "|");
  check(k + "-commit-frame", f.commit === commitF(BL, BL, w.ci),
        "|" + f.commit + "|");
  check(k + "-frames-are-16-and-13-cells",
        cells(f.file) === ws.FRAMEW_FILE && cells(f.commit) === ws.FRAMEW_COMMIT,
        cells(f.file) + " / " + cells(f.commit));
}

//  --- 2. one status read, no second walk -------------------------------------
//  The split rides the model the memo already holds, so asking twice cannot
//  cost a second read; without a live watcher both runs are misses, and the
//  shape must be identical bytes either way.
{
  const a = ws.frames(SRC + "/proj-MIX"), b = ws.frames(SRC + "/proj-MIX");
  check("the-split-is-stable-across-reads", a.file === b.file && a.commit === b.commit,
        a.file + " vs " + b.file);
}

//  --- 3. an unreadable worktree blanks out, never an error row ---------------
{
  const f = ws.frames(SRC + "/no-such-tree");
  check("an-unreadable-wt-blanks-its-frames",
        f.file === fileF(BL, BL, BL) && f.commit === commitF(BL, BL, BL),
        "|" + f.file + "|" + f.commit + "|");
}

//  --- 4. the countFace discipline, on a synthetic stat ------------------------
function synth(un, st, staged, ahead, behind) {
  const cs = [];
  for (let i = 0; i < ahead; i++) cs.push({ quad: ".o.." });
  for (let i = 0; i < behind; i++) cs.push({ quad: "o..." });
  //  BEE-039 revised: a slot counts its whole class, so a stat carries `all`;
  //  these cases are single-axis, where the class is whichever axis holds it.
  const all = { chg: Math.max(un.chg, st.chg), add: Math.max(un.add, st.add),
                del: Math.max(un.del, st.del) };
  return { un: un, st: st, all: all, staged: staged, dirty: false,
           model: { commits: cs } };
}
const Z3 = { chg: 0, add: 0, del: 0 };
{
  const s = synth({ chg: 150, add: 12, del: 7 }, Z3, 0, 0, 0);
  check("a-count-clamps-at-99-and-sheds-its-sigil-from-ten",
        ws.fileFrame(s) === fileF("99", "-7", "12"), "|" + ws.fileFrame(s) + "|");
}

//  --- 5. the ahbeh pair is positional; a diverged one is ONE 5-cell face ------
{
  const a = synth(Z3, Z3, 0, 2, 0), b = synth(Z3, Z3, 0, 0, 3);
  check("ahead-only-fills-the-push-slot",
        ws.commitFrame(a) === commitF("+2", BL, BL), "|" + ws.commitFrame(a) + "|");
  check("behind-only-fills-the-pull-slot",
        ws.commitFrame(b) === commitF(BL, "-3", BL), "|" + ws.commitFrame(b) + "|");
  const d = synth(Z3, Z3, 1, 120, 3);
  check("a-diverged-pair-is-right-aligned-in-five-cells-each-side-clamped",
        ws.commitFrame(d) === pairF(" 99⇄3", " ✓"), "|" + ws.commitFrame(d) + "|");
  check("the-diverged-frame-is-still-13-cells",
        cells(ws.commitFrame(d)) === ws.FRAMEW_COMMIT, cells(ws.commitFrame(d)));
}

//  --- 6. the ✓ is present iff something is staged — no grey ✓ -----------------
{
  const s = synth(Z3, { chg: 0, add: 1, del: 0 }, 1, 0, 0);
  check("staged-work-lights-the-commit-slot",
        ws.commitFrame(s) === commitF(BL, BL, " ✓"), "|" + ws.commitFrame(s) + "|");
  check("nothing-staged-leaves-it-blank",
        ws.commitFrame(synth(Z3, Z3, 0, 0, 0)) === commitF(BL, BL, BL));
}

//  --- 7. fold: the two axes, the conflict, and the char no mapping knows ------
{
  const f = ws.fold([{ quad: "..vv", con: false }]);
  check("a-staged-then-re-edited-row-tallies-on-both-axes",
        f.un.chg === 1 && f.st.chg === 1 && f.staged === 1 && f.dirty === true,
        spell3(f.un) + " / " + spell3(f.st));
  const c = ws.fold([{ quad: "...v", con: true }]);
  check("a-conflicted-row-is-unstaged-chg",
        c.un.chg === 1 && c.staged === 0, spell3(c.un) + " staged " + c.staged);
  //  The quad may under-tell a class (a rename): an unknown column char must
  //  still land somewhere, and chg is the fallback (BEE-039 blocker).
  const u = ws.fold([{ quad: "...?", con: false }, { quad: "..?.", con: false }]);
  check("an-unclassable-column-falls-into-chg",
        u.un.chg === 1 && u.st.chg === 1 && u.staged === 1,
        spell3(u.un) + " / " + spell3(u.st));
  const q = ws.fold([{ quad: "vv..", con: false }]);
  check("the-two-TREE-columns-tally-nowhere",
        q.un.chg + q.un.add + q.un.del + q.staged === 0, spell3(q.un));
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "WTSPLIT";
