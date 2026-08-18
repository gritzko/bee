//  view/diff.js — `bee diff [<path>|<hex>|<hex> <hex>]`, the CFOLD diff view
//  ported from be/views/diff/diff.js and be/shared/weave.js (LITE-010,
//  BEE-005): `abc.ram("CFOLD")` folds a path's whole weave, `abc.ram("HUNK")`
//  takes the emitted records, the pager paints them.  A diff is a projection
//  of one weave per path (BEE-005:10:mJ), seeded at the LCA floor of the two tips
//  with every path-changing commit as a layer, so that the emitted tokens carry
//  real provenance; hence it reads the index and brings up a commit it lacks.
//  The bare form is `git diff HEAD`, since `.git/index` is never read.
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
const wv = require("index/weave.js");

//  The source-size policy, the binary gate and the lexer key live in
//  index/weave.js, one home for both the diff and the merge (LITE-014:19:EL).
const MAX_SOURCE_SIZE = wv.MAX_SOURCE_SIZE;        // 4 MB
const MAX_SOURCE_MARKED_UP = wv.MAX_SOURCE_MARKED_UP;
const isBinary = wv.isBinary, extOf = wv.extOf, bytesEq = wv.bytesEq;

//  The HUNK container a fold emits into, allocated once per run; every emitted
//  record is copied out before the next path folds.
let _hd = null;
function scratch() {
  if (_hd === null) _hd = abc.ram("HUNK", MAX_SOURCE_MARKED_UP);
  _hd.buffer.watermark = 0;                        // the run's records so far
  return _hd;
}

//  The plain render of a record (be diff.js `renderRecord`) scales with the
//  record: seed the buffer at 4x for the markup and double on "out full".
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
      //  A record the C render refuses at every size (a HUNK defect) must not
      //  take the whole diff down, so say so and keep going.
      if (n >= RENDER_MAX) return null;
      n = 2 * n > RENDER_MAX ? RENDER_MAX : 2 * n;
    }
  }
}

