//  view/quad.js — BEE-022: the PURE quad model.  A path's whole story in four
//  chars, and the quad is a LADDER (ruling 2026-08-18): every column is read
//  against its NEIGHBOUR, never against a root —
//    1 UPSTREAM  the tracked tip   vs HEAD
//    2 HEAD      the base commit   vs the tracked tip
//    3 STAGE     `.git/index`      vs HEAD
//    4 WORKTREE  the bytes on disk vs the index
//  so `merge-base` is not in this model at all and two histories that never met
//  are a legal quad, not an error.  The canon is `.` same, `x` removed, `o`
//  created, `v` advanced; an all-`.` row is dropped.  Columns 1 and 2 are the
//  SAME comparison from both ends: the `o`/`x` asymmetry is what says which way.
"use strict";

const CH = { same: ".", removed: "x", created: "o", advanced: "v" };

//  One column's relation to the neighbour it stands on (`null` = path absent).
function rel(refSha, colSha) {
  if (refSha == null && colSha == null) return CH.same;
  if (refSha == null) return CH.created;
  if (colSha == null) return CH.removed;
  return refSha === colSha ? CH.same : CH.advanced;
}

//  A pull cursor over one sorted `[{ path, sha }]` listing: `cur()` or null.
function cursor(rows) {
  const a = rows || [];
  let i = 0;
  return {
    cur: function () { return i < a.length ? a[i] : null; },
    advance: function () { i++; }
  };
}

//  quadModel(inp) -> { rows, commits, counts, noStage } — the k-way cursor
//  merge, pure: no repo, no ambient globals.  `track`/`base`/`stage`/`wt` are
//  listings sorted lex by path (`stage` null = no [GIT-032] reader, so column 3
//  is all-`.` and column 4 falls back to HEAD); `con` is the set of paths the
//  index holds in stage slots 1/2/3; `ahead`/`behind` are commit records.
function quadModel(inp) {
  const noStage = inp.stage === null || inp.stage === undefined;
  const cs = { track: cursor(inp.track), base: cursor(inp.base),
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
    const sTrack = take(cs.track), sBase = take(cs.base);
    const sStage = take(cs.stage), sWt = take(cs.wt);
    //  The four rungs.  With no stage reader there is no index to measure the
    //  worktree against, so rung 4 stands on HEAD instead (the summary says so).
    const rTrack = rel(sBase, sTrack), rHead = rel(sTrack, sBase);
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

  //  The commit rows are the same reading one level up: a row marks `o` in the
  //  column whose tip REACHES it, so a local unposted commit is `.o..` and an
  //  unabsorbed upstream one `o...` — the ladder's own `o`/`x` direction.
  const commits = [];
  for (const c of (inp.ahead || []))
    commits.push({ quad: ".o..", hashlet: c.hashlet, subject: c.subject, ts: c.ts });
  for (const c of (inp.behind || []))
    commits.push({ quad: "o...", hashlet: c.hashlet, subject: c.subject, ts: c.ts });

  return { rows: rows, commits: commits, counts: counts, noStage: noStage };
}

module.exports = { quadModel: quadModel, rel: rel, cursor: cursor, CH: CH };
