//  index/hook.js — LITE-026: the git PRE-COMMIT pass that MINTS permalinks.
//  `file.c:12:24` is what humans and compilers write; committed text is where
//  it rots.  A commit is the last moment the ref is still current AND the first
//  moment every blob's hash is known (the commit id is not — which is why the
//  [LITE-025] hashlet is blob-only), so the upgrade rides the commit.
//
//  THE PASS
//   1. the paths this commit CHANGES, with the blob the index holds for each —
//      read off git, because lite has no `.git/index` reader and a pre-commit
//      hook is exactly where the index is the truth;
//   2. per changed file, one HEAD->staged fold: a token ALIVE in the staged
//      blob that the HEAD side does not carry is ADDED TEXT, and an added token
//      tagged `F` is a fresh reference — the DOG-034 lexer fuses `path:12:24`
//      into that one token, so nothing here re-scans raw bytes;
//   3. the ref's path resolves through the LITE-011 descent (the commit's own
//      new files first, they are in no tree yet); TWO answers is an ambiguity
//      the hook never guesses through;
//   4. the target's blob is its STAGED one when this commit changes it, HEAD's
//      otherwise; the line:col becomes a byte offset in exactly that blob and
//      the blob's id becomes the hashlet, extended against the path's own
//      other blobs ([LITE-025] scope: one file, never the repository);
//   4a. [LITE-027] a hashlet names its target's FINAL bytes, so the carriers are
//      minted in TOPOLOGICAL order — every target before anything naming it;
//   5. the rewrite lands in the INDEX — `hash-object -w` then `update-index`,
//      never the working file used as a proxy for what a commit takes — and the
//      working file then gets the SAME upgrades ref for ref, so an unstaged
//      diff never shows a meaningless link-form difference.
//
//  THE FIRST COMMIT mints too: a repo with no HEAD has nothing to index and no
//  blob history to extend a hashlet against, but EVERY path in it is staged, so
//  the staged set answers every ref by itself and the empty tree is the base.
//
//  LEFT ALONE, NEVER GUESSED: a path nothing answers, a path several files
//  answer, a line past the end of the target, and a ref on a LINK CYCLE — two
//  files naming each other's text have no final bytes to name, the self-link
//  ([LITE-025]) being that cycle of one.  Only those refs degrade; the rest of
//  the commit mints.
"use strict";

const idx = require("./index.js");
const rd = require("./read.js");
const pm = require("./perma.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

const TAG_F = 0x46;                                //  the lexer's `F` anchor
const TOK32_F = TAG_F - 65;                        //  the same tag in a tok32

//  --- bytes ------------------------------------------------------------------
function readFile(path) {
  let st;
  try { st = io.lstat(path); } catch (e) { return null; }
  if (st.kind !== "reg") return null;
  if (st.size === 0) return new Uint8Array(0);
  try { const m = io.mmap(path, "r"); return m.data ? m.data() : m; }
  catch (e) { return null; }
}

function writeFile(path, bytes) {
  let fd;
  try { fd = io.open(path, "c"); }
  catch (e) { throw "hook: cannot write " + path + " (" + e + ")"; }
  try {
    const b = io.buf(bytes.length + 8);
    b.feed(bytes);
    io.writeAll(fd, b);
  } finally { try { io.close(fd); } catch (e) {} }
}

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

//  --- the child --------------------------------------------------------------
//  Run a child to completion; -> its exit code (a signal death answers
//  128 + signal, as a shell does).
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { throw "hook: cannot run " + argv[0] + " (" + e + ")"; }
  const rc = io.reap(pid);
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

//  The same, with stdout on a scratch file — the runtime's io has no pipe, and
//  the hook asks git exactly one question.  null = the child failed.
function capture(argv, tmp) {
  let rc, fd;
  try { fd = io.open(tmp, "c"); }
  catch (e) { throw "hook: cannot write " + tmp + " (" + e + ")"; }
  try {
    let pid;
    try { pid = io.spawnFds(argv[0], argv, -1, fd); }
    catch (e) { throw "hook: cannot run " + argv[0] + " (" + e + ")"; }
    const r = io.reap(pid);
    rc = r.signal != null ? 128 + r.signal : (r.code | 0);
  } finally { try { io.close(fd); } catch (e) {} }
  const out = rc === 0 ? readFile(tmp) : null;
  try { io.unlink(tmp); } catch (e) {}
  return out === null ? null : utf8.Decode(out);
}

function allZero(s) {
  if (s.length === 0) return true;
  for (let i = 0; i < s.length; i++) if (s[i] !== "0") return false;
  return true;
}

//  --- what this commit changes ----------------------------------------------
//  git's EMPTY TREE — the baseline a repo with no HEAD diffs against, so on the
//  FIRST commit every staged path reads as added.  git knows this object
//  without anyone having written it.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

//  -> Map rel -> the staged blob id, for every path whose staged blob differs
//  from HEAD's.  `-z` throughout, so a path with a tab or a quote in it reads
//  back verbatim.  A deletion (no new blob) and an unmerged slot are skipped.
function stagedFiles(ctx) {
  const tmp = ctx.gitdir + "/lite-hook." + io.getpid();
  const text = capture(["git", "-C", ctx.root, "diff-index", "--cached", "--raw",
                        "-z", ctx.head === null ? EMPTY_TREE : ctx.head.sha], tmp);
  if (text === null) return null;
  //  `:<mode> <mode> <old> <new> <status>\0<path>\0` (no -M, so no renames).
  const out = new Map(), parts = text.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i], rel = parts[i + 1];
    if (meta.length === 0 || meta[0] !== ":") continue;
    const f = meta.slice(1).split(" ");
    if (f.length < 5 || allZero(f[3])) continue;
    out.set(rel, { sha: f[3], mode: f[1] });
  }
  return out;
}

