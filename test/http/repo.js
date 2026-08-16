//  bee/test/http/repo.js — BEE-003, the DOOR leg: the resolution ORDER, the
//  mount table, the chooser rows and the cross-tree hop, with no socket in the
//  way.  The fixture is repo.sh's (`$BEE_WORK`), the cwd its `home` repo.
"use strict";
const door = require("door.js");
const mnt = require("index/mount.js");

const W = io.getenv("BEE_WORK");
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
function at(file, fn) { return mnt.within(door.posOf(file), fn); }
function rows(file, ref) { return at(file, function () { return door.resolvePartial(ref); }); }
function one(rs) { return rs === null ? "null" : rs.map(function (r) { return r.repo + ":" + r.rel; }).join(" "); }

//  --- the mount table --------------------------------------------------------
const ms = mnt.mounts();
let quick = null, sub = null;
for (const m of ms) {
  if (m.root === W + "/quick") quick = m;
  if (m.root === W + "/quick/dog/abc") sub = m;
}
check("the registry is the mount table", quick !== null && quick.name === "quick" &&
      quick.prefix === "", quick && quick.name + " '" + quick.prefix + "'");
check("a submodule mounts UNDER its parent (ruling 5)",
      sub !== null && sub.name === "quick" && sub.prefix === "dog/abc",
      sub && sub.name + " '" + sub.prefix + "'");
check("and it is ONE mount, not two", ms.filter(function (m) {
        return m.root === W + "/quick/dog/abc"; }).length === 1);

//  --- the resolution ORDER (ruling 3) ----------------------------------------
//  1. the DIR OF THE FILE BEING READ — `near.txt` read in `sub/` is sub's own,
//     though the repo carries two of them.
const near = rows(W + "/home/sub/note.c", "near.txt");
check("the dir of the file being read answers FIRST",
      near !== null && near.length === 1 && near[0].full === W + "/home/sub/near.txt",
      one(near));
//  2. the ambient repo at HEAD — the same ref read at the root is AMBIGUOUS, and
//     ambiguity IS the answer (ruling 4).
const both = rows(W + "/home/ref.c", "near.txt");
check("the current repo answers next, several hits and all",
      both !== null && both.length === 2 && both[0].repo === "home" &&
      both[1].repo === "home", one(both));
//  3. every registered repo — and a SUBMODULE file is named through its parent.
const cross = rows(W + "/home/ref.c", "abc/TCP.c");
check("a cross-repo partial resolves in the registry",
      cross !== null && cross.length === 1 && cross[0].repo === "quick" &&
      cross[0].rel === "dog/abc/TCP.c" &&
      cross[0].full === W + "/quick/dog/abc/TCP.c", one(cross));
//  ...ONCE, though that file is reachable through the parent AND through the
//  sub's own registry line (ruling 4's dedup).
const bare = rows(W + "/home/ref.c", "TCP.c");
check("one file reached through two mounts is ONE row",
      bare !== null && bare.length === 1 && bare[0].rel === "dog/abc/TCP.c", one(bare));
//  A LOCAL file still wins locally — the order is fixed, not a free-for-all.
const local = rows(W + "/home/ref.c", "q.txt");
check("a same-named local file still answers first",
      local !== null && local.length === 1 && local[0].full === W + "/home/q.txt", one(local));

//  --- the anchored spellings -------------------------------------------------
//  A leading `/` is another repo's ROOT, so it never suffix-matches; `///name`
//  names the repo outright, the registry being the mount table.
const anch = rows(W + "/home/ref.c", "/dog/abc/TCP.c");
check("a root-absolute ref is anchored at a repo root",
      anch !== null && anch.length === 1 && anch[0].repo === "quick" &&
      anch[0].rel === "dog/abc/TCP.c", one(anch));
const notail = rows(W + "/home/ref.c", "/near.txt");
check("...and it does NOT match a deeper same-named file",
      notail !== null && notail.length === 0, one(notail));
const auth = rows(W + "/home/ref.c", "///quick/q.txt");
check("`///name` resolves through the registry",
      auth !== null && auth.length === 1 && auth[0].full === W + "/quick/q.txt", one(auth));
const noauth = rows(W + "/home/ref.c", "///nosuchrepo/q.txt");
check("a `///name` naming no registered repo answers nothing",
      noauth !== null && noauth.length === 0, one(noauth));

//  --- a CLIMBING ref (ruling 7) ----------------------------------------------
//  `../x` is read against the dir of the file being read; climbing OUT of the
//  repo root lands in the sibling the registry names, or nowhere at all.
const up = rows(W + "/home/sub/note.c", "../q.txt");
check("a climbing ref reads against the file's own dir",
      up !== null && up.length === 1 && up[0].full === W + "/home/q.txt", one(up));
const out2 = rows(W + "/home/ref.c", "../quick/q.txt");
check("a ref climbing OUT of the repo lands in the sibling repo",
      out2 !== null && out2.length === 1 && out2[0].repo === "quick" &&
      out2[0].rel === "q.txt", one(out2));
const dead = rows(W + "/home/ref.c", "../nowhere/q.txt");
check("...and one no registered repo holds is dead",
      dead !== null && dead.length === 0, one(dead));

//  --- the refusal (ruling 3) -------------------------------------------------
const words = at(W + "/home/ref.c", function () { return door.refusal("nosuch/gone.c"); });
check("a miss is refused IN WORDS, naming what was searched",
      words.indexOf("nosuch/gone.c") >= 0 && words.indexOf("quick") >= 0 &&
      words.indexOf("bee install") >= 0, words);

//  --- the cross-tree HOP (the pager's own push) ------------------------------
const hs = door.openTarget("abc/TCP.c", W + "/home/ref.c");
check("the door opens the other tree from the reference",
      hs !== null && hs.length === 1 &&
      utf8.Decode(hs[0].text).indexOf("int TCP;") >= 0, hs && hs.length);
//  ...and the target it landed on is an ABSOLUTE path in that tree, which is
//  what the pager stacks — so backing out is an ordinary pop.
check("the landed hunk names the other tree",
      hs !== null && String(hs[0].uri).indexOf(W + "/quick/dog/abc/TCP.c") >= 0,
      hs && hs[0].uri);
//  The chooser NAMES THE REPO on every row (ruling 4).
const ch = door.openTarget("near.txt", W + "/home/ref.c");
check("the chooser rows name their repo",
      ch !== null && ch[0].kind === "chooser" &&
      utf8.Decode(ch[0].text).indexOf("home/sub/near.txt") >= 0,
      ch && utf8.Decode(ch[0].text));
//  A repo with NO lane still serves its files: `plain` was registered by hand
//  and never indexed, and its own file opens by path all the same.
check("a registered repo with no lane still opens",
      door.openTarget(W + "/plain/p.txt") !== null);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
