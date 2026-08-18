//  bee/test/status/stage.js — BEE-022: the STAGE column and its ABSENCE.
//  [GIT-032]'s `dog.readIndex` is what column 3 is read from, and it is also
//  the rung column 4 stands on.  The ticket rules the view must still run
//  without it — column 3 all-`.`, column 4 falling back to HEAD, and BOTH said
//  on the summary line.  This drives the LIVE view over one fixture, with the
//  binding and then with it taken off the `dog` object.
//  $BEE_FIX names the fixture worktree.
"use strict";
const st = require("view/status.js");

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
function quadOf(o, path) {
  for (const r of o.model.rows) if (r.path === path) return r.quad;
  return "";
}

//  --- with the binding ------------------------------------------------------
check("the runtime under test HAS the GIT-032 reader",
      typeof dog !== "undefined" && typeof dog.readIndex === "function");
const on = st.status("", { from: FIX });
check("a staged edit whose worktree matches the stage is `..v.`",
      quadOf(on, "sub/x.txt") === "..v.", quadOf(on, "sub/x.txt"));
check("a staged add with no further edit is `..o.`",
      quadOf(on, "n.txt") === "..o.", quadOf(on, "n.txt"));
check("an unstaged edit lights rung 4 alone",
      quadOf(on, "a.txt") === "vv.v", quadOf(on, "a.txt"));
check("the model does not claim the column is missing", on.model.noStage === false);
check("...and the summary line says nothing about it",
      utf8.Decode(on.hunks[0].plain).indexOf("no stage column") < 0);

//  --- THE REPRO: the same repo with no reader at all ------------------------
const saved = dog.readIndex;
delete dog.readIndex;
let off = null, threw = "";
try { off = st.status("", { from: FIX }); } catch (e) { threw = String(e); }
dog.readIndex = saved;

check("the view still RUNS with no stage reader", off !== null, threw);
if (off !== null) {
  let dirty = 0;
  for (const r of off.model.rows) if (r.quad.charAt(2) !== ".") dirty++;
  check("...with the 3rd char `.` on every row", dirty === 0, dirty);
  check("...rung 4 stands on HEAD instead, so an edit still shows",
        quadOf(off, "a.txt") === "vv.v", quadOf(off, "a.txt"));
  check("...the model SAYS the column is absent", off.model.noStage === true);
  const said = utf8.Decode(off.hunks[0].plain);
  check("...and so does the summary line, in words",
        said.indexOf("no stage column") > 0, said.split("\n").slice(-2)[0]);
  check("...naming the neighbour rung 4 fell back to",
        said.indexOf("worktree column reads against HEAD") > 0,
        said.split("\n").slice(-2)[0]);
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "stage: " + bad + " checks failed";
