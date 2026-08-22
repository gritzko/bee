//  view/cited.js — BEE-057: `bee cited <path>`, the mirror of `bee cite`.  The
//  same file, only what hangs under a line is now every place ELSEWHERE that
//  points at it.  The backlink rows name the carriers as SUSPECTS and no more
//  (INDEXES.mkd, "The suspects contract"); the precision the contract defers is
//  this view's half: each suspect is opened once, lexed once (index/hook.js:24:_m)
//  and resolved in its OWN ambient (BEE-028), and only a seat landing on this
//  very file stays.  The window, the merging and the split are view/quote.js's,
//  shared with cite, so the two directions can never read differently.
"use strict";

const ct = require("./cat.js");
const fs = require("view/fs.js");
const hk = require("index/hook.js");
const idx = require("index/index.js");
const mnt = require("index/mount.js");
const pm = require("index/perma.js");
const qt = require("./quote.js");
const rd = require("index/read.js");
const see = require("./see.js");

//  A path as the fs finally knows it: a suspect reached through a symlinked
//  registry entry must still match the target its ref landed on.
function real(p) { try { return io.realpath(p); } catch (e) { return p; } }

//  ONE carrier's references that land on `full`, appended in byte order.  The
//  carrier is read and lexed once, inside its own repo and dir, which is what
//  lets a relative ref in a sibling repo resolve where its author meant it.
//  Each entry carries `at`, the target line it lands on, 0 for an anchorless ref.
function incoming(carrier, full, out) {
  const bytes = ct.wtBytes(carrier);
  if (bytes === null || bytes === "dir" || bytes.length === 0) return;
  const door = require("door.js");
  const seen = new Set();
  mnt.within(door.posOf(carrier), function () {
    for (const t of hk.fTokens(bytes, fs.pathExt(carrier))) {
      let seat = null;
      try { seat = door.seatOf(t.text); } catch (e) { seat = null; }
      //  A miss, an ambiguity or a landing in another file: the row promised
      //  only a suspect, and this is the line where the promise is settled.
      if (seat === null || seat.rels || real(seat.full) !== full) continue;
      const line = qt.countNL(bytes, 0, t.lo) + 1;
      const at = seat.line >= 1 ? seat.line : 0;
      if (seen.has(line + ":" + at)) continue;     //  one line, one landing, once
      seen.add(line + ":" + at);
      //  The excerpt is cut over the CARRIER: what the reader has not got is
      //  the sentence that cited him, not the line of his own page below it.
      const cs = { full: carrier, line: line, col: 0, lo: t.lo, hi: t.hi };
      const ref = carrier + ":" + line;
      const h = see.excerpt(cs, ref, qt.UP, qt.DOWN, qt.SOLO);
      if (typeof h === "string") continue;         //  the carrier turned unreadable
      out.push({ at: at, seat: cs, ref: ref, hunk: h });
    }
  });
}

