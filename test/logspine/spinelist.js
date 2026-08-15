//  lite/test/logspine/spinelist.js — LITE-020: print the sha8 of every row the
//  bare `lite log` marked ON-SPINE, one per line.  run.sh sorts it and cmps it
//  against `git log --first-parent`, so the ord-0 chain is pinned by GIT and
//  not only by our own expectation of the fixture.
"use strict";
const lg = require("view/log.js");
const out = lg.log(undefined, { from: io.getenv("LITE_FIX") });
let s = "";
for (const p of out.parts) if (!p.nonspine) s += p.sha8 + "\n";
const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x);
