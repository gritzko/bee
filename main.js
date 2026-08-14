//  main.js — the Beagle-lite ENTRY (LITE-003).  Every CLI arg is a file or dir
//  path: at a terminal they open in the interactive pager, piped or `--plain`
//  they dump as plain hunks (`hunk <uri>` + the bytes).  This is be's
//  views/bro/bro.js broRun flow with the spell/verb/loop layer removed — the
//  args are paths, not spells, and there is ONE fs open for both modes.
//
//  Exit is by THROW, never process.exit: the runtime maps an uncaught throw to
//  the non-zero exit (BE-002 discipline — no args → BROUSAGE, args but none
//  opened → BRONONE).
"use strict";

const bro = require("view/bro.js");

function writeFd(fd, bytes) {
  const b = io.buf(bytes.length + 8);
  b.feed(bytes);
  io.writeAll(fd, b);
}

function writeStderr(str) { writeFd(2, utf8.Encode(str)); }

//  THE fs open, shared by the plain dump and the pager (opts.open): stat the
//  bare path, dir → listing hunk, file → mmap+tokenize; a miss → null.  The
//  pager's door is `(path) -> hunks | null`, so the hunk rides a one-elem list.
function openPath(path) {
  const fp = bro.fsPath(path);
  let st;
  try { st = io.stat(fp); } catch (e) { return null; }
  let hunk;
  try {
    //  The hunk URI is the arg VERBATIM (trailing '/' kept) — only fs ops see fp.
    hunk = st.kind === "dir" ? bro.buildDirHunk(path, fp) : bro.buildFileHunk(path, fp);
  } catch (e) { return null; }
  return hunk === null ? null : [hunk];              // empty dir → no hunk
}

//  The interactive leg: build a hunk per arg (a miss is reported and skipped),
//  then page them.
//  LITE-015: the pager's door is openTarget, like every other view's — a click
//  inside a file can name a verb line or a file REFERENCE, not just a dir entry.
function runPager(args) {
  let hunks = [];
  for (const p of args) {
    const hs = openPath(p);
    if (hs !== null) hunks = hunks.concat(hs);
    else writeStderr("cannot open " + p + "\n");
  }
  pageHunks(hunks);
}

//  The plain leg: per arg one plainHunk, concatenated and written to stdout in
//  ONE call (byte-parity with `bro --plain`); a miss goes to stderr and the run
//  continues, so a batch still dumps what it could open.
function runPlain(args) {
  if (args.length === 0) {
    writeStderr("Usage: lite [--plain] <path>...\n");
    throw "BROUSAGE";
  }
  const out = [];
  let anyOpened = false;
  for (const p of args) {
    const hs = openPath(p);
    if (hs === null) { writeStderr("cannot open " + p + "\n"); continue; }
    anyOpened = true;
    for (const h of hs) out.push(bro.plainHunk(h));
  }
  let total = 0;
  for (const b of out) total += b.length;
  const all = new Uint8Array(total);
  let off = 0;
  for (const b of out) { all.set(b, off); off += b.length; }
  if (all.length > 0) writeFd(1, all);
  if (!anyOpened) throw "BRONONE";
}

//  LITE-006: `lite index [<repo>]` brings `<repo>/.git/be/` up to date and
//  prints one summary line.  The verbs stand BEFORE the flag scan because
//  every other arg is a path, verbatim.
function runIndex(args) {
  const idx = require("index/index.js");
  const rec = idx.index(args.length ? args[0] : io.cwd());
  writeFd(1, utf8.Encode(idx.summary(rec) + "\n"));
}

