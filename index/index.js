//  index/index.js — the lazy, commit-based blob-to-path index a repo keeps in
//  its own `<gitdir>/be/` (LITE-006), so views answer by keyed reads instead
//  of walking history.  It is derived state: `rm -rf` it and the next run
//  rebuilds it from the ODB.  The record table is LITE-006:17:Rc, the lazy
//  contract LITE-006:53:Rc, keyed O(1) reads LITE-028:39:~1, dir revs LITE-044:42:5D,
//  submodules BEE-006:42:3B; LINK rows live in index/lindex.js and the registry
//  `$HOME/.config/bee/repos` is BEE-001:25:Po.
"use strict";

const refs = require("./refs.js");
const isSha40 = refs.isSha40;

//  The run family lives in the repo's own gitdir.
const IDX_DIR = "be";
//  The index format is its extension (BEE-002:115:qe): BEE-063:36 moved the kind
//  nibble to the key's TOP bits, so every older key reads as another family and
//  `.lite2.idx` retires — `openIndex` sweeps it and the lane rebuilds lazily.
const IDX_EXT = ".lite3.idx";
//  The KEYED lane beside it (BEE-024:23): a second family in the SAME dir, so
//  the sweep below has to know both exts or it unlinks the kv runs.
const KV_EXT = ".kv.idx";
//  The initial derive alone opens a 64Ki-row memtable and seals lazily
//  (DOG-032:38:Y0); the batch is the memtable, so a commit never lands mid-page.
const IDX_BULK_ROWS = 1 << 16;
//  Parsed trees held per run (a tree is immutable, so this only ever hits).
const TREE_CACHE_MAX = 1 << 14;

//  --- the field split -------------------------------------------------------
//  The kind is the key's TOP nibble (BEE-063:9), so each family owns one
//  contiguous 1/16 of the space and the fat SYM lane peppers no rev-lane page.
const K_BLOB = 0x1n, K_CMMT = 0x2n, K_PARS = 0x3n;
const K_CPAR = 0x4n, K_B2P = 0x5n, K_FSEG = 0x6n, K_MARK = 0xFn;
//  The commit date (BEE-033); 7 is lindex.js's LINK, A..E are still free.
const K_CTS = 0x8n;
//  The symbol-mention family (BEE-063:20), laid out in index/lindex.js.  With
//  the kind leading the key every kind owns a range, so it needs no all-ones.
const K_SYM = 0x9n;

const REV_BITS = 20n, PHL_BITS = 40n;
const REV_MAX = (1n << REV_BITS) - 1n;          // also the empty PARS slot
const PHL_MASK = (1n << PHL_BITS) - 1n;
const HL60_MASK = (1n << 60n) - 1n;
//  A CPAR row means "this commit is indexed", so a root commit gets one with
//  an empty (all-ones) parent slot (LITE-006:54:Rc).
const CPAR_NONE = HL60_MASK;

//  kind:4 | path_hl:40 | rev:20
function revKey(phl, rev, kind) { return (kind << 60n) | (phl << 20n) | rev; }
//  kind:4 | hashlet60:60
function hlKey(hl60, kind) { return (kind << 60n) | hl60; }
//  hashlet60:60 | vnib:4
function hlVal(hl60, vnib) { return (hl60 << 4n) | (vnib & 0xfn); }
//  path_hl:40 | rev:20 | vnib:4  (the B2P value, the REV key without its kind)
function pathRevVal(phl, rev) { return (phl << 24n) | (rev << 4n); }
//  par1:20 | par2:20 | par3:20 | vnib:4
function parsVal(p) {
  const s = [p[0], p[1], p[2]];
  for (let i = 0; i < 3; i++) if (s[i] === undefined) s[i] = REV_MAX;
  return (s[0] << 44n) | (s[1] << 24n) | (s[2] << 4n);
}
//  --- FSEG, the partial-path record (LITE-011) -------------------------------
//  key = 6 | fn_hl:40 | prnt_hl:20, val = seg0..seg5:10 each root-first | vnib:4.
//  A pure function of the path text, minted once and never invalidated
//  (LITE-011:30:a9); root-first is what anchors resolve.js (LITE-011:31:a9).
const SEG_SLOTS = 6;                              // the val holds the top six
const DEPTH_MAX = 15;                             // vnib is 4 bits
const SEG_MASK = (1n << 10n) - 1n;

//  A segment's top `bits` hashlet bits; a genuine 0 bumps to 1 so that 0 keeps
//  its ruled meaning, "no parent" or "no such level".
function segHl(name, bits) {
  const h = hlOfText(name) >> (60n - bits);
  return h === 0n ? 1n : h;
}
//  The last segment's top 40 bits.  No bump: it names nothing absent.
function fnHl(name) { return hlOfText(name) >> 20n; }

//  The fn:40 | prnt:20 split IS the rev key's, so it is built the one way.
function fsegKey(fn, prnt) { return revKey(fn, prnt, K_FSEG); }
function fsegVal(chain, depth) {
  let v = 0n;
  for (let i = 0; i < SEG_SLOTS; i++)
    v = (v << 10n) | (i < chain.length ? chain[i] : 0n);
  return (v << 4n) | BigInt(depth > DEPTH_MAX ? DEPTH_MAX : depth);
}
function fsegSeg(v, i) { return (v >> BigInt(54 - 10 * i)) & SEG_MASK; }
function fsegDepth(v) { return Number(v & 0xfn); }

//  One repo-relative path -> its { key, val }.  A path deeper than SEG_SLOTS
//  says so through `vnib`: the chain holds the top 6 and the near tail is
//  missing, so the descent goes wide for those levels instead of guessing.
function fsegRow(path) {
  const segs = path.split("/");
  const dirs = segs.slice(0, -1);
  const prnt = dirs.length ? segHl(dirs[dirs.length - 1], 20n) : 0n;
  const chain = [];
  for (let i = 0; i < dirs.length && i < SEG_SLOTS; i++)
    chain.push(segHl(dirs[i], 10n));
  return { key: fsegKey(fnHl(segs[segs.length - 1]), prnt),
           val: fsegVal(chain, dirs.length) };
}

function keyKind(k) { return k >> 60n; }
function keyPhl(k) { return (k >> 20n) & PHL_MASK; }
function keyRev(k) { return k & REV_MAX; }
function keyHl60(k) { return k & HL60_MASK; }
//  The VALUES kept their layout across BEE-063: only keys were re-packed.
function valHl60(v) { return v >> 4n; }

//  --- hashlets --------------------------------------------------------------
//  hashlet60: the top 60 bits of a 20-byte sha, big-endian, the JS twin of
//  dog/WHIFF.h whiff_hashlet(s, 15), mirrored from be/shared/util/sha.js.
function hashlet60FromBytes(sha20) {
  let h = 0n;
  for (let i = 0; i < 8; i++) h = (h << 8n) | BigInt(sha20[i]);
  return h >> 4n;
}
function hlOfSha(sha40) { return hashlet60FromBytes(hex.decode(sha40)); }
function hlOfText(s) { return hashlet60FromBytes(sha1(utf8.Encode(s))); }
//  path_hl: the top 40 bits of the path's hashlet (the hashlet60 minus its
//  low 20); the path is repo-relative with no leading slash.
function pathHl(path) { return (hlOfText(path) >> 20n) & PHL_MASK; }

//  --- the repo list ---------------------------------------------------------
function readText(path) {
  try {
    const m = io.mmap(path, "r");
    const d = m.data ? m.data() : m;
    return utf8.Decode(d);
  } catch (e) { return null; }
}

