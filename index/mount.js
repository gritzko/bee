//  index/mount.js as per BEE-003: the REPO is an axis of the TARGET, never
//  process state (BEE-003:he:xS9Y).  THE MOUNT TABLE is the BEE-001:QC:PoS7 registry read
//  as `<name> -> <worktree root>`, the basename being the URL prefix (BEE-003:nZ:xS9Y);
//  a SUBMODULE is addressed THROUGH its parent (BEE-003:121:xS9Y), its own line only
//  redirects; a `git worktree` family folds to ONE mount (BEE-009:1BN:28Oq).  THE
//  AMBIENT `{repo, path, anchor}` is where a run/request/view stands, the cwd
//  only the CLI's default.  Lines are re-read per call; the tip-tree submodule
//  walk is memoized per process, since only the FSEG fan-out pays for it.
"use strict";

const idx = require("./index.js");

//  The last segment of a path: a mount's NAME.  Trailing slashes are the
//  registry's business, not ours — a line is one absolute worktree path.
function basename(p) {
  const s = String(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

//  Is `inner` a path INSIDE `outer` (never equal)?  Segment-wise, so
//  `/src/bee2` is not inside `/src/bee`.
function under(outer, inner) {
  return inner.length > outer.length + 1 &&
         inner.slice(0, outer.length + 1) === outer + "/";
}

//  Does `root` HOLD the path `p` (itself included)?
function holds(root, p) { return p === root || under(root, p); }

//  BEE-009:12c:28Oq: a legacy line naming a LINKED WORKTREE must stop competing in the
//  fan-out — a family folds to ONE, and the user's file is never rewritten.
function fold(lines) {
  const here = at();
  const fam = new Map(), out = [];
  for (const root of lines) {
    const key = idx.mainOf(root);
    const e = fam.get(key);
    //  The ambient checkout when the reader stands in one, else the first line;
    //  the NAME stays that line's, so `///bee` names the repo from `bee2` too.
    if (e === undefined) {
      const n = { name: basename(root), root: root };
      fam.set(key, n); out.push(n);
    } else if (holds(root, here) && !holds(e.root, here)) e.root = root;
  }
  return out;
}

//  BEE-003:nZ:xS9Y: the registry as a mount table.  Lines are realpath'd (a symlinked
//  line and its target are ONE repo, BEE-003:1hv:xS9Y) and deduped; a line inside
//  another becomes that one's SUB mount, addressed through it (BEE-003:121:xS9Y).
//  -> [{ name, root, prefix, own, top, dup }], registry order.
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
    let top = null, topName = null;                // the OUTERMOST line above it
    for (let j = 0; j < roots.length; j++)
      if (under(roots[j], root) && (top === null || roots[j].length < top.length))
        { top = roots[j]; topName = fam[j].name; }
    const own = basename(root);
    const m = top === null
      ? { name: fam[i].name, root: root, prefix: "", own: own, top: root, dup: false }
      : { name: topName, root: root, prefix: root.slice(top.length + 1),
          own: own, top: top, dup: false };
    //  BEE-003:183:xS9Y, open: the basename IS the name.  A second line claiming
    //  a taken name is not reachable by it — no disambiguator is invented here.
    if (m.prefix === "") {
      if (named.has(m.name)) m.dup = true; else named.add(m.name);
    }
    out.push(m);
  }
  return out;
}

//  The mount a NAME answers to — a top-level line only, first line wins.
function named(name, home) {
  for (const m of list(home))
    if (m.prefix === "" && !m.dup && m.name === name) return m;
  return null;
}

//  BEE-003: an absolute path -> its CANONICAL address `{ mount, rel }` — the
//  OUTERMOST registered root holding it, so a submodule file is addressed
//  through its parent (BEE-003:121:xS9Y).  null = no registered repo holds it.
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

//  The repo a path is SERVED from: the deepest worktree holding it, submodule
//  or not — `discover`'s own climb, a plain fs probe and no registry at all.
function deepest(abs) { return idx.discover(abs); }

//  --- the fan-out's mounts ---------------------------------------------------
//  BEE-003: every worktree a partial may resolve in — the registry's own lines
//  plus the submodules a registered parent carries WITHOUT a line of their own
//  (BEE-006:mw:3Bxd installs them, an older registry has none).  The tip-tree walk is
//  the one costly step here, so it is memoized per root for the process.
const SUBS = new Map();

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

//  Every mount a lookup fans over, deduped by root, each carrying the PREFIX it
//  sits at under its top mount — which is what lets a partial spanning the
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
//  BEE-003: `{ repo, path, anchor }` — the position a run / a request / a view
//  reads from.  `within` is the ONLY way to set it, so it is always a scope and
//  never a leak; nothing set = the CLI's cwd, exactly as before.
let POS = null;

function within(pos, fn) {
  const was = POS;
  POS = pos;
  try { return fn(); } finally { POS = was; }
}

function pos() { return POS; }

//  The repo the ambient sits in — the cwd when nothing set a position.
function at() { return POS !== null && POS.repo ? POS.repo : io.cwd(); }

//  The DIR OF THE FILE BEING READ (BEE-003:su:xS9Y, the first leg), or the repo root
//  when the position names no path.  null = no ambient at all.
function dir() {
  if (POS === null || !POS.repo) return null;
  const p = String(POS.path || "");
  const cut = p.lastIndexOf("/");
  if (cut < 0) return POS.repo;
  const d = p.slice(0, cut);
  return d === "" ? POS.repo : POS.repo + "/" + d;
}

module.exports = { list: list, named: named, canon: canon, deepest: deepest,
                   mounts: mounts, subsOf: subsOf, basename: basename,
                   under: under,
                   within: within, pos: pos, at: at, dir: dir };
