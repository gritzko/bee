//  index/mount.js — the repo is an axis of the target, never process state
//  (BEE-003:45:xS).  The mount table is the BEE-001:25:Po registry read as `<name>
//  -> <worktree root>`, the basename being the URL prefix (BEE-003:50:xS); a
//  submodule is addressed through its parent (BEE-003:64:xS) and a `git worktree`
//  family folds to one mount (BEE-009:50:28O).  The ambient `{repo, path, anchor}`
//  is where a run, request or view stands, the cwd being only the CLI default.
"use strict";

const idx = require("./index.js");

//  The last segment of a path, a mount's name.  A registry line is one
//  absolute worktree path, so no trailing slash is expected here.
function basename(p) {
  const s = String(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

//  Is `inner` a path inside `outer` (never equal)?  Segment-wise, so
//  `/src/bee2` is not inside `/src/bee`.
function under(outer, inner) {
  return inner.length > outer.length + 1 &&
         inner.slice(0, outer.length + 1) === outer + "/";
}

//  Does `root` hold the path `p` (itself included)?
function holds(root, p) { return p === root || under(root, p); }

//  A legacy line naming a linked worktree must stop competing in the fan-out:
//  a family folds to one mount and the user's file is never rewritten (BEE-009:50:28O).
function fold(lines) {
  const here = at();
  const fam = new Map(), out = [];
  for (const root of lines) {
    const key = idx.mainOf(root);
    const e = fam.get(key);
    //  The ambient checkout when the reader stands in one, else the first line;
    //  the name stays that line's, so `///bee` names the repo from `bee2` too.
    if (e === undefined) {
      const n = { name: basename(root), root: root };
      fam.set(key, n); out.push(n);
    } else if (holds(root, here) && !holds(e.root, here)) e.root = root;
  }
  return out;
}

//  The registry as a mount table (BEE-003:50:xS).  Lines are realpath'd (a
//  symlinked line and its target are one repo, BEE-003:106:xS) and deduped; a line
//  inside another becomes that one's sub mount, addressed through it (BEE-003:64:xS).
//  Returns [{ name, root, prefix, own, top, dup }] in registry order.
function list(home) {
  const lines = [], seen = new Set();
  for (const line of idx.repos(home)) {
    let real = line;
    try { real = io.realpath(line); } catch (e) { real = line; }
    if (seen.has(real)) continue;
    seen.add(real);
    lines.push(real);
  }
  const fam = fold(lines), roots = fam.map(function (e) { return e.root; });
  const out = [], named = new Set();
  for (let i = 0; i < fam.length; i++) {
    const root = fam[i].root;
    let top = null, topName = null;                // the outermost line above it
    for (let j = 0; j < roots.length; j++)
      if (under(roots[j], root) && (top === null || roots[j].length < top.length))
        { top = roots[j]; topName = fam[j].name; }
    const own = basename(root);
    const m = top === null
      ? { name: fam[i].name, root: root, prefix: "", own: own, top: root, dup: false }
      : { name: topName, root: root, prefix: root.slice(top.length + 1),
          own: own, top: top, dup: false };
    //  The basename is the name (BEE-003:69:xS, open): a second line claiming a
    //  taken name is not reachable by it, and no disambiguator is invented here.
    if (m.prefix === "") {
      if (named.has(m.name)) m.dup = true; else named.add(m.name);
    }
    out.push(m);
  }
  return out;
}

//  The mount a name answers to: a top-level line only, first line wins.
function named(name, home) {
  for (const m of list(home))
    if (m.prefix === "" && !m.dup && m.name === name) return m;
  return null;
}

//  --- BEE-023: the `//name` axis of a CLI arg --------------------------------
//  The dir an unregistered repo is looked for under, read HERE and nowhere
//  else, so `$SRC_ROOT` is one env lookup and never a composed path (BEE-023:28).
function srcRoot() {
  const v = io.getenv("SRC_ROOT");
  return v ? v : (io.getenv("HOME") || "") + "/src";
}

//  `//name` or `//name/rel` -> { name, rel }, else null.  A bare double slash
//  with no scheme: the split is on the first `/` after the `//`, so the
//  retired `///name` authority spelling (BEE-003) is none of this one's business.
function splitRooted(arg) {
  const s = String(arg);
  if (s.length < 3 || s.slice(0, 2) !== "//" || s.charAt(2) === "/") return null;
  const cut = s.indexOf("/", 2);
  const name = cut < 0 ? s.slice(2) : s.slice(2, cut);
  if (name === "" || name === "." || name === "..") return null;
  return { name: name, rel: cut < 0 ? "" : s.slice(cut + 1) };
}

//  The root a name resolves to: the registry first, then `$SRC_ROOT/name` when
//  a git repo or a linked worktree sits exactly there (BEE-023:27).  The second
//  leg is a read-only mount for the run — a hit is never registered.
function byName(name, home) {
  const m = named(name, home);
  if (m !== null) return m.root;
  const dir = srcRoot() + "/" + name;
  if (idx.gitdirOf(dir) === null) return null;
  try { return io.realpath(dir); } catch (e) { return dir; }
}

//  A `//name/rel` word -> { root, full }, the path it names; null when the word
//  is no such word OR the name resolves nowhere, which the caller words.
function rooted(arg, home) {
  const sp = splitRooted(arg);
  if (sp === null) return null;
  const root = byName(sp.name, home);
  if (root === null) return null;
  return { root: root, full: sp.rel === "" ? root : root + "/" + sp.rel };
}

//  The words a `//name` miss gets (BEE-023:27): both places that were searched,
//  since the next move is a `bee install` or a fix to the name itself.
function noRepo(name) {
  return "bee: //" + name + ": no such repo (registry, " + srcRoot() + ")";
}

//  An absolute path -> its canonical address `{ mount, rel }`, the outermost
//  registered root holding it, so a submodule file is addressed through its
//  parent (BEE-003:64:xS).  null when no registered repo holds it.
function canon(abs, home) {
  let best = null;
  for (const m of list(home)) {
    if (m.prefix !== "" || m.dup) continue;
    if (abs !== m.root && !under(m.root, abs)) continue;
    if (best === null || m.root.length < best.root.length) best = m;
  }
  if (best === null) return null;
  return { mount: best, rel: abs === best.root ? "" : abs.slice(best.root.length + 1) };
}

//  The repo a path is served from: the deepest worktree holding it, submodule
//  or not, by `discover`'s own climb, a plain fs probe and no registry at all.
function deepest(abs) { return idx.discover(abs); }

//  The worktree that serves `rel` under `root` (BEE-020:55:Lc).  `deepest` answers
//  null for a path that does not exist (a hexlet, a file gone at that rev)
//  while the sub it belongs to is still nameable, so the probe climbs to the
//  nearest live ancestor.  null when no repo is above it at all.
function serves(root, rel) {
  let abs = rel === "" ? root : root + "/" + rel;
  while (abs.length >= root.length) {
    const d = deepest(abs);
    if (d !== null) return d;
    const cut = abs.lastIndexOf("/");
    if (cut < 0) break;
    abs = abs.slice(0, cut);
  }
  return null;
}

//  --- the fan-out's mounts ---------------------------------------------------
//  Every worktree a partial may resolve in (BEE-003): the registry's own lines
//  plus the submodules a registered parent carries without a line of their own
//  (BEE-006:49:3B installs them, an older registry has none).
const SUBS = new Map();

//  The tip-tree walk is the one costly step here, so it is memoized per root.
function subsOf(root) {
  const hit = SUBS.get(root);
  if (hit !== undefined) return hit;
  let out = [];
  let ctx = null;
  try {
    ctx = idx.openRepo(root, false);
    const s = idx.submodules(ctx);
    out = s.subs.map(function (x) { return { path: x.path, root: x.root }; });
  } catch (e) { out = []; }
  finally { if (ctx !== null) idx.closeRepo(ctx); }
  SUBS.set(root, out);
  return out;
}

//  Every mount a lookup fans over, deduped by root, each carrying the prefix
//  it sits at under its top mount, which is what lets a partial spanning the
//  boundary (`abc/TCP.c` -> `dog/abc/TCP.c`) resolve at all.
function mounts(home) {
  const out = [], seen = new Set();
  const push = function (m) { if (seen.has(m.root)) return; seen.add(m.root); out.push(m); };
  for (const m of list(home)) push(m);
  //  A registered parent brings its own subs along, recursively; a sub that has
  //  its own line was pushed above and is skipped by `seen`.
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.dup) continue;
    for (const s of subsOf(m.root)) {
      let real = s.root;
      try { real = io.realpath(s.root); } catch (e) {}
      push({ name: m.name, root: real,
             prefix: m.prefix === "" ? s.path : m.prefix + "/" + s.path,
             own: basename(real), top: m.top, dup: false });
    }
  }
  return out;
}

