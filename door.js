//  LITE-045:27 CLI, pager and http must open any target the same way.
//  BEE-003: and in the same AMBIENT — the repo is a field of the target
//  (`index/mount.js`), so a reference resolves where it was WRITTEN, not where
//  the process happens to stand.
"use strict";

const fs = require("view/fs.js");
const mnt = require("index/mount.js");

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
//  BEE-003: every view already takes `opts.from` — the dir its arg resolves
//  against — and defaults it to the cwd.  This is where the AMBIENT fills it
//  in, so no view knows a repo axis was added.
function vopts(opts) {
  const o = {};
  if (opts) for (const k in opts) o[k] = opts[k];
  if (o.from === undefined) {
    const p = mnt.pos();
    if (p !== null && p.repo) o.from = p.repo;
  }
  return o;
}

//  LITE-045:42 one view shape `(arg, opts) -> hunks`, so no caller tells views
//  apart; `opts.full` = no viewport (a pipe), else the view's own row cap.
const VERBS = {
  log: function (arg, opts) { return require("view/log.js").view(arg, vopts(opts)); },
  commit: function (arg, opts) { return require("view/commit.js").commit(arg, vopts(opts)).hunks; },
  diff: function (arg, opts) { return require("view/diff.js").diff(arg, vopts(opts)).hunks; },
  //  LITE-017:40 a `tree` row opens a `blob`, a `list` row a `cat`; pager stays arg-blind.
  list: function (arg, opts) { return require("view/list.js").list(arg, vopts(opts)).hunks; },
  cat:  function (arg, opts) { return require("view/cat.js").cat(arg, vopts(opts)).hunks; },
  //  BEE-050: `cat` with every anchored reference on the page already quoted
  //  under the line that named it — the reading view, where `see` reads one ref.
  cite: function (arg, opts) { return require("view/cite.js").cite(arg, vopts(opts)).hunks; },
  //  BEE-046: `cat` with the wt-vs-HEAD wash on — what a changed status row
  //  opens, and the one view that always answers with the whole file.
  dog:  function (arg, opts) { return require("view/dog.js").dog(arg, vopts(opts)).hunks; },
  //  BEE-022: the quad over the live worktree — the one view that reads the
  //  index and the bytes on disk, not a rev.
  status: function (arg, opts) { return require("view/status.js").status(arg, vopts(opts)).hunks; },
  //  BEE-017: the only view whose arg is a LIST of refs — one chunk each, and
  //  the one CLI door onto a permalink, which had none before it.
  see:  function (arg, opts) { return require("view/see.js").see(arg, vopts(opts)).hunks; },
  //  BEE-025: the ticket board — the one view whose arg is neither a path nor a
  //  rev but a TOPIC or a `Key:Value` filter; its rows click back into `see`.
  todo: function (arg, opts) { return require("view/todo.js").todo(arg, vopts(opts)).hunks; },
  tree: function (arg, opts) { return require("view/tree.js").tree(arg, vopts(opts)).hunks; },
  blob: function (arg, opts) { return require("view/blob.js").blob(arg, vopts(opts)).hunks; }
};

//  BEE-023:25 a `//name/rel` word is a path in the repo `name`, wherever an
//  arg is a path.  The table is WRAPPED rather than edited row by row, so the
//  spelling is read ONCE, here, and no view ever parses a repo name.
for (const k in VERBS) VERBS[k] = rootView(VERBS[k]);

function rootView(fn) {
  return function (arg, opts) {
    const o = {};
    if (opts) for (const k in opts) o[k] = opts[k];
    return fn(rootArg(arg, o), o);
  };
}

