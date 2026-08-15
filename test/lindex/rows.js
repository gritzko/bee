//  lite/test/lindex/rows.js — LITE-033 leg 5: the LINK rows `lite lindex` left
//  in the ONE `<repo>/.git/be/*.lite2.idx` family.  Opens the same wh128 stack
//  the verb wrote and asserts the RULED bit layout — key `dst_hl:40|0:20|7`,
//  val `src path_hl:40|0:20|vnib:4` — the two dst flavours (a repo-relative
//  path text and a bare ticket code), the refs that mint NOTHING (ambiguous,
//  self), and the incremental mark under the reserved ref hlOfText("lindex").
//
//  Driven by run.sh with the cwd inside the fixture repo:
//    LITE_FIX  the repo
//
//  It runs LAST, after the `rm -rf .git/be` rebuild, so the lane's LINK rows are
//  exactly what the TIP (c2) blobs carry: doc/guide.mkd -> src/abc/TCP.c and
//  doc/guide.mkd -> LITE-029, and nothing else.
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
check("link-rows-exist", links.length === 2, "LINK rows " + links.length);

//  --- 2. the ruled key/val split -------------------------------------------
//  key = dst_hl:40 | 0:20 | 7 — the middle 20 bits are RESERVED and stay 0, so
//  a LINK key is the dst's `path_hl` shifted into the same slot a rev row uses.
//  val = src path_hl:40 | 0:20 | vnib:4 — the same shape, both spares 0.
let keyClean = true, valClean = true;
for (const [k, v] of links) {
  if (((k >> 4n) & 0xFFFFFn) !== 0n) keyClean = false;
  if ((v & 0xFn) !== 0n || ((v >> 4n) & 0xFFFFFn) !== 0n) valClean = false;
}
check("link-key-middle-20-bits-are-zero", keyClean);
check("link-val-vnib-and-spare-are-zero", valClean);

//  --- 3. the two dst flavours ----------------------------------------------
//  A FILE link is keyed by the REPO-RELATIVE PATH TEXT the ref resolved to; a
//  TICKET link by the BARE CODE, so the row survives a thin<->fat layout move.
const src = idx.pathHl("doc/guide.mkd");
function rowsFor(text) {
  const key = li.linkKey(idx.pathHl(text));
  return links.filter(function (e) { return e[0] === key; });
}
{
  const f = rowsFor("src/abc/TCP.c");
  check("dst-file-is-the-repo-relative-path-text", f.length === 1, "rows " + f.length);
  check("val-names-the-carrier's-path_hl",
        f.length === 1 && li.linkSrc(f[0][1]) === src,
        f.length === 1 ? f[0][1].toString(16) : "-");
  const t = rowsFor("LITE-029");
  check("dst-ticket-is-the-bare-code", t.length === 1, "rows " + t.length);
  check("ticket-val-names-the-same-carrier",
        t.length === 1 && li.linkSrc(t[0][1]) === src,
        t.length === 1 ? t[0][1].toString(16) : "-");
}

//  --- 4. what mints NOTHING -------------------------------------------------
//  The indexer never guesses: a bare `TCP.c` that TWO files answer is skipped,
//  and a self-link mints no row (the rewrite would name its own carrier).
check("an-ambiguous-ref-mints-no-row", rowsFor("TCP.c").length === 0);
check("a-self-link-mints-no-row", rowsFor("doc/guide.mkd").length === 0);
check("no-row-for-an-unlinked-file", rowsFor("net/TCP.c").length === 0);

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
  check("module-query-is-the-suspect-list",
        a.paths !== null && a.paths.length === 1 && a.paths[0] === "doc/guide.mkd",
        JSON.stringify(a.paths));
  //  A second scan over an unmoved tip is the O(1) no-op — nothing is re-put.
  check("a-second-scan-is-the-no-op", a.rec.upToDate === true, JSON.stringify(a.rec));
}

try { ix.close(); } catch (e) {}
w1(bad === 0 ? "DONE " + n + " checks, 0 bad\n" : "DONE " + n + " checks, " + bad + " bad\n");
if (bad) throw "lindex rows: " + bad + " of " + n + " checks failed";
