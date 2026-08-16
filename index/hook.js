//  index/hook.js as per LITE-026: the git PRE-COMMIT pass that MINTS permalinks —
//  a fresh `file.c:12:24` in staged text becomes `file.c:12:d8` (LITE-025:19:zc,
//  BEE-019:35) at the last moment the ref is current and the first every blob id is
//  known.
//  The pass: added text off the weave LITE-026:41:xo, the ruled INDEX write-back
//  LITE-026:51:xo, the first commit LITE-026:59:xo, the topo order and per-ref cycle
//  degrade LITE-027:37:Fe.  Left alone, never guessed: an unresolved or ambiguous
//  path, a line past the end, a link cycle (LITE-026:27:xo, LITE-027:24:Fe).  Ticket
//  stems and the registry fan-out: BEE-014:42; `bee mint` reuses it: BEE-016:34.
"use strict";

const idx = require("./index.js");
const rd = require("./read.js");
const pm = require("./perma.js");
const rs = require("./resolve.js");
const wv = require("./weave.js");

const TAG_F = 0x46;                                //  the lexer's `F` anchor
const TOK32_F = TAG_F - 65;                        //  the same tag in a tok32

//  --- THE link scanner --------------------------------------------------------
//  LITE-033:42:PS: link recognition is the TOKENIZER's alone — the DOG-034 lexer
//  fuses `abc/Makefile:20`, `LITE-029` into ONE `F` token, so no regex and no
//  second recognizer ever re-scans raw bytes.  Shared with lindex.js, mint.js.
//  -> [{ lo, hi, text }, ...] over `bytes`; an untokenisable source is empty.
function fTokens(bytes, ext) {
  let toks;
  try { toks = tok.parse(bytes, ext); } catch (e) { return []; }
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (((toks[i] >>> 27) & 0x1f) !== TOK32_F) continue;
    const lo = i > 0 ? (toks[i - 1] & 0xffffff) : 0, hi = toks[i] & 0xffffff;
    out.push({ lo: lo, hi: hi, text: utf8.Decode(bytes.slice(lo, hi)) });
  }
  return out;
}

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
//  git's EMPTY TREE, the `diff-index` base on the FIRST commit (LITE-026:59:xo):
//  every staged path reads as added, and git knows it without a write.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

//  -> Map rel -> the staged blob id, for every path whose staged blob differs
//  from HEAD's — asked of git, since bee reads no `.git/index` (LITE-026:92:xo).
//  `-z` so odd path bytes read back verbatim; deletions and unmerged skipped.
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
  const split = require("door.js").splitRef;       // the ONE ref split point
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
//  descent at HEAD; several answers = an ambiguity, never guessed.  BEE-014:42:
//  a STEM tries the door's own `refSpellings` ladder, first spelling that answers.
function targetOf(ctx, ix, staged, partial) {
  for (const t of require("door.js").refSpellings(partial)) {
    const q = rs.split(t);
    if (q === null) continue;
    const hits = [];
    for (const rel of staged.keys()) if (rs.tailMatches(rel, q.segs)) hits.push(rel);
    if (ctx.head && ctx.head.sha)
      for (const rel of rs.resolveAt(ctx, ix, ctx.head.sha, t))
        if (hits.indexOf(rel) < 0) hits.push(rel);
    if (hits.length) return hits.length === 1 ? hits[0] : null;
  }
  return foreignTarget(ctx, partial);
}

//  BEE-014:47: the FAN-OUT over the mount table (index/mount.js) — REGISTERED
//  IS THE WHOLE PERMISSION.  Each repo opens READ-ONLY, never brought up
//  (BEE-002:65:qe); a target no registered repo holds mints NOTHING, never a guess.
//  -> { root, rel } (a foreign file), or null.
function foreignTarget(ctx, partial) {
  const mnt = require("./mount.js");
  const spellings = require("door.js").refSpellings(partial);
  let mounts;
  try { mounts = mnt.mounts(); } catch (e) { return null; }
  for (const m of mounts) {
    if (m.root === ctx.root) continue;          // the carrier answered already
    const hit = inForeign(m.root, spellings);
    if (hit !== null) return hit.rel === null ? null : { root: m.root, rel: hit.rel };
  }
  return null;
}

