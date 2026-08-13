//  lite/test/pager/pty.js — LITE-004 leg 3: the REAL UI path.  The lite Pager is
//  driven over a tty.openpty() slave fd — raw mode, a frame painted to a REAL
//  tty, keys pushed in through the master, the frame read back and asserted.
//  The opener is main.js's OWN openPath, so this exercises the shipped
//  entry → pager wiring, not a mock.
//
//  STEPPED, not run(): the loop is driven render/drain/send cycle by cycle.
//   -  a self-pty has no concurrent reader, so the master MUST be drained
//      between frames or the slave write blocks once the buffer fills — and a
//      drain does exactly ONE blocking read (the master is not raw; a second
//      read past the pending bytes would hang forever).
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
const pager = require("view/pager.js");
const bro = require("view/bro.js");
//  main.js exports {main, openPath} and self-runs ONLY when argv[1] ends
//  /main.js — required from here it just hands over the one fs door.
const entry = require("main.js");

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

//  ONE blocking read per drain (see the header note).
const rb = io.buf(1 << 16);
let frames = "";
function drain() {
  rb.reset();
  const k = io.read(pty.master, rb);
  if (k > 0) frames += utf8.Decode(rb.data().slice());
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
  const p = new pager.Pager(pty.slave, { color: true, open: entry.openPath });
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
  check("frame0-bar-top", f0.indexOf("TOP") >= 0 && f0.indexOf("h: help") >= 0, f0);
  const bar = p._statusLine(p.rows(40), 0, 9, 40);
  check("bar-fits-40", bar.replace(/\x1b\[[0-9;]*m/g, "").length === 40, bar);

  //  ---- j scrolls (a real key, through the pty) ---------------------------
  send("j");
  check("key-j-scrolled", pump(p, function () { return p.view.scroll === 1; }),
        "scroll " + p.view.scroll);
  const f1 = frame(p);
  check("frame1-shifted", f1.indexOf("IIII") >= 0 && f1.indexOf("48;5;230") < 0, f1);
  check("frame1-bar-pct", f1.indexOf("TOP") < 0, f1);

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
  const pw = new pager.Pager(pty.slave, { color: true, open: entry.openPath });
  pw.setHunks(entry.openPath("sub/long.txt"), "sub/long.txt");
  check("wrap-off-by-default", pw.view.wrap === false, String(pw.view.wrap));
  const nNo = pw.rows(40).length;
  const fw0 = frame(pw);
  check("nowrap-clamps-tail", fw0.indexOf("TAIL") < 0 && fw0.indexOf("HEAD") >= 0, fw0);
  check("nowrap-keeps-next-line", fw0.indexOf("SHORT") >= 0, fw0);

  send("w");
  check("key-w-wraps", pump(pw, function () { return pw.view.wrap === true; }),
        "wrap " + pw.view.wrap);
  const nYes = pw.rows(40).length;
  check("wrap-adds-rows", nYes > nNo, nNo + " -> " + nYes);
  const fw1 = frame(pw);
  check("wrap-shows-tail", fw1.indexOf("TAIL") >= 0, fw1);
  send("w");
  check("key-w-unwraps", pump(pw, function () { return pw.view.wrap === false; }),
        "wrap " + pw.view.wrap);
  check("unwrap-rows-back", pw.rows(40).length === nNo, String(pw.rows(40).length));

  //  ---- a DIR view: Enter follows an entry, `-` backs out -----------------
  const dh = entry.openPath(".");
  check("openPath-dir-list", dh !== null && dh.length === 1 && dh[0].kind === "dir",
        dh === null ? "null" : "len " + dh.length);
  const pd = new pager.Pager(pty.slave, { color: true, open: entry.openPath });
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
  pd.view.scroll = 0;                               // the banner row
  send("\r");
  check("enter-on-banner-notes", pump(pd, function () { return pd.message !== ""; }) &&
        pd.message === "(nothing to follow)", pd.message);

  //  ---- q sets quit --------------------------------------------------------
  send("q");
  check("key-q-quits", pump(pd, function () { return pd.quit === true; }), "quit " + pd.quit);

  //  ---- run(): the raw + ALT-screen lifecycle and the finally-restore -----
  //  run() is ended from a RENDER HOOK, not a queued key: tty.raw's TCSAFLUSH
  //  would drop a key sent before the loop starts (LITE-002 Blockers).
  const pr = new pager.Pager(pty.slave, { color: true, open: entry.openPath });
  pr.setHunks(entry.openPath("doc.txt"), "doc.txt");
  let painted = 0;
  const realRender = pr.render;
  pr.render = function () { realRender.call(this); painted++; this.quit = true; };
  frames = "";
  pr.run();
  //  A master read hands back ONE slave write at a time (they only sometimes
  //  coalesce), and run() emits exactly THREE: the enter bracket, the frame, the
  //  restore bracket.  Drain at most three times, stopping the moment ALT_OFF is
  //  in — a fourth read with nothing pending would block for ever.  The whole
  //  session is ~250 bytes, far under the pty buffer, so nothing blocks meanwhile.
  for (let i = 0; i < 3 && frames.indexOf("?1049l") < 0; i++) drain();
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
io.close(pty.master); io.close(pty.slave);
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
