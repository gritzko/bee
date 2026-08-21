//  bee/test/wts/rev.js — BEE-027 leg 2: the REV TREE and the per-wt MEMO, the
//  halves no shell can see.  It asserts the four rulings ([STATUS-019], quoted
//  in index/cache.js:5:6x): an event stamps its dir and every ANCESTOR while a
//  sibling stands still, an ignored dir is never armed so its churn is silent,
//  a root bump (an overflow or a lost burst) drops EVERYTHING, and without a
//  live watcher every query is a fresh token — so a one-shot run memoizes nothing.
//
//  Driven by run.sh with $SRC_ROOT on the fixture and $HOME on its registry.
"use strict";

const cache = require("index/cache.js");
const wts = require("index/wts.js");
const ws = require("view/wtstat.js");

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
const A = SRC + "/repo-TKT-1", B = SRC + "/repo-TKT-2";

//  fsw is inotify here: an event lands asynchronously, so a check waits for it
//  rather than asserting straight after the write.  20 ms x 50 = 1 s at worst.
function settle(fn) {
  for (let i = 0; i < 50; i++) { if (fn()) return true; pol.sleep(20e6); }
  return fn();
}
function put(path, text) {
  const fd = io.open(path, "c");
  try { io.writeAll(fd, utf8.Encode(text)); } finally { io.close(fd); }
}

//  --- 1. the scan ------------------------------------------------------------
{
  const list = wts.scan();
  const roots = list.map(function (w) { return w.root; });
  check("scan-finds-the-three-worktrees", list.length === 3, roots.join(" "));
  check("scan-matches-a-dashed-tail", roots.indexOf(A) >= 0, roots.join(" "));
  //  The LONGEST registry name wins: `repo-side-TKT-9` is repo-side's tree with
  //  tail `TKT-9`, never repo's with tail `side-TKT-9` (index/wts.js:24:uR split).
  const side = list.filter(function (w) { return w.root === SRC + "/repo-side-TKT-9"; })[0];
  check("longest-registry-name-splits-it",
        side !== undefined && side.name === "repo-side" && side.tail === "TKT-9",
        side && side.name + " / " + side.tail);
  check("a-name-with-no-dash-is-no-worktree", roots.indexOf(SRC + "/repo1") < 0);
  check("a-non-git-dir-is-skipped", roots.indexOf(SRC + "/repo-NOGIT") < 0);
}

//  --- 2. no watcher: fresh tokens, and therefore no memo ---------------------
{
  check("no-watcher-hands-fresh-tokens", cache.rev(A) !== cache.rev(A));
  ws.frames(A); ws.frames(A);
  check("a-one-shot-run-memoizes-nothing", ws.stats().entries === 0,
        ws.stats().entries);
}

//  --- 3. the rev tree --------------------------------------------------------
check("the-watcher-comes-up", cache.start(SRC) && cache.live());
const s0 = cache.rev(SRC), a0 = cache.rev(A), b0 = cache.rev(B);
check("a-quiet-tree-stands-still", cache.rev(A) === a0 && cache.rev(B) === b0);

//  A CREATE, not an overwrite of the committed x.txt: a kqueue dir watch
//  (FSW.c pins dirs only) never sees a content write to an existing file.
put(A + "/sub/z.txt", "one\n");
check("an-event-under-a-wt-moves-its-rev",
      settle(function () { return cache.rev(A) !== a0; }), cache.rev(A) + " vs " + a0);
check("a-sibling-wt-stands-still", cache.rev(B) === b0, cache.rev(B));
check("every-ancestor-is-stamped-too", cache.rev(SRC) !== s0, cache.rev(SRC));

//  An ignored dir is never armed (index/cache.js:131:6x armTree), so `build/` churn — the
//  reason the watch count stays under the kernel default — is not witnessed.
{
  const a1 = cache.rev(A);
  put(A + "/build/out.o", "x\n");
  pol.sleep(200e6);
  check("an-ignored-dir-is-never-armed", cache.rev(A) === a1, cache.rev(A));
}

//  A lost burst and a kernel overflow are ONE fact, and this is the path both
//  take: the root moves, so every spot moves and every consumer misses.
{
  const a2 = cache.rev(A), b2 = cache.rev(B);
  cache.bumpRoot();
  check("a-root-bump-drops-every-spot",
        cache.rev(A) !== a2 && cache.rev(B) !== b2);
}

//  --- 4. the per-wt memo -----------------------------------------------------
{
  ws.frames(A);
  const h0 = ws.stats().hits;
  ws.frames(A);
  check("a-still-tree-is-a-memo-hit", ws.stats().hits === h0 + 1,
        ws.stats().hits + " vs " + h0);
  check("the-memo-lives-under-the-watcher", ws.stats().entries >= 1,
        ws.stats().entries);
  const a3 = cache.rev(A);
  put(A + "/sub/y.txt", "two\n");
  settle(function () { return cache.rev(A) !== a3; });
  const h1 = ws.stats().hits;
  ws.frames(A);
  check("an-event-drops-the-whole-entry", ws.stats().hits === h1,
        ws.stats().hits + " vs " + h1);
}

//  --- 5. the watcher goes away ------------------------------------------------
cache.stop();
check("a-stopped-watcher-hands-tokens-again", cache.rev(A) !== cache.rev(A));

w1((bad ? "FAIL" : "PASS") + " [bee/wts] rev.js " + n + " checks, " + bad + " failed\n");
if (bad) throw "WTSREV";
