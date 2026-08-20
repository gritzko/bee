//  view/wtstat.js — BEE-027: what a board row ([BEE-025]) says about a ticket's
//  worktree.  The model is view/status.js's own ([BEE-022]) — this file adds a
//  memo and two frames, never a second status.  A HIT needs BOTH witnesses: the
//  rev of the tree standing still (index/cache.js) and the TIPS fingerprint, a
//  ref move living under the unwatched `.git` where no event can reach it.  Any
//  event under the tree drops the WHOLE entry (ruling: no per-block witnesses),
//  the memo holds only while a watcher is live, and nothing is persisted — a
//  one-shot CLI run computes once and remembers nothing.
"use strict";

const cache = require("index/cache.js");
const idx = require("index/index.js");
const refs = require("index/refs.js");
const st = require("view/status.js");
const quad = require("view/quad.js");
const subs = require("index/subs.js");
const theme = require("render/theme.js");

const MEMO = new Map();            // worktree root -> { rev, tips, v }
const SUBS = new Map();            // [BEE-040] sub worktree -> { rev, d }
const SC = { hits: 0, misses: 0 };

//  The witness the rev tree cannot give: the worktree's own tip and the tip it
//  tracks, both resolved through index/refs.js as `status` resolves them.
function tipsOf(root) {
  const gitdir = idx.gitdirOf(root);
  const hd = gitdir === null ? null : refs.head(gitdir);
  if (hd === null) return { tips: "?", sha: "", up: false };
  const up = refs.upstream(gitdir, hd.ref);
  //  BEE-042: whether a tracked tip EXISTS is the pair's own gate — a detached
  //  or untracked head has nowhere to push, pull or merge to.
  return { tips: hd.sha + "|" + (up ? up.sha : "") + "|" + hd.ref, sha: hd.sha,
           up: up !== null };
}

//  stat(root) -> { model, tip, up, un, st, staged, dirty } | null — the memoized
//  read plus the [BEE-039] split folded off its own rows.  An unreadable
//  worktree answers null and its frames blank out, never an error row.
function stat(root) {
  const tp = tipsOf(root);
  const rv = cache.rev(root);
  const hit = MEMO.get(root);
  if (hit !== undefined && hit.rev === rv && hit.tips === tp.tips) {
    SC.hits++;
    return hit.v;
  }
  SC.misses++;
  let v = null;
  try {
    const m = st.status("", { from: root }).model;
    const f = fold(m.rows);
    foldSubs(f, root);                     // [BEE-040]: the WHOLE tree's counts
    f.dirty = (f.un.chg + f.un.add + f.un.del) > 0;
    v = Object.assign({ model: m, tip: tp.sha, up: tp.up }, f);
  } catch (e) { v = null; }
  if (cache.live()) MEMO.set(root, { rev: rv, tips: tp.tips, v: v });
  return v;
}

//  --- the un/staged split ([BEE-039]) ---------------------------------------
//  The quad's five COLUMN counts say WHERE a change sits; a staging button
//  needs the other axis (be todo.js:493:TO UN_COL/ST_COL): UNSTAGED is what
//  `add`/`rm` acts on — column 4, the wt against the index — and STAGED what a
//  commit carries, column 3.  Either column classes the same three ways.
const COL = {};
COL[quad.CH.advanced] = "chg";
COL[quad.CH.created] = "add";
COL[quad.CH.removed] = "del";
const CHG = "chg";                 // where a column the quad under-tells lands

function blankFold() {
  return { un: { chg: 0, add: 0, del: 0 }, st: { chg: 0, add: 0, del: 0 },
           staged: 0, dirty: false };
}

//  fold(rows) -> the split, off the rows stat() already holds — never a second
//  git walk ([BEE-039] design).  A row can tally on BOTH axes (staged, then
//  edited again); a conflict is the one exclusive case, since there is no clean
//  stage entry behind it, so it counts as unstaged work whatever its columns say.
function fold(rows) {
  const f = blankFold();
  for (const r of (rows || [])) {
    if (r.con) { f.un.chg++; continue; }
    const w = r.quad.charAt(3), s = r.quad.charAt(2);
    if (w !== quad.CH.same) f.un[COL[w] || CHG]++;
    if (s !== quad.CH.same) { f.st[COL[s] || CHG]++; f.staged++; }
  }
  f.dirty = (f.un.chg + f.un.add + f.un.del) > 0;
  return f;
}

function addFold(f, d) {
  for (const c in d.un) f.un[c] += d.un[c];
  for (const c in d.st) f.st[c] += d.st[c];
  f.staged += d.staged;
}

