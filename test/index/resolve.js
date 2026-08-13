//  lite/test/index/resolve.js — LITE-011 leg: the FSEG rows and the tree
//  descent that turns a PARTIAL path into the full repo-relative path(s) it
//  names IN A COMMIT.
//
//  Driven by run.sh over its own fixture (`LITE_FIX2`), which holds every case
//  the ticket enumerates: a qualified partial, a bare filename, an AMBIGUOUS
//  bare filename, a repo-root file, a path DEEPER than the 6-slot chain, a path
//  absent at HEAD, and one deleted before HEAD but present in an older commit.
//    LITE_FIX2  the repo      LITE_EXP2  "c0=<sha> c1=<sha>"
"use strict";
const idx = require("index/index.js");
const rv = require("index/resolve.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const repo = io.getenv("LITE_FIX2");
const exp = {};
for (const kv of (io.getenv("LITE_EXP2") || "").split(" ")) {
  const eq = kv.indexOf("=");
  if (eq > 0) exp[kv.slice(0, eq)] = kv.slice(eq + 1);
}

const ctx = idx.openRepo(repo, false);
const ix = idx.openIndex(ctx.gitdir);
function at(commit, partial) { return rv.resolveAt(ctx, ix, commit, partial); }
function head(partial) { return at(ctx.head.sha, partial); }
function one(partial) { const p = head(partial); return p.length === 1 ? p[0] : p.join("|"); }

//  --- 1. the ruled cases ----------------------------------------------------
check("qualified partial", one("abc/TCP.c") === "src/abc/TCP.c", one("abc/TCP.c"));
check("the full path resolves to itself",
      one("src/abc/TCP.c") === "src/abc/TCP.c", one("src/abc/TCP.c"));
//  AMBIGUITY IS THE ANSWER: two real TCP.c come back as two paths.
check("a bare filename that is ambiguous returns BOTH paths",
      head("TCP.c").join(" ") === "net/TCP.c src/abc/TCP.c", head("TCP.c").join(" "));
check("a bare filename that is unique returns one path",
      one("FSW.c") === "src/abc/FSW.c", one("FSW.c"));
check("a repo-root file", one("README.mkd") === "README.mkd", one("README.mkd"));
//  DEPTH > 6: the chain holds the top six dirs, `vnib` says the true depth, so
//  the walk goes wide for the tail instead of looking six-deep.
const DEEP = "a/b/c/d/e/f/g/deep.c";
check("a path deeper than the 6-slot chain, bare", one("deep.c") === DEEP, one("deep.c"));
check("...and qualified past the chain", one("g/deep.c") === DEEP, one("g/deep.c"));
check("...and spelled almost whole", one("b/c/d/e/f/g/deep.c") === DEEP,
      one("b/c/d/e/f/g/deep.c"));
//  A partial whose MIDDLE segments do not line up is not a hit: the bottom
//  verifies the recovered TEXT, so a hash never answers wrong.
check("a wrong middle segment is no hit", head("x/g/deep.c").length === 0,
      head("x/g/deep.c").join(" "));
check("a name no commit ever carried is no hit", head("nosuch.c").length === 0,
      head("nosuch.c").join(" "));

//  --- 2. resolution is PER-COMMIT ------------------------------------------
//  `gone/old.c` was deleted before HEAD: absent at the tip, present at c0.
check("absent in THIS commit", head("old.c").length === 0, head("old.c").join(" "));
check("...but present in the commit that carried it",
      at(exp.c0, "old.c").join(" ") === "gone/old.c", at(exp.c0, "old.c").join(" "));
check("...qualified, at that commit too",
      at(exp.c0, "gone/old.c").join(" ") === "gone/old.c");
//  A file ADDED at HEAD is not there at c0.
check("a path added later is not in the older commit",
      at(exp.c0, "FSW.c").length === 0, at(exp.c0, "FSW.c").join(" "));

//  --- 3. one row per DISTINCT PATH, and a rerun puts nothing new ------------
function fsegRows() {
  const out = [];
  const c = ix.seek(0n);
  while (c.next()) if (idx.keyKind(c.key) === idx.K_FSEG) out.push([c.key, c.val]);
  return out;
}
//  Six paths were ever in this history: README.mkd (revved twice), src/abc/TCP.c,
//  src/abc/FSW.c, net/TCP.c, the deep one, and the deleted gone/old.c.
const before = fsegRows();
check("one FSEG row per distinct path ever seen", before.length === 6,
      "rows " + before.length);
check("no two FSEG rows are the same row",
      new Set(before.map((e) => e[0] + ":" + e[1])).size === before.length);
try { ix.close(); } catch (e) {}
idx.closeRepo(ctx);

const again = idx.index(repo, { track: false });
check("a rerun over an indexed repo is the no-op", again.upToDate === true);
const ctx2 = idx.openRepo(repo, false);
const ix2 = idx.openIndex(ctx2.gitdir);
let after = 0;
{
  const c = ix2.seek(0n);
  while (c.next()) if (idx.keyKind(c.key) === idx.K_FSEG) after++;
}
check("...and it puts no new FSEG row", after === before.length,
      after + " vs " + before.length);
try { ix2.close(); } catch (e) {}
idx.closeRepo(ctx2);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
