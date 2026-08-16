//  lite/test/hook/cycle.js — LITE-027: a LINK CYCLE costs its own refs, not
//  the commit.  `cyc/A.mkd` links `cyc/B.mkd` and B links A back: neither has
//  final bytes for the other to name, so BOTH refs keep the `line:col` form the
//  author typed — while A's own ref to an acyclic file, and the innocent
//  bystander `cyc/C.mkd`, mint exactly as they would in any commit.  Before
//  LITE-027 the bounded fixpoint gave up and the WHOLE commit was abandoned.
//
//  The second commit is the DAG guard: `cyc/X.mkd` names line 3 of `cyc/Y.mkd`
//  and Y's own ref line sits ABOVE it, so the offset X mints is right only if Y
//  was minted FIRST — which is what the topological order buys.
//
//  Run AFTER both real commits, so every assertion is over the COMMITTED blobs.
//  The oracle is arithmetic, as in hook.js: 16-byte lines and `git rev-parse`.
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

function top(sha, bits) { return BigInt("0x" + sha.slice(0, 16)) >> BigInt(64 - bits); }
function mint(sha, others) {
  for (let k = 2; k <= 10; k++) {
    const bits = 6 * k, h = ron.encode(top(sha, bits)).padStart(k, "0");
    let nondigit = false;
    for (const c of h) if (c < "0" || c > "9") nondigit = true;
    if (!nondigit) continue;
    let clash = false;
    for (const o of others || [])
      if (o !== sha && top(o, bits) === top(sha, bits)) clash = true;
    if (!clash) return h;
  }
  return "";
}

const FIX = io.getenv("LITE_FIX");
const B_D = io.getenv("LITE_BD"), B_Y0 = io.getenv("LITE_BY0"),
      B_Y1 = io.getenv("LITE_BY1");
const H_D = mint(B_D, []);                         // one blob of that path, ever
const P_D5 = "data/D.c:5:" + H_D;
const P_D7 = "data/D.c:7:" + H_D;
const P_D9 = "data/D.c:9:" + H_D;

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
const A = (committed("cyc/A.mkd") || "").split("\n");
const B = (committed("cyc/B.mkd") || "").split("\n");
const C = (committed("cyc/C.mkd") || "").split("\n");

//  ---- the cycle ------------------------------------------------------------
check("a ref ONTO a link cycle is left exactly as typed",
      A[1] === "link cyc/B.mkd:1 there", A[1]);
check("...and so is the ref coming back the other way",
      B[1] === "link cyc/A.mkd:1 back", B[1]);
check("a cycle member's ref to an ACYCLIC file still mints",
      A[2] === "also " + P_D7 + " fine", A[2]);
check("the BYSTANDER's ref mints — one cycle no longer abandons the commit",
      C[1] === "look " + P_D5 + " here", C[1]);

//  ---- the DAG guard: X mints against Y's FINAL bytes -----------------------
const Y = (committed("cyc/Y.mkd") || "").split("\n");
const X = (committed("cyc/X.mkd") || "").split("\n");
check("a chained target mints first", Y[1] === "yref " + P_D9 + " here", Y[1]);
//  line 3 of the COMMITTED Y — the rewrite of line 2 no longer moves a LINE
//  (BEE-019:57), but it does move Y's BLOB ID, so X still needs Y minted first.
const P_Y3 = "cyc/Y.mkd:3:" + mint(B_Y1, [B_Y0]);
w1("#    minted " + P_D5 + "  " + P_Y3 + "\n");
check("...and the ref naming it takes the hashlet of the REWRITTEN target",
      X[1] === "xref " + P_Y3 + " there", X[1]);

const at = entry.openTarget(P_Y3);
check("the chained permalink follows to line 3, not to where it used to be",
      at !== null && at[0].land && at[0].land.line === 3 &&
      at.length === 1 && at[0].uri.slice(-10) === "/cyc/Y.mkd",
      at === null ? "null" : JSON.stringify(at[0].land || null) + " " + at[0].uri);

w1((bad ? "FAIL " : "PASS ") + "[lite/hook cycle] " + n + " checks, " + bad + " bad\n");
if (bad) throw "HOOKCYCLE";
