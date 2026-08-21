//  bee/test/doorcache/cache.js — BEE-048: the door's per-repo cache, the half
//  no shell can see.  It asserts the ticket's BAR — a second identical page
//  opens no lane, reads no tip and re-resolves no reference, and its bytes are
//  the uncached run's byte for byte — plus the two drops that pay for it: a
//  touch under one repo's worktree drops THAT repo's entries alone, and a ref
//  move under `refs/` drops its tip and its lane.  Leg 1 runs with no watcher
//  at all, which is the wtstat.js:40:sb law: a one-shot CLI run remembers nothing.
//  Driven by run.sh with $SRC_ROOT on the fixture and $HOME on its registry.
"use strict";

const door = require("door.js");
const web = require("http.js");
const html = require("render/html.js");
const mnt = require("index/mount.js");
const idx = require("index/index.js");
const cache = require("index/cache.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const SRC = io.getenv("SRC_ROOT");
const ALPHA = SRC + "/alpha", BETA = SRC + "/beta";

//  fsw is inotify here: an event lands asynchronously (test/wts/rev.js:29:_v).
function settle(fn) {
  for (let i = 0; i < 50; i++) { if (fn()) return true; pol.sleep(20e6); }
  return fn();
}
function put(path, text) {
  const fd = io.open(path, "c");
  try { io.writeAll(fd, utf8.Encode(text)); } finally { io.close(fd); }
}

//  The two counter sets as ONE record, so a leg reads a delta off two snaps.
function snap() {
  const i = idx.stats(), d = door.stats();
  return { lane: i.laneMisses, tip: i.tipMisses, seat: d.misses, hit: d.hits,
           lanes: i.lanes, tips: i.tips, repos: d.repos };
}
function delta(a, b) {
  return { lane: b.lane - a.lane, tip: b.tip - a.tip, seat: b.seat - a.seat,
           hit: b.hit - a.hit };
}
function said(d) {
  return "lanes " + d.lane + " tips " + d.tip + " seats " + d.seat + " hits " + d.hit;
}

//  ONE board page as http.js:596:0g paints it: the view's hunks, then every
//  reference in them followed through the SAME door an href is minted by.
function page(root, name, verb, arg) {
  const pos = { repo: root, path: arg, anchor: "" };
  idx.epoch();                                  // GIT-031: one page, one snapshot
  const hunks = mnt.within(pos, function () {
    return door.VERBS[verb](arg, { from: root });
  });
  const pg = { root: root, name: name, prefix: "", left: 4096, rev: "",
               refs: new Map(), hunks: new Map(),
               door: { verbs: door.VERBS, seatOf: door.seatOf, statOf: door.statOf,
                       openPath: door.openPath, openTarget: door.openTarget } };
  const link = function (t) {
    return mnt.within(pos, function () { return web.urlOf(pg, t); });
  };
  return html.page(verb + " " + arg, html.hunksHtml(hunks, link));
}

//  ONE reference resolved from alpha: leg 2 asks alpha, leg 3 asks beta — two
//  mounts, so a per-repo drop shows up as a delta of exactly one.
function resolve(from, ref) {
  return mnt.within({ repo: from, path: "", anchor: "" }, function () {
    return door.resolvePartial(ref);
  }).map(function (r) { return r.full; }).join(" ");
}

//  --- 1. no watcher: the CLI one-shot, unchanged ------------------------------
const BOARD = "", TICKET = "todo/TST/TST-001.mkd";
const COLD = page(ALPHA, "alpha", "todo", BOARD);
const COLDCAT = page(ALPHA, "alpha", "cat", TICKET);
{
  const a = snap();
  const again = page(ALPHA, "alpha", "todo", BOARD);
  const againcat = page(ALPHA, "alpha", "cat", TICKET);
  const b = snap();
  check("a-one-shot-run-caches-no-lane-and-no-tip", b.lanes === 0 && b.tips === 0,
        b.lanes + " lanes, " + b.tips + " tips");
  check("a-one-shot-run-memoizes-no-repo", b.repos === 0, b.repos);
  check("...so-it-reopens-everything-it-did-before", delta(a, b).lane > 0,
        said(delta(a, b)));
  check("two-uncached-pages-are-the-same-bytes", again === COLD && againcat === COLDCAT,
        again.length + " vs " + COLD.length);
}

//  --- 2. the watcher up: the BAR ----------------------------------------------
check("the-watcher-comes-up", cache.start(SRC) && cache.live());
const WARM = page(ALPHA, "alpha", "todo", BOARD);   // the cold pass under the watcher
const WARMCAT = page(ALPHA, "alpha", "cat", TICKET);
check("a-repo-arms-its-gitdir-too", cache.stats().gits > 0, cache.stats().gits);
{
  const a = snap();
  const two = page(ALPHA, "alpha", "todo", BOARD);
  const twocat = page(ALPHA, "alpha", "cat", TICKET);
  const d = delta(a, snap());
  check("the-second-page-opens-no-lane", d.lane === 0, said(d));
  check("the-second-page-reads-no-tip", d.tip === 0, said(d));
  check("the-second-page-re-resolves-no-reference", d.seat === 0 && d.hit > 0, said(d));
  check("...and-its-bytes-are-the-uncached-run's",
        two === COLD && WARM === COLD && twocat === COLDCAT && WARMCAT === COLDCAT,
        two.length + " / " + WARM.length + " / " + COLD.length);
}

//  --- 3. one reference, two repos --------------------------------------------
//  `TST-002` lives in beta alone, so alpha is a NEGATIVE answer — the half a
//  fan-out pays for over and over and the half this cache had to hold too.
const SEAT = resolve(ALPHA, "TST-002");
check("the-cross-repo-ticket-resolves-in-beta", SEAT === BETA + "/todo/TST/TST-002.mkd",
      SEAT);
{
  const a = snap();
  check("a-warm-resolve-is-two-memo-hits", resolve(ALPHA, "TST-002") === SEAT);
  const d = delta(a, snap());
  check("...and-opens-nothing-at-all", d.lane === 0 && d.tip === 0 && d.seat === 0,
        said(d));
  check("...one-hit-per-mount-asked", d.hit === 2, said(d));
}

//  --- 4. a touch under ONE repo drops that repo alone -------------------------
{
  const r0 = cache.rev(ALPHA), b0 = cache.rev(BETA);
  put(ALPHA + "/note.txt", "a touch\n");
  check("an-edit-moves-its-own-repo's-rev",
        settle(function () { return cache.rev(ALPHA) !== r0; }));
  check("...and-not-the-other's", cache.rev(BETA) === b0);
  const a = snap();
  check("the-answer-is-what-it-was", resolve(ALPHA, "TST-002") === SEAT);
  const d = delta(a, snap());
  check("the-touched-repo-alone-re-resolves", d.seat === 1 && d.hit === 1, said(d));
  check("...and-reopens-exactly-one-lane", d.lane === 1, said(d));
}

//  --- 5. a ref move drops the tip AND the lane --------------------------------
//  The gitdir is not in the worktree's own walk (index/cache.js armTree skips
//  `.git`), so this is the leg armRepo exists for.
{
  const b0 = cache.rev(BETA);
  put(BETA + "/.git/refs/heads/side", "0000000000000000000000000000000000000000\n");
  check("a-ref-move-moves-the-repo's-rev",
        settle(function () { return cache.rev(BETA) !== b0; }));
  const a = snap();
  check("the-answer-is-still-what-it-was", resolve(ALPHA, "TST-002") === SEAT);
  const d = delta(a, snap());
  check("the-moved-repo-drops-its-seats", d.seat === 1 && d.hit === 1, said(d));
  check("...its-lane", d.lane === 1, said(d));
  check("...and-its-tip", d.tip === 2, said(d));       // the head, then its tree
}

//  --- 6. a forced reload misses everything ------------------------------------
{
  cache.bumpRoot();                     // pager.js:627:6S on a refresh, act.js on a write
  const a = snap();
  check("the-answer-survives-a-forced-reload", resolve(ALPHA, "TST-002") === SEAT);
  const d = delta(a, snap());
  check("a-root-bump-drops-every-repo", d.seat === 2 && d.hit === 0, said(d));
}

//  --- 7. the watcher goes away ------------------------------------------------
{
  cache.stop();
  const a = snap();
  resolve(ALPHA, "TST-002"); resolve(ALPHA, "TST-002");
  const d = delta(a, snap());
  check("a-stopped-watcher-remembers-nothing-again", d.hit === 0 && d.seat === 4,
        said(d));
}

w1((bad ? "FAIL" : "PASS") + " [bee/doorcache] cache.js " + n + " checks, " +
   bad + " failed\n");
if (bad) throw "DOORCACHE";
