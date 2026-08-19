//  main.js — Beagle-bee (LITE-003): DISPATCH and ONE mode pick.
//
//  A word that names a verb goes to door.js's view for it; every other arg is a
//  file or dir path.  Then the mode: at a terminal with no flag the hunks go to
//  pager.js, otherwise a renderer writes their bytes to stdout.  That is
//  the whole file — no view builds a hunk here and no renderer spells a byte.
//
//  LITE-018: with ZERO args INSIDE a git repo there is no fs story to tell —
//  `bee` indexes the repo and opens the `list` browser on its root.  Outside
//  one it is the old no-arg behaviour, untouched.
//
//  Exit is by THROW, never process.exit: the runtime maps an uncaught throw to
//  the non-zero exit (BE-002 discipline — no args → BROUSAGE, args but none
//  opened → BRONONE).
"use strict";

//  LITE-045: main.js is DISPATCH + the one mode pick.  The door (targets ->
//  hunks) is door.js; the renderers are render/* and `renderOf` picks one.
const door = require("door.js");
//  BEE-023: the repo a `//name` word names, and the words a miss gets.
const mnt = require("index/mount.js");

function writeFd(fd, bytes) {
  const b = io.buf(bytes.length + 8);
  b.feed(bytes);
  io.writeAll(fd, b);
}

function writeStderr(str) { writeFd(2, utf8.Encode(str)); }

//  LITE-045: the FS LEG as a view like any other — `(paths) -> hunks`, one per
//  arg, a miss reported on stderr and skipped so a batch still yields what it
//  could open.  Its `arg` is the path LIST (paths carry spaces, so they never
//  fuse into one string the way a verb's words do); every other view takes the
//  words joined.
function pathView(paths) {
  let hunks = [];
  for (const p of paths) {
    const hs = door.openPath(p);
    if (hs !== null) { hunks = hunks.concat(hs); continue; }
    //  BEE-023:27 a `//name/rel` whose name is nowhere is refused by NAME, so
    //  the reader learns it is the repo that is missing, not the file.
    const sp = mnt.splitRooted(p);
    if (sp !== null && mnt.byName(sp.name) === null) writeStderr(mnt.noRepo(sp.name) + "\n");
    else writeStderr("cannot open " + p + "\n");
  }
  return hunks;
}

//  LITE-006: `bee index [<repo>]` brings `<repo>/.git/be/` up to date and
//  prints one summary line.  The verbs stand BEFORE the flag scan because
//  every other arg is a path, verbatim.
//  BEE-007: it runs BOTH passes — the commit walk and the LITE-033 link round
//  over the tip blobs — each off its own mark, both on the one summary line.
function runIndex(args) {
  const idx = require("index/index.js");
  //  BEE-023: with a `//name` context the run STANDS there, so that is the
  //  repo an argless `index` brings up; `mnt.at()` is the cwd without one.
  const rec = idx.index(args.length ? args[0] : mnt.at());
  writeFd(1, utf8.Encode(idx.summary(rec) + "\n"));
}

//  LITE-033: `bee lindex [<target>]` — the BACKLINK SUSPECTS of the index index.
//  BEE-007: this is the QUERY form; `bee index` is the bring-up for both halves.
//  Bare, it brings the LINK rows up to the tip (only the blobs the tip moved are
//  tokenised) and prints one summary line.  With a target — a path, a partial
//  one, or a ticket code — it prints the paths that MAY link to it, one per
//  line.  Suspects, not proof: a stale row is legal and the caller kills it by
//  opening the file, which is what keeps the index append-only.
function runLindex(args) {
  const li = require("index/lindex.js");
  //  A mode flag is a no-op here — plain lines either way, no hunk to page.
  const rest = args.filter(function (a) { return modeOf(a) === null; });
  const out = li.lindex(rest.length ? rest.join(" ") : undefined);
  if (out.paths === null) {
    writeFd(1, utf8.Encode(li.summary(out.rec) + "\n"));
    return;
  }
  if (out.paths.length) writeFd(1, utf8.Encode(out.paths.join("\n") + "\n"));
}

