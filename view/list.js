//  view/list.js — `bee list [<path>][?<rev>]`, the github-style dir browser
//  (LIST-001:30:Bc, LITE-017): one row per entry, `<marker3> <name> <pale
//  last-commit summary> <rel-age>`, and a dir is attributed the newest commit
//  under it, which is the one thing `ls` cannot say.  It lists the tree at the
//  rev rather than the raw worktree, since there is no ignore machinery to keep
//  build output out; the marker compares the worktree blob sha with the tree's,
//  `eq`/`mod`/`del` per file and a flat `dir` (LITE-017:49:Cv).  Attribution is
//  one index scan per entry (LITE-044) and the view brings the index up itself.
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
const df = require("./diff.js");
const rd = require("index/read.js");

//  The marker's colour slot per bucket, as in be's view/theme.js VERB_SLOT:
//  eq grey, mod yellow, del brown, dir grey; render/ansi.js carries the slots.
const VERB_SLOT = { eq: "D", mod: "E", del: "X", dir: "Q" };

//  tok32 (dog/tok/TOK.h): tag in bits 31..27, end byte offset in 23..0.
const TAG_D = 3, TAG_F = 5, TAG_L = 11, TAG_S = 18, TAG_U = 20;
function tagCode(letter) { return letter.charCodeAt(0) - 65; }
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  The fixed name column of be's list.js, so that the summaries line up.
const NAME_W = 24;
function padName(n) {
  return n.length >= NAME_W ? n + " " : n + " ".repeat(NAME_W - n.length + 1);
}

//  One tracked file against the listed tree: gone, byte-identical or changed.
//  The comparison is over the blob name (view/diff.js blobSha), so that an
//  unchanged file is never inflated out of the ODB.
function markerOf(abs, sha) {
  let st = null;
  try { st = io.lstat(abs); } catch (e) { st = null; }
  if (st === null) return "del";
  const bytes = (st.kind === "reg" && st.size === 0) ? new Uint8Array(0)
              : df.wtBytes(abs);
  if (bytes === undefined) return "del";
  return df.blobSha(bytes) === sha ? "eq" : "mod";
}

//  An entry's last commit, off its own index rows and with no history walk, so
//  that depth costs nothing and nothing starves (LITE-044:9:5D).  A file folds its
//  chain (view/log.js fileLog, one row) since the PARS edges order a rewritten
//  history; a dir takes its last rev straight (index/index.js lastRev).
function lastCommitOf(ix, r, path, dir) {
  let hl = null;
  if (dir) {
    const phl = idx.pathHl(path);
    const rev = idx.lastRev(ix, phl, idx.K_CMMT);
    if (rev < 0n) return null;
    hl = idx.valHl60(idx.revValAt(ix, phl, rev, idx.K_CMMT));
  } else {
    const w = lg.fileLog(ix, r, path, 1);
    if (!w.hls.length) return null;
    hl = w.hls[0];
  }
  const m = idx.readCommit(r, idx.hexOfHl(hl));
  return m ? { summary: m.subject, ts: m.ats } : null;
}

//  entries -> { name: { summary, ts } }: the whole listing's attribution.
function lastCommits(ix, r, pfx, entries) {
  const out = {};
  for (const e of entries) {
    const c = lastCommitOf(ix, r, pfx + e.name, e.dir === true);
    if (c !== null) out[e.name] = c;
  }
  return out;
}

//  An entry -> { marker, label, nav, summary, age }: `label` carries a dir's
//  trailing '/', `nav` is the pager click target, so that a dir stays in the
//  browser and a file opens in cat.
function rowsOf(ctx, rel, entries, commits, now) {
  const pfx = rel === "" ? "" : rel + "/";
  const out = [];
  for (const e of entries) {
    const c = commits[e.name] || null;
    out.push({ marker: e.marker,
               label: e.dir ? e.name + "/" : e.name,
               nav: (e.dir ? "list " : "cat ") + rd.navPath(ctx, pfx + e.name) +
                    (e.dir ? "/" : ""),
               summary: c ? c.summary : "",
               age: c ? rd.relAge(c.ts, now) : "" });
  }
  return out;
}

