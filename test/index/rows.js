//  lite/test/index/rows.js — LITE-006 leg 2: the ROWS `quickjab index` left in
//  `<repo>/.git/be/`.  Opens the very same wh128 run family the verb wrote and
//  asserts the six ruled record kinds, one file's rev chain read as ONE prefix
//  scan of its `path_hl`, the B2P rows of a blob that sits at TWO paths, the
//  merge commit's CPAR edges and the single MARK watermark.
//
//  Driven by run.sh, which exports the fixture's paths and shas:
//    LITE_FIX  the repo
//    LITE_EXP  "c0=<sha> c1=… c2=… c3=… c4=… b1=<blob> b2=<blob> bb1=… bb2=…"
"use strict";
const idx = require("index/index.js");

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
const exp = {};
for (const kv of (io.getenv("LITE_EXP") || "").split(" ")) {
  const eq = kv.indexOf("=");
  if (eq > 0) exp[kv.slice(0, eq)] = kv.slice(eq + 1);
}
const gitdir = repo + "/.git";
const ix = idx.openIndex(gitdir);

//  --- 1. every ruled kind is on the stack ----------------------------------
const kinds = new Map();
const all = [];
{
  const c = ix.seek(0n);
  while (c.next()) {
    all.push([c.key, c.val]);
    const k = idx.keyKind(c.key);
    kinds.set(k, (kinds.get(k) || 0) + 1);
  }
}
const NAMED = [["REV-BLOB", idx.K_BLOB], ["REV-CMMT", idx.K_CMMT], ["REV-PARS", idx.K_PARS],
               ["CPAR", idx.K_CPAR], ["B2P", idx.K_B2P], ["MARK", idx.K_MARK]];
for (const [nm, k] of NAMED)
  check("kind-" + nm, (kinds.get(k) || 0) > 0, "rows " + (kinds.get(k) || 0));
check("kinds-are-only-the-six", kinds.size === 6, "distinct kinds " + kinds.size);

//  --- 2. one file's log = ONE prefix scan of its path_hl -------------------
//  The rows come back rev-ordered oldest-first, each rev naming its blob, its
//  commit and its parent revs — no ODB walk.
function logOf(path) {
  const phl = idx.pathHl(path);
  const revs = new Map();
  ix.prefix(phl << 24n, 24, function (e) {
    const rev = idx.keyRev(e[0]), kind = idx.keyKind(e[0]);
    let r = revs.get(rev);
    if (r === undefined) revs.set(rev, r = { rev: rev, blob: null, commit: null, pars: [] });
    if (kind === idx.K_BLOB) r.blob = idx.valHl60(e[1]);
    else if (kind === idx.K_CMMT) r.commit = idx.valHl60(e[1]);
    else if (kind === idx.K_PARS) {
      const v = e[1];
      for (const s of [(v >> 44n) & idx.REV_MAX, (v >> 24n) & idx.REV_MAX, (v >> 4n) & idx.REV_MAX])
        if (s !== idx.REV_MAX) r.pars.push(s);
    }
  });
  const out = [];
  for (const r of revs.values()) out.push(r);
  out.sort((x, y) => (x.rev < y.rev ? -1 : x.rev > y.rev ? 1 : 0));
  return out;
}

const a = logOf("a.txt");
check("a.txt-two-revs", a.length === 2, "revs " + a.length);
if (a.length === 2) {
  check("a.txt-rev-numbers-arrival-local", a[0].rev === 0n && a[1].rev === 1n,
        a[0].rev + "," + a[1].rev);
  check("a.txt-rev0-blob", a[0].blob === idx.hlOfSha(exp.b1), a[0].blob);
  check("a.txt-rev0-commit", a[0].commit === idx.hlOfSha(exp.c0), a[0].commit);
  check("a.txt-rev0-no-pars", a[0].pars.length === 0, a[0].pars.join(","));
  check("a.txt-rev1-blob", a[1].blob === idx.hlOfSha(exp.b2), a[1].blob);
  check("a.txt-rev1-commit", a[1].commit === idx.hlOfSha(exp.c1), a[1].commit);
  check("a.txt-rev1-pars-is-rev0", a[1].pars.length === 1 && a[1].pars[0] === 0n,
        a[1].pars.join(","));
}

