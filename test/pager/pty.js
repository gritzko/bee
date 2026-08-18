//  lite/test/pager/pty.js — LITE-004 leg 3: the REAL UI path.  The lite Pager is
//  driven over a tty.openpty() slave fd — raw mode, a frame painted to a REAL
//  tty, keys pushed in through the master, the frame read back and asserted.
//  The opener is door.js's OWN openPath, so this exercises the shipped
//  entry → pager wiring, not a mock.
//
//  STEPPED, not run(): the loop is driven render/drain/send cycle by cycle.
//   -  a self-pty has no concurrent reader, so a slave write blocks once the
//      queue fills (1 KB on macOS): frames are painted into a scratch FILE and
//      read back to EOF, the pty carrying only geometry and keys.
//   -  a PRE-QUEUED key cannot drive run(): tty.raw installs the termios with
//      TCSAFLUSH, which DROPS whatever is already sitting in the slave queue
//      (LITE-002 Blockers).  Raw is entered ONCE, up front, before any send.
//   -  pump() READS FIRST and tests its condition AFTER, so a send whose
//      condition already holds cannot leave bytes in the queue for the next
//      pager object to swallow (LITE-002 Blockers).
//
//  Run with cwd = the fixture dir (run.sh cds there) so the hunk uris are SHORT:
//  the 40-col status bar truncates the left field to ~27 cells, and an absolute
//  ~/tmp fixture path would push `#L1` off the bar.  The jsrc pin is MAIN-SCRIPT
//  -dir relative, so these requires resolve through lite/jsrc -> . regardless.
"use strict";
const pager = require("pager.js");
//  door.js exports the fs door (openPath/openTarget) and nothing that runs:
//  required from here it just hands over the one fs door.
const entry = require("door.js");        // LITE-045: the door, not the CLI

const ESC = "\x1b";
let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) {
  return String(s).replace(/\x1b/g, "\\e").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}
function skip(name, why) { w1("skip " + name + " — " + why + "\n"); }

const pty = tty.openpty();
tty.setSize(pty.slave, 10, 40);                  // 10 rows: 1 banner + 8 body + bar
//  Frames go to a scratch FILE, not the slave: a self-pty has no concurrent
//  reader and macOS blocks a slave write at 1 KB unread (XNU TTYCLSIZE).  The
//  pty stays the tty (size, raw, keys); `sink` takes the paint, `tap` reads it.
const FRAMES = (io.getenv("TMPDIR") || "/tmp") + "/bee-pty-" + io.getpid() + ".frames";
const sink = io.open(FRAMES, "c"), tap = io.open(FRAMES, "r");

const rb = io.buf(1 << 16);
let frames = "";
function drain() {
  for (;;) {                                     // to EOF: exactly the new frame
    rb.reset();
    const k = io.read(tap, rb);
    if (k <= 0) break;
    frames += utf8.Decode(rb.data().slice());
  }
}
function frame(p) { p.render(); frames = ""; drain(); return frames; }

const kbuf = io.buf(64);
function send(s) { kbuf.reset(); kbuf.feed(utf8.Encode(s)); io.writeAll(pty.master, kbuf); }
//  Read the slave (raw: VMIN=0 VTIME=1, so a read returns 0 after ~100ms) and
//  feed what arrives THROUGH the pager's own input path; test `done` after.
const krb = io.buf(64);
function pump(p, done, tries) {
  for (let r = 0; r < (tries || 20); r++) {
    krb.reset();
    const m = io.read(pty.slave, krb);
    if (m > 0) p._feed(krb.data().slice());
    if (done()) return true;
  }
  return done();
}