//  --- the ambient ------------------------------------------------------------
//  `{ repo, path, anchor }`, the position a run, a request or a view reads from
//  (BEE-003).  `within` is the only way to set it, so it is always a scope and
//  never a leak; nothing set means the CLI's cwd, exactly as before.
let POS = null;

function within(pos, fn) {
  const was = POS;
  POS = pos;
  try { return fn(); } finally { POS = was; }
}

function pos() { return POS; }

//  The repo the ambient sits in, the cwd when nothing set a position.
function at() { return POS !== null && POS.repo ? POS.repo : io.cwd(); }

//  The dir of the file being read (BEE-003:55:xS, the first leg), or the repo
//  root when the position names no path.  null when there is no ambient at all.
function dir() {
  if (POS === null || !POS.repo) return null;
  const p = String(POS.path || "");
  const cut = p.lastIndexOf("/");
  if (cut < 0) return POS.repo;
  const d = p.slice(0, cut);
  return d === "" ? POS.repo : POS.repo + "/" + d;
}

module.exports = { list: list, named: named, canon: canon, deepest: deepest,
                   serves: serves,
                   //  BEE-023: the `//name` axis — one resolver, one $SRC_ROOT.
                   srcRoot: srcRoot, splitRooted: splitRooted, byName: byName,
                   rooted: rooted, noRepo: noRepo,
                   mounts: mounts, subsOf: subsOf, basename: basename,
                   under: under,
                   within: within, pos: pos, at: at, dir: dir };