//  The registered worktree paths (BEE-001:25:Po, BEE-002:29:qe), one per line,
//  deduped on read, in file order: what a cross-repo query fans out over.  The
//  retired `$HOME/.config/be/tracks` seeds the list while the new file is absent.
function repos(home) {
  home = home || io.getenv("HOME");
  if (!home) return [];
  let txt = readText(home + "/.config/bee/repos");
  if (txt === null) txt = readText(home + "/.config/be/tracks");
  const out = [];
  for (const raw of (txt === null ? "" : txt).split("\n")) {
    const t = raw.trim();
    if (t !== "" && out.indexOf(t) < 0) out.push(t);
  }
  return out;
}

//  Append `repo` to `$HOME/.config/bee/repos` (BEE-001), a read-modify-write of
//  the whole short file -> { file, added }; writing it retires `tracks` for good.
function track(repo, home) {
  home = home || io.getenv("HOME");
  if (!home) throw "index: there is no HOME, so there is no repo list";
  const dir = home + "/.config/bee";
  const file = dir + "/repos";
  const seed = readText(file) === null;
  const lines = repos(home);
  const have = lines.indexOf(repo) >= 0;
  if (have && !seed) return { file: file, added: false };
  if (!have) lines.push(repo);
  io.mkdir(dir);
  const fd = io.open(file, "c");
  try { io.writeAll(fd, utf8.Encode(lines.join("\n") + "\n")); }
  finally { io.close(fd); }
  return { file: file, added: !have };
}

//  --- the ODB reader --------------------------------------------------------
//  One repo handle plus the per-run memos.  Trees are parsed through the
//  dog/git cursor `git.tree` and commits through `git.parseCommit`, so no git
//  framing is ever read in JS.
function reader(h) {
  return { h: h, trees: new Map(), commits: new Map(), ts: new Map(),
           subs: new Map() };
}

//  The name is any 6..40-char hexlet (LITE-007), so a 15-hex hashlet60 (what
//  the index rows carry) reads exactly like a full sha; ODBHex resolves both.
const HEXLET = /^[0-9a-fA-F]{6,40}$/;
function object(r, name) {
  if (typeof name !== "string" || !HEXLET.test(name)) return null;
  let o;
  try { o = git.getHex(r.h, name); } catch (e) { return null; }
  return o === null ? null : o;
}

//  A tree -> Map(name -> { sha, mode, dir }).  Gitlinks (0o160000) are dropped
//  here, since a submodule's commit lives in another ODB and is no blob;
//  `subTree` below answers them on their own terms (BEE-006).
function readTree(r, sha) {
  if (!sha) return null;
  const hit = r.trees.get(sha);
  if (hit !== undefined) return hit;
  const o = object(r, sha);
  let m = null;
  if (o !== null && o.type === "tree") {
    m = new Map();
    const c = git.tree(o.bytes);
    while (c.next()) {
      if (c.mode === 0o160000) continue;
      m.set(c.str, { sha: c.sha, mode: c.mode, dir: c.mode === 0o40000 });
    }
  }
  if (r.trees.size >= TREE_CACHE_MAX) r.trees.clear();
  r.trees.set(sha, m);
  return m;
}

//  --- the gitlinks (BEE-006) ---------------------------------------------------
const MODE_SUB = 0o160000;

//  One tree's gitlinks, name -> commit sha, memoized per tree like `readTree`:
//  exactly what `readTree` drops, answered here on their own terms.
function subTree(r, sha) {
  if (!sha) return new Map();
  const hit = r.subs.get(sha);
  if (hit !== undefined) return hit;
  const o = object(r, sha);
  const m = new Map();
  if (o !== null && o.type === "tree") {
    const c = git.tree(o.bytes);
    while (c.next()) if (c.mode === MODE_SUB) m.set(c.str, c.sha);
  }
  if (r.subs.size >= TREE_CACHE_MAX) r.subs.clear();
  r.subs.set(sha, m);
  return m;
}

//  Every gitlink path under `tree`, at any depth -> [{ path, sha }].  The gate
//  is `.gitmodules` at the root: a repo without one pays one Map hit, no walk.
function subPaths(r, tree, prefix, out) {
  const M = readTree(r, tree);
  if (M === null) return out;
  for (const [name, sha] of subTree(r, tree))
    out.push({ path: prefix + name, sha: sha });
  for (const [name, e] of M)
    if (e.dir) subPaths(r, e.sha, prefix + name + "/", out);
  return out;
}
function submodulePaths(r, tree) {
  const M = readTree(r, tree);
  if (M === null || !M.has(".gitmodules")) return [];
  return subPaths(r, tree, "", []);
}

//  The gitlink sha at `path` in `tree`, or null: the dirs off the cached
//  `readTree`, the leaf off its parent tree's gitlink map.
function subAt(r, tree, path) {
  if (!tree) return null;
  const segs = path.split("/");
  let t = tree;
  for (let i = 0; i + 1 < segs.length; i++) {
    const M = readTree(r, t);
    if (M === null) return null;
    const e = M.get(segs[i]);
    if (e === undefined || !e.dir) return null;
    t = e.sha;
  }
  const sha = subTree(r, t).get(segs[segs.length - 1]);
  return sha === undefined ? null : sha;
}

//  A commit that bumped a gitlink gets one dir rev on the sub's path
//  (BEE-006:45:3B); dog/git's tree diff drops gitlinks, so the compare is here (BEE-006:54:3B).
function subRevs(r, subs, tree, pTrees, out) {
  for (const s of subs) {
    const now = subAt(r, tree, s.path);
    if (now === null) continue;
    let same = false;
    for (const t of pTrees) if (subAt(r, t, s.path) === now) { same = true; break; }
    if (same) continue;
    out.push({ path: s.path, phl: pathHl(s.path), blob: now, pblobs: [],
               dir: true });
  }
}

//  A commit -> { tree, parents[], ts, ats, author, subject } | null.  `ts` is
//  the committer time (what git orders a log by), `ats` the author time (what
//  git and be log display).  `name` may be a hashlet: LITE-007's log reads the
//  rows' 15-hex hashlet60s straight through here.
function readCommit(r, name) {
  const hit = r.commits.get(name);
  if (hit !== undefined) return hit;
  const o = object(r, name);
  let m = null;
  if (o !== null && o.type === "commit") {
    const pc = git.parseCommit(o.bytes);
    const ps = [];
    for (const p of (pc.parents || [])) if (isSha40(p)) ps.push(p);
    const ats = identTs(pc.author), cts = identTs(pc.committer);
    m = { tree: isSha40(pc.tree) ? pc.tree : null, parents: ps,
          ts: cts || ats, ats: ats || cts,
          author: pc.author || "", subject: firstLine(pc.body) };
  }
  //  CODE-034: swept at the cap like its siblings — BEE-048 lets the ctx
  //  outlive the request, so an uncapped memo leaks in a resident `bee http`.
  if (r.commits.size >= TREE_CACHE_MAX) r.commits.clear();
  r.commits.set(name, m);
  return m;
}

//  The commit message's first line (be/views/log/log.js firstLine).
function firstLine(body) {
  if (!body) return "";
  let i = 0;
  while (i < body.length && (body[i] === "\n" || body[i] === "\r")) i++;
  let j = i;
  while (j < body.length && body[j] !== "\n" && body[j] !== "\r") j++;
  return body.slice(i, j);
}

//  The epoch seconds off an already-parsed `author`/`committer` header value
//  ("Name <mail> <secs> <tz>"); dog/git split the object into fields, this only
//  reads the numeric tail of one of them.  0 when it is not there.
function identTs(ident) {
  if (typeof ident !== "string") return 0;
  const m = /(\d+)(?:\s+[+-]\d{4})?\s*$/.exec(ident);
  return m ? Number(m[1]) : 0;
}

