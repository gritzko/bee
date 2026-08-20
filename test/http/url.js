//  lite/test/http/url.js — LITE-034, the HEADLESS leg: the two pure halves of
//  `lite http` that need no socket at all —
//
//    http.js  routeOf(url) -> (verb, arg)   the URL table, one way
//                    urlOf(root, pagerTarget)      the same table, the other way
//    render/html.js    sgrCss / color256             render/theme.js -> CSS
//                    hunkHtml(hunk, link)          tok tag -> <span>, `U` -> <a>
//
//  The two directions are asserted TOGETHER: a pager target that becomes a URL
//  must route back to the same (verb, arg), which is what keeps a click in the
//  browser and a click in the pager the same click.  No repository is needed.
"use strict";
const srv = require("http.js");
const html = require("render/html.js");
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

//  --- the URL table, url -> (verb, arg) ------------------------------------
const ROUTES = [
  ["/",                      "list",   ""],
  ["/list/",                 "list",   ""],
  ["/list/sub/",             "list",   "sub/"],
  ["/log/",                  "log",    ""],
  ["/log/sub/x.txt",         "log",    "sub/x.txt"],
  ["/log/78d15e48",          "log",    "78d15e48"],
  ["/commit/78d15e48",       "commit", "78d15e48"],
  ["/diff/",                 "diff",   ""],
  ["/diff/78d15e48",         "diff",   "78d15e48"],
  ["/cat/sub/x.txt",         "cat",    "sub/x.txt"],
  ["/cat/sub/x.txt?da0bd2c", "cat",    "sub/x.txt?da0bd2c"],
  ["/tree/sub/",             "tree",   "sub/"],
  ["/blob/92ac9c80",         "blob",   "92ac9c80"],
];
for (const r of ROUTES) {
  const g = srv.routeOf(r[0]);
  check("route " + r[0] + " -> " + r[1] + " '" + r[2] + "'",
        g.verb === r[1] && g.arg === r[2], g.verb + " '" + g.arg + "'");
}
//  A head no table entry names is NOT a verb — the server answers 404, it does
//  not fall through to some default view.
check("an unknown head names no verb", srv.routeOf("/nope/x").verb === undefined,
      srv.routeOf("/nope/x").verb);
check("style.css names no verb either", srv.routeOf("/style.css").verb === undefined,
      srv.routeOf("/style.css").verb);
//  BEE-003 (ruling 2): the FIRST segment names the REPO when the registry knows
//  it, and the same table follows it — so one URL carries repo, view and path.
const NAMES = ["repo", "quick"];
const RREPO = [
  ["/repo/",                  "repo",  "list",   ""],
  ["/repo/list/sub/",         "repo",  "list",   "sub/"],
  ["/repo/cat/sub/x.txt",     "repo",  "cat",    "sub/x.txt"],
  ["/quick/commit/78d15e48",  "quick", "commit", "78d15e48"],
  //  no verb after the repo: the rest IS the path, the file itself
  ["/quick/lib/abc/TCP.c",    "quick", "path",   "lib/abc/TCP.c"],
  ["/repo/a%20b.txt",         "repo",  "path",   "a b.txt"],
];
for (const r of RREPO) {
  const g = srv.routeOf(r[0], NAMES);
  check("route " + r[0] + " -> " + r[1] + " " + r[2] + " '" + r[3] + "'",
        g.repo === r[1] && g.verb === r[2] && g.arg === r[3],
        g.repo + " " + g.verb + " '" + g.arg + "'");
}
//  A repo-less URL names no repo at all — the server 301s it to the prefixed
//  form rather than serving one tree quietly.
check("a repo-less URL names no repo", srv.routeOf("/cat/x.txt", NAMES).repo === "",
      srv.routeOf("/cat/x.txt", NAMES).repo);
check("...and it keeps the raw path for the Location",
      srv.routeOf("/cat/x.txt", NAMES).raw === "/cat/x.txt");
//  A percent-escaped segment comes back as the byte it stands for (abc/URI).
check("a %20 segment decodes", srv.routeOf("/cat/a%20b.txt").arg === "a b.txt",
      srv.routeOf("/cat/a%20b.txt").arg);

