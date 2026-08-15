//  index/lindex.js — LITE-033 + BEE-002: `bee lindex`, the BACKLINK round of
//  the one `<gitdir>/be/*.lite2.idx` lane.  The [LITE-006] records say what a
//  path IS (REV/B2P); nothing said who POINTS at it, and "who links to this
//  page" is the one wiki query the lane could not answer.
//
//  RECORD `LINK` (kind nibble 7, the last free one):
//      key = fn_hl:40 | par:20 | 7   val = src path_hl:40 | gpar:20 | vnib:4
//  One row per (dst, src) pair.  Every slot is a truncated TEXT hashlet of the
//  TARGET's own segments — the filename's top 40 bits, the immediate parent
//  dir's top 20, the grandparent's top 20 — under the [LITE-011] FSEG rule: `0`
//  spells absent, a genuine 0 bumps to 1, the filename slot never bumps.
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
//  BEE-002: THE MINT IS TEXT-ONLY.  A ref keys on ITS OWN segments — nothing is
//  resolved, no lane is read and no repo is named — so the indexing ORDER cannot
//  change a key and a cross-repo target keys the same everywhere.  A ticket code
//  (`LITE-029`) keys as its own text with both ancestor slots absent.  Anchors
//  are dropped through `door.js splitRef` — a row names files, not places — and
//  a ref spelling the carrier's own path mints nothing.
//
//  BEE-002: THE QUERY IS A FAN-OUT over the [BEE-001] registry
//  `$HOME/.config/bee/repos`: every registered lane is opened READ-ONLY and
//  none is brought up, two exact-key seeks each (`fn|0`, the bare-filename ref,
//  and `fn|par`) off the target's full path, and a row carrying a `gpar` is kept
//  only when it matches the target's.  No dst repo id is recorded anywhere, so
//  two repos carrying a same-named file produce FALSE SUSPECTS — which the
//  suspects contract licenses, and which registering a repo then costs nothing.
//  Suspects are named back to text per repo (one descent of THAT repo's tip
//  tree) and print repo-qualified, the local repo first.
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

const GPAR_MASK = (1n << 20n) - 1n;

//  key = fn_hl:40 | par:20 | 7 — a rev key whose rev slot holds the parent dir.
function linkKey(fn, par) { return idx.revKey(fn, par, K_LINK); }
//  val = src path_hl:40 | gpar:20 | vnib:4 — the B2P value shape, the rev slot
//  holding the target's GRANDPARENT dir.
function linkVal(srcPhl, gpar) { return idx.pathRevVal(srcPhl, gpar); }
function linkSrc(v) { return v >> 24n; }
function linkGpar(v) { return (v >> 4n) & GPAR_MASK; }

