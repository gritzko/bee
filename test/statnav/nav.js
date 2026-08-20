//  bee/test/statnav/nav.js — BEE-046: a status row's FILE NAME is the click
//  target, and what it opens is the FILE.  Three legs over one fixture: the
//  `U` hangs off the NAME token (read by the pager's own `_targetAt`), the nav
//  verb per row class, and the target itself — the whole worktree file with
//  its wt-vs-HEAD spans washed, both sides of a conflict included.
//  $BEE_FIX names the fixture worktree.
"use strict";
const st = require("view/status.js");
const door = require("door.js");
const wrap = require("render/wrap.js");
const html = require("render/html.js");
const srv = require("http.js");
const pagerlib = require("pager.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
const FIX = io.getenv("BEE_FIX");
const view = st.status("", { from: FIX });
const H = view.hunks[0];
const targetAt = function (off) {
  return pagerlib.Pager.prototype._targetAt.call({}, H, off);
};

//  The row for `path`, plus the byte span its NAME token covers in the hunk.
function rowOf(path) {
  for (const r of view.rows) if (!r.commit && r.text === path) return r;
  return null;
}
function nameSpan(path) {
  let lo = 0;
  for (let i = 0; i < H.toks.length; i++) {
    const hi = wrap.TOK_END(H.toks[i]), tag = wrap.TOK_TAG(H.toks[i]);
    const txt = utf8.Decode(H.text.slice(lo, hi));
    if (txt === path && (tag === "F" || tag === "N"))
      return { lo: lo, hi: hi, next: i + 1 < H.toks.length ? wrap.TOK_TAG(H.toks[i + 1]) : "" };
    lo = hi;
  }
  return null;
}

//  --- leg 1: the CLICK lands on the NAME ------------------------------------
const CLASSES = ["mod.txt", "st.txt", "add.txt", "del.txt", "con.txt", "new.txt"];
for (const p of CLASSES) {
  const r = rowOf(p), sp = nameSpan(p);
  check("the row for " + p + " is there", r !== null && sp !== null,
        r === null ? "no row" : "no name token");
  if (r === null || sp === null) continue;
  check("...its NAME token is followed by the hidden `U`", sp.next === "U", sp.next);
  check("...a click on the name's FIRST byte follows the row's nav",
        targetAt(sp.lo) === r.nav, targetAt(sp.lo));
  check("...and on its LAST byte too — the whole name is the target",
        targetAt(sp.hi - 1) === r.nav, targetAt(sp.hi - 1));
}

//  --- leg 2: the nav VERB per row class -------------------------------------
//  A path git never saw opens `cat`; everything else opens the washed file.
function verbOf(path) {
  const r = rowOf(path);
  if (r === null) return "";
  const sp = r.nav.indexOf(" ");
  return sp < 0 ? r.nav : r.nav.slice(0, sp);
}
function argOf(path) {
  const r = rowOf(path);
  return r === null ? "" : r.nav.slice(r.nav.indexOf(" ") + 1);
}
check("an untracked row opens `cat`", verbOf("new.txt") === "cat", verbOf("new.txt"));
for (const p of ["mod.txt", "st.txt", "add.txt", "del.txt", "con.txt"])
  check("a CHANGED row (" + p + ") opens `dog`", verbOf(p) === "dog", verbOf(p));
check("...and the arg is the path, absolute",
      argOf("mod.txt") === FIX + "/mod.txt", argOf("mod.txt"));

//  --- leg 3: what the target SHOWS ------------------------------------------
function open(spell) {
  const sp = spell.indexOf(" ");
  const v = door.verbOf(spell.slice(0, sp));
  if (v === null) return null;
  return v(spell.slice(sp + 1), { from: FIX });
}
function bodyOf(hunks) {
  let s = "";
  for (const h of hunks) s += utf8.Decode(h.text);
  return s;
}
//  Every token of `hunks` whose tok32 side bit says it is washed.
function washed(hunks, side) {
  const out = [];
  for (const h of hunks) {
    let lo = 0;
    for (let i = 0; i < h.toks.length; i++) {
      const hi = wrap.TOK_END(h.toks[i]);
      if (wrap.TOK_SIDE(h.toks[i]) === side) out.push(utf8.Decode(h.text.slice(lo, hi)));
      lo = hi;
    }
  }
  return out.join("");
}
let hs = null, threw = "";
try { hs = open(rowOf("mod.txt").nav); } catch (e) { threw = String(e); }
check("the changed row's target OPENS", hs !== null && hs.length > 0, threw);
if (hs !== null && hs.length) {
  const body = bodyOf(hs);
  check("...the WHOLE file is there, not a hunk window",
        body.indexOf("m1") >= 0 && body.indexOf("m3") >= 0 && body.indexOf("m9") >= 0,
        JSON.stringify(body));
  check("...the worktree's own new bytes ride the IN wash",
        washed(hs, wrap.SIDE_IN).indexOf("MODIFIED") >= 0, washed(hs, wrap.SIDE_IN));
  check("...and what HEAD had rides the RM wash",
        washed(hs, wrap.SIDE_RM).indexOf("m2") >= 0, washed(hs, wrap.SIDE_RM));
  const pl = hs[0].plain === undefined ? "" : utf8.Decode(hs[0].plain);
  check("...no SGR ever reaches the plain bytes",
        pl.indexOf(String.fromCharCode(27)) < 0 && pl.indexOf("m1") >= 0, JSON.stringify(pl));
  //  BEE-021's classes, the http twin of the same wash — no second palette.
  const doc = html.hunkHtml(hs[0], null, 0, "");
  check("...and the http side paints it with the existing wash classes",
        doc.indexOf("side-in") >= 0 && doc.indexOf("side-rm") >= 0);
}

//  A staged edit is measured against HEAD, so it washes like an unstaged one.
let sh = null;
try { sh = open(rowOf("st.txt").nav); } catch (e) { sh = null; }
check("a STAGED edit washes too — the view reads HEAD, not the index",
      sh !== null && washed(sh, wrap.SIDE_IN).indexOf("STAGED") >= 0,
      sh === null ? "threw" : washed(sh, wrap.SIDE_IN));

//  The conflict: the markers and BOTH sides are on disk, so both are shown.
let ch = null;
try { ch = open(rowOf("con.txt").nav); } catch (e) { ch = null; }
check("a CONFLICTED row opens the file with both sides and the markers",
      ch !== null && bodyOf(ch).indexOf("MINE") >= 0 && bodyOf(ch).indexOf("SIDE") >= 0 &&
      bodyOf(ch).indexOf("<<<<<<<") >= 0 && bodyOf(ch).indexOf(">>>>>>>") >= 0,
      ch === null ? "threw" : JSON.stringify(bodyOf(ch)));

//  A deleted file has no bytes on disk: HEAD's are shown, all washed OUT.
let dh = null;
try { dh = open(rowOf("del.txt").nav); } catch (e) { dh = null; }
check("a DELETED row still opens — HEAD's bytes, washed out",
      dh !== null && dh.length > 0 && washed(dh, wrap.SIDE_RM).indexOf("d1") >= 0,
      dh === null ? "threw" : washed(dh, wrap.SIDE_RM));

//  THE DEAD CLICK this ticket kills: a row whose worktree matches HEAD (a
//  staged ADD has no HEAD blob at all) must still open the FILE, never nothing.
let ah = null, aerr = "";
try { ah = open(rowOf("add.txt").nav); } catch (e) { aerr = String(e); }
check("a row with no HEAD side opens the worktree file whole, never an empty page",
      ah !== null && ah.length > 0 && bodyOf(ah).indexOf("brand new") >= 0,
      ah === null ? aerr : JSON.stringify(bodyOf(ah)));

//  --- the verb is TYPABLE, and unchanged bytes are just the file ------------
let clean = null;
try { clean = door.verbOf("dog")(FIX + "/clean.txt", { from: FIX }); }
catch (e) { clean = null; }
check("`wash <clean path>` answers the file whole, with nothing washed",
      clean !== null && clean.length === 1 && bodyOf(clean) === "c1\nc2\n" &&
      washed(clean, wrap.SIDE_IN) === "" && washed(clean, wrap.SIDE_RM) === "",
      clean === null ? "threw" : JSON.stringify(bodyOf(clean)));

//  --- the http twin: one ROUTE row, both ways -------------------------------
const pg = { name: "fix", root: FIX, prefix: "" };
let url = "";
try { url = srv.urlOf(pg, "dog " + FIX + "/mod.txt"); } catch (e) { url = String(e); }
check("a `dog` target has a URL of its own",
      url.length > 1 && url.slice(-12) === "/dog/mod.txt", url);
let rverb = "";
try { rverb = srv.routeOf(url, [url.split("/")[1]]).verb; } catch (e) { rverb = String(e); }
check("...and that URL routes back to the verb", rverb === "dog", rverb);

w1("DONE " + n + " checks, " + bad + " failed\n");
if (bad) throw "statnav: " + bad + " of " + n + " checks failed";
