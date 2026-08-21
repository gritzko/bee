//  sync.js — BEE-037: `commit`, `push`, `pull` and `merge`, bee's HISTORY verbs.
//  Each is one honest git sequence spawned by argv (stage.js:30 spawn), git's
//  stdio inherited throughout: a refusal reaches the user in git's own words and
//  the exit status is git's, never softened into a report line.  The fetch side
//  NEVER stashes by hand — `--autostash` is the atomic stash-merge-pop, so a
//  refused merge aborts back to the worktree byte for byte; the one thing it
//  cannot undo (the reapply conflicting AFTER a good merge) degrades LOUD with
//  the edits parked in `git stash` (BEE-037:15).
"use strict";

const st = require("stage.js");
const subs = require("index/subs.js");

//  RULING (gritzko 2026-08-20, BEE-037:8): the verbs are named GIT-STYLE, so
//  these four words are what main.js:250:eY spells too.
const COMMIT = "commit", PUSH = "push", PULL = "pull", MERGE = "merge";
const UP = "@{u}";                     // the tracked upstream, in git's own word

//  --- what git says ---------------------------------------------------------
//  A one-word plumbing answer (`rev-parse`), or null when git refused — it has
//  already said why on our stderr.
function word(at, args) {
  const out = st.list(["git", "-C", at].concat(args));
  return out === null ? null : utf8.Decode(out).trim();
}

//  The abbreviated HEAD: every report line names WHICH commit the run left the
//  branch at, so no verb here answers with a bare "done".
function head(at) { return word(at, ["rev-parse", "--short", "HEAD"]) || "HEAD"; }

