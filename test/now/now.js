//  lite/test/now/now.js — LITE-019, the CONVERTER leg, headless over main.js's
//  own `ron60ISO` / `ron60Text`.  Every expectation is hand-computed from the
//  RONOfTime layout `[y/10][y%10][mon][dd/10][dd%10][hh][mm][ss][ms/64][ms%64]`
//  over the RON64 alphabet `0-9 A-Z _ a-z ~` (A=10, N=23, Q=26, _=36, a=37,
//  w=59, x=60, ~=63) — never with the code under test:
//
//    26814AoQDh -> 2026 / 8 / 14, 10:51:26, 13*64+44 = 876 ms
//    26812      -> a SHORT word is LEFT-aligned (ron60Norm): 2681200000
//    26812000F~ -> 15*64+63 = 1023 ms, past the second: CLAMPED to .999 rather
//                  than refused — real rows carry those, RONToTime clamps too.
//
//  RED before the verb: main.js exported no converter at all.
"use strict";
const m = require("main.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
function iso(w) { try { return m.ron60ISO(w); } catch (e) { return "THREW " + String(e); } }
function refusal(w) {
  try { m.ron60ISO(w); } catch (e) { return String(e); }
  return null;
}

//  --- the fixed fixtures ---------------------------------------------------
const FIXED = [
  ["26814AoQDh", "2026-08-14T10:51:26.876"],   //  every field non-trivial
  ["2681200000", "2026-08-12T00:00:00.000"],   //  the zero tail, spelled out
  ["10C31Nww~~", "2010-12-31T23:59:59.999"],   //  every field at its ceiling
  ["9911000000", "2099-01-10T00:00:00.000"]    //  the last year of the domain
];
for (const f of FIXED)
  check("fixture " + f[0] + " -> " + f[1], iso(f[0]) === f[1], iso(f[0]));

//  --- the SHORT word: left-aligned, ron60Norm semantics --------------------
check("a short word reads left-aligned (26812 == 2681200000)",
      iso("26812") === iso("2681200000"), iso("26812"));
check("...and that IS its date", iso("26812") === "2026-08-12T00:00:00.000", iso("26812"));
//  A DENORMALIZED stamp (ron60DeNorm strips the trailing zero digits) is the
//  everyday short word, and it must read back as the stamp it came from.
check("a denormalized stamp reads back whole (26814Ao == 26814Ao000)",
      iso("26814Ao") === "2026-08-14T10:51:00.000", iso("26814Ao"));

//  --- the ms slot: past the second is VALID and clamps ---------------------
check("ms past the second clamps to .999, never refused",
      iso("26812000F~") === "2026-08-12T00:00:00.999", iso("26812000F~"));
check("...the largest spelling too (~~ = 4095 ms)",
      iso("26812000~~") === "2026-08-12T00:00:00.999", iso("26812000~~"));

//  --- the refusals, in plain words -----------------------------------------
const CASES = [
  ["a non-RON64 char", "26-12"],
  ["a non-RON64 char (dot)", "26.8"],
  ["an eleven-digit word", "26814AoQDh0"],
  ["an empty word", ""],
  ["a year digit that is not decimal", "a1"],
  ["month 13", "26D1400000"],
  ["month 0 (a word too short to carry one)", "26"],
  ["day 32", "26832"],
  ["day 0", "26800"],
  ["hour 24", "26814O0000"],
  ["minute 60", "268140x000"],
  ["second 60", "2681400x00"],
  ["a word that is a word", "hello"]
];
for (const c of CASES) {
  const e = refusal(c[1]);
  check("refused: " + c[0], e !== null && e.indexOf("not a ron60 timestamp") >= 0, e);
}

//  --- the CURRENT stamp: ten digits, and a decode/encode roundtrip ---------
const now = m.ron60Text(ron.now());
check("the current stamp is ten RON64 digits", /^[0-9A-Z_a-z~]{10}$/.test(now), now);
check("it survives decode -> encode", ron.encode(ron.decode(now)).padStart(10, "0") === now, now);
//  Its own conversion must name TODAY — ron.now() and Date share the wall
//  clock, so only a midnight crossing between the two calls can differ.
const d = new Date();
const want = String(d.getFullYear()) + "-" +
             String(d.getMonth() + 1).padStart(2, "0") + "-" +
             String(d.getDate()).padStart(2, "0");
check("and it converts back to TODAY", iso(now).slice(0, 10) === want, iso(now) + " want " + want);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
