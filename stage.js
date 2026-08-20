//  stage.js — BEE-036: `add`, `add +` and `rm`, bee's first STAGING verbs.
//  Each bare verb moves exactly ONE of be's classes — modified-tracked,
//  untracked, gone-on-disk — because the board's FILE-frame buttons stage one
//  class each and a verb of wider reach would make the count on the face lie
//  (be views/todo/todo.js:488 UN_COL).  Every write is a child `git` off an
//  argv array (fork.js:31 run), the file lists NUL-framed in both directions:
//  no `/bin/sh -c`, no porcelain read by regex.  Named paths go verbatim and
//  wt-relative wherever the run stands, since the board's rows are (be BE-039).
"use strict";

const idx = require("index/index.js");
const mnt = require("index/mount.js");
const subs = require("index/subs.js");

//  RULING (gritzko 2026-08-20, BEE-036:8): the verbs are named GIT-STYLE, so
//  these two words are what the CLI table in main.js:238:eY spells too.
const ADD = "add", RM = "rm";

//  The worktree the run stands in — a `//name` context's repo, else the climb
//  from cwd (index/index.js:759:64f discover).  Like git itself, the verbs act on
//  the CURRENT tree, and `-C` here is what makes every path wt-relative.
function root() {
  const at = idx.discover(mnt.at());
  if (at === null) throw "bee: not a git repository";
  return at;
}

//  --- the children ---------------------------------------------------------
//  git's stderr is INHERITED throughout: a refusal reaches the user in git's
//  own words, never re-worded here.
function spawn(argv) {
  try { return io.spawn(argv[0], argv); }
  catch (e) { throw "bee: cannot run " + argv[0] + " (" + e + ")"; }
}

