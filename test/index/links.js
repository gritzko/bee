//  bee/test/index/links.js — BEE-007: the LINK half of the ONE bring-up, read
//  straight off the index a run left behind.  Prints `links=<n> marks=<n>` — the
//  [LITE-033] LINK rows and the reserved `hlOfText("lindex")` MARK rows — so
//  run.sh can pin that `bee index` mints them with no `lindex` run of its own,
//  and that a READ VIEW (`log`/`list`, which call `bringUp` alone) mints none.
//
//  Driven by run.sh with LITE_FIX = the repo.  The index is opened READ-ONLY, so
//  the probe brings nothing up, sweeps nothing and writes nothing.
"use strict";
const idx = require("index/index.js");
const li = require("index/lindex.js");

function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }

const repo = io.getenv("LITE_FIX");
const gitdir = repo + "/.git";
let links = 0, marks = 0;
if (!idx.fresh(gitdir)) {
  const mk = li.markKey();
  const ix = idx.openIndex(gitdir, false, true);
  try {
    const c = ix.seek(0n);
    while (c.next()) {
      if (idx.keyKind(c.key) === li.K_LINK) links++;
      if (c.key === mk) marks++;
    }
  } finally { try { ix.close(); } catch (e) {} }
}
w1("links=" + links + " marks=" + marks + "\n");
