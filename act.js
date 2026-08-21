//  act.js — BEE-038: the MUTATION TABLE, the ONE place a writer verb registers.
//  main.js gives it the CLI word and pager.js gives it a clicked `O` spell
//  (`_actSpell`), so a new writer is one row here and its click-to-run comes
//  free.  Two words are SHAPE-SPLIT — `commit <rev>` and LITE-014's three-file
//  `merge` are door.js VIEWS, only the other shape writes — so a row may carry
//  a `shape` predicate and the verb NAME alone never decides.
"use strict";

//  A spell's arg WORDS, quotes respected: `commit 'a message'` must reach
//  sync.js as ONE arg at the `:` bar exactly as the shell makes it one on the CLI.
function wordsOf(rest) {
  const out = [];
  let cur = "", quote = "", quoted = false;
  for (const c of rest) {
    if (quote !== "") { if (c === quote) quote = ""; else cur += c; continue; }
    if (c === "'" || c === '"') { quote = c; quoted = true; continue; }
    if (c !== " " && c !== "\t") { cur += c; continue; }
    if (quoted || cur !== "") out.push(cur);
    cur = ""; quoted = false;
  }
  if (quoted || cur !== "") out.push(cur);
  return out;
}

//  BEE-037: a message can be neither a rev nor a path (sync.js messageOf), which
//  is what tells `commit`'s writing shape from view/commit.js's reading one.
function msgOf(args) { return require("sync.js").messageOf(args); }

//  THE TABLE: verb -> { run(args) -> the one report line, shape(args)? -> is
//  THIS shape the writing one }.  Every `run` is the call main.js made before,
//  and a throw is the refusal — git's own words already went to stderr.
const ACTS = {
  //  BEE-036 r2: add's FORCEFUL form is add EXTENDED — edited plus untracked
  //  in one move; the deletions stay `rm`'s.
  add:  { run: function (a) { return require("stage.js").add(a); },
          bang: function (a) { return require("stage.js").addAll(a); } },
  rm:   { run: function (a) { return require("stage.js").rm(a); } },
  push: { run: function (a) { return require("sync.js").push(a); } },
  pull: { run: function (a) { return require("sync.js").pull(a); } },
  fork: { run: function (a) { return require("fork.js").fork(a); } },
  //  BEE-043: the board's own pair — the KEY is the whole argument, so both are
  //  context-LESS spells and done.js resolves page and worktree itself.
  done: { run: function (a) { return require("done.js").done(a); } },
  dont: { run: function (a) { return require("done.js").dont(a); } },
  commit: { shape: function (a) { return msgOf(a) !== null; },
            run: function (a) { return require("sync.js").commit(msgOf(a)); } },
  //  LITE-014: git calls the merge DRIVER with three files, so the arg COUNT is
  //  what tells the history verb from the driver run (main.js runMerge).
  merge:  { shape: function (a) { return a.length === 0; },
            run: function (a) { return require("sync.js").merge(a); } },
};

//  A verb -> its row, or null when no writer owns the word; an own-property
//  test, so a file called `constructor` is a path like any other.
//  RULING (gritzko 2026-08-20): a trailing `!` on ANY verb word is the FORCEFUL
//  flag.  Dispatch only STRIPS it — the VERB interprets it via its row's own
//  `bang` runner, and one with no forceful reading refuses in one line rather
//  than guessing what force means for it.
function rowOf(verb) {
  const f = verb.length > 1 && verb.charAt(verb.length - 1) === "!";
  const name = f ? verb.slice(0, -1) : verb;
  const row = Object.prototype.hasOwnProperty.call(ACTS, name) ? ACTS[name] : null;
  if (row === null || !f) return row;
  return { shape: row.shape,
           run: row.bang ||
                function () { throw "bee: " + name + "!: no forceful form"; } };
}

