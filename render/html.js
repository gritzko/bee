//  render/html.js — LITE-034: the HTML twin of the ANSI painter.  The very same
//  hunks the pager paints (dog tok32 tags over the hunk's own bytes) become
//  `<span class="tok-X">`, and render/theme.js's palette becomes ONE generated
//  stylesheet.  Nothing here re-reads or re-recognises a byte: the tags are the
//  tokenizer's, read through render/wrap.js's accessors (LITE-045: this file
//  used to mirror the tok32 layout itself), the targets are the hidden `U`
//  spans pager.js follows, and every colour NUMBER comes out of
//  render/theme.js.
//
//  VERB-BLIND, like every renderer: it knows tags, sides and hunks, never which
//  view made them.  `lite http` is the app pinned to it.
//
//  The column layout is the terminal's, unchanged — a hunk body is a `<pre>`,
//  so a list/log row's padding and a diff hunk's weave line up as they do at a
//  terminal.  No CommonMark, no site chrome: a `.md`/`.mkd` file is served as
//  syntax-painted source like any other.
"use strict";

const theme = require("render/theme.js");
//  tok32 (dog/tok/TOK.h): [31..27] tag, [25..24] diff side, [23..0] end byte
//  offset; token i starts where token i-1 ended.  THE accessors, shared with
//  the row index and the ansi painter — never a second copy of the layout.
const wrap = require("render/wrap.js");
const TOK_TAG = wrap.TOK_TAG, TOK_SIDE = wrap.TOK_SIDE, TOK_END = wrap.TOK_END;

//  --- SGR parameter -> sRGB --------------------------------------------------
//  A browser has no SGR, so a slot's PARAMETER string goes through xterm's own
//  table — the terminal's rendering of a code; every NUMBER is still theme.js's.
const XTERM16 = ["#000000", "#cd0000", "#43bc6c", "#cdcd00", "#0000ee", "#a9568f",
                 "#00cdcd", "#e5e5e5", "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
                 "#5c5cff", "#ff00ff", "#3684c9", "#ffffff"];
const CUBE = [0, 95, 135, 175, 215, 255];

function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16); }

//  A 256-colour index: the 16 base codes, the 6x6x6 cube, the 24-step grey ramp.
function color256(n) {
  if (n < 16) return XTERM16[n];
  if (n >= 232) { const g = 8 + (n - 232) * 10; return "#" + hex2(g) + hex2(g) + hex2(g); }
  const c = n - 16;
  return "#" + hex2(CUBE[(c / 36) | 0]) + hex2(CUBE[((c % 36) / 6) | 0]) + hex2(CUBE[c % 6]);
}

//  One SGR parameter string ("90", "38;5;56", "38;5;33;1", "48;5;157") -> the
//  CSS declarations it stands for.  An unknown parameter is simply not spelled.
function sgrCss(params) {
  const p = String(params === undefined || params === null ? "" : params).split(";");
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const n = Number(p[i]);
    if (n === 1) { out.push("font-weight:bold"); continue; }
    if ((n === 38 || n === 48) && p[i + 1] === "5") {
      out.push((n === 38 ? "color:" : "background:") + color256(Number(p[i + 2])));
      i += 2;
      continue;
    }
    //  BEE-030 palette: a 24-bit slot ("38;2;r;g;b") spells its hex verbatim.
    if ((n === 38 || n === 48) && p[i + 1] === "2") {
      out.push((n === 38 ? "color:" : "background:") + "#" + hex2(Number(p[i + 2])) +
               hex2(Number(p[i + 3])) + hex2(Number(p[i + 4])));
      i += 4;
      continue;
    }
    if (n >= 30 && n <= 37) out.push("color:" + XTERM16[n - 30]);
    else if (n >= 90 && n <= 97) out.push("color:" + XTERM16[n - 90 + 8]);
    else if (n >= 40 && n <= 47) out.push("background:" + XTERM16[n - 40]);
    else if (n >= 100 && n <= 107) out.push("background:" + XTERM16[n - 100 + 8]);
  }
  return out.join(";");
}

