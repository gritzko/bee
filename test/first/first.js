//  lite/test/first/first.js — LITE-018, the two things the shell legs cannot
//  reach: the repo PROBE bare `lite` dispatches on (main.js `inRepo`, the climb
//  included), and the FIRST RUN itself — a repo that has no `.git/be` at all,
//  where `index/list.js` must derive the whole index before it can fuse a
//  single row, then paint that board on a real `tty.openpty()` slave.
//
//  run.sh hands the repos in as $LITE_FIX (indexed by the earlier legs) and
//  $LITE_FRESH (never indexed, this leg's own).  Stepped, not run(): a self-pty
//  has no concurrent reader (test/pager/pty.js's note).
"use strict";
const entry = require("main.js");
const ls = require("index/list.js");
const pagerlib = require("view/pager.js");

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}
function isdir(p) { try { return io.stat(p).kind === "dir"; } catch (e) { return false; } }

const fix = io.getenv("LITE_FIX");
const fresh = io.getenv("LITE_FRESH");
const nowhere = io.getenv("LITE_NOWHERE");

//  ---- the probe -----------------------------------------------------------
//  run.sh cds the fixture repo, so the cwd probe answers for it; the climb is
//  what makes a subdirectory answer the same, and a dir under no repo at all
//  must answer NO or bare `lite` would eat the filesystem story.
check("the cwd of a git repo probes as a repo", entry.inRepo() === true);
check("...and a subdirectory of it does too (openRepo climbs)",
      (function () { const cd = io.cwd(); io.chdir(fix + "/sub");
                     const r = entry.inRepo(); io.chdir(cd); return r; })() === true);
check("a directory under no repository probes as none",
      (function () { const cd = io.cwd(); io.chdir(nowhere);
                     const r = entry.inRepo(); io.chdir(cd); return r; })() === false);

//  ---- the first run -------------------------------------------------------
//  THE seam of this ticket: the view is handed a repo with no index at all.
check("the fresh fixture has no .git/be before the run", !isdir(fresh + "/.git/be"));
const out = ls.list(undefined, { from: fresh, track: false });
check("...the view derived one", isdir(fresh + "/.git/be"));
check("...and the rows came out", out.rows.length >= 2, "rows " + out.rows.length);
//  A starved fuse would still emit rows — blank ones.  The whole point of the
//  bring-up is that the FIRST run is already attributed.
let attributed = 0;
for (const r of out.rows) if (r.summary !== "" && r.age !== "") attributed++;
check("...every row is FUSED on the very first run, none starved",
      attributed === out.rows.length, attributed + "/" + out.rows.length);
check("...with the fixture's own commits on them",
      utf8.Decode(out.plain).indexOf("F0 fresh seed") >= 0, utf8.Decode(out.plain));

//  A SECOND call on the same handle is the watermark no-op: same rows, and no
//  new run file in the family (bringUp returns before it writes anything).
const before = io.readdir(fresh + "/.git/be").length;
const out2 = ls.list(undefined, { from: fresh, track: false });
check("the second run is the watermark no-op — the family did not grow",
      io.readdir(fresh + "/.git/be").length === before);
check("...and the rows are the same bytes",
      utf8.Decode(out2.plain) === utf8.Decode(out.plain));

//  ---- the glass -----------------------------------------------------------
//  What bare `lite` puts on a terminal is these hunks through the shipped door.
if (typeof tty === "undefined" || !tty.openpty) {
  w1("ok   pty skipped — no tty.openpty binding\n"); n++;
} else {
  const pty = tty.openpty();
  tty.setSize(pty.slave, 12, 100);
  const saved = tty.raw(pty.slave);
  try {
    const p = new pagerlib.Pager(pty.slave, { color: true, open: entry.openTarget });
    p.setHunks(out.hunks, "list");
    p.render();
    const rb = io.buf(1 << 16);
    const k = io.read(pty.master, rb);
    const f = k > 0 ? utf8.Decode(rb.data().slice()) : "";
    check("the first run paints the browser on a real tty", f.length > 0, "bytes " + f.length);
    check("...banner'd `list`, with the fused rows on the glass",
          f.indexOf(ESC + "[38;5;0;48;5;230m") >= 0 && f.indexOf("list") >= 0 &&
          f.indexOf("f.txt") >= 0 && f.indexOf("F0 fresh seed") >= 0, f);
  } finally {
    try { tty.cook(pty.slave, saved); } catch (e) {}
    try { io.close(pty.master); io.close(pty.slave); } catch (e) {}
  }
}

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
