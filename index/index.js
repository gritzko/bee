//  index/index.js — LITE-006: `quickjab index <repo>`, the LAZY, COMMIT-BASED
//  blob<->path index a git repo keeps in its OWN `<repo>/.git/be/`.
//
//  Everything in `.git/be/` is DERIVED: `rm -rf` it and the next run rebuilds
//  it from the ODB.  Tracked repos are listed in `$HOME/.config/be/tracks`, a
//  plain list of absolute paths.
//
//  ONE unified wh128 run family (`abc.index("wh128", …)` = a dog Pup stack).
//  Six record kinds, the kind nibble in the LOW 4 bits of the key; `path_hl` is
//  the TOP 40 bits of the path's hashlet, blob/commit/ref hashlets are ALWAYS
//  the full 60; `rev` is a per-path arrival-local 20-bit counter.
//
//    1. REV-BLOB  key = path_hl:40|rev:20|BLOB  val = blob_hl:60|vnib:4
//    2. REV-CMMT  key = path_hl:40|rev:20|CMMT  val = commit_hl:60|vnib:4
//    3. REV-PARS  key = path_hl:40|rev:20|PARS  val = par1:20|par2:20|par3:20|vnib:4
//    4. CPAR      key = commit_hl:60|CPAR       val = parent_hl:60|ord:4
//    5. B2P       key = blob_hl:60|B2P          val = path_hl:40|rev:20|vnib:4
//    6. FSEG      key = fn_hl:40|prnt_hl:20|FSEG  val = seg0..seg5:10 each|depth:4
//    7. LINK      key = dst_hl:40|0:20|LINK      val = src path_hl:40|0:20|vnib:4
//    8. MARK      key = ref_hl:60|MARK          val = tip commit_hl:60|vnib:4
//
//  LINK (LITE-033, index/lindex.js) is the one kind this file does not write:
//  it is a separate, equally lazy round over the TIP blobs, and it rides the
//  same lane so `rm -rf .git/be` still rebuilds everything.
//
//  `vnib` is RESERVED (0) everywhere the ruled table does not name a field;
//  CPAR's low nibble is the parent ordinal (first parent = 0), and a ROOT
//  commit's CPAR row carries an EMPTY parent slot (all-ones, the same "empty
//  slot" spelling REV-PARS uses).  One file's log is ONE prefix scan of its
//  `path_hl`: the rows come back rev-ordered oldest-first, each rev naming its
//  blob, its commit and its parent revs — what CFOLD weave folding consumes,
//  with no ODB walk at query time.
//
//  THE LAZY CONTRACT (ruling 2026-08-13: PRESENCE is the boundary, and there
//  is no walk ceiling at all).
//   1. the tip is already this ref's MARK -> no-op, without even a scan;
//   2. else the lane is asked, by KEY, whether it holds a given commit (its
//      CPAR rows) and what state a given path has arrived at (LITE-028);
//   3. walk UP from the tip, never entering a commit in that set.  So each run
//      indexes exactly the commits no run has indexed yet: a history of ANY
//      size converges over successive runs, an INTERRUPTED run keeps every
//      commit it sealed, and a rebase needs no special case (the rewritten
//      commits are simply not in the lane, so they are what gets walked);
//   4. per commit the rev rows go in FIRST and the CPAR rows LAST, because a
//      seal persists a PREFIX of what was put — so a CPAR row on disk proves
//      the commit's rev rows are on disk too, and a kill between them costs a
//      redundant re-walk, never a commit stranded behind a lying boundary;
//   5. data rows are never deleted and re-puts are idempotent: a re-derived
//      rev finds its own (path, blob, commit) triple and writes nothing;
//   6. the MARK row is the run's LAST write (DOG-027).
"use strict";

const refs = require("./refs.js");
const isSha40 = refs.isSha40;

