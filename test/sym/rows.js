//  bee/test/sym/rows.js — BEE-063 leg 2: the ROWS the migration left in the ONE
//  `<repo>/.git/be/*.lite3.idx` family.  Opens the same wh128 stack the verb
//  wrote and asserts the TOP-nibble key convention (one contiguous range per
//  kind), MARK left at F, and the SYM record — key `9|sym_hl:40|types:20`,
//  val `seg0..seg3:10|fn_hl:20|vnib:4`, one row per (symbol, file), the
//  canonical tag slots, the mint gates and the watermark under hlOfText("symdex").
//
//  Driven by run.sh with the cwd inside the fixture repo:
//    LITE_FIX  the repo
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

const all = [];
{
  const c = ix.seek(0n);
  while (c.next()) all.push([c.key, c.val]);
}

//  --- 1. the extension IS the format ----------------------------------------
check("the-lite-lane-is-lite3", idx.IDX_EXT === ".lite3.idx", idx.IDX_EXT);
check("the-kv-lane-is-untouched", idx.KV_EXT === ".kv.idx", idx.KV_EXT);

//  --- 2. the kind is the key's TOP nibble ----------------------------------
//  Every builder puts it there, so a family owns exactly one 1/16 of the space.
{
  const phl = idx.pathHl("src/abc/TCP.c"), hl = idx.hlOfText("a commit");
  const rk = idx.revKey(phl, 7n, idx.K_BLOB);
  check("revKey-kind-is-the-top-nibble", (rk >> 60n) === idx.K_BLOB, rk.toString(16));
  check("revKey-round-trips", idx.keyKind(rk) === idx.K_BLOB &&
        idx.keyPhl(rk) === phl && idx.keyRev(rk) === 7n, rk.toString(16));
  const hk = idx.hlKey(hl, idx.K_CPAR);
  check("hlKey-kind-is-the-top-nibble", (hk >> 60n) === idx.K_CPAR, hk.toString(16));
  check("hlKey-round-trips", idx.keyKind(hk) === idx.K_CPAR &&
        idx.keyHl60(hk) === hl, hk.toString(16));
  const fk = idx.fsegRow("src/abc/TCP.c").key;
  check("fsegKey-kind-is-the-top-nibble", idx.keyKind(fk) === idx.K_FSEG,
        fk.toString(16));
  check("fsegKey-holds-fn-and-parent",
        idx.keyPhl(fk) === idx.fnHl("TCP.c") &&
        idx.keyRev(fk) === idx.segHl("abc", 20n), fk.toString(16));
  const lk = li.linkKey(idx.fnHl("TCP.c"), 0n);
  check("linkKey-kind-is-the-top-nibble", idx.keyKind(lk) === li.K_LINK,
        lk.toString(16));
}

//  --- 3. SYM is 9, and MARK keeps its F ------------------------------------
//  With the kind leading the key every kind owns a range, so SYM needs no
//  all-ones slot and nothing had to be renumbered around it (DOG-047).
check("sym-is-the-next-free-kind-9", idx.K_SYM === 0x9n, idx.K_SYM);
check("mark-keeps-F", idx.K_MARK === 0xFn, idx.K_MARK);
check("link-still-7", li.K_LINK === 0x7n, li.K_LINK);

//  --- 4. one CONTIGUOUS range per kind --------------------------------------
//  The rows come back key-ordered, so a kind that owns a range is a kind whose
//  rows form ONE run — the property the fat SYM family was moved here for.
{
  const runs = [], seen = new Set();
  let prev = null, twice = false;
  for (const [k] of all) {
    const kind = idx.keyKind(k);
    if (kind === prev) continue;
    if (seen.has(kind)) twice = true;
    seen.add(kind); runs.push(kind); prev = kind;
  }
  check("every-kind-is-one-contiguous-run", !twice, runs.join(","));
  check("the-runs-come-back-in-kind-order",
        runs.every(function (k, i) { return i === 0 || runs[i - 1] < k; }),
        runs.join(","));
  check("the-fat-sym-family-is-one-range-of-its-own",
        runs.indexOf(idx.K_SYM) >= 0, runs.join(","));
}

//  --- 5. the canonical tag slots -------------------------------------------
//  Sorted ascending, deduped, `0` spells absent, the lowest four win: without
//  that a re-lex of the same blob would key its own row differently (BEE-063:21).
{
  const S = 18, N = 13, C = 2;
  check("slots-are-order-blind", li.typeSlots([S, C, N]) === li.typeSlots([N, S, C]),
        li.typeSlots([S, C, N]).toString(2));
  check("slots-dedupe", li.typeSlots([S, S, S]) === li.typeSlots([S]));
  check("slots-sort-ascending",
        li.typeSlots([S, C]) === ((BigInt(C) << 15n) | (BigInt(S) << 10n)),
        li.typeSlots([S, C]).toString(2));
  check("an-absent-slot-is-zero", li.typeSlots([C]) === (BigInt(C) << 15n),
        li.typeSlots([C]).toString(2));
  check("the-lowest-four-win",
        li.typeSlots([1, 2, 3, 4, 5]) === li.typeSlots([1, 2, 3, 4]),
        li.typeSlots([1, 2, 3, 4, 5]).toString(2));
  check("no-tag-at-all-is-the-empty-slot-set", li.typeSlots([]) === 0n);
}

