//  view/diff.js — LITE-010 / BEE-005: `lite diff`, the CFOLD diff view PORTED
//  from be/views/diff/diff.js (`diffFile`/`emitHunks`/`provList`) and
//  be/shared/weave.js (`buildDag`/`foldWt`) over the same quickjab containers
//  lite already links: `abc.ram("CFOLD")` folds the path's whole weave,
//  `abc.ram("HUNK")` takes the emitted records, `pager.js` paints them.
//
//  It lives in index/ beside log.js because the SOURCES are what differ from
//  be, not the render: a lite diff reads the ODB (`git.tree` walk, `git.getHex`)
//  and the worktree (`io.mmap`/`io.readlink`), while view/ stays pure paint.
//
//  Four forms, one arg, log.js's ruled classification (6..40 hex = a commit):
//
//    diff              the worktree against HEAD, over the TRACKED paths
//    diff <path>       that path only — a file whole (emitFull), a dir scoped
//    diff <hex>        that commit against its FIRST parent
//    diff <hex> <hex>  BEE-005: any two revisions, rooted at their merge base
//
//  BEE-005: a diff is a PROJECTION of ONE weave per path, seeded with the path's
//  blob at the LCA FLOOR of the two tips and folding every path-changing commit
//  above it under its own COMMIT hashlet — not a fold of two loose blobs under
//  two fake layer ids.  So it READS THE INDEX: the changed-path SET still comes
//  off the trees (`treePairs`), but the floor, the seed, the layers and their
//  edges all come off the REV index, and a commit the index lacks is BROUGHT UP,
//  never worked around.  The bare form is `git diff HEAD` in reach, not `git
//  diff`: lite never reads `.git/index`, so a STAGED-only change reads as a
//  worktree one.
//
//  What be's diff.js drags in and lite has no equivalent of — the ulog/patch
//  EXPECTED third layer, sub recursion, wtlog, classify, nav re-baking — is
//  simply absent here: a lite diff has ONE axis, from vs to.
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
const wv = require("index/weave.js");

//  LITE-014: the source-size policy, the binary gate and the lexer key live in
//  index/weave.js now — ONE home for both the diff and the merge, as be has.
const MAX_SOURCE_SIZE = wv.MAX_SOURCE_SIZE;        // 4 MB
const MAX_SOURCE_MARKED_UP = wv.MAX_SOURCE_MARKED_UP;
const isBinary = wv.isBinary, extOf = wv.extOf, bytesEq = wv.bytesEq;

//  --- the emit scratch ------------------------------------------------------
//  The WEAVE is index/weave.js's now (one per path, a layer per rev); the HUNK
//  container a fold emits into is still allocated ONCE per run and reused —
//  every emitted record is copied out before the next path folds.
let _hd = null;
function scratch() {
  if (_hd === null) _hd = abc.ram("HUNK", MAX_SOURCE_MARKED_UP);
  _hd.buffer.watermark = 0;                        // the run's records so far
  return _hd;
}

//  --- the record render (be diff.js `renderRecord`) -------------------------
//  The plain render scales with the RECORD, so no fixed buffer holds — seed off
//  the record (4x: markup) and double on "out full".
const RENDER_MIN = 1 << 16;                        // 64 KB
const RENDER_MAX = MAX_SOURCE_MARKED_UP * 16;      // 256 MB hard cap
function renderRecord(hd, color) {
  let n = RENDER_MIN;
  const want = 4 * (hd.text.length + 64);
  while (n < want && n < RENDER_MAX) n *= 2;
  for (;;) {
    const o = io.buf(n);
    try { if (color) hd.color(o); else hd.plain(o); return o; }
    catch (err) {
      if (!("" + err).includes("full")) throw err;
      //  A record the C render REFUSES at every size (an 800-byte record still
      //  says "out full" at 256 MB — a HUNK render defect, see the report) must
      //  not take the whole diff down with it: say so and keep going.
      if (n >= RENDER_MAX) return null;
      n = 2 * n > RENDER_MAX ? RENDER_MAX : 2 * n;
    }
  }
}

