//  lite/test/hook/first.js — LITE-026: the VERY FIRST commit mints too.
//  A repo with no commits has no HEAD to index and no blob history to extend a
//  hashlet against — but every path in it is STAGED, so the staged set alone
//  answers every ref and the root commit lands with the permalink form in it.
//  Run AFTER a real `git commit` on a repo whose only commit is this one, so
//  the assertions are over the ROOT commit's own blobs.
"use strict";
const entry = require("main.js");
const idx = require("index/index.js");
const rd = require("index/read.js");

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

//  the oracle, as in hook.js: arithmetic over 16-byte lines and `git rev-parse`.
function ron64(v) { const s = ron.encode(BigInt(v)); return s === "" ? "0" : s; }
function pair(hex3) { return ron.encode(BigInt(parseInt(hex3, 16))).padStart(2, "0"); }
function mint(sha) {
  for (let pairs = 2; pairs <= 5; pairs++) {
    let h = "";
    for (let i = 0; i < pairs; i++) h += pair(sha.slice(i * 3, i * 3 + 3));
    for (const c of h) if (c < "0" || c > "9") return h;
  }
  return "";
}

const FIX = io.getenv("LITE_FIX"), B_A = io.getenv("LITE_BA");
//  `src/A.c:5` is line 5 column 1 of a file of 16-byte lines.
const P_A5 = "src/A.c:" + ron64(4 * 16) + ":" + mint(B_A);
w1("#    minted " + P_A5 + "\n");

function committed(rel) {
  const ctx = idx.openRepo(FIX, true);
  try {
    const m = idx.readCommit(ctx.r, ctx.head.sha);
    const e = rd.entryAt(ctx.r, m.tree, rel);
    if (e === null || e.dir) return null;
    const o = idx.object(ctx.r, e.sha);
    return o === null || o.type !== "blob" ? null : utf8.Decode(o.bytes);
  } finally { idx.closeRepo(ctx); }
}
const N = (committed("n.mkd") || "").split("\n");

check("the ROOT commit carries the permalink — the staged set answered it",
      N[0] === "see " + P_A5 + " here", N[0]);
check("...a SELF-link is still left exactly as typed",
      N[1] === "self n.mkd:1 stays", N[1]);
check("...and a path nothing answers too", N[2] === "gone no/such.c:2 nothing", N[2]);
//  the hashlet degenerates to the minimum: one blob in scope, nothing to extend
//  against, so four characters name it.
check("one blob in scope mints the SHORTEST hashlet", mint(B_A).length === 4, mint(B_A));

//  and now that the root commit exists, the LITE-025 resolver has a history to
//  walk: the minted link follows to the line the author meant.
const at = entry.openTarget(P_A5);
check("the minted link follows back through the resolver",
      at !== null && at.length === 1 && ends(at[0].uri, "/src/A.c"),
      at === null ? "null" : at[0].uri);
check("...landing on line 5, column 1",
      at !== null && at.land && at.land.line === 5 && at.land.col === 1,
      at === null ? "null" : JSON.stringify(at.land || null));

w1((bad ? "FAIL " : "PASS ") + "[lite/hook first] " + n + " checks, " + bad + " bad\n");
if (bad) throw "HOOKFIRST";
