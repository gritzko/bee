//  bee/test/ospell/fixture.js — BEE-034: the one hunk both legs drive.  No view
//  emits an `O` yet (the buttons are BEE-035/BEE-038), so the channel is tested
//  on a hand-built hunk: row 1 is a plain `U` nav row, row 2 carries a nav `U`
//  AND two buttons, proving a row's nav click and its button clicks coexist.
"use strict";

//  tok32 tag = the letter minus 'A' (dog/tok/TOK.h); `U` nav, `O` button.
const TAG_S = 18, TAG_N = 13, TAG_U = 20, TAG_O = 14;

//  be's verbatim look prefix (todo.js:750:TO btnSpell): `#<bg><fg> `, both
//  truecolor, background first — the pager sheds it at the first space.
const LOOK = "#000080#ff0000 ";

//  The rows as the terminal shows them (the plain sink must be byte-equal).
const VISIBLE = "one.txt\nrow2 [cat] [nil]\n";

const PARTS = [
  [TAG_N, "one.txt"], [TAG_U, "cat one.txt"], [TAG_S, "\n"],
  [TAG_N, "row2"], [TAG_U, "cat two.txt"],           // the row's own nav
  [TAG_S, " "],
  [TAG_N, "[cat]"], [TAG_O, LOOK + "cat one.txt"],   // a button that runs
  [TAG_S, " "],
  [TAG_N, "[nil]"], [TAG_O, LOOK],                   // look only: falls through
  [TAG_S, "\n"],
];

function hunk() {
  const b = io.buf(1 << 12);
  const toks = new Uint32Array(PARTS.length);
  for (let i = 0; i < PARTS.length; i++) {
    const tag = PARTS[i][0];
    b.feedStr(PARTS[i][1]);
    toks[i] = ((tag & 0x1f) << 27) | (b.size & 0xffffff);
  }
  //  `plain` is the row bytes alone — the hidden-target precedent every list
  //  hunk follows (render/plain.js:19:QF), which is what keeps `O` out of a pipe.
  return { uri: "ospell", verb: "hunk", text: b.data(), toks: toks,
           kind: "ospell", plain: utf8.Encode(VISIBLE), bare: true };
}

//  The byte offset of a visible run; the fixture is ASCII, so index == offset.
function at(h, s) { return utf8.Decode(h.text).indexOf(s); }

module.exports = { hunk: hunk, at: at, LOOK: LOOK, VISIBLE: VISIBLE };
