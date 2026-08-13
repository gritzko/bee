//  index/diff.js — LITE-010: `lite diff`, the CFOLD 2-layer diff view PORTED
//  from be/views/diff/diff.js (`diffFile`/`fold2`/`emitHunks`) over the same
//  quickjab containers lite already links: `abc.ram("CFOLD")` folds the pair,
//  `abc.ram("HUNK")` takes the emitted records, `view/pager.js` paints them.
//
//  It lives in index/ beside log.js because the SOURCES are what differ from
//  be, not the render: a lite diff reads the ODB (`git.tree` walk, `git.getHex`)
//  and the worktree (`io.mmap`/`io.readlink`), while view/ stays pure paint.
//
//  Three forms, one arg, log.js's ruled classification (6..40 hex = a commit):
//
//    diff          the worktree against HEAD, over the TRACKED paths
//    diff <path>   that path only — a file whole (emitFull), a dir scoped
//    diff <hex>    that commit against its FIRST parent
//
//  NO INDEX AND NO `bringUp`: the LITE-006 lane stores `path_hl` only, a
//  one-way hash, so it can never ENUMERATE the paths a commit touched — a diff
//  is ODB + fs, which also means it works in a repo whose `.git/be` was never
//  built.  The bare form is `git diff HEAD` in reach, not `git diff`: lite
//  never reads `.git/index`, so a STAGED-only change reads as a worktree one.
//
//  What be's diff.js drags in and lite has no equivalent of — the ulog/patch
//  EXPECTED third layer, sub recursion, wtlog, classify, nav re-baking — is
//  simply absent here: a lite diff has ONE axis, from vs to.
"use strict";

const idx = require("./index.js");
const lg = require("./log.js");

//  --- the source-size policy (be/shared/weave.js, verbatim) -----------------
//  A source larger than this is a BLOB: not tokenised, not diffed.  Because the
//  source is capped, its markup is too, so every weave/HUNK buffer is allocated
//  ONCE at the fixed 4x (a lazy anonymous mmap — only touched pages fault in).
const MAX_SOURCE_SIZE = 4 << 20;                   // 4 MB
const MAX_SOURCE_MARKED_UP = MAX_SOURCE_SIZE * 4;  // 16 MB

//  Two distinct 16-hex hashlet ids for the from/to weave layers (be's own;
//  the predicates only care about !=).
const ID_FROM = "0000000000000001", ID_TO = "0000000000000002";

