//  view/quad.js — BEE-022: the PURE quad model.  A path's whole story in four
//  chars, each column read against what it stands on —
//    1 UPSTREAM  the tracked tip   vs the FORK POINT (ruling 2026-08-18b)
//    2 HEAD      the base commit   vs the tracked tip
//    3 STAGE     `.git/index`      vs HEAD
//    4 WORKTREE  the bytes on disk vs the index
//  Column 1 stands on the fork so it says what the UPSTREAM did since the two
//  parted: a commit only YOU made leaves it `.`, which is the whole point of
//  the re-ruling — measured against HEAD it lit on every unpushed commit.
//  A missing fork (two tips that never met) is an EMPTY listing, not an error:
//  every path upstream carries then reads `o`.  The canon is `.` same, `x`
//  removed, `o` created, `v` advanced; an all-`.` row is dropped.
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
//  merge, pure: no repo, no ambient globals.  `root`/`track`/`base`/`stage`/`wt`
//  are listings sorted lex by path (`stage` null = no [GIT-032] reader, so
//  column 3 is all-`.` and column 4 falls back to HEAD); `con` is the set of
//  paths the index holds in stage slots 1/2/3; `ahead`/`behind` are commits.
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
    //  The four rungs.  With no stage reader there is no index to measure the
    //  worktree against, so rung 4 stands on HEAD instead (the summary says so).
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
