//  lite/test/cat/hunk.js — LITE-017, be/test/cat/links ported.  be's repro was
//  BRO-006: its cat VIEW had to grow a hidden `U` click-target per grepable
//  token so the pager's left-click could `grep #<word>`.  lite HAS NO GREP
//  VERB, and needs none here — LITE-015 already makes an `F` token in a file
//  hunk a REFERENCE the pager's door resolves — so the U half of that test does
//  not port, and this pins the half that does, which is the load-bearing one:
//
//    the hunk's bytes ARE the source bytes, verbatim.  Nothing is inserted into
//    them, in either mode; the tok32 spans lie OVER those bytes, ascending and
//    covering them exactly, so a painted row strips back to the plain line.
//
//  `LITE_FIX` names the fixture repo, `LITE_REV` the historic commit.
"use strict";
const ct = require("index/cat.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}
function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function tag(w) { return String.fromCharCode(65 + ((w >>> 27) & 0x1f)); }
function end(w) { return w & 0xffffff; }

const repo = io.getenv("LITE_FIX");
const REV = io.getenv("LITE_REV");

//  A tiny C file: a function definition that CALLS a function — be's own
//  fixture, so the lexer has something to tag.
const SRC = "int add(int a, int b) {\n    puts(\"hi\");\n    return a + b;\n}\n";
(function write(p, bytes) {
  const fd = io.open(p, "c");
  const b = io.buf(bytes.length + 8); b.feed(bytes); io.writeAll(fd, b);
  io.close(fd);
})(repo + "/add.c", utf8.Encode(SRC));

const out = ct.cat("add.c", { from: repo });
check("one hunk for one file", out.hunks.length === 1, out.hunks.length);
const h = out.hunks[0];
check("hunk-shape", h.verb === "hunk" && h.kind === "cat" &&
      h.text instanceof Uint8Array && h.toks instanceof Uint32Array, h.verb + " " + h.kind);
check("hunk-banners-the-verb-and-the-path", h.uri === "cat add.c", h.uri);

//  THE contract: the hunk body IS the source, byte for byte.  be appends U
//  bytes into its body; lite inserts nothing at all, in any mode.
check("the hunk body is the VERBATIM source", bytesEq(h.text, utf8.Encode(SRC)),
      utf8.Decode(h.text));
check("--plain writes those same bytes", bytesEq(out.bytes, utf8.Encode(SRC)));

//  The spans lie over them: a known extension is tokenized, the ends ascend,
//  and the last one closes at the last byte.
check("a known extension is tokenized", h.toks.length > 0, h.toks.length);
let asc = true, prev = 0;
for (let i = 0; i < h.toks.length; i++) { if (end(h.toks[i]) < prev) asc = false; prev = end(h.toks[i]); }
check("tok ends ascend", asc, prev);
check("the spans cover the text exactly", prev === h.text.length, prev + "/" + h.text.length);
let anyU = false;
for (let i = 0; i < h.toks.length; i++) if (tag(h.toks[i]) === "U") anyU = true;
check("no hidden U token — lite has no grep verb to point one at", !anyU);

//  An unknown extension is NOT tokenized, and the bytes still come through:
//  be's cat gates tok.parse on the extension the same way.
(function write(p, bytes) {
  const fd = io.open(p, "c");
  const b = io.buf(bytes.length + 8); b.feed(bytes); io.writeAll(fd, b);
  io.close(fd);
})(repo + "/plain", utf8.Encode("no extension here\n"));
const noext = ct.cat("plain", { from: repo });
check("an extension-less file has no toks and all its bytes",
      noext.hunks[0].toks.length === 0 &&
      bytesEq(noext.hunks[0].text, utf8.Encode("no extension here\n")));

//  The `?<rev>` form takes the SAME road: a hunk over the blob's own bytes,
//  banner'd with the rev so a click reopens that rev and not the worktree.
const rev = ct.cat("gone.c?" + REV, { from: repo });
check("the ?<rev> form is one hunk too", rev.hunks.length === 1, rev.hunks.length);
check("...banner'd with the rev", rev.hunks[0].uri === "cat gone.c?" + REV, rev.hunks[0].uri);
check("...over the blob's verbatim bytes", bytesEq(rev.hunks[0].text, rev.bytes));
check("...and tokenized by the PATH's extension, not the rev",
      rev.hunks[0].toks.length > 0, rev.hunks[0].toks.length);

//  An EMPTY file emits no hunk at all — be's own no-banner-for-nothing case.
(function touch(p) { const fd = io.open(p, "c"); io.close(fd); })(repo + "/empty.c");
const empty = ct.cat("empty.c", { from: repo });
check("an empty file emits no hunk", empty.hunks.length === 0 && empty.bytes.length === 0,
      empty.hunks.length);

//  A SYMLINK reads as its target STRING (the git blob body), never followed —
//  index/diff.js's own reader, reused rather than re-derived.
try { io.unlink(repo + "/link.c"); } catch (e) {}
io.symlink("add.c", repo + "/link.c");
const lnk = ct.cat("link.c", { from: repo });
check("a symlink reads as its target string, not the target's bytes",
      utf8.Decode(lnk.bytes) === "add.c", utf8.Decode(lnk.bytes));

for (const f of ["add.c", "plain", "empty.c", "link.c"]) {
  try { io.unlink(repo + "/" + f); } catch (e) {}
}
w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