//  The run family lives in the repo's own gitdir.
const IDX_DIR = "be";
const IDX_EXT = ".lite.idx";
//  DOG-032: the INITIAL derive alone opens a big memtable (64Ki wh128 rows =
//  1 MB) and seals lazily — an incremental run puts a handful of rows and keeps
//  the one-page durable default.  The magic 200-row batch is gone: the batch IS
//  the memtable (`ix.mem` rows), so a commit never lands mid-page.
const IDX_BULK_ROWS = 1 << 16;
//  Parsed trees held per run (a tree is immutable, so this only ever hits).
const TREE_CACHE_MAX = 1 << 14;

//  --- the field split -------------------------------------------------------
const K_BLOB = 0x1n, K_CMMT = 0x2n, K_PARS = 0x3n;
const K_CPAR = 0x4n, K_B2P = 0x5n, K_FSEG = 0x6n, K_MARK = 0xFn;

const REV_BITS = 20n, PHL_BITS = 40n;
const REV_MAX = (1n << REV_BITS) - 1n;          // also the empty PARS slot
const PHL_MASK = (1n << PHL_BITS) - 1n;
const HL60_MASK = (1n << 60n) - 1n;
//  Ruling 2026-08-13: the walk stops at commits already in the lane, so EVERY
//  indexed commit must carry a row that says so — and a ROOT commit has no
//  parent to hang a CPAR row on.  It gets ONE CPAR row with an EMPTY parent
//  slot, all-ones, which is the ruled table's own vocabulary for an empty slot
//  (REV-PARS: "empty slot = all-ones").  No new kind, no new record: a CPAR
//  row means "this commit is indexed", and its parent slot may be empty.
const CPAR_NONE = HL60_MASK;

//  path_hl:40 | rev:20 | kind:4
function revKey(phl, rev, kind) { return (phl << 24n) | (rev << 4n) | kind; }
//  hashlet60:60 | kind:4
function hlKey(hl60, kind) { return (hl60 << 4n) | kind; }
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
//  --- LITE-011: FSEG, the partial-path record -------------------------------
//  key = fn_hl:40 | prnt_hl:20 | 6, val = seg0..seg5:10 each ROOT-FIRST | vnib:4.
//  The val is a pure function of the path TEXT — no rev, no commit, no blob —
//  so a row is minted once, re-puts are byte-identical, and nothing invalidates
//  it: it describes a NAME, not a content state.  ROOT-FIRST is load-bearing,
//  it anchors index/resolve.js's descent at the root tree.
const SEG_SLOTS = 6;                              // the val holds the TOP six
const DEPTH_MAX = 15;                             // vnib is 4 bits
const SEG_MASK = (1n << 10n) - 1n;

//  A segment's TOP `bits` hashlet bits; a genuine 0 bumps to 1 so that 0 keeps
//  its ruled meaning — "no parent" / "no such level".
function segHl(name, bits) {
  const h = hlOfText(name) >> (60n - bits);
  return h === 0n ? 1n : h;
}
//  The LAST segment's top 40 bits.  No bump: it names nothing absent.
function fnHl(name) { return hlOfText(name) >> 20n; }

function fsegKey(fn, prnt) { return (fn << 24n) | (prnt << 4n) | K_FSEG; }
function fsegVal(chain, depth) {
  let v = 0n;
  for (let i = 0; i < SEG_SLOTS; i++)
    v = (v << 10n) | (i < chain.length ? chain[i] : 0n);
  return (v << 4n) | BigInt(depth > DEPTH_MAX ? DEPTH_MAX : depth);
}
function fsegSeg(v, i) { return (v >> BigInt(54 - 10 * i)) & SEG_MASK; }
function fsegDepth(v) { return Number(v & 0xfn); }

//  One repo-relative path -> its { key, val }.  A path deeper than SEG_SLOTS is
//  SELF-DECLARING through `vnib`: the chain holds the top 6 and the near tail is
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

