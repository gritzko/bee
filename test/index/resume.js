//  lite/test/index/resume.js — LITE-006 ruling 2026-08-13: an INTERRUPTED
//  index keeps every commit it sealed, and the next run picks up exactly where
//  it stopped.  There is no walk ceiling and no watermark to lose: PRESENCE of
//  a commit's CPAR rows IS the boundary.
//
//  The leg runs the crash three ways over ONE fixture repo (`LITE_FIX`), each
//  time from a `rm -rf`-ed `.git/be`:
//    1. a clean full run, kept as the reference (commits, revs, the log);
//    2. a run faulted after 2 commits, then rerun to completion — the totals
//       must ADD UP to the reference and the log must be identical;
//    3. a run faulted after EVERY single commit, resumed until it converges —
//       the pathological case, and still no duplicate revs.
"use strict";
const idx = require("index/index.js");
const lg = require("view/log.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const repo = io.getenv("LITE_FIX");
function wipe() { try { io.rmdir(repo + "/.git/be", true); } catch (e) {} }
function run(opts) { return idx.index(repo, Object.assign({ track: false }, opts || {})); }
function logRows() { return lg.log(undefined, { from: repo }).rows; }

//  Every REV row in the index, as path_hl -> [rev...] and a (path, commit) set.
function indexRevs() {
  const ctx = idx.openRepo(repo, false);
  const ix = idx.openIndex(ctx.gitdir);
  const pairs = [], revs = [];
  try {
    const c = ix.seek(0n);
    while (c.next()) {
      const kind = idx.keyKind(c.key);
      if (kind === idx.K_BLOB) revs.push((idx.keyPhl(c.key) << 20n) | idx.keyRev(c.key));
      else if (kind === idx.K_CMMT)
        pairs.push((idx.keyPhl(c.key) << 60n) | idx.valHl60(c.val));
    }
  } finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx); }
  return { pairs: pairs, revs: revs };
}


//  --- 1. the reference ------------------------------------------------------
wipe();
const ref = run();
const refLog = logRows();
const refRows = indexRevs();
check("reference run indexes the whole history",
      ref.commits > 0 && ref.revs > 0 && refLog.length === ref.commits,
      "commits " + ref.commits + " revs " + ref.revs + " rows " + refLog.length);
check("a rerun right after it is the watermark no-op", run().upToDate === true);

//  --- 2. faulted after 2 commits, then resumed ------------------------------
wipe();
let first = null, threw = false;
try { run({ _faultAfter: 2 }); } catch (e) { threw = true; }
check("an injected fault aborts the run", threw);
//  the faulted run sealed its rows but wrote NO mark, so the next run must not
//  see a no-op — it must see exactly the commits the index still lacks.
const second = run();
check("the resumed run is not a no-op", second.upToDate === false, second.upToDate);
check("resumed commits = the reference minus what the faulted run sealed",
      second.commits === ref.commits - 2, "resumed " + second.commits +
      " of " + ref.commits);
check("resume mints no duplicate revs (totals add up)",
      second.revs <= ref.revs, "resumed revs " + second.revs + " ref " + ref.revs);
const resumedLog = logRows();
check("the resumed log is byte-identical to the reference log",
      resumedLog.join("\n") === refLog.join("\n"),
      "rows " + resumedLog.length + " vs " + refLog.length);
check("and a further run is the no-op again", run().upToDate === true);

//  --- 3. faulted after EVERY commit, resumed to convergence -----------------
wipe();
let runs = 0, total = 0, totRevs = 0;
for (;;) {
  if (runs > ref.commits + 4) break;                 // convergence guard
  let rec = null;
  try { rec = run({ _faultAfter: 1 }); }
  catch (e) { runs++; total++; continue; }            // one commit sealed, died
  runs++;
  totRevs = rec.revs;
  if (rec.upToDate || rec.commits === 0) break;
  total += rec.commits;
}
check("a one-commit-per-run crash loop converges",
      runs <= ref.commits + 2 && total === ref.commits,
      "runs " + runs + " commits " + total + " of " + ref.commits);
check("it mints no extra revs on the way", totRevs === 0, "last-run revs " + totRevs);
const crashLog = logRows();
check("the crash-loop log is byte-identical to the reference log",
      crashLog.join("\n") === refLog.join("\n"),
      "rows " + crashLog.length + " vs " + refLog.length);

//  --- 4. the MID-COMMIT crash: revs sealed, CPAR rows never written --------
//  This is the one case the presence boundary alone does NOT cover — an
//  auto-seal on a full memtable page can persist a commit's rev rows while its
//  CPAR rows (put last) are lost.  The commit then reads as unindexed and is
//  re-walked, and the per-path top-rev guard must turn every one of those revs
//  into a no-write.
wipe();
threw = false;
try { run({ _faultMid: 2 }); } catch (e) { threw = true; }
check("a mid-commit fault aborts with the revs sealed and no CPAR", threw);
const after = run();
check("the re-walk covers the stranded commit too",
      after.commits === ref.commits - 1, "walked " + after.commits +
      " of " + ref.commits);
const midLog = logRows();
check("the mid-crash log is byte-identical to the reference log",
      midLog.join("\n") === refLog.join("\n"),
      "rows " + midLog.length + " vs " + refLog.length);
//  ...and the index holds EXACTLY the reference's rows: the stranded commit's
//  revs were re-derived to nothing, so no path carries two revs of one commit
//  and the total rev count is unchanged.
const midRows = indexRevs();
check("no path carries two revs of one commit",
      new Set(midRows.pairs.map(String)).size === midRows.pairs.length,
      midRows.pairs.length + " (path,commit) rows");
check("the index holds exactly the reference's rev count",
      midRows.revs.length === refRows.revs.length,
      midRows.revs.length + " vs " + refRows.revs.length);

//  Leave the fixture's index whole for the legs that follow.
wipe();
run();
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
