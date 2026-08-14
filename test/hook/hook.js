//  lite/test/hook/hook.js — LITE-026: what the pre-commit hook left behind.
//  Run AFTER a real `git commit` drove `lite hook`, so every assertion is over
//  the COMMITTED blob, not a scratch buffer: a fresh `file:line(:col)` ref is
//  now `file:OFF:HASHLET`, a ref that resolves to nothing is byte for byte what
//  the author typed, and the minted link FOLLOWS back to the line it names —
//  through the door and through a real pty click on the painted token.
//
//  THE ORACLE IS ARITHMETIC, not the code under test: the fixture's lines are
//  16 bytes each and the blob ids come from `git rev-parse`, so the expected
//  permalink is spelled here from first principles.
"use strict";
const pagerlib = require("view/pager.js");
const entry = require("main.js");
const idx = require("index/index.js");
const rd = require("index/read.js");

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

//  ---- the oracle -----------------------------------------------------------
//  ron64 of a byte offset, and the hashlet: the blob sha1 packed 12 bits per
//  PAIR of ron64 chars (3 hex digits a pair, big-endian), extended by 2 until it
//  holds a non-digit AND no OTHER blob of that path shares the prefix.
function ron64(v) { const s = ron.encode(BigInt(v)); return s === "" ? "0" : s; }
function pair(hex3) { return ron.encode(BigInt(parseInt(hex3, 16))).padStart(2, "0"); }
function mint(sha, others) {
  for (let pairs = 2; pairs <= 5; pairs++) {
    const hexn = pairs * 3;
    let h = "";
    for (let i = 0; i < pairs; i++) h += pair(sha.slice(i * 3, i * 3 + 3));
    let nondigit = false;
    for (const c of h) if (c < "0" || c > "9") nondigit = true;
    if (!nondigit) continue;
    let clash = false;
    for (const o of others || [])
      if (o !== sha && o.slice(0, hexn) === sha.slice(0, hexn)) clash = true;
    if (!clash) return h;
  }
  return "";
}

const FIX = io.getenv("LITE_FIX");
const B_FSW = io.getenv("LITE_BFSW"), B_TCP0 = io.getenv("LITE_BTCP0"),
      B_TCP1 = io.getenv("LITE_BTCP1");
const LINE = 16;                                   // every fixture line is 16 bytes
const H_FSW = mint(B_FSW, []), H_TCP = mint(B_TCP1, [B_TCP0]);
//  `:20` is line 20 column 1; `:20:5` the same line, byte column 5.
const P_FSW20  = "src/abc/FSW.c:" + ron64(19 * LINE) + ":" + H_FSW;
const P_FSW20C = "src/abc/FSW.c:" + ron64(19 * LINE + 4) + ":" + H_FSW;
const P_FSW7   = "src/abc/FSW.c:" + ron64(6 * LINE) + ":" + H_FSW;
const P_TCP41  = "src/abc/TCP.c:" + ron64(40 * LINE) + ":" + H_TCP;
w1("#    minted " + P_FSW20 + "  " + P_TCP41 + "\n");

//  ---- the committed blobs --------------------------------------------------
function committed(rel) {
  const ctx = idx.openRepo(FIX, true);
  try {
    const m = idx.readCommit(ctx.r, ctx.head.sha);
    const e = rd.entryAt(ctx.r, m.tree, rel);
    if (e === null || e.dir) return null;
    const o = idx.object(ctx.r, e.sha);
    return o === null || o.type !== "blob" ? null : utf8.Decode(o.bytes);
  } finally { idx.closeRepo(ctx); }
}
const NEW = (committed("doc/new.mkd") || "").split("\n");
const OLD = (committed("doc/old.mkd") || "").split("\n");

check("a fresh `file:line` ref is COMMITTED as a permalink",
      NEW[0] === "see " + P_FSW20 + " for the anchor", NEW[0]);
check("...and a `file:line:col` one keeps the column in the byte offset",
      NEW[1] === "and " + P_FSW20C + " with a column", NEW[1]);
check("a ref no file answers is left exactly as typed",
      NEW[2] === "gone no/such/file.c:3 resolves to nothing", NEW[2]);
check("a line PAST the end of the target is left exactly as typed",
      NEW[3] === "past src/abc/FSW.c:999 is off the end", NEW[3]);
check("a SELF-link is left exactly as typed (rewriting moves what it names)",
      NEW[4] === "self doc/new.mkd:2 names this very file", NEW[4]);
check("a path naming TWO files is left exactly as typed — no guessing",
      NEW[5] === "many TCP.c:5 names two files at once", NEW[5]);
check("a ref to a line only the STAGED blob has is minted off that blob",
      NEW[6] === "plus " + P_TCP41 + " from the staged blob", NEW[6]);

check("committed text is NEVER rewritten — the old ref stands",
      OLD[1] === "old ref src/abc/FSW.c:3 stays", OLD[1]);
