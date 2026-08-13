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
//  then hand the pager the SAME openPath so its follow/refresh/`:` reads match.
function runPager(args) {
  const pager = require("view/pager.js");
  let hunks = [];
  for (const p of args) {
    const hs = openPath(p);
    if (hs !== null) hunks = hunks.concat(hs);
    else writeStderr("cannot open " + p + "\n");
  }
  //  The pager reads keys and paints on the CONTROLLING terminal, so stdout may
  //  stay redirected; fall back to a tty stdin, then to fd 1 (be's loop edge).
  let fd = null, own = false;
  try { fd = io.open("/dev/tty", "rw"); own = true; } catch (e) { fd = null; }
  if (fd === null && io.isatty(0)) fd = 0;
  if (fd === null) fd = 1;
  try {
    const p = new pager.Pager(fd, { color: true, open: openPath });
    p.setHunks(hunks);
    p.run();
  } finally { if (own) { try { io.close(fd); } catch (e) {} } }
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
  const lg = require("index/log.js");
  const rest = [];
  let plain = false;
  for (const a of args) { if (a === "--plain") plain = true; else rest.push(a); }
  const out = lg.log(rest.length ? rest[0] : undefined);
  if (out.rows.length === 0) return;              // an empty log says nothing
  if (!io.isatty(1) || plain) {
    writeFd(1, utf8.Encode(out.rows.join("\n") + "\n"));
    return;
  }
  pageHunks([lg.hunk(out.uri, out.parts)]);
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
  if (!io.isatty(1) || plain) { writeFd(1, out.text); return; }
  pageHunks([cm.hunk(out)]);
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

//  Hand a hunk list to the pager on the CONTROLLING terminal (the runPager
//  edge, shared so there is ONE tty lifecycle).  `open` is left unset: a log
//  row has nothing to follow into.
function pageHunks(hunks) {
  const pager = require("view/pager.js");
  let fd = null, own = false;
  try { fd = io.open("/dev/tty", "rw"); own = true; } catch (e) { fd = null; }
  if (fd === null && io.isatty(0)) fd = 0;
  if (fd === null) fd = 1;
  try {
    const p = new pager.Pager(fd, { color: true });
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
  const args = [];
  let plain = false;
  //  `--plain` is the ONE flag; everything else is a path, verbatim.
  for (const a of argl) { if (a === "--plain") plain = true; else args.push(a); }
  if (io.isatty(1) && !plain) runPager(args);      // no args → an empty viewport
  else runPlain(args);
}

if (typeof module !== "undefined")
  module.exports = { main: main, openPath: openPath };
if (process.argv[1] && process.argv[1].slice(-"/main.js".length) === "/main.js")
  main(process.argv);
