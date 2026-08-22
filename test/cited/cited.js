//  bee/test/cited/cited.js — BEE-057: the hunks `cited` builds, not just the
//  bytes they print.  The shell leg reads stdout; this reads the page — that
//  the target's own segments still ADD UP to the file, that a quote is banded
//  and landed on the CARRIER, and that the shared weaving of view/quote.js
//  gives cite and cited the same windows.  Run in the fixture worktree.
"use strict";
const cd = require("view/cited.js");
const ci = require("view/cite.js");
const qt = require("view/quote.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const dec = (b) => utf8.Decode(b);
const TAG = (w) => String.fromCharCode(65 + ((w >>> 27) & 0x1f));

//  ---- the shared rules are ONE set of rules ---------------------------------
//  BEE-057:43 cite's window and cap moved to view/quote.js whole; a copy would
//  have let the two directions drift a line apart.
check("cite and cited quote through the same window and the same cap",
      qt.UP === 1 && qt.DOWN === 2 && qt.SOLO === 128,
      qt.UP + "/" + qt.DOWN + "/" + qt.SOLO);

//  ---- the page over the fixture ---------------------------------------------
//  Four carriers land on src/A.c: note.js on line 5, long.mkd on 12, doc.mkd on
//  20 and on 30 (twice, merged), plus bare.mkd with no anchor at all.
const page = cd.cited("src/A.c");
const segs = page.hunks.filter((h) => h.kind === "cited");
const quotes = page.hunks.filter((h) => h.kind !== "cited");
check("the page is the target's segments with the quotes between them",
      segs.length === 5 && quotes.length === 5,
      segs.length + " segments, " + quotes.length + " quotes");
check("a quote wears the band, a target segment does not",
      segs.every((h) => h.bare === true) && quotes.every((h) => h.bare === false));

//  The one property a split page owes the reader: nothing of the file is lost
//  and nothing is doubled, whatever the cuts did.
const whole = segs.map((h) => dec(h.text)).join("");
const orig = dec(require("view/cat.js").wtBytes(io.cwd() + "/src/A.c"));
check("the segments concatenate back to the target, byte for byte", whole === orig,
      whole.length + " vs " + orig.length);

//  ---- the line each segment starts on ---------------------------------------
let at = 1, ok0 = true;
for (const h of segs) {
  if (h.line0 !== at) { ok0 = false; break; }
  at += dec(h.text).split("\n").length - 1;
}
check("every segment says which file line it starts on (pager.js:413's `#L`)",
      ok0, segs.map((h) => h.line0).join(","));

//  ---- the anchorless ref opens FIRST, above the file ------------------------
check("a ref with no anchor is the leading block, above the first segment",
      page.hunks[0] === quotes[0] && /\/bare\.mkd:2$/.test(quotes[0].ref),
      quotes[0].ref);

//  ---- the quote is banded, landed and linked on the CARRIER -----------------
//  BEE-050:31 the header hangs the CARRIER's whole page off it, opened at the
//  citing line: the reader of a backlink wants to leave for the page that cited.
const doc = quotes.filter((h) => /\/doc\.mkd:/.test(h.ref));
check("a quote's `ref` is the carrier's path and its citing line",
      doc.length === 2 && /\/doc\.mkd:3$/.test(doc[0].ref) &&
      /\/doc\.mkd:12$/.test(doc[1].ref),
      doc.map((h) => h.ref).join(" "));
check("...and the landing selects the citing line inside the quote",
      doc[0].land.line === 2 && doc[0].land.hi > doc[0].land.lo,
      JSON.stringify(doc[0].land));
check("...and the selection is the REF TOKEN the carrier spelled",
      dec(doc[0].text).slice(doc[0].land.lo, doc[0].land.hi) === "src/A.c:20",
      dec(doc[0].text).slice(doc[0].land.lo, doc[0].land.hi));

//  ---- two citing lines under one landing are ONE quote ----------------------
//  BEE-050:36 doc.mkd:12 wants 11..14 and doc.mkd:13 wants 12..15; overlapping,
//  they open as one quote over 11..15, so the second adds no band of its own.
check("touching windows under one landing are one quote over the union",
      doc[1].win.from === 11 && doc[1].win.to === 15,
      JSON.stringify(doc[1].win));

//  ---- a cut inside a comment does not re-lex --------------------------------
//  note.js cites from INSIDE a block comment, so the quote opens in mid-comment
//  and its window is cut, not re-lexed; `see.excerpt` paints it as the comment
//  it is because the window carries the file's own extension.
const note = quotes.filter((h) => /\/note\.js:/.test(h.ref))[0];
check("the quote out of a block comment opens as COMMENT, not as code",
      note !== undefined && note.toks.length > 0 && TAG(note.toks[0]) === "D",
      note === undefined ? "no note.js quote" : TAG(note.toks[0]));

//  ---- cite and cited are the two directions of one edge ---------------------
//  doc.mkd cites src/A.c:20 and src/A.c is cited by doc.mkd:3 — the same edge
//  read from either end, so neither view may see one the other does not.
const out = ci.cite("doc.mkd").hunks.filter((h) => h.kind !== "cite");
check("what cite opens forward, cited opens back",
      out.some((h) => /\/src\/A\.c:20$/.test(h.ref)) &&
      quotes.some((h) => /\/doc\.mkd:3$/.test(h.ref)),
      out.map((h) => h.ref).join(" "));

//  ---- the false suspect answers for the file it truly names -----------------
//  `other/note.mkd` names a bare `A.c`, which keys the row `src/A.c` queries;
//  only opening it in ITS OWN dir (BEE-028) tells the two files apart.
const other = cd.cited("other/A.c");
const oq = other.hunks.filter((h) => h.kind !== "cited");
check("the false suspect of one file is the true carrier of its neighbour",
      oq.length === 1 && /\/other\/note\.mkd:1$/.test(oq[0].ref) &&
      !quotes.some((h) => /other\/note\.mkd/.test(h.ref)),
      oq.map((h) => h.ref).join(" "));

w1((bad ? "FAIL" : "PASS") + " [bee/cited] cited.js " + n + " checks, " + bad + " bad\n");
if (bad) throw "cited.js: " + bad + " bad";
