//  done.js — BEE-043: `done KEY…` and `dont KEY…`, the two acts that CLOSE a
//  ticket (be verbs/done/done.js ported).  Each key is TWO moves: the page's
//  `Now:` pair becomes DONE / DONT — bee's first meta-tree WRITE, a head-scoped
//  line edit and never a body-wide replace — and the ticket's worktree, when it
//  owns one, RETIRES to `$SRC_ROOT/done/` with git's back-pointers repaired
//  (ruling gritzko 2026-08-20, BEE-043:10).  Nothing is ever deleted and nothing
//  is ever committed: review and landing stay with the user (/meta/work).
//  act.js registers both words, so a board row's ` ✓` and ` ✗` run them.
"use strict";

const todo = require("view/todo.js");
const kv = require("index/kv.js");
const mnt = require("index/mount.js");
const idx = require("index/index.js");
const wts = require("index/wts.js");
const subs = require("index/subs.js");
const front = require("mark/front.js");

const DONE = "DONE", DONT = "DONT";
const INDENT = "    ";             // the house indent a pair-less page takes
const DONE_ROOT = wts.DONE_ROOT;   // BEE-043: where a retired worktree parks

//  --- the file ---------------------------------------------------------------
//  The WHOLE page, uncapped: view/todo.js reads a head, this rewrites a file, so
//  a long page may never come back short.  null = there is no page here.
function readText(file) {
  let st;
  try { st = io.lstat(file); } catch (e) { return null; }
  if (st.kind !== "reg") return null;
  if (Number(st.size) === 0) return "";
  try { return utf8.Decode(io.mmap(file, "r").data()); } catch (e) { return null; }
}

//  Mode "c" keeps an existing file's permissions and truncates (merge.js:27:rE).
function writeText(file, text) {
  const bytes = utf8.Encode(text);
  let fd;
  try { fd = io.open(file, "c"); }
  catch (e) { throw "bee: cannot write " + file + " (" + e + ")"; }
  try {
    const b = io.buf(bytes.length + 8);
    b.feed(bytes);
    io.writeAll(fd, b);
  } finally { try { io.close(fd); } catch (e) {} }
}

function there(p) { try { io.lstat(p); return true; } catch (e) { return false; } }

//  --- the page ---------------------------------------------------------------
//  The boards this run can reach, the local one first then every registered
//  repo: the board's OWN fan-out (view/todo.js:182:TO rootsOf) asked to widen,
//  since a `done KEY` click carries no context (BEE-043:17).
function pageOf(key) {
  for (const bd of todo.rootsOf({ all: true })) {
    const file = todo.pageFile(bd.dir, key);
    if (file !== null) return { file: file, bd: bd };
  }
  return null;
}

//  The header line's index — the first non-blank line under any YAML preamble
//  (mark/front.js:13:vZ bodyLine), which is where kv.js starts reading too; -1 when
//  the page has no line at all.
function headLine(lines) {
  for (let i = front.bodyLine(lines); i < lines.length; i++)
    if (lines[i].trim() !== "") return i;
  return -1;
}

//  The header's TITLE, its `#` run and padding stripped (view/todo.js:97:TO head).
function titleOf(ln) {
  let j = 0;
  while (ln.charAt(j) === "#") j++;
  while (ln.charAt(j) === " ") j++;
  return ln.slice(j);
}

//  Is this head one this verb refuses to touch?  A page closes by its own
//  header: no header line, or one naming another ticket, and the edit would be
//  a guess — so it is reported and skipped, never rewritten (be BE-040 r2).
function oddHead(key, lines, hl) {
  if (hl < 0) return true;
  return titleOf(lines[hl]).indexOf(key) !== 0;
}

//  TODO-013: be spliced a SECOND column-0 pair here and re-wrote a legacy
//  `[DONE]` title mark — this verb touches the pair's own line and nothing else.
//  The FIRST `Now:` pair's line is rewritten at the indent it was found at; a
//  page carrying none takes one under the header (BEE-043:39); kv.js owns the grammar.
function setNow(text, mark, hl) {
  const lines = text.split("\n");
  const block = kv.metaPairs(lines);
  for (const p of block)
    if (p.key === "Now") {
      lines[p.line] = p.indent + "Now: " + mark;
      return lines.join("\n");
    }
  const at = block.length ? block[0].line : hl + 1;
  lines.splice(at, 0, (block.length ? block[0].indent : INDENT) + "Now: " + mark);
  return lines.join("\n");
}

//  --- the worktree -----------------------------------------------------------
//  Run a child to completion, inheriting stdio (fork.js:31 run) -> its exit code.
function run(argv) {
  let pid;
  try { pid = io.spawnFds(argv[0], argv, -1, -1); }
  catch (e) { return -1; }
  let rc;
  try { rc = io.reap(pid); } catch (e) { return -1; }
  return rc.signal != null ? 128 + rc.signal : (rc.code | 0);
}