//  git's binary heuristic (be diff.js `isBinary`): a blob is binary iff a NUL
//  byte appears in its first 8000 bytes.  Skip the tokenise + doomed emit.
const BIN_PROBE = 8000;
function isBinary(bytes) {
  if (!bytes || !bytes.length) return false;
  const n = bytes.length < BIN_PROBE ? bytes.length : BIN_PROBE;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

//  The basename suffix after the last '.' — the weave lexer's language key.
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

//  --- the fold scratch ------------------------------------------------------
//  be allocates a fresh 16 MB weave per fold; a whole-tree lite diff folds once
//  per changed file, so the three buffers are allocated ONCE per run and reused
//  (a fold rewrites its target from offset 0, and every emitted record is
//  copied out before the next file folds).  Thousands of changed files would
//  otherwise leave thousands of 16 MB mappings for the GC to notice.
let _wA = null, _wB = null, _hd = null;
function scratch() {
  if (_wA === null) {
    _wA = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
    _wB = abc.ram("CFOLD", MAX_SOURCE_MARKED_UP);
    _hd = abc.ram("HUNK", MAX_SOURCE_MARKED_UP);
  }
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

//  --- one file pair (be diff.js `diffFile`) ---------------------------------
//  Build the 2-layer weave for one file pair and drain its HUNK records into
//  lite hunks.  from==to → skip (byte-identical); binary either side → skip;
//  over the source cap → a BLOB, skip.
//
//  The empty-FROM ADDITION is be's one special case: an empty first layer
//  carries no tokens for the second fold to anchor on, so the pair collapses.
//  The faithful workaround is to fold the layers in the OTHER order (content as
//  the base, empty as the diff) and INVERT the from/to revs — the same records
//  come out, since the +/- sides follow which rev is `from`.
//
//  A hunk is lite-shaped — { uri, verb, text, toks } the pager takes unchanged
//  — plus `plain`, the C unified render of that record (the `--plain` bytes).
function diffFile(name, fromBytes, toBytes, full, out) {
  const f = fromBytes || new Uint8Array(0);
  const t = toBytes || new Uint8Array(0);
  if (f.length === t.length && bytesEq(f, t)) return;         // from==to skip
  if (isBinary(f) || isBinary(t)) {                           // binary skip
    out.push(noteHunk(name, "binary files differ"));
    return;
  }
  if (f.length > MAX_SOURCE_SIZE || t.length > MAX_SOURCE_SIZE) {
    out.push(noteHunk(name, "the file is too big to diff (over 4 MB)"));
    return;
  }

  function fold2(ext) {
    const hd = scratch();
    let wA, wB, from, to;
    if (f.length === 0) {
      wA = _wA.fold(null, t, ext, ID_FROM, []);
      wB = _wB.fold(wA, f, ext, ID_TO, [ID_FROM]);
      from = ID_TO; to = ID_FROM;
    } else {
      wA = _wA.fold(null, f, ext, ID_FROM, []);
      wB = _wB.fold(wA, t, ext, ID_TO, [ID_FROM]);
      from = ID_FROM; to = ID_TO;
    }
    if (full) wB.emitFull(from, to, name, "diff:", "", hd);
    else      wB.emitDiff(from, to, name, "", hd);
    return hd;
  }

  //  The fold/emit buffers are fixed at MAX_SOURCE_MARKED_UP.  A (sub-cap but
  //  token-dense) source that overflows even that is refolded under the PLAIN
  //  lexer — the binding masks a lexer defect as "out full" too (be DIFF-015),
  //  and a changed file must never silently VANISH.
  let hd, ext = extOf(name);
  try {
    hd = fold2(ext);
  } catch (err) {
    if (!("" + err).includes("full")) throw err;
    try { hd = fold2(""); }
    catch (e2) { out.push(noteHunk(name, "too big to diff")); return; }
    io.log("diff: cannot tokenize " + name + " — diffing as plain text\n");
  }
  emitHunks(hd, out);
}

//  Drain every record of the container into lite hunks.  `text`/`toks` are the
//  WEAVE bytes (both sides interleaved, each token's tok32 carrying its diff
//  side) — what the pager paints; `plain` is the same record through the C
//  `diff:`-URI unified render — what `--plain` writes.  The record's own uri is
//  `diff:<name>#L<n>`; a lite uri is a path, so the scheme comes off.
function emitHunks(hd, out) {
  hd.rewind();
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
    out.push({ uri: uri, verb: "hunk", text: hd.text.slice(), toks: hd.toks,
               plain: plain, kind: "diff" });
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
function diffWt(ctx, tree, scope, full, out, exact) {
  const leaves = [];
  treeLeaves(ctx.r, tree, "", scope, leaves);
  leaves.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  for (const leaf of leaves) {
    if (exact && leaf.path !== scope) continue;    // a FILE arg, not a prefix
    const wt = wtBytes(ctx.root + "/" + leaf.path);
    if (wt === undefined) {                        // deleted in the worktree
      diffFile(leaf.path, blobBytes(ctx.r, leaf.sha), undefined, full, out);
      continue;
    }
    if (blobSha(wt) === leaf.sha) continue;        // unchanged, no read at all
    diffFile(leaf.path, blobBytes(ctx.r, leaf.sha), wt, full, out);
  }
}

//  Tree vs tree, in path order.
function diffTrees(ctx, fromTree, toTree, scope, out) {
  const pairs = [];
  treePairs(ctx.r, fromTree, toTree, "", pairs);
  pairs.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  for (const p of pairs) {
    if (scope && p.path.indexOf(scope) !== 0) continue;
    diffFile(p.path, blobBytes(ctx.r, p.from), blobBytes(ctx.r, p.to), false, out);
  }
}

//  One COMMIT's file hunks, against its FIRST parent — what `lite commit` shows
//  under the metadata (LITE-009).  A changed or added file gets its diff hunks;
//  a REMOVED file gets an EMPTY hunk, the banner alone, since the bytes that
//  went are already in the parent.  A root commit's files are all additions.
function commitHunks(ctx, m, out) {
  const par = m.parents.length ? idx.readCommit(ctx.r, m.parents[0]) : null;
  const pairs = [];
  treePairs(ctx.r, par ? par.tree : null, m.tree, "", pairs);
  pairs.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  for (const p of pairs) {
    if (p.to === undefined) { out.push(emptyHunk(p.path)); continue; }
    diffFile(p.path, blobBytes(ctx.r, p.from), blobBytes(ctx.r, p.to), false, out);
  }
  return out;
}

//  The removed file's hunk: a banner and nothing else.  plainHunk writes the
//  `hunk <path>` line alone for it, and the pager paints a bare band.
function emptyHunk(name) {
  return { uri: name, verb: "hunk", text: new Uint8Array(0),
           toks: new Uint32Array(0), plain: new Uint8Array(0), kind: "diff" };
}

//  A `<hex>` arg -> { sha, meta } for the commit it names, refused in plain
//  words when it names nothing (or something that is not a commit).
function commitOf(ctx, hexarg) {
  const o = idx.object(ctx.r, hexarg.toLowerCase());
  if (o === null || o.type !== "commit")
    throw "diff: no commit in this repository is named " + hexarg;
  const m = idx.readCommit(ctx.r, hexarg.toLowerCase());
  if (m === null) throw "diff: no commit in this repository is named " + hexarg;
  return m;
}

//  --- the verb --------------------------------------------------------------
//  diff(arg, opts) -> { hunks, form, uri }.  `opts.from` is the dir to find the
//  repo above (the cwd by default).
function diff(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const head = idx.readCommit(ctx.r, ctx.head.sha);
    const headTree = head ? head.tree : null;
    const out = [];
    let form, uri = "diff";
    if (arg === undefined || arg === null || arg === "") {
      form = "wt";
      diffWt(ctx, headTree, "", false, out);
    } else if (lg.HEXARG.test(arg)) {
      form = "commit";
      const m = commitOf(ctx, arg);
      const par = m.parents.length ? idx.readCommit(ctx.r, m.parents[0]) : null;
      diffTrees(ctx, par ? par.tree : null, m.tree, "", out);
      uri = "diff " + arg;
    } else {
      form = "path";
      const rel = lg.relOf(ctx.root, arg);
      let dir = false;
      try { dir = io.stat(ctx.root + "/" + rel).kind === "dir"; } catch (e) {}
      //  A DIR scopes the worktree diff to that subtree; a FILE gets the
      //  whole-file view (emitFull), which is what `be diff <file>` shows.
      if (dir) diffWt(ctx, headTree, rel === "" ? "" : rel + "/", false, out);
      else diffWt(ctx, headTree, rel, true, out, true);
      uri = "diff " + arg;
    }
    return { hunks: out, form: form, uri: uri };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { diff: diff, diffFile: diffFile, isBinary: isBinary,
                   commitHunks: commitHunks, emptyHunk: emptyHunk,
                   extOf: extOf, blobSha: blobSha, wtBytes: wtBytes,
                   treePairs: treePairs, treeLeaves: treeLeaves,
                   MAX_SOURCE_SIZE: MAX_SOURCE_SIZE,
                   MAX_SOURCE_MARKED_UP: MAX_SOURCE_MARKED_UP };
