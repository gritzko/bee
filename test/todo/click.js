//  bee/test/todo/click.js — BEE-025 leg 2: the SPANS, the half no shell sees.
//  A board row hides its click target in a `U` span as view/list.js does, so
//  this asserts what a pager click opens — a ticket row `cat <its file>`, a topic
//  header `todo TOPIC`, an inline `[value]` the WHOLE arg line with that key
//  replaced (be todo.js:1137 argLineWith) — plus the two lexical halves the
//  board routes by, `shape` and the `Sub:` nesting, which never reach stdout.
//  Driven by run.sh with $SRC_ROOT on the fixture and $HOME on its registry.
"use strict";

const todo = require("view/todo.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const SRC = io.getenv("SRC_ROOT");
const ALPHA = SRC + "/alpha";

//  A hunk -> the list of `U`-tagged span texts, in order: the targets a click
//  or an http href would follow (render/html.js reads the very same spans).
function targets(h) {
  const out = [];
  let lo = 0;
  for (let i = 0; i < h.toks.length; i++) {
    const hi = h.toks[i] & 0xffffff;
    const tag = String.fromCharCode(65 + ((h.toks[i] >>> 27) & 0x1f));
    if (tag === "U" && hi > lo) out.push(utf8.Decode(h.text.slice(lo, hi)));
    lo = hi;
  }
  return out;
}
function has(arr, s) { return arr.indexOf(s) >= 0; }
//  A row opens its file: a `cat` spell whose path ends in the ticket's own file.
function hasCat(arr, key) {
  return arr.some(function (s) {
    return s.slice(0, 4) === "cat " &&
           (s.endsWith("/" + key + ".mkd") || s.endsWith("/" + key + "/README.mkd"));
  });
}

//  --- 1. the lexer routes by SHAPE alone -------------------------------------
check("a-caps-word-is-a-topic", todo.shape("GET") === "topic", todo.shape("GET"));
check("a-code-is-a-key", todo.shape("GET-001") === "key", todo.shape("GET-001"));
check("a-lowercase-word-is-neither", todo.shape("get") === null, todo.shape("get"));
check("a-suffixed-name-carries-its-base-key",
      todo.ticketKey("GET-001-adv") === "GET-001", todo.ticketKey("GET-001-adv"));
check("a-dashless-name-carries-none", todo.ticketKey("alpha") === "", todo.ticketKey("alpha"));

//  --- 2. the row's own click -------------------------------------------------
{
  const v = todo.todo("", { from: ALPHA });
  const t = targets(v.hunks[0]);
  check("a-ticket-row-opens-cat-file", hasCat(t, "GET-001"), t.join(" | "));
  check("a-topic-header-opens-its-list", has(t, "todo GET"), t.join(" | "));
  check("the-fat-ticket-clicks-too", hasCat(t, "GET-003"), t.join(" | "));
  check("a-closed-ticket-has-no-row", !hasCat(t, "GET-002"), t.join(" | "));
  check("a-parked-ticket-has-no-row", !hasCat(t, "GET-099"), t.join(" | "));
}

//  --- 3. an inline value REPLACES its key in the arg line --------------------
{
  const v = todo.todo("GET Sev:CRIT", { from: ALPHA });
  const t = targets(v.hunks[0]);
  check("a-value-bracket-refines-the-line", has(t, "todo GET Sev:CRIT"), t.join(" | "));
  check("the-row-still-opens-its-page", hasCat(t, "GET-001"), t.join(" | "));
}
check("a-click-replaces-one-key-and-keeps-the-rest",
      todo.argLineWith({ toks: ["GET", "Now:OPEN", "Who:gritzko"] }, "Now", "DONE") ===
      "GET Now:DONE Who:gritzko");
check("a-key-the-line-lacks-is-appended",
      todo.argLineWith({ toks: ["GET"] }, "Sev", "HIGH") === "GET Sev:HIGH");
check("a-colon-value-is-no-filter-arg", todo.filterVal("//bee/x:1") === null,
      todo.filterVal("//bee/x:1"));
check("a-spaced-value-rides-its-index-form", todo.filterVal("John Smith") === "johnsmith",
      todo.filterVal("John Smith"));

//  --- 4. the arg-line grammar refuses in words -------------------------------
check("two-colons-refuse", !!todo.parseArgs("Now:OPEN:DONE").err);
check("a-bare-key-points-at-Key-star", /Now:\*/.test(todo.parseArgs("Now").err || ""),
      todo.parseArgs("Now").err);
check("two-subjects-refuse", !!todo.parseArgs("GET PUT").err);
check("a-lowercase-word-refuses", !!todo.parseArgs("junk").err);
check("a-slash-separates-like-a-space",
      todo.parseArgs("GET/Sev:HIGH").toks.join(" ") === "GET Sev:HIGH",
      JSON.stringify(todo.parseArgs("GET/Sev:HIGH")));

//  --- 5. `Sub:` families nest on the rails -----------------------------------
{
  const v = todo.todo("GET", { from: ALPHA });
  const plain = utf8.Decode(v.hunks[0].plain);
  check("a-Sub-child-hangs-on-a-rail", /`-- GET-003/.test(plain), plain);
  check("the-parent-stays-flat", /^GET-001/m.test(plain), plain);
}

//  --- 6. a context with no todo/ refuses, naming itself ----------------------
{
  let said = "";
  try { todo.todo("", { from: SRC + "/gamma" }); } catch (e) { said = String(e); }
  check("a-todo-less-context-refuses-by-name", said === "todo: //gamma: no todo/", said);
}

w1((bad ? "FAIL" : "PASS") + " [bee/todo] click.js " + n + " checks, " + bad + " failed\n");
if (bad) throw "TODOCLICK";
