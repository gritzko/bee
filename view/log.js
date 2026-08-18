//  view/log.js — `bee log [<n>] [<hex>|<path>][?<rev>]` (LITE-007): the commit
//  and file logs read off the LITE-006 index, the CPAR DAG for a commit and one
//  `path_hl` prefix scan for a file, with no ODB walk at query time.  The verb
//  brings the index up itself, so `bee index` never has to run first.  The
//  first-parent spine keeps its columns and every other row greys whole
//  (LITE-020); a capped walk follows git's default heap order, an uncapped one
//  the strict reverse Kahn (LITE-013).  `?<rev>` tips, the submodule descent
//  and ticket `F` spans are BEE-020's (BEE-020:30:Lc, :31, :33).
"use strict";

const idx = require("index/index.js");

//  6..40 hex names a commit; anything else is a path (LITE-007:24:El).
const HEXARG = /^[0-9a-fA-F]{6,40}$/;

//  The row of be/views/log/log.js appendRow, byte for byte: `<sha8> <date7>
//  <summary> (<author>)`.  `date7` is ron.date's 7 columns with its leading
//  and trailing space, so the row carries two spaces on each side of the date.
function authorName(author) {
  const a = author || "";
  const lt = a.indexOf(" <");
  return lt >= 0 ? a.slice(0, lt) : a;
}
//  ron60 spans the years 2000..2099, so a 1998 commit has no ron60 and
//  `RONOfTime` refuses it; `ron.date(0n)` is the "   ?   " column be log shows
//  for a commit with no usable stamp, so such a date renders as one, no error.
function date7Of(secs) {
  if (!(secs > 0)) return ron.date(0n);
  try { return ron.date(ron.of(secs * 1000)); } catch (e) { return ron.date(0n); }
}
//  The row's columns, kept apart so that the tty leg can tag each one; `row()`
//  is the plain join the piped leg writes.
function rowParts(name, m) {
  return { sha8: name.slice(0, 8), hex: name,
           date7: date7Of(m ? m.ats : 0),
           summary: m ? m.subject : "",
           authTail: " (" + authorName(m ? m.author : "") + ")" };
}
function row(name, m) { return rowLine(rowParts(name, m)); }

//  The visible bytes of one row: what a pipe writes and what the pager paints
//  minus the hidden `commit <hex>` target.  `row`, the row list and the hunk's
//  `plain` all come through here, so there is one speller.
function rowLine(p) {
  return p.sha8 + " " + p.date7 + " " + p.summary + p.authTail;
}

//  At a tty a log is a hunk (LITE-007:42:El), painted by the same pager.js and
//  render/ansi.js as a file; the tags are be log's palette (L G S D).
const TAG_L = 11, TAG_G = 6, TAG_S = 18, TAG_D = 3;   // 'L' 'G' 'S' 'D' - 'A'
//  The bytes after a visible token, covered by a `U` span, are its invisible
//  click target (BRO-006); here the row's own `commit <hex>`.
const TAG_U = 20;
//  The off-spine slot, be's own `TAG_Q` (LOG-001), the dir/unknown grey.
const TAG_Q = 16;
//  The `F` slot a reference wears; a ticket code in a summary is one, and the
//  pager, door and http already follow an `F` (BEE-020:33:Lc, pager.js:5tZ:ttJQ:tt).
const TAG_F = 5;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  A summary -> its S/F/S runs, cut by the DOG-034 lexer's `F` tokens through
//  index/hook.js:26:sE fTokens, the one scanner, so no regex ever runs over
//  summary bytes.  Every `F` it mints spans, resolved or not: the door refuses
//  an unanswered code at follow time and http gives it no href (BEE-020:56:Lc).
function putSummary(put, tag, summary) {
  const src = utf8.Encode(summary);
  let cur = 0;
  for (const t of require("index/hook.js").fTokens(src, "txt")) {
    if (t.lo < cur || t.hi <= t.lo) continue;
    if (t.lo > cur) put(tag, utf8.Decode(src.slice(cur, t.lo)));
    put(TAG_F, t.text);
    cur = t.hi;
  }
  if (cur < src.length || cur === 0) put(tag, utf8.Decode(src.slice(cur)));
}