//  --- the index handle ------------------------------------------------------
//  A linked worktree shares the ODB, so it shares the index: the dir is the
//  common gitdir's, never the worktree's.
function indexDir(gitdir) {
  const c = refs.commonDir(gitdir);
  let d = c;                                  // a worktree's is `<gd>/../..`
  try { d = io.realpath(c); } catch (e) {}
  return d + "/" + IDX_DIR;
}

//  `abc.index` mkdirs `<gitdir>/be`, derived state this verb owns.  `bulk` is
//  DOG-032's big-memtable derive, `ro` a read-only open — the rung a fan-out
//  falls back to when the repo refuses to be brought up (BEE-065:22).
function openIndex(gitdir, bulk, ro) {
  const o = { dir: indexDir(gitdir), ext: IDX_EXT };
  if (bulk) { o.mem = IDX_BULK_ROWS; o.durable = false; }
  if (ro) { o.mode = "r"; return abc.index("wh128", o); }
  sweep(o.dir);
  return abc.index("wh128", o);
}

//  The kv64 lane of index/kv.js, opened in the SAME common dir (BEE-024:29), so
//  linked worktrees share it exactly as they share the wh128 family (BEE-009).
function openKv(gitdir, ro) {
  const o = { dir: indexDir(gitdir), ext: KV_EXT };
  if (ro) { o.mode = "r"; return abc.index("kv64", o); }
  sweep(o.dir);
  return abc.index("kv64", o);
}

//  The live formats, longest ext first so that one ending in another still
//  matches its own.  BEE-024:118 generalized this: ONE sweep knows both.
const IDX_EXTS = [IDX_EXT, KV_EXT];

//  Unlink every file of an outdated format before either family is opened
//  (BEE-002:115:qe); the dir is fully derived, so the next run rebuilds from the ODB.
function sweep(dir) {
  let fs;
  try { fs = io.readdir(dir); } catch (e) { return; }
  for (const f of fs) {
    const n = f.length >= 1 && f.slice(-1) === "/" ? "" : f;
    if (n === "" || hasExt(n)) continue;
    try { io.unlink(dir + "/" + n); } catch (e) {}
  }
}

//  Does this index-dir entry belong to a live family?  A run is `<ron64><ext>`
//  and the memtable is the bare `<ext>`, so a suffix test answers both.
function hasExt(name) {
  for (const e of IDX_EXTS)
    if (name.length >= e.length && name.slice(-e.length) === e) return true;
  return false;
}

//  Has this repo an index at all?  A dir with no run and no memtable is the
//  from-scratch derive, the one run that wants the big memtable.
function fresh(gitdir) {
  const dir = indexDir(gitdir);
  try {
    for (const f of io.readdir(dir))
      if (f.length >= IDX_EXT.length && f.slice(-IDX_EXT.length) === IDX_EXT)
        return false;
  } catch (e) { return true; }
  return true;
}

//  Progress for histories over 100 commits: a throttled one-line \r report on
//  stderr, tty only, so piped and captured runs stay byte-identical.
const PROG_MIN = 100, PROG_MS = 200;
function progress() {
  let on = false;
  try { on = io.isatty(2); } catch (e) { on = false; }
  let last = 0, dirty = false;
  function raw(s) {
    const b = utf8.Encode(s);
    const x = io.buf(b.length + 8);
    x.feed(b);
    io.writeAll(2, x);
  }
  return {
    tick: function (s) {
      if (!on) return;
      const t = Date.now();
      if (t - last < PROG_MS) return;
      last = t; dirty = true;
      raw("\r" + s + "\x1b[K");
    },
    //  One unthrottled line saying WHAT the ticks below are walking: a cold
    //  repo in a query's fan-out names itself rather than stalling mute (BEE-065:23).
    note: function (s) { if (on) raw(s + "\n"); },
    done: function () { if (on && dirty) { dirty = false; raw("\r\x1b[K"); } }
  };
}

//  A batching writer (be/shared/ingest.js `idxWriter`): the rows put between
//  two commits fit one memtable, whatever size it was opened at.  A seal never
//  carries the mark.
function idxWriter(ix) {
  let n = 0, total = 0;
  const batch = Number(ix.mem) > 0 ? Number(ix.mem) : 0;
  return {
    put: function (k, v) {
      ix.put(k, v); total++; n++;
      if (batch && n >= batch) { ix.commit(); n = 0; }
    },
    seal: function () { if (n) { ix.commit(); n = 0; } },
    get rows() { return total; }
  };
}

//  Every MARK val this ref carries.  A wh128 index is unkeyed, so a bumped mark
//  is a second row on the same key and nothing says which is newer; that does
//  not matter, since the walk stops at any of them and meets the newest first.
function markSet(ix, refHl) {
  const key = hlKey(refHl, K_MARK);
  const out = new Set();
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    out.add(valHl60(c.val));
  }
  return out;
}

//  --- the arrival state -----------------------------------------------------
//  What the walk extends: `next` path_hl -> next free rev; `byPB` (path,blob)
//  -> newest rev (the PARS lookup); `top` path_hl -> highest {rev, blob, commit},
//  the re-put guard (LITE-006:56:Rc); all filled by keyed seeks (LITE-028:39:~1).
function state(ix) {
  const st = { ix: ix, next: new Map(), byPB: new Map(), top: new Map(),
               have: new Set(), dirs: new Set(),          // LITE-044: loadDir's
               yes: new Set(), no: new Set(), all: false };
  //  An empty index is fully known after one row read.  `range` and `prefix`
  //  answer zero rows at a 2^64 bound (mtimeidx.js), so every read here is a `seek`.
  if (!ix.seek(0n).next()) st.all = true;
  //  `done` is not materialized: one keyed CPAR seek per probed commit (a CPAR
  //  row is the "indexed" flag); `add` is what the run's own seals contribute.
  st.done = {
    has: function (chl) { return hasDone(st, chl); },
    add: function (chl) { st.yes.add(chl); st.no.delete(chl); }
  };
  return st;
}

function hasDone(st, chl) {
  if (st.yes.has(chl)) return true;
  if (st.all || st.no.has(chl)) return false;
  const key = hlKey(chl, K_CPAR);
  const c = st.ix.seek(key);
  const hit = c.next() && c.key === key;
  (hit ? st.yes : st.no).add(chl);
  return hit;
}

//  One (kind, path_hl) span, rev-ordered: with the kind in the TOP nibble a
//  path owns one span PER KIND (BEE-063:38), never one span for all of them, so
//  every folding reader takes the two or three it wants and nothing else.
function revSpan(ix, phl, kind, cb) {
  const c = ix.seek(revKey(phl, 0n, kind));
  while (c.next()) {
    if (keyKind(c.key) !== kind || keyPhl(c.key) !== phl) break;
    cb(c.key, c.val);
  }
}

//  One path's rows (LITE-028:41:~1): the BLOB span then the CMMT one fill
//  next/byPB/top.  BLOB still lands before CMMT for a given rev, which is what
//  lets the commit slot of `top` be filled by the second pass.
function loadPath(st, phl) {
  if (st.all || st.have.has(phl)) return;
  st.have.add(phl);
  const take = function (k, v) { row(st, k, v); };
  revSpan(st.ix, phl, K_BLOB, take);
  revSpan(st.ix, phl, K_CMMT, take);
}

