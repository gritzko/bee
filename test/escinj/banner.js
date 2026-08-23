//  test/escinj/banner.js — CODE-039, the headless half: the ANSI byte sink
//  neutralises every C0/DEL byte a hunk carries, and the banner band fills by
//  COLUMNS.  No repo, no view: hand-built hunks straight into render/ansi.js.
"use strict";

const wrap = require("render/wrap.js");
const ansi = require("render/ansi.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n") + "\n");
}

const ESC = String.fromCharCode(27);
//  Strip the renderer's OWN SGR; whatever escape byte is left came from the text.
function strip(s) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
//  Display columns of a painted string, the codepoint count wrap.js counts by.
function cols(s) { let c = 0; for (const ch of s) c++; return c; }

//  One token over the whole text — the shape every non-diff hunk has; the tag
//  picks the palette slot, so `L` is a row the painter really does colour.
function hunk(s, tag) {
  const text = utf8.Encode(s);
  const toks = new Uint32Array(1);
  toks[0] = (((tag || "S").charCodeAt(0) - 65) & 0x1f) << 27 | (text.length & 0xffffff);
  return { uri: "h", verb: "hunk", text: text, toks: toks };
}

//  ---- the body sink -------------------------------------------------------
const evil = hunk("oops" + ESC + "[31mRED" + ESC + "[0m\x07 done", "L");
const painted = ansi.paintRow(evil, 0, evil.text.length, true, wrap.PASS_NORMAL);
check("a C0 byte in hunk text never reaches the painted row",
      strip(painted).indexOf(ESC) < 0 && strip(painted).indexOf("\x07") < 0, painted);
check("the injected SGR is spelled inert, byte for byte",
      strip(painted) === "oops?[31mRED?[0m? done", strip(painted));
check("the renderer's OWN SGR survives the filter",
      painted.indexOf(ESC + "[") >= 0, painted);
const plain = ansi.paintRow(evil, 0, evil.text.length, false, wrap.PASS_NORMAL);
check("the uncoloured row carries no escape byte at all",
      plain.indexOf(ESC) < 0 && plain === "oops?[31mRED?[0m? done", plain);
check("the substitute is one column, so the row keeps its width",
      cols(plain) === cols("oops" + ESC + "[31mRED" + ESC + "[0m\x07 done"), cols(plain));

//  A DEL and a NUL go the same way; '\t' is geometry and rides through.
const mix = hunk("a\x00b\x7fc\td");
check("NUL and DEL are substituted, TAB is left alone",
      ansi.paintRow(mix, 0, mix.text.length, false, wrap.PASS_NORMAL) === "a?b?c\td",
      ansi.paintRow(mix, 0, mix.text.length, false, wrap.PASS_NORMAL));

//  ---- the banner band -----------------------------------------------------
function band(uri, w) { let s = ""; ansi.bannerColor(uri, w, function (x) { s += x; }); return s; }

const ascii = strip(band("code.js", 40)).replace(/\n$/, "");
check("an ascii band still fills exactly `cols`", cols(ascii) === 40, cols(ascii));

//  The BYTE fill under-filled this one: 9 codepoints, 13 utf-8 bytes.
const utf = strip(band("héllo/wörld.js", 40)).replace(/\n$/, "");
check("a UTF-8 uri fills the band by COLUMNS, not bytes",
      cols(utf) === 40, cols(utf) + " cols: " + JSON.stringify(utf));

const nasty = band("a" + ESC + "[31mb", 20);
check("a control byte in the uri never reaches the band",
      strip(nasty).indexOf(ESC) < 0, nasty);
check("...and the neutralised band is still `cols` wide",
      cols(strip(nasty).replace(/\n$/, "")) === 20,
      JSON.stringify(strip(nasty)));

w1(bad ? "FAILED " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "escinj/banner: " + bad + " failed";
