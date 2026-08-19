//  index/lindex.js — the backlink round of the one index: "who links to this
//  page", answered as suspects, not proof (LITE-033:18:PS), so rows are never
//  deleted and re-puts write nothing.  A LINK row (kind 7, BEE-002:46:qe) keys on
//  text hashlets of the target's own segments, minted from the ref text alone
//  (BEE-002:50:qe) with no repo id (BEE-002:55:qe), so indexing order cannot change
//  a key.  The scan is lazy and tip-only (LITE-033:20:PS, LITE-033:32:PS); the
//  query fans out read-only over the registry (BEE-002:60:qe, BEE-002:65:qe).
"use strict";

const idx = require("./index.js");
const hk = require("./hook.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

//  Nibble 7: LITE-006:17:Rc spends 1..5 and F, LITE-011:26:a9 took 6.
const K_LINK = 0x7n;
//  The reserved ref name the incremental mark hangs on (LITE-033:32:PS); not a
//  real ref, so it can never collide with one's LITE-006 watermark.
const LINDEX_REF = "lindex";

const GPAR_MASK = (1n << 20n) - 1n;

//  key = fn_hl:40 | par:20 | 7, a rev key whose rev slot holds the parent dir.
function linkKey(fn, par) { return idx.revKey(fn, par, K_LINK); }
//  val = src path_hl:40 | gpar:20 | vnib:4, the B2P value shape with the rev
//  slot holding the target's grandparent dir.
function linkVal(srcPhl, gpar) { return idx.pathRevVal(srcPhl, gpar); }
function linkSrc(v) { return v >> 24n; }
function linkGpar(v) { return (v >> 4n) & GPAR_MASK; }

//  --- the target's own segments ---------------------------------------------
//  One text -> the three ruled slots (BEE-002:50:qe), hashed by the LITE-011
//  helpers.  Nothing is resolved: a path, a partial one and a ticket code all
//  go down the same three lines, which is what makes the mint order-free.
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

//  --- the way back to text ---------------------------------------------------
//  `path_hl` is one-way and the index hands back no name (LITE-033:78:PS), so
//  suspects are named the LITE-011 way: one descent of the tip tree keeps the
//  paths the rows asked for.  A suspect gone from the tip simply does not print.
function namePaths(r, treeSha, prefix, want, out) {
  const ents = idx.readTree(r, treeSha);
  if (ents === null) return;
  for (const [name, e] of ents) {
    const path = prefix + name;
    if (e.dir) { namePaths(r, e.sha, path + "/", want, out); continue; }
    if (want.has(idx.pathHl(path))) out.push(path);
  }
}

//  --- the index ---------------------------------------------------------------
//  Every val already sitting on one key.  A wh128 index is unkeyed, so a re-put
//  is a duplicate row rather than an overwrite; checking here is what makes a
//  re-scan of the same blob write nothing at all.
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

//  Every commit the lindex mark names.  Bumping a mark writes a second row on
//  the same key and nothing says which is newer, which is fine: all of them
//  had their tip blobs scanned, so each is a legal base for the diff, and
//  `descend` prunes a path unchanged since any of them.
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
//  writes the mark last.
function scan(ctx, ix) {
  const r = ctx.r, tip = ctx.head.sha, tipHl = idx.hlOfSha(tip);
  const rec = { ref: ctx.head.ref, tip: tip, gitdir: ctx.gitdir,
                upToDate: false, files: 0, links: 0, rows: 0 };
  //  1. The O(1) no-op: the tip is already scanned, so nothing is even read.
  const marks = markCommits(ix);
  for (const m of marks) if (m === tipHl) { rec.upToDate = true; return rec; }

  const tipC = idx.readCommit(r, tip);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit " + tip.slice(0, 8) + " at " + ctx.head.ref;

  //  2. The changed paths of mark..tip, each with its new tip blob; an unreadable
  //  mark (a rewritten history) drops out and the run walks the whole tip tree.
  const pTrees = [];
  for (const m of marks) {
    const mc = idx.readCommit(r, idx.hexOfHl(m));
    if (mc !== null && mc.tree) pTrees.push(mc.tree);
  }
  const changed = [];
  idx.descend(r, tipC.tree, pTrees, "", changed);

  //  3. One tokenised pass per new blob.
  const wr = idx.idxWriter(ix);
  const cache = new Map();
  const splitRef = require("door.js").splitRef;   // the one ref split point
  for (const c of changed) {
    //  `descend` yields changed dirs as well (LITE-044); a subtree carries no
    //  prose, so it is skipped here rather than read back off the ODB.
    if (c.dir) continue;
    const bytes = blobBytes(ctx, c.blob);
    if (bytes === null) continue;
    //  Only prose-bearing blobs are scanned: a binary blob and one over the
    //  shared source cap are not tokenised at all (LITE-014's one gate).
    if (bytes.length > wv.MAX_SOURCE_SIZE || wv.isBinary(bytes)) continue;
    rec.files++;
    for (const t of hk.fTokens(bytes, wv.extOf(c.path))) {
      //  The anchor is shed through the one `splitRef`: the row names a file,
      //  not a place, so `:12:24` and `:58:mJ` alike drop here.
      const sp = splitRef(t.text);
      if (sp.path === "") continue;
      if (sp.path === c.path) continue;           // a self-link mints no row
      //  The ref's own segments, resolved through nothing at all (BEE-002).
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

  //  4. The mark is the run's last write (DOG-027), so a scan killed half way
  //  leaves rows that are all true and a mark that simply lags.
  ix.put(markKey(), idx.hlVal(tipHl, 0n));
  ix.commit(true);
  rec.rows++;
  return rec;
}

//  --- the query --------------------------------------------------------------
//  One index's carriers of `q` (BEE-002:60:qe): two exact-key seeks, `fn|0` for
//  a bare-filename ref and `fn|par` for one naming the parent, keeping a `gpar`
//  row only when it is the target's.  Depth costs false suspects, never a probe.
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

//  The `path_hl` set named back to text by one descent of a tip tree, sorted
//  and deduped: the LITE-033 naming pass, run once per repo.
function nameIn(r, treeSha, want) {
  const out = [];
  namePaths(r, treeSha, "", want, out);
  out.sort();
  const uniq = [];
  for (const p of out) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq;
}

//  One registered repo's answer, repo-qualified (BEE-002:65:qe).  Its index is
//  opened read-only and never brought up, since a stale foreign index answers
//  with fewer suspects, never a wrong one; anything unopenable is skipped.
function foreign(path, q) {
  let ctx = null, ix = null;
  try {
    ctx = idx.openRepo(path, false);
    if (idx.fresh(ctx.gitdir)) return [];         // no index of this format
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

//  suspects(ctx, ix, target, opts) -> the paths that may link to `target`,
//  repo-qualified, the local repo first, registered ones after (BEE-002:68:qe).
//  The target's full path is resolved locally (the one descent a query keeps);
//  several files answering is an ambiguity the caller settles, in plain words.
function suspects(ctx, ix, target, opts) {
  const tipC = idx.readCommit(ctx.r, ctx.head.sha);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit at " + ctx.head.ref;
  const paths = rs.resolve(ix, ctx.r, tipC.tree, target);
  if (paths.length > 1)
    throw "lindex: " + target + " names " + paths.length + " files at " +
          ctx.head.sha.slice(0, 8) + " — say which:\n  " + paths.join("\n  ") + "\n";
  //  The slots come from text exactly as the scan minted them: the resolved
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
    if (repo === ctx.root || repo === ctx.repo) continue;   // the local index answered
    let real = repo;
    try { real = io.realpath(repo); } catch (e) {}
    if (real === ctx.root) continue;
    for (const line of foreign(repo, q))
      if (!seen.has(line)) { seen.add(line); out.push(line); }
  }
  return out;
}

//  --- the run ----------------------------------------------------------------
//  lindex(target) -> { rec, paths }, `paths` being null for the bare form and
//  the suspect list otherwise.  Either way the LITE-006 index is brought up
//  first: the resolver descends its FSEG rows, and stale ones would miss files.
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
           idx.indexDir(rec.gitdir);
  return "scanned " + rec.files + " files, " + rec.links + " links, " +
         rec.rows + " rows — " + rec.ref + " " + tip + " in " +
         idx.indexDir(rec.gitdir);
}

module.exports = { lindex: lindex, summary: summary,
                   scan: scan, suspects: suspects, slots: slots,
                   linkKey: linkKey, linkVal: linkVal, linkSrc: linkSrc,
                   linkGpar: linkGpar, carriers: carriers, foreign: foreign,
                   markKey: markKey, markCommits: markCommits,
                   K_LINK: K_LINK, LINDEX_REF: LINDEX_REF };
