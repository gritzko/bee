//  index/cache.js — BEE-027: the per-dir REV TREE over quickjab `fsw`, be's
//  shared/cache.js ([STATUS-019]) ported.  ONE shared counter: an event stamps
//  its own dir AND every ancestor, so a consumer that kept the rev it saw for a
//  spot learns in one compare whether anything under it moved.  It holds no
//  view values — view/wtstat.js keeps its own memo and compares `rev`.  The
//  rulings ([STATUS-019], reaffirmed BEE-027:31) are not negotiable: an overflow
//  or a lost drain bumps the ROOT; revs exist ONLY under a live watcher; arming
//  is lazy, recursive minus `.git` and ignored dirs, and lands ON the query.
"use strict";

const idx = require("./index.js");

//  Per tree, so one runaway checkout degrades alone; a walk that would pass it
//  leaves that tree WITHOUT a watcher, which reads as "recompute", never as clean.
const MAXDIRS = 32768;
const BUFBYTES = 1 << 16;               // the drain sink; a burst past it is LOST

const S = {
  wfd: -1,                              // the ONE watcher fd
  rev: 0,                               // THE shared counter
  spot: null,                           // absolute dir -> rev      null = OFF
  wdOf: null, dirOf: null,              // dir <-> watch descriptor (attribution)
  armed: null,                          // absolute dir -> the rev its walk ran at
  big: null,                            // trees too big to arm (no watcher there)
  owner: null,                          // BEE-048: an armed gitdir bit -> its wt root
  blind: null,                          // BEE-048: roots whose git side would not arm
  token: 0,                             // the no-watcher token, always fresh
  buf: null, polled: false, root: "",
  st: { bumps: 0, watches: 0 }
};

//  The rev tree EXISTS iff a watcher is live (ruling 3).
function live() { return S.spot !== null; }

//  start(root) -> did the watcher come up?  Only a process-resident caller (the
//  pager, http) calls it; a one-shot CLI run leaves it off and memoizes nothing.
function start(root) {
  if (live()) return true;
  let fd = -1;
  try { fd = fsw.init(); } catch (e) { fd = -1; }
  if (typeof fd !== "number" || fd < 0) { S.wfd = -1; return false; }
  S.wfd = fd;
  S.spot = new Map(); S.wdOf = new Map(); S.dirOf = new Map();
  S.armed = new Map(); S.big = new Set();
  S.owner = new Map(); S.blind = new Set();
  S.root = root || "";
  try { S.buf = io.buf(BUFBYTES); } catch (e) { stop(); return false; }
  return true;
}

//  The fd goes before any `pol.init()`, which wipes the fd table and would
//  strand the watcher (be's cache.js:86, [JAB-032] §6).
function stop() {
  if (S.wfd >= 0) { try { fsw.close(S.wfd); } catch (e) {} }
  S.wfd = -1; S.polled = false;
  S.spot = null; S.wdOf = null; S.dirOf = null; S.armed = null; S.big = null;
  S.owner = null; S.blind = null;
  S.buf = null;
}

//  THE stamp: one increment of the shared counter, laid on the event's dir and
//  on every ANCESTOR spot up the path — a parent embeds what is under it.
function bump(dir) {
  const n = ++S.rev;
  S.st.bumps++;
  stamp(dir, n);
  //  BEE-048: a gitdir bit lies outside its worktree (always for a linked one),
  //  so the ancestor walk alone would never reach the root it speaks for.
  const own = S.owner.get(dir);
  if (own !== undefined) stamp(own, n);
}

//  One rev laid on `dir` and on every ANCESTOR spot up the path.
function stamp(dir, n) {
  for (let p = dir; ;) {
    if (S.spot.has(p)) S.spot.set(p, n);
    const i = p.lastIndexOf("/");
    if (i <= 0) return;
    p = p.slice(0, i);
  }
}

//  Ruling 2: the root moved, so EVERY spot moved and every consumer misses.
//  Both loss paths — a kernel overflow record and a drain we could not hold —
//  are this one fact, and so is a reader asking for a forced reload.
function bumpRoot() {
  if (!live()) return;
  const n = ++S.rev;
  S.st.bumps++;
  for (const k of S.spot.keys()) S.spot.set(k, n);
}

