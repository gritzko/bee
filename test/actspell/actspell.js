//  bee/test/actspell/actspell.js — BEE-038: the MUTATION CLICK, headless.  Three
//  buttons on one fixture row are clicked in turn against a real fixture repo:
//  the writer must RUN and refresh this view in place (no push, scroll and
//  cursor kept), the refusing writer must reach the message line and touch
//  nothing, and the view spell must push-nav exactly as it did before.  The
//  shape split (`commit <rev>` reads, `commit -m x` writes) is asked of the
//  table itself.  The pty leg (Enter, a real click) is test/actspell/pty.js.
"use strict";
const pagerlib = require("pager.js");
const door = require("door.js");
const fixture = require(__dirname + "/fixture.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

//  ---- the table: which spells WRITE, and in which shape --------------------
let act = null;
try { act = require("act.js"); } catch (e) {}
check("there is a mutation table to consult", act !== null, String(act));
function acts(spell) { return act === null ? null : act.actOf(spell); }

check("`add <path>` is a mutation", acts("add one.txt") !== null);
check("bare `rm` is a mutation", acts("rm") !== null);
check("`push` is a mutation", acts("push") !== null);
check("`pull` is a mutation", acts("pull") !== null);
check("`fork` is a mutation", acts("fork //x-BEE-1") !== null);
check("a VIEW spell is not", acts("cat one.txt") === null);
check("...nor is any other door verb", acts("status") === null);
check("...nor an empty spell", acts("") === null);
//  BEE-037: the two SHAPE-SPLIT words — the verb name alone must not decide.
check("`commit <rev>` READS, so it is no mutation", acts("commit 0f1e2d3") === null);
check("`commit -m <msg>` writes", acts("commit -m fixed") !== null);
check("`commit '<msg with spaces>'` writes", acts("commit 'two words'") !== null);
check("bare `merge` writes", acts("merge") !== null);
check("LITE-014's three-file `merge` is the DRIVER, not a mutation",
      acts("merge base ours theirs") === null);
if (act !== null)
  check("a quoted message stays ONE arg",
        act.wordsOf("-m 'two words'").join("|") === "-m|two words",
        act.wordsOf("-m 'two words'").join("|"));

//  ---- the pager: a click on each of the three buttons ----------------------
//  The opener COUNTS the re-opens of the fixture view and hands a fresh hunk
//  each time, so "the view was re-built" is an identity, not a guess.
let opens = 0;
function open(path, from) {
  if (path === "actspell") { opens++; return [fixture.hunk()]; }
  return door.openTarget(path, from);
}
function pager(scroll) {
  const p = new pagerlib.Pager(-1, { tty: -1, color: false, open: open });
  p.setHunks([fixture.hunk()], "actspell");
  p.rows(80);                                  // index at a known width
  p.view.scroll = scroll || 0;
  return p;
}
//  A LEFT PRESS at screen (row, col), the SGR report the pty leg really sends.
function click(p, row, col) { p._mouse("0;" + col + ";" + row, true); }

check("the fixture repo starts with nothing staged", fixture.staged() === "",
      fixture.staged());

//  Scrolled by one, so the refresh has a scroll position to lose.
const p1 = pager(1), h1 = p1.view.hunks[0], was = opens;
click(p1, 2, 6);                               // rows[2] = the button row, `[add]`
check("the click RAN the verb — the fixture index moved",
      fixture.staged() === "one.txt", fixture.staged());
check("...and pushed NOTHING", p1.stack.length === 0, "stack " + p1.stack.length);
check("...the view re-opened in place", opens === was + 1, "opens " + opens);
check("...on its own recorded spell", p1.view.path === "actspell", p1.view.path);
check("...with the hunks re-built", p1.view.hunks[0] !== h1);
check("...the scroll kept", p1.view.scroll === 1, "scroll " + p1.view.scroll);
check("...the cursor kept on the button it fired",
      p1.view.cur.row === 2 && p1.view.cur.tok === 1,
      p1.view.cur.row + "/" + p1.view.cur.tok);
check("...and the report on the message line", p1.message === "add 1 staged",
      p1.message);

//  ---- a refusal: the fixture tracks no upstream, so `push` cannot ----------
const p2 = pager(0), was2 = opens;
click(p2, 3, 12);                              // scroll 0: screen row 3 = rows[2]
check("a refusal lands in the message line",
      p2.message.indexOf("no upstream") >= 0, p2.message);
check("...and pushes nothing either", p2.stack.length === 0, "stack " + p2.stack.length);
check("...having mutated nothing", fixture.staged() === "one.txt", fixture.staged());
check("...so there was nothing to re-open", opens === was2, "opens " + opens);

//  ---- a VIEW spell on the SAME row still push-navs ------------------------
const p3 = pager(0);
click(p3, 3, 18);                              // `[cat]`
check("a view spell still pushes", p3.stack.length === 1, "stack " + p3.stack.length);
check("...the view its spell named", p3.view.path === "cat one.txt", p3.view.path);

//  ---- `:` bar parity: a typed mutation runs, a typed path still opens ------
const p4 = pager(0), was4 = opens;
p4._applyPath("add two.txt");
check("a mutation typed at the `:` bar runs",
      fixture.staged().indexOf("two.txt") >= 0, fixture.staged());
check("...refreshing in place, no push",
      p4.stack.length === 0 && opens === was4 + 1,
      "stack " + p4.stack.length + " opens " + opens);
check("...with the report on the message line", p4.message === "add 1 staged",
      p4.message);

const p5 = pager(0);
p5._applyPath("two.txt");
check("a PATH typed at the bar still opens a view", p5.stack.length === 1,
      "stack " + p5.stack.length);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
