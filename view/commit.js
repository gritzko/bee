//  view/commit.js — LITE-009: `lite commit [<hex>]`, ONE commit's metadata,
//  ported from be/views/commit/commit.js.
//
//  The METADATA half is PURE ODB: `git.getHex` takes any 6..40 hexlet, so the
//  arg IS an object name and no repo-list line is ever touched.  BEE-005: the
//  FILES half is a diff, so it brings the index up to that commit (lazily, and
//  never a registry line) — a diff is a projection of the path's weave now.
//
//  THE OUTPUT IS THE OBJECT.  be's key finding carries over verbatim: the plain
//  bytes are EXACTLY
//
//      commit <sha40>\n
//      <the raw commit object, byte for byte>
//
//  which is `git cat-file commit <sha>` with one synthetic line in front.  So
//  this file never REBUILDS those bytes out of parsed fields — it copies the
//  object through and computes tok32 spans as byte OFFSETS into it.  Nothing
//  is decoded to a JS string, so a latin-1 author name or an `encoding`
//  header cannot round-trip through utf8 and change a byte.  (be walks the
//  DECODED text and re-concatenates it; that is the one shape change here.)
//
//  The colour is layered on those same bytes: field names R, sha values L,
//  other values G, subject N, message body W, line terminators S — render/ansi.js
//  THEME maps every one.  be's `F` ticket spans and its COMMIT-007 human-date
//  rewrite are still NOT carried over (a rewritten date would break the byte
//  identity above).
//
//  LITE-021: the hidden `U` click-targets ARE carried over now that LITE-017
//  built the door: a `tree` sha opens `tree <sha>`, a `parent` sha opens
//  `commit <sha>`.  They are PAGER-ONLY paint -- the target bytes are spliced
//  into a SECOND body (`textU`/`toksU`, what `hunk()` hands the pager), so the
//  plain `text` stays the object byte for byte.  TWO spans per hash row
//  (LITE-017 tree.js's pattern): the pager reads a target as "the span
//  FOLLOWING the one under the cursor", so Enter (which lands on the row's
//  FIRST span, the field name) and a click on the sha itself both follow.
//  The BANNER sha carries NONE: the synthetic `commit <sha40>` line IS the
//  page, which is be's own ruling there (PROJ.c:431-436).
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
//  LITE-009: the metadata is followed by the commit's OWN diff (vs its first
//  parent) — the LITE-010 fold, one hunk set per changed or added file.
const df = require("./diff.js");

//  The arg is a hexlet, nothing else — there is no path form here, so a
//  non-hex arg is refused rather than reclassified (cf. LITE-007's log).
const HEXARG = /^[0-9a-fA-F]{6,40}$/;

//  tok32 tag indices (A=0 … Z=25), be/views/commit/commit.js's own palette:
//  R keyword/blue = field names, L number/cyan = sha values, G string/green =
//  other values, N bold = the subject, W = the message body, S default = the
//  line terminators (so a span's colour never bleeds across a '\n').
//  LITE-021: U = the hidden click-target (BRO-006), no colour of its own.
const TAG_G = 6, TAG_L = 11, TAG_N = 13, TAG_R = 17, TAG_S = 18, TAG_U = 20,
      TAG_W = 22;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

const NL = 0x0a, SP = 0x20;

//  A byte run [lo,hi) as ASCII — header NAMES only, which are ASCII by the
//  object format.  Never used on a value.
function ascii(b, lo, hi) {
  let s = "";
  for (let i = lo; i < hi; i++) s += String.fromCharCode(b[i]);
  return s;
}
//  Is the 40 bytes at `lo` a full lowercase-hex sha?  (tree/parent values, the
//  only ones painted cyan.)
function isSha40At(b, lo, hi) {
  if (hi - lo !== 40) return false;
  for (let i = lo; i < hi; i++) {
    const c = b[i];
    if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66))) return false;
  }
  return true;
}

//  --- the raw ordered header walk (be's parseHeaders, over BYTES) -----------
//  One `field SP value\n` per header, RFC-822 continuation folding (a line
//  beginning with a SPACE continues the previous value), a blank line ends the
//  headers and the rest is the message.  Order is the OBJECT's, so gpgsig,
//  mergetag and encoding survive where git.parseCommit would drop them.
//
//  spansOf(bytes, base) -> [[tag, end, nav]] with `end` an offset into the
//  WHOLE hunk (`base` = the length of the synthetic `commit <sha40>\n` line)
//  and `nav` the LITE-021 click target riding after that span ("" = none).
function spansOf(b, base) {
  const n = b.length, spans = [];
  let last = 0;                                          // the previous end
  const put = (tag, end, nav) => {
    if (end <= last) return;                             // an empty run: no span
    last = end;
    spans.push([tag, base + end, nav || ""]);
  };
  let i = 0;
  //  the header block
  while (i < n) {
    if (b[i] === NL) { put(TAG_S, i + 1); i++; break; }    // the blank separator
    let j = i;
    while (j < n && b[j] !== NL && b[j] !== SP) j++;
    const name = ascii(b, i, j);
    const nameEnd = (j < n && b[j] === SP) ? j + 1 : j;    // the SP rides the name
    //  LITE-021: `tree <sha40>` opens the tree listing, `parent <sha40>` the
    //  parent's own page.  The NAME span carries the target too, so Enter on
    //  the row (which lands on the row's first span) follows it as a click does.
    let ve = nameEnd;
    while (ve < n && b[ve] !== NL) ve++;
    const linky = (name === "tree" || name === "parent") &&
                  isSha40At(b, nameEnd, ve);
    const nav = linky
      ? (name === "tree" ? "tree " : "commit ") + ascii(b, nameEnd, ve) : "";
    put(TAG_R, nameEnd, nav);
    //  the value, plus every folded continuation line, one span per line so a
    //  colour never bleeds across a '\n'.
    let k = nameEnd, first = true;
    for (;;) {
      let e = k;
      while (e < n && b[e] !== NL) e++;
      const sha = first && linky;
      put(sha ? TAG_L : TAG_G, e, sha ? nav : "");
      first = false;
      if (e >= n) { i = e; break; }
      put(TAG_S, e + 1);
      k = e + 1;
      if (!(k < n && b[k] === SP)) { i = k; break; }       // no continuation
    }
  }
  //  the message: the subject bold, the rest the body slot.
  for (let line = 0; i < n; line++) {
    let e = i;
    while (e < n && b[e] !== NL) e++;
    put(line === 0 ? TAG_N : TAG_W, e);
    if (e < n) put(TAG_S, e + 1);
    i = e < n ? e + 1 : e;
  }
  return spans;
}