//  Drain the queue and apply its bumps.  `rev` runs it FIRST, so a query is
//  only ever answered after the pending events landed; the pager calls it on
//  its 100 ms tick (pager.js:841:8l) and http off `pol` (polWatch below).
function drain() {
  if (!live()) return;
  for (let guard = 0; guard < 1024; guard++) {
    let n = 0;
    try { n = fsw.drain(S.wfd, S.buf); }
    catch (e) { S.buf.reset(); bumpRoot(); return; }
    if (!n) { S.buf.reset(); return; }
    let recs;
    try { recs = fsw.records(S.buf); }
    catch (e) { S.buf.reset(); bumpRoot(); return; }
    S.buf.reset();
    for (const r of recs) {
      if (r.wd === fsw.OVERFLOW) { bumpRoot(); continue; }
      //  The name is never read — a rev only ever needs the dir; an unclaimed
      //  wd (a watch we forgot, ABC-013) is ignored.
      const d = S.dirOf.get(r.wd);
      if (d !== undefined) bump(d);
    }
  }
}

//  Arm ONE dir level and open its spot at the CURRENT rev, so a brand-new spot
//  is born fresh and never stale.  A dir that will not arm gets no spot at all.
function armDir(abs) {
  if (S.wdOf.has(abs)) return;
  let wd = -1;
  try { wd = fsw.dir(S.wfd, abs); } catch (e) { return; }
  if (typeof wd !== "number" || wd <= 0) return;      // a jab that cannot attribute
  S.wdOf.set(abs, wd); S.dirOf.set(wd, abs); S.st.watches++;
  if (!S.spot.has(abs)) S.spot.set(abs, S.rev);
}

//  The ignore chain is view/status.js's own (status.js:145) — the same
//  `dog._igno_*` descent the quad walks with, never a second matcher.
function ignoOf(wt) {
  if (typeof dog === "undefined" || typeof dog._igno_open !== "function") return null;
  const gitdir = idx.gitdirOf(wt);
  const ig = require("view/status.js").ignoStack({ root: wt, gitdir: gitdir || "" });
  if (gitdir) ig.root();
  return ig;
}

function isRepo(dir) { return idx.gitdirOf(dir) !== null; }

//  Arm every dir under `wt` bar `.git` (object churn) and the gitignored ones
//  (`build/`), so the watch count stays under the kernel default.  A NESTED
//  repo is left alone: it arms on its own first query and reaches this tree
//  through the ancestor rule.  -> false when the tree ran past MAXDIRS.
function armTree(wt) {
  const ig = ignoOf(wt);
  let n = 1, over = false;
  const walk = function (rel) {
    const abs = rel === "" ? wt : wt + "/" + rel;
    let es;
    try { es = io.readdir(abs, { hidden: true }); } catch (e) { return; }
    const k = ig ? ig.push(rel) : 0;
    try {
      for (const raw of es) {
        if (over) return;
        if (raw.slice(-1) !== "/") continue;
        const name = raw.slice(0, -1);
        if (name === ".git") continue;
        const sub = rel === "" ? name : rel + "/" + name;
        if (ig && ig.match(sub, true)) continue;
        const dir = wt + "/" + sub;
        if (isRepo(dir)) continue;
        if (n >= MAXDIRS) { over = true; return; }
        armDir(dir); n++;
        walk(sub);
      }
    } finally { if (ig) ig.pop(k); }
  };
  try { walk(""); } finally { if (ig) ig.close(); }
  return !over;
}

//  --- BEE-048: the GIT side of a repo ---------------------------------------
//  `refs/` is a handful of quiet dirs and the `be` lane is one, so a gitdir
//  joins the tree for a fraction of what a worktree costs; `objects/` stays
//  out, its churn being why armTree skips `.git` at all (GIT-031's freshen gap).
const GITDIRS = 64;                     // a refs/ fan past this is not watchable