//  BEE-057: the CODE a ticket page is, or null.  The indexer keys a `LITE-028`
//  ref on the code alone, both ancestors absent (INDEXES.mkd, the LINK row), so
//  a query keyed on `todo/LITE/LITE-028.mkd` never meets its carriers.  This
//  only INVERTS the six spellings door.js:240 already resolves by.
function ticketOf(rel) {
  const door = require("door.js");
  const cut = rel.lastIndexOf("/");
  const base = cut < 0 ? rel : rel.slice(cut + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  //  BEE-008: a fat ticket is reached THROUGH its README, so the DIR spells it.
  if (stem !== "README") return door.ticketCode(stem);
  const up = cut < 0 ? "" : rel.slice(0, cut), c2 = up.lastIndexOf("/");
  return door.ticketCode(c2 < 0 ? up : up.slice(c2 + 1));
}

//  LITE-033: `lindex` IS the query — the bring-up of the LINK rows and the
//  BEE-002:60:SO fan-out over the registry are its, and no second finder exists.
function ask(target, root, opts) {
  return require("index/lindex.js").lindex(target,
             { repo: root, home: opts.home }).paths || [];
}

//  The suspects placed on the page: `body` sorted by the line they land on,
//  `head` the anchorless ones, which land on none and open above the file.  A
//  ref naming a line the target has not got adds nothing, as in cite.
function place(bytes, found) {
  const head = [], body = [];
  for (let i = 0; i < found.length; i++) {
    const c = found[i];
    c.i = i;                                       //  carrier order, the tiebreak
    if (c.at < 1) { c.cut = 0; head.push(c); continue; }
    const lo = pm.byteAt(bytes, c.at, 1);
    if (lo < 0) continue;
    c.hi = lo;
    c.cut = qt.lineEnd(bytes, lo);
    body.push(c);
  }
  body.sort(function (a, b) { return a.at - b.at || a.i - b.i; });
  const lead = [], cites = [];
  for (const c of head) qt.add(lead, c);
  for (const c of body) qt.add(cites, c);
  return { lead: lead, cites: cites };
}

//  BEE-057: the repo an ABSOLUTE target lives in — its own, climbed from the
//  file (door.js:528, `mnt.deepest` then the git walk).  A page outside every
//  repository has no history to carry backlinks, so it is refused right here.
function repoAt(path) {
  const repo = idx.discover(require("door.js").posOf(path).repo);
  if (repo === null) throw "cited: " + path + " is in no git repository";
  return repo;
}

//  cited(arg, opts) -> { uri, rel, hunks }, the one view shape (LITE-045:42:t2).
//  The worktree file only: the backlink rows are scanned off the TIP, so there
//  is no rev at which this page could honestly be answered.
function cited(arg, opts) {
  opts = opts || {};
  const a = rd.argSplit(arg);
  if (!a.path) throw "cited: needs a path — try: bee cited <path>";
  if (a.rev) throw "cited: the backlinks are indexed at the tip, so " +
                   a.path + "?" + a.rev + " has none — try: bee cited " + a.path;
  //  Every band on this page prints its carrier ABSOLUTE, so the reader feeds
  //  one straight back: an absolute target opens in ITS OWN repo, never in the
  //  one the run stands in.  door.js:74 has already expanded a `//name/rel`.
  const ctx = idx.openRepo(a.path.charAt(0) === "/" ? repoAt(a.path)
                                                    : (opts.from || io.cwd()), true);
  let bytes, rel, root, uriStr, pos;
  try {
    rel = rd.repoRel("cited", ctx, a.path, opts.from);
    if (rel === "") throw "cited: " + a.path + " is the repository root, not a file";
    root = ctx.root;
    uriStr = "cited " + rel;
    bytes = ct.wtBytes(root + "/" + rel);
    if (bytes === "dir") throw "cited: " + rel + " is a directory — try: bee list " + rel;
    if (bytes === null) throw "cited: there is no " + rel + " in the worktree";
    //  BEE-028: every segment NAMES its ambient, as cite.js:72 does, so a
    //  reference on the page still resolves from the file's own dir.
    pos = { repo: root, path: rel, anchor: "" };
  } finally { idx.closeRepo(ctx); }

  if (bytes.length === 0) return { uri: uriStr, rel: rel, hunks: [] };
  let paths;
  try { paths = ask(rel, root, opts); }
  catch (e) { throw "cited: " + e; }
  //  A ticket page is cited BY CODE as much as by path, and the two key
  //  different rows, so both are asked and the answers unioned in query order.
  //  The code half is a bonus: a refusal there must not cost the page.
  const code = ticketOf(rel);
  if (code !== null) try { paths = paths.concat(ask(code, root, opts)); } catch (e) {}

  const full = real(root + "/" + rel);
  const found = [], seen = new Set();
  //  gritzko, 2026-08-22: a page never cites ITSELF.  A ticket names its own
  //  code in its title, its worktree and its commit line, and none of the three
  //  is a backlink — so the target is dropped unread, not quoted and skipped.
  seen.add(full);
  for (const s of paths) {
    const r = real(s);
    if (seen.has(r)) continue;
    seen.add(r);
    incoming(s, full, found);
  }
  const p = place(bytes, found);
  const ext = fs.pathExt(rel);
  return { uri: uriStr, rel: rel,
           hunks: p.lead.map(function (c) { return c.hunk; })
                       .concat(qt.weave(uriStr, bytes, ext, p.cites, pos, "cited")) };
}

module.exports = { cited: cited, incoming: incoming, ticketOf: ticketOf };