//  --- the last rev, without the chain (LITE-044:49:5D) --------------------------
//  A rev chain is dense (0..k, minted and sealed in order), so "is there a rev
//  r" is an exact-key probe and the highest rev is found by galloping and then
//  bisecting: O(log k) seeks, no row of the chain read.
function revValAt(ix, phl, rev, kind) {
  const k = revKey(phl, rev, kind);
  const c = ix.seek(k);
  return (c.next() && c.key === k) ? c.val : null;
}
//  The highest rev of `kind` this path holds, or -1 when it holds none.
function lastRev(ix, phl, kind) {
  if (revValAt(ix, phl, 0n, kind) === null) return -1n;
  let lo = 0n, hi = 1n;
  while (hi <= REV_MAX && revValAt(ix, phl, hi, kind) !== null) { lo = hi; hi *= 2n; }
  if (hi > REV_MAX) hi = REV_MAX;
  while (lo + 1n < hi) {
    const mid = (lo + hi) >> 1n;
    if (revValAt(ix, phl, mid, kind) !== null) lo = mid; else hi = mid;
  }
  return lo;
}

//  A dir path's state: its last rev alone.  A hot dir changes in most commits,
//  so folding its whole chain the way loadPath folds a file's would be the very
//  O(history) read LITE-028 removed (LITE-044:49:5D); a dir needs no byPB, no blob.
function loadDir(st, phl) {
  if (st.all || st.dirs.has(phl)) return;
  st.dirs.add(phl);
  const last = lastRev(st.ix, phl, K_CMMT);
  if (last < 0n) return;
  const nx = st.next.get(phl);
  if (nx === undefined || nx <= last) st.next.set(phl, last + 1n);
  const t = st.top.get(phl);
  if (t === undefined || t.rev < last)
    st.top.set(phl, { rev: last, blob: null,
                      commit: valHl60(revValAt(st.ix, phl, last, K_CMMT)) });
}

//  One index row into the state, the fold the old full pass did per row.  Only
//  the two REV kinds reach it now: a CPAR row can no longer share a path's span.
function row(st, k, v) {
  const kind = keyKind(k);
  const phl = keyPhl(k), rev = keyRev(k);
  if (kind === K_BLOB) {
    const blob = valHl60(v);
    const nx = st.next.get(phl);
    if (nx === undefined || nx <= rev) st.next.set(phl, rev + 1n);
    const pb = (phl << 60n) | blob;
    const cur = st.byPB.get(pb);
    if (cur === undefined || cur < rev) st.byPB.set(pb, rev);
    const t = st.top.get(phl);
    if (t === undefined || t.rev < rev)
      st.top.set(phl, { rev: rev, blob: blob, commit: null });
    return;
  }
  //  A dir rev is a CMMT row with no BLOB one (LITE-044), so the arrival counter
  //  is bumped here too: a path that was a dir and is a file now shares it.
  const nx = st.next.get(phl);
  if (nx === undefined || nx <= rev) st.next.set(phl, rev + 1n);
  const t = st.top.get(phl);                   // BLOB sorts before CMMT per rev
  if (t !== undefined && t.rev === rev) t.commit = valHl60(v);
}

//  --- the commit date (BEE-033) ---------------------------------------------
//  `CTS` (8) — key `8|commit_hl:60`, val `ats:60|vnib:4`: the AUTHOR time in
//  epoch seconds, what every bee view displays.  A miss answers null and the
//  caller falls back to `readCommit`, so a lane filled before the kind existed
//  is slow, never wrong (BEE-033:46).
function commitTs(ix, chl) {
  const key = hlKey(chl, K_CTS);
  const c = ix.seek(key);            // exact key: `range`/`prefix` answer none
  if (!c.next() || c.key !== key) return null;
  return Number(valHl60(c.val));
}

//  A blob -> the date of the OLDEST commit carrying it, off the index alone:
//  `B2P` names the carriers, each carrier's `REV-CMMT` names the commit and
//  `CTS` dates it (BRO-044's answer, no new lane).  ONE unknown carrier makes
//  the fold null, so a half-filled lane can never answer a too-new date.
function blobTs(ix, bhl) {
  const key = hlKey(bhl, K_B2P);
  const carriers = [];               // read whole: the fold opens its own cursors
  const c = ix.seek(key);
  while (c.next()) {
    if (c.key !== key) break;
    carriers.push([c.val >> 24n, (c.val >> 4n) & REV_MAX]);
  }
  let best = null;
  for (const cr of carriers) {
    const cv = revValAt(ix, cr[0], cr[1], K_CMMT);
    if (cv === null) return null;
    const ts = commitTs(ix, valHl60(cv));
    if (ts === null) return null;
    if (best === null || ts < best) best = ts;
  }
  return best;
}

//  --- the commit walk -------------------------------------------------------
//  Climb from the tip, never entering a commit already in the index: presence,
//  not a watermark, is the boundary (LITE-006:53:Rc), so any history converges,
//  an interrupted run resumes and a rebase needs no case.
function collect(r, tip, done, prog) {
  const set = new Set(), queue = [];
  if (done.has(hlOfSha(tip))) return { set: set, order: [] };
  set.add(tip); queue.push(tip);
  for (let i = 0; i < queue.length; i++) {
    const m = readCommit(r, queue[i]);
    if (!m) continue;                          // unreadable (shallow): clean stop
    for (const p of m.parents) {
      if (set.has(p) || done.has(hlOfSha(p))) continue;
      set.add(p); queue.push(p);
    }
    if (prog && queue.length > PROG_MIN)
      prog.tick("walking the history: " + queue.length + " commits found");
  }
  return { set: set, order: topo(r, set) };
}

//  A binary heap on (ts, name), the ready queue of the Kahn sorts.  `desc`
//  flips it to a max-heap, which is LITE-007's newest-first log order.
function heap(desc) {
  const a = [];
  const less = desc ? ((x, y) => x[0] !== y[0] ? x[0] > y[0] : x[1] > y[1])
                    : ((x, y) => x[0] !== y[0] ? x[0] < y[0] : x[1] < y[1]);
  return {
    get size() { return a.length; },
    push: function (ts, sha) {
      a.push([ts, sha]);
      for (let i = a.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (!less(a[i], a[p])) break;
        const t = a[i]; a[i] = a[p]; a[p] = t; i = p;
      }
    },
    pop: function () {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        for (let i = 0;;) {
          const l = 2 * i + 1, rr = l + 1;
          let s = i;
          if (l < a.length && less(a[l], a[s])) s = l;
          if (rr < a.length && less(a[rr], a[s])) s = rr;
          if (s === i) break;
          const t = a[i]; a[i] = a[s]; a[s] = t; i = s;
        }
      }
      return top[1];
    }
  };
}

//  Ancestors strictly before descendants, commit date as the practical order:
//  Kahn over the in-set parent edges with the ready set drained oldest-first.
//  Topology is the hard constraint (clock skew can never put a child ahead of
//  its parent); the date only picks between ready commits.
function topo(r, set) {
  const deg = new Map(), kids = new Map();
  for (const sha of set) {
    const m = readCommit(r, sha);
    let d = 0;
    for (const p of (m ? m.parents : [])) {
      if (!set.has(p)) continue;
      d++;
      let ks = kids.get(p);
      if (ks === undefined) kids.set(p, ks = []);
      ks.push(sha);
    }
    deg.set(sha, d);
  }
  const ready = heap();
  for (const sha of set)
    if (deg.get(sha) === 0) { const m = readCommit(r, sha); ready.push(m ? m.ts : 0, sha); }
  const out = [];
  while (ready.size) {
    const sha = ready.pop();
    out.push(sha);
    for (const kid of (kids.get(sha) || [])) {
      const d = deg.get(kid) - 1;
      deg.set(kid, d);
      if (d === 0) { const m = readCommit(r, kid); ready.push(m ? m.ts : 0, kid); }
    }
  }
  return out;
}

//  --- the per-commit rev derivation ----------------------------------------
//  A commit yields a new rev of path P iff P's blob differs from P's in every
//  parent; a subtree equal to any parent's is pruned whole.  Both tests are
//  one C leaf, `git.getTreeDiff` (DOG-030:23:Ph, DOG-030:24:Ph).
const ZERO40 = "0000000000000000000000000000000000000000";
const MODE_DIR = 0o40000;

