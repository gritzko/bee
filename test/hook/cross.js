//  lite/test/hook/cross.js — BEE-014: a ref whose target lives in ANOTHER
//  REGISTERED REPO mints, and follows back.  [BEE-008]'s ladder taught the
//  minter what a code SPELLS; this is the other half — WHERE it may look.  The
//  door has fanned out over the mount table since [BEE-003] and the minter
//  never did, so every `BEE-006:gt:3Bxd` written in `///bee` (60 of them) stayed a
//  transient anchor because its page sits in `///bee-journal`.
//  Run AFTER a real `git commit` in the CARRIER repo whose staged text names
//  files in the TARGET repo: two shapes that must mint, one that must not.
"use strict";
const entry = require("door.js");        // LITE-045: the door, not the CLI

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

//  the oracle, as in ticket.js: arithmetic over 16-byte lines and `git
//  rev-parse`, so the expected permalink is stated without asking the code.
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

const CARRIER = io.getenv("LITE_CARRIER");
const B_CODE = io.getenv("LITE_BCODE"), B_PATH = io.getenv("LITE_BPATH");
//  Line 20 of a file of 16-byte lines, column 1.  The PATH IS KEPT AS WRITTEN —
//  the code stays a code, the path stays a path; only the anchor segments move.
const P_CODE = "XRT-001:" + ron64(19 * 16) + ":" + mint(B_CODE);
const P_PATH = "far/deep/note.mkd:" + ron64(19 * 16) + ":" + mint(B_PATH);

const src = utf8.Decode(io.mmap(CARRIER + "/doc/refs.mkd", "r").data());

//  ---- the mint --------------------------------------------------------------
//  The hashlet is scoped to the TARGET repo's blob history, which is the only
//  history that file has; the carrier's own is irrelevant to it.
check("a cross-repo TICKET CODE mints", src.indexOf(P_CODE) >= 0,
      (src.match(/XRT-001:[^ \n]*/) || ["(none)"])[0] + " want " + P_CODE);
check("a cross-repo PATH mints too", src.indexOf(P_PATH) >= 0,
      (src.match(/far\/deep\/note\.mkd:[^ \n]*/) || ["(none)"])[0] + " want " + P_PATH);
//  Registered is the whole permission: a repo nobody registered is not searched,
//  so its refs stay exactly as the author typed them.
check("a target no REGISTERED repo holds is left as typed",
      src.indexOf("XRT-999:3 ") >= 0, (src.match(/XRT-999:[^ \n]*/) || ["(none)"])[0]);

//  ---- the follow back -------------------------------------------------------
//  [BEE-014] ruled it: a link that mints and cannot be followed is worse than
//  one that never minted, so the round trip is the check that matters.
function at(t) { let s; try { s = entry.seatOf(t); } catch (e) { return "THROW " + e; }
                 return s === null ? "null" : s; }
const sc = at(P_CODE), sp = at(P_PATH);
check("the minted code follows back into the other repo",
      sc !== null && typeof sc === "object" && ends(sc.full || "", "/todo/XRT/XRT-001.mkd"),
      sc && (sc.full || JSON.stringify(sc)));
check("...landing on line 20", sc && sc.line === 20, sc && sc.line);
check("the minted path follows back too",
      sp !== null && typeof sp === "object" && ends(sp.full || "", "/far/deep/note.mkd"),
      sp && (sp.full || JSON.stringify(sp)));
check("...landing on line 20", sp && sp.line === 20, sp && sp.line);

w1((bad ? "FAIL" : "PASS") + " [lite/hook cross] " + n + " checks, " + bad + " bad\n");
if (bad) throw "cross: " + bad + " of " + n + " checks failed";
