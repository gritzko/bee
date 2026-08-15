//  index/lindex.js — LITE-033: `lite lindex`, the BACKLINK round of the one
//  `<gitdir>/be/*.lite.idx` lane.  The [LITE-006] records say what a path IS
//  (REV/B2P); nothing said who POINTS at it, and "who links to this page" is
//  the one wiki query the lane could not answer.
//
//  RECORD `LINK` (kind nibble 7, the last free one):
//      key = dst_hl:40 | 0:20 | 7        val = src path_hl:40 | 0:20 | vnib:4
//  One row per (dst, src) pair; the spare 20 bits and `vnib` are RESERVED (0).
//
//  SUSPECTS, NOT PROOF (ruling 2026-08-15).  A row says "this file MAY link
//  there"; precision comes from OPENING the suspect, never from deleting a row
//  or hopping over the tip.  A removed link therefore leaves a false suspect
//  behind, which is exactly what keeps the lane's never-delete, idempotent
//  contract intact — the index only narrows the grep.
//
//  LAZY, TIP-ONLY, NEW BLOBS ONLY.  A MARK-style row under the RESERVED ref
//  `hlOfText("lindex")` holds the commit the last scan finished at:
//   1. the tip is already the mark -> no-op, not one byte written;
//   2. else `index.js descend` diffs mark..tip and hands back exactly the paths
//      whose blob MOVED, each with its new tip blob — the same pruning tree
//      diff the rev derivation rides, so there is no second walk;
//   3. each such blob is TOKENISED and its `F` tokens read (index/hook.js's
//      `fTokens` — the ONE recognizer, ruling 2026-08-15: a link is whatever
//      the DOG-034 lexer fuses, and nothing here re-scans raw bytes);
//   4. the mark row is the LAST write, so an interrupted scan simply re-scans.
//  A rewritten history needs no special case: the mark row just jumps, and a
//  mark commit that no longer reads makes the run a full tip walk.
//
//  THE DST IS TARGET TEXT, not a resolved object: the repo-relative PATH TEXT
//  for a file link (so `abc/TCP.c` and `src/abc/TCP.c` key the same row), the
//  BARE TICKET CODE for a ticket link (so a ticket's backlinks survive the
//  thin<->fat layout move).  Anchors are dropped — a row names files, not
//  places — and a self-link mints nothing.
"use strict";

const idx = require("./index.js");
const hk = require("./hook.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

//  Nibble 7: [LITE-006] spends 1..5 and F, [LITE-011] took 6.
const K_LINK = 0x7n;
//  The RESERVED ref name the incremental mark hangs on.  It is not a ref, so it
//  can never collide with a real one's [LITE-006] watermark.
const LINDEX_REF = "lindex";

//  key = dst_hl:40 | 0:20 | 7 — a rev key with the rev slot held at 0.
function linkKey(dstHl) { return idx.revKey(dstHl, 0n, K_LINK); }
//  val = src path_hl:40 | 0:20 | vnib:4 — the B2P value shape, rev slot 0.
function linkVal(srcPhl) { return idx.pathRevVal(srcPhl, 0n); }
function linkSrc(v) { return v >> 24n; }

//  --- the target text --------------------------------------------------------
//  A fused ref's path -> the TEXT its dst_hl is minted from, or null when the
//  indexer must not guess.  ONE file answers -> that repo-relative path; SEVERAL
//  answer -> an ambiguity, skipped hook-style; NONE answers -> the ref's own
//  text, verbatim, which is precisely the ruled ticket-code dst (`LITE-029`
//  names no file and needs none).  Resolution is the [LITE-011] FSEG descent,
//  the ONE resolver — there is no second one here.
function dstText(ctx, ix, treeSha, partial, memo) {
  const hit = memo.get(partial);
  if (hit !== undefined) return hit;
  let out;
  try {
    const paths = rs.resolve(ix, ctx.r, treeSha, partial);
    out = paths.length > 1 ? null : (paths.length === 1 ? paths[0] : partial);
  } catch (e) { out = null; }
  memo.set(partial, out);
  return out;
}

//  --- the way back to TEXT ---------------------------------------------------
//  `path_hl` is a one-way 40-bit hash and the lane hands back no name
//  ([INDEXES.mkd] "NO path text"), so the suspects are named the [LITE-011] way:
//  the lane narrows, a REAL TREE OBJECT answers.  One descent of the TIP tree
//  hashes every path it carries and keeps the ones the rows asked for — no
//  sidecar record, so the stated gap survives untouched, and a suspect whose
//  file is gone from the tip simply does not print (it carries no link now).
function namePaths(r, treeSha, prefix, want, out) {
  const ents = idx.readTree(r, treeSha);
  if (ents === null) return;
  for (const [name, e] of ents) {
    const path = prefix + name;
    if (e.dir) { namePaths(r, e.sha, path + "/", want, out); continue; }
    if (want.has(idx.pathHl(path))) out.push(path);
  }
}

//  --- the lane ---------------------------------------------------------------
//  Every val already sitting on one key.  A wh128 lane is UNKEYED, so a re-put
//  is a duplicate ROW rather than an overwrite — this is what makes a re-scan
//  of the same blob write nothing at all.
function valsOn(ix, key, cache) {
  let s = cache.get(key);
  if (s !== undefined) return s;
  s = new Set();
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    s.add(c.val);
  }
  cache.set(key, s);
  return s;
}