//  --- the two sides of a file ------------------------------------------------
function headEntry(ctx, rel) {
  if (!(ctx.head && ctx.head.sha)) return null;
  const m = idx.readCommit(ctx.r, ctx.head.sha);
  if (m === null) return null;
  const e = rd.entryAt(ctx.r, m.tree, rel);
  return e === null || e.dir ? null : e;
}

function blobOf(ctx, sha) {
  const o = sha ? idx.object(ctx.r, sha) : null;
  return o === null || o.type !== "blob" ? null : o.bytes;
}

//  --- the fresh refs ---------------------------------------------------------
//  The `F` tokens of the staged blob that the HEAD blob does not carry, in
//  order, each as { lo, hi, path, line, col } over the STAGED bytes.
function freshRefs(rel, was, now) {
  const out = [];
  const split = require("main.js").splitRef;       // the ONE ref split point
  pm.walkNew(was, now, wv.extOf(rel), function (t, lo, hi, fresh) {
    if (!fresh || t.tag !== TAG_F) return;
    const sp = split(utf8.Decode(t.text));
    //  already a permalink, or no all-digit anchor at all: nothing to mint.
    if (sp.hash || !(sp.line >= 1) || sp.path === "") return;
    out.push({ lo: lo, hi: hi, path: sp.path, line: sp.line, col: sp.col });
  });
  return out;
}

//  --- the target -------------------------------------------------------------
//  A ref's path -> the ONE repo-relative file it names, or null.  The commit's
//  own new files answer first (no tree carries them yet), then the LITE-011
//  descent at HEAD.  Several answers = an ambiguity, and the hook never guesses.
//  On the FIRST commit the staged set IS the whole tree, so it answers alone —
//  the descent has nothing to add and there is no index to ask.
function targetOf(ctx, ix, staged, partial) {
  const q = rs.split(partial);
  if (q === null) return null;
  const hits = [];
  for (const rel of staged.keys()) if (rs.tailMatches(rel, q.segs)) hits.push(rel);
  if (ctx.head && ctx.head.sha)
    for (const rel of rs.resolveAt(ctx, ix, ctx.head.sha, partial))
      if (hits.indexOf(rel) < 0) hits.push(rel);
  return hits.length === 1 ? hits[0] : null;
}

