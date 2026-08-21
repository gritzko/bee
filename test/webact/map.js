//  bee/test/webact/map.js — BEE-047: the headless half of the web acts — the
//  ONE views-vs-verbs map (act.js WRITES) and the two http leaves the endpoint
//  is built out of (the act URL, the form field).  The map is asserted as DATA
//  against act.js's own table, so a second verb list anywhere would show up
//  here as a disagreement rather than as a dead button in a browser.
"use strict";

const act = require("act.js");
const http = require("http.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

//  ---- the map IS the table --------------------------------------------------
const words = Object.keys(act.ACTS);
check("every mutation row is a writing word",
      words.every(function (w) { return act.WRITES[w] === true; }), words.join(","));
check("and the map carries nothing else",
      Object.keys(act.WRITES).length === words.length, Object.keys(act.WRITES).join(","));
check("a word off the table writes nothing",
      act.WRITES.status === undefined && act.WRITES.log === undefined);

//  BEE-047: views and verbs may share a word ONLY where act.js says the word is
//  SHAPE-SPLIT — that is the whole claim the two tables make together.
const both = Object.keys(act.WRITES).filter(function (w) { return http.ROUTE[w] !== undefined; });
check("a word in BOTH tables is shape-split and no other",
      both.every(function (w) { return typeof act.ACTS[w].shape === "function"; }),
      both.join(","));
check("and `commit` is exactly such a word", both.indexOf("commit") >= 0, both.join(","));

//  ---- a spell -> its word ---------------------------------------------------
check("a verb-first spell names its word", act.wordOf("done BEE-047") === "done");
check("a context-first spell sheds the context", act.wordOf("//bee-BEE-047 add") === "add");
check("the forceful flag is shed too", act.wordOf("add!") === "add");
check("a spell with no word answers none", act.wordOf("  ") === "");
check("a panel spell writes", act.writes("//bee add +") === true);
check("a board spell writes", act.writes("dont BEE-047") === true);
check("a VIEW spell does not", act.writes("status //bee") === false);
check("nor does an empty one", act.writes("") === false);
//  The SHAPE is not asked here: the painter must not run a predicate per face.
check("a shape-split word writes at the map level", act.writes("commit deadbeef") === true);
check("...and its reading shape is refused by act.actOf, not by the map",
      act.actOf("commit deadbeef") === null);

//  ---- the endpoint's two leaves ---------------------------------------------
check("the act URL names the repo", http.actPath("alpha") === "/alpha/act");
check("and reads back off a request URI", http.actRepo("/alpha/act") === "alpha");
check("a view URL is no act URL", http.actRepo("/alpha/todo") === "");
check("nor is a repo-less one", http.actRepo("/act") === "");
check("a deeper one is not the endpoint", http.actRepo("/alpha/act/x") === "");
check("the form field percent-decodes", http.formField("s=%2F%2Fa%20add", "s") === "//a add");
check("and reads `+` as a space", http.formField("x=1&s=done+GET-001", "s") === "done GET-001");
check("a body naming no field answers none", http.formField("x=1", "s") === "");

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "webact/map: " + bad + " failed";
