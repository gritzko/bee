//  bee/test/see/see.js — BEE-017: the hunk `see` builds, not just its bytes.
//  The shell leg reads what reached stdout; this reads the hunk itself — the
//  band, the `bare: false` that earns it, and the `land` the pager selects by,
//  which is the one thing `--plain` throws away.  Run in the fixture worktree.
"use strict";
const sv = require("view/see.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const ends = (s, tail) => typeof s === "string" && s.slice(-tail.length) === tail;
const dec = (b) => utf8.Decode(b);
//  The fixture's lines are `int AAAMARK018;` — the mark is not at column 0, so
//  the assertions ask for the LINE, never for a substring at a guessed offset.
const lines = (b) => dec(b).split("\n").filter(Boolean);
const line1 = (b, mark) => lines(b)[0] === "int " + mark + ";";

//  ---- the arg is a LIST, and -C reads both ways ------------------------------
check("the words split into refs", sv.parse("a:1 b:2").refs.length === 2 &&
      sv.parse("a:1 b:2").ctx === 2, JSON.stringify(sv.parse("a:1 b:2")));
check("...`-C4` sets the context and is not a ref",
      sv.parse("-C4 a:1").ctx === 4 && sv.parse("-C4 a:1").refs.length === 1,
      JSON.stringify(sv.parse("-C4 a:1")));
check("...and `-C 4` too", sv.parse("-C 4 a:1").ctx === 4 &&
      sv.parse("-C 4 a:1").refs.length === 1, JSON.stringify(sv.parse("-C 4 a:1")));
let threw = false;
try { sv.parse("-Cx a:1"); } catch (e) { threw = true; }
check("...a `-C` that is not a count is refused, never silently ignored", threw);

//  ---- the window, over 16-byte lines ----------------------------------------
//  40 lines of `int AAAMARK007;\n`, so line k starts at byte (k-1)*16.
const forty = utf8.Encode((function () {
  let s = "";
  for (let i = 1; i <= 40; i++) s += "int AAAMARK" + String(i).padStart(3, "0") + ";\n";
  return s;
})());
const w20 = sv.window(forty, 20, 2);
check("the window is lines 18..22 — five lines, exact bytes",
      w20.from === 18 && w20.lo === 17 * 16 && w20.hi === 22 * 16,
      JSON.stringify(w20));
const body20 = forty.slice(w20.lo, w20.hi);
check("...and it reads back as exactly those lines",
      lines(body20).length === 5 && line1(body20, "AAAMARK018") &&
      lines(body20)[4] === "int AAAMARK022;", dec(body20));
const w1a = sv.window(forty, 1, 2);
check("at the FIRST line it clamps rather than running off the front",
      w1a.from === 1 && w1a.lo === 0 && w1a.hi === 3 * 16, JSON.stringify(w1a));
const w40 = sv.window(forty, 40, 2);
check("...and at the LAST it stops at the end of the file",
      w40.from === 38 && w40.hi === forty.length, JSON.stringify(w40));
check("a line the file does not have has no window at all",
      sv.window(forty, 999, 2) === null);

//  ---- the hunk ---------------------------------------------------------------
const hs = sv.see("src/A.c:20").hunks;
check("one ref, one hunk", hs.length === 1, hs.length);
const h = hs[0];
check("...an EXCERPT, so it wears the band", h.bare === false, h.bare);
//  The band is the ref with its PATH EXPANDED and its tail kept — one token,
//  still a reference, so it re-reads through `see` and clicks in the pager.
check("...banded with the ref, its path expanded to the landing",
      h.uri.charAt(0) === "/" && ends(h.uri, "/src/A.c:20"), h.uri);
check("...carrying the five lines and nothing else",
      lines(h.text).length === 5 && line1(h.text, "AAAMARK018") &&
      lines(h.text)[4] === "int AAAMARK022;", dec(h.text));
//  The land is the line WITHIN the window — line 20 is the 3rd of lines 18..22.
check("...and a `land` the pager selects by: the 3rd line of the window",
      h.land && h.land.line === 3 && h.land.col === 1, JSON.stringify(h.land));

//  ---- a batch keeps the order it was given -----------------------------------
const two = sv.see("src/A.c:30 src/A.c:5").hunks;
check("a batch answers IN ORDER, not in file order",
      two.length === 2 && ends(two[0].uri, ":30") && ends(two[1].uri, ":5"),
      two.map(function (x) { return x.uri; }).join(" "));

//  ---- a miss is a hunk too, so the batch carries on ---------------------------
const mixed = sv.see("no/such/file.c:3 src/A.c:20").hunks;
check("a MISS is a hunk of plain words, and the ref after it still answers",
      mixed.length === 2 && dec(mixed[0].text).indexOf("no registered repo holds") === 0 &&
      line1(mixed[1].text, "AAAMARK018"),
      mixed.length + ": " + dec(mixed[0].text).slice(0, 40));

//  ---- and an empty arg says what it wants ------------------------------------
let bare = false;
try { sv.see(""); } catch (e) { bare = ("" + e).indexOf("see:") === 0; }
check("no reference at all is a refusal in plain words", bare);

w1((bad ? "FAIL " : "PASS ") + "[bee/see] " + n + " checks, " + bad + " bad\n");
if (bad) throw "SEECHECK";