//  LITE-007: `lite log [--plain] [<hex>|<path>]` — the commit / file log off
//  that index, which it brings up to date ITSELF.  One be-log row per commit,
//  newest first.
//
//  A LOG IS A HUNK (ruling 2026-08-13).  At a terminal it goes through the
//  SAME door a file arg takes — view/pager.js over a tok32-tagged hunk, painted
//  by view/bro.js's theme — so the columns carry be log's own colours and the
//  whole history scrolls.  Piped or under `--plain` it is the bare rows, which
//  is what a `| grep` and a `diff` against `git log` want.
function runLog(args) {
  const rest = [];
  let plain = false;
  for (const a of args) { if (a === "--plain") plain = true; else rest.push(a); }
  const argstr = rest.join(" ");
  if (!io.isatty(1) || plain) {
    //  A pipe / --plain defaults to ALL rows (the `git log` diff parity); an
    //  explicit count still applies.
    const lg = require("index/log.js");
    const q = logQuery(argstr);
    const out = lg.log(q.target, { max: q.max || 0 });
    if (out.rows.length)
      writeFd(1, utf8.Encode(out.rows.join("\n") + "\n"));
    return;
  }
  //  A log row's sha8 is a click-target: the row carries `commit <hexlet>`, the
  //  pager hands it to the door and pushes that view, `-` backs out.
  const hunks = VERBS.log(argstr);
  if (hunks.length) pageHunks(hunks);
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

//  LITE-009: `lite commit [--plain] [<hex>]` — ONE commit's metadata, the be
//  `commit:` view over this repo's own ODB.  Bare = the checked-out tip.
//
//  The plain bytes are `commit <sha40>\n` + the raw object, which is exactly
//  `git cat-file commit <sha>` with one line in front — so a pipe feeds a diff
//  or a grep the object itself.  At a terminal the SAME bytes ride the SAME
//  pageHunks door a log or a file arg takes, with the fields coloured.
function runCommit(args) {
  const cm = require("index/commit.js");
  const rest = [];
  let plain = false;
  for (const a of args) { if (a === "--plain") plain = true; else rest.push(a); }
  const out = cm.commit(rest.length ? rest[0] : undefined);
  //  The metadata hunk, then the commit's own diff: one hunk set per changed or
  //  added file, an empty (banner-only) hunk per removed one.
  if (!io.isatty(1) || plain) {
    const parts = [out.text];
    for (const h of out.hunks) parts.push(bro.plainHunk(h));
    let total = 0;
    for (const b of parts) total += b.length;
    const all = new Uint8Array(total);
    let off = 0;
    for (const b of parts) { all.set(b, off); off += b.length; }
    writeFd(1, all);
    return;
  }
  pageHunks([cm.hunk(out)].concat(out.hunks));
}



//  LITE-010: `lite diff [--plain] [<hex>|<path>]` — the CFOLD 2-layer diff,
//  worktree vs HEAD by default, a path scoped to that path, a `<hex>` against
//  its first parent.  One hunk per emitted window: at a terminal the pager
//  paints the weave (added salad, removed salmon), piped or under `--plain` it
//  is the C unified render under the usual `hunk <uri>` banner.
function runDiff(args) {
  const df = require("index/diff.js");
  const rest = [];
  let plain = false;
  for (const a of args) { if (a === "--plain") plain = true; else rest.push(a); }
  const out = df.diff(rest.length ? rest[0] : undefined);
  if (out.hunks.length === 0) return;             // no change says nothing
  if (!io.isatty(1) || plain) {
    const parts = [];
    let total = 0;
    for (const h of out.hunks) { const b = bro.plainHunk(h); parts.push(b); total += b.length; }
    const all = new Uint8Array(total);
    let off = 0;
    for (const b of parts) { all.set(b, off); off += b.length; }
    writeFd(1, all);
    return;
  }
  pageHunks(out.hunks);
}

//  LITE-014: `lite merge <base> <ours> <theirs> [-o <out>] [-p <path>]` — the
//  git merge-driver contract (result over <ours>, exit code = clean/conflict),
//  and `lite install [<repo>]` which points a repo's git at it.  Both are silent
//  on success bar install's one report line; a conflict THROWS (exit 1).
function runMerge(args) { require("index/merge.js").merge(args); }

function runInstall(args) {
  const mg = require("index/merge.js");
  writeFd(1, utf8.Encode(mg.install(args.length ? args[0] : undefined) + "\n"));
}

//  LITE-016: `lite chat [dir] [outdir]` renders the Claude Code session logs of
//  a project dir as StrictMark pages, 1:1 by basename, append-only on a rerun.
//  It reports on the message stream only, so stdout stays free.
function runChat(args) { require("index/chat.js").chat(args); }

//  ---- the ONE door --------------------------------------------------------
//  Every view a verb can produce, keyed by the verb: `(arg) -> hunks`.  The CLI
//  legs above and the PAGER both come through this table, so a click target is
//  an ordinary `<verb> <arg>` line and no view-specific opener exists.
const VERBS = {
  log: function (arg) {
    const lg = require("index/log.js");
    const q = logQuery(arg);
    //  The VIEW defaults to 256 rows so any-size history paints instantly.
    const max = q.max === null ? 256 : q.max;
    const o = lg.log(q.target, { max: max });
    if (!o.rows.length) return [];
    //  The uri is the TYPED target, verbatim — an explicit count stays, the
    //  default cap does not rename the view.
    const uri = q.max === null ? o.uri
              : "log " + q.max + (q.target ? " " + q.target : "");
    return [lg.hunk(uri, o.parts)];
  },
  commit: function (arg) {
    const cm = require("index/commit.js");
    const o = cm.commit(arg);
    return [cm.hunk(o)].concat(o.hunks);
  },
  diff: function (arg) { return require("index/diff.js").diff(arg).hunks; }
};

//  LITE-015: the FSEG leg of the door — a path that does not stat may be a
//  PARTIAL one, so the LITE-011 descent gets to name it before the miss stands.
//  ONE hit opens; SEVERAL become the chooser; none leaves the caller's message.
function openPartial(partial) {
  const paths = resolvePartial(partial);
  if (paths.length === 0) return null;
  if (paths.length === 1) return openPath(paths[0].full);
  return [bro.buildChooserHunk(partial, paths)];
}

//  The resolution itself, at HEAD of the CWD repo, through the ONE resolver.
//  The recovered text is repo-relative; the fs path anchors at the repo ROOT,
//  so a reference clicked from a subdir opens the file the name stands for.
function resolvePartial(partial) {
  const idx = require("index/index.js");
  let ctx;
  try { ctx = idx.openRepo(io.cwd(), true); } catch (e) { return []; }
  try {
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });    // the lazy contract, as ever
      const rel = require("index/resolve.js").resolveAt(ctx, ix, ctx.head.sha, partial);
      return rel.map(function (p) { return { rel: p, full: ctx.root + "/" + p }; });
    } finally { try { ix.close(); } catch (e) {} }
  } catch (e) { return []; }
  finally { idx.closeRepo(ctx); }
}

