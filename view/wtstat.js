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

const MEMO = new Map();            // worktree root -> { rev, tips, v }
const SC = { hits: 0, misses: 0 };

//  The witness the rev tree cannot give: the worktree's own tip and the tip it
//  tracks, both resolved through index/refs.js as `status` resolves them.
function tipsOf(root) {
  const gitdir = idx.gitdirOf(root);
  const hd = gitdir === null ? null : refs.head(gitdir);
  if (hd === null) return { tips: "?", sha: "" };
  const up = refs.upstream(gitdir, hd.ref);
  return { tips: hd.sha + "|" + (up ? up.sha : "") + "|" + hd.ref, sha: hd.sha };
}

//  stat(root) -> { model, tip } | null — the memoized read.  An unreadable
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
  try { v = { model: st.status("", { from: root }).model, tip: tp.sha }; }
  catch (e) { v = null; }
  if (cache.live()) MEMO.set(root, { rev: rv, tips: tp.tips, v: v });
  return v;
}

//  --- the two frames --------------------------------------------------------
//  Widths are be's (todo.js:721 FRAMEW_FILE 16, FRAMEW_COMMIT 13) and the glyphs
//  the [BEE-022] canon — the ticket's OPEN question, taken at its own default.
//  POSITION names the column exactly as the quad's does, so every count slot
//  wears `v` (this column moved) and the conflicted one `!`.
const FRAMEW_FILE = 16, FRAMEW_COMMIT = 13, SLOTW = 2, TIPW = 5;

//  One 2-cell count: blank at zero, `<sigil><n>` under ten, the bare number
//  from ten up, clamped at 99 — be's countFace (todo.js:784).
function slot(sigil, n) {
  if (!n) return "  ";
  const v = n > 99 ? 99 : n;
  return v < 10 ? sigil + String(v) : String(v);
}

//  `[v3 v1 v2 v5 !1]`: upstream, head, stage, worktree, conflicted, in the
//  quad's own column order (view/quad.js:44:3B counts).
function fileFrame(s) {
  const c = s ? s.model.counts : null;
  const g = function (k) { return slot("v", c ? c[k] : 0); };
  return "[" + g("track") + " " + g("head") + " " + g("stage") + " " + g("wt") +
         " " + slot("!", c ? c.con : 0) + "]";
}

//  `[o2 o1 a1b2c]`: commits ahead, commits behind — both `o`, since the quad
//  spells either as `created` and it is the COLUMN that tells them apart
//  (view/quad.js:78:3B commits) — then the current tip, `-----` when there is no HEAD.
function commitFrame(s) {
  let a = 0, b = 0;
  if (s) for (const c of s.model.commits) { if (c.quad === ".o..") a++; else b++; }
  const tip = s && s.tip ? s.tip.slice(0, TIPW) : "-".repeat(TIPW);
  return "[" + slot("o", a) + " " + slot("o", b) + " " + tip + "]";
}

//  frames(root) -> { file, commit }, the two fixed-width strings a row carries.
//  ASCII canon throughout, so a `--plain` board stays greppable.
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
  return { entries: MEMO.size, hits: SC.hits, misses: SC.misses,
           live: cache.live() };
}

module.exports = { stat: stat, frames: frames, line: line, stats: stats,
                   fileFrame: fileFrame, commitFrame: commitFrame, slot: slot,
                   FRAMEW_FILE: FRAMEW_FILE, FRAMEW_COMMIT: FRAMEW_COMMIT,
                   SLOTW: SLOTW, TIPW: TIPW };