//  ONE foreign repo's answer.  null = it holds nothing; { rel: null } = it holds
//  SEVERAL, which is the ambiguity the hook refuses rather than guesses through.
function inForeign(root, spellings) {
  let tctx = null, tix = null;
  try {
    tctx = idx.openRepo(root, true);
    if (!(tctx.head && tctx.head.sha)) return null;
    tix = idx.openIndex(tctx.gitdir, false, true);
    for (const t of spellings) {
      const hits = rs.resolveAt(tctx, tix, tctx.head.sha, t);
      if (hits.length === 1) return { rel: hits[0] };
      if (hits.length > 1) return { rel: null };
    }
    return null;
  } catch (e) { return null; }        // an unreadable repo simply does not answer
  finally {
    if (tix !== null) { try { tix.close(); } catch (e) {} }
    if (tctx !== null) idx.closeRepo(tctx);
  }
}

//  One ref -> its permalink spelling, or null when it is left alone.  The path
//  is kept AS WRITTEN — only the anchor segments change.  `ref.dst` is the file
//  the path answered to, resolved once before any rewrite ran.
function mintRef(ctx, ix, images, ref) {
  const rel = ref.dst;
  if (rel === null) return null;
  //  BEE-014: a FOREIGN target is scoped to ITS OWN repo — the hashlet names a
  //  blob in that history, and the carrier's history has nothing to say about it.
  if (typeof rel === "object") return mintForeign(rel, ref);
  const own = images.has(rel);
  const bytes = own ? images.get(rel) : blobOf(ctx, (headEntry(ctx, rel) || {}).sha);
  if (bytes === null || bytes === undefined) return null;
  //  BEE-019:35: the LINE the ref names is the anchor, so the mint is an APPEND
  //  — `byteAt` only asks whether the target image has such a line at all.
  if (pm.byteAt(bytes, ref.line, 1) < 0) return null;    // no such line there
  const sha = own ? pm.blobIdOf(bytes) : headEntry(ctx, rel).sha;
  //  On the FIRST commit the scope degenerates to that ONE staged blob: no
  //  history to collide with, so the minimum hashlet always names it.
  const h = pm.mintHashlet(sha, ix === null ? [] : pm.blobHistory(ctx, ix, rel));
  if (h === null) return null;
  return ref.path + ":" + ref.line + ":" + h;
}

//  BEE-014:49: one FOREIGN ref -> its permalink.  The target repo is opened
//  READ-ONLY: its HEAD blob is what the anchor names and its own blob history
//  is the hashlet's scope (core/Link — one file, one repo).  Path as written.
function mintForeign(dst, ref) {
  let tctx = null, tix = null;
  try {
    tctx = idx.openRepo(dst.root, true);
    const he = headEntry(tctx, dst.rel);
    if (he === null) return null;
    const bytes = blobOf(tctx, he.sha);
    if (bytes === null) return null;
    if (pm.byteAt(bytes, ref.line, 1) < 0) return null;  // no such line there
    tix = idx.openIndex(tctx.gitdir, false, true);
    const h = pm.mintHashlet(he.sha, pm.blobHistory(tctx, tix, dst.rel));
    if (h === null) return null;
    return ref.path + ":" + ref.line + ":" + h;
  } catch (e) { return null; }
  finally {
    if (tix !== null) { try { tix.close(); } catch (e) {} }
    if (tctx !== null) idx.closeRepo(tctx);
  }
}

