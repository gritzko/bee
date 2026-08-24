//  index/lindex.js — the backlink round of the one index: "who links to this
//  page", answered as suspects, not proof (LITE-033:18:PS), so rows are never
//  deleted and re-puts write nothing.  A LINK row (kind 7, BEE-002:46:qe) keys on
//  text hashlets of the target's own segments, minted from the ref text alone
//  (BEE-002:50:qe) with no repo id (BEE-002:55:qe), so indexing order cannot change
//  a key.  The scan is lazy and tip-only (LITE-033:20:PS, LITE-033:32:PS); the
//  query fans out over the registry, each lane brought up first (BEE-065:21).
//  BEE-063:28 rides that one pass with a second family, SYM (kind 9), and the
//  `bee sym` verb — same suspects contract, its own watermark.
"use strict";

const idx = require("./index.js");
const hk = require("./hook.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

//  Kind 7: LITE-006:17:Rc spends 1..5 and F, LITE-011:26:a9 took 6.
const K_LINK = 0x7n;
//  The reserved ref name the incremental mark hangs on (LITE-033:32:PS); not a
//  real ref, so it can never collide with one's LITE-006 watermark.
const LINDEX_REF = "lindex";
//  The SYM round's own watermark ref (BEE-063:24): sharing lindex's would read
//  a pre-SYM index as done and no blob would ever be re-lexed for symbols.
const SYMDEX_REF = "symdex";

const GPAR_MASK = (1n << 20n) - 1n;

//  key = 7 | fn_hl:40 | par:20, a rev key whose rev slot holds the parent dir.
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

//  --- SYM, the symbol-mention record (BEE-063) --------------------------------
//  key = 9 | sym_hl:40 | types:20, val = seg0..seg3:10 ROOT-FIRST | fn_hl:20 |
//  vnib:4: ONE row per (symbol, file), LINK's field vocabulary cut to what a
//  pruned descent needs.  Suspects like LINK's — the row says the symbol MAY be
//  there and the open confirms (BEE-063:9).
const SYM_SEGS = 4;                          // the val holds the top four dirs
const SYM_SLOTS = 4;                         // and the key four 5-bit tags
const TAG_BITS = 5n;
const SEG10_MASK = (1n << 10n) - 1n;
const FN20_MASK = (1n << 20n) - 1n;
//  Past this many suspects in one repo the verb prints the count instead of
//  descending the tree (BEE-063:37): `ctx` legitimately sits in every file.
const SYM_CAP = 200;

function symKey(symHl, types) { return idx.revKey(symHl, types, idx.K_SYM); }
function symVal(chain, fn20) {
  let v = 0n;
  for (let i = 0; i < SYM_SEGS; i++)
    v = (v << 10n) | (i < chain.length ? chain[i] : 0n);
  return (v << 24n) | (fn20 << 4n);
}
function symSeg(v, i) { return (v >> BigInt(54 - 10 * i)) & SEG10_MASK; }
function symFn(v) { return (v >> 4n) & FN20_MASK; }
//  The val minus its reserved nibble, which is what a query compares: a path
//  the descent reaches keys the same way the mint keyed the carrier.
function symSig(v) { return v >> 4n; }
function sigSeg(s, i) { return (s >> BigInt(50 - 10 * i)) & SEG10_MASK; }

//  The basename's top 20 hashlet bits.  No bump: a filename is never absent,
//  which is the one place FSEG's `0 = absent` rule does not apply.
function fn20(name) { return idx.hlOfText(name) >> 40n; }

//  One repo-relative path -> the val every row for a symbol in it carries.  A
//  path deeper than SYM_SEGS says nothing about its near levels, so the descent
//  goes wide there, exactly as the FSEG one does past its own slots.
function symRow(path) {
  const segs = path.split("/");
  const dirs = segs.slice(0, -1);
  const chain = [];
  for (let i = 0; i < dirs.length && i < SYM_SEGS; i++)
    chain.push(idx.segHl(dirs[i], 10n));
  return symVal(chain, fn20(segs[segs.length - 1]));
}

//  The four tag slots, CANONICAL or idempotence dies (BEE-063:21): sorted
//  ascending, deduped, `0` spells absent ('A' is no tag) and the lowest four
//  win, so a re-lex of the same blob rebuilds the very same key.
function typeSlots(tags) {
  const s = [];
  for (const t of tags) if (s.indexOf(t) < 0) s.push(t);
  s.sort(function (a, b) { return a - b; });
  let v = 0n;
  for (let i = 0; i < SYM_SLOTS; i++)
    v = (v << TAG_BITS) | (i < s.length ? BigInt(s[i]) : 0n);
  return v;
}

//  Only code tokens mint (BEE-063:25).  The DOG-034 lexer tags an identifier
//  `S`, a defined name `N` and a call `C` (dog/tok/DEF.h), while comment prose
//  is `D`, a string `G` and a keyword `R` — none of them a symbol to grep for.
const SYM_TAGS = new Set([18, 13, 2]);
const SYM_MIN = 3;                     // shorter than three chars never mints

//  One blob's symbols -> Map(text -> the tags it lexed as here).  Deduped at
//  mint time, so a symbol used twenty times in a file is ONE row (BEE-063:23),
//  and read off the array the F-token filter already parsed — no second lex.
function symsOf(bytes, toks) {
  const out = new Map();
  let lo = 0;
  for (let i = 0; i < toks.length; i++) {
    const at = lo, hi = toks[i] & 0xffffff;
    lo = hi;
    if (hi - at < SYM_MIN) continue;
    const tag = (toks[i] >>> 27) & 0x1f;
    if (!SYM_TAGS.has(tag)) continue;
    const text = utf8.Decode(bytes.slice(at, hi));
    if (text.length < SYM_MIN) continue;
    let s = out.get(text);
    if (s === undefined) out.set(text, s = []);
    if (s.indexOf(tag) < 0) s.push(tag);
  }
  return out;
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

function markKey(ref) {
  return idx.hlKey(idx.hlOfText(ref === undefined ? LINDEX_REF : ref), idx.K_MARK);
}

//  Every commit one round's mark names.  Bumping a mark writes a second row on
//  the same key and nothing says which is newer, which is fine: all of them
//  had their tip blobs scanned, so each is a legal base for the diff, and
//  `descend` prunes a path unchanged since any of them.
function markCommits(ix, ref) {
  const key = markKey(ref);
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
//  scan(ctx, ix) -> the summary record.  ONE tokenised pass over the moved tip
//  blobs yields BOTH families (BEE-063:28), each off its own mark, and the
//  marks are the run's last writes.
function scan(ctx, ix) {
  const r = ctx.r, tip = ctx.head.sha, tipHl = idx.hlOfSha(tip);
  const rec = { ref: ctx.head.ref, tip: tip, gitdir: ctx.gitdir,
                upToDate: false, files: 0, links: 0, syms: 0, rows: 0 };
  //  1. The O(1) no-op: both rounds are already at the tip, so nothing is read.
  const lMarks = markCommits(ix, LINDEX_REF), sMarks = markCommits(ix, SYMDEX_REF);
  const linkUp = lMarks.indexOf(tipHl) >= 0, symUp = sMarks.indexOf(tipHl) >= 0;
  if (linkUp && symUp) { rec.upToDate = true; return rec; }

  const tipC = idx.readCommit(r, tip);
  if (tipC === null || !tipC.tree)
    throw "lindex: cannot read the commit " + tip.slice(0, 8) + " at " + ctx.head.ref;

  //  2. The changed paths of mark..tip, each with its new tip blob; an unreadable
  //  mark (a rewritten history) drops out and the run walks the whole tip tree.
  //  The base is what BOTH rounds already hold: a mark only one of them reached
  //  would prune a path the other still owes.
  const base = linkUp ? sMarks : symUp ? lMarks
             : lMarks.filter(function (m) { return sMarks.indexOf(m) >= 0; });
  const pTrees = [];
  for (const m of base) {
    const mc = idx.readCommit(r, idx.hexOfHl(m));
    if (mc !== null && mc.tree) pTrees.push(mc.tree);
  }
  const changed = [];
  idx.descend(r, tipC.tree, pTrees, "", changed);

  //  3. One tokenised pass per new blob, two families out of it.
  const wr = idx.idxWriter(ix);
  const cache = new Map();
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
    const toks = hk.parse(bytes, wv.extOf(c.path));
    if (!linkUp) linkRows(ix, wr, cache, rec, c, bytes, toks);
    if (!symUp) symRowsOf(ix, wr, cache, rec, c, bytes, toks);
  }
  wr.seal();

  //  4. A mark is its round's last write (DOG-027), so a scan killed half way
  //  leaves rows that are all true and a mark that simply lags.
  if (!linkUp) { ix.put(markKey(LINDEX_REF), idx.hlVal(tipHl, 0n)); rec.rows++; }
  if (!symUp) { ix.put(markKey(SYMDEX_REF), idx.hlVal(tipHl, 0n)); rec.rows++; }
  ix.commit(true);
  return rec;
}

//  One blob's LINK rows (LITE-033): every `F` token the lexer fused, keyed by
//  the ref's own segments and by nothing this repo resolved.
function linkRows(ix, wr, cache, rec, c, bytes, toks) {
  const splitRef = require("door.js").splitRef;   // the one ref split point
  for (const t of hk.fTokensOn(bytes, toks)) {
    //  The anchor is shed through the one `splitRef`: the row names a file,
    //  not a place, so `:12:24` and `:58:mJ` alike drop here.
    const sp = splitRef(t.text);
    if (sp.path === "") continue;
    if (sp.path === c.path) continue;             // a self-link mints no row
    //  The ref's own segments, resolved through nothing at all (BEE-002).
    const q = slots(sp.path);
    if (q === null) continue;
    rec.links++;
    const key = linkKey(q.fn, q.par), val = linkVal(c.phl, q.gpar);
    const have = valsOn(ix, key, cache);
    if (have.has(val)) continue;                  // already a suspect: idempotent
    have.add(val);
    wr.put(key, val);
    rec.rows++;
  }
}

//  One blob's SYM rows (BEE-063): one per symbol the gates let through, keyed
//  by the symbol text VERBATIM and by the canonical tags it lexed as here.
function symRowsOf(ix, wr, cache, rec, c, bytes, toks) {
  const val = symRow(c.path);
  for (const [text, tags] of symsOf(bytes, toks)) {
    rec.syms++;
    const key = symKey(idx.fnHl(text), typeSlots(tags));
    const have = valsOn(ix, key, cache);
    if (have.has(val)) continue;                  // already a suspect: idempotent
    have.add(val);
    wr.put(key, val);
    rec.rows++;
  }
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
//  brought UP first (BEE-065:21), since a cold or swept lane would answer
//  silence; a repo that refuses the bring-up falls down `upForeign`'s ladder.
function foreign(path, q) {
  let ctx = null, ix = null;
  try {
    ctx = idx.openRepo(path, false);
    ix = idx.upForeign(ctx, "indexing " + ctx.root);
    if (ix === null) return [];                   // no lane to read at all
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

//  --- the symbol query (BEE-063:19) -------------------------------------------
//  One index's rows for one `sym_hl`: ONE prefix scan, since the kind's top
//  nibble gives the family a range of its own.  -> the distinct val payloads.
function symSuspects(ix, symhl, want) {
  const c = ix.seek(symKey(symhl, 0n));
  while (c.next()) {
    if (idx.keyKind(c.key) !== idx.K_SYM || idx.keyPhl(c.key) !== symhl) break;
    want.add(symSig(c.val));
  }
}

//  The dir hashlets the rows name, level by level: the descent's prune table.
//  A `0` slot names no dir at that level, so it lets nothing through.
function segLevels(want) {
  const dirs = [];
  for (let i = 0; i < SYM_SEGS; i++) dirs.push(new Set());
  for (const sig of want)
    for (let i = 0; i < SYM_SEGS; i++) {
      const s = sigSeg(sig, i);
      if (s !== 0n) dirs[i].add(s);
    }
  return dirs;
}

//  The suspects named back to TEXT by a descent of the tip tree PRUNED by the
//  rows' own segment hashlets — only a dir some row names is entered, which is
//  cheaper than lindex's full descent (BEE-063:19).  A file confirms on the
//  whole tuple, so depth is answered by the slots and never guessed.
function nameSyms(r, treeSha, depth, want, dirs, prefix, out) {
  const ents = idx.readTree(r, treeSha);
  if (ents === null) return;
  for (const [name, e] of ents) {
    if (e.dir) {
      //  Below the four slots a row says nothing, so the descent goes wide.
      if (depth < SYM_SEGS && !dirs[depth].has(idx.segHl(name, 10n))) continue;
      nameSyms(r, e.sha, depth + 1, want, dirs, prefix + name + "/", out);
      continue;
    }
    const path = prefix + name;
    if (want.has(symSig(symRow(path)))) out.push(path);
  }
}

//  One repo's answer, repo-qualified.  Past the cap it prints the count and
//  asks for a narrower query instead of descending the whole tree (BEE-063:37).
function symIn(ctx, ix, symhl, out) {
  const want = new Set();
  symSuspects(ix, symhl, want);
  if (want.size === 0) return;
  if (want.size > SYM_CAP) {
    out.push(ctx.root + ": " + want.size + " files carry it — narrow the query");
    return;
  }
  const tipC = idx.readCommit(ctx.r, ctx.head.sha);
  if (tipC === null || !tipC.tree) return;
  const paths = [];
  nameSyms(ctx.r, tipC.tree, 0, want, segLevels(want), "", paths);
  paths.sort();
  for (const p of paths) out.push(ctx.root + "/" + p);
}

//  One registered repo's answer (BEE-002:65:qe), off a lane brought UP first
//  (BEE-065:21): a repo registered yesterday, or one fed by a plain `git push`,
//  used to answer nothing at all.  Anything unopenable is skipped in silence.
function symForeign(path, symhl, out) {
  let ctx = null, ix = null;
  try {
    ctx = idx.openRepo(path, false);
    ix = idx.upForeign(ctx, "indexing " + ctx.root);
    if (ix === null) return;                      // no lane to read at all
    symIn(ctx, ix, symhl, out);
  } catch (e) { return; }
  finally {
    if (ix !== null) { try { ix.close(); } catch (e) {} }
    if (ctx !== null) idx.closeRepo(ctx);
  }
}

//  sym(ident, opts) -> the repo-qualified files that MAY mention `ident`, the
//  local repo first, the registered ones after.  Every lane it reads comes up
//  first, the local one here and the foreign ones in `symForeign` (BEE-065:11).
function sym(ident, opts) {
  opts = opts || {};
  const text = String(ident === undefined ? "" : ident).trim();
  if (text === "") return [];
  const symhl = idx.fnHl(text);
  const ctx = idx.openRepo(opts.repo === undefined ? io.cwd() : opts.repo, true);
  const out = [], seen = new Set();
  try {
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    try {
      idx.bringUp(ctx, ix, { track: false });
      scan(ctx, ix);
      symIn(ctx, ix, symhl, out);
    } finally { try { ix.close(); } catch (e) {} }
    for (const line of out) seen.add(line);
    for (const repo of idx.repos(opts.home).sort()) {
      if (repo === ctx.root || repo === ctx.repo) continue;  // the local one answered
      let real = repo;
      try { real = io.realpath(repo); } catch (e) {}
      if (real === ctx.root) continue;
      const got = [];
      symForeign(repo, symhl, got);
      for (const line of got) if (!seen.has(line)) { seen.add(line); out.push(line); }
    }
  } finally { idx.closeRepo(ctx); }
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
                   K_LINK: K_LINK, LINDEX_REF: LINDEX_REF,
                   //  The BEE-063 half: the record, its gates and the verb.
                   sym: sym, symKey: symKey, symVal: symVal, symRow: symRow,
                   symSeg: symSeg, symFn: symFn, symSig: symSig,
                   typeSlots: typeSlots, symsOf: symsOf, symIn: symIn,
                   symSuspects: symSuspects, symForeign: symForeign,
                   SYMDEX_REF: SYMDEX_REF, SYM_CAP: SYM_CAP };
