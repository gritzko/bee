//  index/subs.js — BEE-040: the ONE mount scanner.  A repo's gitlinks come off
//  its HEAD tree (index/index.js:232:64f submodulePaths, gated on `.gitmodules`)
//  and never off a readdir probe, so the FILE-frame fold (view/wtstat.js:110:sb
//  foldSubs) and the bare staging verbs (stage.js:130 sweep) walk one and the
//  same spine — be's rule, one scanner and never two (be views/todo/todo.js:507
//  foldSubs).  The RECURSION is the caller's: each hands a mount's worktree
//  back into `mounts` for the grandchildren, since what a mount is WORTH — a
//  tally to memoize, a repo to stage in — is the caller's own business.
"use strict";

const idx = require("index/index.js");
const refs = require("index/refs.js");

//  mounts(root) -> [{ path, wt, sha, head, live }], the gitlinks `root`'s HEAD
//  records, in tree order.  `sha` is what the parent recorded and `head` what
//  the sub's own HEAD says: they differ exactly when a gitlink bump is owed
//  (BEE-040:16).  An unreadable root is no error, just no mounts at all.
function mounts(root) {
  let ctx = null;
  try { ctx = idx.openRepo(root, false); } catch (e) { return []; }
  try {
    const m = idx.readCommit(ctx.r, ctx.head.sha);
    if (m === null || !m.tree) return [];
    const out = [];
    for (const s of idx.submodulePaths(ctx.r, m.tree)) {
      const wt = root + "/" + s.path;
      //  An uninitialised mount is a bare dir with no `.git` leg: not live, so
      //  it tallies nothing and stages nothing rather than refusing.
      const gitdir = idx.gitdirOf(wt);
      const hd = gitdir === null ? null : refs.head(gitdir);
      out.push({ path: s.path, wt: wt, sha: s.sha, live: gitdir !== null,
                 head: hd === null ? null : hd.sha });
    }
    return out;
  } catch (e) { return []; }
  finally { idx.closeRepo(ctx); }
}

module.exports = { mounts: mounts };