//  dir/b.txt reved on the SIDE branch; the merge carries the side blob, so the
//  merge yields NO rev of it (equal to a parent's blob).
const b = logOf("dir/b.txt");
check("dir/b.txt-two-revs-merge-adds-none", b.length === 2, "revs " + b.length);
if (b.length === 2) {
  check("dir/b.txt-rev1-commit-is-c2", b[1].commit === idx.hlOfSha(exp.c2), b[1].commit);
  check("dir/b.txt-rev1-pars-is-rev0", b[1].pars.length === 1 && b[1].pars[0] === 0n,
        b[1].pars.join(","));
}
//  moved.txt is the SAME blob as a.txt rev1 at a new path — its own rev 0.
const mv = logOf("moved.txt");
check("moved.txt-one-rev", mv.length === 1 && mv[0].rev === 0n, "revs " + mv.length);
if (mv.length === 1)
  check("moved.txt-shares-a.txt-rev1-blob", mv[0].blob === idx.hlOfSha(exp.b2), mv[0].blob);

//  --- 3. B2P: one row per OCCURRENCE, so the shared blob has two -----------
function b2pOf(blobSha) {
  const key = idx.hlKey(idx.hlOfSha(blobSha), idx.K_B2P);
  const out = [];
  ix.range(key, key + 1n, function (e) {
    out.push({ phl: (e[1] >> 24n), rev: (e[1] >> 4n) & idx.REV_MAX });
  });
  return out;
}
const shared = b2pOf(exp.b2);
check("b2p-shared-blob-two-rows", shared.length === 2, "rows " + shared.length);
const wantA = idx.pathHl("a.txt"), wantM = idx.pathHl("moved.txt");
check("b2p-names-a.txt-rev1",
      shared.some((x) => x.phl === wantA && x.rev === 1n), JSON.stringify(shared.length));
check("b2p-names-moved.txt-rev0",
      shared.some((x) => x.phl === wantM && x.rev === 0n), JSON.stringify(shared.length));
check("b2p-first-blob-one-row", b2pOf(exp.b1).length === 1, b2pOf(exp.b1).length);

//  --- 4. CPAR: one row per parent, first parent ord 0 ----------------------
function cparOf(sha) {
  const key = idx.hlKey(idx.hlOfSha(sha), idx.K_CPAR);
  const out = [];
  ix.range(key, key + 1n, function (e) {
    out.push({ parent: idx.valHl60(e[1]), ord: e[1] & 0xfn });
  });
  out.sort((x, y) => (x.ord < y.ord ? -1 : x.ord > y.ord ? 1 : 0));
  return out;
}
const merge = cparOf(exp.c3);
check("cpar-merge-two-edges", merge.length === 2, "rows " + merge.length);
if (merge.length === 2) {
  check("cpar-first-parent-ord0",
        merge[0].ord === 0n && merge[0].parent === idx.hlOfSha(exp.c1), merge[0].ord);
  check("cpar-second-parent-ord1",
        merge[1].ord === 1n && merge[1].parent === idx.hlOfSha(exp.c2), merge[1].ord);
}
//  Ruling 2026-08-13: a CPAR row is the commit's "I am indexed" flag and the
//  walk's boundary, so a ROOT commit carries ONE with an EMPTY parent slot —
//  parentless must not read as unindexed.
const root = cparOf(exp.c0);
check("cpar-root-commit-has-one-row", root.length === 1, "rows " + root.length);
check("cpar-root-parent-slot-is-empty",
      root.length === 1 && root[0].parent === idx.CPAR_NONE && root[0].ord === 0n,
      root.length === 1 ? root[0].parent : "no row");
//  ...and that row must NOT read back as a parent edge.
const lg = require("index/log.js");
check("cpar-root-has-no-parent-edge",
      lg.parentsOf(ix, idx.hlOfSha(exp.c0)).length === 0);
check("cpar-root-still-reads-as-indexed",
      lg.isIndexed(ix, idx.hlOfSha(exp.c0)) === true);

//  --- 5. MARK: one per ref, naming the live tip ---------------------------
{
  const key = idx.hlKey(idx.hlOfText("refs/heads/master"), idx.K_MARK);
  const got = [];
  ix.range(key, key + 1n, function (e) { got.push(idx.valHl60(e[1])); });
  check("mark-one-row", got.length === 1, "rows " + got.length);
  check("mark-names-the-tip", got.length === 1 && got[0] === idx.hlOfSha(exp.c4), got[0]);
}

try { ix.close(); } catch (e) {}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