function keyKind(k) { return k & 0xfn; }
function keyPhl(k) { return k >> 24n; }
function keyRev(k) { return (k >> 4n) & REV_MAX; }
function keyHl60(k) { return k >> 4n; }
function valHl60(v) { return v >> 4n; }

//  --- hashlets --------------------------------------------------------------
//  hashlet60: the MS 60 bits of a 20-byte sha, big-endian — the JS twin of
//  dog/WHIFF.h whiff_hashlet(s, 15), mirrored from be/shared/util/sha.js.
function hashlet60FromBytes(sha20) {
  let h = 0n;
  for (let i = 0; i < 8; i++) h = (h << 8n) | BigInt(sha20[i]);
  return h >> 4n;
}
function hlOfSha(sha40) { return hashlet60FromBytes(hex.decode(sha40)); }
function hlOfText(s) { return hashlet60FromBytes(sha1(utf8.Encode(s))); }
//  path_hl: the TOP 40 bits of the path's hashlet (the hashlet60 minus its
//  low 20) — the repo-relative path, no leading slash.
function pathHl(path) { return (hlOfText(path) >> 20n) & PHL_MASK; }

//  --- the tracks list -------------------------------------------------------
function readText(path) {
  try {
    const m = io.mmap(path, "r");
    const d = m.data ? m.data() : m;
    return utf8.Decode(d);
  } catch (e) { return null; }
}

//  Append `repo` to `$HOME/.config/be/tracks`, deduped ON READ.  The list is a
//  handful of lines, so the append is a read-modify-write of the whole file.
//  Returns { file, added }.
function track(repo, home) {
  home = home || io.getenv("HOME");
  if (!home) throw "index: there is no HOME, so there is no tracks list";
  const dir = home + "/.config/be";
  const file = dir + "/tracks";
  const old = readText(file);
  const lines = [];
  let have = false;
  for (const raw of (old === null ? "" : old).split("\n")) {
    const t = raw.trim();
    if (t === "" || lines.indexOf(t) >= 0) continue;      // dedup on read
    lines.push(t);
    if (t === repo) have = true;
  }
  if (have) return { file: file, added: false };
  lines.push(repo);
  io.mkdir(dir);
  const fd = io.open(file, "c");
  try { io.writeAll(fd, utf8.Encode(lines.join("\n") + "\n")); }
  finally { io.close(fd); }
  return { file: file, added: true };
}

//  --- the ODB reader --------------------------------------------------------
//  One repo handle plus the per-run memos.  Trees are parsed through the
//  dog/git cursor `git.tree`; commits through `git.parseCommit`.  No git
//  framing is ever read in JS.
function reader(h) {
  return { h: h, trees: new Map(), commits: new Map(), ts: new Map() };
}

//  LITE-007: the name is any 6..40-char HEXLET, so a 15-hex hashlet60 (what the
//  index rows carry) reads exactly like a full sha — ODBHex resolves both.
const HEXLET = /^[0-9a-fA-F]{6,40}$/;
function object(r, name) {
  if (typeof name !== "string" || !HEXLET.test(name)) return null;
  let o;
  try { o = git.getHex(r.h, name); } catch (e) { return null; }
  return o === null ? null : o;
}

//  A tree -> Map(name -> { sha, mode, dir, link }).  Gitlinks (0o160000) are
//  DROPPED: a submodule's commit lives in another ODB, and it is no blob.
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

//  A commit -> { tree, parents[], ts, ats, author, subject } | null.  `ts` is
//  the COMMITTER time (what git orders a log by), `ats` the AUTHOR time (what
//  git and be log DISPLAY).  `name` may be a hashlet (LITE-007's log reads the
//  rows' 15-hex hashlet60s straight through here).
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