//  LITE-014: `bee merge <base> <ours> <theirs> [-o <out>] [-p <path>]` — the
//  git merge-driver contract (result over <ours>, exit code = clean/conflict),
//  and `bee install [<repo>]` which points a repo's git at it.  Both are silent
//  on success bar install's one report line; a conflict THROWS (exit 1).
function runMerge(args) { require("merge.js").merge(args); }

function runInstall(args) {
  const mg = require("merge.js");
  writeFd(1, utf8.Encode(mg.install(args.length ? args[0] : mnt.at()) + "\n"));
}

//  LITE-026: `bee hook [<repo>]` — the PRE-COMMIT pass the planted
//  `.git/hooks/pre-commit` runs: fresh `file:line(:col)` refs in the staged text
//  become [LITE-025] permalinks, and the rewritten files are re-staged.  It
//  reports on the message stream only, so a commit's own output stays clean.
function runHook(args) {
  const note = require("index/hook.js").precommit(args.length ? args[0] : mnt.at());
  if (note) writeStderr(note + "\n");
}

//  BEE-016: `bee mint [--dry-run] <file>...` — the VERB half of the minter: the
//  transient `file:line(:col)` refs of the NAMED files become permalinks, in the
//  working copy alone.  The hook only ever sees a commit in flight, so refs that
//  landed transient are reachable no other way ([BEE-015]).  Its arg is the path
//  LIST, unfused — `bee mint view/*.js` is what the shell globbed, verbatim.
function runMint(args) {
  const rest = args.filter(function (a) { return modeOf(a) === null; });
  const r = require("index/mint.js").mint(rest);
  if (r.usage) {
    writeStderr("Usage: bee mint [--dry-run] <file>...\n");
    throw "BROUSAGE";
  }
  if (r.err) writeStderr(r.err);
  if (r.out) writeFd(1, utf8.Encode(r.out));
}

//  `bee mark <file.mkd>` — ONE rendered page on stdout, the beagle mark CLI's
//  job (beagle/mark/README.mkd) with the writing left to the shell.  Its arg is
//  the path LIST, unfused, like `mint`'s.
function runMark(args) {
  const rest = args.filter(function (a) { return modeOf(a) === null; });
  writeFd(1, utf8.Encode(require("view/mark.js").mark(rest)));
}

//  LITE-034: `bee http [--port <n>]` — the repo browser over HTTP, the same
//  views the pager shows.  A LONG-RUNNING verb: this returns once the listener
//  is up and the pol loop takes over, until SIGINT.
//  The whole DOOR is handed over — the verb table AND the reference resolution
//  — so http links through this file's code and owns no resolver of its own.
function runHttp(args) {
  //  BEE-012: `openTarget` rides along — the chooser page is the door's own
  //  several-hits hunk, the one the pager shows.
  require("http.js").http(args, { verbs: door.VERBS, seatOf: door.seatOf,
                                          statOf: door.statOf,
                                          openPath: door.openPath,
                                          openTarget: door.openTarget });
}

//  LITE-016: `bee chat [dir] [outdir]` renders the Claude Code session logs of
//  a project dir as StrictMark pages, 1:1 by basename, append-only on a rerun.
//  It reports on the message stream only, so stdout stays free.
function runChat(args) { require("chat.js").chat(args); }

//  LITE-019: `bee now` — the ron60 clock.  Bare, the CURRENT stamp as RON64
//  text; with a word, that stamp's calendar date.  CLI-only, not in the door.
function runNow(args) {
  //  LITE-019: a mode flag is a no-op here — one line, plain either way.
  const rest = args.filter(function (a) { return modeOf(a) === null; });
  const line = rest.length ? ron60ISO(rest[0]) : ron60Text(ron.now());
  writeFd(1, utf8.Encode(line + "\n"));
}

//  LITE-019: ALL ten digits — ron.encode drops the LEADING zeros (a 200x year)
//  and the trailing two ARE the ms, so neither end may go missing.
function ron60Text(v) { return ron.encode(v).padStart(10, "0"); }

function pad(n, w) { let s = String(n); while (s.length < w) s = "0" + s; return s; }

