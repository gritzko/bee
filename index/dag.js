//  index/dag.js — the index read as two graphs (BEE-005): the commit dag off
//  the CPAR rows and, per path, the condensed rev dag the REV rows already
//  form (BEE-005:24:mJ).  The merge floor is found inside the index in rev space
//  (BEE-005:73:mJ), so nothing here walks a tree or parses a commit: every read
//  is keyed (BEE-005:43:mJ) and every walk is capped (BEE-005:45:mJ).  The one
//  ODB read a weave needs, the blob bytes, lives in index/weave.js.
"use strict";

const idx = require("./index.js");

//  be/shared/dag.js WALK_CAP: a pathological history must not run unbounded.
const WALK_CAP = 1 << 16;

//  --- the commit dag (CPAR) -------------------------------------------------
//  One commit's parents as hashlet60s, ord 0 first.  A root commit's row
//  carries the empty parent slot, which says "indexed", not "has a parent".
function parentsOf(ix, chl) {
  const key = idx.hlKey(chl, idx.K_CPAR);
  const rows = [];
  //  `range`/`prefix` answer nothing when the upper bound reaches 2^64
  //  (index/index.js:416:hT), so every read here rides the seek cursor.
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    rows.push({ hl: idx.valHl60(c.val), ord: Number(c.val & 0xfn) });
  }
  rows.sort(function (a, b) { return a.ord - b.ord; });
  const out = [];
  for (const e of rows) if (e.hl !== idx.CPAR_NONE) out.push(e.hl);
  return out;
}

//  Is this commit in the index at all?  Any CPAR row says yes.
function isIndexed(ix, chl) {
  const key = idx.hlKey(chl, idx.K_CPAR);
  const c = ix.seek(key);
  return c.next() && c.key === key;
}

//  The ancestor set of `chl` (itself included), a bounded BFS over CPAR.
function ancestors(ix, chl, cap) {
  const lim = cap || WALK_CAP;
  const seen = new Set([chl]), queue = [chl];
  for (let i = 0; i < queue.length && seen.size <= lim; i++)
    for (const p of parentsOf(ix, queue[i]))
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
  return seen;
}

//  A maximal common ancestor of two commits (be dag.js `mergeBase`), or null.
//  The common set is closed under `parentsOf`, so "maximal" is just "no common
//  commit names it as a parent": one CPAR seek per common commit, no topo sort.
function mergeBase(ix, a, b) {
  if (a === b) return a;
  const aa = ancestors(ix, a), ab = ancestors(ix, b);
  const common = new Set();
  for (const hl of aa) if (ab.has(hl)) common.add(hl);
  if (!common.size) return null;
  const covered = new Set();
  for (const hl of common)
    for (const p of parentsOf(ix, hl)) if (common.has(p)) covered.add(p);
  for (const hl of common) if (!covered.has(hl)) return hl;
  return null;                                   // a cycle: no maximal element
}

//  --- the path index (REV-*) -------------------------------------------------
//  One path's rev rows off the three key spans its `path_hl` owns, one per kind
//  since BEE-063:38.  Returns { phl, revs: Map(rev ->
//  { rev, blob, commit, pars[] }), order: [rev asc], byCommit: Map(chl -> rev) }.
function pathRevs(ix, path) {
  const phl = idx.pathHl(path);
  const revs = new Map(), byCommit = new Map();
  const at = function (rev) {
    let e = revs.get(rev);
    if (e === undefined) revs.set(rev, e = { rev: rev, blob: null, commit: null,
                                             pars: [] });
    return e;
  };
  idx.revSpan(ix, phl, idx.K_BLOB, function (k, v) { at(idx.keyRev(k)).blob = idx.valHl60(v); });
  idx.revSpan(ix, phl, idx.K_CMMT, function (k, v) { at(idx.keyRev(k)).commit = idx.valHl60(v); });
  idx.revSpan(ix, phl, idx.K_PARS, function (k, v) {
    //  A val holds three parent revs; a 4th+ rides a second row (BEE-005).
    const e = at(idx.keyRev(k));
    for (const s of [(v >> 44n) & idx.REV_MAX, (v >> 24n) & idx.REV_MAX,
                     (v >> 4n) & idx.REV_MAX])
      if (s !== idx.REV_MAX && e.pars.indexOf(s) < 0) e.pars.push(s);
  });
  const order = [];
  for (const [rev, e] of revs) {
    //  A dir path carries CMMT rows and no blob (LITE-044): nothing to fold,
    //  so it is no rev of this index.
    if (e.blob === null || e.commit === null) { revs.delete(rev); continue; }
    byCommit.set(e.commit, rev);
    order.push(rev);
  }
  order.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  return { phl: phl, revs: revs, order: order, byCommit: byCommit };
}

