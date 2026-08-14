//  lite/test/logspine/spine.js — LITE-020: `lite log` marks the STRAIGHT CHAIN.
//  The spine is the first-parent (CPAR ord-0) chain from the walked tip, taken
//  over the rows the LITE-013 walk ALREADY collected; every other row — a
//  commit reachable only through a merge's 2nd+ parent — renders GREY, whole
//  row, under be's own `TAG_Q` (LOG-001, be/views/log/log.js:175).
//
//  Ported from be/test/log/nonspine.js: the same four claims (the spine rows
//  are present and NOT grey, the side rows are present and ARE grey, the grey
//  row carries TAG_Q, a spine row carries none), driven through lite's own
//  index instead of be's keeper pack.
//
//  `LITE_FIX` = the merge fixture, `LITE_FIX_LIN` = the linear one, `LITE_EXP`
//  = "c0=<sha> c1=<sha> s1=<sha> s2=<sha> m=<sha> c2=<sha>".
"use strict";
const lg = require("index/log.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got).replace(/\n/g, "\\n") + "\n");
}

const repo = io.getenv("LITE_FIX"), lin = io.getenv("LITE_FIX_LIN");
const E = {};
for (const kv of (io.getenv("LITE_EXP") || "").split(" ")) {
  const i = kv.indexOf("=");
  if (i > 0) E[kv.slice(0, i)] = kv.slice(i + 1).slice(0, 8);
}

//  A log's rows as "<sha8>:<spine|GREY>", in the order they render.
function marks(out) {
  return out.parts.map(function (p) {
    return p.sha8 + ":" + (p.nonspine ? "GREY" : "spine");
  }).join(" ");
}
//  The tag letters of a hunk's tok32 stream, "LUGLGSDS" per spine row.
function tags(h) {
  let s = "";
  for (let i = 0; i < h.toks.length; i++)
    s += String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f));
  return s;
}
//  The VISIBLE bytes of a hunk — every span but the hidden `U` nav targets.
//  This is what "greying is paint, not text" means: it must equal the plain
//  rows whether the rows are grey or not.
function visible(h) {
  let vis = "", at = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const end = h.toks[i] & 0xffffff;
    if (String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f)) !== "U")
      vis += utf8.Decode(h.text.slice(at, end));
    at = end;
  }
  return vis;
}

//  ---- 1) a LINEAR history is ALL spine -----------------------------------
const L = lg.log(undefined, { from: lin });
const LH = lg.hunk(L.uri, L.parts);
check("linear-history-has-three-rows", L.rows.length === 3, L.rows.length);
check("linear-history-greys-nothing",
      L.parts.every(function (p) { return p.nonspine === false; }), marks(L));
check("linear-history-carries-no-Q-tag", tags(LH).indexOf("Q") < 0, tags(LH));
check("linear-tags-are-the-per-column-palette",
      tags(LH) === "LUGLGSDS".repeat(3), tags(LH));

//  ---- 2) a MERGE: the side chain greys, the spine does not ---------------
//  c2 -> M -> c1 -> c0 is the first-parent line; s2, s1 hang off M's 2nd
//  parent.  Display ORDER is the LITE-013 date order, untouched.
const M = lg.log(undefined, { from: repo });
const MH = lg.hunk(M.uri, M.parts);
const want = E.c2 + ":spine " + E.m + ":spine " + E.s2 + ":GREY " +
             E.s1 + ":GREY " + E.c1 + ":spine " + E.c0 + ":spine";
check("merge-history-spine-and-side-marks", marks(M) === want, marks(M));
//  Spine continuity THROUGH the merge: c0 sits below it and stays on-spine.
const at = function (s) { for (const p of M.parts) if (p.sha8 === s) return p; return null; };
check("the-merge-itself-is-on-spine", at(E.m) && at(E.m).nonspine === false);
check("the-base-below-the-merge-stays-on-spine",
      at(E.c0) && at(E.c0).nonspine === false);
check("LITE-020-the-merged-in-side-chain-is-grey",
      at(E.s1).nonspine === true && at(E.s2).nonspine === true);