const saved = tty.raw(pty.slave);
try {
  //  ---- frame 0 over a FILE view ------------------------------------------
  const hs = entry.openPath("doc.txt");
  check("openPath-file-list", hs !== null && hs.length === 1 && hs[0].kind === "file",
        hs === null ? "null" : "len " + hs.length);
  const p = new pager.Pager(sink, { tty: pty.slave, color: true, open: entry.openPath });
  p.setHunks(hs, "doc.txt");

  const f0 = frame(p);
  check("frame0-body", f0.indexOf("AAAA") >= 0 && f0.indexOf("HHHH") >= 0, f0);
  check("frame0-viewport-ends", f0.indexOf("IIII") < 0, f0);   // 8 body rows only
  //  The banner BAND: pale-yellow bg, filled to the full width, closed ESC[0m.
  const band = p._banner(hs[0], 40);
  check("band-bg", band.indexOf("48;5;230") >= 0, band);
  check("band-fill", band.replace(/\x1b\[[0-9;]*m/g, "").length === 40, band);
  check("band-close", band.slice(-4) === ESC + "[0m", band);
  check("band-text", band.indexOf("doc.txt") >= 0, band);
  check("frame0-has-band", f0.indexOf("48;5;230") >= 0, f0);
  check("body-unbanded", pager.paintRow(hs[0], 0, 4, true).indexOf("48;5;230") < 0,
        pager.paintRow(hs[0], 0, 4, true));
  //  The inverse status bar: ESC[7m … 40 cells … ESC[0m, `<path>#L1` + TOP.
  check("frame0-bar-inverse", f0.indexOf(ESC + "[7m") >= 0, f0);
  check("frame0-bar-uri", f0.indexOf("doc.txt#L1") >= 0, f0);
  check("frame0-bar-top", f0.indexOf("TOP") >= 0 && f0.indexOf("?: help") >= 0, f0);
  const bar = p._statusLine(p.rows(40), 0, 9, 40);
  check("bar-fits-40", bar.replace(/\x1b\[[0-9;]*m/g, "").length === 40, bar);

  //  ---- j moves the CURSOR; walking it off the foot scrolls (LITE-023) -----
  send("j");
  check("key-j-cursor", pump(p, function () { return p.view.cur.row === 1; }),
        "cur " + p.view.cur.row);
  const f1 = frame(p);
  check("frame1-unshifted", f1.indexOf("IIII") < 0 && f1.indexOf("48;5;230") >= 0, f1);
  //  The viewport holds the banner plus 8 body rows, so the cursor reaches the
  //  foot and the NEXT j takes the viewport with it.
  for (let i = 0; i < 8; i++) send("j");
  check("key-j-scrolled", pump(p, function () { return p.view.scroll >= 1; }, 60),
        "scroll " + p.view.scroll);
  const f2 = frame(p);
  check("frame2-shifted", f2.indexOf("IIII") >= 0 && f2.indexOf("48;5;230") < 0, f2);
  check("frame2-bar-pct", f2.indexOf("TOP") < 0, f2);

  //  ---- G / g -------------------------------------------------------------
  send("G");
  check("key-G-seen", pump(p, function () { return p.view.scroll > 1; }),
        "scroll " + p.view.scroll);
  const fG = frame(p);                              // render() clamps the jump
  check("G-clamped", p.view.scroll === p.rows(40).length - 1, "scroll " + p.view.scroll);
  check("G-bottom", fG.indexOf("JJJJ") >= 0 && fG.indexOf("BOT") >= 0, fG);
  send("g");
  check("key-g-top", pump(p, function () { return p.view.scroll === 0; }),
        "scroll " + p.view.scroll);
  const fg = frame(p);
  check("g-top-frame", fg.indexOf("TOP") >= 0 && fg.indexOf("48;5;230") >= 0, fg);

  //  ---- wrap: a view OPENS no-wrap, `w` toggles ---------------------------
  const pw = new pager.Pager(sink, { tty: pty.slave, color: true, open: entry.openPath });
  pw.setHunks(entry.openPath("sub/long.txt"), "sub/long.txt");
  check("wrap-off-by-default", pw.view.wrap === false, String(pw.view.wrap));
  const nNo = pw.rows(40).length;
  const fw0 = frame(pw);
  check("nowrap-clamps-tail", fw0.indexOf("TAIL") < 0 && fw0.indexOf("HEAD") >= 0, fw0);
  check("nowrap-keeps-next-line", fw0.indexOf("SHORT") >= 0, fw0);

  send("W");
  check("key-w-wraps", pump(pw, function () { return pw.view.wrap === true; }),
        "wrap " + pw.view.wrap);
  const nYes = pw.rows(40).length;
  check("wrap-adds-rows", nYes > nNo, nNo + " -> " + nYes);
  const fw1 = frame(pw);
  check("wrap-shows-tail", fw1.indexOf("TAIL") >= 0, fw1);
  send("W");
  check("key-w-unwraps", pump(pw, function () { return pw.view.wrap === false; }),
        "wrap " + pw.view.wrap);
  check("unwrap-rows-back", pw.rows(40).length === nNo, String(pw.rows(40).length));

  //  ---- a DIR view: Enter follows an entry, `-` backs out -----------------
  const dh = entry.openPath(".");
  check("openPath-dir-list", dh !== null && dh.length === 1 && dh[0].kind === "dir",
        dh === null ? "null" : "len " + dh.length);
  const pd = new pager.Pager(sink, { tty: pty.slave, color: true, open: entry.openPath });
  pd.setHunks(dh, ".");
  const drows = pd.rows(40);
  let ri = -1;
  for (let i = 0; i < drows.length; i++)
    if (!drows[i].banner && pd._uriAt(drows[i].hunk, drows[i].off) === "doc.txt") { ri = i; break; }
  check("dir-row-found", ri > 0, "ri " + ri);
  pd.view.scroll = ri;                              // put the entry on the TOP row
  const fd0 = frame(pd);
  check("dir-frame-lists", fd0.indexOf("doc.txt") >= 0, fd0);

  send("\r");                                       // Enter = follow the top row
  check("enter-followed", pump(pd, function () { return pd.stack.length === 1; }),
        "stack " + pd.stack.length);
  check("enter-opened-file", pd.view.hunks.length === 1 && pd.view.hunks[0].uri === "doc.txt" &&
        pd.view.hunks[0].kind === "file", pd.view.hunks[0] && pd.view.hunks[0].uri);
  const fd1 = frame(pd);
  check("followed-frame-body", fd1.indexOf("AAAA") >= 0 && fd1.indexOf("doc.txt#L1") >= 0, fd1);

  send("-");                                        // back
  check("back-popped", pump(pd, function () { return pd.stack.length === 0; }),
        "stack " + pd.stack.length);
  check("back-restored-dir", pd.view.hunks[0].kind === "dir" && pd.view.path === ".",
        pd.view.path + "/" + pd.view.hunks[0].kind);
  //  popView drops the row cache (re-index for the live width) but KEEPS the
  //  scroll pos the view was left at — so the frame resumes on the entry rows.
  check("back-reindexes", pd.view.rows === null, String(pd.view.rows));
  check("back-keeps-scroll", pd.view.scroll === ri, "scroll " + pd.view.scroll);
  const fd2 = frame(pd);
  check("back-frame-lists", fd2.indexOf("doc.txt") >= 0, fd2);
  //  A FILE row follows nothing — the plain-words note, no throw.
  pd.view.scroll = 0; pd.view.cur = { row: 0, tok: -1, span: null };   // the banner row
  send("\r");
  check("enter-on-banner-notes", pump(pd, function () { return pd.message !== ""; }) &&
        pd.message === "(nothing to follow)", pd.message);

  //  ---- q sets quit --------------------------------------------------------
  send("q");
  check("key-q-quits", pump(pd, function () { return pd.quit === true; }), "quit " + pd.quit);

  //  ---- run(): the raw + ALT-screen lifecycle and the finally-restore -----
  //  run() is ended from a RENDER HOOK, not a queued key: tty.raw's TCSAFLUSH
  //  would drop a key sent before the loop starts (LITE-002 Blockers).
  const pr = new pager.Pager(sink, { tty: pty.slave, color: true, open: entry.openPath });
  pr.setHunks(entry.openPath("doc.txt"), "doc.txt");
  let painted = 0;
  const realRender = pr.render;
  pr.render = function () { realRender.call(this); painted++; this.quit = true; };
  frames = "";
  pr.run();
  //  run() emits exactly THREE writes — the enter bracket, the frame, the
  //  restore bracket — all in the file by now: one drain to EOF has them.
  drain();
  const rout = frames;
  check("run-painted-one-frame", painted === 1, "painted " + painted);
  check("run-quit", pr.quit === true, "quit " + pr.quit);
  //  tty.cook took the saved termios back in the finally; the binding exposes no
  //  getattr, so the observable is the CLEARED slot (the ticket's fallback).
  check("run-restored-saved", pr._saved === null, String(pr._saved));
  check("run-alt-screen", rout.indexOf("?1049h") >= 0 && rout.indexOf("?1049l") >= 0, rout);
  check("run-mouse-bracket", rout.indexOf("?1000h") >= 0 && rout.indexOf("?1000l") >= 0, rout);
  check("run-paste-bracket", rout.indexOf("?2004h") >= 0 && rout.indexOf("?2004l") >= 0, rout);
  check("run-cursor-back", rout.indexOf("?25l") >= 0 && rout.indexOf("?25h") >= 0, rout);
  check("run-frame-body", rout.indexOf("AAAA") >= 0 && rout.indexOf("doc.txt#L1") >= 0, rout);
  //  The ALT screen closes LAST (BRO-027) — after the reset and the cursor.
  check("run-alt-off-last", rout.lastIndexOf("?1049l") > rout.lastIndexOf("?25h"), rout);
} finally {
  tty.cook(pty.slave, saved);
}
io.close(pty.master); io.close(pty.slave); io.close(sink); io.close(tap); io.unlink(FRAMES);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
