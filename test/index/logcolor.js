//  lite/test/index/logcolor.js — LITE-007 ruling 2026-08-13: at a terminal a
//  log is a HUNK, painted by the SAME view/bro.js theme + view/pager.js row
//  painter a file arg goes through.  Headless (no tty needed): build the hunk
//  and paint its rows, exactly as main.js's tty leg does.
//
//  The palette is be/views/log/log.js's own: sha8 = L (cyan), the separators =
//  G (green), date7 = L, summary = S (default), " (author)" = D (grey), and a
//  final S span over the "\n" so the next row's L cannot bleed onto this line's
//  terminator.  `LITE_FIX` names the fixture repo.
"use strict";
const lg = require("index/log.js");
const bro = require("view/bro.js");
const pager = require("view/pager.js");

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
check("hunk-seven-toks-per-row", h.toks.length === out.rows.length * 7,
      h.toks.length + " toks for " + out.rows.length + " rows");
//  the hunk's BYTES are the plain rows — one renderer, two sinks.
check("hunk-bytes-are-the-plain-rows",
      utf8.Decode(h.text) === out.rows.join("\n") + "\n",
      utf8.Decode(h.text).slice(0, 60));
//  tok ends must ascend and finish exactly at the text length (bro.rowEnd
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
const rows = bro.indexRows(h, 100, true);
check("one-row-per-commit", rows.length === out.rows.length,
      rows.length + " vs " + out.rows.length);
const r0 = pager.paintRow(h, rows[0].off, rows[0].end, true, rows[0].pass);
//  the be-log column palette, read off lite's OWN theme table (never a
//  hand-rolled SGR): L for the sha, G for the separator, D for the author.
const sgrL = bro.deltaSGR(bro.themeAt("L"), bro.cellAnsi ? bro.themeAt("S") : null);
check("row-opens-with-the-L-slot", r0.indexOf(ESC + "[") === 0, r0.slice(0, 12));
check("row-closes-with-a-full-reset", r0.slice(-4) === ESC + "[0m", r0.slice(-8));
check("row-carries-the-G-separator-slot",
      r0.indexOf(bro.deltaSGR(bro.themeAt("G"), bro.themeAt("L"))) > 0, r0);
check("author-tail-is-the-D-slot",
      r0.indexOf(bro.deltaSGR(bro.themeAt("D"), bro.themeAt("S"))) > 0, r0);
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