//  The arg word by word, a `//name/rel` one replaced by the path it names, its
//  repo taken as `opts.from` (the first such word wins — an arg names its own
//  repo more closely than the context slot does).  A name that resolves nowhere
//  is refused in words, never read as a file called `//name`.
function rootArg(arg, o) {
  if (typeof arg !== "string" || arg.indexOf("//") < 0) return arg;
  const words = arg.split(" ");
  let from = null;
  for (let i = 0; i < words.length; i++) {
    const sp = mnt.splitRooted(words[i]);
    if (sp === null) continue;
    const root = mnt.byName(sp.name);
    if (root === null) throw mnt.noRepo(sp.name);
    words[i] = sp.rel === "" ? root : root + "/" + sp.rel;
    if (from === null) { from = root; o.from = root; }
  }
  return words.join(" ");
}

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
  //  BEE-023:26 `//name/rel` names its repo OUTRIGHT, so a pager click and an
  //  http href on such a reference land there, not in the repo it was read in.
  const rt = mnt.rooted(ref.path);
  if (rt !== null) ref.path = rt.full;
  //  LITE-025:44 a permalink names a commit; the fs alone cannot answer it.
  if (ref.hash) {
    let seat;
    //  BEE-003: a permalink follows in the AMBIENT repo, like every other ref.
    try { seat = require("index/perma.js").follow(ref.path, ref.line, ref.hash,
                                                  rt === null ? mnt.at() : rt.root); }
    catch (e) { return null; }
    if (seat === null) return null;
    if (seat.rels) return { rels: seat.rels, arg: ref.path + ref.tail, tail: ref.tail };
    return { full: seat.full, line: seat.line, col: seat.col,
             lo: seat.lo, hi: seat.hi, note: seat.note };
  }
  //  BEE-003: an ABSOLUTE target is the fs's own answer.  A relative one is a
  //  REFERENCE and goes down the ruled order below — never against the process
  //  cwd, which is no longer the repo; with no ambient at all (the plain CLI)
  //  the cwd is still where a relative arg means to look.
  if ((ref.path.charAt(0) === "/" || mnt.pos() === null) && statOf(ref.path) !== null)
    return { full: ref.path, line: ref.line, col: ref.col };
  //  LITE-024:42 no repo to descend — a bounded worktree walk answers instead.
  let paths = resolvePartial(ref.path);
  if (paths === null) paths = scanPartial(mnt.at(), refNorm(ref.path));
  if (paths.length === 0) return null;
  if (paths.length === 1) return { full: paths[0].full, line: ref.line, col: ref.col };
  return { rels: paths, arg: ref.path + (ref.tail || ""), tail: ref.tail };
}

//  BEE-003: the words a MISS gets (ruling 3).  A reference that no registered
//  repo holds is refused by NAMING WHAT WAS SEARCHED — the useful next move is
//  `bee install` on the repo that owns it, not a bare "cannot open".
function refusal(target) {
  const ref = splitRef(target);
  const names = [], seen = {};
  for (const m of mnt.list()) {
    if (m.prefix !== "" || m.dup || seen[m.name]) continue;
    seen[m.name] = true;
    names.push(m.name);
  }
  const here = mnt.dir();
  return "no registered repo holds " + ref.path + " — searched " +
         (here === null ? "" : here + ", ") + "then " +
         (names.length ? names.length + " registered repos (" + names.join(" ") + ")"
                       : "an EMPTY repo list") +
         "; try `bee install` on the repo that owns it";
}

//  LITE-024:42 refs must click outside git too: bounded BFS, path-suffix match.
//  BEE-008: a ticket code matches on any of its spellings — ONE walk, not six,
//  so the bound stays what it was; the preference order is applied after, on
//  the handful of rows a walk yields.
function scanPartial(root, partial) {
  const tries = refSpellings(partial);
  const rank = function (rel) {
    for (let i = 0; i < tries.length; i++)
      if (rel === tries[i] || rel.endsWith("/" + tries[i])) return i;
    return -1;
  };
  const out = [], q = [""];
  let seen = 0, best = tries.length;
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
      const k = rank(rel);
      if (k < 0) continue;
      if (k < best) { best = k; out.length = 0; }
      if (k === best) out.push({ rel: rel, full: root + "/" + rel });
    }
  }
  out.sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
  return out;
}