//  One ref -> its permalink spelling, or null when it is left alone.  The path
//  is kept AS WRITTEN — only the anchor segments change.  `ref.dst` is the file
//  the path answered to, resolved once before any rewrite ran.
function mintRef(ctx, ix, images, ref) {
  const rel = ref.dst;
  if (rel === null) return null;
  const own = images.has(rel);
  const bytes = own ? images.get(rel) : blobOf(ctx, (headEntry(ctx, rel) || {}).sha);
  if (bytes === null || bytes === undefined) return null;
  const off = pm.byteAt(bytes, ref.line, ref.col);
  if (off < 0) return null;                              // no such line there
  const sha = own ? pm.blobIdOf(bytes) : headEntry(ctx, rel).sha;
  //  On the FIRST commit the scope degenerates to that ONE staged blob: no
  //  history to collide with, so the minimum hashlet always names it.
  const h = pm.mintHashlet(sha, ix === null ? [] : pm.blobHistory(ctx, ix, rel));
  if (h === null) return null;
  return ref.path + ":" + pm.packOffset(off) + ":" + h;
}

//  The staged bytes of one file with every mintable ref replaced; `bytes` is
//  null when none of them minted.  Ascending order, so the splice needs no
//  re-indexing.  `subs` maps each ref AS WRITTEN to its permalink — what the
//  working copy is upgraded by, so the two halves say exactly the same thing.
//  A ref whose target sits in the carrier's OWN component is on a cycle: it has
//  no final bytes to name, so it stays `line:col`.  `stuck` counts only the
//  REAL cycles — a component of one is the self-link, silent and expected.
function rewrite(ctx, ix, images, comp, rel, src, refs) {
  const parts = [], subs = new Map();
  let at = 0, minted = 0, stuck = 0;
  const mine = comp.get(rel);
  for (const ref of refs) {
    if (ref.dst !== null && comp.get(ref.dst) === mine) {
      if (mine.length > 1) stuck++;
      continue;
    }
    const s = mintRef(ctx, ix, images, ref);
    if (s === null) continue;
    parts.push(src.slice(at, ref.lo));
    parts.push(utf8.Encode(s));
    subs.set(utf8.Decode(src.slice(ref.lo, ref.hi)), s);
    at = ref.hi;
    minted++;
  }
  if (minted === 0) return { bytes: null, minted: 0, subs: null, stuck: stuck };
  parts.push(src.slice(at));
  return { bytes: concat(parts), minted: minted, subs: subs, stuck: stuck };
}

//  --- the link graph ---------------------------------------------------------
//  [LITE-027] Carrier -> target edges, over the files this commit REWRITES: a
//  target no rewrite touches is already final and is no edge at all.  Tarjan
//  answers with the strongly connected components in SINK-FIRST order — which is
//  exactly the mint order, every target settled before anything naming it — and
//  a component of more than one file is a link cycle.  A self-link puts a file
//  in its own component with an edge to itself, so both cases read the same:
//  carrier and target in ONE component means the ref cannot be minted.
//  -> [[rel, ...], ...], sinks first.
function components(nodes, edges) {
  const seen = new Map(), low = new Map(), on = new Set();
  const path = [], out = [];
  let clock = 0;
  for (const root of nodes) {
    if (seen.has(root)) continue;
    const work = [{ v: root, i: 0 }];
    while (work.length) {
      const fr = work[work.length - 1], v = fr.v;
      if (fr.i === 0) { seen.set(v, clock); low.set(v, clock); clock++; path.push(v); on.add(v); }
      const es = edges.get(v) || [];
      let down = false;
      while (fr.i < es.length) {
        const w = es[fr.i++];
        if (!seen.has(w)) { work.push({ v: w, i: 0 }); down = true; break; }
        if (on.has(w) && seen.get(w) < low.get(v)) low.set(v, seen.get(w));
      }
      if (down) continue;
      if (low.get(v) === seen.get(v)) {
        const c = [];
        for (;;) { const w = path.pop(); on.delete(w); c.push(w); if (w === v) break; }
        out.push(c);
      }
      work.pop();
      if (work.length) {
        const p = work[work.length - 1].v;
        if (low.get(v) < low.get(p)) low.set(p, low.get(v));
      }
    }
  }
  return out;
}