//  `git worktree repair` INSIDE the moved tree, then in every gitlink of it.
//  The tree's own `.git` leg still names the repo that knows it, so each run
//  finds THAT repo and re-points its `gitdir` back — which is how fork.js:94's
//  per-gitlink sub worktrees repair, each through its own sub repo.
//  CODE-042: the child's status is the answer — the FIRST failure names the
//  tree and the command, since a swallowed one leaves a broken back-pointer.
function repair(dir) {
  const rc = run(["git", "-C", dir, "worktree", "repair"]);
  let why = rc === 0 ? "" : "git -C " + dir + " worktree repair failed (rc " + rc + ")";
  for (const s of subs.mounts(dir)) if (s.live) {
    const w = repair(s.wt);
    if (why === "") why = w;
  }
  return why;
}

//  Move the worktree to the done root.  `git worktree move` is the first leg,
//  but it REFUSES a tree holding submodules — and fork.js gives every gitlink
//  one — so the rename plus repair is the normal leg for a forked worktree, and
//  the plain rename preserves dirty work either way.  -> "" or what went
//  wrong: the rename's refusal, or CODE-042's failed repair.
function moveWt(from, dest) {
  const main = idx.mainOf(from);
  if (subs.mounts(from).length === 0 && main !== from &&
      run(["git", "-C", main, "worktree", "move", from, dest]) === 0) return "";
  try { io.rename(from, dest); }
  catch (e) { return "cannot move " + from + " to " + dest + " (" + e + ")"; }
  return repair(dest);
}

//  The worktree a ticket KEY owns — the board's own match, the scanned tail read
//  as a code (view/todo.js:443:TO wtsOf), first hit wins; null when it owns none.
function wtOf(key) {
  for (const w of wts.scan()) {
    const tail = w.tail;
    if ((todo.shape(tail) === "key" ? tail : todo.ticketKey(tail)) === key) return w;
  }
  return null;
}

//  Retire the key's worktree, when it has one: `$SRC_ROOT/done/<name>`, the root
//  made on demand and a name collision bumping `.2`, `.3`, … — nothing is ever
//  clobbered and nothing deleted.  A refusal is LOUD and the page flip stands.
function retire(key, rows, verb) {
  const wt = wtOf(key);
  if (wt === null) return;                     // no worktree: nothing to retire
  const name = mnt.basename(wt.root);
  const root = mnt.srcRoot() + "/" + DONE_ROOT;
  try { io.mkdir(root); } catch (e) {}         // FILEMakeDirP: idempotent
  let dest = root + "/" + name;
  for (let n = 2; there(dest); n++) dest = root + "/" + name + "." + n;
  const why = moveWt(wt.root, dest);
  if (why !== "") {
    io.log(verb + ": " + key + ": " + why + "\n");
    rows.push(key + " " + why + " — the page is closed all the same");
    return;
  }
  rows.push("mov " + name + " -> " + dest);
}

//  --- the verb ---------------------------------------------------------------
//  BE-003's spirit: ONE uniform miss line, then throw (view/todo.js:809:TO miss).
function miss(verb, arg) {
  io.log(verb + ": " + arg + ": TODONONE\n");
  throw "TODONONE";
}

//  Close ONE key: the `Now:` flip, then the worktree.  Every answer is a ROW —
//  an odd head reports VISIBLY (be BE-040 r2: a rowless run answered a pager
//  click with nothing, io.log never reaching the screen).
function closeOne(key, mark, verb, rows) {
  if (todo.shape(key) !== "key") miss(verb, key);
  const page = pageOf(key);
  if (page === null) miss(verb, key);
  const text = readText(page.file);
  if (text === null) miss(verb, key);
  const lines = text.split("\n");
  const hl = headLine(lines);
  if (oddHead(key, lines, hl)) {
    const head = hl < 0 ? "(empty page)" : lines[hl];
    io.log(verb + ": " + key + ": odd head, skipped: " + head + "\n");
    rows.push(key + ": odd head, skipped: " + head);
    return;
  }
  const bare = todo.bareTitle(key, titleOf(lines[hl]));
  const out = setNow(text, mark, hl);
  //  Idempotent: a page already carrying this state is not rewritten at all,
  //  and its bytes are left exactly as the user last saw them.
  if (out === text) { rows.push(key + " (already closed)"); retire(key, rows, verb); return; }
  writeText(page.file, out);
  rows.push(key + " " + mark + " " + bare);
  retire(key, rows, verb);
}

//  done(args) / dont(args) -> the report, one row per key.  main.js:104:eY prints one
//  LINE, so the rows join on newlines and the pager flattens them to its bar.
function close(args, mark, verb) {
  if (!args.length) throw "bee: usage: bee " + verb + " KEY…";
  const rows = [];
  for (const a of args) closeOne(String(a), mark, verb, rows);
  return rows.join("\n");
}

function done(args) { return close(args, DONE, "done"); }
function dont(args) { return close(args, DONT, "dont"); }

module.exports = { done: done, dont: dont, setNow: setNow, oddHead: oddHead,
                   pageOf: pageOf, wtOf: wtOf, headLine: headLine,
                   DONE: DONE, DONT: DONT, DONE_ROOT: DONE_ROOT };