//  One (tree, parentTree) diff -> Map(name -> { sha, dir, old, oldDir }).
//  `old` is null when the path is absent on the parent side; the whole answer
//  is null when the new tree is unreadable.
function diffMap(r, aSha, bSha) {
  let buf;
  try { buf = git.getTreeDiff(r.h, aSha, bSha || ZERO40); }
  catch (e) { return null; }
  if (buf === null) return null;
  const m = new Map();
  const c = git.tree(buf);
  while (c.next()) {
    const mode = c.mode, sha = c.sha, name = c.str;
    if (!c.next()) break;                       // the old half of the pair
    if (sha === ZERO40) continue;               // deleted: no rev of it here
    const osha = c.sha;
    m.set(name, { sha: sha, dir: mode === MODE_DIR,
                  old: osha === ZERO40 ? null : osha,
                  oldDir: c.mode === MODE_DIR });
  }
  return m;
}

//  `pTrees` stays parent-aligned (a null slot means that parent has no tree
//  here), so a rev's PARS come out in the commit's own parent order.  Emits
//  { path, phl, blob, pblobs[], dir } into `out`.
function descend(r, treeSha, pTrees, prefix, out) {
  if (!treeSha) return;
  for (const t of pTrees) if (t === treeSha) return;      // unchanged: prune
  const maps = [];
  for (const t of pTrees) {
    const m = diffMap(r, treeSha, t);
    if (m === null) return;                               // unreadable tree
    maps.push(m);
  }
  //  A root commit has no parent to differ from: the whole tree is new.
  const base = maps.length ? maps[0] : diffMap(r, treeSha, ZERO40);
  if (base === null) return;
  for (const [name, e] of base) {
    const path = prefix + name;
    const olds = [];
    let same = false;
    for (const m of maps) {
      const s = m.get(name);
      if (s === undefined) { same = true; break; }   // identical there: prune
      olds.push(s);
    }
    if (same) continue;
    if (e.dir) {
      const pd = olds.map((s) => (s.old !== null && s.oldDir) ? s.old : null);
      //  A changed dir is a node of its own, listed before its children
      //  (LITE-044:42:5D); `emit` mints it one rev row, `lindex` skips it.
      out.push({ path: path, phl: pathHl(path), blob: e.sha, pblobs: pd,
                 dir: true });
      descend(r, e.sha, pd, path + "/", out);
      continue;
    }
    out.push({ path: path, phl: pathHl(path), blob: e.sha, dir: false,
               pblobs: olds.map((s) => (s.old !== null && !s.oldDir)
                                       ? s.old : null) });
  }
}

//  --- the repo -------------------------------------------------------------
//  `git.open` takes a repo root, a `.git` dir or a gitfile and does not climb
//  (LITE-007), so a verb invoked from a subdirectory climbs here first: the
//  nearest ancestor carrying a `.git`, ceiling `/`.  The dir for `git.open`, or null.
function discover(from) {
  let dir;
  try { dir = io.realpath(from || io.cwd()); } catch (e) { return null; }
  for (;;) {
    let kind = null;
    try { kind = io.stat(dir + "/.git").kind; } catch (e) { kind = null; }
    if (kind === "dir" || kind === "reg") return dir;
    const i = dir.lastIndexOf("/");
    if (i < 0) return null;
    const up = i === 0 ? "/" : dir.slice(0, i);
    if (up === dir) return null;
    dir = up;
  }
}

//  A linked worktree carries `<gitdir>/commondir` and nothing else does
//  (BEE-001): a plain fs probe, no parsing.  Both doors read it from here.
function linkedWorktree(gitdir) {
  try { return io.stat(gitdir + "/commondir").kind === "reg"; }
  catch (e) { return false; }
}

//  The gitdir a worktree root keeps (BEE-009): a plain `.git` dir, or the path
//  a gitfile names (a linked worktree, a submodule).  null when no repo is there.
function gitdirOf(root) {
  const p = root + "/.git";
  let kind = null;
  try { kind = io.stat(p).kind; } catch (e) { return null; }
  if (kind === "dir") return p;
  if (kind !== "reg") return null;
  const t = readText(p);
  if (t === null) return null;
  const i = t.indexOf("gitdir:");
  if (i < 0) return null;
  const d = t.slice(i + 7).trim();
  return d === "" ? null : (d[0] === "/" ? d : root + "/" + d);
}

//  The original a linked worktree is a second path to (BEE-009): `commondir`
//  (index/refs.js) minus its `/.git`.  null for a main worktree or a submodule.
function origin(gitdir) {
  if (gitdir === null || !linkedWorktree(gitdir)) return null;
  let c = refs.commonDir(gitdir);
  try { c = io.realpath(c); } catch (e) { return null; }
  if (c.length <= 5 || c.slice(-5) !== "/.git") return null;
  const root = c.slice(0, -5);
  try { return io.stat(root + "/.git").kind === "dir" ? root : null; }
  catch (e) { return null; }
}

//  The main worktree a path is a checkout of (BEE-009), itself when it is one
//  or no repo at all: the registry's identity, one line per repository.
function mainOf(root) {
  const o = origin(gitdirOf(root));
  return o === null ? root : o;
}

//  GIT-031: the ODB handle is the whole cost of an open — it maps every
//  pack pair in the repo — and it is READ-ONLY and reusable, so it is kept
//  for the process's life instead of being reopened per lookup.  A page's
//  reference fan-out used to reopen 288 times; now it opens once per repo.
const HANDLES = new Map();      //  realpath'd repo -> the live git handle
const FRESHAT = new Map();      //  realpath'd repo -> the epoch it caught up at
let EPOCH = 0;

//  GIT-031: one page/run is ONE snapshot of every repo it touches.  http.js
//  and main.js bump this per request; the first use of a handle inside the
//  new epoch stats its objects dir, and rescans only if git moved a listing.
function epoch() { EPOCH++; }

function handleOf(repo) {
  const have = HANDLES.get(repo);
  if (have !== undefined) {
    if (FRESHAT.get(repo) !== EPOCH) {
      FRESHAT.set(repo, EPOCH);
      //  A repo that went away mid-run keeps serving what it already mapped.
      try { have.freshen(); } catch (e) {}
    }
    return have;
  }
  let h;
  try { h = git.open(repo); } catch (e) { throw "index: " + e; }
  HANDLES.set(repo, h);
  FRESHAT.set(repo, EPOCH);
  return h;
}

//  --- BEE-048: the TIP and the LANE, per repo, while fsw stays quiet ---------
//  GIT-031 kept the ODB handle; everything above it was still reopened per
//  reference, which a resident server pays 512 times a board page.  The witness
//  is the rev tree (index/cache.js armRepo arms HEAD, `refs/` and the lane): an
//  event under ONE repo drops that repo's entries alone, and no TTL is guessed.
//  wtstat.js:40:sb's law holds — no live watcher, no entry, so the CLI is as it was.
const TIPS = new Map();         //  worktree root -> { rev, ctx, tree }
const LANES = new Map();        //  worktree root -> { rev, ix }
const LC = { tipHits: 0, tipMisses: 0, laneHits: 0, laneMisses: 0 };

//  The repo's rev, or null when nothing may be remembered.  `cache` is required
//  lazily: it requires THIS file at its top (index/cache.js:10:_S).
function repoRev(root, gitdir) {
  const cache = require("./cache.js");
  if (!cache.live()) return null;
  cache.armRepo(root, gitdir);
  const rv = cache.rev(root);
  return typeof rv === "number" && rv >= 0 ? rv : null;   // a token is no witness
}

