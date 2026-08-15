//  merge.js — LITE-014: the git MERGE DRIVER and the wiring that points
//  git at it.  Two verbs, one feature:
//
//    lite merge <base> <ours> <theirs> [-o <out>] [-p <path>]
//    lite install [<repo>]
//
//  git calls a custom driver per file that changed on BOTH sides: `%O %A %B`
//  are temp files (base / ours / theirs), the result goes over `%A`, and the
//  EXIT CODE says clean (0) or conflicted (non-zero).  The temps carry junk
//  names, so the tokenizer's extension comes from `%P` — the real repo path.
//
//  DIS-080/PATCH-025: a conflict writes the MARKERLESS woven bytes (both sides'
//  tokens in RGA order, NO `<<<<`/`====`/`>>>>` fences) and exits non-zero.
//  git then flags the path unmerged and the user resolves in the worktree; a
//  `git mergetool` finds no fences, which is the design, not a defect.
//
//  Exit is by THROW, as everywhere in lite: the runtime maps an uncaught throw
//  to exit 1, and 1 is exactly what git reads as "conflict".
"use strict";

const wv = require("index/weave.js");

//  --- bytes in, bytes out ---------------------------------------------------
//  A file's whole content.  An EMPTY file is answered without mmap (a zero
//  length mapping is refused by the kernel), a missing one is refused in words.
function readBytes(path, what) {
  let st;
  try { st = io.stat(path); } catch (e) { throw "merge: cannot read the " + what + " file " + path; }
  if (st.kind !== "reg") throw "merge: the " + what + " file " + path + " is not a regular file";
  if (st.size === 0) return new Uint8Array(0);
  try { return io.mmap(path, "r").data(); }
  catch (e) { throw "merge: cannot read the " + what + " file " + path; }
}

//  Write `bytes` over `path`, truncating it (mode "c" keeps an existing file's
//  permissions — only a fresh file takes the 0600 default).
function writeBytes(path, bytes) {
  let fd;
  try { fd = io.open(path, "c"); }
  catch (e) { throw "merge: cannot write " + path + " (" + e + ")"; }
  try {
    const b = io.buf(bytes.length + 8);
    b.feed(bytes);
    io.writeAll(fd, b);
  } finally { try { io.close(fd); } catch (e) {} }
}

//  Run a child to completion, inheriting stdio; -> its exit code (a signal
//  death answers 128 + signal, as a shell does).
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { throw "merge: cannot run " + argv[0] + " (" + e + ")"; }
  let rc;
  try { rc = io.reap(pid); }
  catch (e) { throw "merge: cannot wait for " + argv[0] + " (" + e + ")"; }
  if (rc.signal != null) return 128 + rc.signal;
  return rc.code | 0;
}

//  --- the fallback ----------------------------------------------------------
//  weave3 said null (binary, or over the 4 MB source cap): hand the three files
//  to git's OWN text merge rather than pick a side.  `git merge-file` merges IN
//  PLACE over its first argument, which is what the driver contract wants, so
//  the ours bytes go to `out` first when out is not the ours file itself.
//  It exits with the conflict count (or negative, i.e. 255, on a real error).
function gitMergeFile(base, ours, theirs, out, oursBytes, path) {
  if (out !== ours) writeBytes(out, oursBytes);
  const argv = ["git", "merge-file"];
  if (path) {
    argv.push("-L", path);                     // ours / base / theirs labels
    argv.push("-L", path + " (base)");
    argv.push("-L", path + " (theirs)");
  }
  argv.push(out, base, theirs);
  const rc = run(argv);
  if (rc === 0) return;
  if (rc < 0 || rc > 127)
    throw "merge: git merge-file could not merge " + (path || out);
  throw "merge: " + (path || out) +
        " could not be woven (binary or too big) and git's own merge left " +
        rc + " conflict" + (rc === 1 ? "" : "s");
}

//  --- the merge verb --------------------------------------------------------
//  `merge <base> <ours> <theirs> [-o <out>] [-p <path>]`.  Three positionals in
//  git's own %O %A %B order; `-o` defaults to <ours> (the driver contract) and
//  `-p` names the REAL path, which is where the tokenizer's extension comes
//  from — with no `-p` the generic "" lexer runs.
function parse(args) {
  const pos = [];
  let out = null, path = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "-p") {
      if (i + 1 >= args.length) throw "merge: " + a + " needs a file name after it";
      if (a === "-o") out = args[++i]; else path = args[++i];
      continue;
    }
    pos.push(a);
  }
  if (pos.length !== 3)
    throw "merge: give me three files — merge <base> <ours> <theirs> " +
          "[-o <out>] [-p <path>]";
  return { base: pos[0], ours: pos[1], theirs: pos[2],
           out: out === null ? pos[1] : out, path: path };
}

