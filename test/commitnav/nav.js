//  lite/test/commitnav/nav.js — LITE-021, the headless leg: the commit view's
//  hash rows carry the hidden `U` click-targets, the PLAIN body carries none,
//  and the door (door.js openTarget) opens every one of them.
//
//  The targets are read the way the pager reads them — `_targetAt` on the row's
//  own byte offset (Enter) and on the sha token (a click) — so what is pinned
//  here is the contract, not a span table.
//
//  LITE_FIX names the fixture repo, LITE_SHA the MERGE commit, LITE_ROOT the
//  parentless root one, LITE_TREE the merge's tree sha, LITE_P1/LITE_P2 its two
//  parents.
"use strict";
const cm = require("view/commit.js");
const tr = require("view/tree.js");
const pagerlib = require("pager.js");
const wrap = require("render/wrap.js");
const entry = require("door.js");        // LITE-045: the door, not the CLI

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
const SHA = io.getenv("LITE_SHA"), ROOT = io.getenv("LITE_ROOT");
const TREE = io.getenv("LITE_TREE");
const P1 = io.getenv("LITE_P1"), P2 = io.getenv("LITE_P2");

const out = cm.commit(SHA, { from: repo });
const h = out.hunks[0];          // LITE-045: the metadata hunk leads the view
const rows = wrap.indexRows(h, 200, false);
//  the pager's own reader, with no pager instance behind it
const targetAt = (off) => pagerlib.Pager.prototype._targetAt.call({}, h, off);
//  the visible text of a row (`U`/`O` bytes are hidden at paint time, so strip
//  them the way paintRow does): row i of the PLAIN body.
const plines = utf8.Decode(h.plain).split("\n");

//  ---- the plain body stays U-free ----------------------------------------
check("plain-body-is-shorter-than-the-pager-body",
      h.plain.length < h.text.length, h.plain.length + " vs " + h.text.length);
check("plain-body-carries-no-target-bytes",
      utf8.Decode(h.plain).indexOf("tree " + TREE + "\ntree ") < 0 &&
      utf8.Decode(h.plain).indexOf("commit " + P1 + "\nparent") < 0,
      utf8.Decode(h.plain).slice(0, 200));
check("plain-rows-are-the-object's-own",
      plines[1] === "tree " + TREE && plines[2] === "parent " + P1 &&
      plines[3] === "parent " + P2, plines.slice(1, 4).join(" | "));

//  ---- one target per hash ROW (Enter: the row's first span) ---------------
check("banner-sha-carries-no-target", targetAt(rows[0].off) === "",
      targetAt(rows[0].off));
check("tree-row-opens-the-tree", targetAt(rows[1].off) === "tree " + TREE,
      targetAt(rows[1].off));
check("first-parent-row-opens-that-commit",
      targetAt(rows[2].off) === "commit " + P1, targetAt(rows[2].off));
check("second-parent-row-opens-the-OTHER-commit",
      targetAt(rows[3].off) === "commit " + P2, targetAt(rows[3].off));
check("the-two-parent-targets-differ", P1 !== P2 &&
      targetAt(rows[2].off) !== targetAt(rows[3].off), P1 + " " + P2);

//  ---- a CLICK on the sha token itself -------------------------------------
//  The sha starts one span past the field name; a click lands anywhere inside
//  it.  The row byte offsets: `tree ` is 5 bytes + the hidden target, so probe
//  through the pager's screen mapper instead of counting bytes here — the pty
//  leg does the real click; this pins the byte-level twin span.
function clickOn(rowIx, name) {
  //  the sha token = the FIRST 40-hex run after the field name in the row
  const text = utf8.Decode(h.text.slice(rows[rowIx].off, rows[rowIx].end));
  const at = text.indexOf(name + " ") === 0 ? name.length + 1 : -1;
  if (at < 0) return "";
  //  skip the hidden target that rides after the name, land mid-sha
  const nav = targetAt(rows[rowIx].off);
  return targetAt(rows[rowIx].off + at + nav.length + 20);
}
check("a-click-inside-the-tree-sha-opens-the-tree",
      clickOn(1, "tree") === "tree " + TREE, clickOn(1, "tree"));
check("a-click-inside-a-parent-sha-opens-that-commit",
      clickOn(2, "parent") === "commit " + P1, clickOn(2, "parent"));

//  ---- rows that are NOT hashes stay span-free ------------------------------
let dead = "";
for (let i = 4; i < rows.length; i++) {
  const t = targetAt(rows[i].off);
  if (t) { dead = "row " + i + " -> " + t; break; }
}
check("author/committer/message-rows-carry-no-target", dead === "", dead);

//  ---- the ROOT commit: a tree target and no parent row --------------------
const ro = cm.commit(ROOT, { from: repo });
const rh = ro.hunks[0];
const rrows = wrap.indexRows(rh, 200, false);
const rtarget = pagerlib.Pager.prototype._targetAt.call({}, rh, rrows[1].off);
check("the-root-commit's-tree-row-still-opens", rtarget.indexOf("tree ") === 0 &&
      rtarget.length === 45, rtarget);
check("the-root-commit-has-no-parent-row",
      utf8.Decode(rh.plain).indexOf("\nparent ") < 0, utf8.Decode(rh.plain).slice(0, 120));

//  ---- the DOOR opens every target -----------------------------------------
const toTree = entry.openTarget("tree " + TREE);
check("the-door-opens-a-tree-target", toTree !== null && toTree.length >= 1 &&
      toTree[0].kind === "tree", toTree === null ? "null" : toTree[0].kind);
const toParent = entry.openTarget("commit " + P1);
check("the-door-opens-a-parent-target", toParent !== null && toParent.length >= 1 &&
      utf8.Decode(toParent[0].text.slice(0, 47)) === "commit " + P1,
      toParent === null ? "null" : utf8.Decode(toParent[0].text.slice(0, 47)));

//  ---- `tree <raw tree sha>` — a TREE object, not a commit rev -------------
const t = tr.tree(TREE, { from: repo });
check("tree-accepts-a-raw-TREE-object-sha", t.rows.length >= 1 &&
      utf8.Decode(t.hunks[0].plain).indexOf("\t") > 0, "rows " + t.rows.length);
check("that-listing-is-the-commit's-own-tree",
      utf8.Decode(t.hunks[0].plain) === utf8.Decode(tr.tree(SHA, { from: repo }).hunks[0].plain),
      utf8.Decode(t.hunks[0].plain).slice(0, 120));

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