//  openRepo(arg) -> { h, repo, gitdir, root, head, r, rev }.  `root` is the
//  worktree the paths in the index are relative to (the gitdir's parent for a
//  plain `.git`, else the path we opened).  The caller closes with closeRepo.
//  GIT-031: `h` is SHARED and outlives the ctx.  BEE-048: so does the whole
//  ctx while the repo's rev stands — no field of one is ever assigned to.
function openRepo(arg, climb) {
  let repo = null;
  if (climb) repo = discover(arg);
  else { try { repo = io.realpath(arg); } catch (e) { repo = null; } }
  if (repo === null) throw "index: there is no git repository at " + arg;
  const h = handleOf(repo);
  const gitdir = h.dir;
  let root = repo;
  if (gitdir.length > 5 && gitdir.slice(-5) === "/.git") root = gitdir.slice(0, -5);
  const rv = repoRev(root, gitdir);
  const have = rv === null ? undefined : TIPS.get(root);
  if (have !== undefined && have.rev === rv) { LC.tipHits++; return have.ctx; }
  LC.tipMisses++;
  const hd = refs.head(gitdir);
  //  GIT-031: the handle is the cache's, not this ctx's — a HEAD-less repo
  //  refuses without unmapping what other callers are still reading.
  if (hd === null) throw "index: " + repo + " has no HEAD to index";
  const ctx = { h: h, repo: repo, gitdir: gitdir, root: root, head: hd,
                r: reader(h), rev: rv };
  if (rv !== null) TIPS.set(root, { rev: rv, ctx: ctx, tree: undefined });
  return ctx;
}

//  The tip commit's TREE — where every reference resolve starts (door.js:334).
//  It rides the tip entry the head came in, so a warm repo reads no commit.
function tipTree(ctx) {
  const have = ctx.rev === null ? undefined : TIPS.get(ctx.root);
  const warm = have !== undefined && have.rev === ctx.rev;
  if (warm && have.tree !== undefined) { LC.tipHits++; return have.tree; }
  LC.tipMisses++;
  const c = readCommit(ctx.r, ctx.head.sha);
  const t = (c !== null && c.tree) ? c.tree : null;
  if (warm) have.tree = t;
  return t;
}

//  ONE open lane per repo, brought up ONCE and shared by every reader (door.js
//  laneUp, view/todo.js dateRows).  A borrower releases with `laneDown`, a
//  NO-OP for the shared handle as closeRepo:845 is for the shared ODB one; the
//  dropped handle is closed here, where no borrower can still be holding it.
function laneOf(ctx, open) {
  const have = LANES.get(ctx.root);
  if (have !== undefined && ctx.rev !== null && have.rev === ctx.rev) {
    LC.laneHits++;
    return have.ix;
  }
  LC.laneMisses++;
  if (have !== undefined) {
    LANES.delete(ctx.root);
    try { have.ix.close(); } catch (e) {}
  }
  const ix = open();
  if (ctx.rev === null) return ix;              // no watcher: the caller owns it
  LANES.set(ctx.root, { rev: ctx.rev, ix: ix });
  return ix;
}

//  Is this handle the cache's?  The map holds one entry per repo, so the scan
//  is over a handful; a borrower must never close what it does not own.
function laneShared(ix) {
  for (const e of LANES.values()) if (e.ix === ix) return true;
  return false;
}

function laneDown(ix) {
  if (ix === null || laneShared(ix)) return;
  try { ix.close(); } catch (e) {}
}

//  BEE-048: the bar the test asserts — a warm request opens no lane and reads
//  no tip, so both `misses` stand still across a second identical query.
function stats() {
  return { tipHits: LC.tipHits, tipMisses: LC.tipMisses,
           laneHits: LC.laneHits, laneMisses: LC.laneMisses,
           tips: TIPS.size, lanes: LANES.size };
}

//  GIT-031: a no-op for the SHARED handle openRepo hands out; a handle some
//  other opener made (hook.js's openUnborn) is still its own and is closed.
function closeRepo(ctx) {
  if (HANDLES.get(ctx.repo) === ctx.h) return;
  try { git.close(ctx.h); } catch (e) {}
}

//  The initialised submodules of an open repo -> { subs, skipped } (BEE-006).
//  A sub's `.git` is a gitfile with no `commondir`, so BEE-001's linked-worktree
//  refusal never trips on it; an uninitialised or out-of-worktree one is
//  skipped, in words, and never fails the parent's run.
function submodules(ctx) {
  const out = { subs: [], skipped: [] };
  const m = readCommit(ctx.r, ctx.head.sha);
  if (m === null || !m.tree) return out;
  const pfx = ctx.root + "/";
  for (const s of submodulePaths(ctx.r, m.tree)) {
    let real = null;
    try { real = io.realpath(pfx + s.path); } catch (e) { real = null; }
    if (real === null || real.slice(0, pfx.length) !== pfx) {
      out.skipped.push(s.path + " (no worktree of the parent's there)");
      continue;
    }
    let kind = null;
    try { kind = io.stat(real + "/.git").kind; } catch (e) { kind = null; }
    if (kind !== "dir" && kind !== "reg") {
      out.skipped.push(s.path + " (not initialised)");
      continue;
    }
    out.subs.push({ path: s.path, root: real });
  }
  return out;
}

//  --- the run ---------------------------------------------------------------
//  index(repoArg, opts) -> the summary record, `rec.link` the LINK half's.
//  opts: `home` (registry root), `track === false` (no registry line), `climb`
//  (find the repo above the arg), `links === false`, `subs === false`.
function index(repoArg, opts) {
  opts = opts || {};
  const ctx = openRepo(repoArg, opts.climb);
  let rec;
  try {
    const ix = openIndex(ctx.gitdir, fresh(ctx.gitdir));
    try {
      rec = bringUp(ctx, ix, opts);
      //  The LITE-033 round over the tip blobs, off its own mark (BEE-007);
      //  required lazily, so lindex.js's own `require("./index.js")` is fine.
      if (opts.links !== false) rec.link = require("./lindex.js").scan(ctx, ix);
    } finally { try { ix.close(); } catch (e) {} }
    //  BEE-024: the kv lane is a family of its own, so it opens after this one
    //  closes; the sweep is lazy either way and `bee index` runs it so that the
    //  summary line is honest about what the board would answer off.
    if (opts.kv !== false) rec.kv = require("./kv.js").sweepRepo(ctx, opts);
    //  Depth-first into every initialised submodule (BEE-006:48:3B), same
    //  bring-up and opts, so `track: false` writes no registry line for any.
    if (opts.subs !== false) indexSubs(ctx, rec, opts);
  } finally { closeRepo(ctx); }
  return rec;
}

//  The recursion itself (BEE-006).  `rec.subs` comes out flat (a nested sub
//  keeps its parent-relative path) and `rec.skipped` says what was passed over;
//  `_seen` holds the roots taken, so a sub pointing at one is a cycle and stops.
function indexSubs(ctx, rec, opts) {
  rec.subs = []; rec.skipped = [];
  const seen = opts._seen || new Set();
  seen.add(ctx.root);
  const s = submodules(ctx);
  for (const w of s.skipped) rec.skipped.push(w);
  for (const sub of s.subs) {
    if (seen.has(sub.root)) {
      rec.skipped.push(sub.path + " (a cycle: that repo is taken already)");
      continue;
    }
    let sr;
    try {
      sr = index(sub.root, { home: opts.home, track: opts.track, _seen: seen });
    } catch (e) {
      rec.skipped.push(sub.path + " (" + e + ")");
      continue;
    }
    rec.subs.push({ path: sub.path, root: sub.root, rec: sr });
    for (const g of (sr.subs || []))
      rec.subs.push({ path: sub.path + "/" + g.path, root: g.root, rec: g.rec });
    for (const w of (sr.skipped || [])) rec.skipped.push(sub.path + "/" + w);
  }
}