//  --- the hunk --------------------------------------------------------------
//  `commit <sha40>\n` + the object, in ONE growing io.buf (view/log.js's own
//  hunk pattern), with the spans packed over it.
function build(sha, bytes) {
  const head = utf8.Encode("commit " + sha + "\n");
  const b = io.buf(head.length + bytes.length + 8);
  b.feed(head);
  b.feed(bytes);
  //  The banner: `commit ` R, the sha L (no target — this page IS that commit),
  //  the '\n' S.  The object's own spans follow.
  const spans = [[TAG_R, 7, ""], [TAG_L, 7 + sha.length, ""],
                 [TAG_S, head.length, ""]].concat(spansOf(bytes, head.length));
  const text = b.data();
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  const u = withTargets(text, spans);
  return { text: text, toks: toks, textU: u.text, toksU: u.toks };
}

//  LITE-021: the pager's twin body — the very same bytes with each span's nav
//  target spliced in right after it under a hidden `U` span (render/wrap.js gives
//  a `U` byte no column, so the visible row is the plain one to the byte).
function withTargets(text, spans) {
  let extra = 0;
  for (const s of spans) if (s[2]) extra += s[2].length;
  if (extra === 0) {
    const toks = new Uint32Array(spans.length);
    for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
    return { text: text, toks: toks };
  }
  const b = io.buf(text.length + extra + 8);
  const out = [];
  let prev = 0;
  for (const s of spans) {
    b.feed(text.slice(prev, s[1]));
    prev = s[1];
    out.push([s[0], b.size]);
    if (s[2]) { b.feedStr(s[2]); out.push([TAG_U, b.size]); }
  }
  const toks = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) toks[i] = tok32(out[i][0], out[i][1]);
  return { text: b.data(), toks: toks };
}

//  The tty shape: the same hunk record a file arg or a log yields, so it goes
//  through pager.js + render/ansi.js unchanged.
//  LITE-021: the pager gets the U-BEARING twin; the `plain` bytes (what a pipe
//  writes) are the object untouched, so they stay `git cat-file commit` with
//  one line in front.  LITE-045: metadata IS the answer, hence `bare`.
function hunk(uri, b) {
  return { uri: uri, verb: "hunk", text: b.textU || b.text,
           toks: b.toksU || b.toks, kind: "commit",
           plain: b.text, bare: true };
}

//  --- the verb --------------------------------------------------------------
//  commit(arg, opts) -> { sha, uri, hunks }.  No arg = the checked-out tip.
//  `opts.from` is the dir to find the repo above (the cwd by default).
//  LITE-045: the metadata hunk leads the list — a commit view is its fields and
//  then its files, and a caller never assembles the two halves itself.
function commit(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const bare = arg === undefined || arg === null || arg === "";
    if (!bare && !HEXARG.test(arg))
      throw "commit: " + arg + " is not a commit name — give 6 to 40 hex digits";
    const hexlet = bare ? ctx.head.sha : String(arg).toLowerCase();
    let o = null;
    try { o = git.getHex(ctx.h, hexlet); } catch (e) { o = null; }
    if (o === null || o.type !== "commit")
      throw "commit: no commit in this repository is named " + (bare ? hexlet : arg);
    //  getHex hands back {type, bytes} and no name, so a SHORT hexlet is
    //  re-framed to its own sha the way LITE-007's `seedOf` does.
    const sha = hexlet.length === 40 ? hexlet : hex.encode(lg.frameSha(o.bytes));
    const b = build(sha, o.bytes);        // { text, toks } + the U-bearing twin
    const uri = "commit " + (bare ? sha : arg);
    //  The commit's files, under the metadata: a changed or added one gets its
    //  diff hunks, a removed one an EMPTY hunk (the banner alone).
    const m = idx.readCommit(ctx.r, sha);
    const files = m === null ? [] : df.commitHunks(ctx, m, [], sha);
    return { sha: sha, uri: uri, hunks: [hunk(uri, b)].concat(files) };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { commit: commit, hunk: hunk, build: build, spansOf: spansOf,
                   HEXARG: HEXARG };
