//  lite/test/perma/pty.js — LITE-025: a PERMALINK follows to the anchored line.
//  `src/abc/FSW.c:4p:0dK2` is ONE `F` token (DOG-034 fuses both ron64 segments);
//  segment 1 is a BYTE OFFSET into the anchored BLOB, segment 2 that BLOB's
//  hashlet — a blob id prefix and nothing else.  Later commits move that line — the follow still lands on
//  it, and a line later DELETED lands where it stood, with the bar saying so.
//
//  The REAL UI path: a hunk painted on a `tty.openpty()` slave by the shipped
//  Pager, a real SGR press written to the master, the pushed view's FRAME and
//  status bar asserted.  Stepped, not run(): a self-pty has no concurrent
//  reader, so a render is followed by a blocking drain.
//
//  MINTING IS NOT UNDER TEST (another ticket): the anchors here are built from
//  the fixture's own arithmetic — 16-byte lines, `git rev-parse` blob ids.
"use strict";
const pagerlib = require("view/pager.js");
const entry = require("main.js");
const pm = require("index/perma.js");

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}
const tag = (t) => String.fromCharCode(65 + ((t >>> 27) & 0x1f));
const ends = (s, tail) => typeof s === "string" && s.slice(-tail.length) === tail;

//  ---- the anchors ----------------------------------------------------------
//  ron64 of a number, and the hashlet: the sha1 hex packed 12 bits per PAIR of
//  ron64 chars (3 hex digits a pair, big-endian), extended by 2 until it holds
//  a non-digit — which is what makes segment 2 read as a hashlet, not a column.
function ron64(v) { const s = ron.encode(BigInt(v)); return s === "" ? "0" : s; }
function pair(hex3) { return ron.encode(BigInt(parseInt(hex3, 16))).padStart(2, "0"); }
function mint(sha) {
  let h = "";
  for (let i = 0; i < 5; i++) {
    h += pair(sha.slice(i * 3, i * 3 + 3));
    if (h.length < 4) continue;
    let nondigit = false;
    for (const c of h) if (c < "0" || c > "9") nondigit = true;
    if (nondigit) return h;
  }
  return h;
}
const R0 = io.getenv("LITE_R0"), R2 = io.getenv("LITE_R2");
const B0 = io.getenv("LITE_B0"), BT = io.getenv("LITE_BT"), BW = io.getenv("LITE_BW");
const H0 = mint(B0), HT = mint(BT);
const LINE = 16;                                   // every fixture line is 16 bytes
//  line 20 col 5 of r0's blob, and line 7 col 5 — the one r2 deletes.
const OFF20 = 19 * LINE + 4, OFF7 = 6 * LINE + 4;
const ANCHOR = ":" + ron64(OFF20) + ":" + H0;
const TANCHOR = ":" + ron64(OFF20) + ":" + HT;
const PERMA20 = "src/abc/FSW.c" + ANCHOR;
const PERMA7  = "src/abc/FSW.c:" + ron64(OFF7)  + ":" + H0;
const PERMAMANY = "TCP.c" + TANCHOR;             // two files carry that blob
const PERMABAD = "src/abc/FSW.c:" + ron64(OFF20) + ":~~~~";   // no blob carries it
w1("#    anchors " + PERMA20 + "  " + PERMA7 + "\n");

//  ---- the parse forms ------------------------------------------------------
//  The split is the ONE point (LITE-024's `splitRef`); segment 2 decides.
const S = entry.splitRef;
const f1 = S("a/b.c:123");
check("`:123` is a LINE", f1.path === "a/b.c" && f1.line === 123 && f1.col === 0 && !f1.hash,
      JSON.stringify(f1));
const f2 = S("a/b.c:123:45");
check("`:123:45` is line:col", f2.path === "a/b.c" && f2.line === 123 && f2.col === 45 && !f2.hash,
      JSON.stringify(f2));
const f3 = S("a/b.c:k4:d8K3");
check("`:k4:d8K3` is a PERMALINK", f3.path === "a/b.c" && f3.off === "k4" &&
      f3.hash === "d8K3" && f3.line === 0, JSON.stringify(f3));
check("...and it keeps the whole tail for the chooser", f3.tail === ":k4:d8K3", f3.tail);
const f4 = S("a/b.c:0123:4567");
check("an ALL-DIGIT segment 2 stays line:col", f4.line === 123 && f4.col === 4567 && !f4.hash,
      JSON.stringify(f4));
const f5 = S("a/b.c:");
check("a lone trailing colon is no anchor at all", f5.path === "a/b.c:" && !f5.line && !f5.hash,
      JSON.stringify(f5));
