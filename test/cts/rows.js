//  bee/test/cts/rows.js — BEE-033 leg 2: the CTS rows `bee index` left in
//  `<repo>/.git/be/`.  Opens the very same wh128 family the verb wrote and
//  asserts the ruled key/val split, ONE row per walked commit, `commitTs`
//  against `readCommit(...).ats`, the AUTHOR time where it differs from the
//  committer one, the `blobTs` min-fold over a blob's carriers, and the null
//  a commit the walk never entered must answer.
//
//  Driven by run.sh, which exports the fixture's paths and shas:
//    LITE_FIX  the repo
//    LITE_EXP  "c0=<sha> c1=… c2=… orph=<sha> b1=<blob> b2=<blob>"
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
const exp = {};
for (const kv of (io.getenv("LITE_EXP") || "").split(" ")) {
  const eq = kv.indexOf("=");
  if (eq > 0) exp[kv.slice(0, eq)] = kv.slice(eq + 1);
}
const ctx = idx.openRepo(repo);
const ix = idx.openIndex(ctx.gitdir);

//  --- 1. the rows: one per walked commit, key commit_hl:60|8 ---------------
const cts = [];
{
  const c = ix.seek(0n);
  while (c.next()) if (idx.keyKind(c.key) === idx.K_CTS) cts.push([c.key, c.val]);
}
check("cts-one-row-per-indexed-commit", cts.length === 3, "rows " + cts.length);
check("cts-key-is-the-commit-hashlet",
      cts.every((e) => idx.keyKind(e[0]) === 0x8n) &&
      [exp.c0, exp.c1, exp.c2].every((s) =>
        cts.some((e) => idx.keyHl60(e[0]) === idx.hlOfSha(s))),
      cts.length);
check("cts-vnib-is-reserved-zero", cts.every((e) => (e[1] & 0xfn) === 0n));

//  --- 2. commitTs = readCommit(...).ats, for every indexed commit ---------
for (const nm of ["c0", "c1", "c2"]) {
  const sha = exp[nm];
  const m = idx.readCommit(ctx.r, sha);
  const got = idx.commitTs(ix, idx.hlOfSha(sha));
  check("commitTs-" + nm + "-is-readCommit-ats", got === m.ats,
        got + " vs " + m.ats);
}
//  c0 was committed months after it was authored: the row holds the AUTHOR
//  time, the one every bee view displays (BEE-033:29).
{
  const m = idx.readCommit(ctx.r, exp.c0);
  check("c0-author-and-committer-times-really-differ", m.ats !== m.ts,
        m.ats + " vs " + m.ts);
  check("commitTs-is-the-author-time-not-the-committer-one",
        idx.commitTs(ix, idx.hlOfSha(exp.c0)) === m.ats);
}

//  --- 3. a MISS answers null, never a date it cannot know -----------------
//  The orphan commit is off the indexed branch, so the walk never entered it.
check("commitTs-of-an-unwalked-commit-is-null",
      idx.commitTs(ix, idx.hlOfSha(exp.orph)) === null,
      idx.commitTs(ix, idx.hlOfSha(exp.orph)));
check("commitTs-of-a-hashlet-no-object-carries-is-null",
      idx.commitTs(ix, 0x123456789abcdn) === null);

//  --- 4. blobTs: B2P -> REV-CMMT -> CTS, min-folded over the carriers -----
{
  const t0 = idx.readCommit(ctx.r, exp.c0).ats;
  const t1 = idx.readCommit(ctx.r, exp.c1).ats;
  check("blobTs-of-a-single-carrier-blob-is-its-commit-date",
        idx.blobTs(ix, idx.hlOfSha(exp.b1)) === t0,
        idx.blobTs(ix, idx.hlOfSha(exp.b1)) + " vs " + t0);
  //  `2\n` sits at a.txt rev 1 (c1) and at moved.txt rev 0 (c2): the OLDEST
  //  carrier is the answer, which is what a "when was this content first
  //  seen" column wants.
  check("blobTs-folds-a-shared-blob-down-to-its-oldest-carrier",
        idx.blobTs(ix, idx.hlOfSha(exp.b2)) === t1,
        idx.blobTs(ix, idx.hlOfSha(exp.b2)) + " vs " + t1);
  check("blobTs-of-a-blob-the-index-does-not-hold-is-null",
        idx.blobTs(ix, 0x123456789abcdn) === null);
}

//  --- 5. the seal ORDER: CPAR proves the CTS row landed -------------------
//  A CPAR row is the "this commit is indexed" flag and goes in LAST, so every
//  commit that reads as indexed must have its date on disk too (BEE-033:32).
{
  let holes = 0;
  const c = ix.seek(0n);
  const done = [];
  while (c.next()) if (idx.keyKind(c.key) === idx.K_CPAR) done.push(idx.keyHl60(c.key));
  for (const chl of done) if (idx.commitTs(ix, chl) === null) holes++;
  check("every-CPAR-flagged-commit-has-its-CTS-row", holes === 0,
        "commits with no date " + holes);
}

try { ix.close(); } catch (e) {}
idx.closeRepo(ctx);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