function markKey() { return idx.hlKey(idx.hlOfText(LINDEX_REF), idx.K_MARK); }

//  Every commit the lindex mark names.  Bumping a mark writes a SECOND row on
//  the same key and nothing in a row says which is newer — which is fine: they
//  are all commits whose tip blobs were scanned, so every one of them is a legal
//  base for the diff, and `descend` prunes a path unchanged since ANY of them.
function markCommits(ix) {
  const key = markKey();
  const out = [];
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    out.push(idx.valHl60(c.val));
  }
  return out;
}

function blobBytes(ctx, sha) {
  const o = idx.object(ctx.r, sha);
  return o === null || o.type !== "blob" ? null : o.bytes;
}

//  --- the scan ---------------------------------------------------------------
//  scan(ctx, ix) -> the summary record.  Brings the LINK rows up to the tip and
//  writes the mark LAST.
function scan(ctx, ix) {
  const r = ctx.r, tip = ctx.head.sha, tipHl = idx.hlOfSha(tip);
  const rec = { ref: ctx.head.ref, tip: tip, gitdir: ctx.gitdir,
                upToDate: false, files: 0, links: 0, rows: 0 };
  //  1. the O(1) no-op: the tip is already scanned, so nothing is even read.
  const marks = markCommits(ix);
  for (const m of marks) if (m === tipHl) { rec.upToDate = true; return rec; }

  const tipC = idx.readCommit(r, tip);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit " + tip.slice(0, 8) + " at " + ctx.head.ref;

  //  2. the changed paths of mark..tip, each with its NEW tip blob.  An
  //  unreadable mark (a rewritten history) simply drops out, and with no base
  //  left the run walks the whole tip tree — the mark row jumped, no special case.
  const pTrees = [];
  for (const m of marks) {
    const mc = idx.readCommit(r, idx.hexOfHl(m));
    if (mc !== null && mc.tree) pTrees.push(mc.tree);
  }
  const changed = [];
  idx.descend(r, tipC.tree, pTrees, "", changed);

  //  3. one tokenised pass per new blob.
  const wr = idx.idxWriter(ix);
  const cache = new Map(), memo = new Map();
  const splitRef = require("main.js").splitRef;   // the ONE ref split point
  for (const c of changed) {
    const bytes = blobBytes(ctx, c.blob);
    if (bytes === null) continue;
    //  Only PROSE-bearing blobs are scanned: a binary blob and one over the
    //  shared source cap are not tokenised at all ([LITE-014]'s one gate).
    if (bytes.length > wv.MAX_SOURCE_SIZE || wv.isBinary(bytes)) continue;
    rec.files++;
    for (const t of hk.fTokens(bytes, wv.extOf(c.path))) {
      //  The anchor is shed through main.js's ONE `splitRef` — the row names a
      //  FILE, not a place, so `:12:24` and `:k4:d8K3` alike drop here.
      const sp = splitRef(t.text);
      if (sp.path === "") continue;
      const dst = dstText(ctx, ix, tipC.tree, sp.path, memo);
      if (dst === null) continue;                 // ambiguous: never guessed
      if (dst === c.path) continue;               // a self-link mints no row
      rec.links++;
      const key = linkKey(idx.pathHl(dst)), val = linkVal(c.phl);
      const have = valsOn(ix, key, cache);
      if (have.has(val)) continue;                // already a suspect: idempotent
      have.add(val);
      wr.put(key, val);
      rec.rows++;
    }
  }
  wr.seal();

  //  4. the MARK is the run's LAST write (DOG-027), so a scan killed half way
  //  leaves rows that are all true and a mark that simply lags.
  ix.put(markKey(), idx.hlVal(tipHl, 0n));
  ix.commit(true);
  rec.rows++;
  return rec;
}

