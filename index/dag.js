//  index/dag.js — BEE-005: the INDEX as a graph reader.  Two graphs live in the
//  LITE-006 index and neither has ever been read as one: the COMMIT dag (`CPAR`
//  rows) and, per path, the CONDENSED path-dag (`REV-BLOB`/`REV-CMMT`/`REV-PARS`
//  rows — only the commits that CHANGE the path, each with its blob, its commit
//  and its parent revs).  be recomputes both per run (`shared/dag.js`,
//  `shared/pathdag.js`); bee has them on disk already, so `pathdag.of` is NOT
//  ported (ruling 7) — the floor is found INSIDE the index, in 20-bit rev space.
//
//  Everything here is a KEYED read of the index: no ODB tree is walked, no
//  commit is parsed.  An ODB read is for BLOB BYTES only, and that one lives in
//  index/weave.js where the fold needs it.
//
//    parentsOf(ix, chl)          the commit's parents, first parent first
//    ancestors(ix, chl, cap)     its closure, walk-capped (chl included)
//    mergeBase(ix, a, b)         a MAXIMAL common ancestor, or null
//    pathRevs(ix, path)            the path's rev rows, rev-ordered
//    repsOf(ix, index, chl)       the revs a commit's view stands on (ruling 8)
//    floorRev(index, revs)        the LCA inside the index, and what is above it
"use strict";

const idx = require("./index.js");

//  be/shared/dag.js WALK_CAP — a pathological history must not run unbounded.
const WALK_CAP = 1 << 16;

//  --- the commit dag (CPAR) -------------------------------------------------
//  One commit's parents as hashlet60s, ord 0 first.  A ROOT commit's row
//  carries the EMPTY parent slot, which says "indexed", not "has a parent".
function parentsOf(ix, chl) {
  const key = idx.hlKey(chl, idx.K_CPAR);
  const rows = [];
  //  index.js's KNOWN TRAP: `range`/`prefix` answer NOTHING when the upper
  //  bound reaches 2^64, so every read here rides the seek cursor.
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

//  Is this commit in the index at all?  ANY CPAR row says yes.
function isIndexed(ix, chl) {
  const key = idx.hlKey(chl, idx.K_CPAR);
  const c = ix.seek(key);
  return c.next() && c.key === key;
}

//  The ancestor SET of `chl` (chl itself included), a bounded BFS over CPAR.
function ancestors(ix, chl, cap) {
  const lim = cap || WALK_CAP;
  const seen = new Set([chl]), queue = [chl];
  for (let i = 0; i < queue.length && seen.size <= lim; i++)
    for (const p of parentsOf(ix, queue[i]))
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
  return seen;
}

//  A MAXIMAL common ancestor of two commits (be dag.js `mergeBase`), or null.
//  An ancestor of a common ancestor is common too, so the common set is closed
//  under `parentsOf` — which makes "maximal" simply "no common commit names it
//  as a parent", one CPAR seek per common commit instead of a topo sort.
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
//  ONE path's rev rows, by the key span its `path_hl` owns (index.js loadPath's
//  own read): every REV row is in [phl<<24, (phl+1)<<24), and the span is
//  filtered by KIND, never cut short by one.  Returns
//  { phl, revs: Map(rev -> { rev, blob, commit, pars[] }), order: [rev asc],
//    byCommit: Map(commit_hl -> rev) }.
function pathRevs(ix, path) {
  const phl = idx.pathHl(path);
  const revs = new Map(), byCommit = new Map();
  const at = function (rev) {
    let e = revs.get(rev);
    if (e === undefined) revs.set(rev, e = { rev: rev, blob: null, commit: null,
                                             pars: [] });
    return e;
  };
  const c = ix.seek(phl << 24n);
  while (c.next()) {
    if (idx.keyPhl(c.key) !== phl) break;
    const kind = idx.keyKind(c.key), rev = idx.keyRev(c.key), v = c.val;
    if (kind === idx.K_BLOB) at(rev).blob = idx.valHl60(v);
    else if (kind === idx.K_CMMT) at(rev).commit = idx.valHl60(v);
    else if (kind === idx.K_PARS) {
      //  BEE-005: a val holds THREE parent revs; a 4th+ rides a second row.
      const e = at(rev);
      for (const s of [(v >> 44n) & idx.REV_MAX, (v >> 24n) & idx.REV_MAX,
                       (v >> 4n) & idx.REV_MAX])
        if (s !== idx.REV_MAX && e.pars.indexOf(s) < 0) e.pars.push(s);
    }
  }
  const order = [];
  for (const [rev, e] of revs) {
    //  A DIR path carries REV-CMMT rows and no blob (LITE-044) — no content to
    //  fold, so it is no rev of this index.
    if (e.blob === null || e.commit === null) { revs.delete(rev); continue; }
    byCommit.set(e.commit, rev);
    order.push(rev);
  }
  order.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  return { phl: phl, revs: revs, order: order, byCommit: byCommit };
}

//  Ruling 8: the revs a COMMIT's view of the path stands on.  Its own rev when
//  it changed the path; else the nearest rev up the commit dag, over EVERY
//  parent — so a merge that took one side's bytes stands on that side's rev and
//  a merge of two changed views stands on both (the caller joins them).
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

//  The FLOOR: the LCA of the given revs INSIDE the index.  Revs are minted
//  oldest-first as the walk seals commits, so rev order IS a topological order
//  — the HIGHEST common rev has no common descendant and is therefore maximal.
//  Returns { floor, above } — `above` is every rev reachable from `reps` that is
//  NOT at or below the floor, rev-ordered: exactly what folds over the seed.
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
    //  A rev above the floor whose own PARENT is strictly BELOW it would fold
    //  against the seed instead of against its parent — churn the emit then
    //  spells as a change nobody made.  Take that parent as another rep and
    //  find the floor again: the floor DESCENDS until every folded rev has its
    //  parents inside the fold.  A linear from->to pair converges at once.
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
