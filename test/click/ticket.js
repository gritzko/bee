//  bee/test/click/ticket.js — BEE-008: a TICKET CODE is a click target.
//  dog/tok/LINK.rl:83 fuses `TKT-001` into an `F` token exactly as it fuses a
//  filename, and the door resolved that token AS a filename — which never hit,
//  because no file is NAMED `TKT-001`.  This leg pins the STEM scan that fixes
//  it: the spellings [/meta/todo] fixes, in preference order, through the SAME
//  `door.seatOf` a pager click and an http href both ride.
//
//  The negatives are LINK.rl's `keyvoid` in the positive: a shape that is no
//  ticket code must resolve exactly as it did before, i.e. not at all.
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

//  ---- the shape test --------------------------------------------------------
check("a code is two letters, a dash and two digits",
      entry.ticketCode("TKT-001") === "TKT-001", entry.ticketCode("TKT-001"));
check("...digits and underscores after the two letters",
      entry.ticketCode("AB_C1-007") === "AB_C1-007", entry.ticketCode("AB_C1-007"));
check("a one-letter head is no code", entry.ticketCode("C-12") === null);
check("a one-digit tail is no code", entry.ticketCode("GPL-2") === null);
check("a version tail is no code", entry.ticketCode("GPL-2.0") === null);
check("a second dashed group is no code", entry.ticketCode("ISO-8859-1") === null);
check("a lettered tail is no code", entry.ticketCode("KEY-12abc") === null);
check("a digit before the dash is no code", entry.ticketCode("AB12-34CD") === null);
check("a code HEADING a path is a path (LINK.rl `keyed`)",
      entry.ticketCode("TKT-005/notes.mkd") === null);
check("the spellings are the six [/meta/todo] fixes, in order",
      entry.ticketPaths("TKT-001").join(" ") ===
        "TKT-001 TKT-001.mkd TKT-001.md TKT-001.txt TKT-001/README.mkd TKT-001/README.md",
      entry.ticketPaths("TKT-001").join(" "));
check("a non-code ref spells only itself",
      entry.refSpellings("a/b.c").join(" ") === "a/b.c");

//  ---- the scan, through the door -------------------------------------------
check("a THIN ticket opens its .mkd", ends(at("TKT-001"), "/todo/TKT/TKT-001.mkd"),
      at("TKT-001"));
check("...a .md one its .md", ends(at("TKT-002"), "/todo/TKT/TKT-002.md"), at("TKT-002"));
check("...a .txt one its .txt", ends(at("TKT-003"), "/todo/TKT/TKT-003.txt"), at("TKT-003"));
check("a FAT ticket opens its README.mkd",
      ends(at("TKT-005"), "/todo/TKT/TKT-005/README.mkd"), at("TKT-005"));
check("...and a README.md one its README.md",
      ends(at("TKT-009"), "/todo/TKT/TKT-009/README.md"), at("TKT-009"));

//  Preference order, not a union: both spellings exist and ONE page answers —
//  the extension list must never land a reader in the chooser.
check("the bare code beats every extension",
      ends(at("TKT-004"), "/todo/TKT/TKT-004"), at("TKT-004"));
check("...and .mkd beats .md", ends(at("TKT-006"), "/todo/TKT/TKT-006.mkd"),
      at("TKT-006"));

//  A tie WITHIN one spelling is a genuine ambiguity and still reaches the chooser.
const many = seat("TKT-007");
check("two files of the SAME spelling are the chooser",
      many !== null && many.rels !== undefined && many.rels.length === 2,
      many === null ? "null" : JSON.stringify(many));
check("...under the code AS TYPED", many !== null && many.arg === "TKT-007",
      many === null ? "null" : many.arg);

//  The anchor rides: `door.splitRef` sheds it before the stem scan ever runs.
const anch = seat("TKT-001:5");
check("an anchored code lands on its line",
      anch !== null && anch.line === 5 && ends(anch.full, "/todo/TKT/TKT-001.mkd"),
      anch === null ? "null" : anch.full + ":" + anch.line);

//  A code that HEADS a path was always a path and stays one.
check("a code heading a path resolves as that path",
      ends(at("TKT-005/notes.mkd"), "/todo/TKT/TKT-005/notes.mkd"), at("TKT-005/notes.mkd"));

//  The negatives: nothing that is not a code gained a resolution.
check("a code no repo carries is a miss", seat("TKT-999") === null, at("TKT-999"));
check("a version string is a miss", seat("GPL-2.0") === null, at("GPL-2.0"));
check("a charset name is a miss", seat("ISO-8859-1") === null, at("ISO-8859-1"));

//  ...and the file the code names really is opened, bytes and all.
const hs = entry.openTarget("TKT-005");
check("the fat ticket's README is what opens",
      hs !== null && hs.length === 1 &&
      utf8.Decode(hs[0].text).indexOf("FATMARK") >= 0,
      hs === null ? "null" : hs[0].uri);

w1((bad ? "FAIL " : "PASS ") + "[bee/ticket] " + n + " checks, " + bad + " bad\n");
if (bad) throw "TICKET";
