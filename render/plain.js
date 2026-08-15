//  render/plain.js — LITE-045: THE PLAIN SINK, `render(hunks, opts) -> bytes`.
//  The non-interactive rendering, byte-exact with `bro --plain` (BROPlain, the
//  C `!BRO_COLOR` branch): no tok paint, no soft-wrap, just the bytes.
//
//  VERB-BLIND: every piped or `--plain` run in lite — a path, a log, a commit,
//  a diff, a read view — reaches stdout through this ONE call.  What differs
//  between two views is the hunks they make, never the way those hunks are
//  written.
//
//  Carved out of the old view/bro.js (LITE-001), which mixed this with the row
//  index, the ansi painter and the hunk builders.
"use strict";

//  LITE-045, the TWO words a hunk says about its own plain bytes:
//
//    `plain`  THE ONE ESCAPE HATCH — the body to write when the hunk's `text`
//             is not readable bytes.  A diff hunk's text is the WEAVE (both
//             sides interleaved) and its plain is the C unified render; a
//             list/tree/log/commit row set carries hidden `U` click targets
//             that take no column, and its plain is the visible row bytes.
//    `bare`   whether this hunk IS the answer or an EXCERPT of one.  A `cat`,
//             a `blob`, a listing, a log, a commit's metadata is the answer and
//             writes its bytes alone — `lite cat x | diff` wants the file, not
//             a frame around it.  A file at a path and one diff window are
//             excerpts and wear the band.
//
//  The band is the ONE banner header `hunk <uri>\n` (HUNKu8sFeedBanner plain:
//  no ts/verb date, just `[verb ]<uri>`) then the text verbatim, with a
//  trailing '\n' appended iff the text doesn't already end in one.
function plainHunk(hunk) {
  const text = hunk.plain || hunk.text;
  if (hunk.bare) return text;                      // the answer, unframed
  const out = utf8.Encode("hunk " + hunk.uri + "\n");
  if (text.length === 0) return out;
  const needNL = text[text.length - 1] !== 0x0a;
  const buf = new Uint8Array(out.length + text.length + (needNL ? 1 : 0));
  buf.set(out, 0);
  buf.set(text, out.length);
  if (needNL) buf[buf.length - 1] = 0x0a;
  return buf;
}

//  render(hunks, opts) -> bytes — the whole set in ONE buffer, so a batch is
//  one write and a `| head` sees no interleaving.
function render(hunks, opts) {
  const parts = [];
  let total = 0;
  for (const h of hunks) { const b = plainHunk(h); parts.push(b); total += b.length; }
  const all = new Uint8Array(total);
  let off = 0;
  for (const b of parts) { all.set(b, off); off += b.length; }
  return all;
}

module.exports = { render: render, plainHunk: plainHunk };
