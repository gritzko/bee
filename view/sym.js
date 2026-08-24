//  view/sym.js — BEE-066: `bee sym [--paths] <ident> [.ext|<dir>]...`.  EVERY
//  HIT IS A HUNK, the canonical one (/wiki/Hunk, dog/HUNK.h:34): `uri` the
//  address `<path>:<line>`, `text` the RAW window bytes, `toks` the file's own
//  lexer tags with the mention marked.  Two windows MERGE where they overlap,
//  so no line is ever shown twice.  Nothing is drawn here — the banner, the
//  target and the paint are the renderers' off `uri` + `toks` (BEE-066:21).
//  The mentions are index/lindex.js:118's, the one mint gate, and the filter
//  words index/lindex.js:411's, so the verb only shows what a row could mint.
"use strict";

const li = require("index/lindex.js");
const rd = require("index/read.js");

//  tok32 (dog/tok/TOK.h): tag in bits 31..27, end byte offset in 23..0.
function tagCode(letter) { return letter.charCodeAt(0) - 65; }
//  The mention wears a STATUS slot, never a lexer one: borrowing a syntax tag
//  would make the mark vanish into the paint around it (render/theme.js:20:Vv).
const TAG_HIT = tagCode("E");

//  One line of context either side (BEE-066:19), the window `cite` quotes with.
const CONTEXT = 1;

//  --- the windows -------------------------------------------------------------
//  The byte each line starts at, 1-based through `starts[n - 1]`.  A trailing
//  newline opens no line, so the file's last line is its last row.
function lineStarts(bytes) {
  const s = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) s.push(i + 1);
  if (s.length > 1 && s[s.length - 1] === bytes.length) s.pop();
  return s;
}

//  The 1-based line byte `off` sits on.
function lineOf(starts, off) {
  let lo = 0, hi = starts.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if (starts[m] <= off) lo = m + 1; else hi = m; }
  return lo;
}

//  One window per mention, MERGED where two OVERLAP (BEE-066:19): side by side
//  they would show the shared line twice.  A merged window keeps the FIRST
//  mention's line as its address — that is where the reader is (view/quote.js:43:dN).
//  -> [{ from, to, line }] in reading order.
function windows(lines, last) {
  const out = [];
  for (const n of lines) {
    const from = n - CONTEXT < 1 ? 1 : n - CONTEXT;
    const to = n + CONTEXT > last ? last : n + CONTEXT;
    const w = out.length ? out[out.length - 1] : null;
    if (w !== null && from <= w.to) { if (to > w.to) w.to = to; continue; }
    out.push({ from: from, to: to, line: n });
  }
  return out;
}

//  --- the hunk ----------------------------------------------------------------
//  The file's own tags over `[lo,hi)` (index/read.js:116:ll), with every mention
//  token re-tagged: the marking is a TAG, so all three surfaces read it off the
//  one stream and no view draws a highlight of its own.
function markToks(toks, lo, hi, hits) {
  const cut = rd.tokSlice(toks, lo, hi);
  let start = 0;
  for (let i = 0; i < cut.length; i++) {
    const end = cut[i] & 0xffffff;
    if (hits.has(lo + start) && lo + end <= hi)
      cut[i] = (((TAG_HIT & 0x1f) << 27) | end) >>> 0;
    start = end;
  }
  return cut;
}

//  One window -> the canonical hunk.  Its shape is `see`'s excerpt
//  (view/see.js:105:s0): the address, the raw bytes, `win` the lines shown and
//  `land` the mention the pager seats the cursor on.
function windowHunk(rec, w, starts, last, hits) {
  const bytes = rec.bytes;
  const lo = starts[w.from - 1];
  const hi = w.to < last ? starts[w.to] : bytes.length;
  const h = { uri: rec.full + ":" + w.line, verb: "hunk",
              text: bytes.slice(lo, hi), toks: markToks(rec.toks, lo, hi, hits),
              kind: "sym", bare: false,
              //  BEE-050:31:wg the address the banner links to; BEE-028 the ambient
              //  a reference inside the window resolves in.
              ref: rec.full + ":" + w.line,
              pos: { repo: rec.root, path: rec.path, anchor: "" },
              win: { from: w.from, to: w.to } };
  const at = starts[w.line - 1];
  h.land = { line: w.line - w.from + 1, col: 1 };
  for (const m of rec.hits)
    if (m.lo >= at && lineOf(starts, m.lo) === w.line) {
      h.land.col = m.lo - at + 1;
      h.land.lo = m.lo - lo;
      h.land.hi = m.hi - lo;
      break;
    }
  return h;
}

