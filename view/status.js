//  view/status.js — BEE-022: `bee status`, the quad ([/wiki/Status]) over a
//  plain git repo.  ONE row per interesting path, four chars wide:
//
//      <quad4> <path>                    a file row
//      <quad4> ?<hashlet>#<subject>      a commit row (ahead `.o..`, behind `o...`)
//      <branch>?<upstream>\t<counts>     the summary line, last
//
//  The columns are UPSTREAM / HEAD / STAGE / WORKTREE, a LADDER read rung by
//  rung (view/quad.js owns the pure merge); this file is the GATHER — the four
//  listings, the [GIT-032] stage reader, the worktree axis over `dog._igno_*`
//  and the CPAR divergence — plus the painter.
//  Read-only and derived: nothing here writes a ref, an index or a lock.
"use strict";

const idx = require("index/index.js");
const dag = require("index/dag.js");
const refs = require("index/refs.js");
const rd = require("index/read.js");
const df = require("./diff.js");
const quad = require("./quad.js");

const UNTRACKED = "?";                  // a sha no tree entry can ever carry

//  --- the tree columns ------------------------------------------------------
//  A commit's leaves as a sorted `[{ path, sha }]`.  A GITLINK is a leaf like
//  any blob ([/wiki/Status]: an advanced submodule is a `v`), so the walk takes
//  both maps; the `.gitmodules` gate keeps a repo without subs off that path.
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

//  A commit sha (or hashlet) -> its tree's leaves; an unreadable commit reads
//  as the EMPTY tree, the same tolerance the index walks carry.
function leavesAt(ctx, name) {
  if (!name) return [];
  const m = idx.readCommit(ctx.r, name);
  return m === null ? [] : leaves(ctx.r, m.tree);
}

//  --- the STAGE column ([GIT-032]) ------------------------------------------
//  `dog.readIndex` is NOT landed everywhere: feature-detect, and on its absence
//  answer `{ rows: null, note }` so the view still runs with the column all-`.`
//  and SAYS so (the ticket's constraint) — never silently wrong.
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
    //  Slots 1/2/3 ARE the conflict — read, never deduced.  The `ours` slot
    //  stands in for the column; a plain entry is the column and the stat cache.
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

//  --- the WORKTREE column ---------------------------------------------------
//  git's stat cache in ron60: `io.lstat` hands a LOCALTIME-aligned ron60
//  (abc/FILE.c ron60_of_timespec) and DIRC hands epoch seconds + ns, so the
//  entry's stamp is re-spelled the same way before the two are compared.
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

//  Is this file byte-identical to its index entry, on the stat cache alone?
//  Size AND stamp must match, and a RACILY-CLEAN entry (stamped no earlier than
//  the index file itself) is rehashed — git's own rule, so a same-second edit
//  cannot read clean.
function statClean(st, e, idxRon) {
  if (e === undefined || st.size !== e.size) return false;
  if (e.assumeValid || e.skipWorktree) return true;
  const ron = ronOf(e.mtime, e.mtimeNs);
  if (ron === 0n || ron !== st.mtime) return false;
  return !(idxRon && ron >= idxRon);
}

//  The bytes on disk at one tracked path -> its blob sha, or null when it is
//  gone.  A GITLINK answers with the submodule's OWN HEAD (the `adv` case);
//  an uninitialised one reads as unchanged rather than as a removal.
function wtSha(ctx, path, sub, e, st, idxRon) {
  if (sub) {
    const hd = refs.head(idx.gitdirOf(ctx.root + "/" + path) || "");
    return hd === null ? null : hd.sha;
  }
  if (statClean(st, e, idxRon)) return e.sha;
  const bytes = (st.kind === "reg" && st.size === 0) ? new Uint8Array(0)
              : df.wtBytes(ctx.root + "/" + path);
  return bytes === undefined ? null : df.blobSha(bytes);
}

//  wtOf(ctx, base, stage) -> the 4th listing.  TRACKED paths (the union of the
//  HEAD tree and the index) are measured file by file; everything else on disk
//  is UNTRACKED and rides `scanUntracked` below, so a build tree never becomes
//  the output.
function wtOf(ctx, base, stage, cache) {
  let idxRon = 0n;
  try { idxRon = io.lstat(ctx.gitdir + "/index").mtime; } catch (e) { idxRon = 0n; }
  const tracked = new Map();                       // path -> is it a gitlink
  for (const e of base) tracked.set(e.path, e.sub === true);
  for (const e of (stage || []))
    if (!tracked.has(e.path)) tracked.set(e.path, false);
  const out = [];
  for (const [path, sub] of tracked) {
    let st = null;
    try { st = io.lstat(ctx.root + "/" + path); } catch (e) { st = null; }
    if (st === null && !sub) continue;              // gone from the worktree
    const sha = wtSha(ctx, path, sub, cache ? cache.get(path) : undefined,
                      st, idxRon);
    if (sha !== null) out.push({ path: path, sha: sha });
  }
  scanUntracked(ctx, tracked, out);
  out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  return out;
}

