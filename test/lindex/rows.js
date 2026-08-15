//  bee/test/lindex/rows.js — LITE-033 leg 5, re-keyed by BEE-002: the LINK rows
//  `bee lindex` left in the ONE `<repo>/.git/be/*.lite2.idx` family.  Opens the
//  same wh128 stack the verb wrote and asserts the RULED bit layout — key
//  `fn_hl:40|par:20|7`, val `src path_hl:40|gpar:20|vnib:4` — that every slot is
//  minted from the ref TEXT alone (a 3-segment path, a bare filename, a ticket
//  code), that a self-link mints nothing, and the incremental mark under the
//  reserved ref hlOfText("lindex").
//
//  Driven by run.sh with the cwd inside the fixture repo:
//    LITE_FIX  the repo
//
//  It runs LAST, after the `rm -rf .git/be` rebuild, so the index's LINK rows are
//  exactly what the TIP (c2) blobs carry: doc/guide.mkd -> `src/abc/TCP.c`,
//  `TCP.c` and `LITE-029`, and nothing else.
"use strict";
const idx = require("index/index.js");
const li = require("index/lindex.js");

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
const gitdir = repo + "/.git";
const ix = idx.openIndex(gitdir);

//  --- every row on the stack ------------------------------------------------
const all = [];
{
  const c = ix.seek(0n);
  while (c.next()) all.push([c.key, c.val]);
}
const links = all.filter(function (e) { return idx.keyKind(e[0]) === li.K_LINK; });

//  --- 1. the kind ----------------------------------------------------------
//  Nibble 7 was the one free slot beside LITE-006's 1..5/F and LITE-011's 6.
check("link-kind-is-nibble-7", li.K_LINK === 0x7n, "K_LINK " + li.K_LINK);
check("link-rows-exist", links.length === 3, "LINK rows " + links.length);

//  --- 2. the ruled key/val split -------------------------------------------
//  BEE-002: key = fn_hl:40 | par:20 | 7, val = src path_hl:40 | gpar:20 | vnib:4
//  — every slot a truncated TEXT hashlet of the TARGET's own segments, `vnib`
//  the one field still RESERVED.
let valClean = true;
for (const [k, v] of links) if ((v & 0xFn) !== 0n) valClean = false;
check("link-val-vnib-is-zero", valClean);

//  --- 3. the three ref spellings -------------------------------------------
//  The ref keys on ITS OWN segments: a 3-segment path fills all three slots, a
//  bare filename leaves both ancestors absent, and a TICKET CODE is just a text
//  with no ancestors at all — so the row survives a thin<->fat layout move.
const src = idx.pathHl("doc/guide.mkd");
function rowsFor(text) {
  const q = li.slots(text);
  const key = li.linkKey(q.fn, q.par);
  return links.filter(function (e) {
    return e[0] === key && li.linkGpar(e[1]) === q.gpar;
  });
}
{
  const f = rowsFor("src/abc/TCP.c");
  check("a-3-segment-ref-fills-fn-par-gpar", f.length === 1, "rows " + f.length);
  check("val-names-the-carrier's-path_hl",
        f.length === 1 && li.linkSrc(f[0][1]) === src,
        f.length === 1 ? f[0][1].toString(16) : "-");
  const b = rowsFor("TCP.c");
  check("a-bare-ref-leaves-both-ancestors-absent", b.length === 1, "rows " + b.length);
  const t = rowsFor("LITE-029");
  check("a-ticket-code-keys-as-its-own-text", t.length === 1, "rows " + t.length);
  check("ticket-val-names-the-same-carrier",
        t.length === 1 && li.linkSrc(t[0][1]) === src,
        t.length === 1 ? t[0][1].toString(16) : "-");
  //  The absent slots really are 0, the FSEG spelling for "no such level".
  check("the-absent-slots-spell-zero",
        li.slots("LITE-029").par === 0n && li.slots("LITE-029").gpar === 0n &&
        li.slots("abc/TCP.c").gpar === 0n);
}

//  --- 4. what mints NOTHING -------------------------------------------------
//  A ref spelling the carrier's own path mints no row; a spelling nobody used
//  keys nowhere, which is what the two seeks of a query then find nothing on.
check("a-self-link-mints-no-row", rowsFor("doc/guide.mkd").length === 0);
check("no-row-for-an-unlinked-spelling", rowsFor("net/TCP.c").length === 0);

//  --- 5. the incremental mark ----------------------------------------------
//  A MARK-style row under the RESERVED ref hlOfText("lindex"), holding the tip
//  the last scan finished at — written LAST, so an interrupted scan re-scans.
{
  const key = idx.hlKey(idx.hlOfText(li.LINDEX_REF), idx.K_MARK);
  const marks = all.filter(function (e) { return e[0] === key; });
  check("the-lindex-mark-row-exists", marks.length >= 1, "rows " + marks.length);
  const ctx = idx.openRepo(repo);
  try {
    const tipHl = idx.hlOfSha(ctx.head.sha);
    check("the-mark-names-the-tip-commit",
          marks.some(function (e) { return idx.valHl60(e[1]) === tipHl; }),
          "tip " + ctx.head.sha.slice(0, 8));
    //  The mark's ref hashlet is NOT a real ref's, so it can never collide with
    //  the LITE-006 watermark of refs/heads/master.
    check("the-lindex-mark-is-its-own-ref",
          idx.hlOfText(li.LINDEX_REF) !== idx.hlOfText(ctx.head.ref));
  } finally { idx.closeRepo(ctx); }
}

//  --- 6. the module answers the same as the CLI -----------------------------
{
  const a = li.lindex("src/abc/TCP.c");
  //  BEE-002: a suspect is REPO-QUALIFIED — the repo path joined to the
  //  repo-relative one, so a hit in another repo is actionable as it stands.
  check("module-query-is-the-repo-qualified-suspect-list",
        a.paths !== null && a.paths.length === 1 &&
        a.paths[0] === io.realpath(repo) + "/doc/guide.mkd",
        JSON.stringify(a.paths));
  //  A second scan over an unmoved tip is the O(1) no-op — nothing is re-put.
  check("a-second-scan-is-the-no-op", a.rec.upToDate === true, JSON.stringify(a.rec));
}

try { ix.close(); } catch (e) {}
w1(bad === 0 ? "DONE " + n + " checks, 0 bad\n" : "DONE " + n + " checks, " + bad + " bad\n");
if (bad) throw "lindex rows: " + bad + " of " + n + " checks failed";
