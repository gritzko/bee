//  lite/test/merge/weave.js — LITE-014 leg 1: `index/weave.js` itself, with no
//  files, no git and no driver in the way.  The three trivial shortcuts, a
//  clean disjoint weave, a genuine overlap's conflict SPANS, the re-absorbed
//  equal-bytes rule (two births spelling the same bytes are NOT a conflict),
//  and the two unweavable inputs that must answer null so the driver falls
//  back to git's own merge: over the 4 MB source cap, and binary.
//
//  Driven by run.sh; needs no environment.
"use strict";
const wv = require("index/weave.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const B = utf8.Encode;
function S(bytes) { return utf8.Decode(bytes); }

//  --- 1. the trivial three-way shortcuts (all span-free) -------------------
{
  const base = B("a\nb\nc\n"), same = B("a\nZ\nc\n");
  let m = wv.weave3(base, same, same, "txt");
  check("both-sides-same-edit", S(m.bytes) === "a\nZ\nc\n" && m.spans.length === 0, S(m.bytes));
  m = wv.weave3(base, base, same, "txt");
  check("only-theirs-changed", S(m.bytes) === "a\nZ\nc\n" && m.spans.length === 0, S(m.bytes));
  m = wv.weave3(base, same, base, "txt");
  check("only-ours-changed", S(m.bytes) === "a\nZ\nc\n" && m.spans.length === 0, S(m.bytes));
  //  An absent base (a both-sides ADD) reads as empty, not as a crash.
  m = wv.weave3(null, same, same, "txt");
  check("null-base-is-empty", S(m.bytes) === "a\nZ\nc\n" && m.spans.length === 0, S(m.bytes));
}

//  --- 2. a clean disjoint weave: both edits land, no span ------------------
{
  const m = wv.weave3(B("a\nb\nc\n"), B("a\nb\nC\n"), B("A\nb\nc\n"), "txt");
  check("disjoint-lines-clean", S(m.bytes) === "A\nb\nC\n" && m.spans.length === 0,
        S(m.bytes) + " spans " + m.spans.length);
}
{
  //  The CRDT selling point: two edits to DIFFERENT WORDS of the SAME line —
  //  stock git conflicts on this, the weave does not (run.sh proves the git half).
  const m = wv.weave3(B("the quick brown fox\n"), B("the slow brown fox\n"),
                      B("the quick brown dog\n"), "txt");
  check("same-line-different-words-clean",
        S(m.bytes) === "the slow brown dog\n" && m.spans.length === 0,
        S(m.bytes) + " spans " + m.spans.length);
}

//  --- 3. a genuine overlap: both sides in the bytes, ONE conflict span ------
{
  const m = wv.weave3(B("a\nb\nc\n"), B("a\nY\nc\n"), B("a\nX\nc\n"), "txt");
  const text = S(m.bytes);
  check("overlap-has-one-span", m.spans.length === 1, "spans " + m.spans.length);
  check("overlap-carries-both-sides", text.indexOf("X") >= 0 && text.indexOf("Y") >= 0, text);
  check("overlap-is-markerless",
        text.indexOf("<<<<") < 0 && text.indexOf(">>>>") < 0 && text.indexOf("====") < 0, text);
  //  The span is a real byte range INSIDE the merged bytes, and it is the
  //  divergent region — not the whole file.
  const sp = m.spans[0];
  check("span-is-a-byte-range",
        sp.from >= 0 && sp.to > sp.from && sp.to <= m.bytes.length,
        JSON.stringify(sp) + " of " + m.bytes.length);
  check("span-covers-the-divergence",
        S(m.bytes.slice(sp.from, sp.to)).indexOf("X") >= 0 &&
        S(m.bytes.slice(sp.from, sp.to)).indexOf("Y") >= 0,
        S(m.bytes.slice(sp.from, sp.to)));
}

//  --- 4. re-absorbed equal bytes are NOT a conflict ------------------------
//  Both sides independently rewrite line 2 to the SAME "X" (two distinct birth
//  ids); theirs also appends a line, so the trivial ours==theirs shortcut does
//  not fire and the merge really runs.  The divergent run's two groups spell
//  EQUAL bytes, so it collapses to one copy with no span.
{
  const m = wv.weave3(B("a\nb\nc\n"), B("a\nX\nc\n"), B("a\nX\nc\nd\n"), "txt");
  check("re-absorbed-equal-bytes-clean", m.spans.length === 0, "spans " + m.spans.length);
  check("re-absorbed-keeps-one-copy", S(m.bytes) === "a\nX\nc\nd\n", S(m.bytes));
}

//  --- 5. the unweavable inputs answer null (the driver then falls back) -----
{
  const big = new Uint8Array(wv.MAX_SOURCE_SIZE + 1);
  for (let i = 0; i < big.length; i++) big[i] = 97 + (i % 26);
  check("over-cap-ours-is-null", wv.weave3(B("a\n"), big, B("b\n"), "txt") === null);
  check("over-cap-theirs-is-null", wv.weave3(B("a\n"), B("b\n"), big, "txt") === null);
  check("at-the-cap-still-weaves",
        wv.weave3(B("a\n"), big.slice(0, wv.MAX_SOURCE_SIZE), B("b\n"), "txt") !== null);
}
{
  const nul = new Uint8Array([104, 0, 105, 10]);           // "h\0i\n"
  const nul2 = new Uint8Array([104, 0, 106, 10]);          // "h\0j\n"
  check("binary-is-null", wv.weave3(nul, nul2, B("plain\n"), "bin") === null);
  check("text-with-a-late-NUL-is-still-binary", wv.isBinary(nul));
  check("plain-text-is-not-binary", !wv.isBinary(B("a\nb\n")));
}

//  --- 6. the shared policy: diff.js reads the SAME constants ---------------
{
  const df = require("view/diff.js");
  check("one-size-policy-source",
        df.MAX_SOURCE_SIZE === wv.MAX_SOURCE_SIZE &&
        df.MAX_SOURCE_MARKED_UP === wv.MAX_SOURCE_MARKED_UP &&
        df.extOf === wv.extOf && df.isBinary === wv.isBinary,
        df.MAX_SOURCE_SIZE + "/" + wv.MAX_SOURCE_SIZE);
  check("extOf-picks-the-lexer",
        wv.extOf("a/b/c.js") === "js" && wv.extOf("Makefile") === "" &&
        wv.extOf("/tmp/.bashrc") === "" && wv.extOf("x.tar.gz") === "gz",
        wv.extOf("x.tar.gz"));
}

//  --- 7. CODE-040: an absent side falls back, it does not throw ------------
{
  check("null-ours-is-null", wv.weave3(B("a\n"), null, B("b\n"), "txt") === null);
  check("null-theirs-is-null", wv.weave3(B("a\n"), B("b\n"), null, "txt") === null);
  check("undefined-both-sides-is-null",
        wv.weave3(B("a\n"), undefined, undefined, "txt") === null);
  check("bytesEq-tolerates-an-absent-side",
        wv.bytesEq(null, B("a\n")) === false && wv.bytesEq(B("a\n"), null) === false &&
        wv.bytesEq(null, null) === true && wv.bytesEq(B("a\n"), B("a\n")) === true);
}

//  --- 8. CODE-040: the 32-bit membership mask has a hard ceiling -----------
//  One side is one bit, so `1 << g` wraps past 31 sides and NOTHING matches the
//  spine: the whole file reads as one divergent run.  At the ceiling the spine
//  must still be right; over it, mergedLive must refuse instead of mis-merging.
{
  const hid = function (v) { return ("000000000000000" + v.toString(16)).slice(-16); };
  //  `ng` sides over one base: side 0 rewrites line 2 to Y, side 1 to X, the
  //  rest re-fold the base unchanged.  The shared "a\n"/"c\n" are the spine,
  //  so the one conflict span is the middle, [2,4) — never the whole file.
  const build = function (ng) {
    const bid = hid(1), ids = [bid], groups = [];
    let w = wv.fold(null, B("a\nb\nc\n"), "txt", bid, []);
    for (let i = 0; i < ng; i++) {
      const id = hid(0x10 + i);
      w = wv.fold(w, B(i === 0 ? "a\nY\nc\n" : i === 1 ? "a\nX\nc\n" : "a\nb\nc\n"),
                  "txt", id, [bid]);
      ids.push(id); groups.push([bid, id]);
    }
    const mrg = hid(0xff);
    return { w: wv.merge(w, mrg, ids), rev: mrg, groups: groups };
  };
  const spanOf = function (ng) {
    const t = build(ng), m = wv.mergedLive(t.w, t.rev, t.groups);
    return S(m.bytes) + " " + JSON.stringify(m.spans);
  };
  check("mask-ceiling-is-31", wv.MAX_GROUPS === 31, wv.MAX_GROUPS);
  check("2-sides-span-the-divergence-only",
        spanOf(2) === 'a\nXY\nc\n [{"from":2,"to":4}]', spanOf(2));
  check("31-sides-span-the-divergence-only",
        spanOf(31) === 'a\nXY\nc\n [{"from":2,"to":4}]', spanOf(31));
  let threw = "";
  try { spanOf(32); } catch (e) { threw = String(e); }
  check("32-sides-refuse-loudly", threw.indexOf("membership mask") >= 0,
        threw || "no throw");
}

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