//  --- the ignore chain ------------------------------------------------------
//  STATUS-020's `dog._igno_open/_match/_close` is ONE mmapped `.gitignore`; the
//  CHAIN is JS's, and here it is the descent itself — every dir pushes its own
//  file and pops it on the way out, so a deeper rule overrides a shallower one
//  and a path is tested relative to each file's OWN dir.  `.git/info/exclude`
//  rides as the root level's second set.
function ignoStack(ctx) {
  const sets = [];                                 // [{ h, at }] shallow -> deep
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

//  Every file on disk that no tree and no index knows — the UNTRACKED rows.
//  An ignored dir is pruned WHOLE (which is what makes this cheap), and `.git`
//  is never entered at all.
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
            if (!ig.match(rel, true)) walk(rel);
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

//  --- the commit rows -------------------------------------------------------
//  Ahead/behind is the CPAR walk the index already serves: the ancestor set of
//  each tip (`index/dag.js`, capped there), and the rows are the two SET
//  DIFFERENCES — no merge base is computed and none is needed, so two tips that
//  never met simply read as all-ahead and all-behind.
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

//  --- the paint -------------------------------------------------------------
//  PLAIN keeps the greppable ASCII canon and spells a conflict `!` on the wt
//  char; a tty substitutes the [BRO-030] glyphs and paints one CELL per column
//  (view/quadrender.js's rules, render/ansi.js carries the slots).
const TTY = { ".": ".", "x": "∅", "o": "●", "v": "↑" };
const TTY_COMMIT = { ".": ".", "x": "∅", "o": "✔", "v": "↑" };
//  The per-column cell tags — FOUR SLOTS OF THE QUAD'S OWN (ruling
//  2026-08-18), never a syntax or status tag on loan, so nothing else in the
//  palette can move a status column: I blue upstream, J green head, K amber
//  stage, V orange worktree, and M red for a conflict and nothing else.
//  '.' is unpainted ('S'), so position stays authoritative.
const CELL = ["I", "J", "K", "V"], CELL_CON = "M";

function plainQuad(q, con) {
  return con ? q.slice(0, 3) + "!" : q;
}

//  --- the rows --------------------------------------------------------------
//  rowsOf(model, ctx) -> [{ quad, con, text, nav }]: commit rows first (newest
//  first, as the model orders them), then the file rows lex by path.  A row
//  clicks where its quad points: a commit row into `commit`, a path bee has
//  never seen into `cat`, everything else into the `diff` that shows the char.
function rowsOf(model, ctx) {
  const out = [];
  for (const c of model.commits)
    out.push({ quad: c.quad, con: false, commit: true,
               text: "?" + c.hashlet + (c.subject ? "#" + c.subject : ""),
               nav: "commit " + c.hashlet });
  for (const r of model.rows)
    out.push({ quad: r.quad, con: r.con, commit: false, text: r.path,
               gitlink: r.gitlink,
               nav: (r.quad.charAt(3) === "o" ? "cat " : "diff ") +
                    rd.navPath(ctx, r.path) });
  return out;
}

//  The summary line: what HEAD is, what it tracks, and the per-column tallies
//  (zeros omitted) — plus the WORDS when a column could not be read.
function summaryOf(model, s) {
  const seg = [];
  const c = model.counts;
  if (c.track) seg.push(c.track + " upstream");
  if (c.head) seg.push(c.head + " head");
  if (c.stage) seg.push(c.stage + " stage");
  if (c.wt) seg.push(c.wt + " wt");
  if (c.con) seg.push(c.con + " con");
  return s.branch + (s.track ? "?" + s.track : "") + "\t" +
         (seg.length ? seg.join(", ") : "clean") + (s.note ? "\t" + s.note : "");
}

function plainOf(rows, summary) {
  let out = "";
  for (const r of rows) out += plainQuad(r.quad, r.con) + " " + r.text + "\n";
  return utf8.Encode(out + summary + "\n");
}

//  tok32 (dog/tok/TOK.h): [31..27] tag, [23..0] end byte offset.
function tagCode(letter) { return letter.charCodeAt(0) - 65; }
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }
const TAG_U = 20, TAG_S = 18, TAG_F = 5, TAG_D = 3, TAG_Q = 16, TAG_N = 13;

//  The pager hunk: the GLYPH row, one tok span per quad cell, the click target
//  riding a hidden `U` span (view/list.js's own shape, so the pager stays
//  arg-blind).  `plain` carries the ASCII canon, so a pipe never sees a glyph.
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
    //  A declared submodule's path reads BOLD on a tty; plain is untouched.
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

//  --- the verb --------------------------------------------------------------
//  status(arg, opts) -> { uri, model, rows, hunks }.  The tips first: HEAD is
//  the base and the upstream is `index/refs.js upstream` (no second resolver);
//  detached or untracked => track = HEAD, an all-`.` first column.  Column 1
//  stands on the FORK POINT (ruling 2026-08-18b), so the root tree is the
//  merge base's; two tips that never met have none and it lists as EMPTY,
//  which reads every upstream path `o` rather than refusing.
function status(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const base = ctx.head.sha;
    const up = refs.upstream(ctx.gitdir, ctx.head.ref);
    const track = up === null ? base : up.sha;
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    let div = { ahead: [], behind: [] };
    let rootSha = base;                 // no upstream: the fork IS HEAD
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
    //  The degrade path SAYS both halves of what it lost: the column, and the
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
                   ronOf: ronOf, TTY: TTY, TTY_COMMIT: TTY_COMMIT,
                   CELL: CELL, CELL_CON: CELL_CON };