//  --- the same table backwards, pager target -> url ------------------------
//  A page's own state: the root it serves, the door it resolves references
//  through, and the per-page cache/budget.  There is no repository under this
//  headless leg, so `door` is a STUB and every branch of the resolution is
//  driven from here; the wire leg (run.sh) drives the real door.
//  BEE-003: `name` is the mount the page is served under and `prefix` the path
//  it sits at, so every URL this page builds carries its repo.
const ROOT = "/w/repo";
function mkpg(door, left) {
  return { root: ROOT, name: "repo", prefix: "", door: door || null,
           refs: new Map(), hunks: new Map(),
           left: left === undefined ? 0 : left };
}
const TARGETS = [
  ["list /w/repo/sub/",       "/repo/list/sub/"],
  ["list /w/repo/",           "/repo/list/"],
  ["cat /w/repo/sub/x.txt",   "/repo/cat/sub/x.txt"],
  ["commit 78d15e48",         "/repo/commit/78d15e48"],
  ["tree /w/repo/sub/",       "/repo/tree/sub/"],
  ["tree 92ac9c80",           "/repo/tree/92ac9c80"],
  ["blob 92ac9c80",           "/repo/blob/92ac9c80"],
  ["log 78d15e48",            "/repo/log/78d15e48"],
  ["diff sub/x.txt",          "/repo/diff/sub/x.txt"],
  //  a `?<rev>` rides across as the URL's query, which is where it belongs
  ["cat /w/repo/sub/x.txt?da0bd2c", "/repo/cat/sub/x.txt?da0bd2c"],
  //  a space in a path is escaped per SEGMENT, so the separators survive
  ["cat /w/repo/a b/c.txt",   "/repo/cat/a%20b/c.txt"],
];
for (const t of TARGETS) {
  const g = srv.urlOf(mkpg(), t[0]);
  check("url " + t[0] + " -> " + t[1], g === t[1], g);
}
//  ROUND TRIP: every URL built from a target routes back to the verb and the
//  arg that target named (paths repo-relative, which is the URL's own frame).
const TRIPS = [
  ["list /w/repo/sub/",             "list", "sub/"],
  ["cat /w/repo/sub/x.txt?da0bd2c", "cat",  "sub/x.txt?da0bd2c"],
  ["commit 78d15e48",               "commit", "78d15e48"],
  ["blob 92ac9c80",                 "blob", "92ac9c80"],
  ["cat /w/repo/a b/c.txt",         "cat",  "a b/c.txt"],
];
for (const t of TRIPS) {
  const g = srv.routeOf(srv.urlOf(mkpg(), t[0]), NAMES);
  check("round trip " + t[0], g.repo === "repo" && g.verb === t[1] && g.arg === t[2],
        g.repo + " " + g.verb + " '" + g.arg + "'");
}

//  --- a REFERENCE is resolved, never spelled raw ---------------------------
//  Ruling 2026-08-15: the href is FINAL — the reference is followed while the
//  page is painted, and one that answers nothing gets no href at all.  These
//  legs drive the door with a stub, so each branch is asserted on its own.
function doorOf(seat, kind, hunk) {
  return { seatOf: function () { return seat; },
           statOf: function () { return kind === null ? null : { kind: kind }; },
           openPath: function () { return hunk === null ? null : [hunk]; } };
}
//  tok32 = [31..27] tag, [25..24] side, [23..0] end byte offset.
function tok32(tag, end, side) {
  return (((tag.charCodeAt(0) - 65) & 0x1f) << 27) | (((side || 0) & 3) << 24) | (end & 0xffffff);
}
function hunkOf(text, spans, kind) {
  const b = utf8.Encode(text);
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1], spans[i][2]);
  return { uri: "list", verb: "hunk", text: b, toks: toks, kind: kind || "list" };
}
//  `int a;\nint b;\nint c;\n` — three 7-byte lines, one token per word.
const TGT = hunkOf("int a;\nint b;\nint c;\n",
                   [["R", 3], ["W", 4], ["S", 5], ["P", 6], ["W", 7],
                    ["R", 10], ["W", 11], ["S", 12], ["P", 13], ["W", 14],
                    ["R", 17], ["W", 18], ["S", 19], ["P", 20], ["W", 21]], "cat");

