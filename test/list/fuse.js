//  lite/test/list/fuse.js — LITE-017, be/test/list/fuse.js ported.  be's repro
//  was LIST-001: a `list` that only listed the worktree, like `ls`, drops the
//  per-entry commit context.  The fuse is what makes it a browser:
//
//    RED  (no fuse): entries carry no last-commit summary and no age; a dir
//                    gets none at all.
//    GREEN (fused):  each FILE -> its newest commit's summary + ts; each DIR ->
//                    the newest commit touching anything UNDER it; relAge
//                    renders a short `Nh`/`Nd`/`Ny`; the row spans carry the wt
//                    marker slot, a hidden `U` name click-target and a grey
//                    summary.
//
//  be attributes both halves from ONE bounded first-touch walk (its
//  shared/lastcommit.js).  lite uses its OWN machinery instead: a FILE is one
//  LITE-006 lane prefix scan (exact, no walk at all), a DIR is the index/log.js
//  CPAR ancestry — which IS O(history), so it is capped LITE-013-style, and the
//  last check here is that cap doing its job, exactly as be's `cap=1` leg did.
//
//  `LITE_FIX` names the fixture repo, `LITE_TIP` its tip.
"use strict";
const ls = require("index/list.js");
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
function tag(w) { return String.fromCharCode(65 + ((w >>> 27) & 0x1f)); }
function end(w) { return w & 0xffffff; }

const repo = io.getenv("LITE_FIX");
const TIP = io.getenv("LITE_TIP");

//  --- the attribution ------------------------------------------------------
//  The fixture's own epochs, a day apart: C0 1700000000, C1 +1d, C2 +2d.
const DAY = 86400, E = 1700000000;
const out = ls.list(undefined, { from: repo });
const by = {};
for (const r of out.rows) by[r.label] = r;

check("every entry is a row", by["a.txt"] && by["b.txt"] && by["sub/"] && by["old/"],
      Object.keys(by).join(" "));
check("a.txt is attributed its seed commit C0",
      by["a.txt"].summary === "C0 seed a and sub", by["a.txt"].summary);
check("b.txt is attributed its add commit C1",
      by["b.txt"].summary === "C1 add b", by["b.txt"].summary);
//  THE DIR REPRO: sub/ = the NEWEST commit touching anything beneath it (C2),
//  NOT its own seed (C0).  A no-fuse listing would give sub/ nothing.
check("LIST-001: dir sub/ = the newest commit UNDER it (C2), not its seed",
      by["sub/"].summary === "C2 edit sub", by["sub/"].summary);
check("dir old/ = C0, the only commit that ever touched it",
      by["old/"].summary === "C0 seed a and sub", by["old/"].summary);
check("a row carries its rel-age", /^[0-9]+[smhdy]$/.test(by["a.txt"].age), by["a.txt"].age);

//  The markers: the uncommitted edit, the clean file, the deleted one, the dirs.
check("the uncommitted edit reads `mod`", by["a.txt"].marker === "mod", by["a.txt"].marker);
check("the clean file reads `eq`", by["b.txt"].marker === "eq", by["b.txt"].marker);
check("a tracked file gone from the worktree reads `del`",
      by["gone.txt"].marker === "del", by["gone.txt"].marker);
check("a dir reads a flat `dir`", by["sub/"].marker === "dir", by["sub/"].marker);

//  ts ordering: a.txt(C0) < b.txt(C1) < sub(C2) — the raw attribution, read
//  through the two halves of the fuse directly.
const ctx = idx.openRepo(repo, true);
let files, dirs, capped;
try {
  const ix = idx.openIndex(ctx.gitdir);
  try {
    idx.bringUp(ctx, ix, { track: false });
    files = ls.fileCommits(ix, ctx.r, "", ["a.txt", "b.txt", "gone.txt"]);
    dirs = ls.dirCommits(ix, ctx.r, idx.hlOfSha(TIP), "", ["sub", "old"], 512);
    //  be's ceiling leg: a cap of ONE walks only the tip commit (C2), so the
    //  dir it touched is attributed and the untouched one stays blank.
    capped = ls.dirCommits(ix, ctx.r, idx.hlOfSha(TIP), "", ["sub", "old"], 1);
  } finally { try { ix.close(); } catch (e) {} }
} finally { idx.closeRepo(ctx); }

