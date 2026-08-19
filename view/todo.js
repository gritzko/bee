//  view/todo.js — BEE-025: the read-only ticket board, be's `views/todo/todo.js`
//  ported.  `bee todo` is the open-ticket board, `bee todo GET` one topic's
//  list, `bee todo Sev:HIGH` a filter listing; every row clicks to `cat <file>`,
//  since a ticket page is a FILE and BEE-017 already opens it from either tree.
//  The [BEE-024] lane decides WHICH tickets are open, the FILE decides what
//  shows — title, `Sev:` and `Sub:` come off one head read, never off a packed
//  row.  The root is the context repo's `todo/` ([BEE-023]), or every registered
//  repo's when no context and no local one names one (BEE-025:23).
"use strict";

const idx = require("index/index.js");
const mnt = require("index/mount.js");
const kv = require("index/kv.js");
const rd = require("index/read.js");
const lst = require("./list.js");
const wts = require("index/wts.js");
const wtstat = require("./wtstat.js");

const EXTS = ["mkd", "md", "txt"];         // this board is .mkd-first
const CAP = 1 << 16;                       // a ticket head sits at the very top

//  --- the lexer (be shared/ticketpage.js, verbatim) -------------------------
//  Arg routing is a pure SHAPE test, never an fs probe (BEE-025:60): the case
//  alone tells a topic from a ticket code from a `Key:Value` filter.
function ucnumRun(w, i) {
  while (i < w.length) {
    const c = w.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) i++; else break;
  }
  return i;
}

//  `GET` -> topic, `GET-001` -> key, anything else -> null.
function shape(w) {
  if (!w.length) return null;
  const c0 = w.charCodeAt(0);
  if (c0 < 65 || c0 > 90) return null;               // must open uppercase
  const run = ucnumRun(w, 0);
  if (run === w.length) return "topic";
  if (w.charAt(run) !== "-") return null;
  let j = run + 1;
  if (j === w.length) return null;
  while (j < w.length) {
    const c = w.charCodeAt(j);
    if (c >= 48 && c <= 57) j++; else return null;
  }
  return "key";
}

//  The BASE ticket key a name CARRIES, any trailing suffix ignored, so a
//  worktree named `bee-BEE-025-adv` still sits on BEE-025's row; "" when the
//  name does not open with a code.
function ticketKey(w) {
  if (!w.length) return "";
  const c0 = w.charCodeAt(0);
  if (c0 < 65 || c0 > 90) return "";
  const run = ucnumRun(w, 0);
  if (run === w.length || w.charAt(run) !== "-") return "";
  let j = run + 1;
  if (j === w.length || w.charCodeAt(j) < 48 || w.charCodeAt(j) > 57) return "";
  while (j < w.length && w.charCodeAt(j) >= 48 && w.charCodeAt(j) <= 57) j++;
  return w.slice(0, j);
}

function keyTopic(key) { return key.slice(0, key.indexOf("-")); }

//  --- the page ladder and the head read -------------------------------------
function isDir(p) { try { return io.stat(p).kind === "dir"; } catch (e) { return false; } }

//  One page's leading bytes; a head is at the top, so nothing below the cap can
//  be a title or a meta pair of the file's own (index/kv.js:158:hO readText).
function readText(file) {
  let st;
  try { st = io.lstat(file); } catch (e) { return null; }
  if (st.kind !== "reg" || Number(st.size) === 0) return null;
  let d;
  try { d = io.mmap(file, "r").data(); } catch (e) { return null; }
  return utf8.Decode(d.length > CAP ? d.slice(0, CAP) : d);
}

//  A key's page under the board dir: thin `TOPIC/KEY.<ext>` first, then the fat
//  `TOPIC/KEY/README.<ext>` ([/meta/todo]); null when the key has no page.
function pageFile(dir, key) {
  const base = dir + "/" + keyTopic(key) + "/" + key;
  for (const x of EXTS) { const p = base + "." + x; if (statReg(p)) return p; }
  for (const x of EXTS) { const p = base + "/README." + x; if (statReg(p)) return p; }
  return null;
}

function statReg(p) { try { return io.lstat(p).kind === "reg"; } catch (e) { return false; } }