//  `pos` is the repository the rows were walked in, the submodule for a
//  descended log; the pager hands it to the door with the target (BEE-020:55:Lc).
function hunk(uriStr, parts, pos) {
  //  One growing buffer; feedStr encodes each span straight into it, since a
  //  `text +=` concat recopied the whole text and went quadratic.
  const b = io.buf(1 << 16);
  const spans = [];                                  // [tag, byte end]
  const put = (tag, str) => {
    const worst = str.length * 4 + 4;                // utf8 worst case
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  for (const p of parts) {
    //  An off-spine row is covered whole by the grey `Q` slot, same spans and
    //  columns (LITE-020:18:S2); the trailing "\n" keeps `S` so nothing bleeds.
    const t = p.nonspine ? function () { return TAG_Q; } : function (tag) { return tag; };
    put(t(TAG_L), p.sha8);
    //  The sha8 is clickable: `commit <hexlet>` rides after it under a `U`
    //  span, taking no column, and the door reads it as an ordinary verb line.
    if (p.hex) put(TAG_U, "commit " + p.hex);
    put(t(TAG_G), " ");
    put(t(TAG_L), p.date7);
    put(t(TAG_G), " ");
    putSummary(put, t(TAG_S), p.summary);
    put(t(TAG_D), p.authTail);
    put(TAG_S, "\n");
  }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  //  A log is the answer: on a pipe the bare rows, with no `hunk` band and no
  //  hidden target, which is what `| grep` and a diff against `git log` want.
  const lines = [];
  for (const p of parts) lines.push(rowLine(p));
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks,
           kind: "log", bare: true, pos: pos,
           plain: utf8.Encode(lines.length ? lines.join("\n") + "\n" : "") };
}

//  A commit's CPAR rows, first parent first by the row's own `ord`.  A root
//  commit carries one row with an empty parent slot, saying "indexed" rather
//  than "has a parent", so `indexed` and `parents` come off the same scan.
function cparOf(ix, hl) {
  const key = idx.hlKey(hl, idx.K_CPAR);
  const out = [];
  ix.range(key, key + 1n, function (e) {
    out.push({ hl: idx.valHl60(e[1]), ord: Number(e[1] & 0xfn) });
  });
  out.sort((a, b) => a.ord - b.ord);
  return out;
}
function parentsOf(ix, hl) {
  const out = [];
  for (const e of cparOf(ix, hl)) if (e.hl !== idx.CPAR_NONE) out.push(e.hl);
  return out;
}
//  Is this commit in the index at all?  Any CPAR row says yes; a root commit's
//  empty-slot row is what tells parentless from unindexed.  The indexer's walk
//  boundary uses the same test.
function isIndexed(ix, hl) { return cparOf(ix, hl).length > 0; }

//  The capped walk in git's default order (LITE-013): pop the newest, push its
//  parents once each, so the cost is O(rows + frontier).
function lazyAncestry(ix, r, seed, max) {
  const tsOf = (hl) => { const m = idx.readCommit(r, idx.hexOfHl(hl)); return m ? m.ts : 0; };
  const ready = idx.heap(true);                    // a max heap: newest first
  const byHex = new Map(), seen = new Set();
  const push = (hl) => {
    const hex = idx.hexOfHl(hl);
    byHex.set(hex, hl);
    ready.push(tsOf(hl), hex);
  };
  seen.add(seed); push(seed);
  const out = [];
  while (ready.size && out.length < max) {
    const hl = byHex.get(ready.pop());
    out.push(hl);
    for (const p of parentsOf(ix, hl))
      if (!seen.has(p)) { seen.add(p); push(p); }
  }
  return { hls: out, more: ready.size > 0 };
}

