//  view/commit.js — `bee commit [<hex>]`: one commit's metadata, then its
//  diff.  The plain output is exactly `commit <sha40>\n` plus the raw commit
//  object (LITE-009:17:C2), so the object is copied through untouched and the
//  colour spans are byte offsets into it; rebuilding it from parsed fields or
//  a utf8 round trip could change a byte.  The hidden click targets
//  (LITE-021:43:Jb) go into a second body, `textU`/`toksU`, that only the pager
//  sees, so `plain` stays byte-identical.  The metadata needs the ODB alone;
//  the files half is a diff and brings the index up (BEE-005:10:mJ).
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
//  The metadata is followed by the commit's diff against its first parent.
const df = require("./diff.js");

//  The argument is a hexlet only; with no path form here, a non-hex argument
//  is refused rather than reclassified the way `log` does (view/log.js:14:Wn).
const HEXARG = /^[0-9a-fA-F]{6,40}$/;

//  The palette of be/views/commit/commit.js (LITE-009:18:C2): R field names, L
//  shas, G other values, N subject, W body, S terminators, U hidden targets.
const TAG_G = 6, TAG_L = 11, TAG_N = 13, TAG_R = 17, TAG_S = 18, TAG_U = 20,
      TAG_W = 22;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

const NL = 0x0a, SP = 0x20;

//  A byte run [lo,hi) as ASCII, for header names only: the object format
//  keeps those ASCII, while a value may carry any bytes.
function ascii(b, lo, hi) {
  let s = "";
  for (let i = lo; i < hi; i++) s += String.fromCharCode(b[i]);
  return s;
}
//  Is the run [lo,hi) a full lowercase-hex sha?  Only tree/parent values are
//  painted cyan and made clickable, so a malformed one stays plain text.
function isSha40At(b, lo, hi) {
  if (hi - lo !== 40) return false;
  for (let i = lo; i < hi; i++) {
    const c = b[i];
    if (!((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66))) return false;
  }
  return true;
}

//  Walk the raw commit bytes header by header, in the object's own order, so
//  gpgsig/mergetag survive where git.parseCommit drops them (LITE-009:19:C2).
//  Returns [[tag, end, nav]]: the colour slot, the span's end offset in the
//  whole hunk (`base` = the synthetic first line's length), the click target.
function spansOf(b, base) {
  const n = b.length, spans = [];
  let last = 0;                                  // the previous span's end
  const put = (tag, end, nav) => {
    if (end <= last) return;                     // an empty run gets no span
    last = end;
    spans.push([tag, base + end, nav || ""]);
  };
  let i = 0;
  //  The header block: one span for the name, one per value line.
  while (i < n) {
    if (b[i] === NL) { put(TAG_S, i + 1); i++; break; }  // blank line: headers end
    let j = i;
    while (j < n && b[j] !== NL && b[j] !== SP) j++;
    const name = ascii(b, i, j);
    const nameEnd = (j < n && b[j] === SP) ? j + 1 : j;  // the space joins the name
    //  The name span carries the target too, so Enter (which lands on the
    //  row's first span) follows it as a click on the sha does (LITE-021:43:Jb).
    let ve = nameEnd;
    while (ve < n && b[ve] !== NL) ve++;
    const linky = (name === "tree" || name === "parent") &&
                  isSha40At(b, nameEnd, ve);
    const nav = linky
      ? (name === "tree" ? "tree " : "commit ") + ascii(b, nameEnd, ve) : "";
    put(TAG_R, nameEnd, nav);
    //  The value and its folded continuation lines, one span per line, so a
    //  colour never bleeds across a newline.
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
      if (!(k < n && b[k] === SP)) { i = k; break; }     // no continuation line
    }
  }
  //  The message: the subject line bold, the rest in the body slot.
  for (let line = 0; i < n; line++) {
    let e = i;
    while (e < n && b[e] !== NL) e++;
    put(line === 0 ? TAG_N : TAG_W, e);
    if (e < n) put(TAG_S, e + 1);
    i = e < n ? e + 1 : e;
  }
  return spans;
}

//  The hunk body: `commit <sha40>\n` plus the object in one growing io.buf,
//  the pattern of view/log.js `hunk`, with the spans packed over it.
function build(sha, bytes) {
  const head = utf8.Encode("commit " + sha + "\n");
  const b = io.buf(head.length + bytes.length + 8);
  b.feed(head);
  b.feed(bytes);
  //  The banner spans: `commit ` R, the sha L, the newline S.  The banner sha
  //  gets no click target, since this page already is that commit.
  const spans = [[TAG_R, 7, ""], [TAG_L, 7 + sha.length, ""],
                 [TAG_S, head.length, ""]].concat(spansOf(bytes, head.length));
  const text = b.data();
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  const u = withTargets(text, spans);
  return { text: text, toks: toks, textU: u.text, toksU: u.toks };
}

//  The pager's twin body: the same bytes with each span's click target spliced
//  in right after it under a hidden `U` span.  render/wrap.js gives a `U` byte
//  no column, so the visible row stays the plain one to the byte (LITE-021:43:Jb).
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

//  The hunk record, the same shape a file or a log yields, so pager.js and
//  render/ansi.js take it unchanged.  The pager gets the twin body with the
//  targets; `plain` is the object untouched, with no banner band (LITE-017:47:Cv).
function hunk(uri, b) {
  return { uri: uri, verb: "hunk", text: b.textU || b.text,
           toks: b.toksU || b.toks, kind: "commit",
           plain: b.text, bare: true };
}

//  commit(arg, opts) -> { sha, uri, hunks }; no argument means the checked-out
//  tip.  The metadata hunk leads and the file diffs follow, so no caller has
//  to assemble the two halves itself (LITE-045:27:t2).
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
    //  getHex hands back {type, bytes} and no name, so a short hexlet is
    //  re-framed to its full sha, as view/log.js `seedOf` does.
    const sha = hexlet.length === 40 ? hexlet : hex.encode(lg.frameSha(o.bytes));
    const b = build(sha, o.bytes);        // { text, toks } and the targets twin
    const uri = "commit " + (bare ? sha : arg);
    //  The commit's files under the metadata: a changed or added file gets its
    //  diff hunks, a removed one an empty hunk, the banner alone.
    const m = idx.readCommit(ctx.r, sha);
    const files = m === null ? [] : df.commitHunks(ctx, m, [], sha);
    return { sha: sha, uri: uri, hunks: [hunk(uri, b)].concat(files) };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { commit: commit, hunk: hunk, build: build, spansOf: spansOf,
                   HEXARG: HEXARG };