//  ONE read per ticket yields both halves of its head: the TITLE (first line,
//  `#` run stripped) and the `Key: value` block under it.  The block's grammar
//  is the LANE's own (index/kv.js:129:hO metaPairs), so the board and the index can
//  never read one file two ways.
function head(file) {
  const out = { title: "", meta: {} };
  const txt = readText(file);
  if (txt === null) return out;
  const lines = txt.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length) {
    const ln = lines[i];
    let j = 0;
    while (ln.charAt(j) === "#") j++;
    while (ln.charAt(j) === " ") j++;
    out.title = ln.slice(j);
  }
  for (const p of kv.metaPairs(lines))
    if (out.meta[p.key] === undefined) out.meta[p.key] = p.value;
  return out;
}

//  The legacy header MARK's `[ … ]` span, either side of the colon; null when
//  there is none.  The state left the header for the meta pairs (TODO-004), so
//  this only ever CLOSES what it always closed.
function markSpan(key, title) {
  if (title.indexOf(key) !== 0) return null;
  let i = key.length;
  while (title.charAt(i) === " ") i++;
  if (title.charAt(i) === ":") { i++; while (title.charAt(i) === " ") i++; }
  if (title.charAt(i) !== "[") return null;
  let j = i + 1;
  while (j < title.length) {
    const c = title.charCodeAt(j);
    if (c >= 65 && c <= 90) j++; else break;
  }
  return (j > i + 1 && title.charAt(j) === "]") ? { i: i, j: j } : null;
}

function headerMark(key, title) {
  const s = markSpan(key, title);
  return s ? title.slice(s.i + 1, s.j) : "";
}

//  The title with its `[MARK]` token dropped, `KEY: title` spacing normalized.
function stripMark(key, title) {
  const s = markSpan(key, title);
  if (s === null) return title;
  const before = title.slice(0, s.i).replace(/\s+$/, "");
  const after = title.slice(s.j + 1).replace(/^\s+/, "");
  const sep = before.charAt(before.length - 1) === ":" && after && after.charAt(0) !== ":"
            ? " " : "";
  return before + sep + after;
}

//  The pager row spells key and title as separate COLUMNS, so the title span
//  carries neither the code nor the colon; plain keeps the header line verbatim.
function bareTitle(key, title) {
  const s = stripMark(key, title);
  if (s.indexOf(key) !== 0) return s;
  let i = key.length;
  if (s.charAt(i) === ":") i++;
  while (s.charAt(i) === " ") i++;
  return s.slice(i);
}

//  --- the tables (be todo.js:160) -------------------------------------------
const CLOSED = { DONE: true, DONT: true, STALE: true };   // header marks only
const PRIO = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 };        // unmarked = MED
//  The bullet's colour slot per PRIO, out of the slots view/status.js already
//  spends (render/ansi.js:56:GZ): M red, V orange, the default, D dim.
const PRIO_TAG = [12, 21, 18, 3];

//  --- the board root --------------------------------------------------------
function todoOf(root) { const d = root + "/todo"; return isDir(d) ? d : null; }

//  The repos the run boards, `[{ name, root, dir }]`.  A `//name` context is
//  ONE repo and refuses when it carries no `todo/` (BEE-025:75, the stated
//  default); without one the local repo answers, and failing that the board is
//  the FAN-OUT over every registered repo that has a `todo/`.
function rootsOf(opts) {
  const out = [];
  if (opts.from) {
    const dir = todoOf(opts.from);
    if (dir === null) throw "todo: //" + mnt.basename(opts.from) + ": no todo/";
    return [{ name: mnt.basename(opts.from), root: opts.from, dir: dir }];
  }
  const here = idx.discover(mnt.at()) || mnt.at();
  const dir = todoOf(here);
  if (dir !== null) return [{ name: mnt.basename(here), root: here, dir: dir }];
  for (const m of mnt.list()) {
    if (m.prefix !== "" || m.dup) continue;
    const d = todoOf(m.root);
    if (d !== null) out.push({ name: m.name, root: m.root, dir: d });
  }
  return out;
}

//  --- the topics and their pages --------------------------------------------
//  Every UPPERCASE-shaped subdir of the board; `todo/done/` — the closed-ticket
//  parking lot — never lists, nor does a lowercase or mixed-case dir.
function topicsOf(dir) {
  let names;
  try { names = io.readdir(dir, { hidden: false }); } catch (e) { return []; }
  const out = [];
  for (const raw of names) {
    if (raw.slice(-1) !== "/") continue;
    const nm = raw.slice(0, -1);
    if (nm === "done" || shape(nm) !== "topic") continue;
    out.push(nm);
  }
  out.sort();
  return out;
}