check("...while the line this commit ADDED to the same file is minted",
      OLD[3] === "new ref " + P_FSW7 + " here", OLD[3]);

//  the rewrite is on disk too, not only in the index — the tree is clean.
function wt(rel) {
  try { return utf8.Decode(io.mmap(FIX + "/" + rel, "r").data()); } catch (e) { return ""; }
}
check("the worktree carries the same bytes the commit does",
      wt("doc/new.mkd") === NEW.join("\n"), wt("doc/new.mkd").split("\n")[0]);

//  ---- the lexer still sees ONE token ---------------------------------------
const src = utf8.Encode(NEW[0] + "\n");
const lex = (function () {
  let toks;
  try { toks = tok.parse(src, "mkd"); } catch (e) { return []; }
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (tag(toks[i]) !== "F") continue;
    const lo = i > 0 ? (toks[i - 1] & 0xffffff) : 0, hi = toks[i] & 0xffffff;
    out.push(utf8.Decode(src.slice(lo, hi)));
  }
  return out;
})();
check("the minted ref lexes as ONE F token, as the ref it replaced did",
      lex.length === 1 && lex[0] === P_FSW20, lex.join(" "));

//  ---- the FOLLOW: the minted link lands where the author meant -------------
const a20 = entry.openTarget(P_FSW20);
check("the minted permalink opens the file it names",
      a20 !== null && a20.length === 1 && ends(a20[0].uri, "/src/abc/FSW.c"),
      a20 === null ? "null" : a20[0].uri);
check("...on the very line the `:20` ref meant",
      a20 !== null && a20.land && a20.land.line === 20 && a20.land.col === 1,
      a20 === null ? "null" : JSON.stringify(a20.land || null));
const a20c = entry.openTarget(P_FSW20C);
check("...and the column ref on that line's column 5",
      a20c !== null && a20c.land && a20c.land.line === 20 && a20c.land.col === 5,
      a20c === null ? "null" : JSON.stringify(a20c.land || null));
const a41 = entry.openTarget(P_TCP41);
check("the staged-blob permalink follows to the line that commit added",
      a41 !== null && ends(a41[0].uri, "/src/abc/TCP.c") && a41.land &&
      a41.land.line === 41, a41 === null ? "null" : JSON.stringify(a41.land || null));
const a7 = entry.openTarget(P_FSW7);
check("the ref minted in an EDITED file follows too",
      a7 !== null && a7.land && a7.land.line === 7,
      a7 === null ? "null" : JSON.stringify(a7.land || null));

//  ---- the REAL click on the committed page ---------------------------------
//  The page opens through the door exactly as `lite doc/new.mkd` opens it, and
//  the press is a real SGR sequence on a `tty.openpty()` slave.
const page = entry.openTarget(FIX + "/doc/new.mkd");
check("the committed page opens as a file view", page !== null && page.length === 1,
      page === null ? "null" : "hunks " + page.length);

const R = {};
if (page !== null) {
  const pty = tty.openpty();
  tty.setSize(pty.slave, 14, 110);
  const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
  p.setHunks(page, "doc/new.mkd");
  const rb = io.buf(1 << 16);
  const drain = function () {
    rb.reset(); const k = io.read(pty.master, rb);
    return k > 0 ? utf8.Decode(rb.data().slice()) : "";
  };
  const kbuf = io.buf(64);
  const send = function (s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); };
  const krb = io.buf(64);
  const pump = function (done, tries) {
    for (let r = 0; r < (tries || 40); r++) {
      krb.reset();
      const m = io.read(pty.slave, krb);
      if (m > 0) p._feed(krb.data().slice());
      if (done()) return true;
    }
    return done();
  };
  const saved = tty.raw(pty.slave);
  try {
    R.base = (p.render(), drain());
    //  screen row 1 is the banner band, so the first ref line sits on row 2;
    //  `see ` is four bytes, so the token starts at column 5.
    send(ESC + "[<0;6;2M");
    R.pushed = pump(function () { return p.stack.length === 1; });
    R.uri = p.stack.length ? p.view.hunks[0].uri : "";
    R.frame = (p.render(), drain());
    //  a click on the SELF-link row (row 6) opens nothing: it is still a plain
    //  `:line` ref into this very page, so it lands here, not elsewhere.
    R.selfRow = 6;
  } finally { tty.cook(pty.slave, saved); io.close(pty.master); io.close(pty.slave); }
}
check("the permalink paints on the page", (R.base || "").indexOf(P_FSW20) >= 0,
      (R.base || "").split("\r\n")[1] || "");
check("a real click on it pushes the file it names", !!R.pushed && ends(R.uri, "/src/abc/FSW.c"),
      String(R.uri));
check("...with the anchored line on the page", (R.frame || "").indexOf("FSWMARK020") >= 0,
      (R.frame || "").split("\r\n")[3] || "");

w1((bad ? "FAIL " : "PASS ") + "[lite/hook] " + n + " checks, " + bad + " bad\n");
if (bad) throw "HOOK";