//  --- 6. the SYM row of a symbol in a file ---------------------------------
const syms = all.filter(function (e) { return idx.keyKind(e[0]) === idx.K_SYM; });
check("sym-rows-exist", syms.length > 0, "rows " + syms.length);
{
  const hl = idx.fnHl("u8bFeed");
  const mine = syms.filter(function (e) { return idx.keyPhl(e[0]) === hl; });
  check("one-row-per-symbol-per-file", mine.length === 2, "rows " + mine.length);
  const want = li.symRow("src/abc/TCP.c");
  const got = mine.filter(function (e) { return e[1] === want; });
  check("the-val-names-the-carrier's-segments", got.length === 1, "rows " + got.length);
  check("val-seg0-is-the-topmost-dir",
        got.length === 1 && li.symSeg(got[0][1], 0) === idx.segHl("src", 10n),
        got.length ? li.symSeg(got[0][1], 0) : "no row");
  check("val-seg1-is-the-parent-dir",
        got.length === 1 && li.symSeg(got[0][1], 1) === idx.segHl("abc", 10n));
  check("val-unused-levels-are-zero",
        got.length === 1 && li.symSeg(got[0][1], 2) === 0n &&
        li.symSeg(got[0][1], 3) === 0n);
  check("val-fn_hl-is-the-basename's-top-20",
        got.length === 1 && li.symFn(got[0][1]) === (idx.hlOfText("TCP.c") >> 40n));
  check("val-vnib-is-reserved-zero", got.length === 1 && (got[0][1] & 0xFn) === 0n);
  //  VERBATIM: no decasing, no despacing, so another spelling is another key.
  check("the-symbol-hashes-verbatim",
        syms.every(function (e) { return idx.keyPhl(e[0]) !== idx.fnHl("U8BFeed"); }));
  //  The tag slots really are the ones the lexer gave the token: `S`, the
  //  identifier class, and nothing else in this fixture.
  check("the-key-carries-the-canonical-slots",
        got.length === 1 && idx.keyRev(got[0][0]) === li.typeSlots([18]),
        got.length ? idx.keyRev(got[0][0]).toString(2) : "no row");
}

//  --- 7. what never mints ---------------------------------------------------
//  Under three characters, and anything the lexer did not tag as code: the
//  fixture's `id` and its comment-only word `zqcomment` (BEE-063:25).
{
  const short = syms.filter(function (e) { return idx.keyPhl(e[0]) === idx.fnHl("id"); });
  check("a-two-char-symbol-mints-nothing", short.length === 0, "rows " + short.length);
  const prose = syms.filter(function (e) {
    return idx.keyPhl(e[0]) === idx.fnHl("zqcomment");
  });
  check("a-comment-word-mints-nothing", prose.length === 0, "rows " + prose.length);
  //  A keyword is code and still no symbol anyone greps for.
  const kw = syms.filter(function (e) { return idx.keyPhl(e[0]) === idx.fnHl("return"); });
  check("a-keyword-mints-nothing", kw.length === 0, "rows " + kw.length);
}

//  --- 8. the symdex watermark ----------------------------------------------
//  Its OWN reserved ref: sharing lindex's would read a pre-SYM index as done.
{
  const key = idx.hlKey(idx.hlOfText(li.SYMDEX_REF), idx.K_MARK);
  const marks = all.filter(function (e) { return e[0] === key; });
  check("the-symdex-mark-row-exists", marks.length >= 1, "rows " + marks.length);
  check("the-symdex-mark-is-not-lindex's", key !== li.markKey(), key.toString(16));
  const ctx = idx.openRepo(repo);
  try {
    const tipHl = idx.hlOfSha(ctx.head.sha);
    check("the-symdex-mark-names-the-tip",
          marks.some(function (e) { return idx.valHl60(e[1]) === tipHl; }),
          "tip " + ctx.head.sha.slice(0, 8));
    //  Idempotent re-lex: the tip has not moved, so a second scan writes
    //  nothing at all and says so.
    const rec = li.scan(ctx, ix);
    check("a-second-scan-over-an-unmoved-tip-is-the-no-op",
          rec.upToDate === true && rec.rows === 0, JSON.stringify(rec));
  } finally { idx.closeRepo(ctx); }
}

//  --- 9. the query off those rows ------------------------------------------
{
  //  BEE-066: `sym` answers in records now, `paths` the mode that names the
  //  suspects without opening any of them — which is what these rows are about.
  const out = li.sym("u8bFeed", { repo: repo, paths: true })
                .map(function (r) { return r.full; });
  const root = io.realpath(repo);
  check("the-verb-names-both-carriers",
        out.indexOf(root + "/src/abc/TCP.c") >= 0 &&
        out.indexOf(root + "/net/WIRE.c") >= 0, JSON.stringify(out));
  check("a-symbol-nobody-mentions-answers-nothing",
        li.sym("zqcomment", { repo: repo }).length === 0);
}

try { ix.close(); } catch (e) {}
w1(bad === 0 ? "DONE " + n + " checks, 0 bad\n" : "DONE " + n + " checks, " + bad + " bad\n");
if (bad) throw "sym rows: " + bad + " of " + n + " checks failed";
