//  index/resolve.js as per LITE-011: turn a PARTIAL path (`abc/TCP.c`, a bare
//  `TCP.c`) into the full repo-relative path(s) it names IN A GIVEN COMMIT
//  (LITE-011:51:a9).  The index is hash-only and hands back no text, so it only
//  NARROWS and a real tree object answers: FSEG rows keyed by the filename hash
//  carry the ancestor segment hashes that prune the descent (LITE-011:52:a9),
//  iterative and batched, a LINE almost always (LITE-011:58:a9, LITE-011:59:a9).
//  AMBIGUITY IS THE ANSWER, NOT AN ERROR (LITE-011:60:a9): a hash collision costs
//  one tree read, never a wrong path, since the bottom verifies real names.
"use strict";

const idx = require("./index.js");

//  The partial as typed -> { segs[], fn, prnt }.  `prnt` is null for a bare
//  filename, which widens the index scan from 60 bits to 40.
function split(partial) {
  const segs = [];
  for (const s of String(partial === undefined ? "" : partial).split("/"))
    if (s !== "" && s !== ".") segs.push(s);
  if (segs.length === 0) return null;
  const last = segs[segs.length - 1];
  return { segs: segs, fn: idx.fnHl(last),
           prnt: segs.length > 1 ? idx.segHl(segs[segs.length - 2], 20n) : null };
}

//  LITE-011:53:a9, the candidate rows.  The index is unkeyed and a crash can leave
//  a byte-identical duplicate, so rows are deduped on (key, val).
function candidates(ix, q) {
  const out = [], seen = new Set();
  const take = function (k, v) {
    const id = k.toString(16) + ":" + v.toString(16);
    if (seen.has(id)) return;
    seen.add(id);
    const segs = [];
    for (let i = 0; i < idx.SEG_SLOTS; i++) segs.push(idx.fsegSeg(v, i));
    out.push({ segs: segs, depth: idx.fsegDepth(v) });
  };
  if (q.prnt !== null) {
    const key = idx.fsegKey(q.fn, q.prnt);
    ix.range(key, key + 1n, function (e) { take(e[0], e[1]); });
  } else {
    //  The prefix also sweeps the REV rows that share these top 40 bits; the
    //  kind nibble is what tells them apart.
    ix.prefix(q.fn << 24n, 24, function (e) {
      if (idx.keyKind(e[0]) === idx.K_FSEG) take(e[0], e[1]);
    });
  }
  return out;
}

//  LITE-011:56:a9, the text leg: the recovered path must END with the partial as
//  typed, segment for segment — what makes a hash collision cost a tree read
//  and never a wrong answer.
function tailMatches(path, segs) {
  const p = path.split("/");
  if (p.length < segs.length) return false;
  const off = p.length - segs.length;
  for (let i = 0; i < segs.length; i++) if (p[off + i] !== segs[i]) return false;
  return true;
}

//  resolve(ix, r, treeSha, partial) -> the full repo-relative paths that partial
//  names in the commit whose root tree is `treeSha`, sorted, possibly empty.
function resolve(ix, r, treeSha, partial) {
  const q = split(partial);
  if (q === null || !treeSha) return [];
  const rows = candidates(ix, q);
  if (rows.length === 0) return [];
  const out = [];
  let pend = [{ tree: treeSha, prefix: "", prnt: 0n, rows: rows }];
  for (let level = 0; pend.length && level <= idx.DEPTH_MAX; level++) {
    const next = [];
    for (const st of pend) {
      const ents = idx.readTree(r, st.tree);
      if (ents === null) continue;
      let bottom = false;
      const deeper = [];
      for (const row of st.rows) {
        if (row.depth === level) bottom = true;
        else if (row.depth > level) deeper.push(row);
      }
      for (const [name, e] of ents) {
        if (!e.dir) {
          if (!bottom || idx.fnHl(name) !== q.fn) continue;
          if (q.prnt !== null && st.prnt !== q.prnt) continue;
          const path = st.prefix + name;
          if (tailMatches(path, q.segs)) out.push(path);
          continue;
        }
        if (deeper.length === 0) continue;
        const h10 = idx.segHl(name, 10n);
        //  Past the chain the row carries no expectation for this level, so
        //  every subtree stays live — the depth said the tail is missing.
        const keep = [];
        for (const row of deeper)
          if (level >= idx.SEG_SLOTS || row.segs[level] === h10) keep.push(row);
        if (keep.length)
          next.push({ tree: e.sha, prefix: st.prefix + name + "/",
                      prnt: idx.segHl(name, 20n), rows: keep });
      }
    }
    pend = next;
  }
  out.sort();
  const uniq = [];
  for (const p of out) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq;
}

//  resolveAt(ctx, ix, commitName, partial) — the same, naming the commit by any
//  6..40 hexlet (a hashlet60 included).  Resolution is ALWAYS per-commit: a row
//  that does not descend in THAT commit is simply not a hit.
function resolveAt(ctx, ix, commitName, partial) {
  const m = idx.readCommit(ctx.r, commitName);
  if (m === null) return [];
  return resolve(ix, ctx.r, m.tree, partial);
}

//  The verb wiring: one path, or null when the partial names nothing in that
//  commit (the caller's own "no such path" answer stands).  Several paths ARE
//  the answer, so they are listed back in plain words.
function pick(verb, ix, ctx, arg, commitName) {
  const at = commitName || ctx.head.sha;
  const paths = resolveAt(ctx, ix, at, arg);
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  throw verb + ": " + arg + " names " + paths.length + " files at " +
        at.slice(0, 8) + " — say which:\n  " + paths.join("\n  ") + "\n";
}

module.exports = { resolve: resolve, resolveAt: resolveAt, pick: pick,
                   split: split, candidates: candidates,
                   tailMatches: tailMatches };