//  BEE-040: the FILE counts are the WHOLE TREE's, because bare `add`/`rm`
//  descend every mount (stage.js:130 sweep) — a top-repo-only tally under-
//  reported each one.  Depth-first over index/subs.js, one status read per live
//  mount, and a sub whose rev stands still REPLAYS its last tally (be's STATUS-019).
function foldSubs(f, root) {
  for (const s of subs.mounts(root)) {
    if (!s.live) continue;                 // uninitialised: it tallies nothing
    const rv = cache.rev(s.wt);
    const had = SUBS.get(s.wt);
    if (had !== undefined && had.rev === rv) { addFold(f, had.d); continue; }
    const d = blankFold();
    //  An unreadable sub tallies nothing and never errors the row.
    try { addFold(d, fold(st.status("", { from: s.wt }).model.rows)); } catch (e) {}
    foldSubs(d, s.wt);                     // then its own grandchildren
    if (cache.live()) SUBS.set(s.wt, { rev: rv, d: d });
    addFold(f, d);
  }
}

//  --- the two frames --------------------------------------------------------
//  Geometry is be's CI-004 (todo.js:721:TO), so no column moves when [BEE-041]'s
//  buttons land: the FILE frame's last slot is held for the run button, the
//  COMMIT frame's last is the post ✓, and the old tip cell retired with them.
//  Faces and sigils are theme data (render/theme.js:117:4o), never literals here.
const FRAMEW_FILE = 16, FRAMEW_COMMIT = 13, SLOTW = 2;
const PAIRW = SLOTW * 2 + 1;       // a diverged `A⇄B` spans both slots and the gap
const BLANK = "  ";
const FACE = theme.BTN_FACE, SIG = theme.BTN_SIGIL;

//  One 2-cell count, be's THREE-STATE rule (todo.js:786:TO countSlot): rows left
//  to stage show the UNSTAGED number, a wholly staged class shows the STAGED
//  one, an empty class blanks.  Which of the two is LIT is paint ([BEE-041]).
function slot(sigil, un, st) {
  if (un > 0) return theme.countFace(sigil, un);
  if (st > 0) return theme.countFace(sigil, st);
  return BLANK;
}

const ZERO3 = { chg: 0, add: 0, del: 0 };

//  BEE-041: one CELL of the FILE frame — `t` its bytes, `k` what it is (`br`
//  bracket, `gap`, `blank`, `btn` a lit button, `info` a colour with no click),
//  `n` its theme class and `s` its spell.  The frame is cut ONCE, here, so the
//  plain string and the pager's clickable panel can never drift apart.
function cell(t, k, n, s) { return { t: t, k: k, n: n || "", s: s || "" }; }

//  BEE-041: be's THREE-STATE slot (todo.js:786:TO countSlot) — rows left to stage
//  LIGHT the button (the unstaged count, wash and spell), a wholly staged class
//  keeps its colour but sheds both (info), an empty class blanks.
function countCell(sigil, un, st, name, ctx, verb) {
  const t = slot(sigil, un, st);
  if (un > 0) return cell(t, ctx ? "btn" : "info", name, ctx ? ctx + " " + verb : "");
  return st > 0 ? cell(t, "info", name) : cell(t, "blank");
}

//  `[ i ~2 -1 +1   ]` — the staging surface: the status face, then chg/del/add
//  in be's own order, then the slot the run button will take.  An unreadable
//  worktree blanks the counts rather than making an error row.
//  BEE-041: `wt` is the `//name` word the buttons act in (index/mount.js:118:pc).
//  A VIEW resolves its own ARG (door.js:78 rootArg), a WRITER takes the CLI's
//  context slot (main.js:264:eY), so ` i` names the wt after the verb and the three
//  class buttons before it.  No word (an unnameable worktree): no spell at all.
function fileCells(s, wt) {
  const un = (s && s.un) || ZERO3, sg = (s && s.st) || ZERO3;
  const ctx = wt ? "//" + wt : "";
  return [
    cell("[", "br"),
    cell(FACE.status, ctx ? "btn" : "info", "status", ctx ? "status " + ctx : ""),
    cell(" ", "gap"),
    countCell(SIG.chg, un.chg, sg.chg, "chg", ctx, "add"),
    cell(" ", "gap"),
    countCell(SIG.del, un.del, sg.del, "del", ctx, "rm"),
    cell(" ", "gap"),
    countCell(SIG.add, un.add, sg.add, "add", ctx, "add +"),
    cell(" ", "gap"),
    cell(BLANK, "blank"),                    // held for [BEE-044]'s run button
    cell("]", "br")];
}

