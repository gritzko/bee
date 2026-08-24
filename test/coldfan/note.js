//  bee/test/coldfan/note.js — BEE-065:23, the line a query prints when its
//  fan-out has to WALK a repo instead of no-opping off the mark.  It is
//  tty-only (index/index.js:388:eI's law keeps captured runs byte-identical), so
//  `isatty` is stubbed true here and the caller reads the line off stderr.
"use strict";

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

const repo = io.getenv("LITE_FIX");
io.isatty = function () { return true; };        // the one gate, forced open

//  A cold lane: the walk happens, so the line is owed.
const ctx = idx.openRepo(repo, false);
const ix = idx.upForeign(ctx, "indexing " + ctx.root);
check("a cold foreign lane opens", ix !== null);
try { ix.close(); } catch (e) {}

//  The second open is the mark no-op, and a repo that walks nothing says
//  nothing: the line reports work, it is not a banner.
const ix2 = idx.upForeign(ctx, "indexing " + ctx.root);
check("the warm reopen still opens", ix2 !== null);
try { ix2.close(); } catch (e) {}
idx.closeRepo(ctx);

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
