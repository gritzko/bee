//  bee/test/submount/live.js — CODE-044: the fan-out's SUBS memo, the half no
//  shell can see.  `mounts()` memoizes the tip-tree submodule walk per root; the
//  entry must drop when that repo's BEE-048 fsw rev moves, so a submodule added
//  or removed under a resident `bee http` or pager is seen without a restart.
//  With no watcher there is no rev and no event either, so the one-shot CLI run
//  keeps the process-lifetime memo it always had (wtstat.js:40:sb's law).
//  Driven by run.sh with $SRC_ROOT on the fixture and $HOME on its registry.
"use strict";

const mnt = require("index/mount.js");
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
const PARENT = SRC + "/parent", KID = SRC + "/kid";

//  fsw is inotify here: an event lands asynchronously (test/wts/rev.js:29:_v).
function settle(fn) {
  for (let i = 0; i < 50; i++) { if (fn()) return true; pol.sleep(20e6); }
  return fn();
}

//  git, stdio inherited, to completion -> its exit code; every call is `-q`, so
//  a passing run says nothing of its own.
function git(args) {
  const argv = ["git"].concat(args);
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); } catch (e) { return -1; }
  let rc;
  try { rc = io.reap(pid); } catch (e) { return -1; }
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

//  The fan-out's sub mounts: the prefix each one sits at under its top mount.
function subs() {
  const out = [];
  for (const m of mnt.mounts()) if (m.prefix !== "") out.push(m.prefix);
  return out.sort().join(" ");
}
function tops() { return mnt.mounts().length; }

//  --- 1. no watcher: the one-shot CLI, unchanged ------------------------------
{
  check("a-one-shot-run-sees-the-parent-alone", tops() === 1 && subs() === "",
        tops() + " mounts, subs [" + subs() + "]");
}

//  --- 2. the watcher up, and the memo warm ------------------------------------
check("the-watcher-comes-up", cache.start(SRC) && cache.live());
{
  check("a-warm-map-is-the-cold-one", tops() === 1 && subs() === "",
        tops() + " mounts, subs [" + subs() + "]");
}

//  --- 3. a submodule REGISTERED under the live process ------------------------
//  The ticket's own repro: the map must follow without a restart.
{
  const r0 = cache.rev(PARENT);
  check("git-mounts-the-submodule",
        git(["-C", PARENT, "-c", "protocol.file.allow=always",
             "submodule", "add", "-q", KID, "sub"]) === 0 &&
        git(["-C", PARENT, "commit", "-q", "-m", "mount sub"]) === 0);
  check("the-parent's-rev-moves-with-it",
        settle(function () { return cache.rev(PARENT) !== r0; }));
  check("the-added-submodule-is-in-the-mount-map", subs() === "sub",
        tops() + " mounts, subs [" + subs() + "]");
}

//  --- 4. and unmounted again --------------------------------------------------
{
  const r0 = cache.rev(PARENT);
  check("git-unmounts-it",
        git(["-C", PARENT, "rm", "-q", "sub"]) === 0 &&
        git(["-C", PARENT, "commit", "-q", "-m", "unmount sub"]) === 0);
  check("the-parent's-rev-moves-again",
        settle(function () { return cache.rev(PARENT) !== r0; }));
  check("the-removed-submodule-is-gone-from-the-map", tops() === 1 && subs() === "",
        tops() + " mounts, subs [" + subs() + "]");
}

//  --- 5. the watcher goes away ------------------------------------------------
//  No rev to key on: the answer is recomputed once and then stands for the run.
{
  cache.stop();
  check("a-stopped-watcher-still-answers-honestly", tops() === 1 && subs() === "",
        tops() + " mounts, subs [" + subs() + "]");
  check("...and-the-run's-memo-is-stable", subs() === "" && tops() === 1);
}

w1((bad ? "FAIL" : "PASS") + " [bee/submount] live.js " + n + " checks, " +
   bad + " failed\n");
if (bad) throw "SUBMOUNT";
