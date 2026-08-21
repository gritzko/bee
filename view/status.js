//  view/status.js — `bee status`, the quad ([/wiki/Status], BEE-022) over a
//  plain git repo: `<quad4> <path>` per interesting file, `<quad4> <sha8>
//  <subject>` per ahead/behind commit, and a `<branch>...<upstream>\t<counts>`
//  summary last, in git's own `-sb` spelling since bee rows carry no beagle
//  URIs.  The columns upstream / head / stage / worktree form a ladder
//  (BEE-022:76:wX); view/quad.js owns the pure merge, while this file gathers the
//  inputs (the tree listings, the GIT-032 stage reader, the worktree axis over
//  `dog._igno_*`, the CPAR divergence) and paints.  It writes no ref or lock.
"use strict";

const idx = require("index/index.js");
const dag = require("index/dag.js");
const refs = require("index/refs.js");
const rd = require("index/read.js");
const df = require("./diff.js");
const quad = require("./quad.js");

const UNTRACKED = "?";                  // a "sha" no tree entry can ever carry

//  A commit's leaves as a sorted `[{ path, sha }]`.  A gitlink is a leaf like
//  any blob, since an advanced submodule reads `v` ([/wiki/Status]), so the
//  walk takes both maps; the `.gitmodules` gate spares a repo without subs.
function leaves(r, tree) {
  const out = [];
  if (!tree) return out;
  const subs = (idx.readTree(r, tree) || new Map()).has(".gitmodules");
  const walk = function (t, prefix) {
    const M = idx.readTree(r, t);
    if (M === null) return;
    if (subs) for (const [name, sha] of idx.subTree(r, t))
      out.push({ path: prefix + name, sha: sha, sub: true });
    for (const [name, e] of M) {
      if (e.dir) walk(e.sha, prefix + name + "/");
      else out.push({ path: prefix + name, sha: e.sha });
    }
  };
  walk(tree, "");
  out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  return out;
}

//  A commit sha or hashlet -> its tree's leaves; an unreadable commit reads
//  as the empty tree, the same tolerance the index walks carry.
function leavesAt(ctx, name) {
  if (!name) return [];
  const m = idx.readCommit(ctx.r, name);
  return m === null ? [] : leaves(ctx.r, m.tree);
}

//  The stage column (GIT-032).  `dog.readIndex` is not in every build, so it
//  is feature-detected; without it the answer is `{ rows: null, note }` and
//  the view still runs with an all-`.` column, saying so rather than being
//  silently wrong (BEE-022:64:wX).
function stageOf(ctx) {
  if (typeof dog === "undefined" || typeof dog.readIndex !== "function")
    return { rows: null,
             note: "no stage column: this build has no dog.readIndex (GIT-032)" };
  let ix;
  try { ix = dog.readIndex(ctx.gitdir); }
  catch (e) { return { rows: null, note: "no stage column: " + e }; }
  if (ix === null) return { rows: [], con: new Set(), cache: new Map(), note: "" };
  const rows = [], con = new Set(), cache = new Map();
  for (const e of ix.entries) {
    //  Stage slots 1/2/3 are the conflict, read rather than deduced; the `ours`
    //  slot stands in for the column, a plain entry feeds column and stat cache.
    if (e.stage !== 0) {
      con.add(e.path);
      if (e.stage === 2) rows.push({ path: e.path, sha: e.sha });
      continue;
    }
    rows.push({ path: e.path, sha: e.sha });
    cache.set(e.path, e);
  }
  return { rows: rows, con: con, cache: cache, note: "" };
}

//  The worktree column.  `io.lstat` hands a localtime-aligned ron60
//  (abc/FILE.c:405 ron60_of_timespec) while the index entry carries epoch
//  seconds plus ns, so the entry's stamp is respelled the same way before the
//  two are compared.
function ronOf(secs, ns) {
  const d = new Date(secs * 1000);
  const y = d.getFullYear() - 2000;
  if (y < 0 || y > 99) return 0n;
  const ms = Math.min(999, Math.floor((ns || 0) / 1000000));
  const day = d.getDate(), dig = [Math.floor(ms % 64), Math.floor(ms / 64),
    d.getSeconds(), d.getMinutes(), d.getHours(), day % 10, Math.floor(day / 10),
    d.getMonth() + 1, y % 10, Math.floor(y / 10)];
  let r = 0n;
  for (let i = 0; i < 10; i++) r |= BigInt(dig[i]) << BigInt(6 * i);
  return r;
}

