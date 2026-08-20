//  bee/test/actspell/fixture.js — BEE-038: one hunk carrying the three kinds of
//  `O` spell a row can hold, so both legs can click each in turn: a WRITER that
//  lands (`add one.txt`), a writer that REFUSES (`push`, the fixture tracks no
//  upstream, so it cannot touch a byte) and a VIEW spell that must still
//  push-nav (`cat one.txt`).  Built by hand, test/ospell/fixture.js's pattern —
//  the board's own buttons are BEE-025's, not this ticket's.
"use strict";

//  tok32 tag = the letter minus 'A' (dog/tok/TOK.h); `U` nav, `O` button.
const TAG_S = 18, TAG_N = 13, TAG_U = 20, TAG_O = 14;

//  be's verbatim look prefix (todo.js:750:TO btnSpell), shed by wrap.oSpell.
const LOOK = "#000080#ff0000 ";

//  The rows as the terminal shows them; the faces sit at cols 6, 12 and 18.
const VISIBLE = "one.txt\nrow2 [add] [bad] [cat]\n";

const PARTS = [
  [TAG_N, "one.txt"], [TAG_U, "cat one.txt"], [TAG_S, "\n"],
  [TAG_N, "row2"], [TAG_U, "cat two.txt"],           // the row's own nav
  [TAG_S, " "],
  [TAG_N, "[add]"], [TAG_O, LOOK + "add one.txt"],   // a mutation that lands
  [TAG_S, " "],
  [TAG_N, "[bad]"], [TAG_O, LOOK + "push"],          // a mutation that refuses
  [TAG_S, " "],
  [TAG_N, "[cat]"], [TAG_O, LOOK + "cat one.txt"],   // a VIEW spell: push-nav
  [TAG_S, "\n"],
];

function hunk() {
  const b = io.buf(1 << 12);
  const toks = new Uint32Array(PARTS.length);
  for (let i = 0; i < PARTS.length; i++) {
    b.feedStr(PARTS[i][1]);
    toks[i] = ((PARTS[i][0] & 0x1f) << 27) | (b.size & 0xffffff);
  }
  return { uri: "actspell", verb: "hunk", text: b.data(), toks: toks,
           kind: "actspell", plain: utf8.Encode(VISIBLE), bare: true };
}

//  The byte offset of a visible run; the fixture is ASCII, so index == offset.
function at(h, s) { return utf8.Decode(h.text).indexOf(s); }

//  What the fixture repo has STAGED right now, as one line — the proof a click
//  reached git at all.  stage.js:114 `list` is the same child every verb spends.
function staged() {
  const st = require("stage.js");
  const out = st.list(["git", "-C", st.root(), "diff", "--cached", "--name-only"]);
  return out === null ? "(git refused)" : utf8.Decode(out).trim();
}

module.exports = { hunk: hunk, at: at, staged: staged, LOOK: LOOK,
                   VISIBLE: VISIBLE };
