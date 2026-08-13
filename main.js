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

function main(argv) {
  const args = [];
  let plain = false;
  //  `--plain` is the ONE flag; everything else is a path, verbatim.
  for (const a of argv.slice(2)) { if (a === "--plain") plain = true; else args.push(a); }
  if (io.isatty(1) && !plain) runPager(args);      // no args → an empty viewport
  else runPlain(args);
}

if (typeof module !== "undefined")
  module.exports = { main: main, openPath: openPath };
if (process.argv[1] && process.argv[1].slice(-"/main.js".length) === "/main.js")
  main(process.argv);