//  --- one path, ONE weave (BEE-005) -----------------------------------------
//  A diff is a PROJECTION of one CFOLD weave (index/weave.js `weaveDiff`): the
//  path's blob at the LCA FLOOR of the two tips is the seed, every path-changing
//  commit above it folds as its own layer under its COMMIT hashlet, and the two
//  sides are `emitDiff(at(FROM), at(TO))`.  There is no blob pair and no fake
//  layer id left, so every emitted token names the commit that inserted it.
//
//  `from`/`to` are `{ chl, sha, bytes }` — a commit hashlet60 (null = no commit
//  on that side, a root commit's parent), the blob sha the tip's TREE carries
//  (undefined = the path is not there) and its bytes.  The wt side passes
//  `wt: true` instead of a chl: its bytes ride as the final synthetic layer.
//  from==to → skip (byte-identical); binary either side → skip; over the source
//  cap → a BLOB, skip.
//
//  A hunk is lite-shaped — { uri, verb, text, toks } the pager takes unchanged
//  — plus `plain`, the C unified render of that record (the `--plain` bytes),
//  plus `who`, BEE-005's per-token provenance (the inserting commit).
function diffPath(env, name, from, to, full, out) {
  const f = from.bytes || new Uint8Array(0);
  const t = to.bytes || new Uint8Array(0);
  if (f.length === t.length && bytesEq(f, t)) return;         // from==to skip
  if (isBinary(f) || isBinary(t)) {                           // binary skip
    out.push(noteHunk(name, "binary files differ"));
    return;
  }
  if (f.length > MAX_SOURCE_SIZE || t.length > MAX_SOURCE_SIZE) {
    out.push(noteHunk(name, "the file is too big to diff (over 4 MB)"));
    return;
  }
  //  The fold/emit buffers are fixed at MAX_SOURCE_MARKED_UP.  A (sub-cap but
  //  token-dense) source that overflows even that is refolded under the PLAIN
  //  lexer — the binding masks a lexer defect as "out full" too (be DIFF-015),
  //  and a changed file must never silently VANISH.
  let r;
  try {
    r = weaveEmit(env, name, from, to, full, extOf(name));
  } catch (err) {
    if (!("" + err).includes("full")) throw err;
    try { r = weaveEmit(env, name, from, to, full, ""); }
    catch (e2) { out.push(noteHunk(name, "too big to diff")); return; }
    io.log("diff: cannot tokenize " + name + " — diffing as plain text\n");
  }
  if (r === null) return;
  emitHunks(r.hd, out, r.prov);
}

//  Fold the path's weave and emit the from->to window (or the whole file) into
//  the run's HUNK container.  null when the index knows nothing of the path.
function weaveEmit(env, name, from, to, full, ext) {
  const tips = [{ chl: from.chl, blob: from.sha }];
  if (!to.wt) tips.push({ chl: to.chl, blob: to.sha });
  //  BEE-005: a parent->child pair is its own floor, so it folds the two blobs
  //  and reads no index (env.blob) — that is `commit`'s ODB-only leg.
  const b = env.blob ? wv.blobDiff(from, to, ext)
                     : wv.weaveDiff(env.ctx.r, env.ix, name, tips, ext);
  if (b === null) return null;
  let w = b.weave;
  const fromRev = b.views[0].rev;
  let toRev;
  if (to.wt) {
    //  BE-010: the worktree bytes as the LAST layer over the head's view.
    const g = wv.foldWt(w, fromRev, b.views[0].ids,
                            to.bytes || new Uint8Array(0), ext);
    if (!g.layered) return null;                   // adjacent-equal: nothing to say
    w = g.weave; toRev = wv.WT_SRC;
  } else toRev = b.views[1].rev;
  const hd = scratch();
  if (full) w.emitFull(fromRev, toRev, name, "diff:", "", hd);
  else      w.emitDiff(fromRev, toRev, name, "", hd);
  const fromIds = b.views[0].ids;
  const toIds = to.wt ? new Set(fromIds).add(wv.WT_SRC) : b.views[1].ids;
  return { hd: hd,
           prov: provList(w, { rev: fromRev, ids: fromIds },
                             { rev: toRev, ids: toIds }, b.idToHl) };
}

