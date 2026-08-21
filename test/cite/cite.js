//  bee/test/cite/cite.js — BEE-050: the hunks `cite` builds, not just the bytes
//  they print.  The shell leg reads stdout; this reads the page — that the
//  source segments still ADD UP to the file, that each says which line it
//  starts on, and that a segment cut inside a comment is not re-lexed, which is
//  the whole reason the tok stream is sliced instead.  Run in the fixture worktree.
"use strict";
const ci = require("view/cite.js");
const rd = require("index/read.js");

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

//  ---- the segment cutter, on bytes of its own -------------------------------
//  One token per 4 bytes over 16 bytes: a cut at 6..14 keeps the token that
//  straddles 6 (end 8), clamps the one that straddles 14, and rebases both.
const toks = Uint32Array.from([4, 8, 12, 16].map((e) => ((5 << 27) | e) >>> 0));
const cut = rd.tokSlice(toks, 6, 14);
check("a sliced tok stream keeps the straddling tokens and rebases the ends",
      cut.length === 3 && (cut[0] & 0xffffff) === 2 && (cut[1] & 0xffffff) === 6 &&
      (cut[2] & 0xffffff) === 8, Array.from(cut, (w) => w & 0xffffff).join(","));
check("...and their tags survive the cut", TAG(cut[0]) === "F" && TAG(cut[2]) === "F",
      TAG(cut[0]) + TAG(cut[2]));
check("an empty range slices to nothing", rd.tokSlice(toks, 8, 8).length === 0);

//  ---- the page over the fixture ---------------------------------------------
const page = ci.cite("doc.mkd");
const segs = page.hunks.filter((h) => h.kind === "cite");
const quotes = page.hunks.filter((h) => h.kind !== "cite");
check("the page is source segments with the quotes between them",
      segs.length === quotes.length + 1 && quotes.length === 2,
      segs.length + " segments, " + quotes.length + " quotes");
check("a quote wears the band, a source segment does not",
      segs.every((h) => h.bare === true) && quotes.every((h) => h.bare === false));

//  The one property a split page owes the reader: nothing of the file is lost
//  and nothing is doubled, whatever the cuts did.
const whole = segs.map((h) => dec(h.text)).join("");
const orig = dec(require("view/cat.js").wtBytes(io.cwd() + "/doc.mkd"));
check("the segments concatenate back to the file, byte for byte", whole === orig,
      whole.length + " vs " + orig.length);

//  ---- the line each segment starts on ---------------------------------------
let at = 1, ok0 = true;
for (const h of segs) {
  if (h.line0 !== at) { ok0 = false; break; }
  at += dec(h.text).split("\n").length - 1;
}
check("every segment says which file line it starts on (pager.js:413's `#L`)",
      ok0, segs.map((h) => h.line0).join(","));

//  ---- the quote lands where the resolver said -------------------------------
check("a quote carries the landing the pager selects by",
      quotes[0].land && quotes[0].land.line === 2, JSON.stringify(quotes[0].land));

//  ---- a cut inside a comment does not re-lex --------------------------------
//  `note.js` cites from INSIDE a block comment, so the second segment opens in
//  mid-comment.  Re-lexing that segment alone would call its first bytes code;
//  slicing the whole file's stream keeps them the comment they are.
const note = ci.cite("note.js");
const nsegs = note.hunks.filter((h) => h.kind === "cite");
check("a page cut inside a block comment still has two segments", nsegs.length === 2,
      nsegs.length);
const tail = nsegs[1];
check("...and the segment after the cut opens as COMMENT, not as code",
      tail.toks.length > 0 && TAG(tail.toks[0]) === "D",
      tail.toks.length ? TAG(tail.toks[0]) : "no toks");

w1((bad ? "FAIL" : "PASS") + " [bee/cite] cite.js " + n + " checks, " + bad + " bad\n");
if (bad) throw "cite.js: " + bad + " bad";
