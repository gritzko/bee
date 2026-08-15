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

module.exports = { weave3: weave3, mergedLive: mergedLive,
                   fold: fold, merge: merge,
                   bytesEq: bytesEq, extOf: extOf, isBinary: isBinary,
                   MAX_SOURCE_SIZE: MAX_SOURCE_SIZE,
                   MAX_SOURCE_MARKED_UP: MAX_SOURCE_MARKED_UP };
