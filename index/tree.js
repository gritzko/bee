//  index/tree.js — LITE-017: `lite tree [<hex>|<path>][?<rev>]`, the raw git
//  tree listing, ported from be/views/tree/tree.js (JAB-008).
//
//  ONE row per entry, in RAW GIT-TREE ORDER (the cursor's, never re-sorted):
//
//      <mode6> <type6> <sha40>\t<name>[/]
//
//  with a leading BARE `..` row first iff the arg descended BELOW the tree
//  root.  The row is a FIXED-FORMAT byte block — that is the whole contract, so
//  `--plain` writes exactly those bytes and nothing else, no `hunk` banner:
//  they must diff clean against be's own plain tree.  At a terminal the SAME
//  rows ride the SAME pager, the mode/type/sha prefix in the dim `D` slot and
//  the name in the violet `F` one, which is be's tree palette to the byte.
//
//  A GITLINK IS A ROW HERE, not a hole: `160000 commit <sha>` is what the tree
//  object says, and this view reports the object.  (index.js's readTree DROPS
//  gitlinks — a submodule's commit lives in another ODB — so the listing reads
//  the tree bytes through the `git.tree` cursor directly, and only the DESCENT
//  goes through readTree.)
//
//  PURE ODB: `git.getHex` + `git.tree`, no index and no `bringUp`, so `tree`
//  answers in a repo whose `.git/be` was never built.
"use strict";

const idx = require("./index.js");
const lg = require("./log.js");
const rd = require("./read.js");

//  mode class -> the row's `<mode6> <type-padded-to-6> ` prefix (be tree.js's
//  MODE_PREFIX, which folds in the single space before the sha).
const MODE_PREFIX = {
  tree:   "040000 tree   ",           // dir            (+ '/' on the name)
  blob:   "100644 blob   ",           // regular file
  exe:    "100755 blob   ",           // executable
  link:   "120000 blob   ",           // symlink
  commit: "160000 commit ",           // gitlink / submodule
};
function modeKind(mode) {
  if (mode === 0o40000) return "tree";
  if (mode === 0o160000) return "commit";
  if (mode === 0o120000) return "link";
  if (mode === 0o100755) return "exe";
  return "blob";
}

//  tok32 (dog/tok/TOK.h): [31..27] tag, [23..0] end byte offset.  D = the dim
//  meta prefix, F = the violet name, U = the hidden click target, S = the '\n'.
const TAG_D = 3, TAG_F = 5, TAG_S = 18, TAG_U = 20;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  --- resolution ------------------------------------------------------------
//  The arg -> { tree, rel, rev }: which tree to list and how deep we descended.
//  log.js's ruled classification, one arg: 6..40 hex = an OBJECT (a commit is
//  dereferenced to its tree, a tree lists itself), anything else = a path.
function resolve(ctx, arg, from) {
  const a = rd.argSplit(arg);
  if (a.path && !a.rev && lg.HEXARG.test(a.path)) {
    const o = idx.object(ctx.r, a.path.toLowerCase());
    if (o === null) throw "tree: no object in this repository is named " + a.path;
    //  A TREE hexlet lists itself: `git.getHex` takes any 6..40 name, so the
    //  hexlet IS the object handle and no full sha has to be reconstructed.
    if (o.type === "tree") return { tree: a.path.toLowerCase(), rel: "", rev: a.path };
    if (o.type !== "commit")
      throw "tree: " + a.path + " is a " + o.type + ", which has no entries";
    const m = idx.readCommit(ctx.r, a.path.toLowerCase());
    if (m === null || !m.tree) throw "tree: " + a.path + " names no readable commit";
    return { tree: m.tree, rel: "", rev: a.path };
  }
  const c = rd.revCommit("tree", ctx, a.rev);
  const rel = rd.repoRel("tree", ctx, a.path, from);
  const e = rd.entryAt(ctx.r, c.m.tree, rel);
  if (e === null)
    throw "tree: " + (a.path || ".") + " is not in " + c.sha.slice(0, 8);
  if (!e.dir) throw "tree: " + a.path + " is a file, not a directory";
  return { tree: e.sha, rel: rel, rev: a.rev };
}

//  --- the rows --------------------------------------------------------------
//  The tree's entries as { meta, name, nav } — `meta` the fixed prefix through
//  the '\t', `name` carrying a dir's trailing '/', `nav` the click target ("" =
//  none).  A dir opens as a `tree`, a blob as a `blob <sha>`; a gitlink gets no
//  target at all, its commit being in another ODB.
function rowsOf(ctx, at) {
  const o = idx.object(ctx.r, at.tree);
  if (o === null || o.type !== "tree")
    throw "tree: " + at.tree.slice(0, 8) + " is not a readable tree";
  const pfx = at.rel === "" ? "" : at.rel + "/";
  const out = [];
  if (at.rel !== "") {                              // descended: the bare `..`
    const up = at.rel.indexOf("/") < 0 ? "" : at.rel.slice(0, at.rel.lastIndexOf("/"));
    out.push({ meta: "", name: "..",
               nav: "tree " + rd.navPath(ctx, up) + (up ? "/" : "") });
  }
  const c = git.tree(o.bytes);
  while (c.next()) {
    const kind = modeKind(c.mode);
    const name = kind === "tree" ? c.str + "/" : c.str;
    const nav = kind === "tree" ? "tree " + rd.navPath(ctx, pfx + c.str) + "/"
              : kind === "commit" ? ""
              : "blob " + c.sha;
    out.push({ meta: (MODE_PREFIX[kind] || MODE_PREFIX.blob) + c.sha + "\t",
               name: name, nav: nav });
  }
  return out;
}

//  The PLAIN bytes: the rows verbatim, one per line, no banner and no hidden
//  nav — the byte block be's `tree: --plain` writes.
function plainOf(rows) {
  let s = "";
  for (const r of rows) s += r.meta + r.name + "\n";
  return utf8.Encode(s);
}

//  The pager hunk: the same rows with the hidden `U` target riding after the
//  meta AND after the name.  Both, because the pager reads a target as "the
//  span FOLLOWING the one under the cursor" (_targetAt): Enter takes the row's
//  FIRST span, a click takes the span it landed in.  The U bytes take no column
//  either way, so the visible row is the plain one to the byte.
function hunkOf(uriStr, rows) {
  const b = io.buf(1 << 14);
  const spans = [];
  const put = (tag, str) => {
    const worst = str.length * 4 + 4;
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  for (const r of rows) {
    if (r.meta) { put(TAG_D, r.meta); if (r.nav) put(TAG_U, r.nav); }
    put(TAG_F, r.name);
    if (r.nav) put(TAG_U, r.nav);
    put(TAG_S, "\n");
  }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "tree" };
}

//  --- the verb --------------------------------------------------------------
//  tree(arg, opts) -> { uri, rows, plain, hunks }.  `opts.from` is the dir to
//  find the repo above (the cwd by default).
function tree(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const at = resolve(ctx, arg, opts.from);
    const rows = rowsOf(ctx, at);
    const uriStr = "tree" + (arg ? " " + arg : "");
    return { uri: uriStr, rows: rows, plain: plainOf(rows),
             hunks: [hunkOf(uriStr, rows)] };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { tree: tree, resolve: resolve, rowsOf: rowsOf,
                   plainOf: plainOf, hunkOf: hunkOf,
                   MODE_PREFIX: MODE_PREFIX, modeKind: modeKind };
