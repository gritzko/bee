//  LITE-045:27 CLI, pager and http must open any target the same way.
"use strict";

const fs = require("view/fs.js");

//  LITE-034:40 a caller that only resolves (e.g. an href) must not pay for an open.
function statOf(path) {
  try { return io.stat(fs.fsPath(path)); } catch (e) { return null; }
}

//  One fs open for dump and pager alike: dir → listing hunk, file → tokenized.
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
//  LITE-045:42 one view shape `(arg, opts) -> hunks`, so no caller tells views
//  apart; `opts.full` = no viewport (a pipe), else the view's own row cap.
const VERBS = {
  log: function (arg, opts) { return require("view/log.js").view(arg, opts); },
  commit: function (arg, opts) { return require("view/commit.js").commit(arg, opts).hunks; },
  diff: function (arg, opts) { return require("view/diff.js").diff(arg, opts).hunks; },
  //  LITE-017:40 a `tree` row opens a `blob`, a `list` row a `cat`; pager stays arg-blind.
  list: function (arg, opts) { return require("view/list.js").list(arg, opts).hunks; },
  cat:  function (arg, opts) { return require("view/cat.js").cat(arg, opts).hunks; },
  tree: function (arg, opts) { return require("view/tree.js").tree(arg, opts).hunks; },
  blob: function (arg, opts) { return require("view/blob.js").blob(arg, opts).hunks; }
};

//  Verb name -> view | null; own-property test, so `constructor` is a path.
function verbOf(name) {
  return Object.prototype.hasOwnProperty.call(VERBS, name) ? VERBS[name] : null;
}

//  LITE-034:40 a reference (core/Link.mkd:3) resolves in ONE place, so an http
//  href and a pager click land alike: permalink | fs | FSEG partial | wt scan.
//  -> null | { rels, arg, tail } (SEVERAL: the chooser) | { full, line, col,
//     lo, hi, note } (the landing).
function seatOf(target) {
  const ref = splitRef(target);
  //  LITE-025:44 a permalink names a commit; the fs alone cannot answer it.
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
  //  LITE-024:42 no repo to descend — a bounded worktree walk answers instead.
  let paths = resolvePartial(ref.path);
  if (paths === null) paths = scanPartial(io.cwd(), ref.path);
  if (paths.length === 0) return null;
  if (paths.length === 1) return { full: paths[0].full, line: ref.line, col: ref.col };
  return { rels: paths, arg: ref.path + (ref.tail || ""), tail: ref.tail };
}

//  LITE-024:42 refs must click outside git too: bounded BFS, path-suffix match.
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

//  LITE-011:47 a partial path resolves at HEAD of the CWD repo, from the repo ROOT.
function resolvePartial(partial) {
  const idx = require("index/index.js");
  let ctx;
  //  null = NO REPO here (the caller may fs-scan); [] = repo, no hit.
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

//  dog/tok/LINK.rl:76 the byte before a `:line(:col)?` anchor, or -1 if none.
function digitTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  for (let k = i + 1; k < s.length; k++)
    if (s.charCodeAt(k) < 0x30 || s.charCodeAt(k) > 0x39) return -1;
  return i;
}

//  dog/tok/LINK.rl:77 the byte before a `:off:hashlet` permalink anchor, or -1.
function permaTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  const j = s.lastIndexOf(":", i - 1);
  if (j <= 0 || j === i - 1) return -1;
  const pm = require("index/perma.js");
  return pm.isHashlet(s.slice(i + 1)) && pm.isOffset(s.slice(j + 1, i)) ? j : -1;
}

//  core/Link.mkd:9 split a ref into path + anchor (line/col or off/hash).
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

//  A target with an arg is a verb line, anything else a reference — so a file
//  merely NAMED `log` still opens as the file.
function openTarget(target) {
  const sp = target.indexOf(" ");
  const fn = sp > 0 ? VERBS[target.slice(0, sp)] : null;
  if (!fn) {
    const seat = seatOf(target);
    if (seat === null) return null;
    if (seat.rels) return [fs.buildChooserHunk(seat.arg, seat.rels, seat.tail)];
    const hs = openPath(seat.full);
    if (hs === null) return null;
    //  LITE-045:42 the landing rides the hunk it names, like any view field.
    if (seat.line) {
      const land = { line: seat.line, col: seat.col };
      //  LITE-029:39 the resolver's token rides along so the pager selects IT.
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
  //  LITE-034:40 http links through the SAME code the pager clicks.
  statOf: statOf, openPath: openPath, seatOf: seatOf, splitRef: splitRef,
  openTarget: openTarget,
};
