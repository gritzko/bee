//  door.js — LITE-045: THE DOOR, the one place a TARGET becomes hunks.
//
//  A target is either a `<verb> <arg>` line, which the VERBS table answers, or
//  a REFERENCE, which `seatOf` resolves — the LITE-025 permalink follow, the
//  path the fs answers, the LITE-015/LITE-011 FSEG partial, the LITE-024
//  worktree scan.  The CLI, the pager's clicks and `lite serve`'s links all
//  come through here, so a click target is an ordinary line of text and no
//  view-specific opener exists anywhere.
//
//  It KNOWS THE VIEWS AND NOTHING ELSE: no renderer, no tty, no HTTP.  main.js
//  dispatches through it, pager.js is handed `openTarget` as its `open`,
//  serve.js is handed the whole table.
"use strict";

const fs = require("view/fs.js");

//  THE fs open, shared by the plain dump and the pager (opts.open): stat the
//  bare path, dir → listing hunk, file → mmap+tokenize; a miss → null.  The
//  pager's door is `(path) -> hunks | null`, so the hunk rides a one-elem list.
//  LITE-034: the door's first move, on its own — what the fs says a path is, or
//  null.  A caller that only needs to RESOLVE never has to open to find out.
function statOf(path) {
  try { return io.stat(fs.fsPath(path)); } catch (e) { return null; }
}

function openPath(path) {
  const fp = fs.fsPath(path);
  const st = statOf(path);
  if (st === null) return null;
  let hunk;
  try {
    //  The hunk URI is the arg VERBATIM (trailing '/' kept) — only fs ops see fp.
    hunk = st.kind === "dir" ? fs.buildDirHunk(path, fp) : fs.buildFileHunk(path, fp);
  } catch (e) { return null; }
  return hunk === null ? null : [hunk];              // empty dir → no hunk
}
//  ---- the ONE door --------------------------------------------------------
//  Every view a verb can produce, keyed by the verb: `(arg) -> hunks`.  The CLI
//  legs above and the PAGER both come through this table, so a click target is
//  an ordinary `<verb> <arg>` line and no view-specific opener exists.
//  LITE-045: ONE view shape — every entry is `(arg, opts) -> hunks`, and every
//  hunk carries its own plain bytes, so no caller here knows a view apart.
//  `opts.full` says the sink is a STREAM with no viewport (a pipe takes every
//  row); the pager and `lite serve` pass nothing and get the view's own cap.
const VERBS = {
  //  A log row's sha8 is a click-target: the row carries `commit <hexlet>`, the
  //  pager hands it to the door and pushes that view, `-` backs out.
  log: function (arg, opts) { return require("view/log.js").view(arg, opts); },
  //  The metadata hunk, then the commit's own files: one hunk set per changed
  //  or added file, an empty (banner-only) hunk per removed one.
  commit: function (arg, opts) { return require("view/commit.js").commit(arg, opts).hunks; },
  diff: function (arg, opts) { return require("view/diff.js").diff(arg, opts).hunks; },
  //  LITE-017: the read views come through the same door, so a `tree` row's
  //  hidden target opens a `blob`, a `list` row's opens a `cat`, and the pager
  //  stays arg-blind throughout.
  list: function (arg, opts) { return require("view/list.js").list(arg, opts).hunks; },
  cat:  function (arg, opts) { return require("view/cat.js").cat(arg, opts).hunks; },
  tree: function (arg, opts) { return require("view/tree.js").tree(arg, opts).hunks; },
  blob: function (arg, opts) { return require("view/blob.js").blob(arg, opts).hunks; }
};

//  A verb NAME -> its view, or null.  An own-property test, so `constructor`
//  and friends are paths like any other word.
function verbOf(name) {
  return Object.prototype.hasOwnProperty.call(VERBS, name) ? VERBS[name] : null;
}

//  LITE-034: THE DOOR'S RESOLUTION, split out of its opening.  A target that is
//  not a `<verb> <arg>` line is a REFERENCE, and this is the one place one is
//  resolved: the LITE-025 permalink follow when it carries a hashlet, else the
//  path the fs answers, else the LITE-015/LITE-011 FSEG partial, else the
//  LITE-024 worktree scan.  `openTarget` opens what comes back; `lite serve`
//  turns the very same seat into an href — one mechanism, no serve-side variant.
//
//  -> null (nothing answers) | { rels, arg, tail } (SEVERAL: the chooser)
//     | { full, line, col, lo, hi, note } (the landing).
function seatOf(target) {
  const ref = splitRef(target);
  //  LITE-025: a permalink names a commit, so the fs cannot answer it alone.
  if (ref.hash) {
    let seat;
    try { seat = require("index/perma.js").follow(ref.path, ref.off, ref.hash); }
    catch (e) { return null; }
    if (seat === null) return null;
    if (seat.rels) return { rels: seat.rels, arg: ref.path + ref.tail, tail: ref.tail };
    return { full: seat.full, line: seat.line, col: seat.col,
             lo: seat.lo, hi: seat.hi, note: seat.note };
  }
  if (statOf(ref.path) !== null)
    return { full: ref.path, line: ref.line, col: ref.col };
  //  LITE-024: no repo to descend (a jab tree, a plain dir) — a bounded
  //  worktree walk resolves the ref instead; git-repo semantics unchanged.
  let paths = resolvePartial(ref.path);
  if (paths === null) paths = scanPartial(io.cwd(), ref.path);
  if (paths.length === 0) return null;
  if (paths.length === 1) return { full: paths[0].full, line: ref.line, col: ref.col };
  return { rels: paths, arg: ref.path + (ref.tail || ""), tail: ref.tail };
}