//  The epoch seconds off an already-PARSED `author`/`committer` header value
//  ("Name <mail> <secs> <tz>").  dog/git split the object into fields; this
//  only reads the numeric tail of one of them.  0 when it is not there.
function identTs(ident) {
  if (typeof ident !== "string") return 0;
  const m = /(\d+)(?:\s+[+-]\d{4})?\s*$/.exec(ident);
  return m ? Number(m[1]) : 0;
}

//  --- the index handle ------------------------------------------------------
//  `abc.index` io.mkdir()s its dir, so the family CREATES `<gitdir>/be` — that
//  directory is derived state this verb owns, never a store to be conjured.
//  DOG-032: `bulk` opens the from-scratch derive's handle — a 1 MB memtable and
//  lazy seals, finished by the ONE durable commit that writes the mark.
function openIndex(gitdir, bulk) {
  const o = { dir: gitdir + "/" + IDX_DIR, ext: IDX_EXT };
  if (bulk) { o.mem = IDX_BULK_ROWS; o.durable = false; }
  return abc.index("wh128", o);
}

//  Has this repo an index at all?  A dir with no run and no memtable is the
//  from-scratch derive — the one run that wants the big memtable.
function fresh(gitdir) {
  const dir = gitdir + "/" + IDX_DIR;
  try {
    for (const f of io.readdir(dir))
      if (f.length >= IDX_EXT.length && f.slice(-IDX_EXT.length) === IDX_EXT)
        return false;
  } catch (e) { return true; }
  return true;
}

//  Progress for histories over 100 commits: a throttled one-line \r report on
//  STDERR, tty only — piped/captured runs stay byte-identical, plain words.
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
    done: function () { if (on && dirty) { dirty = false; raw("\r\x1b[K"); } }
  };
}

//  A batching writer (be/shared/ingest.js `idxWriter`): the rows put between
//  two commits fit ONE memtable, whatever size it was opened at.  A seal NEVER
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

//  Every MARK val this ref carries.  A wh128 lane is UNKEYED, so a bumped mark
//  is a SECOND row on the same key and nothing in the row says which is newer —
//  which does not matter: the walk stops at ANY of them, and the newest is the
//  one it meets first coming down from the tip.
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
//  The state the walk extends:
//
//    next  : path_hl -> the next free rev
//    byPB  : (path_hl<<60|blob_hl) -> its NEWEST rev   (the PARS lookup)
//    top   : path_hl -> its HIGHEST rev {rev, blob, commit}  (the re-put guard)
//    done  : every INDEXED commit's hashlet60          (THE walk boundary)
//
//  `top` is what is left of the old per-rev (path, blob, commit) guard, and it
//  is now enough: with PRESENCE as the boundary a sealed commit is NEVER walked
//  twice, so the only rev that can be re-derived is one belonging to the commit
//  that was IN FLIGHT when a run died — its rev rows may have been auto-sealed
//  by a full memtable page while its CPAR rows (put last) were not.  That
//  commit's revs are by construction the HIGHEST rev of each path it touched,
//  so one row per PATH catches them, instead of one entry per REV.
//
//  LITE-028: none of it is read WHOLE any more.  A run needs `done` for the
//  commits it PROBES and next/byPB/top for the paths its new commits TOUCH, so
//  both are filled by keyed seeks and memoized for the run — a one-commit
//  catch-up reads a handful of rows instead of the entire history.
//  KNOWN TRAP (be/shared/mtimeidx.js): `range`/`prefix` return ZERO rows when
//  the upper bound reaches 2^64, so every read here MUST ride the seek cursor.

