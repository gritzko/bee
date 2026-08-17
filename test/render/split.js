//  lite/test/render/split.js — BEE-021: inline vs whole-line diff rows, the
//  be bro_walk_hunk heuristics over hand-built weaves (no repo, no view).
//  A lightly edited line is ONE row with both sides painted pale in place; a
//  heavier one splits into an rm row and an in row, each hiding the other
//  side.  BRO-041: the edit weighs max(in,rm), so a symmetric token swap with a
//  4x unchanged remainder stays inline.
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

//  A weave from [side, text] pieces: one 'S' tok per piece, side in bits 25..24.
const EQ = 0, IN = 1, RM = 2;
function weave(pieces) {
  let s = "";
  const toks = new Uint32Array(pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    s += pieces[i][1];
    toks[i] = ((("S".charCodeAt(0) - 65) & 0x1f) << 27) | (pieces[i][0] << 24) |
              (utf8.Encode(s).length & 0xffffff);
  }
  return { uri: "w", verb: "hunk", text: utf8.Encode(s), toks: toks, kind: "diff" };
}
function shown(h, r) { return ansi.paintRow(h, r.off, r.end, false, r.pass); }
function rowsOf(h) {
  return wrap.indexRows(h, 80, true).map(function (r) { return r.pass + ":" + shown(h, r); });
}
const P = wrap.PASS_NORMAL, R = wrap.PASS_RM, I = wrap.PASS_IN;

//  ---- BRO-041: the todo-marker repro — ONE inline row ----------------------
const todo = weave([[RM, "-[ ]"], [IN, "-[x]"], [EQ, " uniform headers\n"]]);
const li = wrap.classifyLines(todo.text, todo.toks);
check("tallies: rm 4, in 4, eq 16, EQ boundary",
      li.length === 1 && li[0].rmB === 4 && li[0].inB === 4 && li[0].eqB === 16 &&
      li[0].bnd === EQ, JSON.stringify(li));
check("BRO-041: max(in,rm)*4 < max+eq classifies INLINE",
      wrap.lineKind(li[0]) === wrap.K_MOD_INLINE, wrap.lineKind(li[0]));
check("a symmetric token swap is ONE normal row, both sides shown",
      JSON.stringify(rowsOf(todo)) === JSON.stringify([P + ":-[ ]-[x] uniform headers"]),
      JSON.stringify(rowsOf(todo)));
const painted = ansi.paintRow(todo, 0, todo.text.length - 1, true, P);
check("inline paints the PALE washes 224/194, never the strong 217/157",
      painted.indexOf("48;5;224m") >= 0 && painted.indexOf("48;5;194m") >= 0 &&
      painted.indexOf("48;5;217m") < 0 && painted.indexOf("48;5;157m") < 0, painted);

//  ---- a whole line replaced: no eq bytes -> SPLIT, rm row then in row ------
const swap = weave([[EQ, "one\n"], [RM, "two"], [IN, "2"], [EQ, "\nthree\n"]]);
check("a full-line replacement splits: eq / rm / in / eq",
      JSON.stringify(rowsOf(swap)) ===
      JSON.stringify([P + ":one", R + ":two", I + ":2", P + ":three"]),
      JSON.stringify(rowsOf(swap)));
const rr = wrap.indexRows(swap, 80, true);
const rmRow = ansi.paintRow(swap, rr[1].off, rr[1].end, true, rr[1].pass);
const inRow = ansi.paintRow(swap, rr[2].off, rr[2].end, true, rr[2].pass);
check("the rm row wears the strong salmon 217 and hides the in bytes",
      rmRow.indexOf("48;5;217m") >= 0 && rmRow.indexOf("2\x1b") < 0, rmRow);
check("the in row wears the strong salad 157 and hides the rm bytes",
      inRow.indexOf("48;5;157m") >= 0 && inRow.indexOf("two") < 0, inRow);

//  ---- a heavy edit with some context still splits (the 4x gate) -----------
const heavy = weave([[EQ, "a "], [RM, "bbbb"], [IN, "cccc"], [EQ, "\n"]]);
check("changed 4 vs eq 2: 16 >= 6 -> SPLIT",
      JSON.stringify(rowsOf(heavy)) === JSON.stringify([R + ":a bbbb", I + ":a cccc"]),
      JSON.stringify(rowsOf(heavy)));

//  ---- pure insert / pure remove lines ---------------------------------------
const pure = weave([[EQ, "x\n"], [IN, "added\n"], [RM, "gone\n"], [EQ, "y\n"]]);
check("a pure in line is one IN row, a pure rm line one RM row (rm first)",
      JSON.stringify(rowsOf(pure)) ===
      JSON.stringify([P + ":x", R + ":gone", I + ":added", P + ":y"]),
      JSON.stringify(rowsOf(pure)));

//  ---- a one-sided '\n' continues the block (lineContinues / passSeesNL) ---
//  from "aa bb\n" to "aa\nbb\n": the rm pass does not see the IN '\n', so its
//  row spans both segments; the in pass breaks there and shows two rows.
const brk = weave([[EQ, "aa"], [RM, " "], [IN, "\n"], [EQ, "bb\n"]]);
check("a one-sided line break groups the rm row across it",
      JSON.stringify(rowsOf(brk)) === JSON.stringify([R + ":aa bb", I + ":aa", I + ":bb"]),
      JSON.stringify(rowsOf(brk)));

//  ---- a file hunk (all EQ) is untouched: one NORMAL row per line ----------
const file = weave([[EQ, "p\nq\n"]]);
check("an EQ-only hunk takes the plain one-row-per-line index",
      JSON.stringify(rowsOf(file)) === JSON.stringify([P + ":p", P + ":q"]),
      JSON.stringify(rowsOf(file)));

//  ---- the whole renderer: strip the SGR and both passes' text is there ----
const dump = utf8.Decode(ansi.render([swap], { cols: 10 })).replace(/\x1b\[[0-9;]*m/g, "");
check("ansi.render emits the split rows in order",
      dump === "w         \none\ntwo\n2\nthree\n", dump);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
