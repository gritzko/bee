//  view/log.js — LITE-007: `bee log [<n>] [<hex>|<path>][?<rev>]`, the commit
//  and file logs read OFF the LITE-006 index — the CPAR DAG for a commit, ONE
//  `path_hl` prefix scan for a file, no ODB walk at query time.  LAZY: the verb
//  brings the index up itself, so `index` is never run first.
//  LITE-020: the SPINE (first-parent) keeps its columns, every other row greys
//  whole (TAG_Q); LITE-013: capped = git's default heap order, uncapped = the
//  strict reverse Kahn.  BEE-020 lands be's three missing legs — `?<rev>` tips
//  (BEE-020:30), the submodule descent (BEE-020:31) and ticket `F` spans (BEE-020:33).
"use strict";

const idx = require("index/index.js");

//  6..40 hex = a commit; anything else is a path (the ruled classification).
const HEXARG = /^[0-9a-fA-F]{6,40}$/;

//  --- the row ---------------------------------------------------------------
//  be/views/log/log.js appendRow, byte for byte:
//      <sha8> <date7> <summary> (<author>)
//  `date7` is ron.date's own 7 columns WITH its leading and trailing space, so
//  the rendered row carries TWO spaces on each side of the date.
function authorName(author) {
  const a = author || "";
  const lt = a.indexOf(" <");
  return lt >= 0 ? a.slice(0, lt) : a;
}
//  ron60 spans the RON epoch, years 2000..2099 (VERIFIED by probe), and the
//  header carries epoch SECONDS — so an OpenLDAP-era 1998 commit has no ron60
//  at all and `RONOfTime` refuses it.  That is not an error: `ron.date(0n)` is
//  the "   ?   " column be log already shows for a commit with no usable
//  stamp, so an out-of-epoch date renders as one instead of killing the log.
function date7Of(secs) {
  if (!(secs > 0)) return ron.date(0n);
  try { return ron.date(ron.of(secs * 1000)); } catch (e) { return ron.date(0n); }
}
//  The row's COLUMNS, kept apart so the tty leg can tag each one; `row()` is
//  the plain join the piped leg writes.
function rowParts(name, m) {
  return { sha8: name.slice(0, 8), hex: name,
           date7: date7Of(m ? m.ats : 0),
           summary: m ? m.subject : "",
           authTail: " (" + authorName(m ? m.author : "") + ")" };
}
function row(name, m) { return rowLine(rowParts(name, m)); }

//  The VISIBLE bytes of one row — what a pipe writes and what the pager paints
//  minus the hidden `commit <hex>` nav.  ONE speller: `row`, the row list and
//  the hunk's own `plain` all come through here.
function rowLine(p) {
  return p.sha8 + " " + p.date7 + " " + p.summary + p.authTail;
}

//  --- the tty rendering: a log IS a hunk ------------------------------------
//  LITE-007 ruling 2026-08-13: at a terminal the log renders the be way — one
//  content hunk carrying per-column tok32 spans, handed to the SAME
//  pager.js + render/ansi.js theme machinery that paints a file.  There is no
//  second renderer: the tags below are be/views/log/log.js `appendRow`'s own
//  palette, and lite's render/ansi.js THEME already maps them (L cyan, G green,
//  S default, D grey).  A final S span covers the row's "\n" so the next row's
//  L does not bleed onto this line's terminator — be's own note.
//
//  What is NOT carried over is be's nav layer: the hidden `U` click-target per
//  row and the `F` ticket-code split need core/nav + shared/ticket, which lite
//  has no equivalent of.  The COLUMNS and their paint are identical.
const TAG_L = 11, TAG_G = 6, TAG_S = 18, TAG_D = 3;   // 'L' 'G' 'S' 'D' - 'A'
//  BRO-006's invisible click-target: the bytes after a visible token, covered by
//  a `U` span, ARE the nav target — here the row's own commit, for `commit`.
const TAG_U = 20;
//  LITE-020: the OFF-SPINE slot — be's own `TAG_Q` (LOG-001), the dir/unk grey
//  of dog/THEME that LITE-017 already added to lite's table (`Q: aFgB(90)`).
const TAG_Q = 16;
//  BEE-020:33: the `F` slot a REFERENCE wears — a ticket code in a summary is
//  one, and the pager/door/http already follow an `F` (pager.js:5tZ:ttJQ:tt).
const TAG_F = 5;
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  BEE-020:33: a summary -> its S/F/S runs, cut by the DOG-034 lexer's own `F`
//  tokens (index/hook.js:MO:sEz2:sE, the ONE scanner — no regex over summary bytes).
//  BEE-020:56: EVERY `F` it mints spans, resolved or not; the door refuses an
//  unanswered code at follow time and http gives it no href.
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

