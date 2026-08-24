//  bee/test/substat/href.js — STATUS-023: a submodule row is CLICKABLE, on the
//  pager and in HTML alike, and the listing agrees with the `bee wts` tally.
//  Four legs over one fixture: the nav each row carries, the http URL that nav
//  builds and the route it comes back as, the pager's own click target off the
//  name token, and the file/wt counts folded both ways.
//  $BEE_FIX names the fixture parent worktree.
"use strict";

const st = require("view/status.js");
const wt = require("view/wtstat.js");
const door = require("door.js");
const wrap = require("render/wrap.js");
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
const PG = { name: "fix", root: FIX, prefix: "" };

function rowOf(path) {
  for (const r of view.rows) if (!r.commit && r.text === path) return r;
  return null;
}

//  --- 1. the nav: the verb per class, the arg absolute through the mount ------
const SUBFILES = ["dog/WHIFF.h", "dog/abc/nest.c"];
for (const p of SUBFILES) {
  const r = rowOf(p);
  check("the sub row " + p + " is there", r !== null, "no row");
  if (r === null) continue;
  check("...it opens `dog`, the washed whole file", r.nav.slice(0, 4) === "dog ", r.nav);
  check("...and its arg is the mount-qualified path, absolute",
        r.nav.slice(4) === FIX + "/" + p, r.nav);
}
{
  const u = rowOf("dog/new.txt");
  check("an untracked file inside the sub opens `cat`",
        u !== null && u.nav === "cat " + FIX + "/dog/new.txt", u === null ? "no row" : u.nav);
}

//  --- 2. the http URL, and the route back ------------------------------------
//  `/<repo>/<verb>/<path>`: the verb is always written (BEE-028), so a root
//  file's `/fix/dog/pack.c` is repo + the `dog` VERB, not a mount prefix.
function urlOf(path) {
  const r = rowOf(path);
  if (r === null) return "";
  try { return srv.urlOf(PG, r.nav); } catch (e) { return String(e); }
}
function routeOf(url) {
  try { return srv.routeOf(url, ["fix"]); } catch (e) { return { verb: String(e), arg: "" }; }
}
const CASES = [["pack.c", "/fix/dog/pack.c"],
               ["dog/WHIFF.h", "/fix/dog/dog/WHIFF.h"],
               ["dog/abc/nest.c", "/fix/dog/dog/abc/nest.c"]];
for (const c of CASES) {
  const u = urlOf(c[0]);
  check("the href for " + c[0] + " is " + c[1], u === c[1], u);
  const rt = routeOf(u);
  check("...and it routes back to the `dog` verb over " + c[0],
        rt.verb === "dog" && rt.arg === c[0], rt.verb + " [" + rt.arg + "]");
}

//  A link is only good if the page behind it paints: the sub file opens whole.
{
  let hs = null, threw = "";
  try { hs = door.verbOf("dog")(FIX + "/dog/WHIFF.h", { from: FIX }); }
  catch (e) { threw = String(e); }
  let body = "";
  for (const h of (hs || [])) body += utf8.Decode(h.text);
  check("the sub file's target OPENS — the link is not dead",
        hs !== null && hs.length > 0 && body.indexOf("W1") >= 0, threw + body);
}

//  --- 3. the pager: the click sits on the NAME token --------------------------
const targetAt = function (off) {
  return pagerlib.Pager.prototype._targetAt.call({}, H, off);
};
function nameSpan(path) {
  let lo = 0;
  for (let i = 0; i < H.toks.length; i++) {
    const hi = wrap.TOK_END(H.toks[i]), tag = wrap.TOK_TAG(H.toks[i]);
    if (utf8.Decode(H.text.slice(lo, hi)) === path && (tag === "F" || tag === "N"))
      return { lo: lo, hi: hi };
    lo = hi;
  }
  return null;
}
for (const p of ["pack.c", "dog/WHIFF.h", "dog/abc/nest.c"]) {
  const r = rowOf(p), sp = nameSpan(p);
  check("the hunk carries a name token for " + p, sp !== null, "no token");
  if (sp === null || r === null) continue;
  check("...a click on its first byte follows the row's nav",
        targetAt(sp.lo) === r.nav, targetAt(sp.lo));
  check("...and on its last byte too", targetAt(sp.hi - 1) === r.nav, targetAt(sp.hi - 1));
}

//  --- 4. the listing agrees with the tally ------------------------------------
//  wtstat folds the top rows and then descends the mounts itself; the LISTING
//  carries those very rows, so the two class counts must be identical.
{
  const shown = [];
  for (const r of view.rows) if (!r.commit) shown.push(r);
  const a = wt.fold(shown), b = wt.stat(FIX);
  const spell = function (f) {
    return f.un.chg + "/" + f.un.add + "/" + f.un.del + " " +
           f.st.chg + "/" + f.st.add + "/" + f.st.del + " " +
           f.all.chg + "/" + f.all.add + "/" + f.all.del;
  };
  check("the listing's own fold equals the `bee wts` tally over the same tree",
        b !== null && spell(a) === spell(b),
        b === null ? "no stat" : spell(a) + " vs " + spell(b));
  check("...and it is not the empty tally either", a.all.chg + a.all.add > 0, spell(a));
}

w1("DONE " + n + " checks, " + bad + " failed\n");
if (bad) throw "substat: " + bad + " of " + n + " checks failed";
