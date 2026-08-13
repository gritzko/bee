//  index/log.js — LITE-007: `quickjab log [<hex>|<path>]`, the commit and file
//  logs read OFF the LITE-006 lane.
//
//  Three forms, one arg, the ruled classification: 6..40 hex = a commit, any
//  other arg = a path, no arg = the live tip.
//
//    log          commits reachable from the live tip, newest first
//    log <hex>    the same from that commit
//    log <path>   the commits that AMENDED that file, newest first
//
//  LAZY BY CONSTRUCTION: the verb opens the repo, brings the index up to date
//  itself (LITE-006's mark check -> gap walk -> mark), and only then queries.
//  A user never runs `index` first, and `log` writes NOTHING but that index
//  update — not even a tracks line.
//
//  WHERE THE DATA COMES FROM
//   -  the commit DAG is the index's CPAR rows (`commit_hl -> parent_hl|ord`);
//      no ODB ancestry walk happens at query time;
//   -  a file's history is ONE prefix scan of its `path_hl`, taking the
//      REV-CMMT row of each rev — the LITE-006 "one file's log = one prefix
//      scan" claim, cashed in;
//   -  date / author / message come from the ODB through `git.parseCommit`,
//      addressed by the row's own 15-hex hashlet60 (ODBHex takes any 6..40
//      hexlet, so a hashlet is a perfectly good object name).
//
//  ORDER = git's own default, which is `--date-order`: no parent before all of
//  its children are shown, otherwise newest COMMITTER date first.  That is a
//  reverse Kahn (children, not parents, are the in-degree) drained by a MAX
//  heap on the commit date.  The DISPLAYED date is the AUTHOR date, as git and
//  be log both show.
"use strict";

const idx = require("./index.js");

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
  return { sha8: name.slice(0, 8),
           date7: date7Of(m ? m.ats : 0),
           summary: m ? m.subject : "",
           authTail: " (" + authorName(m ? m.author : "") + ")" };
}
function row(name, m) {
  const p = rowParts(name, m);
  return p.sha8 + " " + p.date7 + " " + p.summary + p.authTail;
}

//  --- the tty rendering: a log IS a hunk ------------------------------------
//  LITE-007 ruling 2026-08-13: at a terminal the log renders the be way — one
//  content hunk carrying per-column tok32 spans, handed to the SAME
//  view/pager.js + view/bro.js theme machinery that paints a file.  There is no
//  second renderer: the tags below are be/views/log/log.js `appendRow`'s own
//  palette, and lite's view/bro.js THEME already maps them (L cyan, G green,
//  S default, D grey).  A final S span covers the row's "\n" so the next row's
//  L does not bleed onto this line's terminator — be's own note.
//
//  What is NOT carried over is be's nav layer: the hidden `U` click-target per
//  row and the `F` ticket-code split need core/nav + shared/ticket, which lite
//  has no equivalent of.  The COLUMNS and their paint are identical.
const TAG_L = 11, TAG_G = 6, TAG_S = 18, TAG_D = 3;   // 'L' 'G' 'S' 'D' - 'A'
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

function hunk(uriStr, parts) {
  let text = "";
  const spans = [];                                  // [tag, byte end]
  const blen = (s) => utf8.Encode(s).length;
  let at = 0;
  const put = (tag, str) => { text += str; at += blen(str); spans.push([tag, at]); };
  for (const p of parts) {
    put(TAG_L, p.sha8);
    put(TAG_G, " ");
    put(TAG_L, p.date7);
    put(TAG_G, " ");
    put(TAG_S, p.summary);
    put(TAG_D, p.authTail);
    put(TAG_S, "\n");
  }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  return { uri: uriStr, verb: "hunk", text: utf8.Encode(text), toks: toks,
           kind: "log" };
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
//  Is this commit in the lane at all?  ANY CPAR row says yes (a root commit's
//  empty-slot row is exactly what makes parentless distinguishable from
//  unindexed) — the same test the indexer's walk boundary uses.
function isIndexed(ix, hl) { return cparOf(ix, hl).length > 0; }

//  Everything reachable from `seed` over CPAR, newest-first (see the header).
//  Returns [hl60] — the caller reads each one's commit off the ODB.  There is
//  no walk bound: the lane holds a complete history by construction.
function ancestry(ix, r, seed) {
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
  while (ready.size) {
    const hex = ready.pop();
    const hl = byHex.get(hex);
    out.push(hl);
    for (const p of (par.get(hl) || [])) {
      const d = deg.get(p) - 1;
      deg.set(p, d);
      if (d === 0) ready.push(tsOf(p), idx.hexOfHl(p));
    }
  }
  return out;
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
function fileLog(ix, r, rel) {
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
  while (ready.size) {
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
  return out;
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
//  log(arg, opts) -> { rows[], rec, form }.  `opts.from` is the dir to find
//  the repo above (the cwd by default).
function log(arg, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const ix = idx.openIndex(ctx.gitdir);
    try {
      //  LAZY: the index brings ITSELF up to date before a single row is read.
      const rec = idx.bringUp(ctx, ix, { track: false });
      const r = ctx.r;
      let hls, form;
      if (arg === undefined || arg === null || arg === "") {
        form = "tip";
        hls = ancestry(ix, r, idx.hlOfSha(ctx.head.sha));
      } else if (HEXARG.test(arg)) {
        form = "commit";
        hls = ancestry(ix, r, seedOf(ctx, ix, arg));
      } else {
        form = "path";
        hls = fileLog(ix, r, relOf(ctx.root, arg));
      }
      const rows = [], parts = [];
      for (const hl of hls) {
        const hex = idx.hexOfHl(hl);
        const p = rowParts(hex, idx.readCommit(r, hex));
        parts.push(p);
        rows.push(p.sha8 + " " + p.date7 + " " + p.summary + p.authTail);
      }
      return { rows: rows, parts: parts, rec: rec, form: form,
               uri: "log" + (arg ? " " + arg : "") };
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
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
//  be/shared/util/sha.js `frameSha` shape).  Only a short `<hex>` arg needs it.
function frameSha(content) {
  const hdr = utf8.Encode("commit " + content.length + "\0");
  const b = io.buf(hdr.length + content.length + 8);
  b.feed(hdr); b.feed(content);
  return sha1(b.data());
}

module.exports = { log: log, row: row, rowParts: rowParts, hunk: hunk,
                   authorName: authorName, date7Of: date7Of,
                   fileLog: fileLog, ancestry: ancestry, parentsOf: parentsOf,
                   cparOf: cparOf, isIndexed: isIndexed,
                   relOf: relOf, normalize: normalize, HEXARG: HEXARG };
