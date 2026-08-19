//  bee/test/context/door.js — BEE-023: the DOOR's own leg of the `//name` axis.
//  The shell leg reads what the CLI printed; this reads what a pager click and
//  an http href go through — `mount.splitRooted`/`byName` and `door.seatOf`,
//  which no CLI invocation reaches.  Run from anywhere, with `$SRC_ROOT`,
//  `$HOME` and `$CTX_REG` (the registered repo's root) set by run.sh.
"use strict";
const mnt = require("index/mount.js");
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
const REG = io.getenv("CTX_REG"), SRC = io.getenv("SRC_ROOT");

//  ---- the spelling: a bare double slash, split on the first `/` after it -----
const sp = mnt.splitRooted("//a/b/c");
check("`//a/b/c` splits into the name and the rest",
      sp !== null && sp.name === "a" && sp.rel === "b/c", JSON.stringify(sp));
check("`//a` alone is the name with no path",
      mnt.splitRooted("//a").rel === "", JSON.stringify(mnt.splitRooted("//a")));
check("the retired `///a/b` is none of this one's business",
      mnt.splitRooted("///a/b") === null);
for (const w of ["/a/b", "a/b", "//", "//./x", "//../x", "http://h/p"])
  check("`" + w + "` is no rooted word", mnt.splitRooted(w) === null);

//  ---- the two legs, and the miss --------------------------------------------
check("$SRC_ROOT is read from the environment", mnt.srcRoot() === SRC, mnt.srcRoot());
check("the registry leg answers first", mnt.byName("regrepo") === REG, mnt.byName("regrepo"));
check("the $SRC_ROOT leg answers next", mnt.byName("loose") === SRC + "/loose",
      mnt.byName("loose"));
check("a plain directory under $SRC_ROOT is no repo", mnt.byName("nogit") === null,
      mnt.byName("nogit"));
check("an unknown name answers nothing", mnt.byName("nosuch") === null);
check("...and the refusal names both places searched",
      mnt.noRepo("nosuch") === "bee: //nosuch: no such repo (registry, " + SRC + ")",
      mnt.noRepo("nosuch"));

//  ---- the door: a click or an href on `//name/rel` lands in THAT repo --------
const s1 = door.seatOf("//regrepo/sub/s.txt");
check("seatOf lands a rooted reference on the file itself",
      s1 !== null && s1.full === REG + "/sub/s.txt", JSON.stringify(s1));
const s2 = door.seatOf("//regrepo/sub/s.txt:1");
check("...keeping its `:line` anchor", s2 !== null && s2.line === 1, JSON.stringify(s2));
check("a rooted reference to no repo resolves to nothing, and never throws",
      door.seatOf("//nosuch/x.txt") === null, JSON.stringify(door.seatOf("//nosuch/x.txt")));

//  ---- the fs leg keeps the SPELLING in the hunk it builds --------------------
const hs = door.openPath("//regrepo/r.txt");
check("openPath opens a rooted path", hs !== null && hs.length === 1);
check("...and the hunk URI is the arg verbatim", hs !== null && hs[0].uri === "//regrepo/r.txt",
      hs === null ? "null" : hs[0].uri);
check("...over the right bytes", hs !== null && utf8.Decode(hs[0].text) === "R0\n",
      hs === null ? "null" : utf8.Decode(hs[0].text));
const ht = door.openTarget("//regrepo/r.txt");
check("openTarget takes it too — the pager's own door", ht !== null && ht.length === 1);

w1((bad ? "FAIL" : "PASS") + " [bee/context] door.js " + n + " checks\n");
if (bad) throw "door.js: " + bad + " of " + n + " checks failed";