//  One file's staged bytes with every mintable ref replaced (`bytes` null when
//  none minted); `subs` maps ref AS WRITTEN -> permalink, so the working copy
//  gets the SAME upgrades.  LITE-027:37:Fe: a target in the carrier's OWN component
//  is a cycle and stays `line:col`; `left` is what `bee mint` reports (BEE-016:28).
function rewrite(ctx, ix, images, comp, rel, src, refs) {
  const parts = [], subs = new Map(), left = [];
  let at = 0, minted = 0, stuck = 0;
  const mine = comp.get(rel);
  for (const ref of refs) {
    if (ref.dst !== null && comp.get(ref.dst) === mine) {
      if (mine.length > 1) stuck++;
      left.push(ref);
      continue;
    }
    const s = mintRef(ctx, ix, images, ref);
    if (s === null) { if (ref.dst !== null) left.push(ref); continue; }
    parts.push(src.slice(at, ref.lo));
    parts.push(utf8.Encode(s));
    subs.set(utf8.Decode(src.slice(ref.lo, ref.hi)), s);
    at = ref.hi;
    minted++;
  }
  if (minted === 0)
    return { bytes: null, minted: 0, subs: null, stuck: stuck, left: left };
  parts.push(src.slice(at));
  return { bytes: concat(parts), minted: minted, subs: subs, stuck: stuck,
           left: left };
}

//  --- the link graph ---------------------------------------------------------
//  LITE-027:37:Fe: carrier -> target edges over the files this commit REWRITES (an
//  untouched target is final, no edge).  Tarjan yields the SCCs SINK-FIRST = the
//  mint order; a component of >1 file is a cycle, a self-link its own component
//  with a self-edge, so both read the same.  -> [[rel, ...], ...], sinks first.
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
//  LITE-026:51:xo: the rewrite lands in the INDEX — a blob, then the entry pointed
//  at it.  `--no-filters`: the bytes came off the ODB and already ARE index-side
//  content, so no clean filter may run over them twice.
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

//  LITE-026:56:xo: the SAME upgrades over the WORKING file, by TOKEN equality (a
//  substring hunt would eat `FSW.c:9:Ud` out of `FSW.c:90:Ud`) — every other byte,
//  unstaged edits included, stays.  A ref only on disk was not part of this
//  commit and waits its turn.
function applySubs(bytes, ext, subs) {
  if (!subs || subs.size === 0) return null;
  const parts = [];
  let at = 0, hit = 0;
  for (const t of fTokens(bytes, ext)) {
    if (t.lo < at) continue;
    const s = subs.get(t.text);
    if (s === undefined) continue;
    parts.push(bytes.slice(at, t.lo));
    parts.push(utf8.Encode(s));
    at = t.hi;
    hit++;
  }
  if (hit === 0) return null;
  parts.push(bytes.slice(at));
  return concat(parts);
}

//  --- the pass ---------------------------------------------------------------
//  LITE-026:59:xo: openRepo's handle MINUS its HEAD gate — the FIRST commit needs
//  only the ODB and the two paths.  `head` is null, which every leg reads as
//  "the empty tree is the base"; openRepo itself is every verb's and stays.
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

  //  LITE-026:51:xo: the INDEX takes the rewrite (never the working file as a proxy),
  //  then the working file the SAME upgrades — no meaningless link-form diff.
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
//  LITE-026:48:xo: our line goes FIRST, after the shebang — an existing hook gating
//  on its own `exit 0` never reaches an appended line, and a later linter should
//  see the rewritten text.
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
                   freshRefs: freshRefs, stagedFiles: stagedFiles,
                   //  LITE-033: the ONE link scanner, shared with index/lindex.js.
                   fTokens: fTokens,
                   //  BEE-016:34: THE MINTER ITSELF, shared with index/mint.js —
                   //  the verb is this pass with another scan and write-back.
                   targetOf: targetOf, rewrite: rewrite, components: components,
                   readFile: readFile, writeFile: writeFile, blobOf: blobOf,
                   headEntry: headEntry };