//  -> the child's exit code (a signal death answers 128 + signal, as a shell
//  does; merge.js:40:z4).
function reap(pid, argv) {
  let rc;
  try { rc = io.reap(pid); }
  catch (e) { throw "bee: cannot wait for " + argv[0] + " (" + e + ")"; }
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

//  Read a pipe to EOF -> one Uint8Array of everything it said.
function slurp(fd) {
  const parts = [], chunk = new Uint8Array(1 << 16);
  let total = 0, n;
  for (;;) {
    try { n = io.read(fd, chunk); } catch (e) { break; }
    if (n <= 0) break;
    parts.push(chunk.slice(0, n));
    total += n;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

//  Run a LISTER with its stdout on a pipe -> the NUL-framed bytes it named, or
//  null when git refused (it has already said why on our stderr).
function list(argv) {
  const ch = spawn(argv);
  io.close(ch.stdin);                       // a lister reads nothing
  const out = slurp(ch.stdout);
  io.close(ch.stdout);
  return reap(ch.pid, argv) === 0 ? out : null;
}

//  Run a STAGER with `bytes` on its stdin — the second half of the pipe the
//  ticket draws, as a second spawn, no shell between them.  -> its exit code.
function feed(argv, bytes) {
  const ch = spawn(argv);
  //  A child that died before reading answers on the reap, not here (SIGPIPE
  //  is ignored process-wide, so the write comes back EPIPE).
  try { io.writeAll(ch.stdin, bytes); } catch (e) {}
  io.close(ch.stdin);
  const said = slurp(ch.stdout);            // drain: never block a chatty git
  io.close(ch.stdout);
  if (said.length) io.writeAll(1, said);
  return reap(ch.pid, argv);
}

function count(bytes) {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) n++;
  return n;
}

//  --- the classes ----------------------------------------------------------
//  A class is its LISTER and its STAGER, both as argv PARAMETRISED on the repo,
//  since [BEE-040]'s descent spends the very same pair in every mounted sub.
function into(at) {
  return ["git", "-C", at, "add", "--pathspec-from-file=-", "--pathspec-file-nul"];
}
const CLASS = {
  //  `git add -u` swallows the deletions too, and those are `rm`'s to stage —
  //  hence the M filter (BEE-036:14).  `--ignore-submodules` keeps a DIRTY
  //  gitlink out of the class: bumping one is `sweep`'s own call ([BEE-040]).
  chg: { list: function (at) {
           return ["git", "-C", at, "diff", "--name-only", "--diff-filter=M",
                   "--ignore-submodules=all", "-z"]; },
         stage: into },
  add: { list: function (at) {
           return ["git", "-C", at, "ls-files", "--others", "--exclude-standard", "-z"]; },
         stage: into },
  del: { list: function (at) { return ["git", "-C", at, "ls-files", "--deleted", "-z"]; },
         stage: function (at) {
           return ["git", "-C", at, "update-index", "--remove", "-z", "--stdin"]; } }
};

//  --- the verbs ------------------------------------------------------------
//  ONE repo's class: list it, then feed the very same bytes to the stager.
//  -> how many it staged.  An empty class stages nothing and says nothing, so
//  a quiet sub cannot cascade a report line of its own ([BEE-040]).
function classIn(say, at, cl) {
  const lister = cl.list(at);
  const bytes = list(lister);
  if (bytes === null) throw "bee: " + say + ": git " + lister[3] + " refused";
  const n = count(bytes);
  if (n === 0) return 0;
  const stager = cl.stage(at);
  if (feed(stager, bytes) !== 0) throw "bee: " + say + ": git " + stager[3] + " refused";
  return n;
}

//  BEE-040: a BARE verb acts on the whole tree — every mount depth-first over
//  index/subs.js, grandchildren before the parent that records them.  Staging
//  inside a sub does NOT move its HEAD, so the parent's gitlink is bumped only
//  where the recorded sha and the sub's own HEAD already differ (a commit did it).
function sweep(say, at, cl) {
  let n = 0;
  for (const s of subs.mounts(at)) {
    if (!s.live) continue;                  // uninitialised: nothing of ours
    n += sweep(say, s.wt, cl) + classIn(say, s.wt, cl);
    if (s.head === null || s.head === s.sha) continue;
    if (run(["git", "-C", at, "add", "--", s.path]) !== 0)
      throw "bee: " + say + ": git add refused the gitlink " + s.path;
    n++;
  }
  return n;
}

//  A whole class over the WHOLE tree -> the one report line, its count summed
//  across every repo the sweep touched; an empty tree is a quiet no-op.
function whole(say, verb, at, cl) {
  const n = sweep(say, at, cl) + classIn(say, at, cl);
  return n === 0 ? "nothing to " + verb : say + " " + n + " staged";
}

//  Run a child to completion with our stdio INHERITED (fork.js:31) -> its exit
//  code.  Exported because BEE-037's history verbs spend the very same child.
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { throw "bee: cannot run " + argv[0] + " (" + e + ")"; }
  return reap(pid, argv);
}

//  The NAMED paths, verbatim: no list to pipe, so the child just inherits our
//  stdio (fork.js:31).  git takes them all or refuses in its own words, so the
//  count is the count of paths given.  A named file is ONE repo's file, so this
//  form never descends into a mount ([BEE-040] goal 3).
function some(verb, argv, n) {
  if (run(argv) !== 0) throw "bee: " + verb + ": git " + argv[3] + " refused";
  return verb + " " + n + " staged";
}

//  `bee add` — the modified-tracked class; `bee add +` — the untracked one;
//  `bee add <path>...` — the named files.  -> the one report line.
function add(args) {
  const at = root();
  if (args.length && args[0] === "+") {
    if (args.length > 1) throw "bee: usage: bee add [+ | <path>...]";
    return whole(ADD + " +", ADD, at, CLASS.add);
  }
  if (args.length)
    return some(ADD, ["git", "-C", at, "add", "--"].concat(args), args.length);
  return whole(ADD, ADD, at, CLASS.chg);
}

//  `bee add!` — everything ADDABLE in one move (ruling 2026-08-20, BEE-036 r2):
//  the edited class, then the untracked one, ONE summed report line; the
//  deletions stay `rm`'s, so the FILE panel's counts keep matching their reach.
function addAll(args) {
  if (args.length) throw "bee: usage: bee add! (no arguments)";
  const at = root();
  const n = sweep("add!", at, CLASS.chg) + classIn("add!", at, CLASS.chg)
          + sweep("add!", at, CLASS.add) + classIn("add!", at, CLASS.add);
  return n === 0 ? "nothing to add" : "add! " + n + " staged";
}

//  `bee rm` — the gone-on-disk class; `bee rm <path>...` — the named removals.
//  It stages the removal ONLY: the worktree is never touched, unlike `git rm`.
function rm(args) {
  const at = root();
  if (args.length)
    return some(RM, ["git", "-C", at, "update-index", "--remove", "--"].concat(args), args.length);
  return whole(RM, RM, at, CLASS.del);
}

//  BEE-037: `root`, `run` and `list` are the child-spawning floor sync.js stands
//  on, so the two verb files share one way of calling git and one way of reading
//  it back — never two.
module.exports = { add: add, addAll: addAll, rm: rm, ADD: ADD, RM: RM,
                   root: root, run: run, list: list };