//  A ref's segments, empties dropped — `///bee/x.js` and `/x.js` and `x.js` all
//  split the same way; the LEADING slashes are read off the text, not from here.
function refSegs(partial) {
  const out = [];
  for (const s of String(partial).split("/")) if (s !== "" && s !== ".") out.push(s);
  return out;
}

//  BEE-003: a `..` COLLAPSES before anything resolves.  `http.js pageHref`
//  joins the page's own dir into a relative destination — `sub/` + `../doc.rst`
//  — so the text reaching the door carries the climb, while no FSEG row has a
//  `..` segment to match and the fs leg that used to absorb it is now gated on
//  the ambient (`seatOf` below).  A climb PAST the root keeps its `..` and so
//  resolves to nothing, which is the right answer for a ref out of the repo.
function refNorm(partial) {
  const raw = String(partial);
  if (raw.indexOf("..") < 0) return raw;             // the overwhelming case
  const out = [];
  for (const s of refSegs(raw)) {
    if (s !== "..") { out.push(s); continue; }
    if (out.length && out[out.length - 1] !== "..") out.pop(); else out.push(s);
  }
  const head = raw.slice(0, 3) === "///" ? "///" : raw.charAt(0) === "/" ? "/" : "";
  return head + out.join("/");
}

//  Does `pre` (a mount's prefix segments) END with `head`?  This is the leg a
//  partial spanning a mount BOUNDARY needs: `abc/TCP.c` under the mount whose
//  prefix is `dog/abc` is `TCP.c` in that repo (ruling 5's through-the-parent).
function tailEq(pre, head) {
  if (head.length > pre.length) return false;
  const off = pre.length - head.length;
  for (let i = 0; i < head.length; i++) if (pre[off + i] !== head[i]) return false;
  return true;
}

//  --- BEE-008: a TICKET CODE is a STEM, not a filename -----------------------
//  dog/tok/LINK.rl:83 fuses `BEE-002` into an `F` token exactly as it fuses a
//  filename, and the door has resolved that token AS a filename ever since —
//  which never hit, because no file is NAMED `BEE-002`.  LINK.rl:46 already
//  rules that "a ticket code IS a path — `ABC-123` is `ABC-123.mkd` with the
//  ext dropped"; this is that ruling on the resolving side.
const TICKET_SPELLINGS = ["", ".mkd", ".md", ".txt", "/README.mkd", "/README.md"];