//  One confirmed suspect -> its hunks, one per merged window.  The bytes are the
//  record's, which is the worktree file when there is one (index/lindex.js:441).
function fileHunks(rec, out) {
  const starts = lineStarts(rec.bytes), last = starts.length;
  const hits = new Set(), lines = [];
  for (const m of rec.hits) {
    hits.add(m.lo);
    const n = lineOf(starts, m.lo);
    if (!lines.length || lines[lines.length - 1] !== n) lines.push(n);
  }
  for (const w of windows(lines, last))
    out.push(windowHunk(rec, w, starts, last, hits));
}

//  --- the notes ---------------------------------------------------------------
//  A hunk of plain words, the way view/diff.js:201:pn says the one thing there is
//  to say about a pair it will not weave.
function noteHunk(uri, words) {
  const text = utf8.Encode(words + "\n");
  return { uri: uri, verb: "hunk", text: text, toks: new Uint32Array(0),
           kind: "sym", bare: true };
}

//  Past the BEE-063:37 cap a repo says how many files carry the symbol and asks
//  for a narrower query: descending the whole tree would answer with noise.
function capLine(rec) {
  return rec.root + ": " + rec.over + " files carry it — narrow the query";
}

function capHunk(rec) { return noteHunk(rec.root, capLine(rec)); }

//  A binary or over-cap blob is lexed nowhere in bee, so it can only name
//  itself: the address alone, as a deleted file's diff hunk is (view/diff.js:338:pn).
function bareHunk(rec) {
  return { uri: rec.full, verb: "hunk", text: new Uint8Array(0),
           toks: new Uint32Array(0), kind: "sym", bare: false, ref: rec.full };
}

//  --- the verb ----------------------------------------------------------------
//  `--paths` is the scripting mode: one path per line and no file opened at all,
//  which is BEE-063's answer verbatim.  It is ONE hunk, so a pipe reads the
//  paths and nothing else (render/plain.js:52:le).
function pathsHunk(uri, recs) {
  let out = "";
  for (const rec of recs) out += (rec.over ? capLine(rec) : rec.full) + "\n";
  return { uri: uri, verb: "hunk", text: utf8.Encode(out),
           toks: new Uint32Array(0), kind: "sym", bare: true };
}

//  The words of the arg, the flag shed: main.js fuses a verb's words and an
//  identifier never carries a space, so the split is the whole parse.  The
//  FIRST plain word is the symbol and every one after it is a filter, which
//  index/lindex.js:411 reads — a flag may stand anywhere among them.
function parse(arg) {
  const words = String(arg === undefined ? "" : arg).split(/\s+/).filter(Boolean);
  const out = { paths: false, ident: "", words: [] };
  for (const w of words) {
    if (w === "--paths") { out.paths = true; continue; }
    if (out.ident === "") out.ident = w; else out.words.push(w);
  }
  return out;
}

//  sym(arg, opts) -> { uri, hunks }, the one view shape (LITE-045:42:t2), so the
//  pager, the renderers and http take it without knowing a verb was added.
function sym(arg, opts) {
  opts = opts || {};
  const p = parse(arg);
  if (p.ident === "")
    throw "sym: needs an identifier — try: bee sym [--paths] <ident> [.ext|<dir>]...";
  const uriStr = "sym " + (p.paths ? "--paths " : "") +
                 [p.ident].concat(p.words).join(" ");
  const recs = li.sym(p.ident, { repo: opts.from, home: opts.home,
                                 paths: p.paths, words: p.words });
  if (recs.length === 0) return { uri: uriStr, hunks: [] };
  if (p.paths) return { uri: uriStr, hunks: [pathsHunk(uriStr, recs)] };
  const hunks = [];
  for (const rec of recs) {
    if (rec.over) { hunks.push(capHunk(rec)); continue; }
    if (rec.opaque) { hunks.push(bareHunk(rec)); continue; }
    fileHunks(rec, hunks);
  }
  return { uri: uriStr, hunks: hunks };
}

module.exports = { sym: sym, parse: parse, windows: windows, markToks: markToks,
                   lineStarts: lineStarts, lineOf: lineOf, fileHunks: fileHunks };