//  --- the target's own segments ---------------------------------------------
//  BEE-002: ONE text -> the three ruled slots, hashed by index.js's own [LITE-011]
//  helpers.  Nothing is resolved here: a path, a partial one and a ticket code
//  all go down the same three lines, which is what makes the mint order-free.
function slots(text) {
  const segs = [];
  for (const s of String(text === undefined ? "" : text).split("/"))
    if (s !== "" && s !== ".") segs.push(s);
  const n = segs.length;
  if (n === 0) return null;
  return { fn: idx.fnHl(segs[n - 1]),
           par: n > 1 ? idx.segHl(segs[n - 2], 20n) : 0n,
           gpar: n > 2 ? idx.segHl(segs[n - 3], 20n) : 0n };
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
  const cache = new Map();
  const splitRef = require("door.js").splitRef;   // the ONE ref split point
  for (const c of changed) {
    //  LITE-044: `descend` now yields changed DIRS as well; a subtree carries
    //  no prose, so it is skipped here rather than read back off the ODB.
    if (c.dir) continue;
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
      if (sp.path === c.path) continue;           // a self-link mints no row
      //  BEE-002: the ref's OWN segments, resolved through nothing at all.
      const q = slots(sp.path);
      if (q === null) continue;
      rec.links++;
      const key = linkKey(q.fn, q.par), val = linkVal(c.phl, q.gpar);
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
//  BEE-002: ONE lane's carriers of `q`.  Two EXACT-key seeks — `fn|0` catches a
//  bare-filename ref, `fn|par` a ref that named the parent — and a row carrying
//  a grandparent is kept only when it is the target's.  Anything spelled deeper
//  keys like a 3-segment ref, so depth costs false suspects, never a wider probe.
function carriers(ix, q, want) {
  const keys = q.par === 0n ? [linkKey(q.fn, 0n)]
                            : [linkKey(q.fn, 0n), linkKey(q.fn, q.par)];
  for (const key of keys) {
    const c = ix.seek(key);
    while (c.next()) {
      if (c.key !== key) break;
      const g = linkGpar(c.val);
      if (g !== 0n && g !== q.gpar) continue;     // another grandparent: not ours
      want.add(linkSrc(c.val));
    }
  }
}

//  The `path_hl` set named back to TEXT by one descent of a tip tree, sorted
//  and deduped — the [LITE-033] naming pass, now run once PER REPO.
function nameIn(r, treeSha, want) {
  const out = [];
  namePaths(r, treeSha, "", want, out);
  out.sort();
  const uniq = [];
  for (const p of out) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq;
}

//  BEE-002: ONE registered repo's answer, repo-qualified.  Its lane is opened
//  READ-ONLY and never brought up — a stale foreign lane answers with fewer
//  suspects, never a wrong one — and anything unopenable is skipped in silence.
function foreign(path, q) {
  let ctx = null, ix = null;
  try {
    ctx = idx.openRepo(path, false);
    if (idx.fresh(ctx.gitdir)) return [];         // no lane of this format
    ix = idx.openIndex(ctx.gitdir, false, true);
    const want = new Set();
    carriers(ix, q, want);
    if (want.size === 0) return [];
    const tipC = idx.readCommit(ctx.r, ctx.head.sha);
    if (tipC === null || !tipC.tree) return [];
    return nameIn(ctx.r, tipC.tree, want).map(function (p) {
      return ctx.root + "/" + p;
    });
  } catch (e) { return []; }
  finally {
    if (ix !== null) { try { ix.close(); } catch (e) {} }
    if (ctx !== null) idx.closeRepo(ctx);
  }
}

//  suspects(ctx, ix, target, opts) -> the paths that MAY link to `target`,
//  repo-qualified, the LOCAL repo first and the registered ones after it in
//  path order.  The target's own full path is resolved LOCALLY (the one thing
//  a query still descends for); a target several files answer is an ambiguity
//  the caller must settle, in the plain words index/resolve.js's `pick` uses.
function suspects(ctx, ix, target, opts) {
  const tipC = idx.readCommit(ctx.r, ctx.head.sha);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit at " + ctx.head.ref;
  const paths = rs.resolve(ix, ctx.r, tipC.tree, target);
  if (paths.length > 1)
    throw "lindex: " + target + " names " + paths.length + " files at " +
          ctx.head.sha.slice(0, 8) + " — say which:\n  " + paths.join("\n  ") + "\n";
  //  The slots come from TEXT exactly as the scan minted them: the resolved
  //  path when one file answers, the target verbatim (a ticket code) otherwise.
  const q = slots(paths.length === 1 ? paths[0] : target);
  if (q === null) return [];
  const out = [], seen = new Set();
  const want = new Set();
  carriers(ix, q, want);
  if (want.size) for (const p of nameIn(ctx.r, tipC.tree, want)) {
    const line = ctx.root + "/" + p;
    if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  for (const repo of idx.repos(opts && opts.home).sort()) {
    if (repo === ctx.root || repo === ctx.repo) continue;   // the local lane answered
    let real = repo;
    try { real = io.realpath(repo); } catch (e) {}
    if (real === ctx.root) continue;
    for (const line of foreign(repo, q))
      if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  return out;
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
      return { rec: rec, paths: t === null ? null : suspects(ctx, ix, t, opts) };
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
                   scan: scan, suspects: suspects, slots: slots,
                   linkKey: linkKey, linkVal: linkVal, linkSrc: linkSrc,
                   linkGpar: linkGpar, carriers: carriers, foreign: foreign,
                   markKey: markKey, markCommits: markCommits,
                   K_LINK: K_LINK, LINDEX_REF: LINDEX_REF };