//  One topic dir -> `[{ key, file }]` by code, NO file read: the readdir entry
//  already names a thin `KEY.<ext>`, and only a fat `KEY/` costs the README
//  stat (be todo.js:355, TODO-001's budget).
function listTopic(dir, topic) {
  const tdir = dir + "/" + topic;
  let names;
  try { names = io.readdir(tdir, { hidden: false }); } catch (e) { return []; }
  const seen = new Map(), keys = [];
  for (const raw of names) {
    const dirEnt = raw.slice(-1) === "/";
    const nm = dirEnt ? raw.slice(0, -1) : raw;
    let key = nm, ext = "";
    const dot = nm.indexOf(".");
    if (dot > 0) {
      if (dirEnt || EXTS.indexOf(nm.slice(dot + 1)) < 0) continue;
      key = nm.slice(0, dot);
      ext = nm.slice(dot + 1);
    }
    if (shape(key) !== "key" || keyTopic(key) !== topic) continue;   // README etc
    let e = seen.get(key);
    if (e === undefined) { e = { exts: {}, fat: false }; seen.set(key, e); keys.push(key); }
    if (ext) e.exts[ext] = true; else if (dirEnt) e.fat = true;
  }
  const out = [];
  for (const key of keys) {
    const e = seen.get(key), base = tdir + "/" + key;
    let file = null;
    for (const x of EXTS) if (e.exts[x]) { file = base + "." + x; break; }
    if (file === null && e.fat) file = pageFile(dir, key);
    if (file !== null) out.push({ key: key, file: file });
  }
  out.sort(byCode);
  return out;
}

//  Topic then ticket NUMBER — a topic list's whole order, and every other
//  order's tie-break, so a listing is stable (be todo.js:256).
function byCode(a, b) {
  const at = keyTopic(a.key), bt = keyTopic(b.key);
  if (at !== bt) return at < bt ? -1 : 1;
  return parseInt(a.key.slice(a.key.indexOf("-") + 1), 10) -
         parseInt(b.key.slice(b.key.indexOf("-") + 1), 10);
}

//  --- the lane (BEE-024) ----------------------------------------------------
//  The three cells the board asks the lane for, packed once: a row val IS the
//  comparison, so nothing here re-normalizes a value by hand.
const NOW_SUB = kv.subOf(kv.codeOf("Now"), kv.K_HEAD);
const OPEN_VAL = kv.packValue("Now", "OPEN");

//  ONE `find` per repo per run: the clauses the lane can narrow by go in, and
//  the matched files' ROWS come back, so the open test, the OR'd clauses and
//  the `Key:` absences are all answered without opening a file.  null = no lane
//  here (no repo, no index): the caller then reads heads, as it always could.
function laneOf(root, clauses) {
  try { return kv.find(root, clauses, { rows: true }).rows; }
  catch (e) { return null; }
}

//  Is this ticket OPEN?  `Now: OPEN` says so outright; with NO `Now:` pair at
//  all the legacy header mark decides (BEE-025:41), which is the one case that
//  costs a read the lane did not name.
function isOpen(t, rows) {
  if (rows !== undefined) {
    const v = rows.get(NOW_SUB);
    if (v !== undefined) return v === OPEN_VAL;
  }
  return !CLOSED[headerMark(t.key, headOf(t).title)];
}

//  The row's head, read at most once per run.
function headOf(t) {
  if (t.head === undefined) t.head = head(t.file);
  return t.head;
}

//  `Sev:` off the file — the lane says WHICH tickets show, the page says what
//  they look like (BEE-025:59).  An unknown or absent word reads MED.
function prioOf(t) {
  const w = String(headOf(t).meta.Sev || "").trim().toUpperCase();
  return PRIO[w] !== undefined ? PRIO[w] : 2;
}

//  --- freshness (be todo.js:314 dateRows / :337 byFresh) --------------------
//  A row is DIRTY when its bytes differ from the tip blob — then its fs mtime
//  dates it — else the commit time of its REV-CMMT row does ([LITE-044]).  One
//  repo per call, since the all-repos board dates each fan-out leg on its own.
function dateRows(bd, rows) {
  if (!rows.length) return rows;
  let ctx = null;
  try { ctx = idx.openRepo(bd.root, true); } catch (e) { return rows; }
  try {
    const tip = idx.readCommit(ctx.r, ctx.head.sha);
    const tree = tip && tip.tree ? tip.tree : null;
    const ix = idx.openIndex(ctx.gitdir, idx.fresh(ctx.gitdir));
    try {
      idx.bringUp(ctx, ix, { track: false });
      const seen = new Map();
      for (const r of rows) {
        const rel = r.file.slice(bd.root.length + 1);
        let e = null;
        try { e = tree === null ? null : rd.entryAt(ctx.r, tree, rel); } catch (er) { e = null; }
        if (e === null || e.dir || lst.markerOf(r.file, e.sha) !== "eq") {
          r.dirty = true;
          try { r.mtime = io.lstat(r.file).mtime; } catch (er) { r.mtime = 0n; }
          continue;
        }
        r.dirty = false;
        r.ts = lastTs(ctx, ix, rel, seen);
      }
    } finally { try { ix.close(); } catch (e) {} }
  } catch (e) { /* an unreadable repo dates nothing; byFresh is byCode then */ }
  finally { idx.closeRepo(ctx); }
  return rows;
}

