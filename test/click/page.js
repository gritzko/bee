//  bee/test/click/page.js — BEE-013: a POCKET PAGE is a click target.
//  dog/tok/LINK.rl `wikied` (DOG-042) fuses `[/wiki/Bro]` into an 'F' token,
//  and the door resolved that token as a literal root-anchored path — which
//  never hit, because no file is NAMED `wiki/Bro`.  [/meta/wiki] rules that a
//  page is linked bare, so the name carries no extension exactly as a ticket
//  code carries none; this leg pins the SAME six spellings on the path, and
//  pins that the leading slash does NOT mean "at the repo root".
//
//  The negatives are the shapes that must go on resolving as they did: a plain
//  relative path spells only itself, and a ticket code keeps its own ladder.
"use strict";
const entry = require("door.js");

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
function seat(t) { try { return entry.seatOf(t); } catch (e) { return "THROW " + e; } }
function at(t) { const s = seat(t); return s === null ? "null" : (s.full || s.arg || String(s)); }

//  ---- the spellings ---------------------------------------------------------
check("a page takes the six [/meta/todo] spellings, slash dropped",
      entry.pagePaths("/wiki/Bro").join(" ") ===
        "wiki/Bro wiki/Bro.mkd wiki/Bro.md wiki/Bro.txt wiki/Bro/README.mkd wiki/Bro/README.md",
      entry.pagePaths("/wiki/Bro").join(" "));
check("refSpellings reads the slash, in ONE place",
      entry.refSpellings("/wiki/Bro").join(" ") === entry.pagePaths("/wiki/Bro").join(" "),
      entry.refSpellings("/wiki/Bro").join(" "));
check("a plain relative path still spells only itself",
      entry.refSpellings("a/b.c").join(" ") === "a/b.c");
check("a ticket code still takes the ticket ladder",
      entry.refSpellings("TKT-001").join(" ") === entry.ticketPaths("TKT-001").join(" "));

//  ---- the scan, through the door -------------------------------------------
check("a THIN page opens its .mkd", ends(at("/wiki/Bro"), "/wiki/Bro.mkd"), at("/wiki/Bro"));
check("...a .md one its .md", ends(at("/wiki/Nav"), "/wiki/Nav.md"), at("/wiki/Nav"));
check("a FAT page opens its README.mkd",
      ends(at("/wiki/Fat"), "/wiki/Fat/README.mkd"), at("/wiki/Fat"));
check("...and .mkd beats .md", ends(at("/wiki/Both"), "/wiki/Both.mkd"), at("/wiki/Both"));
check("another pocket resolves the same way",
      ends(at("/meta/todo"), "/meta/todo.mkd"), at("/meta/todo"));

//  The ruling that earns this leg its name: a leading slash LIKELY means that
//  repo's root, but nothing assumes it — the SEGMENTS are what is looked up.
check("a page nowhere near the root still answers",
      ends(at("/wiki/Deep"), "/docs/wiki/Deep.mkd"), at("/wiki/Deep"));

//  ---- peeling the head (BEE-013 ruling 2) ------------------------------------
//  We do not know what counts as a root in any context — projects, public_html
//  dirs, submodules — so a head segment that names nothing is dropped and the
//  TAIL is looked up, down to two segments and no further.
check("a head that names nothing is peeled off",
      ends(at("/nosuchhead/wiki/Deep"), "/docs/wiki/Deep.mkd"), at("/nosuchhead/wiki/Deep"));
//  A RELATIVE ref peels too, but it is no pocket page, so it brings no
//  spelling ladder — it must name the file it wants.
check("...and a relative ref peels too, spelling its own name",
      ends(at("nosuchhead/wiki/Deep.mkd"), "/docs/wiki/Deep.mkd"),
      at("nosuchhead/wiki/Deep.mkd"));
check("...while an ext-less relative ref gets no page ladder",
      at("nosuchhead/wiki/Deep") === "null", at("nosuchhead/wiki/Deep"));
check("a bare basename is too weak to peel down to",
      at("nowhere/Bro.mkd") === "null", at("nowhere/Bro.mkd"));

//  ---- the misses ------------------------------------------------------------
check("a page no repo carries is a miss", at("/wiki/Nope") === "null", at("/wiki/Nope"));
check("a spelled-out page opens too", ends(at("/wiki/Bro.mkd"), "/wiki/Bro.mkd"),
      at("/wiki/Bro.mkd"));

w1((bad ? "FAIL" : "PASS") + " [bee/page] " + n + " checks, " + bad + " bad\n");
if (bad) throw "page: " + bad + " of " + n + " checks failed";