const f6 = S("a/b.c:k4");
check("ONE non-digit segment is no anchor (a hashlet needs an offset)",
      f6.path === "a/b.c:k4" && !f6.line && !f6.hash, JSON.stringify(f6));
const f7 = S("a/b.c:12:ab");
check("an ODD-length segment 2 is no hashlet", f7.path === "a/b.c:12:ab" && !f7.hash,
      JSON.stringify(f7));

//  the earliest-match rule: two commits sharing a hashlet resolve to the OLDER,
//  so a link minted long ago never re-points at a newer namesake.
const cands = [{ sha: "bbbbbbbb", ts: 200 }, { sha: "aaaaaaaa", ts: 100 },
               { sha: "cccccccc", ts: 300 }];
check("a hashlet collision resolves to the EARLIEST commit",
      pm.earliest(cands).sha === "aaaaaaaa", JSON.stringify(pm.earliest(cands)));

//  ---- the DOOR: the permalink resolves, the landing rides back -------------
const at = entry.openTarget(PERMA20);
check("a permalink opens the file it names", at !== null && at.length === 1,
      at === null ? "null" : "hunks " + at.length);
check("...the one the FSEG descent named, anchor SHED",
      at !== null && ends(at[0].uri, "/src/abc/FSW.c"), at === null ? "null" : at[0].uri);
//  r1 prepended 5 lines and r2 deleted one above it: the line anchored at r0 as
//  line 20 is line 24 today.
check("...LANDED on the line the later commits MOVED",
      at !== null && at.land && at.land.line === 24 && at.land.col === 5,
      at === null ? "null" : JSON.stringify(at.land || null));
check("...with no note — the line is alive", at !== null && at.land && !at.land.note,
      at === null ? "null" : String(at.land && at.land.note));

//  the tombed leg: r2 deleted the anchored line; the follow lands where it
//  stood (now line 12) and the bar says which commit took it.
const tomb = entry.openTarget(PERMA7);
check("a permalink to a DELETED line still opens the file", tomb !== null && tomb.length === 1,
      tomb === null ? "null" : "hunks " + tomb.length);
check("...landing on the nearest surviving neighbour", tomb !== null && tomb.land &&
      tomb.land.line === 12, tomb === null ? "null" : JSON.stringify(tomb.land || null));
check("...and saying, in plain words, which commit deleted it",
      tomb !== null && tomb.land && tomb.land.note === "deleted in " + R2.slice(0, 8),
      tomb === null ? "null" : String(tomb.land && tomb.land.note));

//  a hashlet no commit carries, and an offset past the blob: quiet misses.
check("a hashlet no version of the file carries is a quiet miss",
      entry.openTarget(PERMABAD) === null, "opened");
check("an offset past the anchored blob is a quiet miss",
      entry.openTarget("src/abc/FSW.c:" + ron64(99999) + ":" + H0) === null, "opened");
check("a permalink on a path nothing names is a quiet miss",
      entry.openTarget("nosuch/gone.c:" + ron64(OFF20) + ":" + H0) === null, "opened");

//  a bare `:line` on the SAME file is untouched by any of this.
const plain = entry.openTarget("src/abc/FSW.c:24");
check("a plain `:line` ref still lands as LITE-024 left it",
      plain !== null && plain.land && plain.land.line === 24 && plain.land.col === 0,
      plain === null ? "null" : JSON.stringify(plain.land || null));

//  ---- the SCOPE: this file's blobs, then its working blob ------------------
//  The working copy's own blob: net/TCP.c is edited and NOT committed, so its
//  blob id lives in no commit at all — it resolves against the working version.
check("lite spells a git blob id the way git does",
      pm.blobIdOf(io.mmap(io.getenv("LITE_FIX") + "/net/TCP.c", "r").data()) === BW, BW);
const WORK20 = "net/TCP.c:" + ron64(OFF20) + ":" + mint(BW);
const work = entry.openTarget(WORK20);
check("a WORKTREE-only blob anchor opens the file", work !== null && work.length === 1,
      work === null ? "null" : "hunks " + work.length);
check("...landing on the working version directly",
      work !== null && work.land && work.land.line === 20 && work.land.col === 5,
      work === null ? "null" : JSON.stringify(work.land || null));

//  EARLIEST-MATCH, for real: src/abc/TCP.c left its r0 blob at r3 and came back
//  to it at r4, so ONE blob id answers at two points of the path's history.
function seatOf(link) {
  const r = S(link);
  return pm.follow(r.path, r.off, r.hash, io.getenv("LITE_FIX"));
}
const twice = seatOf("src/abc/TCP.c" + TANCHOR);
check("a blob the path carries TWICE anchors at the EARLIER commit",
      twice !== null && twice.anchor === R0.slice(0, 8),
      twice === null ? "null" : twice.anchor);