//  The visible bytes of one row: what `--plain` writes and what the pager
//  paints, minus the hidden target.
function rowText(r) {
  return rd.verbCol(r.marker) + " " + padName(r.label) + r.summary +
         (r.age ? "  " + r.age : "") + "\n";
}

function plainOf(rows) {
  let s = "";
  for (const r of rows) s += rowText(r);
  return utf8.Encode(s);
}

//  The pager hunk: the visible bytes with the target under a hidden `U` span
//  after the marker and again after the name, since the pager reads a target
//  as the span following the cursor's (pager.js:544:t0): Enter takes the row's
//  first span, a click the one it landed in.  A `U` span takes no column.
function hunkOf(uriStr, rows) {
  const b = io.buf(1 << 14);
  const spans = [];
  const put = (tag, str) => {
    const worst = str.length * 4 + 4;
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  for (const r of rows) {
    put(tagCode(VERB_SLOT[r.marker] || "S"), rd.verbCol(r.marker) + " ");
    put(TAG_U, r.nav);
    put(TAG_F, padName(r.label));
    put(TAG_U, r.nav);
    put(TAG_D, r.summary);
    if (r.age) { put(TAG_S, "  "); put(TAG_L, r.age); }
    put(TAG_S, "\n");
  }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  //  A listing is the answer, so its plain bytes wear no `hunk` band
  //  (LITE-017:47:Cv), and the hidden targets never reach a pipe.
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "list",
           plain: plainOf(rows), bare: true };
}

//  list(arg, opts) -> { uri, rows, hunks }.  `opts.track` adds the repo to the
//  repo list, which is the bare `bee` run's `index` half (LITE-018).
function list(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const a = rd.argSplit(arg);
    const rel = rd.repoRel("list", ctx, a.path, opts.from);
    const c = rd.revCommit("list", ctx, a.rev);
    const e = rd.entryAt(ctx.r, c.m.tree, rel);
    if (e === null) throw "list: there is no " + (a.path || ".") + " at " + c.sha.slice(0, 8);
    if (!e.dir) throw "list: " + a.path + " is a file, not a directory";
    const M = idx.readTree(ctx.r, e.sha);
    if (M === null) throw "list: " + (a.path || ".") + " is not a readable directory";

    //  Git tree order is be's sort key (a dir sorts as `name/`), so the
    //  entries come out of the cursor already in row order.
    const pfx = rel === "" ? "" : rel + "/";
    const entries = [];
    for (const [name, ent] of M)
      entries.push({ name: name, dir: ent.dir, sha: ent.sha,
                     marker: ent.dir ? "dir"
                           : markerOf(ctx.root + "/" + pfx + name, ent.sha) });
    //  A gitlink is no entry of `readTree`'s (BEE-006:10:3B), so a submodule's row
    //  is added here as a dir row, attributed off the dir revs its bumps mint.
    const subs = idx.subTree(ctx.r, e.sha);
    if (subs.size) {
      for (const [name, sha] of subs)
        entries.push({ name: name, dir: true, sub: true, sha: sha, marker: "dir" });
      //  Git tree order is the row order, and a gitlink sorts as a plain name;
      //  only a subtree's name sorts as if it ended in '/'.
      const key = (x) => (x.dir && !x.sub ? x.name + "/" : x.name);
      entries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    }

    //  Attribution rides the index, so the view owns the full bring-up
    //  (LITE-018:18:os): a never-indexed repo is derived right here.
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    let commits = {};
    try {
      idx.bringUp(ctx, ix, { track: opts.track === true });
      commits = lastCommits(ix, ctx.r, pfx, entries);
    } finally { try { ix.close(); } catch (err) {} }

    const rows = rowsOf(ctx, rel, entries, commits, Math.floor(Date.now() / 1000));
    const uriStr = "list" + (arg ? " " + arg : "");
    return { uri: uriStr, rows: rows, hunks: [hunkOf(uriStr, rows)] };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { list: list, rowsOf: rowsOf, rowText: rowText,
                   plainOf: plainOf, hunkOf: hunkOf, markerOf: markerOf,
                   lastCommits: lastCommits, lastCommitOf: lastCommitOf,
                   padName: padName, VERB_SLOT: VERB_SLOT };
