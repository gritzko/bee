//  render/plain.js — LITE-045: THE PLAIN SINK, `render(hunks, opts) -> bytes`.
//  The non-interactive rendering, byte-exact with `bro --plain` (BROPlain, the
//  C `!BRO_COLOR` branch): no tok paint, no soft-wrap, just the bytes.
//  VERB-BLIND: every piped or `--plain` run in lite reaches stdout through
//  this ONE call — views differ in the hunks they make, never in how the
//  hunks are written.  Carved out of the old view/bro.js (LITE-001).
"use strict";

//  LITE-045, the TWO words a hunk says about its own plain bytes: `plain`, the
//  one ESCAPE HATCH when `text` is not readable bytes (a diff's text is the
//  weave, its plain the C unified render); `bare`, whether the hunk IS the
//  answer — `lite cat x | diff` wants the file alone — or an excerpt wearing the band.

//  BEE-054 the band's sigil: `§` heads a hunk in every ascii view — Markdown
//  syntax at no position, operator or sigil in no language, so a header can
//  never be read as the body under it (gritzko).
const BAND = "§ ";

//  A hunk's title line.  A SEGMENT of a split file says which line it resumes
//  at (`line0`, BEE-050:51), so a repeated title still places the reader.
function bandTitle(hunk) {
  const l = hunk.line0 || 1;
  return BAND + (hunk.uri || "") + (l > 1 ? ":" + l : "");
}

//  The band is the ONE banner header `§ <uri>\n` (HUNKu8sFeedBanner plain:
//  no ts/verb date, just `[verb ]<uri>`) then the text verbatim, with a
//  trailing '\n' appended iff the text doesn't already end in one.  `band`
//  overrides the hunk's own `bare`, which is how a page titles all of its own.
function plainHunk(hunk, band) {
  const text = hunk.plain || hunk.text;
  if (band === undefined) band = !hunk.bare;
  if (!band) return text;                          // the answer, unframed
  const out = utf8.Encode(bandTitle(hunk) + "\n");
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
  //  BEE-054 a page of SEVERAL hunks titles them all: a bare segment among
  //  excerpts still has to say where the file resumes.  One hunk is the answer
  //  and writes alone, so `bee cat x | diff` still gets the file (LITE-045).
  const many = hunks.length > 1;
  for (const h of hunks) {
    const b = plainHunk(h, many || !h.bare);
    parts.push(b); total += b.length;
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const b of parts) { all.set(b, off); off += b.length; }
  return all;
}

module.exports = { render: render, plainHunk: plainHunk,
                   bandTitle: bandTitle };
