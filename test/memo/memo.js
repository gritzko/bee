//  bee/test/memo/memo.js — CODE-034: the reader's commit memo is BOUNDED.
//  `reader()` keeps three memos and only `trees` and `subs` were swept at
//  TREE_CACHE_MAX; since BEE-048 the ctx outlives the request, so a resident
//  `bee http` grew one parsed commit record per commit ever touched.  The leg
//  floods `readCommit` with distinct names, asserts the memo stays under the
//  cap, and then asserts the memo still MEMOIZES — the sweep must not cost the
//  log walk its hits.
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
const HEAD = io.getenv("LITE_HEAD");
const CAP = 1 << 14;                             // index.js TREE_CACHE_MAX
const ctx = idx.openRepo(repo, false);

//  --- 1. the memo is live ----------------------------------------------------
{
  const a = idx.readCommit(ctx.r, HEAD);
  const b = idx.readCommit(ctx.r, HEAD);
  check("a-second-read-is-the-memoized-record", a !== null && a === b,
        a === null ? "null" : "two records");
  check("...and-it-is-the-tip", a !== null && a.subject === "c2",
        a === null ? "null" : a.subject);
}

//  --- 2. the flood: the memo stays bounded ------------------------------------
//  Every distinct hexlet mints a record, a miss included — which is exactly
//  what a resident server accumulates as it walks history after history.
function nameOf(i) {
  return ("0000000000000000000000000000000000000000" + i.toString(16)).slice(-40);
}
{
  const N = 2 * CAP + 1;
  for (let i = 0; i < N; i++) idx.readCommit(ctx.r, nameOf(i));
  check("the-flood-does-not-grow-the-memo-past-the-cap",
        ctx.r.commits.size <= CAP, ctx.r.commits.size + " of " + N + " fed");
  check("...and-the-sibling-memos-are-still-bounded-too",
        ctx.r.trees.size <= CAP && ctx.r.subs.size <= CAP,
        ctx.r.trees.size + " trees, " + ctx.r.subs.size + " subs");
}

//  --- 3. the sweep does not cost the walk its memo -----------------------------
{
  const a = idx.readCommit(ctx.r, HEAD);
  const b = idx.readCommit(ctx.r, HEAD);
  check("the-tip-still-reads-back-whole", a !== null && a.subject === "c2" &&
        a.parents.length === 1, a === null ? "null" : a.subject);
  check("...and-is-memoized-again-after-the-sweep", a === b,
        a === b ? "" : "two records");
  const before = ctx.r.commits.size;
  idx.readCommit(ctx.r, HEAD);
  check("...so-a-repeat-read-adds-no-row", ctx.r.commits.size === before,
        before + " -> " + ctx.r.commits.size);
}

w1((bad ? "FAIL" : "PASS") + " [bee/memo] memo.js " + n + " checks, " +
   bad + " failed\n");
if (bad) throw "MEMO";
w1("DONE\n");
