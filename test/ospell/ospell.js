//  bee/test/ospell/ospell.js — BEE-034: the `O` CLICK CHANNEL, headless.  One
//  fixture hunk carries a nav `U` and two buttons on the SAME row, so the three
//  sinks can be asked what each token means: the pager's `_spellAt`, the plain
//  bytes (no `O` byte may reach them) and the HTML painter's face-as-action.
//  The pty leg (Enter, a real click) is test/ospell/pty.js.
"use strict";
const pagerlib = require("pager.js");
const wrap = require("render/wrap.js");
const plain = require("render/plain.js");
const html = require("render/html.js");
const ansi = require("render/ansi.js");
const fixture = require(__dirname + "/fixture.js");

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

//  ---- the shed: everything through the FIRST space --------------------------
check("the `#<bg><fg> ` prefix is shed",
      wrap.oSpell(fixture.LOOK + "cat one.txt") === "cat one.txt",
      wrap.oSpell(fixture.LOOK + "cat one.txt"));
check("...at the FIRST space only, so an arg list survives",
      wrap.oSpell(fixture.LOOK + "log -n 3") === "log -n 3",
      wrap.oSpell(fixture.LOOK + "log -n 3"));
check("a spell with no look is all spell",
      wrap.oSpell("cat one.txt") === "cat one.txt", wrap.oSpell("cat one.txt"));
check("look and NO spell reads as no target",
      wrap.oSpell(fixture.LOOK) === "", wrap.oSpell(fixture.LOOK));
check("...and so does an empty `O`", wrap.oSpell("") === "", wrap.oSpell(""));

//  ---- _spellAt beside _targetAt, on one row carrying both -------------------
const h = fixture.hunk();
const p = new pagerlib.Pager(-1, { tty: -1, color: false });
check("a face followed by `O` is a click spell",
      p._spellAt(h, fixture.at(h, "[cat]")) === "cat one.txt",
      p._spellAt(h, fixture.at(h, "[cat]")));
check("...its `U` reading stays empty — the tags are separate channels",
      p._targetAt(h, fixture.at(h, "[cat]")) === "",
      p._targetAt(h, fixture.at(h, "[cat]")));
check("the SAME row's nav `U` is untouched",
      p._targetAt(h, fixture.at(h, "row2")) === "cat two.txt",
      p._targetAt(h, fixture.at(h, "row2")));
check("...and asks no spell of it",
      p._spellAt(h, fixture.at(h, "row2")) === "",
      p._spellAt(h, fixture.at(h, "row2")));
check("an empty spell falls through (no target of its own)",
      p._spellAt(h, fixture.at(h, "[nil]")) === "",
      p._spellAt(h, fixture.at(h, "[nil]")));
check("a plain row with neither has no spell",
      p._spellAt(h, fixture.at(h, "one.txt")) === "",
      p._spellAt(h, fixture.at(h, "one.txt")));

//  ---- the three sinks carry NO `O` byte -------------------------------------
const pl = utf8.Decode(plain.render([h]));
check("plain is the visible bytes, verbatim", pl === fixture.VISIBLE, pl);
check("...carrying no look prefix", pl.indexOf(fixture.LOOK) < 0, pl);
check("...and no spell bytes", pl.indexOf("cat one.txt") < 0, pl);
const an = utf8.Decode(ansi.render([h], {}));
check("the ansi paint hides the `O` cells too",
      an.indexOf(fixture.LOOK) < 0 && an.indexOf("cat one.txt") < 0, an);
check("...while the face itself is painted", an.indexOf("[cat]") >= 0, an);

//  ---- html.js: the O span IS the preceding face's action --------------------
const page = utf8.Decode(html.render([h], { link: function (t) { return "/go/" + t; } }));
//  What a browser would run on a face: the href of the anchor WRAPPING it, ""
//  when the face is a bare span — the html twin of the pager's `_curTarget`.
function linkOf(face) {
  const i = page.indexOf(">" + face + "</span>");
  if (i < 0) return "(no such face)";
  const a = page.lastIndexOf('<a href="', i);
  if (a < 0 || page.lastIndexOf("</a>", i) > a) return "";
  return page.slice(a + 9, page.indexOf('"', a + 9));
}
check("the face carries the SHED spell as its href",
      linkOf("[cat]") === "/go/cat one.txt", linkOf("[cat]"));
check("...and the `O` span itself paints zero bytes",
      page.indexOf(fixture.LOOK) < 0, page);
check("the same row's nav `U` still links its own token",
      linkOf("row2") === "/go/cat two.txt", linkOf("row2"));
//  A link to an empty spell would 404 — the face stays plain painted text.
check("a look-only button is no link at all", linkOf("[nil]") === "", linkOf("[nil]"));

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