//  Is this file byte-identical to its index entry, by the stat cache alone?
//  Size and stamp must both match, and a racily clean entry (stamped no earlier
//  than the index file itself) is rehashed, git's own rule, so that a
//  same-second edit cannot read clean.
function statClean(st, e, idxRon) {
  if (e === undefined || st.size !== e.size) return false;
  if (e.assumeValid || e.skipWorktree) return true;
  const ron = ronOf(e.mtime, e.mtimeNs);
  if (ron === 0n || ron !== st.mtime) return false;
  return !(idxRon && ron >= idxRon);
}

//  The bytes on disk at one tracked path -> its blob sha, or null when gone.
//  A gitlink answers with the submodule's own head, so an advanced one reads
//  `v`; an uninitialised one reads as unchanged rather than as removed, which
//  is `rec` — the sha the commit recorded — standing in (BEE-040).
function wtSha(ctx, path, sub, e, st, idxRon, rec) {
  if (sub) {
    const hd = refs.head(idx.gitdirOf(ctx.root + "/" + path) || "");
    return hd === null ? (rec === undefined ? null : rec) : hd.sha;
  }
  if (statClean(st, e, idxRon)) return e.sha;
  const bytes = (st.kind === "reg" && st.size === 0) ? new Uint8Array(0)
              : df.wtBytes(ctx.root + "/" + path);
  return bytes === undefined ? null : df.blobSha(bytes);
}

//  wtOf(ctx, base, stage) -> the fourth listing.  Tracked paths (the union of
//  the head tree and the index) are measured file by file; everything else on
//  disk is untracked and goes through `scanUntracked`, so that a build tree
//  never floods the output.
function wtOf(ctx, base, stage, cache) {
  let idxRon = 0n;
  try { idxRon = io.lstat(ctx.gitdir + "/index").mtime; } catch (e) { idxRon = 0n; }
  const tracked = new Map();                       // path -> is it a gitlink?
  const rec = new Map();                           // BEE-040 gitlink -> recorded sha
  for (const e of base) {
    tracked.set(e.path, e.sub === true);
    if (e.sub === true) rec.set(e.path, e.sha);
  }
  for (const e of (stage || []))
    if (!tracked.has(e.path)) tracked.set(e.path, false);
  const out = [];
  for (const [path, sub] of tracked) {
    let st = null;
    try { st = io.lstat(ctx.root + "/" + path); } catch (e) { st = null; }
    if (st === null && !sub) continue;              // gone from the worktree
    const sha = wtSha(ctx, path, sub, cache ? cache.get(path) : undefined,
                      st, idxRon, rec.get(path));
    if (sha !== null) out.push({ path: path, sha: sha });
  }
  scanUntracked(ctx, tracked, out);
  out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  return out;
}

//  The ignore chain.  `dog._igno_*` (STATUS-020) matches one mmapped
//  `.gitignore`; the chain is the descent itself, each dir pushing its file
//  and popping it on the way out, so that a deeper rule wins and a path is
//  tested relative to each file's own dir.
function ignoStack(ctx) {
  const sets = [];                                 // [{ h, at }], shallow to deep
  const open = function (path, at) {
    const h = dog._igno_open(path);
    if (h) sets.push({ h: h, at: at });
    return h ? 1 : 0;
  };
  return {
    sets: sets,
    push: function (dir) {
      return open(ctx.root + (dir ? "/" + dir : "") + "/.gitignore", dir);
    },
    root: function () { return open(ctx.gitdir + "/info/exclude", ""); },
    pop: function (n) { for (let i = 0; i < n; i++) dog._igno_close(sets.pop().h); },
    //  Deeper wins: the last set with a definite (>= 0) verdict decides.
    match: function (rel, isDir) {
      let d = -1;
      for (const s of sets) {
        const p = s.at ? rel.slice(s.at.length + 1) : rel;
        const v = dog._igno_match(s.h, p, !!isDir);
        if (v >= 0) d = v;
      }
      return d === 1;
    },
    close: function () { while (sets.length) dog._igno_close(sets.pop().h); }
  };
}

