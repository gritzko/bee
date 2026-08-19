//  index/weave.js — the CRDT 3-way weave merge ported from be/shared/weave.js
//  over the `abc.ram("CFOLD")` container (LITE-014:47:EL), plus the file weave
//  reconstruction off the REV index: one weave per path, seeded at the LCA
//  floor, every rev above folded once (BEE-005:58:mJ, BEE-005:73:mJ).  This is
//  also the source-size policy home and the one "can we weave it" gate: over
//  the cap or binary, the caller falls back loudly, never to silent-ours
//  (LITE-014:30:EL, LITE-014:48:EL).  Conflicts render markerless (PATCH-025:26:_w).
"use strict";

//  A source larger than this is a blob, neither tokenised nor woven.  One
//  place sets it; everyone imports it.
const MAX_SOURCE_SIZE = 4 << 20;                   // 4 MB
//  A tokenised source runs larger than its raw bytes; 4x covers the worst real
//  case.  Every weave buffer is a lazy anonymous mmap of this fixed size.
const MAX_SOURCE_MARKED_UP = MAX_SOURCE_SIZE * 4;  // 16 MB

//  git's binary heuristic: a blob is binary iff a NUL byte appears in its first
//  8000 bytes.  A binary pair is never tokenised, neither diffed nor woven.
const BIN_PROBE = 8000;
function isBinary(bytes) {
  if (!bytes || !bytes.length) return false;
  const n = bytes.length < BIN_PROBE ? bytes.length : BIN_PROBE;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

//  The basename suffix after the last '.', the weave lexer's language key; no
//  dot (or a dotfile) yields "", the generic tokenizer.
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

//  One CFOLDFold into a fresh fixed buffer.  `ancestors` lists the hashlets
//  of the commit's whole causal closure (itself excluded); everything folded
//  and not named lands in its ignore-set.
function fold(base, blob, ext, hash, ancestors) {
  const w = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
  w.fold(base, blob, ext, hash, ancestors || []);
  return w;
}

//  A contentless merge commit: it appends nothing and records the union view
//  of `ancestors` (the intersected ignore-set).
function merge(base, hash, ancestors) {
  const w = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
  w.merge(base, hash, ancestors || []);
  return w;
}

//  The markerless merged render (PATCH-025:26:_w, DIS-080): the RGA reading of
//  the weave at `rev`, no fences, `groupIds` one hashlet-id array per side.
//  Returns { bytes, spans }, the spans being the conflicting [from,to) ranges:
//  a run of non-shared tokens conflicts iff two membership masks are disjoint.
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
  //  The alive bytes of one membership mask within [lo,hi), concatenated.
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
    //  A divergent run spans until the next shared token; dead tokens ride along.
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
      //  Equal bytes under other birth ids are re-absorbed content, no conflict.
      if (allEq) { put(g0); i = hi; continue; }
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

const _W3_BASE = "0000000000000001", _W3_OURS = "0000000000000002",
      _W3_THRS = "0000000000000003", _W3_MRG = "0000000000000004";
//  The 3-blob weave merge (GET-056b:29): base, then ours and theirs as
//  concurrent folds on it, then a contentless merge over all three, so disjoint
//  edits coexist and a divergent region reads back markerless with spans.
//  null means unweavable (binary, over cap) and the caller falls back loudly.
function weave3(base, ours, theirs, ext) {
  base = base || new Uint8Array(0);
  //  Trivial resolutions carry no conflict spans (PATCH-025, DIS-080).
  const clean = function (b) { return { bytes: b, spans: [] }; };
  if (bytesEq(ours, theirs)) return clean(ours);   // same edit both sides
  if (bytesEq(ours, base)) return clean(theirs);   // only theirs changed
  if (bytesEq(theirs, base)) return clean(ours);   // only ours changed
  //  Over the shared source cap is a blob, not weavable (PATCH-012).
  if (base.length > MAX_SOURCE_SIZE ||
      ours.length > MAX_SOURCE_SIZE ||
      theirs.length > MAX_SOURCE_SIZE) return null;
  //  A binary side is not weavable either; the driver hands it to git's stock
  //  text merge, as it does an over-cap one (LITE-014).
  if (isBinary(base) || isBinary(ours) || isBinary(theirs)) return null;
  const wb = fold(null, base, ext, _W3_BASE, []);
  const wo = fold(wb, ours, ext, _W3_OURS, [_W3_BASE]);
  const wt = fold(wo, theirs, ext, _W3_THRS, [_W3_BASE]);   // concurrent w/ ours
  const wm = merge(wt, _W3_MRG, [_W3_BASE, _W3_OURS, _W3_THRS]);
  return mergedLive(wm, _W3_MRG, [[_W3_BASE, _W3_OURS], [_W3_BASE, _W3_THRS]]);
}

//  --- the file weave reconstruction (BEE-005) --------------------------------
//  be/shared/weave.js `buildDag` over bee's REV index (BEE-005:19:mJ): one weave
//  per path, the blob at the LCA floor folded first as the floor's own commit
//  (BEE-005:58:mJ), then every rev above it once with its ancestor closure.
const ln = require("./dag.js");
const idx = require("./index.js");

//  A layer id is a 16-hex hashlet (cfold.c JABCcfoldHi64).  The index holds
//  60 bits of the commit sha, so the id is that hashlet shifted; the low nibble
//  is always 0, which keeps the reserved ids below off the commit space.
function layerId(chl) { return idx.hexOfHl(chl) + "0"; }
//  The seed when the tips have no common rev, an addition on one side: an
//  empty first layer, so the first real rev reads as a plain insert (BEE-005:64:mJ).
const LAYER_NIL = "0000000000000005";
//  The worktree's on-disk edit rides as a final synthetic layer (BE-010).
const WT_SRC = "00000000005774ed";
//  A path whose history above the floor is deeper than this is re-rooted at
//  the from-side rev, in words: a fold per rev is a cost, not a promise.
const LAYER_CAP = 1 << 10;

//  Blob bytes for a 60-bit blob hashlet, the one ODB read of the whole fold
//  (`git.getHex` takes any 6..40 hexlet as an object name).  undefined when
//  unreadable, not a blob, or over the source cap.
function blobOf(r, bhl) {
  let o = null;
  try { o = idx.object(r, idx.hexOfHl(bhl)); } catch (e) { o = null; }
  if (o === null || o.type !== "blob") return undefined;
  return o.bytes.length > MAX_SOURCE_SIZE ? undefined : o.bytes;
}

//  weaveDiff(r, ix, path, tips, ext) -> the one weave and one reading per tip,
//  in be's `build` shape: `weave`, `views[i] -> { rev, ids }`, `idToHl` (blame).
//  `tips` are `{ chl, blob }`, from-side first; an absent tip (blob undefined)
//  gets an empty layer, so add/delete are plain insert/removal (BEE-005:64:mJ).
function weaveDiff(r, ix, path, tips, ext) {
  const pr = ln.pathRevs(ix, path);
  const reps = new Map();
  const all = [];
  for (const t of tips) {
    const rs = ln.repsOf(ix, pr, t.chl);
    reps.set(t.chl, rs);
    for (const rev of rs) if (all.indexOf(rev) < 0) all.push(rev);
  }
  //  No rev of this path in the index: the tips still fold their own blobs
  //  over an empty seed under their own ids, degraded but never a missing file.
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
  //  An unreadable (or over-cap) floor blob seeds empty rather than dropping
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
      //  Unreadable or a blob, so not woven: carry a parent's view (be foldCommit).
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

  //  be `viewAt`: a tip stands on one rev, or joins several under its own id,
  //  since a merge that touched no path of its own has no rev to stand on.
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
    //  A tip with no commit at all (a root commit's parent) is the empty side.
    const tid = t.chl === null ? LAYER_NIL : layerId(t.chl);
    let rev = null;
    if (live.length === 1) rev = live[0];
    else if (live.length > 1) {                  // the contentless join
      rev = tid;
      w = merge(w, rev, Array.from(ids));
      idToHl.set(rev, t.chl);
      ids.add(rev);
    }
    const own = t.blob === undefined ? new Uint8Array(0)
              : (rev === null ? blobOf(r, idx.hlOfSha(t.blob)) : null);
    if (own !== null && own !== undefined && tid !== seedId && rev !== tid) {
      //  Absent (fold empty, the delete) or unrepresented (fold its bytes):
      //  either way the tip's view is a real layer, never a guess.
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

//  A parent-to-child pair needs no index (BEE-005): the merge base of a commit
//  and its parent is that parent, so the parent's blob is the seed and the
//  child's the one layer above.  Same shape and real commit ids as `weaveDiff`
//  with no rev read, which keeps `bee commit` an ODB-only view.
function blobDiff(from, to, ext) {
  const idToHl = new Map();
  const fid = from.chl === null ? LAYER_NIL : layerId(from.chl);
  if (from.chl !== null) idToHl.set(fid, from.chl);
  let w = fold(null, from.bytes || new Uint8Array(0), ext, fid, []);
  //  The worktree side is no commit: the caller folds it with `foldWt` over
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

//  The worktree's on-disk bytes as a final synthetic layer over the view `rev`,
//  the wt diff's to-side (BE-010, be/shared/weave.js `foldWt`).  An
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
                   //  The one weave a diff projects (BEE-005).
                   weaveDiff: weaveDiff, blobDiff: blobDiff,
                   foldWt: foldWt, blobOf: blobOf,
                   layerId: layerId, LAYER_NIL: LAYER_NIL, WT_SRC: WT_SRC,
                   LAYER_CAP: LAYER_CAP };