//  a plain `file:line` ref anchors on the LINE'S FIRST token (line 2 starts at 7)
check("a file:line ref anchors on the line's first token",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/t.c", line: 2, col: 0 }, "reg", TGT), 8),
                "t.c:2") === "/repo/cat/t.c#b7",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/t.c", line: 2, col: 0 }, "reg", TGT), 8), "t.c:2"));
//  a `file:line:col` ref anchors on the token the COLUMN sits in (col 5 -> byte 11)
check("a file:line:col ref anchors on the column's token",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/t.c", line: 2, col: 5 }, "reg", TGT), 8),
                "t.c:2:5") === "/repo/cat/t.c#b11");
//  a PERMALINK hands the resolver's OWN token bytes over — no re-derivation
check("a permalink anchors on the resolver's own token",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/t.c", line: 3, col: 1, lo: 14, hi: 17 },
                            "reg", TGT), 8), "t.c:E:AbCd") === "/repo/cat/t.c#b14");
//  a reference naming a DIRECTORY opens the browser, not cat
check("a dir reference opens in list",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/sub", line: 0, col: 0 }, "dir", null), 8),
                "sub") === "/repo/list/sub/");
//  NOTHING answers -> no href; the painter leaves plain text
check("an unresolvable reference gets NO url",
      srv.urlOf(mkpg(doorOf(null, null, null), 8), "nosuch.c:3") === "");
//  BEE-012: SEVERAL answer -> a CHOICE, not a miss: the chooser page, read in
//  this page's own repo.  Before this it folded to "" beside a real miss.
check("an ambiguous reference gets the chooser url",
      srv.urlOf(mkpg(doorOf({ rels: [{ rel: "a/x.c" }, { rel: "b/x.c" }] }, null, null), 8),
                "x.c") === "/repo/choose/x.c");
//  OUTSIDE the repo -> there is no page for it
check("a reference outside the repo gets NO url",
      srv.urlOf(mkpg(doorOf({ full: "/elsewhere/x.c", line: 1, col: 0 }, "reg", TGT), 8),
                "/elsewhere/x.c") === "");
//  no toks to anchor on -> the file still links, bare
check("an untokenised target links without an anchor",
      srv.urlOf(mkpg(doorOf({ full: ROOT + "/t.txt", line: 1, col: 0 }, "reg",
                            { uri: "x", text: utf8.Encode("hi\n"),
                              toks: new Uint32Array(0), kind: "cat" }), 8),
                "t.txt:1") === "/repo/cat/t.txt");
//  the per-page BUDGET: past it a reference paints plain rather than stalling
//  the one loop, and a repeat costs nothing (the cache answers).
{
  let calls = 0;
  const d = { seatOf: function () { calls++; return { full: ROOT + "/t.c", line: 1, col: 0 }; },
              statOf: function () { return { kind: "reg" }; },
              openPath: function () { return [TGT]; } };
  const pg = mkpg(d, 1);
  const a = srv.urlOf(pg, "t.c:1"), b = srv.urlOf(pg, "t.c:1"), c = srv.urlOf(pg, "u.c:1");
  check("a repeated reference is followed once", a === b && a === "/repo/cat/t.c#b0" && calls === 1,
        a + " " + b + " calls " + calls);
  check("past the budget a reference paints plain", c === "", c);
}

//  --- theme.js -> CSS ------------------------------------------------------
//  The numbers are theme.js's; only their SPELLING is asserted here.
check("a basic bright code", html.sgrCss("90") === "color:#7f7f7f", html.sgrCss("90"));
check("a basic code", html.sgrCss("32") === "color:#43bc6c", html.sgrCss("32"));
check("a 256 fg", html.sgrCss("38;5;56") === "color:#5f00d7", html.sgrCss("38;5;56"));
check("a 256 bg", html.sgrCss("48;5;157") === "background:#afffaf", html.sgrCss("48;5;157"));
check("bold is a weight", html.sgrCss("1") === "font-weight:bold", html.sgrCss("1"));
check("a 256 fg PLUS bold", html.sgrCss("38;5;33;1") === "color:#0087ff;font-weight:bold",
      html.sgrCss("38;5;33;1"));
check("the grey ramp", html.color256(240) === "#585858", html.color256(240));
check("the cube corner", html.color256(231) === "#ffffff", html.color256(231));