//  Everything reachable from `seed` over CPAR, newest first (LITE-007:41:El).
//  Returns { hls: [hl60], more }; the caller reads each commit off the ODB.
//  `max` (0 = all) picks the walk: capped is the lazy git-default heap above,
//  uncapped the reverse Kahn over the whole reachable set (LITE-013).
function ancestry(ix, r, seed, max) {
  if (max > 0) return lazyAncestry(ix, r, seed, max);
  const par = new Map(), kids = new Map();
  const queue = [seed];
  par.set(seed, null);
  for (let i = 0; i < queue.length; i++) {
    const ps = parentsOf(ix, queue[i]);
    par.set(queue[i], ps);
    for (const p of ps) {
      let ks = kids.get(p);
      if (ks === undefined) kids.set(p, ks = 0);
      kids.set(p, ks + 1);
      if (!par.has(p)) { par.set(p, null); queue.push(p); }
    }
  }
  //  Reverse Kahn: a commit is ready once every child of it has been emitted.
  const tsOf = (hl) => { const m = idx.readCommit(r, idx.hexOfHl(hl)); return m ? m.ts : 0; };
  const ready = idx.heap(true);                    // a max heap: newest first
  const deg = new Map();
  for (const hl of par.keys()) {
    const d = kids.get(hl) || 0;
    deg.set(hl, d);
    if (d === 0) ready.push(tsOf(hl), idx.hexOfHl(hl));
  }
  const out = [];
  const byHex = new Map();
  for (const hl of par.keys()) byHex.set(idx.hexOfHl(hl), hl);
  while (ready.size && (!max || out.length < max)) {
    const hex = ready.pop();
    const hl = byHex.get(hex);
    out.push(hl);
    for (const p of (par.get(hl) || [])) {
      const d = deg.get(p) - 1;
      deg.set(p, d);
      if (d === 0) ready.push(tsOf(p), idx.hexOfHl(p));
    }
  }
  return { hls: out, more: ready.size > 0 };
}

//  The first-parent spine over the rows the walk already collected: from the
//  tip, take the ord-0 CPAR parent while it is in that set (LITE-020:17:S2).
//  Membership only, so O(rows) and no second history walk; a spine cut short
//  by the cap is still exactly right for the rows on screen.
function spineOf(ix, seed, hls) {
  const have = new Set(hls), on = new Set();
  let hl = seed;
  while (hl !== undefined && have.has(hl) && !on.has(hl)) {
    on.add(hl);
    const ps = parentsOf(ix, hl);
    hl = ps.length ? ps[0] : undefined;
  }
  return on;
}

//  The file history: one prefix scan of the path's `path_hl` for its REV-CMMT
//  and REV-PARS rows.  PARS is the path's rewritten ancestry, what `git log
//  --simplify-merges` computes, so the log is a reverse Kahn over it drained by
//  a max heap on date; date alone misorders side branches (LITE-007:43:El).
function fileLog(ix, r, rel, max) {
  const phl = idx.pathHl(rel);
  const cmt = new Map(), pars = new Map(), kids = new Map();
  ix.prefix(phl << 24n, 24, function (e) {
    const rev = idx.keyRev(e[0]), kind = idx.keyKind(e[0]);
    if (kind === idx.K_CMMT) { cmt.set(rev, idx.valHl60(e[1])); return; }
    if (kind !== idx.K_PARS) return;
    const v = e[1];
    let ps = pars.get(rev);
    if (ps === undefined) pars.set(rev, ps = []);
    for (const s of [(v >> 44n) & idx.REV_MAX, (v >> 24n) & idx.REV_MAX,
                     (v >> 4n) & idx.REV_MAX])
      if (s !== idx.REV_MAX && ps.indexOf(s) < 0) ps.push(s);
  });
  const tsOf = (rev) => {
    const hl = cmt.get(rev);
    if (hl === undefined) return 0;
    const m = idx.readCommit(r, idx.hexOfHl(hl));
    return m ? m.ts : 0;
  };
  for (const rev of cmt.keys())
    for (const p of (pars.get(rev) || []))
      if (cmt.has(p)) kids.set(p, (kids.get(p) || 0) + 1);
  const ready = idx.heap(true);                    // a max heap: newest first
  const deg = new Map();
  for (const rev of cmt.keys()) {
    const d = kids.get(rev) || 0;
    deg.set(rev, d);
    //  The heap keys on (ts, rev): a higher rev is the younger arrival, so a
    //  same-second tie still comes out newest first.
    if (d === 0) ready.push(tsOf(rev), rev);
  }
  const out = [], seen = new Set();
  while (ready.size && (!max || out.length < max)) {
    const rev = ready.pop();
    const hl = cmt.get(rev);
    if (hl !== undefined && !seen.has(hl)) { seen.add(hl); out.push(hl); }
    for (const p of (pars.get(rev) || [])) {
      if (!deg.has(p)) continue;
      const d = deg.get(p) - 1;
      deg.set(p, d);
      if (d === 0) ready.push(tsOf(p), p);
    }
  }
  return { hls: out, more: ready.size > 0 };
}