//  --- the write-back ---------------------------------------------------------
//  Store the rewritten bytes as a blob and point the INDEX entry at them.
//  `--no-filters`: these bytes already ARE index-side content (they came off the
//  ODB), so no clean filter may run over them a second time.
function stageBytes(ctx, rel, mode, bytes) {
  const tmp = ctx.gitdir + "/lite-hook.blob." + io.getpid();
  writeFile(tmp, bytes);
  const out = capture(["git", "-C", ctx.root, "hash-object", "-w", "--no-filters",
                       "--", tmp], tmp + ".id");
  try { io.unlink(tmp); } catch (e) {}
  if (out === null) return false;
  const id = out.split("\n")[0].trim();
  if (id.length !== 40) return false;
  return run(["git", "-C", ctx.root, "update-index", "--cacheinfo",
              mode + "," + id + "," + rel]) === 0;
}

//  The SAME upgrades over the WORKING file: an `F` token that IS one of the refs
//  just minted becomes its permalink, wherever it sits in the dirty content;
//  every other byte, the unstaged edits included, is untouched.  Token equality,
//  never a substring hunt — `FSW.c:9` is a prefix of `FSW.c:90`.
//  A ref that exists ONLY on disk was not part of this commit: it waits its turn.
function applySubs(bytes, ext, subs) {
  if (!subs || subs.size === 0) return null;
  let toks;
  try { toks = tok.parse(bytes, ext); } catch (e) { return null; }
  const parts = [];
  let at = 0, hit = 0;
  for (let i = 0; i < toks.length; i++) {
    if (((toks[i] >>> 27) & 0x1f) !== TOK32_F) continue;
    const lo = i > 0 ? (toks[i - 1] & 0xffffff) : 0, hi = toks[i] & 0xffffff;
    if (lo < at) continue;
    const s = subs.get(utf8.Decode(bytes.slice(lo, hi)));
    if (s === undefined) continue;
    parts.push(bytes.slice(at, lo));
    parts.push(utf8.Encode(s));
    at = hi;
    hit++;
  }
  if (hit === 0) return null;
  parts.push(bytes.slice(at));
  return concat(parts);
}

//  --- the pass ---------------------------------------------------------------
//  The handle openRepo builds, MINUS its HEAD gate — a repo with no commits has
//  no HEAD to index, and the FIRST commit needs only the ODB and the two paths.
//  `head` is null, which every leg below reads as "the empty tree is the base".
//  openRepo itself is shared by every verb and stays as it is.
function openUnborn(arg) {
  let repo = null;
  try { repo = io.realpath(arg); } catch (e) { return null; }
  let h;
  try { h = git.open(repo); } catch (e) { return null; }
  const gitdir = h.dir;
  const root = gitdir.length > 5 && gitdir.slice(-5) === "/.git"
             ? gitdir.slice(0, -5) : repo;
  return { h: h, repo: repo, gitdir: gitdir, root: root, head: null,
           r: idx.reader(h) };
}

function precommit(repoArg) {
  const arg = repoArg === undefined ? io.cwd() : repoArg;
  let ctx = null, why = "";
  try { ctx = idx.openRepo(arg); }
  catch (e) { why = "" + e; ctx = openUnborn(arg); }   // no HEAD: the first commit
  //  Not a repository at all.  A hook never blocks a commit over its own
  //  limits: it says so, in plain words, and stands back.
  if (ctx === null) return "lite: no permalinks minted — " + why;
  try {
    const staged = stagedFiles(ctx);
    if (staged === null) throw "hook: git could not say what is staged for commit";
    if (staged.size === 0) return "";
    //  No HEAD: nothing to index and no blob history to extend a hashlet
    //  against — but everything is STAGED, so the staged set answers for itself.
    if (ctx.head === null) return pass(ctx, null, staged);
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });
      return pass(ctx, ix, staged);
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
}