//  BEE-041: a spell is the CLI LINE verbatim (main.js:264:eY contextOf), so a
//  leading bare `//name` is the CONTEXT the run stands in and never an arg —
//  which is how a board row's `add` stages the ROW's worktree and not the
//  board's own cwd.  -> { name, rest } or null when the spell opens with none.
function ctxOf(s) {
  if (s.slice(0, 2) !== "//") return null;
  const sp = s.indexOf(" ");
  if (sp < 0) return null;
  const w = require("index/mount.js").splitRooted(s.slice(0, sp));
  if (w === null || w.rel !== "") return null;
  return { name: w.name, rest: s.slice(sp + 1).trim() };
}

//  A spell (`<verb> <args>`) -> a thunk that RUNS it and answers the report
//  line, or null when the spell is no mutation IN THIS SHAPE — every door.js
//  view, and a bare path, land there and navigate as they always did.
function actOf(spell) {
  let s = String(spell === undefined || spell === null ? "" : spell).trim();
  const c = ctxOf(s);
  if (c !== null) s = c.rest;                    // BEE-041: the context slot
  if (s === "") return null;
  const sp = s.indexOf(" ");
  const row = rowOf(sp < 0 ? s : s.slice(0, sp));
  if (row === null) return null;
  const args = sp < 0 ? [] : wordsOf(s.slice(sp + 1));
  if (row.shape && !row.shape(args)) return null;
  return function () { return row.run(args); };
}

//  BEE-047: the VIEWS-vs-VERBS map — a word -> does it have a WRITING form at
//  all.  http.js and render/html.js ask THIS and never a list of their own, so
//  a new row above is clickable over http for free; a SHAPE-SPLIT word is true
//  here and its own `shape` gates the run (act.js:94, http.js actPost).
const WRITES = {};
for (const w in ACTS) WRITES[w] = true;

//  A spell -> the VERB word it names, the BEE-041 context slot and BEE-036's
//  forceful `!` both shed, so `//bee add` and `add!` alike answer `add`; "" when
//  the spell names no word.
function wordOf(spell) {
  let s = String(spell === undefined || spell === null ? "" : spell).trim();
  const c = ctxOf(s);
  if (c !== null) s = c.rest;
  const sp = s.indexOf(" ");
  const w = sp < 0 ? s : s.slice(0, sp);
  return w.length > 1 && w.charAt(w.length - 1) === "!" ? w.slice(0, -1) : w;
}

//  BEE-047: does this spell's word write in ANY shape?  The SHAPE is not asked
//  here — a painter must not run `commit`'s predicate (act.js:45) per face, and
//  a POST is gated by actOf below anyway.
function writes(spell) {
  const w = wordOf(spell);
  return w !== "" && Object.prototype.hasOwnProperty.call(WRITES, w);
}

//  Run the spell where the clicked hunk STANDS (BEE-003), which is what
//  door.js:527 openTarget does for a view spell.  -> the report line; null
//  means the spell was no mutation and the caller should navigate instead.
function run(spell, pos) {
  const fn = actOf(spell);
  if (fn === null) return null;
  //  BEE-041: a named context OUTRANKS the ambient the click came from — the
  //  arg names its repo more closely than the view does (door.js:75 rootArg).
  const c = ctxOf(String(spell).trim());
  if (c !== null) {
    const mnt = require("index/mount.js");
    const root = mnt.byName(c.name);
    if (root === null) throw mnt.noRepo(c.name);
    pos = { repo: root, path: "", anchor: "" };
  }
  if (typeof pos === "string") pos = pos === "" ? null : require("door.js").posOf(pos);
  if (pos === undefined || pos === null) return fn();
  return require("index/mount.js").within(pos, fn);
}

module.exports = { ACTS: ACTS, rowOf: rowOf, actOf: actOf, run: run,
                   ctxOf: ctxOf, wordsOf: wordsOf,
                   WRITES: WRITES, wordOf: wordOf, writes: writes };