//  merge(args) -> undefined when the merge is clean; THROWS (exit 1, which git
//  reads as a conflict) when the woven bytes carry conflict spans.  Either way
//  the merged bytes are already on disk: the conflict is a STATE, not a refusal.
function merge(args) {
  const a = parse(args);
  const base = readBytes(a.base, "base");
  const ours = readBytes(a.ours, "ours");
  const theirs = readBytes(a.theirs, "theirs");
  const ext = a.path ? wv.extOf(a.path) : "";
  const m = wv.weave3(base, ours, theirs, ext);
  if (m === null) { gitMergeFile(a.base, a.ours, a.theirs, a.out, ours, a.path); return; }
  writeBytes(a.out, m.bytes);
  if (m.spans.length === 0) return;
  throw "merge: " + (a.path || a.out) + " has " + m.spans.length +
        " conflicting region" + (m.spans.length === 1 ? "" : "s") +
        " — both sides are in the file, resolve it there";
}

//  --- the install verb ------------------------------------------------------
//  The absolute path of THIS binary — what the driver line must name, since git
//  runs it from the repo root with no PATH promise.
function selfPath() {
  try { return io.readlink("/proc/self/exe"); } catch (e) {}
  try { return io.realpath(process.argv[0]); } catch (e) {}
  throw "install: cannot tell where this lite binary lives";
}

const DRIVER_NAME = "Beagle-lite CRDT weave merge";
const ATTR_LINE = "* merge=lite";

//  The `.git/info/attributes` half: the pattern map for a purely LOCAL,
//  uncommitted install.  Appending is the ceiling — the file is read whole and
//  its LINES are compared to the exact line we would add, nothing is parsed.
function attrInstalled(file) {
  let st;
  try { st = io.stat(file); } catch (e) { return false; }
  if (st.kind !== "reg" || st.size === 0) return false;
  let text;
  try { text = utf8.Decode(io.mmap(file, "r").data()); } catch (e) { return false; }
  for (const line of text.split("\n")) if (line.trim() === ATTR_LINE) return true;
  return false;
}

function attrAppend(gitdir, file) {
  try { io.mkdir(gitdir + "/info"); } catch (e) {}      // already there is fine
  let old = "";
  try {
    const st = io.stat(file);
    if (st.kind === "reg" && st.size > 0) old = utf8.Decode(io.mmap(file, "r").data());
  } catch (e) {}
  if (old.length && old[old.length - 1] !== "\n") old += "\n";
  writeBytes(file, utf8.Encode(old + ATTR_LINE + "\n"));
}

//  install(repoArg) -> a one-line report.  The repo resolves exactly as
//  `lite index` resolves it (a root, a `.git` dir or a gitfile; the cwd by
//  default).  Two writes, both idempotent: the driver definition through
//  `git config` (git NEVER reads driver commands from a tracked file) and the
//  pattern line in `.git/info/attributes`.
function install(repoArg) {
  const idx = require("index/index.js");
  const arg = repoArg === undefined ? io.cwd() : repoArg;
  let ctx = null;
  try { ctx = idx.openRepo(arg); }
  catch (e) {
    //  LITE-026: a repo with NO COMMITS YET is wired all the same — a fresh
    //  `git init` is exactly when you install, and the hook mints on the very
    //  first commit.  openRepo's HEAD gate is right for the read verbs and is
    //  left as it is; hook.js owns the HEAD-less handle.
    ctx = require("index/hook.js").openUnborn(arg);
    if (ctx === null) throw e;
  }
  let root, gitdir;
  try { root = ctx.root; gitdir = ctx.gitdir; } finally { idx.closeRepo(ctx); }

  const cmd = selfPath() + " merge %O %A %B -o %A -p %P";
  //  `--fixed-value` compares the stored value BYTE for byte, so no pattern of
  //  ours is ever read as a regex; rc 0 = this exact driver is already set.
  const have = run(["git", "-C", root, "config", "--get", "--fixed-value",
                    "merge.lite.driver", cmd]) === 0;
  let wrote = false;
  if (!have) {
    if (run(["git", "-C", root, "config", "merge.lite.name", DRIVER_NAME]) !== 0 ||
        run(["git", "-C", root, "config", "merge.lite.driver", cmd]) !== 0)
      throw "install: git config refused to record the driver in " + root;
    wrote = true;
  }
  const attrs = gitdir + "/info/attributes";
  if (!attrInstalled(attrs)) { attrAppend(gitdir, attrs); wrote = true; }
  //  LITE-026: the same wiring plants the pre-commit hook, composing with one
  //  already there — index/hook.js owns that half.
  if (require("index/hook.js").plant(gitdir, selfPath())) wrote = true;
  return (wrote ? "installed" : "already installed") +
         ": lite is the merge driver and the pre-commit hook for " + root;
}

module.exports = { merge: merge, install: install, parse: parse,
                   ATTR_LINE: ATTR_LINE, selfPath: selfPath };