//  `pos` is the AMBIENT the rows were walked in (BEE-020:55) — the SUB for a
//  descended log — and the pager hands it to the door with the row's target.
function hunk(uriStr, parts, pos) {
  //  ONE growing Buf; feedStr encodes each span straight into IDLE, so there
  //  is no string concat (`text +=` recopied the whole text: O(n^2)-slow).
  const b = io.buf(1 << 16);
  const spans = [];                                  // [tag, byte end]
  const put = (tag, str) => {
    const worst = str.length * 4 + 4;                // utf8 worst case
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  for (const p of parts) {
    //  LITE-020: an OFF-SPINE row is covered WHOLE by the grey `Q` slot — the
    //  same spans, the same columns, one tag (be's appendRow does exactly this).
    //  The trailing "\n" keeps its `S` either way, so no colour bleeds onward.
    const t = p.nonspine ? function () { return TAG_Q; } : function (tag) { return tag; };
    put(t(TAG_L), p.sha8);
    //  The sha8 is CLICKABLE: `commit <hexlet>` rides after it under a `U` span
    //  — no column, and the door reads it as the ordinary verb line it is.
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
  //  LITE-045: a log IS the answer — on a pipe the bare rows, no `hunk` band
  //  and no hidden nav, which is what a `| grep` and a `diff` against
  //  `git log` want.
  const lines = [];
  for (const p of parts) lines.push(rowLine(p));
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks,
           kind: "log", bare: true, pos: pos,
           plain: utf8.Encode(lines.length ? lines.join("\n") + "\n" : "") };
}

//  --- the CPAR DAG ----------------------------------------------------------
//  A commit's CPAR rows, first parent first (the row's own `ord`).  A ROOT
//  commit carries ONE row with an EMPTY parent slot — it says "indexed", not
//  "has a parent" — so `indexed` and `parents` are read off the same scan.
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
//  Is this commit in the index at all?  ANY CPAR row says yes (a root commit's
//  empty-slot row is exactly what makes parentless distinguishable from
//  unindexed) — the same test the indexer's walk boundary uses.
function isIndexed(ix, hl) { return cparOf(ix, hl).length > 0; }

//  LITE-013: the CAPPED walk, git's default order — pop newest, push ITS
//  parents (the `seen` guard pushes each once), so cost is O(rows + frontier).
function lazyAncestry(ix, r, seed, max) {
  const tsOf = (hl) => { const m = idx.readCommit(r, idx.hexOfHl(hl)); return m ? m.ts : 0; };
  const ready = idx.heap(true);                    // MAX heap: newest first
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

//  Everything reachable from `seed` over CPAR, newest-first (see the header).
//  Returns { hls: [hl60], more } — the caller reads each commit off the ODB.
//  `max` (0 = all) picks the WALK: capped = the lazy git-default heap above,
//  uncapped = the reverse Kahn over the whole reachable set.
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
  //  reverse Kahn: a commit is READY when every child of it has been emitted.
  const tsOf = (hl) => { const m = idx.readCommit(r, idx.hexOfHl(hl)); return m ? m.ts : 0; };
  const ready = idx.heap(true);                    // MAX heap: newest first
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

//  LITE-020: the STRAIGHT CHAIN over the rows the walk ALREADY collected — from
//  the walked tip, take the ord-0 (first) CPAR parent while it is in that set.
//  Membership only: O(rows), no second history walk, and a spine cut short by
//  the cap is still exactly right for the rows on screen.
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

//  --- the file history ------------------------------------------------------
//  ONE prefix scan of the path's `path_hl`, taking BOTH per-rev rows it needs:
//  REV-CMMT (which commit introduced the rev) and REV-PARS (that rev's parent
//  revs).  PARS IS the path's own rewritten ancestry — the very graph `git log
//  --simplify-merges -- <path>` computes on the fly — so the log is a reverse
//  Kahn over the PARS edges drained by a MAX heap on commit date: no rev above
//  a rev that descends from it, otherwise newest first.  Sorting the revs by
//  date ALONE gets this wrong wherever a side branch's commit is older than
//  what the mainline already merged (VERIFIED: gitoxide Cargo.toml, dogs
//  beagle/BE.cli.c both deviated from git until the edges were honoured).
//  `max` (0 = all) caps the emit loop exactly like ancestry's.
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
  const ready = idx.heap(true);                    // MAX heap: newest first
  const deg = new Map();
  for (const rev of cmt.keys()) {
    const d = kids.get(rev) || 0;
    deg.set(rev, d);
    //  the heap keys on (ts, rev) — a higher rev is the younger arrival, so a
    //  same-second tie still comes out newest-first.
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

//  --- the path argument -----------------------------------------------------
//  Normalize a path textually (the file may be DELETED, so realpath cannot be
//  the answer) and make it root-relative — that is what `path_hl` hashes.
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
  return normalize(arg);          // already root-relative, given from elsewhere
}

//  --- the verb --------------------------------------------------------------
//  log(arg, opts) -> { rows[], parts[], rec, form, capped, pos }.  `opts.from`
//  is the dir to find the repo above (the cwd by default); `opts.max` (0/absent
//  = all) caps the walk — a capped walk reads ~max commits off the ODB.
//  BEE-020:31: `log <sub>/<path>` opens the SUB, not the parent's gitlink line.
function log(arg, opts) {
  opts = opts || {};
  const rd = require("index/read.js");        // BEE-020: lazy — read.js needs us
  const mnt = require("index/mount.js");
  const max = opts.max || 0;
  //  BEE-020:30: `<path>?<rev>`, the cat/list/tree spelling.  An arg the URI
  //  leaf refuses (a raw space in a name) is ALL PATH — http.js:2E0:dXIx:dX's own out.
  let a;
  try { a = rd.argSplit(arg); }
  catch (e) { a = { path: arg === undefined || arg === null ? "" : String(arg), rev: "" }; }
  const hexArg = a.path !== "" && HEXARG.test(a.path);
  let ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    //  BEE-020:54: THE DESCENT — the deepest worktree holding the path IS the
    //  repo the view opens; the arg is re-rooted and the walk runs unchanged.
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
      //  BEE-020:30: `?<rev>` names the tip — a branch, tag or hexlet through
      //  the ONE resolver — and it is brought UP, never refused (BEE-005).
      const c = a.rev ? rd.revCommit("log", ctx, a.rev) : null;
      //  LAZY: the index brings ITSELF up to date before a single row is read.
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
        //  LITE-011: the full spelling first (it is exact); nothing there and
        //  the arg may be PARTIAL, so let the FSEG rows name it against the tip.
        w = fileLog(ix, r, rel, c ? 0 : max);
        if (w.hls.length === 0) {
          const hit = require("index/resolve.js").pick("log", ix, ctx, a.path);
          if (hit !== null) { rel = hit; w = fileLog(ix, r, hit, c ? 0 : max); }
        }
        if (c) w = reachable(ix, r, idx.hlOfSha(c.sha), w, max);
      }
      //  LITE-020: a DAG listing is split spine / off-spine; `log <path>` is a
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

//  BEE-020:30: `log <path>?<rev>` is the file's revisions REACHABLE from that
//  tip — the index holds every brought-up branch's, so the tip's own CPAR
//  closure sieves them.  Only a `?<rev>` pays for it; the bare form does not.
function reachable(ix, r, seed, w, max) {
  const have = new Set(ancestry(ix, r, seed, 0).hls);
  const out = [];
  for (const hl of w.hls) if (have.has(hl)) out.push(hl);
  return { hls: max ? out.slice(0, max) : out, more: max ? out.length > max : w.more };
}

//  A `<hex>` arg -> the hashlet60 the CPAR walk seeds on.  A hexlet of 15 or
//  more chars IS the hashlet; a shorter one is resolved through the ODB (which
//  refuses an ambiguous prefix) and re-framed to its own sha.
//  Beagle-lite indexes HEAD only, so a commit that has parents in the ODB but
//  NO CPAR rows is outside the indexed history — said in plain words rather
//  than answered with a one-row log that is silently wrong.
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

//  A commit body -> its 20-byte git sha, over the loose-object framing (the
//  be/shared/util/sha.js `frameSha` shape).  Only a short `<hex>` arg needs it
//  — LITE-009's `commit` re-frames the same way, so it is exported.
function frameSha(content) {
  const hdr = utf8.Encode("commit " + content.length + "\0");
  const b = io.buf(hdr.length + content.length + 8);
  b.feed(hdr); b.feed(content);
  return sha1(b.data());
}

//  --- the VIEW (LITE-045) ---------------------------------------------------
//  `log [<n>] [<hex>|<path>]` -> { hunks }.  The arg grammar is the verb's own,
//  and so is the row budget: `opts.full` says the sink is a STREAM with no
//  viewport (a pipe wants every row, the `git log` diff parity), absent says a
//  viewport, which defaults to 256 rows so any-size history paints instantly.
//  An explicit count in the arg wins over both.
function view(arg, opts) {
  const q = logQuery(arg);
  const max = q.max !== null ? q.max : (opts && opts.full ? 0 : 256);
  const o = log(q.target, { max: max, from: opts && opts.from });
  if (!o.rows.length) return [];
  //  The uri is the TYPED target, verbatim — an explicit count stays, the
  //  default cap does not rename the view.
  const uri = q.max === null ? o.uri
            : "log " + q.max + (q.target ? " " + q.target : "");
  return [hunk(uri, o.parts, o.pos)];
}

//  `log [<n>] [<hex>|<path>]` — a 1..5-digit decimal token is the COUNT, no
//  clash with hexlets (6..40 chars): `log 10` = 10 rows, `log 0` = all.
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
