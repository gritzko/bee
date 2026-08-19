//  index/mint.js — `bee mint <file>...`, the verb half of the minter (BEE-016).
//  A pre-commit hook only sees a commit in flight, so a ref that landed
//  transient (BEE-016:9:KH) is reachable by no hook; this verb is index/hook.js's
//  own pass with two ends changed (BEE-016:42:KH): the scan drops the freshness
//  gate (BEE-016:44:KH), the resolution sees no staged map (BEE-016:45:KH) and only
//  the working file is written (BEE-016:46:KH).  The file list names the carriers
//  (BEE-016:25:KH); a dirty unlisted target is refused (BEE-016:47:KH); everything
//  left alone is said, one line per ref (BEE-016:28:KH).
"use strict";

const idx = require("./index.js");
const pm = require("./perma.js");
const rd = require("./read.js");
const hk = require("./hook.js");
const wv = require("./weave.js");

const FLAG_DRY = "--dry-run";

//  --- the scan ---------------------------------------------------------------
//  Every transient ref a file's working bytes carry: the hook's `freshRefs`
//  without its HEAD-to-staged fold, because none of these is fresh.  The `F`
//  tokens come through the one scanner (LITE-033), no second recognizer here.
function transientRefs(rel, bytes) {
  const split = require("door.js").splitRef;       // the one ref split point
  const out = [];
  for (const t of hk.fTokens(bytes, wv.extOf(rel))) {
    const sp = split(t.text);
    //  Already a permalink, or no all-digit anchor at all: nothing to mint.
    if (sp.hash || !(sp.line >= 1) || sp.path === "") continue;
    out.push({ lo: t.lo, hi: t.hi, path: sp.path, line: sp.line, col: sp.col });
  }
  return out;
}

//  --- the arguments ----------------------------------------------------------
//  One argument -> the repo-relative path of a regular file inside this repo,
//  or null with the reason said out loud.  A glob hands over whatever the shell
//  matched, so a dir or a stray path is reported and the rest is minted.
function relOf(ctx, arg, errs) {
  let real;
  try { real = io.realpath(arg); } catch (e) { errs.push(arg + ": no such file"); return null; }
  let st;
  try { st = io.lstat(real); } catch (e) { errs.push(arg + ": no such file"); return null; }
  if (st.kind === "dir") { errs.push(arg + ": a directory, not a file"); return null; }
  if (st.kind !== "reg") { errs.push(arg + ": not a regular file"); return null; }
  const pre = ctx.root + "/";
  if (real.slice(0, pre.length) !== pre) {
    errs.push(arg + ": outside " + ctx.root);
    return null;
  }
  return real.slice(pre.length);
}

//  --- the dirt gate ----------------------------------------------------------
//  Does this path's working copy differ from the one HEAD carries?  bee never
//  reads `.git/index` (index/perma.js:171:mU), so working-vs-HEAD is the only
//  question that matters: a hashlet can only name a blob the ODB will hold.
function dirty(ctx, rel) {
  const m = idx.readCommit(ctx.r, ctx.head.sha);
  if (m === null) return true;
  const e = rd.entryAt(ctx.r, m.tree, rel);
  if (e === null || e.dir) return true;            // not in HEAD at all
  const was = hk.blobOf(ctx, e.sha);
  const now = hk.readFile(ctx.root + "/" + rel);
  return was === null || now === null || !wv.bytesEq(was, now);
}

//  --- the report -------------------------------------------------------------
//  Why one ref that had a target still did not mint.  The rewrite hands back
//  the refs it left (hook.js `left`); the cause is asked of the final bytes,
//  which by the sink-first order are already settled for any target.
function whyLeft(ctx, images, ref, cyclic) {
  const dst = ref.dst;
  if (cyclic) return spell(dst) + " names text that names it back";
  if (typeof dst === "object") return spell(dst) + " answers no line " + ref.line;
  const bytes = images.has(dst) ? images.get(dst)
              : hk.blobOf(ctx, (hk.headEntry(ctx, dst) || {}).sha);
  if (bytes === null || bytes === undefined) return dst + " has no readable blob";
  if (pm.byteAt(bytes, ref.line, 1) < 0) return dst + " has no line " + ref.line;
  return "no hashlet names " + dst + "'s blob";
}

function spell(dst) { return typeof dst === "object" ? dst.root + "/" + dst.rel : dst; }

//  --- the pass ---------------------------------------------------------------
//  Report lines carry their own place, so the two phases below (resolution,
//  then rewrite) come out as one list in file-and-line order, the order the
//  reader would grep them in.
function noted(notes, rel, line, text) {
  notes.push({ rel: rel, line: line, text: rel + ":" + line + ": " + text });
}
function ordered(notes) {
  notes.sort(function (a, b) {
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line;
  });
  return notes.map(function (nt) { return nt.text; });
}