//  The grey row is covered WHOLE by Q — the same eight spans, one tag.  The
//  hidden `U` click-target and the trailing "\n" under `S` are untouched.
check("a-grey-row-is-eight-Q-spans-with-its-U-and-its-S-newline",
      tags(MH) === "LUGLGSDS" + "LUGLGSDS" + "QUQQQQQS" + "QUQQQQQS" +
                   "LUGLGSDS" + "LUGLGSDS", tags(MH));
check("a-spine-row-carries-no-grey-tag",
      tags(MH).slice(0, 8).indexOf("Q") < 0, tags(MH).slice(0, 8));

//  ---- 3) the ORDER is untouched: still LITE-013's date order -------------
check("greying-does-not-reorder-the-rows",
      M.rows.length === 6 && M.parts[0].sha8 === E.c2 &&
      M.parts[5].sha8 === E.c0, marks(M));

//  ---- 4) `log <hex>` anchors the spine at THAT commit --------------------
//  From the merge: the same split.  From s2: its OWN first-parent line is the
//  spine, so nothing greys — the side chain of one log is the spine of another.
const HM = lg.log(E.m, { from: repo });
check("log-<merge-hex>-splits-the-same-way",
      marks(HM) === E.m + ":spine " + E.s2 + ":GREY " + E.s1 + ":GREY " +
                    E.c1 + ":spine " + E.c0 + ":spine", marks(HM));
const HS = lg.log(E.s2, { from: repo });
check("log-<side-hex>-anchors-the-spine-there",
      marks(HS) === E.s2 + ":spine " + E.s1 + ":spine " + E.c0 + ":spine",
      marks(HS));

//  ---- 5) a CAP that cuts the spine is still right for the rows shown -----
const CP = lg.log(undefined, { from: repo, max: 2 });
check("a-cap-marks-only-what-it-collected",
      marks(CP) === E.c2 + ":spine " + E.m + ":spine", marks(CP));
const CP4 = lg.log(undefined, { from: repo, max: 4 });
check("a-cap-that-includes-the-side-chain-still-greys-it",
      marks(CP4) === E.c2 + ":spine " + E.m + ":spine " + E.s2 + ":GREY " +
                    E.s1 + ":GREY", marks(CP4));

//  ---- 6) `log <path>` is FILE REVISIONS, not a DAG — untouched ----------
const P = lg.log("s.txt", { from: repo });
check("log-<path>-lists-the-side-file's-revisions",
      P.rows.length === 2, P.rows.length);
check("LITE-020-log-<path>-greys-nothing",
      P.parts.every(function (p) { return p.nonspine === false; }), marks(P));
check("log-<path>-carries-no-Q-tag",
      tags(lg.hunk(P.uri, P.parts)).indexOf("Q") < 0);

//  ---- 7) PAINT ONLY: the visible bytes are the plain rows, grey or not ---
check("merge-log-visible-bytes-are-the-plain-rows",
      visible(MH) === M.rows.join("\n") + "\n", visible(MH).slice(0, 60));
check("linear-log-visible-bytes-are-the-plain-rows",
      visible(LH) === L.rows.join("\n") + "\n", visible(LH).slice(0, 60));
check("hex-form-visible-bytes-are-the-plain-rows",
      visible(lg.hunk(HM.uri, HM.parts)) === HM.rows.join("\n") + "\n");
check("path-form-visible-bytes-are-the-plain-rows",
      visible(lg.hunk(P.uri, P.parts)) === P.rows.join("\n") + "\n");
//  A grey row's plain text is formatted EXACTLY like a spine row's — no
//  marker byte, no column, nothing the greying could have leaked into text.
const greyRow = M.rows[2], spineRow = M.rows[0];
const shape = /^[0-9a-f]{8} [0-9A-Za-z? ]{7} .* \(T\)$/;
check("a-grey-row's-plain-text-has-the-spine-row's-exact-shape",
      shape.test(greyRow) && shape.test(spineRow) &&
      greyRow.length - M.parts[2].summary.length ===
      spineRow.length - M.parts[0].summary.length, greyRow + " | " + spineRow);

//  ---- 8) the spine set IS the ord-0 chain, read straight off the API -----
//  (the same claim from the other end: spineOf over the collected hls.)
check("spineOf-is-exported-for-the-walk",
      typeof lg.spineOf === "function" && lg.TAG_Q === 16, lg.TAG_Q);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
