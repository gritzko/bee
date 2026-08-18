//  view/tree.js — `bee tree [<hex>|<path>][?<rev>]`: the raw git tree, one
//  `<mode6> <type6> <sha40>\t<name>[/]` row per entry in tree order, with a
//  bare `..` row first when the argument descended below the root
//  (LITE-017:14:Cv).  The rows are a fixed-format byte block, so `--plain` writes
//  exactly them, no banner, and they diff clean against be's; a tty paints the
//  prefix `D` and the name `F`.  A gitlink is a row (`160000 commit`) because
//  the view reports the tree object as it is; hence it reads `git.tree`
//  directly rather than index.js readTree, which drops gitlinks.  ODB only.
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
const rd = require("index/read.js");

//  Mode class -> the row's `<mode6> <type6> ` prefix, the space before the sha
//  included, as in be/views/tree/tree.js.
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

//  tok32 (dog/tok/TOK.h): tag in bits 31..27, end offset in 23..0.  D paints
//  the dim meta prefix, F the name, U hides a click target, S the newline.
const TAG_D = 3, TAG_F = 5, TAG_S = 18, TAG_U = 20;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  The argument -> { tree, rel, rev }: which tree to list and how deep the
//  descent went.  The classification is log's (view/log.js:14:Wn): 6..40 hex
//  names an object, a commit dereferenced to its tree; anything else is a path.
function resolve(ctx, arg, from) {
  const a = rd.argSplit(arg);
  if (a.path && !a.rev && lg.HEXARG.test(a.path)) {
    const o = idx.object(ctx.r, a.path.toLowerCase());
    if (o === null) throw "tree: no object in this repository is named " + a.path;
    //  A tree hexlet lists itself: `git.getHex` takes any 6..40 name, so the
    //  hexlet serves as the handle and no full sha has to be reconstructed.
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

//  The tree's entries as { meta, name, nav }: the fixed prefix through the
//  tab, the name with a dir's trailing '/', and the click target, "" for none.
//  A dir opens as a `tree`, a blob as `blob <sha>`; a gitlink gets no target,
//  since its commit lives in another repository.
function rowsOf(ctx, at) {
  const o = idx.object(ctx.r, at.tree);
  if (o === null || o.type !== "tree")
    throw "tree: " + at.tree.slice(0, 8) + " is not a readable tree";
  const pfx = at.rel === "" ? "" : at.rel + "/";
  const out = [];
  if (at.rel !== "") {                              // below the root: a `..` row
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

//  The plain bytes: the rows verbatim, one per line, with no banner and no
//  hidden target, the byte block be's `tree: --plain` writes.
function plainOf(rows) {
  let s = "";
  for (const r of rows) s += r.meta + r.name + "\n";
  return utf8.Encode(s);
}

//  The pager hunk: the rows with the hidden `U` target after the meta and
//  again after the name, since the pager reads a target as the span following
//  the cursor's (pager.js:544:t0): Enter takes the row's first span, a click the
//  one it landed in.  U bytes take no column, so the visible row stays plain.
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
  //  The raw git rows are the answer: no `hunk` band on a pipe (LITE-017:47:Cv),
  //  and only the visible bytes, since the hidden targets are pager-only.
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "tree",
           plain: plainOf(rows), bare: true };
}

//  tree(arg, opts) -> { uri, rows, hunks }.  `opts.from` is the directory to
//  find the repository above, the cwd by default.
function tree(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const at = resolve(ctx, arg, opts.from);
    const rows = rowsOf(ctx, at);
    const uriStr = "tree" + (arg ? " " + arg : "");
    return { uri: uriStr, rows: rows, hunks: [hunkOf(uriStr, rows)] };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { tree: tree, resolve: resolve, rowsOf: rowsOf,
                   plainOf: plainOf, hunkOf: hunkOf,
                   MODE_PREFIX: MODE_PREFIX, modeKind: modeKind };
