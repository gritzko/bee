//  lite/test/commit/color.js — LITE-009, the headless span/palette leg: the
//  commit hunk built and painted exactly as main.js's tty leg does, with no tty
//  needed (commitpty.js proves the wiring on a real pty).
//
//  What this pins is that the COLOUR is layered on the object's own bytes and
//  changes none of them: the hunk text is `commit <sha40>\n` + the raw object,
//  the tok ends ascend and cover it exactly, EVERY '\n' is its own default-tag
//  span (so no colour bleeds across a line), and a painted row strips back to
//  the plain line byte for byte.  `LITE_FIX` names the fixture repo, `LITE_SHA`
//  the merge commit and `LITE_SIG` the folded-header (gpgsig) commit.
"use strict";
const cm = require("view/commit.js");
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
const SHA = io.getenv("LITE_SHA"), SIG = io.getenv("LITE_SIG");

const out = cm.commit(SHA, { from: repo });
const h = out.hunks[0];      // LITE-045: the metadata hunk leads the view
const text = utf8.Decode(h.text);
const lines = text.split("\n");
//  LITE-021: the hunk body carries the hidden `U` targets, its `plain` does not
//  — the PLAIN body is what a painted row must strip back to.
const ptext = utf8.Decode(h.plain), plines = ptext.split("\n");

//  ---- the hunk is the shape bro/pager already render -----------------------
check("hunk-shape", h.verb === "hunk" && h.kind === "commit" &&
      h.text instanceof Uint8Array && h.toks instanceof Uint32Array,
      h.verb + " " + h.kind);
check("hunk-banners-the-verb-and-the-arg", h.uri === "commit " + SHA, h.uri);
check("first-line-is-commit-sha40", lines[0] === "commit " + out.sha &&
      out.sha.length === 40, lines[0]);
//  the object itself follows, verbatim — nothing was decoded and re-joined.
check("object-follows-the-synthetic-line",
      h.text.length === utf8.Encode("commit " + out.sha + "\n").length +
      (text.length - lines[0].length - 1), String(h.text.length));

//  ---- the tok table --------------------------------------------------------
let asc = true, prev = -1;
for (let i = 0; i < h.toks.length; i++) {
  const e = h.toks[i] & 0xffffff;
  if (e <= prev) { asc = false; break; }
  prev = e;
}
check("tok-ends-ascend-and-cover-the-text", asc && prev === h.text.length,
      prev + " vs " + h.text.length);

//  Tag of the span covering byte `at`, and that span's [start, end).
function spanAt(at) {
  let start = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const e = h.toks[i] & 0xffffff;
    if (at < e) return { tag: String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f)),
                         start: start, end: e };
    start = e;
  }
  return null;
}

//  The synthetic line: `commit ` R (keyword), the sha L (number), `\n` S.
check("commit-word-is-the-R-slot", spanAt(0).tag === "R" && spanAt(0).end === 7,
      JSON.stringify(spanAt(0)));
check("commit-sha-is-the-L-slot", spanAt(7).tag === "L" && spanAt(7).end === 47,
      JSON.stringify(spanAt(7)));

//  EVERY newline is its own default-tag span, so no colour bleeds across a
//  line — the anti-bleed rule view/log.js's hunk follows too.
let bleed = null;
for (let i = 0; i < h.text.length; i++) {
  if (h.text[i] !== 0x0a) continue;
  const s = spanAt(i);
  if (s.tag !== "S" || s.start !== i || s.end !== i + 1) { bleed = i; break; }
}
check("every-newline-is-its-own-S-span", bleed === null,
      bleed === null ? "" : "byte " + bleed);

//  The header block: field NAMES blue (R), a `tree`/`parent` sha cyan (L), an
//  `author` value green (G), the subject bold (N).
const treeAt = text.indexOf("\ntree ") + 1;
const authAt = text.indexOf("\nauthor ") + 1;
check("field-name-is-the-R-slot", spanAt(treeAt).tag === "R" &&
      spanAt(treeAt).end === treeAt + 5, JSON.stringify(spanAt(treeAt)));
//  LITE-021: a hidden `U` target rides between them — `tree <sha40>` — so the
//  cyan sha span starts after it and a second copy follows the sha (Enter takes
//  the row's first span, a click the sha's own).
const treeNav = "tree " + text.slice(treeAt + 50, treeAt + 90);
check("tree-name-is-followed-by-the-U-target",
      spanAt(treeAt + 5).tag === "U" &&
      text.slice(treeAt + 5, spanAt(treeAt + 5).end) === treeNav,
      JSON.stringify(spanAt(treeAt + 5)));