//  Every file on disk that no tree and no index knows: the untracked rows.  An
//  ignored dir is pruned whole, which is what keeps this cheap, and `.git` is
//  never entered.
function scanUntracked(ctx, tracked, out) {
  if (typeof dog === "undefined" || typeof dog._igno_open !== "function") return;
  const ig = ignoStack(ctx);
  try {
    ig.root();
    const walk = function (dir) {
      let es;
      try { es = io.readdir(ctx.root + (dir ? "/" + dir : ""), { hidden: true }); }
      catch (e) { return; }
      const n = ig.push(dir);
      try {
        for (const raw of es) {
          const isDir = raw.slice(-1) === "/";
          const name = isDir ? raw.slice(0, -1) : raw;
          if (name === ".git") continue;
          const rel = dir ? dir + "/" + name : name;
          if (isDir) {
            //  BEE-040: a declared gitlink is a REPO BOUNDARY, as it is for git
            //  — its files are its own repo's rows, folded there (wtstat.js:110:sb).
            if (tracked.get(rel) !== true && !ig.match(rel, true)) walk(rel);
            continue;
          }
          if (tracked.has(rel) || ig.match(rel, false)) continue;
          out.push({ path: rel, sha: UNTRACKED });
        }
      } finally { ig.pop(n); }
    };
    walk("");
  } finally { ig.close(); }
}

//  Ahead/behind are two set differences over the index/dag.js ancestor sets,
//  so no merge base is needed and tips that never met read all ahead/behind.
const COMMIT_CAP = 4096;

function divergence(ctx, ix, mineHl, theirsHl) {
  const mine = dag.ancestors(ix, mineHl), theirs = dag.ancestors(ix, theirsHl);
  const only = function (a, b) {
    const out = [];
    for (const hl of a) {
      if (b.has(hl)) continue;
      const m = idx.readCommit(ctx.r, idx.hexOfHl(hl));
      out.push({ hashlet: idx.hexOfHl(hl), subject: m ? m.subject : "",
                 ts: m ? m.ats : 0 });
    }
    out.sort(function (x, y) { return y.ts - x.ts; });
    return out.length > COMMIT_CAP ? out.slice(0, COMMIT_CAP) : out;
  };
  return { ahead: only(mine, theirs), behind: only(theirs, mine) };
}

//  Plain output keeps the greppable ASCII canon, a conflict spelled `!` on the
//  wt char; a tty substitutes the BRO-030:32:re glyphs, one cell per column.
const TTY = { ".": ".", "x": "∅", "o": "●", "v": "↑" };
const TTY_COMMIT = { ".": ".", "x": "∅", "o": "✔", "v": "↑" };
//  Four cell tags of the quad's own (I J K V, M for a conflict), never a
//  syntax tag on loan, so no other palette change can move a status column.
const CELL = ["I", "J", "K", "V"], CELL_CON = "M";

function plainQuad(q, con) {
  return con ? q.slice(0, 3) + "!" : q;
}

//  rowsOf(model, ctx) -> [{ quad, con, text, nav }]: commit rows first, then
//  file rows by path.  A row clicks to where its quad points: a commit row
//  into `commit`, a path git never saw into `cat`, the rest into BEE-046's
//  `dog` — the file whole, its wt-vs-HEAD spans washed, which `diff` cannot
//  be, having to stay silent on a row the worktree did not move.
function rowsOf(model, ctx) {
  const out = [];
  for (const c of model.commits)
    out.push({ quad: c.quad, con: false, commit: true,
               text: c.hashlet.slice(0, 8) + (c.subject ? " " + c.subject : ""),
               nav: "commit " + c.hashlet });
  for (const r of model.rows)
    out.push({ quad: r.quad, con: r.con, commit: false, text: r.path,
               gitlink: r.gitlink,
               nav: (r.quad.charAt(3) === "o" ? "cat " : "dog ") +
                    rd.navPath(ctx, r.path) });
  return out;
}

//  The summary line: what head is, what it tracks, the per-column tallies with
//  zeros omitted, and the words when a column could not be read.
function summaryOf(model, s) {
  const seg = [];
  const c = model.counts;
  if (c.track) seg.push(c.track + " upstream");
  if (c.head) seg.push(c.head + " head");
  if (c.stage) seg.push(c.stage + " stage");
  if (c.wt) seg.push(c.wt + " wt");
  if (c.con) seg.push(c.con + " con");
  return s.branch + (s.track ? "..." + s.track : "") + "\t" +
         (seg.length ? seg.join(", ") : "clean") + (s.note ? "\t" + s.note : "");
}

function plainOf(rows, summary) {
  let out = "";
  for (const r of rows) out += plainQuad(r.quad, r.con) + " " + r.text + "\n";
  return utf8.Encode(out + summary + "\n");
}

//  tok32 (dog/tok/TOK.h): tag in bits 31..27, end byte offset in 23..0.
function tagCode(letter) { return letter.charCodeAt(0) - 65; }
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }
const TAG_U = 20, TAG_S = 18, TAG_F = 5, TAG_D = 3, TAG_Q = 16, TAG_N = 13;

