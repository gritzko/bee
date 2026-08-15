//  lite/test/chat/name.js — LITE-022, the NAME leg: `chat.js`'s pageName,
//  the map from a session log's basename to its page name.  Every expectation
//  below is hand-computed (python3 hashlib + the RON64 table), never asked of
//  the code under test:
//
//    name(b) = the top 60 bits of sha1(b), as TEN RON64 digits, msb first.
//
//  RON64 is `0-9 A-Z _ a-z ~` (abc/RON.c RON64_CHARS): 0..9 = '0'..'9',
//  10..35 = 'A'..'Z', 36 = '_', 37..62 = 'a'..'z', 63 = '~'.  The top 60 bits
//  are the first 8 sha1 bytes big-endian, shifted right by 4 — dog/WHIFF.h's
//  hashlet60, the same digest index/index.js already names paths with.
//
//    d12979f3-336b-4666-88b1-d7e6765c817e  sha1 59ab785a31b12dd1..
//        -> 0x59ab785a31b12dd -> MQitMZ6mBT
//    pad-152                               sha1 03c472fc7e88d93c..
//        -> 0x03c472fc7e88d93 -> 0xHn~7v8rJ   (a LEADING zero digit)
//
//  RED before the verb: chat.js named a page by its raw basename.
"use strict";
const chat = require("chat.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

//  --- the pinned map --------------------------------------------------------
//  A real session UUID, the all-zero-ish UUID (its version/variant nibbles are
//  the ONLY non-zero bits — a raw truncation would name it `00000000-0`), the
//  fixture basenames the shell legs expect, both leading-zero cases, the empty
//  string and a non-ASCII name (the digest is over UTF-8 BYTES).
const PIN = [
  ["d12979f3-336b-4666-88b1-d7e6765c817e", "MQitMZ6mBT"],
  ["00000000-0000-4000-8000-000000000000", "DuPUMCaze0"],
  ["sess-one", "c5WgO4DAxQ"],
  ["sess-two", "MB05JVWDBe"],
  ["grow",     "mxNNMO5~rr"],
  ["noisy",    "uN3aTzq82l"],
  ["sess",     "XhzDlVrnFU"],
  ["notes",    "EiqwaX8GBn"],
  ["pad-152",  "0xHn~7v8rJ"],
  ["pad-532",  "00qwTlxYIQ"],
  ["",         "rZbZwaugIl"],
  ["é",   "kmMzSNg1h8"],
];
for (const [base, want] of PIN) {
  const got = chat.pageName(base);
  check("name(" + JSON.stringify(base) + ") = " + want, got === want, got);
}

//  --- the properties the naming rests on ------------------------------------
const RON64 = /^[0-9A-Za-z_~]{10}$/;
let widthBad = 0;
for (const [base] of PIN) if (!RON64.test(chat.pageName(base))) widthBad++;
check("every name is TEN RON64 digits", widthBad === 0, widthBad);

//  PURE: the same basename names the same page, always — this is what makes the
//  verb reentrant with no state anywhere.
check("the name is stable across calls",
      chat.pageName("d12979f3-336b-4666-88b1-d7e6765c817e") ===
      chat.pageName("d12979f3-336b-4666-88b1-d7e6765c817e"));

//  HASHED, not truncated: two UUIDs sharing their first 10 chars must not share
//  a page (a raw truncation would collide here, and on the version nibble too).
const near = ["d12979f3-3000-4000-8000-000000000000",
              "d12979f3-3111-4111-8111-111111111111"];
check("UUIDs with a common 10-char prefix get DIFFERENT names",
      chat.pageName(near[0]) !== chat.pageName(near[1]),
      chat.pageName(near[0]) + " " + chat.pageName(near[1]));
check("neither name is the raw UUID prefix",
      chat.pageName(near[0]) !== "d12979f3-3" && chat.pageName(near[1]) !== "d12979f3-3");

//  It is the RON60 codec's own inverse: decoding the ten digits gives back a
//  60-bit value, so the names live in exactly the ruled space.
const v = ron.decode(chat.pageName("d12979f3-336b-4666-88b1-d7e6765c817e"));
check("the name decodes to a 60-bit ron60", v < (1n << 60n) && v === 0x59ab785a31b12ddn, v);

//  --- the digest is the ONLY thing that varies ------------------------------
//  One flipped character changes the name (no accidental prefix folding).
check("one changed character changes the name",
      chat.pageName("sess-one") !== chat.pageName("sess-onf"));

if (bad) { w1("FAIL [chat/name] " + bad + " of " + n + " checks failed\n"); throw "name.js"; }
w1("ok   [chat/name] " + n + " checks\n");
