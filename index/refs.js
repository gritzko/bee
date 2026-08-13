//  index/refs.js — LITE-006: ref resolution for a foreign `.git`.
//
//  This sits ABOVE the ODB waist BY DESIGN, not by omission: quickjab/git.c
//  ends its own header with "Refs stay ABOVE this waist (test/gitverify.js
//  reads HEAD/packed-refs as text) — the waist is ODB only", and dog/git
//  carries NO ref-store reader at all (GIT.h has GITParseRef, which parses a
//  refNAME, and nothing that opens `HEAD` / `packed-refs`).  So this file
//  MIRRORS quickjab's own sanctioned reader, quickjab/test/gitverify.js, cut
//  down to the two calls the indexer needs.  Nothing here re-implements a
//  parser dog owns — object bytes still go through git.parseCommit/git.tree.
//
//    head(gitdir)          -> { ref, sha } | null    HEAD, chased to a sha
//    resolve(gitdir, name) -> sha | null             one refname
"use strict";

//  A full git object id: 40 lowercase-hex characters (be/shared/util/sha.js).
function isSha40(s) {
  if (typeof s !== "string" || s.length !== 40) return false;
  for (let i = 0; i < 40; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

function readText(path) {
  try {
    const m = io.mmap(path, "r");
    const d = m.data ? m.data() : m;
    return utf8.Decode(d);
  } catch (e) { return null; }
}

//  A linked worktree keeps HEAD in its own gitdir and the branches in the main
//  one, named by the `commondir` file (relative to the gitdir).
function commonDir(gitdir) {
  const c = readText(gitdir + "/commondir");
  if (c === null) return gitdir;
  const t = c.trim();
  if (!t) return gitdir;
  return t[0] === "/" ? t : gitdir + "/" + t;
}

//  packed-refs: "<sha> <refname>" lines; "^<sha>" peels an annotated tag and
//  "#" is the header comment.
function packedRefs(gitdir) {
  const out = new Map();
  for (const dir of [gitdir, commonDir(gitdir)]) {
    const t = readText(dir + "/packed-refs");
    if (t === null) continue;
    for (const line of t.split("\n")) {
      if (!line || line[0] === "#" || line[0] === "^") continue;
      const sp = line.indexOf(" ");
      if (sp !== 40) continue;
      const sha = line.slice(0, 40), name = line.slice(sp + 1).trim();
      if (name && isSha40(sha) && !out.has(name)) out.set(name, sha);
    }
  }
  return out;
}

//  Resolve one refname ("HEAD", "refs/heads/x") to a 40-hex sha, or null.  The
//  loose file first (worktree gitdir, then the common dir), then packed-refs;
//  "ref: <name>" chains follow, bounded.  `seen` collects the chain so the
//  caller learns WHICH ref HEAD finally names.
function resolve(gitdir, name, packed, seen, depth) {
  if ((depth || 0) > 8)
    throw "index: the ref chain from " + name + " never ends";
  if (seen) seen.push(name);
  for (const d of [gitdir, commonDir(gitdir)]) {
    const t = readText(d + "/" + name);
    if (t === null) continue;
    const v = t.trim();
    if (v.slice(0, 5) === "ref: ")
      return resolve(gitdir, v.slice(5).trim(), packed, seen, (depth || 0) + 1);
    if (isSha40(v)) return v;
  }
  const p = (packed || packedRefs(gitdir)).get(name);
  return p === undefined ? null : p;
}

//  head(gitdir) -> { ref, sha } | null.  `ref` is the refname the watermark is
//  keyed on: the branch HEAD points at, or "HEAD" itself when detached.
function head(gitdir) {
  const chain = [];
  let sha = null;
  try { sha = resolve(gitdir, "HEAD", null, chain, 0); } catch (e) { return null; }
  if (!isSha40(sha)) return null;
  return { ref: chain[chain.length - 1], sha: sha };
}

module.exports = { isSha40: isSha40, head: head, resolve: resolve,
                   packedRefs: packedRefs, commonDir: commonDir };