function state(ix) {
  const st = { ix: ix, next: new Map(), byPB: new Map(), top: new Map(),
               have: new Set(), yes: new Set(), no: new Set(), all: false };
  //  An EMPTY lane is fully known after ONE row read — the from-scratch derive
  //  then seeks for nothing, because every row it will ever read is its own.
  if (!ix.seek(0n).next()) st.all = true;
  //  `done` without materializing it: ONE keyed CPAR seek per PROBED commit —
  //  a CPAR row IS the "this commit is indexed" flag, so the probe is the
  //  presence test.  `add` is what the run's own seals contribute.
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

//  ONE path's rows, by the key span its `path_hl` owns: every REV row of the
//  path is in [phl<<24, (phl+1)<<24), so one seek fills next/byPB/top for it.
//  Other kinds hash into that span too (a B2P/FSEG/CPAR key whose top 40 bits
//  land there), so the span is filtered by KIND, never cut short by one.
function loadPath(st, phl) {
  if (st.all || st.have.has(phl)) return;
  st.have.add(phl);
  const c = st.ix.seek(phl << 24n);
  while (c.next()) {
    if (keyPhl(c.key) !== phl) break;
    row(st, c.key, c.val);
  }
}

//  One lane row into the state, the fold the old full pass did per row.
function row(st, k, v) {
  const kind = keyKind(k);
  if (kind === K_CPAR) { st.yes.add(keyHl60(k)); return; }
  if (kind !== K_BLOB && kind !== K_CMMT) return;
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
  const t = st.top.get(phl);                   // BLOB sorts before CMMT per rev
  if (t !== undefined && t.rev === rev) t.commit = valHl60(v);
}

//  --- the commit walk -------------------------------------------------------
//  Ruling 2026-08-13: THERE IS NO WALK CEILING.  The walk climbs from the tip
//  and stops at any commit ALREADY IN THE LANE — presence, not a watermark, is
//  the boundary.  Three things fall out of that:
//   -  a history of any size CONVERGES: each run indexes strictly the commits
//      no run has indexed yet, so the work left shrinks every time;
//   -  an INTERRUPTED run keeps its progress: whatever was sealed is a
//      boundary the next run stops at, and nothing is redone;
//   -  a rebase/reset needs no special case: the rewritten commits are simply
//      not in the lane, so they are exactly what gets walked.
//  The MARK survives as the ruled per-ref watermark and as the O(1) no-op:
//  tip already marked -> answer without even scanning the lane.
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

//  A binary heap on (ts, name) — the ready queue of the Kahn sorts.  `desc`
//  flips it to a MAX-heap, which is LITE-007's newest-first log order.
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

//  ANCESTORS STRICTLY BEFORE DESCENDANTS, commit date as the practical order:
//  Kahn over the in-set parent edges with the ready set drained oldest-FIRST by
//  commit date.  Topology is the hard constraint (clock skew can never put a
//  child ahead of its parent), the date only picks between ready commits.
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
//  A commit yields a NEW REV of path P iff P's blob differs from P's blob in
//  EVERY parent; a subtree whose sha equals the corresponding subtree sha in
//  ANY parent is PRUNED whole — nothing under it can have changed there.
//
//  DOG-030: both tests are now ONE C leaf.  `git.getTreeDiff(h, a, b)` hands
//  back ONLY the entries that differ, in git tree FORMAT — each changed name
//  an adjacent PAIR (the NEW side first, then the OLD one, an all-zero sha
//  spelling "absent on that side").  So a name MISSING from a parent's diff
//  IS the prune, for a blob and for a subtree alike, and the JS work per
//  commit is O(changed) instead of O(dir width).  Merges are one pairwise
//  call per parent, intersected here: present in EVERY parent's diff.
const ZERO40 = "0000000000000000000000000000000000000000";
const MODE_DIR = 0o40000;

//  One (tree, parentTree) diff -> Map(name -> { sha, dir, old, oldDir }).
//  `old` is null when the path is absent on the parent side.  null when the
//  NEW tree is unreadable — what `readTree` returning null used to mean.
function diffMap(r, aSha, bSha) {
  let buf;
  try { buf = git.getTreeDiff(r.h, aSha, bSha || ZERO40); }
  catch (e) { return null; }
  if (buf === null) return null;
  const m = new Map();
  const c = git.tree(buf);
  while (c.next()) {
    const mode = c.mode, sha = c.sha, name = c.str;
    if (!c.next()) break;                       // the OLD half of the pair
    if (sha === ZERO40) continue;               // deleted: no rev of it here
    const osha = c.sha;
    m.set(name, { sha: sha, dir: mode === MODE_DIR,
                  old: osha === ZERO40 ? null : osha,
                  oldDir: c.mode === MODE_DIR });
  }
  return m;
}

//  `pTrees` stays parent-ALIGNED (a null slot = that parent has no tree here),
//  so a rev's PARS come out in the commit's own parent order.
//  Emits { path, phl, blob, pblobs[] } into `out`.
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
      descend(r, e.sha,
              olds.map((s) => (s.old !== null && s.oldDir) ? s.old : null),
              path + "/", out);
      continue;
    }
    out.push({ path: path, phl: pathHl(path), blob: e.sha,
               pblobs: olds.map((s) => (s.old !== null && !s.oldDir)
                                       ? s.old : null) });
  }
}