//  --- provenance (BEE-005 stage 7, be diff.js `provList`/`markRecord`) ------
//  The weave's EMITTED token sequence — every token visible in from ∪ to, in
//  weave order — each carrying the COMMIT that inserted it (`blame`), as byte
//  extents: the emit may SPLIT a weave atom, so a text zip desyncs where the
//  byte extents always agree.  `who` holds one commit hashlet (15 hex) per
//  atom, "" where the layer is synthetic (the wt, an empty side).
//  The two sides can be CONCURRENT layers now, so neither rev's own cursor sees
//  the other's tokens: the walk rides a contentless JOIN of both closures (be's
//  `mergedLive` reading), and a token is emitted iff it is alive on EITHER side.
const JOIN_ID = "0000000000000006";
function aliveAt(w, rev) {
  const live = new Set();
  w.rewind(rev);
  while (w.next()) if (w.tok.alive) live.add(w.tok.off);
  return live;
}
function provList(w, fromV, toV, idToHl) {
  const liveF = aliveAt(w, fromV.rev), liveT = aliveAt(w, toV.rev);
  const ids = new Set(fromV.ids);
  for (const id of toV.ids) ids.add(id);
  const wj = wv.merge(w, JOIN_ID, Array.from(ids));
  const texts = [], ins = [];
  wj.rewind(JOIN_ID);
  while (wj.next()) {
    const tk = wj.tok, off = tk.off;
    if (!liveF.has(off) && !liveT.has(off)) continue;   // on neither side
    const by = wj.blame(off);
    texts.push(tk.text.slice());
    const hl = idToHl.get(by);
    ins.push(hl === undefined || hl === null ? "" : idx.hexOfHl(hl));
  }
  const m = texts.length, offs = new Uint32Array(m + 1);
  let total = 0;
  for (let i = 0; i < m; i++) { offs[i] = total; total += texts[i].length; }
  offs[m] = total;
  const body = new Uint8Array(total);
  for (let i = 0; i < m; i++) body.set(texts[i], offs[i]);
  return { body: body, offs: offs, who: ins };
}

//  Mark ONE record's tokens against `prov` (of which the record is a contiguous
//  byte window at or after `from`): `who[i]` names the commit that inserted
//  token i, "" when no single atom covers it.  Returns the byte cursor past the
//  matched window; an unalignable record is left unattributed, never wrong.
function markRecord(prov, from, text, toks) {
  const n = toks.length;
  const who = new Array(n).fill("");
  if (!n) return { who: who, at: from };
  const end = toks[n - 1] & 0xffffff;
  const body = prov.body, offs = prov.offs, m = prov.who.length;
  let s = -1;
  for (let c = from; c + end <= body.length && s < 0; c++) {
    let hit = true;
    for (let j = 0; j < end && hit; j++) if (body[c + j] !== text[j]) hit = false;
    if (hit) s = c;
  }
  if (s < 0) return { who: who, at: from };
  let a = 0, lo = 0;
  for (let j = 0; j < n; j++) {
    const hi = toks[j] & 0xffffff;
    while (a < m && offs[a + 1] <= s + lo) a++;
    if (hi > lo && a < m) who[j] = prov.who[a];
    lo = hi;
  }
  return { who: who, at: s + end };
}

//  Drain every record of the container into lite hunks.  `text`/`toks` are the
//  WEAVE bytes (both sides interleaved, each token's tok32 carrying its diff
//  side) — what the pager paints; `plain` is the same record through the C
//  `diff:`-URI unified render — what `--plain` writes.  The record's own uri is
//  `diff:<name>#L<n>`; a lite uri is a path, so the scheme comes off.
//  BEE-005: `who` rides along, one inserting-commit hashlet per token.
function emitHunks(hd, out, prov) {
  hd.rewind();
  let at = 0;
  while (hd.next()) {
    const raw = utf8.Decode(hd.uri);
    const uri = raw.indexOf("diff:") === 0 ? raw.slice(5) : raw;
    const o = renderRecord(hd, false);
    let plain;
    if (o === null) {
      const why = uri + ": this hunk cannot be rendered\n";
      io.log("diff: " + why);
      plain = utf8.Encode(why);
    } else plain = o.data().slice();
    const text = hd.text.slice(), toks = hd.toks;
    let who = null;
    if (prov) { const mk = markRecord(prov, at, text, toks); who = mk.who; at = mk.at; }
    out.push({ uri: uri, verb: "hunk", text: text, toks: toks,
               plain: plain, kind: "diff", who: who });
  }
}

//  A TEXT-ONLY hunk (no toks): the one line lite has to say about a pair it
//  will not weave — a binary or over-cap file (be renders the same case as a
//  text-only gitlink hunk).  It reads the same in the pager and under --plain.
function noteHunk(name, why) {
  const text = utf8.Encode(name + ": " + why + "\n");
  return { uri: name, verb: "hunk", text: text, toks: new Uint32Array(0),
           plain: text, kind: "diff" };
}