//  A path's last commit TIME off its REV-CMMT chain alone: the highest rev is
//  a gallop plus a bisect (index/index.js:482:cn lastRev), so depth costs nothing
//  and the commit read is shared by every path that chain ends on.
function lastTs(ctx, ix, rel, seen) {
  const phl = idx.pathHl(rel);
  const rev = idx.lastRev(ix, phl, idx.K_CMMT);
  if (rev < 0n) return undefined;
  const hl = idx.valHl60(idx.revValAt(ix, phl, rev, idx.K_CMMT));
  let ts = seen.get(hl);
  if (ts === undefined) {
    const m = idx.readCommit(ctx.r, idx.hexOfHl(hl));
    ts = m ? m.ats : 0;
    seen.set(hl, ts);
  }
  return ts;
}

//  Dirty above committed, each newest first, byCode breaking every tie — with
//  nothing dated (no repo, no index) this IS byCode.
function byFresh(a, b) {
  if (!a.dirty !== !b.dirty) return a.dirty ? -1 : 1;
  if (a.dirty) {
    if (a.mtime === undefined || b.mtime === undefined) return byCode(a, b);
    return a.mtime > b.mtime ? -1 : a.mtime < b.mtime ? 1 : byCode(a, b);
  }
  if (a.ts === undefined || b.ts === undefined)
    return a.ts === b.ts ? byCode(a, b) : (a.ts === undefined ? 1 : -1);
  return a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : byCode(a, b);
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

//  The DAY a row is dated on, the date separators' own key; "" when the row is
//  undated.  An mtime is a local ron60 (view/status.js:83:9t ronOf), a commit time
//  epoch seconds, so each is spelled by its own unpack.
function dayOf(r) {
  if (r.dirty) {
    if (r.mtime === undefined || r.mtime === 0n) return "";
    const d = [];
    for (let i = 0; i < 10; i++) d.push(Number((r.mtime >> BigInt(6 * i)) & 63n));
    return String(2000 + d[9] * 10 + d[8]) + "-" + pad2(d[7]) + "-" + pad2(d[6] * 10 + d[5]);
  }
  if (r.ts === undefined) return "";
  const d = new Date(r.ts * 1000);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

//  --- `Sub:` families (be todo.js:649 nest) ---------------------------------
//  A `Sub:` child is no subdir, so it hangs on DOTTED rails, never the solid
//  mount ones.
const RAIL = { mid: "|-- ", last: "`-- ", bar: "|   ", gap: "    " };

//  One list -> the same rows as a FOREST: a ticket whose `Sub:` names a LISTED
//  row follows it on rails.  A cycle is cut at its name-sorted first member, so
//  the walk below can never descend forever.
function nest(rows) {
  const by = new Map();
  for (const t of rows) by.set(t.key, t);
  for (const t of rows) {
    const p = String(headOf(t).meta.Sub || "").trim();
    const par = (p && p !== t.key) ? by.get(p) : undefined;
    t.parent = par === undefined ? null : par;
  }
  for (const t of rows) {
    const seen = new Set();
    let n = t, hit = null;
    while (n) { if (seen.has(n)) { hit = n; break; } seen.add(n); n = n.parent; }
    if (hit === null) continue;
    const mem = [];
    let c = hit;
    do { mem.push(c); c = c.parent; } while (c && c !== hit);
    mem.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    mem[0].parent = null;
  }
  const kids = new Map(), roots = [];
  for (const t of rows) {
    if (t.parent === null) { roots.push(t); continue; }
    if (!kids.has(t.parent.key)) kids.set(t.parent.key, []);
    kids.get(t.parent.key).push(t);
  }
  const out = [];
  (function walk(list, prefix, top) {
    for (let i = 0; i < list.length; i++) {
      const t = list[i], last = i === list.length - 1;
      t.rails = top ? "" : prefix + (last ? RAIL.last : RAIL.mid);
      out.push(t);
      const ks = kids.get(t.key);
      if (ks) walk(ks, top ? "" : prefix + (last ? RAIL.gap : RAIL.bar), false);
    }
  })(roots, "", true);
  return out;
}

//  --- the worktree column (BEE-027) -----------------------------------------
//  The scanned worktrees by the ticket code their tail spells; a run with no
//  `$SRC_ROOT` worktree at all pays one readdir and no status.
let WTS = null;
function wtsOf() {
  if (WTS !== null) return WTS;
  const by = new Map(), rest = [];
  for (const w of wts.scan()) {
    const k = shape(w.tail) === "key" ? w.tail : ticketKey(w.tail);
    if (k === "") { rest.push(w); continue; }
    if (!by.has(k)) by.set(k, w);
  }
  return (WTS = { by: by, rest: rest });
}

//  --- the hunk (the view/list.js row model) ---------------------------------
//  tok32 (dog/tok/TOK.h): tag in bits 31..27, end byte offset in 23..0.
function tok32(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }
const TAG_U = 20, TAG_S = 18, TAG_F = 5, TAG_D = 3, TAG_N = 13, TAG_L = 11;

const KEYW = 22;                           // where the dotted leader gives out

//  The row's own click opens the ticket FILE whole: `see KEY` shows a chunk and
//  resolves only committed blobs, while the board already holds the path.  The
//  spell is BEE-023's `//repo/rel`, so a click from any cwd (an all-repos board,
//  a pager opened elsewhere) lands in the ticket's repo; a repo the name does
//  not resolve to (unregistered, off $SRC_ROOT) keeps the absolute path.
function navOf(t) {
  if (!t.repo || !t.root || mnt.byName(t.repo) !== t.root) return "cat " + t.file;
  return "cat //" + t.repo + "/" + t.file.slice(t.root.length + 1);
}

//  The visible key column — the repo name rides it only where the board MIXES
//  repos, so a single-repo board reads exactly as be's does.
function keyCol(t) { return t.prefix ? t.prefix + "/" + t.key : t.key; }

//  The plain line: `KEY title` verbatim off the header, rails kept (they are
//  structure, not chrome) and the frames in their ASCII canon, so a `--plain`
//  board stays greppable (BEE-025:65).
function rowText(t) {
  const title = headOf(t).title;
  const key = keyCol(t);
  const rest = title.indexOf(t.key) === 0 ? title.slice(t.key.length)
             : (title ? " " + title : "");
  let vals = "";
  for (const v of t.vals || []) vals += " [" + v.text + "]";
  return (t.rails || "") + key + vals + rest + (t.wt ? " " + framesOf(t) : "") + "\n";
}

function framesOf(t) {
  const f = wtstat.frames(t.wt.root);
  return f.file + " " + f.commit;
}

//  A hunk builder over the row list: the visible bytes with each row's target
//  under a hidden `U` span right after its first token, as view/list.js does,
//  so the pager follows a row from wherever the cursor sits on it.
function build(uriStr, blocks) {
  const b = io.buf(1 << 15);
  const spans = [];
  const put = function (tag, str) {
    const worst = str.length * 4 + 4;
    if (b.room < worst) b.grow(Math.max(b.cap * 2, b.cap + worst));
    b.feedStr(str);
    spans.push([tag, b.size]);
  };
  let plain = "";
  for (const blk of blocks) {
    if (blk.head !== undefined) {                  // a topic header, itself a target
      put(TAG_N, blk.head);
      if (blk.nav) put(TAG_U, blk.nav);
      put(TAG_S, "\n");
      plain += blk.head + "\n";
      continue;
    }
    if (blk.note !== undefined) {
      put(TAG_S, blk.note + "\n");
      plain += blk.note + "\n";
      continue;
    }
    if (blk.day !== undefined) {                   // a date separator
      put(TAG_L, "-- " + blk.day + "\n");
      plain += "-- " + blk.day + "\n";
      continue;
    }
    const t = blk.row;
    plain += rowText(t);
    const nav = navOf(t);
    const lead = (t.indent || "") + (t.rails || "");
    if (lead) { put(TAG_S, lead); put(TAG_U, nav); }
    put(PRIO_TAG[t.prio], "●");               // the `Sev:` bullet
    put(TAG_U, nav);
    put(TAG_S, " ");
    const key = keyCol(t);
    put(TAG_F, key);
    put(TAG_U, nav);
    let vw = 0;
    for (const v of t.vals || []) {
      put(TAG_S, " [");
      put(TAG_N, v.text);
      if (v.spell) put(TAG_U, v.spell);
      put(TAG_S, "]");
      vw += v.text.length + 3;
    }
    //  A dotted leader to ONE title column, be's KEYW discipline; an over-long
    //  key region degrades to a single space rather than eating the title.
    const fill = KEYW - lead.length - 2 - key.length - vw;
    put(TAG_D, fill >= 2 ? " " + "┄".repeat(fill - 1) + " " : " ");
    put(TAG_S, bareTitle(t.key, headOf(t).title));
    if (t.wt) {
      put(TAG_S, "  ");
      put(TAG_F, framesOf(t));
      put(TAG_U, "list " + t.wt.root + "/");
    }
    put(TAG_S, "\n");
  }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok32(spans[i][0], spans[i][1]);
  return { uri: uriStr, verb: "hunk", text: b.data(), toks: toks, kind: "todo",
           plain: utf8.Encode(plain), bare: true };
}

//  --- the arg line (be todo.js:1088 parseArgs) ------------------------------
//  A topic OR a ticket code, plus any number of `Key:Value` filters in any
//  order.  http joins its path segments with `/`, so a slash separates words
//  exactly as a space does and `/bee/todo/BEE/Sev:HIGH` is one arg line.
function parseArgs(arg) {
  const words = String(arg === undefined || arg === null ? "" : arg)
                .split(/[\s/]+/).filter(Boolean);
  const filters = [], toks = [];
  let subject = null;
  for (const w of words) {
    if (w === "." || w.charAt(0) === "/") continue;   // the `//name` root, already opts.from
    const ci = w.indexOf(":");
    if (ci > 0) {
      const key = w.slice(0, ci), val = w.slice(ci + 1);
      if (val.indexOf(":") >= 0)
        return { err: "'" + w + "' carries two colons — a colon separates, so a" +
                 " filter is one Key:Value; repeat the key to widen it" };
      if (kv.codeOf(key) === null)
        return { err: "'" + key + ":' is not a meta key — a capital and two" +
                 " lowercase letters or digits, like Now: or On1:" };
      filters.push({ key: key, val: val,
                     kind: val === "*" ? "any" : val === "" ? "none" : "eq" });
      toks.push(w);
      continue;
    }
    const s = shape(w);
    if (s) {
      if (subject !== null)
        return { err: "'" + subject.w + "' and '" + w + "' — one topic or one" +
                 " ticket code at a time, plus any number of Key:Value filters" };
      subject = { kind: s, w: w };
      toks.push(w);
      continue;
    }
    if (kv.codeOf(w) !== null)
      return { err: "'" + w + "' is a meta key with no value — write " + w +
               ":VALUE to match one, " + w + ":* for any value, or " + w +
               ": for the tickets that lack it" };
    return { err: "'" + w + "' is not a ticket code, a topic or a Key:Value" +
             " filter — try ABC-123, ABC or Now:OPEN" };
  }
  return { subject: subject, filters: filters, toks: toks };
}

//  The arg line with KEY's filter REPLACED, every other token left where it
//  was — that is what makes a bracket click a REFINEMENT rather than a fresh
//  question (BRO-025: the arg line IS the address bar).
function argLineWith(a, key, val) {
  const out = [];
  let done = false;
  for (const t of a.toks) {
    const ci = t.indexOf(":");
    if (ci > 0 && t.slice(0, ci) === key) {
      if (!done) { out.push(key + ":" + val); done = true; }
      continue;                                    // an OR'd repeat collapses
    }
    out.push(shape(t) === "key" ? keyTopic(t) : t);
  }
  if (!done) out.push(key + ":" + val);
  return out.join(" ");
}

function spellWith(a, key, val) { return "todo " + argLineWith(a, key, val); }

//  A rendered value -> the filter arg that matches it, or null when none does:
//  spaces and colons SEPARATE, so a spaced value rides its despaced index form
//  and a value carrying a colon (a `Rev:` URI) is not expressible at all.
function filterVal(raw) {
  const t = String(raw === undefined || raw === null ? "" : raw).trim();
  if (t === "") return null;
  if (!/[\s:]/.test(t)) return t;
  const n = kv.normalize(t);
  return (n && n.indexOf(":") < 0) ? n : null;
}

//  --- the filter -------------------------------------------------------------
//  ONE clause against one file's lane rows.  `Key:` (absence) is the empty
//  value's own comparison, so presence and absence are two sides of one test
//  and no raw re-read is needed.
function clauseHolds(rows, cl) {
  const sub = kv.subOf(kv.codeOf(cl.key), kv.K_HEAD);
  const v = rows === undefined ? undefined : rows.get(sub);
  const empty = kv.packValue(cl.key, "");
  if (cl.kind === "none") return v === undefined || v === empty;
  if (v === undefined) return false;
  if (cl.kind === "any") return v !== empty;
  return v === kv.packValue(cl.key, cl.val);
}

//  Repeating a key ORs its clauses, different keys AND — be's ruling, and the
//  reason a single-clause key can be handed to the lane while an OR'd one
//  cannot (the lane intersects).
function groupBy(filters) {
  const byKey = Object.create(null), order = [];
  for (const f of filters) {
    if (!byKey[f.key]) { byKey[f.key] = []; order.push(f.key); }
    byKey[f.key].push(f);
  }
  return { byKey: byKey, order: order };
}

//  The clauses the LANE can narrow by: one occurrence, exact or presence.  An
//  OR'd key and a `Key:` absence stay here and ride the rows.
function laneClauses(g) {
  const out = [];
  for (const k of g.order) {
    const cl = g.byKey[k];
    if (cl.length !== 1) continue;
    if (cl[0].kind === "eq") out.push({ key: k, value: cl[0].val });
    else if (cl[0].kind === "any") out.push({ key: k, any: true });
  }
  return out;
}

//  --- gathering --------------------------------------------------------------
//  One repo's board rows: the file layout enumerates, the lane narrows and
//  decides open, the head read fills in what shows.
function gather(bd, a, g, topics) {
  const cls = laneClauses(g);
  const lane = laneOf(bd.root, cls);
  const narrowed = cls.length > 0 && lane !== null;
  const out = [];
  for (const topic of topics) {
    for (const t of listTopic(bd.dir, topic)) {
      const r = lane === null ? undefined : lane.get(t.file);
      if (lane !== null && r === undefined && narrowed) continue;  // the lane said no
      let all = true;
      for (const k of g.order)
        if (!anyHolds(r, g.byKey[k])) { all = false; break; }
      if (!all) continue;
      //  With no `Now:` in the question the implicit default stands: only OPEN
      //  tickets list (BEE-025:41); any mention of `Now:` overrides it.
      if (!g.byKey.Now && !isOpen(t, r)) continue;
      t.repo = bd.name;
      t.root = bd.root;
      t.prio = prioOf(t);
      out.push(t);
    }
  }
  return out;
}

function anyHolds(rows, clauses) {
  for (const cl of clauses) if (clauseHolds(rows, cl)) return true;
  return false;
}

//  The inline `[value]` brackets a filter listing wears: one per key the arg
//  line names, in arg order, each its own click.
function valsOf(t, a, g) {
  const vals = [];
  for (const k of g.order) {
    const raw = String(headOf(t).meta[k] || "").trim();
    if (raw === "") continue;
    const fv = filterVal(raw);
    vals.push({ text: raw, spell: fv === null ? null : spellWith(a, k, fv) });
  }
  return vals;
}

//  A ticket's worktree, when one is named for its code.
function wtOf(t) {
  const w = wtsOf().by.get(t.key);
  return w === undefined ? null : w;
}

//  --- the blocks a hunk is built from ---------------------------------------
//  A flat, freshest-first listing with its date separators; the rows are dated
//  per repo, since freshness is a repo's own question.
function flatBlocks(rows, groups) {
  for (const bd of groups) dateRows(bd.bd, bd.rows);
  rows.sort(byFresh);
  const out = [];
  let day = null;
  for (const t of rows) {
    const d = dayOf(t);
    if (d !== "" && d !== day) { out.push({ day: d }); day = d; }
    out.push({ row: t });
  }
  return out;
}

//  The trailing `worktrees` block: a scanned worktree whose tail is NO ticket
//  code has no row to sit on, and dropping it silently would hide work
//  (BEE-027:37).
function wtBlocks(out) {
  const rest = wtsOf().rest;
  if (!rest.length) return;
  out.push({ head: "worktrees" });
  for (const w of rest)
    out.push({ note: "  " + wtstat.line(w) });
}

//  --- the verb ---------------------------------------------------------------
//  BE-003's spirit: ONE uniform miss line, then throw (the runtime maps an
//  uncaught throw to a non-zero exit).
function miss(arg) {
  io.log("todo: " + arg + ": TODONONE\n");
  throw "TODONONE";
}

function bad(why) {
  io.log("todo: " + why + "\n");
  throw "todo: unknown argument";
}

//  todo(arg, opts) -> { uri, rows, hunks } — the one view shape (LITE-045:42:t2),
//  so the pager, the renderers and http take it without knowing a verb landed.
function todo(arg, opts) {
  opts = opts || {};
  WTS = null;                                      // one scan per run, no memo
  const a = parseArgs(arg);
  if (a.err) bad(a.err);
  //  There is no ticket VIEW here: a page is a file and `see` opens it, so a
  //  code names a page rather than a board and is refused in those words.
  if (a.subject && a.subject.kind === "key")
    bad("'" + a.subject.w + "' names one ticket page, and this is the board — " +
        "try `bee see " + a.subject.w + "`, or `bee todo " +
        keyTopic(a.subject.w) + "` for the topic's list");

  const roots = rootsOf(opts);
  if (!roots.length) miss("todo/");
  const g = groupBy(a.filters);
  const line = a.toks.join(" ");
  const uriStr = "todo" + (line ? " " + line : "");
  const mixed = roots.length > 1;

  //  A TOPIC subject that names no dir in any board is the historic miss.
  if (a.subject && a.subject.kind === "topic") {
    let some = false;
    for (const bd of roots) if (isDir(bd.dir + "/" + a.subject.w)) some = true;
    if (!some) miss(a.subject.w);
  }

  const groups = [], all = [];
  for (const bd of roots) {
    const topics = a.subject ? [a.subject.w] : topicsOf(bd.dir);
    const rows = gather(bd, a, g, topics.filter(function (x) {
      return isDir(bd.dir + "/" + x); }));
    for (const t of rows) {
      if (mixed) t.prefix = bd.name;
      t.wt = wtOf(t);
      if (a.filters.length) t.vals = valsOf(t, a, g);
    }
    groups.push({ bd: bd, rows: rows });
    for (const t of rows) all.push(t);
  }

  const blocks = [];
  //  A filter listing and the ALL-REPOS board read FRESHEST FIRST and so wear
  //  no rails; a board and a topic list keep the code order (BEE-025:44).
  if (a.filters.length || (mixed && !a.subject)) {
    for (const blk of flatBlocks(all, groups)) blocks.push(blk);
    if (!all.length) blocks.push({ note: "(no ticket matches " + (line || "todo") + ")" });
  } else if (a.subject) {
    const rows = nest(all);
    for (const t of rows) blocks.push({ row: t });
    if (!rows.length)
      blocks.push({ note: "(no open tickets in todo/" + a.subject.w + "/)" });
  } else {
    const bd = groups[0];
    const byTopic = new Map();
    for (const t of bd.rows) {
      if (!byTopic.has(keyTopic(t.key))) byTopic.set(keyTopic(t.key), []);
      byTopic.get(keyTopic(t.key)).push(t);
    }
    const names = Array.from(byTopic.keys()).sort();
    for (const nm of names) {
      const rows = nest(byTopic.get(nm));
      blocks.push({ head: nm + " (" + rows.length + ")", nav: "todo " + nm });
      for (const t of rows) { t.indent = "  "; blocks.push({ row: t }); }
    }
    if (!names.length) blocks.push({ note: "(no open tickets)" });
  }
  //  The board — and only the board — accounts for every scanned worktree.
  if (!a.subject && !a.filters.length) wtBlocks(blocks);
  return { uri: uriStr, rows: all, hunks: [build(uriStr, blocks)] };
}

module.exports = { todo: todo,
                   //  BEE-025: the lexer and the ladder, the pieces a test and
                   //  any later ticket view read rather than re-implement.
                   shape: shape, ticketKey: ticketKey, keyTopic: keyTopic,
                   pageFile: pageFile, head: head, headerMark: headerMark,
                   stripMark: stripMark, bareTitle: bareTitle,
                   listTopic: listTopic, topicsOf: topicsOf, rootsOf: rootsOf,
                   byCode: byCode, byFresh: byFresh, dateRows: dateRows,
                   nest: nest, parseArgs: parseArgs, argLineWith: argLineWith,
                   spellWith: spellWith, filterVal: filterVal,
                   PRIO: PRIO, PRIO_TAG: PRIO_TAG, CLOSED: CLOSED, RAIL: RAIL };
