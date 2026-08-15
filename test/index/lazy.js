//  lite/test/index/lazy.js — LITE-028: a catch-up costs the NEW work, not the
//  history.  Before this, `bringUp` read the WHOLE index (every K_BLOB/K_CMMT/
//  K_CPAR row ever written) to index a single new commit, so one `git commit`
//  in a linux-sized repo stalled the next verb for ~10 s.
//
//  The leg is driven by run.sh, which owns the git steps; one MODE per call:
//    index — bring the index up to date, quietly (no repo-list line);
//    meas  — bring it up through a COUNTING shim: `reads` is every row pulled
//            off the index, `index` is how many rows are in it;
//    check — the index's own integrity: each path's revs are exactly 0..k, and
//            no path carries two revs of one commit (a missed per-path read
//            would mint a duplicate rev 0 and show up here).
"use strict";
const idx = require("index/index.js");

const repo = io.getenv("LITE_FIX");
const mode = io.getenv("LITE_MODE") || "meas";
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }

//  Every row the index hands out, counted.  Puts and commits pass straight
//  through, so the run writes exactly what it would write unwrapped.
function counted(ix, st) {
  return {
    seek: function (k) {
      st.seeks++;
      const c = ix.seek(k);
      return { next: function () { const r = c.next(); if (r) st.reads++; return r; },
               get key() { return c.key; }, get val() { return c.val; } };
    },
    put: function (k, v) { return ix.put(k, v); },
    commit: function (d) { return ix.commit(d); },
    get mem() { return ix.mem; }
  };
}

function indexRows(ix) {
  let n = 0;
  const c = ix.seek(0n);
  while (c.next()) n++;
  return n;
}

const ctx = idx.openRepo(repo, false);
const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
try {
  if (mode === "index") {
    idx.bringUp(ctx, ix, { track: false });
  } else if (mode === "meas") {
    const st = { reads: 0, seeks: 0 };
    const t0 = Date.now();
    const rec = idx.bringUp(ctx, counted(ix, st), { track: false });
    const ms = Date.now() - t0;
    w1("commits=" + rec.commits + " reads=" + st.reads + " seeks=" + st.seeks +
       " ms=" + ms + " index=" + indexRows(ix) + "\n");
  } else {
    //  check: fold the whole index and test the two invariants the arrival
    //  state is responsible for.
    const revs = new Map(), pairs = [];
    let bad = 0, n = 0;
    const c = ix.seek(0n);
    while (c.next()) {
      const kind = idx.keyKind(c.key);
      if (kind === idx.K_BLOB) {
        const phl = idx.keyPhl(c.key), rev = idx.keyRev(c.key);
        let a = revs.get(phl);
        if (a === undefined) revs.set(phl, a = []);
        a.push(rev);
      } else if (kind === idx.K_CMMT) {
        pairs.push((idx.keyPhl(c.key) << 60n) | idx.valHl60(c.val));
      }
    }
    n++;
    let dense = true;
    for (const [phl, a] of revs) {
      a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      for (let i = 0; i < a.length; i++) if (a[i] !== BigInt(i)) { dense = false; break; }
      if (!dense) break;
    }
    if (dense) w1("ok   every path's revs are exactly 0..k, no gap and no duplicate\n");
    else { bad++; w1("FAIL a path's rev chain is not dense\n"); }
    n++;
    if (new Set(pairs.map(String)).size === pairs.length)
      w1("ok   no path carries two revs of one commit\n");
    else { bad++; w1("FAIL a path carries two revs of one commit\n"); }
    w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
  }
} finally { try { ix.close(); } catch (e) {} idx.closeRepo(ctx); }