//  LITE-024: the no-git fallback — BFS the worktree from `root`, match the
//  partial as a path suffix; dotfiles skipped, entry/hit caps bound the walk.
function scanPartial(root, partial) {
  const out = [], q = [""];
  let seen = 0;
  while (q.length && seen < 20000 && out.length < 32) {
    const dir = q.shift();
    let es;
    try { es = io.readdir(root + (dir ? "/" + dir : ""), { hidden: false }); }
    catch (e) { continue; }
    for (const e of es) {
      if (++seen > 20000) break;
      const isDir = e.endsWith("/");
      const rel = (dir ? dir + "/" : "") + (isDir ? e.slice(0, -1) : e);
      if (isDir) { q.push(rel); continue; }
      if (rel === partial || rel.endsWith("/" + partial))
        out.push({ rel: rel, full: root + "/" + rel });
    }
  }
  out.sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
  return out;
}

//  The resolution itself, at HEAD of the CWD repo, through the ONE resolver.
//  The recovered text is repo-relative; the fs path anchors at the repo ROOT,
//  so a reference clicked from a subdir opens the file the name stands for.
function resolvePartial(partial) {
  const idx = require("index/index.js");
  let ctx;
  //  LITE-024: null = NO REPO here (the caller may fs-scan); [] = repo, no hit.
  try { ctx = idx.openRepo(io.cwd(), true); } catch (e) { return null; }
  try {
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });    // the lazy contract, as ever
      const rel = require("index/resolve.js").resolveAt(ctx, ix, ctx.head.sha, partial);
      return rel.map(function (p) { return { rel: p, full: ctx.root + "/" + p }; });
    } finally { try { ix.close(); } catch (e) {} }
  } catch (e) { return []; }
  finally { idx.closeRepo(ctx); }
}

//  Resolve ONE target to hunks (`null` = nothing to open): a `<verb> <arg>`
//  line goes to its verb, anything else is a PATH.  A target must carry an arg
//  to read as a verb, so a file merely NAMED `log` still opens as the file.
//  LITE-024: the byte before a ref's `:line(:col)?` tail, or -1 when the last
//  colon has no all-digit run after it (`b.c:` and `TCP.c:100:a7` keep theirs).
function digitTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  for (let k = i + 1; k < s.length; k++)
    if (s.charCodeAt(k) < 0x30 || s.charCodeAt(k) > 0x39) return -1;
  return i;
}

//  LITE-025: the PERMALINK form `file.c:k4:d8K3` — the SAME fused `F` token,
//  decided by SEGMENT 2: a hashlet (even, 4..10 ron64 chars, one non-digit) says
//  permalink, an all-digit segment 2 stays LITE-024's column.  -1 = not one.
function permaTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  const j = s.lastIndexOf(":", i - 1);
  if (j <= 0 || j === i - 1) return -1;
  const pm = require("index/perma.js");
  return pm.isHashlet(s.slice(i + 1)) && pm.isOffset(s.slice(j + 1, i)) ? j : -1;
}

//  LITE-024: split a ref (DOG-034 fuses `abc/TCP.c:12:24` into ONE `F` token)
//  into the path the fs sees and the landing the pager scrolls to.
//  LITE-025: the same split answers for a permalink — `off`/`hash` instead of
//  line:col; `tail` is the anchor as written, which the chooser rows carry.
function splitRef(target) {
  const p = permaTail(target);
  if (p >= 0) {
    const k = target.indexOf(":", p + 1);
    return { path: target.slice(0, p), tail: target.slice(p), line: 0, col: 0,
             off: target.slice(p + 1, k), hash: target.slice(k + 1) };
  }
  const i = digitTail(target);
  if (i < 0) return { path: target, tail: "", line: 0, col: 0 };
  const last = Number(target.slice(i + 1));
  const head = target.slice(0, i);
  const j = digitTail(head);
  if (j < 0) return { path: head, tail: target.slice(i), line: last, col: 0 };
  return { path: head.slice(0, j), tail: target.slice(j), line: Number(head.slice(j + 1)),
           col: last };
}

//  OPEN one target: a `<verb> <arg>` line goes to its verb, anything else is a
//  REFERENCE that seatOf resolves and this opens.  A miss stays the caller's
//  quiet bar message; SEVERAL hits become the LITE-015 chooser, carrying the
//  LITE-024 tail so a picked row still lands on the line the reference named.
function openTarget(target) {
  const sp = target.indexOf(" ");
  const fn = sp > 0 ? VERBS[target.slice(0, sp)] : null;
  if (!fn) {
    const seat = seatOf(target);
    if (seat === null) return null;
    if (seat.rels) return [fs.buildChooserHunk(seat.arg, seat.rels, seat.tail)];
    const hs = openPath(seat.full);
    if (hs === null) return null;
    //  LITE-045: the landing rides the HUNK it names, not the list around it —
    //  `land` is a field of the one view shape, like `plain`.
    if (seat.line) {
      const land = { line: seat.line, col: seat.col };
      //  LITE-029: the token the resolver walked to rides along as its own bytes
      //  — the pager selects THAT, instead of re-deriving one from the column.
      if (seat.hi > seat.lo) { land.lo = seat.lo; land.hi = seat.hi; }
      if (seat.note) land.note = seat.note;
      hs[0].land = land;
    }
    return hs;
  }
  let hunks;
  try { hunks = fn(target.slice(sp + 1).trim()); } catch (e) { return null; }
  return hunks && hunks.length ? hunks : null;
}

module.exports = {
  VERBS: VERBS, verbOf: verbOf,
  //  LITE-034: the door's resolution and its fs probe, so `lite serve` links
  //  through the SAME code the pager clicks.
  statOf: statOf, openPath: openPath, seatOf: seatOf, splitRef: splitRef,
  openTarget: openTarget,
};
