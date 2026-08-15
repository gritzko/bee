//  lite/test/index/logcolor.js — LITE-007 ruling 2026-08-13: at a terminal a
//  log is a HUNK, painted by the SAME render/ansi.js theme + pager.js row
//  painter a file arg goes through.  Headless (no tty needed): build the hunk
//  and paint its rows, exactly as main.js's tty leg does.
//
//  The palette is be/views/log/log.js's own: sha8 = L (cyan), the separators =
//  G (green), date7 = L, summary = S (default), " (author)" = D (grey), and a
//  final S span over the "\n" so the next row's L cannot bleed onto this line's
//  terminator.  `LITE_FIX` names the fixture repo.
"use strict";
const lg = require("view/log.js");
const ansi = require("render/ansi.js");
const wrap = require("render/wrap.js");
const pager = require("pager.js");

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

const repo = io.getenv("LITE_FIX");
const out = lg.log(undefined, { from: repo });
const h = lg.hunk(out.uri, out.parts);

//  ---- the hunk is the shape bro/pager already render ----------------------
check("hunk-shape", h.verb === "hunk" && h.uri === "log" &&
      h.text instanceof Uint8Array && h.toks instanceof Uint32Array,
      h.verb + " " + h.uri);
//  8, not 7: the sha8 is followed by its hidden `U` click-target (`commit
//  <hexlet>`), which takes no column but is a span of its own.
check("hunk-eight-toks-per-row", h.toks.length === out.rows.length * 8,
      h.toks.length + " toks for " + out.rows.length + " rows");
check("the-second-tok-of-a-row-is-the-U-target",
      String.fromCharCode(65 + ((h.toks[1] >>> 27) & 0x1f)) === "U",
      String.fromCharCode(65 + ((h.toks[1] >>> 27) & 0x1f)));
//  The hunk's VISIBLE bytes are the plain rows — one renderer, two sinks.  The
//  `U` spans carry nav bytes that never paint, so they come out of the compare.
let vis = "", at = 0;
for (let i = 0; i < h.toks.length; i++) {
  const end = h.toks[i] & 0xffffff;
  if (String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f)) !== "U")
    vis += utf8.Decode(h.text.slice(at, end));
  at = end;
}
check("hunk-visible-bytes-are-the-plain-rows",
      vis === out.rows.join("\n") + "\n", vis.slice(0, 60));
//  tok ends must ascend and finish exactly at the text length (wrap.rowEnd
//  walks them in order; a stray end would mis-column every row after it).
let ok = true, prev = -1;
for (let i = 0; i < h.toks.length; i++) {
  const e = h.toks[i] & 0xffffff;
  if (e <= prev) { ok = false; break; }
  prev = e;
}
check("tok-ends-ascend-and-cover-the-text",
      ok && prev === h.text.length, prev + " vs " + h.text.length);

//  ---- the paint ----------------------------------------------------------
const rows = wrap.indexRows(h, 100, true);
check("one-row-per-commit", rows.length === out.rows.length,
      rows.length + " vs " + out.rows.length);
const r0 = pager.paintRow(h, rows[0].off, rows[0].end, true, rows[0].pass);
//  the be-log column palette, read off lite's OWN theme table (never a
//  hand-rolled SGR): L for the sha, G for the separator, D for the author.
const sgrL = ansi.deltaSGR(ansi.themeAt("L"), ansi.cellAnsi ? ansi.themeAt("S") : null);
check("row-opens-with-the-L-slot", r0.indexOf(ESC + "[") === 0, r0.slice(0, 12));
check("row-closes-with-a-full-reset", r0.slice(-4) === ESC + "[0m", r0.slice(-8));
check("row-carries-the-G-separator-slot",
      r0.indexOf(ansi.deltaSGR(ansi.themeAt("G"), ansi.themeAt("L"))) > 0, r0);
check("author-tail-is-the-D-slot",
      r0.indexOf(ansi.deltaSGR(ansi.themeAt("D"), ansi.themeAt("S"))) > 0, r0);
//  ...and the visible text of a painted row is the plain row, byte for byte.
const bare = r0.replace(/\x1b\[[0-9;]*m/g, "");
check("painted-row-strips-back-to-the-plain-row", bare === out.rows[0],
      bare + " | " + out.rows[0]);

//  ---- uncoloured paint is the plain row ----------------------------------
const p0 = pager.paintRow(h, rows[0].off, rows[0].end, false, rows[0].pass);
check("no-colour-paint-has-no-SGR-at-all", p0.indexOf(ESC) < 0 && p0 === out.rows[0], p0);

//  ---- the arg rides the banner uri ---------------------------------------
const fh = lg.log("a.txt", { from: repo });
check("a-path-log-banners-its-arg", lg.hunk(fh.uri, fh.parts).uri === "log a.txt",
      fh.uri);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