//  ONE stylesheet, and every slot the theme names has a rule in it — no colour
//  is invented here and none is dropped.
const css = html.stylesheet(theme.THEME16);
let missing = "";
for (const tag in theme.THEME16.slots)
  if (css.indexOf(".tok-" + tag + "{") < 0) missing += tag;
check("every theme slot has a rule", missing === "", "missing " + missing);
check("the banner band is spelled", css.indexOf(".banner{color:#000000;background:#ffffd7}") >= 0);
check("the diff wash is spelled",
      css.indexOf(".side-in{background:#afffaf}") >= 0 &&
      css.indexOf(".side-in.pale{background:#d7ffd7}") >= 0 &&
      css.indexOf(".side-rm.pale{background:#ffd7d7}") >= 0 &&
      css.indexOf(".side-rm{background:#ffafaf}") >= 0);
//  LITE-034: the LANDED token of a followed reference wears the theme's band.
check("the landed token has a :target rule",
      css.indexOf("pre.body span:target{color:#000000;background:#ffffd7}") >= 0);
//  A theme swap repaints without touching the painter — that is the whole point
//  of the palette being data.
const dark = html.stylesheet(theme.THEMEDARK);
check("a theme swap changes the sheet", dark !== css && dark.indexOf(".tok-D{color:#585858}") >= 0);

//  --- the landing math (render/wrap.js, shared with pager.js) ------------
//  `int a;\nint b;\nint c;\n`: line 2 starts at byte 7, its line ends at 13.
{
  const t = TGT.text;
  check("line 2 starts at byte 7", wrap.landAt(t, 2, 0).off === 7, JSON.stringify(wrap.landAt(t, 2, 0)));
  check("no column lands on the line start",
        wrap.landAt(t, 2, 0).at === 7 && wrap.landAt(t, 2, 0).oncol === false);
  check("a column lands on its own byte",
        wrap.landAt(t, 2, 5).at === 11 && wrap.landAt(t, 2, 5).oncol === true);
  check("a column past the line end falls back to the line",
        wrap.landAt(t, 2, 99).at === 7 && wrap.landAt(t, 2, 99).oncol === false);
  check("a line past the last one lands nowhere", wrap.landAt(t, 9, 0) === null);
  check("the token covering a byte is bisected",
        wrap.tokSpanAt(TGT, 11).lo === 11 && wrap.tokSpanAt(TGT, 11).hi === 12);
  check("a byte mid-token names that token's whole span",
        wrap.tokSpanAt(TGT, 8).lo === 7 && wrap.tokSpanAt(TGT, 8).hi === 10);
  check("past the last token there is none", wrap.tokSpanAt(TGT, 999) === null);
}

//  --- the painter ----------------------------------------------------------
//  A hand-built hunk in the shape view/list.js emits: a visible span, a hidden
//  `U` target behind it, a newline.
const link = function (t) { return srv.urlOf(mkpg(), t); };

//  `dir a.txt` visible, then the hidden target `cat /w/repo/a.txt`.
const H = hunkOf("dir a.txt" + "cat /w/repo/a.txt" + "\n",
                 [["Q", 4], ["F", 9], ["U", 26], ["S", 27]]);
const out = html.hunkHtml(H, link);
check("the banner is the hunk uri", out.indexOf('<div class="banner">list</div>') >= 0, out);
check("a tag becomes a class", out.indexOf('<span class="tok-Q" id="b0">dir </span>') >= 0, out);
check("the hidden U bytes are NOT painted", out.indexOf("cat /w/repo") < 0, out);
check("the U target becomes the href",
      out.indexOf('<a href="/repo/cat/a.txt"><span class="tok-F" id="b4">a.txt</span></a>') >= 0, out);
check("the body is a pre", out.indexOf('<pre class="body">') >= 0, out);
//  LITE-034: every token span is anchorable by its START BYTE, and a page's
//  later hunks carry the ordinal so `#b<off>` always names the first.
check("a span is anchored by its start byte", out.indexOf(' id="b4">a.txt') >= 0, out);
check("the second hunk's ids carry the ordinal",
      html.hunkHtml(H, link, 1).indexOf(' id="b1-4">a.txt') >= 0, html.hunkHtml(H, link, 1));