//  --- the ONE stylesheet -----------------------------------------------------
//  The frame (geometry only — no colour is chosen here) plus one rule per theme
//  slot, plus the two diff wash slots.  Served whole at /style.css.
//  The frame is a FILE, blob/style.css, read from beside the code (which is
//  where jsrcpack packs it, so a bundled binary carries it too) — CSS is
//  written as CSS, not spelled as a JS array.  Read on FIRST PAINT and kept:
//  only an HTML page wants it, so a missing file refuses `bee http`, not `bee
//  log` — a renderer's asset is no verb's startup cost.
let FRAME = null;
function frame() {
  if (FRAME === null)
    FRAME = utf8.Decode(io.mmap(__dirname + "/../blob/style.css", "r").data());
  return FRAME;
}

//  The page's own ground is the TERMINAL DEFAULT pair (what ESC[39m/ESC[49m
//  return to), spelled through the same xterm table — no slot of its own, and
//  the one colour the frame file cannot carry.
const GROUND = "body{background:" + XTERM16[15] + ";color:" + XTERM16[0] + "}";

//  stylesheet(thm) -> the CSS text.  `thm` defaults to theme.select(), so
//  $BRO_THEME picks the browser's palette exactly as it picks the pager's.
function stylesheet(thm) {
  thm = thm || theme.select();
  const out = [frame(), GROUND, ".banner{" + sgrCss(thm.banner) + "}"];
  for (const tag in thm.slots) {
    const css = sgrCss(thm.slots[tag]);
    if (css) out.push(".tok-" + tag + "{" + css + "}");
  }
  out.push(".side-in{" + sgrCss(thm.washIn) + "}");
  out.push(".side-rm{" + sgrCss(thm.washRm) + "}");
  out.push(".side-in.pale{" + sgrCss(thm.washInPale) + "}");
  out.push(".side-rm.pale{" + sgrCss(thm.washRmPale) + "}");
  //  LITE-034: the LANDED token — a reference's `#b<offset>` — wears the theme's
  //  own band, which is how the pager marks where a landing put the cursor.
  out.push("pre.body span:target{" + sgrCss(thm.banner) + "}");
  return out.join("\n") + "\n";
}

//  --- the paint --------------------------------------------------------------
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dec(bytes, lo, hi) { return utf8.Decode(bytes.slice(lo, hi)); }

//  ONE hunk -> its HTML: the banner band, then a `<pre>` of tagged spans.
//  `link` is `(pagerTarget) -> url | ""`, the router's — this module knows tags.
//  LITE-034: every token span carries `id="b<start byte>"` — the token's START
//  OFFSET in the served bytes, the same identity index/perma.js walks, so a
//  resolved reference's href ends `#b<offset>` and the browser lands on the
//  token the pager would select.  A page's SECOND and later hunks prefix the
//  ordinal (`b1-<off>`), so ids stay unique and `#b<off>` names the first hunk.
function anchorId(ord, lo) { return "b" + (ord ? ord + "-" : "") + lo; }

//  BEE-021: the wash class of a changed token — strong on its own split pass,
//  pale inline or seen from the other pass (the ansi cellAnsi slots).
function sideClass(side, pass) {
  if (side === wrap.SIDE_IN) return pass === wrap.PASS_IN ? " side-in" : " side-in pale";
  if (side === wrap.SIDE_RM) return pass === wrap.PASS_RM ? " side-rm" : " side-rm pale";
  return "";
}