//  One path, one weave (BEE-005:10:mJ): the diff is a projection of one CFOLD
//  weave (index/weave.js weaveDiff) seeded at the LCA floor, each commit a
//  layer under its hashlet, so that every token names its inserting commit.
//  A side is `{ chl, sha, bytes }` or `wt: true`; a hunk adds `plain` and `who`.
function diffPath(env, name, from, to, full, out) {
  const f = from.bytes || new Uint8Array(0);
  const t = to.bytes || new Uint8Array(0);
  if (f.length === t.length && bytesEq(f, t)) return;         // identical: skip
  if (isBinary(f) || isBinary(t)) {                           // binary: skip
    out.push(noteHunk(name, "binary files differ"));
    return;
  }
  if (f.length > MAX_SOURCE_SIZE || t.length > MAX_SOURCE_SIZE) {
    out.push(noteHunk(name, "the file is too big to diff (over 4 MB)"));
    return;
  }
  //  A token-dense source overflowing the fixed fold buffers is refolded under
  //  the plain lexer, so that a changed file never silently vanishes (DIFF-015:5:1D).
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

//  Fold the path's weave and emit the from->to window, or the whole file, into
//  the run's HUNK container; null when the index knows nothing of the path.
function weaveEmit(env, name, from, to, full, ext) {
  const tips = [{ chl: from.chl, blob: from.sha }];
  if (!to.wt) tips.push({ chl: to.chl, blob: to.sha });
  //  A parent->child pair is its own floor, so it folds the two blobs and
  //  reads no index (env.blob); that is `commit`'s ODB-only leg (BEE-005:36:mJ).
  const b = env.blob ? wv.blobDiff(from, to, ext)
                     : wv.weaveDiff(env.ctx.r, env.ix, name, tips, ext);
  if (b === null) return null;
  let w = b.weave;
  const fromRev = b.views[0].rev;
  let toRev;
  if (to.wt) {
    //  The worktree bytes ride as the last layer over the head's view (BE-010).
    const g = wv.foldWt(w, fromRev, b.views[0].ids,
                            to.bytes || new Uint8Array(0), ext);
    if (!g.layered) return null;                   // adjacent and equal: skip
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

const JOIN_ID = "0000000000000006";
//  Provenance (BEE-005:21:mJ): the weave's emitted tokens with the commit that
//  inserted each, as byte extents since the emit may split an atom.  Both
//  sides may be concurrent layers, so the walk rides a contentless join of both.
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
    if (!liveF.has(off) && !liveT.has(off)) continue;   // alive on neither side
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

//  Mark one record's tokens against `prov`, of which the record is a contiguous
//  byte window at or after `from`: `who[i]` names the commit that inserted
//  token i, "" when no single atom covers it.  Returns the byte cursor past the
//  matched window; an unalignable record is left unattributed rather than wrong.
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

//  Drain every record of the container into hunks: `text`/`toks` are the weave
//  bytes the pager paints, both sides interleaved with each tok32 carrying its
//  side; `plain` is the C unified render that `--plain` writes; `who` is one
//  inserting-commit hashlet per token (BEE-005:37:mJ).
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

//  A text-only hunk with no spans: the one line to say about a pair that will
//  not weave, a binary or over-cap file.  It reads the same in the pager and
//  under --plain.
function noteHunk(name, why) {
  const text = utf8.Encode(name + ": " + why + "\n");
  return { uri: name, verb: "hunk", text: text, toks: new Uint32Array(0),
           plain: text, kind: "diff" };
}

//  Blob bytes at a tree leaf sha, or undefined when missing or not a blob.
function blobBytes(r, sha) {
  if (!sha) return undefined;
  const o = idx.object(r, sha);
  if (o === null || o.type !== "blob") return undefined;
  return o.bytes;
}

//  Pair two trees by path into { path, from, to }, a blob sha or undefined.
//  A subtree with an equal sha on both sides is pruned whole, which is what
//  makes a big-repo diff cheap.  Gitlinks never reach here, since index.js
//  readTree drops them, so a diff says nothing about a pin bump.
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
      //  A dir on either side is descended.  A dir replaced by a file, or the
      //  reverse, is both: every leaf under the dir goes and the file arrives.
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

//  Every blob leaf of a tree as { path, sha }.  `scope`, a "dir/" prefix or
//  "", prunes the subtrees that cannot hold it.
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

//  A tracked file's current bytes, or undefined when it is gone.  A symlink is
//  read with lstat/readlink, since its target string is the git blob body, and
//  never mmapped, which would follow the link and read the target's bytes.
function wtBytes(abs) {
  let st;
  try { st = io.lstat(abs); } catch (e) { return undefined; }
  if (st.kind === "lnk") {
    try { return utf8.Encode(io.readlink(abs)); } catch (e) { return undefined; }
  }
  if (st.kind !== "reg") return undefined;
  try { return io.mmap(abs, "r").data(); } catch (e) { return undefined; }
}

//  The git blob sha of some bytes ("blob <len>\0" + bytes), so that an
//  unchanged tracked file is skipped without ever inflating its ODB blob.
function blobSha(bytes) {
  const hdr = utf8.Encode("blob " + bytes.length + "\0");
  const b = io.buf(hdr.length + bytes.length + 8);
  b.feed(hdr); b.feed(bytes);
  return hex.encode(sha1(b.data()));
}

//  The worktree against a tree, over the tracked paths: a gone file diffs
//  against empty, a matching blob sha is skipped, the rest are pairs.  An
//  untracked file is not here, as `git diff HEAD` does not show one either.
function diffWt(env, headSha, tree, scope, full, out, exact) {
  const ctx = env.ctx, chl = idx.hlOfSha(headSha);
  const leaves = [];
  treeLeaves(ctx.r, tree, "", scope, leaves);
  leaves.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  for (const leaf of leaves) {
    if (exact && leaf.path !== scope) continue;    // a file argument, not a prefix
    const wt = wtBytes(ctx.root + "/" + leaf.path);
    if (wt !== undefined && blobSha(wt) === leaf.sha) continue;   // unchanged
    const from = { chl: chl, sha: leaf.sha, bytes: blobBytes(ctx.r, leaf.sha) };
    diffPath(env, leaf.path, from, { wt: true, bytes: wt }, full, out);
  }
}

//  Tree against tree in path order: the two tips of one weave per changed path.
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

//  One commit's file hunks against its first parent, what `bee commit` shows
//  under the metadata (LITE-009): a changed or added file gets its diff, a
//  removed one an empty hunk, and a root commit's files are all additions.
//  Parent->child is its own floor, so this opens no index (BEE-005:36:mJ).
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

//  The removed file's hunk: a banner and nothing else, since the bytes that
//  went are already in the parent.  The pager paints it as a bare band.
function emptyHunk(name) {
  return { uri: name, verb: "hunk", text: new Uint8Array(0),
           toks: new Uint32Array(0), plain: new Uint8Array(0), kind: "diff" };
}

//  Is `rel` a leaf of this tree?  A file deleted in the worktree still is, so
//  `diff <deleted file>` never has to touch the index (LITE-011).
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

//  A partial path argument, resolved off the index the diff holds (LITE-011:9:a9).
function resolvePartial(env, arg) {
  return require("index/resolve.js").pick("diff", env.ix, env.ctx, arg);
}

//  A `<hex>` argument -> { sha, m } for the commit it names, refused in plain
//  words when it names nothing or a non-commit.  A short hexlet is re-framed
//  to its full sha (view/log.js frameSha), since the weave keys on it.
function commitOf(ctx, hexarg) {
  const name = hexarg.toLowerCase();
  const o = idx.object(ctx.r, name);
  const m = (o === null || o.type !== "commit") ? null : idx.readCommit(ctx.r, name);
  if (m === null) throw "diff: no commit in this repository is named " + hexarg;
  const sha = name.length === 40 ? name : hex.encode(lg.frameSha(o.bytes));
  return { sha: sha, m: m };
}

//  `diff <hexA> <hexB>`, the two-tip form (BEE-005).  A verb's words arrive
//  fused into one string (main.js), so two hexlets are one argument with a space.
function twoHex(arg) {
  const w = String(arg).split(/\s+/).filter(function (s) { return s !== ""; });
  return (w.length === 2 && lg.HEXARG.test(w[0]) && lg.HEXARG.test(w[1])) ? w : null;
}

//  diff(arg, opts) -> { hunks, form, uri }.  A form whose sides are adjacent
//  (the worktree over head, a commit over its first parent) is its own floor
//  and folds the pair off the ODB (`env.blob`, BEE-005:36:mJ); only the two-tip
//  form spans history, and it brings the index up rather than working around it.
function diff(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  let ix = null;
  const env = { ctx: ctx, ix: null, blob: true };
  //  The index is opened only where a form needs it, the two-tip fold and the
  //  partial-path resolve (LITE-011); an adjacent form opens nothing.
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
      //  A merge's first parent is the floor, but the tokens the other side
      //  brought are the whole point of `diff <hex>`, so this form weaves.
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
      //  Neither in the worktree nor in head's tree: the argument may be
      //  partial, so ask the index, and only then, to name it (LITE-011).
      if (!here && !inTree(ctx.r, headTree, rel)) {
        //  The FSEG descent is an index read, unlike the fold below.
        idx.bringUp(ctx, index(), { track: false });
        const hit = resolvePartial(env, arg);
        if (hit !== null) rel = hit;
      }
      //  A dir scopes the worktree diff to that subtree; a file gets the
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