//  --- the ODB sources -------------------------------------------------------
//  Blob bytes at a tree leaf sha, or undefined (missing / not a blob).
function blobBytes(r, sha) {
  if (!sha) return undefined;
  const o = idx.object(r, sha);
  if (o === null || o.type !== "blob") return undefined;
  return o.bytes;
}

//  Pair two trees by path.  A subtree whose sha is EQUAL on both sides is
//  pruned whole — that is what makes a big-repo diff cheap.  Gitlinks never
//  reach here: index.js's readTree drops them (a submodule's commit lives in
//  another ODB), so a lite diff says nothing about a pin bump.
//  Emits { path, from, to } (a blob sha or undefined) into `out`.
function treePairs(r, fromTree, toTree, prefix, out) {
  if (fromTree && fromTree === toTree) return;                // unchanged
  const F = idx.readTree(r, fromTree), T = idx.readTree(r, toTree);
  const names = new Set();
  if (F) for (const k of F.keys()) names.add(k);
  if (T) for (const k of T.keys()) names.add(k);
  for (const name of names) {
    const f = F ? F.get(name) : undefined, t = T ? T.get(name) : undefined;
    const path = prefix + name;
    const fd = f !== undefined && f.dir, td = t !== undefined && t.dir;
    if (fd || td) {
      //  A dir on either side: descend it.  A dir REPLACED by a file (or the
      //  reverse) is both — every leaf under the dir goes, the file arrives.
      treePairs(r, fd ? f.sha : null, td ? t.sha : null, path + "/", out);
      if (!fd && f !== undefined) out.push({ path: path, from: f.sha, to: undefined });
      if (!td && t !== undefined) out.push({ path: path, from: undefined, to: t.sha });
      continue;
    }
    const fs = f === undefined ? undefined : f.sha;
    const ts = t === undefined ? undefined : t.sha;
    if (fs !== undefined && fs === ts) continue;              // unchanged
    out.push({ path: path, from: fs, to: ts });
  }
}

//  Every blob leaf of a tree, as { path, sha }.  `scope` (a "dir/" prefix or
//  "") prunes subtrees that cannot hold it.
function treeLeaves(r, tree, prefix, scope, out) {
  const M = idx.readTree(r, tree);
  if (M === null) return;
  for (const [name, e] of M) {
    const path = prefix + name;
    if (e.dir) {
      const sub = path + "/";
      if (!scope || sub.indexOf(scope) === 0 || scope.indexOf(sub) === 0)
        treeLeaves(r, e.sha, sub, scope, out);
      continue;
    }
    if (scope && path.indexOf(scope) !== 0) continue;
    out.push({ path: path, sha: e.sha });
  }
}

//  --- the worktree source ---------------------------------------------------
//  A tracked file's CURRENT bytes, or undefined when it is gone.  A symlink is
//  read with lstat/readlink — its TARGET STRING is the git blob body — and is
//  never mmap'd, which would follow the link and leak the target's bytes.
function wtBytes(abs) {
  let st;
  try { st = io.lstat(abs); } catch (e) { return undefined; }
  if (st.kind === "lnk") {
    try { return utf8.Encode(io.readlink(abs)); } catch (e) { return undefined; }
  }
  if (st.kind !== "reg") return undefined;
  try { return io.mmap(abs, "r").data(); } catch (e) { return undefined; }
}

//  The git blob sha of some bytes ("blob <len>\0" + bytes), so an unchanged
//  tracked file is skipped without ever inflating its ODB blob.
function blobSha(bytes) {
  const hdr = utf8.Encode("blob " + bytes.length + "\0");
  const b = io.buf(hdr.length + bytes.length + 8);
  b.feed(hdr); b.feed(bytes);
  return hex.encode(sha1(b.data()));
}

//  --- the forms -------------------------------------------------------------
//  The worktree against a tree, over the TRACKED paths (the tree's own leaves):
//  a file that is gone diffs against empty, one whose blob sha still matches is
//  skipped, everything else is a pair.  An UNTRACKED file is not here at all —
//  `git diff HEAD` does not show one either.
function diffWt(env, headSha, tree, scope, full, out, exact) {
  const ctx = env.ctx, chl = idx.hlOfSha(headSha);
  const leaves = [];
  treeLeaves(ctx.r, tree, "", scope, leaves);
  leaves.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  for (const leaf of leaves) {
    if (exact && leaf.path !== scope) continue;    // a FILE arg, not a prefix
    const wt = wtBytes(ctx.root + "/" + leaf.path);
    if (wt !== undefined && blobSha(wt) === leaf.sha) continue;   // unchanged
    const from = { chl: chl, sha: leaf.sha, bytes: blobBytes(ctx.r, leaf.sha) };
    diffPath(env, leaf.path, from, { wt: true, bytes: wt }, full, out);
  }
}

