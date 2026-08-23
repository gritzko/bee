//  bee/test/index/poison.js — BEE-061: a MARK stamped for a tip whose CPAR rows
//  never landed must not brick the ref.  The watermark alone said "indexed",
//  so `bringUp` returned without a row read and every reader walked from a
//  commit the index did not know: one-row log, all-behind, all-new status.
//  The leg plants exactly that on a clone (`LITE_FIX`): index it whole, make a
//  commit, write ONLY its MARK, then pin the readers and the heal — a plain
//  re-run must re-derive the one commit, never the whole index.
"use strict";
const idx = require("index/index.js");
const dag = require("index/dag.js");
const lg = require("view/log.js");
const sv = require("view/status.js");
const sg = require("stage.js");

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
function git(args) { return sg.run(["git", "-C", repo].concat(args)); }
function status() {
  const m = sv.status("", { from: repo }).model;
  return { paths: m.rows.map((r) => r.quad + " " + r.path).join("\n"),
           ahead: m.commits.filter((c) => c.quad === ".o..").length,
           behind: m.commits.filter((c) => c.quad === "o...").length };
}
//  The one index write the bug leaves: a MARK with no rows under it.
function poison() {
  const ctx = idx.openRepo(repo, false);
  const ix = idx.openIndex(ctx.gitdir);
  try {
    ix.put(idx.hlKey(idx.hlOfText(ctx.head.ref), idx.K_MARK),
           idx.hlVal(idx.hlOfSha(ctx.head.sha), 0n));
    ix.commit(true);
  } finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx); }
}
function indexed(sha) {
  const ctx = idx.openRepo(repo, false);
  const ix = idx.openIndex(ctx.gitdir, false, true);
  try { return dag.isIndexed(ix, idx.hlOfSha(sha)); }
  finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx); }
}
function headSha() {
  const ctx = idx.openRepo(repo, false);
  try { return ctx.head.sha; } finally { idx.closeRepo(ctx); }
}
function c5p() {
  const ctx = idx.openRepo(repo, false);
  try { return idx.readCommit(ctx.r, ctx.head.sha).parents[0]; }
  finally { idx.closeRepo(ctx); }
}

//  --- 1. the reference: the clone indexed whole, then one local commit -------
wipe();
const ref = run();
check("reference run indexes the clone", ref.commits > 0 && !ref.upToDate,
      "commits " + ref.commits);
{ const fd = io.open(repo + "/a.txt", "c"), b = io.buf(16);
  b.feed(utf8.Encode("3\n")); io.writeAll(fd, b); io.close(fd); }
if (git(["add", "-A"]) !== 0 ||
    git(["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-m", "c5"]) !== 0)
  throw "poison: cannot commit c5";
const c5 = headSha(), c4 = c5p();
const healthy = run();
check("c5 indexed the normal way is ONE commit", healthy.commits === 1, healthy.commits);
const refLog = logRows(), refStat = status();
check("reference status: ahead 1, behind 0",
      refStat.ahead === 1 && refStat.behind === 0, JSON.stringify(refStat));

//  --- 2. the poison: c5's MARK with no rows under it -------------------------
wipe();
run({ tip: c4 });                         // everything but c5, no mark for it
check("before the mark, c5 is not indexed", indexed(c5) === false);
poison();
check("the mark alone does not make c5 indexed", indexed(c5) === false);

//  --- 3. the readers must see the true history, not the mark ----------------
const heal = run();
check("a re-run is NOT the watermark no-op", heal.upToDate === false, heal.upToDate);
check("the re-run re-derives exactly the one commit", heal.commits === 1, heal.commits);
check("c5 is indexed after the heal", indexed(c5) === true);
const log2 = logRows();
check("log = the reference log, not one row", log2.join("\n") === refLog.join("\n"),
      log2.length + " rows vs " + refLog.length);
const st2 = status();
check("status = the reference rows, ahead 1 behind 0",
      st2.paths === refStat.paths && st2.ahead === 1 && st2.behind === 0,
      JSON.stringify(st2));
check("and the next run is the no-op again", run().upToDate === true);

w1((bad ? "FAILED " + bad + " of " : "DONE ") + n + " checks\n");