//  Resolve ONE target to hunks (`null` = nothing to open): a `<verb> <arg>`
//  line goes to its verb, anything else is a PATH.  A target must carry an arg
//  to read as a verb, so a file merely NAMED `log` still opens as the file.
function openTarget(target) {
  const sp = target.indexOf(" ");
  const fn = sp > 0 ? VERBS[target.slice(0, sp)] : null;
  if (!fn) {
    const hs = openPath(target);
    return hs !== null ? hs : openPartial(target);
  }
  let hunks;
  try { hunks = fn(target.slice(sp + 1).trim()); } catch (e) { return null; }
  return hunks && hunks.length ? hunks : null;
}

//  Hand a hunk list to the pager on the CONTROLLING terminal (the runPager
//  edge, shared so there is ONE tty lifecycle).  The door is openTarget for
//  every view: the pager stays arg-blind, the target names its own verb.
function pageHunks(hunks) {
  const pager = require("view/pager.js");
  let fd = null, own = false;
  try { fd = io.open("/dev/tty", "rw"); own = true; } catch (e) { fd = null; }
  if (fd === null && io.isatty(0)) fd = 0;
  if (fd === null) fd = 1;
  try {
    const p = new pager.Pager(fd, { color: true, open: openTarget });
    p.setHunks(hunks);
    p.run();
  } finally { if (own) { try { io.close(fd); } catch (e) {} } }
}

function main(argv) {
  const argl = argv.slice(2);
  if (argl.length && argl[0] === "index") return runIndex(argl.slice(1));
  if (argl.length && argl[0] === "log") return runLog(argl.slice(1));
  if (argl.length && argl[0] === "commit") return runCommit(argl.slice(1));
  if (argl.length && argl[0] === "diff") return runDiff(argl.slice(1));
  if (argl.length && argl[0] === "merge") return runMerge(argl.slice(1));
  if (argl.length && argl[0] === "install") return runInstall(argl.slice(1));
  if (argl.length && argl[0] === "chat") return runChat(argl.slice(1));
  const args = [];
  let plain = false;
  //  `--plain` is the ONE flag; everything else is a path, verbatim.
  for (const a of argl) { if (a === "--plain") plain = true; else args.push(a); }
  if (io.isatty(1) && !plain) runPager(args);      // no args → an empty viewport
  else runPlain(args);
}

if (typeof module !== "undefined")
  module.exports = { main: main, openPath: openPath, openTarget: openTarget };
if (process.argv[1] && process.argv[1].slice(-"/main.js".length) === "/main.js")
  main(process.argv);