function pass(ctx, ix, args, dry, errs) {
  const notes = [];
  //  The carriers in the order given, deduped, since a glob may name one twice.
  const rels = [];
  for (const a of args) {
    const rel = relOf(ctx, a, errs);
    if (rel !== null && rels.indexOf(rel) < 0) rels.push(rel);
  }

  //  Their working bytes and the transient refs each one carries.
  const base = new Map(), cands = new Map();
  for (const rel of rels) {
    const now = hk.readFile(ctx.root + "/" + rel);
    if (now === null) { errs.push(rel + ": cannot read"); continue; }
    base.set(rel, now);
    const refs = transientRefs(rel, now);
    if (refs.length) cands.set(rel, refs);
  }
  if (cands.size === 0) return { lines: [], minted: 0, done: [] };

  //  Every ref's target, resolved once against HEAD plus the BEE-014 fan-out;
  //  edges go only to carriers, since a target no rewrite touches is final.
  const none = new Map();                          // no commit in flight
  const edges = new Map();
  for (const [rel, refs] of cands) {
    const src = base.get(rel), es = [];
    for (const ref of refs) {
      ref.dst = hk.targetOf(ctx, ix, none, ref.path);
      const at = pm.lineCol(src, ref.lo).line;
      if (ref.dst === null) { noted(notes, rel, at, "no one file answers " + ref.path); continue; }
      //  A target this run does not rewrite must be clean, or the anchor names
      //  bytes the reader will never see (BEE-016:47:KH).
      if (typeof ref.dst === "string" && !base.has(ref.dst) && dirty(ctx, ref.dst)) {
        noted(notes, rel, at, ref.dst + " has uncommitted edits — name it too, or commit it");
        ref.dst = null;
        continue;
      }
      if (cands.has(ref.dst) && es.indexOf(ref.dst) < 0) es.push(ref.dst);
    }
    edges.set(rel, es);
  }

  //  One pass, targets first (LITE-027): when a carrier's turn comes every
  //  file it names is already final in `images`, so nothing is ever re-minted.
  const comps = hk.components(cands.keys(), edges), comp = new Map();
  for (const c of comps) for (const rel of c) comp.set(rel, c);
  const images = new Map(base), done = [];
  let minted = 0;
  for (const c of comps) for (const rel of c) {
    const src = base.get(rel);
    const r = hk.rewrite(ctx, ix, images, comp, rel, src, cands.get(rel));
    for (const ref of r.left)
      noted(notes, rel, pm.lineCol(src, ref.lo).line,
            whyLeft(ctx, images, ref, comp.get(ref.dst) === c));
    if (r.bytes === null) continue;
    //  A dry run spells out every upgrade, since vetting refs before the bytes
    //  move is why the flag exists (BEE-016:29:KH); a live run leaves that to `git diff`.
    if (dry) for (const ref of cands.get(rel)) {
      const now = r.subs.get(utf8.Decode(src.slice(ref.lo, ref.hi)));
      if (now !== undefined)
        noted(notes, rel, pm.lineCol(src, ref.lo).line,
              utf8.Decode(src.slice(ref.lo, ref.hi)) + " -> " + now);
    }
    images.set(rel, r.bytes);
    minted += r.minted;
    done.push(rel);
  }
  if (minted === 0) return { lines: ordered(notes), minted: 0, done: [] };

  //  The working file and nothing else; `stageBytes` is the hook's half.
  if (!dry) for (const rel of done) hk.writeFile(ctx.root + "/" + rel, images.get(rel));
  return { lines: ordered(notes), minted: minted, done: done };
}

//  A hashlet into a listed file names the post-mint image, an object git
//  writes when the commit lands; until then it follows through perma.js's
//  worktree tier (BEE-016:48:KH).
function summary(r, dry) {
  const what = r.minted + " reference" + (r.minted === 1 ? "" : "s");
  if (r.minted === 0) return "mint: nothing to upgrade";
  return "mint: " + what + (dry ? " would be" : "") + " upgraded in " + r.done.join(", ") +
         (dry ? " — nothing written" : "");
}

//  mint(argv) -> { out, err, usage }; the CLI writes them and this owns no
//  exit convention.  The bare word is usage, not a tree sweep (BEE-016:49:KH).
function mint(argv) {
  const dry = argv.indexOf(FLAG_DRY) >= 0;
  const args = argv.filter(function (a) { return a !== FLAG_DRY; });
  if (args.length === 0) return { usage: true };
  const errs = [];
  let ctx;
  //  No HEAD is a refusal, not a first commit: there is no committed blob for
  //  any hashlet to name, so there is nothing this verb could honestly mint.
  try { ctx = idx.openRepo(io.cwd()); }
  catch (e) { return { out: "", err: "mint: " + e + "\n" }; }
  try {
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });
      const r = pass(ctx, ix, args, dry, errs);
      r.lines.push(summary(r, dry));
      return { out: r.lines.join("\n") + "\n",
               err: errs.length ? errs.join("\n") + "\n" : "" };
    } finally { try { ix.close(); } catch (e) {} }
  } finally { idx.closeRepo(ctx); }
}

module.exports = { mint: mint, transientRefs: transientRefs };