//  Normalize a path textually, since the file may be deleted and realpath
//  cannot answer, and make it root-relative, which is what `path_hl` hashes.
function normalize(p) {
  const abs = p[0] === "/";
  const out = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { if (out.length) out.pop(); continue; }
    out.push(s);
  }
  return (abs ? "/" : "") + out.join("/");
}
function relOf(root, arg) {
  const abs = normalize(arg[0] === "/" ? arg : io.cwd() + "/" + arg);
  if (abs.length > root.length + 1 && abs.slice(0, root.length + 1) === root + "/")
    return abs.slice(root.length + 1);
  return normalize(arg);          // already root-relative, given by a caller
}

//  log(arg, opts) -> { rows[], parts[], rec, form, capped, pos }.  `opts.max`
//  (0 or absent = all) caps the walk, which reads about that many commits off
//  the ODB; `log <sub>/<path>` opens the submodule's history (BEE-020:31:Lc).
function log(arg, opts) {
  opts = opts || {};
  const rd = require("index/read.js");        // lazy: read.js requires this file
  const mnt = require("index/mount.js");
  const max = opts.max || 0;
  //  `<path>?<rev>` is the cat/list/tree spelling (BEE-020:30:Lc).  An argument
  //  the URI leaf refuses, such as a raw space, is all path (http.js:2E0:dXIx:dX).
  let a;
  try { a = rd.argSplit(arg); }
  catch (e) { a = { path: arg === undefined || arg === null ? "" : String(arg), rev: "" }; }
  const hexArg = a.path !== "" && HEXARG.test(a.path);
  let ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    //  The descent (BEE-020:54:Lc): the deepest worktree holding the path is the
    //  repo the view opens, so the argument is re-rooted and the walk unchanged.
    let rel = null;
    if (a.path !== "" && !hexArg) {
      rel = rd.repoRel("log", ctx, a.path, opts.from);
      const deep = mnt.serves(ctx.root, rel);
      if (deep !== null && deep !== ctx.root && mnt.under(ctx.root, deep)) {
        rel = (ctx.root + "/" + rel).slice(deep.length + 1);
        idx.closeRepo(ctx);
        ctx = idx.openRepo(deep, true);
      }
    }
    const ix = idx.openIndex(ctx.gitdir);
    try {
      //  `?<rev>` names the tip, a branch, tag or hexlet through the one
      //  resolver, and it is brought up rather than refused (BEE-020:30:Lc).
      const c = a.rev ? rd.revCommit("log", ctx, a.rev) : null;
      //  The index brings itself up to date before a single row is read.
      const rec = idx.bringUp(ctx, ix, { track: false, tip: c ? c.sha : undefined });
      const r = ctx.r;
      let w, form, seed;
      if (hexArg) {
        form = "commit";
        seed = seedOf(ctx, ix, a.path);
        w = ancestry(ix, r, seed, max);
      } else if (rel === null || rel === "") {
        form = "tip";
        seed = idx.hlOfSha(c ? c.sha : ctx.head.sha);
        w = ancestry(ix, r, seed, max);
      } else {
        form = "path";
        //  The full spelling first, since it is exact; failing that the argument
        //  may be partial, so the FSEG rows name it against the tip (LITE-011).
        w = fileLog(ix, r, rel, c ? 0 : max);
        if (w.hls.length === 0) {
          const hit = require("index/resolve.js").pick("log", ix, ctx, a.path);
          if (hit !== null) { rel = hit; w = fileLog(ix, r, hit, c ? 0 : max); }
        }
        if (c) w = reachable(ix, r, idx.hlOfSha(c.sha), w, max);
      }
      //  A DAG listing is split spine / off-spine (LITE-020); `log <path>` is a
      //  file's revisions, not a DAG, so every one of its rows paints normally.
      const spine = form === "path" ? null : spineOf(ix, seed, w.hls);
      const rows = [], parts = [];
      for (const hl of w.hls) {
        const hex = idx.hexOfHl(hl);
        const p = rowParts(hex, idx.readCommit(r, hex));
        p.nonspine = spine !== null && !spine.has(hl);
        parts.push(p);
        rows.push(rowLine(p));
      }
      return { rows: rows, parts: parts, rec: rec, form: form, capped: w.more,
               pos: { repo: ctx.root, path: rel || "", anchor: "" },
               uri: "log" + (arg ? " " + arg : "") };
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
}

//  `log <path>?<rev>` is the file's revisions reachable from that tip; the
//  index holds every brought-up branch's, so the tip's own CPAR closure sieves
//  them (BEE-020:30:Lc).  Only a `?<rev>` pays for it, the bare form does not.
function reachable(ix, r, seed, w, max) {
  const have = new Set(ancestry(ix, r, seed, 0).hls);
  const out = [];
  for (const hl of w.hls) if (have.has(hl)) out.push(hl);
  return { hls: max ? out.slice(0, max) : out, more: max ? out.length > max : w.more };
}

//  A `<hex>` argument -> the hashlet60 the CPAR walk seeds on: 15+ chars are
//  the hashlet, fewer are resolved through the ODB and re-framed to the sha.
//  Only head is indexed, so a commit with parents in the ODB but no CPAR rows
//  is outside the indexed history; that is said in words, not by a wrong row.
function seedOf(ctx, ix, hexarg) {
  const hexlet = hexarg.toLowerCase();
  let hl;
  if (hexlet.length >= 15) hl = BigInt("0x" + hexlet.slice(0, 15));
  else {
    let o = null;
    try { o = git.getHex(ctx.h, hexlet); } catch (e) { o = null; }
    if (o === null || o.type !== "commit")
      throw "log: no commit in this repository is named " + hexarg;
    hl = idx.hashlet60FromBytes(frameSha(o.bytes));
  }
  const m = idx.readCommit(ctx.r, idx.hexOfHl(hl));
  if (m === null) throw "log: no commit in this repository is named " + hexarg;
  if (!isIndexed(ix, hl))
    throw "log: " + hexarg + " is not in the history of " + ctx.head.ref +
          " — beagle-lite indexes the checked-out branch only";
  return hl;
}

//  A commit body -> its 20-byte git sha over the loose-object framing, as
//  be/shared/util/sha.js `frameSha`.  Only a short `<hex>` argument needs it;
//  view/commit.js re-frames the same way, hence the export.
function frameSha(content) {
  const hdr = utf8.Encode("commit " + content.length + "\0");
  const b = io.buf(hdr.length + content.length + 8);
  b.feed(hdr); b.feed(content);
  return sha1(b.data());
}

//  `log [<n>] [<hex>|<path>]` -> { hunks }, the view shape (LITE-045:27:t2).
//  `opts.full` means a stream with no viewport, since a pipe wants every row;
//  otherwise a viewport of 256 rows, so that any history paints instantly.
//  An explicit `<n>` wins over both.
function view(arg, opts) {
  const q = logQuery(arg);
  const max = q.max !== null ? q.max : (opts && opts.full ? 0 : 256);
  const o = log(q.target, { max: max, from: opts && opts.from });
  if (!o.rows.length) return [];
  //  The uri is the typed target verbatim: an explicit count stays, while the
  //  default cap does not rename the view.
  const uri = q.max === null ? o.uri
            : "log " + q.max + (q.target ? " " + q.target : "");
  return [hunk(uri, o.parts, o.pos)];
}

//  A 1..5-digit decimal token is the count, which cannot clash with a hexlet
//  of 6..40 chars: `log 10` is 10 rows, `log 0` is all.
function logQuery(arg) {
  let max = null;
  const t = [];
  for (const w of (arg || "").split(" ")) {
    if (w === "") continue;
    if (max === null && /^\d{1,5}$/.test(w)) max = Number(w);
    else t.push(w);
  }
  return { max: max, target: t.length ? t.join(" ") : undefined };
}

module.exports = { log: log, view: view, logQuery: logQuery,
                   row: row, rowLine: rowLine, rowParts: rowParts, hunk: hunk,
                   authorName: authorName, date7Of: date7Of,
                   fileLog: fileLog, ancestry: ancestry, parentsOf: parentsOf,
                   spineOf: spineOf, TAG_Q: TAG_Q,
                   cparOf: cparOf, isIndexed: isIndexed,
                   relOf: relOf, normalize: normalize, HEXARG: HEXARG,
                   frameSha: frameSha };