//  The revs a commit's view of the path stands on (BEE-005:77:mJ): its own rev
//  when it changed the path, else the nearest rev up every parent, so a merge
//  that took one side stands on that side's rev, one of two changed views on both.
function repsOf(ix, index, chl, cap) {
  if (chl === null || chl === undefined) return [];   // no commit on that side
  const lim = cap || WALK_CAP;
  const seen = new Set([chl]), queue = [chl], out = [];
  for (let i = 0; i < queue.length && seen.size <= lim; i++) {
    const rev = index.byCommit.get(queue[i]);
    if (rev !== undefined) { if (out.indexOf(rev) < 0) out.push(rev); continue; }
    for (const p of parentsOf(ix, queue[i]))
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return out;
}

//  Every rev at or below `revs` over the REV-PARS edges.
function revAncestors(index, revs) {
  const seen = new Set(revs), queue = Array.from(revs);
  for (let i = 0; i < queue.length; i++) {
    const e = index.revs.get(queue[i]);
    if (e === undefined) continue;
    for (const p of e.pars) if (!seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return seen;
}

//  The floor, the LCA of the revs inside the index (BEE-005:73:mJ).  Revs are
//  minted oldest-first, so rev order is topological and the highest common rev
//  is maximal.  Returns { floor, above }: `above` is every rev reachable from
//  `reps` and not at or below the floor, rev-ordered, what folds over the seed.
function floorRev(index, reps) {
  const need = Array.from(new Set(reps));
  for (let round = 0; round <= need.length + 1; round++) {
    let common = null;
    const all = new Set();
    for (const rep of need) {
      const anc = revAncestors(index, [rep]);
      for (const rev of anc) all.add(rev);
      if (common === null) { common = new Set(anc); continue; }
      const both = new Set();
      for (const rev of common) if (anc.has(rev)) both.add(rev);
      common = both;
    }
    let floor = null;
    for (const rev of (common || [])) if (floor === null || rev > floor) floor = rev;
    const below = floor === null ? new Set() : revAncestors(index, [floor]);
    const above = new Set();
    for (const rev of all) if (!below.has(rev)) above.add(rev);
    //  A folded rev whose parent sits below the floor would fold against the
    //  seed and spell a change nobody made: take that parent as a rep and retry.
    const miss = [];
    for (const rev of above) {
      const e = index.revs.get(rev);
      for (const p of (e === undefined ? [] : e.pars))
        if (p !== floor && !above.has(p) && miss.indexOf(p) < 0) miss.push(p);
    }
    if (!miss.length) {
      const out = Array.from(above);
      out.sort(function (x, y) { return x < y ? -1 : x > y ? 1 : 0; });
      return { floor: floor, above: out };
    }
    for (const p of miss) need.push(p);
  }
  return { floor: null, above: [] };
}

module.exports = { parentsOf: parentsOf, isIndexed: isIndexed,
                   ancestors: ancestors, mergeBase: mergeBase,
                   pathRevs: pathRevs, repsOf: repsOf, revAncestors: revAncestors,
                   floorRev: floorRev, WALK_CAP: WALK_CAP };