//  Tree vs tree, in path order — the two tips of ONE weave per changed path.
function diffTrees(env, fromSha, fromTree, toSha, toTree, scope, out) {
  const ctx = env.ctx;
  const pairs = [];
  treePairs(ctx.r, fromTree, toTree, "", pairs);
  pairs.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  const fhl = fromSha === null ? null : idx.hlOfSha(fromSha);
  const thl = toSha === null ? null : idx.hlOfSha(toSha);
  for (const p of pairs) {
    if (scope && p.path.indexOf(scope) !== 0) continue;
    diffPath(env, p.path,
             { chl: fhl, sha: p.from, bytes: blobBytes(ctx.r, p.from) },
             { chl: thl, sha: p.to, bytes: blobBytes(ctx.r, p.to) }, false, out);
  }
}

//  One COMMIT's file hunks, against its FIRST parent — what `lite commit` shows
//  under the metadata (LITE-009).  A changed or added file gets its diff hunks;
//  a REMOVED file gets an EMPTY hunk, the banner alone, since the bytes that
//  went are already in the parent.  A root commit's files are all additions.
//  BEE-005: the two sides are a commit and its FIRST PARENT, whose merge base
//  is that parent and between which nothing lies — so the weave is the pair
//  itself (`env.blob`) and this view opens NO index, as it never did.
function commitHunks(ctx, m, out, sha) {
  const par = m.parents.length ? idx.readCommit(ctx.r, m.parents[0]) : null;
  const pairs = [];
  treePairs(ctx.r, par ? par.tree : null, m.tree, "", pairs);
  pairs.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  const env = { ctx: ctx, ix: null, blob: true };
  const fhl = par === null ? null : idx.hlOfSha(m.parents[0]);
  const thl = idx.hlOfSha(sha);
  for (const p of pairs) {
    if (p.to === undefined) { out.push(emptyHunk(p.path)); continue; }
    diffPath(env, p.path,
             { chl: fhl, sha: p.from, bytes: blobBytes(ctx.r, p.from) },
             { chl: thl, sha: p.to, bytes: blobBytes(ctx.r, p.to) }, false, out);
  }
  return out;
}

//  The removed file's hunk: a banner and nothing else.  plainHunk writes the
//  `hunk <path>` line alone for it, and the pager paints a bare band.
function emptyHunk(name) {
  return { uri: name, verb: "hunk", text: new Uint8Array(0),
           toks: new Uint32Array(0), plain: new Uint8Array(0), kind: "diff" };
}

//  LITE-011: is `rel` a leaf of this tree?  A file DELETED in the worktree
//  still is, so `diff <deleted file>` never has to touch the index.
function inTree(r, tree, rel) {
  const segs = rel === "" ? [] : rel.split("/");
  let t = tree;
  for (let i = 0; i < segs.length; i++) {
    const M = idx.readTree(r, t);
    if (M === null) return false;
    const e = M.get(segs[i]);
    if (e === undefined) return false;
    if (i === segs.length - 1) return true;
    if (!e.dir) return false;
    t = e.sha;
  }
  return false;
}

//  LITE-011: a PARTIAL path arg, resolved off the index the diff already holds.
function resolvePartial(env, arg) {
  return require("index/resolve.js").pick("diff", env.ix, env.ctx, arg);
}

//  A `<hex>` arg -> { sha, m } for the commit it names, refused in plain words
//  when it names nothing (or something that is not a commit).  A short hexlet
//  is re-framed to its own sha (LITE-007 `seedOf`), since the weave keys on it.
function commitOf(ctx, hexarg) {
  const name = hexarg.toLowerCase();
  const o = idx.object(ctx.r, name);
  const m = (o === null || o.type !== "commit") ? null : idx.readCommit(ctx.r, name);
  if (m === null) throw "diff: no commit in this repository is named " + hexarg;
  const sha = name.length === 40 ? name : hex.encode(lg.frameSha(o.bytes));
  return { sha: sha, m: m };
}