//  Arm what a resolved reference DEPENDS on — HEAD (the gitdir itself), `refs/`
//  recursively and the lane dir — every one ATTRIBUTED to the worktree root, so
//  one `rev(root)` compare witnesses a ref move and a lane seal as readily as an
//  edit (BEE-048:24).  Too wide to arm BLINDS the root: tokens, never a lie.
function armRepo(root, gitdir) {
  if (!live() || typeof root !== "string" || typeof gitdir !== "string") return;
  if (root === "" || gitdir === "" || S.blind.has(root)) return;
  armDir(root);
  if (!S.spot.has(root)) return;                      // unwatchable: no rev at all
  if (S.armed.get(gitdir) === S.spot.get(root)) return;
  let n = 0;
  //  MAXDIRS is the WORKTREE's budget (armTree); the git side keeps its own,
  //  so one repo with a thousand branches cannot cost another its watcher.
  const own = function (abs) {
    if (++n > GITDIRS) return false;
    armDir(abs);
    if (S.wdOf.has(abs)) S.owner.set(abs, root);
    return true;
  };
  const walk = function (abs) {
    if (!own(abs)) return false;
    let es;
    try { es = io.readdir(abs, { hidden: true }); } catch (e) { return true; }
    for (const e of es)
      if (e.slice(-1) === "/" && !walk(abs + "/" + e.slice(0, -1))) return false;
    return true;
  };
  //  A dir that is not there yet (`be` before the first index, `refs/heads` on
  //  a bare init) arms on the NEXT pass: its birth is an event in its armed
  //  parent, which moves the root's spot and so re-runs this walk.
  if (!own(gitdir) || !own(idx.indexDir(gitdir)) || !walk(gitdir + "/refs")) {
    S.blind.add(root);
    return;
  }
  S.armed.set(gitdir, S.spot.get(root));
}

//  Arm `wt` before the caller computes (ruling 4): a write between the read and
//  `fsw.dir` would otherwise go unwitnessed.  The walk re-runs only when the
//  spot moved since the last one — exactly when a new subdir may have appeared,
//  and the caller is recomputing anyway.
function arm(wt) {
  if (S.big.has(wt)) return;
  if (S.armed.has(wt) && S.armed.get(wt) === S.spot.get(wt)) return;
  armDir(wt);
  if (!S.spot.has(wt)) return;                        // unwatchable: no rev at all
  if (!armTree(wt)) { S.big.add(wt); S.spot.delete(wt); return; }
  S.armed.set(wt, S.spot.get(wt));
}

//  THE query: drain, arm, answer the spot.  No watcher, an unarmable dir or a
//  tree past MAXDIRS hands out a FRESH TOKEN, so the caller's compare always
//  fails and it recomputes — a missed event is never read as truth (ruling 3).
function rev(path) {
  if (!live() || typeof path !== "string" || !path) return --S.token;
  drain();
  arm(path);
  //  BEE-048: its git side never armed, so a ref move here would go unseen.
  if (S.blind.has(path)) return --S.token;
  const r = S.spot.get(path);
  return r === undefined ? --S.token : r;
}

//  http runs under quickjab's implicit `pol` loop, so the watcher fd is drained
//  there; the pager, which has none, ticks `drain` instead (pager.js:841:8l).
function polWatch() {
  if (!live() || S.polled || typeof pol === "undefined") return false;
  try { pol.watch(S.wfd, pol.IN, function () { drain(); return pol.IN; }); }
  catch (e) { return false; }
  S.polled = true;
  return true;
}

function stats() {
  return { live: live(), rev: S.rev, bumps: S.st.bumps, watches: S.st.watches,
           spots: S.spot ? S.spot.size : 0, big: S.big ? S.big.size : 0,
           gits: S.owner ? S.owner.size : 0, blind: S.blind ? S.blind.size : 0,
           root: S.root };
}

module.exports = { start: start, stop: stop, live: live, rev: rev,
                   drain: drain, bumpRoot: bumpRoot, polWatch: polWatch,
                   armRepo: armRepo,          // BEE-048: the gitdir bits

                   stats: stats, MAXDIRS: MAXDIRS };