//  The spans of the byte window [from, to) in `pass` (a token is clipped to
//  the window; the pass hides the other diff side).  `seen` keeps a token's
//  anchor id on its FIRST emission — a split block shows its eq bytes twice.
function spansHtml(hunk, from, to, pass, link, ord, seen, out) {
  const text = hunk.text, toks = hunk.toks || new Uint32Array(0);
  let lo = 0, hi = toks.length;
  while (lo < hi) { const m = (lo + hi) >> 1;
    if (TOK_END(toks[m]) <= from) lo = m + 1; else hi = m; }
  let prev = lo > 0 ? TOK_END(toks[lo - 1]) : 0;
  for (let i = lo; i < toks.length && prev < to; i++) {
    const tag = TOK_TAG(toks[i]), end = TOK_END(toks[i]), start = prev;
    prev = end;
    const side = TOK_SIDE(toks[i]);
    if (wrap.passHides(tag, pass, side)) continue;   // a target / the other side
    const s = start > from ? start : from, e = end < to ? end : to;
    //  BEE-030: a zero-width `B` span still renders — it is the flex slot that
    //  keeps the trailing columns flush right when the title is empty.
    if (e <= s && !(tag === "B" && start >= from && end <= to)) continue;
    //  The target, exactly as pager.js reads it: a hidden `U` span right
    //  behind this one, else an `F` token's own bytes — a reference (LITE-015).
    let target = "";
    if (i + 1 < toks.length && TOK_TAG(toks[i + 1]) === "U")
      target = dec(text, end, TOK_END(toks[i + 1]));
    else if (tag === "F" && hunk.kind !== "dir")
      target = dec(text, start, end);
    const href = (target && link) ? link(target) : "";
    const id = seen.has(start) ? "" : ' id="' + anchorId(ord, start) + '"';
    seen.add(start);
    //  BEE-030: the elastic span — or the `<a>` around it — wears `els`, the
    //  flex item blob/style.css stretches and ellipsizes (BRO-036's css twin).
    const els = tag === "B" ? " els" : "";
    const span = '<span class="tok-' + tag + (href ? "" : els) +
                 sideClass(side, pass) + '"' + id + '>' +
                 esc(dec(text, s, e)) + "</span>";
    //  A reference that resolves to nothing is PLAIN PAINTED TEXT — never a
    //  link that 404s (ruling 2026-08-15).
    out.push(href ? '<a' + (els ? ' class="els"' : "") + ' href="' + esc(href) +
                    '">' + span + '</a>' : span);
  }
  //  Bytes past the last token — an untokenised tail, or a whole hunk with no
  //  toks (a blob, an unknown extension) — paint as one anchorable plain span.
  const tail = prev > from ? prev : from;
  if (tail < to)
    out.push('<span class="tok-S" id="' + anchorId(ord, tail) + '">' +
             esc(dec(text, tail, to)) + "</span>");
}

//  BEE-030: does the hunk / the row [off, end] carry an elastic `B` span?  A
//  zero-width one (an empty title) counts — it is still the flex slot.
function hasElastic(toks) {
  if (!toks) return false;
  for (let i = 0; i < toks.length; i++) if (TOK_TAG(toks[i]) === "B") return true;
  return false;
}
function rowHasB(hunk, off, end) {
  const toks = hunk.toks;
  let prev = 0;
  for (let i = 0; i < toks.length; i++) {
    const e = TOK_END(toks[i]);
    if (TOK_TAG(toks[i]) === "B" &&
        ((e > off && prev < end) || (prev === e && prev >= off && e <= end)))
      return true;
    prev = e;
  }
  return false;
}

function hunkHtml(hunk, link, ord, tog) {
  ord = ord || 0;
  const out = ['<div class="hunk"><div class="banner">', esc(hunk.uri || ""),
               tog ? " " + tog : "",
               '</div><pre class="body">'];
  const seen = new Set();
  if (wrap.hasDiffSides(hunk.toks)) {
    //  BEE-021: a diff hunk is painted ROW by row — an inline row in place, a
    //  split block as its rm rows then its in rows (the pager's very index).
    for (const r of wrap.indexRows(hunk, wrap.NO_CLAMP, false)) {
      spansHtml(hunk, r.off, r.end, r.pass, link, ord, seen, out);
      out.push("\n");
    }
  } else if (hasElastic(hunk.toks)) {
    //  BEE-030: a line holding a `B` span becomes a flex `.row` the browser
    //  stretches/ellipsizes to ITS width; a block box needs no '\n' of its own.
    for (const r of wrap.indexRows(hunk, wrap.NO_CLAMP, false)) {
      const b = rowHasB(hunk, r.off, r.end);
      if (b) out.push('<span class="row">');
      spansHtml(hunk, r.off, r.end, wrap.PASS_NORMAL, link, ord, seen, out);
      out.push(b ? "</span>" : "\n");
    }
  } else spansHtml(hunk, 0, hunk.text.length, wrap.PASS_NORMAL, link, ord, seen, out);
  out.push('</pre></div>');
  return out.join("");
}