//  BEE-005: `diff <hexA> <hexB>` — the two-tip form.  A verb's words arrive
//  fused into one string (main.js), so two hexlets are ONE arg with a space.
function twoHex(arg) {
  const w = String(arg).split(/\s+/).filter(function (s) { return s !== ""; });
  return (w.length === 2 && lg.HEXARG.test(w[0]) && lg.HEXARG.test(w[1])) ? w : null;
}

//  --- the verb --------------------------------------------------------------
//  diff(arg, opts) -> { hunks, form, uri }.  `opts.from` is the dir to find the
//  repo above (the cwd by default).
//  BEE-005: a form whose two sides are ADJACENT — the worktree over HEAD, a
//  commit over its first parent — is its own floor: nothing lies between them,
//  so it folds the pair and reads NO index (`env.blob`).  Only the two-tip form
//  spans history, and there the index is brought up to the NAMED tips first —
//  an unindexed commit is not a fallback case but a bring-up.
function diff(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  let ix = null;
  const env = { ctx: ctx, ix: null, blob: true };
  //  The index is opened only where a form needs it: the two-tip fold, and the
  //  LITE-011 partial-path resolve.  An adjacent form opens nothing.
  const index = function () {
    if (ix === null) { ix = idx.openIndex(ctx.gitdir); env.ix = ix; }
    return ix;
  };
  const spanning = function () { env.blob = false; return index(); };
  try {
    const head = idx.readCommit(ctx.r, ctx.head.sha);
    const headTree = head ? head.tree : null;
    const out = [];
    let form, uri = "diff";
    const two = (arg === undefined || arg === null) ? null : twoHex(arg);
    if (two !== null) {
      form = "revs";
      const a = commitOf(ctx, two[0]), b = commitOf(ctx, two[1]);
      spanning();
      idx.bringUp(ctx, ix, { track: false, tip: a.sha });
      idx.bringUp(ctx, ix, { track: false, tip: b.sha });
      diffTrees(env, a.sha, a.m.tree, b.sha, b.m.tree, "", out);
      uri = "diff " + two[0] + " " + two[1];
    } else if (arg === undefined || arg === null || arg === "") {
      form = "wt";
      diffWt(env, ctx.head.sha, headTree, "", false, out);
    } else if (lg.HEXARG.test(arg)) {
      form = "commit";
      const c = commitOf(ctx, arg);
      const m = c.m;
      const par = m.parents.length ? idx.readCommit(ctx.r, m.parents[0]) : null;
      //  A MERGE's first parent is the floor, but the tokens the OTHER side
      //  brought are the whole point of `diff <hex>` — so this form weaves.
      spanning();
      idx.bringUp(ctx, ix, { track: false, tip: c.sha });
      diffTrees(env, m.parents.length ? m.parents[0] : null, par ? par.tree : null,
                c.sha, m.tree, "", out);
      uri = "diff " + arg;
    } else {
      form = "path";
      let rel = lg.relOf(ctx.root, arg);
      let dir = false, here = true;
      try { dir = io.stat(ctx.root + "/" + rel).kind === "dir"; } catch (e) { here = false; }
      //  LITE-011: neither in the worktree nor in HEAD's tree — the arg may be
      //  PARTIAL, so ask the index (and only then) to name it.
      if (!here && !inTree(ctx.r, headTree, rel)) {
        //  LITE-011's FSEG descent is an INDEX read (the fold below is not).
        idx.bringUp(ctx, index(), { track: false });
        const hit = resolvePartial(env, arg);
        if (hit !== null) rel = hit;
      }
      //  A DIR scopes the worktree diff to that subtree; a FILE gets the
      //  whole-file view (emitFull), which is what `be diff <file>` shows.
      if (dir) diffWt(env, ctx.head.sha, headTree, rel === "" ? "" : rel + "/", false, out);
      else diffWt(env, ctx.head.sha, headTree, rel, true, out, true);
      uri = "diff " + arg;
    }
    return { hunks: out, form: form, uri: uri };
  } finally { if (ix !== null) { try { ix.close(); } catch (e) {} } idx.closeRepo(ctx); }
}

module.exports = { diff: diff, diffPath: diffPath, isBinary: isBinary,
                   commitHunks: commitHunks, emptyHunk: emptyHunk,
                   extOf: extOf, blobSha: blobSha, wtBytes: wtBytes,
                   treePairs: treePairs, treeLeaves: treeLeaves,
                   MAX_SOURCE_SIZE: MAX_SOURCE_SIZE,
                   MAX_SOURCE_MARKED_UP: MAX_SOURCE_MARKED_UP };
