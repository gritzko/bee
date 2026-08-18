//  view/quad.js — the pure quad model (BEE-022): a path's whole story in four
//  chars, each column read against the one it stands on: upstream (the tracked
//  tip against the fork point), head (against the tracked tip), stage (against
//  head), worktree (against the index).  Column 1 stands on the fork so that
//  it says what upstream did since the two parted, and a commit only you made
//  leaves it `.` (BEE-022:76:wX).  Without a fork the upstream listing is empty,
//  so every path there reads `o`.  The canon is `.` same, `x` removed, `o`
//  created, `v` advanced ([/wiki/Status]); an all-`.` row is dropped.
"use strict";

const CH = { same: ".", removed: "x", created: "o", advanced: "v" };

//  One column's relation to the neighbour it stands on; null means the path
//  is absent on that side.
function rel(refSha, colSha) {
  if (refSha == null && colSha == null) return CH.same;
  if (refSha == null) return CH.created;
  if (colSha == null) return CH.removed;
  return refSha === colSha ? CH.same : CH.advanced;
}

//  A pull cursor over one sorted `[{ path, sha }]` listing, for the k-way merge.
function cursor(rows) {
  const a = rows || [];
  let i = 0;
  return {
    cur: function () { return i < a.length ? a[i] : null; },
    advance: function () { i++; }
  };
}

//  quadModel(inp) -> { rows, commits, counts, noStage }: a k-way cursor merge
//  over listings sorted by path, with no repo and no ambient globals so it is
//  testable alone.  A null `stage` means no GIT-032 reader: column 3 is then
//  all `.` and column 4 stands on head.  `con` holds the conflicted paths.
function quadModel(inp) {
  const noStage = inp.stage === null || inp.stage === undefined;
  const cs = { root: cursor(inp.root), track: cursor(inp.track),
               base: cursor(inp.base),
               stage: cursor(noStage ? [] : inp.stage), wt: cursor(inp.wt) };
  const con = inp.con || new Set();
  const gitlink = inp.gitlink || new Set();
  const rows = [];
  const counts = { track: 0, head: 0, stage: 0, wt: 0, con: 0 };
  for (;;) {
    let min = null;
    for (const k in cs) {
      const v = cs[k].cur();
      if (v && (min === null || v.path < min)) min = v.path;
    }
    if (min === null) break;
    const take = function (c) {
      const v = c.cur();
      if (v && v.path === min) { c.advance(); return v.sha; }
      return null;
    };
    const sRoot = take(cs.root);
    const sTrack = take(cs.track), sBase = take(cs.base);
    const sStage = take(cs.stage), sWt = take(cs.wt);
    //  Without a stage reader there is no index to measure the worktree
    //  against, so rung 4 stands on head instead, and the summary line says so.
    const rTrack = rel(sRoot, sTrack), rHead = rel(sTrack, sBase);
    const rStage = noStage ? CH.same : rel(sBase, sStage);
    const rWt = rel(noStage ? sBase : sStage, sWt);
    const isCon = con.has(min);
    const quad = rTrack + rHead + rStage + rWt;
    if (quad === "...." && !isCon) continue;
    if (rTrack !== CH.same) counts.track++;
    if (rHead !== CH.same) counts.head++;
    if (rStage !== CH.same) counts.stage++;
    if (rWt !== CH.same) counts.wt++;
    if (isCon) counts.con++;
    rows.push({ path: min, quad: quad, con: isCon, gitlink: gitlink.has(min) });
  }

  //  Commit rows read one level up: `o` in the column whose tip reaches it, so
  //  a local unposted commit is `.o..` and an unabsorbed upstream one `o...`.
  const commits = [];
  for (const c of (inp.ahead || []))
    commits.push({ quad: ".o..", hashlet: c.hashlet, subject: c.subject, ts: c.ts });
  for (const c of (inp.behind || []))
    commits.push({ quad: "o...", hashlet: c.hashlet, subject: c.subject, ts: c.ts });

  return { rows: rows, commits: commits, counts: counts, noStage: noStage };
}

module.exports = { quadModel: quadModel, rel: rel, cursor: cursor, CH: CH };
