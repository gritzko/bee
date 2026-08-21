//  index/wts.js — BEE-027: the ticket WORKTREES under `$SRC_ROOT`, found by
//  naming convention and nothing else.  `bee fork //repo-TKT-123` (fork.js:21 srcRoot)
//  lands every one of them at `$SRC_ROOT/<name>-<tail>`, so ONE readdir matched
//  against the registry names finds them all: `git worktree list` is never
//  consulted, no registry line is read for membership and none is ever written
//  (BEE-027:29).  The board (BEE-025) is the consumer — a worktree whose tail
//  is a ticket code sits on that ticket's row.
"use strict";

const idx = require("./index.js");
const mnt = require("./mount.js");

//  BEE-043: the RETIREMENT root `done.js` parks a closed ticket's worktree in.
//  The scan is one readdir of `$SRC_ROOT`, so what sits below never lists — and
//  the root itself is skipped by NAME, since retired work is no ticket's work.
const DONE_ROOT = "done";

//  The top-level registry names, LONGEST first, so a split takes the longest
//  name that prefixes a dir — fork.js:58 `longest`, read backwards.
function names(home) {
  const out = [];
  for (const m of mnt.list(home)) if (m.prefix === "" && !m.dup) out.push(m.name);
  out.sort(function (a, b) { return b.length - a.length; });
  return out;
}

//  A basename -> `{ name, tail }` for the longest registry name it carries
//  followed by `-`, else null: `bee1` names no repo and `bee-BEE022` no tail.
function split(base, ns) {
  for (const n of ns) {
    if (base.length <= n.length + 1) continue;
    if (base.slice(0, n.length) !== n || base.charAt(n.length) !== "-") continue;
    return { name: n, tail: base.slice(n.length + 1) };
  }
  return null;
}

//  scan(home) -> [{ name, tail, root }] by root, one readdir of `$SRC_ROOT` per
//  run.  A dir is a worktree when its name splits AND a repo is really there
//  (index.js:722:cn gitdirOf, the `.git` file-or-dir probe); a dir that IS a
//  registry name is that repo, never another's tail (`bee-journal` is the journal).
function scan(home) {
  const ns = names(home);
  if (ns.length === 0) return [];
  const src = mnt.srcRoot();
  let es;
  try { es = io.readdir(src, { hidden: false }); } catch (e) { return []; }
  const own = new Set(ns), out = [];
  for (const raw of es) {
    if (raw.slice(-1) !== "/") continue;
    const base = raw.slice(0, -1);
    if (own.has(base) || base === DONE_ROOT) continue;
    const sp = split(base, ns);
    if (sp === null) continue;
    const root = src + "/" + base;
    if (idx.gitdirOf(root) === null) continue;
    out.push({ name: sp.name, tail: sp.tail, root: root });
  }
  out.sort(function (a, b) { return a.root < b.root ? -1 : a.root > b.root ? 1 : 0; });
  return out;
}

module.exports = { scan: scan, split: split, names: names,
                   DONE_ROOT: DONE_ROOT };