//  --- the fan-out's open (BEE-065:11) ----------------------------------------
//  On ANY use an index has to be updated: the repo a query fans out over may be
//  read-only, its `<gitdir>/be` never is, and a lane left cold answers silence.

//  BEE-067: the gitdirs whose bring-up already failed in THIS process — the
//  ladder below is silent by design, and a `bee http` fan-out would otherwise
//  repeat the same refusal on every request it serves.  Said once, then quiet.
const FOREIGN_SAID = new Set();
function foreignFailed(ctx, e) {
  if (FOREIGN_SAID.has(ctx.gitdir)) return;
  FOREIGN_SAID.add(ctx.gitdir);
  progress().note("bee: " + ctx.repo + ": index bring-up failed (" + e + ")");
}

//  upForeign(ctx, what) -> one registered repo's index, brought up the passes
//  `bee index` runs (`track: false`, nothing written outside the index dir), or
//  null.  The BEE-065:22 ladder is that bring-up, then a read-only open of the
//  rows already there, then silence: one broken repo never poisons the fan-out.
function upForeign(ctx, what) {
  try {
    const ix = openIndex(ctx.gitdir, fresh(ctx.gitdir));
    try {
      bringUp(ctx, ix, { track: false, what: what });
      //  The query families live off the LINK/SYM round, which `bee index` runs
      //  right here (BEE-007); a commit walk alone would answer with no rows.
      require("./lindex.js").scan(ctx, ix);
      return ix;
    } catch (e) { foreignFailed(ctx, e); try { ix.close(); } catch (e2) {} }
  } catch (e) { foreignFailed(ctx, e); }
  //  An unreadable gitdir or a `be/` unwritable after all: the rows already
  //  there still narrow the grep, and a repo with none simply does not answer.
  if (fresh(ctx.gitdir)) return null;
  try { return openIndex(ctx.gitdir, false, true); } catch (e) { return null; }
}

//  bringUp(ctx, ix, opts) -> the summary record.  The lazy step: the O(1) mark
//  check, then index strictly the commits the index does not hold yet, reading
//  only what it probes and touches (LITE-028:39:~1).  `opts.tip` indexes from an
//  arbitrary commit; no ref names it, so its mark is keyed by its hashlet (BEE-005).
function bringUp(ctx, ix, opts) {
  opts = opts || {};
  const hd = ctx.head, r = ctx.r;
  const tip = (opts.tip && opts.tip !== hd.sha) ? opts.tip : hd.sha;
  const bare = tip !== hd.sha;
  const rec = { repo: ctx.repo, gitdir: ctx.gitdir, ref: bare ? tip : hd.ref,
                tip: tip, tracks: null, tracked: false, origin: null,
                upToDate: false, commits: 0, revs: 0, rows: 0 };
  if (opts.track !== false) {
    //  A linked worktree is a second path over one history, so the registry
    //  line is the original's (BEE-009); bee knows a repo by its path (BEE-001).
    rec.origin = origin(ctx.gitdir);
    const t = track(rec.origin || ctx.repo, opts.home);
    rec.tracks = t.file; rec.tracked = t.added;
  }
  const refHl = bare ? hlOfSha(tip) : hlOfText(hd.ref);
  const st = state(ix);
  //  The watermark is the fast no-op only: the tip it names is already indexed
  //  with everything below it, so there is nothing to scan and nothing to do.
  //  A mark whose tip has no CPAR row is a lie (BEE-061: rows lost under a
  //  surviving mark), so the tip's own done flag is read beside it — one seek.
  if (markSet(ix, refHl).has(hlOfSha(tip)) && st.done.has(hlOfSha(tip))) {
    rec.upToDate = true; return rec;
  }

  const prog = progress();
  //  Past the O(1) no-op there is real walking to do, so `opts.what` — a
  //  fan-out's name for this repo — is said once, before the ticks (BEE-065:23).
  if (opts.what) prog.note(opts.what);
  const w = collect(r, tip, st.done, prog);
  //  The gitlink paths the tip carries, minted once (BEE-006); a repo with no
  //  `.gitmodules` there answers with the empty list and pays nothing per commit.
  const tipC = readCommit(r, tip);
  const subs = tipC === null ? [] : submodulePaths(r, tipC.tree);
  const wr = idxWriter(ix);
  const nw = w.order.length;
  for (const sha of w.order) {
    if (nw > PROG_MIN)
      prog.tick("indexing " + rec.commits + "/" + nw + " commits");
    const m = readCommit(r, sha);
    if (!m) continue;
    rec.commits++;
    const chl = hlOfSha(sha);
    const changed = [];
    const pTrees = m.parents.map((p) => { const pm = readCommit(r, p); return pm ? pm.tree : null; });
    descend(r, m.tree, pTrees, "", changed);
    if (subs.length) subRevs(r, subs, m.tree, pTrees, changed);
    for (const c of changed) rec.revs += emit(wr, st, c, chl) ? 1 : 0;
    //  The mid-commit fault golden: revs sealed, CPAR rows never landed (what an
    //  auto-seal on a full page leaves); the next run re-derives them to nothing.
    if (opts._faultMid !== undefined && rec.commits >= opts._faultMid) {
      wr.seal();
      throw "index: injected mid-commit fault at commit " + rec.commits;
    }
    //  The date is already parsed (the topo tiebreak read it), and it lands
    //  BEFORE the CPAR rows, so the done flag proves it is on disk (BEE-033:32).
    wr.put(hlKey(chl, K_CTS), hlVal(BigInt(m.ats || 0), 0n));
    //  CPAR is the done flag and goes last, since a seal persists a prefix
    //  (LITE-006:55:Rc): one row per parent, a root commit one CPAR_NONE row.
    if (m.parents.length === 0) wr.put(hlKey(chl, K_CPAR), hlVal(CPAR_NONE, 0n));
    for (let i = 0; i < m.parents.length && i < 16; i++)
      wr.put(hlKey(chl, K_CPAR), hlVal(hlOfSha(m.parents[i]), BigInt(i)));
    st.done.add(chl);
    //  The crash-mid-run golden (be/shared/metaidx.js `_crashAfter`): seal what
    //  is written, then die before the mark.  Production never passes this.
    if (opts._faultAfter !== undefined && rec.commits >= opts._faultAfter) {
      wr.seal();
      throw "index: injected fault after " + rec.commits + " commits";
    }
  }
  prog.done();
  wr.seal();
  rec.rows = wr.rows;
  //  The MARK is the last write of the run (DOG-027) and DOG-032's one durable
  //  commit: a lazy bulk run's earlier seals are made good right here.
  ix.put(hlKey(refHl, K_MARK), hlVal(hlOfSha(tip), 0n));
  ix.commit(true);
  rec.rows++;
  if (rec.commits === 0) rec.upToDate = true;   // the tip was indexed, unmarked
  return rec;
}