//  LITE-019: a ron60 word -> `20YY-MM-DDThh:mm:ss.mmm`.  A SHORT word is
//  LEFT-aligned (ron60Norm: `26812` reads `2681200000`), then unpacked digitwise.
function ron60ISO(word) {
  const bad = "now: not a ron60 timestamp: " + word;
  if (!/^[0-9A-Z_a-z~]{1,10}$/.test(word)) throw bad;
  const v = ron.decode(word + "0".repeat(10 - word.length));
  //  RONOfTime's layout: [y/10][y%10][mon][dd/10][dd%10][hh][mm][ss][ms/64][ms%64],
  //  digit 9 first — the shift-and-mask is the whole unpack.
  const d = [];
  for (let i = 0; i < 10; i++) d.push(Number((v >> BigInt(6 * i)) & 63n));
  const day = d[6] * 10 + d[5], ms = d[1] * 64 + d[0];
  //  LITE-019: an out-of-range field is a refusal — bar the MS slot, where a
  //  spelling past the second is real (ron60Inc) and clamps, as RONToTime does.
  if (d[9] > 9 || d[8] > 9 || d[7] < 1 || d[7] > 12 || d[6] > 3 || d[5] > 9 ||
      day < 1 || day > 31 || d[4] > 23 || d[3] > 59 || d[2] > 59) throw bad;
  return String(2000 + d[9] * 10 + d[8]) + "-" + pad(d[7], 2) + "-" + pad(day, 2) +
         "T" + pad(d[4], 2) + ":" + pad(d[3], 2) + ":" + pad(d[2], 2) +
         "." + pad(ms > 999 ? 999 : ms, 3);
}

//  LITE-018: is the cwd inside a git repository?  The probe is `openRepo`'s own
//  — the climb every bee view does — and it is a probe ONLY: it closes what it
//  opened and lets `list` open the repo for real, so no error of the view's is
//  swallowed here.  No repo (or no HEAD yet) -> false, and bare `bee` stays
//  today's filesystem story to the byte.
function inRepo() {
  const idx = require("index/index.js");
  let ctx = null;
  try { ctx = idx.openRepo(io.cwd(), true); } catch (e) { return false; }
  idx.closeRepo(ctx);
  return true;
}

//  Hand a hunk list to the pager on the CONTROLLING terminal (the runPager
//  edge, shared so there is ONE tty lifecycle).  The door is openTarget for
//  every view: the pager stays arg-blind, the target names its own verb.
function pageHunks(hunks) {
  const pager = require("pager.js");
  let fd = null, own = false;
  try { fd = io.open("/dev/tty", "rw"); own = true; } catch (e) { fd = null; }
  if (fd === null && io.isatty(0)) fd = 0;
  if (fd === null) fd = 1;
  try {
    const p = new pager.Pager(fd, { color: true, open: door.openTarget });
    p.setHunks(hunks);
    p.run();
  } finally { if (own) { try { io.close(fd); } catch (e) {} } }
}

//  The verbs that write their own lines and build no hunks at all — nothing to
//  page, nothing to render, so they stand outside the view/renderer axes.
//  LITE-045: `--plain`/`--color`/`--html` are no-ops for them (one line either
//  way), but they are still FLAGS and never a verb's argument.
const SIDE = {
  index: runIndex, lindex: runLindex, merge: runMerge, install: runInstall,
  hook: runHook, chat: runChat, http: runHttp, now: runNow, mint: runMint,
  mark: runMark,
};

//  BEE-023:24 the CLI is TRIPARTITE — `bee [//context] verb args`.  The context
//  slot is POSITIONAL and FIRST, so `bee todo //x` is a verb with a path arg and
//  nothing here looks ahead; the repo it names is where the whole run stands.
function main(argv) {
  const argl = argv.slice(2);
  const root = contextOf(argl);
  if (root === null) return run(argl, null);
  argl.shift();
  return mnt.within({ repo: root, path: "", anchor: "" },
                    function () { return run(argl, root); });
}

//  The repo a leading `//name` (no further slash) names, or null when the first
//  word is no such word.  A name that resolves nowhere ENDS the run in words:
//  creating it is BEE-026's verb, and no verb here guesses at it.
function contextOf(argl) {
  const sp = argl.length ? mnt.splitRooted(argl[0]) : null;
  if (sp === null || sp.rel !== "") return null;
  const r = mnt.byName(sp.name);
  if (r !== null) return r;
  writeStderr(mnt.noRepo(sp.name) + "\n");
  throw "BRONONE";
}