check("tree-sha-value-is-the-L-slot", spanAt(treeAt + 50).tag === "L" &&
      spanAt(treeAt + 50).end === treeAt + 50 + 40, JSON.stringify(spanAt(treeAt + 50)));
check("tree-sha-is-followed-by-the-U-target-too",
      spanAt(treeAt + 50 + 40).tag === "U" &&
      text.slice(treeAt + 50 + 40, spanAt(treeAt + 50 + 40).end) === treeNav,
      JSON.stringify(spanAt(treeAt + 50 + 40)));
check("author-value-is-the-G-slot", spanAt(authAt + 7).tag === "G",
      JSON.stringify(spanAt(authAt + 7)));
const subjAt = text.indexOf("\n\n") + 2;
check("subject-is-the-N-slot", spanAt(subjAt).tag === "N",
      JSON.stringify(spanAt(subjAt)));

//  ---- the paint ------------------------------------------------------------
const rows = wrap.indexRows(h, 200, true);
check("one-row-per-line", rows.length === lines.length - (text.slice(-1) === "\n" ? 1 : 0),
      rows.length + " rows vs " + lines.length + " lines");
const r0 = pager.paintRow(h, rows[0].off, rows[0].end, true, rows[0].pass);
check("row-opens-with-the-R-slot",
      r0.indexOf(ansi.deltaSGR(ansi.themeAt("R"), ansi.A0)) === 0, r0.slice(0, 12));
check("row-carries-the-L-slot-for-the-sha",
      r0.indexOf(ansi.deltaSGR(ansi.themeAt("L"), ansi.themeAt("R"))) > 0, r0);
check("row-closes-with-a-full-reset", r0.slice(-4) === ESC + "[0m", r0.slice(-8));
check("painted-row-strips-back-to-the-plain-line",
      r0.replace(/\x1b\[[0-9;]*m/g, "") === lines[0],
      r0.replace(/\x1b\[[0-9;]*m/g, ""));
const p0 = pager.paintRow(h, rows[0].off, rows[0].end, false, rows[0].pass);
check("no-colour-paint-has-no-SGR-at-all", p0.indexOf(ESC) < 0 && p0 === lines[0], p0);

//  ---- the FOLDED-header commit ---------------------------------------------
//  A gpgsig value is many lines; each continuation is its OWN span, so the
//  colour still stops at every terminator and every row paints back to itself.
const so = cm.commit(SIG, { from: repo });
const sh = so.hunks[0];
const stext = utf8.Decode(sh.text), slines = utf8.Decode(sh.plain).split("\n");
check("folded-commit-first-line", slines[0] === "commit " + SIG, slines[0]);
check("folded-value-lines-are-in-the-text",
      stext.indexOf("\ngpgsig -----BEGIN PGP SIGNATURE-----\n ") > 0 &&
      stext.indexOf("\n -----END PGP SIGNATURE-----\nencoding ISO-8859-1\n") > 0,
      stext.slice(0, 200));
let sbleed = null;
for (let i = 0; i < sh.text.length; i++) {
  if (sh.text[i] !== 0x0a) continue;
  let start = 0, tag = null, end = 0;
  for (let t = 0; t < sh.toks.length; t++) {
    const e = sh.toks[t] & 0xffffff;
    if (i < e) { tag = String.fromCharCode(65 + ((sh.toks[t] >>> 27) & 0x1f)); end = e; break; }
    start = e;
  }
  if (tag !== "S" || start !== i || end !== i + 1) { sbleed = i; break; }
}
check("folded-commit-newlines-are-all-S-spans", sbleed === null,
      sbleed === null ? "" : "byte " + sbleed);
const srows = wrap.indexRows(sh, 200, true);
let allback = true, off = 0;
for (let i = 0; i < srows.length; i++) {
  const painted = pager.paintRow(sh, srows[i].off, srows[i].end, true, srows[i].pass);
  if (painted.replace(/\x1b\[[0-9;]*m/g, "") !== slines[i]) { allback = false; off = i; break; }
}
check("every-folded-row-paints-back-to-its-plain-line", allback, "row " + off);

//  ---- refusals -------------------------------------------------------------
function refused(arg) {
  try { cm.commit(arg, { from: repo }); } catch (e) { return String(e); }
  return null;
}
check("a-non-hex-arg-is-refused-in-plain-words",
      (refused("nosuch") || "").indexOf("is not a commit name") > 0, refused("nosuch"));
check("an-unknown-hexlet-is-refused-in-plain-words",
      (refused("deadbeefdead") || "").indexOf("no commit in this repository") > 0,
      refused("deadbeefdead"));

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