function pass(ctx, ix, staged) {
  //  The staged bytes, and the fresh refs each one carries.
  const base = new Map(), cands = new Map();
  for (const [rel, st] of staged) {
    const now = blobOf(ctx, st.sha);
    if (now === null) continue;
    base.set(rel, now);
    const he = headEntry(ctx, rel);
    const was = he === null ? new Uint8Array(0) : blobOf(ctx, he.sha);
    if (was === null) continue;
    const refs = freshRefs(rel, was, now);
    if (refs.length) cands.set(rel, refs);
  }
  if (cands.size === 0) return "";

  //  Every ref's target, resolved ONCE: the answer is a question about paths,
  //  not about bytes, so no rewrite can change it.  Edges only to carriers.
  const edges = new Map();
  for (const [rel, refs] of cands) {
    const es = [];
    for (const ref of refs) {
      ref.dst = targetOf(ctx, ix, staged, ref.path);
      if (ref.dst !== null && cands.has(ref.dst) && es.indexOf(ref.dst) < 0) es.push(ref.dst);
    }
    edges.set(rel, es);
  }
  const comps = components(cands.keys(), edges), comp = new Map();
  for (const c of comps) for (const rel of c) comp.set(rel, c);

  //  One pass, targets first: when a carrier's turn comes every file it names
  //  is already final in `images`, so nothing minted here is ever re-minted.
  const images = new Map(base), subs = new Map(), stuck = [];
  let minted = 0;
  for (const c of comps) for (const rel of c) {
    const r = rewrite(ctx, ix, images, comp, rel, base.get(rel), cands.get(rel));
    if (r.stuck) stuck.push(rel);
    if (r.bytes === null) continue;
    images.set(rel, r.bytes);
    subs.set(rel, r.subs);
    minted += r.minted;
  }
  //  A cycle costs its own refs, never the commit: they keep the `line:col`
  //  form the author typed and the hook says which files that happened in.
  const note = stuck.length === 0 ? ""
    : "lite: links naming text that names them back stay as line:col in " +
      stuck.join(", ");
  if (minted === 0) return note;

  //  The STAGED content is what a commit takes, so the rewrite lands in the
  //  INDEX — never through the working file as a proxy for it.  The working
  //  file then gets the SAME upgrades ref for ref, so the unstaged diff never
  //  shows a meaningless link-form difference.
  const done = [];
  for (const [rel, bytes] of images) {
    if (wv.bytesEq(bytes, base.get(rel))) continue;
    if (!stageBytes(ctx, rel, staged.get(rel).mode, bytes))
      throw "hook: git would not stage the upgraded " + rel;
    done.push(rel);
    const full = ctx.root + "/" + rel;
    const wt = readFile(full);
    if (wt === null) continue;
    //  In lockstep with the index it IS the rewritten content; dirty, only the
    //  refs move and every unstaged byte around them stays put.
    if (wv.bytesEq(wt, base.get(rel))) { writeFile(full, bytes); continue; }
    const up = applySubs(wt, wv.extOf(rel), subs.get(rel));
    if (up !== null) writeFile(full, up);
  }
  if (done.length === 0) return note;
  return "lite: " + minted + " reference" + (minted === 1 ? "" : "s") +
         " upgraded to permalinks in " + done.join(", ") + (note ? "\n" + note : "");
}

//  --- the plant --------------------------------------------------------------
//  Our line goes FIRST, right after the shebang, rather than at the end: an
//  existing hook that gates on its own `exit 0` would never reach an appended
//  line, and a linter later in the file should see the rewritten text.
const MARK = "#  Beagle-lite (LITE-026): fresh `file:line` refs -> permalinks.";
function hookLine(self) { return "\"" + self + "\" hook || exit $?"; }

//  plant(gitdir, self) -> true when it wrote, false when the line was there.
function plant(gitdir, self) {
  const dir = gitdir + "/hooks";
  try { io.mkdir(dir); } catch (e) {}                 // already there is fine
  const file = dir + "/pre-commit";
  const line = hookLine(self);
  let old = null;
  const b = readFile(file);
  if (b !== null && b.length > 0) old = utf8.Decode(b);
  if (old !== null)
    for (const l of old.split("\n")) if (l.trim() === line) return false;
  let text;
  if (old === null) text = "#!/bin/sh\n" + MARK + "\n" + line + "\n";
  else {
    const lines = old.split("\n");
    const at = lines[0].slice(0, 2) === "#!" ? 1 : 0;
    lines.splice(at, 0, MARK, line);
    text = lines.join("\n");
  }
  writeFile(file, utf8.Encode(text));
  try { io.chmod(file, 0o755); } catch (e) {}
  return true;
}

module.exports = { precommit: precommit, plant: plant, openUnborn: openUnborn,
                   freshRefs: freshRefs, stagedFiles: stagedFiles };