//  One changed path at one commit -> its rev rows.  Returns false when the rev
//  is already indexed: a re-walk (a dropped mark, a rebase) re-derives the same
//  (path, blob, commit) triple and must not mint a second rev for it.
function emit(wr, st, c, chl) {
  if (c.dir) return emitDir(wr, st, c, chl);            // LITE-044
  loadPath(st, c.phl);              // LITE-028: this path's rows, on first use
  const bhl = hlOfSha(c.blob);
  const pb = (c.phl << 60n) | bhl;
  //  The re-put guard: this path's highest rev already carries this (blob,
  //  commit), so the run that died mid-commit had already sealed it.
  const t = st.top.get(c.phl);
  if (t !== undefined && t.blob === bhl && t.commit === chl) return false;

  let rev = st.next.get(c.phl);
  if (rev === undefined) rev = 0n;
  if (rev >= REV_MAX) return false;             // 2^20-1 is the empty PARS slot
  st.next.set(c.phl, rev + 1n);

  //  PARS are the nearest ancestor revs of P, the rev each parent's blob at P
  //  carries.  B2P is exactly that map, mirrored here for the run.
  const pars = [];
  for (const pblob of c.pblobs) {
    if (pblob === null) continue;
    const pr = st.byPB.get((c.phl << 60n) | hlOfSha(pblob));
    if (pr !== undefined && pars.indexOf(pr) < 0) pars.push(pr);
  }

  //  The FSEG row is minted at rev 0 and put before the rev rows (LITE-011:30:a9),
  //  so a persisted blob row (what the re-put guard reads) proves it landed too.
  if (rev === 0n) { const f = fsegRow(c.path); wr.put(f.key, f.val); }
  wr.put(revKey(c.phl, rev, K_BLOB), hlVal(bhl, 0n));
  wr.put(revKey(c.phl, rev, K_CMMT), hlVal(chl, 0n));
  //  A 4th+ parent rev rides a second PARS row (the val holds three slots).
  for (let i = 0; i < pars.length; i += 3)
    wr.put(revKey(c.phl, rev, K_PARS), parsVal(pars.slice(i, i + 3)));
  wr.put(hlKey(bhl, K_B2P), pathRevVal(c.phl, rev));

  st.byPB.set(pb, rev);
  st.top.set(c.phl, { rev: rev, blob: bhl, commit: chl });
  return true;
}

//  One changed dir at one commit -> its one row (LITE-044:45:5D).  The dir fuse
//  wants the newest commit under the dir and nothing else, so the rev carries
//  the commit alone: no blob (a subtree sha is no blob), no PARS (a dir has no
//  content to fold), no B2P, no FSEG (resolve.js only ever names files).
function emitDir(wr, st, c, chl) {
  loadDir(st, c.phl);
  //  The re-put guard, the file half's `top` read at O(log): a re-walked commit
  //  finds its own row as the path's newest and mints no second rev.
  const t = st.top.get(c.phl);
  if (t !== undefined && t.commit === chl) return false;
  let rev = st.next.get(c.phl);
  if (rev === undefined) rev = 0n;
  if (rev >= REV_MAX) return false;             // 2^20-1 is the empty PARS slot
  st.next.set(c.phl, rev + 1n);
  wr.put(revKey(c.phl, rev, K_CMMT), hlVal(chl, 0n));
  st.top.set(c.phl, { rev: rev, blob: null, commit: chl });
  return true;
}

//  The one-line summary the verb prints, all three halves on it (BEE-007,
//  BEE-024).  A half sitting on its mark says so and costs no words.
function summary(rec) {
  const index = rec.ref + " " + rec.tip.slice(0, 8) + " in " + indexDir(rec.gitdir);
  const lk = rec.link;                     // absent when the half did not run
  const lp = !lk ? null : lk.upToDate ? "links up to date"
           : "scanned " + lk.files + " files, " + lk.links + " links, " +
             lk.rows + " rows";
  //  BEE-024's phrase is the TAIL of either spelling, so the three counting
  //  clauses of BEE-007 keep the shape every reader and test already knows.
  const kv = require("./kv.js").said(rec.kv);
  if (rec.upToDate)
    return "up to date: " + index + (lk && !lk.upToDate ? " — " + lp : "") +
           subsSaid(rec) + kv;
  return "indexed " + rec.commits + " commits, " + rec.revs + " revs, " +
         rec.rows + " rows" + (lp === null ? "" : " — " + lp) + " — " + index +
         subsSaid(rec) + kv;
}

//  What the recursion took and what it passed over, as a tail phrase (BEE-006):
//  a skip is said in words on the one line, never a failure of this run.
function subsSaid(rec) {
  //  A run inside a linked worktree took the original, and says so (BEE-009).
  let s = rec.origin ? ", registered " + rec.origin : "";
  const n = (rec.subs || []).length;
  if (n) s += ", took " + n + " submodule" + (n === 1 ? "" : "s");
  for (const w of (rec.skipped || [])) s += ", skipped " + w;
  return s;
}

//  hl60 -> the 15-hex name ODBHex resolves it by (mtimeidx.js `hexOf`).
function hexOfHl(hl60) { return hl60.toString(16).padStart(15, "0"); }

module.exports = {
  index: index, summary: summary, track: track, repos: repos,
  openIndex: openIndex, openKv: openKv, sweep: sweep,
  //  BEE-065: what a cross-repo query opens a foreign lane with.
  upForeign: upForeign,
  discover: discover, openRepo: openRepo, closeRepo: closeRepo, epoch: epoch,
  //  BEE-063: one (kind, path_hl) span, what every folding reader now takes.
  revSpan: revSpan,
  //  BEE-048: the per-repo tip and the shared lane, both witnessed by fsw.
  repoRev: repoRev, tipTree: tipTree, laneOf: laneOf, laneDown: laneDown,
  laneShared: laneShared, stats: stats,
  //  The linked-worktree tell and the original both doors take (BEE-009).
  linkedWorktree: linkedWorktree, origin: origin, mainOf: mainOf,
  gitdirOf: gitdirOf,
  //  The gitlink half: the walk, the sub list and the dir-rev source (BEE-006).
  subTree: subTree, subPaths: subPaths, submodulePaths: submodulePaths,
  subAt: subAt, subRevs: subRevs, submodules: submodules, subsSaid: subsSaid,
  MODE_SUB: MODE_SUB,
  bringUp: bringUp, reader: reader, readCommit: readCommit, readTree: readTree,
  //  `lindex` reuses the pruning tree diff, the batching writer (LITE-033) and
  //  the tty-only message channel every long pass speaks on (BEE-067).
  descend: descend, idxWriter: idxWriter, progress: progress, 
  //  The dir fuse (view/list.js) reads a dir's newest rev with these (LITE-044).
  lastRev: lastRev, revValAt: revValAt,
  //  Dates off the index alone, no ODB read: commit and blob (BEE-033).
  commitTs: commitTs, blobTs: blobTs,
  //  `diff` reads blob/commit objects straight off the ODB (LITE-010).
  object: object,
  firstLine: firstLine, identTs: identTs, heap: heap, hexOfHl: hexOfHl,
  IDX_DIR: IDX_DIR, IDX_EXT: IDX_EXT, KV_EXT: KV_EXT, IDX_EXTS: IDX_EXTS,
  IDX_BULK_ROWS: IDX_BULK_ROWS, indexDir: indexDir,
  fresh: fresh,
  CPAR_NONE: CPAR_NONE,
  K_BLOB: K_BLOB, K_CMMT: K_CMMT, K_PARS: K_PARS,
  K_CPAR: K_CPAR, K_B2P: K_B2P, K_FSEG: K_FSEG, K_CTS: K_CTS, K_MARK: K_MARK,
  K_SYM: K_SYM,
  REV_MAX: REV_MAX,
  //  The FSEG split, shared with index/resolve.js (LITE-011).
  SEG_SLOTS: SEG_SLOTS, DEPTH_MAX: DEPTH_MAX, segHl: segHl, fnHl: fnHl,
  fsegKey: fsegKey, fsegVal: fsegVal, fsegSeg: fsegSeg, fsegDepth: fsegDepth,
  fsegRow: fsegRow,
  revKey: revKey, hlKey: hlKey, hlVal: hlVal, pathRevVal: pathRevVal,
  parsVal: parsVal, keyKind: keyKind, keyPhl: keyPhl, keyRev: keyRev,
  keyHl60: keyHl60, valHl60: valHl60,
  hashlet60FromBytes: hashlet60FromBytes, hlOfSha: hlOfSha, hlOfText: hlOfText,
  pathHl: pathHl
};
