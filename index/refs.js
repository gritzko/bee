//  index/refs.js as per LITE-006: ref resolution for a foreign `.git` — HEAD,
//  loose refs and packed-refs chased to a sha.  It sits ABOVE the ODB waist BY
//  DESIGN (LITE-006:49:Rc): quickjab/git.c rules refs stay above it and dog/git
//  carries no ref-store reader, so this mirrors quickjab/test/gitverify.js, cut
//  to the calls the indexer needs; object bytes still go through git.parseCommit
//  and git.tree, never a parser of our own.  A linked worktree keeps HEAD in its
//  own gitdir and the branches in the common one (`commondir`, BEE-009:21:28O).
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

//  BEE-022:39: the ONE thing a status needs out of `<gitdir>/config` — the
//  `[branch "<b>"]` section's `remote` and `merge`.  dog/git/CFG.h parses this
//  grammar properly but has NO JS binding yet (see the ticket's report), so
//  this reads those two keys and nothing else: a `[section "sub"]` header, a
//  `key = value` line, comments dropped.  No value is a URI and none is
//  resolved here — the refname it yields goes through `resolve` above.
function branchConf(gitdir, branch) {
  const out = { remote: "", merge: "" };
  const t = readText(commonDir(gitdir) + "/config");
  if (t === null) return out;
  const want = 'branch "' + branch + '"';
  let mine = false;
  for (let line of t.split("\n")) {
    line = line.trim();
    if (line === "" || line[0] === "#" || line[0] === ";") continue;
    if (line[0] === "[") {
      const e = line.indexOf("]");
      mine = e > 0 && line.slice(1, e).trim() === want;
      continue;
    }
    if (!mine) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim(), v = line.slice(eq + 1).trim();
    if (k === "remote" || k === "merge") out[k] = v;
  }
  return out;
}

//  upstream(gitdir, headRef) -> { name, short, sha } | null: the tip a branch
//  TRACKS.  `branch.<b>.merge` names the ref on the remote and
//  `branch.<b>.remote` which remote, so the local ref is the remote-tracking
//  one; a `.` remote means the merge ref is local already.  Detached HEAD, no
//  config and an unresolvable ref all answer null — the degenerate roots of
//  [/wiki/Status], where the caller reads track = HEAD.
function upstream(gitdir, headRef) {
  if (typeof headRef !== "string" || headRef.slice(0, 11) !== "refs/heads/") return null;
  const c = branchConf(gitdir, headRef.slice(11));
  if (!c.merge) return null;
  const leaf = c.merge.slice(0, 11) === "refs/heads/" ? c.merge.slice(11) : c.merge;
  const name = (!c.remote || c.remote === ".") ? c.merge
             : "refs/remotes/" + c.remote + "/" + leaf;
  let sha = null;
  try { sha = resolve(gitdir, name, null, null, 0); } catch (e) { sha = null; }
  if (!isSha40(sha)) return null;
  const short = name.slice(0, 13) === "refs/remotes/" ? name.slice(13)
              : name.slice(0, 11) === "refs/heads/" ? name.slice(11) : name;
  return { name: name, short: short, sha: sha };
}

module.exports = { isSha40: isSha40, head: head, resolve: resolve,
                   packedRefs: packedRefs, commonDir: commonDir,
                   branchConf: branchConf, upstream: upstream };
