//  lite/test/render/modes.js — LITE-045, the HEADLESS half of the mode axis:
//  the three `render(hunks, opts) -> bytes` entry points, called directly over
//  hunks a view built and over a hand-built one.
//
//  The claim under test is ORTHOGONALITY: a renderer takes hunks and knows
//  nothing else.  So the SAME hand-built hunk — no verb behind it at all —
//  must render in all three sinks, and a hunk's own `plain`/`bare` words must
//  be the ONLY thing that moves the plain bytes.
//
//  `LITE_FIX` names the fixture repo.
"use strict";

const fs = require("view/fs.js");
const wrap = require("render/wrap.js");
const plain = require("render/plain.js");
const ansi = require("render/ansi.js");
const html = require("render/html.js");
const ct = require("view/cat.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
function S(b) { return utf8.Decode(b); }
const ESC = String.fromCharCode(27);
function nosgr(s) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

const repo = io.getenv("LITE_FIX");

//  ---- a hand-built hunk: NO view made it ----------------------------------
//  Three tagged spans over five bytes, the shape every view emits.
const text = utf8.Encode("ab/cd\n");
const hand = { uri: "hand made", verb: "hunk", text: text,
               toks: fs.packToks([["F", 2], ["P", 3], ["F", 5], ["W", 6]]),
               kind: "file" };

check("plain renders a hunk no verb made",
      S(plain.render([hand])) === "hunk hand made\nab/cd\n", S(plain.render([hand])));
const painted = S(ansi.render([hand], { cols: 20 }));
check("ansi renders that same hunk", painted.indexOf(ESC) === 0, painted);
check("...and the paint strips back to the band + the body",
      nosgr(painted) === "hand made           \nab/cd\n", JSON.stringify(nosgr(painted)));
const page = S(html.render([hand]));
check("html renders that same hunk", page.indexOf("<!DOCTYPE html>") === 0, page.slice(0, 40));
check("...as spans over the very same bytes",
      page.indexOf('<span class="tok-F"') > 0 && page.indexOf(">ab</span>") > 0,
      page.slice(page.indexOf("<body>")));

//  ---- nothing to show is nothing, in all three ----------------------------
check("plain says nothing about no hunks", plain.render([]).length === 0);
check("ansi says nothing about no hunks", ansi.render([]).length === 0);
check("html says nothing about no hunks", html.render([]).length === 0);

//  ---- `bare` and `plain` are the ONLY plain-side dials --------------------
//  The same bytes, once as an EXCERPT (banded) and once as THE ANSWER (naked).
const excerpt = { uri: "u", verb: "hunk", text: text, toks: hand.toks, kind: "file" };
const answer  = { uri: "u", verb: "hunk", text: text, toks: hand.toks, kind: "cat",
                  bare: true };
check("an excerpt wears the band", S(plain.render([excerpt])) === "hunk u\nab/cd\n",
      S(plain.render([excerpt])));
check("the answer wears none", S(plain.render([answer])) === "ab/cd\n",
      S(plain.render([answer])));
//  ...and `plain` overrides the body for both.
const woven = { uri: "u", verb: "hunk", text: utf8.Encode("WEAVE"), toks: hand.toks,
                kind: "diff", plain: utf8.Encode("unified\n") };
check("the plain escape hatch replaces the body, band and all",
      S(plain.render([woven])) === "hunk u\nunified\n", S(plain.render([woven])));
//  the COLOUR sink never reads `plain` — it paints the real bytes.
check("...and the colour sink still paints the hunk's own text",
      nosgr(S(ansi.render([woven], { cols: 8 }))).indexOf("WEAVE") > 0,
      nosgr(S(ansi.render([woven], { cols: 8 }))));

//  ---- no column clamp on a pipe -------------------------------------------
//  A pipe has no width to lose bytes to: a line far past the banner width comes
//  out whole, unlike the pager's no-wrap viewport which hides the tail.
const long = "x".repeat(300);
const wide = { uri: "w", verb: "hunk", text: utf8.Encode(long + "\n"),
               toks: new Uint32Array(0), kind: "file" };
check("--color clamps no body row", nosgr(S(ansi.render([wide], { cols: 20 }))).indexOf(long) > 0,
      nosgr(S(ansi.render([wide], { cols: 20 }))).length);
check("...while the pager's own viewport does clamp",
      wrap.indexRows(wide, 20, false)[0].end === 20,
      wrap.indexRows(wide, 20, false)[0].end);

//  ---- a real view's hunks go through unchanged ----------------------------
const out = ct.cat("a.c", { from: repo });
check("a cat hunk renders plain as the file itself",
      S(plain.render(out.hunks)) === S(out.hunks[0].text), S(plain.render(out.hunks)));
const cpaint = nosgr(S(ansi.render(out.hunks, { cols: 40 })));
check("...and painted as the band plus that file",
      cpaint === "cat a.c" + " ".repeat(33) + "\n" + S(out.hunks[0].text), JSON.stringify(cpaint));
check("...and as a page carrying its tokens",
      S(html.render(out.hunks)).indexOf('class="tok-') > 0);

//  ---- the html page stands alone ------------------------------------------
const solo = S(html.render(out.hunks));
check("the html page inlines its stylesheet",
      solo.indexOf("<style>") > 0 && solo.indexOf('href="/style.css"') < 0);
check("...and every colour in it is theme.js's own",
      solo.indexOf(".tok-F{color:") > 0, solo.slice(solo.indexOf(".tok-F"), solo.indexOf(".tok-F") + 40));

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
if (bad) throw "render: " + bad + " of " + n + " checks failed";
