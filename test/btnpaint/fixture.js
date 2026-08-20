//  bee/test/btnpaint/fixture.js — BEE-035: one row carrying all FOUR button
//  looks, so a golden row pins the lot at once: a LIT face (its `O` names the
//  bg+fg pair), an INFO face (fg only, no wash), a DISABLED face (the grey tag,
//  no `O`) and a BLANK slot.  No view emits a button yet (BEE-041..044).
"use strict";

const theme = require("render/theme.js");

//  tok32 tag = the letter minus 'A' (dog/tok/TOK.h); `O` is the button channel.
const TAG_D = 3, TAG_I = 8, TAG_S = 18, TAG_O = 14;

//  The two look prefixes a view bakes (be views/todo/todo.js:750 btnSpell /
//  :775 infoCell): the derived wash then the tone, and the tone alone.
const LIT = theme.pale(theme.BTN.status) + theme.BTN.status + " ";
const INFO = "#" + theme.BTN.chg + " ";

const VISIBLE = "[ i ~3  ✓  ]\n";

const PARTS = [
  [TAG_D, "["],
  [TAG_I, " i"], [TAG_O, LIT + "status //wt"],   // lit: pair + a spell
  [TAG_S, " "],
  [TAG_I, "~3"], [TAG_O, INFO],                  // info: fg only, no spell
  [TAG_S, " "],
  [TAG_D, " ✓"],                            // disabled: the grey tag alone
  [TAG_S, "  "],                                 // an empty slot
  [TAG_D, "]"],
  [TAG_S, "\n"],
];

function hunk() {
  const b = io.buf(1 << 12);
  const toks = new Uint32Array(PARTS.length);
  for (let i = 0; i < PARTS.length; i++) {
    b.feedStr(PARTS[i][1]);
    toks[i] = ((PARTS[i][0] & 0x1f) << 27) | (b.size & 0xffffff);
  }
  return { uri: "btnpaint", verb: "hunk", text: b.data(), toks: toks,
           kind: "btnpaint", plain: utf8.Encode(VISIBLE), bare: true };
}

module.exports = { hunk: hunk, LIT: LIT, INFO: INFO, VISIBLE: VISIBLE };