//  --- the query --------------------------------------------------------------
//  suspects(ctx, ix, target) -> the paths that MAY link to `target`, sorted.
//  ONE prefix scan of the target's dst_hl, then the tip-tree naming pass.  A
//  target several files answer is an ambiguity the caller must settle, in the
//  plain words index/resolve.js's `pick` uses.
function suspects(ctx, ix, target) {
  const tipC = idx.readCommit(ctx.r, ctx.head.sha);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit at " + ctx.head.ref;
  const paths = rs.resolve(ix, ctx.r, tipC.tree, target);
  if (paths.length > 1)
    throw "lindex: " + target + " names " + paths.length + " files at " +
          ctx.head.sha.slice(0, 8) + " — say which:\n  " + paths.join("\n  ") + "\n";
  //  The dst is minted from TEXT exactly as the scan minted it: the resolved
  //  path when one file answers, the target verbatim (a ticket code) otherwise.
  const text = paths.length === 1 ? paths[0] : target;
  const key = linkKey(idx.pathHl(text));
  const want = new Set();
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    want.add(linkSrc(c.val));
  }
  if (want.size === 0) return [];
  const out = [];
  namePaths(ctx.r, tipC.tree, "", want, out);
  out.sort();
  const uniq = [];
  for (const p of out) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq;
}

//  --- the run ----------------------------------------------------------------
//  lindex(target) -> { rec, paths }.  `paths` is null for the bare form (bring
//  the rows up to date and report), the suspect list otherwise.  Either way the
//  LITE-006 lane is brought up first: the FSEG rows the resolver descends are
//  its, so a stale base index would answer with fewer files than exist.
function lindex(target, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.repo === undefined ? io.cwd() : opts.repo, true);
  try {
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    try {
      idx.bringUp(ctx, ix, { track: false });
      const rec = scan(ctx, ix);
      const t = target === undefined || target === "" ? null : target;
      return { rec: rec, paths: t === null ? null : suspects(ctx, ix, t) };
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
}

//  The one-line summary the bare verb prints.
function summary(rec) {
  const tip = rec.tip.slice(0, 8);
  if (rec.upToDate)
    return "up to date: links at " + rec.ref + " " + tip + " in " +
           rec.gitdir + "/" + idx.IDX_DIR;
  return "scanned " + rec.files + " files, " + rec.links + " links, " +
         rec.rows + " rows — " + rec.ref + " " + tip + " in " +
         rec.gitdir + "/" + idx.IDX_DIR;
}

module.exports = { lindex: lindex, summary: summary,
                   scan: scan, suspects: suspects, dstText: dstText,
                   linkKey: linkKey, linkVal: linkVal, linkSrc: linkSrc,
                   markKey: markKey, markCommits: markCommits,
                   K_LINK: K_LINK, LINDEX_REF: LINDEX_REF };