function run(argl, from) {
  const word = argl.length ? argl[0] : "";
  if (Object.prototype.hasOwnProperty.call(SIDE, word))
    return SIDE[word](argl.slice(1));

  //  ---- the ONE flag scan ------------------------------------------------
  //  Three MODE flags and nothing else; every other word is the view's arg,
  //  verbatim (a verb's words fuse, a path list does not).
  let view = door.verbOf(word);
  const rest = [];
  const flags = {};
  for (const a of (view ? argl.slice(1) : argl))
    { const m = modeOf(a); if (m) flags[m] = true; else rest.push(a); }

  //  ---- the ONE mode pick -------------------------------------------------
  //  A terminal with NO mode flag pages (the pager is an app, not a renderer);
  //  anything else picks a renderer and writes its bytes to stdout.
  const paged = !flags.plain && !flags.color && !flags.html && io.isatty(1);
  const render = paged ? null : renderOf(flags);

  const opts = {};
  if (from !== null) opts.from = from;         // BEE-023: the context slot
  let arg = rest.join(" ");
  if (view === null) {
    //  LITE-018: ZERO args inside a git repo == `bee index && bee list`, one
    //  process.  `list` owns the bring-up, so the index is built (visibly, on
    //  stderr) strictly before the pager takes the tty, and `track` makes this
    //  run the `index` half proper — the repo joins the repo list.
    //  BEE-023:38 with a context that is the same story in THAT repo — and a
    //  `$SRC_ROOT` hit is a read-only mount, so a context never registers one.
    if (rest.length === 0 && (from !== null || inRepo())) {
      view = door.VERBS.list;
      if (from === null) opts.track = true;
    }
    else { view = pathView; arg = rest; }         // the fs leg: the path LIST
  }

  if (paged) {                                     // no args → an empty viewport
    const hunks = view(arg, opts);
    if (hunks.length || view === pathView) pageHunks(hunks);
    return;
  }
  if (view === pathView && rest.length === 0) {
    writeStderr("Usage: bee [--plain|--color|--html] <path>...\n");
    throw "BROUSAGE";
  }
  opts.full = true;                                // a pipe has no viewport
  const hunks = runVerb(view, arg, render, opts);
  if (view === pathView && hunks.length === 0) throw "BRONONE";
}

//  ---- THE mode axis (LITE-045) --------------------------------------------
//  The three sinks a run can end in, one flag each.  A renderer is verb-blind
//  and a view is renderer-blind, so ADDING one is one file under render/ plus
//  one row here — no view knows it happened.
const MODES = { "--plain": "plain", "--color": "color", "--html": "html" };

//  A word -> the mode it names, or null.  An own-property test, so a file
//  called `constructor` is an argument like any other word.
function modeOf(word) {
  return Object.prototype.hasOwnProperty.call(MODES, word) ? MODES[word] : null;
}

//  The pick itself, required LAZILY: a `--plain` run never loads the HTML
//  painter and its stylesheet tables, nor the ansi one.
function renderOf(flags) {
  if (flags.html) return require("render/html.js").render;
  if (flags.color) return require("render/ansi.js").render;
  return require("render/plain.js").render;
}

//  ---- THE non-interactive leg (LITE-045) ----------------------------------
//  A view `(arg, opts) -> hunks` and a renderer `(hunks, opts) -> bytes`: every
//  piped or flagged run in bee is this ONE call.  The five bespoke plain legs
//  it replaced (a path, a log, a commit, a diff, a read view) differed only in
//  the hunks they made, never in how those hunks reached stdout.
function runVerb(view, arg, render, opts) {
  const hunks = view(arg, opts);
  const bytes = render(hunks, opts);
  if (bytes.length) writeFd(1, bytes);
  return hunks;
}

if (typeof module !== "undefined")
  module.exports = { main: main, inRepo: inRepo,
                     ron60ISO: ron60ISO, ron60Text: ron60Text };
if (process.argv[1] && process.argv[1].slice(-"/main.js".length) === "/main.js")
  main(process.argv);
