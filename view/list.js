//  view/list.js — LITE-017: `lite list [<path>][?<rev>]`, the github-style
//  directory browser, ported from be/views/list/list.js (LIST-001).
//
//  ONE row per entry, files AND dirs:
//
//      <marker3> <name padded>  <pale last-commit summary>  <short rel-age>
//
//  and that is the whole view: what is here, who touched it last, how long ago.
//  A DIR is attributed the NEWEST commit touching anything UNDER it, which is
//  the one thing an `ls` cannot say.
//
//  WHAT IT LISTS.  The TREE at the rev, not the raw worktree: lite carries no
//  ignore machinery, so a worktree scan would put `.git` and every build output
//  in the browser.  Tracked content only, github-style — an untracked file has
//  no row (be's list shows one, marked `new`, because be's classifyDir knows
//  what is ignored).
//
//  THE MARKER.  be reads it off classify.js, which lite has no equivalent of;
//  what lite CAN do cheaply is exactly what `lite diff` does — frame the
//  worktree file and compare its blob name with the tree's.  So a file reads
//  `eq` / `mod` / `del` over the LISTED tree, one sha1 per file in this one
//  directory, and a DIR reads `dir` flat: rolling worktree dirtiness up into a
//  dir marker means walking its whole subtree, which is not cheap and is not
//  worth a column.  Nothing here reads `.git/index`, so a staged-only edit
//  reads as a worktree one — `lite diff`'s own model.
//
//  THE FUSE is lite's own machinery, not be's lastcommit.js: ONE prefix scan of
//  the entry's `path_hl` on the LITE-006 lane (view/log.js fileLog, capped at
//  one row) — exact, at any depth, with no history walk at all.
//
//  LITE-044: that used to be the FILE half only.  A dir cannot be enumerated
//  from the lane (the path hash is one-way), so a dir's newest commit came off
//  a CPAR ancestry walk capped at 512 — and on linux every dir below the first
//  level starved, up to 152k commits past the ceiling.  The indexer now emits a
//  REV row per changed DIR (index/index.js descend), so both halves are the one
//  scan and the walk, the cap and the blank rows are all gone.
//
//  LITE-018: the view OWNS its freshness whole — a repo with no `.git/be` at
//  all is derived here, not merely topped up, so bare `lite`, `lite list` and a
//  clicked row all open the same board on a repo nobody ever indexed.
"use strict";

const idx = require("index/index.js");
const lg = require("./log.js");
const df = require("./diff.js");
const rd = require("index/read.js");

//  be view/theme.js VERB_SLOT, for the buckets lite can tell apart: eq grey,
//  mod yellow, del brown, dir grey.  render/ansi.js carries the slots themselves.
const VERB_SLOT = { eq: "D", mod: "E", del: "X", dir: "Q" };

//  tok32 (dog/tok/TOK.h): [31..27] tag, [23..0] end byte offset.
const TAG_D = 3, TAG_F = 5, TAG_L = 11, TAG_S = 18, TAG_U = 20;
function tagCode(letter) { return letter.charCodeAt(0) - 65; }
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  be list.js's fixed name column, so the summaries line up.
const NAME_W = 24;
function padName(n) {
  return n.length >= NAME_W ? n + " " : n + " ".repeat(NAME_W - n.length + 1);
}

//  --- the wt marker ---------------------------------------------------------
//  One tracked file vs the listed tree: gone, byte-identical, or changed.  The
//  compare is over the blob NAME (diff.js's blobSha), so an unchanged file is
//  never inflated out of the ODB.
function markerOf(abs, sha) {
  let st = null;
  try { st = io.lstat(abs); } catch (e) { st = null; }
  if (st === null) return "del";
  const bytes = (st.kind === "reg" && st.size === 0) ? new Uint8Array(0)
              : df.wtBytes(abs);
  if (bytes === undefined) return "del";
  return df.blobSha(bytes) === sha ? "eq" : "mod";
}

//  --- the fuse --------------------------------------------------------------
//  Every entry's last commit, read off the entry's OWN rows on the lane — no
//  history walk for either half, so depth costs nothing and nothing starves.
//   -  a FILE folds its chain (view/log.js fileLog, capped at one row): the
//      chain is short, and PARS is what orders a rewritten file history;
//   -  a DIR takes its LAST rev straight (LITE-044): its revs are its subtree's
//      and are minted oldest-first, so the highest IS the newest commit under
//      it — and a hot dir's chain is as long as the history, which is exactly
//      what may not be read (see index/index.js lastRev).
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

//  entries -> { name: { summary, ts } }, the whole listing's attribution.
function lastCommits(ix, r, pfx, entries) {
  const out = {};
  for (const e of entries) {
    const c = lastCommitOf(ix, r, pfx + e.name, e.dir === true);
    if (c !== null) out[e.name] = c;
  }
  return out;
}

//  --- the rows --------------------------------------------------------------
//  An entry -> { marker, label, nav, summary, age }: `label` carries a dir's
//  trailing '/', `nav` is the pager click target (a dir stays in the browser, a
//  file opens in cat).
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

//  The visible bytes of one row — what `--plain` writes and what the pager
//  paints, minus the hidden nav.
function rowText(r) {
  return rd.verbCol(r.marker) + " " + padName(r.label) + r.summary +
         (r.age ? "  " + r.age : "") + "\n";
}

function plainOf(rows) {
  let s = "";
  for (const r of rows) s += rowText(r);
  return utf8.Encode(s);
}

//  The pager hunk: the same visible bytes, the nav URI riding under a hidden
//  `U` span after the marker AND after the name.  Both, because the pager reads
//  a target as "the span FOLLOWING the one under the cursor" (_targetAt): Enter
//  takes the row's FIRST span, a click takes the span it landed in.  A U span
//  takes no column, so the visible row is the plain one to the byte.
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
  //  LITE-045: a listing IS the answer, so its plain bytes wear no `hunk` band,
  //  and they are the VISIBLE row bytes — the hidden nav never reaches a pipe.
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "list",
           plain: plainOf(rows), bare: true };
}

//  --- the verb --------------------------------------------------------------
//  list(arg, opts) -> { uri, rows, hunks }.  LITE-018's `opts.track`
//  adds the repo to the repo list, which is the bare `lite` run's `index`
//  half.  There is no walk ceiling to override any more (LITE-044).
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

    //  git tree order IS be's sort key (a dir sorts as `name/`), so the
    //  entries come out of the cursor already in the row order.
    const pfx = rel === "" ? "" : rel + "/";
    const entries = [];
    for (const [name, ent] of M)
      entries.push({ name: name, dir: ent.dir, sha: ent.sha,
                     marker: ent.dir ? "dir"
                           : markerOf(ctx.root + "/" + pfx + name, ent.sha) });

    //  The fuse rides the lane, so it brings the index up to date itself —
    //  `lite log`'s lazy contract.  LITE-018: it owns the FULL bring-up, so a
    //  repo that was never indexed is derived right here, at the bulk handle
    //  `lite index` uses (a small memtable would seal per commit); `opts.track`
    //  is the repo-list half, which only the bare `lite` run asks for.
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
