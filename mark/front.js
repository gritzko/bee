//  mark/front.js — BEE-029: a Markdown YAML front matter is the file's
//  METADATA, so it never reaches the parser: unsplit, its opening `---` lexes
//  as a thematic break and its keys as a setext heading underlined by the
//  closer.  The shape is the one `MDFMFind` pins for the dog lexer
//  (quickjab/dog/tok/MDFM.c:11, MARK-017) and the one the keyed lane already
//  read on its own (index/kv.js:126:De), which requires this module now — the
//  page and the index must never split a file differently.
"use strict";

//  The first BODY line: a preamble opens at line 1 with a bare `---` and closes
//  on the first `---` or `...` line, or at EOF.  0 = no preamble, since a `---`
//  below line 1 is a CommonMark thematic break and stays one.
function bodyLine(lines) {
  if (!lines.length || lines[0].trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") return i + 1;
  }
  //  A `---` that is the WHOLE file is a ruler, not an empty preamble: with no
  //  closer, a preamble needs a body to be one (MDFM.c:41, MARK-017).
  return lines.slice(1).join("\n") === "" ? 0 : lines.length;
}

//  The page's bytes with the preamble off — the source itself when there is
//  none, so a page without one parses the bytes it always did.
function strip(src) {
  const text = String(src);
  const lines = text.split("\n");
  const at = bodyLine(lines);
  return at === 0 ? text : lines.slice(at).join("\n");
}

//  The Markdown render every caller wants: the preamble dropped, then the GFM
//  parse and the emit (mark/html.js:225:3i).
function toHtml(src, opts) {
  return require("mark/html.js").toHtml(strip(src), opts);
}

module.exports = { bodyLine: bodyLine, strip: strip, toHtml: toHtml };
