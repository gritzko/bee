//  bee/test/mint/mint.js — BEE-016: what `bee mint <file>...` left on disk.
//  The fixture committed its refs TRANSIENT with no hook installed — the state
//  the ~75 refs of [BEE-015] are actually in — and the verb was then pointed at
//  three of the files.  Run AFTER the mint, in the fixture's own worktree.
//
//  The oracle is the line as typed plus the blob sha1's top 6k bits, exactly as
//  test/hook/*.js does it: the expected permalink is STATED, never asked for.
"use strict";
const entry = require("door.js");        // LITE-045: the door, not the CLI
const idx = require("index/index.js");

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

function top(sha, bits) { return BigInt("0x" + sha.slice(0, 16)) >> BigInt(64 - bits); }
function mint(sha) {
  for (let k = 2; k <= 10; k++) {
    const h = ron.encode(top(sha, 6 * k)).padStart(k, "0");
    for (const c of h) if (c < "0" || c > "9") return h;
  }
  return "";
}

const FIX = io.getenv("LITE_FIX"), B_A = io.getenv("LITE_BA");
function read(rel) {
  const m = io.mmap(FIX + "/" + rel, "r");
  return utf8.Decode(m.data ? m.data() : m).split("\n");
}

//  BEE-019:54: the anchor is the LINE, so `:20` and `:20:5` mint the same link.
const P_20  = "src/A.c:20:" + mint(B_A);
const P_20C = P_20;
const P_9   = "src/A.c:9:" + mint(B_A);
w1("#    minted " + P_20 + "\n");

const P = read("doc/page.mkd");

//  ---- the two that must mint ------------------------------------------------
check("a TRANSIENT ref committed long ago is upgraded in the working file",
      P[1] === "see " + P_20 + " for the anchor", P[1]);
check("...and one carrying a COLUMN mints the same link, column dropped",
      P[2] === "col " + P_20C + " with a column", P[2]);

//  ---- everything the hook refuses to guess through, the verb refuses too -----
check("a path nothing answers is left exactly as typed",
      P[3] === "gone no/such/file.c:3 resolves to nothing", P[3]);
check("...a line past the end of the target too",
      P[4] === "past src/A.c:999 is off the end", P[4]);
check("...a SELF-link, which has no final bytes to name",
      P[5] === "self doc/page.mkd:1 names this very file", P[5]);
check("...and an AMBIGUOUS path, answered by two files at once",
      P[6] === "many C.c:5 names two files at once", P[6]);

//  ---- the rule the hook has no analogue for ---------------------------------
//  src/B.c is DIRTY and was not named: the author's line:col counts working
//  lines while the only hashable bytes are HEAD's, so this is refused outright
//  rather than anchored to bytes no reader will ever see.
check("a ref into a DIRTY file the mint was not given is refused",
      P[7] === "dirt src/B.c:10 has uncommitted edits", P[7]);

//  ---- the chain: a listed file may anchor into another listed file ----------
//  y's own rewrite moves y's BLOB ID, so x's hashlet is right only if y minted
//  first — the LITE-027 sink-first order, inherited whole (BEE-019:57).
const Y = read("doc/y.mkd"), X = read("doc/x.mkd");
check("a listed file mints its own ref against the target's HEAD blob",
      Y[1] === "yref " + P_9 + " here", Y[1]);
const xref = (X[1] || "").split(" ")[1] || "";
check("...and the file naming IT mints too, against the post-mint image",
      xref !== "doc/y.mkd:3" && xref.indexOf("doc/y.mkd:3:") === 0 &&
      xref.split(":").length === 3, X[1]);

//  ---- and the minted links FOLLOW back --------------------------------------
const at = entry.openTarget(P_20);
check("the minted link follows back through the resolver",
      at !== null && at.length === 1 && ends(at[0].uri, "/src/A.c"),
      at === null ? "null" : JSON.stringify(at));
check("...landing on line 20, column 1",
      at !== null && at[0].land && at[0].land.line === 20 && at[0].land.col === 1,
      at === null ? "null" : JSON.stringify(at[0].land || null));

//  The chain's own landing: the hashlet names a blob NO COMMIT CARRIES YET, so
//  it resolves through perma.js's worktree tier until the commit lands.
const ay = entry.openTarget(xref);
check("the chained link lands on the line x meant, the mint's shift included",
      ay !== null && ay.length === 1 && ends(ay[0].uri, "doc/y.mkd") &&
      ay[0].land && ay[0].land.line === 3,
      ay === null ? "null" : JSON.stringify(ay));

//  ---- and the repository itself is untouched --------------------------------
const ctx = idx.openRepo(FIX, true);
try {
  check("HEAD still carries the transient text — mint wrote no object",
        ctx.head !== null && ctx.head.sha.length === 40, ctx.head);
} finally { idx.closeRepo(ctx); }

w1((bad ? "FAIL " : "PASS ") + "[bee/mint] " + n + " checks, " + bad + " bad\n");
if (bad) throw "MINTCHECK";