check("...off the path's own blob history, not the working copy",
      twice !== null && twice.tier === "blob", twice === null ? "null" : twice.tier);
check("...and the uncommitted one off the working copy",
      seatOf(WORK20) !== null && seatOf(WORK20).tier === "work",
      String(seatOf(WORK20) && seatOf(WORK20).tier));

//  ---- the CHOOSER keeps the anchor ----------------------------------------
//  The bare `TCP.c` names two files and BOTH carry the anchored commit, so the
//  chooser stands — with the anchor on every row, as LITE-024 does for a line.
const many = entry.openTarget(PERMAMANY);
check("an AMBIGUOUS permalink is ONE chooser hunk",
      many !== null && many.length === 1 && many[0].kind === "chooser",
      many === null ? "null" : many[0].kind + " x" + many.length);
check("...bannered with the anchor AS TYPED",
      many !== null && many[0].uri === PERMAMANY, many === null ? "null" : many[0].uri);
function uTexts(hunk) {
  const out = [];
  for (let i = 0; i < hunk.toks.length; i++) {
    if (tag(hunk.toks[i]) !== "U") continue;
    const lo = i > 0 ? (hunk.toks[i - 1] & 0xffffff) : 0, hi = hunk.toks[i] & 0xffffff;
    out.push(utf8.Decode(hunk.text.slice(lo, hi)));
  }
  return out;
}
const us = many === null ? [] : uTexts(many[0]);
check("...and every chooser row CARRIES the anchor",
      us.length === 2 && ends(us[0], "/net/TCP.c" + TANCHOR) &&
      ends(us[1], "/src/abc/TCP.c" + TANCHOR), us.join(" "));

//  ---- the LEXER fuses both segments into ONE F token ----------------------
const src = utf8.Encode("/* see " + PERMA20 + " here */\n");
const lex = (function () {
  let toks;
  try { toks = tok.parse(src, "c"); } catch (e) { return []; }
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (tag(toks[i]) !== "F") continue;
    const lo = i > 0 ? (toks[i - 1] & 0xffffff) : 0, hi = toks[i] & 0xffffff;
    out.push(utf8.Decode(src.slice(lo, hi)));
  }
  return out;
})();
check("the lexer fuses `path:off:hashlet` into ONE F token",
      lex.length === 1 && lex[0] === PERMA20, lex.join(" "));

//  ---- the REAL click ------------------------------------------------------
//  Every line opens with the same 7-byte prefix, so the ref starts at COLUMN 8.
const REFS = [PERMA20, PERMA7, PERMAMANY, PERMABAD];
const COL = 8;
function refHunk(uriStr, refs) {
  let text = "";
  const tagAt = [];
  for (const r of refs) {
    text += "/* see ";
    tagAt.push(["C", utf8.Encode(text).length]);
    text += r;
    tagAt.push(["F", utf8.Encode(text).length]);
    text += " */\n";
    tagAt.push(["C", utf8.Encode(text).length]);
  }
  const toks = new Uint32Array(tagAt.length);
  for (let i = 0; i < tagAt.length; i++)
    toks[i] = (((tagAt[i][0].charCodeAt(0) - 65) & 0x1f) << 27) | (tagAt[i][1] & 0xffffff);
  return { uri: uriStr, verb: "hunk", text: utf8.Encode(text), toks: toks, kind: "file" };
}
const h = refHunk("see.c", REFS);

const pty = tty.openpty();
tty.setSize(pty.slave, 14, 100);
const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
p.setHunks([h], "see.c");
const rb = io.buf(1 << 16);
function drain() { rb.reset(); const k = io.read(pty.master, rb); return k > 0 ? utf8.Decode(rb.data().slice()) : ""; }
const kbuf = io.buf(64);
function send(s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); }
const krb = io.buf(64);
function pump(done, tries) {
  for (let r = 0; r < (tries || 40); r++) {
    krb.reset();
    const m = io.read(pty.slave, krb);
    if (m > 0) p._feed(krb.data().slice());
    if (done()) return true;
  }
  return done();
}
function click(row, col) { send(ESC + "[<0;" + col + ";" + row + "M"); }
function frame() { p.render(); return drain(); }
function frameRow(f, i) { return f.split("\r\n")[i] || ""; }
function bar(f) { const l = f.split("\r\n"); return l[l.length - 1] || ""; }