//  The pager hunk: the glyph row, one span per quad cell, the click target
//  under a hidden `U` span as in view/list.js, so the pager stays verb-blind.
//  `plain` carries the ASCII canon, so a pipe never sees a glyph.
function hunkOf(uriStr, rows, summary) {
  const b = io.buf(1 << 14);
  const spans = [];
  const put = function (tag, str) {
    const worst = str.length * 4 + 4;
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  for (const r of rows) {
    const g = r.commit ? TTY_COMMIT : TTY;
    for (let i = 0; i < 4; i++) {
      const ch = r.quad.charAt(i);
      const con = r.con && i === 3;
      put(tagCode(ch === "." && !con ? "S" : con ? CELL_CON : CELL[i]),
          con ? "!" : (g[ch] || ch));
    }
    put(TAG_U, r.nav);
    put(TAG_S, " ");
    //  A declared submodule's path reads bold on a tty; plain is untouched.
    put(r.commit ? TAG_D : r.gitlink ? TAG_N : TAG_F, r.text);
    put(TAG_U, r.nav);
    put(TAG_S, "\n");
  }
  put(TAG_Q, summary);
  put(TAG_S, "\n");
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "status",
           plain: plainOf(rows, summary), bare: true };
}

//  status(arg, opts) -> { uri, model, rows, hunks }.  Head is the base and
//  the upstream comes off index/refs.js (detached or untracked: track = head).
//  The root tree is the merge base's, since column 1 stands on the fork
//  (BEE-022:76:wX); tips that never met list an empty root rather than refusing.
function status(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const base = ctx.head.sha;
    const up = refs.upstream(ctx.gitdir, ctx.head.ref);
    const track = up === null ? base : up.sha;
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    let div = { ahead: [], behind: [] };
    let rootSha = base;                 // no upstream: the fork is head itself
    try {
      idx.bringUp(ctx, ix, { track: false });
      if (track !== base) {
        idx.bringUp(ctx, ix, { tip: track, track: false });
        const mine = idx.hlOfSha(base), theirs = idx.hlOfSha(track);
        div = divergence(ctx, ix, mine, theirs);
        const mb = dag.mergeBase(ix, mine, theirs);
        rootSha = mb === null ? "" : idx.hexOfHl(mb);
      }
    } finally { try { ix.close(); } catch (e) {} }

    const st = stageOf(ctx);
    const baseL = leavesAt(ctx, base);
    const gitlink = new Set();
    for (const e of baseL) if (e.sub) gitlink.add(e.path);
    const model = quad.quadModel({
      root: rootSha === base ? baseL : rootSha ? leavesAt(ctx, rootSha) : [],
      track: track === base ? baseL : leavesAt(ctx, track),
      base: baseL, stage: st.rows, wt: wtOf(ctx, baseL, st.rows, st.cache),
      con: st.con, gitlink: gitlink, ahead: div.ahead, behind: div.behind });

    const branch = ctx.head.ref === "HEAD" ? "HEAD"
                 : ctx.head.ref.slice(0, 11) === "refs/heads/"
                   ? ctx.head.ref.slice(11) : ctx.head.ref;
    const rows = rowsOf(model, ctx);
    //  The degraded run says both halves of what it lost: the column, and the
    //  neighbour the worktree rung had to stand on instead.
    const note = st.note ? st.note + "; the worktree column reads against HEAD" : "";
    const summary = summaryOf(model, { branch: branch, track: up ? up.short : "",
                                       note: note });
    const uriStr = "status" + (arg ? " " + arg : "");
    return { uri: uriStr, model: model, rows: rows,
             hunks: [hunkOf(uriStr, rows, summary)] };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { status: status, rowsOf: rowsOf, hunkOf: hunkOf,
                   plainOf: plainOf, summaryOf: summaryOf, plainQuad: plainQuad,
                   leaves: leaves, stageOf: stageOf, wtOf: wtOf,
                   //  BEE-024 takes the stage column and this walk as its
                   //  candidate set; the quad is the only other caller.
                   scanUntracked: scanUntracked,
                   //  BEE-027 arms its rev tree over this very chain, so the
                   //  watcher skips exactly what the quad skips (cache.js:117 ignoOf).
                   ignoStack: ignoStack,
                   ronOf: ronOf, TTY: TTY, TTY_COMMIT: TTY_COMMIT,
                   CELL: CELL, CELL_CON: CELL_CON };
