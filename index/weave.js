//  index/weave.js — LITE-014: the CRDT 3-way weave MERGE, ported from
//  be/shared/weave.js (`weave3`/`mergedLive`/`fold`/`merge`) over the same
//  `abc.ram("CFOLD")` container lite already links.  The DAG half of be's
//  module (build/buildDag/foldCommit) is NOT here: a git merge driver is handed
//  three BLOBS, so there is no history to walk and no store reader to carry.
//
//  This file is also THE source-size policy home (view/diff.js imports it, so
//  the caps live in one place as they do in be) and the one "can we weave it"
//  gate: over the cap or binary => the caller falls back, never silent-ours.
"use strict";

//  A source larger than this is a BLOB: not tokenised, not woven.  One place
//  sets it; everyone imports it.
const MAX_SOURCE_SIZE = 4 << 20;                   // 4 MB
//  A tokenised source runs larger than its raw bytes; 4x covers the worst real
//  case.  Every weave/HUNK buffer is allocated ONCE at this fixed size (a lazy
//  anonymous mmap — only touched pages fault in), never grown dynamically.
const MAX_SOURCE_MARKED_UP = MAX_SOURCE_SIZE * 4;  // 16 MB

//  git's binary heuristic: a blob is binary iff a NUL byte appears in its first
//  8000 bytes.  A binary pair is never tokenised — neither diffed nor woven.
const BIN_PROBE = 8000;
function isBinary(bytes) {
  if (!bytes || !bytes.length) return false;
  const n = bytes.length < BIN_PROBE ? bytes.length : BIN_PROBE;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

//  The basename suffix after the last '.' — the weave lexer's language key; no
//  dot (or a dotfile) => "" (the generic tokenizer).
function extOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

//  fold(base, blob, ext, hash, ancestors): one CFOLDFold into a fresh fixed
//  buffer.  `ancestors` lists the hashlets of the commit's whole causal closure
//  (itself excluded); everything folded and NOT named lands in its ignore-set.
function fold(base, blob, ext, hash, ancestors) {
  const w = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
  w.fold(base, blob, ext, hash, ancestors || []);
  return w;
}

//  merge(base, hash, ancestors): a CONTENTLESS merge commit — appends nothing,
//  records the union view of `ancestors` (the intersected ignore-set).
function merge(base, hash, ancestors) {
  const w = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
  w.merge(base, hash, ancestors || []);
  return w;
}

//  PATCH-025 (DIS-080): the MARKERLESS merged render — the RGA reading of the
//  weave at `rev` (every alive token in document order, NO fences).
//  `groupIds` is one hashlet-id array per side; returns { bytes, spans } —
//  spans are the [from,to) byte ranges that conflict.  Membership is BLAME:
//  the cursor yields body offsets (identity), blame(off) names the inserter.
//  A run of non-shared tokens CONFLICTS iff two of its membership masks are
//  disjoint; a conflicting run whose groups spell EQUAL bytes collapses to
//  one copy (content re-absorbed under another birth id — never a conflict).
function mergedLive(wm, rev, groupIds) {
  const ng = groupIds.length;
  const spine = ng >= 32 ? 0xFFFFFFFF : ((1 << ng) - 1);
  const sets = groupIds.map(function (g) { return new Set(g); });
  const text = [], mask = [], live = [];
  wm.rewind(rev);
  while (wm.next()) {
    const t = wm.tok;
    const ins = wm.blame(t.off);
    let m = 0;
    for (let g = 0; g < ng; g++) if (sets[g].has(ins)) m |= (1 << g);
    text.push(t.text); mask.push(m); live.push(!!t.alive);
  }

  const n = text.length, parts = [], spans = [];
  let at = 0;
  function put(b) { parts.push(b); at += b.length; }
  //  the alive bytes of one membership mask within [lo,hi), concatenated.
  function gather(lo, hi, m) {
    let len = 0;
    for (let j = lo; j < hi; j++) if (live[j] && mask[j] === m) len += text[j].length;
    const b = new Uint8Array(len);
    let o = 0;
    for (let j = lo; j < hi; j++)
      if (live[j] && mask[j] === m) { b.set(text[j], o); o += text[j].length; }
    return b;
  }

  let i = 0;
  while (i < n) {
    if (!live[i]) { i++; continue; }
    if (mask[i] === spine) { put(text[i]); i++; continue; }
    //  Divergent run: spans until the next shared token (dead tokens ride along).
    let hi = i;
    while (hi < n && !(live[hi] && mask[hi] === spine)) hi++;
    const seen = [];
    for (let j = i; j < hi; j++)
      if (live[j] && seen.indexOf(mask[j]) < 0) seen.push(mask[j]);
    let clash = false;
    for (let a = 0; a < seen.length && !clash; a++)
      for (let b = a + 1; b < seen.length; b++)
        if ((seen[a] & seen[b]) === 0) { clash = true; break; }
    if (clash && seen.length >= 2) {
      const g0 = gather(i, hi, seen[0]);
      let allEq = true;
      for (let g = 1; g < seen.length && allEq; g++)
        if (!bytesEq(g0, gather(i, hi, seen[g]))) allEq = false;
      if (allEq) { put(g0); i = hi; continue; }   // re-absorbed, not a conflict
    }
    const from = at;
    for (let j = i; j < hi; j++) if (live[j]) put(text[j]);
    if (clash) spans.push({ from: from, to: at });
    i = hi;
  }

  const bytes = new Uint8Array(at);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { bytes: bytes, spans: spans };
}

//  GET-056b: the 3-blob weave merge — base, then ours and theirs as CONCURRENT
//  folds on it (each diffs against the base, NOT sequentially), then a
//  contentless merge over all three.  Disjoint edits coexist cleanly; a
//  divergent region reads back markerless with conflict spans (PATCH-025).
//  Returns null for an unweavable input (binary or over the source cap) — the
//  caller falls back LOUDLY, never silent-ours.
const _W3_BASE = "0000000000000001", _W3_OURS = "0000000000000002",
      _W3_THRS = "0000000000000003", _W3_MRG = "0000000000000004";
function weave3(base, ours, theirs, ext) {
  base = base || new Uint8Array(0);
  //  PATCH-025 (DIS-080): trivial resolutions carry no conflict spans.
  const clean = function (b) { return { bytes: b, spans: [] }; };
  if (bytesEq(ours, theirs)) return clean(ours);   // same edit both sides
  if (bytesEq(ours, base)) return clean(theirs);   // only theirs changed
  if (bytesEq(theirs, base)) return clean(ours);   // only ours changed
  //  PATCH-012: over the shared source cap is a BLOB — not weavable.
  if (base.length > MAX_SOURCE_SIZE ||
      ours.length > MAX_SOURCE_SIZE ||
      theirs.length > MAX_SOURCE_SIZE) return null;
  //  LITE-014: a binary side is not weavable either (the driver hands it to
  //  git's stock text merge, as it does an over-cap one).
  if (isBinary(base) || isBinary(ours) || isBinary(theirs)) return null;
  const wb = fold(null, base, ext, _W3_BASE, []);
  const wo = fold(wb, ours, ext, _W3_OURS, [_W3_BASE]);
  const wt = fold(wo, theirs, ext, _W3_THRS, [_W3_BASE]);   // concurrent w/ ours
  const wm = merge(wt, _W3_MRG, [_W3_BASE, _W3_OURS, _W3_THRS]);
  return mergedLive(wm, _W3_MRG, [[_W3_BASE, _W3_OURS], [_W3_BASE, _W3_THRS]]);
}

//  ===========================================================================
//  BEE-005: the file weave RECONSTRUCTION — be/shared/weave.js `buildDag` over
//  bee's REV index instead of be's recomputed pathdag.  ONE weave per path: the
//  path's blob at the LCA FLOOR of the tips folded first (as the floor's own
//  commit), then every rev above it once, in rev order, each folded with its
//  ancestor closure.  Shared history is folded ONCE for every tip.
//  ===========================================================================

const ln = require("./dag.js");
const idx = require("./index.js");

//  A layer id is a 16-hex hashlet (cfold.c JABCcfoldHi64).  The index holds 60
//  bits of the commit sha, so the id is that hashlet SHIFTED — the low nibble
//  is always 0, which is what keeps the reserved ids below off the commit space.
function layerId(chl) { return idx.hexOfHl(chl) + "0"; }
//  The seed layer when the tips have NO common rev at all (the path is an
//  addition on one side): an EMPTY first layer under a reserved id, over which
//  the first real rev reads as a plain insert (BEE-005 ruling 4).
const LAYER_NIL = "0000000000000005";
//  BE-010: the worktree's on-disk edit rides as a FINAL synthetic layer.
const WT_SRC = "00000000005774ed";
//  A path whose history above the floor is deeper than this is re-rooted at the
//  from-side rev, in words — a fold per rev is a cost, not a promise.
const LAYER_CAP = 1 << 10;

//  Blob bytes for a 60-bit blob hashlet — THE one ODB read of the whole fold
//  (a hashlet IS an object name: `git.getHex` takes any 6..40 hexlet).
//  undefined = unreadable, not a blob, or over the source cap.
function blobOf(r, bhl) {
  let o = null;
  try { o = idx.object(r, idx.hexOfHl(bhl)); } catch (e) { o = null; }
  if (o === null || o.type !== "blob") return undefined;
  return o.bytes.length > MAX_SOURCE_SIZE ? undefined : o.bytes;
}

//  weaveDiff(r, ix, path, tips, ext) -> the ONE weave and one READING per tip.
//  `tips` are `{ chl, blob }` — the commit hashlet and the blob sha the tip's
//  TREE carries there (undefined = the path is not there at all), the FROM side
//  first.  The result is be's `build` shape:
//    weave           the CFOLD container every rev reads out of
//    views[i]        -> { rev, ids } the layer id that tip's view stands on
//    idToHl          layer id -> the commit hashlet that folded it (blame)
//  A tip the path is absent at gets an EMPTY layer of its own, so an addition
//  is a plain insert above the floor and a deletion a plain removal: neither
//  needs the inverted 2-layer fold a blob pair does (ruling 4).
function weaveDiff(r, ix, path, tips, ext) {
  const pr = ln.pathRevs(ix, path);
  const reps = new Map();
  const all = [];
  for (const t of tips) {
    const rs = ln.repsOf(ix, pr, t.chl);
    reps.set(t.chl, rs);
    for (const rev of rs) if (all.indexOf(rev) < 0) all.push(rev);
  }
  //  The index knows no rev of this path (nothing above it was ever indexed):
  //  the tips still fold their OWN blobs over an empty seed, under their own
  //  commit ids — a degraded weave, never a silently missing file.
  let f = all.length ? ln.floorRev(pr, all) : { floor: null, above: [] };
  if (f.above.length > LAYER_CAP) {
    //  Too deep to fold rev by rev: re-root at the from side's own rev, in
    //  words.  Still one weave with real commit ids, never a blob pair.
    io.log("diff: " + path + " has over " + LAYER_CAP +
           " revisions above the merge base — rooting the weave at the from side\n");
    const from = reps.get(tips[0].chl) || [];
    f = { floor: from.length ? from[from.length - 1] : null,
          above: all.filter(function (rev) { return from.indexOf(rev) < 0; }) };
  }

  const idOfRev = new Map(), closure = new Map(), idToHl = new Map();
  let w, seedId, seedIds;
  const fe = f.floor === null ? undefined : pr.revs.get(f.floor);
  //  An unreadable (or over-cap) floor blob seeds EMPTY rather than dropping
  //  the path: the layers above still carry their own commit ids.
  const seedBytes = fe === undefined ? undefined : blobOf(r, fe.blob);
  if (seedBytes !== undefined) {
    const e = fe, bytes = seedBytes;
    seedId = layerId(e.commit);
    idToHl.set(seedId, e.commit);
    w = fold(null, bytes, ext, seedId, []);
    idOfRev.set(f.floor, seedId);
    closure.set(f.floor, new Set([seedId]));
  } else {
    seedId = LAYER_NIL;
    w = fold(null, new Uint8Array(0), ext, seedId, []);
  }
  seedIds = new Set([seedId]);

  for (const rev of f.above) {
    const e = pr.revs.get(rev);
    if (e === undefined) continue;
    const ps = e.pars.filter(function (p) { return idOfRev.has(p); });
    const anc = new Set(seedIds);
    for (const p of ps) for (const id of closure.get(p)) anc.add(id);
    const bytes = blobOf(r, e.blob);
    if (bytes === undefined) {
      //  Unreadable or a BLOB: not woven — carry a parent's view (be foldCommit).
      const carry = ps.length ? idOfRev.get(ps[0]) : seedId;
      idOfRev.set(rev, carry);
      closure.set(rev, anc);
      continue;
    }
    const id = layerId(e.commit);
    w = fold(w, bytes, ext, id, Array.from(anc));
    idToHl.set(id, e.commit);
    anc.add(id);
    idOfRev.set(rev, id);
    closure.set(rev, anc);
  }

  //  be `viewAt`: a tip stands on ONE rev, or JOINS several under its own id —
  //  a merge that touched no path of its own has no rev to stand on otherwise.
  //  An ABSENT path folds an empty layer, a tip the index has no rev for folds
  //  its own blob: either way the tip's view is a real layer, never a guess.
  const views = [];
  for (const t of tips) {
    const rs = reps.get(t.chl);
    const live = [], ids = new Set();
    for (const rev of rs) {
      const id = idOfRev.get(rev);
      if (id === undefined) continue;
      if (live.indexOf(id) < 0) live.push(id);
      for (const x of (closure.get(rev) || [])) ids.add(x);
    }
    //  A tip with no commit at all (a root commit's parent) is the EMPTY side.
    const tid = t.chl === null ? LAYER_NIL : layerId(t.chl);
    let rev = null;
    if (live.length === 1) rev = live[0];
    else if (live.length > 1) {                  // the contentless JOIN
      rev = tid;
      w = merge(w, rev, Array.from(ids));
      idToHl.set(rev, t.chl);
      ids.add(rev);
    }
    const own = t.blob === undefined ? new Uint8Array(0)
              : (rev === null ? blobOf(r, idx.hlOfSha(t.blob)) : null);
    if (own !== null && own !== undefined && tid !== seedId && rev !== tid) {
      //  absent (fold empty = the delete) or unrepresented (fold its bytes).
      w = fold(w, own, ext, tid, Array.from(rev === null ? seedIds : ids));
      idToHl.set(tid, t.chl);
      ids.add(tid);
      rev = tid;
    }
    if (rev === null) { rev = seedId; for (const x of seedIds) ids.add(x); }
    views.push({ rev: rev, ids: ids });
  }
  return { get weave() { return w; }, views: views, idToHl: idToHl,
           seed: seedId, revs: pr };
}

//  BEE-005: a PARENT->CHILD pair needs no index at all — the merge base of a
//  commit and its own parent IS that parent, and nothing lies between them, so
//  the weave is the parent's blob as the seed and the child's as the one layer
//  above it.  Same shape as `weaveDiff`, same real commit ids, no rev read: it
//  is what keeps `bee commit` an ODB-only view (ruling, test/commit).
function blobDiff(from, to, ext) {
  const idToHl = new Map();
  const fid = from.chl === null ? LAYER_NIL : layerId(from.chl);
  if (from.chl !== null) idToHl.set(fid, from.chl);
  let w = fold(null, from.bytes || new Uint8Array(0), ext, fid, []);
  //  The WORKTREE side is no commit: the caller folds it with `foldWt` over
  //  this one view, so the pair stops at the seed.
  if (to.wt)
    return { get weave() { return w; }, seed: fid, idToHl: idToHl,
             views: [{ rev: fid, ids: new Set([fid]) }] };
  const tid = to.chl === null ? LAYER_NIL : layerId(to.chl);
  if (tid === fid)                                 // the same commit both sides
    return { get weave() { return w; }, seed: fid, idToHl: idToHl,
             views: [{ rev: fid, ids: new Set([fid]) },
                     { rev: fid, ids: new Set([fid]) }] };
  w = fold(w, to.bytes || new Uint8Array(0), ext, tid, [fid]);
  idToHl.set(tid, to.chl);
  return { get weave() { return w; }, seed: fid, idToHl: idToHl,
           views: [{ rev: fid, ids: new Set([fid]) },
                   { rev: tid, ids: new Set([fid, tid]) }] };
}

//  BE-010 (be/shared/weave.js `foldWt`): the worktree's on-disk bytes as a
//  FINAL synthetic layer over the view `rev` — the wt diff's to-side.  An
//  adjacent-equal wt (or one over the cap) adds no layer at all.
function foldWt(w, rev, ids, bytes, ext) {
  if (!w || rev == null || bytes == null) return { weave: w, layered: false };
  if (bytes.length > MAX_SOURCE_SIZE) return { weave: w, layered: false };
  const prev = io.ram(MAX_SOURCE_MARKED_UP);
  w.produce(rev, prev);
  if (bytesEq(prev.data(), bytes)) return { weave: w, layered: false };
  return { weave: fold(w, bytes, ext, WT_SRC, Array.from(ids)), layered: true };
}

module.exports = { weave3: weave3, mergedLive: mergedLive,
                   fold: fold, merge: merge,
                   bytesEq: bytesEq, extOf: extOf, isBinary: isBinary,
                   MAX_SOURCE_SIZE: MAX_SOURCE_SIZE,
                   MAX_SOURCE_MARKED_UP: MAX_SOURCE_MARKED_UP,
                   //  BEE-005: the ONE weave a diff projects.
                   weaveDiff: weaveDiff, blobDiff: blobDiff,
                   foldWt: foldWt, blobOf: blobOf,
                   layerId: layerId, LAYER_NIL: LAYER_NIL, WT_SRC: WT_SRC,
                   LAYER_CAP: LAYER_CAP };