function fileFrame(s) {
  let out = "";
  for (const c of fileCells(s, "")) out += c.t;
  return out;
}

//  BEE-042: ONE slot of the ahbeh pair — a count the row can act on LIGHTS its
//  button, a count no spell can name greys DEAD (be todo.js:608:TO), an empty slot
//  blanks.  `ctx` is the acting `//name` word, "" where there is no live act.
function histCell(t, name, ctx, verb) {
  if (t === BLANK) return cell(t, "blank");
  return ctx ? cell(t, "btn", name, ctx + " " + verb) : cell(t, "dead");
}

//  BEE-042: act.js:10:aj wordsOf knows no ESCAPE, so a message is quoted with the
//  mark it does not itself carry; one carrying both loses the strays, which
//  beats splitting the message into two args at the `:` bar.
function quoted(m) {
  const q = m.indexOf("'") < 0 ? "'" : '"';
  return q + m.split(q).join("") + q;
}

//  `[ ≡ +2 -1  ✓]` — the history surface, cut into cells as the FILE frame is
//  ([BEE-041]): the ahbeh pair is POSITIONAL (push slot, then pull slot), since
//  the quad spells either as `created` and only the column tells them apart
//  (view/quad.js:78:3B).  A DIVERGED pair is ONE `merge` over both slots and
//  their gap; the ✓ shows iff staged — never a grey one (be 2026-08-03) — and
//  carries `msg`, the message the ROW mints (view/todo.js:508:TO).
function commitCells(s, wt, msg) {
  let a = 0, b = 0;
  if (s) for (const c of s.model.commits) { if (c.quad === ".o..") a++; else b++; }
  const ctx = wt ? "//" + wt : "";
  const act = s && s.up ? ctx : "";        // no tracked tip: the pair is dead
  const pair = a && b
    ? [histCell((Math.min(a, 99) + "⇄" + Math.min(b, 99)).padStart(PAIRW, " "),
                "merge", act, "merge")]
    : [histCell(slot("+", a, 0), "push", act, "push"),
       cell(" ", "gap"),
       histCell(slot("-", b, 0), "pull", act, "pull")];
  const ci = s && s.staged > 0
    ? cell(FACE.commit, ctx && msg ? "btn" : "info", "commit",
           ctx && msg ? ctx + " commit -m " + quoted(msg) : "")
    : cell(BLANK, "blank");
  return [cell("[", "br"),
          //  A VIEW resolves its own ARG (door.js:78 rootArg), so ` ≡` NAMES
          //  the worktree after the verb where the writers take it as context.
          cell(FACE.log, ctx ? "btn" : "info", "log", ctx ? "log " + ctx : ""),
          cell(" ", "gap")].concat(pair,
         [cell(" ", "gap"), ci, cell("]", "br")]);
}

function commitFrame(s) {
  let out = "";
  for (const c of commitCells(s, "", "")) out += c.t;
  return out;
}

//  frames(root) -> { file, commit }, the two fixed-width strings a row carries.
//  Plain text throughout — the button FACES, never paint — so a `--plain`
//  board stays greppable; the clickable twins are `fileCells` ([BEE-041]) and
//  `commitCells` ([BEE-042]), which cut the very same bytes.
function frames(root) {
  const s = stat(root);
  return { file: fileFrame(s), commit: commitFrame(s) };
}

//  One line per worktree, the `bee wts` row and [BEE-025]'s row material: the
//  `//name-tail` word `bee fork` was given, then the two frames.
function line(wt) {
  const f = frames(wt.root);
  return wt.name + "-" + wt.tail + " " + f.file + " " + f.commit;
}

function stats() {
  return { entries: MEMO.size, subs: SUBS.size, hits: SC.hits,
           misses: SC.misses, live: cache.live() };
}

module.exports = { stat: stat, frames: frames, line: line, stats: stats,
                   cell: cell,       // BEE-043: view/todo.js cuts a panel too
                   fileFrame: fileFrame, fileCells: fileCells,
                   commitFrame: commitFrame, commitCells: commitCells,
                   quoted: quoted, slot: slot,
                   fold: fold, blankFold: blankFold, foldSubs: foldSubs,
                   FRAMEW_FILE: FRAMEW_FILE, FRAMEW_COMMIT: FRAMEW_COMMIT,
                   SLOTW: SLOTW, PAIRW: PAIRW };
