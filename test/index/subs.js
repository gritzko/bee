//  lite/test/index/subs.js — BEE-006: a submodule is an ordinary repo.  The
//  leg the shell cannot see: what the RECURSION writes and what the parent's
//  lane holds about the gitlink.
//
//  `LITE_FIX` is a parent repo with ONE initialised submodule at `LITE_SUB`,
//  `LITE_HOME` a home nobody has registered anything in yet.
//    1. `submodules` finds the initialised sub and names its worktree;
//    2. `index(parent, { track: false })` recurses — a lane per sub — and
//       writes NO registry line, for the parent or for any sub;
//    3. the gitlink's path carries REV-CMMT rows and ONLY those: a foreign
//       commit is no blob of ours, so no REV-BLOB, no B2P, no FSEG.
"use strict";
const idx = require("index/index.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const repo = io.getenv("LITE_FIX");
const sub = io.getenv("LITE_SUB");
const home = io.getenv("LITE_HOME");

//  --- 1. the walk -----------------------------------------------------------
const ctx = idx.openRepo(repo, false);
let found;
try { found = idx.submodules(ctx); } finally { idx.closeRepo(ctx); }
check("submodules() finds the one initialised sub",
      found.subs.length === 1 && found.subs[0].path === sub &&
      found.subs[0].root === repo + "/" + sub && found.skipped.length === 0,
      found.subs.length + " subs, skipped: " + found.skipped.join("; "));

//  --- 2. the recursion, with the registry OFF -------------------------------
try { io.rmdir(repo + "/.git/be", true); } catch (e) {}
const rec = idx.index(repo, { track: false, home: home });
//  The sub's lane lives in ITS OWN gitdir — `<parent gitdir>/modules/<name>`,
//  which is what the gitfile points at — and it is brought up or already up.
check("index recurses depth-first into the sub",
      (rec.subs || []).length === 1 && rec.subs[0].path === sub &&
      rec.subs[0].rec.gitdir.slice(-("modules/" + sub).length) === "modules/" + sub &&
      (rec.subs[0].rec.commits > 0 || rec.subs[0].rec.upToDate),
      (rec.subs || []).map(function (s) { return s.path; }).join(","));
let reg = null;
try { reg = io.stat(home + "/.config/bee/repos").kind; } catch (e) { reg = null; }
check("track: false writes no registry line, for the parent or the sub",
      reg === null, String(reg));
let lane = false;
try {
  for (const f of io.readdir(rec.subs[0].rec.gitdir + "/" + idx.IDX_DIR))
    if (f.slice(-idx.IDX_EXT.length) === idx.IDX_EXT) lane = true;
} catch (e) { lane = false; }
check("the sub has a lane of its own in ITS gitdir", lane,
      rec.subs[0].rec.gitdir);

//  --- 3. the parent's rows about the gitlink --------------------------------
//  One prefix scan of the sub path's `path_hl`: the kinds it holds, and the
//  gitlink commit's own hashlet, which must key nothing at all here.
const phl = idx.pathHl(sub);
const ctx2 = idx.openRepo(repo, false);
const ix = idx.openIndex(ctx2.gitdir);
const kinds = new Set();
let bumps = 0, foreign = 0;
try {
  const c = ix.seek(phl << 24n);
  while (c.next()) {
    if (idx.keyPhl(c.key) !== phl) break;
    kinds.add(idx.keyKind(c.key));
    if (idx.keyKind(c.key) === idx.K_CMMT) bumps++;
  }
  //  The sub's TIP commit, as the parent's tree names it: no row of ours may
  //  be keyed by it (a B2P row would be exactly that foreign blob's row).
  const tip = idx.subAt(ctx2.r, idx.readCommit(ctx2.r, ctx2.head.sha).tree, sub);
  const bk = idx.hlKey(idx.hlOfSha(tip), idx.K_B2P);
  const b = ix.seek(bk);
  while (b.next()) { if (b.key !== bk) break; foreign++; }
} finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx2); }
check("the gitlink path carries REV-CMMT rows and no REV-BLOB",
      bumps > 0 && kinds.has(idx.K_CMMT) && !kinds.has(idx.K_BLOB),
      "kinds " + Array.from(kinds).join(",") + " revs " + bumps);
check("the sub's commit keys no row of the parent's lane", foreign === 0,
      String(foreign));

w1(bad ? "FAILED " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