//  The branch `@{u}` resolves to, e.g. `origin/master`.  No upstream is a
//  refusal in words: these verbs have nowhere to go without one, and guessing a
//  remote is exactly the overloading BEE-037:8 ruled out.
function upstream(at, verb) {
  const u = word(at, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", UP]);
  if (u === null || u === "") throw "bee: " + verb + ": this branch tracks no upstream";
  return u;
}

//  The stash tip, or null when there is none.  `merge --autostash` parks the
//  edits it could not reapply HERE and still exits 0, so a moved tip is the one
//  tell that a clean-looking merge left work behind (BEE-037:37).
function stashTip(at) {
  return word(at, ["rev-parse", "--verify", "--quiet", "refs/stash"]);
}

//  --- the verbs -------------------------------------------------------------
//  BEE-056: is this repo's index apart from its HEAD?  `--quiet` answers in the
//  exit code alone (1 == staged), and it holds on an unborn HEAD too.
function staged(at) {
  return st.run(["git", "-C", at, "diff", "--cached", "--quiet"]) !== 0;
}

//  BEE-056: `commit` sweeps the tree as `add`/`rm` do (stage.js:132 sweep) —
//  depth-first over index/subs.js, grandchildren first, every staged level
//  committed under the SAME message and its moved gitlink staged in the parent,
//  so one act leaves no half-committed level behind.  -> how many subs committed.
function descend(msg, at) {
  let n = 0;
  for (const s of subs.mounts(at)) {
    if (!s.live) continue;                  // uninitialised: nothing of ours
    n += descend(msg, s.wt);
    //  A grandchild that committed left ITS gitlink staged here, so this one
    //  test carries both the sub's own work and everything under it.
    let own = 0;
    if (staged(s.wt)) {
      if (st.run(["git", "-C", s.wt, COMMIT, "-q", "-m", msg]) !== 0)
        throw "bee: " + COMMIT + ": git refused in " + s.path;
      own = 1;
    }
    n += own;
    //  The gitlink is owed where OUR commit just moved the sub's HEAD, or where
    //  it already stood apart from the recorded sha (stage.js:137).
    if (!own && (s.head === null || s.head === s.sha)) continue;
    if (st.run(["git", "-C", at, "add", "--", s.path]) !== 0)
      throw "bee: " + COMMIT + ": git add refused the gitlink " + s.path;
  }
  return n;
}

//  `bee commit '<msg>'` -> the one report line, the top's abbreviated sha and,
//  where subs took part, how many commits the one act made (BEE-056).  Nothing
//  staged ANYWHERE is git's own refusal, verbatim and non-zero; reindexing comes
//  free from the BEE-031 post-commit hook, so this verb owns no index work.
function commit(msg) {
  if (typeof msg !== "string" || msg === "")
    throw "bee: usage: bee " + COMMIT + " '<message>'";
  const at = st.root();
  //  A sub that committed leaves its gitlink staged here, so the top's own
  //  commit lands; a wholly quiet tree reaches git's refusal untouched.
  const n = descend(msg, at);
  if (st.run(["git", "-C", at, COMMIT, "-q", "-m", msg]) !== 0)
    throw "bee: " + COMMIT + ": git refused";
  return COMMIT + " " + head(at) + (n ? " " + (n + 1) + " commits" : "");
}

//  The message a `commit` arg list MEANS, or null when it is view/commit.js's
//  rev instead — the word is a verb AND a view.  git forbids a space in a
//  refname, so a word carrying one can only be a message; `-m` says it outright.
function messageOf(args) {
  if (args.length === 2 && args[0] === "-m") return args[1];
  if (args.length === 1 && args[0].indexOf(" ") >= 0) return args[0];
  return null;
}

//  BEE-045: where the tracked branch is CHECKED OUT, off `worktree list
//  --porcelain` (a plumbing format: `worktree <path>`, then `branch <ref>`,
//  per entry); null when no worktree holds it.
function landSite(at, u) {
  const out = st.list(["git", "-C", at, "worktree", "list", "--porcelain"]);
  if (out === null) return null;
  let wt = null;
  for (const ln of utf8.Decode(out).split("\n")) {
    if (ln.indexOf("worktree ") === 0) wt = ln.slice(9);
    else if (ln === "branch refs/heads/" + u) return wt;
  }
  return null;
}

//  `bee push` — to the tracked upstream and nowhere else; a non-FF rejection
//  is git's own stderr, exit non-zero.  BEE-045: a fork tracks the LOCAL
//  branch it forked off and git refuses to move a checked-out ref — so landing
//  is the PARENT's `--autostash --ff-only` merge of our tip; diverged refuses in words.
function push(args) {
  if (args.length) throw "bee: usage: bee " + PUSH;
  const at = st.root();
  const u = upstream(at, PUSH);
  const cur = word(at, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const rem = cur === null ? null : word(at, ["config", "branch." + cur + ".remote"]);
  const site = rem === "." ? landSite(at, u) : null;
  if (site !== null) {
    if (st.run(["git", "-C", at, "merge-base", "--is-ancestor", u, "HEAD"]) !== 0)
      throw "bee: " + PUSH + ": " + u + " has commits this branch lacks — pull (or merge) first";
    const was = stashTip(site);
    if (st.run(["git", "-C", site, MERGE, "-q", "--ff-only", "--autostash", cur]) !== 0)
      throw "bee: " + PUSH + ": " + u + " would not fast-forward";
    if (stashTip(site) !== was)
      throw "bee: " + PUSH + ": landed on " + u + ", but its autostash would not " +
            "reapply — the edits are safe in `git stash` THERE";
    return PUSH + " " + u + " " + head(at);
  }
  if (st.run(["git", "-C", at, PUSH, "-q"]) !== 0) throw "bee: " + PUSH + ": git refused";
  return PUSH + " " + u + " " + head(at);
}

//  The fetch side's one spine: bring the upstream in, then integrate it under
//  `--autostash`.  `ff` is `pull`'s ladder — behind-only is a fast-forward by
//  construction, so `--ff-only` makes a diverged pair fail LOUD (git puts the
//  autostash back itself there) rather than quietly weave a merge commit.
function integrate(verb, ff) {
  const at = st.root();
  const u = upstream(at, verb);
  if (st.run(["git", "-C", at, "fetch", "-q"]) !== 0)
    throw "bee: " + verb + ": git fetch refused";
  const was = stashTip(at);
  const argv = ["git", "-C", at, MERGE, "-q", "--autostash"];
  if (ff) argv.push("--ff-only");
  argv.push(UP);
  if (st.run(argv) !== 0) {
    //  A conflicted merge parks the autostash in MERGE_AUTOSTASH; `--abort` is
    //  the one move that puts the tree AND those edits back (BEE-037:8).
    if (!ff) st.run(["git", "-C", at, MERGE, "--abort"]);
    throw "bee: " + verb + ": " + u + " did not integrate — the worktree is as it was";
  }
  //  "safe in the stash" is the phrase test/sync/run.sh:250:mw pins: git spells
  //  its own reapply-conflict advice differently across versions.
  if (stashTip(at) !== was)
    throw "bee: " + verb + ": merged " + u + ", but the autostash would not " +
          "reapply — your edits are safe in the stash, `git stash pop` to resolve";
  return verb + " " + u + " " + head(at);
}

function pull(args) {
  if (args.length) throw "bee: usage: bee " + PULL;
  return integrate(PULL, true);
}

function merge(args) {
  if (args.length) throw "bee: usage: bee " + MERGE;
  return integrate(MERGE, false);
}

module.exports = { commit: commit, messageOf: messageOf, push: push,
                   pull: pull, merge: merge,
                   COMMIT: COMMIT, PUSH: PUSH, PULL: PULL, MERGE: MERGE };