//  The ticket code a ref spells, or null.  dog/tok/LINK.rl:70 `code = [A-Z]
//  [A-Z] [A-Z0-9_]* "-" [0-9]{2,}` — a SHAPE test on an ALREADY-FUSED token,
//  never a second recognizer: the lexer said this is a ref, this says which
//  KIND of ref it is.  The all-digits tail is LINK.rl's `keyvoid` in the
//  positive, so `GPL-2`, `GPL-2.0`, `ISO-8859-1` and `KEY-12abc` are no codes;
//  a code that HEADS a path (`BEE-002/x.js`, LINK.rl's `keyed`) is a real path
//  and stays one.
function ticketCode(partial) {
  const s = String(partial);
  const dash = s.indexOf("-");
  if (dash < 2 || s.length - dash < 3 || s.indexOf("/") >= 0) return null;
  for (let i = 0; i < dash; i++) {
    const c = s.charCodeAt(i);
    const up = c >= 65 && c <= 90;
    if (i < 2 ? !up : !(up || (c >= 48 && c <= 57) || c === 95)) return null;
  }
  for (let i = dash + 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  return s;
}

//  BEE-008: the spellings a ticket takes, in PREFERENCE order — [/meta/todo]
//  fixes them: a thin ticket is `TOPIC-123.mkd`, a fat one the DIR
//  `TOPIC-123/` with its `README.mkd`.  The first that resolves wins, so a repo
//  carrying both `.mkd` and `.md` lands on one page instead of the chooser;
//  only a tie WITHIN one spelling (two topics holding `BEE-002.mkd`) is a
//  genuine ambiguity and goes on reaching the chooser.
//  The DIR is reached THROUGH its README: `index/index.js` emitDir mints no
//  FSEG row for a directory and `index/resolve.js` names files only, so a
//  README-less ticket dir has no key to be found by and stays plain text.
function ticketPaths(partial) {
  const code = ticketCode(partial);
  if (code === null) return null;
  const out = [];
  for (const s of TICKET_SPELLINGS) out.push(code + s);
  return out;
}

//  BEE-013: a SLASH-HEADED ref is a POCKET PAGE — `[/wiki/Bro]`, `[/meta/todo]`
//  ([/meta/wiki]: a page is linked bare).  The name carries no extension,
//  exactly as a ticket code carries none, so the SAME six spellings apply: a
//  thin page is `Page.mkd`, a fat one `Page/README.mkd`.  DOG-042 fuses the
//  token; this is that ruling on the resolving side.
//  The slash is DROPPED and the segments are looked up like any other ref's:
//  a leading slash likely means that repo's root, but we do not assume it —
//  we look for such a file (gritzko's ruling 2026-08-16), so a wiki parked
//  under `docs/wiki/` answers `/wiki/Page` as readily as one at the root.
function pagePaths(partial) {
  const s = String(partial);
  const bare = s.charAt(0) === "/" ? s.slice(1) : s;
  const out = [];
  for (const p of TICKET_SPELLINGS) out.push(bare + p);
  return out;
}

//  A ref -> the spellings to TRY, in order: one for an ordinary path, six for a
//  ticket code, six for a pocket page.  Every leg that resolves a partial runs
//  this one scan, so the slash is read in ONE place.
function refSpellings(partial) {
  const s = String(partial);
  if (s.charAt(0) === "/") return pagePaths(s);
  const t = ticketPaths(s);
  return t === null ? [s] : t;
}

//  BEE-031: a mount's lane, up to its tip.  `.git/be` is bee's OWN derived
//  state and bee's to write (gritzko, BEE-031:8), so a reader is never the last
//  to know; an up-to-date lane costs ONE watermark check (index/index.js:879:cn).
//  A lane that will not take a write reopens read-only: stale rows beat no page.
//  BEE-048: and the up-to-date lane is then SHARED for as long as the repo's
//  rev stands — `laneDown` below is what a borrower releases it with.
function laneUp(idx, ctx) {
  return idx.laneOf(ctx, function () {
    let ix = null;
    try {
      ix = idx.openIndex(ctx.gitdir);
      idx.bringUp(ctx, ix, { track: false });
      return ix;
    } catch (e) {
      if (ix !== null) { try { ix.close(); } catch (e2) {} }
      return idx.openIndex(ctx.gitdir, false, true);
    }
  });
}

//  --- BEE-048: one repo's answers, the MISSES too ---------------------------
//  A board page asks ~512 references of every mount and most mounts answer
//  NOTHING — a miss costs the same open as a hit, so it is kept the same way.
//  Keyed by the repo's own rev (index/cache.js armRepo): a touch under one repo
//  drops its answers alone, and the fan-out then skips whole repos outright.
const SEATS = new Map();           // repo root -> { rev, m: Map(key -> rels) }
const SC = { hits: 0, misses: 0 };

//  The live map for this repo, or null when nothing may be remembered.  A
//  moved rev throws the whole map away: no per-entry witness (BEE-027's ruling).
function seatMemo(ctx) {
  if (ctx.rev === null) return null;
  const have = SEATS.get(ctx.root);
  if (have !== undefined && have.rev === ctx.rev) return have.m;
  const m = new Map();
  SEATS.set(ctx.root, { rev: ctx.rev, m: m });
  return m;
}

//  The two flags change what a scan may answer, so they key it with the ref.
function seatKey(partial, anchored, local) {
  return (anchored ? "@" : local ? "L" : ".") + partial;
}

function stats() {
  return { hits: SC.hits, misses: SC.misses, repos: SEATS.size };
}

//  BEE-003: ONE mount's answer, repo-relative paths.  The lookup is FSEG
//  ([LITE-011] `index/resolve.js`, ruling 8) over the mount's own tip, plus the
//  boundary leg above; an ANCHORED ref (a leading `/` — another repo's ROOT) is
//  an exact tree descent instead, never a suffix match.  BEE-031: the lane is
//  brought UP, the mount's GIT side untouched ([BEE-002] is about that half);
//  a repo with NO lane still answers the anchored and boundary legs alone.
//  BEE-008: the ticket spellings are tried INSIDE this one open — one repo, one
//  tip read, one index — so a code answered locally never pays the fan-out.
function inMount(m, partial, anchored, local) {
  const idx = require("index/index.js");
  if (refSegs(partial).length === 0) return [];
  //  BEE-048: the memo sits UNDER the open — `openRepo` is a map lookup on a
  //  warm repo and it is what hands out the rev this is keyed by.
  let ctx = null;
  try { ctx = idx.openRepo(m.root, false); } catch (e) { return []; }
  const memo = seatMemo(ctx);
  const key = seatKey(partial, anchored, local);
  if (memo !== null) {
    const hit = memo.get(key);
    if (hit !== undefined) { SC.hits++; return hit.slice(); }
  }
  SC.misses++;
  const out = mountScan(idx, ctx, m, partial, anchored, local);
  if (memo !== null) memo.set(key, out.slice());
  return out;
}

//  The scan itself, run only on a memo miss: the tip's tree, the lane and the
//  FSEG lookup per spelling.
function mountScan(idx, ctx, m, partial, anchored, local) {
  const rd = require("index/read.js");
  const pre = m.prefix ? m.prefix.split("/") : [];
  const out = [];
  const tries = anchored ? [String(partial)] : refSpellings(partial);
  let ix = null;
  try {
    const tree = idx.tipTree(ctx);
    if (tree === null) return out;
    const at = function (rel) {
      if (rel === "") { out.push(""); return; }
      if (rd.entryAt(ctx.r, tree, rel) !== null) out.push(rel);
    };
    //  BEE-031: the AMBIENT repo's lane always came up; a FOREIGN one now does
    //  too, but only when it exists — `fresh` is the kernel-clone guard.
    if (!anchored && (local || !idx.fresh(ctx.gitdir))) ix = laneUp(idx, ctx);
    const rsv = require("index/resolve.js");
    for (const t of tries) {
      const segs = refSegs(t);
      //  The boundary: the ref's first k segments spelled the mount's own tail.
      for (let k = anchored ? pre.length : 1; k <= segs.length && k <= pre.length; k++)
        if (tailEq(pre, segs.slice(0, k))) at(segs.slice(k).join("/"));
      if (anchored) { if (pre.length === 0) at(segs.join("/")); }
      else if (ix !== null)
        for (const p of rsv.resolve(ix, ctx.r, tree, t)) out.push(p);
      if (out.length) break;              // BEE-008: first spelling that answers
    }
  } catch (e) { return out; }
  finally {
    idx.laneDown(ix);                     // BEE-048: a no-op for a shared lane
    idx.closeRepo(ctx);
  }
  return out;
}

//  LITE-011:47 a partial path resolves at HEAD, from the repo ROOT.
//  BEE-003: in ONE fixed order (ruling 3) — the DIR of the file being read,
//  then the ambient repo at HEAD, then every registered repo (submodules
//  recursed, [BEE-006]).  The first leg that answers wins; several answers
//  within a leg ARE the answer and land in the chooser (ruling 4), deduped by
//  realpath so one file reached through two mounts is ONE row.
//  null = there is no repo here at all (the caller may fs-scan); [] = a miss.
function resolvePartial(partial) {
  const idx = require("index/index.js");
  const path = refNorm(partial);                 // BEE-003: the `..` climb, once
  const auth = path.slice(0, 3) === "///";       // `///bee/x.js`: the repo NAMED
  //  BEE-013: a slash-headed ref is a POCKET PAGE, resolved by its SEGMENTS
  //  like any other ref — only `///name` (auth) descends a repo root exactly.
  const page = !auth && path.charAt(0) === "/";
  const out = [], seen = new Set();
  //  A row is `{ rel, full, repo }`: the CANONICAL spelling when a registered
  //  repo holds it — its name plus the path under that repo's root, so a
  //  submodule file reads through its parent — else the mount-relative one, and
  //  no repo name at all.  Deduped by REALPATH: one file reached through two
  //  mounts (or through a symlinked tree) is ONE row (ruling 4).
  const add = function (m, full) {
    let real = full;
    try { real = io.realpath(full); } catch (e) {}
    if (seen.has(real)) return;
    seen.add(real);
    const c = mnt.canon(real);
    if (c !== null) {
      out.push({ rel: c.rel === "" ? "." : c.rel, full: real, repo: c.mount.name });
      return;
    }
    const pre = m === null ? null : m.root + "/";
    const rel = pre !== null && real.slice(0, pre.length) === pre
              ? real.slice(pre.length) : real;
    out.push({ rel: rel, full: real, repo: "" });
  };
  const mounts = mnt.mounts();
  //  BEE-011: the repo NAME then the path under its root — an exact descent, no
  //  suffix match.  `///bee/x.js` spells it outright; `bee/x.js` reaches it below.
  const named = function (segs) {
    const m = mnt.named(segs[0]);
    if (m === null) return false;
    for (const rel of inMount(m, "/" + segs.slice(1).join("/"), true))
      add(m, rel === "" ? m.root : m.root + "/" + rel);
    return true;
  };
  //  `///name/...` names its repo outright — the registry IS the mount table.
  if (auth) {
    if (!named(refSegs(path))) return [];
    return out;
  }
  //  1. the DIR OF THE FILE BEING READ — the leg that was missing.
  //  BEE-008: the ticket spellings here are plain stats, first hit wins.
  const here = mnt.dir();
  if (here !== null) for (const t of refSpellings(path))
    if (statOf(here + "/" + t) !== null) { add(null, here + "/" + t); break; }
  if (out.length) return out;
  //  2. the ambient repo at HEAD, with its own mount prefix.
  const root = idx.discover(mnt.at());
  if (root === null && !page) return null;       // no repo: the caller fs-scans
  let self = null;
  if (root !== null) {
    for (const m of mounts) if (m.root === root) { self = m; break; }
    if (self === null) self = { name: mnt.basename(root), root: root, prefix: "" };
    for (const rel of inMount(self, path, false, true))
      add(self, rel === "" ? self.root : self.root + "/" + rel);
    if (out.length) return out;
  }
  //  3. every registered repo, submodules recursed.
  for (const m of mounts) {
    if (self !== null && m.root === self.root) continue;
    for (const rel of inMount(m, path, false))
      add(m, rel === "" ? m.root : m.root + "/" + rel);
  }
  //  4. BEE-011: the PROJECT-PREFIXED reading, last — a plain partial that
  //  answers keeps its answer, so no ref resolving today changes where it goes.
  if (!out.length && !page) {
    const segs = refSegs(path);
    if (segs.length > 1) named(segs);
  }
  //  5. BEE-013: PEEL THE HEAD.  A ref may carry leading segments that name
  //  nothing in any tree — a repo name, a project dir, a `public_html`, a
  //  submodule spelled from its parent — and we do not know what counts as a
  //  ROOT in any given context (gritzko's ruling 2026-08-16), so we assume
  //  none: drop one leading segment at a time and take the first TAIL that
  //  answers.  `/quickjab/dog/abc/TCP.c` is bogus as a path and opens anyway.
  //  Last of all, and only on a total miss, so nothing that resolves today
  //  moves; the page-ness rides along, so a peeled page keeps its spellings.
  //  The tail keeps at least TWO segments: a bare basename is too weak to
  //  vouch for a head nobody recognised, and peeling down to one would revive
  //  every dead climb (`../nowhere/q.txt` must stay dead) and turn a unique
  //  miss into a chooser full of same-named files.
  if (!out.length) {
    const segs = refSegs(path);
    const head = page ? "/" : "";
    for (let i = 1; i + 1 < segs.length; i++) {
      const sub = resolvePartial(head + segs.slice(i).join("/"));
      if (sub !== null && sub.length) return sub;
    }
  }
  return out;
}

//  dog/tok/LINK.rl:76 the byte before a `:line(:col)?` anchor, or -1 if none.
function digitTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  for (let k = i + 1; k < s.length; k++)
    if (s.charCodeAt(k) < 0x30 || s.charCodeAt(k) > 0x39) return -1;
  return i;
}

