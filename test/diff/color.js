//  lite/test/diff/color.js — LITE-010: the DIFF WASH, headless.  A diff hunk's
//  text is the CFOLD weave (both sides interleaved) and every token's tok32
//  carries its side in bits [25..24]; the pager's row painter ORs the wash on
//  top of the syntax colour — salad green 157 for the to-side, salmon 217 for
//  the from-side (be/view/theme.js `inWash`/`rmWash`, which is what the C HUNK
//  colour render paints too).  `LITE_FIX` names the fixture repo.
"use strict";
const df = require("index/diff.js");
const bro = require("view/bro.js");
const pager = require("view/pager.js");

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

const repo = io.getenv("LITE_FIX");
const out = df.diff(undefined, { from: repo });
check("wt-diff-yields-hunks", out.hunks.length > 0, "hunks " + out.hunks.length);

const h = out.hunks[0];
check("hunk-is-lite-shaped",
      h.verb === "hunk" && h.kind === "diff" &&
      h.text instanceof Uint8Array && h.toks instanceof Uint32Array,
      h.verb + "/" + h.kind);
//  The uri is a PATH with the window's line anchor — no `diff:` scheme, which
//  is a be/URI concern lite has no parser for.
check("uri-is-a-path-with-an-anchor",
      h.uri.indexOf("diff:") < 0 && /#L[0-9]+$/.test(h.uri), h.uri);

//  Both sides are present in ONE hunk: some token is IN, some is RM.
let sides = 0;
for (let i = 0; i < h.toks.length; i++) sides |= 1 << ((h.toks[i] >>> 24) & 3);
check("toks-carry-both-diff-sides", (sides & 2) !== 0 && (sides & 4) !== 0,
      "side mask " + sides);

//  The painted rows carry the two washes and nothing else new.
const rows = bro.indexRows(h, 100, true);
let painted = "";
for (const r of rows) painted += pager.paintRow(h, r.off, r.end, true, r.pass) + "\n";
check("painted-rows-carry-the-in-wash", painted.indexOf(ESC + "[48;5;157m") >= 0
      || painted.indexOf(";48;5;157m") >= 0, painted.slice(0, 200));
check("painted-rows-carry-the-rm-wash", painted.indexOf("48;5;217m") >= 0,
      painted.slice(0, 200));
//  A file hunk is side EQ everywhere, so it gets NO wash — the wash is a diff
//  concern only (this is the regression guard for view/bro.js's cellAnsi).
check("a-side-EQ-token-takes-no-wash",
      bro.aEq(bro.cellAnsi("S", 0, bro.SIDE_EQ), bro.themeAt("S")) &&
      !bro.aEq(bro.cellAnsi("S", 0, bro.SIDE_IN), bro.themeAt("S")), "");

//  The C plain render rides along as `plain`, and bro.plainHunk writes THAT
//  under the usual banner — the weave bytes would be unreadable.
const pl = utf8.Decode(bro.plainHunk(h));
check("plainHunk-writes-the-unified-render",
      pl.indexOf("hunk " + h.uri + "\n") === 0 && pl.indexOf("\n--- a/") > 0 &&
      pl.indexOf("\n+++ b/") > 0 && pl.indexOf("\n@@ ") > 0, pl.slice(0, 120));
check("plainHunk-still-ends-in-a-newline", pl[pl.length - 1] === "\n", pl.slice(-20));

//  A binary pair is a TEXT-ONLY note hunk (no toks): the same channel, no
//  bytes.  bin.dat changed in the fixture's c1, so this reads the COMMIT form.
const cout = df.diff(io.getenv("LITE_HEX"), { from: repo });
let note = null;
for (const x of cout.hunks) if (x.uri.indexOf("bin.dat") === 0) note = x;
check("a-binary-pair-is-a-one-line-note", note !== null && note.toks.length === 0 &&
      utf8.Decode(note.text).indexOf("binary files differ") > 0,
      note ? utf8.Decode(note.text) : "(none)");

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