//  --- the repo -------------------------------------------------------------
//  LITE-007: `git.open` takes a repo root, a `.git` dir or a gitfile and does
//  NOT climb, so a verb invoked from a SUBDIRECTORY climbs here first: the
//  nearest ancestor carrying a `.git`, ceiling `/`.  A plain fs probe, no
//  parsing.  Returns the dir to hand `git.open`, or null.
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

//  openRepo(arg) -> { h, repo, gitdir, root, head, reader }.  `root` is the
//  worktree the paths in the index are relative to (the gitdir's parent for a
//  plain `.git`, else the path we opened).  The caller closes with closeRepo.
function openRepo(arg, climb) {
  let repo = null;
  if (climb) repo = discover(arg);
  else { try { repo = io.realpath(arg); } catch (e) { repo = null; } }
  if (repo === null) throw "index: there is no git repository at " + arg;
  let h;
  try { h = git.open(repo); } catch (e) { throw "index: " + e; }
  const gitdir = h.dir;
  let root = repo;
  if (gitdir.length > 5 && gitdir.slice(-5) === "/.git") root = gitdir.slice(0, -5);
  const hd = refs.head(gitdir);
  if (hd === null) { try { git.close(h); } catch (e) {}
    throw "index: " + repo + " has no HEAD to index"; }
  return { h: h, repo: repo, gitdir: gitdir, root: root, head: hd, r: reader(h) };
}
function closeRepo(ctx) { try { git.close(ctx.h); } catch (e) {} }

//  --- the run ---------------------------------------------------------------
//  index(repoArg, opts) -> the summary record.  `opts.home` overrides the
//  tracks root, `opts.track === false` skips the tracks list (LITE-007's `log`
//  brings the index up to date but must write nothing else), `opts.climb`
//  looks for the repo above the arg.
function index(repoArg, opts) {
  opts = opts || {};
  const ctx = openRepo(repoArg, opts.climb);
  try {
    const ix = openIndex(ctx.gitdir, fresh(ctx.gitdir));
    try { return bringUp(ctx, ix, opts); }
    finally { try { ix.close(); } catch (e) {} }
  } finally { closeRepo(ctx); }
}

