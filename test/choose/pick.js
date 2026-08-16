//  bee/test/choose/pick.js — BEE-011: a PROJECT-PREFIXED path resolves.
//  A generic name answers in several repos and reaches the {rels} chooser; the
//  spelling a reader reaches for is the repo's NAME then the path under it.
//  BEE-012's half is the http leg in run.sh — this one is the door alone.
"use strict";
const door = require("door.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const ALPHA = io.getenv("BEE_ALPHA"), BETA = io.getenv("BEE_BETA");
function rows(t) { const r = door.resolvePartial(t); return r === null ? [] : r; }
function fulls(t) { return rows(t).map(function (x) { return x.full; }).join(" "); }

//  ---- the ambiguity that makes the spelling necessary -----------------------
check("a generic name answers in BOTH repos", rows("main.js").length === 2, fulls("main.js"));
const seat = door.seatOf("main.js");
check("...so the door answers the chooser, not a seat",
      seat !== null && seat.rels !== undefined && seat.rels.length === 2,
      JSON.stringify(seat));

//  ---- BEE-011: the repo name as the head of the path ------------------------
check("the repo NAME picks its own file", fulls("alpha/main.js") === ALPHA + "/main.js",
      fulls("alpha/main.js"));
check("...and the other name the other file", fulls("beta/main.js") === BETA + "/main.js",
      fulls("beta/main.js"));
check("...so a prefixed ref seats, never the chooser",
      (door.seatOf("alpha/main.js") || {}).full === ALPHA + "/main.js",
      JSON.stringify(door.seatOf("alpha/main.js")));
check("`///name/path` goes on naming the same file",
      fulls("///alpha/main.js") === ALPHA + "/main.js", fulls("///alpha/main.js"));

//  ---- what must NOT change --------------------------------------------------
//  The prefixed reading is the LAST leg, so a partial that answers today keeps
//  its answer and never gains a second row from the repo-name spelling.
check("a plain partial that answers is untouched",
      fulls("render/html.js") === ALPHA + "/render/html.js", fulls("render/html.js"));
check("an intra-repo ambiguity is still a choice", rows("html.js").length === 2,
      fulls("html.js"));
check("...and the name resolves it", fulls("alpha/render/html.js") === ALPHA + "/render/html.js",
      fulls("alpha/render/html.js"));
check("an unknown repo name answers nothing", rows("nosuch/main.js").length === 0,
      fulls("nosuch/main.js"));
check("a known name with no such file answers nothing",
      rows("alpha/nosuch.js").length === 0, fulls("alpha/nosuch.js"));
check("the name is not a SUFFIX match — it heads the path",
      rows("alpha/packtoy/main.js").length === 0, fulls("alpha/packtoy/main.js"));

w1((bad ? "FAIL" : "PASS") + " [bee/choose door] " + n + " checks, " + bad + " bad\n");
if (bad) throw "choose: " + bad + " of " + n + " checks failed";