check("anchorId spells both forms",
      html.anchorId(0, 54) === "b54" && html.anchorId(2, 54) === "b2-54");

//  A diff hunk: the tok32 SIDE bits become the wash classes, both ways.
//  BEE-021: a whole-line swap SPLITS — the rm row, then the in row, each hiding
//  the other side; the row's '\n' is the row terminator, not a span.
const D = hunkOf("X1X0\n", [["S", 2, 1], ["S", 4, 2], ["S", 5, 0]], "diff");
const dout = html.hunkHtml(D, link);
check("the to-side washes in", dout.indexOf('<span class="tok-S side-in" id="b0">X1</span>') >= 0, dout);
check("the from-side washes out", dout.indexOf('<span class="tok-S side-rm" id="b2">X0</span>') >= 0, dout);
check("a full-line swap splits, rm row first",
      dout.indexOf('id="b2">X0</span>\n<span class="tok-S side-in" id="b0">X1</span>\n') >= 0, dout);
//  A light edit stays ONE row, both sides pale in place; an EQ token takes no wash.
const E = hunkOf("a-b+ and a long unchanged rest\n",
                 [["S", 1, 0], ["S", 2, 2], ["S", 3, 0], ["S", 4, 1], ["S", 31, 0]], "diff");
const eout = html.hunkHtml(E, link);
check("an inline edit paints both sides PALE on one row",
      eout.indexOf('<span class="tok-S side-rm pale" id="b1">-</span>') >= 0 &&
      eout.indexOf('<span class="tok-S side-in pale" id="b3">+</span>') >= 0 &&
      eout.indexOf("\n") === eout.lastIndexOf("\n"), eout);
check("an EQ token takes no wash", eout.indexOf('<span class="tok-S" id="b4"> and a long') >= 0, eout);

//  An `F` token with no `U` behind it IS a reference (LITE-015).  With no door
//  behind the page it resolves to nothing, so it stays PLAIN PAINTED TEXT.
const F = hunkOf("see sub/x.txt\n", [["S", 4], ["F", 13], ["S", 14]], "cat");
check("an unresolvable F token is plain text, not a link",
      html.hunkHtml(F, link).indexOf("<a ") < 0, html.hunkHtml(F, link));
check("and it is still painted", html.hunkHtml(F, link).indexOf('class="tok-F" id="b4">sub/x.txt') >= 0);
//  With a door that answers, the SAME token becomes the resolved link.
{
  const lk = function (t) {
    return srv.urlOf(mkpg(doorOf({ full: ROOT + "/sub/x.txt", line: 0, col: 0 }, "reg", TGT), 8), t);
  };
  check("a resolvable F token becomes the resolved href",
        html.hunkHtml(F, lk).indexOf('<a href="/repo/cat/sub/x.txt">') >= 0, html.hunkHtml(F, lk));
}

//  A hunk with NO toks at all (a blob, an unknown extension) still paints its
//  bytes — escaped, never dropped, and anchorable from byte 0.
const P = { uri: "blob 92ac9c80", verb: "hunk", text: utf8.Encode("a < b & c\n"),
            toks: new Uint32Array(0), kind: "blob" };
const pout = html.hunkHtml(P, link);
check("untokenised bytes still paint", pout.indexOf("a &lt; b &amp; c") >= 0, pout);
check("and they are anchorable", pout.indexOf('id="b0">a &lt; b') >= 0, pout);
check("and nothing is a link there", pout.indexOf("<a ") < 0, pout);
//  Markup in the SOURCE is escaped, never served as markup.
const X = { uri: "cat x.html", verb: "hunk", text: utf8.Encode('<script>"x"</script>'),
            toks: new Uint32Array(0), kind: "cat" };
check("source markup is escaped",
      html.hunkHtml(X, link).indexOf("&lt;script&gt;&quot;x&quot;&lt;/script&gt;") >= 0);

//  The page frame: one stylesheet link, a title, and no chrome around it.
const pg = html.page("cat a.txt", "<b>B</b>");
check("the page links the ONE sheet",
      pg.indexOf('<link rel="stylesheet" href="/style.css">') >= 0, pg);
check("the page carries the title", pg.indexOf("<title>cat a.txt</title>") >= 0, pg);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