check("the file half attributes off ONE lane prefix scan",
      files["a.txt"].ts === E && files["b.txt"].ts === E + DAY,
      files["a.txt"].ts + " " + files["b.txt"].ts);
check("the dir half attributes off the CPAR ancestry",
      dirs["sub"].ts === E + 2 * DAY && dirs["old"].ts === E,
      dirs["sub"].ts + " " + dirs["old"].ts);
check("attributed ts increase C0 < C1 < C2",
      files["a.txt"].ts < files["b.txt"].ts && files["b.txt"].ts < dirs["sub"].ts);
check("LITE-013: the cap attributes the dir the tip touched",
      capped["sub"] !== undefined && capped["sub"].summary === "C2 edit sub",
      capped["sub"]);
check("LITE-013: and leaves an entry beyond the ceiling blank",
      capped["old"] === undefined, capped["old"]);
check("a blank attribution costs the row neither summary nor age",
      ls.rowsOf({ root: repo }, "", [{ name: "old", dir: true, marker: "dir" }], capped, E)[0].age === "");

//  --- relAge, be view/render.js's own boundaries ---------------------------
function ageOf(delta) { return rd.relAge(E, E + delta); }
check("relAge: ts 0 -> blank", rd.relAge(0, E) === "", rd.relAge(0, E));
check("relAge: 30s", ageOf(30) === "30s", ageOf(30));
check("relAge: 90s -> 1m", ageOf(90) === "1m", ageOf(90));
check("relAge: 3h", ageOf(3 * 3600) === "3h", ageOf(3 * 3600));
check("relAge: 2d", ageOf(2 * DAY) === "2d", ageOf(2 * DAY));
check("relAge: over a year -> 1y", ageOf(400 * DAY) === "1y", ageOf(400 * DAY));
check("relAge: a clock skew into the future reads 0s", rd.relAge(E, E - 60) === "0s",
      rd.relAge(E, E - 60));

//  --- the fused ROW: the marker slot, the U target, the grey summary -------
const h = out.hunks[0];
check("one hunk for one listing", out.hunks.length === 1, out.hunks.length);
check("hunk-shape", h.verb === "hunk" && h.kind === "list", h.verb + " " + h.kind);
check("hunk-banners-the-verb", h.uri === "list", h.uri);

const tags = [];
for (let i = 0; i < h.toks.length; i++) tags.push(tag(h.toks[i]));
check("the row carries the wt marker palette slot (E = mod)", tags.indexOf("E") >= 0, tags.join(""));
check("the row carries the F name token", tags.indexOf("F") >= 0);
check("the row carries a hidden U name click-target", tags.indexOf("U") >= 0);
check("the row carries the grey D summary slot", tags.indexOf("D") >= 0);
check("the row carries the L age slot", tags.indexOf("L") >= 0);

//  The visible bytes (U hidden) reconstruct the plain block exactly.
const vis = [];
{
  let ti = 0, pos = 0;
  while (pos < h.text.length) {
    while (ti < h.toks.length && end(h.toks[ti]) <= pos) ti++;
    if (ti < h.toks.length && tag(h.toks[ti]) === "U") { pos++; continue; }
    vis.push(h.text[pos]); pos++;
  }
}
check("the visible bytes ARE the plain block",
      utf8.Decode(new Uint8Array(vis)) === utf8.Decode(out.plain),
      utf8.Decode(new Uint8Array(vis)));

//  The U targets: a dir stays in the browser, a file opens in cat.
const targets = {};
for (let i = 1; i < h.toks.length; i++) {
  if (tag(h.toks[i]) !== "U") continue;
  const lo = end(h.toks[i - 1]), hi = end(h.toks[i]);
  const vlo = i >= 2 ? end(h.toks[i - 2]) : 0;
  targets[utf8.Decode(h.text.slice(vlo, lo)).trim()] = utf8.Decode(h.text.slice(lo, hi));
}
check("a dir row opens as a list (stay in the browser)",
      /^list .*\/sub\/$/.test(targets["sub/"] || ""), targets["sub/"]);
check("a file row opens in cat", /^cat .*\/a\.txt$/.test(targets["a.txt"] || ""), targets["a.txt"]);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