//  dog/tok/LINK.rl:94 the byte before a `:line:hashlet` permalink anchor, or -1.
//  BEE-019:58: segment 1 is DIGITS now, so an old `:1Jz:mJpI` is no anchor and
//  the ref lands on the file — the corpus is migrated, not read both ways.
function permaTail(s) {
  const i = s.lastIndexOf(":");
  if (i <= 0 || i === s.length - 1) return -1;
  const j = s.lastIndexOf(":", i - 1);
  if (j <= 0 || j === i - 1) return -1;
  const pm = require("index/perma.js");
  return pm.isHashlet(s.slice(i + 1)) && pm.isLine(s.slice(j + 1, i)) ? j : -1;
}

//  core/Link.mkd:9 split a ref into path + anchor (line/col or line/hash).
function splitRef(target) {
  const p = permaTail(target);
  if (p >= 0) {
    const k = target.indexOf(":", p + 1);
    return { path: target.slice(0, p), tail: target.slice(p), col: 0,
             line: Number(target.slice(p + 1, k)), hash: target.slice(k + 1) };
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

//  BEE-003: the ambient a FILE puts a view in — its own repo and its own path,
//  which is what makes ruling 3's first leg (the dir of the file being read)
//  possible at all.  A path in no repo positions at its own dir.
//  A TRAILING SLASH names the dir itself, so a caller with only a dir in hand
//  (the pager's `_viewDir`) needs no second entry point.
function posOf(full, anchor) {
  let p = String(full);
  const isDir = p.length > 1 && p.slice(-1) === "/";
  if (isDir) p = p.slice(0, -1);
  let real = p;
  try { real = io.realpath(p); } catch (e) {}
  const root = mnt.deepest(real);
  if (root === null) {
    const cut = real.lastIndexOf("/");
    return { repo: isDir ? real : (cut <= 0 ? "/" : real.slice(0, cut)), path: "",
             anchor: anchor || "" };
  }
  const rel = real.length > root.length ? real.slice(root.length + 1) : "";
  return { repo: root, path: rel === "" ? "" : rel + (isDir ? "/" : ""),
           anchor: anchor || "" };
}

//  A target with an arg is a verb line, anything else a reference — so a file
//  merely NAMED `log` still opens as the file.
//  BEE-003: `pos` is the AMBIENT the target is read FROM — the pager hands the
//  view it clicked in, http the page it painted; without one the cwd stands.
function openTarget(target, pos) {
  if (typeof pos === "string") pos = pos === "" ? null : posOf(pos);
  if (pos !== undefined && pos !== null)
    return mnt.within(pos, function () { return openTarget(target); });
  const sp = target.indexOf(" ");
  const fn = sp > 0 ? VERBS[target.slice(0, sp)] : null;
  if (!fn) {
    const seat = seatOf(target);
    //  BEE-003: a miss has WORDS to it (`refusal`, ruling 3), but three pty
    //  suites pin the pager's bare "cannot open <ref>", so nothing throws them
    //  here — the caller asks for them.
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
  //  BEE-003: the repo axis — the ambient a target is read from, and the words
  //  a miss gets.
  posOf: posOf, refusal: refusal, resolvePartial: resolvePartial,
  //  BEE-008: a ticket code is a stem — the one scan every leg resolves by.
  ticketCode: ticketCode, ticketPaths: ticketPaths, refSpellings: refSpellings,
  stats: stats,                          // BEE-048: the per-repo seat memo's

  pagePaths: pagePaths,                  // BEE-013: a pocket page's spellings
  refNorm: refNorm,
};