//  bringUp(ctx, ix, opts) -> the summary record.  THE lazy step: the O(1) mark
//  check, then index strictly the commits the lane does not hold yet, reading
//  (LITE-028) only the commits it probes and the paths they touch.  `ix` is
//  the caller's open handle, so `log` queries the very rows this just wrote.
function bringUp(ctx, ix, opts) {
  opts = opts || {};
  const hd = ctx.head, r = ctx.r;
  const rec = { repo: ctx.repo, gitdir: ctx.gitdir, ref: hd.ref, tip: hd.sha,
                tracks: null, tracked: false, upToDate: false,
                commits: 0, revs: 0, rows: 0 };
  if (opts.track !== false) {
    const t = track(ctx.repo, opts.home);
    rec.tracks = t.file; rec.tracked = t.added;
  }
  const refHl = hlOfText(hd.ref);
  //  The watermark is the FAST no-op only: the tip it names is already indexed
  //  with everything below it, so there is nothing to scan and nothing to do.
  if (markSet(ix, refHl).has(hlOfSha(hd.sha))) { rec.upToDate = true; return rec; }

  const st = state(ix);
  const prog = progress();
  const w = collect(r, hd.sha, st.done, prog);
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
    for (const c of changed) rec.revs += emit(wr, st, c, chl) ? 1 : 0;
    //  The MID-COMMIT golden: the revs are sealed, the CPAR rows never land —
    //  exactly what an auto-seal on a full memtable page can leave behind.  The
    //  next run must re-walk this commit and re-derive those revs to NOTHING.
    if (opts._faultMid !== undefined && rec.commits >= opts._faultMid) {
      wr.seal();
      throw "index: injected mid-commit fault at commit " + rec.commits;
    }
    //  CPAR is the commit's DONE flag, so it is put LAST — a seal persists a
    //  PREFIX of what was put, so a persisted CPAR row proves every rev row of
    //  this commit was already put and is in this seal or an earlier one.  Put
    //  it first and a kill between the two would strand the commit's revs
    //  forever behind a boundary that says "indexed".
    //  One row per parent, first parent ord 0; a ROOT commit gets the one row
    //  with an EMPTY parent slot, so parentless still reads as PRESENT.
    if (m.parents.length === 0) wr.put(hlKey(chl, K_CPAR), hlVal(CPAR_NONE, 0n));
    for (let i = 0; i < m.parents.length && i < 16; i++)
      wr.put(hlKey(chl, K_CPAR), hlVal(hlOfSha(m.parents[i]), BigInt(i)));
    st.done.add(chl);
    //  The crash-mid-run golden (be/shared/metaidx.js `_crashAfter`): seal what
    //  is written, then die BEFORE the mark.  Production never passes this.
    if (opts._faultAfter !== undefined && rec.commits >= opts._faultAfter) {
      wr.seal();
      throw "index: injected fault after " + rec.commits + " commits";
    }
  }
  prog.done();
  wr.seal();
  rec.rows = wr.rows;
  //  The MARK is the LAST write of the run (DOG-027) and DOG-032's ONE durable
  //  commit: a lazy bulk run's earlier seals are made good right here.
  ix.put(hlKey(refHl, K_MARK), hlVal(hlOfSha(hd.sha), 0n));
  ix.commit(true);
  rec.rows++;
  if (rec.commits === 0) rec.upToDate = true;   // the tip was indexed, unmarked
  return rec;
}

//  ONE changed path at ONE commit -> its rev rows.  Returns false when the rev
//  is already indexed: a re-walk (a dropped mark, a rebase) re-derives the same
//  (path, blob, commit) triple and must NOT mint a second rev for it.
function emit(wr, st, c, chl) {
  loadPath(st, c.phl);              // LITE-028: this path's rows, on first use
  const bhl = hlOfSha(c.blob);
  const pb = (c.phl << 60n) | bhl;
  //  The re-put guard: this path's HIGHEST rev already carries this (blob,
  //  commit), so the run that died mid-commit had already sealed it.
  const t = st.top.get(c.phl);
  if (t !== undefined && t.blob === bhl && t.commit === chl) return false;

  let rev = st.next.get(c.phl);
  if (rev === undefined) rev = 0n;
  if (rev >= REV_MAX) return false;             // 2^20-1 is the empty PARS slot
  st.next.set(c.phl, rev + 1n);

  //  PARS = the nearest ancestor revs of P: the rev each parent's blob at P
  //  carries.  B2P is exactly that map, mirrored here for the run.
  const pars = [];
  for (const pblob of c.pblobs) {
    if (pblob === null) continue;
    const pr = st.byPB.get((c.phl << 60n) | hlOfSha(pblob));
    if (pr !== undefined && pars.indexOf(pr) < 0) pars.push(pr);
  }

  //  LITE-011: the path's FSEG row, minted at its rev 0 — the one commit that
  //  FIRST sees the path — and put BEFORE the rev rows, so a persisted blob row
  //  (what the re-put guard reads) always proves the FSEG row landed too.
  if (rev === 0n) { const f = fsegRow(c.path); wr.put(f.key, f.val); }
  wr.put(revKey(c.phl, rev, K_BLOB), hlVal(bhl, 0n));
  wr.put(revKey(c.phl, rev, K_CMMT), hlVal(chl, 0n));
  //  4th+ parent rev rides a SECOND PARS row (the val holds three slots).
  for (let i = 0; i < pars.length; i += 3)
    wr.put(revKey(c.phl, rev, K_PARS), parsVal(pars.slice(i, i + 3)));
  wr.put(hlKey(bhl, K_B2P), pathRevVal(c.phl, rev));

  st.byPB.set(pb, rev);
  st.top.set(c.phl, { rev: rev, blob: bhl, commit: chl });
  return true;
}