//  BEE-032: `tog` (a prebuilt toggle anchor) rides the FIRST hunk's own banner
//  line, so the source view spends no separate bar on it.
function hunksHtml(hunks, link, tog) {
  if (!hunks || !hunks.length) return '<pre class="note">(nothing to show)</pre>';
  const out = [];
  for (let i = 0; i < hunks.length; i++)
    out.push(hunkHtml(hunks[i], link, i, i === 0 ? tog : ""));
  return out.join("");
}

//  The toggle anchor to the OTHER view of the same bytes (rendered <-> source).
function toggle(label, href) {
  return label && href ? '<a href="' + esc(href) + '">' + esc(label) + "</a>" : "";
}

//  LITE-035: the banner band on its own — a title and the toggle.  Empty when
//  there is neither.
function viewBar(title, label, href) {
  const tog = toggle(label, href);
  if (!title && !tog) return "";
  return '<div class="hunk"><div class="banner">' + esc(title) +
         (title && tog ? " " : "") + tog + "</div></div>";
}

//  LITE-035: a rendered Markdown fragment in the SAME chrome the painted hunks
//  wear — mark/html.js emits the body, this is all the page it gets.
function markBody(fragment) {
  return '<div class="hunk"><div class="mark">' + fragment + "</div></div>";
}

//  The page: a title, the one stylesheet, the hunks.  No chrome.
function page(title, body) {
  return '<!DOCTYPE html>\n<html><head><meta charset="utf-8">' +
         '<meta name="viewport" content="width=device-width,initial-scale=1">' +
         "<title>" + esc(title) + "</title>" +
         '<link rel="stylesheet" href="/style.css">' +
         '<link rel="icon" href="/favicon.ico"></head><body>' +
         body + "</body></html>\n";
}

//  A refusal reads as the verb wrote it — plain words, no stack, no chrome.
//  BEE-028: `hint` is an optional `{ text, href }` — one link the miss offers.
function errorPage(title, message, hint) {
  const h = hint ? "\n" + esc(hint.text) + ' <a href="' + esc(hint.href) + '">' +
                   esc(hint.href) + "</a>" : "";
  return page(title, '<div class="hunk"><div class="banner">' + esc(title) +
                     '</div><pre class="body">' + esc(message) + h + "\n</pre></div>");
}

//  ---- the RENDERER (LITE-045) -----------------------------------------------
//  render(hunks, opts) -> bytes: ONE SELF-CONTAINED page — the very hunks
//  `lite http` paints, with the stylesheet INLINE, because a `lite --html x >
//  x.html` dump has no server to fetch /style.css from.  `opts.link` is the
//  same `(target) -> url` resolver http passes; with none, a reference is
//  plain painted text (ruling 2026-08-15) and the page stands alone.
//  Nothing to show renders NOTHING, so the three renderers agree on silence.
function render(hunks, opts) {
  if (!hunks || !hunks.length) return new Uint8Array(0);
  const title = (opts && opts.title) || hunks[0].uri || "lite";
  return utf8.Encode(
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + esc(title) + "</title><style>\n" +
    stylesheet(opts && opts.theme) + "</style></head><body>" +
    hunksHtml(hunks, opts && opts.link) + "</body></html>\n");
}

module.exports = {
  render: render,
  stylesheet: stylesheet,
  hunkHtml: hunkHtml,
  hunksHtml: hunksHtml,
  page: page,
  errorPage: errorPage,
  viewBar: viewBar,
  toggle: toggle,
  markBody: markBody,
  esc: esc,
  sgrCss: sgrCss,
  color256: color256,
  anchorId: anchorId,
};
