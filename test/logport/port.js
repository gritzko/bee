//  bee/test/logport/port.js — BEE-020, the leg the shell cannot see: what a log
//  hunk CARRIES.  The sha8's hidden `commit <hex>` target, the `F` span the
//  DOG-034 lexer mints over a ticket code in a summary, the hunk's own `pos`
//  (the repo it walked, which is the SUB for a descended log), the door opening
//  both of those in that ambient, and the http href a sub page's row gets.
"use strict";
const lg = require("view/log.js");
const door = require("door.js");
const mnt = require("index/mount.js");
const httpjs = require("http.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const PAR = io.getenv("BEE_PAR"), SUB = io.getenv("BEE_SUB");
const P2 = io.getenv("BEE_P2"), S2 = io.getenv("BEE_S2");

//  A hunk's spans as [{ tag, lo, hi, text }] — the tok32 stream, decoded.
function spansOf(h) {
  const out = [];
  let prev = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const tag = String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f));
    const end = h.toks[i] & 0xffffff;
    out.push({ tag: tag, lo: prev, hi: end, text: utf8.Decode(h.text.slice(prev, end)) });
    prev = end;
  }
  return out;
}

//  --- 1. the DESCENDED log: the sub's own history, in the sub's ambient ------
const dh = lg.view("sub/g.txt", { from: PAR });
check("a descended log builds one hunk", dh.length === 1, dh.length + " hunks");
const d0 = dh[0];
check("the descended hunk names the SUB as its pos",
      d0.pos !== undefined && d0.pos !== null && d0.pos.repo === SUB,
      d0.pos ? d0.pos.repo : "no pos");
check("the banner keeps the spelling typed", d0.uri === "log sub/g.txt", d0.uri);

const ds = spansOf(d0);
//  LITE-007 addresses a row by its own hashlet60 (15 hex), which the ODB takes
//  as an object name like any other 6..40 hexlet.
const dU = ds.length > 1 && ds[1].tag === "U" ? ds[1].text : "";
check("the sha8 still carries a hidden `commit <hex>` target",
      dU.indexOf("commit ") === 0 && dU.length === 7 + 15, dU);
check("that target is the SUB's own tip commit",
      dU === "commit " + S2.slice(0, 15), dU);

//  The row opens in the SUB's ambient, which is the whole point: the same
//  target read in the PARENT names no commit there.
const inSub = door.openTarget(dU, d0.pos);
check("the door opens a descended row's commit IN THE SUB",
      inSub !== null && inSub.length > 0 &&
      utf8.Decode(inSub[0].text.slice(0, 47)) === "commit " + S2,
      inSub === null ? "null" : utf8.Decode(inSub[0].text.slice(0, 47)));
const inPar = door.openTarget(dU, { repo: PAR, path: "", anchor: "" });
check("the same target in the PARENT's ambient names no commit there",
      inPar === null, inPar === null ? "null" : inPar.length + " hunks");

//  --- 2. `log <sub>` alone: the sub's whole history --------------------------
const wh = lg.view("sub", { from: PAR, full: true });
check("log <sub> is the sub's own whole log",
      wh.length === 1 && wh[0].pos.repo === SUB &&
      utf8.Decode(wh[0].plain).split("\n").length - 1 === 3,
      wh.length ? wh[0].pos.repo + " / " + utf8.Decode(wh[0].plain) : "no hunk");

//  --- 3. the ticket code in a summary is an `F` span -------------------------
const ph = lg.view("", { from: PAR, full: true });
check("the parent log builds one hunk", ph.length === 1, ph.length + " hunks");
const ps = spansOf(ph[0]);
let f = null;
for (const s of ps) if (s.tag === "F" && s.text === "TKT-12") { f = s; break; }
check("a ticket code in a summary is its own `F` span", f !== null,
      ps.map(function (s) { return s.tag; }).join(""));
//  The tail after the code stays plain text in the summary's own slot.
if (f !== null) {
  let tail = "";
  for (const s of ps) if (s.lo === f.hi) { tail = s.text; break; }
  check("the summary tail after the code stays a plain span",
        tail === ": parent edit", tail);
}
//  The `F` bytes ARE the target: the door resolves the code to its ticket file
//  through door.ticketPaths, in the hunk's own ambient.
const tk = door.openTarget("TKT-12", ph[0].pos);
check("the door opens the ticket the code names", tk !== null && tk.length > 0 &&
      String(tk[0].uri).indexOf("TKT-12.mkd") >= 0,
      tk === null ? "null" : String(tk[0].uri));
//  The parent log's own pos is the PARENT (no descent happened).
check("an undescended log's pos is the repo it walked",
      ph[0].pos.repo === PAR, ph[0].pos.repo);

//  --- 4. `?<rev>`: the tip is the ref's, and it is brought up ----------------
const sx = io.getenv("BEE_SX");
const rh = lg.view("?side", { from: PAR, full: true });
const rs = spansOf(rh[0]);
check("log ?<ref> seeds the walk on THAT ref's tip",
      rs.length > 1 && rs[1].text === "commit " + sx.slice(0, 15),
      rs.length > 1 ? rs[1].text : "no target");

//  --- 5. BEE-020:55:Lc the http href of a SUB page's commit row -----------------
//  A page served under `/<par>/log/sub/g.txt` runs the view in the sub and
//  carries `prefix = "sub"`; its rows' hrefs must land in the sub too, which
//  they only do if the hexlet takes that prefix AND the router re-roots it.
const pg = { root: SUB, name: "par", prefix: "sub", door: door,
             refs: new Map(), hunks: new Map(), left: 64, rev: "" };
const href = httpjs.urlOf(pg, dU);
check("a sub page's commit row hrefs through the sub's prefix",
      href === "/par/commit/sub/" + S2.slice(0, 15), href);
check("the router re-roots <prefix>/<hexlet> at the sub",
      mnt.serves(PAR, "sub/" + S2.slice(0, 15)) === SUB,
      String(mnt.serves(PAR, "sub/" + S2.slice(0, 15))));

//  --- 6. a missing path is an empty log (test/index/run.sh:181:ZR stands) ------
let words = "", hs = null;
try { hs = lg.view("nosuch.c", { from: PAR }); } catch (e) { words = String(e); }
check("a path no tree and no worktree holds is an empty log, no throw",
      words === "" && hs !== null && hs.length === 0, words || String(hs));

w1((bad ? "FAILED " + bad + " of " : "DONE ") + n + " checks\n");
