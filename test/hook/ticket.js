//  lite/test/hook/ticket.js — BEE-014: a TICKET CODE is a mintable ref.
//  [BEE-008] made a code a STEM for the DOOR — `TKT-001` is `TKT-001.mkd` with
//  the ext dropped — but the LITE-026 minter resolved its own targets and never
//  learned that ladder, so every `TKT-123:42` stayed a transient `:line` anchor
//  through every commit, silently.  Run AFTER a real `git commit` whose staged
//  text carried four code shapes: two that must mint, two that must not.
"use strict";
const entry = require("door.js");        // LITE-045: the door, not the CLI
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

//  the oracle, as in hook.js/first.js: the line as typed, and the sha1's top 6k
//  bits, so the expected permalink is stated without asking the code.
function top(sha, bits) { return BigInt("0x" + sha.slice(0, 16)) >> BigInt(64 - bits); }
function mint(sha) {
  for (let k = 2; k <= 10; k++) {
    const h = ron.encode(top(sha, 6 * k)).padStart(k, "0");
    for (const c of h) if (c < "0" || c > "9") return h;
  }
  return "";
}

const FIX = io.getenv("LITE_FIX");
const B_TKT = io.getenv("LITE_BTKT"), B_FAT = io.getenv("LITE_BFAT");
//  Line 20.  The PATH IS KEPT AS WRITTEN: the code stays a code, only the
//  anchor segments change.
const P_TKT = "TKT-001:20:" + mint(B_TKT);
const P_FAT = "TKT-005:20:" + mint(B_FAT);
w1("#    minted " + P_TKT + " and " + P_FAT + "\n");

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
const R = (committed("doc/refs.mkd") || "").split("\n");

//  ---- the two that must mint ------------------------------------------------
check("a THIN ticket code mints, through its .mkd",
      R[1] === "see " + P_TKT + " for the thin one", R[1]);
check("...and a FAT one through its README.mkd",
      R[2] === "fat " + P_FAT + " through its README", R[2]);

//  ---- the two the hook must never guess through -----------------------------
check("an AMBIGUOUS code is left exactly as typed",
      R[3] === "many TKT-007:1 names two at once", R[3]);
check("...and a code no repo holds too",
      R[4] === "gone TKT-999:3 no repo holds", R[4]);

//  ---- and the minted link follows back --------------------------------------
const at = entry.openTarget(P_TKT);
check("the minted code follows back through the resolver",
      at !== null && at.length === 1 && ends(at[0].uri, "/todo/TKT/TKT-001.mkd"),
      at === null ? "null" : at[0].uri);
check("...landing on line 20, column 1",
      at !== null && at[0].land && at[0].land.line === 20 && at[0].land.col === 1,
      at === null ? "null" : JSON.stringify(at[0].land || null));

w1((bad ? "FAIL " : "PASS ") + "[lite/hook ticket] " + n + " checks, " + bad + " bad\n");
if (bad) throw "HOOKTICKET";
