//  fork.js — BEE-026: `bee fork //repo-TKT-123`, the ticket worktree of the work
//  loop.  The word splits by the LONGEST registry name that prefixes it
//  (index/mount.js:84:BJ named), the tail names the branch, and the tree lands at
//  `$SRC_ROOT/<name>-<tail>` — no path argument and no registry line, since a
//  linked worktree is reached by that leg and indexes through the original
//  (BEE-009).  `git worktree add` leaves a submodule dir EMPTY, so every gitlink
//  the parent records gets a worktree of its own repo, detached at that commit,
//  recursively; every write is a child `git`, never a `.git` file we compose.
"use strict";

const idx = require("index/index.js");
const mnt = require("index/mount.js");
const refs = require("index/refs.js");

//  The verb's name (ruled gritzko 2026-08-19, BEE-026:42): `fork`, a tree forked
//  off the registered repo.  main.js's SIDE row spells the same word.
const VERB = "fork";

//  Where every ticket worktree lands (BEE-026:32).  BEE-023 moves this to
//  `index/mount.js srcRoot()`, the one place `$SRC_ROOT` is ever read.
function srcRoot() {
  const r = io.getenv("SRC_ROOT");
  if (r) return r;
  const h = io.getenv("HOME");
  if (!h) throw "bee: there is no HOME, so there is no $SRC_ROOT";
  return h + "/src";
}

//  Run a child to completion, inheriting stdio -> its exit code (a signal death
//  answers 128 + signal, as a shell does; merge.js:40:z4).
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { throw "bee: cannot run " + argv[0] + " (" + e + ")"; }
  let rc;
  try { rc = io.reap(pid); }
  catch (e) { throw "bee: cannot wait for " + argv[0] + " (" + e + ")"; }
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

function there(path) {
  try { io.stat(path); return true; } catch (e) { return false; }
}

//  --- the name -------------------------------------------------------------
//  The `//name` body, or null when the word is not of that shape: a bare double
//  slash with NO further slash, which is BEE-023's spelling and no URI at all.
function bodyOf(word) {
  if (typeof word !== "string" || word.slice(0, 2) !== "//") return null;
  const body = word.slice(2);
  if (body === "" || body.indexOf("/") >= 0) return null;
  return body;
}

//  The registry mount the body names: the LONGEST top-level name that prefixes
//  it and is followed by `-`, so `bee-journal-BEE-023` is the journal's tree and
//  not `bee`'s (BEE-026:25).  null when no registered name prefixes it.
function longest(body) {
  let hit = null;
  for (const m of mnt.list()) {
    if (m.prefix !== "" || m.dup) continue;
    const n = m.name.length;
    if (body.length <= n + 1 || body.slice(0, n) !== m.name || body[n] !== "-") continue;
    if (hit === null || n > hit.name.length) hit = m;
  }
  return hit;
}

//  --- the submodules -------------------------------------------------------
//  The gitlinks a commit records -> [{ path, sha }], or null when that commit
//  is not in this repo's ODB — the tell a missing sub refuses on (BEE-026:44).
function subsAt(root, sha) {
  const ctx = idx.openRepo(root, false);
  try {
    const m = idx.readCommit(ctx.r, sha);
    if (m === null || !m.tree) return null;
    return idx.submodulePaths(ctx.r, m.tree);
  } finally { idx.closeRepo(ctx); }
}

//  Give every gitlink of `dest` a worktree of ITS OWN repo, detached at the
//  commit the parent records, then descend — `root` is the original checkout
//  the sub repos are found through, `added` the rollback trail.  -> the count.
function grow(root, dest, subs, added) {
  let n = 0;
  for (const s of subs) {
    const from = root + "/" + s.path, at = dest + "/" + s.path;
    if (idx.gitdirOf(from) === null)
      throw "bee: submodule " + s.path + ": there is no repo at " + from;
    const kids = subsAt(from, s.sha);
    if (kids === null)
      throw "bee: submodule " + s.path + ": commit " + s.sha.slice(0, 8) +
            " is not here — fetch it first";
    if (run(["git", "-C", from, "worktree", "add", "-q", "--detach", at, s.sha]) !== 0)
      throw "bee: submodule " + s.path + ": git worktree add refused " + at;
    added.push({ repo: from, path: at });
    n += 1 + grow(from, at, kids, added);
  }
  return n;
}

//  A refusal leaves NOTHING behind (BEE-026:44): the worktrees go in the reverse
//  order they came, each through the repo that knows it, and git prunes its own
//  administrative files as it removes them.
function rollback(added) {
  for (let i = added.length - 1; i >= 0; i--)
    run(["git", "-C", added[i].repo, "worktree", "remove", "--force", added[i].path]);
}

//  --- the verb -------------------------------------------------------------
//  fork(args) -> the one report line; every refusal is a throw, so the runtime
//  maps it to exit 1 with that line on stderr (BE-002's discipline).
function fork(args) {
  const word = args.length ? args[0] : "";
  if (word === "") throw "bee: usage: bee " + VERB + " //repo-TKT-123";
  const body = bodyOf(word);
  if (body === null) throw "bee: " + word + ": not a //name";
  const m = longest(body);
  if (m === null) throw "bee: " + word + ": no registered repo names it";
  const tail = body.slice(m.name.length + 1);
  const dest = srcRoot() + "/" + body;
  if (there(dest)) throw "bee: " + word + ": exists";
  const gitdir = idx.gitdirOf(m.root);
  if (gitdir === null) throw "bee: " + word + ": there is no git repo at " + m.root;
  //  An existing branch is CHECKED OUT, never re-created (BEE-026:23); a fresh
  //  one starts at this repo's HEAD, which is `worktree add -b`'s own default.
  const has = refs.resolve(gitdir, "refs/heads/" + tail, null, null, 0) !== null;
  const argv = has ? ["git", "-C", m.root, "worktree", "add", "-q", dest, tail]
                   : ["git", "-C", m.root, "worktree", "add", "-q", "-b", tail, dest];
  if (run(argv) !== 0) throw "bee: " + word + ": git worktree add refused";
  const added = [{ repo: m.root, path: dest }];
  let n = 0;
  try {
    //  The tree is the one the new worktree CHECKED OUT — HEAD's for a fresh
    //  branch, the branch's own when it was there already.
    const hd = refs.head(idx.gitdirOf(dest));
    if (hd === null) throw "bee: " + word + ": the new worktree has no HEAD";
    n = grow(m.root, dest, subsAt(m.root, hd.sha) || [], added);
  } catch (e) { rollback(added); throw e; }
  return dest + " " + tail + " " + n + " submodule" + (n === 1 ? "" : "s");
}

module.exports = { fork: fork, VERB: VERB, srcRoot: srcRoot };