//  The one-line summary the verb prints.
function summary(rec) {
  const tip = rec.tip.slice(0, 8);
  if (rec.upToDate)
    return "up to date: " + rec.ref + " " + tip + " in " + rec.gitdir + "/" + IDX_DIR;
  return "indexed " + rec.commits + " commits, " + rec.revs + " revs, " +
         rec.rows + " rows — " + rec.ref + " " + tip +
         " in " + rec.gitdir + "/" + IDX_DIR;
}

//  hl60 -> the 15-hex name ODBHex resolves it by (mtimeidx.js `hexOf`).
function hexOfHl(hl60) { return hl60.toString(16).padStart(15, "0"); }

module.exports = {
  index: index, summary: summary, track: track, openIndex: openIndex,
  discover: discover, openRepo: openRepo, closeRepo: closeRepo,
  bringUp: bringUp, reader: reader, readCommit: readCommit, readTree: readTree,
  //  LITE-033: `lindex` reuses the pruning tree diff (the changed paths of
  //  mark..tip, each with its NEW blob) and the batching writer, rather than
  //  growing a second walk of its own.
  descend: descend, idxWriter: idxWriter,
  //  LITE-010: `diff` reads blob/commit objects straight off the ODB.
  object: object,
  firstLine: firstLine, identTs: identTs, heap: heap, hexOfHl: hexOfHl,
  IDX_DIR: IDX_DIR, IDX_EXT: IDX_EXT, IDX_BULK_ROWS: IDX_BULK_ROWS,
  fresh: fresh,
  CPAR_NONE: CPAR_NONE,
  K_BLOB: K_BLOB, K_CMMT: K_CMMT, K_PARS: K_PARS,
  K_CPAR: K_CPAR, K_B2P: K_B2P, K_FSEG: K_FSEG, K_MARK: K_MARK,
  REV_MAX: REV_MAX,
  //  LITE-011: the FSEG split, shared with index/resolve.js.
  SEG_SLOTS: SEG_SLOTS, DEPTH_MAX: DEPTH_MAX, segHl: segHl, fnHl: fnHl,
  fsegKey: fsegKey, fsegVal: fsegVal, fsegSeg: fsegSeg, fsegDepth: fsegDepth,
  fsegRow: fsegRow,
  revKey: revKey, hlKey: hlKey, hlVal: hlVal, pathRevVal: pathRevVal,
  parsVal: parsVal, keyKind: keyKind, keyPhl: keyPhl, keyRev: keyRev,
  keyHl60: keyHl60, valHl60: valHl60,
  hashlet60FromBytes: hashlet60FromBytes, hlOfSha: hlOfSha, hlOfText: hlOfText,
  pathHl: pathHl
};
