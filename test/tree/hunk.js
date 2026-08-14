//  lite/test/tree/hunk.js — LITE-017, the tty side of `lite tree` headless: the
//  pager hunk carries the SAME visible bytes the plain block writes, with the
//  D/F/S spans laid over them and one hidden `U` click-target per entry.  No
//  tty needed — test/pager already proves the Pager itself.
//
//  `LITE_FIX` names the fixture repo, `LITE_TIP` its tip, `LITE_SUBTREE` the
//  `sub` tree sha.
"use strict";
const tr = require("index/tree.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const repo = io.getenv("LITE_FIX");
const TIP = io.getenv("LITE_TIP");

function tag(w) { return String.fromCharCode(65 + ((w >>> 27) & 0x1f)); }
function end(w) { return w & 0xffffff; }

//  The bytes a pager RENDERS: every byte not covered by a `U` token (the
//  view/pager.js rowEnd rule — a U cell takes no column).
function visible(h) {
  const out = [];
  let ti = 0, pos = 0;
  while (pos < h.text.length) {
    while (ti < h.toks.length && end(h.toks[ti]) <= pos) ti++;
    if (ti < h.toks.length && tag(h.toks[ti]) === "U") { pos++; continue; }
    out.push(h.text[pos]); pos++;
  }
  return new Uint8Array(out);
}
function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
//  Each visible token and the U target that follows it, the way _targetAt reads
//  them: a `U` tok's hidden bytes are [prev end .. its end).
function targets(h) {
  const out = [];
  for (let i = 1; i < h.toks.length; i++) {
    if (tag(h.toks[i]) !== "U") continue;
    const lo = end(h.toks[i - 1]), hi = end(h.toks[i]);
    const vlo = i >= 2 ? end(h.toks[i - 2]) : 0;
    out.push({ name: utf8.Decode(h.text.slice(vlo, lo)),
               uri: utf8.Decode(h.text.slice(lo, hi)) });
  }
  return out;
}

//  ---- the root listing ----------------------------------------------------
const root = tr.tree(undefined, { from: repo });
const h = root.hunks[0];
check("one hunk for one listing", root.hunks.length === 1, root.hunks.length);
check("hunk-shape", h.verb === "hunk" && h.kind === "tree" &&
      h.text instanceof Uint8Array && h.toks instanceof Uint32Array, h.verb + " " + h.kind);
check("hunk-banners-the-verb", h.uri === "tree", h.uri);
check("the visible bytes ARE the plain block",
      bytesEq(visible(h), root.plain), utf8.Decode(visible(h)));

//  tok ends ascend and cover the text exactly — the pager's bisect needs both.
let asc = true, prev = 0;
for (let i = 0; i < h.toks.length; i++) { if (end(h.toks[i]) < prev) asc = false; prev = end(h.toks[i]); }
check("tok ends ascend", asc, prev);
check("the last tok ends at the last byte", prev === h.text.length, prev + "/" + h.text.length);

//  Every row: the meta prefix dim (D), the name violet (F), the '\n' its own
//  default (S) so no colour bleeds onto the next row.
const tags = [];
for (let i = 0; i < h.toks.length; i++) tags.push(tag(h.toks[i]));
check("the meta prefix rides the dim D slot", tags.indexOf("D") >= 0, tags.join(""));
check("the name rides the violet F slot", tags.indexOf("F") >= 0, tags.join(""));
const nl = [];
for (let i = 0; i < h.toks.length; i++)
  if (h.text[end(h.toks[i]) - 1] === 0x0a) nl.push(tags[i]);
check("every newline is its own S span (no colour bleed)",
      nl.length > 0 && nl.every(function (t) { return t === "S"; }), nl.join(""));

//  ---- the click targets ---------------------------------------------------
const t = targets(h);
function find(name) { for (const x of t) if (x.name === name) return x.uri; return null; }
check("a DIR entry opens as a tree", /^tree .*\/sub\/$/.test(find("sub/") || ""), find("sub/"));
check("a FILE entry opens as a blob by sha",
      /^blob [0-9a-f]{40}$/.test(find("a.txt") || ""), find("a.txt"));
check("a symlink entry opens as a blob too",
      /^blob [0-9a-f]{40}$/.test(find("link.txt") || ""), find("link.txt"));
check("a GITLINK gets no target (its commit is in another ODB)",
      find("mod") === null, find("mod"));
//  TWO U spans per navigable entry — one after the meta (what Enter on the row
//  reads) and one after the name (what a click on the name reads); the gitlink
//  has neither.
check("every entry but the gitlink carries a target, both ways",
      t.length === 2 * (root.rows.length - 1), t.length + "/" + root.rows.length);

//  ---- descended: the `..` row navigates UP --------------------------------
const sub = tr.tree("sub", { from: repo });
const sh = sub.hunks[0];
check("descended: the banner names the arg", sh.uri === "tree sub", sh.uri);
check("descended: the visible bytes ARE the plain block",
      bytesEq(visible(sh), sub.plain));
check("descended: the first row is the bare '..'",
      sub.rows[0].name === ".." && sub.rows[0].meta === "", sub.rows[0].name);
const st = targets(sh);
check("the '..' row opens the parent tree", /^tree .*\/$/.test(st[0].uri) &&
      st[0].name === "..", st[0].uri);

//  ---- a hexlet names the same listing -------------------------------------
const byHex = tr.tree(TIP, { from: repo });
check("a commit hexlet yields the same rows", bytesEq(byHex.plain, root.plain));
check("...and banners the arg", byHex.uri === "tree " + TIP, byHex.uri);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