const saved = tty.raw(pty.slave);
const R = {};
try {
  R.base = frame();
  //  screen row 1 is the banner band, so ref line i sits on row i+1.
  click(2, COL + 1);
  R.landed = pump(function () { return p.stack.length === 1; });
  R.landScroll = p.view.scroll;
  R.landCur = p.view.cur ? p.view.cur.row : -1;
  R.landFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  //  the `:` bar rides the SAME door — a typed permalink lands identically.
  send(":" + PERMA20 + "\r");
  R.barPushed = pump(function () { return p.stack.length === 1; });
  R.barScroll = p.view.scroll;
  R.barFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(3, COL + 1);
  R.tombPushed = pump(function () { return p.stack.length === 1; });
  R.tombScroll = p.view.scroll;
  R.tombFrame = frame();
  send("-"); pump(function () { return p.stack.length === 0; });

  click(4, COL + 1);
  R.chooserPushed = pump(function () { return p.stack.length === 1; });
  R.chooserFrame = frame();
  //  the chooser's row 2 (screen row 3) is the SECOND candidate, src/abc/TCP.c
  click(3, 1);
  R.chosen = pump(function () { return p.stack.length === 2; });
  R.chosenUri = p.view.hunks[0].uri;
  R.chosenScroll = p.view.scroll;
  R.chosenFrame = frame();
  send("-"); pump(function () { return p.stack.length === 1; });
  send("-"); pump(function () { return p.stack.length === 0; });

  click(5, COL + 1);
  R.missMsg = pump(function () { return p.message !== ""; }) ? p.message : "";
  R.missDepth = p.stack.length;
  R.missFrame = frame();
} finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }

check("the permalink lines paint", R.base.indexOf(PERMA20) >= 0, frameRow(R.base, 1));
check("a click on a permalink pushed a view", R.landed, "stack depth");
//  the landed line sits 1/4 down the 12-row page.
check("...SCROLLED to 1/4 above the MOVED line", R.landScroll === 21, "scroll " + R.landScroll);
check("...so the anchored line is the 4th body row",
      frameRow(R.landFrame, 3).indexOf("FSWMARK020") >= 0, frameRow(R.landFrame, 3));
check("...the CURSOR parked on it", R.landCur === 24, "cur.row " + R.landCur);

check("a permalink TYPED on the `:` bar lands the same way",
      R.barPushed && R.barScroll === 21, "scroll " + R.barScroll);
check("...on the same line", frameRow(R.barFrame, 3).indexOf("FSWMARK020") >= 0,
      frameRow(R.barFrame, 3));

check("a click on a TOMBED permalink still opens the file", R.tombPushed, "stack depth");
check("...landed where the deleted line stood", R.tombScroll === 9, "scroll " + R.tombScroll);
check("...the surviving neighbour on the 4th body row",
      frameRow(R.tombFrame, 3).indexOf("FSWMARK008") >= 0, frameRow(R.tombFrame, 3));
check("...and the BAR says it was deleted, in plain words",
      R.tombFrame.indexOf("deleted in " + R2.slice(0, 8)) >= 0, bar(R.tombFrame));

check("a click on an AMBIGUOUS permalink pushed the chooser", R.chooserPushed, "stack depth");
check("...bannered with the anchor as typed",
      frameRow(R.chooserFrame, 0).indexOf(PERMAMANY) >= 0, frameRow(R.chooserFrame, 0));
check("...with the anchored row targets HIDDEN (no absolute path paints)",
      R.chooserFrame.indexOf(io.getenv("LITE_FIX") + "/") < 0, frameRow(R.chooserFrame, 1));
check("a click on a chooser row follows THAT file's anchor", R.chosen, "stack depth");
check("...the second candidate, as chosen", ends(R.chosenUri, "/src/abc/TCP.c"), R.chosenUri);
//  that file no later commit touched: the anchored line is still line 20.
check("...LANDED on line 20, the anchor the row carried", R.chosenScroll === 17,
      "scroll " + R.chosenScroll);
check("...so line 20 is the 4th body row",
      frameRow(R.chosenFrame, 3).indexOf("TCPMARK020") >= 0, frameRow(R.chosenFrame, 3));

check("a permalink nothing answers opens nothing", R.missDepth === 0, "stack " + R.missDepth);
check("...and says so in plain words, the anchor as written",
      R.missMsg === "cannot open " + PERMABAD, R.missMsg);
check("...on the status bar", R.missFrame.indexOf("cannot open " + PERMABAD) >= 0,
      bar(R.missFrame));

w1((bad ? "FAIL " : "PASS ") + "[lite/perma] " + n + " checks, " + bad + " bad\n");
if (bad) throw "PERMA";
